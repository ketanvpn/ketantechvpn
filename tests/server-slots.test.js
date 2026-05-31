const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { createServerSlotManager } = require('../lib/server-slots');

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

async function makeDb(total = 0, limit = 2) {
  const db = new sqlite3.Database(':memory:');
  await dbRun(db, 'CREATE TABLE Server (id INTEGER PRIMARY KEY, total_create_akun INTEGER, batas_create_akun INTEGER)');
  await dbRun(db, 'INSERT INTO Server (id, total_create_akun, batas_create_akun) VALUES (1, ?, ?)', [total, limit]);
  return db;
}

test('reserveCreateSlot increments when server has capacity', async () => {
  const db = await makeDb(0, 2);
  const manager = createServerSlotManager({ db, logger: { error() {} } });

  assert.equal(await manager.reserveCreateSlot('create', 1), true);
  const row = await dbGet(db, 'SELECT total_create_akun FROM Server WHERE id = 1');
  assert.equal(row.total_create_akun, 1);
  db.close();
});

test('reserveCreateSlot returns false when server is full', async () => {
  const db = await makeDb(2, 2);
  const manager = createServerSlotManager({ db, logger: { error() {} } });

  assert.equal(await manager.reserveCreateSlot('create', 1), false);
  const row = await dbGet(db, 'SELECT total_create_akun FROM Server WHERE id = 1');
  assert.equal(row.total_create_akun, 2);
  db.close();
});

test('reserveCreateSlot non-create is no-op success', async () => {
  const db = await makeDb(0, 2);
  const manager = createServerSlotManager({ db, logger: { error() {} } });

  assert.equal(await manager.reserveCreateSlot('renew', 1), true);
  const row = await dbGet(db, 'SELECT total_create_akun FROM Server WHERE id = 1');
  assert.equal(row.total_create_akun, 0);
  db.close();
});

test('releaseCreateSlot decrements reserved slot and returns false', async () => {
  const db = await makeDb(1, 2);
  const manager = createServerSlotManager({ db, logger: { error() {} } });

  assert.equal(await manager.releaseCreateSlot('create', 1, true), false);
  const row = await dbGet(db, 'SELECT total_create_akun FROM Server WHERE id = 1');
  assert.equal(row.total_create_akun, 0);
  db.close();
});

test('releaseCreateSlot never decrements below zero and no-ops when not reserved', async () => {
  const db = await makeDb(0, 2);
  const manager = createServerSlotManager({ db, logger: { error() {} } });

  assert.equal(await manager.releaseCreateSlot('create', 1, true), false);
  assert.equal(await manager.releaseCreateSlot('create', 1, false), false);
  assert.equal(await manager.releaseCreateSlot('renew', 1, true), false);
  const row = await dbGet(db, 'SELECT total_create_akun FROM Server WHERE id = 1');
  assert.equal(row.total_create_akun, 0);
  db.close();
});
