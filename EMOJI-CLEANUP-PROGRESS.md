# Emoji Cleanup Progress

Catatan perjalanan fix emoji di `app.js` yang corrupt akibat `Set-Content -Encoding ASCII` saat refactor split. Emoji UTF-8 (byte >0x7F) ter-downgrade jadi `?` literal.

---

## Sudah Selesai

### Phase 1: Restore 99.3% raw `???` marker (commits `643ec4a` + `276feaa`)

- Total `???` corrupt di `app.js`: **1385** (semua muncul di `bbcb2d2` saat body-function migration pakai ASCII encoding).
- Tool: `scripts/restore-emoji.js` — 80+ rules context-aware regex.
- Hasil: **1375 dari 1385 ter-restore (99.3%)**. Sisa 10 = 9 komentar non-visible + 1 literal API check `msg.includes('???')`.
- Pattern yang ditangani: error/warning/success prefix, separator `━`, bullet `•`, tombol `Kembali`, status `ON/OFF`, field labels, QRIS flow detail, range dash, GTE symbol, step number, dll.

### Phase 2: Context-aware cleanup emoji salah konteks (commits `c4d4063` + `bfa208c`)

Banyak `❌` (x merah) muncul di tempat yang harusnya `✅` (check), `⚠️` (warning), `⏳` (hourglass), `•` (bullet), atau emoji konteks spesifik.

**Menu utama & status user:**
- Tombol "Buat Akun" ❌ → 🛍️, "Trial Akun" ❌ → 🆓, "Bantuan" ❌ → ❓
- Status admin rusak total (`⚡��`) → 👑
- License "Sisa N hari" ❌ → 📅, "Status HARI INI" ❌ → ⚠️, "Lisensi habis" ❌ → 🔒

**Submenu protocol (create/trial/renew/del/lock/unlock):**
- "Buat Ssh/Ovpn" (no emoji) → 🖥️ Buat SSH / OpenVPN
- "Buat Vmess/Vless" → 🔗 Buat VMess/VLess
- "Buat Trojan" → 🎠 (lalu diganti 🛡️ di typeLabel, tapi tetap 🎠 di button)
- Renew → ♻️, Del → 🗑️, Lock → 🔒, Unlock → 🔓

**typeLabel riwayat akun:**
- 🗿 SSH → 🖥️ SSH
- 🔗 VMess → 🔐 VMess (kunci = encryption)
- 🔗 VLess → 🔒 VLess
- 🎠 Trojan → 🛡️ Trojan (shield)
- 👻 Shadowsocks → 🌶️ Shadowsocks

**Sukses action (admin + user):**
- TOPUP BERHASIL, API key berhasil, Saldo/User/Server berhasil: ❌ → ✅
- Gambar QRIS berhasil diunggah: ❌ → ✅
- Lisensi masih aktif, DB terhubung & bisa query: ❌ → ✅
- Toggle button "Matikan Trial" ❌ → ⛔, "Aktifkan Trial" ❌ → ✅, "Konfirmasi" ❌ → ✅

**Loading states:**
- "Sedang membuat akun..." ❌ → ⏳
- "Sedang mengecek server..." ❌ → ⏳
- "Mengirim laporan harian" ❌ → ⏳
- "Membuat preview pengingat" ❌ → ⏳
- "Menjalankan backup otomatis" ❌ → ⏳
- "Sedang diproses" ❌ → ⏳

**Warning states:**
- "Bot sementara nonaktif" ❌ → ⛔
- "Fitur cek server hanya reseller" ❌ → 🚫
- "QRIS Expired" ❌ → ⏰
- "Mode input API key GoPay dibatalkan" ❌ → ⛔
- "Lisensi sudah kadaluarsa" ❌ → ⛔

**STATUS BOT template (admin status panel):**
- ❌ ${nowText} → ⏰ (waktu)
- ❌ Uptime bot → ⏱️ (stopwatch)
- ❌ ${licenseStatus} → 📅 (kalender)
- ❌ ${dbStatus} → 💾 (disk)
- ❌ Status/Jam/Jadwal → • (bullet)

