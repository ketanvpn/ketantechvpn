// lib/dashboard-menu.js
// UI builders untuk admin dashboard.

const { htmlEscape } = require('./html');

/**
 * Format timestamp ms ke string readable (Asia/Jakarta default).
 * @param {number} timestampMs - epoch ms
 * @param {string} timeZone - IANA timezone (default: Asia/Jakarta)
 * @returns {string}
 */
function formatTimestamp(timestampMs, timeZone = 'Asia/Jakarta') {
  if (!timestampMs) return '-';
  try {
    const date = new Date(timestampMs);
    return date.toLocaleString('id-ID', { 
      timeZone, 
      dateStyle: 'short', 
      timeStyle: 'short' 
    });
  } catch (err) {
    return '-';
  }
}

/**
 * Format rupiah (shorthand, e.g. 15rb, 1.5jt).
 * @param {number} amount
 * @returns {string}
 */
function formatRupiahShort(amount) {
  if (!amount || amount === 0) return 'Rp0';
  if (amount >= 1000000) {
    return 'Rp' + (amount / 1000000).toFixed(1) + 'jt';
  }
  if (amount >= 1000) {
    return 'Rp' + (amount / 1000).toFixed(0) + 'rb';
  }
  return 'Rp' + amount;
}

/**
 * Build main dashboard text.
 * @param {object} data - { qrisPending, errorCount, activeUsers, revenue, totalUsers, accounts }
 * @returns {string}
 */
function buildDashboardText(data) {
  const { qrisPending, errorCount, activeUsers, revenue, totalUsers, accounts } = data;

  let text = '📊 <b>Admin Dashboard</b>\n\n';

  // QRIS Pending
  text += '💳 <b>QRIS Pending:</b> ' + qrisPending.count + ' invoice\n';
  if (qrisPending.count > 0) {
    text += '<i>Klik tombol untuk detail</i>\n';
  }
  text += '\n';

  // Error Rate 24h
  text += '⚠️ <b>Error 24 Jam:</b> ' + errorCount + ' error\n';
  if (errorCount > 0) {
    text += '<i>Klik tombol untuk detail</i>\n';
  }
  text += '\n';

  // Stats
  text += '👥 <b>Users:</b> ' + activeUsers + ' aktif / ' + totalUsers + ' total\n';
  text += '📦 <b>Akun:</b> ' + accounts.active + ' aktif / ' + accounts.expired + ' expired\n';
  text += '\n';

  // Revenue
  text += '💰 <b>Revenue:</b>\n';
  text += '  • Hari ini: ' + formatRupiahShort(revenue.today) + '\n';
  text += '  • 7 hari: ' + formatRupiahShort(revenue.week) + '\n';
  text += '  • 30 hari: ' + formatRupiahShort(revenue.month) + '\n';

  return text;
}

/**
 * Build dashboard keyboard.
 * @returns {object}
 */
function buildDashboardKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '💳 QRIS Pending', callback_data: 'dashboard_qris' },
        { text: '⚠️ Error Logs', callback_data: 'dashboard_errors' },
      ],
      [
        { text: '🔄 Refresh', callback_data: 'dashboard_refresh' },
        { text: '🔙 Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

/**
 * Build QRIS pending detail text.
 * @param {object} data - { count, items }
 * @param {string} timeZone
 * @returns {string}
 */
function buildQrisPendingText(data, timeZone = 'Asia/Jakarta') {
  const { count, items } = data;

  let text = '💳 <b>QRIS Pending</b>\n\n';
  text += 'Total: <b>' + count + '</b> invoice\n\n';

  if (items.length === 0) {
    text += '<i>Tidak ada invoice pending.</i>';
    return text;
  }

  text += '<b>Invoice Terakhir:</b>\n';
  items.forEach((item, index) => {
    text += (index + 1) + '. <code>' + htmlEscape(item.invoice_id) + '</code>\n';
    text += '   User: ' + item.user_id + '\n';
    text += '   Amount: ' + formatRupiahShort(item.amount) + '\n';
    text += '   Created: ' + formatTimestamp(item.created_at, timeZone) + '\n';
    if (index < items.length - 1) text += '\n';
  });

  return text;
}

/**
 * Build error logs detail text.
 * @param {object} data - { count, items }
 * @param {string} timeZone
 * @returns {string}
 */
function buildErrorLogsText(data, timeZone = 'Asia/Jakarta') {
  const { count, items } = data;

  let text = '⚠️ <b>Error Logs (24 Jam)</b>\n\n';
  text += 'Total: <b>' + count + '</b> error\n\n';

  if (items.length === 0) {
    text += '<i>Tidak ada error dalam 24 jam terakhir.</i>';
    return text;
  }

  text += '<b>Error Terakhir:</b>\n';
  items.forEach((item, index) => {
    text += (index + 1) + '. <b>' + htmlEscape(item.source) + '</b>\n';
    text += '   ' + htmlEscape(item.error_message.substring(0, 100)) + '\n';
    text += '   ' + formatTimestamp(item.timestamp, timeZone) + '\n';
    if (index < items.length - 1) text += '\n';
  });

  return text;
}

/**
 * Build back to dashboard keyboard.
 * @returns {object}
 */
function buildBackToDashboardKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔙 Kembali ke Dashboard', callback_data: 'dashboard_refresh' },
        { text: '🔙 Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

module.exports = {
  formatTimestamp,
  formatRupiahShort,
  buildDashboardText,
  buildDashboardKeyboard,
  buildQrisPendingText,
  buildErrorLogsText,
  buildBackToDashboardKeyboard,
};
