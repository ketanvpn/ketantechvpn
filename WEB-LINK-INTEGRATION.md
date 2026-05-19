# Web Link Integration — Bot VPN ↔ ketantech.my.id

Dokumentasi lengkap integrasi BotVPN (Telegram) dengan web ketantech.my.id.
Dipakai sebagai **single reference document** untuk maintain / debug / lanjut development.

> **Konteks:** Chat AI (Cline) yang me-rancang & implement integrasi ini sudah
> "terlalu berat" — context window penuh setelah 14 commit. File ini di-buat
> untuk dipakai di chat baru: tinggal share path file ini ke AI, dia langsung
> paham konteks lengkap tanpa harus dijelasin ulang.

---

## 📑 Daftar Isi

1. [Quick Start](#1-quick-start)
2. [Architecture Overview](#2-architecture-overview)
3. [Konfigurasi (Env Vars)](#3-konfigurasi-env-vars)
4. [Schema DB Tambahan](#4-schema-db-tambahan)
5. [Endpoint API Web yang Dipakai Bot](#5-endpoint-api-web-yang-dipakai-bot)
6. [Flow Diagram Per Fitur](#6-flow-diagram-per-fitur)
7. [File-File yang Berubah](#7-file-file-yang-berubah)
8. [Daftar 14 Commit](#8-daftar-14-commit)
9. [Troubleshooting Umum](#9-troubleshooting-umum)
10. [Security Checklist](#10-security-checklist)
11. [Test Checklist Setelah Deploy](#11-test-checklist-setelah-deploy)
12. [Cara Setup di VPS Baru](#12-cara-setup-di-vps-baru)
13. [Catatan untuk Developer Berikutnya](#13-catatan-untuk-developer-berikutnya)

---

## 1. Quick Start

### Untuk admin yang baru deploy

```bash
# Di VPS bot
cd ~/BotVPN
git pull origin main
nano .vars.json   # isi WEB_* (lihat section 3)
pm2 restart all
```

### Untuk admin yang baru pindah VPS tanpa pakai web

```bash
git clone https://github.com/ketanvpn/ketantechvpn.git
cd ketantechvpn
cp .vars.example.json .vars.json
nano .vars.json   # isi BOT_TOKEN, MASTER_ID, dll. SKIP semua WEB_*
npm install
pm2 start ecosystem.config.js
```

Tidak akan error. `WEB_LINK_ENABLED` default `false` → fitur web-link otomatis OFF, bot jalan standalone seperti versi sebelum integrasi.

---

## 2. Architecture Overview

```
┌────────────────────────┐                ┌─────────────────────────┐
│   Telegram User        │                │   Browser User          │
└────────────┬───────────┘                └────────────┬────────────┘
             │                                          │
             ▼                                          ▼
┌────────────────────────┐  X-Bot-API-Key  ┌─────────────────────────┐
│   Bot VPN (BotVPN)     │ ──────────────► │   Web ketantech.my.id   │
│   - Telegraf           │                  │   - Express (api-server)│
│   - SQLite (sellvpn.db)│ ◄────────────── │   - Postgres            │
└────────────────────────┘   JSON          └─────────────────────────┘
             │                                          │
             ▼                                          ▼
   ┌──────────────────┐                       ┌──────────────────┐
   │  users.saldo     │                       │  users.balance   │
   │  (linked: 0)     │                       │  (single source) │
   └──────────────────┘                       └──────────────────┘
```

**Kunci desain:**

- **Single source of truth = saldo web**, untuk user yang sudah link
- **Backward compat**: user belum link tetap pakai SQLite (legacy, behavior tidak berubah)
- **Master switch**: `WEB_LINK_ENABLED` di `.vars.json` — kalau `false`, integrasi seluruhnya OFF
- **Two-token separation**: bot ini punya 2 jenis link Telegram terpisah:
  - `users.telegram_id` (web side) → Bot Notifikasi (notif order/topup, bot lain)
  - `users.vpn_telegram_id` (web side) → Bot VPN ini (akun shared)

---

## 3. Konfigurasi (Env Vars)

### Sisi Bot (`.vars.json` di BotVPN)

| Key | Default | Wajib | Keterangan |
|-----|---------|-------|------------|
| `WEB_LINK_ENABLED` | `false` | Tidak | Master switch. Set `true` untuk aktifkan integrasi |
| `WEB_API_BASE_URL` | (kosong) | Ya kalau enabled | Mis. `https://ketantech.my.id/api` |
| `WEB_DOMAIN` | (kosong) | Tidak | Mis. `https://ketantech.my.id` (untuk pesan ke user) |
| `WEB_API_BOT_KEY` | (kosong) | Ya kalau enabled | Shared secret dengan web. Harus sama persis |
| `WEB_API_TIMEOUT_MS` | `15000` | Tidak | Timeout HTTP ke web (ms) |

**Default behavior kalau key kosong:** fitur otomatis OFF, bot fallback ke SQLite legacy.

### Sisi Web (`ecosystem.config.cjs` di project web)

| Key | Default | Wajib | Keterangan |
|-----|---------|-------|------------|
| `BOT_API_KEY` | (kosong) | Ya | Sama dengan `WEB_API_BOT_KEY` di bot |
| `BOT_VPN_USERNAME` | `panelketan_bot` | Tidak | Username Bot VPN (untuk URL `t.me/<bot>?start=link_<token>`) |

⚠️ **PENTING**: api-server **tidak load `dotenv`**. Env harus di-set di `ecosystem.config.cjs`, **bukan** `.env` file. Setelah ubah, restart pakai:
```bash
pm2 delete ketantech-api && pm2 start ecosystem.config.cjs && pm2 save
```
**Bukan** `pm2 restart --update-env` karena flag itu tidak fully apply env baru di edge case ini.

---

## 4. Schema DB Tambahan

### Sisi Bot (SQLite, table `users`)

| Kolom | Tipe | Default | Keterangan |
|-------|------|---------|------------|
| `web_user_id` | INTEGER | NULL | ID user di DB web. Kalau NULL = belum link |
| `web_linked_at` | INTEGER | NULL | Unix timestamp ms saat first link |

Migration: di `db/migrations.js` via `ensureSqliteColumn` — **idempotent**, aman dijalankan berulang.

### Sisi Web (Postgres, table `users`)

| Kolom | Tipe | Default | Keterangan |
|-------|------|---------|------------|
| `vpn_telegram_id` | BIGINT | NULL | Telegram ID user yang sudah link ke Bot VPN |
| `vpn_telegram_link_token` | TEXT | NULL | Token sekali pakai untuk verify link |

Migration: lewat Drizzle ORM. Kalau `pnpm db:push` ke-skip karena prompt interaktif, jalankan manual:
```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS vpn_telegram_id BIGINT,
  ADD COLUMN IF NOT EXISTS vpn_telegram_link_token TEXT;
```

⚠️ **Kolom `telegram_id` & `telegram_link_token`** (tanpa prefix `vpn_`) tetap dipertahankan untuk Bot Notifikasi (tidak boleh di-touch).

---

## 5. Endpoint API Web yang Dipakai Bot

Semua endpoint khusus bot diproteksi dengan header `X-Bot-API-Key`. Endpoint user-facing pakai cookie session web.

### Group A: Endpoint USER (auth cookie session)

Dipakai oleh halaman Profile web saat user klik "Hubungkan ke Bot VPN".

| Method | Path | Body / Query | Response |
|--------|------|--------------|----------|
| `POST` | `/api/telegram/vpn-link` | (kosong) | `{ token, botUsername, url }` |
| `DELETE` | `/api/telegram/vpn-link` | (kosong) | `{ ok: true }` |

### Group B: Endpoint BOT (auth `X-Bot-API-Key`)

Dipakai oleh `modules/web-api-client.js` di bot.

| Method | Path | Body / Query | Response | Idempotent |
|--------|------|--------------|----------|------------|
| `POST` | `/api/telegram/verify-link-token` | `{ token, telegramId }` | `{ ok, user: {...} }` | Token sekali pakai |
| `GET` | `/api/telegram/user-by-tgid/:telegramId` | — | `{ user: {...} }` | Read-only |
| `GET` | `/api/telegram/balance/:telegramId` | — | `{ balance, pendingTopup }` | Read-only |
| `POST` | `/api/telegram/credit` | `{ telegramId, amount, description, refId }` | `{ ok, applied, newBalance }` | ✅ via `refId` |
| `POST` | `/api/telegram/debit` | `{ telegramId, amount, description, refId }` | `{ ok, applied, newBalance }` atau 400 + `newBalance` | ✅ via `refId` |
| `POST` | `/api/telegram/unlink` | `{ telegramId }` | `{ ok: true }` | — |

**Idempotency `refId`:** server cek di `balance_logs.description` dengan pattern `[refId:<x>]`. Kalau sudah ada → response `applied: false` (tidak double-credit/debit).

**Refund:** tidak ada endpoint terpisah. Refund pakai `/api/telegram/credit` dengan `description: "Refund ..."`.

---

## 6. Flow Diagram Per Fitur

### A. Link Akun (First Time)

```
User klik "Hubungkan ke Bot VPN" di web Profile
  ▼
Web POST /api/telegram/vpn-link → token + URL t.me/<bot>?start=link_<token>
  ▼
User klik URL → Telegram buka bot dengan /start link_<token>
  ▼
Bot handler /start: deteksi prefix "link_" → handleWebLinkToken(ctx, token)
  ▼
Bot POST /api/telegram/verify-link-token { token, telegramId }
  ▼
Web validasi token, set users.vpn_telegram_id, return user info + balance
  ▼
Bot UPDATE users SET web_user_id = ?, web_linked_at = ?
  ▼
[FIRST LINK] Cek SQLite saldo > 0?
  ├── Ya → POST /credit (refId=migrate_telegram_<userId>)
  │         → web.balance += saldo SQLite
  │         → SQLite saldo set 0
  │         → tx log type='web_link_migration'
  └── Tidak → skip migrate
  ▼
Bot kirim "🎉 Akun web kamu berhasil terhubung!" + saldo + tombol
```

### B. Beli Akun Reguler (handler `exp_*`)

```
User pilih server, username, masukkan jumlah hari
  ▼
Pre-check saldo: getUserSaldo(db, userId) ← AWARE-LINK
  ├── Linked → fetch GET /balance/<tgId> → web saldo
  └── Non-linked → SELECT saldo FROM users SQLite
  ▼
Saldo cukup?
  ├── Tidak → reply "Saldo tidak cukup"
  └── Ya → lanjut
  ▼
processAccountPayment(...) ← AWARE-LINK
  ├── Linked → POST /debit (refId='buy-<server>-<user>-<ts>')
  │            → kalau 400 → throw "Saldo tidak cukup"
  │            → kalau 5xx/network → throw, JANGAN fallback (saldo SQLite=0)
  └── Non-linked → BEGIN TRX → UPDATE saldo - amount → INSERT transactions → COMMIT
  ▼
createvmess() / createssh() / dst → buat akun di server VPN
  ├── Sukses → upsertAccount() di SQLite, kirim config ke user, notif grup
  └── Gagal → refundAccountPayment() ← AWARE-LINK
              ├── Linked → POST /credit (refId='refund-...') 
              └── Non-linked → UPDATE saldo + amount
```

### C. Topup QRIS Otomatis

```
User klik "TopUp Saldo (QRIS Otomatis)" → input nominal → konfirmasi
  ▼
Bot generate invoice QRIS, simpan ke qris_payments status='pending'
  ▼
User scan QR & bayar
  ▼
Background poller (qrisPaymentPoller, interval 15s):
  ├── Ambil transaksi dari GoPay
  ├── Match dengan qris_payments pending
  └── Jika match → finalizeQrisPayment(...)
  ▼
finalizeQrisPayment ← AWARE-LINK
  ├── Cek getUserLinkInfo(userId)
  ├── Linked path:
  │   1. POST /credit (refId='qris_<invoiceId>')
  │   2. Web sukses → UPDATE qris_payments=paid + INSERT transactions audit
  │   3. Web gagal → throw → invoice tetap pending → poller retry next loop
  │   4. Edge: web sukses tapi audit SQLite gagal → log CRITICAL
  └── Non-linked path:
      BEGIN TRX → UPDATE qris_payments=paid → UPDATE saldo += amount → 
      INSERT transactions → COMMIT
  ▼
applyQrisTopupBonus(userId, invoiceId, bonus) ← AWARE-LINK
  ├── Linked → POST /credit (refId='qris_bonus_<invoiceId>')
  └── Non-linked → UPDATE saldo += bonus
  ▼
notifyTopupSuccess(...) → kirim notif ke user + grup
```

### D. Admin /addsaldo

```
Admin command: /addsaldo <user_id> <amount>
  ▼
Hitung bonus tier (sama persis untuk linked & non-linked)
  ▼
Cek getUserLinkInfo(targetId)
  ├── Linked path:
  │   1. POST /credit (refId='addsaldo_admin_<adminId>_<targetId>_<ts>')
  │   2. Sukses → record di transactions SQLite type='manual_addsaldo_web'
  │   3. Notif admin/user/grup pakai newBalance dari response web (label '🌐')
  │   4. Gagal → JANGAN fallback ke SQLite (tampilkan error)
  └── Non-linked path:
      UPDATE saldo += totalCredit → record type='manual_addsaldo' → notif
```

---

## 7. File-File yang Berubah

### Bot VPN (BotVPN repo `ketanvpn/ketantechvpn`)

| File | Sesi | Perubahan |
|------|------|-----------|
| `.vars.example.json` | 1 | Tambah `WEB_*` config keys |
| `db/migrations.js` | 1 | Migration kolom `web_user_id`, `web_linked_at` |
| `modules/web-api-client.js` | 1, 3 | Factory HTTP client. Method: `verifyLinkToken`, `getUserByTelegramId`, `getBalanceByTelegramId`, `unlinkTelegram`, `creditBalance`, `debitBalance` |
| `accounts/service.js` | 4 | `createAccountService` aware-link: `getUserSaldo`, `processAccountPayment`, `refundAccountPayment` cek `web_user_id` |
| `app.js` | Banyak | Init `webApiClient`, helper `getUserLinkInfo`, handler `/start link_*`, tombol `web_link_menu`, `sendMainMenu` aware-link, `finalizeQrisPayment`, `applyQrisTopupBonus`, `/addsaldo` |
| `modules/edukasi.js` | 5d | `getUserSaldoOrZero` delegasi ke `accountService.getUserSaldo` |

### Web (webvpn repo)

| File | Sesi | Perubahan |
|------|------|-----------|
| `lib/db/src/schema/users.ts` | 2, 3 | Kolom `vpnTelegramId`, `vpnTelegramLinkToken` |
| `artifacts/api-server/src/middlewares/bot-auth-key.ts` | 2 | Middleware verify `X-Bot-API-Key` header, return 503 kalau env kosong |
| `artifacts/api-server/src/routes/telegram-bot-api.ts` | 2, 3 | 6 endpoint: vpn-link, verify-link-token, user-by-tgid, balance, credit, debit, unlink |
| `artifacts/api-server/src/routes/index.ts` | 2 | Register route |
| `artifacts/api-server/src/routes/auth.ts` | 3 | Update query select untuk kolom baru |
| `artifacts/vpn-web/src/pages/user/profile.tsx` | 2 | Card "Akun Bot VPN" + tombol generate URL link |

---

## 8. Daftar 14 Commit

Repo `ketanvpn/ketantechvpn` (BotVPN), urut dari yang paling lama:

| # | Hash | Pesan | Sesi |
|---|------|-------|------|
| 1 | `9b24df0` | feat(web-link): infrastruktur OPSI B - link akun bot Telegram ke web ketantech.my.id | 1 |
| 2 | `3ddac6a` | feat(web-link): migrate saldo SQLite ke web saat first link (OPSI 1) | 3 |
| 3 | `e770bcb` | feat(web-link): bot pakai saldo web sebagai single source of truth saat user linked | 4 |
| 4 | `93690c5` | fix(buy): pre-check saldo pakai getUserSaldo() aware-link, bukan SQLite langsung | 5a |
| 5 | `56ad1f4` | fix(buy): tambah () di async IIFE handler exp_* supaya alur beli akun jalan | 5c |
| 6 | `03af8bb` | fix(edukasi): pre-check saldo pakai accountService.getUserSaldo (aware-link) | 5d |
| 7 | `4b1f35c` | feat(addsaldo): aware-link - kalau user linked push saldo ke web (OPSI A) | 5b |
| 8 | `fc4a8a0` | feat(qris): topup auto QRIS aware-link - kalau user linked saldo masuk ke web (OPSI A) | 5e |

Repo webvpn (web ketantech.my.id):
- `3183ba3` (Sesi 2): bot-auth-key middleware + 4 endpoint awal
- `db60556` (Sesi 3): pisahkan kolom vpnTelegramId dari telegramId
- `bf02c1b` (Sesi 3): tambah endpoint credit & debit dengan idempotency

---

## 9. Troubleshooting Umum

### Issue 1: "503 BOT_API_KEY belum dikonfigurasi di server"

**Gejala:** `curl https://ketantech.my.id/api/telegram/balance/<id>` return 503.

**Penyebab:** api-server tidak load dotenv, env-nya hanya dibaca dari `process.env` saat startup.

**Fix:**
1. Edit `/var/www/ketantech-vpn/ecosystem.config.cjs`, pastikan `env: { BOT_API_KEY: "...", BOT_VPN_USERNAME: "panelketan_bot" }`
2. Full reload (BUKAN `pm2 restart`):
   ```bash
   pm2 delete ketantech-api
   pm2 start ecosystem.config.cjs
   pm2 save
   ```
3. Test: `curl -i -H "X-Bot-API-Key: WRONG" https://ketantech.my.id/api/telegram/balance/12345`
4. Harus dapat **401 "Invalid bot API key"** (bukan 503)

### Issue 2: "Saldo tidak cukup" untuk user linked padahal saldo web ada

**Penyebab:** ada spot di kode yang query `SELECT saldo FROM users` SQLite langsung, bukan via `getUserSaldo()` aware-link.

**Cara cek:** `findstr /S /N /C:"SELECT saldo" *.js`

**Fix:** ganti dengan `await getUserSaldo(db, userId)` atau `await accountService.getUserSaldo(userId)`.

Sudah di-fix di:
- `app.js` line 11622 (handler beli akun reguler) — commit `93690c5`
- `modules/edukasi.js` line 206 (helper `getUserSaldoOrZero`) — commit `03af8bb`

### Issue 3: Bot diam total setelah user kirim angka hari

**Penyebab:** async IIFE didefinisikan tanpa `()` di akhir, jadi function tidak pernah dipanggil.

```js
await (async () => { ... });   // ❌ tidak dipanggil
await (async () => { ... })();  // ✅ benar
```

Fix: commit `56ad1f4`.

### Issue 4: Saldo "terjebak" — user bayar QRIS sukses tapi saldo bot tetap 0

**Penyebab:** `finalizeQrisPayment` selalu update SQLite, tidak aware-link.

**Fix:** commit `fc4a8a0`. Sekarang aware-link.

### Issue 5: `pnpm db:push` ke-skip saat deploy web

**Penyebab:** Drizzle Kit minta konfirmasi interaktif `(y/N)`, default ke N saat non-TTY.

**Fix opsi 1:** pakai `--force`:
```bash
pnpm --filter @workspace/db run push --force
```

**Fix opsi 2 (lebih aman):** generate migration file dulu di local, apply via `migrate`:
```bash
# di local
pnpm --filter @workspace/db drizzle-kit generate
git add lib/db/drizzle/ && git commit -m "migration"

# di VPS
pnpm --filter @workspace/db drizzle-kit migrate
```

**Fix opsi 3 (manual SQL kalau urgent):**
```bash
sudo -u postgres psql -d ketantech_db -c "ALTER TABLE users ADD COLUMN IF NOT EXISTS vpn_telegram_id BIGINT, ADD COLUMN IF NOT EXISTS vpn_telegram_link_token TEXT;"
```

### Issue 6: Refund web gagal — saldo "hilang"

**Penyebab:** kalau provisioning akun gagal & refund credit ke web juga gagal (network error), saldo user ter-debit tapi tidak refund.

**Mitigasi:** `refundAccountPayment` log CRITICAL ke `bot-error.log`. Admin harus refund manual via:
```bash
curl -X POST https://ketantech.my.id/api/telegram/credit \
  -H "X-Bot-API-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"telegramId":<tgid>,"amount":<rp>,"description":"Refund manual","refId":"manual_refund_<unique>"}'
```

---

## 10. Security Checklist

⚠️ **WAJIB DILAKUKAN** karena production secrets sempat ke-paste di chat AI:

- [ ] Rotate `BOT_API_KEY`
  - Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  - Update di `ecosystem.config.cjs` (web) + `.vars.json` field `WEB_API_BOT_KEY` (bot) — harus sama persis
  - `pm2 delete ketantech-api && pm2 start ecosystem.config.cjs && pm2 save` di VPS web
  - `pm2 restart all` di VPS bot
- [ ] Rotate `DATABASE_URL` password
  - `ALTER USER ketantech WITH PASSWORD '<baru>';` di Postgres
  - Update di `ecosystem.config.cjs` field `DATABASE_URL`
  - Full reload pm2
- [ ] Rotate `SESSION_SECRET`
  - ⚠️ Akan invalidate semua sesi user existing (semua harus login ulang)
  - Update di `ecosystem.config.cjs`
  - Full reload pm2
- [ ] Rotate `TURNSTILE_SECRET_KEY`
  - Dari dashboard Cloudflare Turnstile
  - Update di `ecosystem.config.cjs`
  - Full reload pm2

---

## 11. Test Checklist Setelah Deploy

### A. User non-linked (untuk pastikan tidak break behavior lama)
- [ ] `/start` → tampil saldo tanpa label `🌐`
- [ ] Beli akun reguler → saldo SQLite kepotong
- [ ] Topup QRIS otomatis → saldo SQLite naik
- [ ] Trial akun → counter naik

### B. User linked
- [ ] `/start` → tampil saldo dari web dengan label `🌐`
- [ ] Beli akun reguler → saldo web kepotong (cek di Profile web)
- [ ] Beli paket Edukasi → saldo web kepotong
- [ ] Topup QRIS otomatis → saldo web naik
- [ ] `/addsaldo <user_id> <amount>` admin → saldo web naik (bukan SQLite)

### C. Edge cases
- [ ] Putuskan koneksi (`web_link_unlink`) → user kembali ke saldo SQLite (lokal)
- [ ] Re-link user yang pernah unlink → tidak migrate ulang (idempotent)
- [ ] Curl `/credit` 2x dengan refId sama → response kedua `applied: false`

---

## 12. Cara Setup di VPS Baru

### Skenario A: Pakai integrasi web (full setup)

**Prasyarat:**
- VPS bot (Node.js + SQLite)
- VPS web yang sudah running ketantech.my.id

**Langkah:**
```bash
# Di VPS bot
cd ~
git clone https://github.com/ketanvpn/ketantechvpn.git BotVPN
cd BotVPN
cp .vars.example.json .vars.json
nano .vars.json
```

Isi minimal di `.vars.json`:
```json
{
  "BOT_TOKEN": "...",
  "MASTER_ID": "...",
  "ADMIN_IDS": "...",
  "GROUP_ID": "...",

  "WEB_LINK_ENABLED": true,
  "WEB_API_BASE_URL": "https://ketantech.my.id/api",
  "WEB_DOMAIN": "https://ketantech.my.id",
  "WEB_API_BOT_KEY": "<hex 32 byte yang sama dengan BOT_API_KEY di web>",
  "WEB_API_TIMEOUT_MS": 15000
}
```

```bash
npm install
pm2 start ecosystem.config.js
pm2 save
```

Verifikasi:
```bash
curl -i -H "X-Bot-API-Key: WRONG" https://ketantech.my.id/api/telegram/balance/12345
# Harus 401, bukan 503
```

### Skenario B: Standalone tanpa web

```bash
git clone https://github.com/ketanvpn/ketantechvpn.git BotVPN
cd BotVPN
cp .vars.example.json .vars.json
nano .vars.json
```

Isi `.vars.json` **tanpa key WEB_***:
```json
{
  "BOT_TOKEN": "...",
  "MASTER_ID": "...",
  "ADMIN_IDS": "...",
  "GROUP_ID": "..."
}
```

```bash
npm install
pm2 start ecosystem.config.js
pm2 save
```

Bot akan jalan 100% offline dari web. Tombol "Hubungkan ke Web" tidak muncul.

---

## 13. Catatan untuk Developer Berikutnya

### Pattern aware-link yang konsisten

Setiap kali ada operasi saldo baru, pakai pattern ini:

```js
async function someBalanceOperation(userId, amount, ...) {
  // Cek apakah user linked
  let linkedToWeb = false;
  try {
    if (isWebLinkEnabled()) {
      const linkInfo = await getUserLinkInfo(userId);
      if (linkInfo && linkInfo.web_user_id) linkedToWeb = true;
    }
  } catch (e) {
    logger.warn('aware-link check error: ' + (e.message || e));
    linkedToWeb = false;
  }

  if (linkedToWeb) {
    // PATH WEB: panggil webApiClient.creditBalance / debitBalance
    // dengan refId pattern unik untuk operasi ini (idempotent)
    try {
      const res = await webApiClient.debitBalance({
        telegramId: userId,
        amount,
        description: '...',
        refId: `<operation>_<context>_<id>_<ts>`,
      });
      if (!res.ok) throw new Error('...');
      // Audit di SQLite (transactions table) supaya admin lihat history
    } catch (e) {
      // JANGAN fallback ke SQLite untuk linked user — saldo SQLite = 0
      throw e;
    }
  } else {
    // PATH SQLITE: kode lama, tidak perlu diubah
    // BEGIN TRX → UPDATE saldo → INSERT transactions → COMMIT
  }
}
```

### Pattern refId untuk idempotency

Format: `<operation>_<context>_<unique>`

| Operasi | Pattern refId | Contoh |
|---------|---------------|--------|
| Migrate saldo | `migrate_telegram_<userId>` | `migrate_telegram_690744680` |
| Beli akun | `buy-<serverId>-<username>-<ts>` | `buy-1-user01-1736200000000` |
| Refund | `refund-<serverId>-<username>-<ts>` | `refund-1-user01-1736200000000` |
| Edukasi buy | `buy-0-<username>-<ts>` (serverId 0) | `buy-0-user01-1736200000000` |
| /addsaldo admin | `addsaldo_admin_<adminId>_<targetId>_<ts>` | `addsaldo_admin_111_222_1736...` |
| QRIS topup | `qris_<invoiceId>` | `qris_INV1234567` |
| QRIS bonus | `qris_bonus_<invoiceId>` | `qris_bonus_INV1234567` |
| Manual refund | `manual_refund_<unique>` | `manual_refund_admin_xyz` |

### Gotcha yang harus diingat

1. **api-server tidak pakai dotenv** — env harus via `ecosystem.config.cjs`, bukan `.env`. `pm2 restart --update-env` tidak cukup, harus `delete + start`.

2. **Smoke test cuma cek syntax + boot**, tidak simulate full flow. Bug regression bisa lolos kalau IIFE/closure tidak benar (lihat issue 3 di section troubleshooting).

3. **Drizzle ORM `db:push` interaktif** — saat deploy non-TTY, default ke `N` (skip migration). Pakai `--force` atau migration file.

4. **`processAccountPayment` untuk linked user TIDAK fallback ke SQLite** kalau API web error, karena saldo SQLite = 0 (akan tampak "saldo cukup" tapi user tidak punya saldo asli). Lebih baik tolak transaksi & user retry.

5. **Bot Notifikasi vs Bot VPN** — beda kolom DB di sisi web. Jangan pakai `telegramId` (untuk Bot Notifikasi); harus `vpnTelegramId` (untuk Bot VPN).

6. **`isWebLinkEnabled()` adalah master switch**. Kalau `false`, fungsi `getUserLinkInfo` tetap bisa dipanggil tapi `_resolveLink` di account service akan return null (treat as non-linked).

### Roadmap potensial (kalau mau lanjut develop)

- **Tier bonus reseller bulanan** — sekarang masih SQLite-only. Belum diadaptasi aware-link.
- **Notif topup web → bot** — kalau user topup di web (via QRIS web), bot tidak otomatis kirim notif Telegram. Bisa pakai webhook dari web ke bot.
- **Dashboard admin web** untuk monitor link akun — sekarang admin lihat dari bot saja.
- **Auto-rotate `BOT_API_KEY`** — feature toggle untuk auto-rotate per N hari.

---

## 📞 Reference Cepat

- Repo bot: https://github.com/ketanvpn/ketantechvpn (commit terakhir integrasi: `fc4a8a0`)
- Repo web: (private)
- Dokumentasi ini: `/WEB-LINK-INTEGRATION.md` di repo bot
- Migration notes lain: `/MIGRATION-NOTES.md`

---

_Dokumen ini di-buat 19 Mei 2026 setelah integrasi 14 commit BotVPN + 4 commit webvpn selesai. Update kalau ada perubahan major._
