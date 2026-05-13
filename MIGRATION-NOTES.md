# Catatan Migrasi & Backup BotVPN

Panduan santai untuk merawat bot setelah migrasi dari VPS lama ke VPS baru.
Ditulis untuk admin yang baru pertama kali handle deployment Node.js + bot Telegram.

Kalau ada istilah yang asing, lihat bagian "Glosarium" di paling bawah.

---

## 1. Apa yang Sudah Terjadi Sampai Sekarang

Singkatnya, kita sudah pindahkan bot dari VPS lama ke VPS baru, lalu rapikan
supaya lebih aman dan rapi. Yang berubah:

- **Data lama tetap terbawa.** User, saldo, akun yang sudah dibuat, riwayat transaksi,
  trial counter, semua pindah utuh ke VPS baru.
- **Token bot, ID admin, dan API key payment** sekarang disimpan di file `.env`.
  Dulu numpang di `.vars.json` campur sama tier bonus dan scheduler. Sekarang dipisah:
  yang sensitif (rahasia) di `.env`, yang non-sensitif (config bisnis) tetap di `.vars.json`.
- **Trial counter harian** dulu disimpan di file `trial.db` berbentuk JSON.
  Sekarang sudah dipindah ke tabel SQLite supaya lebih aman dari race condition
  (klik dua kali nggak bisa lolos double trial).
- **Backup otomatis** sekarang jalan tiap 12 jam. File backup dikirim ke Telegram admin
  dan disimpan lokal 7 hari di `/root/botvpn_backups/`.

## 2. Alat-alat Penting (Lokasi & Fungsi)

Anggap bot kamu seperti rumah. Ini ruangan-ruangannya:

| Lokasi | Fungsi | Boleh Diedit Manual? |
|---|---|---|
| `/root/BotVPN/` | Folder utama bot (kode + config + DB) | Ya, hati-hati |
| `/root/BotVPN/.env` | Token bot, ID admin, API payment | Ya, lalu `pm2 restart sellvpn --update-env` |
| `/root/BotVPN/.vars.json` | Tier bonus, jam laporan, dll | Ya, restart bot |
| `/root/BotVPN/sellvpn.db` | Database utama (user, saldo, akun, transaksi) | **Jangan** edit manual |
| `/root/BotVPN/qris.jpg` | Gambar QRIS untuk topup manual | Replace lewat menu admin |
| `/root/botvpn_backups/` | Backup tar.gz lokal (7 hari terakhir) | Boleh dilihat / dihapus |
| `/var/log/botvpn-backup.log` | Log proses backup | Cuma dibaca |

## 3. Cara Pakai Sehari-hari

### Cek bot masih hidup

```bash
pm2 status sellvpn
```

Status harus `online`. Kalau `errored` atau `stopped`, lihat logs.

### Lihat log bot

```bash
pm2 logs sellvpn --lines 30 --nostream
```

`--nostream` artinya tampil 30 baris terakhir lalu keluar (nggak nge-tail terus).
Kalau mau live-tail (sampai kamu Ctrl+C), hapus `--nostream`.

### Restart bot setelah ubah config

```bash
pm2 restart sellvpn --update-env
```

`--update-env` itu wajib kalau kamu edit `.env`. Tanpa flag itu, PM2 masih pakai
nilai lama yang ada di memori.

### Update bot ke versi terbaru dari GitHub

```bash
cd /root/BotVPN
bash ./update.sh
```

Script `update.sh` otomatis backup database, pull dari GitHub, install
dependency baru, smoke test, lalu restart PM2. Kalau ada perubahan lokal yang
belum di-commit, dia akan stop dan minta kamu stash dulu (lihat bagian
troubleshooting di DEPLOY.md).

## 4. Backup System (Yang Baru Disetup)

### Cara kerjanya

Setiap **12 jam** (jam 00:00 dan 12:00 WIT), cron jalankan:
`/root/BotVPN/scripts/backup_botvpn.sh`

