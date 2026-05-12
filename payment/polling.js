// payment/polling.js - scheduler polling QRIS pending (factory)
// Dependency: db, bot, logger, checkQrisInvoiceStatus, finalizeQrisPayment,
// calculateTopupBonus, applyQrisTopupBonus, notifyTopupSuccess.

function createQrisPaymentPoller({
  db,
  bot,
  logger,
  checkQrisInvoiceStatus,
  finalizeQrisPayment,
  calculateTopupBonus,
  applyQrisTopupBonus,
  notifyTopupSuccess,
  intervalMs = 15000,
  paymentTimeoutMin = 10,
}) {
  if (!db) throw new Error('createQrisPaymentPoller: db required');
  if (!bot) throw new Error('createQrisPaymentPoller: bot required');
  if (!logger) throw new Error('createQrisPaymentPoller: logger required');
  if (typeof checkQrisInvoiceStatus !== 'function') {
    throw new Error('createQrisPaymentPoller: checkQrisInvoiceStatus harus fungsi');
  }
  if (typeof finalizeQrisPayment !== 'function') {
    throw new Error('createQrisPaymentPoller: finalizeQrisPayment harus fungsi');
  }
  if (typeof calculateTopupBonus !== 'function') {
    throw new Error('createQrisPaymentPoller: calculateTopupBonus harus fungsi');
  }
  if (typeof applyQrisTopupBonus !== 'function') {
    throw new Error('createQrisPaymentPoller: applyQrisTopupBonus harus fungsi');
  }
  if (typeof notifyTopupSuccess !== 'function') {
    throw new Error('createQrisPaymentPoller: notifyTopupSuccess harus fungsi');
  }

  const qrisPollIntervalMs = Number(intervalMs || 15000);

  async function getPendingQrisCount() {
    return await new Promise((resolve) => {
      db.get("SELECT COUNT(*) AS cnt FROM qris_payments WHERE status='pending'", [], (err, row) => {
        if (err) return resolve(-1);
        resolve(Number(row?.cnt || 0));
      });
    });
  }

  async function markQrisStatus(id, status, paidAt = null) {
    return await new Promise((resolve) => {
      if (paidAt) {
        db.run('UPDATE qris_payments SET status=?, paid_at=? WHERE id=?', [status, paidAt, id], () => resolve());
      } else {
        db.run('UPDATE qris_payments SET status=? WHERE id=?', [status, id], () => resolve());
      }
    });
  }

  async function sendQrisExpiredNotice(userId, invoiceId) {
    try {
      await bot.telegram.sendMessage(
        userId,
        '⏰ <b>QRIS EXPIRED</b>\n' +
          '━━━━━━━━━━━━━━━━\n' +
          'QR sudah tidak berlaku (melewati batas waktu).\n' +
          'Silakan buat QRIS baru untuk topup.\n' +
          '━━━━━━━━━━━━━━━━\n' +
          'Invoice: <code>' + invoiceId + '</code>',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Buat QRIS Baru', callback_data: 'topupqris_btn' }],
              [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
            ],
          },
        }
      );
    } catch (_) {}
  }

  async function pollOnce() {
    const pollStartedAt = Number(global.__pollQrisStartedAt || 0);
    if (global.__pollQrisRunning) {
      if (pollStartedAt && Date.now() - pollStartedAt > 90 * 1000) {
        logger.warn('Polling QRIS sebelumnya stuck >90s, reset flag dan mulai ulang.');
        global.__pollQrisRunning = false;
      } else {
        return;
      }
    }
    global.__pollQrisRunning = true;
    global.__pollQrisStartedAt = Date.now();
    try {
      const now = Date.now();
      const timeoutMin = Number(paymentTimeoutMin || 10);
      const rows = await new Promise((resolve, reject) => {
        const cutoff = now - ((timeoutMin + 15) * 60 * 1000);
        db.all(
          "SELECT id, user_id, invoice_id, amount, base_amount, unique_suffix, created_at FROM qris_payments WHERE status='pending' AND created_at >= ? ORDER BY created_at ASC LIMIT 50",
          [cutoff],
          (err, rowsRes) => (err ? reject(err) : resolve(rowsRes || []))
        );
      });

      if (!rows.length) return;

      logger.info('🔎 Poll QRIS GoPay: cek ' + rows.length + ' transaksi pending...');

      for (const row of rows) {
        const expiresAt = Number(row.created_at) + (timeoutMin * 60 * 1000);
        if (now > expiresAt) {
          await markQrisStatus(row.id, 'expired');
          await sendQrisExpiredNotice(row.user_id, row.invoice_id);
          logger.info('⌛ QRIS expired: invoice=' + row.invoice_id + ' user=' + row.user_id);
          continue;
        }

        const checkRes = await checkQrisInvoiceStatus(row.invoice_id, Number(row.amount), row.created_at);
        if (checkRes.status === 'EXPIRED') {
          await markQrisStatus(row.id, 'expired');
          await sendQrisExpiredNotice(row.user_id, row.invoice_id);
          logger.info('⌛ QRIS expired: invoice=' + row.invoice_id + ' user=' + row.user_id);
          continue;
        }
        if (checkRes.status === 'CANCELED') {
          await markQrisStatus(row.id, 'canceled');
          logger.info('🚫 QRIS canceled: invoice=' + row.invoice_id + ' user=' + row.user_id);
          continue;
        }
        if (checkRes.status !== 'PAID' || !checkRes.transaction) continue;

        const finalRes = await finalizeQrisPayment({
          paymentRow: row,
          matchedTx: checkRes.transaction,
          transactionType: 'qris_auto_topup',
          transactionRef: 'qris_auto_' + row.invoice_id,
        });
        if (!finalRes.applied) continue;

        const addSaldo = Number(row.base_amount);
        try {
          const { bonus, percent } = calculateTopupBonus(addSaldo);
          if (bonus > 0) {
            try {
              await applyQrisTopupBonus(row.user_id, row.invoice_id, bonus);
            } catch (e) {
              logger.error('⚠️ Gagal mencatat bonus QRIS: ' + (e?.message || e));
            }
            await notifyTopupSuccess({
              bot,
              db,
              userId: row.user_id,
              baseAmount: addSaldo,
              bonusAmount: bonus,
              percent,
              ref: row.invoice_id,
              method: 'QRIS GoPay',
            });
          } else {
            await notifyTopupSuccess({
              bot,
              db,
              userId: row.user_id,
              baseAmount: addSaldo,
              bonusAmount: 0,
              percent: 0,
              ref: row.invoice_id,
              method: 'QRIS GoPay',
            });
          }
        } catch (e) {
          logger.error('⚠️ Gagal kirim notif topup sukses: ' + (e?.message || e));
        }

        logger.info('✅ QRIS PAID: invoice=' + row.invoice_id + ' user=' + row.user_id + ' billed=' + row.amount + ' add=' + addSaldo + ' tx=' + (finalRes.providerTxId || '-'));
      }
    } catch (e) {
      logger.error('❌ pollQrisPayments fatal: ' + (e?.message || e));
    } finally {
      global.__pollQrisRunning = false;
      global.__pollQrisStartedAt = 0;
    }
  }

  function start() {
    const IS_PRIMARY_INSTANCE = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    if (!IS_PRIMARY_INSTANCE) {
      logger.info('ℹ️ QRIS polling nonaktif di instance non-primary (PM2 cluster).');
      return;
    }
    if (global.__qrisPollStarted) {
      logger.info('ℹ️ QRIS polling sudah aktif. Interval=' + qrisPollIntervalMs + 'ms');
      return;
    }

    global.__qrisPollStarted = true;
    global.__qrisPollInterval = setInterval(pollOnce, qrisPollIntervalMs);
    setTimeout(() => { pollOnce().catch(() => {}); }, 2000);
    getPendingQrisCount()
      .then((pendingCount) => {
        if (pendingCount >= 0) {
          logger.info('✅ QRIS polling aktif. Interval=' + qrisPollIntervalMs + 'ms, pending=' + pendingCount + ', source=startup');
        } else {
          logger.info('✅ QRIS polling aktif. Interval=' + qrisPollIntervalMs + 'ms, source=startup');
        }
      })
      .catch(() => {
        logger.info('✅ QRIS polling aktif. Interval=' + qrisPollIntervalMs + 'ms, source=startup');
      });
  }

  return { start, pollOnce, getPendingQrisCount, markQrisStatus };
}

module.exports = { createQrisPaymentPoller };
