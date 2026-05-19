# memori.md — Catatan Operasional Bot VPN

> Dokumen ini ditulis untuk diri sendiri (admin) dan AI assistant di sesi-sesi
> berikutnya. Berisi quick-reference: cara deploy, troubleshoot error yang
> berulang, dan keputusan-keputusan penting yang sudah diambil — supaya tidak
> perlu diagnosa ulang dari nol setiap kali.

---

## 1. Quick Deploy Standar (VPS)

```bash
cd /root/BotVPN && bash update.sh
```

Akan menjalankan: backup DB → `git pull --rebase` → `npm ci` → smoke test → `pm2 restart sellvpn` → verify online → tampilkan log terbaru.

Kalau bot online di akhir, deploy sukses. Kalau status bukan `online`, script kasih hint rollback.

---

## 2. Troubleshoot Berulang

### 2.1 Error "Ada perubahan lokal yang belum di-commit"

Saat `bash update.sh` dijalankan, muncul pesan dirty files di:

- `cek-port.sh`
- `scripts/backup_botvpn.sh`
- `scripts/install.sh`
- `update.sh`

**Penyebab:** `.gitattributes` memaksa `* text eol=lf`, tapi 4 file shell di
atas pernah masuk repo dengan CRLF (atau pernah diedit di Windows). Setiap
kali `git status`, dia tampilkan sebagai modified meskipun isi sebenarnya
identik dengan versi commit.

**Permanent fix (1x saja, beres selamanya):**

```bash
cd /root/BotVPN
git rm --cached -- cek-port.sh scripts/backup_botvpn.sh scripts/install.sh update.sh
git checkout HEAD -- cek-port.sh scripts/backup_botvpn.sh scripts/install.sh update.sh
git status   # harus bersih sekarang
bash update.sh
```

Kalau setelah `git status` masih ada perubahan: berarti memang ada modif
logic asli (bukan line ending). Jalankan `git diff <file>` untuk lihat apa
yang berubah, putuskan stash atau checkout.

### 2.2 Bot crash di tengah broadcast

Sejak commit `d986fbb`, broadcast persist progres tiap pesan ke tabel
`broadcast_jobs`. Saat startup, `resumePendingBroadcastJobs()` otomatis
melanjutkan job yang `status='running'`.

Kalau ternyata job nyangkut (tidak resume karena alasan lain), cek:

```bash
sqlite3 sellvpn.db "SELECT job_id, admin_id, target_type, cursor, total_target, status FROM broadcast_jobs WHERE status='running';"
```

Kalau ada row stale (cursor < total_target tapi tidak jalan), bisa di-mark manual:

```bash
sqlite3 sellvpn.db "UPDATE broadcast_jobs SET status='failed', finished_at=$(date +%s)000 WHERE job_id=<id>;"
```

### 2.3 Smoke test gagal saat update

`update.sh` menjalankan `node scripts/smoke-audit.js` dan `node scripts/smoke-boot.js`. Kalau salah satu gagal:

- `smoke-audit` cek regex admin guard di `app.js` + `admin/menu.js` + `admin/promo.js`. Gagal biasanya karena ada handler admin tanpa `ADMIN_IDS.includes(...)` guard.
- `smoke-boot` cek semua factory module bisa di-require dan di-instantiate. Gagal biasanya karena typo di require path atau missing dependency.

Cek log error terakhir untuk detail. Smoke test dijalankan **setelah** `npm ci`, jadi error require berarti ada bug syntax/import, bukan dependency.

---

## 3. Catatan Versi Penting

Lihat `git log --oneline` untuk daftar lengkap. Highlight commit penting:

