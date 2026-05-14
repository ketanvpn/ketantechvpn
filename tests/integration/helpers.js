// tests/integration/helpers.js - bootstrap DB in-memory untuk integration test.

const { createConnection } = require('../../db/connection');
const { createDdlHelpers } = require('../../db/ddl-safe');
const { runMigrations } = require('../../db/migrations');
const { dbRun, dbGet, dbAll } = require('../../lib/db-async');

function silentLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

async function setupMemoryDb() {
  const logger = silentLogger();
  const db = createConnection(':memory:', logger);
  const helpers = createDdlHelpers(db, logger);
  runMigrations(db, logger, helpers);

  // runMigrations pakai db.run async; tunggu sampai semua statement selesai
  // dengan cara flush serialize queue pakai COMMIT dummy.
  await new Promise((resolve) => {
    db.serialize(() => {
      db.run('SELECT 1', () => resolve());
    });
  });

  return { db, logger };
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function seedUser(db, userId, saldo = 0) {
  await dbRun(db, 'INSERT OR IGNORE INTO users (user_id, saldo) VALUES (?, ?)', [userId, saldo]);
  await dbRun(db, 'UPDATE users SET saldo = ? WHERE user_id = ?', [saldo, userId]);
}

module.exports = {
  setupMemoryDb,
  closeDb,
  dbRun,
  dbGet,
  dbAll,
  seedUser,
  silentLogger,
};
