// modules/web-api-client.js
// HTTP client untuk komunikasi dengan api-server di domain web (ketantech.my.id).
// Dipakai bot Telegram untuk:
//   - Verifikasi token "link akun" yang di-generate web (user dapat link
//     `https://t.me/<botname>?start=link_<token>` setelah klik tombol di web).
//   - Sync saldo & data user antara bot dan web (read di awal, write opsional).
//   - Ambil daftar produk/server dari web (untuk konsistensi katalog).
//
// SEMUA endpoint khusus bot di web diproteksi dengan API key (`WEB_API_BOT_KEY`)
// di header `X-Bot-API-Key`. Endpoint publik (mis. /products, /servers) tidak
// butuh key.
//
// Factory pattern (createWebApiClient) supaya gampang inject dependency &
// gampang di-test.

const axios = require('axios');

function createWebApiClient({ getBaseUrl, getBotKey, getTimeout, logger }) {
  if (typeof getBaseUrl !== 'function') {
    throw new Error('createWebApiClient: getBaseUrl harus fungsi');
  }
  if (typeof getBotKey !== 'function') {
    throw new Error('createWebApiClient: getBotKey harus fungsi');
  }
  if (!logger) throw new Error('createWebApiClient: logger required');
  const _getTimeout = typeof getTimeout === 'function' ? getTimeout : () => 15000;

  function _baseUrl() {
    const raw = String(getBaseUrl() || '').trim();
    return raw.replace(/\/+$/, ''); // strip trailing slash
  }

  function _http(authBot = false) {
    const cfg = {
      baseURL: _baseUrl(),
      timeout: Number(_getTimeout()) || 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BotVPN-Telegram/1.0',
      },
    };
    if (authBot) {
      const key = String(getBotKey() || '').trim();
      if (key) cfg.headers['X-Bot-API-Key'] = key;
    }
    return axios.create(cfg);
  }

  // Helper: standarkan error dari API web supaya pemanggil mudah handle.
  function _wrapError(err, contextLabel) {
    const status = err && err.response ? err.response.status : null;
    const apiMsg =
      (err && err.response && err.response.data &&
        (err.response.data.error || err.response.data.message)) ||
      (err && err.message) ||
      'Unknown error';
    const out = new Error(apiMsg);
    out.status = status;
    out.code = 'web_api_error';
    out.context = contextLabel;
    return out;
  }

  // ============== ENDPOINT PUBLIK (tidak butuh bot key) ==============

  async function ping() {
    try {
      const res = await _http(false).get('/products', { timeout: 5000 });
      return res.status === 200;
    } catch (e) {
      logger.warn('Web API ping gagal: ' + (e.message || e));
      return false;
    }
  }

  async function getProducts() {
    try {
      const res = await _http(false).get('/products');
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      throw _wrapError(err, 'getProducts');
    }
  }

  async function getServers() {
    try {
      const res = await _http(false).get('/servers');
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      throw _wrapError(err, 'getServers');
    }
  }

  // ============== ENDPOINT KHUSUS BOT (butuh X-Bot-API-Key) ==============

  // Verifikasi token "link akun" yang di-generate web. Kalau valid, web akan
  // mengaitkan telegramId tersebut ke user web yang sesuai, lalu return
  // info user web (id, username, balance).
  // Endpoint ini DIASUMSIKAN ada di web: POST /telegram/verify-link-token
  // body: { token: string, telegramId: number }
  // response: { ok: true, user: { id, username, balance, ... } }
  async function verifyLinkToken({ token, telegramId }) {
    try {
      const res = await _http(true).post('/telegram/verify-link-token', {
        token: String(token || ''),
        telegramId: Number(telegramId || 0),
      });
      return res.data;
    } catch (err) {
      throw _wrapError(err, 'verifyLinkToken');
    }
  }

  // Ambil data user web by telegramId. Dipakai bot saat user yang sudah link
  // mau cek saldo / info akun.
  // Endpoint: GET /telegram/user-by-tgid/:telegramId
  // response: { user: { id, username, balance, fullName, ... } }
  async function getUserByTelegramId(telegramId) {
    try {
      const res = await _http(true).get(
        '/telegram/user-by-tgid/' + Number(telegramId || 0)
      );
      return res.data && res.data.user ? res.data.user : null;
    } catch (err) {
      // 404 = belum link, jangan throw error noisy
      if (err && err.response && err.response.status === 404) {
        return null;
      }
      throw _wrapError(err, 'getUserByTelegramId');
    }
  }

  // Ambil saldo user web by telegramId.
  // Endpoint: GET /telegram/balance/:telegramId
  // response: { balance: number, pendingTopup: number }
  async function getBalanceByTelegramId(telegramId) {
    try {
      const res = await _http(true).get(
        '/telegram/balance/' + Number(telegramId || 0)
      );
      return res.data || { balance: 0, pendingTopup: 0 };
    } catch (err) {
      if (err && err.response && err.response.status === 404) {
        return null;
      }
      throw _wrapError(err, 'getBalanceByTelegramId');
    }
  }

  // Unlink akun web dari telegram. Dipakai admin / user yang ingin putuskan.
  // Endpoint: POST /telegram/unlink
  // body: { telegramId: number }
  async function unlinkTelegram(telegramId) {
    try {
      const res = await _http(true).post('/telegram/unlink', {
        telegramId: Number(telegramId || 0),
      });
      return res.data || { ok: true };
    } catch (err) {
      throw _wrapError(err, 'unlinkTelegram');
    }
  }

  // Tambah saldo user web. Dipakai oleh:
  //   1. Migrate saldo SQLite -> web saat user pertama kali link akun
  //   2. (future) Topup di bot yang langsung masuk ke saldo web
  // refId opsional: kalau diisi, server akan idempotent (request yang sama
  // tidak double-credit). Penting untuk operasi network-retry yang aman.
  // Endpoint: POST /telegram/credit
  // body: { telegramId, amount, description?, refId? }
  // response: { ok: true, applied: boolean, newBalance: number }
  async function creditBalance({ telegramId, amount, description, refId }) {
    try {
      const res = await _http(true).post('/telegram/credit', {
        telegramId: Number(telegramId || 0),
        amount: Number(amount || 0),
        description: description ? String(description) : undefined,
        refId: refId ? String(refId) : undefined,
      });
      return res.data || { ok: false };
    } catch (err) {
      throw _wrapError(err, 'creditBalance');
    }
  }

  // Kurangi saldo user web. Dipakai bot saat user beli akun, perpanjang, dll.
  // refId mandatory di production supaya tidak double-debit kalau bot retry.
  // Endpoint: POST /telegram/debit
  // body: { telegramId, amount, description?, refId? }
  // response: { ok: true, applied: boolean, newBalance: number }
  // Throw error dengan status 400 + newBalance kalau saldo kurang.
  async function debitBalance({ telegramId, amount, description, refId }) {
    try {
      const res = await _http(true).post('/telegram/debit', {
        telegramId: Number(telegramId || 0),
        amount: Number(amount || 0),
        description: description ? String(description) : undefined,
        refId: refId ? String(refId) : undefined,
      });
      return res.data || { ok: false };
    } catch (err) {
      throw _wrapError(err, 'debitBalance');
    }
  }

  return {
    // public
    ping,
    getProducts,
    getServers,
    // bot-only
    verifyLinkToken,
    getUserByTelegramId,
    getBalanceByTelegramId,
    unlinkTelegram,
    creditBalance,
    debitBalance,
    // utils
    _baseUrl,
  };
}

module.exports = { createWebApiClient };
