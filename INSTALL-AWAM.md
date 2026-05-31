# Panduan Instal BotVPN dari Nol (Untuk Pemula)

Panduan ini dibuat untuk orang awam yang mau install **Ketantech VPN Bot** dari awal sampai bisa dipakai jualan akun VPN lewat Telegram.

Kalau kamu belum pernah pegang VPS, ikuti pelan-pelan dari atas. Jangan loncat kecuali memang sudah paham.

---

## 0. Gambaran Singkat

BotVPN ini berjalan di VPS dan terhubung ke Telegram.

Alurnya:

```text
Customer Telegram
  ↓
BotVPN di VPS
  ↓
Database saldo/transaksi lokal
  ↓
Server VPN / panel / script create akun
  ↓
Payment QRIS lewat KetantechPay
```

Jadi yang dibutuhkan bukan cuma bot Telegram, tapi juga VPS, token bot, admin ID, dan data server VPN yang mau dijual.

---

## 1. Yang Harus Disiapkan

### A. VPS untuk menjalankan bot

Minimal:

- OS: **Ubuntu 24.04 LTS** atau **Debian 12**
- RAM: minimal 512 MB, rekomendasi 1 GB
- Disk: minimal 5 GB
- Akses: SSH root

Contoh login:

```bash
ssh root@IP_VPS_KAMU
```

### B. Bot Telegram

Buat bot lewat Telegram:

1. Buka `@BotFather`
2. Kirim `/newbot`
3. Ikuti instruksi
4. Simpan token bot, bentuknya mirip:

```text
1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Token ini rahasia. Jangan dikirim ke orang lain.

### C. ID Telegram admin

Cari ID Telegram kamu:

1. Buka `@userinfobot`
2. Kirim `/start`
3. Simpan angka ID kamu

Contoh:

```text
690744680
```

### D. Grup notifikasi Telegram

Disarankan buat grup khusus notifikasi bot.

Kebutuhan:

- Masukkan bot ke grup
- Jadikan bot admin grup
- Ambil `GROUP_ID`, biasanya diawali `-100...`

Kalau belum tahu cara ambil ID grup, paling gampang pakai bot helper seperti `@RawDataBot`, lalu masukkan ke grup dan lihat `chat.id`.

### E. Payment QRIS

Rekomendasi production: pakai **KetantechPay**.

Yang perlu:

```env
PAYMENT_GATEWAY_BASE_URL=https://pay.ketantech.my.id
PAYMENT_GATEWAY_API_KEY=client_api_key_dari_ketantechpay
GOPAY_API_BASE_URL=https://pay.ketantech.my.id
GOPAY_API_KEY=
```

Catatan:

- API key AutoGoPay asli jangan ditaruh di BotVPN kalau sudah pakai KetantechPay.
- Simpan API AutoGoPay/OrderKuota di dashboard KetantechPay saja.
- BotVPN cukup pegang `PAYMENT_GATEWAY_API_KEY`.

### F. Server VPN yang mau dijual

Minimal kamu perlu punya server VPN/panel yang sudah siap create akun.

Siapkan data seperti:

- nama server
- domain server
- auth/user/pass/API key sesuai tipe server
- limit IP/quota
- harga member/reseller
- tipe akun: SSH, VMess, VLess, Trojan, Shadowsocks, sesuai setup kamu

Data server ini nanti bisa ditambahkan dari menu admin bot.

---

## 2. Cara Instal Paling Mudah (One-Liner)

Login ke VPS sebagai root, lalu jalankan:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ketanvpn/ketantechvpn/main/scripts/install.sh)
```

Installer akan otomatis:

- cek OS
- set timezone
- install paket dasar
- install Node.js + PM2
- clone repo ke `/root/BotVPN`
- install dependency bot
- membuat `.env`
- menjalankan smoke test
- start bot via PM2
- pasang firewall dasar

Nanti installer akan minta data penting seperti:

- `BOT_TOKEN`
- `USER_ID`
- `MASTER_ID`
- `ADMIN_IDS`
- `GROUP_ID`
- `BACKUP_CHAT_ID`
- `NAMA_STORE`

