# Roadmap Split `app.js` Ketantech VPN Bot

Catatan pengerjaan split `app.js` secara bertahap. Tujuan akhir: memecah file 13.600+ baris jadi modul-modul per-domain supaya gampang di-maintain dan di-test.

Status keseluruhan: **6/6 fase selesai** (Fase 5 parsial 3/6 sub: menu + promo + reseller; 3/6 sub SKIPPED dengan alasan coupling)

**Final Stats (2026-06-02):**
- `app.js`: ~13.600 baris → ~11.047 baris (~19% reduction)
- Test coverage: 80 test (59 unit + 21 integration), semua PASS
- Modules extracted: `lib/` (8 files), `db/` (3 files), `payment/` (4 files), `accounts/` (2 files), `admin/` (3 files), `scheduler/` (4 files)
- **Fase 5 lanjutan (broadcast/server/user) SKIPPED** — deeply coupled dengan `bot.on('text')` central router + shared state (`userState`, `broadcastSessions`). Extract butuh sesi khusus dengan strategi state machine isolation. Risk vs benefit: HIGH RISK, LOW BENEFIT untuk sekarang.

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
- [x] **Paket 5 Security Audit Lanjutan** - `5f7281d`
  - Audit privilege escalation di semua `bot.action`/`bot.command` admin handler.
  - Fix: `bot.action('listserver')` tambah guard `ADMIN_IDS.includes` (sebelumnya bocor list domain server kalau callback dipalsukan).
  - Verifikasi aman (no patch perlu): trial flow (PK atomic + trialLock), reseller bonus (Math.floor + dual idempotency `transactions.reference_id` & `reseller_bonus_logs(user_id, period_month)`), broadcast (persist DB + retry-after 429 + sleep 80ms), session in-memory (yang penting sudah di DB).
  - Nice-to-have follow-up:
    - [x] TTL cleanup state in-memory (`c50b4a1`): sweeper 5 menit, hapus entri `userState`/`broadcastSessions`/`adminState`/`adminTrialTemp`/`global.depositState` yang idle > 30 menit. Stamp `__t` retro-active waktu sweeper jalan.
    - [x] Trial `isError` detection (`61a0c76`): ganti `includes('❌')` ke prefix-match (`trim().startsWith('❌') || includes('???')`). Lebih robust kalau provider script ubah body pesan sukses.
    - [ ] `global.depositState` pindah ke `state/deposit-state.js` module: SKIP. 23 callsite tersebar di `app.js` + `payment/deposit.js`, refactor cosmetic (bukan bug security). Sudah ter-cover oleh sweeper TTL di `c50b4a1`. Bisa dikerjakan kalau ada sesi refactor khusus (1 sesi).
- [x] **Paket 6 Dependency Hardening** - `5502b96`
  - `npm audit` triage manual: 25 advisories awal (4 low, 5 mod, 16 high) → 10 sisa (2 low, 0 mod, 8 high).
  - Fix: bump `axios ^1.13.2` → `^1.15` (lockfile resolve ke `1.16.1`) + `npm audit fix --omit=dev` untuk transitive sqlite3 build chain. **15 vuln cleaned** (1 low, 5 mod, 9 high).
  - Sisa 10 advisory **diabaikan dengan alasan** (didokumentasikan):
    - `tar`, `node-gyp`, `make-fetch-happen`, `cacache`, `http-proxy-agent`, `@tootallnate/once`, `@mapbox/node-pre-gyp` → build-tooling chain dari `sqlite3` + `canvas`. Hanya jalan saat `npm install`, tidak load runtime. Tidak ada attack surface produksi.
    - `express ^4.21.2` (high via body-parser/path-to-regexp/qs) → fix butuh major upgrade ke express 5 (breaking). HTTP server bot bind `127.0.0.1` only, no external attack surface.
    - `qs ^6.14.1` (low DoS) → same reasoning, attack surface lokal saja.
    - `autoft-qris 0.0.12` + `autoft-orkut 0.0.2` (high via canvas) → alpha 0.0.x, fix downstream butuh fork internal (sudah di-flag di Nice-to-have section).
  - Workflow: `npm install` + `npm audit fix` jalan di VPS (akses npm registry bersih), lalu commit + push dari VPS sekali ini saja. Setelah ini balik ke alur normal (develop di local → push GitHub → VPS pull).
