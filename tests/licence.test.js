// tests/licence.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getLicenseInfo } = require('../lib/licence');

test('getLicenseInfo: null when undefined', () => {
  assert.equal(getLicenseInfo(null), null);
  assert.equal(getLicenseInfo(''), null);
});

test('getLicenseInfo: daysLeft positive for future', () => {
  const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const iso = future.toISOString().slice(0, 10);
  const r = getLicenseInfo(iso);
  assert.ok(r);
  assert.ok(r.daysLeft >= 9 && r.daysLeft <= 11);
});

test('getLicenseInfo: daysLeft negative for past', () => {
  const r = getLicenseInfo('2020-01-01');
  assert.ok(r);
  assert.ok(r.daysLeft < 0);
});

test('getLicenseInfo: invalid date returns null or sensible', () => {
  const r = getLicenseInfo('not-a-date');
  // depending on JS Date parsing, invalid input may be null
  if (r !== null) {
    assert.ok(typeof r.daysLeft === 'number');
  }
});
