'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQrisStatusText,
  buildQrisStatusKeyboard,
} = require('../lib/qris-status-menu');

test('buildQrisStatusText: renders invoice and upper-case status', () => {
  const text = buildQrisStatusText({ invoiceId: 'INV-1', status: 'paid' });
  assert.match(text, /Status QRIS/);
  assert.match(text, /Invoice : <code>INV-1<\/code>/);
  assert.match(text, /Status  : <b>PAID<\/b>/);
  assert.match(text, /Saldo masuk otomatis/);
});

test('buildQrisStatusText: escapes invoice and status', () => {
  const text = buildQrisStatusText({ invoiceId: '<INV&1>', status: '<paid>' });
  assert.match(text, /&lt;INV&amp;1&gt;/);
  assert.match(text, /&lt;PAID&gt;/);
});

test('buildQrisStatusKeyboard: refresh and main menu callbacks', () => {
  const kb = buildQrisStatusKeyboard('INV-2');
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'qris_status:INV-2');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'send_main_menu');
});
