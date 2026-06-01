// lib/dashboard-stats.js
// Helper untuk query dashboard statistics.
// Dipakai oleh command /admin_dashboard untuk tampilkan metrics real-time.

const { dbGet, dbAll } = require('./db-async');

/**
 * Get QRIS pending count + list invoice terakhir.
 * @param {object} db - sqlite3 database instance
 * @param {number} limit - max items to return (default 10)
 * @returns {Promise<{count: number, items: Array}>}
 */
async function getQrisPending(db, limit = 10) {
  const countRow = await dbGet(
    db,
    'SELECT COUNT(*) as count FROM qris_payments WHERE status = ?',
    ['pending']
  );
  const count = countRow ? countRow.count : 0;

  const items = await dbAll(
    db,
    `SELECT invoice_id, user_id, amount, created_at 
     FROM qris_payments 
     WHERE status = ? 
     ORDER BY created_at DESC 
     LIMIT ?`,
    ['pending', limit]
  );

  return { count, items };
}

/**
 * Get active users count (users dengan saldo > 0 atau punya akun aktif).
 * @param {object} db - sqlite3 database instance
 * @returns {Promise<number>}
 */
async function getActiveUsersCount(db) {
  const row = await dbGet(
    db,
    `SELECT COUNT(DISTINCT user_id) as count 
     FROM users 
     WHERE saldo > 0 OR user_id IN (
       SELECT DISTINCT user_id FROM accounts WHERE expires_at > ?
     )`,
    [Date.now()]
  );
  return row ? row.count : 0;
}

/**
 * Get revenue summary (today, 7 days, 30 days).
 * @param {object} db - sqlite3 database instance
 * @returns {Promise<{today: number, week: number, month: number}>}
 */
async function getRevenueSummary(db) {
  const now = Date.now();
  const oneDayMs = 24 * 3600 * 1000;
  const todayStart = now - oneDayMs;
  const weekStart = now - 7 * oneDayMs;
  const monthStart = now - 30 * oneDayMs;

  const todayRow = await dbGet(
    db,
    `SELECT SUM(amount) as total 
     FROM transactions 
     WHERE type = 'debit' AND timestamp >= ?`,
    [todayStart]
  );

  const weekRow = await dbGet(
    db,
    `SELECT SUM(amount) as total 
     FROM transactions 
     WHERE type = 'debit' AND timestamp >= ?`,
    [weekStart]
  );

  const monthRow = await dbGet(
    db,
    `SELECT SUM(amount) as total 
     FROM transactions 
     WHERE type = 'debit' AND timestamp >= ?`,
    [monthStart]
  );

  return {
    today: todayRow?.total || 0,
    week: weekRow?.total || 0,
    month: monthRow?.total || 0,
  };
}

/**
 * Get total users count.
 * @param {object} db - sqlite3 database instance
 * @returns {Promise<number>}
 */
async function getTotalUsersCount(db) {
  const row = await dbGet(db, 'SELECT COUNT(*) as count FROM users', []);
  return row ? row.count : 0;
}

/**
 * Get total accounts count (aktif + expired).
 * @param {object} db - sqlite3 database instance
 * @returns {Promise<{active: number, expired: number}>}
 */
async function getAccountsCount(db) {
  const now = Date.now();
  
  const activeRow = await dbGet(
    db,
    'SELECT COUNT(*) as count FROM accounts WHERE expires_at > ?',
    [now]
  );

  const expiredRow = await dbGet(
    db,
    'SELECT COUNT(*) as count FROM accounts WHERE expires_at <= ?',
    [now]
  );

  return {
    active: activeRow?.count || 0,
    expired: expiredRow?.count || 0,
  };
}

module.exports = {
  getQrisPending,
  getActiveUsersCount,
  getRevenueSummary,
  getTotalUsersCount,
  getAccountsCount,
};
