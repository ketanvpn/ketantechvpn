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

# Guard: repo harus di branch (bukan detached HEAD) biar git pull aman
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
  echo -e "${RED}Repo dalam state detached HEAD. Checkout ke branch dulu (mis. 'git checkout main') sebelum update.${NC}"
  exit 1
fi

# Guard: pastikan working tree bersih supaya 'git pull --rebase' tidak pecah
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${RED}Ada perubahan lokal yang belum di-commit di $BOT_DIR.${NC}"
  echo -e "${YELLOW}Pilihan:${NC}"
  echo -e "  1) git stash  (simpan perubahan dulu, lalu jalankan update ulang)"
  echo -e "  2) git checkout -- <file>  (buang perubahan lokal kalau tidak perlu)"
  echo -e "  3) commit dulu kalau memang perubahan penting"
  git status --short
  exit 1
fi

echo -e "${YELLOW}==> Backup database ke $BACKUP_DIR${NC}"
mkdir -p "$BACKUP_DIR"
cp -a ./*.db "$BACKUP_DIR" 2>/dev/null || true
cp -a ./.env "$BACKUP_DIR" 2>/dev/null || true
cp -a ./.vars.json "$BACKUP_DIR" 2>/dev/null || true
cp -a ./trial_config.json ./trial_settings.json "$BACKUP_DIR" 2>/dev/null || true

echo -e "${YELLOW}==> git fetch & pull${NC}"
git fetch --all --prune
git pull --rebase origin "$CURRENT_BRANCH"

echo -e "${YELLOW}==> Install dependency (npm ci bila lockfile ada)${NC}"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

# Rebuild native module kalau Node version berubah antar update (sqlite3 dll)
if [ -d node_modules ]; then
  npm rebuild --omit=dev >/dev/null 2>&1 || true
fi

# Pastikan semua shell script executable (termasuk yang di scripts/)
find . -maxdepth 2 -name '*.sh' -type f -exec chmod +x {} + 2>/dev/null || true

echo -e "${YELLOW}==> Smoke test${NC}"
node --check app.js
if [ -f scripts/smoke-audit.js ]; then
  node scripts/smoke-audit.js
fi
if [ -d tests ]; then
  node --test tests/*.test.js tests/integration/*.test.js >/dev/null 2>&1 && \
    echo -e "${GREEN}Unit test: pass${NC}" || \
    echo -e "${YELLOW}Unit test: ada yang fail / skip (tidak blocking)${NC}"
fi

echo -e "${YELLOW}==> Restart PM2${NC}"
if pm2 describe sellvpn >/dev/null 2>&1; then
  pm2 restart sellvpn --update-env
else
  pm2 start ecosystem.config.js
  pm2 save
fi

# Tunggu sebentar supaya bot sempat init, lalu verifikasi masih online
sleep 3
STATUS=$(pm2 jlist 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    try{const j=JSON.parse(d);const p=j.find(x=>x.name==='sellvpn');
    console.log(p?p.pm2_env.status:'not-found')}catch(e){console.log('parse-err')}
  });
" 2>/dev/null || echo "unknown")

echo -e "${YELLOW}==> Status PM2:${NC}"
pm2 status sellvpn

if [ "$STATUS" = "online" ]; then
  echo -e "${GREEN}==> Update selesai. Bot online.${NC}"
  echo -e "${GREEN}    Backup: $BACKUP_DIR${NC}"
else
  echo -e "${RED}==> PERINGATAN: status sellvpn = ${STATUS}. Cek log:${NC}"
  echo -e "${YELLOW}    pm2 logs sellvpn --err --lines 30${NC}"
  echo -e "${YELLOW}    Rollback: cp -a $BACKUP_DIR/*.db $BOT_DIR/ && git reset --hard HEAD@{1}${NC}"
fi

echo -e "${YELLOW}==> Log terbaru (20 baris):${NC}"
pm2 logs sellvpn --lines 20 --nostream 2>/dev/null || true
