// payment/gopay.js - klien GoPay QRIS (factory pattern)
// Dependency: axios + getGopayApiKey() + GOPAY_API_BASE_URL
const axios = require('axios');

function createGopayClient({ getApiKey, baseUrl, timeoutMs = 15000 }) {
  if (typeof getApiKey !== 'function') {
    throw new Error('createGopayClient: getApiKey harus fungsi');
  }
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('createGopayClient: baseUrl kosong');
  }

  function buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  async function fetchTransactions() {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('GOPAY_API_KEY belum diisi');

    const res = await axios.post(
      `${baseUrl}/transactions`,
      {},
      { headers: buildHeaders(apiKey), timeout: timeoutMs }
    );

    if (!res.data?.success) {
      throw new Error(res.data?.message || 'Gagal mengambil transaksi GoPay');
    }
    return Array.isArray(res.data?.data?.transactions) ? res.data.data.transactions : [];
  }

  async function generateQris(amount) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('GOPAY_API_KEY belum diisi');

    const nominal = Number(amount || 0);
    if (!Number.isFinite(nominal) || nominal <= 0) {
      throw new Error('Nominal QRIS tidak valid');
    }

    const res = await axios.post(
      `${baseUrl}/qris/generate`,
      { amount: nominal },
      { headers: buildHeaders(apiKey), timeout: timeoutMs }
    );

    if (!res.data?.success || !res.data?.data?.transaction_id) {
      throw new Error(res.data?.message || 'Gagal membuat QRIS GoPay');
    }
    return res.data.data;
  }

  async function fetchQrisStatus(transactionId) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('GOPAY_API_KEY belum diisi');

    const txid = String(transactionId || '').trim();
    if (!txid) throw new Error('transaction_id kosong');

    const res = await axios.post(
      `${baseUrl}/qris/status`,
      { transaction_id: txid },
      { headers: buildHeaders(apiKey), timeout: timeoutMs }
    );

    if (!res.data?.data) {
      throw new Error(res.data?.message || 'Gagal mengecek status QRIS');
    }
    return res.data;
  }

  return { fetchTransactions, generateQris, fetchQrisStatus };
}

module.exports = { createGopayClient };
