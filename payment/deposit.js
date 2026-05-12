// payment/deposit.js - QRIS mutasi deposit manager (factory)
// Dependency: db, bot, logger, gopayClient, helper QRIS, dan sejumlah getter config.

function createDepositManager({
  db,
  bot,
  logger,
  gopayClient,
  findMatchingSettlementTransaction,
  parseProviderTransactionTime,
  buildDynamicQrisPayload,
  buildStaticQrisImageUrl,
  getTimeZone,
  getPaymentTimeoutMin,
  getMinMaxTopup,
  getBaseQr,
  getApiKey,
  pollIntervalMs = 10000,
  depositExpireMs = 5 * 60 * 1000,
  requestIntervalMs = 1000,
}) {
  if (!db) throw new Error('createDepositManager: db required');
  if (!bot) throw new Error('createDepositManager: bot required');
  if (!logger) throw new Error('createDepositManager: logger required');
  if (!gopayClient) throw new Error('createDepositManager: gopayClient required');
  if (typeof findMatchingSettlementTransaction !== 'function') {
    throw new Error('createDepositManager: findMatchingSettlementTransaction harus fungsi');
  }
  if (typeof parseProviderTransactionTime !== 'function') {
    throw new Error('createDepositManager: parseProviderTransactionTime harus fungsi');
  }
  if (typeof buildDynamicQrisPayload !== 'function') {
    throw new Error('createDepositManager: buildDynamicQrisPayload harus fungsi');
  }
  if (typeof buildStaticQrisImageUrl !== 'function') {
    throw new Error('createDepositManager: buildStaticQrisImageUrl harus fungsi');
  }
  const tz = typeof getTimeZone === 'function' ? getTimeZone : () => 'Asia/Jakarta';
  const getTimeoutMin = typeof getPaymentTimeoutMin === 'function'
    ? getPaymentTimeoutMin
    : () => 10;
  const getMinMax = typeof getMinMaxTopup === 'function'
    ? getMinMaxTopup
    : () => ({ min: 1000, max: 300000 });
  const getQrBase = typeof getBaseQr === 'function' ? getBaseQr : () => '';
  const getKey = typeof getApiKey === 'function' ? getApiKey : () => '';

  global.pendingDeposits = global.pendingDeposits || {};
  global.depositState = global.depositState || {};

  const POLL_INTERVAL = Number(pollIntervalMs || 10000);
  const DEPOSIT_EXPIRE_MS = Number(depositExpireMs || 5 * 60 * 1000);
  let lastPollTime = 0;
  let lastRequestTime = 0;

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function parseKreditFromResponse(text) {
    const blocks = String(text).split('------------------------').filter(Boolean);
    const kredits = [];
    for (const b of blocks) {
      const m = b.match(/Kredit\s*:\s*([\d.]+)/);
      if (!m) continue;
      const val = parseInt(m[1].replace(/\./g, ''), 10);
      if (!Number.isNaN(val)) kredits.push(val);
    }
    return kredits;
  }

  async function markDepositExpired(uniqueCode) {
    await new Promise((resolve) => {
      db.run(
        'UPDATE pending_deposits SET status=? WHERE unique_code=? AND status=?',
        ['expired', uniqueCode, 'pending'],
        () => resolve()
      );
    });

    const d = global.pendingDeposits[uniqueCode];
    if (d) {
      try {
        const text =
          '⏰ <b>QRIS EXPIRED</b>\n' +
          '━━━━━━━━━━━━━━━━\n' +
          'Pembayaran tidak kami terima dalam batas waktu.\n' +
          'Silakan buat QRIS baru dari menu topup.\n' +
          '━━━━━━━━━━━━━━━━\n' +
          'Ref: <code>' + uniqueCode + '</code>';

        await bot.telegram.sendMessage(d.userId, text, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
            ],
          },
        });
      } catch (_) {}
    }

    delete global.pendingDeposits[uniqueCode];
  }

  async function creditDeposit(uniqueCode, matchedTx = null) {
    const d = global.pendingDeposits[uniqueCode];
    if (!d) return false;

    const now = Date.now();
    const credit = d.originalAmount;
    const providerPayloadJson = matchedTx ? JSON.stringify(matchedTx) : null;
    const providerTxId = matchedTx
      ? (String(matchedTx.id || matchedTx.transaction_id || matchedTx.tx_id || '').trim() || null)
      : null;
    const providerTxTime = matchedTx
      ? (matchedTx.time || matchedTx.created_at || matchedTx.updated_at || matchedTx.transaction_time || null)
      : null;
    const providerIssuer = matchedTx
      ? (String(matchedTx.issuer || '').trim() || null)
      : null;
    const providerPaymentType = matchedTx
      ? (String(matchedTx.payment_type || '').trim() || null)
      : null;
    const providerStatus = matchedTx
      ? (String(matchedTx.status || '').trim() || null)
      : null;

    const applied = await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE TRANSACTION', (beginErr) => {
          if (beginErr) return reject(beginErr);

          db.run(
            'UPDATE pending_deposits SET status=? WHERE unique_code=? AND status=?',
            ['paid', uniqueCode, 'pending'],
            function (err1) {
              if (err1) { db.run('ROLLBACK'); return reject(err1); }
              if ((this.changes || 0) === 0) { db.run('ROLLBACK'); return resolve(false); }

              db.run(
                'UPDATE users SET saldo = saldo + ? WHERE user_id = ?',
                [credit, d.userId],
                function (err2) {
                  if (err2) { db.run('ROLLBACK'); return reject(err2); }
                  if ((this.changes || 0) === 0) {
                    db.run('ROLLBACK');
                    return reject(new Error('User topup manual tidak ditemukan'));
                  }

                  db.run(
                    'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
                    [d.userId, credit, 'qris_auto_topup', uniqueCode, now],
                    (err3) => {
                      if (err3) { db.run('ROLLBACK'); return reject(err3); }

                      if (!providerPayloadJson) {
                        return db.run('COMMIT', (err4) => (err4 ? reject(err4) : resolve(true)));
                      }

                      db.run(
                        'INSERT INTO qris_payments (user_id, invoice_id, amount, base_amount, unique_suffix, status, created_at, paid_at, matched_at, provider_tx_id, provider_tx_time, provider_payment_type, provider_issuer, provider_status, provider_payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                          d.userId,
                          uniqueCode,
                          d.amount,
                          credit,
                          Number(d.amount || 0) - Number(credit || 0),
                          'paid',
                          Number(d.timestamp || now),
                          parseProviderTransactionTime(providerTxTime) || now,
                          now,
                          providerTxId,
                          providerTxTime ? String(providerTxTime) : null,
                          providerPaymentType,
                          providerIssuer,
                          providerStatus,
                          providerPayloadJson,
                        ],
                        (err4) => {
                          if (err4 && !String(err4.message || '').includes('UNIQUE constraint failed: qris_payments.invoice_id')) {
                            db.run('ROLLBACK');
                            return reject(err4);
                          }
                          db.run('COMMIT', (err5) => (err5 ? reject(err5) : resolve(true)));
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      });
    });

    if (!applied) return false;

    try {
      const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
      const waktu = new Date().toLocaleString('id-ID', { timeZone: tz() });

      const text =
        '✅ <b>TOPUP BERHASIL</b>\n' +
        '━━━━━━━━━━━━━━━━\n' +
        '💰 <b>Saldo Masuk</b> : <b>' + rupiah(credit) + '</b>\n' +
        '🧾 <b>Ref</b>        : <code>' + uniqueCode + '</code>\n' +
        '🕒 <b>Waktu</b>      : ' + waktu + '\n' +
        '━━━━━━━━━━━━━━━━\n' +
        'Terima kasih 🙏';

      await bot.telegram.sendMessage(d.userId, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏠 Menu Utama', callback_data: 'send_main_menu' }],
          ],
        },
      });
    } catch (_) {}

    delete global.pendingDeposits[uniqueCode];
    return true;
  }

  async function pollMutasi() {
    global.mutasiBlockedUntil = global.mutasiBlockedUntil || 0;
    if (Date.now() < global.mutasiBlockedUntil) return;

    const now = Date.now();
    if (now - lastPollTime < POLL_INTERVAL) return;
    lastPollTime = now;

    const pendingList = Object.entries(global.pendingDeposits)
      .filter(([_, d]) => d.status === 'pending');

    if (pendingList.length === 0) return;

    try {
      const transactions = await gopayClient.fetchTransactions();

      for (const [uniqueCode, d] of pendingList) {
        const expiresAt = d.expiresAt || (d.timestamp ? (d.timestamp + DEPOSIT_EXPIRE_MS) : 0);
        if (expiresAt && now > expiresAt) {
          await markDepositExpired(uniqueCode);
          continue;
        }

        const matched = findMatchingSettlementTransaction(transactions, d.amount, {
          createdAt: d.timestamp,
          timeWindowMs: DEPOSIT_EXPIRE_MS,
        });
        if (matched) {
          await creditDeposit(uniqueCode, matched);
        }
      }
    } catch (e) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.message || e?.message || e;
      logger.error('❌ Poll mutasi GoPay error (' + (status || 'no-status') + '): ' + msg);
    }
  }

  function startAutoTopupMutasi() {
    const IS_PRIMARY_INSTANCE = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    if (!IS_PRIMARY_INSTANCE) {
      logger.info('ℹ️ Auto-topup mutasi nonaktif di instance non-primary (PM2 cluster).');
      return;
    }
    setInterval(() => pollMutasi(), 2000);
    logger.info('✅ Auto-topup QRIS (mutasi) aktif.');
  }

  async function checkQRISStatus() {
    try {
      const entries = Object.entries(global.pendingDeposits || {}).filter(
        ([, d]) => d.status === 'pending'
      );
      if (entries.length === 0) return;

      const timeoutMin = Number(getTimeoutMin() || 10);
      const transactions = await gopayClient.fetchTransactions();

      for (const [uniqueCode, deposit] of entries) {
        const expiredAt = deposit.expiresAt || (deposit.timestamp + (timeoutMin * 60 * 1000));
        if (Date.now() > expiredAt) {
          try {
            if (deposit.qrMessageId) {
              await bot.telegram.deleteMessage(deposit.userId, deposit.qrMessageId);
            }
          } catch (_) {}
          await markDepositExpired(uniqueCode);
          continue;
        }

        const matched = findMatchingSettlementTransaction(transactions, deposit.amount, {
          createdAt: Number(deposit.timestamp || 0),
        });
        if (matched) {
          await creditDeposit(uniqueCode);
          logger.info('✅ QRIS paid: ' + uniqueCode + ' amount=' + deposit.amount);
        }
      }
    } catch (error) {
      logger.error('Error in checkQRISStatus: ' + (error?.message || error));
    }
  }

  async function findAvailableTopupAmount(baseAmount, minSuffix, maxSuffix, maxAttempts) {
    const min = Number.isFinite(Number(minSuffix)) ? Number(minSuffix) : 1;
    const max = Number.isFinite(Number(maxSuffix)) ? Number(maxSuffix) : 300;
    const attempts = Number(maxAttempts) > 0 ? Number(maxAttempts) : 10;
    const tried = new Set();
    for (let i = 0; i < attempts; i++) {
      const suffix = randomInt(min, max);
      if (tried.has(suffix)) continue;
      tried.add(suffix);
      const candidate = Number(baseAmount) + suffix;
      const clash = await new Promise((resolve) => {
        db.get(
          'SELECT 1 FROM pending_deposits WHERE amount = ? AND status = ? LIMIT 1',
          [candidate, 'pending'],
          (err, row) => {
            if (err) {
              logger.warn('findAvailableTopupAmount db error: ' + err.message);
              return resolve(false);
            }
            resolve(!!row);
          }
        );
      });
      if (!clash) return { amount: candidate, uniqueSuffix: suffix };
    }
    const lastSuffix = randomInt(min, max);
    return { amount: Number(baseAmount) + lastSuffix, uniqueSuffix: lastSuffix };
  }

  async function processDeposit(ctx, amount) {
    const currentTime = Date.now();

    if (currentTime - lastRequestTime < requestIntervalMs) {
      await ctx.editMessageText(
        '⚠️ *Terlalu banyak permintaan. Silakan tunggu sebentar sebelum mencoba lagi.*',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    lastRequestTime = currentTime;

    const userId = ctx.from.id;

    const amountNum = Number(amount || 0);
    const { min, max } = getMinMax();
    if (!Number.isFinite(amountNum) || amountNum < min || amountNum > max) {
      await ctx.editMessageText(
        '❌ *Nominal tidak valid!*\n\nMinimal: *Rp ' + min.toLocaleString('id-ID') + '*\nMaksimal: *Rp ' + max.toLocaleString('id-ID') + '*',
        { parse_mode: 'Markdown' }
      );
      delete global.depositState[userId];
      return;
    }

    const apiKey = getKey();
    if (!apiKey || apiKey === 'NONE') {
      await ctx.editMessageText(
        '❌ *API_KEY belum diisi.*\n\nIsi `API_KEY` di `.vars.json` dengan apikey dari rajaserverpremium.',
        { parse_mode: 'Markdown' }
      );
      delete global.depositState[userId];
      return;
    }

    const baseQr = getQrBase();
    if (!baseQr || baseQr.length < 10) {
      await ctx.editMessageText(
        '❌ *QR String belum benar.*\n\nCek `GOPAY_BASE_QR` / `DATA_QRIS` di `.vars.json` (`ORDERKUOTA_BASE_QR` masih didukung sebagai fallback).',
        { parse_mode: 'Markdown' }
      );
      delete global.depositState[userId];
      return;
    }

    const { amount: finalAmount, uniqueSuffix } = await findAvailableTopupAmount(amountNum, 1, 300, 10);
    const adminFee = uniqueSuffix;

    const ts = Date.now();
    const uniqueCode = 'TOPUP-' + userId + '-' + ts;
    const referenceId = 'REF-' + ts + '-' + randomInt(1000, 9999);

    try {
      const dynamicQrText = buildDynamicQrisPayload(baseQr, finalAmount);
      const qrImageUrl = buildStaticQrisImageUrl(dynamicQrText);
      if (!qrImageUrl) {
        throw new Error('QR URL tidak valid dari QRIS dinamis');
      }

      const timeoutMin = Number(getTimeoutMin() || 10);
      const caption =
        '💳 *INSTRUKSI PEMBAYARAN*\n\n' +
        '💰 *TOP-UP:* Rp ' + amountNum.toLocaleString('id-ID') + '\n' +
        '🎲 *ADMIN FEE:* Rp ' + adminFee.toLocaleString('id-ID') + '\n' +
        '💵 *TOTAL BAYAR:* Rp ' + finalAmount.toLocaleString('id-ID') + '\n\n' +
        '📌 *CARA BAYAR:*\n' +
        '1) Scan QR di atas\n' +
        '2) Nominal akan terisi otomatis\n' +
        '3) Pastikan bayar *tepat* Rp ' + finalAmount.toLocaleString('id-ID') + '\n\n' +
        '⏳ QR berlaku *' + timeoutMin + ' menit*\n' +
        '🆔 Ref: `' + referenceId + '`';

      const qrMessage = await ctx.replyWithPhoto(
        { url: qrImageUrl },
        { caption, parse_mode: 'Markdown' }
      );

      try { await ctx.deleteMessage(); } catch (_) {}

      global.pendingDeposits[uniqueCode] = {
        amount: finalAmount,
        originalAmount: amountNum,
        adminFee,
        userId,
        timestamp: Date.now(),
        status: 'pending',
        qrMessageId: qrMessage.message_id,
        referenceId,
        expiresAt: Date.now() + (timeoutMin * 60 * 1000),
        qrisText: dynamicQrText,
      };

      db.run(
        'INSERT INTO pending_deposits (unique_code, user_id, amount, original_amount, timestamp, status, qr_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uniqueCode, userId, finalAmount, amountNum, Date.now(), 'pending', qrMessage.message_id],
        (err) => {
          if (err) logger.error('❌ Gagal insert pending_deposits: ' + err.message);
        }
      );

      delete global.depositState[userId];
      logger.info('✅ QR dynamic sent: user=' + userId + ' amount=' + finalAmount + ' ref=' + referenceId);
    } catch (error) {
      logger.error('❌ Deposit error: ' + (error?.message || error));
      try {
        await ctx.editMessageText(
          '❌ *GAGAL MEMBUAT PEMBAYARAN*\n\nSilakan coba lagi.',
          { parse_mode: 'Markdown' }
        );
      } catch (_) {}
      delete global.depositState[userId];
    }
  }

  return {
    markDepositExpired,
    creditDeposit,
    pollMutasi,
    startAutoTopupMutasi,
    checkQRISStatus,
    findAvailableTopupAmount,
    processDeposit,
    parseKreditFromResponse,
  };
}

module.exports = { createDepositManager };
