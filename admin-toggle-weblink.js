// ============================================================================
// ADMIN COMMAND: Toggle Web Link Feature
// ============================================================================
bot.command('toggleweblink', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from) return;
  
  const userId = ctx.from.id;
  if (userId !== MASTER_ID) {
    return ctx.reply('🚫 Command ini hanya untuk master admin.', { parse_mode: 'HTML' });
  }

  const currentStatus = isWebLinkEnabled();
  const newStatus = !currentStatus;
  
  // Update env variable (runtime only - tidak persist ke file .env)
  process.env.WEB_LINK_ENABLED = newStatus ? 'true' : 'false';
  
  await ctx.reply(
    `🔧 <b>Web Link Feature</b>\n\n` +
    `Status sebelum: ${currentStatus ? '✅ Enabled' : '❌ Disabled'}\n` +
    `Status sekarang: ${newStatus ? '✅ Enabled' : '❌ Disabled'}\n\n` +
    `<i>Note: Perubahan ini runtime only. Untuk permanent, edit .env file:</i>\n` +
    `<code>WEB_LINK_ENABLED=${newStatus ? 'true' : 'false'}</code>\n` +
    `Lalu restart bot.`,
    { parse_mode: 'HTML' }
  );
  
  logger.info(`Web link feature toggled by ${userId}: ${currentStatus} → ${newStatus}`);
});
