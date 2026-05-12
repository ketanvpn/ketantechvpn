# Roadmap Split `app.js` Ketantech VPN Bot

Catatan pengerjaan split `app.js` secara bertahap. Tujuan akhir: memecah file 13.600+ baris jadi modul-modul per-domain supaya gampang di-maintain dan di-test.

Status keseluruhan: **4/6 fase selesai (Fase 5 parsial 2/6 sub)**

---

## Catatan Sesi Pengerjaan

Refactor Fase 4/5/6 punya **deep coupling** dengan global state (`bot`, `db`, `vars`, `global.*`, closure `notifyTopupSuccess`, `calculateTopupBonus`, dll). Supaya aman:

- **Satu fase per sesi chat**. Kalau dipaksa dalam satu sesi, rawan bug karena factory parameter meledak.
- **Strategi per fase**: 1) Petakan dependency closure dulu, 2) Ekstrak **helper pure** dulu (target ke `lib/` kalau mungkin), 3) Ekstrak stateful ke factory terakhir.
- Kalau mentok (coupling terlalu dalam), **tandai sub-item sebagai SKIP** dengan alasan, lanjut ke sub-item lain. Jangan force.
- Setelah tiap fase, wajib verify: `node --check app.js`, smoke audit, tests pass, dan **bot bisa boot tanpa error** (minimal manual test).

---

## Panduan Menandai Selesai
- Centang `[x]` kalau fase/sub-item sudah dikerjakan, di-commit, dan di-push.
- Update baris **Commit** dengan hash commit aktual.
- Update **Status keseluruhan** di atas.
- Jangan skip urutan fase: tiap fase mengasumsikan fase sebelumnya sudah stabil.

---

## Sudah Selesai (pra-split)

- [x] **Paket 1 Security Critical** - `33ca7c2`
  - Eliminate `exec(curl)` di 6 modul (create, trial, del, lock, unlock, renew), ganti ke `axios`.
  - Bind `app.listen` ke `127.0.0.1` (HTTP_BIND env).
  - Validasi input user (username, password, exp, iplimit, quota).
  - Fix bug shadowsocks `vmessData` → `shadowsocksData`.
- [x] **Paket 2 Stability** - `6d0548d`
  - Pending deposit restore lengkap dari DB (expiresAt, adminFee, auto-expire).
  - `findAvailableTopupAmount` collision guard (retry 10x).
  - Index SQLite baru untuk query polling sering dipakai.
  - Helper `htmlEscape` di `app.js` + pakai di notif grup.
  - `modules/http-client.js` axios retry wrapper (backoff exponential).
- [x] **Paket 3 Quality** - `ca360b7`
  - Logger auto-mask secrets (BOT_TOKEN, Authorization, api key, password).
  - Ekstrak helper ke `lib/` (html, validators, bonus).
  - 18 unit test dengan `node:test` (built-in).
  - GitHub Actions CI: matrix Node 20.x/22.x.
- [x] **Paket 4 Logic Audit** - `fa287b8`
  - `findMatchingSettlementTransaction`: time-window guard (±5 menit sebelum, ±60 menit sesudah).
  - `checkQrisInvoiceStatus`: grace period 2 menit sebelum mark EXPIRED.
  - `pollQrisPaymentsStartup`: guard stuck >90 detik, auto-reset flag.
  - Daily report + expiry reminder persist `lastDateKey` ke `.vars.json`.

---

## Fase 1 - Ekstrak Helper Pure (LOW RISK) - SELESAI

**Target:** keluarkan ~500 baris ke `lib/`. No runtime behavior change.

**Commit:** `c9484f4`

**Checklist:**
- [x] `lib/qris.js`: `crc16Ccitt`, `removeTag54`, `buildEmvTag`, `buildDynamicQrisPayload`, `buildStaticQrisImageUrl`, `parseProviderTransactionTime`, `buildProviderTransactionFingerprint`, `findMatchingSettlementTransaction`
- [x] `lib/licence.js`: `getLicenseInfo` (note: `setLicenseExpireDate` tetap di `app.js` karena mutate `vars`)
- [x] `lib/masker.js`: `maskLogMessage`, `maskToken`
- [x] `lib/time.js`: `getTimeInConfiguredTimeZone`, `getAccountDaysLeft`, `getMonthRange`, `typeCode`, `shortStatus`
- [x] Update `app.js` untuk `require('./lib/*')` dan hapus definisi lama (tambah wrapper thin untuk inject `TIME_ZONE`/`EXPIRE_DATE`).
- [x] Tambah unit test: qris (11), time (7), masker (6), licence (4) = 28 test baru (total 46).
- [x] `node --check`, smoke audit, tests, commit, push.

