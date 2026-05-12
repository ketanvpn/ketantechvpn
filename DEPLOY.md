# Deploy BotVPN ke VPS Baru

Checklist ini fokus untuk deploy bersih Bot Telegram VPN (Node.js + Telegraf + Express + SQLite) ke VPS Ubuntu 24.04 / Debian 12. Target path default: `/root/BotVPN` (sesuai `ecosystem.config.js`).

> Catatan: repo sedang transisi dari `.vars.json` (semua config + secret campur) ke `.env` (secret) + `.vars.json` (config non-sensitif). Checklist ini mendukung dua-duanya, pilih salah satu jalur di bagian Setup Konfigurasi.

---

## 1. Prasyarat VPS

- **OS**: Ubuntu 24.04 LTS atau Debian 12 (x86_64). Arsitektur ARM tetap jalan selama `node-gyp` bisa build `sqlite3`.
- **RAM**: minimal 512 MB (PM2 `max_memory_restart` di-set 512M), rekomendasi 1 GB biar aman saat backup + cron jalan bareng.
- **Disk**: 5 GB bebas (DB + log rotasi).
- **Network**: outbound ke `api.telegram.org:443`, `v1-gateway.autogopay.site:443`, `api.rajaserver.web.id:443`, dan SOCKS pool (`*.rajavpn.web.id:1080`) harus lolos. Tidak perlu inbound HTTP publik (Telegraf pakai long-polling).
- **Timezone**: `Asia/Jayapura` sesuai `.vars.json` (`TIME_ZONE`). Samakan jam OS:

```bash
sudo timedatectl set-timezone Asia/Jayapura
timedatectl status
```

- **User**: dokumentasi ini asumsinya jalan sebagai `root`. Kalau pakai user non-root, sesuaikan path `cwd` di `ecosystem.config.js` dan semua `chmod/chown`.

---

## 2. Install Dependensi Sistem

Satu blok sekali jalan:

```bash
sudo apt update
sudo apt install -y curl git jq build-essential python3 bash ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2@latest
```

Verifikasi:

```bash
node -v   # harus v20.x
npm -v
pm2 -v
jq --version
```

`build-essential` + `python3` wajib karena `sqlite3@^5.1.7` butuh compile native.

---

## 3. Clone / Upload Repo ke `/root/BotVPN`

Pilih salah satu:

**Opsi A - git clone (fresh install)**

```bash
git clone https://github.com/ketanvpn/ketantechvpn.git /root/BotVPN
cd /root/BotVPN
```

**Opsi B - rsync dari lokal (kalau sudah dimodif di workstation)**

Dari mesin lokal:

```bash
rsync -avz --progress \
  --exclude node_modules --exclude logs --exclude .git \
  ./BotVPN/ root@VPS_IP:/root/BotVPN/
```

Aturan upload:
- **JANGAN** ikutkan `node_modules/`, `logs/` (di-generate ulang).
- **JANGAN** ikutkan `*.db` kalau ini fresh install (biar schema dibuat ulang otomatis oleh `app.js`).
- **IKUTKAN** `*.db` + `trial_config.json` + `trial_settings.json` kalau migrasi dari bot lama (lihat bagian 4).
- `qris.jpg`, `cek-port.sh`, `ecosystem.config.js`, `package.json`, `package-lock.json`, `app.js` wajib ada.

---

## 4. Backup & Migrasi Data dari Bot Lama

Di VPS lama, stop dulu biar DB konsisten:

```bash
pm2 stop sellvpn
```

File yang wajib dipindah:

- `./sellvpn.db` - DB utama (user, produk, transaksi, reseller).
- `./trial.db` - data trial.
- `./ressel.db` - data reseller.
- `./database.db` - kalau terpakai (beberapa build lama masih nulis ke sini).
- `./trial_config.json`, `./trial_settings.json` - konfigurasi trial.
- `./qris.jpg` - gambar QRIS statis.
- `./.vars.json` - hanya kalau belum migrasi ke `.env`.

Copy dari VPS lama ke VPS baru:

```bash
# dari VPS baru, tarik file dari VPS lama
rsync -avz root@OLD_VPS:/root/BotVPN/sellvpn.db        /root/BotVPN/
rsync -avz root@OLD_VPS:/root/BotVPN/trial.db          /root/BotVPN/
rsync -avz root@OLD_VPS:/root/BotVPN/ressel.db         /root/BotVPN/
rsync -avz root@OLD_VPS:/root/BotVPN/database.db       /root/BotVPN/ 2>/dev/null || true
rsync -avz root@OLD_VPS:/root/BotVPN/trial_config.json /root/BotVPN/
rsync -avz root@OLD_VPS:/root/BotVPN/trial_settings.json /root/BotVPN/
rsync -avz root@OLD_VPS:/root/BotVPN/qris.jpg          /root/BotVPN/
```

