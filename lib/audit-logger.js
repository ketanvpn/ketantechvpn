// lib/audit-logger.js
// Helper untuk log admin actions ke table audit_logs.
//
// Pemakaian:
//   const { logAuditAction } = require('./lib/audit-logger');
//   await logAuditAction(db, userId, 'add_server', { domain: 'example.com', harga: 15000 });
//
// Details disimpan sebagai JSON string supaya fleksibel (bisa simpan object apapun).

const { dbRun } = require('./db-async');

/**
 * Log admin action ke table audit_logs.
 * @param {object} db - sqlite3 database instance
 * @param {number} userId - telegram user_id admin yang melakukan action
 * @param {string} action - nama action (add_server, edit_harga, delete_server, add_saldo, broadcast, dll)
 * @param {object|string|null} details - detail action (object akan di-JSON.stringify, string disimpan as-is, null jadi '')
 * @returns {Promise<{changes: number, lastID: number}>}
 */
async function logAuditAction(db, userId, action, details = null) {
  let detailsStr = '';
  if (details !== null && details !== undefined) {
    detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
  }

  const timestamp = Date.now();
  return dbRun(
    db,
    'INSERT INTO audit_logs (user_id, action, details, timestamp) VALUES (?, ?, ?, ?)',
    [userId, action, detailsStr, timestamp]
  );
}

/**
 * Ambil audit logs dengan filter (untuk admin dashboard).
 * @param {object} db - sqlite3 database instance
 * @param {object} options - { userId, action, limit, offset }
 * @returns {Promise<Array>}
 */
async function getAuditLogs(db, options = {}) {
  const { dbAll } = require('./db-async');
  const { userId, action, limit = 50, offset = 0 } = options;

  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }

  if (action) {
    sql += ' AND action = ?';
    params.push(action);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return dbAll(db, sql, params);
}

module.exports = {
  logAuditAction,
  getAuditLogs,
};
