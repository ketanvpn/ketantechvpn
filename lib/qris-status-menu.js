'use strict';

const { htmlEscape } = require('./html');

function buildQrisStatusText(options = {}) {
  const {
    invoiceId = '-',
    status = 'pending',
  } = options;

  const safeInvoiceId = htmlEscape(invoiceId);
  const safeStatus = htmlEscape(String(status || 'pending').toUpperCase());
  return (
    '🔍 <b>Status QRIS</b>\n' +
    '━━━━━━━━━━━━━━━━\n' +
    `Invoice : <code>${safeInvoiceId}</code>\n` +
    `Status  : <b>${safeStatus}</b>\n` +
    '━━━━━━━━━━━━━━━━\n' +
    'Catatan: Saldo masuk otomatis saat status <b>PAID</b>.'
  );
}

function buildQrisStatusKeyboard(invoiceId) {
  return {
    inline_keyboard: [
      [{ text: '🔄 Refresh Status', callback_data: `qris_status:${invoiceId}` }],
      [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
    ],
  };
}

module.exports = {
  buildQrisStatusText,
  buildQrisStatusKeyboard,
};
