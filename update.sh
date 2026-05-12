#!/bin/bash
# update.sh - Update Ketantech VPN Bot dari git repo
# Jalankan dari /root/BotVPN: bash update.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BOT_DIR="/root/BotVPN"
BACKUP_DIR="/root/BotVPN-backup-$(date +%Y%m%d-%H%M%S)"

if [ ! -d "$BOT_DIR/.git" ]; then
  echo -e "${RED}Repo git tidak ditemukan di $BOT_DIR. Deploy awal pakai DEPLOY.md dulu.${NC}"
  exit 1
fi

cd "$BOT_DIR"

echo -e "${YELLOW}==> Backup database ke $BACKUP_DIR${NC}"
mkdir -p "$BACKUP_DIR"
cp -a ./*.db "$BACKUP_DIR" 2>/dev/null || true
cp -a ./.env "$BACKUP_DIR" 2>/dev/null || true
cp -a ./.vars.json "$BACKUP_DIR" 2>/dev/null || true
cp -a ./trial_config.json ./trial_settings.json "$BACKUP_DIR" 2>/dev/null || true

echo -e "${YELLOW}==> git fetch & pull${NC}"
git fetch --all --prune
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git pull --rebase origin "$CURRENT_BRANCH"

echo -e "${YELLOW}==> Install dependency (npm ci bila lockfile ada)${NC}"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

chmod +x cek-port.sh update.sh 2>/dev/null || true

echo -e "${YELLOW}==> Smoke test${NC}"
node --check app.js
node scripts/smoke-audit.js

echo -e "${YELLOW}==> Restart PM2${NC}"
if pm2 describe sellvpn >/dev/null 2>&1; then
  pm2 restart sellvpn --update-env
else
  pm2 start ecosystem.config.js
  pm2 save
fi

echo -e "${GREEN}==> Update selesai. Backup tersimpan di $BACKUP_DIR${NC}"
pm2 status sellvpn
