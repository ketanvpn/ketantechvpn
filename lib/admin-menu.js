'use strict';

function formatAdminLicenseStatus(licenseInfo, timeZone = 'Asia/Jakarta') {
  if (!licenseInfo || !licenseInfo.expire) return '';

  const expireText = licenseInfo.expire.toLocaleDateString('id-ID', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  if (licenseInfo.daysLeft > 0) {
    return (
      '📜 <b>INFO LISENSI BOT</b>\n' +
      `Aktif sampai: <b>${expireText}</b>\n` +
      `Sisa: <b>${licenseInfo.daysLeft}</b> hari`
    );
  }

  if (licenseInfo.daysLeft === 0) {
    return (
      '📜 <b>INFO LISENSI BOT</b>\n' +
      `Berakhir: <b>${expireText}</b>\n` +
      '⚠️ Status: <b>HARI INI</b>'
    );
  }

  return (
    '📜 <b>INFO LISENSI BOT</b>\n' +
    `Habis: <b>${expireText}</b>\n` +
    `📅 Lewat: <b>${Math.abs(Number(licenseInfo.daysLeft || 0))}</b> hari lalu`
  );
}

function buildAdminMenuHeader(options = {}) {
  const {
    expireDate = null,
    licenseInfo = null,
    timeZone = 'Asia/Jakarta',
  } = options;

  let headerText = '<b>⚙️ MENU ADMIN</b>';
  if (expireDate && licenseInfo) {
    const statusText = formatAdminLicenseStatus(licenseInfo, timeZone);
    if (statusText) headerText += `\n\n${statusText}`;
  }
  return headerText;
}

function buildAdminMenuKeyboard() {
  return [
    [
      { text: '📊 Monitor User & Reseller', callback_data: 'monitor_panel' },
      { text: '📋 List Semua User', callback_data: 'list_all_users' },
    ],
    [
      { text: '🚩 Tandai User', callback_data: 'flag_user_start' },
      { text: '🧪 Pengaturan Trial', callback_data: 'admin_trial_menu' },
    ],
    [
      { text: '🧾 Reseller & Saldo', callback_data: 'admin_reseller_menu' },
    ],
    [
      { text: '🎓 Akun EDU / Ilmupedia', callback_data: 'admin_edukasi_menu' },
    ],
    [
      { text: '🎁 Template Promosi', callback_data: 'promo_template_menu' },
      { text: '📢 Kirim Pengumuman', callback_data: 'broadcast_menu' },
    ],
    [
      { text: '🖥️ Menu Server', callback_data: 'admin_server_menu' },
      { text: '🔔 Pengingat Expired', callback_data: 'expiry_reminder_menu' },
    ],
    [
      { text: '📦 Backup Database', callback_data: 'backup_db' },
      { text: '💾 Auto Backup', callback_data: 'backup_auto_menu' },
    ],
    [
      { text: '🌐 Timezone Bot', callback_data: 'timezone_menu' },
    ],
    [
      { text: '🔙 Kembali', callback_data: 'send_main_menu' },
    ],
  ];
}

module.exports = {
  formatAdminLicenseStatus,
  buildAdminMenuHeader,
  buildAdminMenuKeyboard,
};
