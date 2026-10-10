-- Cloudflare D1 Schema — School Management System
-- Run: wrangler d1 execute school-db --file=./sql/schema.sql

PRAGMA foreign_keys = ON;

-- School settings / profile
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Students
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  cls TEXT,
  section TEXT,
  roll TEXT,
  father TEXT,
  mother TEXT,
  phone TEXT,
  dob TEXT,
  blood_group TEXT,
  gender TEXT,
  religion TEXT,
  birth_reg_no TEXT,
  address TEXT,
  status TEXT DEFAULT 'active',
  photo_url TEXT,          -- Google Drive file URL or local path
  photo_drive_id TEXT,     -- Google Drive file ID
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_cls ON students(cls);
CREATE INDEX IF NOT EXISTS idx_students_sid ON students(sid);

-- Teachers
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  desig TEXT,
  subject TEXT,
  dept TEXT,
  qual TEXT,
  phone TEXT,
  join_date TEXT,
  photo_url TEXT,
  photo_drive_id TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  att_date TEXT NOT NULL,
  status TEXT NOT NULL, -- present | absent | late
  cls TEXT,
  section TEXT,
  UNIQUE(student_id, att_date),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- Fee types
CREATE TABLE IF NOT EXISTS fee_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0
);

-- Fee records / receipts
CREATE TABLE IF NOT EXISTS fee_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT UNIQUE,
  student_id INTEGER,
  student_name TEXT,
  sid TEXT,
  cls TEXT,
  fee_type TEXT,
  amount REAL,
  method TEXT,
  receipt_date TEXT,
  drive_pdf_id TEXT,
  drive_pdf_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
);

-- Results
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  sid TEXT,
  name TEXT,
  cls TEXT,
  section TEXT,
  roll TEXT,
  exam TEXT,
  session TEXT,
  marks_json TEXT,  -- JSON object of subject:marks
  total REAL,
  gpa REAL,
  grade TEXT,
  published INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
);

-- Notices
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  notice_date TEXT,
  published INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Events
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  event_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Gallery
CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  image_url TEXT,
  drive_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Messages to parents
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  title TEXT,
  body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Admission applications
CREATE TABLE IF NOT EXISTS admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_no TEXT UNIQUE,
  name TEXT,
  cls TEXT,
  father TEXT,
  mother TEXT,
  dob TEXT,
  gender TEXT,
  blood_group TEXT,
  religion TEXT,
  address TEXT,
  guardian_phone TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Admin users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Backup log (Google Drive)
CREATE TABLE IF NOT EXISTS backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_type TEXT,       -- full | photos | pdfs
  drive_file_id TEXT,
  drive_file_url TEXT,
  file_name TEXT,
  size_bytes INTEGER,
  status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed default admin (password: admin123 — change after first login)
-- Hash is SHA-256 of "admin123" for demo; production should use proper hashing in Worker
INSERT OR IGNORE INTO users (id, email, password_hash, name, role)
VALUES (1, 'admin@school.edu.bd', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'Admin', 'admin');

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('school_name', 'Rohamat Pur M.M High School'),
  ('school_short', 'ROHAMAT PUR M.M HIGH SCHOOL'),
  ('motto', 'Knowledge | Discipline | Excellence'),
  ('address', 'Gaibandha Sadar, Gaibandha'),
  ('phone', '01715981981'),
  ('email', 'info@greenfield.edu.bd'),
  ('website', 'www.rmmedu.bd'),
  ('session', '2026'),
  ('principal_name', ''),
  ('principal_title', 'Principal');