**Catatan:**
- Fungsi yang di-extract harus PURE (tidak akses `db`/`vars`/`logger` lewat closure). Kalau butuh, pass sebagai parameter.
- `getLicenseInfo` butuh `EXPIRE_DATE` — pass dari luar, jangan import dari app.js.
- `findMatchingSettlementTransaction` sekarang panggil `parseProviderTransactionTime` lokal — kedua fn harus di-extract bersamaan.

---

## Fase 2 - Ekstrak DB Setup + Migrasi (LOW-MEDIUM RISK) - SELESAI

**Target:** ~800 baris ke `db/`. Tetap satu connection SQLite.

**Commit:** `4f563bf`

**Checklist:**
- [x] `db/connection.js`: factory `createConnection(filePath, logger)` return sqlite3 instance.
- [x] `db/ddl-safe.js`: `isSafeSqlIdent`, `isSafeSqlIdentList`, `createDdlHelpers(db, logger)` factory.
- [x] `db/migrations.js`: semua DDL (pending_deposits, qris_payments, Server, users, transactions, accounts, reseller_bonus_logs) + index + column upgrade. Export `runMigrations(db, logger, helpers)`.
- [x] Update `app.js`: `createConnection(null, logger)` + `createDdlHelpers(db, logger)` + `runMigrations(db, logger, helpers)`. `recordSaldoTransaction` tetap di `app.js` (bukan DDL).
- [x] `node --check`, smoke audit, tests (+7 ddl-safe test = 53 total), commit, push.

**Catatan:**
- Jangan ubah skema. Cuma pindahkan lokasi.
- `ensureSqliteColumn` dipanggil setelah migration awal — urutan wajib tetap.

---

## Fase 3 - Ekstrak Payment/QRIS (MEDIUM RISK) - SELESAI

**Target:** ~1500 baris ke `payment/`. Extract bertahap karena deep coupling dengan bot/vars/state.

**Commit:** `045160e` (Fase 3 parsial, gopay/qris-invoice) + `7f07008` (Fase 3 lanjutan, polling/deposit)

**Checklist:**
- [x] `payment/gopay.js`: `createGopayClient({ getApiKey, baseUrl })` factory dengan `fetchTransactions`, `generateQris`, `fetchQrisStatus`. `getGopayApiKey` tetap di `app.js` (pakai `readVarsFresh` dari closure).
- [x] `payment/qris-invoice.js`: `createQrisInvoiceChecker({ db, gopayClient })` factory untuk `checkQrisInvoiceStatus`. `finalizeQrisPayment`/`applyQrisTopupBonus`/`createQrisInvoice` tetap di `app.js` (pending Fase 3 lanjutan karena butuh `notifyTopupSuccess`, `calculateTopupBonus`, `generateUniqueSuffix`).
- [x] `payment/polling.js`: `createQrisPaymentPoller({ db, bot, logger, checkQrisInvoiceStatus, finalizeQrisPayment, calculateTopupBonus, applyQrisTopupBonus, notifyTopupSuccess, intervalMs, paymentTimeoutMin })` factory. Handler expired/canceled/paid tetap sama (guard PM2 cluster, reset flag >90s, startup log pending count).
- [x] `payment/deposit.js`: `createDepositManager({ db, bot, logger, gopayClient, getTimeZone, getPaymentTimeoutMin, getMinMaxTopup, getBaseQr, getApiKey, ... })` factory. Ekspor `markDepositExpired`, `creditDeposit`, `pollMutasi`, `startAutoTopupMutasi`, `checkQRISStatus`, `findAvailableTopupAmount`, `processDeposit`. `createQrisInvoice` tetap di `app.js` karena butuh `generateUniqueSuffix` (hoisted).
- [x] Factory pattern diterapkan di `gopay.js` dan `qris-invoice.js`.
- [x] `app.js` init `gopayClient` setelah `GOPAY_API_BASE_URL`, `__getQrisInvoiceChecker()` lazy init (butuh `db`).
- [ ] Test integration `:memory:` - belum, geser ke Fase 4 (akan dibahas bareng account service yang lebih stateful).
- [x] `node --check`, smoke audit, tests pass (53 test), commit, push.

