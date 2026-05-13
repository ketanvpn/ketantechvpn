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

## Status Sekarang

- **Menu user**: sudah rapi semua tampilan (main menu, submenu protocol, trial flow, program reseller, help text).
- **Create akun**: berhasil untuk VMess (ada di log produksi). Protocol lain (VLess/Trojan/SSH/Shadowsocks) perlu test lanjutan.
- **Trial akun**: semua protocol bisa jalan setelah fix `0a8dd52` (dispatcher per-signature).
- **Notif grup**: dibiarkan. User belum add bot ke grup, akan jalan otomatis setelah `GROUP_ID` di-set + bot invited.
- **Menu admin**: belum di-scan ulang. Kemungkinan masih ada banyak ❌ yang salah konteks + emoji aneh di template seperti notifikasi broadcast summary, management server prompts, reseller target menu, dll.

---

## Yang Belum (To-Do Sesi Baru)

### Prioritas A — Fungsional (selain emoji)

1. **Test create akun untuk VLess / Trojan / Shadowsocks** (bukan trial). Signature mismatch yang sama mungkin juga ada di handler `create_*`. Trial sudah di-fix via dispatcher per-type, create mungkin perlu perlakuan sama.
2. **Notif grup setelah `GROUP_ID` di-set**: verify `/testgroup` jalan + notif pembelian muncul di grup.

### Prioritas B — Emoji menu admin

1. **Menu admin top-level**: `/admin` atau tombol `⚙️ MENU ADMIN`. Cek tombol-tombol utama (Menu Reseller, Monitor User, List Semua User, Tandai User, Backup Database, Auto Backup, Timezone, Upload QRIS, Kirim Pengumuman, Template Promosi).
2. **Submenu Admin Reseller**: `🧾 Menu Reseller & Saldo` → Target Reseller, Bonus Reseller Aktif, Tambah Saldo, Riwayat Saldo, List Reseller/Member, Upload QRIS.
3. **Admin Server management**: `🗑️ MANAGEMEN SERVER` → List Server, Tambah Server, Detail Server, Delete Server, edit harga/nama/auth/quota/iplimit/batas_create/total_create. Prompt input (`🌐 Masukkan domain`, `✏️ Silakan masukkan...`).
4. **Admin Flag User**: `🚩 Tandai User` flow, status `⚠️ WATCHLIST` / `⛔ NAKAL` / `👤 Member`.
5. **Broadcast flow** (template manual, maintenance VPN, promo diskon): preview + confirm + summary terkirim.
6. **Trial admin config menu**: toggle on/off, max per hari, durationHours, minBalance, save config.
7. **License admin** (`/addhari`, `/kurangihari`): success/error message.
8. **Topup manual admin** (tambah/kurang saldo user): success message + banner TOPUP MANUAL / PENGURANGAN SALDO.

---

## Script yang Dipakai

- `scripts/restore-emoji.js` — 80+ rules untuk restore `???` → emoji pertama kali.
- `scripts/fix-emoji-context.js` — context-aware rules untuk `❌` yang salah konteks → emoji yang benar.

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
