// tests/error-logger.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const sqlite3 = require('sqlite3');
const { logError, getErrorLogs, getErrorCount } = require('../lib/error-logger');
const { runMigrations } = require('../db/migrations');
const { createDdlHelpers } = require('../db/ddl-safe');

// Mock logger minimal
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

test('error-logger: logError simpan error dengan context object', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);

  // Wait migrations selesai
  await new Promise((resolve) => setTimeout(resolve, 100));

  const source = 'payment/deposit';
  const error = new Error('Insufficient balance');
  const context = { userId: 123, amount: 50000 };

  const result = await logError(db, source, error, context);
  assert.strictEqual(result.changes, 1, 'Should insert 1 row');
  assert.ok(result.lastID > 0, 'Should return lastID');

  // Verify data tersimpan
  const logs = await getErrorLogs(db, { source, limit: 10 });
  assert.strictEqual(logs.length, 1, 'Should have 1 error log');
  assert.strictEqual(logs[0].source, source);
  assert.strictEqual(logs[0].error_message, 'Insufficient balance');
  assert.strictEqual(logs[0].context, JSON.stringify(context));
  assert.ok(logs[0].timestamp > 0);

  db.close();
});

test('error-logger: logError simpan error string', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const source = 'bot.action.addserver';
  const error = 'Validation failed: domain required';

  await logError(db, source, error);

  const logs = await getErrorLogs(db, { source });
  assert.strictEqual(logs[0].error_message, error);
  assert.strictEqual(logs[0].context, '');

  db.close();
});

test('error-logger: getErrorLogs filter by source', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  await logError(db, 'payment/deposit', new Error('Error 1'));
  await logError(db, 'scheduler/daily-report', new Error('Error 2'));
  await logError(db, 'payment/deposit', new Error('Error 3'));

  const logs = await getErrorLogs(db, { source: 'payment/deposit' });
  assert.strictEqual(logs.length, 2, 'Should have 2 payment/deposit errors');
  assert.ok(logs.every(log => log.source === 'payment/deposit'));

  db.close();
});

test('error-logger: getErrorLogs filter by time window (sinceMs)', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const now = Date.now();
  const oneHourAgo = now - 3600 * 1000;
  const twoDaysAgo = now - 2 * 24 * 3600 * 1000;

  // Simulate old error (manual insert dengan timestamp custom)
  const { dbRun } = require('../lib/db-async');
  await dbRun(db, 'INSERT INTO error_logs (source, error_message, context, timestamp) VALUES (?, ?, ?, ?)',
    ['test', 'Old error', '', twoDaysAgo]);

  // New error
  await logError(db, 'test', new Error('New error'));

  // Query errors since 1 hour ago
  const recentLogs = await getErrorLogs(db, { sinceMs: oneHourAgo });
  assert.strictEqual(recentLogs.length, 1, 'Should have 1 recent error');
  assert.strictEqual(recentLogs[0].error_message, 'New error');

  db.close();
});

test('error-logger: getErrorCount returns correct count', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 3600 * 1000;

  // Insert 5 errors in last 24h
  for (let i = 0; i < 5; i++) {
    await logError(db, 'test_source', new Error(`Error ${i}`));
  }

  const count = await getErrorCount(db, twentyFourHoursAgo);
  assert.strictEqual(count, 5, 'Should count 5 errors');

  db.close();
});

test('error-logger: getErrorCount filter by source', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const now = Date.now();
  const oneDayAgo = now - 24 * 3600 * 1000;

  await logError(db, 'payment/deposit', new Error('Error A'));
  await logError(db, 'payment/deposit', new Error('Error B'));
  await logError(db, 'scheduler/daily', new Error('Error C'));

  const count = await getErrorCount(db, oneDayAgo, 'payment/deposit');
  assert.strictEqual(count, 2, 'Should count 2 payment/deposit errors');

  db.close();
});
