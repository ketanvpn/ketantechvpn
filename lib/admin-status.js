'use strict';

function formatBotStatusLicenseText(expireDate, licenseInfo) {
  if (!expireDate) return '⚠️ Lisensi: <b>lifetime / belum diatur</b>';
  if (!licenseInfo) return '⚠️ Tidak dapat membaca informasi lisensi.';

  const expireText = licenseInfo.expire.toLocaleDateString('id-ID');
  if (licenseInfo.daysLeft > 0) {
    return `✅ Sampai: <b>${expireText}</b>\n📅 Sisa  : <b>${licenseInfo.daysLeft}</b> hari`;
  }
  if (licenseInfo.daysLeft === 0) {
    return `✅ Sampai: <b>${expireText}</b>\n⚠️ Status: <b>HARI INI</b>`;
  }
  return `🕒 Habis : <b>${expireText}</b>\n📅 Lewat : <b>${Math.abs(licenseInfo.daysLeft)}</b> hari`;
}

function formatTrialInfoText(trialCfg) {
  if (!trialCfg) return '⚠️ Gagal membaca konfigurasi trial.';
  const tStatus = trialCfg.enabled ? '🟢 ON' : '🔴 OFF';
  return (
    `Status   : ${tStatus}\n` +
    `Max/hari : <b>${trialCfg.maxPerDay}</b> x\n` +
    `Durasi   : <b>${trialCfg.durationHours}</b> jam\n` +
    `Min saldo: <b>${trialCfg.minBalanceForTrial}</b>`
  );
}

function buildBotStatusText(options = {}) {
  const {
    storeName = '',
    licenseText = '',
    autoBackupEnabled = false,
    autoBackupIntervalHours = null,
    backupChatId = '',
    expiryReminderEnabled = false,
    expiryReminderHour = 0,
    expiryReminderMinute = 0,
    expiryReminderDaysBefore = 1,
    timeZone = 'Asia/Jakarta',
    trialInfoText = '',
  } = options;

  const abStatus = autoBackupEnabled ? '🟢 ON' : '🔴 OFF';
  const abInterval = autoBackupIntervalHours && autoBackupIntervalHours > 0
    ? `${autoBackupIntervalHours} jam`
    : 'tidak di-set';
  const abChat = backupChatId && backupChatId !== '' ? `<code>${backupChatId}</code>` : '<i>belum di-set</i>';
  const erStatus = expiryReminderEnabled ? '🟢 ON' : '🔴 OFF';
  const erTime = `${String(expiryReminderHour).padStart(2, '0')}:${String(expiryReminderMinute).padStart(2, '0')}`;

  return `
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>
<b>📊 STATUS BOT VPN ${storeName}</b>
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>

<code>━━━━━ LISENSI BOT ━━━━━━━━━━━━━━</code>
${licenseText}
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>

<code>━━━━━ AUTO BACKUP DB ━━━━━━━━━━━</code>
• Status   : <b>${abStatus}</b>
• Interval : <b>${abInterval}</b>
• Chat ID  : ${abChat}
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>

<code>━━━━━ PENGINGAT EXPIRED ━━━━━━━━</code>
• Status   : <b>${erStatus}</b>
• H-       : <b>${expiryReminderDaysBefore}</b> hari
• Jam      : <b>${erTime}</b> (zona ${timeZone})
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>

<code>━━━━━ PENGATURAN TRIAL ━━━━━━━━━</code>
${trialInfoText}
<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>
`.trim();
}

