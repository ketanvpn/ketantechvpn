// lib/error-logger.js
// Helper untuk log runtime errors ke table error_logs.
//
// Pemakaian:
//   const { logError } = require('./lib/error-logger');
//   try {
//     // risky operation
//   } catch (err) {
//     await logError(db, 'payment/deposit', err, { userId: 123, amount: 50000 });
//     throw err; // re-throw kalau perlu
//   }
//
// Context disimpan sebagai JSON string supaya fleksibel (bisa simpan object apapun).

const { dbRun } = require('./db-async');

/**
 * Log runtime error ke table error_logs.
 * @param {object} db - sqlite3 database instance
 * @param {string} source - sumber error (e.g. 'payment/deposit', 'bot.action.addserver', 'scheduler/daily-report')
 * @param {Error|string} error - Error object atau string message
 * @param {object|string|null} context - context tambahan (object akan di-JSON.stringify, string disimpan as-is, null jadi '')
 * @returns {Promise<{changes: number, lastID: number}>}
 */
async function logError(db, source, error, context = null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  let contextStr = '';
  if (context !== null && context !== undefined) {
    contextStr = typeof context === 'string' ? context : JSON.stringify(context);
  }

  const timestamp = Date.now();
  return dbRun(
    db,
    'INSERT INTO error_logs (source, error_message, context, timestamp) VALUES (?, ?, ?, ?)',
    [source, errorMessage, contextStr, timestamp]
  );
}

/**
 * Ambil error logs dengan filter (untuk admin dashboard).
 * @param {object} db - sqlite3 database instance
 * @param {object} options - { source, sinceMs, limit, offset }
 * @returns {Promise<Array>}
 */
async function getErrorLogs(db, options = {}) {
  const { dbAll } = require('./db-async');
  const { source, sinceMs, limit = 50, offset = 0 } = options;

  let sql = 'SELECT * FROM error_logs WHERE 1=1';
  const params = [];

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }

  if (sinceMs) {
    sql += ' AND timestamp >= ?';
    params.push(sinceMs);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return dbAll(db, sql, params);
}

/**
 * Hitung error count dalam time window (untuk admin dashboard).
 * @param {object} db - sqlite3 database instance
 * @param {number} sinceMs - timestamp ms (e.g. Date.now() - 24*3600*1000 untuk 24 jam terakhir)
 * @param {string|null} source - filter by source (optional)
 * @returns {Promise<number>}
 */
async function getErrorCount(db, sinceMs, source = null) {
  const { dbGet } = require('./db-async');

  let sql = 'SELECT COUNT(*) as count FROM error_logs WHERE timestamp >= ?';
  const params = [sinceMs];

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }

  const row = await dbGet(db, sql, params);
  return row ? row.count : 0;
}

module.exports = {
  logError,
  getErrorLogs,
  getErrorCount,
};
