// scheduler/expiry-reminder.js - pengingat akun expired tiap hari.

function createExpiryReminderScheduler({
  logger,
  getTimeInConfiguredTimeZone,
  getTimeZone,
  isEnabled,
  getHour,
  getMinute,
  sendExpiryReminders,
  getLastSentDateKey,
  setLastSentDateKey,
  checkIntervalMs = 60 * 1000,
}) {
  if (!logger) throw new Error('createExpiryReminderScheduler: logger required');
  if (typeof getTimeInConfiguredTimeZone !== 'function') {
    throw new Error('createExpiryReminderScheduler: getTimeInConfiguredTimeZone harus fungsi');
  }
  if (typeof isEnabled !== 'function' || typeof getHour !== 'function' || typeof getMinute !== 'function') {
    throw new Error('createExpiryReminderScheduler: getter config harus fungsi');
  }
  if (typeof sendExpiryReminders !== 'function') {
    throw new Error('createExpiryReminderScheduler: sendExpiryReminders harus fungsi');
  }
  if (typeof getLastSentDateKey !== 'function' || typeof setLastSentDateKey !== 'function') {
    throw new Error('createExpiryReminderScheduler: getLastSentDateKey/setLastSentDateKey harus fungsi');
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

  return { start };
}

module.exports = { createExpiryReminderScheduler };
