'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatRupiahNumber,
  buildAddSaldoPromptText,
  buildAddSaldoPreviewText,
  buildAddSaldoSuccessText,
} = require('../lib/admin-saldo-menu');

test('formatRupiahNumber: formats id-ID numbers', () => {
  assert.equal(formatRupiahNumber(15000), '15.000');
  assert.equal(formatRupiahNumber(0), '0');
});

test('buildAddSaldoPromptText: renders initial prompt', () => {
  assert.match(buildAddSaldoPromptText(), /jumlah saldo/);
});

test('buildAddSaldoPreviewText: renders current amount fallback and value', () => {
  assert.match(buildAddSaldoPreviewText(''), /Jumlah saldo saat ini: \*0\*/);
  assert.match(buildAddSaldoPreviewText('25000'), /Jumlah saldo saat ini: \*25000\*/);
});

test('buildAddSaldoSuccessText: renders without bonus', () => {
  const text = buildAddSaldoSuccessText({ amount: 15000, totalCredit: 15000 });
  assert.match(text, /Saldo user berhasil ditambahkan/);
  assert.match(text, /Nominal Bayar : \*Rp 15\.000\*/);
  assert.doesNotMatch(text, /Bonus/);
  assert.match(text, /Saldo Masuk   : \*Rp 15\.000\*/);
});

test('buildAddSaldoSuccessText: renders with bonus', () => {
  const text = buildAddSaldoSuccessText({ amount: 100000, bonus: 5000, percent: 5, totalCredit: 105000 });
  assert.match(text, /Bonus        : \*Rp 5\.000 \(5%\)\*/);
  assert.match(text, /Saldo Masuk   : \*Rp 105\.000\*/);
});
