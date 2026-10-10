/**
 * Google Drive helper for Cloudflare Workers
 * Uses a Service Account (JSON key) stored as secrets.
 *
 * Folder structure created under GOOGLE_DRIVE_FOLDER_ID:
 *   School-Management-Backups/
 *     ├── photos/          student & teacher photos
 *     ├── pdfs/            receipts, certificates, ID cards
 *     ├── backups/         full JSON database dumps
 *     └── exports/         CSV exports
 */

const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let cachedToken = null;
let tokenExpiry = 0;

/** Base64url encode (Workers-safe) */
function b64url(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Import PKCS8 PEM private key for RS256 JWT */
async function importPrivateKey(pem) {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/** Get OAuth2 access token via JWT assertion (Service Account) */
export async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < tokenExpiry - 60) return cachedToken;

  const email = env.GOOGLE_CLIENT_EMAIL;
  const keyPem = env.GOOGLE_PRIVATE_KEY;
  if (!email || !keyPem) throw new Error('Google Drive credentials not configured');

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: email,
      scope: 'https://www.googleapis.com/auth/drive.file',
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const key = await importPrivateKey(keyPem);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Google token error: ' + t);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in || 3600);
  return cachedToken;
}

/** Ensure subfolder exists under parent; return folder ID */
async function ensureFolder(token, parentId, name) {
  const q = encodeURIComponent(
    `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const list = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await list.json();
  if (data.files && data.files.length) return data.files[0].id;

  const create = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const folder = await create.json();
  if (!folder.id) throw new Error('Failed to create folder: ' + JSON.stringify(folder));
  return folder.id;
}

/** Upload a file (binary or text) to Drive; returns {id, webViewLink, webContentLink} */
export async function uploadFile(env, { name, mimeType, content, folder = 'backups' }) {
  const token = await getAccessToken(env);
  const rootId = env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootId) throw new Error('GOOGLE_DRIVE_FOLDER_ID not set');

  const folderId = await ensureFolder(token, rootId, folder);

  const metadata = JSON.stringify({ name, parents: [folderId] });
  const boundary = 'sms_boundary_' + Date.now();
  let body;

  if (typeof content === 'string') {
    body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n` +
      `--${boundary}--`;
  } else {
    // Binary: content is ArrayBuffer or Uint8Array
    const metaPart = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const endPart = new TextEncoder().encode(`\r\n--${boundary}--`);
    const bin = content instanceof Uint8Array ? content : new Uint8Array(content);
    body = new Uint8Array(metaPart.length + bin.length + endPart.length);
    body.set(metaPart, 0);
    body.set(bin, metaPart.length);
    body.set(endPart, metaPart.length + bin.length);
  }

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink,webContentLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Drive upload failed: ' + t);
  }
  return res.json();
}

/** Upload base64 data-URL image (student photo) */
export async function uploadPhoto(env, dataUrl, fileName) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL for photo');
  const mimeType = match[1];
  const binary = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  return uploadFile(env, {
    name: fileName.endsWith(ext) ? fileName : `${fileName}.${ext}`,
    mimeType,
    content: binary,
    folder: 'photos',
  });
}

/** Upload PDF bytes */
export async function uploadPdf(env, bytes, fileName) {
  return uploadFile(env, {
    name: fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`,
    mimeType: 'application/pdf',
    content: bytes,
    folder: 'pdfs',
  });
}

/** Full automatic backup → Google Drive (JSON + students CSV) */
export async function fullBackupToDrive(env, db, reason = 'scheduled') {
  const tables = [
    'students', 'teachers', 'attendance', 'fee_types', 'fee_receipts',
    'results', 'notices', 'events', 'gallery', 'messages', 'admissions', 'settings', 'users',
  ];
  const dump = {
    exported_at: new Date().toISOString(),
    timezone_note: 'Timestamps are UTC; Bangladesh = UTC+6',
    reason,
    tables: {},
  };
  for (const t of tables) {
    try {
      // Never dump password hashes in readable backup of users — only id/email/role
      if (t === 'users') {
        const { results } = await db.prepare('SELECT id, email, name, role, created_at FROM users').all();
        dump.tables[t] = results || [];
      } else {
        const { results } = await db.prepare(`SELECT * FROM ${t}`).all();
        dump.tables[t] = results || [];
      }
    } catch {
      dump.tables[t] = [];
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const json = JSON.stringify(dump, null, 2);

  // 1) Full JSON dump
  const file = await uploadFile(env, {
    name: `backup-full-${stamp}.json`,
    mimeType: 'application/json',
    content: json,
    folder: 'backups',
  });

  await db
    .prepare(
      `INSERT INTO backup_log (backup_type, drive_file_id, drive_file_url, file_name, size_bytes, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(reason || 'full', file.id, file.webViewLink || '', file.name, json.length, 'ok')
    .run();

  // 2) Students CSV (easy to open in Excel / Sheets)
  try {
    const students = dump.tables.students || [];
    const headers = [
      'id','sid','name','cls','section','roll','father','mother','phone','dob',
      'blood_group','gender','religion','birth_reg_no','address','status','photo_url','photo_drive_id',
    ];
    const lines = [headers.join(',')];
    for (const s of students) {
      lines.push(headers.map((h) => `"${String(s[h] ?? '').replace(/"/g, '""')}"`).join(','));
    }
    const csv = lines.join('\n');
    const csvFile = await uploadFile(env, {
      name: `students-${stamp}.csv`,
      mimeType: 'text/csv',
      content: csv,
      folder: 'exports',
    });
    await db
      .prepare(
        `INSERT INTO backup_log (backup_type, drive_file_id, drive_file_url, file_name, size_bytes, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind('students_csv', csvFile.id, csvFile.webViewLink || '', csvFile.name, csv.length, 'ok')
      .run();
  } catch (e) {
    console.log('CSV backup skipped:', e.message);
  }

  return file;
}
