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
sudo apt install -y curl git jq build-essential python3 bash ca-certificates nano
```

**Cek sukses:**

```bash
git --version
jq --version
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

Harus ada file: `app.js`, `package.json`, `ecosystem.config.js`, `cek-port.sh`, `qris.jpg`.

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

Bot butuh minimal 4 config: `BOT_TOKEN`, `USER_ID`, `ADMIN_IDS`, `GROUP_ID`. Lainnya bisa diisi belakangan.

Buat file `.env`:

```bash
cp /root/BotVPN/.env.example /root/BotVPN/.env
nano /root/BotVPN/.env
```

Isi yang WAJIB:

```env
BOT_TOKEN=12345:ABC-token-dari-BotFather
USER_ID=690744680
MASTER_ID=690744680
ADMIN_IDS=690744680
GROUP_ID=-1001234567890
```

Arti field:
- `BOT_TOKEN`: token bot dari BotFather.
- `USER_ID`: ID Telegram owner bot (lihat di @userinfobot).
- `MASTER_ID`: biasanya sama dengan `USER_ID`. Yang terima laporan harian.
- `ADMIN_IDS`: ID admin, pisahkan koma kalau lebih dari 1 (contoh: `690744680,123456789`).
- `GROUP_ID`: ID grup Telegram untuk notifikasi transaksi. Add bot ke grup, kirim `/start@bot_kamu`, cek ID grup via log bot atau pakai bot lain seperti @getmyid_bot.

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
rsync -avz root@OLD_VPS:/root/BotVPN/sellvpn.db        ./
rsync -avz root@OLD_VPS:/root/BotVPN/trial.db          ./
rsync -avz root@OLD_VPS:/root/BotVPN/ressel.db         ./
rsync -avz root@OLD_VPS:/root/BotVPN/trial_config.json ./ 2>/dev/null || true
rsync -avz root@OLD_VPS:/root/BotVPN/trial_settings.json ./ 2>/dev/null || true
rsync -avz root@OLD_VPS:/root/BotVPN/qris.jpg          ./ 2>/dev/null || true
rsync -avz root@OLD_VPS:/root/BotVPN/.vars.json        ./ 2>/dev/null || true
```

Ganti `OLD_VPS` dengan IP VPS lama.

**Cek integrity DB:**

```bash
sqlite3 ./sellvpn.db "PRAGMA integrity_check;" 2>/dev/null
```

Output harus `ok`. Kalau bukan, DB corrupt \u2014 restore dari backup sebelumnya, jangan dipakai.

**Rapikan permission:**

```bash
chmod 600 ./*.db ./.env ./.vars.json 2>/dev/null || true
chmod 644 ./qris.jpg ./trial_config.json ./trial_settings.json 2>/dev/null || true
```

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

Restart bot:

```bash
pm2 restart sellvpn
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
3. Instal paket dasar (`git`, `curl`, `jq`, `build-essential`, `python3`, `nano`).
4. Instal Node.js 20 + PM2.
5. Clone repo ke `/root/BotVPN` (skip kalau sudah ada).
6. `npm ci --omit=dev`.
7. Tanya `BOT_TOKEN`, `USER_ID`, `ADMIN_IDS`, `GROUP_ID` (prompt interaktif).
8. Tulis `.env` dengan `chmod 600`.
9. Smoke test syntax + audit.
10. Start PM2 + setup auto-start saat reboot.
11. Pasang UFW allow OpenSSH + deny incoming.

**Kalau mau non-interaktif (untuk automation)**, set env var:

```bash
BOT_TOKEN=xxx USER_ID=123 ADMIN_IDS=123 GROUP_ID=-100123 \
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

---

**Butuh bantuan lebih lanjut?** Cek log dulu (`pm2 logs sellvpn --lines 100`), baru lapor issue dengan output log yang relevan.

