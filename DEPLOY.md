# Deploy Guide — GitHub + Cloudflare D1 + Google Drive

## Overview

| Layer | Service | Purpose |
|-------|---------|---------|
| Code | **GitHub** | Source control & CI |
| Hosting + API | **Cloudflare Workers** | Serve HTML + REST API |
| Database | **Cloudflare D1** | Students, fees, results… (SQLite) |
| Files & Backup | **Google Drive** | Photos, PDFs, daily JSON backups |

```
Browser  →  Cloudflare Worker  →  D1 (data)
                              ↘  Google Drive (photos / PDF / backup JSON)
```

---

## 1. Push to GitHub

```bash
cd school-mgmt-cloud
git init
git add .
git commit -m "School Management System — D1 + Google Drive"
# Create empty repo on github.com, then:
git remote add origin https://github.com/YOUR_USER/school-management-system.git
git branch -M main
git push -u origin main
```

---

## 2. Cloudflare account + Wrangler

1. Sign up: https://dash.cloudflare.com  
2. Install Node.js 18+  
3. Install deps & login:

```bash
npm install
npx wrangler login
```

---

## 3. Create D1 database

```bash
npm run db:create
# Copy the database_id from output into wrangler.toml:
#   database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Apply schema (remote):

```bash
npm run db:migrate
```

Local test DB:

```bash
npm run db:migrate:local
npm run dev
```

---

## 4. Google Drive setup (photos + backup)

### 4.1 Service Account
1. Google Cloud Console → create project  
2. Enable **Google Drive API**  
3. IAM → Service Accounts → Create  
4. Key → JSON → download  
5. Note `client_email` and `private_key`

### 4.2 Shared folder
1. Google Drive → New Folder: `School-Management-Backups`  
2. Share folder with the service account email (**Editor**)  
3. Open folder → URL has `.../folders/FOLDER_ID` — copy that ID  

### 4.3 Set Worker secrets

```bash
npx wrangler secret put ADMIN_JWT_SECRET
# paste a long random string

npx wrangler secret put GOOGLE_CLIENT_EMAIL
# paste client_email from JSON

npx wrangler secret put GOOGLE_PRIVATE_KEY
# paste private_key (including BEGIN/END lines; keep \n or real newlines)

npx wrangler secret put GOOGLE_DRIVE_FOLDER_ID
# paste folder ID
```

Folder structure auto-created under that root:

```
School-Management-Backups/
  photos/     ← student/teacher photos
  pdfs/       ← receipts, certificates
  backups/    ← daily full JSON dumps
  exports/    ← CSV exports
```

---

## 5. Point frontend to API

Edit `public/config.js`:

```js
window.SMS_API_BASE = "https://school-management-system.YOUR_SUBDOMAIN.workers.dev";
```

---

## 6. Deploy

```bash
npm run deploy
```

Open the `*.workers.dev` URL.  
Default login: `admin@school.edu.bd` / `admin123` — **change immediately**.

---

## 7. Automatic Google Drive backup (already configured)

`wrangler.toml` runs **two cron jobs every day** (Bangladesh time UTC+6):

```toml
[triggers]
crons = ["0 20 * * *", "0 8 * * *"]
# 20:00 UTC = 02:00 AM Bangladesh
# 08:00 UTC = 02:00 PM Bangladesh
```

Each run uploads:
1. **Full JSON** → `School-Management-Backups/backups/backup-full-....json`  
   (students, teachers, fees, results, attendance, settings, …)
2. **Students CSV** → `School-Management-Backups/exports/students-....csv`

Success/failure is written to D1 table `backup_log`.

**Manual backup**
- Admin panel → Settings → Backup → **এখনই Google Drive-এ ব্যাকআপ করুন**
- Or API: `POST /api/backup` (with auth token)

No extra cron setup is needed after `wrangler deploy` — Cloudflare runs the schedule automatically.

---

## 8. Optional: Custom domain

Cloudflare Dashboard → Workers → your worker → Triggers → Custom Domains  
Add `admin.yourschool.edu.bd` etc.

---

## Security checklist

- [ ] Change default admin password (update `users.password_hash` in D1)  
- [ ] Rotate `ADMIN_JWT_SECRET`  
- [ ] Never commit `.dev.vars` or service-account JSON  
- [ ] Restrict Drive folder to the service account only  
- [ ] Enable Cloudflare WAF / rate limiting on `/api/login` if public  

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `database_id` error | Run `db:create` and paste ID into `wrangler.toml` |
| Drive upload fails | Check SA has Editor on folder; Drive API enabled |
| 401 on API | Re-login; check `ADMIN_JWT_SECRET` matches |
| Photos still data-URL | Secrets missing — Worker falls back to storing data-URL in D1 |
