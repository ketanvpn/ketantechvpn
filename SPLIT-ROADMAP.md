# Roadmap Split `app.js` Ketantech VPN Bot

Catatan pengerjaan split `app.js` secara bertahap. Tujuan akhir: memecah file 13.600+ baris jadi modul-modul per-domain supaya gampang di-maintain dan di-test.

Status keseluruhan: **5/6 fase selesai (Fase 5 parsial 3/6 sub: menu + promo + reseller)**

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

## Fase 5 - Ekstrak Admin Menu (HIGH RISK) - PARSIAL (3/6 sub)

**Target:** ~3000 baris ke `admin/`.

**Commit:** `6c26923` + `af2f145` (admin/reseller.js)

**Checklist:**
- [x] `admin/menu.js`: `createAdminMenuHandlers({ bot, logger, adminIds, ADMIN_IDS, sendAdminMenu })`. Register `admin_menu` + `admin_reseller_menu`. `sendAdminMenu` sendiri masih di `app.js` (karena mengakses banyak variabel module-level).
- [x] `admin/promo.js`: `createPromoHandlers({ bot, logger, adminIds })`. Register `promo_template_menu` + 4 template (`promo_tpl_catalog/reseller/short/kaisar`). `getBotTagForPromo` helper pindah ke module.
- [x] `admin/reseller.js`: `createResellerAdminHandlers({ bot, logger, ADMIN_IDS, state, getTiers, getMonthRange, getEligiblePreview, grantBonus, updateTargetVars, updateBonusVars })`. Register `admin_reseller_target` + `admin_res_target_*` + `admin_reseller_bonus_menu` + `admin_res_bonus_*` (17 handler total). `renderResellerTargetMenu` + `renderResellerBonusMenu` + `clampResellerBonusConfig` + `updateAndRenderResellerBonusMenu` + `adjustResellerBonusVar` semua pindah. State wrapper pakai getter/setter object (`state.getTargetEnabled/setTargetEnabled()` dst.) supaya `let` di `app.js` tetap bisa di-reassign — tidak perlu refactor 140 callsite.
- [ ] `admin/broadcast.js`: SKIP. Flow `broadcast_menu` + `broadcastSessions` nested di dalam `bot.on('text')` handler (step machine), tidak bisa dicabut sepotong.
- [ ] `admin/server.js`: SKIP. Handler `addserver`/`editharga`/dsb tersebar di banyak titik + share flow dengan `userState`.
- [ ] `admin/user.js`: SKIP. Sama seperti server — command `addsaldo`/`minsaldo`/`deluser` + state flow.
- [x] Update `app.js`: `createAdminMenuHandlers({...}).register()` + `createPromoHandlers({...}).register()` dipanggil setelah `bot`, `sendAdminMenu`, `adminIds` siap.
- [x] Smoke audit diperluas: sekarang membaca `app.js` + `admin/menu.js` + `admin/promo.js` digabung supaya regex `admin_menu` tetap ketemu meski handler pindah.
- [ ] Test admin guard (non-admin): belum otomatis, masih manual.
- [x] `node --check`, smoke audit, tests pass (53), commit, push.

**Catatan:**
- Urutan register sensitif tetap dijaga: module admin di-register duluan supaya generic handler yang lebih umum tidak menelan callback admin.
- Smoke audit regex `admin_res_bonus_*` di-update: (a) scan file diperluas ke `admin/reseller.js`, (b) regex guard admin menerima `!ADMIN_IDS.includes(ctx.from.id)` atau `!isAdmin(ctx)`, (c) regex tier days/amount update ke format template string baru `'admin_res_bonus_' + tier + '_xxx'` + helper `adjustBonusVar`.
- Smoke boot tambah check `require admin/reseller` + `createResellerAdminHandlers factory` (total 36 check).

---

## Fase 6 - Ekstrak Scheduler (LOW RISK) - SELESAI

**Target:** ~800 baris ke `scheduler/`.

**Commit:** `f2bef74`