function buildHelpAdminMessage() {
  return (
    '📜 DAFTAR PERINTAH ADMIN TAPEKETAN VPN\n' +
    '\n' +
    'Gunakan perintah berikut hanya jika Anda memahami fungsinya.\n' +
    'Beberapa perintah tertentu sebaiknya hanya dipakai OWNER / MASTER.\n' +
    '\n' +
    '1) PANEL & BANTUAN\n' +
    '- /admin        → Buka Menu Admin (panel tombol)\n' +
    '- /helpadmin    → Menampilkan daftar perintah admin ini\n' +
    '- /botstatus atau /statusbot -> Cek status bot & server\n' +
    '\n' +
    '2) MANAJEMEN USER & RESELLER\n' +
    '- /listuser     → Menampilkan daftar user yang terdaftar di database\n' +
    '- /addressel    → Menambahkan reseller baru\n' +
    '- /delressel    → Menghapus ID reseller\n' +
    '- /deluser      → Menghapus user dari database (hati-hati)\n' +
    '\n' +
    '3) SALDO & TRANSAKSI\n' +
    '- /addsaldo     → Menambahkan saldo ke akun user\n' +
    '- /minsaldo     → Mengurangi saldo akun user (misal setelah beli akun)\n' +
    '- /cekqris <invoice_id> -> Cek status QRIS manual (invoice tertentu)\n' +
    '\n' +
    '4) SERVER & PAKET\n' +
    '- /addserver          → Menambahkan server baru\n' +
    '- /addserver_reseller → Mengatur server default untuk reseller\n' +
    '- /editharga          → Mengedit harga paket pada server\n' +
    '- /editauth           → Mengedit akun/auth panel (jika dipakai)\n' +
    '- /editdomain         → Mengedit domain server\n' +
    '- /editlimitcreate    → Mengedit batas pembuatan akun per server\n' +
    '- /editlimitip        → Mengedit batas jumlah IP per akun\n' +
    '- /editlimitquota     → Mengedit batas kuota paket\n' +
    '- /editnama           → Mengedit nama server\n' +
    '- /edittotalcreate    → Mengedit total limit pembuatan akun server\n' +
    '\n' +
    '5) BROADCAST & PENGUMUMAN\n' +
    '- /broadcast      → Broadcast ke semua user\n' +
    '- /broadcastres   → Broadcast ke semua reseller\n' +
    '- /broadcastmem   → Broadcast ke semua member biasa\n' +
    '- /lastbroadcast  → Menampilkan ringkasan broadcast terakhir\n' +
    '\n' +
    '6) LOG & MAINTENANCE\n' +
    '- /hapuslog       → Menghapus file log bot\n' +
    '- /testgroup      → Menguji kirim pesan ke GROUP_ID (alat uji/debug)\n' +
    '\n' +
    '7) LISENSI BOT\n' +
    '- /lisensi        → Melihat masa aktif lisensi bot (expire date & sisa hari)\n' +
    '- /addhari        → Menambah masa aktif lisensi bot (biasanya khusus OWNER/MASTER)\n' +
    '- /kuranghari     → Mengurangi masa aktif lisensi bot (biasanya khusus OWNER/MASTER)\n' +
    '\n' +
    '8) LAPORAN, BACKUP & REMINDER\n' +
    '- /health               → Cek kesehatan bot (lisensi, database, auto-backup, laporan harian, pengingat expired, uptime)\n' +
    '- /daily_report_test    → Mengirim laporan harian secara manual (mode test)\n' +
    '- /backup_auto_test     → Menguji fungsi auto-backup sekali (test kirim backup)\n' +
    '- /expired_reminder_test → Preview tampilan pesan pengingat akun expired ke chat Anda\n' +
    '\n' +
    '9) TROUBLESHOOTING / MODERASI\n' +
    '- /setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan...] -> Tandai status user\n' +
    '\n' +
    'Catatan:\n' +
    '- Hak akses admin diatur melalui MASTER_ID dan ADMIN_IDS di file .vars.json\n' +
    '- Jangan gunakan perintah penghapusan/ubah server/lisensi jika belum paham akibatnya.\n'
  );
}

