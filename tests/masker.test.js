// tests/masker.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { maskLogMessage, maskToken } = require('../lib/masker');

test('maskLogMessage: mask telegram bot token', () => {
  const v = maskLogMessage('bot1234567:ABCDEFGH_1234567890abcdefghij');
  assert.ok(v.includes('bot<REDACTED>'));
});

test('maskLogMessage: mask Authorization header', () => {
  const v = maskLogMessage('Authorization: Bearer abcdef123456789012345');
  assert.ok(v.includes('<REDACTED>'));
});

test('maskLogMessage: mask api key + password + token', () => {
  assert.ok(maskLogMessage('api_key=secret123').includes('<REDACTED>'));
  assert.ok(maskLogMessage('password=hunter2').includes('<REDACTED>'));
  assert.ok(maskLogMessage('token=abc123def456').includes('<REDACTED>'));
});

test('maskLogMessage: null/undefined safe', () => {
  assert.equal(maskLogMessage(null), null);
  assert.equal(maskLogMessage(undefined), undefined);
});

test('maskToken: short stays intact', () => {
  assert.equal(maskToken(''), '-');
  assert.equal(maskToken('short'), 'short');
});

test('maskToken: long truncated', () => {
  const out = maskToken('abcdefghijklmnopqrstuvwxyz1234567890');
  assert.ok(out.includes('...'));
  assert.ok(out.length < 36);
});