Setelah selesai, tes di Telegram:

```text
/start
```

Kalau bot membalas menu utama, berarti instalasi dasar sukses.

---

## 3. Cara Instal Manual

Kalau one-liner gagal atau mau install manual, ikuti ini.

### Step 1 — Update VPS

```bash
apt update
apt install -y curl git jq build-essential python3 bash ca-certificates nano rsync sqlite3 ufw
```

### Step 2 — Set timezone

Untuk WIT / Papua:

```bash
timedatectl set-timezone Asia/Jayapura
```

Untuk WIB:

```bash
timedatectl set-timezone Asia/Jakarta
```

### Step 3 — Install Node.js 20 dan PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2@latest
```

Cek:

```bash
node -v
npm -v
pm2 -v
```

### Step 4 — Clone repo

```bash
cd /root
git clone https://github.com/ketanvpn/ketantechvpn.git BotVPN
cd /root/BotVPN
```

### Step 5 — Install dependency

```bash
npm ci --omit=dev
```

Kalau gagal, coba:

```bash
npm install --omit=dev
npm rebuild sqlite3
```

### Step 6 — Buat config `.env`

```bash
cp .env.example .env
nano .env
```

Minimal isi:

```env
BOT_TOKEN=isi_token_dari_botfather
USER_ID=isi_id_telegram_admin
MASTER_ID=isi_id_telegram_admin
ADMIN_IDS=isi_id_telegram_admin
GROUP_ID=isi_id_grup_notifikasi
BACKUP_CHAT_ID=isi_id_telegram_admin_atau_grup_backup
NAMA_STORE=Nama Toko Kamu
TIME_ZONE=Asia/Jayapura
```

Kalau pakai KetantechPay:

```env
PAYMENT_GATEWAY_BASE_URL=https://pay.ketantech.my.id
PAYMENT_GATEWAY_API_KEY=isi_client_api_key
GOPAY_API_BASE_URL=https://pay.ketantech.my.id
GOPAY_API_KEY=
```

Simpan file di nano:

```text
CTRL + O → Enter → CTRL + X
```

### Step 7 — Buat config `.vars.json`

```bash
cp .vars.example.json .vars.json
nano .vars.json
```

Untuk awal, boleh biarkan default dulu. Yang paling penting samakan timezone:

```json
"TIME_ZONE": "Asia/Jayapura"
```

### Step 8 — Jalankan smoke test

```bash
node --check app.js
node scripts/smoke-audit.js
node scripts/smoke-boot.js
```

Kalau semua aman, lanjut.

### Step 9 — Start bot pakai PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 status sellvpn
```

Supaya bot otomatis hidup setelah VPS restart:

```bash
pm2 startup systemd -u root --hp /root
```

Command ini biasanya menampilkan command lanjutan. Copy dan jalankan command yang muncul, lalu:

```bash
pm2 save
```

### Step 10 — Tes bot

Buka Telegram bot kamu, lalu kirim:

```text
/start
```

Kalau muncul menu utama, bot sudah jalan.

---

## 4. Setup Awal dari Menu Admin Bot

Setelah bot hidup, buka Telegram dan masuk menu admin.

Urutan setup yang disarankan:

1. Cek menu admin tampil.
2. Tambahkan server VPN.
3. Atur harga akun.
4. Atur limit/quota/IP kalau diperlukan.
5. Tes buat akun kecil dari akun admin sendiri.
6. Tes topup QRIS nominal kecil.
7. Tes beli akun pakai saldo.
8. Cek log PM2 kalau ada error.

Command cek log:

```bash
pm2 logs sellvpn --lines 100
```

---

## 5. Cara Update Bot

Ada 2 cara.

### Cara A — Update simpel

Dipakai kalau update kecil dan Bos tahu kondisi bot aman.

```bash
cd /root/BotVPN
git pull origin main
pm2 restart all
```

Cek status:

```bash
pm2 status
pm2 logs sellvpn --lines 50
```

