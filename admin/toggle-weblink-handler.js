// Admin button handler untuk toggle web link
module.exports = function registerToggleWebLinkHandler(bot, deps) {
  const { sendCleanMenu, MASTER_ID, logger } = deps;
  
  // Validasi dependencies
  if (!sendCleanMenu) {
    console.error('[toggle-weblink-handler] ERROR: sendCleanMenu is undefined');
    return;
  }
  if (!MASTER_ID) {
    console.error('[toggle-weblink-handler] ERROR: MASTER_ID is undefined');
    return;
  }
  if (!logger) {
    console.error('[toggle-weblink-handler] ERROR: logger is undefined');
    return;
  }
  
  console.log('[toggle-weblink-handler] Registering admin_toggle_weblink handler...');
  
  // Import function isWebLinkEnabled dari app context
  function isWebLinkEnabled() {
    const flag = process.env.WEB_LINK_ENABLED;
    if (flag === undefined || flag === null || flag === '') return false;
    return String(flag).toLowerCase() === 'true';
  }

  bot.action('admin_toggle_weblink', async (ctx) => {
    console.log('[toggle-weblink-handler] Button clicked by:', ctx.from?.id);
    
    await ctx.answerCbQuery().catch(() => {});
    if (!ctx.from) return;
    
    const userId = ctx.from.id;
    if (userId !== MASTER_ID) {
      console.log('[toggle-weblink-handler] Access denied for user:', userId);
      return ctx.reply('🚫 Fitur ini hanya untuk master admin.', { parse_mode: 'HTML' });
    }

    const currentStatus = isWebLinkEnabled();
    const newStatus = !currentStatus;
    
    console.log('[toggle-weblink-handler] Toggle:', currentStatus, '→', newStatus);
    
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
            [{ text: '🔙 Kembali ke Admin Menu', callback_data: 'send_admin_menu' }]
          ]
        }
      }
    );
    
    logger.info(`Web link feature toggled by ${userId} (button): ${currentStatus} → ${newStatus}`);
  });
  
  console.log('[toggle-weblink-handler] Handler registered successfully');
};
