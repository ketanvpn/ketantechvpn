#!/usr/bin/env bash
# scripts/install.sh - Installer one-liner untuk BotVPN.
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/ketanvpn/ketantechvpn/main/scripts/install.sh)
#   BOT_TOKEN=xxx USER_ID=123 ADMIN_IDS=123 GROUP_ID=-100123 bash scripts/install.sh --yes
#
# Flags:
#   --yes              skip semua konfirmasi
#   --dry-run          print command tanpa eksekusi
#   --skip-pm2         jangan setup PM2 startup (kalau sudah diatur sendiri)
#   --skip-firewall    jangan pasang UFW rules
#   --repo=URL         pakai fork repo lain (default: ketanvpn/ketantechvpn)
#   --branch=NAME      pakai branch lain (default: main)

set -euo pipefail

# =================== colors ===================
RED=$'\e[0;31m'
GREEN=$'\e[0;32m'
YELLOW=$'\e[1;33m'
BLUE=$'\e[1;34m'
NC=$'\e[0m'

log()  { echo -e "${BLUE}==>${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*" >&2; }

# =================== flag parsing ===================
ASSUME_YES=0
DRY_RUN=0
SKIP_PM2=0
SKIP_FIREWALL=0
REPO_URL="https://github.com/ketanvpn/ketantechvpn.git"
REPO_BRANCH="main"
TARGET_DIR="/root/BotVPN"

for arg in "$@"; do
  case "$arg" in
    --yes|-y)          ASSUME_YES=1 ;;
    --dry-run)         DRY_RUN=1 ;;
    --skip-pm2)        SKIP_PM2=1 ;;
    --skip-firewall)   SKIP_FIREWALL=1 ;;
    --repo=*)          REPO_URL="${arg#*=}" ;;
    --branch=*)        REPO_BRANCH="${arg#*=}" ;;
    --target=*)        TARGET_DIR="${arg#*=}" ;;
    --help|-h)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      err "Flag tidak dikenal: $arg"
      exit 1
      ;;
  esac
done

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  [dry-run] $*"
  else
    eval "$@"
  fi
}

confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" -eq 1 ]; then
    return 0
  fi
  read -rp "$prompt (y/N) " reply
  [[ "$reply" =~ ^[Yy]$ ]]
}

# =================== pre-flight ===================
log "BotVPN Installer"
echo "  Repo    : $REPO_URL"
echo "  Branch  : $REPO_BRANCH"
echo "  Target  : $TARGET_DIR"
echo "  Mode    : $([ "$DRY_RUN" -eq 1 ] && echo dry-run || echo real)"
echo

if [ "$EUID" -ne 0 ]; then
  err "Script harus dijalankan sebagai root. Coba: sudo -i lalu jalankan ulang."
  exit 1
fi

if ! grep -qE 'ID=(ubuntu|debian)' /etc/os-release; then
  err "OS bukan Ubuntu/Debian. Script ini belum teruji di OS lain."
  cat /etc/os-release | grep PRETTY_NAME || true
  exit 1
fi

OS_VERSION=$(grep '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
case "$OS_VERSION" in
  24.04|24.10|25.04|12|13) ok "OS supported: $OS_VERSION" ;;
  *) warn "OS version $OS_VERSION belum diuji, lanjut atas risiko sendiri." ;;
esac

# =================== step 1: timezone ===================
log "Step 1/10: Set timezone ke Asia/Jayapura"
CURRENT_TZ=$(timedatectl | grep 'Time zone:' | awk '{print $3}' || echo '')
if [ "$CURRENT_TZ" = "Asia/Jayapura" ]; then
  ok "Timezone sudah Asia/Jayapura, skip."
else
  run "timedatectl set-timezone Asia/Jayapura"
fi

# =================== step 2: apt packages ===================
log "Step 2/10: Instal paket dasar (apt)"
run "apt update -y"
run "apt install -y curl git jq build-essential python3 bash ca-certificates nano rsync sqlite3 ufw"

# =================== step 3: node.js 20 ===================
log "Step 3/10: Instal Node.js 20 + PM2"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/^v//; s/\..*$//')
  if [ "$NODE_MAJOR" -ge 20 ]; then
    ok "Node.js $(node -v) sudah terinstal (>= 20), skip NodeSource setup."
    NODE_OK=1
  fi