| Commit | Tanggal | Deskripsi |
|--------|---------|-----------|
| `959b03c` | 2026-05-19 | Audit fix Akun Direct EDU (MEDIUM+LOW): submenu set price & link Ilmupedia pakai pattern editMessageText, cap atas 1jt untuk semua field harga, label `_dimatikan total_` saat trial=0 |
| `72cf9e4`  | 2026-05-19 | Audit fix Pengingat Expired (MEDIUM): konsolidasi handler ke `editOrReply` |
| `9d4055a`  | 2026-05-19 | Audit fix Auto Backup menu (HIGH+MEDIUM): semua handler pakai `ADMIN_IDS.includes()` (bukan `MASTER_ID` saja), refactor ke `editOrReply`, cap interval atas 168 jam |
| `81b2feb`  | 2026-05-19 | Audit fix Pengaturan Trial (HIGH+MEDIUM): expose `watchlistMaxPerDay` ke UI menu (tombol +/-), pesan sukses save pakai `editOrReply`, tambah tombol Kembali ke Menu Admin di pesan sukses |
| `2d795b7`  | 2026-05-19 | Audit fix Reseller & Saldo (HIGH): aware-link saldo di /addsaldo (cmd+menu), validasi user_id input addsaldo, riwayat saldo aware-link |
| `ec80ce2`  | 2026-05-19 | Tambah 2 template broadcast: 🔥 Slot/Stok Terbatas + 📋 Info/Pengumuman Umum |
| `0931bf3` | 2026-05-19 | Tambah memori.md sebagai catatan operasional |
| `264327b` | 2026-05-19 | Test Mode broadcast — tombol 🧪 Test ke Saya di preview |
| `d986fbb` | 2026-05-19 | Audit fix broadcast — HTML pre-validation, cursor per pesan, concurrent lock, tombol batal di step template |
| `19cf653` | 2025-05-19 | Template Maintenance Selesai untuk broadcast |
| `b8da967` | 2025-05-12 | Persist `broadcast_jobs` + resume cursor saat restart |
| `5e0b2e2` | 2025-05-12 | HTML-escape & command-guard di template `tm_*`/`promo_*` |
| `fbc589b` | 2025-05-12 | Guard admin handlers + trial race + broadcast rate-limit |

---

## 4. Cara Test Broadcast Tanpa Risiko ke User

Sejak commit `264327b`, ada **Test Mode** di preview konfirmasi pengumuman:

1. 📢 Kirim Pengumuman → pilih target → pilih mode (Manual / Maintenance / Maintenance Selesai / Promo / **Slot Terbatas** / **Info Umum**)
2. Selesaikan flow sampai ke layar **Preview Pengumuman**
3. Klik tombol **🧪 Test ke Saya (preview)** di baris kedua
4. Pesan dikirim hanya ke admin yang klik (bukan ke user asli), dengan label header `🧪 [TEST MODE — pesan ini hanya kamu yang lihat]`

**Template yang tersedia:**
- ✏️ **Tulis Manual** — bebas ketik, tidak ada struktur
- 🛠️ **Maintenance VPN** — pengumuman maintenance terjadwal (4 step: layanan, waktu, durasi, catatan)
- ✅ **Maintenance Selesai** — notif setelah maintenance kelar (3 step: layanan, durasi aktual, catatan)
- 🎁 **Promo / Diskon** — penawaran harga turun (4 step: paket, detail, berlaku, catatan)
- 🔥 **Slot/Stok Terbatas** — urgency saat stok terbatas (4 step: layanan, sisa slot opsional, deadline opsional, catatan opsional). Cocok untuk "Akun Direct EDU slot terbatas".
- 📋 **Info / Pengumuman Umum** — catch-all untuk pengumuman yang tidak fit ke template lain (3 step: judul, isi, catatan opsional). Cocok untuk: server baru, libur, perubahan aturan, dll.

Pakai ini untuk:

- Verifikasi format/HTML pesan sebelum kirim massal.
- Cek tampilan template maintenance/promo di chat real Telegram.
- Test HTML safety: ketik tag rusak intentionally (`<b>halo` tanpa penutup) → akan tampil `❌ Test gagal — pesan ditolak Telegram`.
- Test concurrent lock: klik 🧪 dua kali cepat → klik kedua harus tertahan dengan `⚠️ Masih ada broadcast/test yang berjalan`.

Sesi tidak dihapus setelah test, jadi setelah preview oke, tinggal klik 📢 Kirim Sekarang di pesan konfirmasi sebelumnya untuk kirim beneran.

---

## 5. Backlog Sesi Berikutnya

### Status audit menu admin (per 2026-05-19)

**Sudah selesai diaudit & di-fix:**
- ✅ Broadcast (commit `d986fbb`, `264327b`, `ec80ce2`, dll)
- ✅ Reseller & Saldo — HIGH only (commit `2d795b7`). MEDIUM/LOW masih ada beberapa yang sengaja di-defer (lihat di bawah).
- ✅ Pengaturan Trial (commit `81b2feb`)
- ✅ Auto Backup (commit `9d4055a`)
- ✅ Pengingat Expired (commit `72cf9e4`)
- ✅ Akun Direct EDU (commit `959b03c`)

**Belum diaudit:**
- [ ] **Manajemen Server** — paling kompleks, 20+ handler edit (harga/nama/domain/auth/quota/limit IP/batas/total), plus picker `_openEditNumericFieldPrompt` yang baru ditambahkan. Estimasi 1.5-2 jam. **Sebaiknya sesi terpisah** karena flow text input panjangnya banyak edge case.

