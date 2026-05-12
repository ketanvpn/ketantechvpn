// tests/validators.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSafeSqlIdent,
  isSafeSqlIdentList,
  isValidUsername,
  isValidPassword,
  isValidPositiveInt,
  isValidNonNegativeInt,
} = require('../lib/validators');

test('isSafeSqlIdent: accepts alnum + underscore', () => {
  assert.equal(isSafeSqlIdent('users'), true);
  assert.equal(isSafeSqlIdent('user_id'), true);
  assert.equal(isSafeSqlIdent('_private'), true);
  assert.equal(isSafeSqlIdent('a1'), true);
});

test('isSafeSqlIdent: rejects injection attempts', () => {
  assert.equal(isSafeSqlIdent(''), false);
  assert.equal(isSafeSqlIdent('1user'), false);
  assert.equal(isSafeSqlIdent('user-id'), false);
  assert.equal(isSafeSqlIdent("'; DROP TABLE --"), false);
  assert.equal(isSafeSqlIdent(null), false);
  assert.equal(isSafeSqlIdent(123), false);
});

test('isSafeSqlIdentList: comma-separated', () => {
  assert.equal(isSafeSqlIdentList('user_id, status'), true);
  assert.equal(isSafeSqlIdentList('a,b,c'), true);
  assert.equal(isSafeSqlIdentList('a, 1bad'), false);
  assert.equal(isSafeSqlIdentList(''), false);
});

test('isValidUsername: VPN username rules', () => {
  assert.equal(isValidUsername('myuser'), true);
  assert.equal(isValidUsername('user123'), true);
  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername('user-1'), false);
  assert.equal(isValidUsername('user 1'), false);
  assert.equal(isValidUsername('user!@#'), false);
});

test('isValidPassword: SSH password rules', () => {
  assert.equal(isValidPassword('abc'), true);
  assert.equal(isValidPassword('abcDEF123.!@#-_'), true);
  assert.equal(isValidPassword('ab'), false);
  assert.equal(isValidPassword('has space'), false);
  assert.equal(isValidPassword("evil'$(rm"), false);
  assert.equal(isValidPassword('a'.repeat(33)), false);
});

test('isValidPositiveInt & isValidNonNegativeInt', () => {
  assert.equal(isValidPositiveInt(1), true);
  assert.equal(isValidPositiveInt('30'), true);
  assert.equal(isValidPositiveInt(0), false);
  assert.equal(isValidPositiveInt(-1), false);
  assert.equal(isValidPositiveInt(1.5), false);
  assert.equal(isValidNonNegativeInt(0), true);
  assert.equal(isValidNonNegativeInt('0'), true);
  assert.equal(isValidNonNegativeInt(-1), false);
});
