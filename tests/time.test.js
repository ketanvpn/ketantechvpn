// tests/time.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getTimeInConfiguredTimeZone,
  getAccountDaysLeft,
  getMonthRange,
  typeCode,
  shortStatus,
} = require('../lib/time');

test('getTimeInConfiguredTimeZone: returns dateKey + hour + minute', () => {
  const r = getTimeInConfiguredTimeZone('UTC');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.dateKey));
  assert.ok(r.hour >= 0 && r.hour <= 23);
  assert.ok(r.minute >= 0 && r.minute <= 59);
});

test('getAccountDaysLeft: null for missing', () => {
  assert.equal(getAccountDaysLeft(null), null);
  assert.equal(getAccountDaysLeft(0), null);
});

test('getAccountDaysLeft: positive for future', () => {
  const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const d = getAccountDaysLeft(future);
  assert.ok(d >= 6 && d <= 7);
});

test('getAccountDaysLeft: negative for past', () => {
  const past = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const d = getAccountDaysLeft(past);
  assert.ok(d <= -2 && d >= -3);
});

test('getMonthRange: current month default', () => {
  const r = getMonthRange(0, 'UTC');
  assert.ok(r.startMs < r.endMs);
  assert.ok(r.month >= 1 && r.month <= 12);
  assert.ok(/^\d{4}-\d{2}$/.test(r.monthKey));
});

test('typeCode: per type', () => {
  assert.equal(typeCode('vmess'), 'VM');
  assert.equal(typeCode('vless'), 'VL');
  assert.equal(typeCode('ssh'), 'SH');
  assert.equal(typeCode('trojan'), 'TJ');
  assert.equal(typeCode('shadowsocks'), 'SS');
  assert.equal(typeCode('unknown'), 'UN');
  assert.equal(typeCode(''), '??');
});

test('shortStatus: null/undefined/past/future', () => {
  const future = Date.now() + 2 * 24 * 60 * 60 * 1000;
  assert.match(shortStatus(future), /A[12]/);
  const past = Date.now() - 24 * 60 * 60 * 1000;
  assert.match(shortStatus(past), /X$/);
  assert.ok(shortStatus(null).length > 0);
});
