/**
 * Cloudflare Worker — School Management API + static assets
 * Binds: DB (D1), ASSETS (static files)
 * Secrets: ADMIN_JWT_SECRET, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_DRIVE_FOLDER_ID
 */

import { fullBackupToDrive, uploadPhoto, uploadFile } from './google-drive.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function makeToken(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 86400 * 7 }));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${data}.${sigB64}`;
}

async function verifyToken(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const data = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!ok) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireAuth(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  return verifyToken(token, env.ADMIN_JWT_SECRET || 'dev-secret-change-me');
}

// ─── Route handlers ───────────────────────────────────────────

async function handleLogin(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) return err('Email and password required');
  const hash = await sha256(password);
  const user = await env.DB.prepare('SELECT id, email, name, role FROM users WHERE email = ? AND password_hash = ?')
    .bind(email, hash)
    .first();
  if (!user) return err('Invalid credentials', 401);
  const token = await makeToken({ uid: user.id, email: user.email, role: user.role }, env.ADMIN_JWT_SECRET || 'dev-secret-change-me');
  return json({ token, user });
}

async function listStudents(env, url) {
  const cls = url.searchParams.get('cls');
  const q = url.searchParams.get('q');
  let sql = 'SELECT * FROM students WHERE 1=1';
  const binds = [];
  if (cls) {
    sql += ' AND cls = ?';
    binds.push(cls);
  }
  if (q) {
    sql += ' AND (name LIKE ? OR sid LIKE ? OR roll LIKE ?)';
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  sql += ' ORDER BY id DESC';
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  // Map snake_case → camelCase for frontend
  const rows = (results || []).map((s) => ({
    id: s.id,
    sid: s.sid,
    name: s.name,
    cls: s.cls,
    section: s.section,
    roll: s.roll,
    father: s.father,
    mother: s.mother,
    phone: s.phone,
    dob: s.dob,
    bloodGroup: s.blood_group,
    gender: s.gender,
    religion: s.religion,
    birthRegNo: s.birth_reg_no,
    address: s.address,
    status: s.status,
    photo: s.photo_url,
    photoDriveId: s.photo_drive_id,
  }));
  return json(rows);
}

async function saveStudent(request, env, id) {
  const body = await request.json();
  let photoUrl = body.photo || null;
  let photoDriveId = body.photoDriveId || null;

  // If photo is a data-URL, upload to Google Drive
  if (photoUrl && photoUrl.startsWith('data:') && env.GOOGLE_CLIENT_EMAIL) {
    try {
      const fileName = `student-${body.sid || 'unknown'}-${Date.now()}`;
      const file = await uploadPhoto(env, photoUrl, fileName);
      photoDriveId = file.id;
      photoUrl = file.webViewLink || file.webContentLink || photoUrl;
    } catch (e) {
      // Keep local data-URL if Drive fails; still save student
      console.log('Drive photo upload failed:', e.message);
    }
  }

  if (id) {
    await env.DB.prepare(
      `UPDATE students SET sid=?, name=?, cls=?, section=?, roll=?, father=?, mother=?, phone=?, dob=?,
       blood_group=?, gender=?, religion=?, birth_reg_no=?, address=?, status=?,
       photo_url=COALESCE(?, photo_url), photo_drive_id=COALESCE(?, photo_drive_id),
       updated_at=datetime('now') WHERE id=?`
    )
      .bind(
        body.sid, body.name, body.cls, body.section, body.roll,
        body.father || '', body.mother || '', body.phone || '', body.dob || '',
        body.bloodGroup || '', body.gender || '', body.religion || '', body.birthRegNo || '',
        body.address || '', body.status || 'active',
        photoUrl, photoDriveId, id
      )
      .run();
    return json({ ok: true, id: Number(id) });
  }

  const r = await env.DB.prepare(
    `INSERT INTO students (sid, name, cls, section, roll, father, mother, phone, dob,
      blood_group, gender, religion, birth_reg_no, address, status, photo_url, photo_drive_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      body.sid, body.name, body.cls, body.section, body.roll,
      body.father || '', body.mother || '', body.phone || '', body.dob || '',
      body.bloodGroup || '', body.gender || '', body.religion || '', body.birthRegNo || '',
      body.address || '', body.status || 'active', photoUrl, photoDriveId
    )
    .run();
  return json({ ok: true, id: r.meta.last_row_id });
}

async function deleteStudent(env, id) {
  await env.DB.prepare('DELETE FROM students WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  (results || []).forEach((r) => (obj[r.key] = r.value));
  return json(obj);
}

async function saveSettings(request, env) {
  const body = await request.json();
  for (const [k, v] of Object.entries(body)) {
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
    )
      .bind(k, String(v ?? ''))
      .run();
  }
  return json({ ok: true });
}

async function runBackup(env) {
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_DRIVE_FOLDER_ID) {
    return err('Google Drive not configured. Set GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_DRIVE_FOLDER_ID secrets.', 503);
  }
  try {
    const file = await fullBackupToDrive(env, env.DB, 'manual');
    return json({ ok: true, file, message: 'Backup uploaded to Google Drive (JSON + students CSV)' });
  } catch (e) {
    return err('Backup failed: ' + e.message, 500);
  }
}

async function backupLogs(env) {
  const { results } = await env.DB.prepare('SELECT * FROM backup_log ORDER BY id DESC LIMIT 50').all();
  return json(results || []);
}

async function exportStudentsCsv(env) {
  const { results } = await env.DB.prepare('SELECT * FROM students ORDER BY id').all();
  const headers = [
    'sid', 'name', 'cls', 'section', 'roll', 'father', 'mother', 'phone', 'dob',
    'blood_group', 'gender', 'religion', 'birth_reg_no', 'address', 'status',
  ];
  const lines = [headers.join(',')];
  for (const s of results || []) {
    lines.push(
      headers
        .map((h) => `"${String(s[h] ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );
  }
  const csv = lines.join('\n');

  // Also push CSV to Google Drive if configured
  if (env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_DRIVE_FOLDER_ID) {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await uploadFile(env, {
        name: `students-export-${stamp}.csv`,
        mimeType: 'text/csv',
        content: csv,
        folder: 'exports',
      });
    } catch (_) {}
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="students.csv"',
      ...CORS,
    },
  });
}

