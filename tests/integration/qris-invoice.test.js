// Integration test untuk payment/qris-invoice.js (createQrisInvoice +
// checkQrisInvoiceStatus). Body-nya baru saja dipindah dari app.js — test
// ini verifikasi suffix clamping, provider status mapping, dan grace period.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createQrisInvoiceChecker } = require('../../payment/qris-invoice');
const { setupMemoryDb, closeDb, dbRun } = require('./helpers');

function stubGopayClient(overrides = {}) {
  return {
    async fetchTransactions() { return []; },
    async generateQris(amount) {
      return {
        order_id: 'GOPAY-TEST-' + amount,
        qr_url: 'https://example.invalid/qr.png',
        qr_string: 'QRIS-' + amount,
        expiry_time: null,
        transaction_id: 'tx-' + amount,
        transaction_time: null,
        transaction_status: 'pending',
        ...overrides.generated,
      };
    },
    async fetchQrisStatus(txid) {
      const status = overrides.providerStatus || 'pending';
      return {
        success: status === 'settlement',
        data: {
          transaction_id: txid,
          transaction_status: status,
          transaction_time: overrides.providerTime || null,
        },
      };
    },
  };
}

function baseDeps(gopayClient) {
  return {
    gopayClient: gopayClient || stubGopayClient(),
    getApiKey: () => 'dummy-key',
    generateUniqueSuffix: () => 120, // suffix default biar deterministik
    parseProviderTransactionTime: (raw) => {
      if (!raw) return null;
      const n = Date.parse(String(raw).replace(' ', 'T'));
      return Number.isFinite(n) ? n : null;
    },
    getMaxTopup: () => 500000,
    paymentTimeoutMin: 10,
  };
}

// ===== createQrisInvoice =====

test('createQrisInvoice: forcedUniqueSuffix=null → suffix 0 (carry-over behavior)', async () => {
  // CATATAN: ini mendokumentasikan perilaku aktual sejak app.js asli.
  // `Number(null) === 0` + `Number.isFinite(0) === true`, jadi default param
  // `forcedUniqueSuffix = null` di-treat sebagai suffix 0 (bukan fallback ke
  // generateUniqueSuffix). Sebagai akibatnya, caller di app.js (line 9364) yang
  // tidak pass arg ketiga akan dapat amount = baseAmount flat tanpa randomisasi.
  // Ini bug pre-existing yang TIDAK diperbaiki saat refactor (di luar scope).
  const { db } = await setupMemoryDb();
  const checker = createQrisInvoiceChecker({ db, ...baseDeps() });

  const inv = await checker.createQrisInvoice(20000, 'topup test');
  assert.equal(inv.base_amount, 20000);
  assert.equal(inv.unique_suffix, 0);
  assert.equal(inv.amount, 20000);
  assert.equal(inv.provider_payment_type, 'qris');
  assert.equal(inv.provider_issuer, 'gopay');
  assert.ok(inv.invoice_id.startsWith('GOPAY-TEST-'));

  await closeDb(db);
});

test('createQrisInvoice: forcedUniqueSuffix angka eksplisit → dipakai apa adanya', async () => {
  const { db } = await setupMemoryDb();
  const checker = createQrisInvoiceChecker({ db, ...baseDeps() });

  const inv = await checker.createQrisInvoice(20000, 'force', 120);
  assert.equal(inv.unique_suffix, 120);
  assert.equal(inv.amount, 20120);

  await closeDb(db);
});

test('createQrisInvoice: forcedUniqueSuffix override', async () => {
  const { db } = await setupMemoryDb();
  const checker = createQrisInvoiceChecker({ db, ...baseDeps() });

  const inv = await checker.createQrisInvoice(15000, 'custom suffix', 77);
  assert.equal(inv.unique_suffix, 77);
  assert.equal(inv.amount, 15077);

  await closeDb(db);
});

test('createQrisInvoice: clamp amount kalau melebihi max (diff >= 50)', async () => {
  const { db } = await setupMemoryDb();
  const deps = baseDeps();
  deps.getMaxTopup = () => 500100;
  const checker = createQrisInvoiceChecker({ db, ...deps });

  // base 500000 + suffix 200 = 500200 > max 500100. diff = 100 -> clamp suffix ke 100.
  // Pakai forcedUniqueSuffix eksplisit supaya bypass bug null-default.
  const inv = await checker.createQrisInvoice(500000, 'clamp', 200);
  assert.equal(inv.unique_suffix, 100);
  assert.equal(inv.amount, 500100);

  await closeDb(db);
});

test('createQrisInvoice: kalau diff < 50, suffix di-nol-kan & pakai amount = base', async () => {
  const { db } = await setupMemoryDb();
  const deps = baseDeps();
  deps.getMaxTopup = () => 500020; // diff hanya 20
  const checker = createQrisInvoiceChecker({ db, ...deps });

  const inv = await checker.createQrisInvoice(500000, 'small-diff', 200);
  assert.equal(inv.unique_suffix, 0);
  assert.equal(inv.amount, 500000);

  await closeDb(db);
});

test('createQrisInvoice: error kalau base amount invalid', async () => {
  const { db } = await setupMemoryDb();
  const checker = createQrisInvoiceChecker({ db, ...baseDeps() });

  await assert.rejects(() => checker.createQrisInvoice(-100), /Nominal baseAmount tidak valid/);
  await assert.rejects(() => checker.createQrisInvoice('abc'), /Nominal baseAmount tidak valid/);

  await closeDb(db);
});

