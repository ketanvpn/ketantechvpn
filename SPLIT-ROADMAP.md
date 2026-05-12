# Roadmap Split `app.js` Ketantech VPN Bot

Catatan pengerjaan split `app.js` secara bertahap. Tujuan akhir: memecah file 13.600+ baris jadi modul-modul per-domain supaya gampang di-maintain dan di-test.

Status keseluruhan: **1/6 fase selesai**

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

## Fase 2 - Ekstrak DB Setup + Migrasi (LOW-MEDIUM RISK)

**Target:** ~800 baris ke `db/`. Tetap satu connection SQLite.

**Commit:** _(belum)_

**Checklist:**
- [ ] `db/connection.js`: init `new sqlite3.Database('./sellvpn.db')`, export `db`.
- [ ] `db/ddl-safe.js`: `isSafeSqlIdent`, `isSafeSqlIdentList`, `ensureSqliteColumn`, `createUniqueIndexIfSafe`, `createUniqueIndexMultiIfSafe`.
- [ ] `db/migrations.js`: semua `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX`, `ensureSqliteColumn` calls. Export `runMigrations(db, logger)`.
- [ ] Update `app.js`: `const db = require('./db/connection')` dan `require('./db/migrations')(db, logger)`.
- [ ] `node --check`, smoke audit, tests, commit, push.

**Catatan:**
- Jangan ubah skema. Cuma pindahkan lokasi.
- `ensureSqliteColumn` dipanggil setelah migration awal — urutan wajib tetap.

---

## Fase 3 - Ekstrak Payment/QRIS (MEDIUM RISK)

**Target:** ~1500 baris ke `payment/`.

**Commit:** _(belum)_

**Checklist:**
- [ ] `payment/gopay.js`: `fetchGopayTransactions`, `generateGopayQris`, `fetchGopayQrisStatus`, `getGopayApiKey`.
- [ ] `payment/qris-invoice.js`: `createQrisInvoice`, `checkQrisInvoiceStatus`, `finalizeQrisPayment`, `applyQrisTopupBonus`.
- [ ] `payment/polling.js`: `startQrisPaymentPolling`, `startAutoTopupMutasi`, `pollQrisPaymentsStartup`, `markQrisStatus`, `getPendingQrisCount`.
- [ ] `payment/deposit.js`: `processDeposit`, `creditDeposit`, `markDepositExpired`, `findAvailableTopupAmount`, `generateRandomAmount`.
- [ ] Pakai factory pattern: `module.exports = ({ db, bot, logger, vars, notifyTopupSuccess }) => ({ ... })`.
- [ ] Update `app.js` untuk init via factory.
- [ ] Test: integration test pakai sqlite `:memory:` untuk flow `processDeposit` → `creditDeposit`.
- [ ] `node --check`, smoke audit, tests, commit, push.

**Catatan:**
- `notifyTopupSuccess` masih di `app.js` (pakai `bot.telegram.sendMessage`). Bisa di-pass sebagai callback.
- Hati-hati dengan `global.pendingDeposits` — tetap shared state. Bisa dibiarkan di `global` atau pindah ke module-scoped Map (preferred).

---

## Fase 4 - Ekstrak Account Service (MEDIUM RISK)

**Target:** ~1500 baris ke `accounts/`.

**Commit:** _(belum)_

**Checklist:**
- [ ] `accounts/service.js`: `processAccountPayment`, `refundAccountPayment`, `recordAccountTransaction`, `upsertAccount`, `recordSaldoTransaction`, `getUserSaldo`.
- [ ] `accounts/actions.js`: wrapper yang call `modules/create.js`, `modules/renew.js`, dll.
- [ ] `accounts/my-accounts.js`: `showMyAccounts`, pagination `myacc_page:*`, handler `accsel/accdel/acclock/accunlock/accrenew`.
- [ ] Update `app.js`: register handler via module.
- [ ] Test: race condition pada `processAccountPayment` (debit saldo tapi provisioning gagal).
- [ ] `node --check`, smoke audit, tests, commit, push.

**Catatan:**
- Handler `bot.action(/^myacc_page:(active|expired|all):(\d+)$/, ...)` harus tetap di-register sebelum `bot.action(/accsel:(\d+)/)` kalau ada overlap.

---

## Fase 5 - Ekstrak Admin Menu (HIGH RISK)

**Target:** ~3000 baris ke `admin/`.

**Commit:** _(belum)_

**Checklist:**
- [ ] `admin/menu.js`: `sendAdminMenu`, `admin_menu` handler, guard helper.
- [ ] `admin/reseller.js`: target menu, bonus menu, `admin_res_*` handler, `renderResellerTargetMenu`, `renderResellerBonusMenu`.
- [ ] `admin/broadcast.js`: `broadcastSessions`, `broadcast_menu` flow, `sendBroadcastFromMenu`, template (manual, maintenance, promo).
- [ ] `admin/server.js`: `addserver`, `editharga`, `editnama`, `editauth`, `editlimitquota`, `editlimitip`, `editlimitcreate`, `edittotalcreate`, detail/delete.
- [ ] `admin/user.js`: `cek_saldo_user`, `riwayat_saldo_user`, `flag_user_start`, `addsaldo`, `minsaldo`, `deluser`, `listuser`, `setflag`, `list_all_users`.
- [ ] `admin/promo.js`: `promo_template_menu`, template catalog/reseller/short/kaisar.
- [ ] Update `app.js`: register semua admin module.
- [ ] Test: admin guard (non-admin tidak boleh akses).
- [ ] `node --check`, smoke audit, tests, commit, push.

**Catatan:**
- Banyak handler share `userState`/`broadcastSessions`/`flow`. Keluarkan ke module `state.js` global.
- Urutan register sensitif: generic `/flag_user_set_..._(\d+)/` harus sebelum handler yang lebih spesifik.
- Smoke audit regex pada `admin_res_bonus_*` dan `admin_menu` harus tetap pass (jangan ubah struktur guard).

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
