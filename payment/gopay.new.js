// payment/gopay.js - UPDATE untuk payment gateway KetantechPay
// Version: 2.0 - Integrasi dengan https://pay.ketantech.my.id

const axios = require('axios');

function createGopayClient({ getApiKey, baseUrl, timeoutMs = 15000 }) {
  if (typeof getApiKey !== 'function') {
    throw new Error('createGopayClient: getApiKey harus fungsi');
  }
  
  // Default ke payment gateway kita
  if (!baseUrl || typeof baseUrl !== 'string') {
    baseUrl = 'https://pay.ketantech.my.id';
  }

  // API key payment gateway (bukan AutoGopay API key)
  const gatewayApiKey = process.env.PAYMENT_GATEWAY_API_KEY || '';

  function buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': gatewayApiKey,
    };
  }

  /**
   * Generate QRIS via payment gateway
   * Gateway akan otomatis pilih provider terbaik (AutoGopay/Midtrans/dll)
   */
  async function generateQris(amount) {
    if (!gatewayApiKey) {
      throw new Error('PAYMENT_GATEWAY_API_KEY belum diisi di .env');
    }

    const nominal = Number(amount || 0);
    if (!Number.isFinite(nominal) || nominal <= 0) {
      throw new Error('Nominal QRIS tidak valid');
    }

    // Generate unique order ID
    const orderId = `vpn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Idempotency key untuk prevent double charge
    const idempotencyKey = `bot-vpn-${orderId}`;

    const payload = {
      orderId: orderId,
      amount: nominal,
      currency: 'IDR',
      method: 'qris',
      customer: {
        name: 'VPN Customer',
        email: 'customer@ketantech.my.id'
      },
      description: `Top up saldo VPN - Rp ${nominal.toLocaleString('id-ID')}`
    };

    const res = await axios.post(
      `${baseUrl}/api/v1/payments/charge`,
      payload,
      { 
        headers: {
          ...buildHeaders(),
          'Idempotency-Key': idempotencyKey
        },
        timeout: timeoutMs 
      }
    );

    // Response dari payment gateway
    const data = res.data?.data;
    if (!data) {
      throw new Error('Response payment gateway tidak valid');
    }

    // Normalize response supaya compatible dengan code bot yang ada
    return {
      success: true,
      data: {
        transaction_id: data.id, // ID transaksi di gateway
        order_id: data.orderId,
        qris_string: data.rawResponse?.qris_string || '', // QRIS string kalau ada
        qris_url: data.paymentUrl || '', // URL payment page
        amount: data.amount,
        status: data.status, // pending/success/failed
        provider: data.providerName, // provider yang dipakai (autogopay/midtrans/dll)
        created_at: data.createdAt
      }
    };
  }

  /**
   * Cek status transaksi QRIS
   * @param {string} transactionId - ID transaksi dari payment gateway
   */
  async function fetchQrisStatus(transactionId) {
    if (!gatewayApiKey) {
      throw new Error('PAYMENT_GATEWAY_API_KEY belum diisi di .env');
    }

    if (!transactionId) {
      throw new Error('Transaction ID tidak boleh kosong');
    }

    const res = await axios.get(
      `${baseUrl}/api/v1/payments/${transactionId}`,
      { 
        headers: buildHeaders(),
        timeout: timeoutMs 
      }
    );

    const data = res.data?.data;
    if (!data) {
      throw new Error('Response payment gateway tidak valid');
    }

    // Normalize response
    return {
      success: true,
      data: {
        transaction_id: data.id,
        order_id: data.orderId,
        transaction_status: data.status, // pending/success/failed/expired
        transaction_time: data.updatedAt,
        payment_type: 'qris',
        issuer: data.providerName,
        amount: data.amount
      }
    };
  }

  /**
   * Fetch semua transaksi (untuk polling mutasi)
   * NOTE: Payment gateway kita tidak punya endpoint list transactions untuk client API
   * Jadi kita skip fungsi ini, pakai webhook untuk update status
   */
  async function fetchTransactions() {
    // Tidak dipakai lagi karena payment gateway pakai webhook
    // Kalau perlu, bisa hit endpoint admin (tapi butuh ADMIN_API_KEY)
    return [];
  }

  return {
    generateQris,
    fetchQrisStatus,
    fetchTransactions,
  };
}

module.exports = { createGopayClient };
