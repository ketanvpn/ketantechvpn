// payment/gopay.js - client QRIS via KetantechPay gateway (drop-in untuk bot VPN)
// Compatible dengan payment/qris-invoice.js yang expect shape AutoGoPay-like.
const axios = require('axios');

const DEFAULT_GATEWAY_BASE_URL = 'https://pay.ketantech.my.id';
const SUCCESS_STATUSES = new Set(['success', 'settlement', 'capture', 'paid']);
const EXPIRED_STATUSES = new Set(['expired', 'expire']);
const CANCELED_STATUSES = new Set(['canceled', 'cancel', 'failed', 'deny']);

function normalizeBaseUrl(baseUrl) {
  const url = String(baseUrl || DEFAULT_GATEWAY_BASE_URL).trim() || DEFAULT_GATEWAY_BASE_URL;
  return url.replace(/\/+$/, '');
}

function getGatewayApiKey(getApiKey) {
  // PAYMENT_GATEWAY_API_KEY adalah nama baru yang jelas.
  // Fallback ke getApiKey()/GOPAY_API_KEY supaya deployment lama tetap boot.
  return String(process.env.PAYMENT_GATEWAY_API_KEY || (typeof getApiKey === 'function' ? getApiKey() : '') || '').trim();
}

function mapGatewayStatusToProviderStatus(status) {
  const s = String(status || '').toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return 'settlement';
  if (EXPIRED_STATUSES.has(s)) return 'expire';
  if (CANCELED_STATUSES.has(s)) return 'cancel';
  return 'pending';
}

function createGopayClient({ getApiKey, baseUrl, timeoutMs = 15000 }) {
  if (typeof getApiKey !== 'function') {
    throw new Error('createGopayClient: getApiKey harus fungsi');
  }

  const gatewayBaseUrl = normalizeBaseUrl(baseUrl || process.env.PAYMENT_GATEWAY_BASE_URL || process.env.GOPAY_API_BASE_URL);

  function buildHeaders(extra = {}) {
    const apiKey = getGatewayApiKey(getApiKey);
    if (!apiKey) throw new Error('PAYMENT_GATEWAY_API_KEY belum diisi di .env');

    return {
      'Content-Type': 'application/json',
      // KetantechPay memakai X-Client-Key untuk endpoint /api/v1/payments/*.
      // x-api-key tetap dikirim sebagai compatibility kalau gateway lama pernah pakai itu.
      'X-Client-Key': apiKey,
      'x-api-key': apiKey,
      ...extra,
    };
  }

  async function generateQris(amount) {
    const nominal = Number(amount || 0);
    if (!Number.isFinite(nominal) || nominal <= 0) {
      throw new Error('Nominal QRIS tidak valid');
    }

    const orderId = `VPN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const idempotencyKey = `bot-vpn-${orderId}`;

    const payload = {
      orderId,
      amount: Math.round(nominal),
      currency: 'IDR',
      method: 'qris',
      customer: {
        name: 'VPN Customer',
        email: 'customer@ketantech.my.id',
      },
      description: `Top up saldo VPN - Rp ${Math.round(nominal).toLocaleString('id-ID')}`,
    };

    const res = await axios.post(`${gatewayBaseUrl}/api/v1/payments/charge`, payload, {
      headers: buildHeaders({ 'Idempotency-Key': idempotencyKey }),
      timeout: timeoutMs,
    });

    const data = res.data?.data;
    if (!data?.id || !data?.orderId) {
      throw new Error(res.data?.message || 'Response payment gateway tidak valid');
    }

    const raw = data.rawResponse || {};
    const full = raw.full || raw;

    // Return object langsung, bukan {success,data}, supaya kompatibel dengan qris-invoice.js.
    return {
      transaction_id: data.id,
      provider_transaction_id: data.providerTransactionId,
      order_id: data.orderId,
      amount: Number(data.amount || nominal),
      transaction_status: mapGatewayStatusToProviderStatus(data.status),
      gateway_status: data.status,
      provider: data.providerName,
      qr_string: raw.qr_string || full.qr_string || '',
      qr_url: data.paymentUrl || raw.qr_url || full.qr_url || '',
      transaction_time: data.createdAt || raw.transaction_time || full.transaction_time || null,
      expiry_time: raw.expiry_time || full.expiry_time || null,
      raw_gateway_response: data,
    };
  }

  async function fetchQrisStatus(transactionId) {
    const id = String(transactionId || '').trim();
    if (!id) throw new Error('transaction_id kosong');

    const res = await axios.get(`${gatewayBaseUrl}/api/v1/payments/${encodeURIComponent(id)}`, {
      headers: buildHeaders(),
      timeout: timeoutMs,
    });

    const data = res.data?.data;
    if (!data?.id) {
      throw new Error(res.data?.message || 'Response payment gateway tidak valid');
    }

    const providerStatus = mapGatewayStatusToProviderStatus(data.status);
    const paid = providerStatus === 'settlement';

    return {
      // qris-invoice.js lama menganggap success=true sebagai PAID, jadi hanya true kalau benar-benar paid.
      success: paid,
      data: {
        transaction_id: data.id,
        provider_transaction_id: data.providerTransactionId,
        order_id: data.orderId,
        transaction_time: data.updatedAt,
        transaction_status: providerStatus,
        gateway_status: data.status,
        payment_type: 'qris',
        issuer: data.providerName || 'ketantechpay',
        amount: data.amount,
        raw_gateway_response: data,
      },
    };
  }

  async function fetchTransactions() {
    // Mutasi list tidak dipakai untuk flow invoice gateway. Polling status dilakukan per transaction id.
    return [];
  }

  return { fetchTransactions, generateQris, fetchQrisStatus };
}

module.exports = { createGopayClient };
