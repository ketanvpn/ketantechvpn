// modules/edukasi-client.js
// Wrapper HTTP untuk vpnbiz.id Reseller API.
// Base URL & header sesuai dokumentasi reseller. API key di-resolve via getApiKey()
// supaya bisa di-rotate tanpa restart bot (mirip pola gopay client).
//
// Pakai http-client (axios + retry) yang sudah ada untuk transient error.

const { httpGet, httpPost } = require('./http-client');

const DEFAULT_BASE_URL = 'https://vpnbiz.id/api/reseller';

function buildHeaders(apiKey) {
  return {
    Authorization: 'Bearer ' + apiKey,
    'X-API-Key': apiKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

class EdukasiApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'EdukasiApiError';
    this.code = options.code || 'edukasi_api_error';
    this.httpStatus = options.httpStatus || null;
    this.providerMessage = options.providerMessage || message;
    this.payload = options.payload || null;
  }
}

function extractMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  if (payload.message) return String(payload.message);
  if (payload.error) return String(payload.error);
  return fallback;
}

function classifyMessage(msg) {
  if (!msg) return 'edukasi_api_error';
  const m = String(msg).toLowerCase();
  if (m.includes('saldo tidak cukup') || m.includes('saldo kurang')) {
    return 'insufficient_balance';
  }
  if (m.includes('api key tidak valid') || m.includes('tidak diizinkan')) {
    return 'invalid_api_key';
  }
  if (m.includes('paket complete')) {
    return 'invalid_billing_period';
  }
  if (m.includes('trial')) {
    return 'trial_not_allowed';
  }
  return 'edukasi_api_error';
}

function createEdukasiClient({ getApiKey, baseUrl, logger }) {
  if (typeof getApiKey !== 'function') {
    throw new Error('createEdukasiClient: getApiKey harus fungsi');
  }
  const log = logger || console;
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');

  function ensureKey() {
    const key = String(getApiKey() || '').trim();
    if (!key) {
      throw new EdukasiApiError(
        'API key vpnbiz belum di-set. Atur via /setvpnbizapikey.',
        { code: 'missing_api_key' }
      );
    }
    return key;
  }

  function unwrapResponse(resp, defaultMessage) {
    const body = resp && resp.data ? resp.data : null;
    if (!body) {
      throw new EdukasiApiError('Response kosong dari vpnbiz', {
        code: 'empty_response',
        httpStatus: resp ? resp.status : null,
      });
    }
    if (body.success === false) {
      const msg = extractMessage(body, defaultMessage);
      throw new EdukasiApiError(msg, {
        code: classifyMessage(msg),
        httpStatus: resp.status || null,
        providerMessage: msg,
        payload: body,
      });
    }
    return body.data || body;
  }

  function handleAxiosError(err, defaultMessage) {
    if (err && err.name === 'EdukasiApiError') return err;
    const status = err && err.response ? err.response.status : null;
    const payload = err && err.response ? err.response.data : null;
    const msg = extractMessage(payload, err && err.message ? err.message : defaultMessage);
    return new EdukasiApiError(msg, {
      code: classifyMessage(msg),
      httpStatus: status,
      providerMessage: msg,
      payload,
    });
  }

  async function getProfile() {
    const key = ensureKey();
    try {
      const resp = await httpGet(base + '/profile', { headers: buildHeaders(key), timeout: 15000 });
      return unwrapResponse(resp, 'Gagal ambil profile vpnbiz');
    } catch (err) {
      throw handleAxiosError(err, 'Gagal ambil profile vpnbiz');
    }
  }

  async function getBalance() {
    const key = ensureKey();
    try {
      const resp = await httpGet(base + '/balance', { headers: buildHeaders(key), timeout: 15000 });
      return unwrapResponse(resp, 'Gagal ambil saldo vpnbiz');
    } catch (err) {
      throw handleAxiosError(err, 'Gagal ambil saldo vpnbiz');
    }
  }

  async function getProducts() {
    const key = ensureKey();
    try {
      const resp = await httpGet(base + '/products', { headers: buildHeaders(key), timeout: 20000 });
      return unwrapResponse(resp, 'Gagal ambil daftar produk vpnbiz');
    } catch (err) {
      throw handleAxiosError(err, 'Gagal ambil daftar produk vpnbiz');
    }
  }

  async function getAccounts({ renewable = false } = {}) {
    const key = ensureKey();
    const url = base + '/accounts' + (renewable ? '?renewable=true' : '');
    try {
      const resp = await httpGet(url, { headers: buildHeaders(key), timeout: 20000 });
      return unwrapResponse(resp, 'Gagal ambil daftar akun vpnbiz');
    } catch (err) {
      throw handleAxiosError(err, 'Gagal ambil daftar akun vpnbiz');
    }
  }

  // payload: { server_code, service, username?, password?, duration?, billing_period?, trial? }
  async function orderVpn(payload) {
    const key = ensureKey();
    try {
      const resp = await httpPost(base + '/vpn/order', payload, {
        headers: buildHeaders(key),
        timeout: 30000,
      });
      return unwrapResponse(resp, 'Gagal order akun edukasi');
    } catch (err) {
      throw handleAxiosError(err, 'Gagal order akun edukasi');
    }
  }

  // payload: { order_id, duration, billing_period }
  async function renewVpn(payload) {
    const key = ensureKey();
    try {
      const resp = await httpPost(base + '/vpn/renew', payload, {
        headers: buildHeaders(key),
        timeout: 30000,
      });
      return unwrapResponse(resp, 'Gagal renew akun edukasi');
    } catch (err) {
      throw handleAxiosError(err, 'Gagal renew akun edukasi');
    }
  }

  return {
    baseUrl: base,
    getProfile,
    getBalance,
    getProducts,
    getAccounts,
    orderVpn,
    renewVpn,
  };
}

module.exports = {
  createEdukasiClient,
  EdukasiApiError,
  DEFAULT_BASE_URL,
};