test('createQrisInvoice: error kalau getApiKey return empty', async () => {
  const { db } = await setupMemoryDb();
  const deps = baseDeps();
  deps.getApiKey = () => '';
  const checker = createQrisInvoiceChecker({ db, ...deps });

  await assert.rejects(() => checker.createQrisInvoice(10000), /GOPAY_API_KEY belum diisi/);

  await closeDb(db);
});

// ===== checkQrisInvoiceStatus =====

async function seedInvoice(db, overrides = {}) {
  const defaults = {
    invoice_id: 'INV-1',
    user_id: 100,
    amount: 20120,
    base_amount: 20000,
    unique_suffix: 120,
    status: 'pending',
    created_at: Date.now(),
    provider_tx_id: null,
  };
  const row = { ...defaults, ...overrides };
  await dbRun(db,
    'INSERT INTO qris_payments (user_id, invoice_id, amount, base_amount, unique_suffix, status, created_at, provider_tx_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [row.user_id, row.invoice_id, row.amount, row.base_amount, row.unique_suffix, row.status, row.created_at, row.provider_tx_id]
  );
  return row;
}

test('checkQrisInvoiceStatus: invoice tidak ditemukan → throw', async () => {
  const { db } = await setupMemoryDb();
  const checker = createQrisInvoiceChecker({ db, ...baseDeps() });

  await assert.rejects(
    () => checker.checkQrisInvoiceStatus('NOT-EXIST', 10000, Date.now()),
    /tidak ditemukan di database/
  );

  await closeDb(db);
});

test('checkQrisInvoiceStatus: invoice tanpa provider_tx_id → PENDING sampai lewat grace', async () => {
  const { db } = await setupMemoryDb();
  const checker = createQrisInvoiceChecker({ db, ...baseDeps() });

  // Fresh invoice (belum expired)
  const fresh = await seedInvoice(db, { invoice_id: 'INV-FRESH', created_at: Date.now() });
  const res1 = await checker.checkQrisInvoiceStatus(fresh.invoice_id, fresh.amount, fresh.created_at);
  assert.equal(res1.status, 'PENDING');

  // Stale invoice (created 20 menit lalu, timeout 10m + grace 2m = 12m < 20m → EXPIRED)
  const twentyMinAgo = Date.now() - 20 * 60 * 1000;
  const stale = await seedInvoice(db, { invoice_id: 'INV-STALE', created_at: twentyMinAgo });
  const res2 = await checker.checkQrisInvoiceStatus(stale.invoice_id, stale.amount, stale.created_at);
  assert.equal(res2.status, 'EXPIRED');

  await closeDb(db);
});

test('checkQrisInvoiceStatus: provider settlement → PAID', async () => {
  const { db } = await setupMemoryDb();
  const deps = baseDeps(stubGopayClient({ providerStatus: 'settlement', providerTime: '2026-05-13 12:00:00' }));
  const checker = createQrisInvoiceChecker({ db, ...deps });

  const row = await seedInvoice(db, { invoice_id: 'INV-PAID', provider_tx_id: 'tx-paid-1' });
  const res = await checker.checkQrisInvoiceStatus(row.invoice_id, row.amount, row.created_at);

  assert.equal(res.status, 'PAID');
  assert.ok(res.transaction, 'transaction harus ada');
  assert.equal(res.transaction.payment_type, 'qris');
  assert.equal(res.transaction.issuer, 'gopay');

  await closeDb(db);
});

test('checkQrisInvoiceStatus: provider expire → EXPIRED', async () => {
  const { db } = await setupMemoryDb();
  const deps = baseDeps(stubGopayClient({ providerStatus: 'expire' }));
  const checker = createQrisInvoiceChecker({ db, ...deps });

  const row = await seedInvoice(db, { invoice_id: 'INV-EXP', provider_tx_id: 'tx-exp-1' });
  const res = await checker.checkQrisInvoiceStatus(row.invoice_id, row.amount, row.created_at);
  assert.equal(res.status, 'EXPIRED');

  await closeDb(db);
});

test('checkQrisInvoiceStatus: provider cancel → CANCELED', async () => {
  const { db } = await setupMemoryDb();
  const deps = baseDeps(stubGopayClient({ providerStatus: 'cancel' }));
  const checker = createQrisInvoiceChecker({ db, ...deps });

  const row = await seedInvoice(db, { invoice_id: 'INV-CNC', provider_tx_id: 'tx-cnc-1' });
  const res = await checker.checkQrisInvoiceStatus(row.invoice_id, row.amount, row.created_at);
  assert.equal(res.status, 'CANCELED');

  await closeDb(db);
});

test('checkQrisInvoiceStatus: provider pending + belum lewat grace → PENDING', async () => {
  const { db } = await setupMemoryDb();
  const deps = baseDeps(stubGopayClient({ providerStatus: 'pending' }));
  const checker = createQrisInvoiceChecker({ db, ...deps });

  const row = await seedInvoice(db, { invoice_id: 'INV-PND', provider_tx_id: 'tx-pnd-1', created_at: Date.now() });
  const res = await checker.checkQrisInvoiceStatus(row.invoice_id, row.amount, row.created_at);
  assert.equal(res.status, 'PENDING');

  await closeDb(db);
});
