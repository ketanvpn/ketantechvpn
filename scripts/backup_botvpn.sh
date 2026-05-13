#!/bin/bash
#
# scripts/backup_botvpn.sh - Backup folder BotVPN (DB + config) ke Telegram admin.
# Dipanggil via cron (biasanya tiap 12 jam). Token + admin ID dibaca dari .env
# supaya tidak hardcode di script ini.
#
# Setup di VPS (lihat DEPLOY.md section 14):
#   chmod +x /root/BotVPN/scripts/backup_botvpn.sh
#   crontab -e
#   tambahkan: 0 */12 * * * /root/BotVPN/scripts/backup_botvpn.sh >> /var/log/botvpn-backup.log 2>&1
#
# Test manual: bash /root/BotVPN/scripts/backup_botvpn.sh
# Cek log:     tail -f /var/log/botvpn-backup.log

set -euo pipefail

BOT_DIR="${BOT_DIR:-/root/BotVPN}"
BACKUP_DIR="${BACKUP_DIR:-/root/botvpn_backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
LOCK_FILE="${LOCK_FILE:-/tmp/backup_botvpn.lock}"
ENV_FILE="$BOT_DIR/.env"

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }
log() { echo "[$(ts)] $*"; }

# === Load .env ===
if [ ! -f "$ENV_FILE" ]; then
  log "ERROR: $ENV_FILE tidak ditemukan."
  exit 1
fi

# Parse .env line-by-line tanpa source bash. Source bash bisa pecah kalau
# value mengandung karakter spesial (`,`, `&`, `/`, spasi tanpa quote).
# Format: KEY=value (komentar `#` dan baris kosong di-skip).
while IFS= read -r line || [ -n "$line" ]; do
  # Skip komentar + baris kosong
  case "$line" in
    ''|\#*) continue ;;
  esac
  # Split di tanda `=` pertama
  key="${line%%=*}"
  value="${line#*=}"
  # Trim whitespace di key
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"
  # Hilangkan tanda petik wrapping kalau ada
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  # Validasi key (harus alfanumerik + underscore)
  case "$key" in
    *[!A-Za-z0-9_]*|'') continue ;;
  esac
  export "$key=$value"
done < "$ENV_FILE"

if [ -z "${BOT_TOKEN:-}" ]; then
  log "ERROR: BOT_TOKEN kosong di $ENV_FILE."
  exit 1
fi

# Tujuan backup: BACKUP_CHAT_ID > USER_ID > MASTER_ID > ADMIN_IDS[0]
TARGET_CHAT="${BACKUP_CHAT_ID:-${USER_ID:-${MASTER_ID:-}}}"
if [ -z "$TARGET_CHAT" ] && [ -n "${ADMIN_IDS:-}" ]; then
  TARGET_CHAT="$(echo "$ADMIN_IDS" | awk -F, '{print $1}' | tr -d ' ')"
fi
if [ -z "$TARGET_CHAT" ]; then
  log "ERROR: Tidak ada chat tujuan (BACKUP_CHAT_ID / USER_ID / MASTER_ID / ADMIN_IDS)."
  exit 1
fi

# === Mutex via flock ===
mkdir -p "$BACKUP_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Backup sebelumnya masih berjalan, keluar."
  exit 0
fi

# === Bundle ===
DATE_STR="$(date +'%Y-%m-%d_%H-%M')"
BACKUP_FILE="${BACKUP_DIR}/botvpn_${DATE_STR}.tar.gz"
HOST_LABEL="$(hostname)"

log "Mulai backup folder $BOT_DIR -> $BACKUP_FILE"

# Pakai pigz (parallel gzip) kalau ada, fallback gzip biasa.
if command -v pigz >/dev/null 2>&1; then
  COMPRESS_CMD=(pigz -9)
  COMPRESS_LABEL="pigz"
else
  COMPRESS_CMD=(gzip -9)
  COMPRESS_LABEL="gzip"
fi

PARENT_DIR="$(dirname "$BOT_DIR")"
BOT_BASENAME="$(basename "$BOT_DIR")"

