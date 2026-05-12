// scheduler/expiry-reminder.js - pengingat akun expired H-n ke user + loop.

function createExpiryReminderScheduler({
  logger,
  db,
  bot,
  getTimeInConfiguredTimeZone,
  getTimeZone,
  getMasterId,
  getDaysBefore,
  isEnabled,
  getHour,
  getMinute,
  getLastSentDateKey,
  setLastSentDateKey,
  checkIntervalMs = 60 * 1000,
}) {
  if (!logger) throw new Error('createExpiryReminderScheduler: logger required');
  if (!db) throw new Error('createExpiryReminderScheduler: db required');
  if (!bot) throw new Error('createExpiryReminderScheduler: bot required');
  if (typeof getTimeInConfiguredTimeZone !== 'function') {
    throw new Error('createExpiryReminderScheduler: getTimeInConfiguredTimeZone harus fungsi');
  }
  if (typeof isEnabled !== 'function' || typeof getHour !== 'function' || typeof getMinute !== 'function') {
    throw new Error('createExpiryReminderScheduler: getter config harus fungsi');
  }
  if (typeof getDaysBefore !== 'function') {
    throw new Error('createExpiryReminderScheduler: getDaysBefore harus fungsi');
  }
  if (typeof getMasterId !== 'function') {
    throw new Error('createExpiryReminderScheduler: getMasterId harus fungsi');
  }
  if (typeof getLastSentDateKey !== 'function' || typeof setLastSentDateKey !== 'function') {
    throw new Error('createExpiryReminderScheduler: getLastSentDateKey/setLastSentDateKey harus fungsi');
  }

  async function sendExpiryReminders() {
    try {
      if (!isEnabled()) {
        logger.info('Expiry reminder nonaktif, lewati pengecekan.');
        return;
      }

      const daysBefore = Number(getDaysBefore() || 3);
      const tz = typeof getTimeZone === 'function' ? getTimeZone() : 'Asia/Jakarta';
      const dayMs = 24 * 60 * 60 * 1000;
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const targetStart = todayStart + daysBefore * dayMs;
      const targetEnd = targetStart + dayMs;

      logger.info('Cek akun yang expired H-' + daysBefore + ' (range=' + targetStart + '..' + targetEnd + ')');

      const rows = await new Promise((resolve, reject) => {
        db.all(
          'SELECT a.user_id, a.username, a.type, a.server_id, a.expires_at, s.nama_server '
          + 'FROM accounts a LEFT JOIN Server s ON a.server_id = s.id '
          + 'WHERE a.expires_at IS NOT NULL AND a.expires_at >= ? AND a.expires_at < ?',
          [targetStart, targetEnd],
          (err, rowsRes) => {
            if (err) {
              logger.error('\u274c Gagal membaca akun untuk reminder expired:', err.message);
              return reject(err);
            }
            resolve(rowsRes || []);
          }
        );
      });

      if (!rows.length) {
        logger.info('Tidak ada akun yang perlu diingatkan (H-' + daysBefore + ').');
        return;
      }

      const grouped = {};
      for (const row of rows) {
        if (!row.user_id) continue;
        const uid = String(row.user_id);
        if (!grouped[uid]) grouped[uid] = [];
        grouped[uid].push(row);
      }

      const targetDateLabel = new Date(targetStart).toLocaleDateString('id-ID', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      let userCount = 0;
      let successCount = 0;
      let failCount = 0;

      for (const [userIdStr, accs] of Object.entries(grouped)) {
        const userIdNum = Number(userIdStr);
        if (!userIdNum) continue;

        userCount++;

        const akunLines = accs.map((acc, idx) => {
          const expLabel = new Date(acc.expires_at).toLocaleDateString('id-ID', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          });

          let serverLabel = '-';
          if (typeof acc.server_id !== 'undefined' && acc.server_id !== null) {
            if (acc.nama_server && String(acc.nama_server).trim() !== '') {
              serverLabel = String(acc.nama_server);
            } else {
              serverLabel = 'Server #' + acc.server_id;
            }
          }

          const uname = acc.username || '-';
          const jenis = acc.type || 'AKUN';
          return (idx + 1) + '. ' + uname + ' | ' + jenis + ' | ' + serverLabel + ' | exp: ' + expLabel;
        }).join('\n');

        const akunLinesBlock = '<code>' + akunLines + '</code>';

        const text =
          '\u23f0 <b>Peringatan Akun VPN Akan Berakhir</b>\n\n'
          + 'Beberapa akun VPN kamu akan expired <b>H-' + daysBefore + ' (tanggal ' + targetDateLabel + ')</b>:\n\n'
          + akunLinesBlock + '\n\n'
          + 'Kalau mau perpanjang, silakan buka menu bot:\n'
          + '\u2022 /start \u2192 \ud83d\udcc2 Akun Saya \u2192 pilih akun \u2192 Perpanjang.\n\n'
          + 'Kalau sudah diperpanjang, pesan ini bisa diabaikan \ud83d\ude4f';

        try {
          await bot.telegram.sendMessage(userIdNum, text, { parse_mode: 'HTML' });
          successCount++;
        } catch (err) {
          failCount++;
          logger.warn('Gagal kirim reminder expired ke user ' + userIdNum + ':', err.message || err);
        }
      }

      logger.info(
        'Reminder expired selesai: ' + rows.length + ' akun, '
          + userCount + ' user, sukses=' + successCount + ', gagal=' + failCount
      );

      const masterId = getMasterId();
      if (masterId) {
        try {
          await bot.telegram.sendMessage(
            masterId,
            '\ud83d\udd14 <b>Laporan Pengingat Expired</b>\n\n'
              + 'Hari ini cek H-' + daysBefore + ' (tanggal ' + targetDateLabel + ').\n'
              + 'Total akun: <b>' + rows.length + '</b>\n'
              + 'Total user: <b>' + userCount + '</b>\n'
              + 'Berhasil dikirimi: <b>' + successCount + '</b>\n'
              + 'Gagal (bot diblokir / error kirim): <b>' + failCount + '</b>',
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          logger.warn('Gagal kirim ringkasan reminder expired ke MASTER_ID:', e.message || e);
        }
      }
    } catch (err) {
      logger.error('\u274c Error di sendExpiryReminders:', err);
    }
  }

  function start() {
    if (global.__expiryReminderSchedulerStarted) {
      logger.info('Scheduler reminder expired sudah aktif, skip start kedua.');
      return;
    }
    global.__expiryReminderSchedulerStarted = true;

    const tz = typeof getTimeZone === 'function' ? getTimeZone() : 'Asia/Jakarta';
    logger.info(
      'Scheduler pengingat expired aktif: jam '
        + getHour() + ':' + String(getMinute()).padStart(2, '0')
        + ' (zona ' + tz + ', cek tiap 1 menit)'
    );

    setInterval(async () => {
      try {
        if (!isEnabled()) return;

        const { dateKey, hour, minute } = getTimeInConfiguredTimeZone();
        if (dateKey === getLastSentDateKey()) return;

        const nowTotalMinutes = hour * 60 + minute;
        const targetTotalMinutes = Number(getHour()) * 60 + Number(getMinute());

        if (nowTotalMinutes >= targetTotalMinutes) {
          logger.info('Waktu reminder expired tercapai, mulai kirim pengingat...');
          await sendExpiryReminders();
          setLastSentDateKey(dateKey);
        }
      } catch (err) {
        logger.error('\u274c Error di scheduler reminder expired:', err);
      }
    }, checkIntervalMs);
  }

  return { start, sendExpiryReminders };
}

module.exports = { createExpiryReminderScheduler };
