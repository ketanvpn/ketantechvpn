// scheduler/reseller-target.js - cek target reseller bulanan + auto-downgrade.

function createResellerTargetScheduler({
  logger,
  db,
  bot,
  getTimeInConfiguredTimeZone,
  getTimeZone,
  getMasterId,
  getMin30dAccounts,
  getMinDaysPerMonth,
  readResellerSetSync,
  removeResellerIdFromCache,
  isEnabled,
  getCheckHour,
  getCheckMinute,
  getLastProcessedMonthKey,
  setLastProcessedMonthKey,
  checkIntervalMs = 60 * 1000,
}) {
  if (!logger) throw new Error('createResellerTargetScheduler: logger required');
  if (!db) throw new Error('createResellerTargetScheduler: db required');
  if (!bot) throw new Error('createResellerTargetScheduler: bot required');
  if (typeof getTimeInConfiguredTimeZone !== 'function') {
    throw new Error('createResellerTargetScheduler: getTimeInConfiguredTimeZone harus fungsi');
  }
  if (typeof isEnabled !== 'function'
    || typeof getCheckHour !== 'function'
    || typeof getCheckMinute !== 'function') {
    throw new Error('createResellerTargetScheduler: getter config harus fungsi');
  }
  if (typeof getMasterId !== 'function') {
    throw new Error('createResellerTargetScheduler: getMasterId harus fungsi');
  }
  if (typeof getMin30dAccounts !== 'function' || typeof getMinDaysPerMonth !== 'function') {
    throw new Error('createResellerTargetScheduler: getMin30dAccounts/getMinDaysPerMonth harus fungsi');
  }
  if (typeof readResellerSetSync !== 'function') {
    throw new Error('createResellerTargetScheduler: readResellerSetSync harus fungsi');
  }
  if (typeof removeResellerIdFromCache !== 'function') {
    throw new Error('createResellerTargetScheduler: removeResellerIdFromCache harus fungsi');
  }
  if (typeof getLastProcessedMonthKey !== 'function' || typeof setLastProcessedMonthKey !== 'function') {
    throw new Error('createResellerTargetScheduler: getLastProcessedMonthKey/setLastProcessedMonthKey harus fungsi');
  }

  async function checkAndDowngradeResellersForPreviousMonth() {
    try {
      const { dateKey } = getTimeInConfiguredTimeZone();
      const [yearStr, monthStr] = dateKey.split('-');
      let year = Number(yearStr);
      let month = Number(monthStr);

      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }

      const monthKey = year + '-' + String(month).padStart(2, '0');
      const monthStart = new Date(year, month - 1, 1).getTime();
      const monthEnd = new Date(year, month, 1).getTime();

      const resellerSet = readResellerSetSync();
      if (!resellerSet || resellerSet.size === 0) {
        logger.info('[ResellerTarget] Tidak ada reseller di cache, lewati periode ' + monthKey + '.');
        return;
      }

      const dayMs = 24 * 60 * 60 * 1000;
      const downgraded = [];
      const min30dAccounts = Number(getMin30dAccounts() || 0);
      const minDaysPerMonth = Number(getMinDaysPerMonth() || 0);

      for (const idStr of resellerSet) {
        const userId = Number(idStr);
        if (!userId || Number.isNaN(userId)) continue;

        const accounts = await new Promise((resolve) => {
          db.all(
            'SELECT created_at, expires_at FROM accounts '
            + 'WHERE user_id = ? AND created_at >= ? AND created_at < ?',
            [userId, monthStart, monthEnd],
            (err, rows) => {
              if (err) {
                logger.error('[ResellerTarget] Gagal ambil data akun untuk user ' + userId + ':', err.message || err);
                return resolve([]);
              }
              resolve(rows || []);
            }
          );
        });

        let totalAccounts = accounts.length;
        let totalDays = 0;
        let count30Days = 0;

        for (const acc of accounts) {
          if (!acc.expires_at || !acc.created_at) continue;
          const durMs = acc.expires_at - acc.created_at;
          let durDays = Math.round(durMs / dayMs);
          if (durDays < 1) durDays = 1;
          totalDays += durDays;
          if (durDays >= 30) count30Days++;
        }

        const meets30 = count30Days >= min30dAccounts;
        const meetsDays = totalDays >= minDaysPerMonth;

        if (!meets30 && !meetsDays) {
          const removed = removeResellerIdFromCache(userId);
          if (removed) {
            downgraded.push({ userId, totalAccounts, totalDays, count30Days });
          }
        }
      }

      for (const info of downgraded) {
        const { userId, totalAccounts, totalDays, count30Days } = info;
        try {
          await bot.telegram.sendMessage(
            userId,
            '\u26a0\ufe0f <b>Status Reseller Dibatalkan</b>\n\n'
              + 'Bulan sebelumnya kamu tidak mencapai target penjualan.\n\n'
              + '<b>Ringkasan bulan ' + monthKey + '</b>\n'
              + '\u2022 Akun terjual         : <b>' + totalAccounts + '</b>\n'
              + '\u2022 Akun \u2265 30 hari       : <b>' + count30Days + '</b>\n'
              + '\u2022 Total hari akumulasi: <b>' + totalDays + '</b> hari\n\n'
              + 'Status kamu sekarang berubah menjadi <b>member biasa</b>.\n'
              + 'Silakan hubungi admin bila ingin mengajukan jadi reseller lagi.',
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          logger.error('[ResellerTarget] Gagal kirim pesan downgrade ke user ' + userId + ':', e.message || e);
        }
      }

      const masterId = getMasterId();
      if (masterId && downgraded.length > 0) {
        const lines = downgraded.map((d, idx) =>
          (idx + 1) + '. ID <code>' + d.userId + '</code> \u2022 akun: <b>' + d.totalAccounts
            + '</b>, 30d: <b>' + d.count30Days + '</b>, total hari: <b>' + d.totalDays + '</b>'
        );

        const msg = '<b>\ud83d\udcdd Laporan Auto-Downgrade Reseller</b>\n'
          + 'Periode: <b>' + monthKey + '</b>\n'
          + 'Total reseller didowngrade: <b>' + downgraded.length + '</b>\n\n'
          + lines.join('\n');

        try {
          await bot.telegram.sendMessage(masterId, msg, { parse_mode: 'HTML' });
        } catch (e) {
          logger.error('[ResellerTarget] Gagal kirim laporan downgrade ke MASTER_ID:', e.message || e);
        }
      }

      logger.info('[ResellerTarget] Cek target reseller periode ' + monthKey
        + ' selesai. Didowngrade: ' + downgraded.length);
    } catch (err) {
      logger.error('[ResellerTarget] Error di checkAndDowngradeResellersForPreviousMonth:', err);
    }
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
        await checkAndDowngradeResellersForPreviousMonth();
      } catch (err) {
        logger.error('[ResellerTarget] Error di scheduler target reseller:', err);
      }
    }, checkIntervalMs);
  }

  return { start, checkAndDowngradeResellersForPreviousMonth };
}

module.exports = { createResellerTargetScheduler };
