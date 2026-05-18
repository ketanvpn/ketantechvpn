// admin/edukasi.js
// Submenu admin untuk Paket Edukasi (vpnbiz):
//   - Cek profile & saldo vpnbiz
//   - Set API key vpnbiz (command + tombol via state input)
//   - Edit harga (member/reseller, monthly/weekly)
//   - Edit limit trial harian per user
//
// Pakai pattern factory yang sama dengan admin/reseller.js & admin/menu.js.

function formatRupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

function createEdukasiAdminHandlers({
  bot,
  logger,
  ADMIN_IDS,
  edukasiClient,
  edukasiService,
  state,
  updateVarsPartial,
  adminState,
}) {
  if (!bot) throw new Error('createEdukasiAdminHandlers: bot required');
  if (!logger) throw new Error('createEdukasiAdminHandlers: logger required');
  if (!Array.isArray(ADMIN_IDS)) {
    throw new Error('createEdukasiAdminHandlers: ADMIN_IDS harus array');
  }
  if (!edukasiClient) throw new Error('createEdukasiAdminHandlers: edukasiClient required');
  if (!edukasiService) throw new Error('createEdukasiAdminHandlers: edukasiService required');
  if (!state || typeof state !== 'object') {
    throw new Error('createEdukasiAdminHandlers: state object required');
  }
  for (const k of [
    'getMemberMonthly', 'setMemberMonthly',
    'getMemberWeekly', 'setMemberWeekly',
    'getResellerMonthly', 'setResellerMonthly',
    'getResellerWeekly', 'setResellerWeekly',
    'getTrialMaxPerDay', 'setTrialMaxPerDay',
  ]) {
    if (typeof state[k] !== 'function') {
      throw new Error('createEdukasiAdminHandlers: state.' + k + ' harus fungsi');
    }
  }
  if (typeof updateVarsPartial !== 'function') {
    throw new Error('createEdukasiAdminHandlers: updateVarsPartial harus fungsi');
  }

  function isAdmin(ctx) {
    return ctx.from && ADMIN_IDS.includes(ctx.from.id);
  }

  function persistPrices() {
    updateVarsPartial({
      EDUKASI_PRICE_MEMBER_MONTHLY: state.getMemberMonthly(),
      EDUKASI_PRICE_MEMBER_WEEKLY: state.getMemberWeekly(),
      EDUKASI_PRICE_RESELLER_MONTHLY: state.getResellerMonthly(),
      EDUKASI_PRICE_RESELLER_WEEKLY: state.getResellerWeekly(),
      EDUKASI_TRIAL_MAX_PER_DAY: state.getTrialMaxPerDay(),
    });
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  }

  async function renderMenu(ctx, options = {}) {
    const isEdit = !!options.edit;
    const lines = [];
    lines.push('\uD83C\uDF93 *Pengaturan Akun Direct EDU (vpnbiz)*');
    lines.push('');
    lines.push('*Harga Member*');
    lines.push('\u2022 Bulanan : ' + formatRupiah(state.getMemberMonthly()));
    lines.push('\u2022 Mingguan: ' + formatRupiah(state.getMemberWeekly()));
    lines.push('');
    lines.push('*Harga Reseller*');
    lines.push('\u2022 Bulanan : ' + formatRupiah(state.getResellerMonthly()));
    lines.push('\u2022 Mingguan: ' + formatRupiah(state.getResellerWeekly()));
    lines.push('');
    lines.push('*Limit Trial*: ' + state.getTrialMaxPerDay() + 'x / hari / user');

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '\uD83D\uDD11 Set API Key vpnbiz', callback_data: 'admin_eduk_setkey' }],
        [{ text: '\u2139\uFE0F Cek Profile & Saldo vpnbiz', callback_data: 'admin_eduk_check' }],
        [{ text: '\uD83D\uDD04 Refresh Cache Produk', callback_data: 'admin_eduk_refresh' }],
        [
          { text: '\u2796 Member /bln', callback_data: 'admin_eduk_mm_dec' },
          { text: formatRupiah(state.getMemberMonthly()), callback_data: 'admin_eduk_nop' },
          { text: '\u2795', callback_data: 'admin_eduk_mm_inc' },
        ],
        [
          { text: '\u2796 Member /mgu', callback_data: 'admin_eduk_mw_dec' },
          { text: formatRupiah(state.getMemberWeekly()), callback_data: 'admin_eduk_nop' },
          { text: '\u2795', callback_data: 'admin_eduk_mw_inc' },
        ],
        [
          { text: '\u2796 Resel /bln', callback_data: 'admin_eduk_rm_dec' },
          { text: formatRupiah(state.getResellerMonthly()), callback_data: 'admin_eduk_nop' },
          { text: '\u2795', callback_data: 'admin_eduk_rm_inc' },
        ],
        [
          { text: '\u2796 Resel /mgu', callback_data: 'admin_eduk_rw_dec' },
          { text: formatRupiah(state.getResellerWeekly()), callback_data: 'admin_eduk_nop' },
          { text: '\u2795', callback_data: 'admin_eduk_rw_inc' },
        ],
        [
          { text: '\u2796 Trial/hari', callback_data: 'admin_eduk_t_dec' },
          { text: state.getTrialMaxPerDay() + 'x', callback_data: 'admin_eduk_nop' },
          { text: '\u2795', callback_data: 'admin_eduk_t_inc' },
        ],
        [{ text: '\uD83D\uDD19 Kembali ke Menu Admin', callback_data: 'admin_menu' }],
      ],
    };

    const message = lines.join('\n');
    if (isEdit) {
      try {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: replyMarkup });
        return;
      } catch (err) {
        // Edit gagal (pesan asli sudah hilang) -> fallback reply.
      }
    }
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: replyMarkup });
  }

  async function rerender(ctx) {
    persistPrices();
    await renderMenu(ctx, { edit: true });
  }

  function adjustMember(period, delta) {
    if (period === 'monthly') {
      state.setMemberMonthly(clamp(state.getMemberMonthly() + delta, 0));
    } else {
      state.setMemberWeekly(clamp(state.getMemberWeekly() + delta, 0));
    }
  }
  function adjustReseller(period, delta) {
    if (period === 'monthly') {
      state.setResellerMonthly(clamp(state.getResellerMonthly() + delta, 0));
    } else {
      state.setResellerWeekly(clamp(state.getResellerWeekly() + delta, 0));
    }
  }
  function adjustTrial(delta) {
    state.setTrialMaxPerDay(clamp(state.getTrialMaxPerDay() + delta, 0, 50));
  }

  async function handleCheck(ctx) {
    try {
      await ctx.reply('\u23F3 Mengambil data dari vpnbiz...');
      const [profile, balance] = await Promise.all([
        edukasiClient.getProfile().catch((e) => ({ __error: e })),
        edukasiClient.getBalance().catch((e) => ({ __error: e })),
      ]);

      const lines = [];
      lines.push('\uD83C\uDF93 *Status vpnbiz Reseller*');
      lines.push('');
      if (profile && profile.__error) {
        lines.push('\u274C Profile error: _' + (profile.__error.message || '?') + '_');
      } else {
        lines.push('\u2022 Nama   : ' + (profile.name || '-'));
        lines.push('\u2022 Email  : ' + (profile.email || '-'));
        lines.push('\u2022 Role   : ' + (profile.role || '-'));
        if (profile.api_key_prefix) lines.push('\u2022 API key: `' + profile.api_key_prefix + '`');
      }
      lines.push('');
      if (balance && balance.__error) {
        lines.push('\u274C Saldo error: _' + (balance.__error.message || '?') + '_');
      } else {
        lines.push('\uD83D\uDCB0 Saldo: *' + (balance.formatted_balance || formatRupiah(balance.balance)) + '*');
      }
      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply('\u274C Gagal cek vpnbiz: ' + (err.message || err));
    }
  }

  async function handleRefresh(ctx) {
    edukasiService.clearProductsCache();
    try {
      const products = await edukasiService.getProducts({ force: true });
      const servers = edukasiService.listServers(products);
      await ctx.reply('\u2705 Cache produk diperbarui. Server tersedia: *'
        + servers.length + '*\n\n' +
        servers.map((s) => '\u2022 ' + s.name + ' (' + s.code + ')').join('\n'),
        { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply('\u274C Gagal refresh: ' + (err.message || err));
    }
  }

  function register() {
    bot.action('admin_edukasi_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) {
        return ctx.reply('\u274C Menu ini khusus admin.', { parse_mode: 'Markdown' });
      }
      await renderMenu(ctx, { edit: false });
    });

    bot.action('admin_eduk_nop', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
    });

    bot.action('admin_eduk_setkey', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      if (adminState && typeof adminState === 'object') {
        adminState[ctx.from.id] = { action: 'edukasi_set_apikey', __t: Date.now() };
      }
      await ctx.reply(
        '\uD83D\uDD11 Kirim *API key vpnbiz* sekarang.\n\n' +
        'Atau pakai command: `/setvpnbizapikey <APIKEY>`\n' +
        'Batal: ketik `/batal`',
        { parse_mode: 'Markdown' }
      );
    });

    bot.action('admin_eduk_check', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      await handleCheck(ctx);
    });

    bot.action('admin_eduk_refresh', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      await handleRefresh(ctx);
    });

    // Adjust harga
    const stepMember = 1000;
    const stepReseller = 1000;
    bot.action('admin_eduk_mm_inc', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustMember('monthly', stepMember);
      await rerender(ctx);
    });
    bot.action('admin_eduk_mm_dec', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustMember('monthly', -stepMember);
      await rerender(ctx);
    });
    bot.action('admin_eduk_mw_inc', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustMember('weekly', 500);
      await rerender(ctx);
    });
    bot.action('admin_eduk_mw_dec', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustMember('weekly', -500);
      await rerender(ctx);
    });
    bot.action('admin_eduk_rm_inc', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustReseller('monthly', stepReseller);
      await rerender(ctx);
    });
    bot.action('admin_eduk_rm_dec', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustReseller('monthly', -stepReseller);
      await rerender(ctx);
    });
    bot.action('admin_eduk_rw_inc', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustReseller('weekly', 500);
      await rerender(ctx);
    });
    bot.action('admin_eduk_rw_dec', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustReseller('weekly', -500);
      await rerender(ctx);
    });
    bot.action('admin_eduk_t_inc', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustTrial(1);
      await rerender(ctx);
    });
    bot.action('admin_eduk_t_dec', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return;
      adjustTrial(-1);
      await rerender(ctx);
    });

    // Command: /setvpnbizapikey <key>
    bot.command('setvpnbizapikey', async (ctx) => {
      if (!isAdmin(ctx)) return;
      const parts = (ctx.message.text || '').trim().split(/\s+/);
      if (parts.length < 2 || !parts[1]) {
        return ctx.reply('Format: `/setvpnbizapikey <APIKEY>`', { parse_mode: 'Markdown' });
      }
      const key = parts.slice(1).join(' ').trim();
      updateVarsPartial({ VPNBIZ_API_KEY: key });
      edukasiService.clearProductsCache();
      // Verifikasi key dengan call profile
      try {
        const profile = await edukasiClient.getProfile();
        await ctx.reply('\u2705 API key tersimpan & valid.\n\nLogin sebagai: *' + (profile.name || '-') + '*'
          + '\nSaldo: *' + formatRupiah(profile.balance || 0) + '*',
          { parse_mode: 'Markdown' });
      } catch (err) {
        await ctx.reply('\u26A0\uFE0F API key tersimpan, tapi gagal verifikasi:\n_' + (err.message || err) + '_',
          { parse_mode: 'Markdown' });
      }
    });

    bot.command('cekvpnbiz', async (ctx) => {
      if (!isAdmin(ctx)) return;
      await handleCheck(ctx);
    });
  }

  // Hook untuk app.js bot.on('text') existing — kalau admin lagi menunggu input API key.
  async function handleTextStep(ctx) {
    if (!ctx.from || !ctx.message) return false;
    if (!adminState || typeof adminState !== 'object') return false;
    const slot = adminState[ctx.from.id];
    if (!slot || slot.action !== 'edukasi_set_apikey') return false;

    const text = (ctx.message.text || '').trim();
    if (text === '/batal' || text === '/cancel') {
      delete adminState[ctx.from.id];
      await ctx.reply('Dibatalkan.');
      return true;
    }
    if (text.startsWith('/')) {
      // Biarkan command lain jalan, jangan konsumsi
      return false;
    }
    if (text.length < 5) {
      await ctx.reply('\u274C API key terlalu pendek. Coba kirim ulang atau ketik /batal.');
      return true;
    }
    delete adminState[ctx.from.id];
    updateVarsPartial({ VPNBIZ_API_KEY: text });
    edukasiService.clearProductsCache();
    try {
      const profile = await edukasiClient.getProfile();
      await ctx.reply('\u2705 API key tersimpan & valid.\n\nLogin sebagai: *' + (profile.name || '-') + '*'
        + '\nSaldo: *' + formatRupiah(profile.balance || 0) + '*',
        { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply('\u26A0\uFE0F API key tersimpan, tapi gagal verifikasi:\n_' + (err.message || err) + '_',
        { parse_mode: 'Markdown' });
    }
    return true;
  }

  return { register, handleTextStep, renderMenu };
}

module.exports = { createEdukasiAdminHandlers };
