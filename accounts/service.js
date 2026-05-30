// accounts/service.js - data layer akun VPN (factory)
//
// Sejak penambahan integrasi web (ketantech.my.id), service ini SADAR LINK:
//   - Kalau user sudah link ke akun web (kolom users.web_user_id != NULL):
//     • getUserSaldo() ambil saldo dari API web (single source of truth)
//     • processAccountPayment() panggil POST /telegram/debit ke web
//     • refundAccountPayment() panggil POST /telegram/credit ke web
//   - Kalau user belum link ATAU webApiClient/getLinkInfo tidak di-inject:
//     • Semua operasi tetap pakai tabel users SQLite (perilaku legacy)
//
// Dependency optional `webApiClient` + `getLinkInfo(userId)` di-inject dari
// app.js. `getLinkInfo` return Promise<null | { web_user_id, web_linked_at }>.

function createAccountService({ db, logger, webApiClient = null, getLinkInfo = null, isWebLinkEnabled = null }) {
  if (!db) throw new Error('createAccountService: db required');
  if (!logger) throw new Error('createAccountService: logger required');

  // Helper internal: cek apakah user sudah link & web link feature aktif.
  // Return objek link kalau aktif & linked; null kalau tidak (atau ada error).
  // Sengaja silent fallback: kalau SQLite/web error, anggap saja "tidak linked"
  // supaya operasi pembelian akun tidak nge-block kalau ada masalah jaringan.
  async function _resolveLink(userId) {
    if (!webApiClient) return null;
    if (typeof isWebLinkEnabled === 'function' && !isWebLinkEnabled()) return null;
    if (typeof getLinkInfo !== 'function') return null;
    try {
      const info = await getLinkInfo(userId);
      if (info && info.web_user_id) return info;
      return null;
    } catch (e) {
      logger.warn('_resolveLink error: ' + (e.message || e));
      return null;
    }
  }

  // Saldo legacy dari SQLite. Dipakai kalau user belum link, atau sebagai
  // fallback emergency saat API web error.
  function _getLocalSaldo(userId) {
    return new Promise((resolve) => {
      db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (e, r) => {
        if (e) return resolve(null);
        resolve(r ? Number(r.saldo || 0) : null);
      });
    });
  }

  // Saldo "efektif" — dari web kalau linked, dari SQLite kalau tidak.
  // Ini yang dipakai handler create akun untuk cek saldo cukup.
  async function getUserSaldo(userId) {
    const link = await _resolveLink(userId);
    if (link) {
      try {
        const res = await webApiClient.getBalanceByTelegramId(userId);
        if (res && typeof res.balance === 'number') return res.balance;
        // 404 = endpoint return null = user tidak ditemukan di web
        // (mungkin web baru saja unlink). Fallback ke SQLite.
        logger.warn('getUserSaldo: web return null untuk linked user ' + userId + ', fallback SQLite');
      } catch (e) {
        logger.warn('getUserSaldo: gagal fetch saldo web, fallback SQLite: ' + (e.message || e));
      }
    }
    return _getLocalSaldo(userId);
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

  // Internal: debit saldo lokal SQLite secara atomic + record transaction.
  // Dipakai sebagai legacy path untuk user yang belum link.
  function _debitLocal(userId, amount, trxType, refId) {
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

  async function processAccountPayment(userId, amount, type, action, serverId, username, refIdOverride = null) {
    const trxType = action === 'create'
      ? 'buy_create_' + type
      : 'buy_renew_' + type;
    const refId = String(refIdOverride || '').trim() || ('buy-' + serverId + '-' + username + '-' + Date.now());

    const link = await _resolveLink(userId);

    if (link) {
      // === Pakai saldo web ===
      // Kirim debit ke web. refId dipakai sebagai marker idempotent di
      // balance_logs.description, supaya retry network tidak double-debit.
      try {
        const res = await webApiClient.debitBalance({
          telegramId: userId,
          amount: amount,
          description: 'Pembelian ' + type.toUpperCase() + ' (' + action + ')',
          refId: refId,
        });
        if (!res || !res.ok) {
          // applied=false bisa terjadi kalau refId dipakai ulang (idempotency hit).
          // Untuk pemanggil tidak masalah — saldo sudah pernah dikurangi, kita
          // anggap berhasil.
          if (res && res.applied === false) {
            logger.warn('processAccountPayment: refId duplicate at web, anggap sukses (refId=' + refId + ')');
            return { refId, trxType, source: 'web', dedup: true };
          }
          throw new Error('Web tidak ack debit (response.ok = false)');
        }
        // Catat juga di transactions SQLite untuk audit trail. Tidak menggangu
        // saldo SQLite (saldo SQLite sudah 0 dan tetap 0 untuk linked user).
        try {
          await new Promise((resolve) => {
            db.run(
              'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
              [userId, -amount, trxType + '_web', refId, Date.now()],
              () => resolve()
            );
          });
        } catch (e) {
          logger.warn('processAccountPayment: gagal catat tx SQLite (non-fatal): ' + (e.message || e));
        }
        return { refId, trxType, source: 'web', newBalance: res.newBalance };
      } catch (e) {
        // Kalau web bilang saldo kurang (status 400 + newBalance), lempar error
        // dengan pesan jelas supaya UI bot tampilkan "saldo tidak cukup".
        if (e.status === 400) {
          throw new Error('Saldo tidak cukup. Saldo web sekarang: Rp ' + Number(e.newBalance || 0).toLocaleString('id-ID'));
        }
        // Untuk error lain (network/5xx): JANGAN fallback ke SQLite, karena
        // saldo SQLite linked user = 0. Lebih baik tolak transaksi supaya user
        // bisa retry, daripada akun jadi terbuat tapi saldo tidak kepotong.
        logger.error('processAccountPayment via web gagal: ' + (e.message || e));
        throw new Error('Tidak bisa terhubung ke server saldo. Silakan coba lagi sebentar.');
      }
    }

    // === Legacy path: debit SQLite ===
    return _debitLocal(userId, amount, trxType, refId);
  }

  function _refundLocal(userId, amount, trxType, refId, reason) {
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

  async function refundAccountPayment(userId, amount, type, action, serverId, username, reason = 'rollback_create_failed') {
    const trxType = action === 'create'
      ? 'refund_create_' + type
      : 'refund_renew_' + type;
    const refId = 'refund-' + serverId + '-' + username + '-' + Date.now();

    const link = await _resolveLink(userId);

    if (link) {
      // Kembalikan saldo ke web. refId beda dari debit asli — tidak ada konflik.
      try {
        const res = await webApiClient.creditBalance({
          telegramId: userId,
          amount: amount,
          description: 'Refund ' + type.toUpperCase() + ' (' + action + ': ' + reason + ')',
          refId: refId,
        });
        if (res && res.ok) {
          try {
            await new Promise((resolve) => {
              db.run(
                'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
                [userId, amount, trxType + '_web', refId + ':' + reason, Date.now()],
                () => resolve()
              );
            });
          } catch (e) {
            logger.warn('refundAccountPayment: gagal catat tx SQLite (non-fatal): ' + (e.message || e));
          }
          return true;
        }
        throw new Error('Web tidak ack credit refund');
      } catch (e) {
        // Refund GAGAL ke web → bahaya, saldo user "hilang". Log error keras
        // supaya admin tahu untuk refund manual via /addsaldo atau curl /credit.
        logger.error(
          'CRITICAL: Refund web gagal untuk user ' + userId + ', amount ' + amount +
          ', refId ' + refId + ': ' + (e.message || e) +
          '. Lakukan refund manual!'
        );
        throw e;
      }
    }

    // Legacy path
    return _refundLocal(userId, amount, trxType, refId, reason);
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
