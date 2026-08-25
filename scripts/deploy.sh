#!/usr/bin/env bash
#
# Pull the latest code and restart the app.
#
#   ./scripts/deploy.sh
#
# set -e stops at the first failure, so a broken build never reaches pm2 —
# the old version keeps serving instead of going down.

set -e

cd "$(dirname "$0")/.."

echo "==> Pulling latest"
git pull

echo "==> Installing dependencies"
npm install

# npm can preserve the bundled 7za binary without its executable bit on some
# Linux hosts. Historical-price backfills need to launch it directly.
chmod +x node_modules/7zip-bin/linux/*/7za 2>/dev/null || true

echo "==> Applying schema"
npx prisma db push

echo "==> Building"
npm run build

echo "==> Restarting"
pm2 restart drop-buddy
pm2 status

echo
echo "Done. https://z863.com"