Rapikan owner & permission:

```bash
cd /root/BotVPN
chown -R root:root .
chmod 600 ./*.db ./.env ./.vars.json 2>/dev/null || true
chmod 644 ./qris.jpg ./trial_config.json ./trial_settings.json
```

Cek integrity SQLite sebelum lanjut:

```bash
sqlite3 ./sellvpn.db "PRAGMA integrity_check;"
```

Kalau output bukan `ok`, jangan lanjut. Restore dari backup sebelumnya.

---

## 5. Setup Konfigurasi

### Jalur A - sudah pindah ke `.env` (rekomendasi ke depan)

Buat `./.env` di root repo:

```bash
cat > /root/BotVPN/.env <<''ENV''
BOT_TOKEN=ISI_TOKEN_BARU_DARI_BOTFATHER
GOPAY_API_KEY=agp_xxxxxxxxxxxxxxxxxxxxxxxx
GOPAY_API_BASE_URL=https://v1-gateway.autogopay.site
GOPAY_BASE_QR=0002010102...
ORDERKUOTA_AUTH_USERNAME=ekokuncoro
ORDERKUOTA_AUTH_TOKEN=xxxxxxx:xxxxxxxxxxxxxxxxxxxxxxxx
CEKPAY_ORKUT_USERNAME=ekokuncoro
CEKPAY_ORKUT_TOKEN=xxxxxxx:xxxxxxxxxxxxxxxxxxxxxxxx
MERCHANT_ID=00020101021126670016COM.NOBUBANK.WWW...
PAYMENT_GATEWAY_BASE_URL=https://api.rajaserver.web.id/orderkuota/createpayment
CEKPAY_API_URL=https://api.rajaserver.web.id/orderkuota/cekstatus
SOCKS_POOL=["user:pass@host1:1080","user:pass@host2:1080"]
ENV
chmod 600 /root/BotVPN/.env
```

`SOCKS_POOL` ditulis sebagai **JSON array string satu baris** (di-`JSON.parse` oleh `app.js`).

Lalu tinggalkan di `./.vars.json` hanya konfigurasi non-sensitif: `NAMA_STORE`, `PORT`, `TIME_ZONE`, `ADMIN_IDS`, `GROUP_ID`, `RESELLER_DISCOUNT`, `RESELLER_MIN_TOPUP`, `AUTO_BACKUP_*`, `DAILY_REPORT_*`, `EXPIRY_REMINDER_*`, `TOPUP_BONUS_*`, `RESELLER_TARGET_*`, `RESELLER_ACTIVE_BONUS_*`, `QRIS_AUTO_TOPUP_*`, `QRIS_CHECK_INTERVAL_MS`, `QRIS_PAYMENT_TIMEOUT_MIN`, `EXPIRE_DATE`, `NOTIF_TOPUP_GROUP`.

### Jalur B - masih pakai `.vars.json` lama (belum migrasi)

Tidak perlu bikin `.env`. Edit langsung `./.vars.json`:

```bash
nano /root/BotVPN/.vars.json
chmod 600 /root/BotVPN/.vars.json
```

Wajib ganti minimal: `BOT_TOKEN`, `USER_ID`, `ADMIN_IDS`, `GROUP_ID`, `MERCHANT_ID`, `GOPAY_API_KEY`, `GOPAY_BASE_QR`, `ORDERKUOTA_AUTH_*`, `CEKPAY_ORKUT_*`, `SOCKS_POOL`, `NAMA_STORE`.

> Kalau ragu mix `.env` + `.vars.json`: `app.js` pasca-patch akan prioritaskan `process.env.X`, fallback ke `.vars.json[X]`. Aman untuk transisi bertahap.

---

## 6. Install Dependency Node

```bash
cd /root/BotVPN
npm ci        # kalau package-lock.json ada (repo ini ada)
# fallback kalau npm ci gagal karena lock mismatch:
# npm install
```

Kalau build `sqlite3` gagal dengan error `node-gyp` / `python not found`:

```bash
sudo apt install -y python3 build-essential
npm rebuild sqlite3
```

---

## 7. Permission & Folder

