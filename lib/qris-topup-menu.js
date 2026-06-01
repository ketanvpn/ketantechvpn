'use strict';

function formatRupiah(value) {
  return Number(value || 0).toLocaleString('id-ID');
}

function buildTopupQrisPromptText(options = {}) {
  const {
    min,
    max,
  } = options;

  return (
    '💳 <b>Topup Saldo Otomatis (QRIS)</b>\n\n' +
    `Minimal: <b>Rp${min}</b>\n` +
    `Maksimal: <b>Rp${max}</b>\n\n` +
    'Silakan kirim nominal topup dalam angka saja.\n' +
    'Contoh: <code>25000</code>\n\n' +
    'Tekan tombol <b>❌ Batal</b> untuk membatalkan.'
  );
}

function buildTopupQrisPromptMarkup() {
  return {
    keyboard: [[{ text: '❌ Batal' }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function buildInvalidTopupNominalText(options = {}) {
  const { min, max } = options;
  return (
    '⚠️ Nominal tidak valid.\n\n' +
    `Minimal: <b>Rp${formatRupiah(min)}</b>\n` +
    `Maksimal: <b>Rp${formatRupiah(max)}</b>\n\n` +
    'Ketik ulang nominal, contoh: <code>25000</code>'
  );
}

function buildTopupConfirmText(options = {}) {
  const {
    baseAmount,
    payableAmount,
    uniqueSuffix,
    bonus = 0,
    percent = 0,
    estimatedSaldo,
    timeoutMin = 10,
  } = options;

  return (
    '💳 <b>Konfirmasi Topup QRIS</b>\n\n' +
    `💰 Nominal topup: <b>Rp${formatRupiah(baseAmount)}</b>\n` +
    `💵 Jumlah yang harus dibayar: <b>Rp${formatRupiah(payableAmount)}</b>\n` +
    `🔢 Kode unik QRIS: <b>Rp${formatRupiah(uniqueSuffix)}</b>\n` +
    (bonus > 0
      ? `🎁 Bonus topup: <b>${percent}%</b> ( +Rp${formatRupiah(bonus)} )\n`
      : '🎁 Bonus topup: <b>Tidak ada</b>\n') +
    `💰 Estimasi saldo masuk: <b>Rp${formatRupiah(estimatedSaldo)}</b>\n` +
    `⏳ Masa berlaku QR: <b>${timeoutMin} menit</b>\n\n` +
    'ℹ️ Tekan <b>➡️ Lanjut Topup</b> untuk membuat invoice QRIS dengan nominal di atas.\n' +
    'ℹ️ Tekan <b>❌ Batal</b> jika ingin membatalkan topup.\n\n' +
    'Pastikan nominal dan jumlah pembayaran sudah benar sebelum melanjutkan.'
  );
}

function buildTopupConfirmMarkup() {
  return {
    remove_keyboard: true,
    inline_keyboard: [
      [{ text: '➡️ Lanjut Topup', callback_data: 'qris_topup_confirm_yes' }],
      [{ text: '❌ Batal', callback_data: 'qris_topup_confirm_cancel' }],
    ],
  };
}

function buildQrisInvoiceCaption(options = {}) {
  const {
    invoiceId,
    baseAmount,
    billedAmount,
    uniqueSuffix = 0,
    timeoutMin = 10,
  } = options;

  return (
    '💳 <b>QRIS TOPUP DIBUAT</b>\n' +
    '━━━━━━━━━━━━━━━━\n' +
    `🧾 <b>Invoice</b> : <code>${invoiceId}</code>\n` +
    `💰 <b>Nominal</b> : <b>Rp${formatRupiah(baseAmount)}</b>\n` +
    (uniqueSuffix > 0
      ? `🔢 <b>Kode unik</b> : <b>${String(uniqueSuffix).padStart(3, '0')}</b>\n` +
        `💵 <b>Total bayar</b> : <b>Rp${formatRupiah(billedAmount)}</b>\n`
      : `💵 <b>Total bayar</b> : <b>Rp${formatRupiah(billedAmount)}</b>\n`) +
    '━━━━━━━━━━━━━━━━\n' +
    '📲 Scan QR lalu bayar sesuai <b>TOTAL BAYAR</b>\n' +
    `⏳ <b>Berlaku ${timeoutMin} menit</b>\n` +
    'Saldo masuk otomatis setelah terdeteksi.'
  );
}

function buildQrisInvoiceKeyboard(invoiceId) {
  return {
    inline_keyboard: [
      [{ text: '🔄 Cek Status', callback_data: `qris_status:${invoiceId}` }],
      [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
    ],
  };
}

module.exports = {
  formatRupiah,
  buildTopupQrisPromptText,
  buildTopupQrisPromptMarkup,
  buildInvalidTopupNominalText,
  buildTopupConfirmText,
  buildTopupConfirmMarkup,
  buildQrisInvoiceCaption,
  buildQrisInvoiceKeyboard,
};
