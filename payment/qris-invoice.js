// payment/qris-invoice.js - cek status invoice QRIS + pembuatan invoice (factory).

function createQrisInvoiceChecker({
  db,
  gopayClient,
  paymentTimeoutMin = 10,
  gracePeriodMs = 2 * 60 * 1000,
  getApiKey,
  generateUniqueSuffix,
  parseProviderTransactionTime,
  getMaxTopup,
}) {
  if (!db) throw new Error('createQrisInvoiceChecker: db required');
  if (!gopayClient) throw new Error('createQrisInvoiceChecker: gopayClient required');

  async function checkQrisInvoiceStatus(invoiceId, billedAmount, createdAt) {
    const inv = String(invoiceId || '').trim();
    if (!inv) return { status: 'PENDING', paid_at: null, transaction: null };

    const paymentRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM qris_payments WHERE invoice_id = ? LIMIT 1`,
        [inv],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });
    if (!paymentRow) throw new Error('Invoice QRIS tidak ditemukan di database');

    const providerTransactionId = String(paymentRow.provider_tx_id || '').trim();
    const timeoutMin = Number(paymentTimeoutMin || 10);
    const expiresAt = Number(paymentRow.created_at || createdAt || 0) + timeoutMin * 60 * 1000;

    if (!providerTransactionId) {
      if ((paymentRow.created_at || createdAt) && Date.now() > expiresAt + gracePeriodMs) {
        return { status: 'EXPIRED', paid_at: null, transaction: null };
      }
      return { status: 'PENDING', paid_at: null, transaction: null };
    }

    const statusRes = await gopayClient.fetchQrisStatus(providerTransactionId);
    const data = statusRes.data || {};
    const providerStatus = String(data.transaction_status || '').toLowerCase();
    const normalizedTx = {
      transaction_id: data.transaction_id || providerTransactionId,
      transaction_time: data.transaction_time || null,
      transaction_status: data.transaction_status || providerStatus || null,
      payment_type: 'qris',
      issuer: 'gopay',
    };

    if (providerStatus === 'settlement' || statusRes.success === true) {
      return {
        status: 'PAID',
        paid_at: data.transaction_time || Date.now(),
        transaction: normalizedTx,
      };
    }

    if (providerStatus === 'expire') {
      return { status: 'EXPIRED', paid_at: null, transaction: normalizedTx };
    }
    if (providerStatus === 'cancel') {
      return { status: 'CANCELED', paid_at: null, transaction: normalizedTx };
    }

    if ((paymentRow.created_at || createdAt) && Date.now() > expiresAt + gracePeriodMs) {
      return { status: 'EXPIRED', paid_at: null, transaction: normalizedTx };
    }

    return { status: 'PENDING', paid_at: null, transaction: normalizedTx };
  }

  async function createQrisInvoice(baseAmount, noteOrReference, forcedUniqueSuffix = null) {
    if (typeof getApiKey !== 'function') {
      throw new Error('createQrisInvoiceChecker: getApiKey required untuk createQrisInvoice');
    }
    if (typeof generateUniqueSuffix !== 'function') {
      throw new Error('createQrisInvoiceChecker: generateUniqueSuffix required untuk createQrisInvoice');
    }
    if (typeof parseProviderTransactionTime !== 'function') {
      throw new Error('createQrisInvoiceChecker: parseProviderTransactionTime required untuk createQrisInvoice');
    }

    const base_amount = Number(baseAmount);
    if (!Number.isFinite(base_amount) || base_amount <= 0) {
      throw new Error('Nominal baseAmount tidak valid');
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('GOPAY_API_KEY belum diisi di .vars.json');
    }

    let unique_suffix = Number.isFinite(Number(forcedUniqueSuffix))
      ? Number(forcedUniqueSuffix)
      : generateUniqueSuffix(50, 200);
    let amount = base_amount + unique_suffix;

    const max = typeof getMaxTopup === 'function' ? Number(getMaxTopup()) : NaN;
    if (Number.isFinite(max) && amount > max) {
      const diff = max - base_amount;
      if (diff >= 50) {
        unique_suffix = Math.min(diff, 200);
        amount = base_amount + unique_suffix;
      } else {
        unique_suffix = 0;
        amount = base_amount;
      }
    }

    const generated = await gopayClient.generateQris(amount);
    const invoice_id = String(generated.order_id || 'GOPAY-' + Date.now());
    const qris_image_url = String(generated.qr_url || '').trim() || null;
    const qris_text = String(generated.qr_string || '').trim() || null;

    return {
      invoice_id,
      amount,
      base_amount,
      unique_suffix,
      qris_image_url,
      qris_image_path: null,
      payment_link: null,
      qris_text,
      expired: parseProviderTransactionTime(generated.expiry_time)
        || (Date.now() + Number(paymentTimeoutMin || 10) * 60 * 1000),
      provider_transaction_id: generated.transaction_id || null,
      provider_transaction_time: generated.transaction_time || null,
      provider_status: generated.transaction_status || 'pending',
      provider_payment_type: 'qris',
      provider_issuer: 'gopay',
      raw: {
        provider: 'gopay_sawargipay',
        note: String(noteOrReference || ''),
        response: generated,
      },
    };
  }

  return { checkQrisInvoiceStatus, createQrisInvoice };
}

module.exports = { createQrisInvoiceChecker };