```bash
cd /root/BotVPN
chmod +x ./cek-port.sh
chmod +x ./start 2>/dev/null || true
chmod +x ./update.sh
mkdir -p ./logs
```

`cek-port.sh` dipakai runtime oleh bot untuk cek port server VPN, jadi bit execute wajib.

---

## 8. Rotasi Kredensial Sebelum Go-Live

Wajib hukumnya kalau repo / `.vars.json` pernah terekspos (GitHub public, screenshot, dsb):

- **BOT_TOKEN**: BotFather -> `/revoke` -> pilih bot -> ganti token di `.env`/`.vars.json`.
- **GOPAY_API_KEY**: dashboard AutoGoPay -> Regenerate API Key.
- **ORDERKUOTA_AUTH_TOKEN / CEKPAY_ORKUT_TOKEN**: login ulang OrderKuota, generate token baru.
- **SOCKS_POOL**: minta provider rotate password user SOCKS.
- **MERCHANT_ID / GOPAY_BASE_QR**: tidak termasuk secret, tapi pastikan sesuai merchant aktif.

Simpan kredensial lama di password manager selama 24 jam untuk rollback darurat, lalu hapus.

---

## 9. Smoke Test

```bash
cd /root/BotVPN
npm run smoke:syntax          # node --check app.js
npm run smoke:audit           # node scripts/smoke-audit.js
```

Lalu jalankan manual sebentar untuk lihat startup log:

```bash
node app.js
```

Yang harus muncul di stdout (tanpa error fatal):
- `Bot telah dimulai` atau log startup Telegraf.
- `Express listening on :6969` (atau port di `PORT`).
- Tidak ada `SQLITE_CANTOPEN` / `Unauthorized` / `401`.

Di Telegram, kirim `/start` ke bot -> harus balas menu utama. Kalau OK, `Ctrl+C` dan lanjut PM2.

---

## 10. Jalankan Produksi via PM2

```bash
cd /root/BotVPN
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root
# copy-paste command yang di-print PM2 kalau ada, lalu:
pm2 save
```

Operasional harian:

```bash
pm2 status
pm2 logs sellvpn          # live tail
pm2 logs sellvpn --lines 200
pm2 restart sellvpn
pm2 reload sellvpn        # zero-downtime (bot akan reconnect polling)
pm2 stop sellvpn
```