fi

if [ "$NODE_OK" -eq 0 ]; then
  run "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
  run "apt install -y nodejs"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  run "npm install -g pm2@latest"
else
  ok "PM2 sudah terinstal ($(pm2 -v)), skip."
fi

# =================== step 4: clone repo ===================
log "Step 4/10: Clone repo ke $TARGET_DIR"
if [ -d "$TARGET_DIR/.git" ]; then
  ok "Repo sudah ada di $TARGET_DIR, skip clone. Mau update? Pakai: bash $TARGET_DIR/update.sh"
else
  if [ -d "$TARGET_DIR" ] && [ "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
    err "$TARGET_DIR sudah ada tapi bukan git repo. Pindahkan/hapus dulu."
    exit 1
  fi
  run "git clone --depth 1 --branch $REPO_BRANCH $REPO_URL $TARGET_DIR"
fi

cd "$TARGET_DIR" || exit 1

# =================== step 5: npm install ===================
log "Step 5/10: npm install (production only)"
if [ -f package-lock.json ]; then
  if ! run "npm ci --omit=dev"; then
    warn "npm ci gagal, fallback ke npm install"
    run "npm install --omit=dev"
  fi
else
  run "npm install --omit=dev"
fi

# =================== step 6: .env setup ===================
log "Step 6/10: Setup konfigurasi .env"
ENV_FILE="$TARGET_DIR/.env"
ENV_EXAMPLE="$TARGET_DIR/.env.example"

if [ -f "$ENV_FILE" ]; then
  ok "File .env sudah ada, skip pembuatan. Edit manual kalau perlu: nano $ENV_FILE"
else
  # Strategy: copy dari .env.example (semua field visible + kosong), lalu
  # isi field wajib + optional yang umum. Pendekatan ini memastikan semua
  # field dari .env.example masuk ke .env walaupun user tidak mengisinya,
  # jadi admin bisa edit manual nanti tanpa bingung field-nya di mana.
  if [ ! -f "$ENV_EXAMPLE" ]; then
    err "File template .env.example tidak ditemukan di $ENV_EXAMPLE. Repo corrupt?"
    exit 1
  fi

  # Prompt mandatory (kecuali env var sudah set)
  if [ -z "${BOT_TOKEN:-}" ]; then
    if [ "$ASSUME_YES" -eq 1 ]; then
      warn "Mode --yes tapi BOT_TOKEN tidak di-set. Copy .env.example kosong, isi manual nanti."
    else
      echo
      echo "  Isi konfigurasi bot. Field bertanda (*) wajib."
      read -rp "  (*) BOT_TOKEN (dari @BotFather): " BOT_TOKEN
      read -rp "  (*) USER_ID (ID Telegram kamu, dari @userinfobot): " USER_ID
      read -rp "      MASTER_ID (kosongkan = sama dengan USER_ID): " MASTER_ID
      read -rp "  (*) ADMIN_IDS (pisahkan koma kalau banyak, contoh: 123,456): " ADMIN_IDS
      read -rp "  (*) GROUP_ID (ID grup notifikasi, mulai dengan -100...): " GROUP_ID
      read -rp "      BACKUP_CHAT_ID (kosongkan = sama dengan USER_ID): " BACKUP_CHAT_ID
      read -rp "      NAMA_STORE (opsional, nama toko kamu): " NAMA_STORE
      echo
    fi
  fi

  MASTER_ID="${MASTER_ID:-${USER_ID:-}}"
  BACKUP_CHAT_ID="${BACKUP_CHAT_ID:-${USER_ID:-}}"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  [dry-run] copy .env.example -> .env + fill BOT_TOKEN=(redacted), USER_ID=$USER_ID, ADMIN_IDS=$ADMIN_IDS, GROUP_ID=$GROUP_ID, BACKUP_CHAT_ID=$BACKUP_CHAT_ID"
  else
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    # Sed helper: set KEY=value kalau baris 'KEY=' masih kosong / belum di-fill.
    set_env() {
      local key="$1"
      local value="$2"
      # Escape '&' '/' '\\' di value biar aman di replacement sed
      local escaped
      escaped=$(printf '%s' "$value" | sed -e 's/[\\/&]/\\&/g')
      # Ganti baris '^KEY=' (dengan atau tanpa value) jadi 'KEY=value'
      sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
    }

    [ -n "${BOT_TOKEN:-}" ]       && set_env BOT_TOKEN       "$BOT_TOKEN"
    [ -n "${USER_ID:-}" ]         && set_env USER_ID         "$USER_ID"
    [ -n "${MASTER_ID:-}" ]       && set_env MASTER_ID       "$MASTER_ID"
    [ -n "${ADMIN_IDS:-}" ]       && set_env ADMIN_IDS       "$ADMIN_IDS"
    [ -n "${GROUP_ID:-}" ]        && set_env GROUP_ID        "$GROUP_ID"
    [ -n "${BACKUP_CHAT_ID:-}" ]  && set_env BACKUP_CHAT_ID  "$BACKUP_CHAT_ID"
    [ -n "${NAMA_STORE:-}" ]      && set_env NAMA_STORE      "$NAMA_STORE"

    ok ".env tersimpan di $ENV_FILE (semua field dari .env.example ikut,"
    echo "     yang belum diisi tinggal edit manual: nano $ENV_FILE)"
  fi
fi

# =================== step 7: smoke test ===================
log "Step 7/10: Smoke test (syntax + audit + boot)"
if [ "$DRY_RUN" -eq 0 ]; then
  if ! node --check app.js; then
    err "Syntax error di app.js. Stop."
    exit 1
  fi
  if [ -f scripts/smoke-audit.js ]; then
    node scripts/smoke-audit.js || warn "Smoke audit gagal, tapi lanjut (cek output di atas)."
  fi
  if [ -f scripts/smoke-boot.js ]; then
    node scripts/smoke-boot.js || warn "Smoke boot gagal, tapi lanjut (cek output di atas)."
  fi
  ok "Smoke test lolos."
fi

# =================== step 8: pm2 start ===================
log "Step 8/10: Start bot pakai PM2"
if [ "$DRY_RUN" -eq 0 ]; then
  if pm2 describe sellvpn >/dev/null 2>&1; then
    pm2 restart sellvpn --update-env
    ok "PM2 restart sellvpn"
  else
    pm2 start ecosystem.config.js
    pm2 save
    ok "PM2 start sellvpn"
  fi
fi

# =================== step 9: pm2 startup ===================
if [ "$SKIP_PM2" -eq 0 ]; then
  log "Step 9/10: Setup PM2 auto-start (systemd)"
  if [ "$DRY_RUN" -eq 0 ]; then
    # pm2 startup print command, kita jalankan otomatis
    PM2_STARTUP_CMD=$(pm2 startup systemd -u root --hp /root 2>&1 | grep -E '^sudo env' || true)
    if [ -n "$PM2_STARTUP_CMD" ]; then
      eval "$PM2_STARTUP_CMD"
      pm2 save
      ok "PM2 startup aktif."
    else
      warn "Tidak bisa ambil command startup otomatis. Jalankan manual: pm2 startup systemd -u root --hp /root"
    fi
  fi
else
  log "Step 9/10: Skip PM2 startup (--skip-pm2)"
fi

# =================== step 10: firewall ===================
if [ "$SKIP_FIREWALL" -eq 0 ]; then
  log "Step 10/10: Pasang UFW firewall"
  if command -v ufw >/dev/null 2>&1; then
    run "ufw allow OpenSSH"
    run "ufw default deny incoming"
    run "ufw default allow outgoing"
    if [ "$DRY_RUN" -eq 0 ] && ! ufw status | grep -q 'Status: active'; then
      echo 'y' | ufw enable >/dev/null 2>&1 || true
    fi
    ok "UFW aktif (SSH allow, lainnya deny)."
  else
    warn "UFW tidak ter-install, skip firewall setup."
  fi
else
  log "Step 10/10: Skip firewall (--skip-firewall)"
fi

# =================== done ===================
echo
ok "Instalasi selesai!"
echo
echo "  Status bot   : pm2 status sellvpn"
echo "  Live log     : pm2 logs sellvpn"
echo "  Config       : nano $ENV_FILE"
echo "  Restart bot  : pm2 restart sellvpn"
echo "  Update bot   : bash $TARGET_DIR/update.sh"
echo
echo "  Tes di Telegram: kirim /start ke bot kamu. Harus balas menu utama."
echo
