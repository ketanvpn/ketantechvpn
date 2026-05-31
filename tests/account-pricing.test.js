const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateAccountQuota,
  calculateAccountPrice,
} = require('../lib/account-pricing');

test('calculateAccountQuota: proportional quota for positive base quota', () => {
  assert.equal(calculateAccountQuota(30, 30), 30);
  assert.equal(calculateAccountQuota(30, 15), 15);
  assert.equal(calculateAccountQuota(30, 1), 1);
  assert.equal(calculateAccountQuota(10, 1), 1);
});

test('calculateAccountQuota: preserves previous falsy/non-positive behavior', () => {
  assert.equal(calculateAccountQuota(0, 30), 0);
  assert.equal(calculateAccountQuota(null, 30), null);
  assert.equal(calculateAccountQuota(undefined, 30), undefined);
  assert.equal(calculateAccountQuota(-5, 30), -5);
});

test('calculateAccountPrice: proportional normal price', () => {
  assert.equal(calculateAccountPrice(30000, 30, false, 0.5), 30000);
  assert.equal(calculateAccountPrice(30000, 15, false, 0.5), 15000);
  assert.equal(calculateAccountPrice(30000, 1, false, 0.5), 1000);
});

test('calculateAccountPrice: reseller discount after proportional price', () => {
  assert.equal(calculateAccountPrice(30000, 30, true, 0.5), 15000);
  assert.equal(calculateAccountPrice(30000, 15, true, 0.5), 7500);
  assert.equal(calculateAccountPrice(100, 1, true, 0.5), 1);
});

test('calculateAccountPrice: invalid or zero price stays free', () => {
  assert.equal(calculateAccountPrice(0, 30, false, 0.5), 0);
  assert.equal(calculateAccountPrice(null, 30, false, 0.5), 0);
  assert.equal(calculateAccountPrice('abc', 30, false, 0.5), 0);
});
