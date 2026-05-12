// payment/qris-invoice.js - cek status invoice QRIS (factory)

function createQrisInvoiceChecker({ db, gopayClient, paymentTimeoutMin = 10, gracePeriodMs = 2 * 60 * 1000 }) {
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

  return { checkQrisInvoiceStatus };
}

module.exports = { createQrisInvoiceChecker };
