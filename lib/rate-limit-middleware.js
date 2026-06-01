// lib/rate-limit-middleware.js
// Telegraf middleware untuk rate limiting callback query & command.
//
// Usage di app.js:
//   const { createRateLimitMiddleware } = require('./lib/rate-limit-middleware');
//   const rateLimitCb = createRateLimitMiddleware({ type: 'callback', windowMs: 10000, maxRequests: 5 });
//   const rateLimitCmd = createRateLimitMiddleware({ type: 'command', windowMs: 60000, maxRequests: 10 });
//   bot.use(rateLimitCb);
//   bot.use(rateLimitCmd);

const { createRateLimiter } = require('./rate-limiter');

/**
 * Create rate limit middleware untuk Telegraf.
 * @param {object} options - { type, windowMs, maxRequests, message, logger }
 * @returns {Function} - Telegraf middleware
 */
function createRateLimitMiddleware(options = {}) {
  const {
    type = 'callback',           // 'callback' atau 'command'
    windowMs = 10000,            // Default: 10 detik window
    maxRequests = 5,             // Default: max 5 requests
    message = null,              // Custom cooldown message (optional)
    logger = null,               // Logger instance (optional)
  } = options;

  const keyPrefix = type === 'callback' ? 'rl_cb' : 'rl_cmd';
  const limiter = createRateLimiter({ windowMs, maxRequests, keyPrefix });

  // Cleanup interval: setiap 5 menit
  const cleanupInterval = setInterval(() => {
    const cleaned = limiter.cleanup();
    if (logger && cleaned > 0) {
      logger.debug(`Rate limiter cleanup: ${cleaned} expired entries removed`);
    }
  }, 5 * 60 * 1000);

  // Cleanup on process exit
  if (typeof process !== 'undefined') {
    process.on('exit', () => clearInterval(cleanupInterval));
  }

  /**
   * Telegraf middleware function.
   */
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    // Skip rate limit kalau tidak ada userId (edge case)
    if (!userId) {
      return next();
    }

    // Check hanya untuk type yang sesuai
    const isCallback = type === 'callback' && ctx.callbackQuery;
    const isCommand = type === 'command' && ctx.message?.text?.startsWith('/');

    if (!isCallback && !isCommand) {
      return next(); // Skip kalau bukan target type
    }

    // Check rate limit
    const result = limiter.check(userId);

    if (!result.allowed) {
      const resetSeconds = Math.ceil(result.resetMs / 1000);
      const defaultMessage = `⏳ Tunggu ${resetSeconds} detik sebelum mencoba lagi.`;
      const cooldownMessage = message || defaultMessage;

      if (logger) {
        logger.warn(`Rate limit exceeded for user ${userId} (${type})`);
      }

      // Answer callback query dengan cooldown message
      if (isCallback) {
        try {
          await ctx.answerCbQuery(cooldownMessage, { show_alert: false });
        } catch (err) {
          // Ignore error kalau answerCbQuery gagal
        }
      } else if (isCommand) {
        // Reply command dengan cooldown message
        try {
          await ctx.reply(cooldownMessage, { parse_mode: 'HTML' });
        } catch (err) {
          // Ignore error kalau reply gagal
        }
      }

      return; // Stop middleware chain (jangan lanjut ke handler)
    }

    // Allow request, lanjut ke next middleware/handler
    return next();
  };
}

/**
 * Get rate limiter stats (untuk monitoring/debugging).
 * Helper function untuk expose stats dari middleware.
 */
function createRateLimitStatsGetter(middleware) {
  // Note: ini butuh modify middleware untuk expose limiter instance.
  // Untuk sekarang, kita skip stats getter (optional feature).
  return () => ({ message: 'Stats not available yet' });
}

module.exports = {
  createRateLimitMiddleware,
  createRateLimitStatsGetter,
};