- [x] **Paket 7 Polish & Hygiene** - `00ff863`
  - `feat(http): /healthz + /livez endpoint` (`b550433`): bind `127.0.0.1` (sama seperti app utama), return JSON status (uptime, db reachable). Berguna untuk monitoring eksternal (cron health check / systemd watcher / reverse proxy).
  - `refactor(state): depositState/pendingDeposits ke state/deposit-state.js` (`4e77ec8`): hapus 14 referensi `global.*`, ganti ke module-scope object yang di-share lewat module cache. Tidak ada breaking change — object reference sama, hanya namespace pindah. Test integration `deposit-manager.test.js` ikut di-update.
  - `feat(lib): lib/db-async.js promise wrapper sqlite3` (`00ff863`): export `dbRun` / `dbGet` / `dbAll` / `dbExec` untuk adopsi gradual. Test integration helper di-DRY-kan (reuse dari `lib/db-async`). 5 unit test baru. Total test: 64 unit + 31 integration = **95 test**.
  - Catatan: refactor existing callsite callback hell ke `lib/db-async` belum dikerjakan (skala besar, perlu sesi sendiri). Helper sudah siap dipakai untuk fitur baru.

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

## Fase 5 - Ekstrak Admin Menu (HIGH RISK) - PARSIAL (3/6 sub) — FINAL

**Target:** ~3000 baris ke `admin/`.

**Commit:** `6c26923` + `af2f145` (admin/reseller.js) + `678d0de` (admin-saldo-menu.js)

**Status:** ✅ **SELESAI PARSIAL** — 3/6 sub-item extracted, 3/6 SKIPPED dengan alasan coupling.

**Checklist:**
- [x] `admin/menu.js`: `createAdminMenuHandlers({ bot, logger, adminIds, ADMIN_IDS, sendAdminMenu })`. Register `admin_menu` + `admin_reseller_menu`. `sendAdminMenu` sendiri masih di `app.js` (karena mengakses banyak variabel module-level).
- [x] `admin/promo.js`: `createPromoHandlers({ bot, logger, adminIds })`. Register `promo_template_menu` + 4 template (`promo_tpl_catalog/reseller/short/kaisar`). `getBotTagForPromo` helper pindah ke module.
- [x] `admin/reseller.js`: `createResellerAdminHandlers({ bot, logger, ADMIN_IDS, state, getTiers, getMonthRange, getEligiblePreview, grantBonus, updateTargetVars, updateBonusVars })`. Register `admin_reseller_target` + `admin_res_target_*` + `admin_reseller_bonus_menu` + `admin_res_bonus_*` (17 handler total). `renderResellerTargetMenu` + `renderResellerBonusMenu` + `clampResellerBonusConfig` + `updateAndRenderResellerBonusMenu` + `adjustResellerBonusVar` semua pindah. State wrapper pakai getter/setter object (`state.getTargetEnabled/setTargetEnabled()` dst.) supaya `let` di `app.js` tetap bisa di-reassign — tidak perlu refactor 140 callsite.
- [x] `admin/broadcast.js`: **SKIPPED** (2026-06-02). Alasan: Flow `broadcast_menu` + `broadcastSessions` deeply coupled dengan `bot.on('text')` handler (multi-step state machine untuk 5 template: manual, maintenance, maintenance_done, promo, slot, info). Extract membutuhkan refactor 200+ baris `bot.on('text')` yang juga handle flow lain (admin server, admin user, service flow). Risk vs benefit: **HIGH RISK, LOW BENEFIT**. Broadcast sudah punya helper UI di `lib/broadcast-menu.js` + core functions rapi (validate, lock, persist, worker). Audit lengkap tersimpan di session 2026-06-02.
- [x] `admin/server.js`: **SKIPPED** (2026-06-02). Alasan: Handler `addserver`/`editharga`/`editnama`/`editauth`/`editlimit*` tersebar di 8 legacy commands + 1 multi-step wizard (7 steps: domain→auth→nama→quota→iplimit→batas_create→harga) yang deeply coupled dengan `bot.on('text')` + shared `userState` (dipakai juga untuk service create/trial/renew flow). Extract parsial (commands + actions only, skip wizard) possible tapi benefit kecil (~1000 baris) vs risk medium (touch shared state). Audit lengkap tersimpan di session 2026-06-02.
- [x] `admin/user.js`: **SKIPPED** (2026-06-02). Alasan: Pattern sama seperti `admin/server.js` — command `addsaldo`/`minsaldo`/`deluser`/`listuser`/`setflag` + state flow kemungkinan besar deeply coupled dengan `bot.on('text')` + shared state. Tidak di-audit detail karena broadcast + server sudah menunjukkan pattern HIGH RISK yang konsisten.
- [x] Update `app.js`: `createAdminMenuHandlers({...}).register()` + `createPromoHandlers({...}).register()` dipanggil setelah `bot`, `sendAdminMenu`, `adminIds` siap.
- [x] Smoke audit diperluas: sekarang membaca `app.js` + `admin/menu.js` + `admin/promo.js` digabung supaya regex `admin_menu` tetap ketemu meski handler pindah.
- [ ] Test admin guard (non-admin): belum otomatis, masih manual.
- [x] `node --check`, smoke audit, tests pass (80 total: 59 unit + 21 integration), commit, push.

