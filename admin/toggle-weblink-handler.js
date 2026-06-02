// Admin button handler untuk toggle web link
module.exports = function registerToggleWebLinkHandler(bot, deps) {
  const { sendCleanMenu, MASTER_ID, logger } = deps;
  
  // Import function isWebLinkEnabled dari app context
  function isWebLinkEnabled() {
    const flag = process.env.WEB_LINK_ENABLED;
    if (flag === undefined || flag === null || flag === '') return false;
    return String(flag).toLowerCase() === 'true';
  }

  bot.action('admin_toggle_weblink', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!ctx.from) return;
    
    const userId = ctx.from.id;
    if (userId !== MASTER_ID) {
      return ctx.reply('🚫 Fitur ini hanya untuk master admin.', { parse_mode: 'HTML' });
    }

    const currentStatus = isWebLinkEnabled();
    const newStatus = !currentStatus;
    
    // Update env variable (runtime only)
    process.env.WEB_LINK_ENABLED = newStatus ? 'true' : 'false';
    
    await sendCleanMenu(ctx,
      `🔧 <b>Web Link Feature</b>\n\n` +
      `Status: ${newStatus ? '✅ <b>Enabled</b>' : '❌ <b>Disabled</b>'}\n\n` +
      `${newStatus ? '✅ User sekarang bisa link akun ke web' : '❌ Menu link disembunyikan dari user'}\n\n` +
      `<i>Perubahan runtime only. Untuk permanent, edit .env:</i>\n` +
      `<code>WEB_LINK_ENABLED=${newStatus ? 'true' : 'false'}</code>`,
      { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Toggle Lagi', callback_data: 'admin_toggle_weblink' }],
            [{ text: '🔙 Kembali ke Admin Menu', callback_data: 'admin' }]
          ]
        }
      }
    );
    
    logger.info(`Web link feature toggled by ${userId} (button): ${currentStatus} → ${newStatus}`);
  });
};