### Cleanup non-audit (medium priority)

- [ ] **MEDIUM/LOW Reseller & Saldo** yang sengaja di-defer waktu commit `2d795b7`:
  - Dead code `if (false && ...)` legacy di `app.js` step `addsaldo_amount` (handler menu lama yang sudah di-replace tapi belum dihapus). Komentar `[AUDIT FIX]` sudah ada, tinggal hapus blok dead code-nya.
  - Error handling reseller bonus (kalau web API down → fallback bagaimana di `accountService.creditBalance`).
  - Race kecil di `recordSaldoTransaction` saat web credit gagal (audit trail tetap ditulis walau credit reverted).
- [ ] Refactor `admin/broadcast.js` + `state/broadcast.js` (lihat `SPLIT-ROADMAP.md`). Step machine `bot.on('text')` perlu di-extract dulu jadi state machine module supaya handler bisa pindah ke `admin/broadcast.js`. Total ~320 baris akan keluar dari `app.js`.
- [ ] Helper DRY untuk preset H-1/2/3 di `setReminderDaysPreset` — masih pakai pattern `editMessageText try/catch reply` lama, belum di-konsolidasi ke `editOrReply` (sengaja di-skip di `72cf9e4` karena beda struktur, non-blocking).

### UX polish broadcast (medium)

- [ ] Tombol "Kembali" di submenu pilih-mode (sekarang admin yang salah pilih target harus klik Batal lalu mulai lagi).
- [ ] Tombol "Edit" di preview konfirmasi (admin yang salah ketik harus mulai dari awal).
- [ ] Helper DRY untuk guard admin (8 handler `bot.action('broadcast_*')` copy-paste pattern yang sama).

### Cosmetic

- [ ] Item-item di `EMOJI-CLEANUP-PROGRESS.md` yang masih open.
- [ ] Indent fix di handler broadcast (closing brace `}` 0-spasi padahal isinya 4-spasi).
- [ ] Header comment `// ==== MENU ?→ PENGUMUMAN DI ADMIN ====` di `app.js:6613` (mestinya 📢).

---

## 6. Hal-hal yang Sudah Diputuskan (Jangan Tanya Ulang)

- **Bahasa komunikasi**: Indonesia + emoji, gaya casual tapi to-the-point. Hindari sleepy formal.
- **Pre-flight test**: selalu jalankan `node scripts/smoke-audit.js` + `node scripts/smoke-boot.js` sebelum push.
- **Branch deploy**: langsung ke `main`. Single-developer, low risk, tidak perlu PR-based workflow untuk sekarang.
- **PM2 process name**: `sellvpn`.
- **Repo**: https://github.com/ketanvpn/ketantechvpn.git
- **Database**: SQLite, file `sellvpn.db` di root project.
- **VPS path**: `/root/BotVPN`.
- **Update workflow standar**: `cd /root/BotVPN && bash update.sh`.
- **Rollback strategy**: backup DB otomatis di `/root/BotVPN-backup-<timestamp>/` setiap update; rollback dengan `cp -a <backup>/*.db /root/BotVPN/ && git reset --hard HEAD@{1}`.
- **TIME_ZONE default**: `Asia/Jayapura` (WIT). Bisa diatur lewat menu admin → Timezone Bot.

---

## 7. Untuk AI Assistant di Sesi Berikutnya

Kalau kamu (AI) baru join sesi dengan user ini, baca file ini dulu sebelum
mulai. Kalau user request pekerjaan yang punya pattern berulang yang sudah
dicatat di sini, langsung pakai solusi yang ada — tidak perlu re-diagnose.

Update file ini setelah:

- Menemukan / memperbaiki bug yang potentially berulang.
- Melakukan refactor besar yang mengubah struktur kode.
- Menambah fitur yang punya operational impact (mis. command admin baru, scheduler baru).
- User memberikan keputusan/preferensi yang harus persistent.

Jangan tambah:

- Detail implementasi yang sudah ada di kode (cukup link nama file/function).
- Roadmap besar yang lebih cocok di `SPLIT-ROADMAP.md` atau `EMOJI-CLEANUP-PROGRESS.md`.
- Dokumentasi user-facing (cocok di `README.md` atau `DEPLOY.md`).

Format tanggal: `YYYY-MM-DD` (ISO). Format commit hash: 7 karakter (`abc1234`).
