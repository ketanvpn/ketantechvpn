// lib/db-async.js
// Promise wrapper untuk sqlite3 callback API. Adopsi gradual:
// callsite baru bisa pakai async/await daripada nested callback hell.
//
// Pemakaian:
//   const { dbRun, dbGet, dbAll, dbExec } = require('./lib/db-async');
//   const row = await dbGet(db, 'SELECT * FROM users WHERE user_id = ?', [id]);
//
// Catatan:
// - `dbRun` return { changes, lastID } supaya call-site bisa cek `this.changes` ala sqlite3 native.
// - `dbGet` return row (object) atau `null` kalau tidak ada.
// - `dbAll` return array (kosong [] kalau tidak ada).
// - `dbExec` untuk multiple statement DDL/migration; tidak return data.
// - Semua function reject dengan Error original sqlite3 (jangan swallow).

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function dbExec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = { dbRun, dbGet, dbAll, dbExec };
