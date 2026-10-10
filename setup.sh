#!/usr/bin/env bash
# Interactive first-time setup helper
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== School Management System — Setup ==="
echo ""

if ! command -v node >/dev/null; then
  echo "Node.js required. Install from https://nodejs.org"
  exit 1
fi

echo "[1/5] npm install..."
npm install

echo ""
echo "[2/5] Cloudflare login (browser will open)..."
npx wrangler login

echo ""
echo "[3/5] Create D1 database 'school-db'..."
npx wrangler d1 create school-db || true
echo ""
echo ">>> Copy database_id from above into wrangler.toml (database_id = \"...\")"
read -r -p "Press Enter after updating wrangler.toml..."

echo ""
echo "[4/5] Apply schema to remote D1..."
npx wrangler d1 execute school-db --file=./sql/schema.sql

echo ""
echo "[5/5] Set secrets (Google Drive + JWT)..."
echo "You will be prompted for each secret value."
npx wrangler secret put ADMIN_JWT_SECRET
npx wrangler secret put GOOGLE_CLIENT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler secret put GOOGLE_DRIVE_FOLDER_ID

echo ""
echo "Edit public/config.js → set window.SMS_API_BASE to your workers.dev URL after deploy."
echo ""
echo "Deploy now? (y/n)"
read -r ans
if [[ "$ans" == "y" || "$ans" == "Y" ]]; then
  npx wrangler deploy
  echo "Done! Open the URL shown above + /admin-panel.html"
else
  echo "Run later: npm run deploy"
fi
