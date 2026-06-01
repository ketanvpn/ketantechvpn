// tests/dashboard-stats.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const sqlite3 = require('sqlite3');
const { dbRun } = require('../lib/db-async');
const { runMigrations } = require('../db/migrations');
const { createDdlHelpers } = require('../db/ddl-safe');
const {
  getQrisPending,
  getActiveUsersCount,
  getRevenueSummary,
  getTotalUsersCount,
  getAccountsCount,
} = require('../lib/dashboard-stats');

// Mock logger minimal
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

test('getQrisPending: returns count and items', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Insert pending invoices
  await dbRun(db, 'INSERT INTO qris_payments (user_id, invoice_id, amount, base_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [100, 'INV-001', 50000, 50000, 'pending', Date.now()]);
  await dbRun(db, 'INSERT INTO qris_payments (user_id, invoice_id, amount, base_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [200, 'INV-002', 100000, 100000, 'pending', Date.now()]);
  await dbRun(db, 'INSERT INTO qris_payments (user_id, invoice_id, amount, base_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [300, 'INV-003', 75000, 75000, 'paid', Date.now()]);

  const result = await getQrisPending(db, 10);
  assert.strictEqual(result.count, 2, 'Should have 2 pending invoices');
  assert.strictEqual(result.items.length, 2, 'Should return 2 items');
  assert.ok(result.items[0].invoice_id, 'Should have invoice_id');
  assert.ok(result.items[0].user_id, 'Should have user_id');
  assert.ok(result.items[0].amount, 'Should have amount');

  db.close();
});

test('getActiveUsersCount: count users with balance or active accounts', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const futureExpiry = Date.now() + 7 * 24 * 3600 * 1000;

  // User dengan saldo
  await dbRun(db, 'INSERT INTO users (user_id, saldo) VALUES (?, ?)', [100, 50000]);
  // User dengan akun aktif
  await dbRun(db, 'INSERT INTO users (user_id, saldo) VALUES (?, ?)', [200, 0]);
  await dbRun(db, 'INSERT INTO accounts (user_id, username, type, server_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [200, 'user200', 'vmess', 1, futureExpiry, Date.now()]);
  // User tanpa saldo dan akun expired
  await dbRun(db, 'INSERT INTO users (user_id, saldo) VALUES (?, ?)', [300, 0]);

  const count = await getActiveUsersCount(db);
  assert.strictEqual(count, 2, 'Should have 2 active users');

  db.close();
});

test('getRevenueSummary: sum debit transactions by time window', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const now = Date.now();
  const oneDayAgo = now - 24 * 3600 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;

  // Transaction today
  await dbRun(db, 'INSERT INTO transactions (user_id, type, amount, timestamp) VALUES (?, ?, ?, ?)',
    [100, 'debit', 50000, oneDayAgo + 1000]);
  // Transaction 7 days ago
  await dbRun(db, 'INSERT INTO transactions (user_id, type, amount, timestamp) VALUES (?, ?, ?, ?)',
    [100, 'debit', 100000, sevenDaysAgo + 1000]);
  // Transaction 30 days ago
  await dbRun(db, 'INSERT INTO transactions (user_id, type, amount, timestamp) VALUES (?, ?, ?, ?)',
    [100, 'debit', 200000, thirtyDaysAgo + 1000]);
  // Credit transaction (should be excluded)
  await dbRun(db, 'INSERT INTO transactions (user_id, type, amount, timestamp) VALUES (?, ?, ?, ?)',
    [100, 'credit', 10000, now]);

  const revenue = await getRevenueSummary(db);
  assert.ok(revenue.today >= 50000, 'Today revenue should include today transaction');
  assert.ok(revenue.week >= 150000, 'Week revenue should include today + 7 days ago');
  assert.ok(revenue.month >= 350000, 'Month revenue should include all transactions');

  db.close();
});

test('getTotalUsersCount: count all users', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  await dbRun(db, 'INSERT INTO users (user_id, saldo) VALUES (?, ?)', [100, 0]);
  await dbRun(db, 'INSERT INTO users (user_id, saldo) VALUES (?, ?)', [200, 10000]);
  await dbRun(db, 'INSERT INTO users (user_id, saldo) VALUES (?, ?)', [300, 5000]);

  const count = await getTotalUsersCount(db);
  assert.strictEqual(count, 3, 'Should have 3 total users');

  db.close();
});

test('getAccountsCount: count active and expired accounts', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const now = Date.now();
  const futureExpiry = now + 7 * 24 * 3600 * 1000;
  const pastExpiry = now - 7 * 24 * 3600 * 1000;

  await dbRun(db, 'INSERT INTO accounts (user_id, username, type, server_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [100, 'active1', 'vmess', 1, futureExpiry, now]);
  await dbRun(db, 'INSERT INTO accounts (user_id, username, type, server_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [200, 'active2', 'ssh', 1, futureExpiry, now]);
  await dbRun(db, 'INSERT INTO accounts (user_id, username, type, server_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [300, 'expired1', 'vmess', 1, pastExpiry, now]);

  const counts = await getAccountsCount(db);
  assert.strictEqual(counts.active, 2, 'Should have 2 active accounts');
  assert.strictEqual(counts.expired, 1, 'Should have 1 expired account');

  db.close();
});
