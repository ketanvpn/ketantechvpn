// scheduler/daily-report.js - laporan harian ke master chat + loop scheduler.
// Factory: body sendDailyReport + start(). Config di-baca via getter supaya
// toggle/jam dari menu admin langsung berlaku.

const fs = require('fs');

function createDailyReportScheduler({
  logger,
  db,
  bot,
  getTimeInConfiguredTimeZone,
  getTimeZone,
  getMasterId,
  getResselFilePath,
  getUsernameById,
  isEnabled,
  getHour,
  getMinute,
  getLastSentDateKey,
  setLastSentDateKey,
  checkIntervalMs = 60 * 1000,
}) {
  if (!logger) throw new Error('createDailyReportScheduler: logger required');
  if (!db) throw new Error('createDailyReportScheduler: db required');
  if (!bot) throw new Error('createDailyReportScheduler: bot required');
  if (typeof getTimeInConfiguredTimeZone !== 'function') {
    throw new Error('createDailyReportScheduler: getTimeInConfiguredTimeZone harus fungsi');
  }
  if (typeof isEnabled !== 'function' || typeof getHour !== 'function' || typeof getMinute !== 'function') {
    throw new Error('createDailyReportScheduler: getter config harus fungsi');
  }
  if (typeof getMasterId !== 'function') {
    throw new Error('createDailyReportScheduler: getMasterId harus fungsi');
  }
  if (typeof getLastSentDateKey !== 'function' || typeof setLastSentDateKey !== 'function') {
    throw new Error('createDailyReportScheduler: getLastSentDateKey/setLastSentDateKey harus fungsi');
  }

  async function sendDailyReport(isManual = false) {
    try {
      const chatId = getMasterId();
      if (!chatId) {
        logger.warn('MASTER_ID tidak diset, lewati laporan harian.');
        return;
      }

      const tz = typeof getTimeZone === 'function' ? getTimeZone() : 'Asia/Jakarta';
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
      const tanggalLabel = now.toLocaleDateString('id-ID', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      const totalCreatedToday = await new Promise((resolve) => {
        db.get(
          'SELECT COUNT(*) AS count FROM accounts WHERE created_at >= ? AND created_at < ?',
          [todayStart, tomorrowStart],
          (err, row) => {
            if (err) {
              logger.error('Gagal menghitung akun hari ini:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      });

      const [totalAccounts, totalActiveAccounts, totalExpiredAccounts] = await Promise.all([
        new Promise((resolve) => {
          db.get('SELECT COUNT(*) AS count FROM accounts', [], (err, row) => {
            if (err) {
              logger.error('Gagal menghitung total accounts:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          });
        }),
        new Promise((resolve) => {
          db.get(
            'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NULL OR expires_at > ?',
            [Date.now()],
            (err, row) => {
              if (err) {
                logger.error('Gagal menghitung akun aktif:', err.message);
                return resolve(0);
              }
              resolve(row ? row.count : 0);
            }
          );
        }),
        new Promise((resolve) => {
          db.get(
            'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NOT NULL AND expires_at <= ?',
            [Date.now()],
            (err, row) => {
              if (err) {
                logger.error('Gagal menghitung akun expired:', err.message);
                return resolve(0);
              }
              resolve(row ? row.count : 0);
            }
          );
        }),
      ]);

      const totalUsers = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) AS count FROM users', [], (err, row) => {
          if (err) {
            logger.error('Gagal menghitung total users:', err.message);
            return resolve(0);
          }
          resolve(row ? row.count : 0);
        });
      });

      let resellerSet = new Set();
      let totalReseller = 0;
      try {
        const resselFilePath = typeof getResselFilePath === 'function' ? getResselFilePath() : null;
        if (resselFilePath && fs.existsSync(resselFilePath)) {
          const fileContent = fs.readFileSync(resselFilePath, 'utf8');
          const resellerList = fileContent
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l !== '');
          resellerSet = new Set(resellerList);
          totalReseller = resellerSet.size;
        }
      } catch (e) {
        logger.error('Gagal membaca ressel.db saat laporan harian:', e.message);
      }

      const topResellerRows = await new Promise((resolve) => {
        db.all(
          'SELECT user_id, COUNT(*) AS total_all, '
          + 'SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS total_today '
          + 'FROM accounts GROUP BY user_id ORDER BY total_today DESC, total_all DESC',
          [todayStart, tomorrowStart],
          (err, rows) => {
            if (err) {
              logger.error('Gagal mengambil data top reseller (harian):', err.message);
              return resolve([]);
            }
            resolve(rows || []);
          }
        );
      });

      const topResellersToday = [];
      for (const row of topResellerRows) {
        const uidStr = String(row.user_id);
        if (!resellerSet.has(uidStr)) continue;
        if (row.total_today > 0) topResellersToday.push(row);
        if (topResellersToday.length >= 5) break;
      }

      const lines = [];
      lines.push('<b>\ud83d\udcca Laporan Harian Bot VPN \u2022 ' + tanggalLabel + '</b>\n');

      lines.push('<code>Ringkasan Pengguna</code>');
      lines.push('\u2022 Total user    : <b>' + totalUsers + '</b>');
      lines.push('\u2022 Total reseller: <b>' + totalReseller + '</b>\n');

      lines.push('<code>Ringkasan Akun</code>');
      lines.push('\u2022 Total akun (semua) : <b>' + totalAccounts + '</b>');
      lines.push('\u2022 Akun aktif sekarang: <b>' + totalActiveAccounts + '</b>');
      lines.push('\u2022 Akun expired        : <b>' + totalExpiredAccounts + '</b>\n');

      lines.push('<code>Aktivitas Hari Ini</code>');
      lines.push('\u2022 Akun dibuat hari ini: <b>' + totalCreatedToday + '</b>\n');

      lines.push('<code>Top Reseller Hari Ini</code>');
      if (topResellersToday.length === 0) {
        lines.push('Belum ada reseller yang membuat akun hari ini.');
      } else {
        let no = 1;
        for (const r of topResellersToday) {
          let username = '';
          try {
            if (typeof getUsernameById === 'function') {
              username = await getUsernameById(r.user_id);
            }
          } catch (_) {
            username = '';
          }
          const displayName = username
            ? (username.startsWith('@') ? username : '@' + username)
            : 'ID:' + r.user_id;
          const totalToday = r.total_today || 0;
          const totalAll = r.total_all || 0;
          lines.push(
            no + '. ' + displayName + ' \u2022 hari ini: <b>' + totalToday + '</b> akun | total: <b>' + totalAll + '</b> akun'
          );
          no++;
        }
      }

      lines.push('\n<i>Laporan ini dikirim ' + (isManual ? 'manual (/daily_report_test).' : 'otomatis setiap hari.') + '</i>');

      await bot.telegram.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });
      logger.info('Laporan harian berhasil dikirim ke MASTER_ID.');
    } catch (err) {
      logger.error('\u274c Error di sendDailyReport:', err);
    }
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

  return { start, sendDailyReport };
}

module.exports = { createDailyReportScheduler };
