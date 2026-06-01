'use strict';

function formatLicenseInfoText(expireDate, licenseInfo) {
  if (!expireDate) {
    return '⚠️ Lisensi bot tidak dibatasi tanggal (lifetime) atau belum diatur.\n';
  }

  const info = licenseInfo;
  if (!info) return '⚠️ Tidak dapat membaca informasi lisensi.\n';

  const dateText = info.expire && typeof info.expire.toLocaleDateString === 'function'
    ? info.expire.toLocaleDateString('id-ID')
    : String(info.expire || '-');

  if (info.daysLeft > 0) {
    return (
      `✅ Lisensi aktif sampai: <b>${dateText}</b>\n` +
      `📅 Sisa: <b>${info.daysLeft}</b> hari\n`
    );
  }

  if (info.daysLeft === 0) {
    return (
      `⚠️ Lisensi berakhir: <b>${dateText}</b>\n` +
      '⚠️ Status: <b>HARI INI</b>\n'
    );
  }

  return (
    `🔒 Lisensi habis: <b>${dateText}</b>\n` +
    `📅 Lewat: <b>${Math.abs(Number(info.daysLeft || 0))}</b> hari lalu\n`
  );
}

function buildMainMenuMessage(options = {}) {
  const {
    storeName = '',
    userName = '-',
    userId = '',
    saldo = 0,
    saldoSource = 'lokal',
    isAdmin = false,
    isReseller = false,
    expireDate = null,
    licenseInfo = null,
  } = options;

  let userStatus = '👤 Member';
  if (isAdmin) {
    userStatus = '👑 Admin';
  } else if (isReseller) {
    userStatus = '💎 Reseller';
  }

  const licenseInfoText = formatLicenseInfoText(expireDate, licenseInfo);

  const commandPanelText = isAdmin ? `
<code>✨ COMMAND PANEL</code>
• /start       → Menu Utama
• /admin       → Menu Admin
⭐ /helpadmin  → Panel Admin

${licenseInfoText}
` : '';

  return `
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>
<b>⚡ BOT VPN ${storeName} ⚡</b>
<i>📡 Koneksi cepat, aman, stabil.</i>
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>

<code>━━━━━━━ USER INFO ━━━━━━━━━━</code>
• Nama   : <b>${userName}</b>
• ID     : <code>${userId}</code>
• Saldo  : <code>Rp ${Number(saldo || 0).toLocaleString('id-ID')}</code>${saldoSource === 'web' ? ' 🌐' : ''}
• Status : <code>${userStatus}</code>
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>

<code>━━━━━ MENU UTAMA ━━━━━━━━━━━</code>
Gunakan tombol di bawah ini
untuk membuat akun, cek akun,
dan melihat riwayat penjualanmu.
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>

<code>━━━━━━━ INFO BOT ━━━━━━━━━━━━</code>
• Editor  : <b>KETANTECH</b>
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>

${commandPanelText}
`.trim();
}

function buildMainMenuKeyboard(options = {}) {
  const {
    isReseller = false,
    isAdmin = false,
    webLinkEnabled = false,
    webLinked = false,
  } = options;

  let keyboard = [
    [
      { text: '🛍️ Buat Akun', callback_data: 'service_create' },
      { text: '♻️ Perpanjang Akun', callback_data: 'my_accounts' }
    ],
    [
      { text: '📂 Akun Saya', callback_data: 'my_accounts' },
      { text: '💰 Cek Saldo', callback_data: 'user_balance' }
    ],
    [
      { text: '💳 TopUp Saldo QRIS', callback_data: 'topupqris_btn' },
      { text: '🧾 Riwayat Transaksi', callback_data: 'transaction_history:0' }
    ],
    [
      { text: '🆓 Trial Akun', callback_data: 'service_trial' },
      { text: '🖥️ Status Server', callback_data: 'cek_service' }
    ],
    [
      { text: '🎓 Akun EDU / Ilmupedia', callback_data: 'edukasi_menu' }
    ],
    [
      { text: '📈 Statistik & Riwayat Akun', callback_data: 'my_stats:0' },
      { text: '📘 Panduan Pakai', callback_data: 'vpn_guide' }
    ],
    [
      { text: '❓ Bantuan / Support', callback_data: 'help_user' }
    ],
    [
      { text: '💎 Upgrade ke Reseller (harga murah)', callback_data: 'jadi_reseller' }
    ]
  ];

  if (webLinkEnabled) {
    keyboard.push([
      {
        text: webLinked ? '✅ Akun Web Terhubung' : '🔗 Hubungkan Akun ke Web',
        callback_data: 'web_link_menu',
      },
    ]);
  }

  if (isReseller) {
    keyboard.splice(2, 0, [
      { text: '💵 Penjualan Saya', callback_data: 'sales_summary' }
    ]);
  }

  if (isReseller || isAdmin) {
    keyboard = keyboard.filter(row =>
      !row.some(btn => btn && btn.callback_data === 'jadi_reseller')
    );
  }

  return keyboard;
}

module.exports = {
  formatLicenseInfoText,
  buildMainMenuMessage,
  buildMainMenuKeyboard,
};
