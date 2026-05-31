const test = require('node:test');
const assert = require('node:assert/strict');
const { formatProvisioningFailure } = require('../lib/provisioning-errors');

test('formatProvisioningFailure: default account error', () => {
  assert.equal(
    formatProvisioningFailure('random failure'),
    '❌ Gagal membuat akun. Server sedang bermasalah, silakan coba lagi beberapa saat.'
  );
});

test('formatProvisioningFailure: account unauthorized/timeout/gateway', () => {
  assert.equal(
    formatProvisioningFailure('{"meta":{"code":401,"message":"unauthorized"}}'),
    '❌ Gagal membuat akun. Server target tidak terautentikasi (unauthorized). Silakan hubungi admin.'
  );
  assert.equal(
    formatProvisioningFailure('ETIMEDOUT while request'),
    '❌ Gagal membuat akun. Server target terlalu lama merespons (timeout). Silakan coba lagi.'
  );
  assert.equal(
    formatProvisioningFailure('Bad Gateway 502'),
    '❌ Gagal membuat akun. Server target sedang gangguan. Silakan coba lagi beberapa saat.'
  );
});

test('formatProvisioningFailure: trial prefix', () => {
  assert.equal(
    formatProvisioningFailure('unauthorized', { trial: true }),
    '❌ Gagal membuat akun trial. Server target tidak terautentikasi (unauthorized). Silakan hubungi admin.'
  );
  assert.equal(
    formatProvisioningFailure('bad gateway', { trial: true }),
    '❌ Gagal membuat akun trial. Server target sedang gangguan. Silakan coba lagi beberapa saat.'
  );
});

test('formatProvisioningFailure: refund failed note', () => {
  assert.equal(
    formatProvisioningFailure('timeout', { refundFailed: true }),
    '❌ Gagal membuat akun. Server target terlalu lama merespons (timeout). Silakan coba lagi.\n\n⚠️ Refund otomatis sedang bermasalah. Admin sudah diberi notifikasi untuk pengecekan manual.'
  );
});
