// admin/menu.js - handler 'admin_menu' + 'admin_reseller_menu'.
// Factory: butuh bot, logger, adminIds, ADMIN_IDS, sendAdminMenu.

function createAdminMenuHandlers({ bot, logger, adminIds, ADMIN_IDS, sendAdminMenu }) {
  if (!bot) throw new Error('createAdminMenuHandlers: bot required');
  if (!logger) throw new Error('createAdminMenuHandlers: logger required');
  if (!Array.isArray(ADMIN_IDS)) {
    throw new Error('createAdminMenuHandlers: ADMIN_IDS harus array');
  }
  if (!Array.isArray(adminIds)) {
    throw new Error('createAdminMenuHandlers: adminIds harus array');
  }
  if (typeof sendAdminMenu !== 'function') {
    throw new Error('createAdminMenuHandlers: sendAdminMenu harus fungsi');
  }

  function registerAdminMenu() {
    bot.action('admin_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
        return ctx.reply('\u274c *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
      }
      await sendAdminMenu(ctx);
    });
  }

  function registerResellerMenu() {
    bot.action('admin_reseller_menu', async (ctx) => {
      const adminId = ctx.from.id;

      if (!adminIds.includes(adminId)) {
        return ctx
          .answerCbQuery('\ud83d\udeab Khusus admin.', { show_alert: true })
          .catch(() => {});
      }

      await ctx.answerCbQuery().catch(() => {});

      const text = '<b>\ud83e\uddfe MENU RESELLER & SALDO</b>\n\n'
        + 'Semua pengaturan yang berhubungan dengan reseller & saldo:\n\n'
        + '\u2022 Tambah server reseller\n'
        + '\u2022 Tambah saldo user / reseller\n'
        + '\u2022 Lihat riwayat saldo\n'
        + '\u2022 Lihat daftar reseller & member\n'
        + '\u2022 Upload QRIS untuk topup manual\n';

      const keyboard = [
        [{ text: '\ud83e\udd1d Tambah Server Reseller', callback_data: 'addserver_reseller' }],
        [
          { text: '\ud83d\udcb5 Tambah Saldo User', callback_data: 'tambah_saldo' },
          { text: '\ud83d\udcdc Riwayat Saldo User', callback_data: 'riwayat_saldo_user' },
        ],
        [{ text: '\ud83d\udc65 List Res & Member', callback_data: 'list_res_mem' }],
        [{ text: '\ud83c\udfaf Target Reseller', callback_data: 'admin_reseller_target' }],
        [{ text: '\ud83c\udf81 Bonus Reseller Aktif', callback_data: 'admin_reseller_bonus_menu' }],
        [{ text: '\ud83d\uddbc\ufe0f Upload Gambar QRIS', callback_data: 'upload_qris' }],
        [{ text: '\ud83d\udd19 Kembali ke Menu Admin', callback_data: 'admin_menu' }],
      ];

      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        });
      } catch (err) {
        logger.error('Error saat buka submenu reseller:', err.message || err);
        await ctx.reply(text, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        });
      }
    });
  }

  function register() {
    registerAdminMenu();
    registerResellerMenu();
  }

  return { register };
}

module.exports = { createAdminMenuHandlers };
