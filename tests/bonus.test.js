// tests/bonus.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTopupBonus } = require('../lib/bonus');

const CFG = {
  enabled: true,
  tier1Min: 10000, tier1Percent: 5,
  tier2Min: 100000, tier2Percent: 7,
  tier3Min: 200000, tier3Percent: 10,
};

test('bonus disabled returns zero', () => {
  const r = calculateTopupBonus(50000, { ...CFG, enabled: false });
  assert.deepEqual(r, { bonus: 0, percent: 0 });
});

test('below tier1 returns zero', () => {
  assert.deepEqual(calculateTopupBonus(5000, CFG), { bonus: 0, percent: 0 });
  assert.deepEqual(calculateTopupBonus(0, CFG), { bonus: 0, percent: 0 });
  assert.deepEqual(calculateTopupBonus(-100, CFG), { bonus: 0, percent: 0 });
});

test('tier1: 10rb-100rb', () => {
  assert.deepEqual(calculateTopupBonus(10000, CFG), { bonus: 500, percent: 5 });
  assert.deepEqual(calculateTopupBonus(50000, CFG), { bonus: 2500, percent: 5 });
  assert.deepEqual(calculateTopupBonus(99999, CFG), { bonus: 4999, percent: 5 });
});

test('tier2: 100rb-200rb', () => {
  assert.deepEqual(calculateTopupBonus(100000, CFG), { bonus: 7000, percent: 7 });
  assert.deepEqual(calculateTopupBonus(150000, CFG), { bonus: 10500, percent: 7 });
});

test('tier3: >=200rb', () => {
  assert.deepEqual(calculateTopupBonus(200000, CFG), { bonus: 20000, percent: 10 });
  assert.deepEqual(calculateTopupBonus(500000, CFG), { bonus: 50000, percent: 10 });
});

test('bonus rounds down', () => {
  // 12345 * 5 / 100 = 617.25 -> 617
  assert.deepEqual(calculateTopupBonus(12345, CFG), { bonus: 617, percent: 5 });
});

test('invalid input returns zero', () => {
  assert.deepEqual(calculateTopupBonus(NaN, CFG), { bonus: 0, percent: 0 });
  assert.deepEqual(calculateTopupBonus('abc', CFG), { bonus: 0, percent: 0 });
});
