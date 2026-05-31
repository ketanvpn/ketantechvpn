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
  validateAccountUsernameInput,
  validateManageUsernameInput,
  validateAccountPasswordInput,
  validateAccountExpiryInput,
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

test('validateAccountUsernameInput: mirrors account flow messages', () => {
  assert.deepEqual(validateAccountUsernameInput('user123'), { ok: true, value: 'user123' });
  assert.equal(validateAccountUsernameInput('').message, '❌ *Username tidak valid. Masukkan username yang valid.*');
  assert.equal(validateAccountUsernameInput('abc').message, '❌ *Username harus terdiri dari 4 hingga 20 karakter.*');
  assert.equal(validateAccountUsernameInput('User123').message, '❌ *Username tidak boleh menggunakan huruf kapital. Gunakan huruf kecil saja.*');
  assert.equal(validateAccountUsernameInput('user-1').message, '❌ *Username tidak boleh mengandung karakter khusus atau spasi. Gunakan huruf kecil dan angka saja.*');
});

test('validateManageUsernameInput: mirrors del/lock/unlock flow', () => {
  assert.deepEqual(validateManageUsernameInput('abc'), { ok: true, value: 'abc' });
  assert.equal(validateManageUsernameInput('ab').message, '❌ *Username tidak valid. Gunakan huruf kecil dan angka (3–20 karakter).*');
  assert.equal(validateManageUsernameInput('User').message, '❌ *Username tidak valid. Gunakan huruf kecil dan angka (3–20 karakter).*');
});

test('validateAccountPasswordInput: mirrors SSH password flow', () => {
  assert.deepEqual(validateAccountPasswordInput('abc123'), { ok: true, value: 'abc123' });
  assert.equal(validateAccountPasswordInput('').message, '❌ *Password tidak valid. Masukkan password yang valid.*');
  assert.equal(validateAccountPasswordInput('ab').message, '❌ *Password harus terdiri dari minimal 3 karakter.*');
  assert.equal(validateAccountPasswordInput('abc-1').message, '❌ *Password tidak boleh mengandung karakter khusus atau spasi.*');
});

test('validateAccountExpiryInput: mirrors expiry flow', () => {
  assert.deepEqual(validateAccountExpiryInput('30'), { ok: true, value: 30 });
  assert.equal(validateAccountExpiryInput('3x').message, '❌ *Masa aktif hanya boleh angka, contoh: 30*');
  assert.equal(validateAccountExpiryInput('0').message, '❌ *Masa aktif tidak valid. Masukkan angka yang valid.*');
  assert.equal(validateAccountExpiryInput('366').message, '❌ *Masa aktif tidak boleh lebih dari 365 hari.*');
});
