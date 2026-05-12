// modules/http-client.js
// Wrapper axios dengan retry otomatis untuk call ke provider VPN (Potato/AutoScript).
// Retry hanya untuk error transient: network error, timeout, 5xx.
// 4xx (bad request, unauthorized, not found, conflict) tidak di-retry.
const axios = require('axios');

const DEFAULT_RETRIES = Number(process.env.PROVIDER_HTTP_RETRIES || 2);
const DEFAULT_BACKOFF_MS = Number(process.env.PROVIDER_HTTP_BACKOFF_MS || 800);
const DEFAULT_TIMEOUT_MS = Number(process.env.PROVIDER_HTTP_TIMEOUT_MS || 15000);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function isRetryable(err) {
  if (!err) return false;
  if (err.code && ['ECONNRESET','ECONNABORTED','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN','EPIPE'].includes(err.code)) return true;
  if (err.response && err.response.status >= 500 && err.response.status < 600) return true;
  return false;
}

async function requestWithRetry(config, options = {}) {
  const retries = options.retries != null ? Number(options.retries) : DEFAULT_RETRIES;
  const backoffMs = options.backoffMs != null ? Number(options.backoffMs) : DEFAULT_BACKOFF_MS;
  const merged = Object.assign({ timeout: DEFAULT_TIMEOUT_MS }, config);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios(merged);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isRetryable(err)) break;
      await sleep(backoffMs * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

function httpGet(url, config = {}, options) { return requestWithRetry(Object.assign({}, config, { method: 'get', url }), options); }
function httpPost(url, data, config = {}, options) { return requestWithRetry(Object.assign({}, config, { method: 'post', url, data }), options); }
function httpPut(url, data, config = {}, options) { return requestWithRetry(Object.assign({}, config, { method: 'put', url, data }), options); }
function httpPatch(url, data, config = {}, options) { return requestWithRetry(Object.assign({}, config, { method: 'patch', url, data }), options); }
function httpDelete(url, config = {}, options) { return requestWithRetry(Object.assign({}, config, { method: 'delete', url }), options); }

module.exports = { requestWithRetry, httpGet, httpPost, httpPut, httpPatch, httpDelete, isRetryable };
