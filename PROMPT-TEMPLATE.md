# Template Prompt Sesi Baru - Ketantech VPN Bot

Copy salah satu template di bawah untuk memulai sesi chat baru dengan Codex/Kiro.
Semua template mengasumsikan Codex buka folder `F:\2. BotVPN\VPNBOT ASLI\BotVPN`.

---

## Template 1: Lanjut Split app.js (Generic)

```
Halo, kita lanjut refactor split app.js Ketantech VPN Bot.

Status saat ini ada di `SPLIT-ROADMAP.md` di root repo. Tolong:
1. Baca `SPLIT-ROADMAP.md` dulu supaya tahu fase mana yang sudah selesai.
2. Baca "Catatan Sesi Pengerjaan" di atas roadmap biar paham strateginya.
3. Kerjakan **fase berikutnya yang belum selesai** (urut: Fase 3 sisa, 4, 5, 6).
4. Ikuti aturan: satu fase per sesi, verify di tiap langkah (node --check + smoke audit + tests).
5. Setelah selesai: commit + push + update roadmap hash.
```

---

## Template 2: Fase Spesifik

Ganti `FASE_X` dengan nomor fase yang mau dikerjakan.

```
Halo, kita lanjut refactor Ketantech VPN Bot di repo https://github.com/ketanvpn/ketantechvpn

Hari ini saya mau kerjakan Fase X (lihat `SPLIT-ROADMAP.md`).

Aturan main:
- Baca `SPLIT-ROADMAP.md` dulu untuk checklist Fase X.
- Baca "Catatan Sesi Pengerjaan" di roadmap.
- Ekstrak pure function dulu kalau ada, baru stateful (factory pattern).
- Kalau ada sub-item yang coupling-nya terlalu dalam, tandai SKIP di roadmap dengan alasan, lanjut ke sub-item lain. Jangan force.
- Verify tiap langkah: `node --check app.js`, `node scripts/smoke-audit.js`, `node --test tests/*.test.js`.
- Kalau ada bug sintaks, restore dari `app.js.bak` kalau perlu.
- Setelah selesai: commit + push + update roadmap hash + ringkas ke saya.

Mulai dengan scan dulu state repo & roadmap.
```

---

## Template 3: Audit Lanjutan (bukan split)

```
Halo, lanjut audit keamanan Ketantech VPN Bot di https://github.com/ketanvpn/ketantechvpn

Kita sudah selesai 4 paket audit (security, stability, quality, logic). Lihat `SPLIT-ROADMAP.md` bagian "Sudah Selesai (pra-split)".

Tolong audit lebih dalam untuk area berikut (pilih salah satu atau semua):
1. Admin menu handler (potensi privilege escalation?).
2. Broadcast flow (rate limit, race condition session state).
3. Trial flow (cegah abuse reset trial, cek per-user quota).
4. Reseller bonus calculation (rounding error, double grant).
5. Session state in-memory (userState, broadcastSessions, flow) - survive restart?

Kalau nemu finding: prioritize (critical/important/nice), patch yang aman, commit, push.
```

---

## Template 4: Fix Bug Spesifik

```
Halo, ada bug di Ketantech VPN Bot (repo https://github.com/ketanvpn/ketantechvpn).

[DESKRIPSI BUG]
- Apa yang terjadi: ...
- Reproduksi: ...
- Log error (kalau ada): ...
- Frekuensi: selalu / kadang-kadang

Tolong:
1. Cari root cause (bukan surface-level patch).
2. Kalau butuh, tanya dulu kalau ada ambiguitas.
3. Fix + tambah test regression kalau bisa.
4. Commit + push.
```

---

## Template 5: Deploy ke VPS

```
Halo, saya siap deploy Ketantech VPN Bot ke VPS baru.

Repo: https://github.com/ketanvpn/ketantechvpn
Checklist: `DEPLOY.md`

Tolong bantu:
1. Jelaskan langkah deploy satu per satu.
2. Kalau ada error di setiap langkah, bantu debug.
3. Review `.env` isian saya (saya paste, JANGAN tampilkan ulang isinya di response).
4. Saran optimasi PM2 + firewall + backup cron.
```

---

## Tips Umum Saat Sesi Baru

- **Jangan** langsung request "kerjakan semua fase". Satu sesi = satu fase. Bot besar banget.
- **Ingatkan Codex** untuk baca `SPLIT-ROADMAP.md` dulu supaya konteks terpasang.
- **Minta verifikasi** sebelum lanjut: "tunjukkan diff sebelum commit" atau "jalankan test dulu".
- Kalau Codex mulai over-engineer, interrupt dengan: "simplify, fokus pada fase saja".
- Kalau ada file rusak: `git reset --hard HEAD` atau restore dari `app.js.bak` (kalau dibuat).

---

## Command Cepat Buat Cek Status Sendiri

Jalan di PowerShell di folder repo:

```powershell
git log --oneline -15
node --check app.js
node scripts/smoke-audit.js
node --test tests/*.test.js
(Get-Content app.js | Measure-Object -Line).Lines
```

Kalau semua lolos, repo sehat.

---

## Template 6: Lanjut Emoji Cleanup Menu Admin

```
Halo, kita lanjut fix emoji di Ketantech VPN Bot.

Status cleanup sampai sesi kemarin ada di `EMOJI-CLEANUP-PROGRESS.md`.
- Phase 1 + 2 sudah selesai untuk menu USER (komit `bfa208c`).
- Hari ini target: **MENU ADMIN**.

Tolong:
1. Baca `EMOJI-CLEANUP-PROGRESS.md` dulu (terutama section "Yang Belum" di bawah).
2. Scan area admin yang disebut di daftar to-do (admin top-level, reseller submenu, server management, flag user, broadcast, trial config, license, topup manual).
3. Gunakan `scripts/fix-emoji-context.js` pattern yang sudah ada sebagai referensi. Tambah rules baru context-aware.
4. Untuk tiap area:
   - Cari `❌` yang salah konteks (bukan benar-benar error).
   - Cari pattern 'tanpa emoji' di tombol/pesan yang harusnya punya icon.
   - Replace context-aware, jangan global replace buta.
5. Verify tiap beberapa rule:
   - `node --check app.js`
   - `node scripts/smoke-audit.js`
   - `node --test tests/*.test.js`
6. Commit + push batch per area (mis. "fix(emoji-admin): reseller submenu", "fix(emoji-admin): server management").
7. Update `EMOJI-CLEANUP-PROGRESS.md` dengan area yang sudah di-cover di sesi ini.

Aturan penting:
- Satu area (mis. admin server management) = satu commit. Gampang revert kalau rusak.
- Jangan ubah struktur callback_data atau callback handler name. Cuma ubah `text:` / template string yang visible.
- Kalau ragu emoji yang tepat, tanya saya dulu dengan context line-nya.

Mulai dari: admin top-level (tombol `/admin` + submenu MENU ADMIN).
```

---
