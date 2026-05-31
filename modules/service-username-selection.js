'use strict';

function createServiceUsernameSelectionHandlers(options = {}) {
  const {
    bot,
    db,
    logger = console,
    userState,
    sendCleanMenu,
    showErrorOnMenu,
    getTrialConfig,
    defaultTrialConfig = {},
  } = options;

  if (!bot) throw new Error('createServiceUsernameSelectionHandlers: bot is required');
  if (!db) throw new Error('createServiceUsernameSelectionHandlers: db is required');
  if (!userState) throw new Error('createServiceUsernameSelectionHandlers: userState is required');
  if (typeof sendCleanMenu !== 'function') throw new Error('createServiceUsernameSelectionHandlers: sendCleanMenu is required');
  if (typeof showErrorOnMenu !== 'function') throw new Error('createServiceUsernameSelectionHandlers: showErrorOnMenu is required');
  if (typeof getTrialConfig !== 'function') throw new Error('createServiceUsernameSelectionHandlers: getTrialConfig is required');

  async function handleCreateOrRenewUsername(ctx) {
    const action = ctx.match[1];
    const type = ctx.match[2];
    const serverId = ctx.match[3];

    userState[ctx.chat.id] = {
      step: `username_${action}_${type}`,
      serverId,
      type,
      action,
      flowStartedAt: Date.now(),
    };

    db.get('SELECT batas_create_akun, total_create_akun FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err) {
        logger.error?.('⚠️ Error fetching server details:', err.message || err);
        return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
      }

      if (!server) {
        return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
      }

      const batasCreateAkun = server.batas_create_akun;
      const totalCreateAkun = server.total_create_akun;

      if (totalCreateAkun >= batasCreateAkun) {
        return sendCleanMenu(
          ctx,
          '⛔ <b>Server penuh.</b> Tidak dapat membuat akun baru di server ini.',
          { parse_mode: 'HTML' }
        );
      }

      await ctx.reply('👤 <b>Masukkan username:</b>', { parse_mode: 'HTML' });
    });
  }

  async function handleTrialUsername(ctx) {
    const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err) {
        logger.error?.('❌ Gagal mengambil data server:', err.message || err);
        return showErrorOnMenu(ctx, 'Terjadi kesalahan saat mengambil data server.');
      }

      if (!server) {
        return ctx.reply('⚠️ Server tidak ditemukan di database.');
      }

      userState[ctx.chat.id] = {
        step: `username_${action}_${type}`,
        serverId,
        type,
        action,
        serverName: server.nama_server || server.domain,
      };

      let cfg;
      try {
        cfg = await getTrialConfig();
      } catch (e) {
        cfg = defaultTrialConfig;
        logger.error?.('⚠️ Gagal membaca konfigurasi trial di konfirmasi server:', e.message || e);
      }

      const durationHours = cfg && Number.isInteger(cfg.durationHours) && cfg.durationHours > 0
        ? cfg.durationHours
        : defaultTrialConfig.durationHours;

      const maxPerDay = cfg && Number.isInteger(cfg.maxPerDay) && cfg.maxPerDay > 0
        ? cfg.maxPerDay
        : defaultTrialConfig.maxPerDay;

      const minBalance = cfg && Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial > 0
        ? cfg.minBalanceForTrial
        : 0;

      const serverName = server.nama_server || server.domain || `ID ${server.id}`;

      let info =
        `⚠️ <b>Konfirmasi Trial ${type.toUpperCase()}</b>\n\n` +
        `Kamu akan membuat akun <b>trial ${type.toUpperCase()}</b> di server <b>${serverName}</b>.\n\n` +
        '<b>Pengaturan trial saat ini:</b>\n' +
        `• Masa aktif trial   : <b>${durationHours} jam</b>\n` +
        `• Batas trial / hari : <b>${maxPerDay}x per user</b>\n`;

      if (minBalance > 0) {
        info += `• Minimal saldo trial: <b>Rp${minBalance}</b>\n`;
      }

      info +=
        '\nUsername untuk akun trial akan dibuat <b>acak otomatis oleh server</b>.\n' +
        'Jadi kamu <b>tidak perlu menentukan username sendiri</b>.\n\n' +
        'Kalau setuju, balas pesan ini dengan teks apa saja (contoh: <code>ok</code>, <code>lanjut</code>, atau emoji).\n' +
        'Setelah itu bot akan langsung membuat akun trial dan menampilkan username & password yang dibuat otomatis.';

      await sendCleanMenu(ctx, info, { parse_mode: 'HTML' });
    });
  }

  function register() {
    bot.action(/(create|renew)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, handleCreateOrRenewUsername);
    bot.action(/(trial)_username_(vmess|vless|trojan|shadowsocks|ssh)_(\d+)/, handleTrialUsername);
  }

  return {
    register,
    handleCreateOrRenewUsername,
    handleTrialUsername,
  };
}

module.exports = { createServiceUsernameSelectionHandlers };
