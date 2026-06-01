// admin/dashboard.js
// Admin dashboard handlers: /admin_dashboard command + callback handlers.

const { getErrorLogs, getErrorCount } = require('../lib/error-logger');
const {
  getQrisPending,
  getActiveUsersCount,
  getRevenueSummary,
  getTotalUsersCount,
  getAccountsCount,
} = require('../lib/dashboard-stats');
const {
  buildDashboardText,
  buildDashboardKeyboard,
  buildQrisPendingText,
  buildErrorLogsText,
  buildBackToDashboardKeyboard,
} = require('../lib/dashboard-menu');

/**
 * Create admin dashboard handlers.
 * @param {object} deps - { bot, db, logger, ADMIN_IDS, timeZone }
 * @returns {object} - { register }
 */
function createDashboardHandlers(deps) {
  const { bot, db, logger, ADMIN_IDS, timeZone = 'Asia/Jakarta' } = deps;

  // Helper: edit or reply message
  async function editOrReply(ctx, text, extra = {}) {
    try {
      if (ctx.callbackQuery && ctx.callbackQuery.message) {
        await ctx.editMessageText(text, extra);
      } else {
        await ctx.reply(text, extra);
      }
    } catch (err) {
      // Fallback reply kalau edit gagal (message too old, etc)
      if (err.message && err.message.includes('message is not modified')) {
        return; // Skip kalau message sama persis
      }
      try {
        await ctx.reply(text, extra);
      } catch (replyErr) {
        logger.error('editOrReply fallback gagal:', replyErr.message);
      }
    }
  }

  // Helper: fetch dashboard data
  async function fetchDashboardData() {
    const qrisPending = await getQrisPending(db, 10);
    const errorCount = await getErrorCount(db, Date.now() - 24 * 3600 * 1000);
    const activeUsers = await getActiveUsersCount(db);
    const revenue = await getRevenueSummary(db);
    const totalUsers = await getTotalUsersCount(db);
    const accounts = await getAccountsCount(db);

    return { qrisPending, errorCount, activeUsers, revenue, totalUsers, accounts };
  }

  // Command: /admin_dashboard
  bot.command('admin_dashboard', async (ctx) => {
    try {
      const userId = ctx.from?.id;
      if (!userId || !ADMIN_IDS.includes(userId)) {
        return ctx.reply('🚫 <b>Menu ini khusus admin.</b>', { parse_mode: 'HTML' });
      }

      logger.info('Admin dashboard accessed by user ' + userId);

      const data = await fetchDashboardData();
      const text = buildDashboardText(data);
      const keyboard = buildDashboardKeyboard();

      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error('Error /admin_dashboard:', err.message);
      await ctx.reply('⚠️ Terjadi kesalahan saat memuat dashboard.', { parse_mode: 'HTML' });
    }
  });

  // Action: dashboard_refresh (reload main dashboard)
  bot.action('dashboard_refresh', async (ctx) => {
    try {
      await ctx.answerCbQuery('🔄 Memuat ulang...').catch(() => {});

      const userId = ctx.from?.id;
      if (!userId || !ADMIN_IDS.includes(userId)) {
        return ctx.answerCbQuery('🚫 Khusus admin.', { show_alert: true }).catch(() => {});
      }

      const data = await fetchDashboardData();
      const text = buildDashboardText(data);
      const keyboard = buildDashboardKeyboard();

      await editOrReply(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error('Error dashboard_refresh:', err.message);
      await ctx.answerCbQuery('⚠️ Gagal memuat dashboard.', { show_alert: true }).catch(() => {});
    }
  });

  // Action: dashboard_qris (QRIS pending detail)
  bot.action('dashboard_qris', async (ctx) => {
    try {
      await ctx.answerCbQuery('💳 Memuat QRIS pending...').catch(() => {});

      const userId = ctx.from?.id;
      if (!userId || !ADMIN_IDS.includes(userId)) {
        return ctx.answerCbQuery('🚫 Khusus admin.', { show_alert: true }).catch(() => {});
      }

      const qrisPending = await getQrisPending(db, 10);
      const text = buildQrisPendingText(qrisPending, timeZone);
      const keyboard = buildBackToDashboardKeyboard();

      await editOrReply(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error('Error dashboard_qris:', err.message);
      await ctx.answerCbQuery('⚠️ Gagal memuat QRIS pending.', { show_alert: true }).catch(() => {});
    }
  });

  // Action: dashboard_errors (Error logs detail)
  bot.action('dashboard_errors', async (ctx) => {
    try {
      await ctx.answerCbQuery('⚠️ Memuat error logs...').catch(() => {});

      const userId = ctx.from?.id;
      if (!userId || !ADMIN_IDS.includes(userId)) {
        return ctx.answerCbQuery('🚫 Khusus admin.', { show_alert: true }).catch(() => {});
      }

      const twentyFourHoursAgo = Date.now() - 24 * 3600 * 1000;
      const errorCount = await getErrorCount(db, twentyFourHoursAgo);
      const errorLogs = await getErrorLogs(db, { sinceMs: twentyFourHoursAgo, limit: 5 });

      const text = buildErrorLogsText({ count: errorCount, items: errorLogs }, timeZone);
      const keyboard = buildBackToDashboardKeyboard();

      await editOrReply(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.error('Error dashboard_errors:', err.message);
      await ctx.answerCbQuery('⚠️ Gagal memuat error logs.', { show_alert: true }).catch(() => {});
    }
  });

  return {
    register() {
      logger.info('Admin dashboard handlers registered');
    },
  };
}

module.exports = { createDashboardHandlers };