**Logger info (bukan error):**
- "User dihapus dari tabel users" ❌ → ℹ️
- "User juga dihapus dari daftar reseller" ❌ → ℹ️
- "Broadcast/Broadcastres/Broadcastmem terkirim" ❌ → ℹ️

**Program Reseller:**
- 4 bullet keuntungan sama semua (`• ✨ ...`) → bervariasi (💰 💵 ⚡ 💬)

**Test group / success generic:**
- "Test kirim notif ke grup berhasil" ❌ → ✅
- "Gagal kirim ke grup" ❌ → ⚠️

---

### Phase 3: MENU ADMIN context-aware cleanup (sesi 13-05-2026)

Total ❌ sebelum sesi ini: **385**. Setelah 5 batch patch: **205** (turun 180, ±47%).
Sisa 205 = mostly `logger.error`, `Terjadi kesalahan`, `Gagal ...`, validation messages yang memang error asli.

**Batch 1 — tombol & toggle** (`scripts/fix-emoji-admin-1.js`, 21 replace):
- Tombol `Pengaturan Trial` ❌ → 🧪; `Pengingat Expired` ❌ → 🔔
- Toggle Nyalakan Pengingat / Nyalakan Auto Backup ❌ → 🔔 / 💾
- Arithmetic buttons `Jam -1/+1`, `Menit -5/+5`, `-1 jam/+1 jam` ❌ → ➖ / ➕
- Tombol `Kirim Sekarang` (broadcast) ❌ → 📢 (tombol `Batal` tetap ❌)
- Reset DB: `Ya` ❌ → ✅, `Tidak` ❌ → ⛔
- `Tambah Server` / `Hapus Server` ❌ → ➕ / 🗑️
- `Lanjut Topup` (QRIS) ❌ → ➡️
- Status lisensi `HARI INI` di `sendAdminMenu` ❌ → ⚠️

**Batch 2 — success & logger info** (`scripts/fix-emoji-admin-2.js`, 41 replace):
- Success messages: `Saldo user berhasil`, `Server baru berhasil ditambahkan`, `Akun berhasil dibuat`, edit nama/domain/auth/harga/quota server, edit fieldName server, saldo sebesar Rp... berhasil → semua ✅
- Loading: `Sedang membuat QRIS...`, `Sedang membuat akun...` ❌ → ⏳
- Info cancel: Pengumuman/Topup/Edit nama/Edit domain/Edit auth/Tandai user/Tambah server/Reset DB/Tambah saldo dibatalkan ❌ → ⛔
- Logger.info sukses: akun unlock/lock/dihapus, QRIS paid → ✅; QRIS expired → ⏰; hapus server dimulai / QRIS polling aktif → ℹ️
- Bullet detail edit domain/auth (Sebelumnya/Menjadi/Server/Domain) ❌ → •

