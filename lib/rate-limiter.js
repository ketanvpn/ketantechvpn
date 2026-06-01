// lib/rate-limiter.js
// In-memory rate limiter dengan TTL cleanup.
// Dipakai untuk anti-spam callback query & command.

/**
 * Create rate limiter instance.
 * @param {object} options - { windowMs, maxRequests, keyPrefix }
 * @returns {object} - { check, cleanup, stats }
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 10000,        // Default: 10 detik window
    maxRequests = 5,         // Default: max 5 requests per window
    keyPrefix = 'rl',        // Prefix untuk key
  } = options;

  // In-memory store: { key: [timestamp1, timestamp2, ...] }
  const store = new Map();

  /**
   * Check apakah user exceed rate limit.
   * @param {string|number} userId - User identifier
   * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
   */
  function check(userId) {
    const key = `${keyPrefix}:${userId}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get existing timestamps untuk user ini
    let timestamps = store.get(key) || [];

    // Filter timestamps yang masih dalam window
    timestamps = timestamps.filter(ts => ts > windowStart);

    // Check apakah exceed limit
    if (timestamps.length >= maxRequests) {
      const oldestTimestamp = Math.min(...timestamps);
      const resetMs = oldestTimestamp + windowMs - now;
      return {
        allowed: false,
        remaining: 0,
        resetMs: Math.max(0, resetMs),
      };
    }

    // Add new timestamp
    timestamps.push(now);
    store.set(key, timestamps);

    return {
      allowed: true,
      remaining: maxRequests - timestamps.length,
      resetMs: windowMs,
    };
  }

  /**
   * Cleanup expired entries dari store.
   * Panggil periodic untuk prevent memory leak.
   */
  function cleanup() {
    const now = Date.now();
    const windowStart = now - windowMs;
    let cleaned = 0;

    for (const [key, timestamps] of store.entries()) {
      const validTimestamps = timestamps.filter(ts => ts > windowStart);
      if (validTimestamps.length === 0) {
        store.delete(key);
        cleaned++;
      } else if (validTimestamps.length < timestamps.length) {
        store.set(key, validTimestamps);
      }
    }

    return cleaned;
  }

  /**
   * Get current stats (untuk monitoring).
   * @returns {{ totalKeys: number, totalRequests: number }}
   */
  function stats() {
    let totalRequests = 0;
    for (const timestamps of store.values()) {
      totalRequests += timestamps.length;
    }
    return {
      totalKeys: store.size,
      totalRequests,
    };
  }

  /**
   * Clear all entries (untuk testing).
   */
  function clear() {
    store.clear();
  }

  return {
    check,
    cleanup,
    stats,
    clear,
  };
}

module.exports = { createRateLimiter };