tar -C "$PARENT_DIR" \
  --exclude="${BOT_BASENAME}/node_modules" \
  --exclude="${BOT_BASENAME}/.git" \
  --exclude="${BOT_BASENAME}/logs" \
  --exclude="${BOT_BASENAME}/*.log" \
  --exclude="${BOT_BASENAME}/tmp_qris" \
  --exclude="${BOT_BASENAME}/tmp" \
  --exclude="${BOT_BASENAME}/*.tar" \
  --exclude="${BOT_BASENAME}/*.tar.gz" \
  --exclude="${BOT_BASENAME}/*.bak" \
  --exclude="${BOT_BASENAME}/*.bak_*" \
  --exclude="${BOT_BASENAME}/*.backup-*" \
  --exclude="${BOT_BASENAME}/*.vpsbaru-bak" \
  --exclude="${BOT_BASENAME}/*.save" \
  --exclude="${BOT_BASENAME}/*.save.*" \
  -cf - "$BOT_BASENAME" | "${COMPRESS_CMD[@]}" > "$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  log "ERROR: File backup kosong/tidak ada, batal kirim."
  exit 1
fi

# Caption: size + jumlah file + uptime bot (kalau pm2 tersedia)
SIZE_HUMAN="$(du -h "$BACKUP_FILE" | awk '{print $1}')"
FILE_COUNT="$(tar -tzf "$BACKUP_FILE" 2>/dev/null | wc -l)"
UPTIME_INFO=""
if command -v pm2 >/dev/null 2>&1; then
  UPTIME_INFO="$(pm2 jlist 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      try{const j=JSON.parse(d);const p=j.find(x=>x.name==='sellvpn');
        if(!p){console.log('');return;}
        const upMs=Date.now()-p.pm2_env.pm_uptime;
        const h=Math.floor(upMs/3600000);
        console.log(p.pm2_env.status+', up '+h+'h');
      }catch(e){console.log('');}
    });
  " 2>/dev/null || echo '')"
fi

CAPTION="📦 Backup BotVPN"
CAPTION+="\nHost: ${HOST_LABEL}"
CAPTION+="\nWaktu: ${DATE_STR}"
CAPTION+="\nSize: ${SIZE_HUMAN} (${COMPRESS_LABEL}, ${FILE_COUNT} file)"
if [ -n "$UPTIME_INFO" ]; then
  CAPTION+="\nBot: ${UPTIME_INFO}"
fi

# === Kirim ke Telegram (retry 3x) ===
API_URL="https://api.telegram.org/bot${BOT_TOKEN}/sendDocument"
SUCCESS=0
for attempt in 1 2 3; do
  log "Kirim ke Telegram (attempt ${attempt}/3) chat=${TARGET_CHAT} ..."
  RESPONSE="$(curl -s -S --max-time 120 \
    -F "chat_id=${TARGET_CHAT}" \
    -F "document=@${BACKUP_FILE}" \
    -F "caption=${CAPTION}" \
    "$API_URL" || echo '')"
  if echo "$RESPONSE" | grep -q '"ok":true'; then
    log "Backup terkirim ke Telegram, hapus file lokal."
    rm -f "$BACKUP_FILE"
    SUCCESS=1
    break
  fi
  log "Gagal kirim (attempt ${attempt}). Response: ${RESPONSE:0:200}"
  sleep $((attempt * 5))
done

if [ "$SUCCESS" -eq 0 ]; then
  log "ERROR: 3x gagal kirim, backup disimpan lokal di $BACKUP_FILE"
  # Notif plain text ke admin (tanpa file) biar aware ada masalah.
  curl -s -S --max-time 30 \
    -F "chat_id=${TARGET_CHAT}" \
    -F "text=⚠️ Backup BotVPN gagal kirim file ke Telegram 3x. Cek /var/log/botvpn-backup.log di host ${HOST_LABEL}. File lokal: ${BACKUP_FILE}" \
    "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" >/dev/null || true
fi

# === Cleanup retention ===
find "$BACKUP_DIR" -type f -name 'botvpn_*.tar.gz' -mtime +"$KEEP_DAYS" -print -delete 2>/dev/null || true

log "Selesai."