Yang script ini lakukan:
1. Bundle folder `/root/BotVPN` jadi file `tar.gz` (kecuali yang nggak penting
   seperti `node_modules`, `.git`, log).
2. Kirim file ke chat Telegram admin (chat_id dari `.env`).
3. Simpan copy lokal di `/root/botvpn_backups/`.
4. Hapus backup lokal yang lebih dari 7 hari.
5. Kalau gagal kirim, retry 3 kali. Kalau masih gagal juga, kirim notif teks
   ke admin biar tahu ada masalah.

### Kalau pengen test backup sekarang (nggak nunggu cron)

```bash
bash /root/BotVPN/scripts/backup_botvpn.sh
```

Cek di Telegram, harus ada file `botvpn_YYYY-MM-DD_HH-MM.tar.gz` masuk.

### Cek log backup

```bash
tail -30 /var/log/botvpn-backup.log
```

Kalau cron sukses, ada baris `Backup terkirim ke Telegram` setiap 12 jam.

### Kalau cron-nya nggak jalan

Cek apakah cron daemon hidup:

```bash
systemctl status cron --no-pager | head -10
```

Harus ada tulisan `active (running)`. Kalau `inactive`, restart:

```bash
systemctl start cron
systemctl enable cron
```

## 5. Cara Restore dari Backup (Skenario Disaster)

Skenario: VPS rusak, harus pindah ke VPS lain. Ini langkahnya:

### Langkah 1 — Siapkan VPS baru