Log disimpan di `./logs/out.log` dan `./logs/err.log` (lihat `ecosystem.config.js`). Rotasi opsional:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
```

---

## 11. Firewall / UFW

Bot tidak butuh inbound HTTP publik (Telegraf pakai long-polling outbound). Port 6969 cukup listen di `127.0.0.1` atau LAN internal. Konfigurasi minimal:

```bash
sudo ufw allow OpenSSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status verbose
```

Buka `6969` hanya kalau memang ada tooling eksternal (monitoring internal, health check) yang butuh:

```bash
sudo ufw allow from TRUSTED_IP to any port 6969 proto tcp
```

Jangan buka 6969 ke `0.0.0.0` tanpa reverse proxy + auth.

---

## 12. Monitoring & Backup Otomatis

**Built-in bot:**
- `AUTO_BACKUP_ENABLED=true` + `AUTO_BACKUP_INTERVAL_HOURS` di `.vars.json` -> bot kirim DB ke admin via Telegram tiap interval.
- Admin bisa trigger manual via menu admin -> `backup_db`.
- `DAILY_REPORT_HOUR/MINUTE` -> report omzet harian.
- `EXPIRY_REMINDER_ENABLED` -> reminder expired H-N.

**Off-site backup (rekomendasi tambahan):**

```bash
cat >/etc/cron.d/botvpn-offsite <<''CRON''
0 */6 * * * root rsync -az /root/BotVPN/sellvpn.db /root/BotVPN/trial.db /root/BotVPN/ressel.db backup@OFFSITE_HOST:/srv/botvpn-backup/$(hostname)/ >> /var/log/botvpn-offsite.log 2>&1
CRON
```

Monitoring proses minimal via `pm2 monit` atau integrasi `pm2 plus`. Untuk alert sederhana: pantau `logs/err.log` via `tail -F` + script notifikasi Telegram.

---

## 13. Update Versi Baru

**Cara cepat (dari repo upstream):**

```bash
cd /root/BotVPN
bash ./update.sh
```

`update.sh` akan re-pull sejumlah file dari GitHub + rebuild dependencies + restart PM2. Cocok kalau tidak ada modifikasi lokal.

**Cara manual (repo di-clone):**

```bash
cd /root/BotVPN
pm2 stop sellvpn
cp ./sellvpn.db ./sellvpn.db.bak.$(date +%F-%H%M)
git pull --rebase
npm install
npm run smoke:all
pm2 restart sellvpn
pm2 logs sellvpn --lines 100
```

Selalu backup DB sebelum `git pull` karena migrasi schema dijalankan saat boot.

---

## 14. Troubleshooting Umum

- **Bot tidak respon `/start`**
  - `pm2 logs sellvpn` -> cek error `401 Unauthorized` (token salah/dicabut) atau `ETIMEDOUT` (network).
  - Pastikan jam VPS akurat: `timedatectl`. Drift > beberapa menit bikin Telegram tolak request.
  - Cek hanya satu instance yang polling (dua proses -> konflik `getUpdates`).

- **`npm install` gagal di `sqlite3` / `node-gyp`**
  ```bash
  sudo apt install -y python3 build-essential
  npm rebuild sqlite3 --build-from-source
  ```
  Kalau masih gagal, clear cache: `rm -rf node_modules package-lock.json && npm install` (hanya kalau siap regenerate lock).

- **Telegraf polling timeout / DNS error ke `api.telegram.org`**
  - Sering disebabkan IPv6 broken di beberapa VPS. Matikan IPv6 (sama seperti anjuran di `README.md`):
    ```bash
    sudo sysctl -w net.ipv6.conf.all.disable_ipv6=1
    sudo sysctl -w net.ipv6.conf.default.disable_ipv6=1
    echo "net.ipv6.conf.all.disable_ipv6=1"     | sudo tee -a /etc/sysctl.conf
    echo "net.ipv6.conf.default.disable_ipv6=1" | sudo tee -a /etc/sysctl.conf
    ```
  - Cek resolver: `getent hosts api.telegram.org`. Kalau gagal, set DNS ke `1.1.1.1` / `8.8.8.8` di `/etc/resolv.conf` atau `systemd-resolved`.

- **QRIS mutasi tidak masuk / auto topup diam**
  - Cek `SOCKS_POOL`: minimal satu proxy harus hidup. Tes manual `curl --socks5 user:pass@host:1080 https://mobile.orderkuota.com`.
  - Cek `ORDERKUOTA_AUTH_TOKEN` / `CEKPAY_ORKUT_TOKEN` belum expired (format `ID:token`).
  - Cek interval `QRIS_CHECK_INTERVAL_MS` tidak 0 dan `QRIS_PAYMENT_TIMEOUT_MIN` wajar.
  - `pm2 logs sellvpn | grep -i qris` untuk lihat respons API.

- **Port 6969 "address already in use"**
  - `ss -lntp | grep 6969` -> kill proses lama atau ganti `PORT` di `.vars.json`.

- **File `.env` / `.vars.json` diabaikan**
  - Pastikan path running `cwd` sesuai: `pm2 describe sellvpn | grep cwd` harus `/root/BotVPN`.

---

## 15. Uninstall / Rollback

Stop & hapus dari PM2:

```bash
pm2 stop sellvpn
pm2 delete sellvpn
pm2 save
```

Backup DB terakhir sebelum buang:

```bash
tar czf /root/botvpn-final-$(date +%F).tgz \
  /root/BotVPN/sellvpn.db \
  /root/BotVPN/trial.db \
  /root/BotVPN/ressel.db \
  /root/BotVPN/.vars.json \
  /root/BotVPN/.env 2>/dev/null
```

Matikan service di VPS lama (kalau ini migrasi):

```bash
# di VPS LAMA, bukan VPS baru
pm2 stop sellvpn && pm2 delete sellvpn && pm2 save
sudo systemctl disable pm2-root 2>/dev/null || true
```

Revoke token lama di BotFather biar tidak ada dua instance. Simpan `.tgz` di tempat aman minimal 30 hari sebelum VPS lama di-destroy.

---

## Ringkasan One-Liner (referensi cepat, BUKAN pengganti checklist di atas)

```bash
sudo apt update && sudo apt install -y curl git jq build-essential python3 && \
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && \
sudo apt install -y nodejs && sudo npm i -g pm2@latest && \
git clone https://github.com/ketanvpn/ketantechvpn.git /root/BotVPN && \
cd /root/BotVPN && npm ci && chmod +x cek-port.sh && mkdir -p logs && \
nano .env   # isi secret, lalu:
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```
