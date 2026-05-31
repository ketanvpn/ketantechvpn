// modules/reseller-sales.js
// User-facing reseller sales summary ("💵 Penjualan Saya").

function createResellerSalesHandlers({
  bot,
  db,
  logger,
  ensurePrivateChat,
  sendCleanMenu,
  isResellerId,
  adminIds,
  getResellerActiveBonusStats,
  getTargetMin30dAccounts,
  getTargetMinDaysPerMonth,
  getBonusEnabled,
  getBonusMinDurationDays,
  getBonusMinDailyOmzet,
  timeZone,
}) {
  if (!bot) throw new Error('createResellerSalesHandlers: bot required');
  if (!db) throw new Error('createResellerSalesHandlers: db required');
  if (!logger) throw new Error('createResellerSalesHandlers: logger required');
  if (typeof ensurePrivateChat !== 'function') throw new Error('createResellerSalesHandlers: ensurePrivateChat required');
  if (typeof sendCleanMenu !== 'function') throw new Error('createResellerSalesHandlers: sendCleanMenu required');
  if (typeof isResellerId !== 'function') throw new Error('createResellerSalesHandlers: isResellerId required');
  if (typeof getResellerActiveBonusStats !== 'function') throw new Error('createResellerSalesHandlers: getResellerActiveBonusStats required');

  const ADMIN_IDS = Array.isArray(adminIds) ? adminIds : [];
  const TIME_ZONE = timeZone || 'Asia/Jakarta';
  const getTarget30 = typeof getTargetMin30dAccounts === 'function' ? getTargetMin30dAccounts : () => 3;
  const getTargetDays = typeof getTargetMinDaysPerMonth === 'function' ? getTargetMinDaysPerMonth : () => 90;
  const isBonusEnabled = typeof getBonusEnabled === 'function' ? getBonusEnabled : () => false;
  const getMinDuration = typeof getBonusMinDurationDays === 'function' ? getBonusMinDurationDays : () => 7;
  const getMinDailyOmzet = typeof getBonusMinDailyOmzet === 'function' ? getBonusMinDailyOmzet : () => 10000;

  async function showSalesSummary(ctx) {
    await ctx.answerCbQuery().catch(() => {});

    if (!ensurePrivateChat(ctx)) return;
    if (!ctx.from) return;

    const userId = ctx.from.id;

    if (!isResellerId(userId) && !ADMIN_IDS.includes(userId)) {
      return ctx.reply(
        '🚫 Fitur <b>Penjualan Saya</b> hanya untuk reseller.',
        { parse_mode: 'HTML' }
      );
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    db.all(
      `SELECT created_at, expires_at, type, username
       FROM accounts
       WHERE user_id = ?
         AND created_at >= ?
         AND created_at < ?
       ORDER BY created_at ASC`,
      [userId, monthStart, monthEnd],
      async (err, rows) => {
        if (err) {
          logger.error('Gagal ambil data penjualan reseller (sales_summary):', err.message || err);
          return ctx.reply('❌ Gagal memuat ringkasan penjualan kamu. Silakan coba lagi.', { parse_mode: 'HTML' });
        }

        const bonusStats = await getResellerActiveBonusStats(userId, { offsetMonths: 0 });
        const bulanLabel = now.toLocaleDateString('id-ID', {
          timeZone: TIME_ZONE,
          year: 'numeric',
          month: 'long',
        });

        let totalAccounts = 0;
        let totalDays = 0;
        let count30Days = 0;

        for (const acc of (rows || [])) {
          totalAccounts += 1;
          if (!acc.expires_at || !acc.created_at) continue;
          const durMs = acc.expires_at - acc.created_at;
          let durDays = Math.round(durMs / dayMs);
          if (durDays < 1) durDays = 1;
          totalDays += durDays;
          if (durDays >= 30) count30Days += 1;
        }

        const target30 = Number(getTarget30() || 0);
        const targetDays = Number(getTargetDays() || 0);
        const meets30 = count30Days >= target30;
        const meetsDays = totalDays >= targetDays;

        let bonusProgressText = '';
        if (isBonusEnabled()) {
          bonusProgressText += `<b>🎁 Progress Bonus Aktif</b>\n`;
          bonusProgressText += `• Hari aktif valid       : <b>${bonusStats.validActiveDays}</b> hari\n`;
          bonusProgressText += `• Akun valid bonus       : <b>${bonusStats.validAccounts}</b> akun\n`;
          bonusProgressText += `• Omzet valid estimasi   : <b>Rp${Number(bonusStats.validOmzet || 0).toLocaleString('id-ID')}</b>\n`;
          bonusProgressText += `• Min durasi dihitung    : <b>${Number(getMinDuration() || 0)}</b> hari\n`;
          bonusProgressText += `• Min omzet / hari       : <b>Rp${Number(getMinDailyOmzet() || 0).toLocaleString('id-ID')}</b>\n`;
          if (bonusStats.currentTier) {
            bonusProgressText += `• Tier tercapai          : <b>${bonusStats.currentTier.label}</b> (Rp${Number(bonusStats.currentTier.bonusAmount || 0).toLocaleString('id-ID')})\n`;
          } else {
            bonusProgressText += `• Tier tercapai          : <b>Belum ada</b>\n`;
          }
          if (bonusStats.nextTier) {
            const need = Math.max(0, bonusStats.nextTier.minDays - bonusStats.validActiveDays);
            bonusProgressText += `• Target berikutnya      : <b>${bonusStats.nextTier.label}</b> → sisa <b>${need}</b> hari lagi\n`;
          } else if (bonusStats.currentTier) {
            bonusProgressText += `• Target berikutnya      : <b>Tier tertinggi sudah tercapai</b>\n`;
          }
          if (bonusStats.invalidShortAccounts > 0) {
            bonusProgressText += `• Akun terlalu pendek    : <b>${bonusStats.invalidShortAccounts}</b> akun tidak dihitung\n`;
          }
          if (bonusStats.invalidLowOmzetDays > 0) {
            bonusProgressText += `• Hari omzet kurang      : <b>${bonusStats.invalidLowOmzetDays}</b> hari tidak dihitung\n`;
          }
        }

        let text =
          `<b>💵 Penjualan Saya • ${bulanLabel}</b>\n\n` +
          `• Total akun terjual       : <b>${totalAccounts}</b>\n` +
          `• Akun durasi ≥ 30 hari    : <b>${count30Days}</b>\n` +
          `• Total hari akumulasi     : <b>${totalDays}</b> hari\n\n` +
          `<b>🎯 Target Bulanan</b>\n` +
          `• Minimal <b>${target30}</b> akun berdurasi ≥ 30 hari\n` +
          `• Atau total <b>${targetDays}</b> hari dari semua akun\n\n` +
          `<b>📊 Status Target Bulan Ini</b>\n` +
          `• Target akun 30 hari : ${meets30 ? '✅ Tercapai' : '❌ Belum tercapai'}\n` +
          `• Target total hari   : ${meetsDays ? '✅ Tercapai' : '❌ Belum tercapai'}\n\n`;

        if (bonusProgressText) {
          text += bonusProgressText + `\n`;
        }

        text += '<i>Catatan: bonus reseller aktif hanya menghitung akun berbayar yang memenuhi durasi minimum dan omzet harian minimum. Akun 1 hari / terlalu pendek tidak dihitung.</i>';

        return sendCleanMenu(ctx, text, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }],
            ],
          },
        });
      }
    );
  }

  function register() {
    bot.action('sales_summary', showSalesSummary);
  }

  return { register, showSalesSummary };
}

module.exports = { createResellerSalesHandlers };