**Batch 3 + 3b — bullets & labels** (`scripts/fix-emoji-admin-3.js` + `3b.js`, 76 replace):
- Header Pengaturan Trial ❌ → 🧪; tombol Simpan Pengaturan ❌ → 💾
- Header `Broadcast selesai` / `Pengumuman selesai dikirim` ❌ → ✅
- Broadcast target/mode/contoh (Semua User, Reseller, Member, manual, maintenance, promo, SG-1/SG-2, durasi 30 menit/1 jam/2 jam, waktu contoh, promo detail) ❌ → •
- Timezone menu bullet (Laporan harian, Pengingat expired) ❌ → •
- Monitor panel (Total user, Total reseller, Total akun, Akun expired) ❌ → •
- Managemen Server header bullet (Tambah/Hapus, Edit harga/nama/domain/auth, Edit quota/limit/batas, Lihat list) ❌ → •
- Trial confirm info (Masa aktif, Batas trial, Minimal saldo) ❌ → •
- Riwayat saya: Total dibuat / Aktif sekarang / Sudah expired ❌ → •
- Reseller bonus progress (Akun valid, Omzet valid, Min durasi, Min omzet, Tier tercapai, Target berikutnya, Akun pendek, Hari omzet kurang) ❌ → •
- Penjualan saya (Total akun terjual, Akun durasi ≥30, Total hari, Target minimal) ❌ → •
- Status target: `Tercapai` ❌ → ✅ (ternary); `Belum tercapai` tetap ❌
- Flag user detail bullet (ID/Saldo/Status) ❌ → •; label `NORMAL` default ❌ → ✅ (WATCHLIST/NAKAL tetap ⚠️ / ⛔)
- Cek QRIS `Dibayar` bullet ❌ → •; /health `Mode` bullet ❌ → •
- Info `Ketik *batal*`, `Kalau ingin batal` ❌ → ℹ️

**Batch 4 — context messages & QRIS templates** (`scripts/fix-emoji-admin-4.js`, 29 replace):
- /health HARI INI ❌ → ⚠️
- Rate-limit warn broadcast/res/mem ❌ → ⏳ (ini warn, bukan error)
- QRIS header `QRIS EXPIRED` ❌ → ⏰, `QRIS TOPUP DIBUAT` ❌ → 💳, `Berlaku X menit` ❌ → ⏳
- Warning user-facing: `Fitur trial dimatikan`, `Batas trial watchlist/harian`, `Batas pembuatan akun watchlist` ❌ → ⛔
- Warning soft: `Saldo kurang`, `Kamu belum memenuhi syarat saldo trial`, `Perintah tidak dikenali`, `Tidak bisa membaca data pengguna` ❌ → ⚠️
- `Fitur Penjualan hanya reseller`, `Server penuh` ❌ → 🚫 / ⛔
- Prompt input `Masukkan username/masa aktif/nama server baru` ❌ → ✏️
- `Pilih server yang ingin dihapus` ❌ → 🗑️
- Legend `Sudah expired` ❌ → 🔒
- Detail server `Nama Server` bullet ❌ → •

**Batch 5 — permission denials** (`scripts/fix-emoji-admin-5.js`, 13 replace):
- `Menu ini khusus admin` (10 occurrences) ❌ → 🚫
- `Fitur ini hanya untuk Ressel VPN` (3 occurrences) ❌ → 🚫

Side-effect bug yang ketangkep & dibereskan dalam sesi ini:
- 3x `ctx.reply('... *Masukkan ...*, { parse_mode: ... })` kehilangan tanda petik penutup dari rule batch-4 prompt — patched ulang jadi `*Masukkan ...:*'`.
- 1x `ctx.reply('🗑️ *Pilih server yang ingin dihapus:*, {` — patched.

Verifikasi akhir sesi:
- `node --check app.js` → OK
- `node scripts/smoke-audit.js` → SMOKE AUDIT PASSED
- `node --test tests/*.test.js` → 59/59 pass

---

## Status Sekarang

- **Menu user**: sudah rapi semua tampilan (main menu, submenu protocol, trial flow, program reseller, help text).
- **Create akun**: berhasil untuk VMess (ada di log produksi). Protocol lain (VLess/Trojan/SSH/Shadowsocks) perlu test lanjutan.
- **Trial akun**: semua protocol bisa jalan setelah fix `0a8dd52` (dispatcher per-signature).
- **Notif grup**: dibiarkan. User belum add bot ke grup, akan jalan otomatis setelah `GROUP_ID` di-set + bot invited.
- **Menu admin**: sudah di-sweep context-aware (385 → 205 ❌). Sisa 205 = error asli (logger.error, Gagal..., Terjadi kesalahan, validation, permission). Tampilan tombol, bullet, header, prompt, dan status sukses sudah konsisten.

---

## Yang Belum (To-Do Sesi Baru)

