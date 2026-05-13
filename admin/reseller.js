// admin/reseller.js - Target Reseller + Bonus Reseller Aktif menu (factory).
// State akses via getter/setter supaya `let` di app.js tetap bisa di-reassign
// dan reflect di scheduler (yang juga baca via getter).

function createResellerAdminHandlers({
  bot,
  logger,
  ADMIN_IDS,
  state,
  getTiers,
  getMonthRange,
  getEligiblePreview,
  grantBonus,
  updateTargetVars,
  updateBonusVars,
}) {
  if (!bot) throw new Error('createResellerAdminHandlers: bot required');
  if (!logger) throw new Error('createResellerAdminHandlers: logger required');
  if (!Array.isArray(ADMIN_IDS)) {
    throw new Error('createResellerAdminHandlers: ADMIN_IDS harus array');
  }
  if (!state || typeof state !== 'object') {
    throw new Error('createResellerAdminHandlers: state object required');
  }
  for (const k of [
    'getTargetEnabled', 'setTargetEnabled',
    'getTargetMin30d', 'setTargetMin30d',
    'getTargetMinDays', 'setTargetMinDays',
    'getBonusEnabled', 'setBonusEnabled',
    'getBonusMinDuration', 'setBonusMinDuration',
    'getBonusMinOmzet', 'setBonusMinOmzet',
    'getBonusTier1Days', 'setBonusTier1Days',
    'getBonusTier1Amount', 'setBonusTier1Amount',
    'getBonusTier2Days', 'setBonusTier2Days',
    'getBonusTier2Amount', 'setBonusTier2Amount',
    'getBonusTier3Days', 'setBonusTier3Days',
    'getBonusTier3Amount', 'setBonusTier3Amount',
  ]) {
    if (typeof state[k] !== 'function') {
      throw new Error('createResellerAdminHandlers: state.' + k + ' harus fungsi');
    }
  }
  if (typeof getTiers !== 'function') {
    throw new Error('createResellerAdminHandlers: getTiers harus fungsi');
  }
  if (typeof getMonthRange !== 'function') {
    throw new Error('createResellerAdminHandlers: getMonthRange harus fungsi');
  }
  if (typeof getEligiblePreview !== 'function') {
    throw new Error('createResellerAdminHandlers: getEligiblePreview harus fungsi');
  }
  if (typeof grantBonus !== 'function') {
    throw new Error('createResellerAdminHandlers: grantBonus harus fungsi');
  }
  if (typeof updateTargetVars !== 'function') {
    throw new Error('createResellerAdminHandlers: updateTargetVars harus fungsi');
  }
  if (typeof updateBonusVars !== 'function') {
    throw new Error('createResellerAdminHandlers: updateBonusVars harus fungsi');
  }

  function isAdmin(ctx) {
    return ctx.from && ADMIN_IDS.includes(ctx.from.id);
  }

  async function rejectNonAdmin(ctx) {
    return ctx.reply('\u274c *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }

  // === RENDER TARGET MENU ===

  async function renderResellerTargetMenu(ctx, options = {}) {
    const isEdit = options.edit || false;
    const enabled = state.getTargetEnabled();
    const min30 = state.getTargetMin30d();
    const minDays = state.getTargetMinDays();
    const statusText = enabled ? 'Aktif \u2705' : 'Nonaktif \u26d4';

    const message =
      '\ud83c\udfaf *Pengaturan Target Reseller*\n\n'
      + 'Status target bulanan : *' + statusText + '*\n'
      + 'Minimal akun 30 hari  : *' + min30 + ' akun/bulan*\n'
      + 'Minimal total hari    : *' + minDays + ' hari/bulan*\n\n'
      + '_Reseller yang tidak memenuhi salah satu target di atas '
      + 'pada akhir bulan akan otomatis turun menjadi member biasa._';

    const replyMarkup = {
      inline_keyboard: [
        [{ text: enabled ? '\u26d4 Nonaktifkan' : '\u2705 Aktifkan', callback_data: 'admin_res_target_toggle' }],
        [
          { text: '\u2796', callback_data: 'admin_res_target_min30_dec' },
          { text: 'Min 30 Hari: ' + min30, callback_data: 'admin_res_target_min30_nop' },
          { text: '\u2795', callback_data: 'admin_res_target_min30_inc' },
        ],
        [
          { text: '\u23ea', callback_data: 'admin_res_target_days_dec' },
          { text: 'Min Total: ' + minDays + ' hari', callback_data: 'admin_res_target_days_nop' },
          { text: '\u23e9', callback_data: 'admin_res_target_days_inc' },
        ],
        [{ text: '\ud83d\udd19 Kembali ke Menu Reseller', callback_data: 'admin_reseller_menu' }],
      ],
    };

    if (isEdit) {
      try {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: replyMarkup });
        return;
      } catch (err) {
        logger.error('Gagal edit pesan menu target reseller:', err.message || err);
      }
    }
    try {
      await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: replyMarkup });
    } catch (e) {
      logger.error('Gagal kirim pesan menu target reseller:', e.message || e);
    }
  }

  // === RENDER BONUS MENU ===

  async function renderResellerBonusMenu(ctx, options = {}) {
    const isEdit = options.edit || false;
    const tiers = getTiers();
    const enabled = state.getBonusEnabled();
    const statusText = enabled ? 'Aktif \u2705' : 'Nonaktif \u26d4';
    const monthInfo = getMonthRange(-1);

    const lines = [];
    lines.push('\ud83c\udf81 *Bonus Reseller Aktif*');
    lines.push('');
    lines.push('Status bonus          : *' + statusText + '*');
    lines.push('Durasi akun minimum   : *' + state.getBonusMinDuration() + ' hari*');
    lines.push('Omzet valid / hari    : *Rp' + Number(state.getBonusMinOmzet() || 0).toLocaleString('id-ID') + '*');
    lines.push('Periode preview/proses: *' + monthInfo.label + '*');
    lines.push('');
    lines.push('*Tier bonus:*');
    tiers.forEach((tier) => {
      lines.push('\u2022 ' + tier.label + ': *' + tier.minDays + ' hari* \u2192 *Rp' + tier.bonusAmount.toLocaleString('id-ID') + '*');
    });
    lines.push('');
    lines.push('_Hanya akun berbayar dengan durasi minimum yang dihitung. Hari aktif hanya dihitung sekali per tanggal._');

    const replyMarkup = {
      inline_keyboard: [
        [{ text: enabled ? '\u26d4 Nonaktifkan' : '\u2705 Aktifkan', callback_data: 'admin_res_bonus_toggle' }],
        [
          { text: '\u2796', callback_data: 'admin_res_bonus_mindur_dec' },
          { text: 'Min Durasi: ' + state.getBonusMinDuration() + 'h', callback_data: 'admin_res_bonus_nop' },
          { text: '\u2795', callback_data: 'admin_res_bonus_mindur_inc' },
        ],
        [
          { text: '\u2796', callback_data: 'admin_res_bonus_omzet_dec' },
          { text: 'Min Omzet: Rp' + Number(state.getBonusMinOmzet() || 0).toLocaleString('id-ID'), callback_data: 'admin_res_bonus_nop' },
          { text: '\u2795', callback_data: 'admin_res_bonus_omzet_inc' },
        ],
        [
          { text: 'Tier 1', callback_data: 'admin_res_bonus_nop' },
          { text: 'Hari -', callback_data: 'admin_res_bonus_t1_days_dec' },
          { text: state.getBonusTier1Days() + 'h', callback_data: 'admin_res_bonus_nop' },
          { text: 'Hari +', callback_data: 'admin_res_bonus_t1_days_inc' },
        ],
        [
          { text: 'Bonus -', callback_data: 'admin_res_bonus_t1_amt_dec' },
          { text: 'Rp' + Number(state.getBonusTier1Amount() || 0).toLocaleString('id-ID'), callback_data: 'admin_res_bonus_nop' },
          { text: 'Bonus +', callback_data: 'admin_res_bonus_t1_amt_inc' },
        ],
        [
          { text: 'Tier 2', callback_data: 'admin_res_bonus_nop' },
          { text: 'Hari -', callback_data: 'admin_res_bonus_t2_days_dec' },
          { text: state.getBonusTier2Days() + 'h', callback_data: 'admin_res_bonus_nop' },
          { text: 'Hari +', callback_data: 'admin_res_bonus_t2_days_inc' },
        ],
        [
          { text: 'Bonus -', callback_data: 'admin_res_bonus_t2_amt_dec' },
          { text: 'Rp' + Number(state.getBonusTier2Amount() || 0).toLocaleString('id-ID'), callback_data: 'admin_res_bonus_nop' },
          { text: 'Bonus +', callback_data: 'admin_res_bonus_t2_amt_inc' },
        ],
        [
          { text: 'Tier 3', callback_data: 'admin_res_bonus_nop' },
          { text: 'Hari -', callback_data: 'admin_res_bonus_t3_days_dec' },
          { text: state.getBonusTier3Days() + 'h', callback_data: 'admin_res_bonus_nop' },
          { text: 'Hari +', callback_data: 'admin_res_bonus_t3_days_inc' },
        ],
        [
          { text: 'Bonus -', callback_data: 'admin_res_bonus_t3_amt_dec' },
          { text: 'Rp' + Number(state.getBonusTier3Amount() || 0).toLocaleString('id-ID'), callback_data: 'admin_res_bonus_nop' },
          { text: 'Bonus +', callback_data: 'admin_res_bonus_t3_amt_inc' },
        ],
        [{ text: '\ud83d\udc40 Preview Penerima', callback_data: 'admin_res_bonus_preview' }],
        [{ text: '\ud83c\udf81 Proses Bonus Bulan Lalu', callback_data: 'admin_res_bonus_process' }],
        [{ text: '\ud83d\udd19 Kembali ke Menu Reseller', callback_data: 'admin_reseller_menu' }],
      ],
    };

    const message = lines.join('\n');
    if (isEdit) {
      try {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: replyMarkup });
        return;
      } catch (err) {
        logger.error('Gagal edit menu bonus reseller:', err.message || err);
      }
    }
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: replyMarkup });
  }

  // === HELPER ===

  function clampBonusConfig() {
    if (state.getBonusMinDuration() < 1) state.setBonusMinDuration(1);
    if (state.getBonusMinOmzet() < 0) state.setBonusMinOmzet(0);
    if (state.getBonusTier1Days() < 1) state.setBonusTier1Days(1);
    if (state.getBonusTier2Days() <= state.getBonusTier1Days()) {
      state.setBonusTier2Days(state.getBonusTier1Days() + 1);
    }
    if (state.getBonusTier3Days() <= state.getBonusTier2Days()) {
      state.setBonusTier3Days(state.getBonusTier2Days() + 1);
    }
    if (state.getBonusTier1Amount() < 1000) state.setBonusTier1Amount(1000);
    if (state.getBonusTier2Amount() < state.getBonusTier1Amount()) {
      state.setBonusTier2Amount(state.getBonusTier1Amount());
    }
    if (state.getBonusTier3Amount() < state.getBonusTier2Amount()) {
      state.setBonusTier3Amount(state.getBonusTier2Amount());
    }
  }

  async function updateAndRenderBonus(ctx) {
    clampBonusConfig();
    updateBonusVars({
      RESELLER_ACTIVE_BONUS_ENABLED: state.getBonusEnabled(),
      RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS: state.getBonusMinDuration(),
      RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET: state.getBonusMinOmzet(),
      RESELLER_ACTIVE_BONUS_TIER1_DAYS: state.getBonusTier1Days(),
      RESELLER_ACTIVE_BONUS_TIER1_AMOUNT: state.getBonusTier1Amount(),
      RESELLER_ACTIVE_BONUS_TIER2_DAYS: state.getBonusTier2Days(),
      RESELLER_ACTIVE_BONUS_TIER2_AMOUNT: state.getBonusTier2Amount(),
      RESELLER_ACTIVE_BONUS_TIER3_DAYS: state.getBonusTier3Days(),
      RESELLER_ACTIVE_BONUS_TIER3_AMOUNT: state.getBonusTier3Amount(),
    });
    await renderResellerBonusMenu(ctx, { edit: true });
  }

  function adjustBonusVar(varName, delta) {
    const map = {
      RESELLER_ACTIVE_BONUS_TIER1_DAYS: ['getBonusTier1Days', 'setBonusTier1Days'],
      RESELLER_ACTIVE_BONUS_TIER2_DAYS: ['getBonusTier2Days', 'setBonusTier2Days'],
      RESELLER_ACTIVE_BONUS_TIER3_DAYS: ['getBonusTier3Days', 'setBonusTier3Days'],
      RESELLER_ACTIVE_BONUS_TIER1_AMOUNT: ['getBonusTier1Amount', 'setBonusTier1Amount'],
      RESELLER_ACTIVE_BONUS_TIER2_AMOUNT: ['getBonusTier2Amount', 'setBonusTier2Amount'],
      RESELLER_ACTIVE_BONUS_TIER3_AMOUNT: ['getBonusTier3Amount', 'setBonusTier3Amount'],
    };
    const handlers = map[varName];
    if (!handlers) {
      logger.warn('Variabel bonus reseller tidak dikenal: ' + varName);
      return;
    }
    const [getter, setter] = handlers;
    state[setter](state[getter]() + delta);
  }

  // === REGISTER TARGET HANDLER ===

  function registerTargetHandlers() {
    bot.action('admin_reseller_target', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        await renderResellerTargetMenu(ctx, { edit: false });
      } catch (err) {
        logger.error('Gagal membuka menu target reseller:', err.message || err);
        ctx.reply('\u274c Terjadi kesalahan saat membuka menu target reseller.');
      }
    });

    bot.action('admin_res_target_toggle', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        state.setTargetEnabled(!state.getTargetEnabled());
        updateTargetVars({ RESELLER_TARGET_ENABLED: state.getTargetEnabled() });
        await renderResellerTargetMenu(ctx, { edit: true });
      } catch (err) {
        logger.error('Gagal toggle RESELLER_TARGET_ENABLED:', err.message || err);
        ctx.reply('\u274c Terjadi kesalahan saat mengubah status target reseller.');
      }
    });

    bot.action('admin_res_target_min30_inc', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        let val = Number(state.getTargetMin30d() || 0) + 1;
        if (val < 1) val = 1;
        state.setTargetMin30d(val);
        updateTargetVars({ RESELLER_TARGET_MIN_30D_ACCOUNTS: val });
        await renderResellerTargetMenu(ctx, { edit: true });
      } catch (err) {
        logger.error('Gagal menaikkan target akun 30 hari:', err.message || err);
        ctx.reply('\u274c Terjadi kesalahan saat mengubah target akun 30 hari.');
      }
    });

    bot.action('admin_res_target_min30_dec', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        let val = Number(state.getTargetMin30d() || 1) - 1;
        if (val < 1) val = 1;
        state.setTargetMin30d(val);
        updateTargetVars({ RESELLER_TARGET_MIN_30D_ACCOUNTS: val });
        await renderResellerTargetMenu(ctx, { edit: true });
      } catch (err) {
        logger.error('Gagal menurunkan target akun 30 hari:', err.message || err);
        ctx.reply('\u274c Terjadi kesalahan saat mengubah target akun 30 hari.');
      }
    });

    bot.action('admin_res_target_days_inc', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        const val = Number(state.getTargetMinDays() || 0) + 30;
        state.setTargetMinDays(val);
        updateTargetVars({ RESELLER_TARGET_MIN_DAYS_PER_MONTH: val });
        await renderResellerTargetMenu(ctx, { edit: true });
      } catch (err) {
        logger.error('Gagal menaikkan target hari reseller:', err.message || err);
        ctx.reply('\u274c Terjadi kesalahan saat mengubah target total hari.');
      }
    });

    bot.action('admin_res_target_days_dec', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        let val = Number(state.getTargetMinDays() || 30) - 30;
        if (val < 30) val = 30;
        state.setTargetMinDays(val);
        updateTargetVars({ RESELLER_TARGET_MIN_DAYS_PER_MONTH: val });
        await renderResellerTargetMenu(ctx, { edit: true });
      } catch (err) {
        logger.error('Gagal menurunkan target hari reseller:', err.message || err);
        ctx.reply('\u274c Terjadi kesalahan saat mengubah target total hari.');
      }
    });

    bot.action('admin_res_target_min30_nop', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
    });
    bot.action('admin_res_target_days_nop', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
    });
  }

  // === REGISTER BONUS HANDLER ===

  function registerBonusHandlers() {
    bot.action('admin_reseller_bonus_menu', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        await renderResellerBonusMenu(ctx, { edit: false });
      } catch (err) {
        logger.error('Gagal membuka menu bonus reseller:', err.message || err);
        ctx.reply('\u274c Terjadi kesalahan saat membuka menu bonus reseller.');
      }
    });

    bot.action('admin_res_bonus_nop', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
    });

    bot.action('admin_res_bonus_toggle', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
      state.setBonusEnabled(!state.getBonusEnabled());
      updateBonusVars({ RESELLER_ACTIVE_BONUS_ENABLED: state.getBonusEnabled() });
      await renderResellerBonusMenu(ctx, { edit: true });
    });

    bot.action('admin_res_bonus_mindur_inc', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
      state.setBonusMinDuration(state.getBonusMinDuration() + 1);
      await updateAndRenderBonus(ctx);
    });
    bot.action('admin_res_bonus_mindur_dec', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
      state.setBonusMinDuration(state.getBonusMinDuration() - 1);
      await updateAndRenderBonus(ctx);
    });
    bot.action('admin_res_bonus_omzet_inc', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
      state.setBonusMinOmzet(state.getBonusMinOmzet() + 5000);
      await updateAndRenderBonus(ctx);
    });
    bot.action('admin_res_bonus_omzet_dec', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
      state.setBonusMinOmzet(state.getBonusMinOmzet() - 5000);
      await updateAndRenderBonus(ctx);
    });

    for (const [tier, dayVar, amountVar] of [
      ['t1', 'RESELLER_ACTIVE_BONUS_TIER1_DAYS', 'RESELLER_ACTIVE_BONUS_TIER1_AMOUNT'],
      ['t2', 'RESELLER_ACTIVE_BONUS_TIER2_DAYS', 'RESELLER_ACTIVE_BONUS_TIER2_AMOUNT'],
      ['t3', 'RESELLER_ACTIVE_BONUS_TIER3_DAYS', 'RESELLER_ACTIVE_BONUS_TIER3_AMOUNT'],
    ]) {
      bot.action('admin_res_bonus_' + tier + '_days_inc', async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        adjustBonusVar(dayVar, 1);
        await updateAndRenderBonus(ctx);
      });
      bot.action('admin_res_bonus_' + tier + '_days_dec', async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        adjustBonusVar(dayVar, -1);
        await updateAndRenderBonus(ctx);
      });
      bot.action('admin_res_bonus_' + tier + '_amt_inc', async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        adjustBonusVar(amountVar, 5000);
        await updateAndRenderBonus(ctx);
      });
      bot.action('admin_res_bonus_' + tier + '_amt_dec', async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        if (!isAdmin(ctx)) return rejectNonAdmin(ctx);
        adjustBonusVar(amountVar, -5000);
        await updateAndRenderBonus(ctx);
      });
    }

    bot.action('admin_res_bonus_preview', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return rejectNonAdmin(ctx);

      try {
        const monthInfo = getMonthRange(-1);
        const preview = await getEligiblePreview(-1);

        if (!preview.length) {
          return ctx.reply(
            '\u2139\ufe0f Belum ada reseller yang lolos bonus aktif untuk periode *' + monthInfo.label + '*.',
            { parse_mode: 'Markdown' }
          );
        }

        const lines = [];
        lines.push('\ud83d\udc40 *Preview Bonus Reseller Aktif*');
        lines.push('Periode: *' + monthInfo.label + '*');
        lines.push('');

        preview.slice(0, 25).forEach((item, idx) => {
          const processedMark = item.processed ? ' \u2022 SUDAH DIPROSES' : '';
          lines.push(
            (idx + 1) + '. `' + item.userId + '` \u2014 *' + item.validActiveDays + ' hari* \u2014 '
              + 'omzet ~ *Rp' + Number(item.validOmzet || 0).toLocaleString('id-ID') + '* \u2014 '
              + item.currentTier.label + ': *Rp' + Number(item.currentTier.bonusAmount || 0).toLocaleString('id-ID')
              + '*' + processedMark
          );
        });

        if (preview.length > 25) {
          lines.push('');
          lines.push('_Menampilkan 25 dari total ' + preview.length + ' reseller yang lolos._');
        }

        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
      } catch (err) {
        logger.error('Gagal preview bonus reseller:', err.message || err);
        await ctx.reply('\u274c Gagal membuat preview bonus reseller.');
      }
    });

    bot.action('admin_res_bonus_process', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!isAdmin(ctx)) return rejectNonAdmin(ctx);

      if (!state.getBonusEnabled()) {
        return ctx.reply(
          '\u26a0\ufe0f Bonus reseller aktif sedang nonaktif. Aktifkan dulu dari menu bonus reseller.',
          { parse_mode: 'Markdown' }
        );
      }

      try {
        const monthInfo = getMonthRange(-1);
        const preview = await getEligiblePreview(-1);
        let successCount = 0;
        let skipCount = 0;
        let totalBonus = 0;

        for (const item of preview) {
          if (item.processed || !item.currentTier) {
            skipCount += 1;
            continue;
          }
          const result = await grantBonus({
            userId: item.userId,
            monthKey: item.monthKey,
            activeDays: item.validActiveDays,
            bonusAmount: item.currentTier.bonusAmount,
            tierLabel: item.currentTier.label,
            processedBy: ctx.from.id,
          });

          if (result.ok) {
            successCount += 1;
            totalBonus += Number(item.currentTier.bonusAmount || 0);
            try {
              await bot.telegram.sendMessage(
                item.userId,
                '\ud83c\udf81 <b>Bonus Reseller Aktif Cair</b>\n\n'
                  + 'Periode: <b>' + monthInfo.label + '</b>\n'
                  + 'Hari aktif valid: <b>' + item.validActiveDays + '</b> hari\n'
                  + 'Tier bonus: <b>' + item.currentTier.label + '</b>\n'
                  + 'Bonus saldo: <b>Rp' + Number(item.currentTier.bonusAmount || 0).toLocaleString('id-ID') + '</b>\n\n'
                  + 'Terima kasih sudah aktif jualan. Semangat closing lagi ya \ud83d\udd25',
                { parse_mode: 'HTML' }
              );
            } catch (_) {}
          } else {
            skipCount += 1;
          }
        }

        await ctx.reply(
          '\u2705 *Proses bonus reseller selesai*\n\n'
            + 'Periode : *' + monthInfo.label + '*\n'
            + 'Berhasil: *' + successCount + '* reseller\n'
            + 'Skip    : *' + skipCount + '* reseller\n'
            + 'Total   : *Rp' + Number(totalBonus || 0).toLocaleString('id-ID') + '*',
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        logger.error('Gagal proses bonus reseller:', err.message || err);
        await ctx.reply('\u274c Gagal memproses bonus reseller.');
      }
    });
  }

  function register() {
    registerTargetHandlers();
    registerBonusHandlers();
  }

  return {
    register,
    renderResellerTargetMenu,
    renderResellerBonusMenu,
  };
}

module.exports = { createResellerAdminHandlers };
