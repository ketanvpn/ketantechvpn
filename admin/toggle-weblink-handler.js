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
  
  // Function untuk update .env file
  function updateEnvFile(newStatus) {
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(__dirname, '..', '.env');
      
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      
      const newValue = newStatus ? 'true' : 'false';
      const envKey = 'WEB_LINK_ENABLED';
      
      if (envContent.includes(envKey)) {
        envContent = envContent.replace(
          new RegExp(`^${envKey}=.*$`, 'm'),
          `${envKey}=${newValue}`
        );
      } else {
        envContent += `\n${envKey}=${newValue}\n`;
      }
      
      fs.writeFileSync(envPath, envContent, 'utf8');
      console.log('[toggle-weblink-handler] .env file updated:', envKey, '=', newValue);
      return true;
    } catch (err) {
      console.error('[toggle-weblink-handler] Failed to update .env file:', err.message);
      return false;
    }
  }

    // Handler untuk MASUK ke menu toggle (tidak toggle langsung)
  bot.action('admin_toggle_weblink', async (ctx) => {
    console.log('[toggle-weblink-handler] Menu opened by:', ctx.from?.id);
    
    await ctx.answerCbQuery().catch(() => {});
    if (!ctx.from) return;
    
    const userId = ctx.from.id;
    if (userId !== MASTER_ID) {
      console.log('[toggle-weblink-handler] Access denied for user:', userId);
      return ctx.reply('🚫 Fitur ini hanya untuk master admin.', { parse_mode: 'HTML' });
    }

    const currentStatus = isWebLinkEnabled();
    
    console.log('[toggle-weblink-handler] Current status:', currentStatus);
    
    // Tampilkan menu toggle switch style
    await sendCleanMenu(ctx,
      `🔧 <b>Web Link Feature</b>\n\n` +
      `Status: ${currentStatus ? '✅ <b>ON</b>' : '❌ <b>OFF</b>'}\n\n` +
      `${currentStatus ? 'User bisa link akun ke web.' : 'Menu link disembunyikan dari user.'}`,
      { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            currentStatus 
              ? [{ text: '🔴 Matikan', callback_data: 'admin_toggle_disable' }]
              : [{ text: '🟢 Nyalakan', callback_data: 'admin_toggle_enable' }],
            [{ text: '🔙 Kembali', callback_data: 'send_admin_menu' }]
          ]
        }
      }
    );
  });
  
    // Handler untuk ENABLE (toggle actual)
  bot.action('admin_toggle_enable', async (ctx) => {
    await ctx.answerCbQuery('✅ Web Link dinyalakan').catch(() => {});
    if (!ctx.from || ctx.from.id !== MASTER_ID) return;
    
    console.log('[toggle-weblink-handler] Enable by:', ctx.from.id);
    
    // Update runtime + file
    process.env.WEB_LINK_ENABLED = 'true';
    const success = updateEnvFile(true);
    
    logger.info(`Web link enabled by ${ctx.from.id}`);
    
    // Langsung balik ke menu toggle (refresh status)
    const currentStatus = isWebLinkEnabled();
    await sendCleanMenu(ctx,
      `🔧 <b>Web Link Feature</b>\n\n` +
      `Status: ${currentStatus ? '✅ <b>ON</b>' : '❌ <b>OFF</b>'}\n\n` +
      `${currentStatus ? 'User bisa link akun ke web.' : 'Menu link disembunyikan dari user.'}`,
      { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            currentStatus 
              ? [{ text: '🔴 Matikan', callback_data: 'admin_toggle_disable' }]
              : [{ text: '🟢 Nyalakan', callback_data: 'admin_toggle_enable' }],
            [{ text: '🔙 Kembali', callback_data: 'send_admin_menu' }]
          ]
        }
      }
    );
  });
  
  // Handler untuk DISABLE (toggle actual)
  bot.action('admin_toggle_disable', async (ctx) => {
    await ctx.answerCbQuery('❌ Web Link dimatikan').catch(() => {});
    if (!ctx.from || ctx.from.id !== MASTER_ID) return;
    
    console.log('[toggle-weblink-handler] Disable by:', ctx.from.id);
    
    // Update runtime + file
    process.env.WEB_LINK_ENABLED = 'false';
    const success = updateEnvFile(false);
    
    logger.info(`Web link disabled by ${ctx.from.id}`);
    
    // Langsung balik ke menu toggle (refresh status)
    const currentStatus = isWebLinkEnabled();
    await sendCleanMenu(ctx,
      `🔧 <b>Web Link Feature</b>\n\n` +
      `Status: ${currentStatus ? '✅ <b>ON</b>' : '❌ <b>OFF</b>'}\n\n` +
      `${currentStatus ? 'User bisa link akun ke web.' : 'Menu link disembunyikan dari user.'}`,
      { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            currentStatus 
              ? [{ text: '🔴 Matikan', callback_data: 'admin_toggle_disable' }]
              : [{ text: '🟢 Nyalakan', callback_data: 'admin_toggle_enable' }],
            [{ text: '🔙 Kembali', callback_data: 'send_admin_menu' }]
          ]
        }
      }
    );
  });
  
  console.log('[toggle-weblink-handler] Handler registered successfully');
};
