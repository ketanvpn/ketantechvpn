# Deploy BotVPN ke VPS (Panduan Pelan)

Panduan step-by-step untuk deploy bersih **BotVPN (Telegram Bot VPN)** ke VPS Ubuntu 24.04 / Debian 12. Ditulis supaya gampang diikuti walau baru pertama kali deploy bot Node.js.

**Kalau cuma mau instal cepat:** skip ke bagian [One-Liner Installer](#one-liner-installer) di bawah. Script akan jalankan semua langkah di bawah ini secara otomatis + tanya konfigurasi yang wajib.

---

## Daftar Isi

1. [Apa yang Kamu Butuhkan](#1-apa-yang-kamu-butuhkan)
2. [Login ke VPS + Cek OS](#2-login-ke-vps--cek-os)
3. [Set Timezone Server](#3-set-timezone-server)
4. [Instal Paket Dasar](#4-instal-paket-dasar)
5. [Instal Node.js 20 + PM2](#5-instal-nodejs-20--pm2)
6. [Clone Repo BotVPN](#6-clone-repo-botvpn)
7. [Instal Dependency Bot](#7-instal-dependency-bot)
8. [Isi Konfigurasi (`.env`)](#8-isi-konfigurasi-env)
9. [Smoke Test: Pastikan Bot Bisa Start](#9-smoke-test-pastikan-bot-bisa-start)
10. [Jalankan Bot Pakai PM2 (Auto-Restart)](#10-jalankan-bot-pakai-pm2-auto-restart)
11. [Pasang Firewall Dasar (UFW)](#11-pasang-firewall-dasar-ufw)
12. [Migrasi dari Bot Lama (Opsional)](#12-migrasi-dari-bot-lama-opsional)
13. [Update Bot ke Versi Baru](#13-update-bot-ke-versi-baru)
14. [Backup Otomatis Tiap Jam](#14-backup-otomatis-tiap-jam)
15. [One-Liner Installer](#one-liner-installer)
16. [Troubleshooting Umum](#16-troubleshooting-umum)

---

## 1. Apa yang Kamu Butuhkan

Siapkan dulu sebelum mulai:

- **VPS Ubuntu 24.04 LTS atau Debian 12**. Minimal RAM 512 MB (rekomendasi 1 GB), disk 5 GB. Arsitektur x86_64 atau ARM (keduanya jalan).
- **Akses SSH sebagai root** (atau user yang bisa `sudo`).
- **Token Bot Telegram** dari [@BotFather](https://t.me/botfather). Chat BotFather \u2192 `/newbot` \u2192 ikuti prompt \u2192 simpan token yang diberikan.
- **User ID Telegram kamu** (untuk admin bot). Chat [@userinfobot](https://t.me/userinfobot) \u2192 dia balas ID numerik kamu.
- **(Opsional)** API key payment gateway (GoPay / OrderKuota) kalau mau auto-topup QRIS.

**Kalau belum punya VPS:** beli dulu di provider (Contabo, DigitalOcean, Niagahoster, dsb). Pilih OS **Ubuntu 24.04** atau **Debian 12** saat order.

---

## 2. Login ke VPS + Cek OS

Dari laptop kamu, buka terminal (macOS/Linux) atau PowerShell / WSL (Windows):

```bash
ssh root@IP_VPS_KAMU
```

Ganti `IP_VPS_KAMU` dengan IP beneran. Kalau diminta password, isi password VPS.

Setelah login, pastikan OS kamu benar:

```bash
cat /etc/os-release | grep PRETTY_NAME
```

Harus keluar salah satu dari:
- `PRETTY_NAME="Ubuntu 24.04.x LTS"`
- `PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"`

**Kalau OS beda** (Ubuntu 20, CentOS, dsb): panduan ini tidak dijamin jalan. Reinstall VPS ke Ubuntu 24.04 dulu lebih aman.

---

## 3. Set Timezone Server

Biar jam laporan harian, QRIS expired, dan scheduler sesuai dengan jam Indonesia:

```bash
sudo timedatectl set-timezone Asia/Jayapura
timedatectl status
```

Cek bagian `Time zone:` harus `Asia/Jayapura`.

**Kalau mau zona lain** (misal WIB): ganti jadi `Asia/Jakarta`. Nanti juga samakan di konfigurasi `.vars.json` field `TIME_ZONE`.

---

## 4. Instal Paket Dasar

Ini paket yang diperlukan untuk build `sqlite3` native + download repo + edit file:

```bash
sudo apt update
sudo apt install -y curl git jq build-essential python3 bash ca-certificates \
                    nano rsync sqlite3 ufw
```

Arti paket tambahan:
- `rsync` — buat migrasi DB dari VPS lama (section 12).
- `sqlite3` — CLI buat cek integrity DB + query manual saat debugging.
- `ufw` — firewall dasar (section 11).

**Cek sukses:**

```bash
git --version
jq --version
rsync --version | head -n1
sqlite3 --version
```

Kalau dua command di atas keluar versinya, berarti sukses.

**Kalau error "Unable to locate package":** repo apt corrupt. Fix dengan:

```bash
sudo rm -rf /var/lib/apt/lists/*
sudo apt update
```

Lalu ulangi command `apt install` di atas.

---

## 5. Instal Node.js 20 + PM2

Bot butuh **Node.js 20** (LTS). Pakai NodeSource repo supaya dapat versi terbaru yang stabil:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2@latest
```

**Cek sukses:**

```bash
node -v    # harus v20.x.x
npm -v     # minimal 10.x.x
pm2 -v
```

**Kalau `node -v` keluar versi lain** (misal v18 atau v22): ada residu Node.js lama. Uninstall dulu:

```bash
sudo apt remove -y nodejs npm
sudo rm -rf /usr/local/lib/node_modules /usr/local/bin/node /usr/local/bin/npm
```

Lalu ulangi command di atas.

---

## 6. Clone Repo BotVPN

Default path adalah `/root/BotVPN` (sudah di-hardcode di `ecosystem.config.js`). Kalau ikuti default, gak perlu edit apa-apa.

```bash
cd /root
git clone https://github.com/ketanvpn/ketantechvpn.git BotVPN
cd /root/BotVPN
```

**Cek isinya:**

```bash
ls -la
```

Harus ada minimal file-file ini:
- `app.js`, `package.json`, `ecosystem.config.js` — core bot.
- `.env.example`, `.vars.example.json` — template config (copy jadi `.env` + `.vars.json`).
- `update.sh`, `cek-port.sh`, `cek-port.servers.example` — helper scripts.
- `scripts/` (ada `install.sh`, `smoke-audit.js`, dkk) — script install & audit.
- `db/`, `lib/`, `payment/`, `scheduler/`, `modules/`, `accounts/`, `admin/` — modul.
- `qris.jpg` — placeholder QRIS (bisa kosong, nanti di-upload via bot admin).

Kalau ada yang hilang, clone gagal di tengah. Coba hapus folder + clone ulang.

---

## 7. Instal Dependency Bot

Download semua library Node.js yang dibutuhkan bot:

```bash
cd /root/BotVPN
npm ci --omit=dev
```

Ini akan makan waktu 1\u20133 menit tergantung kecepatan VPS.

**Kalau `npm ci` gagal dengan error `EUSAGE` atau lock mismatch:**

```bash
npm install --omit=dev
```

**Kalau build `sqlite3` gagal dengan error `node-gyp` / `python not found`:**

```bash
sudo apt install -y python3 build-essential
npm rebuild sqlite3
```

**Cek sukses:**

```bash
ls node_modules/sqlite3 node_modules/telegraf node_modules/axios
```

Harus keluar 3 folder tanpa error.

---

## 8. Isi Konfigurasi (`.env`)

Bot butuh minimal 5 config wajib: `BOT_TOKEN`, `USER_ID`, `ADMIN_IDS`, `GROUP_ID`, `BACKUP_CHAT_ID`. Lainnya bisa diisi belakangan.

Buat file `.env` (copy dari template, lalu edit):

```bash
cp /root/BotVPN/.env.example /root/BotVPN/.env
nano /root/BotVPN/.env
```

Cara ini selalu bikin `.env` punya **semua** field dari `.env.example`. Kalau di sesi mendatang ada field baru ditambah ke template, kamu tahu di mana isi-nya tanpa perlu cari-cari.

Isi yang WAJIB:

```env
BOT_TOKEN=12345:ABC-token-dari-BotFather
USER_ID=690744680
MASTER_ID=690744680
ADMIN_IDS=690744680
GROUP_ID=-1001234567890
BACKUP_CHAT_ID=690744680
```

Arti field:
- `BOT_TOKEN`: token bot dari BotFather.
- `USER_ID`: ID Telegram owner bot (lihat di @userinfobot).
- `MASTER_ID`: biasanya sama dengan `USER_ID`. Yang terima laporan harian.
- `ADMIN_IDS`: ID admin, pisahkan koma kalau lebih dari 1 (contoh: `690744680,123456789`).
- `GROUP_ID`: ID grup Telegram untuk notifikasi transaksi. Add bot ke grup, kirim `/start@bot_kamu`, cek ID grup via log bot atau pakai bot lain seperti @getmyid_bot.
- `BACKUP_CHAT_ID`: chat ID tujuan backup DB otomatis (biasanya sama dengan `USER_ID`).

**Kalau mau auto-topup QRIS**, isi juga:

```env
GOPAY_API_KEY=agp_xxxxxxxxxxxxxxxxxxxxxxxx
GOPAY_API_BASE_URL=https://v1-gateway.autogopay.site
GOPAY_BASE_QR=0002010102...isi_string_QRIS_statis...
ORDERKUOTA_AUTH_USERNAME=username_orderkuota
ORDERKUOTA_AUTH_TOKEN=123:abcdef
```

**Save:** di nano, tekan `Ctrl+O` \u2192 Enter \u2192 `Ctrl+X`.

**Amankan file config:**

```bash
chmod 600 /root/BotVPN/.env
```

Ini penting supaya user lain di VPS tidak bisa baca token.

---

## 9. Smoke Test: Pastikan Bot Bisa Start

Sebelum lepas ke PM2, coba jalankan manual dulu:

```bash
cd /root/BotVPN
npm run smoke:syntax       # cek syntax error di app.js
npm run smoke:audit        # cek admin guard + security pattern
```

Keduanya harus lolos tanpa `FAIL`.

**Coba running bot manual:**

```bash
node app.js
```

Yang diharapkan muncul (sebagian):

```
Terhubung ke SQLite3 (...)
Bot telah dimulai (build QRIS AUTO v3)
HTTP server listening on 127.0.0.1:6969
```

**Test di Telegram:** chat bot kamu, kirim `/start`. Harus balas menu utama.

Kalau sukses, tekan `Ctrl+C` untuk stop. Lanjut ke PM2.

**Kalau error:**
- `Unauthorized` atau `401 Unauthorized`: BOT_TOKEN salah. Edit `.env`, rotate token di BotFather kalau perlu.
- `SQLITE_CANTOPEN`: permission DB bermasalah. `chmod 644 /root/BotVPN/*.db 2>/dev/null`.
- `TelegramError: 404 Not Found`: token bot belum di-enable. Cek di BotFather \u2192 `/mybots` \u2192 pilih bot \u2192 `Bot Settings` \u2192 `Enable Polling`.

---

## 10. Jalankan Bot Pakai PM2 (Auto-Restart)

PM2 akan jaga bot tetap hidup kalau crash + auto-start saat reboot VPS.

```bash
cd /root/BotVPN
pm2 start ecosystem.config.js
pm2 save
```

**Supaya auto-start saat reboot VPS:**

```bash
pm2 startup systemd -u root --hp /root
```

PM2 akan print satu command panjang (mulai `sudo env ...`). **Copy-paste persis** command itu lalu Enter. Setelah itu:

```bash
pm2 save
```

**Command harian yang sering dipakai:**

```bash
pm2 status            # lihat status bot
pm2 logs sellvpn      # live tail log (Ctrl+C untuk keluar)
pm2 restart sellvpn   # restart bot
pm2 stop sellvpn      # stop bot
pm2 reload sellvpn    # zero-downtime restart
```

**Rotasi log otomatis** (opsional tapi disarankan):

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
```

---

## 11. Pasang Firewall Dasar (UFW)

Bot pakai long-polling (outbound) jadi gak butuh inbound kecuali SSH. Konfig minimal:

```bash
sudo ufw allow OpenSSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
```

Saat muncul prompt `Command may disrupt existing ssh connections. Proceed with operation (y|n)?`, ketik `y` \u2192 Enter.

**Cek:**

```bash
sudo ufw status verbose
```

Harus ada line `22/tcp ALLOW IN Anywhere` dan `Default: deny (incoming), allow (outgoing)`.

**Jangan** buka port 6969 ke publik. Kalau butuh monitoring internal, pakai SSH tunnel: `ssh -L 6969:127.0.0.1:6969 root@VPS`.

---

## 12. Migrasi dari Bot Lama (Opsional)

**Skip bagian ini kalau ini deploy perdana.**

Kalau kamu sudah punya BotVPN di VPS lama dan mau migrasi:

**Di VPS lama**, stop bot dulu biar DB konsisten:

```bash
pm2 stop sellvpn
```

**Di VPS baru** (dari folder `/root/BotVPN`), tarik file dari VPS lama:

```bash
cd /root/BotVPN
# DB utama
rsync -avz root@OLD_VPS:/root/BotVPN/sellvpn.db        ./
rsync -avz root@OLD_VPS:/root/BotVPN/ressel.db         ./  2>/dev/null || true
# Legacy trial counter (kalau masih ada di VPS lama).
# Versi baru sudah migrate ke tabel SQLite `trial_usage` di sellvpn.db,
# tapi kalau VPS lama belum upgrade, file ini masih pegang counter harian.
rsync -avz root@OLD_VPS:/root/BotVPN/trial.db          ./  2>/dev/null || true
# Config file
rsync -avz root@OLD_VPS:/root/BotVPN/trial_config.json ./ 2>/dev/null || true
rsync -avz root@OLD_VPS:/root/BotVPN/trial_settings.json ./ 2>/dev/null || true
rsync -avz root@OLD_VPS:/root/BotVPN/qris.jpg          ./ 2>/dev/null || true
rsync -avz root@OLD_VPS:/root/BotVPN/.vars.json        ./ 2>/dev/null || true
rsync -avz root@OLD_VPS:/root/BotVPN/.env              ./ 2>/dev/null || true
# Opsional: list server health-check
rsync -avz root@OLD_VPS:/root/BotVPN/cek-port.servers  ./ 2>/dev/null || true
```

Ganti `OLD_VPS` dengan IP VPS lama.

**Alternatif cepat (satu paket)** — bundle semua file yang penting di VPS lama jadi satu `.tar.gz`, transfer sekali, lalu extract:

```bash
# Di VPS lama
cd /root/BotVPN
pm2 stop sellvpn
tar --exclude='node_modules' --exclude='.git' --exclude='logs' \
    --exclude='*.log' \
    -czf /tmp/botvpn-backup.tar.gz \
    sellvpn.db ressel.db trial.db trial_config.json trial_settings.json \
    .env .vars.json qris.jpg cek-port.servers 2>/dev/null
ls -lh /tmp/botvpn-backup.tar.gz

# Di laptop / VPS baru
scp root@OLD_VPS:/tmp/botvpn-backup.tar.gz .
# Di VPS baru, extract ke /root/BotVPN
cd /root/BotVPN
tar -xzf /path/ke/botvpn-backup.tar.gz
```

Cara ini lebih rapih buat DB yang besar — kompresi `.tar.gz` biasanya 30–60% dari ukuran raw.

**Cek integrity DB:**

```bash
sqlite3 ./sellvpn.db "PRAGMA integrity_check;" 2>/dev/null
```

Output harus `ok`. Kalau bukan, DB corrupt \u2014 restore dari backup sebelumnya, jangan dipakai.

**Cek isi tabel penting:**

```bash
sqlite3 ./sellvpn.db <<'SQL'
.tables
SELECT COUNT(*) AS users FROM users;
SELECT COUNT(*) AS servers FROM Server;
SELECT COUNT(*) AS akun FROM accounts;
SELECT COUNT(*) AS tx FROM transactions;
SQL
```

Angka harus masuk akal (bukan 0 total) kalau memang VPS lama aktif.

**Rapikan permission:**

```bash
chmod 600 ./*.db ./.env ./.vars.json 2>/dev/null || true
chmod 644 ./qris.jpg ./trial_config.json ./trial_settings.json 2>/dev/null || true
```

**Restart + test:**

```bash
pm2 restart sellvpn --update-env
pm2 logs sellvpn --lines 30
```

Pastikan tidak ada error `SQLITE_CANTOPEN`, tidak ada `Unauthorized`, dan laporan lisensi muncul. Lalu di Telegram, kirim `/start` ke bot — harus balas menu utama dengan saldo + riwayat dari VPS lama.

**Setelah migrasi sukses**, jangan lupa stop bot di VPS lama permanen:

```bash
# Di VPS lama
pm2 stop sellvpn
pm2 delete sellvpn
pm2 save
```

Dua bot jalan bersamaan = double notifikasi + double potong saldo = kacau.

---

## 13. Update Bot ke Versi Baru

Ada script `update.sh` yang otomatis:

```bash
cd /root/BotVPN
bash ./update.sh
```

Script akan:
1. Backup semua `.db` + `.env` + `.vars.json` ke `/root/BotVPN-backup-YYYYMMDD-HHMMSS/`.
2. `git pull` dari branch aktif.
3. `npm ci --omit=dev`.
4. Smoke test (`node --check` + audit).
5. `pm2 restart sellvpn --update-env`.

**Kalau ada peringatan "perubahan lokal yang belum di-commit":**

Update.sh sengaja stop kalau working tree kotor, biar gak rusak file lokal kamu.
File yang biasa muncul:
- `cek-port.sh` — mestinya bersih, list server kamu di `cek-port.servers`. Kalau tetap muncul, bandingkan dengan repo lalu `git checkout -- cek-port.sh`.
- `cek-port.servers` — sudah di-`.gitignore`. Kalau muncul di list, kemungkinan kamu di branch lama. `git pull` dulu setelah stash.
- `trial.db.migrated` — file hasil migrasi trial.db ke SQLite, sudah di-`.gitignore`. Aman dibiarkan.

Cara stash perubahan lokal lalu lanjut update:
```bash
cd /root/BotVPN
git stash push -u -m "vps-local"
bash ./update.sh
# kalau perlu balikin perubahan lokal:
# git stash pop
```

**Cara isi `cek-port.servers` (daftar server VPN buat health-check):**

```bash
cd /root/BotVPN
cp cek-port.servers.example cek-port.servers
nano cek-port.servers   # isi 1 hostname per baris, '#' = komentar
bash cek-port.sh
```

File ini sudah di-`.gitignore`, jadi gak akan ke-overwrite saat update.

**Kalau update gagal di tengah jalan:** restore dari folder backup yang baru dibuat:

```bash
cp -a /root/BotVPN-backup-LATEST/*.db /root/BotVPN/
cp -a /root/BotVPN-backup-LATEST/.env /root/BotVPN/
pm2 restart sellvpn
```

---

## 14. Backup Otomatis Tiap Jam

Bot sudah punya auto-backup built-in (kirim DB via Telegram). Aktifkan di `.vars.json`:

```bash
nano /root/BotVPN/.vars.json
```

Cari atau tambahkan:

```json
{
  "AUTO_BACKUP_ENABLED": true,
  "AUTO_BACKUP_INTERVAL_HOURS": 12,
  "BACKUP_CHAT_ID": 690744680
}
```

`BACKUP_CHAT_ID` = chat tempat kirim backup (biasanya ID kamu sendiri).

**Catatan**: kalau `BACKUP_CHAT_ID` sudah di-set di `.env`, field ini di `.vars.json` bersifat override — boleh di-skip. Urutan prioritas: `.env` → `.vars.json` → default.

Restart bot:

```bash
pm2 restart sellvpn --update-env
```

Flag `--update-env` penting kalau kamu ubah `.env`, bukan cuma `.vars.json`. Tanpa flag itu PM2 masih pakai env lama.

**Alternatif / tambahan: backup folder lengkap via cron (recommended untuk migrasi ke VPS lain).**

Auto-backup built-in di atas cuma kirim 1 file `sellvpn.db`. Untuk backup lengkap (DB + `.env` + `.vars.json` + `qris.jpg` + config trial) pakai script `scripts/backup_botvpn.sh` yang ter-bundle di repo:

```bash
# 1. Pastikan executable
chmod +x /root/BotVPN/scripts/backup_botvpn.sh

# 2. Test manual dulu
/root/BotVPN/scripts/backup_botvpn.sh
# Cek di Telegram admin kamu, harus ada file botvpn_YYYY-MM-DD_HH-MM.tar.gz

# 3. Setup cron tiap 12 jam (jam 00:00 dan 12:00 waktu server)
( crontab -l 2>/dev/null; echo '0 */12 * * * /root/BotVPN/scripts/backup_botvpn.sh >> /var/log/botvpn-backup.log 2>&1' ) | crontab -

# 4. Verify cron tersimpan
crontab -l | grep backup_botvpn
```

Yang script ini lakukan:
- Baca `BOT_TOKEN` + chat tujuan dari `.env` (tidak hardcode).
- Bundle folder `/root/BotVPN` ke `.tar.gz` (exclude `node_modules/`, `.git/`, `logs/`, file backup lama).
- Pakai `pigz` (parallel gzip) kalau tersedia, fallback ke `gzip`.
- Kirim ke Telegram admin dengan caption ukuran + jumlah file + status bot.
- Retry 3x kalau gagal, terakhir kirim notif plain text ke admin.
- Simpan lokal di `/root/botvpn_backups/` dengan retention 7 hari.
- Lock file via `flock` supaya tidak overlap.

**Restore dari backup tar.gz** (misalnya saat migrasi ke VPS baru):

```bash
# Di VPS baru, setelah installer jalan
pm2 stop sellvpn
cd /root
tar -xzf /path/ke/botvpn_YYYY-MM-DD_HH-MM.tar.gz
# File akan extract ke /root/BotVPN/ (overwrite config + DB lama)
pm2 restart sellvpn --update-env
```

**Cek log backup + debugging:**

```bash
tail -f /var/log/botvpn-backup.log
ls -lh /root/botvpn_backups/
```

**Off-site backup (rekomendasi tambahan ke VPS lain):**

```bash
cat >/etc/cron.d/botvpn-offsite <<'CRON'
0 */6 * * * root rsync -az /root/BotVPN/sellvpn.db /root/BotVPN/trial.db /root/BotVPN/ressel.db backup@OFFSITE_HOST:/srv/botvpn-backup/$(hostname)/ >> /var/log/botvpn-offsite.log 2>&1
CRON
```

---

## One-Liner Installer

Kalau mau skip semua step manual di atas, jalankan satu command ini di VPS baru (fresh Ubuntu 24.04 / Debian 12, login sebagai root):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ketanvpn/ketantechvpn/main/scripts/install.sh)
```

Atau kalau repo sudah di-clone manual:

```bash
cd /root/BotVPN
bash scripts/install.sh
```

**Yang script ini lakukan:**

1. Cek OS (harus Ubuntu 24.04 / Debian 12).
2. Set timezone ke `Asia/Jayapura`.
3. Instal paket dasar (`git`, `curl`, `jq`, `build-essential`, `python3`, `nano`, `rsync`, `sqlite3`, `ufw`).
4. Instal Node.js 20 + PM2.
5. Clone repo ke `/root/BotVPN` (skip kalau sudah ada).
6. `npm ci --omit=dev`.
7. Prompt interaktif: `BOT_TOKEN`, `USER_ID`, `MASTER_ID`, `ADMIN_IDS`, `GROUP_ID`, `BACKUP_CHAT_ID`, `NAMA_STORE`. Field opsional boleh dikosongkan.
8. Copy `.env.example` ke `.env` (semua field ikut), isi field yang user masukkan lewat `sed`, `chmod 600`.
9. Smoke test syntax + audit.
10. Start PM2 + setup auto-start saat reboot.
11. Pasang UFW allow OpenSSH + deny incoming.

**Setelah installer selesai, kamu tetap bisa edit manual** `nano /root/BotVPN/.env` untuk isi field opsional yang belum terisi (GoPay, OrderKuota, dll). Semua field dari `.env.example` sudah ada di file-mu, tinggal isi.

**Kalau mau non-interaktif (untuk automation)**, set env var:

```bash
BOT_TOKEN=xxx USER_ID=123 ADMIN_IDS=123 GROUP_ID=-100123 BACKUP_CHAT_ID=123 \
  bash scripts/install.sh --yes
```

Flag `--yes` skip semua prompt konfirmasi.

**Flag lain:**
- `--dry-run` \u2014 print yang akan dilakukan tanpa eksekusi (buat preview).
- `--skip-pm2` \u2014 jangan pasang PM2 startup (kalau mau atur sendiri).
- `--skip-firewall` \u2014 jangan pasang UFW (kalau sudah pakai firewall lain).
- `--repo=URL` \u2014 pakai fork repo lain (default: `ketanvpn/ketantechvpn`).
- `--branch=NAME` \u2014 pakai branch lain (default: `main`).

---

## 16. Troubleshooting Umum

### Bot gak bales di Telegram

1. Cek status PM2: `pm2 status sellvpn` \u2014 harus `online`.
2. Cek log error: `pm2 logs sellvpn --err --lines 50`.
3. Pastikan `BOT_TOKEN` benar: `grep BOT_TOKEN /root/BotVPN/.env`.
4. Pastikan bot sudah `/start` sekali oleh user (Telegram tidak izinkan bot DM user yang belum `/start`).

### Error `EADDRINUSE: address already in use 0.0.0.0:6969`

Port 6969 sudah dipakai process lain. Opsi:
- Stop process lama: `lsof -i :6969` \u2014 kill PID-nya.
- Ganti port di `.env`: `PORT=6970`.

### Error `SQLITE_CANTOPEN` di log

Permission DB salah atau folder `/root/BotVPN` tidak writable:

```bash
chown -R root:root /root/BotVPN
chmod 755 /root/BotVPN
chmod 644 /root/BotVPN/*.db 2>/dev/null
```

### `node-gyp` / `sqlite3` build error saat `npm ci`

```bash
sudo apt install -y python3 build-essential
cd /root/BotVPN
rm -rf node_modules package-lock.json
npm install --omit=dev
```

### Memori VPS penuh (OOM)

Bot restart berulang karena kena `max_memory_restart: 512M` di `ecosystem.config.js`. Opsi:
- Upgrade VPS ke RAM 1 GB.
- Tambah swap: `fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`.
- Kecilkan scheduler interval di `.vars.json` (`QRIS_CHECK_INTERVAL_MS`, `AUTO_BACKUP_INTERVAL_HOURS`).

### PM2 tidak auto-start setelah reboot

Ulangi setup startup:

```bash
pm2 unstartup systemd
pm2 startup systemd -u root --hp /root
# copy command yang di-print, jalankan
pm2 save
```

### Log penuh disk

Pasang pm2-logrotate (lihat bagian 10) atau manual clean:

```bash
pm2 flush sellvpn
```

### Mau downgrade atau uninstall total

```bash
pm2 stop sellvpn && pm2 delete sellvpn
pm2 save
pm2 unstartup systemd
rm -rf /root/BotVPN /root/BotVPN-backup-*
sudo apt remove -y nodejs npm
```

### `update.sh` stop dengan "perubahan lokal yang belum di-commit"

File yang biasa muncul + cara handle:
- `cek-port.sh` — mestinya bersih sekarang. Kalau muncul, `git checkout -- cek-port.sh`.
- `cek-port.servers` — sudah `.gitignore`. Kalau masih nyangkut, `git pull` setelah stash.
- `trial.db.migrated` — hasil migrasi trial ke SQLite. Aman dibiarkan, di-`.gitignore`.

Bersihkan + lanjut update:

```bash
cd /root/BotVPN
git stash push -u -m "vps-local"
bash ./update.sh
# kalau perlu balikin perubahan lokal: git stash pop
```

### Bot baru deploy tapi sebagian field `.env` kosong

Installer copy dari `.env.example` lalu prompt 7 field umum (`BOT_TOKEN`, `USER_ID`, `MASTER_ID`, `ADMIN_IDS`, `GROUP_ID`, `BACKUP_CHAT_ID`, `NAMA_STORE`). Field opsional (GoPay/OrderKuota/CekPay) sengaja dibiarkan kosong supaya bot tetap bisa start untuk testing.

Untuk isi sisanya, edit manual:

```bash
nano /root/BotVPN/.env
pm2 restart sellvpn --update-env
```

### Ada field di `.env.example` yang gak ada di `.env` lama

Sesi mendatang mungkin tambah field baru ke `.env.example`. Cara cek + sync:

```bash
cd /root/BotVPN
# List field yang ada di example tapi belum ada di .env kamu
diff <(grep -v '^#' .env.example | awk -F= '{print $1}' | sort -u) \
     <(grep -v '^#' .env | awk -F= '{print $1}' | sort -u) | grep '^<'
```

Output `< NAMA_FIELD` = field yang belum kamu punya. Tambah manual via `nano .env`.

### Migrasi DB dari VPS lama tapi data hilang

Cek di VPS lama dulu apakah file DB ada + bukan kosong:

```bash
# Di VPS lama
ls -lh /root/BotVPN/*.db
sqlite3 /root/BotVPN/sellvpn.db "SELECT COUNT(*) FROM users;"
```

Kalau angka 0 padahal seharusnya banyak, kemungkinan file DB di-overwrite atau path beda. Cek:

```bash
find / -name 'sellvpn.db' 2>/dev/null
```

Pastikan kamu pakai file yang benar saat migrasi.

---

**Butuh bantuan lebih lanjut?** Cek log dulu (`pm2 logs sellvpn --lines 100`), baru lapor issue dengan output log yang relevan.
