# School Management System  
### Cloudflare Workers + D1 Database + Google Drive Backup

স্কুল ম্যানেজমেন্ট সিস্টেম — কোড **GitHub**-এ, ডেটা **Cloudflare D1**-এ, ছবি/PDF/ব্যাকআপ **Google Drive**-এ।

---

## ফিচার

- শিক্ষার্থী CRUD (নাম, আইডি, শ্রেণি, রক্তের গ্রুপ, ঠিকানা, ছবি…)
- আইডি কার্ড জেনারেটর (পোর্ট্রেট, নীল+সোনালি ডিজাইন)
- উপস্থিতি, ফি, রেজাল্ট, নোটিশ, ইভেন্ট
- **Cloudflare D1** — স্থায়ী ডেটাবেজ (পেজ রিফ্রেশে মুছে যায় না)
- **Google Drive**
  - শিক্ষার্থীর ছবি আপলোড
  - PDF (রিসিট/সার্টিফিকেট) সংরক্ষণ
  - প্রতিদিন স্বয়ংক্রিয় JSON ব্যাকআপ
  - CSV এক্সপোর্ট কপি
- অ্যাডমিন প্যানেল + পাবলিক স্কুল ওয়েবসাইট

---

## ফোল্ডার স্ট্রাকচার

```
school-mgmt-cloud/
├── public/                 # Frontend (Workers Assets)
│   ├── admin-panel.html
│   ├── school-website.html
│   ├── config.js           # ← API URL এখানে সেট করুন
│   └── api-client.js
├── worker/src/
│   ├── index.js            # API + cron backup
│   └── google-drive.js     # Drive upload helpers
├── sql/
│   └── schema.sql          # D1 tables
├── docs/
│   └── DEPLOY.md           # বিস্তারিত ডিপ্লয় গাইড
├── wrangler.toml
├── package.json
└── README.md
```

---

## দ্রুত শুরু (লোকাল)

```bash
npm install
npm run db:migrate:local
npm run dev
```

ব্রাউজারে `http://127.0.0.1:8787/admin-panel.html`

ডিফল্ট লগইন: `admin@school.edu.bd` / `admin123`

---

## প্রোডাকশন ডিপ্লয়

সম্পূর্ণ ধাপ: **[docs/DEPLOY.md](docs/DEPLOY.md)**

সংক্ষেপে:

1. **GitHub**-এ রিপো পুশ  
2. `wrangler login` + `npm run db:create` → `database_id` `wrangler.toml`-এ  
3. `npm run db:migrate`  
4. Google Service Account + Drive ফোল্ডার → `wrangler secret put …`  
5. `public/config.js`-এ Worker URL  
6. `npm run deploy`

---

## Google Drive ফোল্ডার

```
School-Management-Backups/
├── photos/      শিক্ষার্থী/শিক্ষক ছবি
├── pdfs/        রিসিট, সার্টিফিকেট, আইডি PDF
├── backups/     দৈনিক সম্পূর্ণ JSON ডাম্প
└── exports/     CSV এক্সপোর্ট
```

Cron: প্রতিদিন 02:00 UTC-এ অটো ব্যাকআপ।

---

## গুরুত্বপূর্ণ

| বিষয় | নোট |
|--------|------|
| আমি আপনার অ্যাকাউন্টে আপলোড করতে পারি না | GitHub / Cloudflare / Google-এ **আপনার লগইন** লাগে |
| এই প্যাকেজ | কোড + স্কিমা + API প্রস্তুত — আপনি এক কমান্ডে ডিপ্লয় করবেন |
| সিক্রেট | কখনো Git-এ কমিট করবেন না (`.gitignore` আছে) |

---

## লাইসেন্স

Private school use. Customize as needed.
