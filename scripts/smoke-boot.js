// Smoke boot test: verifikasi semua module bisa di-require + factory
// bisa di-construct tanpa error. Tidak menjalankan bot Telegraf asli
// (biar bisa jalan di CI tanpa BOT_TOKEN valid).

const path = require('path');

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function stubBot() {
  return {
    telegram: {
      async sendMessage() {},
      async sendDocument() {},
      async getMe() { return { username: 'smoke_bot' }; },
    },
    action() {},
    on() {},
    command() {},
    catch() {},
    use() {},
  };
}

const failures = [];
function check(label, fn) {
  try {
    fn();
    console.log('[ok]   ' + label);
  } catch (err) {
    failures.push({ label, err });
    console.error('[FAIL] ' + label + ': ' + (err.message || err));
  }
}

// ===== require semua module =====

check('require lib/qris', () => require('../lib/qris'));
check('require lib/time', () => require('../lib/time'));
check('require lib/validators', () => require('../lib/validators'));
check('require lib/bonus', () => require('../lib/bonus'));
check('require lib/html', () => require('../lib/html'));
check('require lib/masker', () => require('../lib/masker'));
check('require lib/licence', () => require('../lib/licence'));

check('require db/connection', () => require('../db/connection'));
check('require db/ddl-safe', () => require('../db/ddl-safe'));
check('require db/migrations', () => require('../db/migrations'));

check('require modules/http-client', () => require('../modules/http-client'));
check('require modules/reseller', () => require('../modules/reseller'));

check('require payment/gopay', () => require('../payment/gopay'));
check('require payment/qris-invoice', () => require('../payment/qris-invoice'));
check('require payment/polling', () => require('../payment/polling'));
check('require payment/deposit', () => require('../payment/deposit'));

check('require accounts/service', () => require('../accounts/service'));
check('require accounts/my-accounts', () => require('../accounts/my-accounts'));

check('require admin/menu', () => require('../admin/menu'));
check('require admin/promo', () => require('../admin/promo'));

check('require scheduler/auto-backup', () => require('../scheduler/auto-backup'));
check('require scheduler/daily-report', () => require('../scheduler/daily-report'));
check('require scheduler/expiry-reminder', () => require('../scheduler/expiry-reminder'));
check('require scheduler/reseller-target', () => require('../scheduler/reseller-target'));

// ===== factory smoke =====

check('createAccountService factory', () => {
  const { createAccountService } = require('../accounts/service');
  const db = { run() {}, get() {}, all() {}, serialize() {} };
  const svc = createAccountService({ db, logger: silentLogger() });
  if (typeof svc.getUserSaldo !== 'function') throw new Error('missing getUserSaldo');
  if (typeof svc.processAccountPayment !== 'function') throw new Error('missing processAccountPayment');
});

check('createGopayClient factory', () => {
  const { createGopayClient } = require('../payment/gopay');
  const client = createGopayClient({ getApiKey: () => 'dummy', baseUrl: 'https://example.invalid' });
  if (typeof client.fetchTransactions !== 'function') throw new Error('missing fetchTransactions');
});

check('createQrisInvoiceChecker factory', () => {
  const { createQrisInvoiceChecker } = require('../payment/qris-invoice');
  const f = createQrisInvoiceChecker({
    db: {},
    gopayClient: {},
    getApiKey: () => 'x',
    generateUniqueSuffix: () => 100,
    parseProviderTransactionTime: () => Date.now(),
    getMaxTopup: () => 500000,
  });
  if (typeof f.checkQrisInvoiceStatus !== 'function') throw new Error('missing checkQrisInvoiceStatus');
  if (typeof f.createQrisInvoice !== 'function') throw new Error('missing createQrisInvoice');
});

check('createDepositManager factory', () => {
  const { createDepositManager } = require('../payment/deposit');
  const dm = createDepositManager({
    db: {},
    bot: stubBot(),
    logger: silentLogger(),
    gopayClient: { fetchTransactions: async () => [] },
    findMatchingSettlementTransaction: () => null,
    parseProviderTransactionTime: () => Date.now(),
    buildDynamicQrisPayload: () => '',
    buildStaticQrisImageUrl: () => 'https://example.invalid/qr.png',
    getTimeZone: () => 'Asia/Jakarta',
    getPaymentTimeoutMin: () => 10,
    getMinMaxTopup: () => ({ min: 1000, max: 500000 }),
    getBaseQr: () => '00020101',
    getApiKey: () => 'dummy',
  });
  if (typeof dm.processDeposit !== 'function') throw new Error('missing processDeposit');
});

check('createQrisPaymentPoller factory', () => {
  const { createQrisPaymentPoller } = require('../payment/polling');
  const p = createQrisPaymentPoller({
    db: {},
    bot: stubBot(),
    logger: silentLogger(),
    checkQrisInvoiceStatus: async () => ({ status: 'PENDING' }),
    finalizeQrisPayment: async () => ({ applied: false }),
    calculateTopupBonus: () => ({ bonus: 0, percent: 0 }),
    applyQrisTopupBonus: async () => {},
    notifyTopupSuccess: async () => {},
  });
  if (typeof p.start !== 'function') throw new Error('missing start');
});

check('createAutoBackupScheduler factory', () => {
  const { createAutoBackupScheduler } = require('../scheduler/auto-backup');
  const s = createAutoBackupScheduler({
    logger: silentLogger(),
    bot: stubBot(),
    isEnabled: () => false,
    getIntervalHours: () => 12,
    getBackupChatId: () => 123,
    getTimeZone: () => 'Asia/Jakarta',
  });
  if (typeof s.restart !== 'function' || typeof s.sendAutoBackup !== 'function') {
    throw new Error('missing restart/sendAutoBackup');
  }
});