**Catatan:**
- `notifyTopupSuccess` masih di `app.js` (pakai `bot.telegram.sendMessage`). Bisa di-pass sebagai callback.
- Hati-hati dengan `global.pendingDeposits` — tetap shared state. Bisa dibiarkan di `global` atau pindah ke module-scoped Map (preferred).
- Fase 3 lanjutan (polling + deposit) tetap mempertahankan nama wrapper global (`processDeposit`, `markDepositExpired`, `creditDeposit`, `findAvailableTopupAmount`, `checkQRISStatus`) dengan destructuring dari factory supaya call-site existing tidak berubah.
- `pollMutasi` dan `startAutoTopupMutasi` sekarang pakai closure dari factory (`pollIntervalMs`, `depositExpireMs`). Konstanta lama `POLL_INTERVAL` / `DEPOSIT_EXPIRE_MS` di `app.js` dihapus.
- Startup dipanggil via `depositManager.startAutoTopupMutasi()` + `qrisPaymentPoller.start()` (menggantikan dua baris lama).

---

## Fase 4 - Ekstrak Account Service (MEDIUM RISK) - SELESAI

**Target:** ~1500 baris ke `accounts/`.

**Commit:** `ac18d91`

**Checklist:**
- [x] `accounts/service.js`: `createAccountService({ db, logger })` factory. Export `getUserSaldo(userId)`, `recordSaldoTransaction`, `recordAccountTransaction`, `processAccountPayment`, `refundAccountPayment`, `upsertAccount`. Signature `getUserSaldo(userId)` murni (tidak terima `db` lagi).
- [x] `accounts/my-accounts.js`: `createMyAccountsHandlers({ bot, db, logger, userState, sendCleanMenu, recordAccountTransaction, getAccountDaysLeft, typeCode, shortStatus, delHandlers, lockHandlers, unlockHandlers })` factory. Ekspor `showMyAccounts` + `register()` yang memasang handler `my_accounts*`, `myacc_page:*`, `accsel/accdel/acclock/accunlock/accrenew`.
- [ ] `accounts/actions.js`: SKIP (scope overlap dengan flow `bot.on('text')` yang masih di `app.js`; rencana digabung ke Fase 5 ketika admin menu juga diekstrak).
- [x] Update `app.js`: `accountService` di-init setelah `runMigrations`; `myAccountsHandlers.register()` dipanggil setelah `userState` dibuat. Wrapper `getUserSaldo(db, userId)` dipertahankan agar call-site lama tidak berubah.
- [ ] Test: race condition `processAccountPayment` ditunda ke Fase "Optional Future Work" (butuh sqlite3 `:memory:` dulu).
- [x] `node --check`, smoke audit (regex diperluas `err|beginErr`), tests pass (53), commit, push.

**Catatan:**
- Handler `bot.action(/^myacc_page:(active|expired|all):(\d+)$/, ...)` harus tetap di-register sebelum `bot.action(/accsel:(\d+)/)` kalau ada overlap.
- Sekarang handler di-register dalam satu `register()`; urutan `myacc_page` mendahului `accsel` dijaga di dalam module.
- Smoke audit rule BEGIN IMMEDIATE TRANSACTION diperluas jadi menerima `(err)` atau `(beginErr)` karena pattern `beginErr` pindah ke `accounts/service.js` (bukan lagi di `app.js`).

---

## Fase 5 - Ekstrak Admin Menu (HIGH RISK) - PARSIAL (2/6 sub)

**Target:** ~3000 baris ke `admin/`.

**Commit:** `6c26923`

**Checklist:**
- [x] `admin/menu.js`: `createAdminMenuHandlers({ bot, logger, adminIds, ADMIN_IDS, sendAdminMenu })`. Register `admin_menu` + `admin_reseller_menu`. `sendAdminMenu` sendiri masih di `app.js` (karena mengakses banyak variabel module-level).
- [x] `admin/promo.js`: `createPromoHandlers({ bot, logger, adminIds })`. Register `promo_template_menu` + 4 template (`promo_tpl_catalog/reseller/short/kaisar`). `getBotTagForPromo` helper pindah ke module.
- [ ] `admin/reseller.js`: SKIP di sesi ini. Semua handler `admin_res_target_*` & `admin_res_bonus_*` mengakses (reassign) variabel module-level (`RESELLER_TARGET_ENABLED`, `RESELLER_ACTIVE_BONUS_TIER1_DAYS`, dll.) yang juga dibaca oleh `renderResellerTargetMenu`/`renderResellerBonusMenu` di `app.js`. Pindah ke module = reassign hanya mempengaruhi scope modul, bukan closure di `app.js`. Butuh wrapper state object (invasif) — tunda ke sesi khusus.
- [ ] `admin/broadcast.js`: SKIP. Flow `broadcast_menu` + `broadcastSessions` nested di dalam `bot.on('text')` handler (step machine), tidak bisa dicabut sepotong.
- [ ] `admin/server.js`: SKIP. Handler `addserver`/`editharga`/dsb tersebar di banyak titik + share flow dengan `userState`.
- [ ] `admin/user.js`: SKIP. Sama seperti server — command `addsaldo`/`minsaldo`/`deluser` + state flow.
- [x] Update `app.js`: `createAdminMenuHandlers({...}).register()` + `createPromoHandlers({...}).register()` dipanggil setelah `bot`, `sendAdminMenu`, `adminIds` siap.
- [x] Smoke audit diperluas: sekarang membaca `app.js` + `admin/menu.js` + `admin/promo.js` digabung supaya regex `admin_menu` tetap ketemu meski handler pindah.
- [ ] Test admin guard (non-admin): belum otomatis, masih manual.
- [x] `node --check`, smoke audit, tests pass (53), commit, push.

