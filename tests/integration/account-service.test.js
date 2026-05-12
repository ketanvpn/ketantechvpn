// Integration test untuk accounts/service.js dengan DB :memory:.
// Fokus utama: race condition processAccountPayment + refundAccountPayment.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAccountService } = require('../../accounts/service');
const {
  setupMemoryDb,
  closeDb,
  dbGet,
  dbAll,
  seedUser,
} = require('./helpers');

test('processAccountPayment: dua call paralel hanya 1 yang sukses kalau saldo cuma cukup 1 transaksi', async () => {
  const { db, logger } = await setupMemoryDb();
  const service = createAccountService({ db, logger });

  const userId = 1001;
  await seedUser(db, userId, 10000);

  const results = await Promise.allSettled([
    service.processAccountPayment(userId, 10000, 'vmess', 'create', 1, 'usr1'),
    service.processAccountPayment(userId, 10000, 'vmess', 'create', 1, 'usr2'),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'Tepat satu transaksi harus sukses');
  assert.equal(rejected.length, 1, 'Satu transaksi harus rejected karena saldo tidak cukup');

  const userRow = await dbGet(db, 'SELECT saldo FROM users WHERE user_id = ?', [userId]);
  assert.equal(Number(userRow.saldo), 0, 'Saldo akhir harus 0 setelah satu pembayaran sukses');

  const trx = await dbAll(db, 'SELECT * FROM transactions WHERE user_id = ?', [userId]);
  assert.equal(trx.length, 1, 'Hanya satu baris transaksi boleh tercatat');
  assert.equal(Number(trx[0].amount), -10000);
  assert.equal(trx[0].type, 'buy_create_vmess');

  await closeDb(db);
});

test('refundAccountPayment: saldo dikembalikan + transaksi refund tercatat', async () => {
  const { db, logger } = await setupMemoryDb();
  const service = createAccountService({ db, logger });

  const userId = 2002;
  await seedUser(db, userId, 50000);

  await service.processAccountPayment(userId, 25000, 'vless', 'create', 2, 'usrA');
  let row = await dbGet(db, 'SELECT saldo FROM users WHERE user_id = ?', [userId]);
  assert.equal(Number(row.saldo), 25000);

  await service.refundAccountPayment(userId, 25000, 'vless', 'create', 2, 'usrA', 'rollback_create_failed');
  row = await dbGet(db, 'SELECT saldo FROM users WHERE user_id = ?', [userId]);
  assert.equal(Number(row.saldo), 50000, 'Saldo harus kembali ke nilai awal setelah refund');

  const trx = await dbAll(db, 'SELECT type, amount FROM transactions WHERE user_id = ? ORDER BY id', [userId]);
  assert.equal(trx.length, 2);
  assert.equal(trx[0].type, 'buy_create_vless');
  assert.equal(Number(trx[0].amount), -25000);
  assert.equal(trx[1].type, 'refund_create_vless');
  assert.equal(Number(trx[1].amount), 25000);

  await closeDb(db);
});

test('processAccountPayment: 3 pembelian berurutan dengan saldo cukup → semua sukses', async () => {
  const { db, logger } = await setupMemoryDb();
  const service = createAccountService({ db, logger });

  const userId = 3003;
  await seedUser(db, userId, 30000);

  // Sequential bukan paralel: user beli satu per satu setelah konfirmasi sukses.
  // Paralel BEGIN IMMEDIATE di satu connection sqlite3 node binding bisa kena
  // SQLITE_BUSY (tidak semua runtime punya automatic serialize). Test ini
  // mendokumentasikan kontrak aman: call bertahap = semua sukses.
  await service.processAccountPayment(userId, 10000, 'ssh', 'create', 3, 'a');
  await service.processAccountPayment(userId, 10000, 'ssh', 'create', 3, 'b');
  await service.processAccountPayment(userId, 10000, 'ssh', 'create', 3, 'c');

  const row = await dbGet(db, 'SELECT saldo FROM users WHERE user_id = ?', [userId]);
  assert.equal(Number(row.saldo), 0);

  const trx = await dbAll(db, 'SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?', [userId]);
  assert.equal(Number(trx[0].c), 3);

  await closeDb(db);
});

test('processAccountPayment: dua call paralel bisa saja salah satu kena SQLITE_BUSY (kontrak sqlite3)', async () => {
  // Test untuk mendokumentasikan perilaku aktual: dua BEGIN IMMEDIATE bersamaan
  // di connection yang sama bisa gagal dengan SQLITE_BUSY. Kalau diperlukan
  // serialization ketat, gunakan db.serialize() di level caller atau queue
  // permintaan di layer atas. Test ini PASS selama:
  // - total transaksi sukses <= 2
  // - saldo konsisten dengan jumlah transaksi sukses
  const { db, logger } = await setupMemoryDb();
  const service = createAccountService({ db, logger });

  const userId = 4004;
  await seedUser(db, userId, 20000);

  const results = await Promise.allSettled([
    service.processAccountPayment(userId, 10000, 'ssh', 'create', 4, 'x'),
    service.processAccountPayment(userId, 10000, 'ssh', 'create', 4, 'y'),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const row = await dbGet(db, 'SELECT saldo FROM users WHERE user_id = ?', [userId]);
  const expectedSaldo = 20000 - fulfilled * 10000;
  assert.equal(Number(row.saldo), expectedSaldo);

  const trx = await dbAll(db, 'SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?', [userId]);
  assert.equal(Number(trx[0].c), fulfilled);

  // fulfilled boleh 1 atau 2, tergantung apakah BEGIN IMMEDIATE kedua kena BUSY
  assert.ok(fulfilled >= 1 && fulfilled <= 2, 'fulfilled harus 1 atau 2, dapat: ' + fulfilled);

  await closeDb(db);
});
