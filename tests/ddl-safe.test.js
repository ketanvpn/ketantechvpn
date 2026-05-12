// tests/ddl-safe.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeSqlIdent, isSafeSqlIdentList, createDdlHelpers } = require('../db/ddl-safe');

test('isSafeSqlIdent: valid names', () => {
  assert.equal(isSafeSqlIdent('users'), true);
  assert.equal(isSafeSqlIdent('user_id'), true);
  assert.equal(isSafeSqlIdent('_private'), true);
  assert.equal(isSafeSqlIdent('a1'), true);
});

test('isSafeSqlIdent: rejects injection', () => {
  assert.equal(isSafeSqlIdent(''), false);
  assert.equal(isSafeSqlIdent('1user'), false);
  assert.equal(isSafeSqlIdent('user-id'), false);
  assert.equal(isSafeSqlIdent("'; DROP TABLE --"), false);
  assert.equal(isSafeSqlIdent(null), false);
  assert.equal(isSafeSqlIdent(123), false);
});

test('isSafeSqlIdentList: comma-separated', () => {
  assert.equal(isSafeSqlIdentList('user_id, period_month'), true);
  assert.equal(isSafeSqlIdentList('a,b,c'), true);
  assert.equal(isSafeSqlIdentList('a, 1bad'), false);
  assert.equal(isSafeSqlIdentList(''), false);
  assert.equal(isSafeSqlIdentList(null), false);
});

test('createDdlHelpers: returns expected methods', () => {
  const fakeDb = { run: () => {}, get: () => {}, all: () => {} };
  const helpers = createDdlHelpers(fakeDb, console);
  assert.equal(typeof helpers.ensureSqliteColumn, 'function');
  assert.equal(typeof helpers.createUniqueIndexIfSafe, 'function');
  assert.equal(typeof helpers.createUniqueIndexMultiIfSafe, 'function');
});

test('ensureSqliteColumn: skip invalid identifier', () => {
  const warns = [];
  const fakeLogger = { warn: (m) => warns.push(m), info: () => {}, error: () => {} };
  const fakeDb = { all: () => { throw new Error('should not query'); }, run: () => { throw new Error('should not run'); } };
  const helpers = createDdlHelpers(fakeDb, fakeLogger);
  helpers.ensureSqliteColumn("users'; DROP --", 'col', 'TEXT');
  assert.equal(warns.length, 1);
  assert.match(warns[0], /identifier tidak valid/);
});

test('createUniqueIndexIfSafe: skip invalid identifier', () => {
  const warns = [];
  const fakeLogger = { warn: (m) => warns.push(m), info: () => {}, error: () => {} };
  const fakeDb = { get: () => { throw new Error('should not query'); }, run: () => { throw new Error('should not run'); } };
  const helpers = createDdlHelpers(fakeDb, fakeLogger);
  helpers.createUniqueIndexIfSafe('1bad', 'users', 'id');
  assert.equal(warns.length, 1);
});

test('createUniqueIndexMultiIfSafe: skip invalid list', () => {
  const warns = [];
  const fakeLogger = { warn: (m) => warns.push(m), info: () => {}, error: () => {} };
  const fakeDb = { get: () => { throw new Error('should not query'); }, run: () => { throw new Error('should not run'); } };
  const helpers = createDdlHelpers(fakeDb, fakeLogger);
  helpers.createUniqueIndexMultiIfSafe('idx_x', 'users', 'id, 1bad');
  assert.equal(warns.length, 1);
});