**Catatan:**
- Sesi berikut untuk `admin/reseller.js`: strategi = bungkus `RESELLER_TARGET_*` & `RESELLER_ACTIVE_BONUS_*` jadi satu object state (`resellerState.targetEnabled`, dst.), pass reference ke module + `render*Menu` sekaligus. Atau pindahkan kedua `render*Menu` ke module yang sama.
- Urutan register sensitif tetap dijaga: module admin di-register duluan supaya generic handler yang lebih umum tidak menelan callback admin.
- Smoke audit regex `admin_res_bonus_*` masih pass karena handler-nya belum dipindah (masih di `app.js`).

---

## Fase 6 - Ekstrak Scheduler (LOW RISK)

**Target:** ~800 baris ke `scheduler/`.

**Commit:** _(belum)_

**Checklist:**
- [ ] `scheduler/daily-report.js`: `startDailyReportScheduler`, `sendDailyReport`.
- [ ] `scheduler/expiry-reminder.js`: `startExpiryReminderScheduler`, `sendExpiryReminders`.
- [ ] `scheduler/reseller-target.js`: `startResellerTargetScheduler`, `checkAndDowngradeResellersForPreviousMonth`.
- [ ] `scheduler/auto-backup.js`: `restartAutoBackupScheduler`, `sendAutoBackup`.
- [ ] Update `app.js`: panggil semua scheduler dari satu tempat.
- [ ] Test: scheduler pakai fake timer (`setTimeout` mock).
- [ ] `node --check`, smoke audit, tests, commit, push.

**Catatan:**
- Scheduler pakai `setInterval` — pastikan kalau module di-load ulang, tidak bikin interval ganda (kasih guard `global.__*SchedulerStarted`).
- `sendAutoBackup` kirim file DB ke chat admin — butuh `bot.telegram.sendDocument` reference.

---

## Setelah 6 Fase

- `app.js` tinggal ~3000-4000 baris: bot init, middleware, `text` handler (user input flow), callback middleware, entry point.
- Struktur akhir:
  ```
  app.js                  ~3500 baris (bot core + text flow)
  lib/                    helper pure (qris, html, validators, bonus, time, masker, licence)
  db/                     connection, migrations, ddl-safe
  modules/                provider API (create, trial, renew, del, lock, unlock, reseller, http-client)
  payment/                gopay, qris-invoice, polling, deposit
  accounts/               service, actions, my-accounts
  admin/                  menu, reseller, broadcast, server, user, promo
  scheduler/              daily-report, expiry-reminder, reseller-target, auto-backup
  tests/                  unit test per modul
  scripts/                smoke-audit
  ```

---

## Prinsip Umum Saat Split

1. **Pure function first**: kalau fn bisa diekstrak tanpa closure, prioritaskan ke `lib/`.
2. **Factory pattern untuk stateful**: module yang butuh `db`/`bot`/`logger`/`vars` export function yang terima deps.
3. **Shared state eksplisit**: `global.pendingDeposits`, `userState`, `broadcastSessions` keluarkan ke `state/` module kalau shared banyak tempat.
4. **Smoke audit harus tetap pass**: regex di `scripts/smoke-audit.js` memeriksa admin guard. Kalau nama handler berubah, update audit script.
5. **Tiap fase satu commit**: gampang revert kalau break.
6. **Jangan ubah API eksternal**: semua handler `bot.action`/`bot.command` harus tetap register dengan nama dan signature yang sama.
7. **Urutan register sensitif**: Telegraf jalan top-down, regex yang generic harus di-register setelah yang spesifik.

---

## Optional Future Work (tidak urgent)

- [ ] Fork internal `autoft-orkut` dan `autoft-qris` (versi 0.0.x alpha, risiko maintenance).
- [ ] Refactor callback hell `db.*` ke pattern async/promise.
- [ ] Tambah integration test pakai sqlite3 in-memory (`:memory:`).
- [ ] Monitoring: kirim metrics ke endpoint eksternal (total topup, error rate).
- [ ] Admin panel web sederhana untuk cek status + tanpa perlu Telegram.
