// scheduler/auto-backup.js - kirim backup DB ke BACKUP_CHAT_ID secara periodic.
// Karena toggle ON/OFF + interval bisa diubah dari menu admin, factory ekspos
// `restart()` yang baca config terbaru via getter.

function createAutoBackupScheduler({
  logger,
  isEnabled,
  getIntervalHours,
  sendAutoBackup,
}) {
  if (!logger) throw new Error('createAutoBackupScheduler: logger required');
  if (typeof isEnabled !== 'function' || typeof getIntervalHours !== 'function') {
    throw new Error('createAutoBackupScheduler: getter config harus fungsi');
  }
  if (typeof sendAutoBackup !== 'function') {
    throw new Error('createAutoBackupScheduler: sendAutoBackup harus fungsi');
  }

  let timer = null;

  function restart() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    const intervalHours = Number(getIntervalHours() || 0);
    if (!isEnabled() || intervalHours <= 0) {
      logger.info('Auto-backup nonaktif atau interval tidak valid, scheduler tidak jalan.');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    timer = setInterval(() => {
      sendAutoBackup('backup otomatis tiap ' + intervalHours + ' jam').catch((err) => {
        logger.error('\u274c Gagal menjalankan backup otomatis:', err);
      });
    }, intervalMs);

    logger.info(
      'Auto-backup aktif setiap ' + intervalHours + ' jam (~' + (intervalMs / 1000) + ' detik).'
    );
  }

  return { restart };
}

module.exports = { createAutoBackupScheduler };