Install bot baru pakai installer:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ketanvpn/ketantechvpn/main/scripts/install.sh)
```

Saat installer prompt token bot, kasih nilai apa saja sementara (akan ditimpa).

### Langkah 2 — Stop bot baru

```bash
pm2 stop sellvpn
```

### Langkah 3 — Download backup tar.gz dari Telegram

Kirim file `botvpn_YYYY-MM-DD_HH-MM.tar.gz` dari chat admin Telegram
ke laptop kamu, lalu upload ke VPS baru pakai `scp`:

```bash
scp ~/Downloads/botvpn_2026-05-13_12-00.tar.gz root@IP_VPS_BARU:/tmp/
```

### Langkah 4 — Extract di VPS baru

```bash
cd /root
tar -xzf /tmp/botvpn_2026-05-13_12-00.tar.gz
# Ini akan extract ke /root/BotVPN/ dan timpa file yang ada
```

### Langkah 5 — Restart bot

```bash
chmod 600 /root/BotVPN/.env
pm2 restart sellvpn --update-env
pm2 logs sellvpn --lines 30 --nostream
```

Kalau `Bot telah dimulai` muncul di log + nggak ada error, bot kembali online
dengan semua data dari backup.

## 6. Troubleshooting Umum

### "Backup nggak masuk Telegram"

Cek log:

```bash
tail -50 /var/log/botvpn-backup.log
```

Beberapa kemungkinan:
- **`BOT_TOKEN kosong`**: file `.env` rusak. Restore dari backup.
- **`Tidak ada chat tujuan`**: `.env` kehilangan `BACKUP_CHAT_ID` / `USER_ID`. Edit `.env`, isi.
- **`Gagal kirim (attempt 3/3)`**: Telegram block, atau bot belum pernah `/start` di chat admin.
  Kirim `/start` ke bot dulu dari chat admin.
- **File `.tar.gz` lebih dari 50 MB**: Telegram limit. Kalau bot sudah besar banget,
  pindah ke OFFSITE backup (rsync ke VPS lain), bukan via Telegram.

### "Bot offline / errored"

```bash
pm2 logs sellvpn --err --lines 50
```

Cari kata "Error" atau "Unauthorized". Kalau Unauthorized, BOT_TOKEN salah.
Kalau ECONNREFUSED, internet bermasalah atau IP VPS di-block oleh Telegram
(jarang tapi bisa kejadian).

### "`update.sh` minta stash perubahan lokal"

Berarti ada file di repo yang kamu edit. Cek file mana:

```bash
git status --short
```

Kalau itu file system (cek-port.sh, install.sh, update.sh), buang aja:

```bash
git checkout -- cek-port.sh scripts/install.sh update.sh
```

Lalu coba `update.sh` lagi.

### "Disk penuh"

```bash
df -h
du -sh /root/BotVPN/logs /root/botvpn_backups /root/BotVPN/node_modules
```

Yang sering bikin penuh:
- Log PM2: `pm2 flush sellvpn` (kosongkan log)
- Backup lokal lama: retention sudah set 7 hari, tapi kalau perlu manual `rm`
- Node modules bisa di-rebuild: `cd /root/BotVPN && rm -rf node_modules && npm ci --omit=dev`

## 7. Yang Perlu Kamu Lakukan ke Depannya

### Mingguan

- Cek bot masih online: `pm2 status sellvpn`
- Cek backup masih masuk Telegram (file dari cron 12 jam)

### Bulanan

- Cek update repo: `cd /root/BotVPN && bash ./update.sh`
- Lihat log error PM2: `pm2 logs sellvpn --err --lines 100`

### Sekali (jangan lupa)

- **Shutdown VPS lama permanen** kalau belum:
  ```bash
  ssh root@IP_VPS_LAMA
  pm2 delete sellvpn
  pm2 save
  pm2 unstartup systemd
  ```
- **Hapus file backup migrasi** setelah yakin VPS baru stabil (1–2 minggu):
  ```bash
  cd /root/BotVPN
  rm .env.vpsbaru-bak .vars.json.vpsbaru-bak sellvpn.db.vpsbaru-bak
  rm /tmp/qris.jpg.production /tmp/botvpn-old-backup.tar.gz
  ```
- **(Opsional)** Rotate token + API key kalau khawatir bocor:
  - BotFather → `/mybots` → pilih bot → `API Token` → `Revoke current token`.
  - Update `.env` dengan token baru, `pm2 restart sellvpn --update-env`.

## 8. Glosarium (Istilah yang Sering Muncul)

- **VPS**: Server virtual yang kamu sewa di provider (Contabo, DigitalOcean, dsb).
  Dirimu "login" pakai SSH dari laptop.
- **SSH**: Cara remote ke VPS dari terminal laptop. Login pakai password atau key.
- **PM2**: Tool yang jaga bot Node.js tetap hidup (auto-restart kalau crash).
  Command-nya `pm2 status`, `pm2 logs`, `pm2 restart`.
- **Cron**: Penjadwal task di Linux. Format `MENIT JAM TANGGAL BULAN HARI command`.
  Contoh `0 */12 * * *` = jam 00:00 dan 12:00 tiap hari.
- **`.env`**: File config yang isinya pasangan `KEY=VALUE`. Biasanya untuk
  rahasia (token, password, API key).
- **SQLite**: Database file-based. Filenya `sellvpn.db` di folder bot. Nggak perlu
  install MySQL/PostgreSQL terpisah.
- **tar.gz**: Format archive (mirip ZIP) di Linux. `tar` bundle folder, `gz`
  compress isinya.
- **Race condition**: Bug yang terjadi karena dua proses jalan bareng dan saling
  bertabrakan. Misalnya user klik 2x cepat, bot proses 2x = double create.
- **Stash (git)**: "Saku sementara" buat simpan perubahan lokal yang belum siap
  di-commit. Bisa di-pop balik nanti.

## 9. Penutup

Catatan ini akan terus di-update kalau ada perubahan major. File ini ada di
repo (`/root/BotVPN/MIGRATION-NOTES.md` di VPS, atau di GitHub).

Kalau ada masalah:
1. Baca DEPLOY.md section "Troubleshooting".
2. Cek log: `pm2 logs sellvpn --err --lines 100` dan `tail /var/log/botvpn-backup.log`.
3. Kalau masih bingung, paste log + perintah yang kamu jalankan.

Selamat mengelola bot.
