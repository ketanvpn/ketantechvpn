// scheduler/auto-backup.js - kirim backup DB ke BACKUP_CHAT_ID secara periodic.
// Factory ekspos `sendAutoBackup()` + `restart()`. Config di-baca via getter
// supaya toggle/interval dari menu admin langsung berlaku.

const fs = require('fs');
const path = require('path');

function createAutoBackupScheduler({
  logger,
  bot,
  isEnabled,
  getIntervalHours,
  getBackupChatId,
  getTimeZone,
  baseDir,
  backupFiles,
}) {
  if (!logger) throw new Error('createAutoBackupScheduler: logger required');
  if (typeof isEnabled !== 'function' || typeof getIntervalHours !== 'function') {
    throw new Error('createAutoBackupScheduler: isEnabled/getIntervalHours harus fungsi');
  }
  if (!bot) throw new Error('createAutoBackupScheduler: bot required');
  if (typeof getBackupChatId !== 'function') {
    throw new Error('createAutoBackupScheduler: getBackupChatId harus fungsi');
  }

  const rootDir = baseDir || process.cwd();
  const defaultFiles = ['sellvpn.db', 'ressel.db', 'trial.db', '.vars.json'];
  const fileList = Array.isArray(backupFiles) && backupFiles.length
    ? backupFiles
    : defaultFiles;

  async function sendAutoBackup(reason = 'backup otomatis') {
    try {
      const chatId = getBackupChatId();
      if (!chatId) {
        logger.warn('BACKUP_CHAT_ID tidak diset, lewati backup otomatis.');
        return;
      }

      const files = fileList
        .map((name) => path.join(rootDir, name))
        .filter((filePath) => fs.existsSync(filePath));

      if (files.length === 0) {
        await bot.telegram.sendMessage(
          chatId,
          '\u26a0\ufe0f Backup otomatis gagal: tidak ada file database yang ditemukan.'
        );
        return;
      }

      const tz = typeof getTimeZone === 'function' ? getTimeZone() : 'Asia/Jakarta';
      const waktu = new Date().toLocaleString('id-ID', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      await bot.telegram.sendMessage(
        chatId,
        '\ud83d\uddc4\ufe0f Mulai backup otomatis bot VPN.\nAlasan: <b>' + reason + '</b>\nWaktu: <b>' + waktu + '</b>',
        { parse_mode: 'HTML' }
      );

      for (const filePath of files) {
        const filename = path.basename(filePath);
        try {
          await bot.telegram.sendDocument(
            chatId,
            { source: filePath, filename },
            {
              caption: '\ud83d\udce6 Backup: <b>' + filename + '</b>\nWaktu: <b>' + waktu + '</b>',
              parse_mode: 'HTML',
            }
          );
        } catch (err) {
          logger.error('\u274c Gagal mengirim backup file ' + filename + ': ' + err.message);
        }
      }

      await bot.telegram.sendMessage(
        chatId,
        '\u2705 Backup otomatis selesai.\nTotal file: <b>' + files.length + '</b>',
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      logger.error('\u274c Error di sendAutoBackup:', err);
    }
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

  return { restart, sendAutoBackup };
}

module.exports = { createAutoBackupScheduler };
