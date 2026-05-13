// Integration test: trial_usage SQLite atomic counter.
// Memastikan INSERT ... ON CONFLICT menghitung benar walaupun 2 request paralel,
// menggantikan file JSON trial.db yang ada race-condition.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setupMemoryDb, closeDb, dbGet, dbRun } = require('./helpers');

function saveTrial(db, userId, date) {
  return dbRun(
    db,
    `INSERT INTO trial_usage (user_id, date, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1`,
    [userId, date]
  );
}

test('trial_usage: first insert sets count = 1', async () => {
  const { db } = await setupMemoryDb();
  try {
    await saveTrial(db, 1001, '2026-05-13');
    const row = await dbGet(db, 'SELECT count FROM trial_usage WHERE user_id = ? AND date = ?', [1001, '2026-05-13']);
    assert.equal(row?.count, 1);
  } finally {
    await closeDb(db);
  }
});

test('trial_usage: subsequent inserts increment count atomically', async () => {
  const { db } = await setupMemoryDb();
  try {
    await saveTrial(db, 1001, '2026-05-13');
    await saveTrial(db, 1001, '2026-05-13');
    await saveTrial(db, 1001, '2026-05-13');
    const row = await dbGet(db, 'SELECT count FROM trial_usage WHERE user_id = ? AND date = ?', [1001, '2026-05-13']);
    assert.equal(row?.count, 3);
  } finally {
    await closeDb(db);
  }
});

test('trial_usage: parallel saves all land, final count = concurrent total', async () => {
  const { db } = await setupMemoryDb();
  try {
    await Promise.all(
      Array.from({ length: 10 }, () => saveTrial(db, 1002, '2026-05-13'))
    );
    const row = await dbGet(db, 'SELECT count FROM trial_usage WHERE user_id = ? AND date = ?', [1002, '2026-05-13']);
    assert.equal(row?.count, 10, 'counter harus = jumlah paralel (tidak hilang)');
  } finally {
    await closeDb(db);
  }
});

test('trial_usage: different dates = independent counters', async () => {
  const { db } = await setupMemoryDb();
  try {
    await saveTrial(db, 1003, '2026-05-13');
    await saveTrial(db, 1003, '2026-05-14');
    await saveTrial(db, 1003, '2026-05-14');
    const d1 = await dbGet(db, 'SELECT count FROM trial_usage WHERE user_id = ? AND date = ?', [1003, '2026-05-13']);
    const d2 = await dbGet(db, 'SELECT count FROM trial_usage WHERE user_id = ? AND date = ?', [1003, '2026-05-14']);
    assert.equal(d1?.count, 1);
    assert.equal(d2?.count, 2);
  } finally {
    await closeDb(db);
  }
});

test('trial_usage: different users = independent counters', async () => {
  const { db } = await setupMemoryDb();
  try {
    await saveTrial(db, 2001, '2026-05-13');
    await saveTrial(db, 2002, '2026-05-13');
    await saveTrial(db, 2001, '2026-05-13');
    const u1 = await dbGet(db, 'SELECT count FROM trial_usage WHERE user_id = ? AND date = ?', [2001, '2026-05-13']);
    const u2 = await dbGet(db, 'SELECT count FROM trial_usage WHERE user_id = ? AND date = ?', [2002, '2026-05-13']);
    assert.equal(u1?.count, 2);
    assert.equal(u2?.count, 1);
  } finally {
    await closeDb(db);
  }
});
