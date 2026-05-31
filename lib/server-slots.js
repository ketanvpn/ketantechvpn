'use strict';

function createServerSlotManager({ db, logger = console } = {}) {
  if (!db) throw new Error('createServerSlotManager: db required');

  async function reserveCreateSlot(action, serverId) {
    if (action !== 'create') return true;
    return new Promise((resolve) => {
      db.run(
        'UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ? AND total_create_akun < batas_create_akun',
        [serverId],
        function (err) {
          if (err) {
            logger.error?.('⚠️ Gagal reservasi slot create server:', err.message || err);
            return resolve(false);
          }
          resolve((this.changes || 0) > 0);
        }
      );
    });
  }

  async function releaseCreateSlot(action, serverId, slotReserved) {
    if (action !== 'create' || !slotReserved) return false;
    await new Promise((resolve) => {
      db.run(
        'UPDATE Server SET total_create_akun = CASE WHEN total_create_akun > 0 THEN total_create_akun - 1 ELSE 0 END WHERE id = ?',
        [serverId],
        () => resolve()
      );
    });
    return false;
  }

  return { reserveCreateSlot, releaseCreateSlot };
}

module.exports = { createServerSlotManager };