### Prioritas A — Fungsional (selain emoji)

1. **Test create akun untuk VLess / Trojan / Shadowsocks** (bukan trial). Signature mismatch yang sama mungkin juga ada di handler `create_*`. Trial sudah di-fix via dispatcher per-type, create mungkin perlu perlakuan sama.
2. **Notif grup setelah `GROUP_ID` di-set**: verify `/testgroup` jalan + notif pembelian muncul di grup.

### Prioritas B — Emoji menu admin

Sudah di-sweep di sesi ini (Batch 1–5). Sisa item kalau mau di-polish manual nanti (skip kalau tidak urgent):
- Beberapa `Terjadi kesalahan saat ...` mungkin bisa dipisah: yang hard error → ❌, yang retry hint → ⚠️.
- Banner `TOPUP MANUAL` / `PENGURANGAN SALDO` belum di-verify screenshot; lihat `notifTopupManualGroup()` dan related.
- `/addhari`, `/kurangihari` success/error response belum di-review ulang emoji (hanya `logger.error`-nya yang sempat disentuh).

---

## Script yang Dipakai

- `scripts/restore-emoji.js` — 80+ rules untuk restore `???` → emoji pertama kali.
- `scripts/fix-emoji-context.js` — context-aware rules untuk `❌` yang salah konteks → emoji yang benar.
- `scripts/fix-emoji-admin-1.js` — batch 1 sesi 13-05-2026: tombol & toggle menu admin.
- `scripts/fix-emoji-admin-2.js` — batch 2 sesi 13-05-2026: success, logger.info, loading states.
- `scripts/fix-emoji-admin-3.js` + `scripts/fix-emoji-admin-3b.js` — batch 3 sesi 13-05-2026: bullets & labels.
- `scripts/fix-emoji-admin-4.js` — batch 4 sesi 13-05-2026: context messages & QRIS/broadcast templates.
- `scripts/fix-emoji-admin-5.js` — batch 5 sesi 13-05-2026: permission denials.

Kedua script bisa di-run ulang. Pattern baru bisa ditambahkan sebagai object `{ re, rep, label }` di array `rules`.

---

## Commits Terkait

- `bbcb2d2` — refactor body function (bug: emoji corrupt jadi `???`)
- `643ec4a` — fix(emoji) restore 1073 dari 1385 `???`
- `276feaa` — fix(emoji) restore sisa 285 `???` (total 99.3%)
- `d041185` — fix(gopay) fallback baseUrl kosong
- `c4d4063` — fix(emoji) menu user: Buat Akun, Trial, Bantuan, Admin status, license, reseller bullets
- `bfa208c` — fix(emoji) context-aware 100+ emoji konteks salah (success/warning/loading/info/bullet)
- `4f9cd1c` — fix(app) tambah `getUserFlagStatus` + `getUsernameById` yang hilang (bot diam saat klik Buat Akun/Trial sebelum pilih server)
- `64b058b` — fix: trial gagal (ressel.db ENOENT tolerant) + emoji log `❌ Transaksi sukses` → `✅`
- `0a8dd52` — fix(trial): dispatcher per-protocol signature (vmess/vless/trojan/shadowsocks bisa trial, bukan cuma ssh)

---

## Verifikasi Cepat

```bash
# Hitung ??? di app.js (seharusnya 10 atau lebih sedikit)
grep -c '???' app.js

# Hitung ? (x merah) di app.js (sisa yang memang konteks error benar)
grep -c '❌' app.js

# Smoke test
node --check app.js && node scripts/smoke-audit.js && node --test tests/*.test.js
```

---

## Deploy Ulang

```bash
cd /root/BotVPN
git fetch --all --prune
git reset --hard origin/main
pm2 restart sellvpn
pm2 logs sellvpn --lines 30
```

Lalu test di Telegram, kirim `/admin` (khusus ID admin) — screenshot / paste teks kalau ada emoji yang salah konteks.
