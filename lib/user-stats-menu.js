'use strict';

function getAccountTypeLabel(type) {
  switch (type) {
    case 'ssh': return '🖥️ SSH';
    case 'vmess': return '🔐 VMess';
    case 'vless': return '🔒 VLess';
    case 'trojan': return '🛡️ Trojan';
    case 'shadowsocks': return '🌶️ Shadowsocks';
    default: return type || '-';
  }
}

function formatAccountDateTime(ts, timeZone = 'Asia/Jakarta') {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('id-ID', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAccountExpireDate(expiresAt, timeZone = 'Asia/Jakarta') {
  if (!expiresAt) return 'Tanpa masa aktif';
  return new Date(expiresAt).toLocaleDateString('id-ID', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function buildMyStatsText(options = {}) {
  const {
    totalAll = 0,
    totalActive = 0,
    totalExpired = 0,
    currentPage = 0,
    totalPages = 1,
    offset = 0,
    accounts = [],
    timeZone = 'Asia/Jakarta',
  } = options;

  const lines = [];

  lines.push('<b>📈 Riwayat Akun Kamu</b>');
  lines.push('<i>Catatan: Tanggal Expire adalah hari terakhir akun aktif. Setelah lewat tanggal itu, akun dianggap expired walaupun jam belum tertera di config.</i>\n');

  lines.push('<code>Ringkasan Akun</code>');
  lines.push(`• Total dibuat   : <b>${totalAll}</b> akun`);
  lines.push(`• Aktif sekarang : <b>${totalActive}</b> akun`);
  lines.push(`• Sudah expired  : <b>${totalExpired}</b> akun\n`);

  lines.push(`<code>Riwayat Akun (halaman ${currentPage + 1} dari ${totalPages})</code>`);

  if (!accounts.length) {
    lines.push('Belum ada akun yang tercatat di riwayat kamu.');
  } else {
    accounts.forEach((row, idx) => {
      const dibuatText = formatAccountDateTime(row.created_at, timeZone);
      const expireText = formatAccountExpireDate(row.expires_at, timeZone);
      const serverName = row.nama_server || row.domain || (row.server_id ? `Server #${row.server_id}` : '-');
      const username = row.username || '-';
      const nomor = offset + idx + 1;

      lines.push(
        `#${nomor} ${getAccountTypeLabel(row.type)}\n` +
        `   User   : <b>${username}</b>\n` +
        `   Server : ${serverName}\n` +
        `   Dibuat : ${dibuatText}\n` +
        `   Expire : ${expireText}`
      );
    });
  }

  return lines.join('\n');
}

function buildMyStatsKeyboard(options = {}) {
  const {
    currentPage = 0,
    totalPages = 1,
  } = options;

  const navButtons = [];
  if (currentPage > 0) {
    navButtons.push({
      text: '⬅️ Sebelumnya',
      callback_data: `my_stats:${currentPage - 1}`,
    });
  }
  if (currentPage < totalPages - 1) {
    navButtons.push({
      text: 'Selanjutnya ➡️',
      callback_data: `my_stats:${currentPage + 1}`,
    });
  }

  const keyboardRows = [];
  if (navButtons.length > 0) keyboardRows.push(navButtons);
  keyboardRows.push([
    { text: '🔙 Menu Utama', callback_data: 'send_main_menu' },
  ]);

  return { inline_keyboard: keyboardRows };
}

module.exports = {
  getAccountTypeLabel,
  formatAccountDateTime,
  formatAccountExpireDate,
  buildMyStatsText,
  buildMyStatsKeyboard,
};
