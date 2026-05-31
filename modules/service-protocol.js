'use strict';

const TYPES = ['vmess', 'vless', 'trojan', 'shadowsocks', 'ssh'];

function typeLabel(type) {
  switch (type) {
    case 'ssh': return 'SSH/OVPN';
    case 'vmess': return 'VMESS';
    case 'vless': return 'VLESS';
    case 'trojan': return 'TROJAN';
    case 'shadowsocks': return 'SHADOWSOCKS';
    default: return String(type || '').toUpperCase();
  }
}

function createServiceProtocolHandlers(options = {}) {
  const {
    bot,
    logger = console,
    getUserFlagStatus,
    startSelectServer,
  } = options;

  if (!bot) throw new Error('createServiceProtocolHandlers: bot is required');
  if (typeof getUserFlagStatus !== 'function') throw new Error('createServiceProtocolHandlers: getUserFlagStatus is required');
  if (typeof startSelectServer !== 'function') throw new Error('createServiceProtocolHandlers: startSelectServer is required');

  async function answerInvalidCallback(ctx, label) {
    try {
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      logger.error?.(`Gagal kirim callback error ${label}:`, e.message || e);
    }
  }

  async function showBlocked(ctx, action, type) {
    const label = typeLabel(type);

    if (action === 'trial') {
      try {
        await ctx.answerCbQuery('⚠️ Akses trial kamu dibatasi.', { show_alert: true });
      } catch (_) {}
      return ctx.reply(
        '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
          `Fitur <b>TRIAL ${label}</b> tidak dapat digunakan.\n` +
          'Silakan hubungi admin jika merasa ini salah.',
        { parse_mode: 'HTML' }
      );
    }

    if (action === 'create') {
      try {
        await ctx.answerCbQuery('⚠️ Akses buat akun kamu dibatasi.', { show_alert: true });
      } catch (_) {}
      return ctx.reply(
        '⚠️ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
          `Fitur <b>BUAT AKUN ${label}</b> tidak dapat digunakan.\n` +
          'Silakan hubungi admin jika merasa ini salah.',
        { parse_mode: 'HTML' }
      );
    }

    return null;
  }

  async function handleProtocol(ctx, action, type) {
    if (!ctx || !ctx.match) return answerInvalidCallback(ctx, `${action}_${type}`);

    if (action === 'trial' || action === 'create') {
      const userId = ctx.from.id;
      const flag = await getUserFlagStatus(userId);

      if (flag === 'NAKAL') {
        return showBlocked(ctx, action, type);
      }
    }

    return startSelectServer(ctx, action, type);
  }

  async function handleSimpleProtocol(ctx, action, type) {
    if (!ctx || !ctx.match) {
      return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
    }
    return startSelectServer(ctx, action, type);
  }

  function register() {
    for (const type of TYPES) {
      bot.action(`trial_${type}`, (ctx) => handleProtocol(ctx, 'trial', type));
      bot.action(`create_${type}`, (ctx) => handleProtocol(ctx, 'create', type));
      bot.action(`renew_${type}`, (ctx) => handleProtocol(ctx, 'renew', type));
    }

    // Legacy menu saat ini hanya menampilkan ssh/vmess/vless/trojan untuk aksi ini.
    // Tetap register shadowsocks juga supaya callback lama/deep-link tidak putus.
    for (const type of TYPES) {
      bot.action(`del_${type}`, (ctx) => handleSimpleProtocol(ctx, 'del', type));
      bot.action(`lock_${type}`, (ctx) => handleSimpleProtocol(ctx, 'lock', type));
      bot.action(`unlock_${type}`, (ctx) => handleSimpleProtocol(ctx, 'unlock', type));
    }
  }

  return {
    register,
    handleProtocol,
    handleSimpleProtocol,
  };
}

module.exports = { createServiceProtocolHandlers };