// ─── Main fetch ───────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // API routes
    if (path.startsWith('/api/')) {
      try {
        // Public
        if (path === '/api/login' && method === 'POST') return handleLogin(request, env);
        if (path === '/api/health') return json({ ok: true, ts: Date.now() });

        // Auth required for most routes
        const auth = await requireAuth(request, env);
        const isPublicRead =
          (path === '/api/notices' || path === '/api/events') && method === 'GET';

        if (!auth && !isPublicRead) return err('Unauthorized', 401);

        if (path === '/api/students' && method === 'GET') return listStudents(env, url);
        if (path === '/api/students' && method === 'POST') return saveStudent(request, env, null);
        if (path.match(/^\/api\/students\/\d+$/) && method === 'PUT') {
          const id = path.split('/').pop();
          return saveStudent(request, env, id);
        }
        if (path.match(/^\/api\/students\/\d+$/) && method === 'DELETE') {
          return deleteStudent(env, path.split('/').pop());
        }
        if (path === '/api/students/export' && method === 'GET') return exportStudentsCsv(env);

        if (path === '/api/settings' && method === 'GET') return getSettings(env);
        if (path === '/api/settings' && method === 'PUT') return saveSettings(request, env);

        if (path === '/api/backup' && method === 'POST') return runBackup(env);
        if (path === '/api/backup/logs' && method === 'GET') return backupLogs(env);

        return err('Not found', 404);
      } catch (e) {
        return err(e.message || 'Server error', 500);
      }
    }

    // Static assets (admin-panel.html, school-website.html, …)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('School Management System API is running. Deploy frontend assets.', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },

  /**
   * Automatic Google Drive backup (Cloudflare Cron Triggers)
   * Schedule in wrangler.toml:
   *   "0 20 * * *" → 02:00 AM Bangladesh (UTC+6)
   *   "0 8 * * *"  → 02:00 PM Bangladesh
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const cron = (event && event.cron) || 'unknown';
        console.log('Auto-backup started, cron=', cron);
        if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.GOOGLE_DRIVE_FOLDER_ID) {
          console.log('Skip backup: Google Drive secrets not configured');
          try {
            await env.DB.prepare(
              `INSERT INTO backup_log (backup_type, drive_file_id, drive_file_url, file_name, size_bytes, status)
               VALUES (?, '', '', '', 0, ?)`
            ).bind('scheduled', 'skipped: missing Google Drive secrets').run();
          } catch (_) {}
          return;
        }
        try {
          const file = await fullBackupToDrive(env, env.DB, 'scheduled:' + cron);
          console.log('Auto-backup OK:', file && file.name, file && file.id);
        } catch (e) {
          console.log('Scheduled backup failed:', e.message);
          try {
            await env.DB.prepare(
              `INSERT INTO backup_log (backup_type, drive_file_id, drive_file_url, file_name, size_bytes, status)
               VALUES (?, '', '', '', 0, ?)`
            ).bind('scheduled', 'error: ' + String(e.message || e).slice(0, 200)).run();
          } catch (_) {}
        }
      })()
    );
  },
};