### Cara B — Update aman pakai script

Ini rekomendasi untuk orang awam karena otomatis backup + test.

```bash
cd /root/BotVPN
bash update.sh
```

Script ini akan:

- cek perubahan lokal
- backup database/config penting
- `git pull`
- install dependency
- run smoke test
- restart PM2
- cek status bot
- tampilkan log terbaru

Kalau sukses akan muncul info seperti:

```text
Update selesai. Bot online.
Backup: /root/BotVPN-backup-YYYYMMDD-HHMMSS
```

---

## 6. Cara Cek Bot Sehat

```bash
pm2 status sellvpn
```

Status harus:

```text
online
```

Cek log:

```bash
pm2 logs sellvpn --lines 100
```

Cek restart count:

```bash
pm2 describe sellvpn | grep restart
```

Kalau restart terus naik, berarti bot crash-loop dan perlu cek error log.

---

## 7. Backup Manual

Backup cepat sebelum edit/update besar:

```bash
BACKUP_DIR="/root/backup-botvpn-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -a /root/BotVPN/*.db "$BACKUP_DIR" 2>/dev/null || true
cp -a /root/BotVPN/.env "$BACKUP_DIR" 2>/dev/null || true
cp -a /root/BotVPN/.vars.json "$BACKUP_DIR" 2>/dev/null || true
echo "Backup tersimpan di: $BACKUP_DIR"
```

Atau pakai script bawaan jika tersedia:

```bash
cd /root/BotVPN
bash scripts/backup_botvpn.sh
```

---

## 8. Troubleshooting Umum

### Bot tidak membalas `/start`

Cek:

```bash
pm2 status sellvpn
pm2 logs sellvpn --lines 100
```

Kemungkinan:

- `BOT_TOKEN` salah
- bot belum distart
- proses crash
- token bot sudah dicabut dari BotFather

### Error `409 Conflict: terminated by other getUpdates request`

Artinya token bot yang sama sedang jalan di tempat lain.

Solusi:

- matikan bot lama
- pastikan cuma 1 VPS yang menjalankan token itu
- restart:

```bash
pm2 restart sellvpn
```

### Error payment / QRIS tidak muncul

Cek `.env`:

```bash
nano /root/BotVPN/.env
```

Pastikan:

```env
PAYMENT_GATEWAY_BASE_URL=https://pay.ketantech.my.id
PAYMENT_GATEWAY_API_KEY=isi_key_benar
GOPAY_API_BASE_URL=https://pay.ketantech.my.id
```

Lalu restart:

```bash
pm2 restart sellvpn --update-env
```

### Error server penuh / gagal create akun

Biasanya masalah di data server VPN.

Cek dari menu admin:

- domain server
- auth/API key
- limit IP/quota
- server aktif/nonaktif
- port/protocol

Cek juga log:

```bash
pm2 logs sellvpn --lines 100
```

### Setelah update bot error

Cek log:

```bash
pm2 logs sellvpn --err --lines 100
```

Kalau perlu rollback cepat:

```bash
cd /root/BotVPN
git reset --hard HEAD@{1}
pm2 restart sellvpn
```

Kalau database/config rusak, ambil dari backup yang dibuat `update.sh`.

---

## 9. Checklist Sebelum Dipakai Jualan

Sebelum dipakai customer real, pastikan:

- [ ] Bot membalas `/start`
- [ ] Menu admin bisa dibuka
- [ ] Server VPN sudah ditambahkan
- [ ] Harga akun sudah benar
- [ ] Test create akun berhasil
- [ ] Test topup QRIS nominal kecil berhasil
- [ ] Saldo masuk otomatis setelah bayar
- [ ] Beli akun pakai saldo berhasil
- [ ] Customer bisa lihat akun di `Akun Saya`
- [ ] Backup aktif / minimal tahu cara backup manual
- [ ] Admin tahu cara cek log PM2
- [ ] Admin tahu cara update pakai `bash update.sh`

Kalau semua checklist aman, bot siap dipakai operasional.
