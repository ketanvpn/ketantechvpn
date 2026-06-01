// tests/audit-logger.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const sqlite3 = require('sqlite3');
const { logAuditAction, getAuditLogs } = require('../lib/audit-logger');
const { runMigrations } = require('../db/migrations');
const { createDdlHelpers } = require('../db/ddl-safe');

// Mock logger minimal
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

test('audit-logger: logAuditAction simpan action dengan details object', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);

  // Wait migrations selesai (SQLite migrations async)
  await new Promise((resolve) => setTimeout(resolve, 100));

  const userId = 123;
  const action = 'add_server';
  const details = { domain: 'test.example.com', harga: 15000 };

  const result = await logAuditAction(db, userId, action, details);
  assert.strictEqual(result.changes, 1, 'Should insert 1 row');
  assert.ok(result.lastID > 0, 'Should return lastID');

  // Verify data tersimpan
  const logs = await getAuditLogs(db, { userId, limit: 10 });
  assert.strictEqual(logs.length, 1, 'Should have 1 audit log');
  assert.strictEqual(logs[0].user_id, userId);
  assert.strictEqual(logs[0].action, action);
  assert.strictEqual(logs[0].details, JSON.stringify(details));
  assert.ok(logs[0].timestamp > 0);

  db.close();
});

test('audit-logger: logAuditAction simpan action dengan details string', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const userId = 456;
  const action = 'delete_server';
  const details = 'Server domain: old.example.com';

  await logAuditAction(db, userId, action, details);

  const logs = await getAuditLogs(db, { userId });
  assert.strictEqual(logs[0].details, details);

  db.close();
});

test('audit-logger: logAuditAction simpan action tanpa details', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const userId = 789;
  const action = 'broadcast';

  await logAuditAction(db, userId, action);

  const logs = await getAuditLogs(db, { userId });
  assert.strictEqual(logs[0].details, '');

  db.close();
});

test('audit-logger: getAuditLogs filter by action', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  await logAuditAction(db, 100, 'add_server', { domain: 'a.com' });
  await logAuditAction(db, 100, 'edit_harga', { domain: 'a.com', harga: 20000 });
  await logAuditAction(db, 100, 'add_server', { domain: 'b.com' });

  const logs = await getAuditLogs(db, { action: 'add_server' });
  assert.strictEqual(logs.length, 2, 'Should have 2 add_server logs');
  assert.ok(logs.every(log => log.action === 'add_server'));

  db.close();
});

test('audit-logger: getAuditLogs limit & offset', async () => {
  const db = new sqlite3.Database(':memory:');
  const helpers = createDdlHelpers(db, mockLogger);
  runMigrations(db, mockLogger, helpers);
  await new Promise((resolve) => setTimeout(resolve, 100));

  for (let i = 0; i < 10; i++) {
    await logAuditAction(db, 200, 'test_action', { index: i });
  }

  const page1 = await getAuditLogs(db, { userId: 200, limit: 3, offset: 0 });
  assert.strictEqual(page1.length, 3);

  const page2 = await getAuditLogs(db, { userId: 200, limit: 3, offset: 3 });
  assert.strictEqual(page2.length, 3);
  // Verify tidak overlap (timestamp DESC)
  assert.notStrictEqual(page1[0].id, page2[0].id);

  db.close();
});
