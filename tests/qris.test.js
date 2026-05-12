// tests/qris.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  crc16Ccitt,
  buildEmvTag,
  buildStaticQrisImageUrl,
  buildDynamicQrisPayload,
  parseProviderTransactionTime,
  buildProviderTransactionFingerprint,
  findMatchingSettlementTransaction,
} = require('../lib/qris');

test('crc16Ccitt: kasus standar EMV', () => {
  // https://en.wikipedia.org/wiki/Cyclic_redundancy_check#Specification - polynomial 0x1021, init 0xFFFF
  const crc = crc16Ccitt('123456789');
  assert.equal(crc, '29B1');
});

test('buildEmvTag: length prefixed', () => {
  assert.equal(buildEmvTag('54', '10000'), '540510000');
  assert.equal(buildEmvTag('01', 'AB'), '0102AB');
  assert.equal(buildEmvTag('02', ''), '0200');
});

test('buildStaticQrisImageUrl: encode URI', () => {
  assert.equal(buildStaticQrisImageUrl(''), '');
  const u = buildStaticQrisImageUrl('000201&x=1');
  assert.ok(u.includes('000201%26x%3D1'));
  assert.ok(u.startsWith('https://api.qrserver.com/'));
});

test('buildDynamicQrisPayload: throw on invalid amount', () => {
  assert.throws(() => buildDynamicQrisPayload('base', 0), /Nominal/);
  assert.throws(() => buildDynamicQrisPayload('base', -10), /Nominal/);
  assert.throws(() => buildDynamicQrisPayload('', 1000), /Base QRIS/);
});

test('buildDynamicQrisPayload: inject amount + CRC', () => {
  const base = '000201010211' + '5802ID' + '6304ABCD';
  const out = buildDynamicQrisPayload(base, 5000);
  assert.ok(out.includes('54045000'), 'should contain amount tag');
  assert.ok(out.includes('5802ID'), 'should preserve country tag');
  assert.ok(out.includes('010212'), 'POI method should be dynamic');
  assert.match(out, /6304[0-9A-F]{4}$/);
});

test('parseProviderTransactionTime: various input shapes', () => {
  assert.equal(parseProviderTransactionTime(null), null);
  assert.equal(parseProviderTransactionTime(''), null);
  assert.equal(parseProviderTransactionTime(1700000000000), 1700000000000);
  assert.equal(parseProviderTransactionTime(1700000000), 1700000000000);
  assert.equal(parseProviderTransactionTime('2024-01-02 03:04:05'), Date.parse('2024-01-02T03:04:05'));
  assert.equal(parseProviderTransactionTime('not a date'), null);
});

test('buildProviderTransactionFingerprint: explicit id preferred', () => {
  assert.equal(buildProviderTransactionFingerprint({ id: 'TX123' }), 'id:TX123');
  assert.equal(buildProviderTransactionFingerprint({ transaction_id: 'A1' }), 'id:A1');
});

test('buildProviderTransactionFingerprint: fallback composite', () => {
  const fp = buildProviderTransactionFingerprint({
    amount: 5000,
    time: '2024-01-02 03:04:05',
    issuer: 'GoPay',
    payment_type: 'QRIS',
    status: 'settlement',
  });
  assert.ok(fp.startsWith('fp:5000|'));
  assert.ok(fp.includes('gopay'));
  assert.ok(fp.endsWith('|settlement'));
});

test('findMatchingSettlementTransaction: match amount + status', () => {
  const trxs = [
    { amount: 1000, status: 'pending' },
    { amount: 5000, status: 'settlement' },
    { amount: 5000, status: 'settlement' },
  ];
  const m = findMatchingSettlementTransaction(trxs, 5000);
  assert.ok(m);
  assert.equal(m.amount, 5000);
});

test('findMatchingSettlementTransaction: no match return null', () => {
  const trxs = [{ amount: 1000, status: 'settlement' }];
  assert.equal(findMatchingSettlementTransaction(trxs, 999), null);
  assert.equal(findMatchingSettlementTransaction([], 5000), null);
  assert.equal(findMatchingSettlementTransaction(null, 5000), null);
});

test('findMatchingSettlementTransaction: time window guard', () => {
  const created = Date.parse('2024-06-15T12:00:00Z');
  const trxs = [
    { amount: 5000, status: 'settlement', transaction_time: '2024-06-15T12:02:00Z' }, // 2 menit sesudah: OK
    { amount: 5000, status: 'settlement', transaction_time: '2024-01-01T00:00:00Z' }, // way too old
  ];
  const m = findMatchingSettlementTransaction(trxs, 5000, { createdAt: created });
  assert.ok(m);
  assert.equal(m.transaction_time, '2024-06-15T12:02:00Z');

  const old = findMatchingSettlementTransaction(
    [{ amount: 5000, status: 'settlement', transaction_time: '2024-01-01T00:00:00Z' }],
    5000,
    { createdAt: created }
  );
  assert.equal(old, null);
});