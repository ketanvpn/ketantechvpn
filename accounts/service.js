// accounts/service.js - data layer akun VPN (factory)
// Dependency: db, logger.

function createAccountService({ db, logger }) {
  if (!db) throw new Error('createAccountService: db required');
  if (!logger) throw new Error('createAccountService: logger required');

  function getUserSaldo(userId) {
    return new Promise((resolve) => {
      db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (e, r) => {
        if (e) return resolve(null);
        resolve(r ? Number(r.saldo || 0) : null);
      });
    });
  }

  function recordSaldoTransaction(userId, amount, type, referenceId) {
    db.run(
      'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
      [userId, amount, type, referenceId || null, Date.now()],
      (err) => {
        if (err) {
          logger.error('Kesalahan mencatat transaksi saldo:', err.message);
        }
      }
    );
  }

  function recordAccountTransaction(userId, type) {
    return new Promise((resolve, reject) => {
      const referenceId = 'account-' + type + '-' + userId + '-' + Date.now();
      db.run(
        'INSERT INTO transactions (user_id, type, reference_id, timestamp) VALUES (?, ?, ?, ?)',
        [userId, type, referenceId, Date.now()],
        (err) => {
          if (err) {
            logger.error('Error recording account transaction:', err.message);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  function processAccountPayment(userId, amount, type, action, serverId, username) {
    const trxType = action === 'create'
      ? 'buy_create_' + type
      : 'buy_renew_' + type;
    const refId = 'buy-' + serverId + '-' + username + '-' + Date.now();

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE TRANSACTION', (beginErr) => {
          if (beginErr) {
            logger.error('Gagal memulai transaksi pembayaran akun:', beginErr.message);
            return reject(beginErr);
          }

          db.run(
            'UPDATE users SET saldo = saldo - ? WHERE user_id = ? AND saldo >= ?',
            [amount, userId, amount],
            function (err) {
              if (err) {
                return db.run('ROLLBACK', () => {
                  logger.error('Kesalahan saat mengurangi saldo pengguna:', err.message);
                  reject(err);
                });
              }

              if (this.changes === 0) {
                const warnMsg = 'Gagal mengurangi saldo (saldo tidak cukup) untuk user ' + userId + ' saat proses pembelian.';
                return db.run('ROLLBACK', () => {
                  logger.warn(warnMsg);
                  reject(new Error(warnMsg));
                });
              }

              db.run(
                'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
                [userId, -amount, trxType, refId, Date.now()],
                (err2) => {
                  if (err2) {
                    return db.run('ROLLBACK', () => {
                      logger.error('Gagal mencatat transaksi saldo pembelian akun:', err2.message);
                      reject(err2);
                    });
                  }

                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      logger.error('Gagal commit transaksi pembayaran akun:', commitErr.message);
                      return reject(commitErr);
                    }
                    resolve({ refId, trxType });
                  });
                }
              );
            }
          );
        });
      });
    });
  }

  function refundAccountPayment(userId, amount, type, action, serverId, username, reason = 'rollback_create_failed') {
    const trxType = action === 'create'
      ? 'refund_create_' + type
      : 'refund_renew_' + type;
    const refId = 'refund-' + serverId + '-' + username + '-' + Date.now();

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE TRANSACTION', (beginErr) => {
          if (beginErr) return reject(beginErr);

          db.run(
            'UPDATE users SET saldo = saldo + ? WHERE user_id = ?',
            [amount, userId],
            function (err) {
              if (err) return db.run('ROLLBACK', () => reject(err));
              if ((this.changes || 0) === 0) {
                return db.run('ROLLBACK', () => reject(new Error('User refund tidak ditemukan')));
              }

              db.run(
                'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
                [userId, amount, trxType, refId + ':' + reason, Date.now()],
                (err2) => {
                  if (err2) return db.run('ROLLBACK', () => reject(err2));
                  db.run('COMMIT', (commitErr) => (commitErr ? reject(commitErr) : resolve(true)));
                }
              );
            }
          );
        });
      });
    });
  }

  function upsertAccount(userId, username, type, serverId, expDays) {
    const nowTs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    let addMs = 0;
    if (expDays && Number.isFinite(expDays) && expDays > 0) {
      addMs = expDays * dayMs;
    }

    db.get(
      'SELECT id, created_at, expires_at FROM accounts WHERE user_id = ? AND username = ? AND type = ? AND server_id = ? ORDER BY id DESC LIMIT 1',
      [userId, username, type, serverId],
      (err, row) => {
        if (err) {
          logger.error('Kesalahan saat membaca tabel accounts:', err.message);
          return;
        }

        if (row) {
          const oldCreated = row.created_at || nowTs;
          const oldExpires = row.expires_at || nowTs;
          const baseTs = oldExpires > nowTs ? oldExpires : nowTs;
          const newExpires = baseTs + addMs;

          db.run(
            'UPDATE accounts SET created_at = ?, expires_at = ? WHERE id = ?',
            [oldCreated, newExpires, row.id],
            (err2) => {
              if (err2) {
                logger.error('Kesalahan memperbarui data akun di tabel accounts:', err2.message);
              } else {
                logger.info('Accounts updated untuk user ' + userId + ', ' + type + ':' + username + ' di server ' + serverId);
              }
            }
          );
        } else {
          const createdAt = nowTs;
          const expiresAt = addMs ? nowTs + addMs : null;

          db.run(
            'INSERT INTO accounts (user_id, username, type, server_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, username, type, serverId, createdAt, expiresAt],
            (err2) => {
              if (err2) {
                logger.error('Kesalahan menyimpan data akun ke tabel accounts:', err2.message);
              } else {
                logger.info('Accounts inserted untuk user ' + userId + ', ' + type + ':' + username + ' di server ' + serverId);
              }
            }
          );
        }
      }
    );
  }

  return {
    getUserSaldo,
    recordSaldoTransaction,
    recordAccountTransaction,
    processAccountPayment,
    refundAccountPayment,
    upsertAccount,
  };
}

module.exports = { createAccountService };
