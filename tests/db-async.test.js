// Unit test untuk lib/db-async.js - promise wrapper sqlite3.
// Pakai DB :memory: dari sqlite3 native (bukan helper integration).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { dbRun, dbGet, dbAll, dbExec } = require('../lib/db-async');

function makeDb() {
  return new sqlite3.Database(':memory:');
}

function close(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

test('dbRun: insert returns lastID + changes', async () => {
  const db = makeDb();
  await dbExec(db, 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
  const r1 = await dbRun(db, 'INSERT INTO t (name) VALUES (?)', ['alice']);
  assert.equal(r1.changes, 1);
  assert.equal(r1.lastID, 1);
  const r2 = await dbRun(db, 'INSERT INTO t (name) VALUES (?)', ['bob']);
  assert.equal(r2.lastID, 2);
  await close(db);
});

test('dbGet: returns row object atau null', async () => {
  const db = makeDb();
  await dbExec(db, 'CREATE TABLE t (id INTEGER, val TEXT)');
  await dbRun(db, 'INSERT INTO t VALUES (?, ?)', [1, 'hello']);
  const found = await dbGet(db, 'SELECT * FROM t WHERE id = ?', [1]);
  assert.equal(found.val, 'hello');
  const missing = await dbGet(db, 'SELECT * FROM t WHERE id = ?', [99]);
  assert.equal(missing, null);
  await close(db);
});

test('dbAll: returns array (kosong [] kalau tidak ada)', async () => {
  const db = makeDb();
  await dbExec(db, 'CREATE TABLE t (id INTEGER, val TEXT)');
  await dbRun(db, 'INSERT INTO t VALUES (?, ?)', [1, 'a']);
  await dbRun(db, 'INSERT INTO t VALUES (?, ?)', [2, 'b']);
  const rows = await dbAll(db, 'SELECT * FROM t ORDER BY id');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].val, 'a');
  const empty = await dbAll(db, 'SELECT * FROM t WHERE id > 99');
  assert.deepEqual(empty, []);
  await close(db);
});

test('dbRun: reject pada SQL error', async () => {
  const db = makeDb();
  await assert.rejects(dbRun(db, 'INSERT INTO nonexistent VALUES (?)', [1]));
  await close(db);
});

test('dbExec: jalankan multi-statement DDL', async () => {
  const db = makeDb();
  await dbExec(db, 'CREATE TABLE a (id INT); CREATE TABLE b (id INT);');
  await dbRun(db, 'INSERT INTO a VALUES (1)');
  await dbRun(db, 'INSERT INTO b VALUES (2)');
  const aRow = await dbGet(db, 'SELECT * FROM a');
  const bRow = await dbGet(db, 'SELECT * FROM b');
  assert.equal(aRow.id, 1);
  assert.equal(bRow.id, 2);
  await close(db);
});
