// scheduler/reseller-target.js - cek target reseller bulanan & auto-downgrade.

function createResellerTargetScheduler({
  logger,
  getTimeInConfiguredTimeZone,
  getTimeZone,
  isEnabled,
  getCheckHour,
  getCheckMinute,
  runCheck,
  getLastProcessedMonthKey,
  setLastProcessedMonthKey,
  checkIntervalMs = 60 * 1000,
}) {
  if (!logger) throw new Error('createResellerTargetScheduler: logger required');
  if (typeof getTimeInConfiguredTimeZone !== 'function') {
    throw new Error('createResellerTargetScheduler: getTimeInConfiguredTimeZone harus fungsi');
  }
  if (typeof isEnabled !== 'function'
    || typeof getCheckHour !== 'function'
    || typeof getCheckMinute !== 'function') {
    throw new Error('createResellerTargetScheduler: getter config harus fungsi');
  }
  if (typeof runCheck !== 'function') {
    throw new Error('createResellerTargetScheduler: runCheck harus fungsi');
  }
  if (typeof getLastProcessedMonthKey !== 'function' || typeof setLastProcessedMonthKey !== 'function') {
    throw new Error('createResellerTargetScheduler: getLastProcessedMonthKey/setLastProcessedMonthKey harus fungsi');
  }

  function start() {
    if (global.__resellerTargetSchedulerStarted) {
      logger.info('Scheduler target reseller sudah aktif, skip start kedua.');
      return;
    }
    global.__resellerTargetSchedulerStarted = true;

    const tz = typeof getTimeZone === 'function' ? getTimeZone() : 'Asia/Jakarta';
    logger.info(
      'Scheduler target reseller aktif: jam '
        + getCheckHour() + ':' + String(getCheckMinute()).padStart(2, '0')
        + ' (zona ' + tz + ', cek tiap 1 menit)'
    );

    setInterval(async () => {
      try {
        if (!isEnabled()) return;

        const { dateKey, hour, minute } = getTimeInConfiguredTimeZone();
        if (hour !== getCheckHour() || minute !== getCheckMinute()) return;

        const [yearStr, monthStr, dayStr] = dateKey.split('-');
        const day = Number(dayStr);
        if (day !== 1) return;

        let year = Number(yearStr);
        let month = Number(monthStr) - 1;
        if (month === 0) {
          month = 12;
          year -= 1;
        }

        const monthKey = year + '-' + String(month).padStart(2, '0');
        if (getLastProcessedMonthKey() === monthKey) return;

        setLastProcessedMonthKey(monthKey);
        await runCheck();
      } catch (err) {
        logger.error('[ResellerTarget] Error di scheduler target reseller:', err);
      }
    }, checkIntervalMs);
  }

  return { start };
}

module.exports = { createResellerTargetScheduler };