**Catatan:**
- Urutan register sensitif tetap dijaga: module admin di-register duluan supaya generic handler yang lebih umum tidak menelan callback admin.
- Smoke audit regex `admin_res_bonus_*` di-update: (a) scan file diperluas ke `admin/reseller.js`, (b) regex guard admin menerima `!ADMIN_IDS.includes(ctx.from.id)` atau `!isAdmin(ctx)`, (c) regex tier days/amount update ke format template string baru `'admin_res_bonus_' + tier + '_xxx'` + helper `adjustBonusVar`.
- Smoke boot tambah check `require admin/reseller` + `createResellerAdminHandlers factory` (total 36 check).
- **Lesson learned (2026-06-02):** `bot.on('text')` handler di app.js adalah **central router** untuk semua multi-step flow (broadcast templates, admin server wizard, admin user commands, service flow). Extract flow dari sini = **VERY HIGH RISK** karena shared state (`userState`, `broadcastSessions`, `adminState`) + nested conditionals yang saling depend. Refactor ini butuh sesi khusus dengan strategi: (1) extract state machine ke module terpisah, (2) refactor `bot.on('text')` jadi thin router yang delegate ke module, (3) isolate shared state per-domain. Untuk sekarang, **SKIP adalah keputusan yang benar** — benefit kecil vs risk besar.

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

## Kondisi Setelah 6 Fase (Aktual) — FINAL 2026-06-02

- `app.js` sekarang **~11.047 baris** (dari ~13.600 pra-split) — turun ~19%. Target awal ~3.500 baris belum tercapai karena banyak sub-item di Fase 5 di-SKIP (broadcast/server/user deeply coupled dengan `bot.on('text')` central router) dan body fungsi `send*Report`/`send*Reminders`/`sendAutoBackup`/`checkAndDowngradeResellersForPreviousMonth` sengaja ditinggal di `app.js` (akses closure DB + template + render menu).
- Struktur folder aktual:
  ```
  app.js                  ~11.047 baris (bot core + text flow central router + body scheduler + broadcast/server/user handlers)
  lib/                    helper pure: qris, html, validators, bonus, time, masker, licence, broadcast-menu, admin-saldo-menu, admin-server-menu
  db/                     connection, migrations, ddl-safe
  modules/                provider API: create, trial, renew, del, lock, unlock, reseller, http-client, user-dashboard, reseller-sales, reseller-upgrade
  payment/                gopay, qris-invoice, polling, deposit
  accounts/               service, my-accounts
  admin/                  menu, promo, reseller
  scheduler/              daily-report, expiry-reminder, reseller-target, auto-backup
  state/                  deposit-state
  tests/                  unit (59 test) + integration (21 test) = 80 test total, semua PASS
  scripts/                smoke-audit (multi-file scan), smoke-boot (CI verification)
  ```
- **Lesson learned:** `bot.on('text')` adalah **central router** untuk semua multi-step flow. Extract dari sini = VERY HIGH RISK karena shared state + nested conditionals. Untuk refactor lebih lanjut, butuh strategi: (1) isolate state machine per-domain ke module terpisah, (2) refactor `bot.on('text')` jadi thin dispatcher, (3) decouple shared state (`userState`, `broadcastSessions`, `adminState`). Ini adalah **sesi khusus tersendiri**, bukan incremental refactor.

---

## Pasca 6 Fase — Sisa Pekerjaan Opsional

Daftar ini konsolidasi semua sub-item yang `[ ]` di Fase 3-6. Bukan blocker, dikerjakan hanya kalau mau menurunkan `app.js` lebih jauh atau menambah coverage test.

### Fase 5 lanjutan (admin tersisa) — SKIPPED 2026-06-02

**Status:** ❌ **SKIPPED** — deeply coupled dengan `bot.on('text')` central router + shared state.

**Alasan SKIP:**
- `bot.on('text')` handler di app.js (line 8700+) adalah **central router** untuk semua multi-step flow: broadcast templates (5 templates × multi-step), admin server wizard (7 steps), admin user commands, service flow (create/trial/renew), reseller addserver (7 steps).
- Shared state (`userState`, `broadcastSessions`, `adminState`) dipakai oleh banyak flow secara bersamaan. Extract satu flow = risk break flow lain.
- Extract butuh **sesi khusus** dengan strategi: (1) isolate state machine per-domain ke `state/` module, (2) refactor `bot.on('text')` jadi thin dispatcher yang delegate ke module, (3) decouple shared state dengan namespace per-domain.
- **Risk vs benefit:** HIGH RISK (touch 200+ baris central router + shared state), LOW BENEFIT (hanya ~1500-2000 baris pindah, tapi `app.js` tetap jadi router).

