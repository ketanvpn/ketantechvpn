'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatRupiah,
  buildTopupQrisPromptText,
  buildTopupQrisPromptMarkup,
  buildInvalidTopupNominalText,
  buildTopupConfirmText,
  buildTopupConfirmMarkup,
  buildQrisInvoiceCaption,
  buildQrisInvoiceKeyboard,
} = require('../lib/qris-topup-menu');

test('formatRupiah: formats id-ID numbers', () => {
  assert.equal(formatRupiah(25000), '25.000');
  assert.equal(formatRupiah(null), '0');
});

test('buildTopupQrisPromptText: includes min max and example', () => {
  const text = buildTopupQrisPromptText({ min: 1000, max: 300000 });
  assert.match(text, /Topup Saldo Otomatis/);
  assert.match(text, /Minimal: <b>Rp1000<\/b>/);
  assert.match(text, /Maksimal: <b>Rp300000<\/b>/);
  assert.match(text, /<code>25000<\/code>/);
});

test('buildTopupQrisPromptMarkup: cancel keyboard', () => {
  const markup = buildTopupQrisPromptMarkup();
  assert.equal(markup.keyboard[0][0].text, '❌ Batal');
  assert.equal(markup.resize_keyboard, true);
});

test('buildInvalidTopupNominalText: formats range', () => {
  const text = buildInvalidTopupNominalText({ min: 1000, max: 300000 });
  assert.match(text, /Nominal tidak valid/);
  assert.match(text, /Rp1\.000/);
  assert.match(text, /Rp300\.000/);
});

test('buildTopupConfirmText: shows bonus and estimated saldo', () => {
  const text = buildTopupConfirmText({
    baseAmount: 100000,
    payableAmount: 100123,
    uniqueSuffix: 123,
    bonus: 5000,
    percent: 5,
    estimatedSaldo: 105000,
    timeoutMin: 5,
  });

  assert.match(text, /Nominal topup: <b>Rp100\.000<\/b>/);
  assert.match(text, /Jumlah yang harus dibayar: <b>Rp100\.123<\/b>/);
  assert.match(text, /Bonus topup: <b>5%<\/b>/);
  assert.match(text, /Estimasi saldo masuk: <b>Rp105\.000<\/b>/);
});

test('buildTopupConfirmMarkup: confirm and cancel callbacks', () => {
  const markup = buildTopupConfirmMarkup();
  assert.equal(markup.remove_keyboard, true);
  assert.equal(markup.inline_keyboard[0][0].callback_data, 'qris_topup_confirm_yes');
  assert.equal(markup.inline_keyboard[1][0].callback_data, 'qris_topup_confirm_cancel');
});

test('buildQrisInvoiceCaption: shows invoice, unique suffix and timeout', () => {
  const caption = buildQrisInvoiceCaption({
    invoiceId: 'INV-1',
    baseAmount: 25000,
    billedAmount: 25123,
    uniqueSuffix: 123,
    timeoutMin: 10,
  });

  assert.match(caption, /QRIS TOPUP DIBUAT/);
  assert.match(caption, /<code>INV-1<\/code>/);
  assert.match(caption, /Kode unik/);
  assert.match(caption, /Rp25\.123/);
  assert.match(caption, /Berlaku 10 menit/);
});

test('buildQrisInvoiceKeyboard: status callback uses invoice id', () => {
  const kb = buildQrisInvoiceKeyboard('INV-2');
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'qris_status:INV-2');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'send_main_menu');
});
