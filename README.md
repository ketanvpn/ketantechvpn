# Ketantech VPN Bot

Bot Telegram untuk jualan dan manajemen akun VPN Ketantech. Mendukung pembelian akun otomatis, saldo user, QRIS otomatis via **KetantechPay**, trial, reseller, Akun Direct EDU/Ilmupedia, laporan reseller, backup, dan menu admin berbasis inline keyboard.

> Status dokumentasi: README ini sudah disesuaikan dengan menu/refactor terbaru. Screenshot lama masih disimpan sebagai arsip dan perlu diganti dari bot production terbaru.

## Instalasi Cepat

Rekomendasi OS: Ubuntu 24 LTS atau Debian 12.

```bash
git clone https://github.com/ketanvpn/ketantechvpn.git ~/BotVPN
cd ~/BotVPN
npm ci --omit=dev
cp .env.example .env
# edit .env & .vars.json
pm2 start ecosystem.config.js
pm2 save
```

Checklist deploy VPS baru lengkap ada di [DEPLOY.md](./DEPLOY.md).

## Update Production

Di VPS production yang sudah jalan:

```bash
cd ~/BotVPN
git pull origin main
pm2 restart all
```

Atau pakai script update lengkap dengan backup + smoke test:

```bash
cd ~/BotVPN
bash update.sh
```

## Fitur Utama

### Untuk User
- `🛍️ Buat Akun` — beli akun SSH, VMess, VLess, Trojan, Shadowsocks.
- `♻️ Perpanjang Akun` — shortcut ke flow renew lewat Akun Saya.
- `📂 Akun Saya` — lihat akun, renew, lock/unlock, hapus akun sendiri.
- `💰 Cek Saldo` — lihat saldo efektif, termasuk saldo web jika akun terhubung.
- `💳 TopUp Saldo QRIS` — topup otomatis via QRIS dinamis.
- `🧾 Riwayat Transaksi` — riwayat QRIS/topup dan aktivitas saldo terakhir.
- `🆓 Trial Akun` — trial harian dengan limit konfigurasi admin.
- `🖥️ Status Server` — ringkasan server untuk member, detail port untuk reseller/admin.
- `🎓 Akun EDU / Ilmupedia` — akun Direct EDU via provider eksternal.
- `📈 Statistik & Riwayat Akun` — ringkasan akun dibuat/aktif/expired.
- `📘 Panduan Pakai` dan `❓ Bantuan / Support`.

### Untuk Reseller
- Harga akun khusus reseller.
- Server khusus reseller jika disediakan admin.
- `💵 Penjualan Saya` — ringkasan penjualan bulan berjalan.
- Target aktivitas bulanan dan progress bonus reseller.
- `💎 Upgrade ke Reseller` untuk user biasa yang ingin daftar.

### Untuk Admin / Owner
- Dashboard admin via inline keyboard.
- Manajemen server, user, saldo, reseller, harga, limit, quota.
- Tambah server umum dan server reseller.
- Broadcast ke semua user/reseller/member.
- Cek status QRIS, pending payment, dan server.
- Laporan harian, pengingat expired, backup manual/otomatis.
- Smoke checks dan helper deploy/update.

## Struktur Project

```text
app.js                  # bootstrap utama + handler legacy yang belum dipindah
accounts/               # account list/service/payment/refund helpers
admin/                  # menu admin, promo, reseller, edukasi admin
modules/                # fitur user/reseller/edukasi/service per modul
payment/                # KetantechPay/QRIS invoice, deposit, poller
scheduler/              # daily report, auto backup, expiry reminder, target reseller
lib/                    # helper umum: qris, validator, masker, time, dll
db/                     # koneksi dan migrasi SQLite
scripts/                # smoke test, installer/helper, backup
```

Modularisasi sedang berjalan bertahap. Handler yang sudah dipisah antara lain:

- `modules/user-dashboard.js`
- `modules/reseller-sales.js`
- `modules/reseller-upgrade.js`
- `accounts/my-accounts.js`
- `accounts/service.js`
- `payment/*`
- `admin/*`
- `scheduler/*`

## Sistem Pembayaran

### Rekomendasi Production: KetantechPay

BotVPN sekarang diarahkan lewat gateway internal KetantechPay, bukan direct AutoGoPay/OrderKuota dari bot.

Isi `.env`:

```env
PAYMENT_GATEWAY_BASE_URL=https://pay.ketantech.my.id
PAYMENT_GATEWAY_API_KEY=isi_client_api_key_dari_dashboard_ketantechpay

# Legacy alias untuk kompatibilitas kode lama. Samakan dengan PAYMENT_GATEWAY_BASE_URL.
GOPAY_API_BASE_URL=https://pay.ketantech.my.id
GOPAY_API_KEY=
```

Catatan penting:

- API key AutoGoPay asli sebaiknya hanya disimpan di dashboard KetantechPay credentials.
- BotVPN cukup pegang `PAYMENT_GATEWAY_API_KEY` client KetantechPay.
- Jangan isi `PAYMENT_GATEWAY_BASE_URL` dengan endpoint AutoGoPay/OrderKuota langsung.
- Hindari duplicate env key; kalau ada dua baris sama, Node akan memakai nilai terakhir.

### QRIS Statis / Manual

Untuk fallback QRIS statis/manual, `qris.jpg` masih disediakan sebagai placeholder. Data QRIS bisa diekstrak dengan:

https://qreader.online/

## Screenshot / Gambar

File gambar saat ini masih snapshot lama dan **belum mencerminkan menu user terbaru**:

| File | Status |
|---|---|
| `tampilanmenu.png` | Legacy, menu user lama. Perlu diganti dengan menu baru. |
| `image.png` | Legacy menu admin lama; masih berguna sebagai gambaran, tapi belum update. |
| `tampilaninstalasi.png` | Legacy installer lama. |
| `ss.png`, `ss2.png` | Legacy screenshot lama. |
| `qris.jpg` | Placeholder QRIS/fallback, jangan pakai untuk dokumentasi publik kalau berisi QRIS asli. |

Screenshot baru yang sebaiknya dibuat dari bot production:

1. Menu utama user terbaru.
2. Akun Saya.
3. TopUp Saldo QRIS + status invoice.
4. Riwayat Transaksi.
5. Akun EDU / Ilmupedia.
6. Menu Admin terbaru.
7. Penjualan Saya untuk reseller.

> Catatan keamanan: kalau screenshot menampilkan token, API key, ID sensitif, QRIS asli, atau saldo real, blur dulu sebelum commit/publish.

## Smoke Test Lokal

```bash
npm run smoke:syntax
npm run smoke:audit
npm run smoke:boot
npm test
```

Semua perubahan production sebaiknya minimal lolos `smoke:syntax`, `smoke:audit`, dan `smoke:boot` sebelum restart bot.

## File Konfigurasi Penting

- `.env` — secrets dan endpoint production. Jangan commit.
- `.env.example` — contoh env aman.
- `.vars.json` — konfigurasi non-sensitif/runtime legacy.
- `sellvpn.db` / `*.db` — database runtime. Jangan commit.
- `qris.jpg` — QRIS fallback/manual.

## Lisensi

Untuk pemakaian internal Ketantech. Tidak untuk redistribusi publik tanpa izin.