**Checklist:**
- [x] `scheduler/daily-report.js`: `createDailyReportScheduler({ logger, getTimeInConfiguredTimeZone, getTimeZone, isEnabled, getHour, getMinute, sendDailyReport, getLastSentDateKey, setLastSentDateKey })`. Loop scheduler dipindah, `sendDailyReport` body tetap di `app.js` (akses DB + template).
- [x] `scheduler/expiry-reminder.js`: `createExpiryReminderScheduler({ ... })`. Pola sama. `sendExpiryReminders` tetap di `app.js`.
- [x] `scheduler/reseller-target.js`: `createResellerTargetScheduler({ ..., runCheck, getLastProcessedMonthKey, setLastProcessedMonthKey })`. `checkAndDowngradeResellersForPreviousMonth` tetap di `app.js`.
- [x] `scheduler/auto-backup.js`: `createAutoBackupScheduler({ logger, isEnabled, getIntervalHours, sendAutoBackup })`. `restart()` membaca interval terbaru via getter supaya handler admin bisa ubah config on-the-fly.
- [x] Update `app.js`: factory di-init di posisi lama `restartAutoBackupScheduler`. Wrapper `function restartAutoBackupScheduler() { __autoBackupScheduler.restart(); }` + setara untuk 3 scheduler lain dipertahankan supaya call-site lama tidak perlu diubah.
- [ ] Test scheduler pakai fake timer: belum (butuh sinon/jest fake timer; ditunda ke Optional Future Work).
- [x] `node --check`, smoke audit, tests pass (53), commit, push.

**Catatan:**
- Guard `global.__*SchedulerStarted` dipasang di factory (daily/expiry/reseller). AutoBackup pakai local `timer` variable di factory closure — dipanggil `restart()` via wrapper setiap kali config berubah.
- Semua getter config (`isEnabled`, `getHour`, `getMinute`, `getIntervalHours`, dll.) diwrap sebagai arrow function supaya reassign di `app.js` terbaca setiap kali scheduler tick.
- `sendDailyReport` / `sendExpiryReminders` / `sendAutoBackup` / `checkAndDowngradeResellersForPreviousMonth` tetap di `app.js` karena akses banyak closure (DB, template, dsb.). Bisa diekstrak di sesi khusus kalau ingin module lebih "pure".

---

## Kondisi Setelah 6 Fase (Aktual)

- `app.js` sekarang **~11.562 baris** (dari ~13.600 pra-split) — turun ~15%. Target awal ~3.500 baris belum tercapai karena banyak sub-item di Fase 5 di-SKIP dan body fungsi `send*Report`/`send*Reminders`/`sendAutoBackup`/`checkAndDowngradeResellersForPreviousMonth` sengaja ditinggal di `app.js` (akses closure DB + template + render menu).
- Struktur folder aktual:
  ```
  app.js                  ~11.562 baris (bot core + text flow + body scheduler + admin/reseller/broadcast/server/user handler)
  lib/                    helper pure: qris, html, validators, bonus, time, masker, licence
  db/                     connection, migrations, ddl-safe
  modules/                provider API: create, trial, renew, del, lock, unlock, reseller, http-client
  payment/                gopay, qris-invoice, polling, deposit
  accounts/               service, my-accounts                  (actions: SKIP)
  admin/                  menu, promo                           (reseller/broadcast/server/user: SKIP)
  scheduler/              daily-report, expiry-reminder, reseller-target, auto-backup
  tests/                  8 file, 53 test (bonus, ddl-safe, html, licence, masker, qris, time, validators)
  scripts/                smoke-audit (multi-file scan: app.js + admin/menu.js + admin/promo.js)
  ```

---

## Pasca 6 Fase — Sisa Pekerjaan Opsional

Daftar ini konsolidasi semua sub-item yang `[ ]` di Fase 3-6. Bukan blocker, dikerjakan hanya kalau mau menurunkan `app.js` lebih jauh atau menambah coverage test.

### Fase 5 lanjutan (admin tersisa)

**Risiko: HIGH.** Semua item di bawah butuh refactor state wrapper supaya reassign module-level bisa reflect di factory module.

- [ ] `admin/reseller.js`: handler `admin_res_target_*` + `admin_res_bonus_*` + `renderResellerTargetMenu` + `renderResellerBonusMenu` + `adjustResellerBonusVar`. Strategi: bungkus `RESELLER_TARGET_*` & `RESELLER_ACTIVE_BONUS_*` ke satu object `resellerState` (`resellerState.targetEnabled`, dst.) lalu pass reference ke module. Atau pindahkan `render*Menu` bareng handler-nya ke satu module.
- [ ] `admin/broadcast.js`: `broadcastSessions` + flow `broadcast_menu`. Masalahnya step machine nested di `bot.on('text')` handler — perlu ekstrak flow sessions jadi state machine module (`state/broadcast.js`) terpisah, baru handler-nya bisa pindah.
- [ ] `admin/server.js`: `addserver`, `editharga`, `editnama`, `editauth`, `editlimitquota`, `editlimitip`, `editlimitcreate`, `edittotalcreate`, detail/delete. Banyak share flow dengan `userState`.
- [ ] `admin/user.js`: `cek_saldo_user`, `riwayat_saldo_user`, `flag_user_start`, `addsaldo`, `minsaldo`, `deluser`, `listuser`, `setflag`, `list_all_users`. Sama kendalanya seperti `admin/server.js`.
- [ ] Test admin guard (non-admin tidak boleh akses): otomatis, belum dibuat.

