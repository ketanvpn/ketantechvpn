'use strict';

function createServiceMenuHandlers(options = {}) {
  const {
    bot,
    logger = console,
    sendCleanMenu,
    getTrialConfig,
  } = options;

  if (!bot) throw new Error('createServiceMenuHandlers: bot is required');
  if (typeof sendCleanMenu !== 'function') throw new Error('createServiceMenuHandlers: sendCleanMenu is required');

  async function answerInvalidCallback(ctx, label) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      logger.error?.(`Gagal kirim callback error ${label}:`, e.message || e);
    }
  }

  function buildKeyboard(action) {
    if (action === 'create') {
      return [
        [{ text: '🖥️ Buat SSH / OpenVPN', callback_data: 'create_ssh' }],
        [
          { text: '🔗 Buat VMess', callback_data: 'create_vmess' },
          { text: '🔗 Buat VLess', callback_data: 'create_vless' },
        ],
        [{ text: '🛡️ Buat Trojan', callback_data: 'create_trojan' }],
        [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }],
      ];
    }

    if (action === 'trial') {
      return [
        [{ text: '🖥️ Trial SSH / OpenVPN', callback_data: 'trial_ssh' }],
        [
          { text: '🔗 Trial VMess', callback_data: 'trial_vmess' },
          { text: '🔗 Trial VLess', callback_data: 'trial_vless' },
        ],
        [{ text: '🛡️ Trial Trojan', callback_data: 'trial_trojan' }],
        [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }],
      ];
    }

    if (action === 'renew') {
      return [
        [{ text: '♻️ Perpanjang SSH / OpenVPN', callback_data: 'renew_ssh' }],
        [
          { text: '♻️ Perpanjang VMess', callback_data: 'renew_vmess' },
          { text: '♻️ Perpanjang VLess', callback_data: 'renew_vless' },
        ],
        [{ text: '♻️ Perpanjang Trojan', callback_data: 'renew_trojan' }],
        [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }],
      ];
    }

    if (action === 'del') {
      return [
        [{ text: '🗑️ Hapus SSH / OpenVPN', callback_data: 'del_ssh' }],
        [
          { text: '🗑️ Hapus VMess', callback_data: 'del_vmess' },
          { text: '🗑️ Hapus VLess', callback_data: 'del_vless' },
        ],
        [{ text: '🗑️ Hapus Trojan', callback_data: 'del_trojan' }],
        [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }],
      ];
    }

    if (action === 'lock') {
      return [
        [{ text: '🔒 Lock SSH / OpenVPN', callback_data: 'lock_ssh' }],
        [
          { text: '🔒 Lock VMess', callback_data: 'lock_vmess' },
          { text: '🔒 Lock VLess', callback_data: 'lock_vless' },
        ],
        [{ text: '🔒 Lock Trojan', callback_data: 'lock_trojan' }],
        [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }],
      ];
    }

    if (action === 'unlock') {
      return [
        [{ text: '🔓 Unlock SSH / OpenVPN', callback_data: 'unlock_ssh' }],
        [
          { text: '🔓 Unlock VMess', callback_data: 'unlock_vmess' },
          { text: '🔓 Unlock VLess', callback_data: 'unlock_vless' },
        ],
        [{ text: '🔓 Unlock Trojan', callback_data: 'unlock_trojan' }],
        [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }],
      ];
    }

    return null;
  }

  async function showServiceMenu(ctx, action) {
    const keyboard = buildKeyboard(action);
    if (!keyboard) {
      logger.warn?.(`Service menu action tidak dikenal: ${action}`);
      return sendCleanMenu(ctx, '⚠️ Menu layanan tidak dikenal.', { parse_mode: 'HTML' });
    }

    if (action === 'trial') {
      let durationHours = 1;
      let maxPerDay = 1;
      let minBalance = 0;

      try {
        const cfg = typeof getTrialConfig === 'function' ? await getTrialConfig() : null;
        if (cfg) {
          if (Number.isInteger(cfg.durationHours)) durationHours = cfg.durationHours;
          if (Number.isInteger(cfg.maxPerDay)) maxPerDay = cfg.maxPerDay;
          if (Number.isInteger(cfg.minBalanceForTrial)) minBalance = cfg.minBalanceForTrial;
        }
      } catch (e) {
        logger.error?.('⚠️ Gagal membaca konfigurasi trial di service menu:', e.message || e);
      }

      let infoText =
        '🆓 *Trial Akun*\n\n' +
        `⏱️ Masa aktif trial saat ini sekitar *${durationHours} jam*.\n` +
        `🔄 Setiap user bisa memakai trial hingga *${maxPerDay}x per hari* (kecuali reseller).\n`;

      if (minBalance > 0) {
        infoText += `💰 Trial hanya bisa digunakan jika saldo kamu minimal *Rp${minBalance}*.\n`;
      }

      infoText +=
        '💡 Trial dipakai untuk coba kualitas server sebelum kamu beli akun berbayar.\n\n' +
        'Kalau cocok, kamu bisa lanjut beli akun lewat menu *🛍️ Buat Akun* atau daftar sebagai *Reseller*.\n\n' +
        'Silakan pilih jenis akun yang mau kamu coba:';

      try {
        await sendCleanMenu(ctx, infoText, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard },
        });
        logger.info?.('trial service menu sent (clean)');
      } catch (error) {
        logger.error?.('Error saat mengirim menu trial:', error);
      }
      return;
    }

    try {
      const msgText = `Pilih jenis layanan yang ingin Anda ${action}:`;
      await sendCleanMenu(ctx, msgText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
      logger.info?.(`${action} service menu sent (clean)`);
    } catch (error) {
      logger.error?.(`Error saat mengirim menu ${action}:`, error);
    }
  }

  async function showTrialMenu(ctx) {
    if (!ctx || !ctx.match) return answerInvalidCallback(ctx, 'service_trial');

    try {
      const cfg = typeof getTrialConfig === 'function' ? await getTrialConfig() : null;
      if (cfg && !cfg.enabled) {
        return sendCleanMenu(
          ctx,
          '⛔ <b>Fitur trial sedang dimatikan oleh admin.</b>\n\n' +
            'Silakan gunakan menu <b>🛍️ Buat Akun</b> untuk membeli akun,\n' +
            'atau coba lagi nanti ketika trial diaktifkan kembali.',
          { parse_mode: 'HTML' }
        );
      }
    } catch (err) {
      logger.error?.('⚠️ Gagal membaca konfigurasi trial:', err.message || err);
    }

    return showServiceMenu(ctx, 'trial');
  }

  function register() {
    bot.action('service_trial', showTrialMenu);
    bot.action('service_create', async (ctx) => {
      if (!ctx || !ctx.match) return answerInvalidCallback(ctx, 'service_create');
      return showServiceMenu(ctx, 'create');
    });
    bot.action('service_renew', async (ctx) => {
      if (!ctx || !ctx.match) return answerInvalidCallback(ctx, 'service_renew');
      return showServiceMenu(ctx, 'renew');
    });
    bot.action('service_del', async (ctx) => {
      if (!ctx || !ctx.match) return answerInvalidCallback(ctx, 'service_del');
      return showServiceMenu(ctx, 'del');
    });
    bot.action('service_lock', async (ctx) => {
      if (!ctx || !ctx.match) return answerInvalidCallback(ctx, 'service_lock');
      return showServiceMenu(ctx, 'lock');
    });
    bot.action('service_unlock', async (ctx) => {
      if (!ctx || !ctx.match) return answerInvalidCallback(ctx, 'service_unlock');
      return showServiceMenu(ctx, 'unlock');
    });
  }

  return {
    register,
    showServiceMenu,
    showTrialMenu,
    buildKeyboard,
  };
}

module.exports = { createServiceMenuHandlers };
