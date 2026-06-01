'use strict';

const { htmlEscape } = require('./html');

function formatRupiah(value) {
  return Number(value || 0).toLocaleString('id-ID');
}

function buildWebLinkSuccessText(options = {}) {
  const {
    wasLinked = false,
    webDomain = 'web',
    username = '-',
    migratedAmount = 0,
    migrateError = null,
    finalWebBalance = 0,
  } = options;

  const lines = [];
  lines.push(wasLinked
    ? '✅ <b>Akun web kamu sudah terhubung ulang.</b>'
    : '🎉 <b>Akun web kamu berhasil terhubung!</b>');
  lines.push('');
  lines.push('🌐 Web: <b>' + htmlEscape(webDomain || 'web') + '</b>');
  lines.push('👤 Username web: <code>' + htmlEscape(username) + '</code>');
  if (migratedAmount > 0) {
    lines.push('🔄 Saldo lokal bot di-migrate: <b>+Rp ' + formatRupiah(migratedAmount) + '</b>');
  } else if (migrateError) {
    lines.push('⚠️ <i>Migrasi saldo lokal gagal:</i> <code>' + htmlEscape(migrateError) + '</code>');
    lines.push('<i>Saldo lokal kamu tidak hilang — silakan hubungi admin untuk migrasi manual.</i>');
  }
  lines.push('💰 Saldo sekarang: <b>Rp ' + formatRupiah(finalWebBalance) + '</b>');
  lines.push('');
  lines.push('Mulai sekarang, transaksi di bot ini & di web akan menggunakan akun yang sama.');
  return lines.join('\n');
}

function buildWebLinkSuccessKeyboard(webDomain) {
  return {
    inline_keyboard: [
      [{ text: '🌐 Buka Web', url: webDomain || 'https://ketantech.my.id' }],
      [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
    ],
  };
}

function buildWebLinkedStatusText(options = {}) {
  const {
    webDomain = 'https://ketantech.my.id',
    webUser = null,
  } = options;

  const lines = [];
  lines.push('🔗 <b>Akun Web Sudah Terhubung</b>');
  lines.push('');
  lines.push('🌐 Web: ' + htmlEscape(webDomain));
  if (webUser) {
    lines.push('👤 Username: <code>' + htmlEscape(webUser.username || webUser.email || ('User #' + webUser.id)) + '</code>');
    lines.push('💰 Saldo web: <b>Rp ' + formatRupiah(webUser.balance) + '</b>');
  } else {
    lines.push('<i>(Tidak bisa ambil info terbaru dari web. Coba lagi nanti.)</i>');
  }
  lines.push('');
  lines.push('Saldo & transaksi kamu sinkron antara bot ini dan web.');
  return lines.join('\n');
}

function buildWebLinkedStatusKeyboard(webDomain) {
  return {
    inline_keyboard: [
      [{ text: '🌐 Buka Web', url: webDomain }],
      [{ text: '🔌 Putuskan Koneksi', callback_data: 'web_link_unlink' }],
      [{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }],
    ],
  };
}

function buildWebLinkInstructionsText(webDomain = 'https://ketantech.my.id') {
  const lines = [];
  lines.push('🔗 <b>Hubungkan Akun ke Web</b>');
  lines.push('');
  lines.push('Kamu bisa menghubungkan akun bot ini dengan akun di:');
  lines.push('🌐 <b>' + htmlEscape(webDomain) + '</b>');
  lines.push('');
  lines.push('Setelah terhubung, <b>saldo dan akun</b> kamu akan sinkron antara bot dan web.');
  lines.push('');
  lines.push('<b>Cara menghubungkan:</b>');
  lines.push('1. Login (atau daftar) di ' + htmlEscape(webDomain));
  lines.push('2. Buka menu <b>Profil</b> → <b>Hubungkan ke Telegram</b>');
  lines.push('3. Klik link yang diberikan oleh web');
  lines.push('4. Akun akan otomatis terhubung');
  lines.push('');
  lines.push('Belum punya akun web? Daftar dulu lewat tombol di bawah.');
  return lines.join('\n');
}

function buildWebLinkInstructionsKeyboard(webDomain) {
  return {
    inline_keyboard: [
      [{ text: '🌐 Buka Web Sekarang', url: webDomain }],
      [{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }],
    ],
  };
}

function buildWebUnlinkSuccessText() {
  return (
    '🔌 <b>Akun web sudah diputuskan dari bot ini.</b>\n\n' +
    'Saldo & transaksi kamu di bot kembali memakai data lokal.\n' +
    'Kamu bisa hubungkan ulang kapan saja lewat menu <b>🔗 Hubungkan ke Web</b>.'
  );
}

function buildWebUnlinkSuccessKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }],
    ],
  };
}

module.exports = {
  formatRupiah,
  buildWebLinkSuccessText,
  buildWebLinkSuccessKeyboard,
  buildWebLinkedStatusText,
  buildWebLinkedStatusKeyboard,
  buildWebLinkInstructionsText,
  buildWebLinkInstructionsKeyboard,
  buildWebUnlinkSuccessText,
  buildWebUnlinkSuccessKeyboard,
};