### Body function ke module

**Risiko: MEDIUM. SELESAI.** Semua body function di bawah sudah pindah ke module; wrapper tipis (`const fn = (...args) => factory.fn(...args)`) tetap di `app.js` agar call-site lama tidak berubah.

- [x] `createQrisInvoice` → `payment/qris-invoice.js` (deps: `getApiKey`, `generateUniqueSuffix`, `parseProviderTransactionTime`, `getMaxTopup`).
- [x] `sendAutoBackup` → `scheduler/auto-backup.js` (deps: `bot`, `getBackupChatId`, `getTimeZone`, `baseDir`). Factory sekarang expose `{ restart, sendAutoBackup }`.
- [x] `sendDailyReport` → `scheduler/daily-report.js` (deps: `db`, `bot`, `getMasterId`, `getResselFilePath`, `getUsernameById`, `getTimeZone`).
- [x] `sendExpiryReminders` → `scheduler/expiry-reminder.js` (deps: `db`, `bot`, `getMasterId`, `getDaysBefore`, `getTimeZone`).
- [x] `checkAndDowngradeResellersForPreviousMonth` → `scheduler/reseller-target.js` (deps: `db`, `bot`, `getMasterId`, `getMin30dAccounts`, `getMinDaysPerMonth`, `readResellerSetSync`, `removeResellerIdFromCache`).
- Total dampak: `app.js` 11.562 → ~11.047 baris (turun ~515 baris dari body function saja). Komposisi factory semakin tajam.

### Integration test & CI

- [x] `tests/integration/` dengan sqlite3 `:memory:` — helper bootstrap (migrations otomatis) di `tests/integration/helpers.js`. Commit: `0753437` + `<TBD>` (qris-invoice).
  - [x] `account-service.test.js` (4 test): race condition `processAccountPayment` saldo tipis, `refundAccountPayment` balikin saldo, pembelian sequential, kontrak paralel (SQLITE_BUSY acceptable).
  - [x] `deposit-manager.test.js` (3 test): `creditDeposit` double-process guard (hanya 1 kredit saldo), `findAvailableTopupAmount` collision fallback, suffix tersedia → non-bentrok.
  - [x] `smoke.test.js` (1 test): verifikasi semua table utama ter-migrate.
  - [x] `qris-invoice.test.js` (13 test): happy path, `forcedUniqueSuffix` explicit, clamp amount ke max (diff>=50 vs <50), validasi base amount + api key; `checkQrisInvoiceStatus` invoice tidak ada, PENDING sebelum grace lewat, PAID/EXPIRED/CANCELED/PENDING state dari provider. **Test ini juga mendokumentasikan bug carry-over**: `forcedUniqueSuffix=null` default di-treat suffix 0 karena `Number.isFinite(Number(null))===true`.
  - Total: **21 integration test, semua PASS.**
  - Script npm: `npm run test:integration` (tests/integration/*.test.js) + `npm run test:all` (unit + integration).
- [x] Scheduler fake-timer test (`node:test` `mock.timers`) untuk 4 scheduler — `tests/scheduler.test.js`, 6 test: auto-backup disabled/enabled/restart, daily-report jam target + no double-send, expiry-reminder H-n, reseller-target day-1 of month only. Total 59 unit test (dari 53).
- [x] Smoke boot (`scripts/smoke-boot.js`) + GitHub Actions step: verifikasi semua module bisa di-require + semua factory bisa di-construct dengan stub deps + DB `:memory:` migrations sukses. Tidak perlu BOT_TOKEN valid. CI workflow juga sekarang jalankan `npm run test:integration` + syntax check untuk semua folder split (`db/`, `payment/`, `accounts/`, `admin/`, `scheduler/`).

### Nice-to-have (bukan refactor)

- [ ] Fork internal `autoft-orkut` dan `autoft-qris` (versi 0.0.x alpha, risiko maintenance pihak ketiga).
- [ ] Refactor callback hell `db.*` ke pattern async/promise (util wrapper `dbAll`, `dbGet`, `dbRun` berbasis Promise).
- [ ] Monitoring: kirim metrics ke endpoint eksternal (total topup, error rate, scheduler last-run timestamp).
- [ ] Admin panel web sederhana untuk cek status (tanpa perlu Telegram).
- [ ] Middleware rate-limit per user di Telegraf (anti spam tombol).

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
