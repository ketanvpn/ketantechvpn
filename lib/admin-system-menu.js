'use strict';

function buildTimezoneStatusText(options = {}) {
  const {
    timeZone = 'Asia/Jakarta',
    now = new Date(),
  } = options;

  const nowSample = now.toLocaleString('id-ID', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    '🌐 <b>PENGATURAN TIMEZONE BOT</b>\n\n' +
    `Timezone saat ini: <b>${timeZone}</b>\n` +
    `Waktu sekarang (versi bot): <b>${nowSample}</b>\n\n` +
    'Timezone ini dipakai untuk:\n' +
    '• Laporan harian\n' +
    '• Pengingat expired akun\n' +
    'ℹ️ Tampilan info lisensi /health\n\n' +
    'Silakan pilih timezone yang sesuai dengan lokasi kamu.'
  );
}

function buildTimezoneKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'WIB (Jakarta)', callback_data: 'timezone_set_wib' },
        { text: 'WITA (Makassar)', callback_data: 'timezone_set_wita' },
      ],
      [
        { text: 'WIT (Jayapura)', callback_data: 'timezone_set_wit' },
      ],
      [
        { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

function buildExpiryReminderStatusText(options = {}) {
  const {
    enabled = false,
    hour = 0,
    minute = 0,
    daysBefore = 1,
  } = options;

  const statusText = enabled ? '🟢 ON' : '🔴 OFF';
  const hourStr = String(hour).padStart(2, '0');
  const minuteStr = String(minute).padStart(2, '0');

  return (
    '<b>⏰ Pengaturan Pengingat Expired Akun</b>\n\n' +
    `Status       : <b>${statusText}</b>\n` +
    `Waktu kirim  : <b>${hourStr}:${minuteStr}</b> (waktu server)\n` +
    `Hari sebelum : <b>H-${daysBefore}</b>\n\n` +
    'Bot akan mengirim pesan ke user yang punya akun akan expired pada hari tersebut.'
  );
}

function buildExpiryReminderKeyboard(options = {}) {
  const { enabled = false } = options;

  return {
    inline_keyboard: [
      [
        {
          text: enabled ? '⛔ Matikan Pengingat' : '🔔 Nyalakan Pengingat',
          callback_data: 'expiry_reminder_toggle',
        },
      ],
      [
        { text: '➖ Jam -1', callback_data: 'expiry_hour_minus' },
        { text: '➕ Jam +1', callback_data: 'expiry_hour_plus' },
      ],
      [
        { text: '➖ Menit -5', callback_data: 'expiry_minute_minus' },
        { text: '➕ Menit +5', callback_data: 'expiry_minute_plus' },
      ],
      [
        { text: 'H-1', callback_data: 'expiry_days_1' },
        { text: 'H-2', callback_data: 'expiry_days_2' },
        { text: 'H-3', callback_data: 'expiry_days_3' },
      ],
      [
        { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

function buildAutoBackupStatusText(options = {}) {
  const {
    enabled = false,
    intervalHours = 24,
    backupChatId = '',
  } = options;

  const statusText = enabled ? '🟢 ON' : '🔴 OFF';
  return (
    '<b>💾 Pengaturan Auto Backup Database</b>\n\n' +
    `Status   : <b>${statusText}</b>\n` +
    `Interval : <b>${intervalHours}</b> jam\n` +
    `Tujuan   : <code>${backupChatId}</code>\n\n` +
    'Gunakan tombol di bawah untuk mengaktifkan/nonaktifkan dan mengubah interval backup.'
  );
}

function buildAutoBackupKeyboard(options = {}) {
  const { enabled = false } = options;

  return {
    inline_keyboard: [
      [
        {
          text: enabled ? '⛔ Matikan Auto Backup' : '💾 Nyalakan Auto Backup',
          callback_data: 'backup_auto_toggle',
        },
      ],
      [
        { text: '➖ -1 jam', callback_data: 'backup_auto_interval_minus' },
        { text: '➕ +1 jam', callback_data: 'backup_auto_interval_plus' },
      ],
      [
        { text: '6 jam', callback_data: 'backup_auto_set_6' },
        { text: '12 jam', callback_data: 'backup_auto_set_12' },
        { text: '24 jam', callback_data: 'backup_auto_set_24' },
      ],
      [
        { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

module.exports = {
  buildTimezoneStatusText,
  buildTimezoneKeyboard,
  buildExpiryReminderStatusText,
  buildExpiryReminderKeyboard,
  buildAutoBackupStatusText,
  buildAutoBackupKeyboard,
};