function formatDateTimeId(date, timeZone = 'Asia/Jakarta') {
  return date.toLocaleString('id-ID', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateId(date, timeZone = 'Asia/Jakarta') {
  return date.toLocaleDateString('id-ID', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function buildLicenseInfoText(options = {}) {
  const {
    licenseInfo,
    now = new Date(),
    timeZone = 'Asia/Jakarta',
  } = options;

  const nowText = formatDateTimeId(now, timeZone);
  const expireText = formatDateId(licenseInfo.expire, timeZone);

  let statusText;
  if (licenseInfo.daysLeft > 0) {
    statusText = `✅ Lisensi masih aktif.\nSisa: <b>${licenseInfo.daysLeft}</b> hari lagi.`;
  } else if (licenseInfo.daysLeft === 0) {
    statusText = '⚠️ Lisensi akan berakhir <b>hari ini</b>.';
  } else {
    statusText = `⛔ Lisensi sudah kadaluarsa <b>${Math.abs(licenseInfo.daysLeft)}</b> hari yang lalu.`;
  }

  return (
    '<b>📜 INFO LISENSI BOT</b>\n\n' +
    `Aktif sampai: <b>${expireText}</b>\n` +
    `${statusText}\n\n` +
    `Waktu sekarang: ${nowText}`
  );
}

function buildHealthLicenseStatus(expireDate, licenseInfo, timeZone = 'Asia/Jakarta') {
  if (!expireDate) return '⚠️ EXPIRE_DATE belum di-set di .vars.json';
  const expireText = formatDateId(licenseInfo.expire, timeZone);
  if (licenseInfo.daysLeft > 0) {
    return `✅ Aktif, sisa <b>${licenseInfo.daysLeft}</b> hari (sampai <b>${expireText}</b>)`;
  }
  if (licenseInfo.daysLeft === 0) {
    return `⚠️ Akan berakhir <b>HARI INI</b> (sampai ${expireText})`;
  }
  return `⛔ Sudah kadaluarsa <b>${Math.abs(licenseInfo.daysLeft)}</b> hari yang lalu (terakhir <b>${expireText}</b>)`;
}

function buildHealthText(options = {}) {
  const {
    now = new Date(),
    timeZone = 'Asia/Jakarta',
    uptimeSeconds = 0,
    licenseStatus = '',
    dbStatus = '',
    autoBackupEnabled = false,
    autoBackupIntervalHours = null,
    backupChatId = '',
    dailyReportEnabled = false,
    dailyReportHour = 0,
    dailyReportMinute = 0,
    expiryReminderEnabled = false,
    expiryReminderHour = 0,
    expiryReminderMinute = 0,
    expiryReminderDaysBefore = 1,
  } = options;

  const upSec = Math.floor(uptimeSeconds);
  const upHour = Math.floor(upSec / 3600);
  const upMin = Math.floor((upSec % 3600) / 60);
  const nowText = formatDateTimeId(now, timeZone);
  const abStatus = autoBackupEnabled ? '🟢 ON' : '🔴 OFF';
  const abDetail = backupChatId
    ? `Interval: <b>${autoBackupIntervalHours}</b> jam\n   Tujuan : <code>${backupChatId}</code>`
    : '⚠️ BACKUP_CHAT_ID belum di-set (pakai MASTER_ID atau set manual).';
  const drStatus = dailyReportEnabled ? '🟢 ON' : '🔴 OFF';
  const drTime = `${String(dailyReportHour).padStart(2, '0')}:${String(dailyReportMinute).padStart(2, '0')}`;
  const erStatus = expiryReminderEnabled ? '🟢 ON' : '🔴 OFF';
  const erTime = `${String(expiryReminderHour).padStart(2, '0')}:${String(expiryReminderMinute).padStart(2, '0')}`;
  const erDays = `H-${expiryReminderDaysBefore}`;

  return (
    '<b>📊 STATUS BOT & SERVER</b>\n\n' +
    '<code>Waktu Sekarang</code>\n' +
    `⏰ ${nowText}\n` +
    `⏱️ Uptime bot: <b>${upHour} jam ${upMin} menit</b>\n\n` +
    '<code>Lisensi Bot</code>\n' +
    `📅 ${licenseStatus}\n\n` +
    '<code>Database</code>\n' +
    `💾 ${dbStatus}\n\n` +
    '<code>Auto Backup</code>\n' +
    `• Status  : ${abStatus}\n` +
    `• ${abDetail}\n\n` +
    '<code>Laporan Harian</code>\n' +
    `• Status : ${drStatus}\n` +
    `• Jam    : <b>${drTime}</b>\n\n` +
    '<code>Pengingat Expired Akun</code>\n' +
    `• Status : ${erStatus}\n` +
    `• Jadwal : <b>${erTime}</b>\n` +
    `• Mode   : <b>${erDays}</b>\n\n` +
    'Kalau ada yang merah/kuning, cek pengaturan di .vars.json atau menu Admin.'
  );
}

module.exports = {
  formatBotStatusLicenseText,
  formatTrialInfoText,
  buildBotStatusText,
  buildHelpAdminMessage,
  formatDateTimeId,
  formatDateId,
  buildLicenseInfoText,
  buildHealthLicenseStatus,
  buildHealthText,
};
