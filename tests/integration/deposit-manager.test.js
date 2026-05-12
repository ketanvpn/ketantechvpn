// Integration test untuk payment/deposit.js dengan DB :memory:.
// Fokus: double-process guard creditDeposit + collision findAvailableTopupAmount.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDepositManager } = require('../../payment/deposit');
const {
  setupMemoryDb,
  closeDb,
  dbGet,
  dbAll,
  dbRun,
  seedUser,
} = require('./helpers');

function makeStubBot() {
  const calls = [];
  return {
    telegram: {
      async sendMessage(chatId, text, extra) {
        calls.push({ type: 'sendMessage', chatId, text, extra });
      },
      async sendPhoto() { calls.push({ type: 'sendPhoto' }); },
      async deleteMessage() {},
    },
    _calls: calls,
  };
}

function makeStubGopayClient() {
  return {
    async fetchTransactions() { return []; },
    async generateQris() { throw new Error('not used'); },
    async fetchQrisStatus() { throw new Error('not used'); },
  };
}

function makeDepsOverrides() {
  return {
    findMatchingSettlementTransaction: () => null,
    parseProviderTransactionTime: () => Date.now(),
    buildDynamicQrisPayload: (base, amount) => base + '-' + amount,
    buildStaticQrisImageUrl: () => 'https://example.invalid/qr.png',
  };
}

test('creditDeposit: dua call paralel → hanya satu yang menambah saldo', async () => {
  const { db, logger } = await setupMemoryDb();
  const bot = makeStubBot();
  const gopay = makeStubGopayClient();

  const dm = createDepositManager({
    db,
    bot,
    logger,
    gopayClient: gopay,
    ...makeDepsOverrides(),
    getTimeZone: () => 'Asia/Jakarta',
    getPaymentTimeoutMin: () => 10,
    getMinMaxTopup: () => ({ min: 1000, max: 500000 }),
    getBaseQr: () => '00020101021126',
    getApiKey: () => 'dummy',
  });

  const userId = 7001;
  const uniqueCode = 'TOPUP-7001-abc';
  await seedUser(db, userId, 0);
  await dbRun(db,
    'INSERT INTO pending_deposits (unique_code, user_id, amount, original_amount, timestamp, status, qr_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uniqueCode, userId, 12345, 10000, Date.now(), 'pending', 999]
  );
  global.pendingDeposits[uniqueCode] = {
    amount: 12345,
    originalAmount: 10000,
    adminFee: 2345,
    userId,
    timestamp: Date.now(),
    status: 'pending',
    qrMessageId: 999,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };

  const matchedTx = { id: 'tx1', time: new Date().toISOString(), issuer: 'gopay', payment_type: 'qris', status: 'SUCCESS' };
  const results = await Promise.allSettled([
    dm.creditDeposit(uniqueCode, matchedTx),
    dm.creditDeposit(uniqueCode, matchedTx),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  assert.equal(fulfilled, 1, 'Tepat satu creditDeposit harus berhasil kredit saldo');

  const user = await dbGet(db, 'SELECT saldo FROM users WHERE user_id = ?', [userId]);
  assert.equal(Number(user.saldo), 10000, 'Saldo user harus naik tepat sekali (10000)');

  const pending = await dbGet(db, 'SELECT status FROM pending_deposits WHERE unique_code = ?', [uniqueCode]);
  assert.equal(pending.status, 'paid');

  const trx = await dbAll(db, 'SELECT * FROM transactions WHERE reference_id = ?', [uniqueCode]);
  assert.equal(trx.length, 1, 'Hanya satu transaksi qris_auto_topup yang boleh tercatat');

  // cleanup global state supaya test lain bersih
  delete global.pendingDeposits[uniqueCode];
  await closeDb(db);
});

test('findAvailableTopupAmount: kalau semua suffix bentrok, fallback ke random last-suffix', async () => {
  const { db, logger } = await setupMemoryDb();
  const bot = makeStubBot();
  const gopay = makeStubGopayClient();

  const dm = createDepositManager({
    db,
    bot,
    logger,
    gopayClient: gopay,
    ...makeDepsOverrides(),
    getTimeZone: () => 'Asia/Jakarta',
    getPaymentTimeoutMin: () => 10,
    getMinMaxTopup: () => ({ min: 1000, max: 500000 }),
    getBaseQr: () => '00020101021126',
    getApiKey: () => 'dummy',
  });

  const baseAmount = 20000;
  // Isi semua suffix 1..3 supaya collision (search range kecil biar pasti bentrok).
  for (let suffix = 1; suffix <= 3; suffix++) {
    await dbRun(db,
      'INSERT INTO pending_deposits (unique_code, user_id, amount, original_amount, timestamp, status, qr_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['TOPUP-clash-' + suffix, 8001, baseAmount + suffix, baseAmount, Date.now(), 'pending', null]
    );
  }

  const { amount, uniqueSuffix } = await dm.findAvailableTopupAmount(baseAmount, 1, 3, 5);
  // Dengan maxAttempts 5 pada range 1..3, semua tried kena clash; fallback ke last random.
  assert.ok(amount === baseAmount + uniqueSuffix, 'amount harus = baseAmount + uniqueSuffix');
  assert.ok(uniqueSuffix >= 1 && uniqueSuffix <= 3, 'suffix tetap di range min-max');

  await closeDb(db);
});

test('findAvailableTopupAmount: suffix tersedia → return candidate non-bentrok', async () => {
  const { db, logger } = await setupMemoryDb();
  const bot = makeStubBot();
  const gopay = makeStubGopayClient();

  const dm = createDepositManager({
    db,
    bot,
    logger,
    gopayClient: gopay,
    ...makeDepsOverrides(),
    getTimeZone: () => 'Asia/Jakarta',
    getPaymentTimeoutMin: () => 10,
    getMinMaxTopup: () => ({ min: 1000, max: 500000 }),
    getBaseQr: () => '00020101021126',
    getApiKey: () => 'dummy',
  });

  const baseAmount = 50000;
  // Isi hanya 1 suffix; range 1..10 masih banyak yang kosong.
  await dbRun(db,
    'INSERT INTO pending_deposits (unique_code, user_id, amount, original_amount, timestamp, status, qr_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['TOPUP-one', 9001, baseAmount + 5, baseAmount, Date.now(), 'pending', null]
  );

  const { amount, uniqueSuffix } = await dm.findAvailableTopupAmount(baseAmount, 1, 10, 20);
  assert.notEqual(uniqueSuffix, 5, 'suffix 5 harus dihindari karena bentrok');
  assert.ok(uniqueSuffix >= 1 && uniqueSuffix <= 10);
  assert.equal(amount, baseAmount + uniqueSuffix);

  await closeDb(db);
});
