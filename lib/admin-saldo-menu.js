'use strict';

function formatRupiahNumber(value) {
  return Number(value || 0).toLocaleString('id-ID');
}

function buildAddSaldoPromptText() {
  return '?? *Silakan masukkan jumlah saldo yang ingin ditambahkan:*';
}

function buildAddSaldoPreviewText(currentSaldo = '') {
  return (
    '💰 *Silakan masukkan jumlah saldo yang ingin ditambahkan:*\n\n' +
    `Jumlah saldo saat ini: *${currentSaldo || '0'}*`
  );
}

function buildAddSaldoSuccessText(options = {}) {
  const {
    amount = 0,
    bonus = 0,
    percent = 0,
    totalCredit = 0,
  } = options;

  let text =
    '✅ *Saldo user berhasil ditambahkan.*\n\n' +
    '📋 *Detail:*\n' +
    `- Nominal Bayar : *Rp ${formatRupiahNumber(amount)}*\n`;

  if (Number(bonus || 0) > 0) {
    text += `- Bonus        : *Rp ${formatRupiahNumber(bonus)} (${percent}%)*\n`;
  }

  text += `- Saldo Masuk   : *Rp ${formatRupiahNumber(totalCredit)}*`;
  return text;
}

module.exports = {
  formatRupiahNumber,
  buildAddSaldoPromptText,
  buildAddSaldoPreviewText,
  buildAddSaldoSuccessText,
};