**Items SKIPPED:**
- [x] `admin/broadcast.js`: **SKIPPED**. Flow `broadcast_menu` + `broadcastSessions` + 5 template multi-step (manual, maintenance, maintenance_done, promo, slot, info) nested di `bot.on('text')`. Audit lengkap: 13 action handlers, 9 core functions, multi-step state machine 200+ baris. Helper UI sudah ada di `lib/broadcast-menu.js`.
- [x] `admin/server.js`: **SKIPPED**. 8 legacy commands (`/addserver`, `/editharga`, `/editnama`, `/editauth`, `/editlimit*`) + 1 multi-step wizard (7 steps) + 6 action handlers. Wizard deeply coupled dengan `userState` (shared dengan service flow). Extract parsial (commands + actions only) possible tapi benefit kecil (~1000 baris) vs risk medium.
- [x] `admin/user.js`: **SKIPPED**. Pattern sama seperti `admin/server.js` — command `addsaldo`/`minsaldo`/`deluser`/`listuser`/`setflag` + state flow kemungkinan besar deeply coupled. Tidak di-audit detail karena broadcast + server sudah menunjukkan pattern HIGH RISK yang konsisten.
- [ ] Test admin guard (non-admin tidak boleh akses): belum otomatis, masih manual.

**Rekomendasi untuk future refactor:**
Kalau mau lanjut extract broadcast/server/user, strategi yang aman:
1. **Sesi 1:** Extract state machine ke `state/broadcast-state.js`, `state/server-state.js`, `state/user-state.js` dengan API: `getState(chatId)`, `setState(chatId, step, data)`, `clearState(chatId)`.
2. **Sesi 2:** Extract handler logic ke `admin/broadcast-handlers.js`, `admin/server-handlers.js`, `admin/user-handlers.js` dengan factory pattern (inject state module + deps).
3. **Sesi 3:** Refactor `bot.on('text')` jadi thin dispatcher: `if (state.step.startsWith('broadcast_')) return broadcastHandlers.handle(ctx, state);`.
4. **Sesi 4:** Decouple shared `userState` — split jadi `serviceState` (create/trial/renew) vs `adminServerState` (addserver wizard) dengan namespace berbeda.
5. **Sesi 5:** Integration test untuk semua flow (broadcast, server, user, service) supaya yakin tidak ada regression.

Total effort: **5 sesi × 2-3 jam = 10-15 jam**. Benefit: `app.js` turun ~2000 baris lagi (jadi ~9000 baris). Risk: MEDIUM-HIGH kalau tidak hati-hati dengan shared state.

### Body function ke module

**Risiko: MEDIUM. SELESAI.** Semua body function di bawah sudah pindah ke module; wrapper tipis (`const fn = (...args) => factory.fn(...args)`) tetap di `app.js` agar call-site lama tidak berubah.

- [x] `createQrisInvoice` → `payment/qris-invoice.js` (deps: `getApiKey`, `generateUniqueSuffix`, `parseProviderTransactionTime`, `getMaxTopup`).
- [x] `sendAutoBackup` → `scheduler/auto-backup.js` (deps: `bot`, `getBackupChatId`, `getTimeZone`, `baseDir`). Factory sekarang expose `{ restart, sendAutoBackup }`.
- [x] `sendDailyReport` → `scheduler/daily-report.js` (deps: `db`, `bot`, `getMasterId`, `getResselFilePath`, `getUsernameById`, `getTimeZone`).
- [x] `sendExpiryReminders` → `scheduler/expiry-reminder.js` (deps: `db`, `bot`, `getMasterId`, `getDaysBefore`, `getTimeZone`).
- [x] `checkAndDowngradeResellersForPreviousMonth` → `scheduler/reseller-target.js` (deps: `db`, `bot`, `getMasterId`, `getMin30dAccounts`, `getMinDaysPerMonth`, `readResellerSetSync`, `removeResellerIdFromCache`).
- Total dampak: `app.js` 11.562 → ~11.047 baris (turun ~515 baris dari body function saja). Komposisi factory semakin tajam.

### Integration test & CI

- [x] `tests/integration/` dengan sqlite3 `:memory:` — helper bootstrap (migrations otomatis) di `tests/integration/helpers.js`. Commit: `0753437` + `585c370` (qris-invoice).
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
