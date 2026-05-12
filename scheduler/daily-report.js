// scheduler/daily-report.js - pemicu laporan harian jam tertentu.
// Factory: getter config supaya bisa update toggle/jam tanpa restart.

function createDailyReportScheduler({
  logger,
  getTimeInConfiguredTimeZone,
  getTimeZone,
  isEnabled,
  getHour,
  getMinute,
  sendDailyReport,
  getLastSentDateKey,
  setLastSentDateKey,
  checkIntervalMs = 60 * 1000,
}) {
  if (!logger) throw new Error('createDailyReportScheduler: logger required');
  if (typeof getTimeInConfiguredTimeZone !== 'function') {
    throw new Error('createDailyReportScheduler: getTimeInConfiguredTimeZone harus fungsi');
  }
  if (typeof isEnabled !== 'function' || typeof getHour !== 'function' || typeof getMinute !== 'function') {
    throw new Error('createDailyReportScheduler: getter config harus fungsi');
  }
  if (typeof sendDailyReport !== 'function') {
    throw new Error('createDailyReportScheduler: sendDailyReport harus fungsi');
  }
  if (typeof getLastSentDateKey !== 'function' || typeof setLastSentDateKey !== 'function') {
    throw new Error('createDailyReportScheduler: getLastSentDateKey/setLastSentDateKey harus fungsi');
  }

  function start() {
    if (global.__dailyReportSchedulerStarted) {
      logger.info('Scheduler laporan harian sudah aktif, skip start kedua.');
      return;
    }
    global.__dailyReportSchedulerStarted = true;

    setInterval(async () => {
      try {
        if (!isEnabled()) return;

        const { dateKey, hour, minute } = getTimeInConfiguredTimeZone();
        if (dateKey === getLastSentDateKey()) return;

        if (hour === getHour() && minute === getMinute()) {
          logger.info('Waktu laporan harian tercapai, mengirim laporan...');
          await sendDailyReport(false);
          setLastSentDateKey(dateKey);
        }
      } catch (err) {
        logger.error('\u274c Error di scheduler laporan harian:', err);
      }
    }, checkIntervalMs);

    const tz = typeof getTimeZone === 'function' ? getTimeZone() : 'Asia/Jakarta';
    logger.info(
      'Scheduler laporan harian aktif: jam '
        + getHour() + ':' + String(getMinute()).padStart(2, '0')
        + ' (zona ' + tz + ', cek tiap 1 menit)'
    );
  }

  return { start };
}

module.exports = { createDailyReportScheduler };
