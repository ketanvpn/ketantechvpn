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

# Guard: pastikan working tree bersih supaya 'git pull --rebase' tidak pecah.
#
# Strategi auto-renormalize (whitelist-based, agnostic terhadap penyebab):
# - 4 file shell di bawah ini di-deploy lewat repo & TIDAK BOLEH di-edit
#   manual di server. Mereka sering muncul dirty di server karena:
#   * CRLF vs LF (.gitattributes eol=lf vs file pernah disentuh editor Windows)
#   * mode 0644 vs 0755 (chmod +x di akhir update.sh ini bikin mode change)
#   * BOM / line ending campuran setelah edit lewat tool yang tidak konsisten
#   * core.fileMode mismatch antar mesin
# - Kalau SEMUA dirty files termasuk di whitelist ini → checkout paksa,
#   tanpa peduli isi diff-nya. Aman karena file ini "owned by deploy".
# - Kalau ada dirty file DI LUAR whitelist → fail seperti biasa supaya
#   perubahan user yang berarti tidak ke-discard tanpa konfirmasi.
SAFE_DIRTY_WHITELIST=(
  "cek-port.sh"
  "scripts/backup_botvpn.sh"
  "scripts/install.sh"
  "update.sh"
)

# Helper: cek satu path apakah ada di whitelist (exact match).
is_in_whitelist() {
  local target="$1"
  local f
  for f in "${SAFE_DIRTY_WHITELIST[@]}"; do
    if [ "$f" = "$target" ]; then
      return 0
    fi
  done
  return 1
}

if ! git diff --quiet || ! git diff --cached --quiet; then
  # Kumpulkan semua file dirty (working tree + staged), unique.
  DIRTY_LIST=$( { git diff --name-only; git diff --cached --name-only; } | sort -u )

  ALL_WHITELISTED=1
  if [ -z "$DIRTY_LIST" ]; then
    ALL_WHITELISTED=0
  else
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      if ! is_in_whitelist "$f"; then
        ALL_WHITELISTED=0
        break
      fi
    done <<< "$DIRTY_LIST"
  fi

  if [ "$ALL_WHITELISTED" = "1" ]; then
    echo -e "${YELLOW}==> Phantom dirty di whitelist deploy script, auto-renormalize...${NC}"
    DIRTY_ONELINE=$(echo "$DIRTY_LIST" | tr '\n' ' ')
    # shellcheck disable=SC2086
    git rm --cached -- $DIRTY_ONELINE >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    git checkout HEAD -- $DIRTY_ONELINE >/dev/null 2>&1 || true
    echo -e "${GREEN}    Sudah di-renormalize: $DIRTY_ONELINE${NC}"

    # Verifikasi bersih setelah auto-fix.
    if ! git diff --quiet || ! git diff --cached --quiet; then
      echo -e "${RED}Auto-renormalize tidak menyelesaikan diff (kemungkinan core.fileMode).${NC}"
      echo -e "${YELLOW}Coba: git config core.fileMode false  (lalu jalankan ulang).${NC}"
      git status --short
      exit 1
    fi
  else
    echo -e "${RED}Ada perubahan lokal yang belum di-commit di $BOT_DIR.${NC}"
    echo -e "${YELLOW}Pilihan:${NC}"
    echo -e "  1) git stash  (simpan perubahan dulu, lalu jalankan update ulang)"
    echo -e "  2) git checkout -- <file>  (buang perubahan lokal kalau tidak perlu)"
    echo -e "  3) commit dulu kalau memang perubahan penting"
    git status --short
    exit 1
  fi
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