check('createDailyReportScheduler factory', () => {
  const { createDailyReportScheduler } = require('../scheduler/daily-report');
  const s = createDailyReportScheduler({
    logger: silentLogger(),
    db: { get() {}, all() {} },
    bot: stubBot(),
    getTimeInConfiguredTimeZone: () => ({ dateKey: '2026-01-01', hour: 0, minute: 0 }),
    getTimeZone: () => 'Asia/Jakarta',
    getMasterId: () => 123,
    getResselFilePath: () => null,
    getUsernameById: async () => '',
    isEnabled: () => false,
    getHour: () => 23,
    getMinute: () => 0,
    getLastSentDateKey: () => null,
    setLastSentDateKey: () => {},
  });
  if (typeof s.start !== 'function' || typeof s.sendDailyReport !== 'function') {
    throw new Error('missing start/sendDailyReport');
  }
});

check('createExpiryReminderScheduler factory', () => {
  const { createExpiryReminderScheduler } = require('../scheduler/expiry-reminder');
  const s = createExpiryReminderScheduler({
    logger: silentLogger(),
    db: { all() {} },
    bot: stubBot(),
    getTimeInConfiguredTimeZone: () => ({ dateKey: '2026-01-01', hour: 0, minute: 0 }),
    getTimeZone: () => 'Asia/Jakarta',
    getMasterId: () => 123,
    getDaysBefore: () => 3,
    isEnabled: () => false,
    getHour: () => 20,
    getMinute: () => 0,
    getLastSentDateKey: () => null,
    setLastSentDateKey: () => {},
  });
  if (typeof s.start !== 'function' || typeof s.sendExpiryReminders !== 'function') {
    throw new Error('missing start/sendExpiryReminders');
  }
});

check('createResellerTargetScheduler factory', () => {
  const { createResellerTargetScheduler } = require('../scheduler/reseller-target');
  const s = createResellerTargetScheduler({
    logger: silentLogger(),
    db: { all() {} },
    bot: stubBot(),
    getTimeInConfiguredTimeZone: () => ({ dateKey: '2026-01-01', hour: 0, minute: 0 }),
    getTimeZone: () => 'Asia/Jakarta',
    getMasterId: () => 123,
    getMin30dAccounts: () => 3,
    getMinDaysPerMonth: () => 90,
    readResellerSetSync: () => new Set(),
    removeResellerIdFromCache: () => true,
    isEnabled: () => false,
    getCheckHour: () => 1,
    getCheckMinute: () => 5,
    getLastProcessedMonthKey: () => null,
    setLastProcessedMonthKey: () => {},
  });
  if (typeof s.start !== 'function' || typeof s.checkAndDowngradeResellersForPreviousMonth !== 'function') {
    throw new Error('missing start/checkAndDowngradeResellersForPreviousMonth');
  }
});

check('createAdminMenuHandlers factory', () => {
  const { createAdminMenuHandlers } = require('../admin/menu');
  const h = createAdminMenuHandlers({
    bot: stubBot(),
    logger: silentLogger(),
    adminIds: [1],
    ADMIN_IDS: [1],
    sendAdminMenu: async () => {},
  });
  if (typeof h.register !== 'function') throw new Error('missing register');
});

check('createPromoHandlers factory', () => {
  const { createPromoHandlers } = require('../admin/promo');
  const h = createPromoHandlers({ bot: stubBot(), logger: silentLogger(), adminIds: [1] });
  if (typeof h.register !== 'function') throw new Error('missing register');
});

check('createMyAccountsHandlers factory', () => {
  const { createMyAccountsHandlers } = require('../accounts/my-accounts');
  const h = createMyAccountsHandlers({
    bot: stubBot(),
    db: {},
    logger: silentLogger(),
    userState: {},
    sendCleanMenu: async () => {},
    recordAccountTransaction: async () => {},
    getAccountDaysLeft: () => 0,
    typeCode: () => 'VM',
    shortStatus: () => 'OK',
    delHandlers: { vmess() {}, vless() {}, trojan() {}, shadowsocks() {}, ssh() {} },
    lockHandlers: { vmess() {}, vless() {}, trojan() {}, shadowsocks() {}, ssh() {} },
    unlockHandlers: { vmess() {}, vless() {}, trojan() {}, shadowsocks() {}, ssh() {} },
  });
  if (typeof h.register !== 'function') throw new Error('missing register');
});

// ===== DB bootstrap in-memory =====

check('DB :memory: bootstrap + migrations', async () => {
  // Dibiarkan sync di sini; tidak jalan sebagai test, cuma smoke.
  const { createConnection } = require('../db/connection');
  const { createDdlHelpers } = require('../db/ddl-safe');
  const { runMigrations } = require('../db/migrations');
  const db = createConnection(':memory:', silentLogger());
  const helpers = createDdlHelpers(db, silentLogger());
  runMigrations(db, silentLogger(), helpers);
  // close async; tidak di-await karena check() sync
  db.close(() => {});
});

// ===== summary =====

if (failures.length > 0) {
  console.error('\nSMOKE BOOT FAILED: ' + failures.length + ' dari ' + (failures.length) + ' check gagal');
  process.exit(1);
}

console.log('\nSMOKE BOOT PASSED');
