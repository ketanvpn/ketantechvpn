// Smoke integration test: bootstrap DB :memory: + verifikasi semua table utama dibuat.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupMemoryDb, dbAll, closeDb } = require('./helpers');

test('bootstrap DB in-memory membuat semua table utama', async () => {
  const { db } = await setupMemoryDb();

  const rows = await dbAll(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const names = rows.map((r) => r.name);

  for (const expected of [
    'Server',
    'accounts',
    'pending_deposits',
    'qris_payments',
    'reseller_bonus_logs',
    'transactions',
    'users',
  ]) {
    assert.ok(names.includes(expected), 'Table hilang: ' + expected + ' (ada: ' + names.join(',') + ')');
  }

  await closeDb(db);
});
