const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const { Telegraf } = require('telegraf');
const app = express();
const axios = require('axios');
const { isUserReseller, addReseller, removeReseller, listResellersSync } = require('./modules/reseller');
const winston = require('winston');

const logger = winston.createLogger({
  // Bisa diatur via ENV, default 'info'
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    // Log error saja, file kecil tapi penting
    new winston.transports.File({
      filename: 'bot-error.log',
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5 MB per file
      maxFiles: 3,              // simpan 3 file (15MB total)
    }),

    // Log gabungan, bisa agak lebih besar
    new winston.transports.File({
      filename: 'bot-combined.log',
      maxsize: 10 * 1024 * 1024, // 10 MB per file
      maxFiles: 5,               // simpan 5 file (50MB total)
    }),
  ],
});

// Di luar production, log ke console untuk debugging
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}


// Helper sederhana untuk jeda (dipakai di broadcast)
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const {
  createssh,
  createvmess,
  createvless,
  createtrojan,
  createshadowsocks
} = require('./modules/create');

const {
  trialssh,
  trialvmess,
  trialvless,
  trialtrojan,
  trialshadowsocks
} = require('./modules/trial');

const {
  renewssh,
  renewvmess,
  renewvless,
  renewtrojan,
  renewshadowsocks
} = require('./modules/renew');

const {
  delssh,
  delvmess,
  delvless,
  deltrojan,
  delshadowsocks
} = require('./modules/del');

const {
  lockssh,
  lockvmess,
  lockvless,
  locktrojan,
  lockshadowsocks
} = require('./modules/lock');

const {
  unlockssh,
  unlockvmess,
  unlockvless,
  unlocktrojan,
  unlockshadowsocks
} = require('./modules/unlock');

const fsPromises = require('fs/promises');
const path = require('path');

const VARS_PATH = path.join(__dirname, '.vars.json');

const trialFile = path.join(__dirname, 'trial.db');
const trialConfigFile = path.join(__dirname, 'trial_config.json');

// Konfigurasi default trial
const DEFAULT_TRIAL_CONFIG = {
  enabled: true,          // trial awalnya AKTIF
  maxPerDay: 1,           // berapa kali trial per user per hari
  durationHours: 1,       // lama trial dalam satuan JAM
  minBalanceForTrial: 0   // minimal saldo untuk bisa trial (0 = bebas)
};
// Cache in-memory untuk konfigurasi trial
let trialConfigCache = null;
let trialConfigCacheLoadedAt = 0;
const TRIAL_CONFIG_CACHE_TTL_MS = 60 * 1000; // 1 menit (boleh diubah kalau perlu)

// Baca / buat file konfigurasi trial (dengan cache in-memory)
async function getTrialConfig() {
  const now = Date.now();

  // Kalau masih dalam TTL dan cache ada â†’ pakai cache saja
  if (
    trialConfigCache &&
    now - trialConfigCacheLoadedAt < TRIAL_CONFIG_CACHE_TTL_MS
  ) {
    return trialConfigCache;
  }

  try {
    const data = await fsPromises.readFile(trialConfigFile, 'utf8');
    const cfg = JSON.parse(data);

    // Backward compatibility:
    // - Kalau durationHours ada â†’ pakai itu
    // - Kalau cuma ada durationDays â†’ konversi ke jam (x24)
    let durationHours;
    if (Number.isInteger(cfg.durationHours)) {
      durationHours = cfg.durationHours;
    } else if (Number.isInteger(cfg.durationDays)) {
      durationHours = cfg.durationDays * 24;
    } else {
      durationHours = DEFAULT_TRIAL_CONFIG.durationHours;
    }

    const maxPerDay = Number.isInteger(cfg.maxPerDay)
      ? cfg.maxPerDay
      : DEFAULT_TRIAL_CONFIG.maxPerDay;

    const enabled =
      typeof cfg.enabled === 'boolean'
        ? cfg.enabled
        : DEFAULT_TRIAL_CONFIG.enabled;

    const minBalanceForTrial =
      Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial >= 0
        ? cfg.minBalanceForTrial
        : DEFAULT_TRIAL_CONFIG.minBalanceForTrial;

    const result = {
      enabled,
      maxPerDay,
      durationHours,
      minBalanceForTrial,
    };

    // Simpan ke cache
    trialConfigCache = result;
    trialConfigCacheLoadedAt = Date.now();

    return result;
  } catch (err) {
    // Kalau file belum ada / rusak â†’ tulis default
    try {
      await fsPromises.writeFile(
        trialConfigFile,
        JSON.stringify(DEFAULT_TRIAL_CONFIG, null, 2)
      );
    } catch (e) {
      logger.error('âš ï¸ Gagal membuat trial_config.json:', e.message);
    }

    // Simpan default ke cache juga
    trialConfigCache = DEFAULT_TRIAL_CONFIG;
    trialConfigCacheLoadedAt = Date.now();

    return DEFAULT_TRIAL_CONFIG;
  }
}

// Update / simpan konfigurasi trial
async function updateTrialConfig(partial) {
  const current = await getTrialConfig();
  const updated = { ...current, ...partial };

  try {
    await fsPromises.writeFile(
      trialConfigFile,
      JSON.stringify(updated, null, 2)
    );

    // Update cache juga
    trialConfigCache = updated;
    trialConfigCacheLoadedAt = Date.now();
  } catch (e) {
    logger.error('âš ï¸ Gagal mengupdate trial_config.json:', e.message);
  }

  return updated;
}

// Mengecek apakah user sudah melewati batas trial per hari
async function checkTrialAccess(userId) {
  // default kalau config gagal dibaca
  let maxPerDay = DEFAULT_TRIAL_CONFIG.maxPerDay || 1;

  // baca maxPerDay dari trial_config.json
  try {
    const cfg = await getTrialConfig();
    if (cfg && Number.isInteger(cfg.maxPerDay) && cfg.maxPerDay > 0) {
      maxPerDay = cfg.maxPerDay;
    }
  } catch (err) {
    if (typeof logger !== 'undefined') {
      logger.error('âš ï¸ Gagal membaca konfigurasi trial (maxPerDay):', err.message || err);
    }
  }

  try {
    const data = await fsPromises.readFile(trialFile, 'utf8');
    const trialData = JSON.parse(data);
    const entry = trialData[userId];
    const today = new Date().toISOString().slice(0, 10);

    if (!entry) {
      return false;
    }

    // format lama: "YYYY-MM-DD"
    if (typeof entry === 'string') {
      if (entry !== today) return false;
      const used = 1;
      return used >= maxPerDay;
    }

    // format baru: { date, count }
    if (typeof entry === 'object' && entry.date) {
      if (entry.date !== today) return false;
      const used = typeof entry.count === 'number' ? entry.count : 1;
      return used >= maxPerDay;
    }

    return false;
  } catch (err) {
    return false; // kalau gagal baca file â†’ anggap belum melewati batas
  }
}

async function getTrialUsageToday(userId) {
  try {
    const data = await fsPromises.readFile(trialFile, 'utf8');
    const trialData = JSON.parse(data);
    const entry = trialData[userId];
    const today = new Date().toISOString().slice(0, 10);

    if (!entry) return 0;

    // format lama: "YYYY-MM-DD"
    if (typeof entry === 'string') {
      return entry === today ? 1 : 0;
    }

    // format baru: { date, count }
    if (typeof entry === 'object' && entry.date) {
      if (entry.date !== today) return 0;
      return typeof entry.count === 'number' ? entry.count : 1;
    }

    return 0;
  } catch (err) {
    // kalau gagal baca file â†’ anggap belum pernah trial
    return 0;
  }
}

async function getCreateUsageToday(userId) {
  return await new Promise((resolve) => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startTs = startOfDay.getTime();

      db.get(
        'SELECT COUNT(*) AS cnt FROM accounts WHERE user_id = ? AND created_at >= ?',
        [userId, startTs],
        (err, row) => {
          if (err) {
            logger.error('âŒ Kesalahan saat membaca jumlah akun harian user:', err.message);
            return resolve(0); // kalau error, anggap 0 biar ga ganggu user baik
          }
          const cnt = row && row.cnt ? Number(row.cnt) : 0;
          resolve(cnt);
        }
      );
    } catch (e) {
      logger.error('âŒ Error di getCreateUsageToday:', e.message || e);
      resolve(0);
    }
  });
}

/////////
async function checkServerAccess(serverId, userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT is_reseller_only FROM Server WHERE id = ?', [serverId], async (err, row) => {
      if (err) return reject(err);
      // jika server tidak ada => tolak (caller menangani pesan)
      if (!row) return resolve({ ok: false, reason: 'not_found' });
      const flag = row.is_reseller_only === 1 || row.is_reseller_only === '1';
      if (!flag) return resolve({ ok: true }); // publik
      // jika reseller-only, cek apakah user terdaftar reseller
      try {
        const isR = await isUserReseller(userId);
        if (isR) return resolve({ ok: true });
        return resolve({ ok: false, reason: 'reseller_only' });
      } catch (e) {
        // fallback: tolak akses
        return resolve({ ok: false, reason: 'reseller_only' });
      }
    });
  });
}

// Menyimpan informasi penggunaan trial user (tanggal + hitungan per hari)
async function saveTrialAccess(userId) {
  let trialData = {};
  try {
    const data = await fsPromises.readFile(trialFile, 'utf8');
    trialData = JSON.parse(data);
  } catch (err) {
    // file belum ada / rusak â†’ mulai dari kosong
  }

  const today = new Date().toISOString().slice(0, 10);
  const existing = trialData[userId];

  if (existing && typeof existing === 'object') {
    // format baru: { date, count }
    if (existing.date === today) {
      existing.count = (existing.count || 0) + 1;
    } else {
      trialData[userId] = { date: today, count: 1 };
    }
  } else if (typeof existing === 'string') {
    // format lama: "YYYY-MM-DD" â†’ anggap sudah 1x di hari itu
    if (existing === today) {
      trialData[userId] = { date: today, count: 2 };
    } else {
      trialData[userId] = { date: today, count: 1 };
    }
  } else {
    // belum ada catatan sama sekali
    trialData[userId] = { date: today, count: 1 };
  }

  await fsPromises.writeFile(trialFile, JSON.stringify(trialData, null, 2));
}
// ============================================================================
// SECTION: PAYMENT CONFIG & QRIS GOPAY AUTOFTBOT
// - Baca .vars.json
// - Inisialisasi autoft-qris (QRISGenerator, PaymentChecker)
// - Batas nominal & interval cek QRIS
// ============================================================================

const fs = require('fs');
try { require('dotenv').config(); } catch (e) { /* dotenv opsional */ }
let vars = {};
function envOr(key, fallback) {
  const v = process.env[key];
  if (v !== undefined && v !== null && String(v).length > 0) return v;
  return (vars && Object.prototype.hasOwnProperty.call(vars, key)) ? vars[key] : fallback;
}
function envJson(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).length === 0) {
    return (vars && Object.prototype.hasOwnProperty.call(vars, key)) ? vars[key] : fallback;
  }
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}
try {
  vars = JSON.parse(fs.readFileSync(VARS_PATH, 'utf8'));
} catch (e) {
  logger.error('Gagal membaca .vars.json. Pastikan file ada & format JSON benar:', e.message || e);
  vars = {};
}

function readVarsFresh() {
  try {
    const raw = fs.readFileSync(VARS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    vars = parsed;
    return parsed;
  } catch (e) {
    logger.error('Gagal membaca .vars.json terbaru:', e.message || e);
    return vars || {};
  }
}

function writeVarsPartial(partial) {
  const current = readVarsFresh();
  const updated = { ...current, ...partial };
  fs.writeFileSync(VARS_PATH, JSON.stringify(updated, null, 2));
  vars = updated;
  return updated;
}

function getGopayApiKey() {
  const envKey = process.env.GOPAY_API_KEY;
  if (envKey && String(envKey).trim()) return String(envKey).trim();
  const fresh = readVarsFresh();
  return String(fresh.GOPAY_API_KEY || '').trim();
}

function maskToken(token, head = 12, tail = 8) {
  const value = String(token || '').trim();
  if (!value) return '-';
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

const GOPAY_BASE_QR = envOr('GOPAY_BASE_QR', envOr('ORDERKUOTA_BASE_QR', ''));
const GOPAY_AUTH_USERNAME = envOr('GOPAY_AUTH_USERNAME', envOr('ORDERKUOTA_AUTH_USERNAME', ''));
const GOPAY_AUTH_TOKEN = envOr('GOPAY_AUTH_TOKEN', envOr('ORDERKUOTA_AUTH_TOKEN', ''));
//const { QRISGenerator, PaymentChecker } = require('autoft-qris');
const GOPAY_CREATEPAYMENT_URL =
  envOr('GOPAY_CREATEPAYMENT_URL', envOr('ORDERKUOTA_CREATEPAYMENT_URL',
  'https://api.rajaserver.web.id/orderkuota/createpayment'));

const GOPAY_CREATEPAYMENT_APIKEY =
  envOr('GOPAY_CREATEPAYMENT_APIKEY', envOr('ORDERKUOTA_CREATEPAYMENT_APIKEY', ''));


const GOPAY_API_BASE_URL =
  envOr('GOPAY_API_BASE_URL', envOr('GOPAY_BACKEND_BASE_URL',
  'https://api-gopay.autoftbot.com'));

let qrisGen = null;
let qrisPaymentChecker = null;

// Init / lazy init instance autoft-qris
// === autoft-orkut (sesuai README) ===
const ork = require('autoft-orkut');
const MutasiClient = ork.MutasiClient || (ork.default && ork.default.MutasiClient);
const QRIS = ork.QRIS || (ork.default && ork.default.QRIS);

let mutasiClient = null;
let qrisImageGen = null;

// Init / lazy init instance autoft-orkut
function getOrkutInstances() {
  if (!GOPAY_BASE_QR || !GOPAY_AUTH_USERNAME || !GOPAY_AUTH_TOKEN) {
    throw new Error(
      'Config GOPAY_BASE_QR / GOPAY_AUTH_USERNAME / GOPAY_AUTH_TOKEN belum di-set di .vars.json (ORDERKUOTA_* masih didukung sebagai fallback)'
    );
  }

  if (!MutasiClient || !QRIS) {
    throw new Error('autoft-orkut tidak terbaca. Pastikan `npm i autoft-orkut` sudah sukses.');
  }

  if (!mutasiClient) {
    mutasiClient = new MutasiClient(GOPAY_AUTH_USERNAME, GOPAY_AUTH_TOKEN);
  }

  if (!qrisImageGen) {
    // dipakai untuk generate gambar QR
    qrisImageGen = new QRIS({ baseQrString: GOPAY_BASE_QR });
  }

  return { mutasiClient, qrisImageGen, QRIS };
}


const QRIS_AUTO_TOPUP_MIN = vars.QRIS_AUTO_TOPUP_MIN || 15000;
const QRIS_AUTO_TOPUP_MAX = vars.QRIS_AUTO_TOPUP_MAX || 500000;
// Interval cek QRIS & timeout invoice (bisa di-set dari .vars.json)
const QRIS_CHECK_INTERVAL_MS = Number(vars.QRIS_CHECK_INTERVAL_MS || 5000);
const QRIS_PAYMENT_TIMEOUT_MIN = Number(vars.QRIS_PAYMENT_TIMEOUT_MIN || 15);
// ====================== END SECTION: PAYMENT CONFIG & QRIS ===================


function generateUniqueSuffix(min = 50, max = 200) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildStaticQrisImageUrl(qrString) {
  const payload = String(qrString || '').trim();
  if (!payload) return '';
  return `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(payload)}`;
}

function buildEmvTag(tag, value) {
  const v = String(value ?? '');
  return `${tag}${String(v.length).padStart(2, '0')}${v}`;
}

function crc16Ccitt(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function removeTag54(payload) {
  const idx = payload.indexOf('54');
  if (idx === -1) return payload;
  const len = Number.parseInt(payload.slice(idx + 2, idx + 4), 10);
  if (!Number.isFinite(len) || len < 0) return payload;
  return payload.slice(0, idx) + payload.slice(idx + 4 + len);
}

function buildDynamicQrisPayload(baseQrString, amount) {
  const nominal = Number(amount || 0);
  if (!Number.isFinite(nominal) || nominal <= 0) {
    throw new Error('Nominal QRIS dinamis tidak valid');
  }

  let payload = String(baseQrString || '').trim();
  if (!payload) {
    throw new Error('Base QRIS kosong');
  }

  const crcPos = payload.lastIndexOf('6304');
  if (crcPos >= 0) {
    payload = payload.slice(0, crcPos);
  }

  if (payload.includes('010211')) {
    payload = payload.replace('010211', '010212');
  } else if (!payload.includes('010212') && payload.startsWith('00020101')) {
    payload = payload.replace('00020101', '000201010212');
  }

  payload = removeTag54(payload);

  const amountTag = buildEmvTag('54', String(Math.round(nominal)));
  if (payload.includes('5802ID')) {
    payload = payload.replace('5802ID', `${amountTag}5802ID`);
  } else {
    payload += amountTag;
  }

  const unsignedPayload = `${payload}6304`;
  return `${unsignedPayload}${crc16Ccitt(unsignedPayload)}`;
}

async function fetchGopayTransactions() {
  const gopayApiKey = getGopayApiKey();

  if (!gopayApiKey) {
    throw new Error('GOPAY_API_KEY belum diisi di .vars.json');
  }

  const res = await axios.post(
    `${GOPAY_API_BASE_URL}/transactions`,
    {},
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gopayApiKey}`,
      },
      timeout: 15000,
    }
  );

  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Gagal mengambil transaksi GoPay');
  }

  return Array.isArray(res.data?.data?.transactions)
    ? res.data.data.transactions
    : [];
}


async function generateGopayQris(amount) {
  const gopayApiKey = getGopayApiKey();

  if (!gopayApiKey) {
    throw new Error('GOPAY_API_KEY belum diisi di .vars.json');
  }

  const nominal = Number(amount || 0);
  if (!Number.isFinite(nominal) || nominal <= 0) {
    throw new Error('Nominal QRIS tidak valid');
  }

  const res = await axios.post(
    `${GOPAY_API_BASE_URL}/qris/generate`,
    { amount: nominal },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gopayApiKey}`,
      },
      timeout: 15000,
    }
  );

  if (!res.data?.success || !res.data?.data?.transaction_id) {
    throw new Error(res.data?.message || 'Gagal membuat QRIS GoPay');
  }

  return res.data.data;
}

async function fetchGopayQrisStatus(transactionId) {
  const gopayApiKey = getGopayApiKey();

  if (!gopayApiKey) {
    throw new Error('GOPAY_API_KEY belum diisi di .vars.json');
  }

  const txid = String(transactionId || '').trim();
  if (!txid) {
    throw new Error('transaction_id kosong');
  }

  const res = await axios.post(
    `${GOPAY_API_BASE_URL}/qris/status`,
    { transaction_id: txid },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gopayApiKey}`,
      },
      timeout: 15000,
    }
  );

  if (!res.data?.data) {
    throw new Error(res.data?.message || 'Gagal mengecek status QRIS');
  }

  return res.data;
}

function parseProviderTransactionTime(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const directTs = Number(raw);
  if (Number.isFinite(directTs) && directTs > 0) {
    return directTs > 1e12 ? directTs : directTs * 1000;
  }

  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildProviderTransactionFingerprint(trx) {
  if (!trx || typeof trx !== 'object') return '';
  const explicitId = String(trx.id || trx.transaction_id || trx.tx_id || '').trim();
  if (explicitId) return `id:${explicitId}`;

  const amount = Number(trx.amount || 0);
  const timeMs = parseProviderTransactionTime(trx.time || trx.created_at || trx.updated_at || trx.transaction_time) || 0;
  const issuer = String(trx.issuer || '').trim().toLowerCase();
  const paymentType = String(trx.payment_type || '').trim().toLowerCase();
  const status = String(trx.status || '').trim().toLowerCase();
  return `fp:${amount}|${timeMs}|${issuer}|${paymentType}|${status}`;
}

function findMatchingSettlementTransaction(transactions, expectedAmount, options = {}) {
  const expected = Number(expectedAmount || 0);
  if (!Array.isArray(transactions) || expected <= 0) return null;

  return (
    transactions.find((trx) => {
      const amount = Number(trx?.amount || 0);
      const status = String(trx?.status || '').toLowerCase();
      return amount === expected && status === 'settlement';
    }) || null
  );
}

async function checkQrisInvoiceStatus(invoiceId, billedAmount, createdAt) {
  const inv = String(invoiceId || '').trim();
  if (!inv) {
    return { status: 'PENDING', paid_at: null, transaction: null };
  }

  const paymentRow = await new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM qris_payments WHERE invoice_id = ? LIMIT 1`,
      [inv],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });

  if (!paymentRow) {
    throw new Error('Invoice QRIS tidak ditemukan di database');
  }

  const providerTransactionId = String(paymentRow.provider_tx_id || '').trim();
  const timeoutMin = Number(QRIS_PAYMENT_TIMEOUT_MIN || 10);
  const expiresAt = Number(paymentRow.created_at || createdAt || 0) + timeoutMin * 60 * 1000;

  if (!providerTransactionId) {
    if ((paymentRow.created_at || createdAt) && Date.now() > expiresAt) {
      return { status: 'EXPIRED', paid_at: null, transaction: null };
    }
    return { status: 'PENDING', paid_at: null, transaction: null };
  }

  const statusRes = await fetchGopayQrisStatus(providerTransactionId);
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
    return {
      status: 'EXPIRED',
      paid_at: null,
      transaction: normalizedTx,
    };
  }

  if (providerStatus === 'cancel') {
    return {
      status: 'CANCELED',
      paid_at: null,
      transaction: normalizedTx,
    };
  }

  if ((paymentRow.created_at || createdAt) && Date.now() > expiresAt) {
    return {
      status: 'EXPIRED',
      paid_at: null,
      transaction: normalizedTx,
    };
  }

  return {
    status: 'PENDING',
    paid_at: null,
    transaction: normalizedTx,
  };
}

// === PENGATURAN BONUS TOPUP (TIER) ===
let TOPUP_BONUS_ENABLED =
  typeof vars.TOPUP_BONUS_ENABLED !== 'undefined'
    ? !!vars.TOPUP_BONUS_ENABLED
    : true;

let TOPUP_BONUS_MIN_AMOUNT = Number(vars.TOPUP_BONUS_MIN_AMOUNT || 50000);
let TOPUP_BONUS_PERCENT = Number(vars.TOPUP_BONUS_PERCENT || 5);

let TOPUP_BONUS_TIER2_MIN = Number(vars.TOPUP_BONUS_TIER2_MIN || 100000);
let TOPUP_BONUS_TIER2_PERCENT = Number(vars.TOPUP_BONUS_TIER2_PERCENT || 7);

let TOPUP_BONUS_TIER3_MIN = Number(vars.TOPUP_BONUS_TIER3_MIN || 200000);
let TOPUP_BONUS_TIER3_PERCENT = Number(vars.TOPUP_BONUS_TIER3_PERCENT || 10);

// Hitung bonus topup berdasarkan tier (pembulatan ke bawah)
function calculateTopupBonus(amount) {
  if (!TOPUP_BONUS_ENABLED) {
    return { bonus: 0, percent: 0 };
  }

  // Pastikan nominal angka
  amount = Number(amount || 0);
  if (amount <= 0) {
    return { bonus: 0, percent: 0 };
  }

  let percent = 0;

  // Cek dari tier tertinggi ke terendah
  if (amount >= TOPUP_BONUS_TIER3_MIN) {
    percent = TOPUP_BONUS_TIER3_PERCENT;
  } else if (amount >= TOPUP_BONUS_TIER2_MIN) {
    percent = TOPUP_BONUS_TIER2_PERCENT;
  } else if (amount >= TOPUP_BONUS_MIN_AMOUNT) {
    percent = TOPUP_BONUS_PERCENT;
  }

  if (percent <= 0) {
    return { bonus: 0, percent: 0 };
  }

  // BONUS DIBULATKAN KE BAWAH
  const bonus = Math.floor((amount * percent) / 100);

  return { bonus, percent };
}

logger.info(
  `Topup bonus init: enabled=${TOPUP_BONUS_ENABLED}, ` +
    `tier1>=${TOPUP_BONUS_MIN_AMOUNT}@${TOPUP_BONUS_PERCENT}%, ` +
    `tier2>=${TOPUP_BONUS_TIER2_MIN}@${TOPUP_BONUS_TIER2_PERCENT}%, ` +
    `tier3>=${TOPUP_BONUS_TIER3_MIN}@${TOPUP_BONUS_TIER3_PERCENT}%`
);


const BOT_TOKEN = envOr('BOT_TOKEN', '');
const port = Number(envOr('PORT', 6969));

// Owner / master
const MASTER_ID = Number(envOr('MASTER_ID', envOr('USER_ID', 0))); // owner asli

// === LIST ADMIN ===
// Bisa diisi lewat ADMIN_IDS di .vars.json:
// "ADMIN_IDS": "690744680,111111111"
// atau
// "ADMIN_IDS": [690744680,111111111]
const ADMIN_IDS_RAW = envOr('ADMIN_IDS', envOr('USER_ID', ''));

// Konfigurasi lain
const NAMA_STORE = envOr('NAMA_STORE', '@kr2k3n');
const DATA_QRIS = envOr('DATA_QRIS', '');
const MERCHANT_ID = envOr('MERCHANT_ID', '');
const API_KEY = envOr('API_KEY', '');
// Diskon harga untuk reseller (0.7 = 70% dari harga normal)
const RESELLER_DISCOUNT = vars.RESELLER_DISCOUNT || 0.5;
const GROUP_ID = envOr('GROUP_ID', '');
// Kontrol notif topup/pengurangan saldo ke grup
// Di .vars.json bisa set "NOTIF_TOPUP_GROUP": true atau false
const NOTIF_TOPUP_GROUP =
  vars.NOTIF_TOPUP_GROUP === undefined
    ? true
    : String(vars.NOTIF_TOPUP_GROUP).toLowerCase() === 'true';

// === PENGATURAN AUTO BACKUP DATABASE ===
let AUTO_BACKUP_ENABLED =
  typeof vars.AUTO_BACKUP_ENABLED !== 'undefined'
    ? !!vars.AUTO_BACKUP_ENABLED
    : true;

let AUTO_BACKUP_INTERVAL_HOURS = Number(vars.AUTO_BACKUP_INTERVAL_HOURS || 12);

// Chat tujuan backup otomatis (default: MASTER_ID)
const BACKUP_CHAT_ID = Number(envOr('BACKUP_CHAT_ID', MASTER_ID || 0));

// Timer / handle untuk setInterval auto-backup
let autoBackupTimer = null;

logger.info(
  `Auto-backup init: enabled=${AUTO_BACKUP_ENABLED}, interval=${AUTO_BACKUP_INTERVAL_HOURS} jam, chat=${BACKUP_CHAT_ID}`
);

// === PENGATURAN LAPORAN HARIAN ===
// ON/OFF (default: aktif kalau tidak diset)
let DAILY_REPORT_ENABLED =
  typeof vars.DAILY_REPORT_ENABLED !== 'undefined'
    ? !!vars.DAILY_REPORT_ENABLED
    : true;

// Jam & menit laporan (pakai waktu server, biasanya sudah sama WITA/WIT)
let DAILY_REPORT_HOUR = Number(vars.DAILY_REPORT_HOUR || 23); // jam 23
let DAILY_REPORT_MINUTE = Number(vars.DAILY_REPORT_MINUTE || 0); // menit 00

// Supaya laporan hanya sekali per hari
let lastDailyReportDateKey = null;

logger.info(
  `Daily report init: enabled=${DAILY_REPORT_ENABLED}, time=${DAILY_REPORT_HOUR}:${String(
    DAILY_REPORT_MINUTE
  ).padStart(2, '0')}`
);

// === PENGATURAN PENGINGAT EXPIRED AKUN ===
let EXPIRY_REMINDER_ENABLED =
  typeof vars.EXPIRY_REMINDER_ENABLED !== 'undefined'
    ? !!vars.EXPIRY_REMINDER_ENABLED
    : true;

// default jam 20:00 H-1
let EXPIRY_REMINDER_HOUR = Number(vars.EXPIRY_REMINDER_HOUR || 20);
let EXPIRY_REMINDER_MINUTE = Number(vars.EXPIRY_REMINDER_MINUTE || 0);
let EXPIRY_REMINDER_DAYS_BEFORE = Number(
  vars.EXPIRY_REMINDER_DAYS_BEFORE || 1
);

// Supaya reminder hanya sekali per hari
let lastExpiryReminderDateKey = null;

logger.info(
  `Expiry reminder init: enabled=${EXPIRY_REMINDER_ENABLED}, daysBefore=${EXPIRY_REMINDER_DAYS_BEFORE}, time=${EXPIRY_REMINDER_HOUR}:${String(
    EXPIRY_REMINDER_MINUTE
  ).padStart(2, '0')}`
);

// === PENGATURAN TARGET RESELLER ===
let RESELLER_TARGET_ENABLED =
  typeof vars.RESELLER_TARGET_ENABLED !== 'undefined'
    ? !!vars.RESELLER_TARGET_ENABLED
    : true;

let RESELLER_TARGET_MIN_30D_ACCOUNTS = Number(
  vars.RESELLER_TARGET_MIN_30D_ACCOUNTS || 3
);

let RESELLER_TARGET_MIN_DAYS_PER_MONTH = Number(
  vars.RESELLER_TARGET_MIN_DAYS_PER_MONTH || 90
);

// jam & menit cek otomatis tiap tanggal 1
let RESELLER_TARGET_CHECK_HOUR = Number(
  vars.RESELLER_TARGET_CHECK_HOUR || 1
);
let RESELLER_TARGET_CHECK_MINUTE = Number(
  vars.RESELLER_TARGET_CHECK_MINUTE || 5
);

// supaya cek auto-downgrade cuma sekali per bulan
let lastResellerTargetMonthKey = null;

logger.info(
  `Reseller target init: enabled=${RESELLER_TARGET_ENABLED}, ` +
  `min30d=${RESELLER_TARGET_MIN_30D_ACCOUNTS}, ` +
  `minDays=${RESELLER_TARGET_MIN_DAYS_PER_MONTH}, ` +
  `time=${RESELLER_TARGET_CHECK_HOUR}:${String(
    RESELLER_TARGET_CHECK_MINUTE
  ).padStart(2, '0')}`
);
function updateResellerTargetVars(partial) {
  try {
    const varsPath = path.join(__dirname, '.vars.json');

    let current = {};
    try {
      if (fs.existsSync(varsPath)) {
        const raw = fs.readFileSync(varsPath, 'utf8');
        current = JSON.parse(raw);
      }
    } catch (e) {
      logger.error(
        'Gagal baca .vars.json saat updateResellerTargetVars:',
        e.message || e
      );
    }

    const updated = Object.assign({}, current, partial);
    fs.writeFileSync(varsPath, JSON.stringify(updated, null, 2));

    logger.info(
      '[ResellerTarget] .vars.json diupdate untuk key: ' +
        Object.keys(partial).join(', ')
    );
  } catch (err) {
    logger.error(
      '[ResellerTarget] Gagal menulis .vars.json saat updateResellerTargetVars:',
      err.message || err
    );
  }
}



// === PENGATURAN BONUS RESELLER AKTIF BULANAN ===
let RESELLER_ACTIVE_BONUS_ENABLED =
  typeof vars.RESELLER_ACTIVE_BONUS_ENABLED !== 'undefined'
    ? !!vars.RESELLER_ACTIVE_BONUS_ENABLED
    : true;

let RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS = Number(
  vars.RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS || 7
);

let RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET = Number(
  vars.RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET || 10000
);

let RESELLER_ACTIVE_BONUS_TIER1_DAYS = Number(
  vars.RESELLER_ACTIVE_BONUS_TIER1_DAYS || 5
);
let RESELLER_ACTIVE_BONUS_TIER1_AMOUNT = Number(
  vars.RESELLER_ACTIVE_BONUS_TIER1_AMOUNT || 5000
);

let RESELLER_ACTIVE_BONUS_TIER2_DAYS = Number(
  vars.RESELLER_ACTIVE_BONUS_TIER2_DAYS || 10
);
let RESELLER_ACTIVE_BONUS_TIER2_AMOUNT = Number(
  vars.RESELLER_ACTIVE_BONUS_TIER2_AMOUNT || 15000
);

let RESELLER_ACTIVE_BONUS_TIER3_DAYS = Number(
  vars.RESELLER_ACTIVE_BONUS_TIER3_DAYS || 15
);
let RESELLER_ACTIVE_BONUS_TIER3_AMOUNT = Number(
  vars.RESELLER_ACTIVE_BONUS_TIER3_AMOUNT || 30000
);

logger.info(
  `Reseller active bonus init: enabled=${RESELLER_ACTIVE_BONUS_ENABLED}, ` +
  `minDur=${RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS}, ` +
  `minOmzet=${RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET}, ` +
  `tiers=${RESELLER_ACTIVE_BONUS_TIER1_DAYS}/${RESELLER_ACTIVE_BONUS_TIER1_AMOUNT},` +
  `${RESELLER_ACTIVE_BONUS_TIER2_DAYS}/${RESELLER_ACTIVE_BONUS_TIER2_AMOUNT},` +
  `${RESELLER_ACTIVE_BONUS_TIER3_DAYS}/${RESELLER_ACTIVE_BONUS_TIER3_AMOUNT}`
);

function updateResellerBonusVars(partial) {
  try {
    const varsPath = path.join(__dirname, '.vars.json');

    let current = {};
    try {
      if (fs.existsSync(varsPath)) {
        const raw = fs.readFileSync(varsPath, 'utf8');
        current = JSON.parse(raw);
      }
    } catch (e) {
      logger.error(
        'Gagal baca .vars.json saat updateResellerBonusVars:',
        e.message || e
      );
    }

    const updated = Object.assign({}, current, partial);
    fs.writeFileSync(varsPath, JSON.stringify(updated, null, 2));
    vars = updated;

    logger.info(
      '[ResellerBonus] .vars.json diupdate untuk key: ' +
        Object.keys(partial).join(', ')
    );
  } catch (err) {
    logger.error(
      '[ResellerBonus] Gagal menulis .vars.json saat updateResellerBonusVars:',
      err.message || err
    );
  }
}

function getMonthRange(offsetMonths = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 1);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    year: start.getFullYear(),
    month: start.getMonth() + 1,
    monthKey: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
    label: start.toLocaleDateString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: 'long',
    }),
  };
}

function getResellerActiveBonusTiers() {
  const tiers = [
    {
      key: 'tier1',
      label: 'Tier 1',
      minDays: Number(RESELLER_ACTIVE_BONUS_TIER1_DAYS || 0),
      bonusAmount: Number(RESELLER_ACTIVE_BONUS_TIER1_AMOUNT || 0),
    },
    {
      key: 'tier2',
      label: 'Tier 2',
      minDays: Number(RESELLER_ACTIVE_BONUS_TIER2_DAYS || 0),
      bonusAmount: Number(RESELLER_ACTIVE_BONUS_TIER2_AMOUNT || 0),
    },
    {
      key: 'tier3',
      label: 'Tier 3',
      minDays: Number(RESELLER_ACTIVE_BONUS_TIER3_DAYS || 0),
      bonusAmount: Number(RESELLER_ACTIVE_BONUS_TIER3_AMOUNT || 0),
    },
  ].filter((t) => t.minDays > 0 && t.bonusAmount > 0);

  return tiers.sort((a, b) => a.minDays - b.minDays);
}

function pickHighestResellerActiveBonusTier(activeDays) {
  const days = Number(activeDays || 0);
  let picked = null;
  for (const tier of getResellerActiveBonusTiers()) {
    if (days >= tier.minDays) picked = tier;
  }
  return picked;
}

async function hasProcessedResellerActiveBonus(userId, monthKey) {
  return await new Promise((resolve) => {
    db.get(
      `SELECT id FROM reseller_bonus_logs WHERE user_id = ? AND period_month = ? LIMIT 1`,
      [userId, monthKey],
      (err, row) => {
        if (err) {
          logger.error('Gagal cek reseller_bonus_logs:', err.message || err);
          return resolve(false);
        }
        resolve(!!row);
      }
    );
  });
}

async function getResellerActiveBonusStats(userId, options = {}) {
  const uid = Number(userId || 0);
  const offsetMonths = Number(options.offsetMonths || 0);
  const monthRange = getMonthRange(offsetMonths);

  const base = {
    userId: uid,
    monthKey: monthRange.monthKey,
    monthLabel: monthRange.label,
    validActiveDays: 0,
    validAccounts: 0,
    validOmzet: 0,
    invalidShortAccounts: 0,
    invalidLowOmzetDays: 0,
    flaggedStatus: 'NORMAL',
    isReseller: isResellerId(uid),
    bonusEnabled: !!RESELLER_ACTIVE_BONUS_ENABLED,
    minDurationDays: Number(RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS || 0),
    minDailyOmzet: Number(RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET || 0),
    currentTier: null,
    nextTier: null,
    processed: false,
    processedAmount: 0,
  };

  if (!uid || Number.isNaN(uid)) return base;

  const flagStatus = await getUserFlagStatus(uid);
  base.flaggedStatus = flagStatus;

  const rows = await new Promise((resolve) => {
    db.all(
      `SELECT a.created_at, a.expires_at, a.type, a.server_id, s.harga
       FROM accounts a
       LEFT JOIN Server s ON s.id = a.server_id
       WHERE a.user_id = ?
         AND a.created_at >= ?
         AND a.created_at < ?
       ORDER BY a.created_at ASC`,
      [uid, monthRange.startMs, monthRange.endMs],
      (err, rows) => {
        if (err) {
          logger.error('Gagal ambil stats bonus reseller:', err.message || err);
          return resolve([]);
        }
        resolve(rows || []);
      }
    );
  });

  const dayMap = new Map();
  const dayMs = 24 * 60 * 60 * 1000;

  for (const acc of rows) {
    if (!acc || !acc.created_at || !acc.expires_at) continue;

    let durDays = Math.round((Number(acc.expires_at) - Number(acc.created_at)) / dayMs);
    if (durDays < 1) durDays = 1;

    if (durDays < Number(RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS || 0)) {
      base.invalidShortAccounts += 1;
      continue;
    }

    const dayKey = new Date(Number(acc.created_at)).toLocaleDateString('en-CA', {
      timeZone: TIME_ZONE,
    });
    const resellerCost = Math.floor(Number(acc.harga || 0) * Number(RESELLER_DISCOUNT || 0));
    const estimatedOmzet = resellerCost > 0 ? resellerCost : Number(acc.harga || 0) || 0;

    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, {
        dayKey,
        accounts: 0,
        omzet: 0,
      });
    }

    const entry = dayMap.get(dayKey);
    entry.accounts += 1;
    entry.omzet += estimatedOmzet;
  }

  for (const entry of dayMap.values()) {
    if (entry.omzet >= Number(RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET || 0)) {
      base.validActiveDays += 1;
      base.validAccounts += entry.accounts;
      base.validOmzet += entry.omzet;
    } else {
      base.invalidLowOmzetDays += 1;
    }
  }

  base.currentTier = pickHighestResellerActiveBonusTier(base.validActiveDays);
  const tiers = getResellerActiveBonusTiers();
  base.nextTier = tiers.find((tier) => tier.minDays > base.validActiveDays) || null;
  base.processed = await hasProcessedResellerActiveBonus(uid, monthRange.monthKey);
  if (base.processed) {
    const row = await new Promise((resolve) => {
      db.get(
        `SELECT bonus_amount FROM reseller_bonus_logs WHERE user_id = ? AND period_month = ? LIMIT 1`,
        [uid, monthRange.monthKey],
        (err, row) => resolve(row || null)
      );
    });
    base.processedAmount = Number(row?.bonus_amount || 0);
  }

  return base;
}

async function getEligibleResellerActiveBonusPreview(offsetMonths = -1) {
  const resellerSet = readResellerSetSync();
  const results = [];

  for (const idStr of resellerSet) {
    const userId = Number(idStr);
    if (!userId || Number.isNaN(userId)) continue;

    const stats = await getResellerActiveBonusStats(userId, { offsetMonths });
    if (stats.flaggedStatus === 'NAKAL') continue;
    if (!stats.currentTier) continue;

    results.push(stats);
  }

  results.sort((a, b) => {
    if (b.validActiveDays !== a.validActiveDays) return b.validActiveDays - a.validActiveDays;
    return b.validOmzet - a.validOmzet;
  });

  return results;
}

async function grantResellerActiveBonus({ userId, monthKey, activeDays, bonusAmount, tierLabel, processedBy }) {
  const uid = Number(userId || 0);
  const amount = Number(bonusAmount || 0);
  const adminId = Number(processedBy || 0);
  const refId = `reseller_active_bonus_${monthKey}_${uid}`;
  const now = Date.now();

  if (!uid || amount <= 0 || !monthKey) {
    return { ok: false, reason: 'invalid_params' };
  }

  return await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
        if (err) return reject(err);

        db.get(
          `SELECT id FROM reseller_bonus_logs WHERE user_id = ? AND period_month = ? LIMIT 1`,
          [uid, monthKey],
          (err0, existing) => {
            if (err0) return db.run('ROLLBACK', () => reject(err0));
            if (existing) return db.run('ROLLBACK', () => resolve({ ok: false, reason: 'already_processed' }));

            db.run(
              `UPDATE users SET saldo = saldo + ? WHERE user_id = ?`,
              [amount, uid],
              function (err1) {
                if (err1) return db.run('ROLLBACK', () => reject(err1));
                if (!this.changes) return db.run('ROLLBACK', () => resolve({ ok: false, reason: 'user_not_found' }));

                db.run(
                  `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
                   VALUES (?, ?, ?, ?, ?)`,
                  [uid, amount, 'reseller_active_bonus', refId, now],
                  (err2) => {
                    if (err2) return db.run('ROLLBACK', () => reject(err2));

                    db.run(
                      `INSERT INTO reseller_bonus_logs (
                        user_id, period_month, active_days, bonus_amount, tier_label, processed_at, processed_by, note
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                      [uid, monthKey, Number(activeDays || 0), amount, String(tierLabel || ''), now, adminId || null, 'Manual payout from admin menu'],
                      (err3) => {
                        if (err3) return db.run('ROLLBACK', () => reject(err3));
                        db.run('COMMIT', (err4) => {
                          if (err4) return reject(err4);
                          resolve({ ok: true, refId });
                        });
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
}

async function renderResellerBonusMenu(ctx, options = {}) {
  const isEdit = options.edit || false;
  const tiers = getResellerActiveBonusTiers();
  const statusText = RESELLER_ACTIVE_BONUS_ENABLED ? 'Aktif âœ…' : 'Nonaktif â›”';
  const monthInfo = getMonthRange(-1);

  const lines = [];
  lines.push('ðŸŽ *Bonus Reseller Aktif*');
  lines.push('');
  lines.push(`Status bonus          : *${statusText}*`);
  lines.push(`Durasi akun minimum   : *${RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS} hari*`);
  lines.push(`Omzet valid / hari    : *Rp${Number(RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET || 0).toLocaleString('id-ID')}*`);
  lines.push(`Periode preview/proses: *${monthInfo.label}*`);
  lines.push('');
  lines.push('*Tier bonus:*');
  tiers.forEach((tier) => {
    lines.push(`â€¢ ${tier.label}: *${tier.minDays} hari* â†’ *Rp${tier.bonusAmount.toLocaleString('id-ID')}*`);
  });
  lines.push('');
  lines.push('_Hanya akun berbayar dengan durasi minimum yang dihitung. Hari aktif hanya dihitung sekali per tanggal._');

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: RESELLER_ACTIVE_BONUS_ENABLED ? 'â›” Nonaktifkan' : 'âœ… Aktifkan',
          callback_data: 'admin_res_bonus_toggle'
        }
      ],
      [
        { text: 'âž–', callback_data: 'admin_res_bonus_mindur_dec' },
        { text: `Min Durasi: ${RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS}h`, callback_data: 'admin_res_bonus_nop' },
        { text: 'âž•', callback_data: 'admin_res_bonus_mindur_inc' }
      ],
      [
        { text: 'âž–', callback_data: 'admin_res_bonus_omzet_dec' },
        { text: `Min Omzet: Rp${Number(RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET || 0).toLocaleString('id-ID')}`, callback_data: 'admin_res_bonus_nop' },
        { text: 'âž•', callback_data: 'admin_res_bonus_omzet_inc' }
      ],
      [
        { text: 'Tier 1', callback_data: 'admin_res_bonus_nop' },
        { text: 'Hari -', callback_data: 'admin_res_bonus_t1_days_dec' },
        { text: `${RESELLER_ACTIVE_BONUS_TIER1_DAYS}h`, callback_data: 'admin_res_bonus_nop' },
        { text: 'Hari +', callback_data: 'admin_res_bonus_t1_days_inc' }
      ],
      [
        { text: 'Bonus -', callback_data: 'admin_res_bonus_t1_amt_dec' },
        { text: `Rp${Number(RESELLER_ACTIVE_BONUS_TIER1_AMOUNT || 0).toLocaleString('id-ID')}`, callback_data: 'admin_res_bonus_nop' },
        { text: 'Bonus +', callback_data: 'admin_res_bonus_t1_amt_inc' }
      ],
      [
        { text: 'Tier 2', callback_data: 'admin_res_bonus_nop' },
        { text: 'Hari -', callback_data: 'admin_res_bonus_t2_days_dec' },
        { text: `${RESELLER_ACTIVE_BONUS_TIER2_DAYS}h`, callback_data: 'admin_res_bonus_nop' },
        { text: 'Hari +', callback_data: 'admin_res_bonus_t2_days_inc' }
      ],
      [
        { text: 'Bonus -', callback_data: 'admin_res_bonus_t2_amt_dec' },
        { text: `Rp${Number(RESELLER_ACTIVE_BONUS_TIER2_AMOUNT || 0).toLocaleString('id-ID')}`, callback_data: 'admin_res_bonus_nop' },
        { text: 'Bonus +', callback_data: 'admin_res_bonus_t2_amt_inc' }
      ],
      [
        { text: 'Tier 3', callback_data: 'admin_res_bonus_nop' },
        { text: 'Hari -', callback_data: 'admin_res_bonus_t3_days_dec' },
        { text: `${RESELLER_ACTIVE_BONUS_TIER3_DAYS}h`, callback_data: 'admin_res_bonus_nop' },
        { text: 'Hari +', callback_data: 'admin_res_bonus_t3_days_inc' }
      ],
      [
        { text: 'Bonus -', callback_data: 'admin_res_bonus_t3_amt_dec' },
        { text: `Rp${Number(RESELLER_ACTIVE_BONUS_TIER3_AMOUNT || 0).toLocaleString('id-ID')}`, callback_data: 'admin_res_bonus_nop' },
        { text: 'Bonus +', callback_data: 'admin_res_bonus_t3_amt_inc' }
      ],
      [
        { text: 'ðŸ‘€ Preview Penerima', callback_data: 'admin_res_bonus_preview' }
      ],
      [
        { text: 'ðŸŽ Proses Bonus Bulan Lalu', callback_data: 'admin_res_bonus_process' }
      ],
      [
        { text: 'ðŸ”™ Kembali ke Menu Reseller', callback_data: 'admin_reseller_menu' }
      ]
    ]
  };

  const message = lines.join('\n');

  if (isEdit) {
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
      return;
    } catch (err) {
      logger.error('Gagal edit menu bonus reseller:', err.message || err);
    }
  }

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: replyMarkup,
  });
}

// Tanggal kadaluarsa lisensi bot...
let EXPIRE_DATE = vars.EXPIRE_DATE || envOr('EXPIRE_DATE', null);

// Timezone yang dipakai untuk tampilan jam/tanggal lisensi & scheduler
let TIME_ZONE = vars.TIME_ZONE || envOr('TIME_ZONE', 'Asia/Jayapura'); // default awal

logger.info(`Time zone init: ${TIME_ZONE}`);

// Helper: ambil tanggal & jam sesuai TIME_ZONE (bukan jam server)
function getTimeInConfiguredTimeZone() {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);

  const dateKey = `${year}-${month}-${day}`; // YYYY-MM-DD di timezone kita

  return { dateKey, hour, minute };
}

// ===== Tambahan: helper sisa hari akun (berdasarkan TANGGAL, bukan jam) =====
function getAccountDaysLeft(expiresAtMs) {
  if (!expiresAtMs) return null; // kalau nggak ada expires_at

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  const expDate = new Date(expiresAtMs);
  const expDayStart = new Date(
    expDate.getFullYear(),
    expDate.getMonth(),
    expDate.getDate()
  ).getTime();

  const diffDays = Math.round(
    (expDayStart - todayStart) / (1000 * 60 * 60 * 24)
  );

  return diffDays;
}
// ===== Akhir helper =====

function typeCode(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'vmess') return 'VM';
  if (t === 'vless') return 'VL';
  if (t === 'ssh') return 'SH';
  if (t === 'trojan') return 'TJ';
  if (t === 'shadowsocks') return 'SS';
  return (t.slice(0, 2) || '??').toUpperCase();
}

function shortStatus(expiresAtMs) {
  const daysLeft = getAccountDaysLeft(expiresAtMs);
  if (daysLeft === null || typeof daysLeft === 'undefined') return 'â“';
  if (daysLeft > 0) return `âœ…A${daysLeft}`;
  if (daysLeft === 0) return 'âš ï¸A0';
  return 'âŒX';
}
// State sederhana untuk admin (edit nama / harga server)
const adminState = {};

// State sesi pengumuman (broadcast) dari menu admin
// Key = id admin (number), value = { step, target, message }
const broadcastSessions = {};

// Ringkasan broadcast terakhir (hanya disimpan di memori, hilang kalau bot restart)
let lastBroadcastInfo = null;

// Inisialisasi bot
const bot = new Telegraf(BOT_TOKEN);

// ==== Helper: konversi Markdown lama -> HTML aman ====
function mdToHtml(text) {
  if (text == null) return '';
  let escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // `code`
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  // *bold*
  escaped = escaped.replace(/\*([^*]+)\*/g, '<b>$1</b>');

  return escaped;
}

// Patch ctx.reply supaya semua parse_mode: 'Markdown' diubah ke HTML
bot.use((ctx, next) => {
  const origReply = ctx.reply.bind(ctx);
  ctx.reply = (text, extra = {}) => {
    if (extra && extra.parse_mode === 'Markdown') {
      const htmlText = mdToHtml(text);
      const newExtra = { ...extra, parse_mode: 'HTML' };
      return origReply(htmlText, newExtra);
    }
    return origReply(text, extra);
  };
  return next();
});

// Patch bot.telegram.sendMessage & editMessageText juga
const origSendMessage = bot.telegram.sendMessage.bind(bot.telegram);
bot.telegram.sendMessage = (chatId, text, extra = {}) => {
  if (extra && extra.parse_mode === 'Markdown') {
    const htmlText = mdToHtml(text);
    const newExtra = { ...extra, parse_mode: 'HTML' };
    return origSendMessage(chatId, htmlText, newExtra);
  }
  return origSendMessage(chatId, text, extra);
};

const origEditMessageText = bot.telegram.editMessageText.bind(bot.telegram);
bot.telegram.editMessageText = (chatId, messageId, inlineMessageId, text, extra = {}) => {
  if (extra && extra.parse_mode === 'Markdown') {
    const htmlText = mdToHtml(text);
    const newExtra = { ...extra, parse_mode: 'HTML' };
    return origEditMessageText(chatId, messageId, inlineMessageId, htmlText, newExtra);
  }
  return origEditMessageText(chatId, messageId, inlineMessageId, text, extra);
};

// =====================================================
// Anti double-click / anti spam tombol inline
// =====================================================
const cbRateLimit = new Map();     // userId -> last timestamp
const cbSameDataLock = new Map();  // `${userId}:${data}` -> last timestamp

// Bersihkan cache biar tidak numpuk di memori
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of cbRateLimit) {
    if (now - ts > 5 * 60 * 1000) cbRateLimit.delete(k); // >5 menit
  }
  for (const [k, ts] of cbSameDataLock) {
    if (now - ts > 5 * 60 * 1000) cbSameDataLock.delete(k);
  }
}, 5 * 60 * 1000);

// Middleware callback_query (jalan untuk semua tombol inline)
bot.on('callback_query', async (ctx, next) => {
  try {
    const userId = ctx.from?.id;
    const data = ctx.callbackQuery?.data || '';
    const now = Date.now();

    if (!userId) return next();

    // Rate limit umum: cegah spam klik terlalu cepat
    const lastAny = cbRateLimit.get(userId) || 0;
    if (now - lastAny < 700) {
      await ctx.answerCbQuery('Pelan-pelan yaâ€¦');
      return;
    }
    cbRateLimit.set(userId, now);

    // Lock tombol yang sama: cegah klik tombol yang sama berulang
    const key = `${userId}:${data}`;
    const lastSame = cbSameDataLock.get(key) || 0;
    if (now - lastSame < 1500) {
      await ctx.answerCbQuery('Sedang diprosesâ€¦');
      return;
    }
    cbSameDataLock.set(key, now);

    return next();
  } catch (e) {
    // kalau answerCbQuery gagal, jangan bikin bot crash
    try { await ctx.answerCbQuery(); } catch (_) {}
    return next();
  }
});// =====================================================
// Helper menu bersih (edit/replace + hapus menu lama)
// =====================================================
const lastMenuMsgId = new Map(); // userId -> message_id bot terakhir (menu)

async function sendCleanMenu(ctx, text, extra = {}) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // 1) Kalau datang dari callback (klik tombol) -> EDIT pesan yang sama
  if (ctx.callbackQuery && ctx.update?.callback_query?.message) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...extra });
      // simpan id pesan yg sedang diedit
      const mid = ctx.update.callback_query.message.message_id;
      lastMenuMsgId.set(userId, mid);
      return;
    } catch (e) {
      // kalau gagal edit (misal pesan terlalu lama / beda jenis)
      // lanjut ke opsi hapus+kirim
    }
  }

  // 2) Kalau bukan callback (misal /menu, /start) -> hapus menu bot sebelumnya
  const prevId = lastMenuMsgId.get(userId);
  if (prevId) {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, prevId);
    } catch (e) {
      // bisa gagal kalau:
      // - di grup (bot gak punya hak delete)
      // - pesan sudah lama
      // biarin aja
    }
  }

  // 3) kirim menu baru
  const sent = await ctx.reply(text, { parse_mode: 'HTML', ...extra });
  if (sent?.message_id) lastMenuMsgId.set(userId, sent.message_id);
}

// === Helper notifikasi singkat ke user (cbQuery / edit menu) ===
async function toast(ctx, text, { alert = false } = {}) {
  try { await ctx.answerCbQuery(text, { show_alert: alert }); } catch (_) {}
}
async function toastError(ctx, text) {
  await toast(ctx, `âš ï¸ ${text}`);
}
async function showErrorOnMenu(ctx, htmlText) {
  await sendCleanMenu(ctx, `âš ï¸ <b>Terjadi kesalahan</b>\n${htmlText}`, { parse_mode: 'HTML' });
}

// === Template pesan standar (HTML) ===
function msgSuccess(t){ return `âœ… <b>Berhasil</b>\n${t}`; }
function msgError(t){ return `âŒ <b>Gagal</b>\n${t}`; }
function msgInfo(t){ return `â„¹ï¸ <b>Info</b>\n${t}`; }
function rupiah(n) {
  return `Rp${Number(n || 0).toLocaleString('id-ID')}`;
}

async function getUserSaldo(db, userId) {
  return await new Promise((resolve) => {
    db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (e, r) => {
      if (e) return resolve(null);
      resolve(r ? Number(r.saldo || 0) : null);
    });
  });
}


async function finalizeQrisPayment({ paymentRow, matchedTx, transactionType = 'qris_auto_topup', transactionRef = null }) {
  const row = paymentRow || {};
  const tx = matchedTx || {};

  const paymentId = Number(row.id || 0);
  const userId = Number(row.user_id || 0);
  const invoiceId = String(row.invoice_id || '').trim();
  const baseAmount = Number(row.base_amount || row.amount || 0);
  const paidAt = (() => {
    const raw =
      tx.transaction_time ||
      tx.time ||
      tx.paid_at ||
      tx.timestamp ||
      Date.now();
    const parsed =
      typeof raw === 'number'
        ? raw
        : new Date(String(raw).replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
  })();
  const matchedAt = Date.now();
  const providerPayloadJson = (() => {
    try { return JSON.stringify(tx); } catch (_) { return null; }
  })();

  if (!paymentId || !userId || !invoiceId || !Number.isFinite(baseAmount) || baseAmount <= 0) {
    throw new Error('Data finalize QRIS tidak valid');
  }

  return await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
        if (err) return reject(err);

        db.get(
          'SELECT id, status, paid_at FROM qris_payments WHERE id = ? LIMIT 1',
          [paymentId],
          (err0, current) => {
            if (err0) {
              return db.run('ROLLBACK', () => reject(err0));
            }
            if (!current) {
              return db.run('ROLLBACK', () => reject(new Error('Invoice QRIS tidak ditemukan')));
            }
            if (String(current.status || '').toLowerCase() === 'paid') {
              return db.run('ROLLBACK', () => resolve({ applied: false, alreadyPaid: true, paidAt: current.paid_at || null }));
            }

            db.run(
              `UPDATE qris_payments
                 SET status = 'paid',
                     paid_at = ?,
                     matched_at = ?,
                     provider_tx_id = ?,
                     provider_tx_time = ?,
                     provider_payment_type = ?,
                     provider_issuer = ?,
                     provider_status = ?,
                     provider_payload_json = ?
               WHERE id = ? AND status != 'paid'`,
              [
                paidAt,
                matchedAt,
                tx.transaction_id || tx.id || null,
                tx.transaction_time || tx.time || null,
                tx.payment_type || 'qris',
                tx.issuer || 'gopay',
                tx.transaction_status || tx.status || null,
                providerPayloadJson,
                paymentId,
              ],
              function (err1) {
                if (err1) {
                  return db.run('ROLLBACK', () => reject(err1));
                }
                if (!this.changes) {
                  return db.run('ROLLBACK', () => resolve({ applied: false, alreadyPaid: true, paidAt: current.paid_at || null }));
                }

                db.run(
                  'UPDATE users SET saldo = saldo + ? WHERE user_id = ?',
                  [baseAmount, userId],
                  function (err2) {
                    if (err2) {
                      return db.run('ROLLBACK', () => reject(err2));
                    }
                    if (!this.changes) {
                      return db.run('ROLLBACK', () => reject(new Error('User untuk topup QRIS tidak ditemukan')));
                    }

                    db.run(
                      `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
                       VALUES (?, ?, ?, ?, ?)`,
                      [userId, baseAmount, transactionType, transactionRef || `qris_${invoiceId}`, matchedAt],
                      (err3) => {
                        if (err3) {
                          return db.run('ROLLBACK', () => reject(err3));
                        }

                        db.run('COMMIT', (err4) => {
                          if (err4) return reject(err4);
                          resolve({ applied: true, alreadyPaid: false, paidAt, matchedAt });
                        });
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
}


async function applyQrisTopupBonus(userId, invoiceId, bonusAmount) {
  const uid = Number(userId || 0);
  const bonus = Number(bonusAmount || 0);
  const inv = String(invoiceId || '').trim();
  const refId = `qris_bonus_${inv}`;
  const now = Date.now();

  if (!uid || !inv || !Number.isFinite(bonus) || bonus <= 0) {
    return { applied: false, skipped: true };
  }

  return await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
        if (err) return reject(err);

        db.get(
          'SELECT id FROM transactions WHERE reference_id = ? LIMIT 1',
          [refId],
          (err0, existing) => {
            if (err0) {
              return db.run('ROLLBACK', () => reject(err0));
            }
            if (existing) {
              return db.run('ROLLBACK', () => resolve({ applied: false, alreadyApplied: true }));
            }

            db.run(
              'UPDATE users SET saldo = saldo + ? WHERE user_id = ?',
              [bonus, uid],
              function (err1) {
                if (err1) {
                  return db.run('ROLLBACK', () => reject(err1));
                }
                if (!this.changes) {
                  return db.run('ROLLBACK', () => reject(new Error('User bonus QRIS tidak ditemukan')));
                }

                db.run(
                  `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
                   VALUES (?, ?, ?, ?, ?)`,
                  [uid, bonus, 'qris_topup_bonus', refId, now],
                  (err2) => {
                    if (err2) {
                      return db.run('ROLLBACK', () => reject(err2));
                    }

                    db.run('COMMIT', (err3) => {
                      if (err3) return reject(err3);
                      resolve({ applied: true, alreadyApplied: false, refId });
                    });
                  }
                );
              }
            );
          }
        );
      });
    });
  });
}

async function notifyTopupSuccess({ bot, db, userId, baseAmount, bonusAmount, percent, ref, method }) {
  const total = Number(baseAmount || 0) + Number(bonusAmount || 0);
  const saldoNow = await getUserSaldo(db, userId);

  // Nama user untuk notif grup (aman kalau gagal ambil)
  let who = `UID:${userId}`;
  try {
    const chat = await bot.telegram.getChat(userId);
    if (chat?.username) who = `@${chat.username}`;
    else if (chat?.first_name) who = chat.first_name;
  } catch {}

  // 1) Notif ke user (rapi + informatif)
  const lines = [];
  lines.push(`âœ… <b>TOPUP BERHASIL</b>`);
  lines.push(`Metode: <b>${method || 'QRIS'}</b>`);
  lines.push(`Nominal: <b>${rupiah(baseAmount)}</b>`);
  if (Number(bonusAmount) > 0) {
    lines.push(`Bonus: <b>${rupiah(bonusAmount)}</b> <i>(${percent || 0}%)</i>`);
  }
  lines.push(`Total masuk: <b>${rupiah(total)}</b>`);
  if (saldoNow != null) lines.push(`Saldo sekarang: <b>${rupiah(saldoNow)}</b>`);
  lines.push(`Ref: <code>${ref}</code>`);
  lines.push(`\nTerima kasih ðŸ™`);

  try {
    await bot.telegram.sendMessage(userId, lines.join('\n'), { parse_mode: 'HTML' });
  } catch {}

// 2) Notif ke grup (kalau diaktifkan)
try {
  if (NOTIF_TOPUP_GROUP && GROUP_ID) {
    const saldoMasuk = Number(baseAmount || 0) + Number(bonusAmount || 0);

    const gLines = [];
    gLines.push(`âœ… <b>TOPUP SUCCESS</b>`);
    gLines.push(`â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`);
    gLines.push(`ðŸ‘¤ <b>User:</b> ${who}`);
    gLines.push(`ðŸ†” <b>ID:</b> <code>${userId}</code>`);
    gLines.push(`ðŸ’³ <b>Metode:</b> QRIS`);
    gLines.push(`ðŸ’° <b>Nominal:</b> ${rupiah(baseAmount)}`);
    gLines.push(`ðŸŽ <b>Bonus:</b> ${rupiah(bonusAmount || 0)}`);
    gLines.push(`ðŸ“¥ <b>Saldo Masuk:</b> ${rupiah(saldoMasuk)}`);
    gLines.push(`ðŸ§¾ <b>Ref:</b> <code>${ref}</code>`);
    gLines.push(`ðŸ•’ <b>Waktu:</b> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' })}`);
    gLines.push(`â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”`);

    await bot.telegram.sendMessage(GROUP_ID, gLines.join('\n'), { parse_mode: 'HTML' });
  }
} catch {}
}

async function notifyTopupExpired({ bot, userId, ref }) {
  const txt =
    `â° <b>QRIS Expired</b>\n` +
    `Ref: <code>${ref}</code>\n` +
    `QRIS kamu sudah lewat batas waktu.\n` +
    `Silakan buat QRIS baru dari menu topup.`;
  try { await bot.telegram.sendMessage(userId, txt, { parse_mode: 'HTML' }); } catch {}
}

// ===== Helper: indikator menunggu saat proses panjang =====
async function startWaiting(ctx, text = 'â³ Sedang membuat akun...') {
  const m = await ctx.reply(text, { parse_mode: 'Markdown' }).catch(() => null);
  let dots = 0;
  const timer = setInterval(async () => {
    dots = (dots + 1) % 4;
    try {
      if (m) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          m.message_id,
          undefined,
          text + '.'.repeat(dots),
          { parse_mode: 'Markdown' }
        );
      }
      await ctx.sendChatAction('typing').catch(() => {});
    } catch (_) {}
  }, 1200);
  return {
    async stop(finalText = null, keep = false) {
      clearInterval(timer);
      if (!m) return;
      try {
        if (finalText) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            m.message_id,
            undefined,
            finalText,
            { parse_mode: 'Markdown' }
          );
        } else if (!keep) {
          await ctx.telegram.deleteMessage(ctx.chat.id, m.message_id);
        }
      } catch (_) {}
    }
  };
}

// === Wizard state untuk flow create/trial (1 pesan aktif) ===
const flow = new Map(); // userId -> { mode:'trial'|'create', type:'ssh'|'vmess'|'vless'|'trojan'|'shadowsocks', step, payload:{} }

function startFlow(userId, mode, type) {
  flow.set(userId, { mode, type, step: 'pick_server', payload: {} });
}
function endFlow(userId) { flow.delete(userId); }
function getFlow(userId) { return flow.get(userId) || null; }


// Render pilih server
async function renderPickServer(ctx) {
  const userId = ctx.from.id;
  const st = getFlow(userId); if (!st) return;

  try {
    db.all(`SELECT id, nama_server FROM Server ORDER BY id ASC`, [], async (err, rows) => {
      if (err || !rows || rows.length === 0) {
        return showErrorOnMenu(ctx, 'Server tidak tersedia.');
      }
      const buttons = rows.map(s => [{ text: s.nama_server, callback_data: `flow_pick_server:${s.id}` }]);
      buttons.push([{ text: 'ðŸ”™ Kembali', callback_data: 'send_main_menu' }]);

      await sendCleanMenu(ctx,
        `<b>${st.mode === 'trial' ? 'Trial' : 'Buat Akun'} ${st.type.toUpperCase()}</b>\nPilih server:`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard: buttons } }
      );
    });
  } catch {
    return showErrorOnMenu(ctx, 'Gagal memuat daftar server.');
  }
}

// Render konfirmasi
async function renderConfirm(ctx) {
  const userId = ctx.from.id;
  const st = getFlow(userId); if (!st) return;

  const { serverId, username } = st.payload;
  const trialCfg = await getTrialConfig();
  const days = Math.max(1, Math.ceil(trialCfg.durationHours / 24));

  const srow = await new Promise((resolve)=> {
    db.get(`SELECT nama_server FROM Server WHERE id=?`, [serverId], (e, r) => resolve(r || null));
  });

  const namaServer = srow?.nama_server || `Server #${serverId}`;

  const msg = [
    `<b>Konfirmasi Trial ${st.type.toUpperCase()}</b>`,
    `Server   : <b>${namaServer}</b>`,
    `Username : <code>${username}</code>`,
    `Durasi   : ~<b>${trialCfg.durationHours} jam</b> (${days} hari dibulatkan)`,
  ].join('\n');

  const kb = [
    [{ text: 'âœ… Konfirmasi', callback_data: 'flow_confirm' }],
    [{ text: 'ðŸ”™ Ubah Server', callback_data: 'flow_back_server' }],
    [{ text: 'âŒ Batal', callback_data: 'flow_cancel' }],
  ];

  await sendCleanMenu(ctx, msg, { parse_mode:'HTML', reply_markup:{ inline_keyboard: kb } });
}

// =====================================================
// Pengaman transaksi penting (create / trial / renew / topup)
// Mencegah dobel proses walau callback terkirim ulang
// =====================================================
const txLock = new Map(); // userId -> { action, until }

function isTxAction(data = '') {
  return (
    data.startsWith('create_') ||   // create_ssh/vmess/vless/trojan...
    data.startsWith('renew_')  ||   // renew_ssh/vmess/vless/trojan...
    data.startsWith('trial_')  ||   // trial_ssh/vmess/vless/trojan...
    data === 'topup_manual'    ||   // topup manual QRIS
    data === 'topup_saldo'     ||   // kalau suatu saat kamu hidupkan lagi
    data === 'qris_topup_confirm_yes'
  );
}

bot.on('callback_query', async (ctx, next) => {
  const userId = ctx.from?.id;
  const data = ctx.callbackQuery?.data || '';
  if (!userId || !isTxAction(data)) return next();

  const now = Date.now();
  const lock = txLock.get(userId);

  // kalau masih dalam lock window, hentikan proses
  if (lock && now < lock.until) {
    await ctx.answerCbQuery(`â³ Sedang diproses (${lock.action})`, { show_alert: false });
    return;
  }

  // set lock 25 detik (cukup untuk create/renew/trial/topup)
  txLock.set(userId, { action: data, until: now + 25 * 1000 });

  try {
    await next();
  } finally {
    // lepas lock setelah handler selesai (normalnya cepat)
    // tapi kalau handler async lama, lock tetap aman karena ada auto-timeout
    txLock.delete(userId);
  }
});

let ADMIN_USERNAME = '';
const pendingGopayApiKeyInput = new Map();
const GOPAY_APIKEY_INPUT_TIMEOUT_MS = 5 * 60 * 1000;

function normalizeGopayCredentialInput(text) {
  return String(text || '').trim();
}

function startPendingGopayApiKeyInput(userId) {
  pendingGopayApiKeyInput.set(userId, Date.now() + GOPAY_APIKEY_INPUT_TIMEOUT_MS);
}

function clearPendingGopayApiKeyInput(userId) {
  pendingGopayApiKeyInput.delete(userId);
}

function hasPendingGopayApiKeyInput(userId) {
  const expiresAt = pendingGopayApiKeyInput.get(userId);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    pendingGopayApiKeyInput.delete(userId);
    return false;
  }
  return true;
}

// Ubah ADMIN_IDS_RAW jadi array angka
const adminIds = Array.isArray(ADMIN_IDS_RAW)
  ? ADMIN_IDS_RAW.map((id) => Number(id))
  : String(ADMIN_IDS_RAW)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));

// Alias lama supaya kode yang pakai ADMIN_IDS masih jalan
const ADMIN_IDS = adminIds;

logger.info(`Admin IDs: ${adminIds.join(', ')}`);
logger.info('Bot initialized');

async function handleSetGopayApiKey(ctx) {
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const text = normalizeGopayCredentialInput(ctx.message?.text || '');
  const inlineApiKey = text
    .replace(/^\/setgopayapikey(?:@\w+)?\s*/i, '')
    .trim();
  const repliedText = normalizeGopayCredentialInput(
    ctx.message?.reply_to_message?.text ||
    ctx.message?.reply_to_message?.caption ||
    ''
  );
  const apiKey = inlineApiKey || repliedText;

  if (!apiKey) {
    startPendingGopayApiKeyInput(ctx.from.id);
    return ctx.reply(
      'ðŸ” <b>Mode input API key GoPay aktif.</b>\n\n' +
      'Silakan kirim API key baru pada pesan berikutnya.\n' +
      'API key akan disimpan ke <code>.vars.json</code> dan langsung dipakai tanpa restart.\n\n' +
      'Alternatif cepat:\n' +
      'â€¢ <code>/setgopayapikey API_KEY_BARU</code>\n' +
      'â€¢ reply pesan API key dengan <code>/setgopayapikey</code>\n\n' +
      'Alias lama <code>/setgopaytoken</code> masih didukung.\n' +
      'Mode ini berlaku 5 menit atau sampai API key berhasil disimpan.\n' +
      'Ketik <code>/batalsetgopayapikey</code> untuk membatalkan.',
      { parse_mode: 'HTML' }
    );
  }

  try {
    writeVarsPartial({ GOPAY_API_KEY: apiKey });
    clearPendingGopayApiKeyInput(ctx.from.id);
    logger.info(`GOPAY_API_KEY diperbarui oleh admin ${ctx.from.id}`);

    return ctx.reply(
      'âœ… <b>GOPAY_API_KEY berhasil diperbarui.</b>\n\n' +
      'Request GoPay berikutnya akan langsung memakai API key baru tanpa restart bot.',
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('Gagal menyimpan GOPAY_API_KEY:', e.message || e);
    return ctx.reply(
      'âŒ <b>Gagal menyimpan GOPAY_API_KEY.</b>\n' +
      `<code>${String(e.message || e)}</code>`,
      { parse_mode: 'HTML' }
    );
  }
}

async function handleCancelGopayApiKeyInput(ctx) {
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  clearPendingGopayApiKeyInput(ctx.from.id);
  return ctx.reply('âœ… Mode input API key GoPay dibatalkan.', { parse_mode: 'HTML' });
}

bot.command('setgopayapikey', handleSetGopayApiKey);
bot.command('batalsetgopayapikey', handleCancelGopayApiKeyInput);

bot.on('text', async (ctx, next) => {
  if (!ensurePrivateChat(ctx)) return next();
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) return next();
  if (!hasPendingGopayApiKeyInput(ctx.from.id)) return next();

  const text = normalizeGopayCredentialInput(ctx.message?.text || '');
  if (!text || text.startsWith('/')) return next();

  try {
    writeVarsPartial({ GOPAY_API_KEY: text });
    clearPendingGopayApiKeyInput(ctx.from.id);
    logger.info(`GOPAY_API_KEY diperbarui via mode input oleh admin ${ctx.from.id}`);

    return ctx.reply(
      'âœ… <b>GOPAY_API_KEY berhasil diperbarui.</b>\n\n' +
      'Request GoPay berikutnya akan langsung memakai API key baru tanpa restart bot.',
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('Gagal menyimpan GOPAY_API_KEY via mode input:', e.message || e);
    return ctx.reply(
      'âŒ <b>Gagal menyimpan GOPAY_API_KEY.</b>\n' +
      `<code>${String(e.message || e)}</code>`,
      { parse_mode: 'HTML' }
    );
  }
});

async function handleCheckGopayApiKey(ctx) {
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  try {
    const activeApiKey = getGopayApiKey();
    const maskedApiKey = maskToken(activeApiKey);
    const transactions = await fetchGopayTransactions();
    return ctx.reply(
      `âœ… <b>API key GoPay valid.</b>\n\nAPI key aktif: <code>${maskedApiKey}</code>\nEndpoint: <code>${GOPAY_API_BASE_URL}/transactions</code>\nBerhasil ambil <b>${transactions.length}</b> transaksi dari endpoint mutasi.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    const status = e?.response?.status;
    const apiMsg = e?.response?.data?.message || e?.message || e;
    logger.error(`Cek GOPAY API key gagal (${status || 'no-status'}): ${apiMsg}`);
    return ctx.reply(
      'âŒ <b>API key GoPay gagal dipakai.</b>\n\n' +
      `Status: <code>${status || '-'}</code>\n` +
      `Pesan: <code>${String(apiMsg)}</code>`,
      { parse_mode: 'HTML' }
    );
  }
}

bot.command('cekgopayapikey', handleCheckGopayApiKey);

// ====== FUNGSI INFO LISENSI BOT ======
function getLicenseInfo() {
  if (!EXPIRE_DATE) return null;

  // Anggap EXPIRE_DATE dalam format "YYYY-MM-DD"
  const now = new Date();
  const expire = new Date(EXPIRE_DATE + 'T23:59:59');

  const diffMs   = expire - now;
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // dibulatkan ke atas

  return { expire, daysLeft };
}
// ====== AKHIR FUNGSI INFO LISENSI ======

// === MIDDLEWARE KUNCI LISENSI ===
bot.use(async (ctx, next) => {
  // Kalau EXPIRE_DATE belum di-set â†’ anggap free, jangan blokir
  if (!EXPIRE_DATE) {
    return next();
  }

  const info = getLicenseInfo();
  if (!info) {
    return next();
  }

  // Kalau lisensi masih aktif â†’ lanjut ke handler berikutnya
  if (info.daysLeft > 0) {
    return next();
  }

  // Kalau yang akses adalah MASTER â†’ tetap boleh lanjut (biar bisa /addhari dll)
  if (ctx.from && ctx.from.id === MASTER_ID) {
    return next();
  }

  // Selain MASTER: blokir, kasih info lisensi habis
  try {
    await ctx.reply(
      'â›” *Bot sementara nonaktif karena lisensi sudah habis.*\n' +
      'Silakan hubungi owner untuk perpanjang.',
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    // kalau gagal kirim pesan, diamkan saja
  }

  // Jangan lanjut ke handler lain
  return;
});

// Update tanggal lisensi di memori & di file .vars.json
function setLicenseExpireDate(newDateStr) {
  EXPIRE_DATE = newDateStr;
  try {
    // update object vars di memori
    vars.EXPIRE_DATE = newDateStr;

    // tulis ulang ke file
    fs.writeFileSync(VARS_PATH, JSON.stringify(vars, null, 2));

    logger.info(`EXPIRE_DATE updated to ${newDateStr} in .vars.json`);
  } catch (e) {
    logger.error('Gagal mengupdate EXPIRE_DATE di .vars.json:', e.message);
  }
}

// Simpan timezone ke .vars.json
function saveTimeZoneConfig() {
  try {
    vars.TIME_ZONE = TIME_ZONE;
    fs.writeFileSync(VARS_PATH, JSON.stringify(vars, null, 2));
    logger.info(`TIME_ZONE disimpan: ${TIME_ZONE}`);
  } catch (e) {
    logger.error('Gagal menyimpan TIME_ZONE ke .vars.json:', e.message || e);
  }
}

// Simpan pengaturan auto-backup ke .vars.json
function saveAutoBackupConfig() {
  try {
    // update object vars di memori
    vars.AUTO_BACKUP_ENABLED = AUTO_BACKUP_ENABLED;
    vars.AUTO_BACKUP_INTERVAL_HOURS = AUTO_BACKUP_INTERVAL_HOURS;

    // tulis ulang ke file
    fs.writeFileSync(VARS_PATH, JSON.stringify(vars, null, 2));

    logger.info(
      `AUTO_BACKUP disimpan: enabled=${AUTO_BACKUP_ENABLED}, interval=${AUTO_BACKUP_INTERVAL_HOURS} jam`
    );
  } catch (e) {
    logger.error('Gagal menyimpan AUTO_BACKUP ke .vars.json:', e.message);
  }
}

// Simpan pengaturan pengingat expired ke .vars.json
function saveExpiryReminderConfig() {
  try {
    // update object vars di memori
    vars.EXPIRY_REMINDER_ENABLED = EXPIRY_REMINDER_ENABLED;
    vars.EXPIRY_REMINDER_HOUR = EXPIRY_REMINDER_HOUR;
    vars.EXPIRY_REMINDER_MINUTE = EXPIRY_REMINDER_MINUTE;
    vars.EXPIRY_REMINDER_DAYS_BEFORE = EXPIRY_REMINDER_DAYS_BEFORE;

    // tulis ulang ke file
    fs.writeFileSync(VARS_PATH, JSON.stringify(vars, null, 2));

    logger.info(
      `EXPIRY_REMINDER disimpan: enabled=${EXPIRY_REMINDER_ENABLED}, time=${EXPIRY_REMINDER_HOUR}:${String(
        EXPIRY_REMINDER_MINUTE
      ).padStart(2, '0')}, H-${EXPIRY_REMINDER_DAYS_BEFORE}`
    );
  } catch (e) {
    logger.error(
      'Gagal menyimpan pengingat expired ke .vars.json:',
      e.message
    );
  }
}

// Kirim backup otomatis ke BACKUP_CHAT_ID
async function sendAutoBackup(reason = 'backup otomatis') {
  try {
    if (!BACKUP_CHAT_ID) {
      logger.warn('BACKUP_CHAT_ID kosong, lewati backup otomatis.');
      return;
    }

    const candidateFiles = [
      './sellvpn.db',
      './ressel.db',
      './trial.db',
    ];

    const files = candidateFiles.filter((filePath) => fs.existsSync(filePath));

    if (files.length === 0) {
      await bot.telegram.sendMessage(
        BACKUP_CHAT_ID,
        'âš ï¸ Backup otomatis gagal: tidak ada file yang ditemukan.'
      );
      return;
    }

    const waktu = new Date().toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    await bot.telegram.sendMessage(
      BACKUP_CHAT_ID,
      `ðŸ—„ï¸ Mulai backup otomatis.\nAlasan: <b>${reason}</b>\nWaktu: <b>${waktu}</b>`,
      { parse_mode: 'HTML' }
    );

    for (const filePath of files) {
      const filename = filePath.replace('./', '');

      try {
        await bot.telegram.sendDocument(
          BACKUP_CHAT_ID,
          { source: filePath, filename },
          {
            caption: `ðŸ“¦ Backup: <b>${filename}</b>\nWaktu: <b>${waktu}</b>`,
            parse_mode: 'HTML',
          }
        );
      } catch (err) {
        logger.error(`âŒ Gagal kirim backup file ${filename}: ${err.message}`);
      }
    }

    await bot.telegram.sendMessage(
      BACKUP_CHAT_ID,
      `âœ… Backup otomatis selesai.\nTotal file: <b>${files.length}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    logger.error('âŒ Error di sendAutoBackup:', err);
  }
}

// Start / restart scheduler auto-backup
function restartAutoBackupScheduler() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }

  if (!AUTO_BACKUP_ENABLED || AUTO_BACKUP_INTERVAL_HOURS <= 0) {
    logger.info('Auto-backup nonaktif atau interval tidak valid, scheduler tidak jalan.');
    return;
  }

  const intervalMs = AUTO_BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;

  autoBackupTimer = setInterval(() => {
    sendAutoBackup(`backup otomatis tiap ${AUTO_BACKUP_INTERVAL_HOURS} jam`).catch((err) => {
      logger.error('âŒ Gagal menjalankan backup otomatis:', err);
    });
  }, intervalMs);

  logger.info(
    `Auto-backup aktif setiap ${AUTO_BACKUP_INTERVAL_HOURS} jam (~${intervalMs / 1000} detik).`
  );
}

(async () => {
  try {
    const adminId = Array.isArray(adminIds) ? adminIds[0] : adminIds;
    const chat = await bot.telegram.getChat(adminId);
    ADMIN_USERNAME = chat.username ? `@${chat.username}` : 'Admin';
    logger.info(`Admin username detected: ${ADMIN_USERNAME}`);
  } catch (e) {
    ADMIN_USERNAME = 'Admin';
    logger.warn('Tidak bisa ambil username admin otomatis.');
  }
})();
/////
const db = new sqlite3.Database('./sellvpn.db', (err) => {
  if (err) {
    logger.error('Kesalahan koneksi SQLite3:', err.message);
  } else {
    logger.info('Terhubung ke SQLite3');
  }
});

const SQL_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function isSafeSqlIdent(name) {
  return typeof name === 'string' && SQL_IDENT_RE.test(name);
}
function isSafeSqlIdentList(csv) {
  if (typeof csv !== 'string') return false;
  return csv.split(',').every((part) => isSafeSqlIdent(part.trim()));
}

function ensureSqliteColumn(tableName, columnName, columnType) {
  if (!tableName || !columnName || !columnType) return;
  if (!isSafeSqlIdent(tableName) || !isSafeSqlIdent(columnName)) {
    logger.warn(`ensureSqliteColumn: identifier tidak valid (${tableName}.${columnName})`);
    return;
  }

  db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
    if (err) {
      logger.warn(`Gagal cek kolom ${tableName}.${columnName}: ${err.message}`);
      return;
    }

    const exists = Array.isArray(rows) && rows.some((row) => row && row.name === columnName);
    if (exists) return;

    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`, (alterErr) => {
      if (alterErr) {
        const msg = String(alterErr.message || '');
        if (!msg.includes('duplicate column name')) {
          logger.warn(`Gagal menambah kolom ${tableName}.${columnName}: ${msg}`);
        }
        return;
      }

      logger.info(`Kolom SQLite ditambahkan: ${tableName}.${columnName} (${columnType})`);
    });
  });
}

function createUniqueIndexIfSafe(indexName, tableName, columnName, whereClause = '') {
  if (!indexName || !tableName || !columnName) return;
  if (!isSafeSqlIdent(indexName) || !isSafeSqlIdent(tableName) || !isSafeSqlIdent(columnName)) {
    logger.warn(`createUniqueIndexIfSafe: identifier tidak valid (${indexName}/${tableName}/${columnName})`);
    return;
  }

  const whereSql = whereClause ? ` WHERE ${whereClause}` : '';
  const duplicateQuery = `
    SELECT ${columnName} AS value, COUNT(*) AS cnt
    FROM ${tableName}
    ${whereSql}
    GROUP BY ${columnName}
    HAVING COUNT(*) > 1
    LIMIT 1
  `;

  db.get(duplicateQuery, [], (dupErr, row) => {
    if (dupErr) {
      logger.warn(`Gagal cek duplikat untuk index ${indexName}: ${dupErr.message}`);
      return;
    }

    if (row) {
      logger.warn(`Index unik ${indexName} dilewati karena masih ada data duplikat di ${tableName}.${columnName}`);
      return;
    }

    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnName})${whereSql}`, (indexErr) => {
      if (indexErr) {
        logger.warn(`Gagal membuat unique index ${indexName}: ${indexErr.message}`);
        return;
      }

      logger.info(`Unique index siap: ${indexName}`);
    });
  });
}
function createUniqueIndexMultiIfSafe(indexName, tableName, columns) {
  if (!indexName || !tableName || !columns) return;
  if (!isSafeSqlIdent(indexName) || !isSafeSqlIdent(tableName) || !isSafeSqlIdentList(columns)) {
    logger.warn(`createUniqueIndexMultiIfSafe: identifier tidak valid (${indexName}/${tableName}/${columns})`);
    return;
  }

  const duplicateQuery = `
    SELECT ${columns}, COUNT(*) AS cnt
    FROM ${tableName}
    GROUP BY ${columns}
    HAVING COUNT(*) > 1
    LIMIT 1
  `;

  db.get(duplicateQuery, [], (dupErr, row) => {
    if (dupErr) {
      logger.warn(`Gagal cek duplikat untuk index ${indexName}: ${dupErr.message}`);
      return;
    }

    if (row) {
      logger.warn(`Index unik ${indexName} dilewati karena masih ada data duplikat di ${tableName}(${columns})`);
      return;
    }

    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columns})`,
      (indexErr) => {
        if (indexErr) {
          logger.warn(`Gagal membuat unique index ${indexName}: ${indexErr.message}`);
          return;
        }
        logger.info(`Unique index siap: ${indexName}`);
      }
    );
  });
}
// ============================================================================
// SECTION: PAYMENT - DATABASE TABLES
// - pending_deposits  : topup manual via QRIS
// - qris_payments     : topup otomatis (GoPay QRIS)
// ============================================================================
db.run(`CREATE TABLE IF NOT EXISTS pending_deposits (
  unique_code TEXT PRIMARY KEY,
  user_id INTEGER,
  amount INTEGER,
  original_amount INTEGER,
  timestamp INTEGER,
  status TEXT,
  qr_message_id INTEGER
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel pending_deposits:', err.message);
  }
});


db.run(`CREATE TABLE IF NOT EXISTS qris_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  invoice_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  base_amount INTEGER NOT NULL,
  unique_suffix INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  matched_at INTEGER,
  provider_tx_id TEXT,
  provider_tx_time TEXT,
  provider_payment_type TEXT,
  provider_issuer TEXT,
  provider_status TEXT,
  provider_payload_json TEXT
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel qris_payments:', err.message);
  }
});

ensureSqliteColumn('qris_payments', 'matched_at', 'INTEGER');
ensureSqliteColumn('qris_payments', 'provider_tx_id', 'TEXT');
ensureSqliteColumn('qris_payments', 'provider_tx_time', 'TEXT');
ensureSqliteColumn('qris_payments', 'provider_payment_type', 'TEXT');
ensureSqliteColumn('qris_payments', 'provider_issuer', 'TEXT');
ensureSqliteColumn('qris_payments', 'provider_status', 'TEXT');
ensureSqliteColumn('qris_payments', 'provider_payload_json', 'TEXT');
createUniqueIndexIfSafe('idx_qris_payments_invoice_unique', 'qris_payments', 'invoice_id');

// =================== AUTO TOPUP QRIS (MODEL MUTASI: pending_deposits) ===================

// Simpan deposit yang sedang menunggu pembayaran (di memory)
global.pendingDeposits = global.pendingDeposits || {};

// Anti dobel proses di PM2 cluster: hanya instance 0 yang polling
const IS_PRIMARY_INSTANCE =
  !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

let lastPollTime = 0;
const POLL_INTERVAL = 10000;          // 10 detik (mirip temanmu)
const DEPOSIT_EXPIRE_MS = 5 * 60 * 1000; // 5 menit

function parseKreditFromResponse(text) {
  // format dari temanmu: ada "Kredit: 10.123"
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

async function markDepositExpired(uniqueCode, bot, db, logger) {
  await new Promise((resolve) => {
    db.run(
      `UPDATE pending_deposits SET status=? WHERE unique_code=? AND status=?`,
      ['expired', uniqueCode, 'pending'],
      () => resolve()
    );
  });

  const d = global.pendingDeposits[uniqueCode];
  if (d) {
    try {
      const text =
  `â° <b>QRIS EXPIRED</b>\n` +
  `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
  `Pembayaran tidak kami terima dalam batas waktu.\n` +
  `Silakan buat QRIS baru dari menu topup.\n` +
  `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
  `Ref: <code>${uniqueCode}</code>`;

      await bot.telegram.sendMessage(d.userId, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ðŸ  Menu Utama', callback_data: 'send_main_menu' }],
          ],
        },
      });
    } catch {}

  }

  delete global.pendingDeposits[uniqueCode];
}

async function creditDeposit(uniqueCode, bot, db, logger, matchedTx = null) {
  const d = global.pendingDeposits[uniqueCode];
  if (!d) return false;

  const now = Date.now();

  // SALDO MASUK: pakai nominal topup asli (tanpa angka unik)
  // Kalau kamu mau saldo masuk = yang dibayar, ubah jadi: const credit = d.amount;
  const credit = d.originalAmount;
  const providerPayloadJson = matchedTx ? JSON.stringify(matchedTx) : null;
  const providerTxId = matchedTx ? (String(matchedTx.id || matchedTx.transaction_id || matchedTx.tx_id || '').trim() || null) : null;
  const providerTxTime = matchedTx ? (matchedTx.time || matchedTx.created_at || matchedTx.updated_at || matchedTx.transaction_time || null) : null;
  const providerIssuer = matchedTx ? (String(matchedTx.issuer || '').trim() || null) : null;
  const providerPaymentType = matchedTx ? (String(matchedTx.payment_type || '').trim() || null) : null;
  const providerStatus = matchedTx ? (String(matchedTx.status || '').trim() || null) : null;

  const applied = await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION', (beginErr) => {
        if (beginErr) return reject(beginErr);

        // Pastikan hanya proses sekali (status masih pending)
        db.run(
          `UPDATE pending_deposits SET status=? WHERE unique_code=? AND status=?`,
          ['paid', uniqueCode, 'pending'],
          function (err1) {
            if (err1) {
              db.run('ROLLBACK');
              return reject(err1);
            }
            if ((this.changes || 0) === 0) {
              db.run('ROLLBACK');
              return resolve(false);
            }

            db.run(
              `UPDATE users SET saldo = saldo + ? WHERE user_id = ?`,
              [credit, d.userId],
              function (err2) {
                if (err2) {
                  db.run('ROLLBACK');
                  return reject(err2);
                }
                if ((this.changes || 0) === 0) {
                  db.run('ROLLBACK');
                  return reject(new Error('User topup manual tidak ditemukan'));
                }

                db.run(
                  `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
                   VALUES (?, ?, ?, ?, ?)`,
                  [d.userId, credit, 'qris_auto_topup', uniqueCode, now],
                  (err3) => {
                    if (err3) {
                      db.run('ROLLBACK');
                      return reject(err3);
                    }

                    if (!providerPayloadJson) {
                      return db.run('COMMIT', (err4) => (err4 ? reject(err4) : resolve(true)));
                    }

                    db.run(
                      `INSERT INTO qris_payments (
                        user_id,
                        invoice_id,
                        amount,
                        base_amount,
                        unique_suffix,
                        status,
                        created_at,
                        paid_at,
                        matched_at,
                        provider_tx_id,
                        provider_tx_time,
                        provider_payment_type,
                        provider_issuer,
                        provider_status,
                        provider_payload_json
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;
    const waktu = new Date().toLocaleString('id-ID', { timeZone: TIME_ZONE });

    const text =
      `âœ… <b>TOPUP BERHASIL</b>
` +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
` +
      `ðŸ’° <b>Saldo Masuk</b> : <b>${rupiah(credit)}</b>
` +
      `ðŸ§¾ <b>Ref</b>        : <code>${uniqueCode}</code>
` +
      `ðŸ•’ <b>Waktu</b>      : ${waktu}
` +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
` +
      `Terima kasih ðŸ™`;

    await bot.telegram.sendMessage(d.userId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ðŸ  Menu Utama', callback_data: 'send_main_menu' }],
        ],
      },
    });
  } catch {}

  delete global.pendingDeposits[uniqueCode];
  return true;
}

async function pollMutasi(bot, db, logger, axios) {
  global.mutasiBlockedUntil = global.mutasiBlockedUntil || 0;
  if (Date.now() < global.mutasiBlockedUntil) return;

  const now = Date.now();
  if (now - lastPollTime < POLL_INTERVAL) return;
  lastPollTime = now;

  const pendingList = Object.entries(global.pendingDeposits)
    .filter(([_, d]) => d.status === 'pending');

  if (pendingList.length === 0) return;

  try {
    const transactions = await fetchGopayTransactions();

    for (const [uniqueCode, d] of pendingList) {
      const expiresAt = d.expiresAt || (d.timestamp ? (d.timestamp + DEPOSIT_EXPIRE_MS) : 0);
      if (expiresAt && now > expiresAt) {
        await markDepositExpired(uniqueCode, bot, db, logger);
        continue;
      }

      const matched = findMatchingSettlementTransaction(transactions, d.amount, {
        createdAt: d.timestamp,
        timeWindowMs: DEPOSIT_EXPIRE_MS,
      });
      if (matched) {
        await creditDeposit(uniqueCode, bot, db, logger, matched);
      }
    }
  } catch (e) {
    const status = e?.response?.status;
    const msg = e?.response?.data?.message || e?.message || e;
    logger.error(`âŒ Poll mutasi GoPay error (${status || 'no-status'}): ${msg}`);
  }
}


function startAutoTopupMutasi(bot, db, logger, axios) {
  if (!IS_PRIMARY_INSTANCE) {
    logger.info('â„¹ï¸ Auto-topup mutasi nonaktif di instance non-primary (PM2 cluster).');
    return;
  }

  setInterval(() => pollMutasi(bot, db, logger, axios), 2000);
  logger.info('âœ… Auto-topup QRIS (mutasi) aktif.');
}

// ======================= END SECTION: PAYMENT - DATABASE TABLES =============

// ============================================================================


db.run(`CREATE TABLE IF NOT EXISTS Server (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT,
  auth TEXT,
  harga INTEGER,
  nama_server TEXT,
  quota INTEGER,
  iplimit INTEGER,
  batas_create_akun INTEGER,
  total_create_akun INTEGER,
  is_reseller_only INTEGER DEFAULT 0
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel Server:', err.message);
  } else {
    logger.info('Server table created or already exists');
  }
});

db.run("UPDATE Server SET total_create_akun = 0 WHERE total_create_akun IS NULL", function(err) {
  if (err) {
    logger.error('Error fixing NULL total_create_akun:', err.message);
  } else {
    if (this.changes > 0) {
      logger.info(`âœ… Fixed ${this.changes} servers with NULL total_create_akun`);
    }
  }
});

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  saldo INTEGER DEFAULT 0,
  CONSTRAINT unique_user_id UNIQUE (user_id)
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel users:', err.message);
  } else {
    logger.info('Users table created or already exists');
  }
});

// Upgrade tabel users: tambahkan kolom flag_status dan flag_note jika belum ada
db.get('SELECT flag_status FROM users LIMIT 1', (err, row) => {
  if (err && err.message && err.message.includes('no such column')) {
    logger.info('Menambahkan kolom flag_status dan flag_note ke tabel users...');

    db.run(
      "ALTER TABLE users ADD COLUMN flag_status TEXT DEFAULT 'NORMAL'",
      (err2) => {
        if (err2) {
          logger.error('Kesalahan menambahkan kolom flag_status:', err2.message);
        } else {
          logger.info('Kolom flag_status berhasil ditambahkan ke tabel users');
        }
      }
    );

    db.run('ALTER TABLE users ADD COLUMN flag_note TEXT', (err3) => {
      if (err3) {
        logger.error('Kesalahan menambahkan kolom flag_note:', err3.message);
      } else {
        logger.info('Kolom flag_note berhasil ditambahkan ke tabel users');
      }
    });
  }
});


db.run(`CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  type TEXT,
  reference_id TEXT,
  timestamp INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel transactions:', err.message);
  } else {
    logger.info('Transactions table created or already exists');

    // Add reference_id column if it doesn't exist
    db.get("PRAGMA table_info(transactions)", (err, rows) => {
      if (err) {
        logger.error('Kesalahan memeriksa struktur tabel:', err.message);
        return;
      }

      db.get("SELECT * FROM transactions WHERE reference_id IS NULL LIMIT 1", (err, row) => {
        if (err && err.message.includes('no such column')) {
          // Column doesn't exist, add it
          db.run("ALTER TABLE transactions ADD COLUMN reference_id TEXT", (err) => {
            if (err) {
              logger.error('Kesalahan menambahkan kolom reference_id:', err.message);
            } else {
              logger.info('Kolom reference_id berhasil ditambahkan ke tabel transactions');
            }
          });
        } else if (row) {
          // Update existing transactions with reference_id
          db.all("SELECT id, user_id, type, timestamp FROM transactions WHERE reference_id IS NULL", [], (err, rows) => {
            if (err) {
              logger.error('Kesalahan mengambil transaksi tanpa reference_id:', err.message);
              return;
            }

            rows.forEach(row => {
              const referenceId = `account-${row.type}-${row.user_id}-${row.timestamp}`;
              db.run("UPDATE transactions SET reference_id = ? WHERE id = ?", [referenceId, row.id], (err) => {
                if (err) {
                  logger.error(`Kesalahan mengupdate reference_id untuk transaksi ${row.id}:`, err.message);
                } else {
                  logger.info(`Berhasil mengupdate reference_id untuk transaksi ${row.id}`);
                }
              });
            });
          });
        }
      });
    });
    createUniqueIndexIfSafe('idx_transactions_reference_unique', 'transactions', 'reference_id', 'reference_id IS NOT NULL');
  }
});

function recordSaldoTransaction(userId, amount, type, referenceId) {
  db.run(
    `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, amount, type, referenceId || null, Date.now()],
    (err) => {
      if (err) {
        logger.error(
          'Kesalahan mencatat transaksi saldo:',
          err.message
        );
      }
    }
  );
}

db.run(`CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  type TEXT,
  server_id INTEGER,
  created_at INTEGER,
  expires_at INTEGER
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel accounts:', err.message);
  } else {
    logger.info('Accounts table created or already exists');
  }
});

// Buat index untuk mempercepat query yang sering dipakai
db.run(
  'CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)',
  (err) => {
    if (err) {
      logger.error(
        'Kesalahan membuat index idx_users_user_id:',
        err.message
      );
    } else {
      logger.info('Index idx_users_user_id siap dipakai');
    }
  }
);

db.run(
  'CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, timestamp)',
  (err) => {
    if (err) {
      logger.error(
        'Kesalahan membuat index idx_tx_user_time:',
        err.message
      );
    } else {
      logger.info('Index idx_tx_user_time siap dipakai');
    }
  }
);

db.run(
  'CREATE INDEX IF NOT EXISTS idx_tx_type_time ON transactions(type, timestamp)',
  (err) => {
    if (err) {
      logger.error(
        'Kesalahan membuat index idx_tx_type_time:',
        err.message
      );
    } else {
      logger.info('Index idx_tx_type_time siap dipakai');
    }
  }
);

db.run(
  'CREATE INDEX IF NOT EXISTS idx_accounts_user_time ON accounts(user_id, expires_at)',
  (err) => {
    if (err) {
      logger.error(
        'Kesalahan membuat index idx_accounts_user_time:',
        err.message
      );
    } else {
      logger.info('Index idx_accounts_user_time siap dipakai');
    }
  }
);


db.run(`CREATE TABLE IF NOT EXISTS reseller_bonus_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  period_month TEXT NOT NULL,
  active_days INTEGER NOT NULL DEFAULT 0,
  bonus_amount INTEGER NOT NULL DEFAULT 0,
  tier_label TEXT,
  processed_at INTEGER NOT NULL,
  processed_by INTEGER,
  note TEXT
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel reseller_bonus_logs:', err.message);
  } else {
    logger.info('Reseller bonus logs table created or already exists');
  }
});
createUniqueIndexMultiIfSafe(
  'idx_reseller_bonus_unique_month',
  'reseller_bonus_logs',
  'user_id, period_month'
);
ensureSqliteColumn('reseller_bonus_logs', 'processed_by', 'INTEGER');
ensureSqliteColumn('reseller_bonus_logs', 'note', 'TEXT');

const adminTrialTemp = {}; // key: adminId, value: config trial sementara

const userState = {};
logger.info('User state initialized');
// Pesan standar untuk akses ditolak
const NO_ACCESS_MESSAGE = 'ðŸš« Kamu tidak punya akses untuk perintah ini.';
// Pesan standar untuk perintah khusus pemilik bot (MASTER)
const MASTER_ONLY_MESSAGE =
  'âš ï¸ <b>Perintah ini hanya bisa digunakan oleh pemilik bot (MASTER).</b>';

// Pastikan perintah hanya dipakai di private chat
function ensurePrivateChat(ctx) {
  const chatType = ctx.chat?.type;

  if (chatType && chatType !== 'private') {
    ctx.reply(
      'ðŸ“© Perintah ini hanya bisa digunakan di chat pribadi dengan bot.\n' +
      'Silakan klik nama bot ini lalu tekan tombol <b>Start</b>.',
      { parse_mode: 'HTML' }
    ).catch((e) => {
      console.error('âŒ Gagal kirim instruksi private chat:', e.message);
    });

    return false;
  }

  return true;
}

bot.command(['start', 'menu'], async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  logger.info('Start or Menu command received');
  const chatType = ctx.chat?.type;
  if (chatType && chatType !== 'private') {
    try {
      await ctx.reply(
        'ðŸ“© Untuk menggunakan bot ini, silakan buka chat pribadi dengan bot.\n' +
        'Klik nama bot ini lalu tekan tombol <b>Start</b>.',
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.error('âŒ Gagal kirim pesan instruksi di grup:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      logger.error('Kesalahan saat memeriksa user_id:', err.message);
      return;
    }

    if (row) {
      logger.info(`User ID ${userId} sudah ada di database`);
    } else {
      db.run('INSERT INTO users (user_id) VALUES (?)', [userId], (err) => {
        if (err) {
          logger.error('Kesalahan saat menyimpan user_id:', err.message);
        } else {
          logger.info(`User ID ${userId} berhasil disimpan`);
        }
      });
    }
  });

  await sendMainMenu(ctx);
});

// ============================================================================
// SECTION: PAYMENT - UI TOPUP SALDO OTOMATIS (QRIS)
// - openTopupQrisMenu : set state qris_topup_nominal + kirim instruksi nominal
// ============================================================================
async function openTopupQrisMenu(ctx) {
  if (!ensurePrivateChat(ctx)) return;

  const chatId = ctx.chat.id;

  // Simpan state: user ini lagi diminta isi nominal topup QRIS
  userState[chatId] = { step: 'qris_topup_nominal' };

  await ctx.reply(
    'ðŸ’³ <b>Topup Saldo Otomatis (QRIS)</b>\n\n' +
      `Minimal: <b>Rp${QRIS_AUTO_TOPUP_MIN}</b>\n` +
      `Maksimal: <b>Rp${QRIS_AUTO_TOPUP_MAX}</b>\n\n` +
      'Silakan kirim nominal topup dalam angka saja.\n' +
      'Contoh: <code>25000</code>\n\n' +
      'Tekan tombol <b>âŒ Batal</b> untuk membatalkan.',
    {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [[{ text: 'âŒ Batal' }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    }
  );
  
}
// ===== END SECTION: PAYMENT - UI TOPUP SALDO OTOMATIS (QRIS) ================

bot.command('testgroup', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  // Hanya admin yang boleh pakai perintah ini
  if (!ctx.from || !adminIds.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  try {
    await bot.telegram.sendMessage(GROUP_ID, 'âœ… Test kirim notif ke grup berhasil!');
    await ctx.reply('âœ… Pesan test sudah dikirim ke grup.');
  } catch (e) {
    console.error('Gagal kirim ke grup:', e.message);
    await ctx.reply('âŒ Gagal kirim ke grup, cek ID grup & izin bot.');
  }
});


bot.command('daily_report_test', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || ctx.from.id !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}

  await ctx.reply('â³ Mengirim laporan harian (test)...');
  await sendDailyReport(true);
});

// Command: /expired_reminder_test
// Kirim preview pengingat expired ke si pemanggil command
bot.command('expired_reminder_test', (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from) return;

  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  // Boleh dibatasi hanya admin/master:
  // if (!ADMIN_IDS.includes(userId)) {
  //   return ctx.reply('âš ï¸ Perintah ini hanya untuk admin.');
  // }

  ctx.reply('â³ Membuat preview pengingat expired dari akun kamu...').catch(() => {});

  db.all(
    `
      SELECT username, type, server_id, expires_at
      FROM accounts
      WHERE user_id = ?
      ORDER BY expires_at ASC
      LIMIT 5
    `,
    [userId],
    async (err, rows) => {
      if (err) {
        logger.error('âŒ Gagal ambil akun untuk expired_reminder_test:', err.message);
        return ctx.reply('âŒ Gagal mengambil data akun untuk preview.');
      }

      let text = '';

      if (!rows || rows.length === 0) {
        // Tidak ada akun milik user ini -> kirim contoh dummy
        text =
          'ðŸ”” <b>Peringatan Akun VPN Akan Berakhir</b>\n\n' +
          'Contoh tampilan pengingat expired akun (dummy):\n\n' +
          '1. <b>VMESS</b> <code>user-vmess</code> (server 1)\n' +
          '   â° Expired: 01-01-2026 20:00\n\n' +
          '2. <b>SSH</b> <code>user-ssh</code> (server 2)\n' +
          '   â° Expired: 02-01-2026 20:00\n\n' +
          'Kalau pengingat jalan beneran, daftar di atas akan diisi pakai akun asli milik kamu.\n\n' +
          'Pengingat otomatis tetap mengikuti pengaturan di menu:\n' +
          'â€¢ Jam & menit pengingat\n' +
          'â€¢ H-1 / H-2 / H-3.';
      } else {
        // Pakai akun beneran milik user ini
        const akunLines = rows
          .map((acc, idx) => {
            const expLabel = acc.expires_at
              ? new Date(acc.expires_at).toLocaleString('id-ID', {
                  timeZone: TIME_ZONE,
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '-';

            const serverLabel =
              typeof acc.server_id !== 'undefined' && acc.server_id !== null
                ? `server ${acc.server_id}`
                : 'server -';

            return `${idx + 1}. <b>${acc.type || 'AKUN'}</b> <code>${
              acc.username || '-'
            }</code> (${serverLabel})\n   â° Expired: ${expLabel}`;
          })
          .join('\n\n');

        text =
          'ðŸ”” <b>Peringatan Akun VPN Akan Berakhir</b>\n\n' +
          'Ini contoh tampilan pengingat expired pakai beberapa akun milik kamu (maks 5):\n\n' +
          akunLines +
          '\n\n' +
          'Pengingat otomatis nanti isinya mirip seperti ini,\n' +
          'bedanya hanya akun yang tampil adalah yang benar-benar akan expired sesuai pengaturan H-n.\n\n' +
          'Atur jadwal & H-nya di:\n' +
          'â€¢ Menu Admin â†’ â° Pengingat Expired.';
      }

      try {
        await bot.telegram.sendMessage(chatId, text, {
          parse_mode: 'HTML',
        });
      } catch (e) {
        logger.error(
          'âŒ Gagal kirim expired_reminder_test:',
          e.message || e
        );
      }
    }
  );
});

// Test backup otomatis secara manual
bot.command('backup_auto_test', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || ctx.from.id !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}

  await ctx.reply('â³ Menjalankan backup otomatis (test)...');
  await sendAutoBackup('backup manual lewat /backup_auto_test');
});

// Command: /lisensi
// Menampilkan info masa aktif bot (expire date & sisa hari)
bot.command('lisensi', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
   if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  if (!EXPIRE_DATE) {
    return ctx.reply('â„¹ï¸ EXPIRE_DATE belum di-set di .vars.json untuk bot ini.');
  }

  const info = getLicenseInfo();
  const now  = new Date();

  const nowText = now.toLocaleString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const expireText = info.expire.toLocaleDateString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  let statusText;
  if (info.daysLeft > 0) {
    statusText = `âœ… Lisensi masih aktif.\nSisa: <b>${info.daysLeft}</b> hari lagi.`;
  } else if (info.daysLeft === 0) {
    statusText = 'âš ï¸ Lisensi akan berakhir <b>hari ini</b>.';
  } else {
    statusText = `âŒ Lisensi sudah kadaluarsa <b>${Math.abs(info.daysLeft)}</b> hari yang lalu.`;
  }

  const msg =
    '<b>ðŸ” INFO LISENSI BOT</b>\n\n' +
    `Aktif sampai: <b>${expireText}</b>\n` +
    `${statusText}\n\n` +
    `Waktu sekarang: ${nowText}`;

  return ctx.reply(msg, { parse_mode: 'HTML' });
});
// Command: /health
// Cek kesehatan bot: lisensi, database, backup, laporan harian, pengingat expired
bot.command('health', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const chatId = ctx.chat.id;

  // Cek database
  let dbStatus = 'âŒ Gagal cek database';
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT 1 AS ok', [], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (row && row.ok === 1) {
      dbStatus = 'âœ… Terhubung & bisa query';
    } else {
      dbStatus = 'âš ï¸ Respons aneh dari database';
    }
  } catch (e) {
    dbStatus = `âŒ Error DB: ${e.message || e}`;
  }

  // Info lisensi
  let licenseStatus = 'â„¹ï¸ EXPIRE_DATE belum di-set di .vars.json';
  if (EXPIRE_DATE) {
    const info = getLicenseInfo();
    const expireText = info.expire.toLocaleDateString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    if (info.daysLeft > 0) {
      licenseStatus = `âœ… Aktif, sisa <b>${info.daysLeft}</b> hari (sampai <b>${expireText}</b>)`;
    } else if (info.daysLeft === 0) {
      licenseStatus = `âš ï¸ Akan berakhir <b>HARI INI</b> (sampai ${expireText})`;
    } else {
      licenseStatus = `âŒ Sudah kadaluarsa <b>${Math.abs(
        info.daysLeft
      )}</b> hari yang lalu (terakhir <b>${expireText}</b>)`;
    }
  }

  // Status auto-backup
  const abStatus = AUTO_BACKUP_ENABLED ? 'ðŸŸ¢ ON' : 'ðŸ”´ OFF';
  const abDetail = BACKUP_CHAT_ID
    ? `Interval: <b>${AUTO_BACKUP_INTERVAL_HOURS}</b> jam\n   Tujuan : <code>${BACKUP_CHAT_ID}</code>`
    : 'âš ï¸ BACKUP_CHAT_ID belum di-set (pakai MASTER_ID atau set manual).';

  // Status laporan harian
  const drStatus = DAILY_REPORT_ENABLED ? 'ðŸŸ¢ ON' : 'ðŸ”´ OFF';
  const drTime = `${String(DAILY_REPORT_HOUR).padStart(2, '0')}:${String(
    DAILY_REPORT_MINUTE
  ).padStart(2, '0')}`;

  // Status pengingat expired
  const erStatus = EXPIRY_REMINDER_ENABLED ? 'ðŸŸ¢ ON' : 'ðŸ”´ OFF';
  const erTime = `${String(EXPIRY_REMINDER_HOUR).padStart(2, '0')}:${String(
    EXPIRY_REMINDER_MINUTE
  ).padStart(2, '0')}`;
  const erDays = `H-${EXPIRY_REMINDER_DAYS_BEFORE}`;

  // Uptime process (dalam jam & menit)
  const upSec = Math.floor(process.uptime());
  const upHour = Math.floor(upSec / 3600);
  const upMin = Math.floor((upSec % 3600) / 60);

  const now = new Date();
  const nowText = now.toLocaleString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const msg =
    '<b>ðŸ©º STATUS BOT & SERVER</b>\n\n' +
    `<code>Waktu Sekarang</code>\n` +
    `â€¢ ${nowText}\n` +
    `â€¢ Uptime bot: <b>${upHour} jam ${upMin} menit</b>\n\n` +
    `<code>Lisensi Bot</code>\n` +
    `â€¢ ${licenseStatus}\n\n` +
    `<code>Database</code>\n` +
    `â€¢ ${dbStatus}\n\n` +
    `<code>Auto Backup</code>\n` +
    `â€¢ Status  : ${abStatus}\n` +
    `â€¢ ${abDetail}\n\n` +
    `<code>Laporan Harian</code>\n` +
    `â€¢ Status : ${drStatus}\n` +
    `â€¢ Jam    : <b>${drTime}</b>\n\n` +
    `<code>Pengingat Expired Akun</code>\n` +
    `â€¢ Status : ${erStatus}\n` +
    `â€¢ Jadwal : <b>${erTime}</b>\n` +
    `â€¢ Mode   : <b>${erDays}</b>\n\n` +
    'Kalau ada yang merah/kuning, cek pengaturan di .vars.json atau menu Admin.';

  try {
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e) {
    logger.error('âŒ Gagal kirim pesan /health:', e.message || e);
  }
});

// Command: /addhari <jumlah_hari>
// Menambah masa aktif lisensi bot
bot.command('addhari', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || ctx.from.id !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}

  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /addhari
  if (parts.length !== 2) {
       return ctx.reply(
      'âš ï¸ <b>Format salah.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/addhari 30</code>',
      { parse_mode: 'HTML' }
    );
  }

  const days = parseInt(parts[1], 10);
  if (isNaN(days) || days <= 0) {
       return ctx.reply(
    'âš ï¸ <b>Jumlah hari tidak valid.</b>\n' +
    'Harus berupa angka lebih dari 0.\n\n' +
    'Contoh:\n' +
    '<code>/addhari 7</code>',
    { parse_mode: 'HTML' }
  );
}
  
  const oldInfo = getLicenseInfo();
  let baseDate;

  // Kalau sebelumnya sudah ada tanggal lisensi â†’ tambah dari tanggal itu
  if (oldInfo) {
    baseDate = new Date(oldInfo.expire.getTime());
  } else {
    // Kalau belum ada â†’ mulai dari hari ini
    baseDate = new Date();
  }

  // Tambah hari
  baseDate.setDate(baseDate.getDate() + days);
  const newDateStr = baseDate.toISOString().slice(0, 10); // YYYY-MM-DD

  // Simpan ke memori & .vars.json
  setLicenseExpireDate(newDateStr);

  const newInfo = getLicenseInfo();
  const expireText = newInfo.expire.toLocaleDateString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  let oldText = '-';
  if (oldInfo) {
    oldText = oldInfo.expire.toLocaleDateString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  return ctx.reply(
    '<b>âœ… Berhasil menambah masa aktif lisensi bot.</b>\n\n' +
    `Sebelumnya : <b>${oldText}</b>\n` +
    `Ditambah   : <b>${days}</b> hari\n` +
    `Tanggal baru: <b>${expireText}</b>\n` +
    `Sisa sekarang: <b>${newInfo.daysLeft}</b> hari`,
    { parse_mode: 'HTML' }
  );
});

// Command: /kuranghari <jumlah_hari>
// Mengurangi masa aktif lisensi bot
bot.command('kuranghari', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || ctx.from.id !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}
  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /kuranghari
  if (parts.length !== 2) {
      return ctx.reply(
      'âš ï¸ <b>Format salah.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/kuranghari 7</code>',
      { parse_mode: 'HTML' }
    );
  }

  const days = parseInt(parts[1], 10);
  if (isNaN(days) || days <= 0) {
    return ctx.reply(
    'âš ï¸ <b>Jumlah hari tidak valid.</b>\n' +
    'Harus berupa angka lebih dari 0.\n\n' +
    'Contoh:\n' +
    '<code>/kuranghari 7</code>',
    { parse_mode: 'HTML' }
  );
}
  
  const oldInfo = getLicenseInfo();
  let baseDate;

  if (oldInfo) {
    baseDate = new Date(oldInfo.expire.getTime());
  } else {
    // Kalau belum ada tanggal, pakai hari ini sebagai dasar
    baseDate = new Date();
  }

  // Kurangi hari
  baseDate.setDate(baseDate.getDate() - days);
  const newDateStr = baseDate.toISOString().slice(0, 10); // YYYY-MM-DD

  setLicenseExpireDate(newDateStr);

  const newInfo = getLicenseInfo();
  const expireText = newInfo.expire.toLocaleDateString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  let oldText = '-';
  if (oldInfo) {
    oldText = oldInfo.expire.toLocaleDateString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  return ctx.reply(
    '<b>âœ… Berhasil mengurangi masa aktif lisensi bot.</b>\n\n' +
    `Sebelumnya : <b>${oldText}</b>\n` +
    `Dikurangi  : <b>${days}</b> hari\n` +
    `Tanggal baru: <b>${expireText}</b>\n` +
    `Sisa sekarang: <b>${newInfo.daysLeft}</b> hari`,
    { parse_mode: 'HTML' }
  );
});

////////////////
// Manual admin command: /addsaldo <user_id> <jumlah>
bot.command('addsaldo', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  // Hanya admin yang boleh pakai
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /addsaldo
  if (parts.length !== 3) {
    return ctx.reply(
      'âš ï¸ <b>Format salah.</b>\n\n' +
      'Gunakan:\n' +
      '<code>/addsaldo &lt;user_id&gt; &lt;jumlah&gt;</code>\n\n' +
      'Contoh:\n' +
      '<code>/addsaldo 5439429147 50000</code>',
      { parse_mode: 'HTML' }
    );
  }

  const targetId = Number(parts[1]);
  const amount = Number(parts[2]);

  if (!targetId || !amount || amount <= 0) {
    return ctx.reply(
      'âš ï¸ <b>user_id atau jumlah tidak valid.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/addsaldo 5439429147 50000</code>',
      { parse_mode: 'HTML' }
    );
  }

  // Ambil saldo lama user
  db.get(
    'SELECT saldo FROM users WHERE user_id = ?',
    [targetId],
    (err, row) => {
      if (err) {
        logger.error('Error ambil data user:', err.message);
        return ctx.reply('âŒ Gagal membaca data user. Coba lagi nanti.');
      }

      if (!row) {
        return ctx.reply(`âŒ User dengan ID ${targetId} tidak ditemukan di database.`);
      }

      const oldSaldo = Number(row.saldo || 0);

      // ðŸŽ BONUS: pakai tier dari .vars.json jika ada
      let bonusEnabled = true;
      if (typeof TOPUP_BONUS_ENABLED !== 'undefined') {
        bonusEnabled = !!TOPUP_BONUS_ENABLED;
      }

      let tier1Min = 50000;
      let tier1Pct = 5;
      let tier2Min = 100000;
      let tier2Pct = 7;
      let tier3Min = 200000;
      let tier3Pct = 10;

      if (typeof TOPUP_BONUS_MIN_AMOUNT !== 'undefined') {
        const v = Number(TOPUP_BONUS_MIN_AMOUNT);
        if (!Number.isNaN(v)) tier1Min = v;
      }
      if (typeof TOPUP_BONUS_PERCENT !== 'undefined') {
        const v = Number(TOPUP_BONUS_PERCENT);
        if (!Number.isNaN(v)) tier1Pct = v;
      }
      if (typeof TOPUP_BONUS_TIER2_MIN !== 'undefined') {
        const v = Number(TOPUP_BONUS_TIER2_MIN);
        if (!Number.isNaN(v)) tier2Min = v;
      }
      if (typeof TOPUP_BONUS_TIER2_PERCENT !== 'undefined') {
        const v = Number(TOPUP_BONUS_TIER2_PERCENT);
        if (!Number.isNaN(v)) tier2Pct = v;
      }
      if (typeof TOPUP_BONUS_TIER3_MIN !== 'undefined') {
        const v = Number(TOPUP_BONUS_TIER3_MIN);
        if (!Number.isNaN(v)) tier3Min = v;
      }
      if (typeof TOPUP_BONUS_TIER3_PERCENT !== 'undefined') {
        const v = Number(TOPUP_BONUS_TIER3_PERCENT);
        if (!Number.isNaN(v)) tier3Pct = v;
      }

      // Pilih tier tertinggi yang lolos
      let bonusPercent = 0;
      if (bonusEnabled) {
        if (amount >= tier3Min && tier3Min > 0 && tier3Pct > 0) {
          bonusPercent = tier3Pct;
        } else if (amount >= tier2Min && tier2Min > 0 && tier2Pct > 0) {
          bonusPercent = tier2Pct;
        } else if (amount >= tier1Min && tier1Min > 0 && tier1Pct > 0) {
          bonusPercent = tier1Pct;
        }
      }

      let bonus = 0;
      if (bonusPercent > 0) {
        // dibulatkan ke bawah
        bonus = Math.floor((amount * bonusPercent) / 100);
      }

      const totalCredit = amount + bonus;
      const newSaldo = oldSaldo + totalCredit;

      // Update saldo user
      db.run(
        'UPDATE users SET saldo = ? WHERE user_id = ?',
        [newSaldo, targetId],
        async (err2) => {
          if (err2) {
            logger.error('Error update saldo:', err2.message);
            return ctx.reply('âŒ Gagal menambahkan saldo. Coba lagi nanti.');
          }

          // ðŸ§¾ CATAT TRANSAKSI SALDO
          try {
            recordSaldoTransaction(
              targetId,
              totalCredit,
              'manual_addsaldo',
              `addsaldo_by_${ctx.from.id}`
            );
          } catch (e) {
            logger.error('Gagal mencatat transaksi tambah saldo manual:', e.message);
          }

          // Notif ke admin
          let msgAdmin =
            `âœ… Saldo user ID <code>${targetId}</code> berhasil ditambah.\n\n` +
            `ðŸ’µ Nominal bayar : <b>Rp${amount.toLocaleString('id-ID')}</b>\n`;

          if (bonus > 0) {
            msgAdmin +=
              `ðŸŽ Bonus         : <b>Rp${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n` +
              `ðŸ’³ Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n`;
          } else {
            msgAdmin +=
              `ðŸ’³ Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n`;
          }

          msgAdmin +=
            `\nðŸ’¼ Saldo sekarang: <b>Rp${newSaldo.toLocaleString('id-ID')}</b>`;

          await ctx.reply(msgAdmin, { parse_mode: 'HTML' });

          // Notif ke user
          try {
            let msgUser =
              'ðŸ’° Saldo kamu telah <b>ditambahkan</b>.\n\n' +
              `ðŸ’µ Topup : <b>Rp ${amount.toLocaleString('id-ID')}</b>\n`;

            if (bonus > 0) {
              msgUser +=
                `ðŸŽ Bonus : <b>Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n` +
                `ðŸ’³ Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n`;
            } else {
              msgUser +=
                `ðŸ’³ Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n`;
            }

            msgUser +=
              `\nðŸ’¼ Saldo sekarang: <b>Rp ${newSaldo.toLocaleString('id-ID')}</b>`;

            await bot.telegram.sendMessage(targetId, msgUser, {
              parse_mode: 'HTML'
            });
          } catch (e) {
            logger.error('Gagal kirim notif ke user:', e.message);
          }

          // Notif ke grup (jika diaktifkan)
          if (typeof NOTIF_TOPUP_GROUP !== 'undefined' && NOTIF_TOPUP_GROUP && GROUP_ID) {
            try {
              let targetInfo;
              try {
                targetInfo = await bot.telegram.getChat(targetId);
              } catch (e) {
                targetInfo = {};
              }

              let userLabel;
              if (targetInfo.username) {
                userLabel = targetInfo.username;
              } else if (targetInfo.first_name) {
                userLabel = targetInfo.first_name;
              } else {
                userLabel = String(targetId);
              }

              const waktu = new Date().toLocaleString('id-ID', {
                timeZone: TIME_ZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              });

              let notifTopup =
                '<blockquote>\n' +
                'â”â”â” TOPUP MANUAL â”â”â”\n' +
				'<code>\n' + // <-- MULAI BLOK MONOSPACE
                `ðŸ‘¤ User   : ${userLabel}\n` +
                `ðŸ†” ID     : ${targetId}\n` +
                `ðŸ’µ Bayar  : Rp ${amount.toLocaleString('id-ID')}\n`;

              if (bonus > 0) {
                notifTopup +=
                  `ðŸŽ Bonus  : Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)\n` +
                  `ðŸ’³ Masuk  : Rp ${totalCredit.toLocaleString('id-ID')}\n`;
              } else {
                notifTopup +=
                  `ðŸ’³ Masuk  : Rp ${totalCredit.toLocaleString('id-ID')}\n`;
              }

              notifTopup +=
                `ðŸ’¼ Saldo  : Rp ${newSaldo.toLocaleString('id-ID')}\n` +
                `ðŸ“… Tanggal: ${waktu}\n` +
				'</code>\n' + // <-- AKHIR BLOK MONOSPACE
                'â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n' +
                '</blockquote>';

              await bot.telegram.sendMessage(GROUP_ID, notifTopup, {
                parse_mode: 'HTML'
              });
            } catch (e) {
              logger.error('Gagal kirim notif topup manual ke grup:', e.message);
            }
          }
        }
      );
    }
  );
});



// Manual admin command: /minsaldo <user_id> <jumlah>
// Mengurangi saldo user secara manual oleh admin
bot.command('minsaldo', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  // Hanya admin yang boleh pakai
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /minsaldo
    if (parts.length !== 3) {
    return ctx.reply(
      'âš ï¸ <b>Format salah.</b>\n\n' +
      'Gunakan:\n' +
      '<code>/minsaldo &lt;user_id&gt; &lt;jumlah&gt;</code>\n\n' +
      'Contoh:\n' +
      '<code>/minsaldo 5439429147 10000</code>',
      { parse_mode: 'HTML' }
    );
  }

  const targetId = Number(parts[1]);
  const amount   = Number(parts[2]);

    if (!targetId || !amount || amount <= 0) {
    return ctx.reply(
      'âš ï¸ <b>user_id atau jumlah tidak valid.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/minsaldo 5439429147 10000</code>',
      { parse_mode: 'HTML' }
    );
  }

  // Ambil saldo lama user
  db.get(
    'SELECT saldo FROM users WHERE user_id = ?',
    [targetId],
    (err, row) => {
      if (err) {
        console.error('Error ambil data user:', err.message);
        return ctx.reply('âŒ Gagal membaca data user. Coba lagi nanti.');
      }

      if (!row) {
        return ctx.reply(`âš ï¸ User dengan ID ${targetId} tidak ditemukan di database.`);
      }

      const oldSaldo = Number(row.saldo || 0);

      // Cek biar saldo tidak minus
      if (oldSaldo < amount) {
        return ctx.reply(
          `âš ï¸ Saldo user tidak cukup.\n` +
          `Saldo sekarang: Rp${oldSaldo.toLocaleString()}\n` +
          `Jumlah pengurangan: Rp${amount.toLocaleString()}`
        );
      }

      const newSaldo = oldSaldo - amount;

      // Update saldo user
      db.run(
        'UPDATE users SET saldo = ? WHERE user_id = ?',
        [newSaldo, targetId],
        async (err2) => {
          if (err2) {
            console.error('Error update saldo:', err2.message);
            return ctx.reply('âŒ Gagal mengurangi saldo. Coba lagi nanti.');
          }
       // ðŸ§¾ CATAT TRANSAKSI SALDO
          recordSaldoTransaction(
            targetId,
            amount,
            'manual_minsaldo',
            `minsaldo_by_${ctx.from.id}`
          );

          // Notif ke admin (chat ini)
          await ctx.reply(
            `âœ… Saldo user ID <code>${targetId}</code> berhasil dikurangi Rp${amount.toLocaleString()}.\n` +
            `ðŸ’° Saldo sekarang: <b>Rp${newSaldo.toLocaleString()}</b>`,
            { parse_mode: 'HTML' }
          );

          // Notif ke user yang bersangkutan (kalau bisa di-chat)
try {
  await bot.telegram.sendMessage(
    targetId,
    'ðŸ’¸ Saldo kamu telah <b>dikurangi</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n' +
    'ðŸ’³ Saldo sekarang: <b>Rp ' + newSaldo.toLocaleString() + '</b>.',
    { parse_mode: 'HTML' }
  );
} catch (e) {
  console.error('Gagal kirim notif ke user saat pengurangan saldo:', e.message);
}


          // (OPSIONAL) Notif ke grup, mirip topup manual
 if (NOTIF_TOPUP_GROUP) {
  try {
    // Ambil info user untuk ditampilkan
    let targetInfo;
    try {
      targetInfo = await bot.telegram.getChat(targetId);
    } catch (e) {
      targetInfo = {};
    }

    let userLabel;
    if (targetInfo.username) {
      userLabel = targetInfo.username;
    } else if (targetInfo.first_name) {
      userLabel = targetInfo.first_name;
    } else {
      userLabel = String(targetId);
    }

    const waktu = new Date().toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const notifPotong =
      '<blockquote>\n' +
      'â”â” PENGURANGAN SALDO â”â”\n' +
      '<code>\n' + // <-- MULAI BLOK MONOSPACE
      `ðŸ‘¤ User   : ${userLabel}\n` +
      `ðŸ’¸ Jumlah : Rp ${amount.toLocaleString()}\n` +
      `ðŸ“… Tanggal: ${waktu}\n` +
      '</code>\n' + // <-- AKHIR BLOK MONOSPACE
      'â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n' +
      '</blockquote>';

    await bot.telegram.sendMessage(GROUP_ID, notifPotong, {
      parse_mode: 'HTML',
    });
            } catch (e) {
              console.error('Gagal kirim notif pengurangan saldo ke grup:', e.message);
            }
          }
        }
      );
    }
  );
});

// Manual admin command: /deluser <user_id>
// Menghapus user dari tabel users dan (jika ada) dari daftar reseller
bot.command('deluser', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  // Hanya admin yang boleh pakai (pakai pola yang sama seperti /addsaldo)
   if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const parts = ctx.message.text.trim().split(/\s+/);
  // parts[0] = /deluser
      if (parts.length !== 2) {
    return ctx.reply(
      'âš ï¸ <b>Format salah.</b>\n\n' +
      'Gunakan:\n' +
      '<code>/deluser &lt;user_id&gt;</code>\n\n' +
      'Contoh:\n' +
      '<code>/deluser 5439429147</code>',
      { parse_mode: 'HTML' }
    );
  }

  const targetId = Number(parts[1]);
    if (!targetId) {
    return ctx.reply(
      'âš ï¸ <b>user_id tidak valid.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/deluser 5439429147</code>',
      { parse_mode: 'HTML' }
    );
  }

  // Cek apakah user ada di tabel users
  db.get('SELECT * FROM users WHERE user_id = ?', [targetId], (err, row) => {
    if (err) {
      logger.error('âŒ Kesalahan saat memeriksa user_id di /deluser:', err.message);
      return ctx.reply('âŒ Terjadi kesalahan saat memeriksa user.');
    }

    if (!row) {
      return ctx.reply(`â„¹ï¸ User dengan ID ${targetId} tidak ditemukan di database.`);
    }

    // Hapus dari tabel users
    db.run('DELETE FROM users WHERE user_id = ?', [targetId], (err2) => {
      if (err2) {
        logger.error('âŒ Gagal menghapus user di /deluser:', err2.message);
        return ctx.reply('âŒ Gagal menghapus user dari database.');
      }

      logger.info(`âœ… User ${targetId} dihapus dari tabel users oleh admin ${ctx.from.id}`);

         // Setelah berhasil hapus dari users, hapus juga dari daftar reseller (cache + file)
      try {
        const removed = removeResellerIdFromCache(targetId);
        if (removed) {
          logger.info(`âœ… User ${targetId} juga dihapus dari daftar reseller (cache + ressel.db)`);
        }
      } catch (e) {
        logger.error('âš ï¸ Gagal mengupdate resellerCache di /deluser:', e.message || e);
      }
      ctx.reply(
        `âœ… User dengan ID <code>${targetId}</code> berhasil dihapus dari database.`,
        { parse_mode: 'HTML' }
      );
    });
  });
});

// Command: /listuser
// Menampilkan total user, total reseller, dan 10 user terakhir
bot.command('listuser', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  // Hanya admin yang boleh pakai
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  // Hitung total user
  db.get('SELECT COUNT(*) AS total FROM users', [], (err, row) => {
    if (err) {
      logger.error('Gagal menghitung total user:', err.message);
      return ctx.reply('âŒ Terjadi kesalahan saat mengambil data user.');
    }

    const totalUser = row ? row.total : 0;

    // Ambil 10 user terakhir (berdasarkan id)
    db.all(
      'SELECT user_id, saldo FROM users ORDER BY id DESC LIMIT 10',
      [],
      (err2, rows) => {
        if (err2) {
          logger.error('Gagal mengambil daftar user:', err2.message);
          return ctx.reply('âŒ Terjadi kesalahan saat mengambil daftar user.');
        }

        // Hitung total reseller dari modul reseller
        let totalReseller = 0;
        try {
          const resList = listResellersSync();
          if (Array.isArray(resList)) {
            totalReseller = resList.length;
          }
        } catch (e) {
          logger.error('Gagal mengambil daftar reseller:', e.message);
        }

        let msg = '<b>STATISTIK USER</b>\n\n';
        msg += `Total user terdaftar : <b>${totalUser}</b>\n`;
        msg += `Total reseller       : <b>${totalReseller}</b>\n\n`;

        if (!rows || rows.length === 0) {
          msg += 'Belum ada user di database.';
        } else {
          msg += '10 user terakhir di tabel:\n';
          rows.forEach((u, i) => {
            const saldo = Number(u.saldo || 0).toLocaleString('id-ID');
            msg += `${i + 1}. <code>${u.user_id}</code> â€” Saldo: Rp${saldo}\n`;
          });
        }

        ctx.reply(msg, { parse_mode: 'HTML' });
      }
    );
  });
});

// Command: /setflag
// /setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan optional...]
bot.command('setflag', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const args = ctx.message.text.trim().split(/\s+/);
  // args[0] = /setflag
  if (args.length < 3) {
    return ctx.reply(
      'âš ï¸ Format salah.\n' +
        'Gunakan:\n' +
        '`/setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan...]`',
      { parse_mode: 'Markdown' }
    );
  }

  const targetId = args[1];
  const rawStatus = args[2].toUpperCase();
  const note = args.slice(3).join(' ').trim();

  if (!/^\d+$/.test(targetId)) {
    return ctx.reply('âš ï¸ user_id harus berupa angka.', { parse_mode: 'Markdown' });
  }

  if (!['NORMAL', 'WATCHLIST', 'NAKAL'].includes(rawStatus)) {
    return ctx.reply(
      'âš ï¸ Status tidak dikenal.\n' +
        'Gunakan salah satu: `NORMAL`, `WATCHLIST`, atau `NAKAL`.',
      { parse_mode: 'Markdown' }
    );
  }

  db.run(
    'UPDATE users SET flag_status = ?, flag_note = ? WHERE user_id = ?',
    [rawStatus, note || null, targetId],
    function (err) {
      if (err) {
        logger.error('âŒ Gagal mengupdate flag_status user:', err.message);
        return ctx.reply('âŒ Terjadi kesalahan saat mengupdate status user.');
      }

      if (this.changes === 0) {
        return ctx.reply(
          `âš ï¸ User dengan ID ${targetId} tidak ditemukan di tabel users.`,
          { parse_mode: 'Markdown' }
        );
      }

      let label = 'âœ… NORMAL';
      if (rawStatus === 'WATCHLIST') label = 'âš ï¸ WATCHLIST';
      else if (rawStatus === 'NAKAL') label = 'ðŸš« NAKAL';

      const noteText = note ? `\nðŸ“ Catatan: ${note}` : '';
      ctx.reply(
        `âœ… Status user \`${targetId}\` berhasil diubah menjadi: ${label}${noteText}`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('lastbroadcast', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from) return;
  const userId = ctx.from.id;

  // Hanya admin/master yang boleh
  if (!adminIds.includes(userId) && userId !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}

  if (!lastBroadcastInfo) {
    return ctx.reply('â„¹ï¸ Belum ada data broadcast yang tersimpan (atau bot baru saja direstart).');
  }

  const info = lastBroadcastInfo;

  let targetLabel = info.target;
  if (info.target === 'all') targetLabel = 'semua user';
  else if (info.target === 'reseller') targetLabel = 'semua reseller';
  else if (info.target === 'member') targetLabel = 'member (bukan reseller & bukan admin)';

  await ctx.reply(
    `ðŸ“Š <b>Broadcast Terakhir</b>\n\n` +
    `Waktu   : <b>${info.time}</b>\n` +
    `Target  : <b>${targetLabel}</b>\n` +
    `Total   : <b>${info.totalTarget}</b> user\n` +
    `Berhasil: <b>${info.sukses}</b>\n` +
    `Gagal   : <b>${info.gagal}</b>\n\n` +
    `<b>Preview Pesan:</b>\n` +
    info.messagePreview,
    { parse_mode: 'HTML' }
  );
});

//////////////////
bot.command('admin', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  logger.info('Admin menu requested');

  if (!adminIds.includes(ctx.from.id)) {
    await ctx.reply('ðŸš« Anda tidak memiliki izin untuk mengakses menu admin.');
    return;
  }

  await sendAdminMenu(ctx);
});
async function sendMainMenu(ctx) {
  if (!ctx.from) return;

  const userId = ctx.from.id;
  const userName = ctx.from.first_name || '-';

  // Ambil saldo user
  let saldo = 0;
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    saldo = row && typeof row.saldo === 'number' ? row.saldo : 0;
  } catch (e) {
    saldo = 0;
    logger.error('Gagal mengambil saldo di sendMainMenu:', e);
  }

  const isReseller = isResellerId(userId);


  // Cek apakah user ini admin
  const isAdmin = ADMIN_IDS.includes(userId);

  // Tentukan status user + badge
  let userStatus = 'ðŸ‘¤ Member';
  if (isAdmin) {
    userStatus = 'ðŸ›¡ï¸ Admin';
  } else if (isReseller) {
    userStatus = 'ðŸ¤ Reseller';
  }

  // Susun teks lisensi (kalau EXPIRE_DATE di-set)
  let licenseInfoText = '';
  if (EXPIRE_DATE) {
    const info = getLicenseInfo();
    if (info) {
      if (info.daysLeft > 0) {
        licenseInfoText =
          `ðŸ“… Lisensi aktif sampai: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          `â³ Sisa: <b>${info.daysLeft}</b> hari\n`;
      } else if (info.daysLeft === 0) {
        licenseInfoText =
          `ðŸ“… Lisensi berakhir: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          'â³ Status: <b>HARI INI</b>\n';
      } else {
        licenseInfoText =
          `ðŸ“… Lisensi habis: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          `â³ Lewat: <b>${Math.abs(info.daysLeft)}</b> hari lalu\n`;
      }
    } else {
      licenseInfoText = 'âš ï¸ Tidak dapat membaca informasi lisensi.\n';
    }
  } else {
    licenseInfoText = 'â„¹ï¸ Lisensi bot tidak dibatasi tanggal (lifetime) atau belum diatur.\n';
  }

  // Teks panel admin (hanya muncul kalau user adalah admin)
  const commandPanelText = isAdmin ? `
<code>âš™ï¸ COMMAND PANEL</code>
ðŸ  /start       â†’ Menu Utama
ðŸ”‘ /admin       â†’ Menu Admin
ðŸ›¡ï¸ /helpadmin  â†’ Panel Admin

${licenseInfoText}
` : '';

  const messageText = `
<code>â•­â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®</code>
<b>âš¡ BOT VPN ${NAMA_STORE} âš¡</b>
<i>ðŸŒ Koneksi cepat, aman, stabil.</i>
<code>â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯</code>

<code>â•­â”€â”€â”€â”€â”€â”€ USER INFO â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®</code>
â€¢ Nama   : <b>${userName}</b>
â€¢ ID     : <code>${userId}</code>
â€¢ Saldo  : <code>Rp ${saldo}</code>
â€¢ Status : <code>${userStatus}</code>
<code>â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯</code>

<code>â•­â”€â”€â”€â”€ MENU UTAMA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®</code>
Gunakan tombol di bawah ini
untuk membuat akun, cek akun,
dan melihat riwayat penjualanmu.
<code>â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯</code>

<code>â•­â”€â”€â”€â”€â”€â”€ INFO BOT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®</code>
â€¢ Editor  : <b>KETANTECH</b>
<code>â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯</code>

${commandPanelText}
`.trim();

  let keyboard = [
    [
      { text: 'âž• Buat Akun', callback_data: 'service_create' },
      { text: 'ðŸ“‚ Akun Saya', callback_data: 'my_accounts' }
    ],
    [
      { text: 'âŒ› Trial Akun', callback_data: 'service_trial' },
      { text: 'ðŸ“¶ Cek Server', callback_data: 'cek_service' }
    ],
    [
      { text: 'â“ Bantuan', callback_data: 'help_user' }
    ],
    [
      { text: 'ðŸ“Š Riwayat Saya', callback_data: 'my_stats:0' }
    ],
    [
      { text: 'ðŸ¤ Jadi Reseller harga lebih murah!!', callback_data: 'jadi_reseller' }
    ],
	// ========================================================================
    // SECTION: PAYMENT - TOMBOL TOPUP SALDO
    // ========================================================================
	[
   { text: 'ðŸ’³ TopUp Saldo OTOMATIS (QRIS)', callback_data: 'topupqris_btn' }
	],
    //[
     // { text: 'ðŸ’° TopUp Saldo MANUAL via (QRIS)', callback_data: 'topup_manual' }
    //]
  ];

  // Tambah tombol "Penjualan Saya" khusus reseller
  if (isReseller) {
    keyboard.splice(2, 0, [
      { text: 'ðŸ§¾ Penjualan Saya', callback_data: 'sales_summary' }
    ]);
  }

  // Kalau user sudah reseller atau admin, sembunyikan tombol "Jadi Reseller"
  if (isReseller || isAdmin) {
    keyboard = keyboard.filter(row =>
      !row.some(btn => btn && btn.callback_data === 'jadi_reseller')
    );
  }

  try {
    await sendCleanMenu(ctx, messageText, {
      reply_markup: { inline_keyboard: keyboard }
    });
    logger.info('Main menu sent');
  } catch (error) {
    logger.error('Error saat mengirim menu utama:', error);
  }
}


bot.command('hapuslog', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!adminIds.includes(ctx.from.id)) return ctx.reply('Tidak ada izin!');
  try {
    if (fs.existsSync('bot-combined.log')) fs.unlinkSync('bot-combined.log');
    if (fs.existsSync('bot-error.log')) fs.unlinkSync('bot-error.log');
    ctx.reply('Log berhasil dihapus.');
    logger.info('Log file dihapus oleh admin.');
  } catch (e) {
    ctx.reply('Gagal menghapus log: ' + e.message);
    logger.error('Gagal menghapus log: ' + e.message);
  }
});

// === ðŸ” STATUS BOT (ADMIN) ===
// Cek cepat: lisensi, auto-backup, pengingat expired, dan trial
bot.command(['botstatus', 'statusbot'], async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const adminId = ctx.from?.id;
  if (!adminId || !ADMIN_IDS.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // --- Lisensi ---
  let licenseText = '';
  if (EXPIRE_DATE) {
    const info = getLicenseInfo();
    if (info) {
      if (info.daysLeft > 0) {
        licenseText =
          `ðŸ“… Sampai: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          `â³ Sisa  : <b>${info.daysLeft}</b> hari`;
      } else if (info.daysLeft === 0) {
        licenseText =
          `ðŸ“… Sampai: <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          'â³ Status: <b>HARI INI</b>';
      } else {
        licenseText =
          `ðŸ“… Habis : <b>${info.expire.toLocaleDateString('id-ID')}</b>\n` +
          `â³ Lewat : <b>${Math.abs(info.daysLeft)}</b> hari`;
      }
    } else {
      licenseText = 'âš ï¸ Tidak dapat membaca informasi lisensi.';
    }
  } else {
    licenseText = 'â™¾ï¸ Lisensi: <b>lifetime / belum diatur</b>';
  }

  // --- Auto-backup ---
  const abStatus = AUTO_BACKUP_ENABLED ? 'ðŸŸ¢ ON' : 'ðŸ”´ OFF';
  const abInterval =
    AUTO_BACKUP_INTERVAL_HOURS && AUTO_BACKUP_INTERVAL_HOURS > 0
      ? `${AUTO_BACKUP_INTERVAL_HOURS} jam`
      : 'tidak di-set';
  const abChat =
    BACKUP_CHAT_ID && BACKUP_CHAT_ID !== ''
      ? `<code>${BACKUP_CHAT_ID}</code>`
      : '<i>belum di-set</i>';

  // --- Pengingat expired ---
  const erStatus = EXPIRY_REMINDER_ENABLED ? 'ðŸŸ¢ ON' : 'ðŸ”´ OFF';
  const erTime = `${String(EXPIRY_REMINDER_HOUR).padStart(
    2,
    '0'
  )}:${String(EXPIRY_REMINDER_MINUTE).padStart(2, '0')}`;
  const erDays = EXPIRY_REMINDER_DAYS_BEFORE;

  // --- Trial config ---
  let trialInfoText = '';
  try {
    const trialCfg = await getTrialConfig();
    const tStatus = trialCfg.enabled ? 'ðŸŸ¢ ON' : 'ðŸ”´ OFF';
    trialInfoText =
      `Status   : ${tStatus}\n` +
      `Max/hari : <b>${trialCfg.maxPerDay}</b> x\n` +
      `Durasi   : <b>${trialCfg.durationHours}</b> jam\n` +
      `Min saldo: <b>${trialCfg.minBalanceForTrial}</b>`;
  } catch (e) {
    logger.error('âŒ Gagal membaca trial_config di /botstatus:', e);
    trialInfoText = 'âš ï¸ Gagal membaca konfigurasi trial.';
  }

  const text = `
<code>â•­â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®</code>
<b>ðŸ§° STATUS BOT VPN ${NAMA_STORE}</b>
<code>â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯</code>

<code>â•­â”€â”€â”€â”€ LISENSI BOT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®</code>
${licenseText}
<code>â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯</code>

<code>â•­â”€â”€â”€â”€ AUTO BACKUP DB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®</code>
â€¢ Status   : <b>${abStatus}</b>
â€¢ Interval : <b>${abInterval}</b>
â€¢ Chat ID  : ${abChat}
<code>â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯</code>

<code>â•­â”€â”€â”€â”€ PENGINGAT EXPIRED â”€â”€â”€â”€â”€â”€â”€â•®</code>
â€¢ Status   : <b>${erStatus}</b>
â€¢ H-       : <b>${erDays}</b> hari
â€¢ Jam      : <b>${erTime}</b> (zona ${TIME_ZONE})
<code>â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯</code>

<code>â•­â”€â”€â”€â”€ PENGATURAN TRIAL â”€â”€â”€â”€â”€â”€â”€â”€â•®</code>
${trialInfoText}
<code>â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯</code>
`.trim();

  return ctx.reply(text, { parse_mode: 'HTML' });
});

// Command: /helpadmin
// Menampilkan daftar lengkap perintah admin
bot.command('helpadmin', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  const userId = ctx.message.from.id;

  // Hanya admin / owner
  if (!ADMIN_IDS.includes(userId)) {
  return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}


  const helpMessage =
    'ðŸ“‹ DAFTAR PERINTAH ADMIN TAPEKETAN VPN\n' +
    '\n' +
    'Gunakan perintah berikut hanya jika Anda memahami fungsinya.\n' +
    'Beberapa perintah tertentu sebaiknya hanya dipakai OWNER / MASTER.\n' +
    '\n' +
    '1) PANEL & BANTUAN\n' +
    '- /admin        â†’ Buka Menu Admin (panel tombol)\n' +
    '- /helpadmin    â†’ Menampilkan daftar perintah admin ini\n' +
    '- /botstatus atau /statusbot -> Cek status bot & server\n' +
    '\n' +
    '2) MANAJEMEN USER & RESELLER\n' +
    '- /listuser     â†’ Menampilkan daftar user yang terdaftar di database\n' +
    '- /addressel    â†’ Menambahkan reseller baru\n' +
    '- /delressel    â†’ Menghapus ID reseller\n' +
    '- /deluser      â†’ Menghapus user dari database (hati-hati)\n' +
    '\n' +
    '3) SALDO & TRANSAKSI\n' +
    '- /addsaldo     â†’ Menambahkan saldo ke akun user\n' +
    '- /minsaldo     â†’ Mengurangi saldo akun user (misal setelah beli akun)\n' +
    '- /cekqris <invoice_id> -> Cek status QRIS manual (invoice tertentu)\n' +
    '\n' +
    '4) SERVER & PAKET\n' +
    '- /addserver          â†’ Menambahkan server baru\n' +
    '- /addserver_reseller â†’ Mengatur server default untuk reseller\n' +
    '- /editharga          â†’ Mengedit harga paket pada server\n' +
    '- /editauth           â†’ Mengedit akun/auth panel (jika dipakai)\n' +
    '- /editdomain         â†’ Mengedit domain server\n' +
    '- /editlimitcreate    â†’ Mengedit batas pembuatan akun per server\n' +
    '- /editlimitip        â†’ Mengedit batas jumlah IP per akun\n' +
    '- /editlimitquota     â†’ Mengedit batas kuota paket\n' +
    '- /editnama           â†’ Mengedit nama server\n' +
    '- /edittotalcreate    â†’ Mengedit total limit pembuatan akun server\n' +
    '\n' +
    '5) BROADCAST & PENGUMUMAN\n' +
    '- /broadcast      â†’ Broadcast ke semua user\n' +
    '- /broadcastres   â†’ Broadcast ke semua reseller\n' +
    '- /broadcastmem   â†’ Broadcast ke semua member biasa\n' +
    '- /lastbroadcast  â†’ Menampilkan ringkasan broadcast terakhir\n' +
    '\n' +
    '6) LOG & MAINTENANCE\n' +
    '- /hapuslog       â†’ Menghapus file log bot\n' +
    '- /testgroup      â†’ Menguji kirim pesan ke GROUP_ID (alat uji/debug)\n' +
    '\n' +
    '7) LISENSI BOT\n' +
    '- /lisensi        â†’ Melihat masa aktif lisensi bot (expire date & sisa hari)\n' +
    '- /addhari        â†’ Menambah masa aktif lisensi bot (biasanya khusus OWNER/MASTER)\n' +
    '- /kuranghari     â†’ Mengurangi masa aktif lisensi bot (biasanya khusus OWNER/MASTER)\n' +
    '\n' +
    '8) LAPORAN, BACKUP & REMINDER\n' +
    '- /health               â†’ Cek kesehatan bot (lisensi, database, auto-backup, laporan harian, pengingat expired, uptime)\n' +
    '- /daily_report_test    â†’ Mengirim laporan harian secara manual (mode test)\n' +
    '- /backup_auto_test     â†’ Menguji fungsi auto-backup sekali (test kirim backup)\n' +
    '- /expired_reminder_test â†’ Preview tampilan pesan pengingat akun expired ke chat Anda\n' +
    '\n' +
    '9) TROUBLESHOOTING / MODERASI\n' +
    '- /setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan...] -> Tandai status user\n' +
    '\n' +
    'Catatan:\n' +
    '- Hak akses admin diatur melalui MASTER_ID dan ADMIN_IDS di file .vars.json\n' +
    '- Jangan gunakan perintah penghapusan/ubah server/lisensi jika belum paham akibatnya.\n';

  return ctx.reply(helpMessage);
});

//////////
bot.command('addserver_reseller', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;
  const userId = ctx.from?.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }
  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 7) {
      return ctx.reply('âš ï¸ Format salah!\n\nGunakan:\n/addserver_reseller <domain> <auth> <harga> <nama_server> <quota> <iplimit> <batas_create_akun>');
    }

    const [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun] = args;

    // âœ… TAMBAHKAN total_create_akun di VALUES
    db.run(`INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, is_reseller_only, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun],
      function (err) {
        if (err) {
          logger.error('âŒ Gagal menambah server reseller:', err.message);
          return ctx.reply('âŒ *Gagal menambah server reseller.*', { parse_mode: 'Markdown' });
        }
        ctx.reply('âœ… *Server khusus reseller berhasil ditambahkan!*', { parse_mode: 'Markdown' });
      }
    );
  } catch (e) {
    logger.error('Error di /addserver_reseller:', e);
    ctx.reply('âŒ *Terjadi kesalahan.*', { parse_mode: 'Markdown' });
  }
});
//////////
bot.command('broadcast', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.from.id;
  logger.info(`Broadcast command received from user_id: ${userId}`);

  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // Ambil pesan: dari reply, atau dari teks setelah /broadcast
  const msg = ctx.message;
  const messageText = msg.reply_to_message
    ? msg.reply_to_message.text
    : msg.text.split(' ').slice(1).join(' ');

  if (!messageText || !messageText.trim()) {
    logger.info('âš ï¸ Pesan untuk broadcast tidak diberikan.');
    return ctx.reply(
      'âš ï¸ <b>Pesan broadcast kosong.</b>\n' +
        'Kirim ulang perintah dengan teks setelah command, atau reply ke pesan lalu jalankan <code>/broadcast</code>.',
      { parse_mode: 'HTML' }
    );
  }

  try {
    // Ambil semua user dari tabel users
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT user_id FROM users', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    if (rows.length === 0) {
      return ctx.reply('â„¹ï¸ Tidak ada user di database untuk dikirimi broadcast.', {
        parse_mode: 'HTML',
      });
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let sukses = 0;
    let gagal = 0;
    let totalTarget = 0;

    // Beri info awal ke admin
    await ctx.reply(
      `ðŸ“¢ Mulai broadcast ke <b>${rows.length}</b> user...\n` +
        'Mohon tunggu, ini bisa memakan waktu beberapa detik/menit tergantung jumlah user.',
      { parse_mode: 'HTML' }
    );

    for (const row of rows) {
      const targetId = row.user_id;
      if (!targetId) continue;
      totalTarget++;

      try {
        await axios.post(telegramUrl, {
          chat_id: targetId,
          text: messageText,
        });
        sukses++;
        logger.info(`âœ… Broadcast terkirim ke ${targetId}`);
            } catch (error) {
        gagal++;

        // Kalau kena limit Telegram (429), ikuti retry_after kalau ada
        const status = error?.response?.status;
        const retryAfter =
          error?.response?.data?.parameters?.retry_after || 0;

        if (status === 429) {
          logger.warn(
            `â³ Kena limit Telegram (429) saat kirim ke ${targetId}. retry_after=${retryAfter}s`
          );
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          await sleep(delayMs);
        } else {
          logger.error(
            `âš ï¸ Gagal kirim broadcast ke ${targetId}:`,
            error.message || error
          );
        }
      }


      // Jeda kecil agar tidak ngebombardir API Telegram
      await sleep(80); // bisa diubah ke 30/100 ms sesuai kebutuhan
    }

    await ctx.reply(
      `âœ… <b>Broadcast selesai.</b>\n\n` +
        `ðŸŽ¯ Target   : <b>${totalTarget}</b> user\n` +
        `âœ… Berhasil : <b>${sukses}</b>\n` +
        `âš ï¸ Gagal    : <b>${gagal}</b>\n\n` +
        `<i>Kalau sering kena limit, naikkan jeda di fungsi sleep (misal jadi 100ms).</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('âš ï¸ Kesalahan saat mengambil daftar pengguna untuk broadcast:', e);
    return ctx.reply(
      'âš ï¸ Terjadi kesalahan saat mengambil daftar pengguna untuk broadcast.',
      { parse_mode: 'HTML' }
    );
  }
});

// Broadcast ke reseller saja (ID diambil dari ressel.db)
/**
 * Cara pakai:
 * /broadcastres Pesan...
 * ATAU reply ke pesan lalu kirim /broadcastres
 */
// Broadcast ke reseller saja (ID diambil dari ressel.db)
/**
 * Cara pakai:
 * /broadcastres Pesan...
 * ATAU reply ke pesan lalu kirim /broadcastres
 */
bot.command('broadcastres', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.from.id;
  logger.info(`Broadcastres command received from user_id: ${userId}`);

  // Hanya admin
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // Ambil pesan: dari reply, atau dari teks setelah /broadcastres
  const msg = ctx.message;
  const messageText = msg.reply_to_message
    ? msg.reply_to_message.text
    : msg.text.split(' ').slice(1).join(' ');

  if (!messageText || !messageText.trim()) {
    logger.info('âš ï¸ Pesan untuk broadcastres tidak diberikan.');
    return ctx.reply(
      'âš ï¸ <b>Pesan broadcast kosong.</b>\n' +
        'Kirim ulang perintah dengan teks, atau reply sebuah pesan lalu jalankan <code>/broadcastres</code>.',
      { parse_mode: 'HTML' }
    );
  }

  try {
    if (!fs.existsSync(resselFilePath)) {
      return ctx.reply(
        'â„¹ï¸ Belum ada reseller yang terdaftar (file <code>ressel.db</code> kosong).',
        { parse_mode: 'HTML' }
      );
    }

    const fileContent = fs.readFileSync(resselFilePath, 'utf8');
    const resellerList = fileContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');

    if (resellerList.length === 0) {
      return ctx.reply(
        'â„¹ï¸ Belum ada reseller yang terdaftar di <code>ressel.db</code>.',
        { parse_mode: 'HTML' }
      );
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let sukses = 0;
    let gagal = 0;
    let totalTarget = 0;

    // Info awal ke admin
    await ctx.reply(
      `ðŸ“¢ Mulai broadcast ke <b>${resellerList.length}</b> reseller...\n` +
        'Mohon tunggu, proses berjalan bertahap agar tidak kena limit Telegram.',
      { parse_mode: 'HTML' }
    );

    for (const idStr of resellerList) {
      const targetId = Number(idStr);
      if (!targetId) continue;
      totalTarget++;

      try {
        await axios.post(telegramUrl, {
          chat_id: targetId,
          text: messageText,
        });
        sukses++;
        logger.info(`âœ… Broadcastres terkirim ke ${targetId}`);
            } catch (error) {
        gagal++;

        const status = error?.response?.status;
        const retryAfter =
          error?.response?.data?.parameters?.retry_after || 0;

        if (status === 429) {
          logger.warn(
            `â³ Kena limit Telegram (429) saat broadcastres ke ${targetId}. retry_after=${retryAfter}s`
          );
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          await sleep(delayMs);
        } else {
          logger.error(
            `âš ï¸ Gagal kirim broadcastres ke ${targetId}:`,
            error.message || error
          );
        }
      }


      // Jeda kecil supaya aman dari limit
      await sleep(80);
    }

    await ctx.reply(
      `âœ… <b>Broadcast ke reseller selesai.</b>\n\n` +
        `ðŸŽ¯ Target   : <b>${totalTarget}</b> reseller\n` +
        `âœ… Berhasil : <b>${sukses}</b>\n` +
        `âš ï¸ Gagal    : <b>${gagal}</b>\n\n` +
        `<i>Kalau mulai sering dapat error limit, jeda bisa dinaikkan lagi (misal 100â€“120 ms).</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('âŒ Error di broadcastres:', e);
    return ctx.reply(
      'âš ï¸ Terjadi kesalahan saat menjalankan broadcast ke reseller.',
      { parse_mode: 'HTML' }
    );
  }
});

// Broadcast ke MEMBER saja (bukan reseller & bukan admin)
/**
 * Cara pakai:
 * /broadcastmem Pesan...
 * ATAU reply ke pesan lalu kirim /broadcastmem
 */
bot.command('broadcastmem', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.from.id;
  logger.info(`Broadcastmem command received from user_id: ${userId}`);

  // Hanya admin
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // Ambil pesan: dari reply, atau dari teks setelah /broadcastmem
  const msg = ctx.message;
  const messageText = msg.reply_to_message
    ? msg.reply_to_message.text
    : msg.text.split(' ').slice(1).join(' ');

  if (!messageText || !messageText.trim()) {
    logger.info('âš ï¸ Pesan untuk broadcastmem tidak diberikan.');
    return ctx.reply(
      'âš ï¸ <b>Pesan broadcast kosong.</b>\n' +
        'Kirim ulang perintah dengan teks, atau reply sebuah pesan lalu jalankan <code>/broadcastmem</code>.',
      { parse_mode: 'HTML' }
    );
  }

  try {
    // Ambil daftar reseller dari file ressel.db
    let resellerSet = new Set();
    if (fs.existsSync(resselFilePath)) {
      try {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
      } catch (e) {
        logger.error('âš ï¸ Gagal membaca file reseller di broadcastmem:', e);
      }
    }

    // Ambil semua user dari tabel users
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT user_id FROM users', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    if (!rows || rows.length === 0) {
      return ctx.reply(
        'â„¹ï¸ Belum ada user yang terdaftar di database.',
        { parse_mode: 'HTML' }
      );
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let sukses = 0;
    let gagal = 0;
    let totalTarget = 0;

    // Info awal ke admin
    await ctx.reply(
      'ðŸ“¢ Mulai broadcast ke member (non-reseller & non-admin)...\n' +
        'Proses berjalan bertahap agar aman dari limit Telegram.',
      { parse_mode: 'HTML' }
    );

    for (const row of rows) {
      const targetId = row.user_id;
      if (!targetId) continue;

      const idStr = String(targetId);

      // Skip reseller
      if (resellerSet.has(idStr)) {
        continue;
      }

      // Skip admin
      if (ADMIN_IDS.includes(targetId)) {
        continue;
      }

      totalTarget++;

      try {
        await axios.post(telegramUrl, {
          chat_id: targetId,
          text: messageText,
        });
        sukses++;
        logger.info(`âœ… Broadcastmem terkirim ke ${targetId}`);
            } catch (error) {
        gagal++;

        const status = error?.response?.status;
        const retryAfter =
          error?.response?.data?.parameters?.retry_after || 0;

        if (status === 429) {
          logger.warn(
            `â³ Kena limit Telegram (429) saat broadcastmem ke ${targetId}. retry_after=${retryAfter}s`
          );
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          await sleep(delayMs);
        } else {
          logger.error(
            `âš ï¸ Gagal kirim broadcastmem ke ${targetId}:`,
            error.message || error
          );
        }
      }

      // Jeda 80ms biar aman dari limit
      await sleep(80);
    }

    await ctx.reply(
      `âœ… <b>Broadcast ke member selesai.</b>\n\n` +
        `ðŸŽ¯ Target   : <b>${totalTarget}</b> user (bukan reseller & bukan admin)\n` +
        `âœ… Berhasil : <b>${sukses}</b>\n` +
        `âš ï¸ Gagal    : <b>${gagal}</b>\n\n` +
        `<i>Kalau mulai sering kena limit, jeda bisa dinaikkan lagi (misal 100â€“120 ms).</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('âŒ Error di broadcastmem:', e);
    return ctx.reply(
      'âš ï¸ Terjadi kesalahan saat broadcast ke member.',
      { parse_mode: 'HTML' }
    );
  }
});

bot.command('cekqris', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.from?.id || 0;

  // Hanya admin / owner
  if (!adminIds.includes(userId) && userId !== MASTER_ID) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const parts = ctx.message.text.trim().split(/\s+/);
  const invoiceId = parts[1];

  if (!invoiceId) {
    return ctx.reply(
      'â„¹ï¸ Penggunaan:\n<code>/cekqris INV123456789</code>',
      { parse_mode: 'HTML' }
    );
  }

  try {
    // 1. Ambil data dari DB
    const row = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM qris_payments WHERE invoice_id = ? ORDER BY id DESC LIMIT 1',
        [invoiceId],
        (err, r) => (err ? reject(err) : resolve(r))
      );
    });

    if (!row) {
      return ctx.reply(
        'âŒ Invoice tidak ditemukan di tabel <code>qris_payments</code>.',
        { parse_mode: 'HTML' }
      );
    }

    // Simpan status DB di variabel (bisa di-update nanti)
    let dbStatus = row.status || 'pending';
    let dbPaidAt = row.paid_at || null;

    // 2. Cek status ke API
    let apiStatus = '-';
    let apiPaidAt = null;
    let apiExtra = '';
    let apiRes = null;

    try {
      apiRes = await checkQrisInvoiceStatus(row.invoice_id, row.amount, row.created_at);

      if (apiRes) {
        apiStatus = (apiRes.status || '-').toUpperCase();
        apiPaidAt = apiRes.paid_at || null;

        if (apiPaidAt) {
          apiExtra =
            '\nðŸ“… Paid API: ' +
            new Date(apiPaidAt).toLocaleString('id-ID', {
              timeZone: TIME_ZONE,
            });
        }
      }
    } catch (e) {
      logger.error('âš ï¸ Gagal cek status QRIS ke API dari /cekqris:', e);
      apiStatus = 'ERROR';
      apiExtra = `\nâš ï¸ ${e.message || String(e)}`;
    }

    // 3. Kalau DB masih pending tapi API sudah PAID â†’ langsung selesaikan topup
    if (dbStatus !== 'paid' && apiStatus === 'PAID') {
      const paidTs = apiPaidAt || Date.now();
      const finalRes = await finalizeQrisPayment({
        paymentRow: row,
        matchedTx: apiRes?.transaction || { time: paidTs, status: 'settlement' },
        transactionType: 'qris_manual_topup',
        transactionRef: `qris_manual_${row.invoice_id}`,
      });

      if (finalRes.applied) {
        // update variabel biar tampilan pakai status terbaru
        dbStatus = 'paid';
        dbPaidAt = finalRes.paidAt || paidTs;

        // kirim notif ke user
        try {
          // ambil saldo terbaru
          const userRow = await new Promise((resolve, reject) => {
            db.get(
              'SELECT saldo FROM users WHERE user_id = ?',
              [row.user_id],
              (err, r) => (err ? reject(err) : resolve(r))
            );
          });

          const saldoNow = userRow?.saldo || 0;

          const msgUser =
            'âœ… <b>Topup Saldo Berhasil (Manual Sync)</b>\n\n' +
            'ðŸ’³ Metode : <b>QRIS Otomatis</b>\n' +
            `ðŸ§¾ Invoice : <code>${row.invoice_id}</code>\n` +
            `ðŸ’° Nominal : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n\n` +
            `ðŸ’¼ Saldo kamu sekarang: <b>${saldoNow.toLocaleString('id-ID')}</b>`;

          await bot.telegram.sendMessage(row.user_id, msgUser, {
            parse_mode: 'HTML',
          });

          // notif ke grup (kalau diaktifkan)
          if (GROUP_ID && NOTIF_TOPUP_GROUP) {
            const chatId = row.user_id;
            let chatInfo;
            try {
              chatInfo = await bot.telegram.getChat(chatId);
            } catch (e) {
              chatInfo = {};
            }

            let userLabel;
            if (chatInfo.username) {
              userLabel = chatInfo.username;
            } else if (chatInfo.first_name) {
              userLabel = chatInfo.first_name;
            } else {
              userLabel = String(chatId);
            }

            const msgGroup =
              '<blockquote>\n' +
              'ðŸ’° TOPUP SALDO (QRIS)' +
              '<code>\n' + // <-- MULAI BLOK MONOSPACE
              `ðŸ‘¤ User   : ${userLabel}\n` +
              `ðŸ’° Nominal: Rp${row.amount.toLocaleString('id-ID')}\n` +
              `ðŸ§¾ Invoice: ${row.invoice_id}\n` +
              '</code>\n' + // <-- AKHIR BLOK MONOSPACE
              'â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n' +
              '</blockquote>';

            await bot.telegram.sendMessage(GROUP_ID, msgGroup, {
              parse_mode: 'HTML',
            });
          }
        } catch (e) {
          logger.error(
            'âŒ Gagal kirim notif ke user/grup setelah /cekqris:',
            e
          );
        }
      }
    }

    // 4. Tampilkan hasil ke admin (pakai status DB TERBARU)
    const createdAtText = new Date(row.created_at).toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
    });

    const paidAtDbText = dbPaidAt
      ? new Date(dbPaidAt).toLocaleString('id-ID', { timeZone: TIME_ZONE })
      : '-';

    const baseAmount = row.base_amount || 0;
    const uniqueSuffix = row.unique_suffix || 0;

    let nominalInfo = '';
    if (baseAmount > 0) {
      if (uniqueSuffix > 0) {
        nominalInfo =
          `ðŸ’° Dipilih user : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
          `ðŸ’  Kode unik    : <b>${uniqueSuffix
            .toString()
            .padStart(3, '0')}</b>\n` +
          `ðŸ’³ Dibayar      : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n`;
      } else {
        // base ada, tapi kode unik 0 (misalnya lagi dimatikan)
        nominalInfo =
          `ðŸ’° Dipilih user : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
          `ðŸ’³ Dibayar      : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n`;
      }
    } else {
      // data lama (waktu belum ada kolom base_amount / unique_suffix)
      nominalInfo =
        `ðŸ’³ Dibayar      : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n` +
        '<i>(base_amount tidak tersimpan â€” transaksi lama)</i>\n';
    }

    const msg =
      'ðŸ”Ž <b>Cek Invoice QRIS</b>\n\n' +
      `ðŸ§¾ Invoice : <code>${row.invoice_id}</code>\n` +
      `ðŸ‘¤ User ID : <code>${row.user_id}</code>\n\n` +
      nominalInfo +
      '\n' +
      `ðŸ“Š Status DB : <b>${dbStatus.toUpperCase()}</b>\n` +
      `ðŸ•’ Dibuat    : ${createdAtText}\n` +
      `âœ… Dibayar   : ${paidAtDbText}\n\n` +
      `ðŸ“¡ Status API: <b>${apiStatus}</b>${apiExtra}`;

    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e) {
    logger.error('âŒ Error di /cekqris:', e);
    await ctx.reply('âŒ Terjadi kesalahan saat cek invoice QRIS.', {
      parse_mode: 'HTML',
    });
  }
});


bot.command('addserver', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
  return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}


  const args = ctx.message.text.split(' ');
  if (args.length !== 8) {
      return ctx.reply('âš ï¸ Format salah. Gunakan: `/addserver <domain> <auth> <harga> <nama_server> <quota> <iplimit> <batas_create_account>`', { parse_mode: 'Markdown' });
  }

  const [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun] = args.slice(1);

  const numberOnlyRegex = /^\d+$/;
  if (!numberOnlyRegex.test(harga) || !numberOnlyRegex.test(quota) || !numberOnlyRegex.test(iplimit) || !numberOnlyRegex.test(batas_create_akun)) {
      return ctx.reply('âš ï¸ `harga`, `quota`, `iplimit`, dan `batas_create_akun` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  // âœ… QUERY YANG BENAR
  db.run("INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      [domain, auth, parseInt(harga), nama_server, parseInt(quota), parseInt(iplimit), parseInt(batas_create_akun)],
      function(err) {
          if (err) {
              logger.error('âš ï¸ Kesalahan saat menambahkan server:', err.message);
              return ctx.reply('âš ï¸ Kesalahan saat menambahkan server.', { parse_mode: 'Markdown' });
          }
          ctx.reply(`âœ… Server \`${nama_server}\` berhasil ditambahkan.`, { parse_mode: 'Markdown' });
      }
  );
});

bot.command('editharga', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // Pecah teks command: /editharga domain harga
  const args = ctx.message.text.trim().split(/\s+/);
  // args[0] = "/editharga"
  if (args.length !== 3) {
    return ctx.reply(
      'âš ï¸ Format salah. Gunakan:\n`/editharga <domain> <harga>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const hargaStr = args[2];

  // Validasi harga harus angka positif
  if (!/^\d+$/.test(hargaStr)) {
    return ctx.reply(
      'âš ï¸ `harga` harus berupa angka (tanpa titik/koma).',
      { parse_mode: 'Markdown' }
    );
  }

  const hargaBaru = parseInt(hargaStr, 10);

  db.run(
    'UPDATE Server SET harga = ? WHERE domain = ?',
    [hargaBaru, domain],
    function (err) {
      if (err) {
        logger.error('âš ï¸ Kesalahan saat mengedit harga server:', err.message);
        return ctx.reply(
          'âš ï¸ Terjadi kesalahan saat mengedit harga server.',
          { parse_mode: 'Markdown' }
        );
      }

      // this.changes = berapa baris yang kena UPDATE
      if (this.changes === 0) {
        return ctx.reply(
          'âš ï¸ Server dengan domain tersebut tidak ditemukan.',
          { parse_mode: 'Markdown' }
        );
      }

      ctx.reply(
        `âœ… Harga server \`${domain}\` berhasil diubah menjadi \`${hargaBaru}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});


// =========================
// EDIT DATA SERVER
// =========================

bot.command('editnama', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editnama <domain> <nama_server_baru...>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length < 3) {
    return ctx.reply(
      'âš ï¸ Format salah.\nGunakan:\n`/editnama <domain> <nama_server_baru>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const namaBaru = args.slice(2).join(' '); // nama bisa pakai spasi

  db.run(
    'UPDATE Server SET nama_server = ? WHERE domain = ?',
    [namaBaru, domain],
    function (err) {
      if (err) {
        logger.error('âš ï¸ Kesalahan saat mengedit nama server:', err.message);
        return ctx.reply('âš ï¸ Kesalahan saat mengedit nama server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('âš ï¸ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `âœ… Nama server untuk \`${domain}\` berhasil diubah menjadi \`${namaBaru}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.action(/edit_domain_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit domain server dengan ID: ${serverId}`);

  // Ambil domain sekarang dari database
  db.get('SELECT domain FROM Server WHERE id = ?', [serverId], async (err, row) => {
    if (err) {
      logger.error('Kesalahan saat mengambil data server untuk edit domain:', err.message);
      await ctx.reply('âš ï¸ Terjadi kesalahan saat mengambil data server.');
      return;
    }

    if (!row) {
      await ctx.reply('âš ï¸ Server tidak ditemukan.');
      return;
    }

    const currentDomain = row.domain || '-';

    // Simpan state: input berikutnya dianggap sebagai domain baru
    userState[ctx.chat.id] = {
      step: 'edit_domain',
      serverId: serverId,
      oldDomain: currentDomain,
    };

    await ctx.reply(
      'ðŸŒ *Silakan ketik domain server baru, lalu kirim sebagai pesan biasa.*\n' +
        `âœï¸ Contoh: \`${currentDomain}\`\n` +
        'âŒ Ketik *batal* untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );
  });
});


bot.command('editauth', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editauth <domain> <auth_baru>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length !== 3) {
    return ctx.reply(
      'âš ï¸ Format salah.\nGunakan:\n`/editauth <domain> <auth_baru>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const authBaru = args[2];

  db.run(
    'UPDATE Server SET auth = ? WHERE domain = ?',
    [authBaru, domain],
    function (err) {
      if (err) {
        logger.error('âš ï¸ Kesalahan saat mengedit auth server:', err.message);
        return ctx.reply('âš ï¸ Kesalahan saat mengedit auth server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('âš ï¸ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `âœ… Auth server untuk \`${domain}\` berhasil diubah.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('editlimitquota', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editlimitquota <domain> <quota>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length !== 3) {
    return ctx.reply(
      'âš ï¸ Format salah.\nGunakan:\n`/editlimitquota <domain> <quota>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const quotaStr = args[2];

  if (!/^\d+$/.test(quotaStr)) {
    return ctx.reply('âš ï¸ `quota` harus berupa angka.', {
      parse_mode: 'Markdown',
    });
  }

  const quota = parseInt(quotaStr, 10);

  db.run(
    'UPDATE Server SET quota = ? WHERE domain = ?',
    [quota, domain],
    function (err) {
      if (err) {
        logger.error(
          'âš ï¸ Kesalahan saat mengedit quota server:',
          err.message
        );
        return ctx.reply('âš ï¸ Kesalahan saat mengedit quota server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('âš ï¸ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `âœ… Quota server \`${domain}\` berhasil diubah menjadi \`${quota}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('editlimitip', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editlimitip <domain> <iplimit>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length !== 3) {
    return ctx.reply(
      'âš ï¸ Format salah.\nGunakan:\n`/editlimitip <domain> <iplimit>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const ipLimitStr = args[2];

  if (!/^\d+$/.test(ipLimitStr)) {
    return ctx.reply('âš ï¸ `iplimit` harus berupa angka.', {
      parse_mode: 'Markdown',
    });
  }

  const iplimit = parseInt(ipLimitStr, 10);

  db.run(
    'UPDATE Server SET iplimit = ? WHERE domain = ?',
    [iplimit, domain],
    function (err) {
      if (err) {
        logger.error(
          'âš ï¸ Kesalahan saat mengedit iplimit server:',
          err.message
        );
        return ctx.reply('âš ï¸ Kesalahan saat mengedit iplimit server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('âš ï¸ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `âœ… Limit IP server \`${domain}\` berhasil diubah menjadi \`${iplimit}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('editlimitcreate', async (ctx) => {
  if (!ensurePrivateChat(ctx)) return;

  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  // /editlimitcreate <domain> <batas_create_akun>
  const args = ctx.message.text.trim().split(/\s+/);
  if (args.length !== 3) {
    return ctx.reply(
      'âš ï¸ Format salah.\nGunakan:\n`/editlimitcreate <domain> <batas_create_akun>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const batasStr = args[2];

  if (!/^\d+$/.test(batasStr)) {
    return ctx.reply(
      'âš ï¸ `batas_create_akun` harus berupa angka.',
      { parse_mode: 'Markdown' }
    );
  }

  const batas = parseInt(batasStr, 10);

  db.run(
    'UPDATE Server SET batas_create_akun = ? WHERE domain = ?',
    [batas, domain],
    function (err) {
      if (err) {
        logger.error(
          'âš ï¸ Kesalahan saat mengedit batas_create_akun server:',
          err.message
        );
        return ctx.reply(
          'âš ï¸ Kesalahan saat mengedit batas_create_akun server.',
          { parse_mode: 'Markdown' }
        );
      }

      if (this.changes === 0) {
        return ctx.reply('âš ï¸ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `âœ… Batas create akun server \`${domain}\` berhasil diubah menjadi \`${batas}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.command('edittotalcreate', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  const userId = ctx.message.from.id;
  if (!ADMIN_IDS.includes(userId)) {
  return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}


  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('âš ï¸ Format salah. Gunakan: `/edittotalcreate <domain> <total_create_akun>`', { parse_mode: 'Markdown' });
  }

  const [domain, total_create_akun] = args.slice(1);

  if (!/^\d+$/.test(total_create_akun)) {
      return ctx.reply('âš ï¸ `total_create_akun` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  db.run("UPDATE Server SET total_create_akun = ? WHERE domain = ?", [parseInt(total_create_akun), domain], function(err) {
      if (err) {
          logger.error('âš ï¸ Kesalahan saat mengedit total_create_akun server:', err.message);
          return ctx.reply('âš ï¸ Kesalahan saat mengedit total_create_akun server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('âš ï¸ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`âœ… Total create akun server \`${domain}\` berhasil diubah menjadi \`${total_create_akun}\`.`, { parse_mode: 'Markdown' });
  });
});
async function handleServiceAction(ctx, action) {
  let keyboard;

  if (action === 'create') {
    keyboard = [
      [{ text: 'Buat Ssh/Ovpn', callback_data: 'create_ssh' }],
      [
        { text: 'Buat Vmess', callback_data: 'create_vmess' },
        { text: 'Buat Vless', callback_data: 'create_vless' }
      ],
      [
        { text: 'Buat Trojan', callback_data: 'create_trojan' },
        /*{ text: 'Buat Shadowsocks', callback_data: 'create_shadowsocks' }*/ 
        { text: 'ðŸ”™ Kembali', callback_data: 'send_main_menu' }
      ]
    ];
  } else if (action === 'trial') {
    keyboard = [
      [{ text: 'Trial Ssh/Ovpn', callback_data: 'trial_ssh' }],
      [
        { text: 'Trial Vmess', callback_data: 'trial_vmess' },
        { text: 'Trial Vless', callback_data: 'trial_vless' }
      ],
      [
        { text: 'Trial Trojan', callback_data: 'trial_trojan' },
        /*{ text: 'Trial Shadowsocks', callback_data: 'trial_shadowsocks' }*/ 
        { text: 'ðŸ”™ Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  } else if (action === 'renew') {
    keyboard = [
      [{ text: 'Perpanjang Ssh/Ovpn', callback_data: 'renew_ssh' }],
      [
        { text: 'Perpanjang Vmess', callback_data: 'renew_vmess' },
        { text: 'Perpanjang Vless', callback_data: 'renew_vless' }
      ],
      [
        { text: 'Perpanjang Trojan', callback_data: 'renew_trojan' },
        /*{ text: 'Perpanjang Shadowsocks', callback_data: 'renew_shadowsocks' }*/ 
        { text: 'ðŸ”™ Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  } else if (action === 'del') {
    keyboard = [
      [{ text: 'Hapus Ssh/Ovpn', callback_data: 'del_ssh' }],
      [
        { text: 'Hapus Vmess', callback_data: 'del_vmess' },
        { text: 'Hapus Vless', callback_data: 'del_vless' }
      ],
      [
        { text: 'Hapus Trojan', callback_data: 'del_trojan' },
        /*{ text: 'Hapus Shadowsocks', callback_data: 'del_shadowsocks' }*/ 
        { text: 'ðŸ”™ Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  } else if (action === 'lock') {
    keyboard = [
      [{ text: 'Lock Ssh/Ovpn', callback_data: 'lock_ssh' }],
      [
        { text: 'Lock Vmess', callback_data: 'lock_vmess' },
        { text: 'Lock Vless', callback_data: 'lock_vless' }
      ],
      [
        { text: 'Lock Trojan', callback_data: 'lock_trojan' },
        /*{ text: 'Lock Shadowsocks', callback_data: 'lock_shadowsocks' }*/ 
        { text: 'ðŸ”™ Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  } else if (action === 'unlock') {
    keyboard = [
      [{ text: 'Unlock Ssh/Ovpn', callback_data: 'unlock_ssh' }],
      [
        { text: 'Unlock Vmess', callback_data: 'unlock_vmess' },
        { text: 'Unlock Vless', callback_data: 'unlock_vless' }
      ],
      [
        { text: 'Unlock Trojan', callback_data: 'unlock_trojan' },
        /*{ text: 'Unlock Shadowsocks', callback_data: 'unlock_shadowsocks' }*/ 
        { text: 'ðŸ”™ Kembali', callback_data: 'send_main_menu' }
      ],
    ];
  }

  // ðŸ”¹ Khusus menu TRIAL: kirim teks penjelasan + keyboard dalam satu pesan
     if (action === 'trial') {
    let durationHours = 1;
    let maxPerDay = 1;
    let minBalance = 0;

    try {
      const cfg = await getTrialConfig();
      if (cfg) {
        if (Number.isInteger(cfg.durationHours))      durationHours = cfg.durationHours;
        if (Number.isInteger(cfg.maxPerDay))          maxPerDay     = cfg.maxPerDay;
        if (Number.isInteger(cfg.minBalanceForTrial)) minBalance    = cfg.minBalanceForTrial;
      }
    } catch (e) {
      logger.error('âš ï¸ Gagal membaca konfigurasi trial di handleServiceAction:', e.message);
    }

    let infoText =
      'âŒ› *Trial Akun*\n\n' +
      `â€¢ Masa aktif trial saat ini sekitar *${durationHours} jam*.\n` +
      `â€¢ Setiap user bisa memakai trial hingga *${maxPerDay}x per hari* (kecuali reseller).\n`;

    if (minBalance > 0) {
      infoText +=
        `â€¢ Trial hanya bisa digunakan jika saldo kamu minimal *Rp${minBalance}*.\n`;
    }

    infoText +=
      'â€¢ Trial dipakai untuk coba kualitas server sebelum kamu beli akun berbayar.\n\n' +
      'Kalau cocok, kamu bisa lanjut beli akun lewat menu *âž• Buat Akun* atau daftar sebagai *Reseller*.\n\n' +
      'Silakan pilih jenis akun yang mau kamu coba:';

        try {
      await sendCleanMenu(ctx, infoText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
      logger.info('trial service menu sent (clean)');
    } catch (error) {
      logger.error('Error saat mengirim menu trial:', error);
    }
    return;
 }

    // ðŸ”¹ Untuk create / renew / del / lock / unlock â†’ tampilkan menu lewat sendCleanMenu
  try {
    const msgText = `Pilih jenis layanan yang ingin Anda ${action}:`;
    await sendCleanMenu(ctx, msgText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
    logger.info(`${action} service menu sent (clean)`);
  } catch (error) {
    logger.error(`Error saat mengirim menu ${action}:`, error);
  }
}

async function sendAdminMenu(ctx) {
  // === SUSUN TEKS INFO LISENSI (HANYA UNTUK ADMIN) ===
  let headerText = '<b>ðŸ”§ MENU ADMIN</b>';
  if (EXPIRE_DATE && ADMIN_IDS.includes(ctx.from.id)) {
    const info = getLicenseInfo();
    if (info) {
      const expireText = info.expire.toLocaleDateString('id-ID', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });

      let statusText;
      if (info.daysLeft > 0) {
        statusText =
          `ðŸ” <b>INFO LISENSI BOT</b>\n` +
          `Aktif sampai: <b>${expireText}</b>\n` +
          `Sisa: <b>${info.daysLeft}</b> hari`;
      } else if (info.daysLeft === 0) {
        statusText =
          `ðŸ” <b>INFO LISENSI BOT</b>\n` +
          `Berakhir: <b>${expireText}</b>\n` +
          `â³ Status: <b>HARI INI</b>`;
      } else {
        statusText =
          `ðŸ” <b>INFO LISENSI BOT</b>\n` +
          `Habis: <b>${expireText}</b>\n` +
          `â›” Lewat: <b>${Math.abs(info.daysLeft)}</b> hari lalu`;
      }

      headerText += `\n\n${statusText}`;
    }
  }

       // === TOMBOL ADMIN (RAPI, PAKAI SUBMENU SERVER) ===
      const adminKeyboard = [
  // ðŸ§¾ Submenu Reseller & Saldo
  [
    { text: 'ðŸ§¾ Menu Reseller & Saldo', callback_data: 'admin_reseller_menu' }
  ],

  // ðŸŒ Submenu Server
  [
    { text: 'âš™ï¸ Menu Server', callback_data: 'admin_server_menu' }
  ],

    // ðŸ“Š Monitoring & List User
  [
    { text: 'ðŸ“Š Monitor User & Reseller', callback_data: 'monitor_panel' },
    { text: 'ðŸ“‹ List Semua User',         callback_data: 'list_all_users' }
  ],
    // ðŸš© Flag / Tandai user
  [
    { text: 'ðŸš© Tandai User', callback_data: 'flag_user_start' }
  ],
  // âŒ› Pengaturan Trial
  [
    { text: 'âŒ› Pengaturan Trial', callback_data: 'admin_trial_menu' }
  ],

  // ðŸ“¦ Backup & auto backup
  [
    { text: 'ðŸ“¦ Backup Database', callback_data: 'backup_db' },
    { text: 'ðŸ—„ï¸ Auto Backup',     callback_data: 'backup_auto_menu' }
  ],
  
// ðŸŒ Timezone bot
  [
    { text: 'ðŸŒ Timezone Bot', callback_data: 'timezone_menu' }
  ],
    // ðŸ–¼ï¸ QRIS & pengingat expired
  [
    { text: 'ðŸ–¼ï¸ Upload Gambar QRIS', callback_data: 'upload_qris' },
    { text: 'â° Pengingat Expired',   callback_data: 'expiry_reminder_menu' }
  ],

  // ðŸ“¢ Template promosi & pengumuman
  [
    { text: 'ðŸ“¢ Template Promosi', callback_data: 'promo_template_menu' },
    { text: 'ðŸ“£ Kirim Pengumuman', callback_data: 'broadcast_menu' }
  ],
  [
    { text: 'ðŸ”™ Kembali', callback_data: 'send_main_menu' }
  ]
];



    try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: adminKeyboard
    });
    logger.info('Admin menu sent');
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      await ctx.reply(headerText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: adminKeyboard
        }
      });
      logger.info('Admin menu sent as new message');
    } else {
      logger.error('Error saat mengirim menu admin:', error);
    }
  }
}
// ====== ADMIN: PENGATURAN TRIAL ======
bot.action('admin_trial_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const cfg = await getTrialConfig();

    const tempCfg = {
      enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : DEFAULT_TRIAL_CONFIG.enabled,
      maxPerDay: Number.isInteger(cfg.maxPerDay) ? cfg.maxPerDay : DEFAULT_TRIAL_CONFIG.maxPerDay,
      durationHours: Number.isInteger(cfg.durationHours) ? cfg.durationHours : DEFAULT_TRIAL_CONFIG.durationHours,
      minBalanceForTrial: Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial >= 0
        ? cfg.minBalanceForTrial
        : DEFAULT_TRIAL_CONFIG.minBalanceForTrial
    };

    adminTrialTemp[ctx.from.id] = tempCfg;

    await renderAdminTrialMenu(ctx, tempCfg, { edit: false });
  } catch (err) {
    logger.error('âŒ Gagal membuka menu pengaturan trial:', err.message);
    ctx.reply('âŒ Terjadi kesalahan saat membuka pengaturan trial.');
  }
});


bot.action('admin_trial_toggle', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    temp.enabled = !temp.enabled;

    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('âŒ Gagal mengubah status trial (temp):', err.message);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah status trial.');
  }
});

bot.action('admin_trial_max_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.maxPerDay)
      ? temp.maxPerDay
      : DEFAULT_TRIAL_CONFIG.maxPerDay;

    current += 1;
    if (current > 10) current = 10; // batas atas 10x/hari

    temp.maxPerDay = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('âŒ Gagal menaikkan maxPerDay trial (temp):', err.message);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah batas trial per hari.');
  }
});

bot.action('admin_trial_max_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.maxPerDay)
      ? temp.maxPerDay
      : DEFAULT_TRIAL_CONFIG.maxPerDay;

    current -= 1;
    if (current < 1) current = 1; // minimal 1x/hari

    temp.maxPerDay = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('âŒ Gagal menurunkan maxPerDay trial (temp):', err.message);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah batas trial per hari.');
  }
});
bot.action('admin_trial_min_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.minBalanceForTrial)
      ? temp.minBalanceForTrial
      : DEFAULT_TRIAL_CONFIG.minBalanceForTrial;

    const step = 1000;           // naik 1000 per klik (bisa kamu ubah)
    const maxVal = 1000000;      // batas atas 1 juta (bisa diubah juga)

    current += step;
    if (current > maxVal) current = maxVal;

    temp.minBalanceForTrial = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('âŒ Gagal menaikkan minBalanceForTrial (temp):', err.message);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah minimal saldo trial.');
  }
});

bot.action('admin_trial_min_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.minBalanceForTrial)
      ? temp.minBalanceForTrial
      : DEFAULT_TRIAL_CONFIG.minBalanceForTrial;

    const step = 1000;
    current -= step;
    if (current < 0) current = 0;   // boleh 0 = bebas

    temp.minBalanceForTrial = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('âŒ Gagal menurunkan minBalanceForTrial (temp):', err.message);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah minimal saldo trial.');
  }
});

bot.action('admin_trial_min_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_trial_dur_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.durationHours)
      ? temp.durationHours
      : DEFAULT_TRIAL_CONFIG.durationHours;

    current += 1;
    if (current > 24) current = 24; // batas atas 24 jam

    temp.durationHours = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('âŒ Gagal menaikkan durasi trial (temp):', err.message);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah durasi trial.');
  }
});

bot.action('admin_trial_dur_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.durationHours)
      ? temp.durationHours
      : DEFAULT_TRIAL_CONFIG.durationHours;

    current -= 1;
    if (current < 1) current = 1; // minimal 1 jam

    temp.durationHours = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('âŒ Gagal menurunkan durasi trial (temp):', err.message);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah durasi trial.');
  }
});

bot.action('admin_trial_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_trial_dur_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_trial_save', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const adminId = ctx.from.id;
    const temp = adminTrialTemp[adminId] || (await getTrialConfig());

    const normalized = {
      enabled: typeof temp.enabled === 'boolean' ? temp.enabled : DEFAULT_TRIAL_CONFIG.enabled,
      maxPerDay:
        Number.isInteger(temp.maxPerDay) && temp.maxPerDay > 0
          ? temp.maxPerDay
          : DEFAULT_TRIAL_CONFIG.maxPerDay,
      durationHours:
        Number.isInteger(temp.durationHours) && temp.durationHours > 0
          ? temp.durationHours
          : DEFAULT_TRIAL_CONFIG.durationHours,
      minBalanceForTrial:
        Number.isInteger(temp.minBalanceForTrial) && temp.minBalanceForTrial >= 0
          ? temp.minBalanceForTrial
          : DEFAULT_TRIAL_CONFIG.minBalanceForTrial
    };

    await updateTrialConfig(normalized);

    // Hapus draft sementara
    delete adminTrialTemp[adminId];

    const statusText = normalized.enabled ? 'Aktif âœ…' : 'Nonaktif â›”';

    await ctx.reply(
      'âœ… *Pengaturan trial berhasil disimpan.*\n\n' +
      `Status trial          : *${statusText}*\n` +
      `Max trial / hari      : *${normalized.maxPerDay}x per user*\n` +
      `Lama trial per akun   : *${normalized.durationHours} jam*\n` +
      `Min saldo untuk trial : *Rp${normalized.minBalanceForTrial}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error('âŒ Gagal menyimpan pengaturan trial:', err.message);
    ctx.reply('âŒ Terjadi kesalahan saat menyimpan pengaturan trial.');
  }
});


function getAdminTrialTemp(ctx) {
  const adminId = ctx.from.id;
  let temp = adminTrialTemp[adminId];
  if (!temp) {
    temp = {
      enabled: DEFAULT_TRIAL_CONFIG.enabled,
      maxPerDay: DEFAULT_TRIAL_CONFIG.maxPerDay,
      durationHours: DEFAULT_TRIAL_CONFIG.durationHours
    };
    adminTrialTemp[adminId] = temp;
  }
  return temp;
}

async function renderResellerTargetMenu(ctx, options = {}) {
  const isEdit = options.edit || false;

  const statusText = RESELLER_TARGET_ENABLED ? 'Aktif âœ…' : 'Nonaktif â›”';
  const min30 = RESELLER_TARGET_MIN_30D_ACCOUNTS;
  const minDays = RESELLER_TARGET_MIN_DAYS_PER_MONTH;

  const message =
    'ðŸŽ¯ *Pengaturan Target Reseller*\n\n' +
    `Status target bulanan : *${statusText}*\n` +
    `Minimal akun 30 hari  : *${min30} akun/bulan*\n` +
    `Minimal total hari    : *${minDays} hari/bulan*\n\n` +
    '_Reseller yang tidak memenuhi salah satu target di atas ' +
    'pada akhir bulan akan otomatis turun menjadi member biasa._';

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: RESELLER_TARGET_ENABLED ? 'â›” Nonaktifkan' : 'âœ… Aktifkan',
          callback_data: 'admin_res_target_toggle'
        }
      ],
      [
        { text: 'âž–', callback_data: 'admin_res_target_min30_dec' },
        {
          text: `Min 30 Hari: ${min30}`,
          callback_data: 'admin_res_target_min30_nop'
        },
        { text: 'âž•', callback_data: 'admin_res_target_min30_inc' }
      ],
      [
        { text: 'â¬', callback_data: 'admin_res_target_days_dec' },
        {
          text: `Min Total: ${minDays} hari`,
          callback_data: 'admin_res_target_days_nop'
        },
        { text: 'â«', callback_data: 'admin_res_target_days_inc' }
      ],
      [
        {
          text: 'ðŸ”™ Kembali ke Menu Reseller',
          callback_data: 'admin_reseller_menu'
        }
      ]
    ]
  };

  if (isEdit) {
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } catch (err) {
      logger.error(
        'Gagal edit pesan menu target reseller:',
        err.message || err
      );
      try {
        await ctx.reply(message, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup
        });
      } catch (e2) {
        logger.error(
          'Gagal kirim pesan menu target reseller:',
          e2.message || e2
        );
      }
    }
  } else {
    try {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } catch (err) {
      logger.error(
        'Gagal kirim pesan menu target reseller:',
        err.message || err
      );
    }
  }
}

async function renderAdminTrialMenu(ctx, cfg, options = {}) {
  const isEdit = options.edit || false;

  const statusText = cfg.enabled ? 'Aktif âœ…' : 'Nonaktif â›”';
  const maxPerDay = cfg.maxPerDay;
  const durationHours = cfg.durationHours;
  const minBalance = cfg.minBalanceForTrial || 0;

  const message =
    'âŒ› *Pengaturan Trial Akun*\n\n' +
    `Status trial saat ini           : *${statusText}*\n` +
    `Maksimal trial / user / hari    : *${maxPerDay}x*\n` +
    `Lama trial (masa aktif akun)    : *${durationHours} jam*\n` +
    `Minimal saldo untuk trial       : *Rp${minBalance}*\n\n` +
    'Silakan atur nilai di bawah ini.\n' +
    'Perubahan *belum disimpan* sebelum kamu menekan tombol *âœ… Simpan Pengaturan*.\n';

  const toggleText = cfg.enabled ? 'â›” Matikan Trial' : 'âœ… Aktifkan Trial';

  const replyMarkup = {
    inline_keyboard: [
      [{ text: toggleText, callback_data: 'admin_trial_toggle' }],
      [
        { text: 'âž–', callback_data: 'admin_trial_max_dec' },
        { text: `Max/Hari: ${maxPerDay}x`, callback_data: 'admin_trial_nop' },
        { text: 'âž•', callback_data: 'admin_trial_max_inc' }
      ],
      [
        { text: 'â¬', callback_data: 'admin_trial_dur_dec' },
        { text: `Lama: ${durationHours} jam`, callback_data: 'admin_trial_dur_nop' },
        { text: 'â«', callback_data: 'admin_trial_dur_inc' }
      ],
      [
        { text: 'â¬‡ï¸', callback_data: 'admin_trial_min_dec' },
        { text: `Min Saldo: Rp${minBalance}`, callback_data: 'admin_trial_min_nop' },
        { text: 'â¬†ï¸', callback_data: 'admin_trial_min_inc' }
      ],
      [
        { text: 'âœ… Simpan Pengaturan', callback_data: 'admin_trial_save' }
      ],
      [
        { text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' }
      ]
    ]
  };

  if (isEdit) {
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } catch (err) {
      logger.error('Gagal edit pesan pengaturan trial, kirim baru:', err.message);
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    }
  } else {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });
  }
}


const resselFilePath = path.join(__dirname, 'ressel.db');

// Cache in-memory daftar reseller (string user_id)
let resellerCache = new Set();

/**
 * Load resellerCache dari file ressel.db (dipanggil saat start bot)
 */
function loadResellerCacheFromFile() {
  resellerCache = new Set();
  try {
    if (!fs.existsSync(resselFilePath)) {
      logger.info('ressel.db belum ada, resellerCache dikosongkan.');
      return;
    }

    const fileContent = fs.readFileSync(resselFilePath, 'utf8');
    fileContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .forEach((idStr) => {
        resellerCache.add(idStr);
      });

    logger.info(`Reseller cache dimuat: ${resellerCache.size} ID.`);
  } catch (e) {
    logger.error('âš ï¸ Gagal load resellerCache dari ressel.db:', e.message || e);
    resellerCache = new Set();
  }
}

/**
 * Simpan resellerCache ke file ressel.db
 */
function saveResellerCacheToFile() {
  try {
    const content =
      Array.from(resellerCache).join('\n') + (resellerCache.size ? '\n' : '');
    fs.writeFileSync(resselFilePath, content);
    logger.info(
      `Reseller cache disimpan ke ressel.db (${resellerCache.size} ID).`
    );
  } catch (e) {
    logger.error(
      'âš ï¸ Gagal menyimpan resellerCache ke ressel.db:',
      e.message || e
    );
  }
}

/**
 * Ambil snapshot Set reseller (untuk fungsi-fungsi lama yang butuh Set)
 */
function readResellerSetSync() {
  // sekarang tidak baca file lagi, pakai cache
  return new Set(resellerCache);
}

/**
 * Cek apakah user_id adalah reseller
 */
function isResellerId(userId) {
  if (!userId) return false;
  return resellerCache.has(String(userId));
}

/**
 * Tambah ID ke daftar reseller (update cache + file)
 */
function addResellerIdToCache(userId) {
  const idStr = String(userId).trim();
  if (!idStr) return false;
  if (resellerCache.has(idStr)) return false;

  resellerCache.add(idStr);
  saveResellerCacheToFile();
  return true;
}

/**
 * Hapus ID dari daftar reseller (update cache + file)
 */
function removeResellerIdFromCache(userId) {
  const idStr = String(userId).trim();
  if (!resellerCache.has(idStr)) return false;

  resellerCache.delete(idStr);
  saveResellerCacheToFile();
  return true;
}

// Panggil sekali saat start
loadResellerCacheFromFile();


// Ambil daftar target pengumuman sesuai pilihan
function getBroadcastTargetsFromMenu(target) {
  return new Promise((resolve, reject) => {
    if (target === 'all') {
      db.all('SELECT user_id FROM users', [], (err, rows) => {
        if (err) {
          logger.error('âš ï¸ Kesalahan saat mengambil daftar pengguna (broadcast menu all):', err.message);
          return reject(err);
        }
        const set = new Set();
        if (rows && rows.length > 0) {
          rows.forEach((r) => {
            const idNum = Number(r.user_id);
            if (!Number.isNaN(idNum)) {
              set.add(idNum);
            }
          });
        }
        resolve(set);
      });
      return;
    }

    // selain "all", butuh data reseller
    const resellerSet = readResellerSetSync();

    if (target === 'reseller') {
      const set = new Set();
      resellerSet.forEach((idStr) => {
        const idNum = Number(idStr);
        if (!Number.isNaN(idNum)) {
          set.add(idNum);
        }
      });
      resolve(set);
      return;
    }

    if (target === 'member') {
      db.all('SELECT user_id FROM users', [], (err, rows) => {
        if (err) {
          logger.error('âš ï¸ Kesalahan saat mengambil daftar pengguna (broadcast menu member):', err.message);
          return reject(err);
        }

        const set = new Set();
        if (rows && rows.length > 0) {
          rows.forEach((r) => {
            const idNum = Number(r.user_id);
            if (Number.isNaN(idNum)) return;

            const idStr = String(r.user_id);
            // Kecualikan reseller & admin
            if (resellerSet.has(idStr)) return;
            if (adminIds.includes(idNum)) return;
            if (idNum === MASTER_ID) return;

            set.add(idNum);
          });
        }
        resolve(set);
      });
      return;
    }

    // target tidak dikenal â†’ kosong
    resolve(new Set());
  });
}

// ============================================================================

// ============ END SECTION: PAYMENT - QRIS AUTO TOPUP (GOPAY) ===========



// Kirim pengumuman ke target yang sudah dihitung
async function sendBroadcastFromMenu(ctx, target, message) {
  try {
    const targets = await getBroadcastTargetsFromMenu(target);

    if (!targets || targets.size === 0) {
      await ctx.reply('â„¹ï¸ Tidak ada target yang cocok untuk pengumuman ini.');
      return;
    }

    let sukses = 0;
    let gagal = 0;

    for (const id of targets) {
      try {
        await bot.telegram.sendMessage(id, message, { parse_mode: 'HTML' });
        sukses++;
      } catch (e) {
        gagal++;
        logger.error(`âš ï¸ Gagal kirim pengumuman ke ${id}:`, e.message);
      }
    }

    // Simpan ringkasan ke memori
    const now = new Date();
    const timeLabel = now.toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Potong pesan kalau terlalu panjang (biar ringkasan enak dibaca)
    const maxPreviewLen = 300;
    let previewMessage = message;
    if (previewMessage.length > maxPreviewLen) {
      previewMessage = previewMessage.slice(0, maxPreviewLen) + '...';
    }

    lastBroadcastInfo = {
      time: timeLabel,
      target,
      totalTarget: targets.size,
      sukses,
      gagal,
      messagePreview: previewMessage,
      fullMessage: message,
    };

    // Kirim ringkasan ke admin yang menjalankan
    await ctx.reply(
      `âœ… Pengumuman selesai dikirim.\n` +
      `Waktu   : <b>${timeLabel}</b>\n` +
      `Target  : <b>${target}</b>\n` +
      `Total   : <b>${targets.size}</b> user\n` +
      `Berhasil: <b>${sukses}</b>, Gagal: <b>${gagal}</b>.`,
      { parse_mode: 'HTML' }
    );

    // Kirim ringkasan ke MASTER_ID (kalau beda dengan pengirim)
    try {
      if (MASTER_ID && ctx.from && ctx.from.id !== MASTER_ID) {
        await bot.telegram.sendMessage(
          MASTER_ID,
          `ðŸ“¢ <b>Ringkasan Pengumuman</b>\n` +
          `Dikirim oleh: <code>${ctx.from.id}</code>\n` +
          `Waktu   : <b>${timeLabel}</b>\n` +
          `Target  : <b>${target}</b>\n` +
          `Total   : <b>${targets.size}</b> user\n` +
          `Berhasil: <b>${sukses}</b>, Gagal: <b>${gagal}</b>\n\n` +
          `<b>Preview Pesan:</b>\n` +
          previewMessage,
          { parse_mode: 'HTML' }
        );
      }
    } catch (e) {
      logger.error('âš ï¸ Gagal kirim ringkasan broadcast ke MASTER_ID:', e.message);
    }
  } catch (err) {
    logger.error('âŒ Error di sendBroadcastFromMenu:', err);
    await ctx.reply('âŒ Terjadi kesalahan saat mengirim pengumuman.');
  }
}

// ==== MENU ðŸ“¢ PENGUMUMAN DI ADMIN ====
bot.action('broadcast_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return;
  }

  const adminId = ctx.from.id;
  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  broadcastSessions[adminId] = { step: 'choose_target' };

  const text =
    'ðŸ“¢ <b>Kirim Pengumuman</b>\n\n' +
    'Silakan pilih target pengumuman:\n' +
    'â€¢ ðŸ‘¥ Semua User\n' +
    'â€¢ ðŸ§‘â€ðŸ’¼ Reseller\n' +
    'â€¢ ðŸ‘¤ Member (bukan reseller & bukan admin)\n\n' +
    'Setelah pilih target, kirim teks pengumuman di chat ini.';

  const keyboard = [
    [
      { text: 'ðŸ‘¥ Semua User', callback_data: 'broadcast_target_all' },
    ],
    [
      { text: 'ðŸ§‘â€ðŸ’¼ Reseller', callback_data: 'broadcast_target_reseller' },
      { text: 'ðŸ‘¤ Member', callback_data: 'broadcast_target_member' },
    ],
    [
      { text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' },
    ],
  ];

  return ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
});

async function handleBroadcastTargetFromMenu(ctx, target) {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  let targetLabel = 'semua user';
  if (target === 'reseller') targetLabel = 'semua reseller';
  else if (target === 'member') targetLabel = 'member (bukan reseller & bukan admin)';

  // Simpan target, dan tunggu user pilih MODE (manual / template)
  broadcastSessions[adminId] = {
    step: 'choose_mode',
    target,
  };

  await ctx.reply(
    `ðŸ“¢ Pengumuman ke <b>${targetLabel}</b>\n\n` +
      'Pilih cara membuat pengumuman:\n' +
      'â€¢ âœï¸ Tulis manual (ketik bebas)\n' +
      'â€¢ ðŸ”§ Template Maintenance VPN\n' +
      'â€¢ ðŸ· Template Promo/Diskon VPN',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'âœï¸ Tulis Manual', callback_data: 'broadcast_mode_manual' },
          ],
          [
            { text: 'ðŸ”§ Maintenance VPN', callback_data: 'broadcast_mode_maintenance' },
          ],
          [
            { text: 'ðŸ· Promo / Diskon', callback_data: 'broadcast_mode_promo' },
          ],
          [
            { text: 'âŒ Batal', callback_data: 'broadcast_cancel' },
          ],
        ],
      },
    }
  );
}
// Mode: Tulis manual
bot.action('broadcast_mode_manual', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const state = broadcastSessions[adminId];
  if (!state || !state.target) {
    return ctx.reply('â„¹ï¸ Tidak ada sesi pengumuman yang aktif. Mulai dari menu ðŸ“¢ lagi.');
  }

  state.step = 'wait_message';

  await ctx.reply(
    'âœï¸ Silakan kirim teks pengumuman yang ingin dikirim.\n' +
      'â€¢ Kalau ingin batal, kirim perintah lain (misalnya /start).',
    { parse_mode: 'HTML' }
  );
});

// Mode: Template Maintenance VPN
bot.action('broadcast_mode_maintenance', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const state = broadcastSessions[adminId];
  if (!state || !state.target) {
    return ctx.reply('â„¹ï¸ Tidak ada sesi pengumuman yang aktif. Mulai dari menu ðŸ“¢ lagi.');
  }

  // Step pertama: minta nama server/layanan
  state.step = 'tm_ask_layanan';

  await ctx.reply(
    'ðŸ”§ Template Maintenance VPN\n\n' +
      '1ï¸âƒ£ Masukkan nama server atau layanan yang terkena maintenance.\n' +
      'Contoh:\n' +
      'â€¢ Semua server VPN\n' +
      'â€¢ Server SG-1 & SG-2\n' +
      'â€¢ Layanan SSH & VMESS',
    { parse_mode: 'HTML' }
  );
});

// Mode: Template Promo / Diskon VPN
bot.action('broadcast_mode_promo', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  const state = broadcastSessions[adminId];
  if (!state || !state.target) {
    return ctx.reply('â„¹ï¸ Tidak ada sesi pengumuman yang aktif. Mulai dari menu ðŸ“¢ lagi.');
  }

  // Step pertama: minta nama paket promo
  state.step = 'promo_ask_paket';

  await ctx.reply(
    'ðŸ· Template Promo / Diskon VPN\n\n' +
      '1ï¸âƒ£ Masukkan nama paket atau jenis promo.\n' +
      'Contoh:\n' +
      'â€¢ Paket 30 Hari All Server\n' +
      'â€¢ Promo Akhir Bulan 7 Hari\n' +
      'â€¢ Diskon 30% semua paket bulanan',
    { parse_mode: 'HTML' }
  );
});

bot.action('broadcast_target_all', async (ctx) => {
  return handleBroadcastTargetFromMenu(ctx, 'all');
});

bot.action('broadcast_target_reseller', async (ctx) => {
  return handleBroadcastTargetFromMenu(ctx, 'reseller');
});

bot.action('broadcast_target_member', async (ctx) => {
  return handleBroadcastTargetFromMenu(ctx, 'member');
});

bot.action('broadcast_confirm', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  const state = broadcastSessions[adminId];
  if (!state || state.step !== 'confirm' || !state.message || !state.target) {
    return ctx.reply('â„¹ï¸ Tidak ada pengumuman yang menunggu konfirmasi.');
  }

  const target = state.target;
  const message = state.message;

  delete broadcastSessions[adminId];

  await ctx.reply('â³ Mengirim pengumuman, mohon tunggu...');
  await sendBroadcastFromMenu(ctx, target, message);
});

bot.action('broadcast_cancel', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (broadcastSessions[adminId]) {
    delete broadcastSessions[adminId];
  }

  await ctx.reply('âŒ Pengumuman dibatalkan.');
});

// ============================================================================
// SECTION: PAYMENT - TRIGGER TOPUP OTOMATIS (COMMAND & BUTTON)
// - /topupqris      : user ketik command manual
// - topupqris_btn   : user klik tombol di menu utama
// ============================================================================
let processQrisTopupInvoice;

bot.command('topupqris', async (ctx) => {
  await openTopupQrisMenu(ctx);
});

// User klik tombol di menu utama
bot.action('topupqris_btn', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await openTopupQrisMenu(ctx);
});

bot.action('qris_topup_confirm_yes', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const chatId = ctx.chat.id;
  const state = userState[chatId];

  if (!state || state.step !== 'qris_topup_confirm' || !state.baseAmount) {
    await ctx.reply('âš ï¸ Sesi topup sudah tidak aktif. Silakan mulai lagi dari menu topup.', {
      parse_mode: 'HTML'
    });
    return;
  }

  const baseAmount = Number(state.baseAmount);
  const forcedUniqueSuffix = state.previewUniqueSuffix ?? null;
  delete userState[chatId];

  try {
    await ctx.deleteMessage();
  } catch (_) {
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (_) {}
  }

  await processQrisTopupInvoice(ctx, baseAmount, forcedUniqueSuffix);
});

bot.action('qris_topup_confirm_cancel', async (ctx) => {
  await ctx.answerCbQuery('Topup dibatalkan').catch(() => {});

  const chatId = ctx.chat.id;
  delete userState[chatId];

  try {
    await ctx.editMessageText('âœ… Topup dibatalkan.', {
      parse_mode: 'HTML'
    });
  } catch (_) {
    await ctx.reply('âœ… Topup dibatalkan.', {
      parse_mode: 'HTML'
    });
  }
});
// ===== END SECTION: PAYMENT - TRIGGER TOPUP OTOMATIS =======================

bot.action('qris_auto_topup', async (ctx) => {
  try {
    const userId = String(ctx.from.id);

    // pastikan object-nya ada
    global.depositState = global.depositState || {};
    global.depositState[userId] = { amount: '' };

    const msg =
      `ðŸ’° *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*\n\n` +
      `Jumlah saat ini: *Rp 0*`;

    const opts = {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown',
    };

    // kalau tombol ditekan dari pesan lama, coba edit biar tidak bikin pesan baru
    try {
      await ctx.editMessageText(msg, opts);
    } catch {
      await ctx.reply(msg, opts);
    }

    await ctx.answerCbQuery('OK').catch(() => {});
  } catch (e) {
    try { await ctx.answerCbQuery('Gagal membuka topup', { show_alert: true }); } catch {}
  }
});

bot.command('addressel', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  try {
    const requesterId = ctx.from.id;

    // Hanya admin yang bisa menjalankan perintah ini
    if (!adminIds.includes(requesterId)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }

    // Ambil ID Telegram dari argumen
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply(
        'âš ï¸ <b>Format salah.</b>\n\n' +
          'Gunakan:\n' +
          '<code>/addressel &lt;user_id&gt;</code>\n\n' +
          'Contoh:\n' +
          '<code>/addressel 5439429147</code>',
        { parse_mode: 'HTML' }
      );
    }

    const targetId = args[1].trim();

    if (!targetId) {
      return ctx.reply('âš ï¸ user_id tidak valid.', { parse_mode: 'HTML' });
    }

    // Cek di cache dulu
    if (isResellerId(targetId)) {
      return ctx.reply(
        `âš ï¸ User dengan ID <code>${targetId}</code> sudah menjadi reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    // Tambah ke cache + simpan ke file
    const added = addResellerIdToCache(targetId);
    if (!added) {
      return ctx.reply(
        `âš ï¸ Gagal menambahkan ID <code>${targetId}</code> ke daftar reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    ctx.reply(
      `âœ… User dengan ID <code>${targetId}</code> berhasil dijadikan reseller.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('âŒ Error di command /addressel:', e.message || e);
    ctx.reply('âŒ Terjadi kesalahan saat menjalankan perintah.');
  }
});


bot.command('delressel', async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  try {
    const requesterId = ctx.from.id;

    // Hanya admin yang bisa menjalankan perintah ini
    if (!adminIds.includes(requesterId)) {
      return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
    }

    // Ambil ID Telegram dari argumen
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply(
        'âš ï¸ <b>Format salah.</b>\n\n' +
          'Gunakan:\n' +
          '<code>/delressel &lt;user_id&gt;</code>\n\n' +
          'Contoh:\n' +
          '<code>/delressel 5439429147</code>',
        { parse_mode: 'HTML' }
      );
    }

    const targetId = args[1].trim();

    if (!targetId) {
      return ctx.reply('âš ï¸ user_id tidak valid.', { parse_mode: 'HTML' });
    }

    if (!isResellerId(targetId)) {
      return ctx.reply(
        `â„¹ï¸ User dengan ID <code>${targetId}</code> tidak ada di daftar reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    const removed = removeResellerIdFromCache(targetId);
    if (!removed) {
      return ctx.reply(
        `âš ï¸ Gagal menghapus ID <code>${targetId}</code> dari daftar reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    ctx.reply(
      `âœ… User dengan ID <code>${targetId}</code> berhasil dihapus dari daftar reseller.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('âŒ Error di command /delressel:', e.message || e);
    ctx.reply('âŒ Terjadi kesalahan saat menjalankan perintah.');
  }
});


// ============================================================================
// SECTION: PAYMENT - HANDLER TOPUP MANUAL (ADMIN & USER)
// - bot.on('photo')       : admin kirim QRIS statis (disimpan ke qris.jpg)
// - bot.action('upload_qris') : tombol admin untuk mulai upload QRIS
// - bot.action('topup_manual'): tombol user untuk topup manual via QRIS
// ============================================================================
bot.on('photo', async (ctx) => {
  const adminId = ctx.from.id;
  const state = userState[adminId];
  if (!state || state.step !== 'upload_qris') return;

  const fileId = ctx.message.photo.pop().file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const filePath = path.join(__dirname, 'qris.jpg');

  const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
  fs.writeFileSync(filePath, Buffer.from(response.data));

  await ctx.reply('âœ… Gambar QRIS berhasil diunggah!');
  logger.info('ðŸ–¼ï¸ QRIS image uploaded by admin');
  delete userState[adminId];
});
// === ðŸ–¼ï¸ UPLOAD GAMBAR QRIS ===
bot.action('upload_qris', async (ctx) => {
  const adminId = ctx.from.id;
  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  await ctx.reply('ðŸ“¸ Kirim gambar QRIS yang ingin digunakan:');
  userState[adminId] = { step: 'upload_qris' };
});

///////////////////////
// ====== TOPUP SALDO MANUAL (QRIS) ======
bot.action('topup_manual', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    const qrisPath = path.join(__dirname, 'qris.jpg');

    const storeName = NAMA_STORE || 'Layanan VPN';
    const adminName = ADMIN_USERNAME || 'Admin';
    const userId = ctx.from.id;

    const captionText = `
<b>ðŸ“² Top Up Saldo Manual via QRIS - ${storeName}</b>

1ï¸âƒ£ Scan QRIS di atas dengan aplikasi pembayaran kamu.
2ï¸âƒ£ Masukkan nominal sesuai saldo yang ingin kamu isi.
ðŸ’¸ Minimal top up: <b>Rp15.000</b>.
3ï¸âƒ£ Setelah pembayaran <b>BERHASIL</b>, kirim bukti ke admin ${adminName}.

<b>ðŸ“ Format pesan ke admin:</b>
<code>Saya sudah top up saldo.
ID Telegram : ${userId}
Nominal     : Rp...
Metode      : QRIS</code>

Kalau belum pernah chat admin, klik username ${adminName} atau hubungi via WhatsApp:
https://wa.me/6282397803813

<i>Admin akan mengecek pembayaran kamu dan mengisi saldo secepatnya.</i>
`.trim();

        if (fs.existsSync(qrisPath)) {
      // Hapus menu sebelumnya kalau ada
      const userIdForTopup = ctx.from.id;
      const prevId = lastMenuMsgId.get(userIdForTopup);
      if (prevId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, prevId);
        } catch (e) {
          // kalau gagal hapus (pesan sudah lama / tidak boleh dihapus) abaikan saja
        }
      }

      // Kirim foto QRIS + caption
      const sent = await ctx.replyWithPhoto(
        { source: qrisPath },
        {
          caption: captionText,
          parse_mode: 'HTML',
        }
      );

      // Simpan ID pesan foto sebagai "menu" terakhir
      if (sent && sent.message_id) {
        lastMenuMsgId.set(userIdForTopup, sent.message_id);
      }
    } else {
      const msgText =
        `âš ï¸ QRIS belum diunggah oleh admin. Silakan hubungi ${adminName}.`;

      // Hapus menu sebelumnya kalau ada
      const userIdForTopup = ctx.from.id;
      const prevId = lastMenuMsgId.get(userIdForTopup);
      if (prevId) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, prevId);
        } catch (e) {}
      }

      // Kirim pesan info & simpan ID sebagai menu terakhir
      const sent = await ctx.reply(msgText);
      if (sent && sent.message_id) {
        lastMenuMsgId.set(userIdForTopup, sent.message_id);
      }
    }
  } catch (err) {
    logger.error('âŒ Error di topup_manual:', err.message);
    try {
      await sendCleanMenu(ctx, 'âŒ Terjadi kesalahan saat menampilkan QRIS.', {
        parse_mode: 'HTML',
      });
    } catch (e) {}
  }
});
// ===== END SECTION: PAYMENT - HANDLER TOPUP MANUAL (ADMIN & USER) ==========

/////
// ====== FUNGSI BACKUP OTOMATIS KE TELEGRAM ======
async function sendAutoBackup(reason = 'backup otomatis') {
  try {
    if (!BACKUP_CHAT_ID) {
      logger.warn('BACKUP_CHAT_ID tidak diset, lewati backup otomatis.');
      return;
    }

    const candidateFiles = [
      path.join(__dirname, 'sellvpn.db'),
      path.join(__dirname, 'ressel.db'),
      path.join(__dirname, 'trial.db'),
      path.join(__dirname, '.vars.json'),
    ];

    // Hanya kirim file yang benar-benar ada
    const files = candidateFiles.filter(filePath => fs.existsSync(filePath));

    if (files.length === 0) {
      await bot.telegram.sendMessage(
        BACKUP_CHAT_ID,
        'âš ï¸ Backup otomatis gagal: tidak ada file database yang ditemukan.'
      );
      return;
    }

    const waktu = new Date().toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    await bot.telegram.sendMessage(
      BACKUP_CHAT_ID,
      `ðŸ—„ï¸ Mulai backup otomatis bot VPN.\nAlasan: <b>${reason}</b>\nWaktu: <b>${waktu}</b>`,
      { parse_mode: 'HTML' }
    );

    for (const filePath of files) {
      const filename = path.basename(filePath);

      try {
        await bot.telegram.sendDocument(
          BACKUP_CHAT_ID,
          { source: filePath, filename },
          {
            caption: `ðŸ“¦ Backup: <b>${filename}</b>\nWaktu: <b>${waktu}</b>`,
            parse_mode: 'HTML',
          }
        );
      } catch (err) {
        logger.error(`âŒ Gagal mengirim backup file ${filename}: ${err.message}`);
      }
    }

    await bot.telegram.sendMessage(
      BACKUP_CHAT_ID,
      `âœ… Backup otomatis selesai.\nTotal file: <b>${files.length}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    logger.error('âŒ Error di sendAutoBackup:', err);
  }
}

// ===== LAPORAN HARIAN KE MASTER =====
async function sendDailyReport(isManual = false) {
  try {
    if (!MASTER_ID) {
      logger.warn('MASTER_ID tidak diset, lewati laporan harian.');
      return;
    }

    const chatId = MASTER_ID;

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

    const tanggalLabel = now.toLocaleDateString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });


    // === Akun dibuat hari ini ===
    const totalCreatedToday = await new Promise((resolve) => {
      db.get(
        'SELECT COUNT(*) AS count FROM accounts WHERE created_at >= ? AND created_at < ?',
        [todayStart, tomorrowStart],
        (err, row) => {
          if (err) {
            logger.error('Gagal menghitung akun hari ini:', err.message);
            return resolve(0);
          }
          resolve(row ? row.count : 0);
        }
      );
    });

    // === Ringkasan akun aktif / expired (pakai logika sama kayak monitor_panel) ===
    const [totalAccounts, totalActiveAccounts, totalExpiredAccounts] = await Promise.all([
      new Promise((resolve) => {
        db.get('SELECT COUNT(*) AS count FROM accounts', [], (err, row) => {
          if (err) {
            logger.error('Gagal menghitung total accounts:', err.message);
            return resolve(0);
          }
          resolve(row ? row.count : 0);
        });
      }),
      new Promise((resolve) => {
        db.get(
          'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NULL OR expires_at > ?',
          [Date.now()],
          (err, row) => {
            if (err) {
              logger.error('Gagal menghitung akun aktif:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      }),
      new Promise((resolve) => {
        db.get(
          'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NOT NULL AND expires_at <= ?',
          [Date.now()],
          (err, row) => {
            if (err) {
              logger.error('Gagal menghitung akun expired:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      }),
    ]);

    // === Total user & reseller ===
    const totalUsers = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) AS count FROM users', [], (err, row) => {
        if (err) {
          logger.error('Gagal menghitung total users:', err.message);
          return resolve(0);
        }
        resolve(row ? row.count : 0);
      });
    });

    let resellerSet = new Set();
    let totalReseller = 0;
    try {
      if (fs.existsSync(resselFilePath)) {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
        totalReseller = resellerSet.size;
      }
    } catch (e) {
      logger.error('Gagal membaca ressel.db saat laporan harian:', e.message);
    }

    // === Top reseller HARI INI + total lifetime ===
    const topResellerRows = await new Promise((resolve) => {
      db.all(
        `SELECT user_id,
                COUNT(*) AS total_all,
                SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS total_today
         FROM accounts
         GROUP BY user_id
         ORDER BY total_today DESC, total_all DESC`,
        [todayStart, tomorrowStart],
        (err, rows) => {
          if (err) {
            logger.error('Gagal mengambil data top reseller (harian):', err.message);
            return resolve([]);
          }
          resolve(rows || []);
        }
      );
    });

    const topResellersToday = [];
    for (const row of topResellerRows) {
      const uidStr = String(row.user_id);
      if (!resellerSet.has(uidStr)) continue; // hanya reseller

      if (row.total_today > 0) {
        topResellersToday.push(row);
      }
      if (topResellersToday.length >= 5) break; // top 5 aja
    }

    const lines = [];
    lines.push(`<b>ðŸ“… Laporan Harian Bot VPN â€” ${tanggalLabel}</b>\n`);

    lines.push('<code>Ringkasan Pengguna</code>');
    lines.push(`â€¢ Total user    : <b>${totalUsers}</b>`);
    lines.push(`â€¢ Total reseller: <b>${totalReseller}</b>\n`);

    lines.push('<code>Ringkasan Akun</code>');
    lines.push(`â€¢ Total akun (semua) : <b>${totalAccounts}</b>`);
    lines.push(`â€¢ Akun aktif sekarang: <b>${totalActiveAccounts}</b>`);
    lines.push(`â€¢ Akun expired        : <b>${totalExpiredAccounts}</b>\n`);

    lines.push('<code>Aktivitas Hari Ini</code>');
    lines.push(`â€¢ Akun dibuat hari ini: <b>${totalCreatedToday}</b>\n`);

    lines.push('<code>Top Reseller Hari Ini</code>');
    if (topResellersToday.length === 0) {
      lines.push('Belum ada reseller yang membuat akun hari ini.');
    } else {
      let no = 1;
      for (const r of topResellersToday) {
        let username = '';
        try {
          username = await getUsernameById(r.user_id);
        } catch (e) {
          username = '';
        }

        const displayName = username
          ? (username.startsWith('@') ? username : '@' + username)
          : `ID:${r.user_id}`;

        const totalToday = r.total_today || 0;
        const totalAll = r.total_all || 0;

        lines.push(
          `${no}. ${displayName} â€” hari ini: <b>${totalToday}</b> akun | total: <b>${totalAll}</b> akun`
        );
        no++;
      }
    }

    lines.push('\n<i>Laporan ini dikirim ' + (isManual ? 'manual (/daily_report_test).' : 'otomatis setiap hari.') + '</i>');

    const text = lines.join('\n');

    await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    logger.info('Laporan harian berhasil dikirim ke MASTER_ID.');
  } catch (err) {
    logger.error('âŒ Error di sendDailyReport:', err);
  }
}
// ===============================
// PENGINGAT AKUN AKAN EXPIRED (H-n)
// ===============================
async function sendExpiryReminders() {
  try {
    if (!EXPIRY_REMINDER_ENABLED) {
      logger.info('Expiry reminder nonaktif, lewati pengecekan.');
      return;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const now = new Date();

    // Awal hari (00:00) hari ini (pakai waktu server)
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

    // Target H-n
    const targetStart =
      todayStart + EXPIRY_REMINDER_DAYS_BEFORE * dayMs;
    const targetEnd = targetStart + dayMs;

    logger.info(
      `Cek akun yang expired H-${EXPIRY_REMINDER_DAYS_BEFORE} (range=${targetStart}..${targetEnd})`
    );

    const rows = await new Promise((resolve, reject) => {
db.all(
  `
  SELECT a.user_id,
         a.username,
         a.type,
         a.server_id,
         a.expires_at,
         s.nama_server
  FROM accounts a
  LEFT JOIN Server s ON a.server_id = s.id
  WHERE a.expires_at IS NOT NULL
    AND a.expires_at >= ?
    AND a.expires_at < ?
`,
  [targetStart, targetEnd],
  (err, rows) => {
          if (err) {
            logger.error(
              'âŒ Gagal membaca akun untuk reminder expired:',
              err.message
            );
            return reject(err);
          }
          resolve(rows || []);
        }
      );
    });

    if (!rows.length) {
      logger.info(
        `Tidak ada akun yang perlu diingatkan (H-${EXPIRY_REMINDER_DAYS_BEFORE}).`
      );
      return;
    }

    // Group per user_id
    const grouped = {};
    for (const row of rows) {
      if (!row.user_id) continue;
      const uid = String(row.user_id);
      if (!grouped[uid]) grouped[uid] = [];
      grouped[uid].push(row);
    }

    const targetDateLabel = new Date(targetStart).toLocaleDateString(
      'id-ID',
      {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }
    );

    let userCount = 0;
    let successCount = 0;
    let failCount = 0;

    for (const [userIdStr, accs] of Object.entries(grouped)) {
      const userIdNum = Number(userIdStr);
      if (!userIdNum) continue;

      userCount++;

const akunLines = accs
  .map((acc, idx) => {
    const expLabel = new Date(acc.expires_at).toLocaleDateString(
      'id-ID',
      {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }
    );

    let serverLabel = '-';
    if (
      typeof acc.server_id !== 'undefined' &&
      acc.server_id !== null
    ) {
      if (acc.nama_server && String(acc.nama_server).trim() !== '') {
        serverLabel = String(acc.nama_server);   // contoh: ID neva
      } else {
        serverLabel = `Server #${acc.server_id}`;
      }
    }

    const uname = acc.username || '-';
    const jenis = acc.type || 'AKUN';

    // satu baris, hemat tempat
    return `${idx + 1}. ${uname} | ${jenis} | ${serverLabel} | exp: ${expLabel}`;
  })
  .join('\n');

const akunLinesBlock = `<code>${akunLines}</code>`;

const text =
  `ðŸ”” <b>Peringatan Akun VPN Akan Berakhir</b>\n\n` +
  `Beberapa akun VPN kamu akan expired <b>H-${EXPIRY_REMINDER_DAYS_BEFORE} (tanggal ${targetDateLabel})</b>:\n\n` +
  `${akunLinesBlock}\n\n` +
  `Kalau mau perpanjang, silakan buka menu bot:\n` +
  `â€¢ /start â†’ ðŸ“‚ Akun Saya â†’ pilih akun â†’ Perpanjang.\n\n` +
  `Kalau sudah diperpanjang, pesan ini bisa diabaikan ðŸ˜Š`;

      try {
        await bot.telegram.sendMessage(userIdNum, text, {
          parse_mode: 'HTML',
        });
        successCount++;
      } catch (err) {
        failCount++;
        logger.warn(
          `Gagal kirim reminder expired ke user ${userIdNum}:`,
          err.message || err
        );
      }
    }

    logger.info(
      `Reminder expired selesai: ${rows.length} akun, ${userCount} user, sukses=${successCount}, gagal=${failCount}`
    );

    // Kirim ringkasan ke MASTER_ID (kalau mau tau kerja bot)
    if (MASTER_ID) {
      try {
        await bot.telegram.sendMessage(
          MASTER_ID,
          `â„¹ï¸ <b>Laporan Pengingat Expired</b>\n\n` +
            `Hari ini cek H-${EXPIRY_REMINDER_DAYS_BEFORE} (tanggal ${targetDateLabel}).\n` +
            `Total akun: <b>${rows.length}</b>\n` +
            `Total user: <b>${userCount}</b>\n` +
            `Berhasil dikirimi: <b>${successCount}</b>\n` +
            `Gagal (bot diblokir / error kirim): <b>${failCount}</b>`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        logger.warn(
          'Gagal kirim ringkasan reminder expired ke MASTER_ID:',
          e.message || e
        );
      }
    }
  } catch (err) {
    logger.error('âŒ Error di sendExpiryReminders:', err);
  }
}
function startDailyReportScheduler() {
  const CHECK_INTERVAL_MS = 60 * 1000; // cek tiap 1 menit

  setInterval(async () => {
    try {
      // Kalau dimatikan dari menu admin, jangan kirim apa-apa
      if (!DAILY_REPORT_ENABLED) return;

      const { dateKey, hour, minute } = getTimeInConfiguredTimeZone();

      if (dateKey === lastDailyReportDateKey) return;

      if (hour === DAILY_REPORT_HOUR && minute === DAILY_REPORT_MINUTE) {
        logger.info('Waktu laporan harian tercapai, mengirim laporan...');
        await sendDailyReport(false);
        lastDailyReportDateKey = dateKey;
      }
    } catch (err) {
      logger.error('âŒ Error di scheduler laporan harian:', err);
    }
  }, CHECK_INTERVAL_MS);

    logger.info(
    `Scheduler laporan harian aktif: jam ${DAILY_REPORT_HOUR}:${String(
      DAILY_REPORT_MINUTE
    ).padStart(2, '0')} (zona ${TIME_ZONE}, cek tiap 1 menit)`
  );
}


function startExpiryReminderScheduler() {
  const CHECK_INTERVAL_MS = 60 * 1000; // cek tiap 1 menit

  logger.info(
    `Scheduler pengingat expired aktif: jam ${EXPIRY_REMINDER_HOUR}:${String(
      EXPIRY_REMINDER_MINUTE
    ).padStart(2, '0')} (zona ${TIME_ZONE}, cek tiap 1 menit)`
  );

  setInterval(async () => {
    try {
      // Kalau OFF dari menu admin, jangan kirim apa-apa
      if (!EXPIRY_REMINDER_ENABLED) return;

      const { dateKey, hour, minute } = getTimeInConfiguredTimeZone();

      // Biar sehari cuma sekali per tanggal
      if (dateKey === lastExpiryReminderDateKey) return;

      // Konversi ke total menit
      const nowTotalMinutes = hour * 60 + minute;
      const targetTotalMinutes =
        Number(EXPIRY_REMINDER_HOUR) * 60 +
        Number(EXPIRY_REMINDER_MINUTE);

      // Kalau jam sekarang SUDAH lewat jam target dan
      // hari ini belum pernah kirim â†’ kirim sekali
      if (nowTotalMinutes >= targetTotalMinutes) {
        logger.info(
          'Waktu reminder expired tercapai (atau sudah lewat dikit), mulai kirim pengingat...'
        );
        await sendExpiryReminders();
        lastExpiryReminderDateKey = dateKey;
      }
    } catch (err) {
      logger.error('âŒ Error di scheduler reminder expired:', err);
    }
  }, CHECK_INTERVAL_MS);
}

// === CEK TARGET RESELLER & AUTO-DOWNGRADE BULANAN ===
async function checkAndDowngradeResellersForPreviousMonth() {
  try {
    const { dateKey } = getTimeInConfiguredTimeZone();
    const [yearStr, monthStr] = dateKey.split('-');
    let year = Number(yearStr);
    let month = Number(monthStr);

    // periode yang dicek = bulan sebelumnya
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }

    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    const monthStart = new Date(year, month - 1, 1).getTime();
    const monthEnd = new Date(year, month, 1).getTime();

    const resellerSet = readResellerSetSync();
    if (!resellerSet || resellerSet.size === 0) {
      logger.info(`[ResellerTarget] Tidak ada reseller di cache, lewati periode ${monthKey}.`);
      return;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const downgraded = [];

    for (const idStr of resellerSet) {
      const userId = Number(idStr);
      if (!userId || Number.isNaN(userId)) continue;

      const accounts = await new Promise((resolve) => {
        db.all(
          `SELECT created_at, expires_at
           FROM accounts
           WHERE user_id = ?
             AND created_at >= ?
             AND created_at < ?`,
          [userId, monthStart, monthEnd],
          (err, rows) => {
            if (err) {
              logger.error(
                `[ResellerTarget] Gagal ambil data akun untuk user ${userId}:`,
                err.message || err
              );
              return resolve([]);
            }
            resolve(rows || []);
          }
        );
      });

      let totalAccounts = accounts.length;
      let totalDays = 0;
      let count30Days = 0;

      for (const acc of accounts) {
        if (!acc.expires_at || !acc.created_at) continue;

        const durMs = acc.expires_at - acc.created_at;
        let durDays = Math.round(durMs / dayMs);
        if (durDays < 1) durDays = 1;

        totalDays += durDays;
        if (durDays >= 30) count30Days++;
      }

      const meets30 = count30Days >= RESELLER_TARGET_MIN_30D_ACCOUNTS;
      const meetsDays = totalDays >= RESELLER_TARGET_MIN_DAYS_PER_MONTH;

      // kalau TIDAK memenuhi salah satu pun â†’ downgrade
      if (!meets30 && !meetsDays) {
        const removed = removeResellerIdFromCache(userId);
        if (removed) {
          downgraded.push({ userId, totalAccounts, totalDays, count30Days });
        }
      }
    }

    // Kirim notifikasi ke reseller yang didowngrade
    for (const info of downgraded) {
      const { userId, totalAccounts, totalDays, count30Days } = info;
      try {
        await bot.telegram.sendMessage(
          userId,
          `âš ï¸ <b>Status Reseller Dibatalkan</b>\n\n` +
          `Bulan sebelumnya kamu tidak mencapai target penjualan.\n\n` +
          `<b>Ringkasan bulan ${monthKey}</b>\n` +
          `â€¢ Akun terjual        : <b>${totalAccounts}</b>\n` +
          `â€¢ Akun â‰¥ 30 hari      : <b>${count30Days}</b>\n` +
          `â€¢ Total hari akumulasi: <b>${totalDays}</b> hari\n\n` +
          `Status kamu sekarang berubah menjadi <b>member biasa</b>.\n` +
          `Silakan hubungi admin bila ingin mengajukan jadi reseller lagi.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        logger.error(
          `[ResellerTarget] Gagal kirim pesan downgrade ke user ${userId}:`,
          e.message || e
        );
      }
    }

    // Laporan ke MASTER
    if (MASTER_ID && downgraded.length > 0) {
      const lines = downgraded.map((d, idx) =>
        `${idx + 1}. ID <code>${d.userId}</code> â€” akun: <b>${d.totalAccounts}</b>, 30d: <b>${d.count30Days}</b>, total hari: <b>${d.totalDays}</b>`
      );

      const msg =
        `<b>ðŸ“‰ Laporan Auto-Downgrade Reseller</b>\n` +
        `Periode: <b>${monthKey}</b>\n` +
        `Total reseller didowngrade: <b>${downgraded.length}</b>\n\n` +
        lines.join('\n');

      try {
        await bot.telegram.sendMessage(MASTER_ID, msg, { parse_mode: 'HTML' });
      } catch (e) {
        logger.error(
          '[ResellerTarget] Gagal kirim laporan downgrade ke MASTER_ID:',
          e.message || e
        );
      }
    }

    logger.info(
      `[ResellerTarget] Cek target reseller periode ${monthKey} selesai. Didowngrade: ${downgraded.length}`
    );
  } catch (err) {
    logger.error(
      '[ResellerTarget] Error di checkAndDowngradeResellersForPreviousMonth:',
      err
    );
  }
}

function startResellerTargetScheduler() {
  const CHECK_INTERVAL_MS = 60 * 1000; // cek tiap 1 menit

  logger.info(
    `Scheduler target reseller aktif: jam ${RESELLER_TARGET_CHECK_HOUR}:${String(
      RESELLER_TARGET_CHECK_MINUTE
    ).padStart(2, '0')} (zona ${TIME_ZONE}, cek tiap 1 menit)`
  );

  setInterval(async () => {
    try {
      if (!RESELLER_TARGET_ENABLED) return;

      const { dateKey, hour, minute } = getTimeInConfiguredTimeZone();
      if (
        hour !== RESELLER_TARGET_CHECK_HOUR ||
        minute !== RESELLER_TARGET_CHECK_MINUTE
      ) {
        return;
      }

      const [yearStr, monthStr, dayStr] = dateKey.split('-');
      const day = Number(dayStr);

      // hanya jalan di hari pertama tiap bulan
      if (day !== 1) return;

      let year = Number(yearStr);
      let month = Number(monthStr) - 1; // periode yang dicek = bulan sebelumnya
      if (month === 0) {
        month = 12;
        year -= 1;
      }

      const monthKey = `${year}-${String(month).padStart(2, '0')}`;

      if (lastResellerTargetMonthKey === monthKey) {
        // sudah pernah diproses untuk bulan ini
        return;
      }

      lastResellerTargetMonthKey = monthKey;

      await checkAndDowngradeResellersForPreviousMonth();
    } catch (err) {
      logger.error('[ResellerTarget] Error di scheduler target reseller:', err);
    }
  }, CHECK_INTERVAL_MS);
}


// === ðŸ—‚ï¸ BACKUP DATABASE DAN KIRIM KE ADMIN ===
bot.action('backup_db', async (ctx) => {
  try {
    const adminId = ctx.from.id;

    // Hanya admin yang bisa pakai
    if (!adminIds.includes(adminId)) {
      return ctx.reply('ðŸš« Kamu tidak memiliki izin untuk melakukan tindakan ini.');
    }

    const dbPath = path.join(__dirname, 'sellvpn.db');
    if (!fs.existsSync(dbPath)) {
      return ctx.reply('âš ï¸ File database tidak ditemukan.');
    }

    // Kirim file sellvpn.db ke admin
    await ctx.replyWithDocument({ source: dbPath, filename: 'sellvpn.db' }, {
      caption: 'ðŸ“¦ Backup database berhasil dikirim!',
    });

    logger.info(`ðŸ“¤ Backup database dikirim ke admin ${adminId}`);
  } catch (error) {
    logger.error('âŒ Gagal mengirim file backup ke admin:', error);
    ctx.reply('âŒ Terjadi kesalahan saat mengirim file backup.');
  }

});

// Buka menu pengingat expired
bot.action('expiry_reminder_menu', async (ctx) => {
  const adminId = ctx.from.id;

  // Hanya admin/master
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    await ctx.editMessageText(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  } catch (e) {
    logger.error('âŒ Gagal kirim menu pengingat expired:', e.message);
    await ctx.reply(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  }
});

// ====== ADMIN: TIMEZONE BOT ======

function getTimezoneStatusText() {
  const nowSample = new Date().toLocaleString('id-ID', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    'ðŸŒ <b>PENGATURAN TIMEZONE BOT</b>\n\n' +
    `Timezone saat ini: <b>${TIME_ZONE}</b>\n` +
    `Waktu sekarang (versi bot): <b>${nowSample}</b>\n\n` +
    'Timezone ini dipakai untuk:\n' +
    'â€¢ Laporan harian\n' +
    'â€¢ Pengingat expired akun\n' +
    'â€¢ Tampilan info lisensi /health\n\n' +
    'Silakan pilih timezone yang sesuai dengan lokasi kamu.'
  );
}

function buildTimezoneKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'WIB (Jakarta)',  callback_data: 'timezone_set_wib' },
        { text: 'WITA (Makassar)', callback_data: 'timezone_set_wita' },
      ],
      [
        { text: 'WIT (Jayapura)', callback_data: 'timezone_set_wit' },
      ],
      [
        { text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

// Buka menu timezone
bot.action('timezone_menu', async (ctx) => {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    await ctx.reply(getTimezoneStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildTimezoneKeyboard(),
    });
  } catch (e) {
    logger.error('âŒ Gagal kirim menu timezone:', e.message || e);
  }
});

async function setTimezoneAndRefresh(ctx, tzValue, label) {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  TIME_ZONE = tzValue;
  saveTimeZoneConfig();

  await ctx.answerCbQuery(`Timezone diatur ke ${label}.`, {
    show_alert: false,
  });

  try {
    await ctx.editMessageText(getTimezoneStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildTimezoneKeyboard(),
    });
  } catch {
    await ctx.reply(getTimezoneStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildTimezoneKeyboard(),
    });
  }
}

bot.action('timezone_set_wib', (ctx) =>
  setTimezoneAndRefresh(ctx, 'Asia/Jakarta', 'WIB (Asia/Jakarta)')
);
bot.action('timezone_set_wita', (ctx) =>
  setTimezoneAndRefresh(ctx, 'Asia/Makassar', 'WITA (Asia/Makassar)')
);
bot.action('timezone_set_wit', (ctx) =>
  setTimezoneAndRefresh(ctx, 'Asia/Jayapura', 'WIT (Asia/Jayapura)')
);


// ON/OFF
bot.action('expiry_reminder_toggle', async (ctx) => {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  EXPIRY_REMINDER_ENABLED = !EXPIRY_REMINDER_ENABLED;
  saveExpiryReminderConfig();

  await ctx.answerCbQuery(
    EXPIRY_REMINDER_ENABLED
      ? 'Pengingat expired diaktifkan.'
      : 'Pengingat expired dimatikan.',
    { show_alert: false }
  );

  try {
    await ctx.editMessageText(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  } catch {
    await ctx.reply(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  }
});

// Ubah jam/menit dan refresh tampilan
async function adjustReminderTimeAndRefresh(ctx, deltaHour, deltaMinute) {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  if (deltaHour) {
    EXPIRY_REMINDER_HOUR =
      (EXPIRY_REMINDER_HOUR + deltaHour + 24) % 24;
  }

  if (deltaMinute) {
    let total = EXPIRY_REMINDER_MINUTE + deltaMinute;
    while (total < 0) total += 60;
    while (total >= 60) total -= 60;
    EXPIRY_REMINDER_MINUTE = total;
  }

  saveExpiryReminderConfig();

  await ctx.answerCbQuery('Waktu pengingat diubah.', {
    show_alert: false,
  });

  try {
    await ctx.editMessageText(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  } catch {
    await ctx.reply(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  }
}

bot.action('expiry_hour_minus', (ctx) =>
  adjustReminderTimeAndRefresh(ctx, -1, 0)
);
bot.action('expiry_hour_plus', (ctx) =>
  adjustReminderTimeAndRefresh(ctx, +1, 0)
);

bot.action('expiry_minute_minus', (ctx) =>
  adjustReminderTimeAndRefresh(ctx, 0, -5)
);
bot.action('expiry_minute_plus', (ctx) =>
  adjustReminderTimeAndRefresh(ctx, 0, +5)
);

// Preset H-1 / H-2 / H-3
async function setReminderDaysPreset(ctx, value) {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  EXPIRY_REMINDER_DAYS_BEFORE = value;
  saveExpiryReminderConfig();

  await ctx.answerCbQuery(`Diatur ke H-${value}.`, {
    show_alert: false,
  });

  try {
    await ctx.editMessageText(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  } catch {
    await ctx.reply(getExpiryReminderStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildExpiryReminderKeyboard(),
    });
  }
}

bot.action('expiry_days_1', (ctx) => setReminderDaysPreset(ctx, 1));
bot.action('expiry_days_2', (ctx) => setReminderDaysPreset(ctx, 2));
bot.action('expiry_days_3', (ctx) => setReminderDaysPreset(ctx, 3));

function getExpiryReminderStatusText() {
  const statusText = EXPIRY_REMINDER_ENABLED ? 'ðŸŸ¢ ON' : 'ðŸ”´ OFF';
  const hourStr = String(EXPIRY_REMINDER_HOUR).padStart(2, '0');
  const minuteStr = String(EXPIRY_REMINDER_MINUTE).padStart(2, '0');

  return (
    '<b>â° Pengaturan Pengingat Expired Akun</b>\n\n' +
    `Status       : <b>${statusText}</b>\n` +
    `Waktu kirim  : <b>${hourStr}:${minuteStr}</b> (waktu server)\n` +
    `Hari sebelum : <b>H-${EXPIRY_REMINDER_DAYS_BEFORE}</b>\n\n` +
    'Bot akan mengirim pesan ke user yang punya akun akan expired pada hari tersebut.'
  );
}

function buildExpiryReminderKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: EXPIRY_REMINDER_ENABLED
            ? 'ðŸ”Œ Matikan Pengingat'
            : 'âš¡ Nyalakan Pengingat',
          callback_data: 'expiry_reminder_toggle',
        },
      ],
      [
        { text: 'â¬ Jam -1', callback_data: 'expiry_hour_minus' },
        { text: 'â« Jam +1', callback_data: 'expiry_hour_plus' },
      ],
      [
        { text: 'â¬ Menit -5', callback_data: 'expiry_minute_minus' },
        { text: 'â« Menit +5', callback_data: 'expiry_minute_plus' },
      ],
      [
        { text: 'H-1', callback_data: 'expiry_days_1' },
        { text: 'H-2', callback_data: 'expiry_days_2' },
        { text: 'H-3', callback_data: 'expiry_days_3' },
      ],
      [
        { text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

function getAutoBackupStatusText() {
  const statusText = AUTO_BACKUP_ENABLED ? 'ðŸŸ¢ ON' : 'ðŸ”´ OFF';
  return (
    '<b>ðŸ—„ï¸ Pengaturan Auto Backup Database</b>\n\n' +
    `Status   : <b>${statusText}</b>\n` +
    `Interval : <b>${AUTO_BACKUP_INTERVAL_HOURS}</b> jam\n` +
    `Tujuan   : <code>${BACKUP_CHAT_ID}</code>\n\n` +
    'Gunakan tombol di bawah untuk mengaktifkan/nonaktifkan dan mengubah interval backup.'
  );
}

function buildAutoBackupKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: AUTO_BACKUP_ENABLED ? 'ðŸ”Œ Matikan Auto Backup' : 'âš¡ Nyalakan Auto Backup',
          callback_data: 'backup_auto_toggle',
        },
      ],
      [
        { text: 'â¬ -1 jam', callback_data: 'backup_auto_interval_minus' },
        { text: 'â« +1 jam', callback_data: 'backup_auto_interval_plus' },
      ],
      [
        { text: '6 jam',  callback_data: 'backup_auto_set_6' },
        { text: '12 jam', callback_data: 'backup_auto_set_12' },
        { text: '24 jam', callback_data: 'backup_auto_set_24' },
      ],
      [
        { text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' },
      ],
    ],
  };
}

// Buka menu pengaturan auto-backup
bot.action('backup_auto_menu', async (ctx) => {
  const adminId = ctx.from.id;
  if (adminId !== MASTER_ID) {
  return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
}

  await ctx.answerCbQuery().catch(() => {});
  try {
    await ctx.reply(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  } catch (e) {
    logger.error('âŒ Gagal kirim menu auto backup:', e.message);
  }
});

// Toggle ON/OFF
bot.action('backup_auto_toggle', async (ctx) => {
  const adminId = ctx.from.id;
  if (adminId !== MASTER_ID) {
  return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
}

  AUTO_BACKUP_ENABLED = !AUTO_BACKUP_ENABLED;
  saveAutoBackupConfig();
  restartAutoBackupScheduler();

  await ctx.answerCbQuery(
    AUTO_BACKUP_ENABLED ? 'Auto-backup diaktifkan.' : 'Auto-backup dimatikan.',
    { show_alert: false }
  );

  try {
    await ctx.editMessageText(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  } catch {
    await ctx.reply(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  }
});

// Ubah interval Â±1 jam
async function adjustIntervalAndRefresh(ctx, delta) {
  const adminId = ctx.from.id;
  if (adminId !== MASTER_ID) {
  return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
}

  AUTO_BACKUP_INTERVAL_HOURS = Math.max(1, AUTO_BACKUP_INTERVAL_HOURS + delta); // minimal 1 jam
  saveAutoBackupConfig();
  restartAutoBackupScheduler();

  await ctx.answerCbQuery(`Interval diatur: ${AUTO_BACKUP_INTERVAL_HOURS} jam.`, {
    show_alert: false,
  });

  try {
    await ctx.editMessageText(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  } catch {
    await ctx.reply(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  }
}

bot.action('backup_auto_interval_minus', (ctx) => adjustIntervalAndRefresh(ctx, -1));
bot.action('backup_auto_interval_plus', (ctx) => adjustIntervalAndRefresh(ctx, +1));

// Preset interval 6 / 12 / 24 jam
async function setIntervalPreset(ctx, value) {
  const adminId = ctx.from.id;
  if (adminId !== MASTER_ID) {
  return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
}

  AUTO_BACKUP_INTERVAL_HOURS = value;
  saveAutoBackupConfig();
  restartAutoBackupScheduler();

  await ctx.answerCbQuery(`Interval diatur: ${value} jam.`, { show_alert: false });

  try {
    await ctx.editMessageText(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  } catch {
    await ctx.reply(getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  }
}

bot.action('backup_auto_set_6',  (ctx) => setIntervalPreset(ctx, 6));
bot.action('backup_auto_set_12', (ctx) => setIntervalPreset(ctx, 12));
bot.action('backup_auto_set_24', (ctx) => setIntervalPreset(ctx, 24));

// === ðŸ’³ CEK SALDO USER ===
bot.action('cek_saldo_user', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('ðŸš« Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery();
  await ctx.reply('ðŸ” Masukkan ID Telegram user yang ingin dicek saldonya:');
  userState[adminId] = { step: 'cek_saldo_userid' };
});

// === ðŸ“œ RIWAYAT SALDO USER ===
bot.action('riwayat_saldo_user', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('ðŸš« Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('ðŸ“œ Masukkan ID Telegram user/reseller yang ingin dilihat riwayat saldonya:');

  userState[adminId] = { step: 'riwayat_saldo_userid' };
});

// === ðŸš© TANDAI / ATUR STATUS USER (NORMAL / WATCHLIST / NAKAL) ===
bot.action('flag_user_start', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('ðŸš« Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    'ðŸš© *Mode tandai user*\n\n' +
      'Silakan kirim *ID Telegram user* yang ingin diatur statusnya.\n' +
      'Ketik *batal* untuk keluar dari mode ini.',
    { parse_mode: 'Markdown' }
  );

  // Simpan state: admin ini sekarang lagi mode input ID untuk flag user
  userState[adminId] = { step: 'flag_user_wait_id' };
});

// === Handler tombol pilih status: NORMAL / WATCHLIST / NAKAL ===
bot.action(/flag_user_set_(NORMAL|WATCHLIST|NAKAL)_(\d+)/, async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('ðŸš« Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  const newStatus = ctx.match[1]; // NORMAL / WATCHLIST / NAKAL
  const targetId = ctx.match[2];

  db.run(
    'UPDATE users SET flag_status = ? WHERE user_id = ?',
    [newStatus, targetId],
    function (err) {
      if (err) {
        logger.error('âŒ Gagal mengupdate flag_status user:', err.message);
        return ctx.reply('âŒ Terjadi kesalahan saat mengupdate status user.');
      }

      if (this.changes === 0) {
        return ctx.reply(
          `âš ï¸ User dengan ID ${targetId} tidak ditemukan di tabel users.`
        );
      }

      let label = 'âœ… NORMAL';
      if (newStatus === 'WATCHLIST') label = 'âš ï¸ WATCHLIST';
      else if (newStatus === 'NAKAL') label = 'ðŸš« NAKAL';

      ctx.reply(
        `âœ… Status user \`${targetId}\` berhasil diubah menjadi: ${label}`,
        { parse_mode: 'Markdown' }
      );
    }
  );

  // Bersihkan state khusus flag kalau ada
  if (
    userState[adminId] &&
    userState[adminId].step &&
    userState[adminId].step.toString().startsWith('flag_user')
  ) {
    delete userState[adminId];
  }
});

// === ðŸ“Š MONITOR USER & RESELLER ===
bot.action('monitor_panel', async (ctx) => {
  const adminId = ctx.from.id;

  // Hanya admin yang boleh akses menu ini
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.reply('ðŸš« Anda tidak memiliki izin untuk menggunakan menu ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    const nowTs = Date.now();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // ======= RINGKASAN PENGGUNA =======
    const totalUsers = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) AS count FROM users', [], (err, row) => {
        if (err) {
          logger.error('Gagal menghitung total users:', err.message);
          return resolve(0);
        }
        resolve(row ? row.count : 0);
      });
    });

    // ======= RINGKASAN AKUN =======
    const [totalAccounts, totalActiveAccounts, totalExpiredAccounts] = await Promise.all([
      new Promise((resolve) => {
        db.get('SELECT COUNT(*) AS count FROM accounts', [], (err, row) => {
          if (err) {
            logger.error('Gagal menghitung total accounts:', err.message);
            return resolve(0);
          }
          resolve(row ? row.count : 0);
        });
      }),
      new Promise((resolve) => {
        db.get(
          'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NULL OR expires_at > ?',
          [nowTs],
          (err, row) => {
            if (err) {
              logger.error('Gagal menghitung akun aktif:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      }),
      new Promise((resolve) => {
        db.get(
          'SELECT COUNT(*) AS count FROM accounts WHERE expires_at IS NOT NULL AND expires_at <= ?',
          [nowTs],
          (err, row) => {
            if (err) {
              logger.error('Gagal menghitung akun expired:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      }),
    ]);

    // ======= BACA DAFTAR RESELLER DARI ressel.db =======
    let resellerSet = new Set();
    let totalReseller = 0;
    try {
      if (fs.existsSync(resselFilePath)) {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
        totalReseller = resellerSet.size;
      }
    } catch (e) {
      logger.error('Gagal membaca ressel.db saat monitor_panel:', e.message);
    }

    // ======= TOP 5 RESELLER (BULAN INI + TOTAL) =======
    const topResellerRows = await new Promise((resolve) => {
      db.all(
        `SELECT user_id,
                COUNT(*) AS total_all,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS total_month
         FROM accounts
         GROUP BY user_id
         ORDER BY total_month DESC, total_all DESC`,
        [monthStart],
        (err, rows) => {
          if (err) {
            logger.error('Gagal mengambil data top reseller (bulan):', err.message);
            return resolve([]);
          }
          resolve(rows || []);
        }
      );
    });

    const topResellers = [];
    for (const row of topResellerRows) {
      const uidStr = String(row.user_id);
      if (!resellerSet.has(uidStr)) continue; // hanya reseller

      // fokus ke yang punya aktivitas bulan ini
      if (row.total_month > 0) {
        topResellers.push(row);
      }
      if (topResellers.length >= 5) break;
    }

    // ======= SUSUN TEKS =======
    const lines = [];
    lines.push('<b>ðŸ“Š Monitor User & Reseller</b>\n');

    // Ringkasan pengguna
    lines.push('<code>Ringkasan Pengguna</code>');
    lines.push(`â€¢ Total user terdaftar : <b>${totalUsers}</b>`);
    lines.push(`â€¢ Total reseller       : <b>${totalReseller}</b>\n`);

    // Ringkasan akun
    lines.push('<code>Ringkasan Akun</code>');
    lines.push(`â€¢ Total akun dibuat    : <b>${totalAccounts}</b>`);
    lines.push(`â€¢ Akun aktif sekarang  : <b>${totalActiveAccounts}</b>`);
    lines.push(`â€¢ Akun sudah expired   : <b>${totalExpiredAccounts}</b>\n`);

    // Top reseller
    lines.push('<code>Top 5 Reseller (berdasarkan akun bulan ini)</code>');
    if (topResellers.length === 0) {
      lines.push('Belum ada reseller yang membuat akun di bulan ini.');
    } else {
      let no = 1;
      for (const r of topResellers) {
        let username = '';
        try {
          username = await getUsernameById(r.user_id);
        } catch (e) {
          username = '';
        }

        const displayName = username
          ? (username.startsWith('@') ? username : '@' + username)
          : `ID:${r.user_id}`;

        const totalMonth = r.total_month || 0;
        const totalAll = r.total_all || 0;

        lines.push(
          `${no}. ${displayName} â€” bulan ini: <b>${totalMonth}</b> akun | total: <b>${totalAll}</b> akun`
        );
        no++;
      }
    }

    const text = lines.join('\n');

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' }],
        ],
      },
    });
  } catch (err) {
    logger.error('âŒ Error di monitor_panel:', err);
    await ctx.reply('âŒ Terjadi kesalahan saat menampilkan monitor user & reseller.');
  }
});

// === ðŸ‘¥ MENU LIST RESELLER & MEMBER ===
bot.action('list_res_mem', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('ðŸš« Anda tidak memiliki izin untuk menggunakan menu ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  await ctx.reply('Pilih daftar yang ingin ditampilkan:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'ðŸ“‹ List Reseller', callback_data: 'list_reseller' },
          { text: 'ðŸ“‹ List Member',  callback_data: 'list_member'  }
        ],
        [
          { text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' }
        ]
      ]
    }
  });
});

// Tombol balik ke menu admin
bot.action('admin_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  await sendAdminMenu(ctx);
});
// === SUBMENU: RESELLER & SALDO ===
bot.action('admin_reseller_menu', async (ctx) => {
  const adminId = ctx.from.id;

  // Pastikan cuma admin yang bisa buka
  if (!adminIds.includes(adminId)) {
    return ctx
      .answerCbQuery('ðŸš« Khusus admin.', { show_alert: true })
      .catch(() => {});
  }

  await ctx.answerCbQuery().catch(() => {});

  const text =
    '<b>ðŸ§¾ MENU RESELLER & SALDO</b>\n\n' +
    'Semua pengaturan yang berhubungan dengan reseller & saldo:\n\n' +
    'â€¢ Tambah server reseller\n' +
    'â€¢ Tambah saldo user / reseller\n' +
    'â€¢ Lihat riwayat saldo\n' +
    'â€¢ Lihat daftar reseller & member\n' +
    'â€¢ Upload QRIS untuk topup manual\n';

  const keyboard = [
    [
      { text: 'ðŸ¤ Tambah Server Reseller', callback_data: 'addserver_reseller' }
    ],
    [
      { text: 'ðŸ’µ Tambah Saldo User',      callback_data: 'tambah_saldo' },
      { text: 'ðŸ“œ Riwayat Saldo User',    callback_data: 'riwayat_saldo_user' }
    ],
    [
      { text: 'ðŸ‘¥ List Res & Member',      callback_data: 'list_res_mem' }
    ],
	[
      { text: 'ðŸŽ¯ Target Reseller',        callback_data: 'admin_reseller_target' }
    ],
    [
      { text: 'ðŸŽ Bonus Reseller Aktif',   callback_data: 'admin_reseller_bonus_menu' }
    ],
    [
      { text: 'ðŸ–¼ï¸ Upload Gambar QRIS',     callback_data: 'upload_qris' }
    ],
    [
      { text: 'ðŸ”™ Kembali ke Menu Admin',  callback_data: 'admin_menu' }
    ]
  ];

  try {
    // Coba edit pesan inline yang sebelumnya (lebih rapi)
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    logger.error('Error saat buka submenu reseller:', err.message || err);
    // Fallback: kalau nggak bisa edit (misal pesan lama), kirim pesan baru
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
});

// Buka menu "ðŸŽ¯ Target Reseller"
bot.action('admin_reseller_target', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    await renderResellerTargetMenu(ctx, { edit: false });
  } catch (err) {
    logger.error('Gagal membuka menu target reseller:', err.message || err);
    ctx.reply('âŒ Terjadi kesalahan saat membuka menu target reseller.');
  }
});

// ON/OFF target reseller
bot.action('admin_res_target_toggle', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_ENABLED = !RESELLER_TARGET_ENABLED;

    updateResellerTargetVars({
      RESELLER_TARGET_ENABLED: RESELLER_TARGET_ENABLED
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal toggle RESELLER_TARGET_ENABLED:', err.message || err);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah status target reseller.');
  }
});

// Naikkan minimal akun 30 hari
bot.action('admin_res_target_min30_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_MIN_30D_ACCOUNTS =
      Number(RESELLER_TARGET_MIN_30D_ACCOUNTS || 0) + 1;
    if (RESELLER_TARGET_MIN_30D_ACCOUNTS < 1)
      RESELLER_TARGET_MIN_30D_ACCOUNTS = 1;

    updateResellerTargetVars({
      RESELLER_TARGET_MIN_30D_ACCOUNTS
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal menaikkan target akun 30 hari:', err.message || err);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah target akun 30 hari.');
  }
});

// Turunkan minimal akun 30 hari (minimal 1)
bot.action('admin_res_target_min30_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_MIN_30D_ACCOUNTS =
      Number(RESELLER_TARGET_MIN_30D_ACCOUNTS || 1) - 1;
    if (RESELLER_TARGET_MIN_30D_ACCOUNTS < 1)
      RESELLER_TARGET_MIN_30D_ACCOUNTS = 1;

    updateResellerTargetVars({
      RESELLER_TARGET_MIN_30D_ACCOUNTS
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal menurunkan target akun 30 hari:', err.message || err);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah target akun 30 hari.');
  }
});

// Naikkan minimal total hari (step 30 hari)
bot.action('admin_res_target_days_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_MIN_DAYS_PER_MONTH =
      Number(RESELLER_TARGET_MIN_DAYS_PER_MONTH || 0) + 30;

    updateResellerTargetVars({
      RESELLER_TARGET_MIN_DAYS_PER_MONTH
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal menaikkan target hari reseller:', err.message || err);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah target total hari.');
  }
});

// Turunkan minimal total hari (minimal 30)
bot.action('admin_res_target_days_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    RESELLER_TARGET_MIN_DAYS_PER_MONTH =
      Number(RESELLER_TARGET_MIN_DAYS_PER_MONTH || 30) - 30;
    if (RESELLER_TARGET_MIN_DAYS_PER_MONTH < 30)
      RESELLER_TARGET_MIN_DAYS_PER_MONTH = 30;

    updateResellerTargetVars({
      RESELLER_TARGET_MIN_DAYS_PER_MONTH
    });

    await renderResellerTargetMenu(ctx, { edit: true });
  } catch (err) {
    logger.error('Gagal menurunkan target hari reseller:', err.message || err);
    ctx.reply('âŒ Terjadi kesalahan saat mengubah target total hari.');
  }
});

// Tombol tengah (NOP) biar nggak error kalau kepencet
bot.action('admin_res_target_min30_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_res_target_days_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});



// Buka menu bonus reseller aktif
bot.action('admin_reseller_bonus_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', {
        parse_mode: 'Markdown'
      });
    }

    await renderResellerBonusMenu(ctx, { edit: false });
  } catch (err) {
    logger.error('Gagal membuka menu bonus reseller:', err.message || err);
    ctx.reply('âŒ Terjadi kesalahan saat membuka menu bonus reseller.');
  }
});

bot.action('admin_res_bonus_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_res_bonus_toggle', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ADMIN_IDS.includes(ctx.from.id)) return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  RESELLER_ACTIVE_BONUS_ENABLED = !RESELLER_ACTIVE_BONUS_ENABLED;
  updateResellerBonusVars({ RESELLER_ACTIVE_BONUS_ENABLED });
  await renderResellerBonusMenu(ctx, { edit: true });
});

function clampResellerBonusConfig() {
  if (RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS < 1) RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS = 1;
  if (RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET < 0) RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET = 0;
  if (RESELLER_ACTIVE_BONUS_TIER1_DAYS < 1) RESELLER_ACTIVE_BONUS_TIER1_DAYS = 1;
  if (RESELLER_ACTIVE_BONUS_TIER2_DAYS <= RESELLER_ACTIVE_BONUS_TIER1_DAYS) RESELLER_ACTIVE_BONUS_TIER2_DAYS = RESELLER_ACTIVE_BONUS_TIER1_DAYS + 1;
  if (RESELLER_ACTIVE_BONUS_TIER3_DAYS <= RESELLER_ACTIVE_BONUS_TIER2_DAYS) RESELLER_ACTIVE_BONUS_TIER3_DAYS = RESELLER_ACTIVE_BONUS_TIER2_DAYS + 1;
  if (RESELLER_ACTIVE_BONUS_TIER1_AMOUNT < 1000) RESELLER_ACTIVE_BONUS_TIER1_AMOUNT = 1000;
  if (RESELLER_ACTIVE_BONUS_TIER2_AMOUNT < RESELLER_ACTIVE_BONUS_TIER1_AMOUNT) RESELLER_ACTIVE_BONUS_TIER2_AMOUNT = RESELLER_ACTIVE_BONUS_TIER1_AMOUNT;
  if (RESELLER_ACTIVE_BONUS_TIER3_AMOUNT < RESELLER_ACTIVE_BONUS_TIER2_AMOUNT) RESELLER_ACTIVE_BONUS_TIER3_AMOUNT = RESELLER_ACTIVE_BONUS_TIER2_AMOUNT;
}

async function updateAndRenderResellerBonusMenu(ctx) {
  clampResellerBonusConfig();
  updateResellerBonusVars({
    RESELLER_ACTIVE_BONUS_ENABLED,
    RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS,
    RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET,
    RESELLER_ACTIVE_BONUS_TIER1_DAYS,
    RESELLER_ACTIVE_BONUS_TIER1_AMOUNT,
    RESELLER_ACTIVE_BONUS_TIER2_DAYS,
    RESELLER_ACTIVE_BONUS_TIER2_AMOUNT,
    RESELLER_ACTIVE_BONUS_TIER3_DAYS,
    RESELLER_ACTIVE_BONUS_TIER3_AMOUNT,
  });
  await renderResellerBonusMenu(ctx, { edit: true });
}

bot.action('admin_res_bonus_mindur_inc', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS += 1;
  await updateAndRenderResellerBonusMenu(ctx);
});
bot.action('admin_res_bonus_mindur_dec', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS -= 1;
  await updateAndRenderResellerBonusMenu(ctx);
});
bot.action('admin_res_bonus_omzet_inc', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET += 5000;
  await updateAndRenderResellerBonusMenu(ctx);
});
bot.action('admin_res_bonus_omzet_dec', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET -= 5000;
  await updateAndRenderResellerBonusMenu(ctx);
});

function adjustResellerBonusVar(varName, delta) {
  switch (varName) {
    case 'RESELLER_ACTIVE_BONUS_TIER1_DAYS':
      RESELLER_ACTIVE_BONUS_TIER1_DAYS += delta;
      return;
    case 'RESELLER_ACTIVE_BONUS_TIER2_DAYS':
      RESELLER_ACTIVE_BONUS_TIER2_DAYS += delta;
      return;
    case 'RESELLER_ACTIVE_BONUS_TIER3_DAYS':
      RESELLER_ACTIVE_BONUS_TIER3_DAYS += delta;
      return;
    case 'RESELLER_ACTIVE_BONUS_TIER1_AMOUNT':
      RESELLER_ACTIVE_BONUS_TIER1_AMOUNT += delta;
      return;
    case 'RESELLER_ACTIVE_BONUS_TIER2_AMOUNT':
      RESELLER_ACTIVE_BONUS_TIER2_AMOUNT += delta;
      return;
    case 'RESELLER_ACTIVE_BONUS_TIER3_AMOUNT':
      RESELLER_ACTIVE_BONUS_TIER3_AMOUNT += delta;
      return;
    default:
      logger.warn(`Variabel bonus reseller tidak dikenal: ${varName}`);
  }
}

for (const [tier, dayVar, amountVar] of [
  ['t1', 'RESELLER_ACTIVE_BONUS_TIER1_DAYS', 'RESELLER_ACTIVE_BONUS_TIER1_AMOUNT'],
  ['t2', 'RESELLER_ACTIVE_BONUS_TIER2_DAYS', 'RESELLER_ACTIVE_BONUS_TIER2_AMOUNT'],
  ['t3', 'RESELLER_ACTIVE_BONUS_TIER3_DAYS', 'RESELLER_ACTIVE_BONUS_TIER3_AMOUNT'],
]) {
  bot.action(`admin_res_bonus_${tier}_days_inc`, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    adjustResellerBonusVar(dayVar, 1);
    await updateAndRenderResellerBonusMenu(ctx);
  });
  bot.action(`admin_res_bonus_${tier}_days_dec`, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    adjustResellerBonusVar(dayVar, -1);
    await updateAndRenderResellerBonusMenu(ctx);
  });
  bot.action(`admin_res_bonus_${tier}_amt_inc`, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    adjustResellerBonusVar(amountVar, 5000);
    await updateAndRenderResellerBonusMenu(ctx);
  });
  bot.action(`admin_res_bonus_${tier}_amt_dec`, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    adjustResellerBonusVar(amountVar, -5000);
    await updateAndRenderResellerBonusMenu(ctx);
  });
}

bot.action('admin_res_bonus_preview', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ADMIN_IDS.includes(ctx.from.id)) return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });

  try {
    const monthInfo = getMonthRange(-1);
    const preview = await getEligibleResellerActiveBonusPreview(-1);

    if (!preview.length) {
      return ctx.reply(
        `â„¹ï¸ Belum ada reseller yang lolos bonus aktif untuk periode *${monthInfo.label}*.`,
        { parse_mode: 'Markdown' }
      );
    }

    const lines = [];
    lines.push(`ðŸ‘€ *Preview Bonus Reseller Aktif*`);
    lines.push(`Periode: *${monthInfo.label}*`);
    lines.push('');

    preview.slice(0, 25).forEach((item, idx) => {
      const processedMark = item.processed ? ' â€¢ SUDAH DIPROSES' : '';
      lines.push(
        `${idx + 1}. \`${item.userId}\` â€” *${item.validActiveDays} hari* â€” ` +
        `omzet ~ *Rp${Number(item.validOmzet || 0).toLocaleString('id-ID')}* â€” ` +
        `${item.currentTier.label}: *Rp${Number(item.currentTier.bonusAmount || 0).toLocaleString('id-ID')}*${processedMark}`
      );
    });

    if (preview.length > 25) {
      lines.push('');
      lines.push(`_Menampilkan 25 dari total ${preview.length} reseller yang lolos._`);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('Gagal preview bonus reseller:', err.message || err);
    await ctx.reply('âŒ Gagal membuat preview bonus reseller.');
  }
});

bot.action('admin_res_bonus_process', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ADMIN_IDS.includes(ctx.from.id)) return ctx.reply('âŒ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });

  if (!RESELLER_ACTIVE_BONUS_ENABLED) {
    return ctx.reply('âš ï¸ Bonus reseller aktif sedang nonaktif. Aktifkan dulu dari menu bonus reseller.', { parse_mode: 'Markdown' });
  }

  try {
    const monthInfo = getMonthRange(-1);
    const preview = await getEligibleResellerActiveBonusPreview(-1);
    let successCount = 0;
    let skipCount = 0;
    let totalBonus = 0;

    for (const item of preview) {
      if (item.processed || !item.currentTier) {
        skipCount += 1;
        continue;
      }
      const result = await grantResellerActiveBonus({
        userId: item.userId,
        monthKey: item.monthKey,
        activeDays: item.validActiveDays,
        bonusAmount: item.currentTier.bonusAmount,
        tierLabel: item.currentTier.label,
        processedBy: ctx.from.id,
      });

      if (result.ok) {
        successCount += 1;
        totalBonus += Number(item.currentTier.bonusAmount || 0);
        try {
          await bot.telegram.sendMessage(
            item.userId,
            `ðŸŽ <b>Bonus Reseller Aktif Cair</b>

` +
            `Periode: <b>${monthInfo.label}</b>
` +
            `Hari aktif valid: <b>${item.validActiveDays}</b> hari
` +
            `Tier bonus: <b>${item.currentTier.label}</b>
` +
            `Bonus saldo: <b>Rp${Number(item.currentTier.bonusAmount || 0).toLocaleString('id-ID')}</b>

` +
            `Terima kasih sudah aktif jualan. Semangat closing lagi ya ðŸ”¥`,
            { parse_mode: 'HTML' }
          );
        } catch (e) {}
      } else {
        skipCount += 1;
      }
    }

    await ctx.reply(
      `âœ… *Proses bonus reseller selesai*

` +
      `Periode : *${monthInfo.label}*
` +
      `Berhasil: *${successCount}* reseller
` +
      `Skip    : *${skipCount}* reseller
` +
      `Total   : *Rp${Number(totalBonus || 0).toLocaleString('id-ID')}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.error('Gagal proses bonus reseller:', err.message || err);
    await ctx.reply('âŒ Gagal memproses bonus reseller.');
  }
});

// === SUBMENU: MANAGEMEN SERVER ===
bot.action('admin_server_menu', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    // Biar kalau ada user biasa iseng klik, dapat notif
    return ctx.answerCbQuery('ðŸš« Khusus admin.', { show_alert: true }).catch(() => {});
  }

  await ctx.answerCbQuery().catch(() => {});

  const text =
    '<b>ðŸŒ MANAGEMEN SERVER</b>\n\n' +
    'Pilih pengaturan yang berhubungan dengan server:\n\n' +
    'â€¢ Tambah / Hapus server\n' +
    'â€¢ Edit harga, nama, domain, auth\n' +
    'â€¢ Edit quota, limit IP, batas & total create\n' +
    'â€¢ Lihat list & detail server\n';

  const keyboard = [
    [
      { text: 'âž• Tambah Server', callback_data: 'addserver' },
      { text: 'âŒ Hapus Server', callback_data: 'deleteserver' }
    ],
    [
      { text: 'ðŸ’² Edit Harga', callback_data: 'editserver_harga' },
      { text: 'ðŸ“ Edit Nama', callback_data: 'nama_server_edit' }
    ],
    [
      { text: 'ðŸŒ Edit Domain', callback_data: 'editserver_domain' },
      { text: 'ðŸ”‘ Edit Auth', callback_data: 'editserver_auth' }
    ],
    [
      { text: 'ðŸ“Š Edit Quota', callback_data: 'editserver_quota' },
      { text: 'ðŸ“¶ Edit Limit IP', callback_data: 'editserver_limit_ip' }
    ],
    [
      { text: 'ðŸ”¢ Edit Batas Create', callback_data: 'editserver_batas_create_akun' },
      { text: 'ðŸ”¢ Edit Total Create', callback_data: 'editserver_total_create_akun' }
    ],
    [
      { text: 'ðŸ“‹ List Server', callback_data: 'listserver' },
      { text: 'â™»ï¸ Reset Server', callback_data: 'resetdb' }
    ],
    [
      { text: 'â„¹ï¸ Detail Server', callback_data: 'detailserver' }
    ],
    [
      { text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' }
    ]
  ];

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    logger.error('Error saat buka submenu server:', err);
    // fallback: kirim pesan baru
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
});

// === SUBMENU: TEMPLATE PROMOSI ===
bot.action('promo_template_menu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) {
    return ctx.reply('ðŸš« Menu ini khusus admin.');
  }

  const keyboard = [
    [
      { text: 'ðŸ“œ Katalog Paket VPN', callback_data: 'promo_tpl_catalog' }
    ],
    [
      { text: 'ðŸ’Ž Open Reseller', callback_data: 'promo_tpl_reseller' }
    ],
    [
      { text: 'âš¡ Promo Singkat Bot', callback_data: 'promo_tpl_short' }
    ],
    [
      { text: 'ðŸ‘‘ Template Kaisar', callback_data: 'promo_tpl_kaisar' }
    ],
    [
      { text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' }
    ]
  ];

  const text =
    '<b>ðŸ“¢ TEMPLATE PROMOSI</b>\n\n' +
    'Pilih template yang ingin dipakai.\n' +
    'Bot akan kirim teks iklan siap copas, ' +
    'bisa kamu edit dulu sebelum dikirim ke channel / grup.';

  try {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
});
// Helper kecil untuk ambil username bot
async function getBotTagForPromo() {
  let botTag = '@BOT_KAMU';
  try {
    const me = await bot.telegram.getMe();
    if (me && me.username) {
      botTag = '@' + me.username;
    }
  } catch (e) {
    logger.error('Gagal ambil info bot untuk template promosi:', e.message);
  }
  return botTag;
}

// ðŸ“œ Template 1: Katalog Paket VPN
bot.action('promo_tpl_catalog', async (ctx) => {
  try { await ctx.answerCbQuery().catch(() => {}); } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

  const botTag = await getBotTagForPromo();

  const text =
    'â•­â”€â–  N A M A  S T O R E  â–\n' +
    'â”‚ ðŸ” Pasti Aman âš¡ Anti Ngebug\n' +
    'â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®\n' +
    '   âœ¨ READY CONFIG PREMIUM âœ¨\n' +
    'â•­â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯\n' +
    'â”‚ ðŸ”° SSH WS / UDP\n' +
    'â”‚ ðŸ”° XRAY VMESS WS & GRPC\n' +
    'â”‚ ðŸ”° XRAY VLESS WS & GRPC\n' +
    'â”‚ ðŸ”° TROJAN WS & GRPC\n' +
    'â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•®\n' +
    '   ðŸŒ PILIH LOKASI SERVER\n' +
    'â•­â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯\n' +
    'â”‚ ðŸ‡¸ðŸ‡¬ SG DIGITALOCEAN\n' +
    'â”‚   Rp. 10.000 / 30 Hari â€¢ 2 Device\n' +
    'â”‚ ðŸ‡®ðŸ‡© ID NUSA\n' +
    'â”‚   Rp. 12.000 / 30 Hari â€¢ 2 Device\n' +
    'â”‚ ðŸ‡®ðŸ‡© ID RAJASA\n' +
    'â”‚   Rp. 13.000 / 30 Hari â€¢ 2 Device\n' +
    'â”‚ ðŸ‡®ðŸ‡© ID MSA\n' +
    'â”‚   Rp. 12.000 / 30 Hari â€¢ 2 Device\n' +
    'â”‚ ðŸŒ Lokasi lain bisa request\n' +
    'â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”ˆâ\n' +
    '\n' +
    'âœ… Anti Lag â€¢ Stabil Harian\n' +
    'âœ… Cocok Game / Streaming / Zoom\n' +
    'âœ… Bisa Trial dulu sebelum beli\n' +
    '\n' +
    'ðŸ“© Order via bot:\n' +
    'ðŸ‘‰ ' + botTag;

  await ctx.reply(text);
});

// ðŸ’Ž Template 2: Open Reseller
bot.action('promo_tpl_reseller', async (ctx) => {
  try { await ctx.answerCbQuery().catch(() => {}); } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

  const botTag = await getBotTagForPromo();

  const text =
    'â•­â”â”â”â–  OPEN RESELLER VPN  â–â”â”â”â•®\n' +
    'â”ƒ  Saatnya cuan dari jualan akun ðŸ’¸\n' +
    'â•°â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â•¯\n\n' +
    'âœ¨ HARGA RESELLER MULAI:\n' +
    'â€¢ Dari Rp. 4.500 / akun\n' +
    'â€¢ Bot auto create akun 24 jam\n' +
    'â€¢ Banyak pilihan server premium\n' +
    'â€¢ Trial bisa kapan saja\n\n' +
    'ðŸ’³ HARGA MEMBER MULAI:\n' +
    'â€¢ Rp. 10.000 / bulan\n' +
    'â€¢ Support 2 Device\n\n' +
    'ðŸ§¾ JOIN RESELLER:\n' +
    'â€¢ Minimal deposit: Rp. 25.000\n' +
    'â€¢ Sistem saldo, tinggal klik akun jadi\n\n' +
    'ðŸŽ¯ KEUNGGULAN:\n' +
    'â€¢ Panel dan bot mudah dipahami\n' +
    'â€¢ Bebas tentukan harga jual sendiri\n\n' +
    'ðŸ“² Minat daftar reseller?\n' +
    'Order langsung via bot:\n' +
    'ðŸ‘‰ ' + botTag;

  await ctx.reply(text);
});

// âš¡ Template 3: Promo Singkat Bot Auto Order
bot.action('promo_tpl_short', async (ctx) => {
  try { await ctx.answerCbQuery().catch(() => {}); } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

  const botTag = await getBotTagForPromo();

  const text =
    'â•­â”€â”€â”€â”€â”€â”€â”€â”€â–  VPN AUTO ORDER  â–â”€â”€â”€â”€â”€â”€â”€â”€â•®\n' +
    'â”‚   Bot siap melayani 24 jam non-stop âš¡\n' +
    'â•°â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â•¯\n\n' +
    'ðŸš€ PROTOKOL:\n' +
    'â€¢ SSH & UDP\n' +
    'â€¢ VMESS â€¢ VLESS â€¢ TROJAN\n\n' +
    'ðŸŒ SERVER:\n' +
    'â€¢ ðŸ‡¸ðŸ‡¬ Singapore\n' +
    'â€¢ ðŸ‡®ðŸ‡© Indonesia\n\n' +
    'ðŸ’Ž KEUNGGULAN:\n' +
    'â€¢ Banyak promo menarik\n' +
    'â€¢ Speed kencang dan stabil\n' +
    'â€¢ Akun langsung jadi tanpa tunggu admin\n' +
    'â€¢ Garansi sesuai masa aktif\n\n' +
    'ðŸ¤– Order otomatis di bot:\n' +
    'ðŸ‘‰ ' + botTag;

  await ctx.reply(text);
});

// ðŸ‘‘ Template 4: Style â€œKaisar Storeâ€
bot.action('promo_tpl_kaisar', async (ctx) => {
  try { await ctx.answerCbQuery().catch(() => {}); } catch (e) {}

  if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

  const botTag = await getBotTagForPromo();

  const text =
    'ðŸ‘‘ NAMA STORE KAMU ðŸ‘‘\n' +
    'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n' +
    'AKUN PREMIUM INDONESIA ðŸ‡®ðŸ‡©\n\n' +
    'ðŸ‡®ðŸ‡© ID CLOUD 1  :  Rp. 8K\n' +
    'ðŸ‡®ðŸ‡© ID CLOUD 2  :  Rp. 8K\n' +
    'ðŸ‡®ðŸ‡© ID CLOUD 3  :  Rp. 8K\n' +
    'ðŸ‡®ðŸ‡© ID HERZA 1  :  Rp. 8K\n' +
    'ðŸ‡®ðŸ‡© ID HERZA 2  :  Rp. 8K\n' +
    'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n' +
    'TERSEDIA:\n' +
    'ðŸ›° SSH\n' +
    'ðŸ›° VMESS\n' +
    'ðŸ›° SSH UDP\n' +
    'â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n' +
    'âœ… Wajib trial dulu biar makin yakin\n' +
    'âœ… Support 2 device\n' +
    'âœ… Support STB / HP / Laptop\n\n' +
    'ðŸ’³ Pembayaran:\n' +
    'âœ… DANA\n' +
    'âœ… OVO\n' +
    'âœ… QRIS (All Payment)\n\n' +
    'ðŸ“ž Order / tanya tanya via bot:\n' +
    'ðŸ‘‰ ' + botTag;

  await ctx.reply(text);
});

// === ðŸ“‹ LIST RESELLER ===
bot.action('list_reseller', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('ðŸš« Anda tidak memiliki izin untuk menggunakan menu ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    let resellerList = [];
    if (fs.existsSync(resselFilePath)) {
      const fileContent = fs.readFileSync(resselFilePath, 'utf8');
      resellerList = fileContent
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '');
    }

    if (resellerList.length === 0) {
      return ctx.reply('â„¹ï¸ Belum ada reseller terdaftar.');
    }

    const lines = [];
    let no = 1;

    for (const idStr of resellerList) {
      const userId = Number(idStr);
      if (!userId) continue;

      // Ambil username Telegram
      let username = '';
      try {
        username = await getUsernameById(userId);
      } catch (e) {
        username = '';
      }

      const displayName = username
        ? (username.startsWith('@') ? username : '@' + username)
        : `ID:${userId}`;

      // Ambil saldo dari tabel users
      const saldoRow = await new Promise((resolve) => {
        db.get(
          'SELECT saldo FROM users WHERE user_id = ?',
          [userId],
          (err, row) => {
            if (err || !row) return resolve(null);
            resolve(row);
          }
        );
      });

      const saldoText = saldoRow ? `Rp${saldoRow.saldo}` : 'Rp0';

      lines.push(`${no}. ${displayName} (${userId}) â€” Saldo: ${saldoText}`);
      no++;
    }

    const message =
      '<b>ðŸ“‹ DAFTAR RESELLER</b>\n\n' +
      (lines.length ? lines.join('\n') : 'Belum ada reseller yang tercatat di database users.');

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (err) {
    logger.error('âŒ Error saat menampilkan daftar reseller:', err);
    await ctx.reply('âŒ Terjadi kesalahan saat menampilkan daftar reseller.');
  }
});

// === ðŸ“‹ LIST MEMBER (USER BIASA) ===
bot.action('list_member', async (ctx) => {
  const adminId = ctx.from.id;

  // Pakai ADMIN_IDS (array angka) untuk cek admin
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.reply('ðŸš« Anda tidak memiliki izin untuk menggunakan menu ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    // Ambil semua user dari tabel users
    const allUsers = await new Promise((resolve, reject) => {
      db.all('SELECT user_id, saldo FROM users', [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    // Ambil daftar reseller dari ressel.db
    let resellerSet = new Set();
    try {
      if (fs.existsSync(resselFilePath)) {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
      }
    } catch (e) {
      logger.error('âš ï¸ Gagal membaca ressel.db saat list_member:', e);
    }

    // Filter: user yang bukan reseller dan bukan admin
    const memberUsers = allUsers.filter((u) => {
      const uidStr = String(u.user_id);
      if (resellerSet.has(uidStr)) return false;                // buang reseller
      if (ADMIN_IDS.includes(Number(u.user_id))) return false;  // buang admin
      return true;
    });

    if (memberUsers.length === 0) {
      return ctx.reply('â„¹ï¸ Belum ada member biasa yang terdaftar.');
    }

    const lines = [];
    let no = 1;

    // Susun teks dengan username + saldo
    for (const user of memberUsers) {
      const userId = user.user_id;

      let username = '';
      try {
        username = await getUsernameById(userId);
      } catch (e) {
        username = '';
      }

      const displayName = username
        ? (username.startsWith('@') ? username : '@' + username)
        : `ID:${userId}`;

      const saldoText = Number(user.saldo || 0).toLocaleString('id-ID');

      lines.push(`${no}. ${displayName} (${userId}) â€” Saldo: Rp${saldoText}`);
      no++;
    }

    const message = '<b>ðŸ“‹ DAFTAR MEMBER</b>\n\n' + lines.join('\n');
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    logger.error('âŒ Error saat menampilkan daftar member:', error);
    await ctx.reply('âŒ Terjadi kesalahan saat menampilkan daftar member.');
  }
});

// === ðŸ“‹ LIST SEMUA USER (ADMIN + RESELLER + MEMBER) + PAGING ===
const LIST_USERS_PAGE_SIZE = 40; // Ubah kalau mau lebih/kurang per halaman

async function renderAllUsersPage(ctx, page, editMessage) {
  try {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) {
      // kalau bukan admin, jangan apa-apa
      if (!editMessage) {
        await ctx.reply('ðŸš« Anda tidak memiliki izin untuk menggunakan menu ini.');
      }
      return;
    }

    // Ambil semua user dari tabel users (termasuk flag)
    const allUsers = await new Promise((resolve, reject) => {
      db.all(
        'SELECT user_id, saldo, flag_status, flag_note FROM users ORDER BY user_id ASC',
        [],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });

    if (!allUsers.length) {
      if (editMessage) {
        // kalau mau, edit pesan jadi info kosong
        try {
          await ctx.editMessageText('â„¹ï¸ Belum ada user terdaftar di database.', {
            parse_mode: 'HTML',
          });
        } catch (e) {
          await ctx.reply('â„¹ï¸ Belum ada user terdaftar di database.', {
            parse_mode: 'HTML',
          });
        }
      } else {
        await ctx.reply('â„¹ï¸ Belum ada user terdaftar di database.', {
          parse_mode: 'HTML',
        });
      }
      return;
    }

    // Ambil daftar reseller dari ressel.db
    let resellerSet = new Set();
    try {
      if (fs.existsSync(resselFilePath)) {
        const fileContent = fs.readFileSync(resselFilePath, 'utf8');
        const resellerList = fileContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        resellerSet = new Set(resellerList);
      }
    } catch (e) {
      logger.error('âš ï¸ Gagal membaca ressel.db saat list_all_users:', e);
    }

    const lines = [];
    let idx = 0;

    for (const user of allUsers) {
      const userId = user.user_id;
      if (!userId) continue;
      idx++;

      const uidNum = Number(userId);
      const uidStr = String(userId);

      // Tipe user: Admin / Reseller / Member (pakai singkatan)
      let tipeShort = 'MEM';
      if (ADMIN_IDS.includes(uidNum)) {
        tipeShort = 'ADM';
      } else if (resellerSet.has(uidStr)) {
        tipeShort = 'RES';
      }

      // Ambil username dari Telegram
      let username = '';
      try {
        username = await getUsernameById(userId);
      } catch (e) {
        username = '';
      }

      const displayName = username
        ? (username.startsWith('@') ? username : '@' + username)
        : `ID:${userId}`;

      const saldoText = Number(user.saldo || 0).toLocaleString('id-ID');

      // Flag status (pakai singkatan)
      let flagStatus = (user.flag_status || 'NORMAL').toString().toUpperCase();
      let flagShort = 'OK';
      if (flagStatus === 'WATCHLIST') {
        flagShort = 'WL';
      } else if (flagStatus === 'NAKAL') {
        flagShort = 'NK';
      }

      // Nomor global (01, 02, 03, ...)
      const num = String(idx).padStart(2, '0');

      // Catatan pendek (kalau ada)
      const note =
        user.flag_note && user.flag_note.trim()
          ? ` | Note: ${user.flag_note.trim()}`
          : '';

      // Satu baris per user, format rapih di monospace
      lines.push(
        `${num}. ${userId} | ${displayName} | ${tipeShort} | ${flagShort} | Rp${saldoText}${note}`
      );
    }

    const totalLines = lines.length;
    const pageSize = LIST_USERS_PAGE_SIZE;
    let totalPages = Math.ceil(totalLines / pageSize);
    if (totalPages < 1) totalPages = 1;

    // Normalisasi page
    if (!Number.isInteger(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const start = (page - 1) * pageSize;
    const pageLines = lines.slice(start, start + pageSize);
    const body =
      pageLines.length > 0
        ? pageLines.join('\n')
        : '(Tidak ada user di halaman ini)';

    const header =
      '<b>ðŸ“‹ DAFTAR SEMUA USER</b>\n' +
      `Hal ${page}/${totalPages} (maks ${pageSize} user/halaman)\n\n`;

    const message = header + '<pre>' + body + '</pre>';

    // Keyboard paging
    const buttons = [];
    if (page > 1) {
      buttons.push({
        text: 'â¬…ï¸ Sebelumnya',
        callback_data: `list_all_users_p_${page - 1}`,
      });
    }
    if (page < totalPages) {
      buttons.push({
        text: 'Berikutnya âž¡ï¸',
        callback_data: `list_all_users_p_${page + 1}`,
      });
    }

    const opts = { parse_mode: 'HTML' };
    if (buttons.length) {
      opts.reply_markup = { inline_keyboard: [buttons] };
    }

    if (editMessage) {
      // Edit pesan list yang lama
      try {
        await ctx.editMessageText(message, opts);
      } catch (e) {
        // kalau gagal edit (misalnya pesan sudah dihapus), kirim baru
        await ctx.reply(message, opts);
      }
    } else {
      // Kirim pesan baru
      await ctx.reply(message, opts);
    }
  } catch (err) {
    logger.error('âŒ Error di renderAllUsersPage:', err);
    if (!editMessage) {
      await ctx.reply('âŒ Terjadi kesalahan saat menampilkan daftar semua user.', {
        parse_mode: 'HTML',
      });
    }
  }
}

// Tombol di menu admin â†’ buka halaman 1
bot.action('list_all_users', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await renderAllUsersPage(ctx, 1, false);
});

// Tombol paging (Next / Prev) â†’ ganti halaman di pesan yang sama
bot.action(/list_all_users_p_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const page = parseInt(ctx.match[1], 10) || 1;
  await renderAllUsersPage(ctx, page, true);
});


///////////////

// ====== PROGRAM RESELLER ======
bot.action('jadi_reseller', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const userId = ctx.from.id;
  const storeName = NAMA_STORE || 'Layanan VPN';
  const adminName = ADMIN_USERNAME || 'Admin';

  const msg = `
<b>ðŸ¤ Program Reseller ${storeName}</b>

Pengen jualan akun VPN sendiri dengan modal lebih hemat?
Kamu bisa daftar sebagai <b>reseller resmi</b> di ${storeName}.

<b>âœ¨ Keuntungan jadi reseller:</b>
â€¢ ðŸ’¸ Dapat harga akun lebih murah dari harga user biasa.
â€¢ ðŸ§¾ Bebas atur harga jual ke pelanggan kamu sendiri.
â€¢ ðŸŒ Prioritas akses server & bantuan kalau ada kendala teknis.
â€¢ ðŸ›Ÿ Support langsung dari admin ${adminName} lewat chat.

<b>ðŸ“Œ Cara daftar reseller:</b>
1. Salin format pesan di bawah ini.
2. Kirim ke ${adminName} lewat chat Telegram.

<code>
Mau jadi reseller.
ID Telegram : ${userId}
Nama        : ....
</code>

<b>â„¹ï¸ Keterangan tambahan:</b>
â€¢ Minimal deposit, list harga reseller, dan aturan lengkap akan dijelaskan oleh admin.
â€¢ Saldo reseller nantinya bisa dipakai untuk membuat akun VPN langsung dari bot.
â€¢ Disarankan pakai nomor & akun Telegram yang aktif agar mudah dihubungi.
`.trim();

    await sendCleanMenu(ctx, msg, {
    parse_mode: 'HTML',
  });
});

// ========= â“ BANTUAN UNTUK PENGGUNA =========
bot.action('help_user', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const storeName = NAMA_STORE || 'Layanan VPN';
  const adminName = ADMIN_USERNAME || 'Admin';

  const text = `
<b>Bantuan Pengguna ${storeName}</b>

<b>1. Cara beli akun VPN</b>
â€¢ Tekan tombol "<b>âž• Buat Akun</b>" di menu utama.
â€¢ Pilih jenis akun (VMess / VLess / Trojan / SSH / lain-lain).
â€¢ Pilih server dan durasi paket.
â€¢ Konfirmasi pembelian sesuai petunjuk di layar.

<b>2. Cara cek akun & masa aktif</b>
â€¢ Tekan tombol "<b>ðŸ“‚ Akun Saya</b>".
â€¢ Bot akan menampilkan daftar akun milik kamu.
â€¢ Status akun:
  â€¢ âœ… Aktif (~X hari lagi)
  â€¢ âš ï¸ Aktif (habis HARI INI)
  â€¢ âŒ Sudah expired

<b>3. Cara melihat riwayat akun</b>
â€¢ Tekan tombol "<b>ðŸ“Š Riwayat Saya</b>".
â€¢ Di sana ada ringkasan:
  â€¢ Total akun yang pernah dibuat.
  â€¢ Berapa yang masih aktif.
  â€¢ Berapa yang sudah expired.
â€¢ Riwayat bisa digeser dengan tombol â¬…ï¸ dan âž¡ï¸ di bawah pesan.

<b>4. Trial akun</b>
â€¢ Tekan tombol "<b>âŒ› Trial Akun</b>" (jika tersedia).
â€¢ Trial hanya bisa dipakai <b>1x per hari</b> per akun Telegram (non-reseller).
â€¢ Jika sudah pernah trial hari ini, bot akan memberi info bahwa trial belum bisa dipakai lagi.

<b>5. TopUp saldo manual (QRIS)</b>
â€¢ Tekan tombol "<b>ðŸ’° TopUp Saldo Manual via (QRIS)</b>" di menu utama.
â€¢ Scan QRIS dengan aplikasi pembayaran kamu.
â€¢ Ikuti petunjuk jumlah & kirim bukti pembayaran ke admin sesuai format yang muncul.
â€¢ Setelah pembayaran dicek dan valid, saldo kamu akan diisi oleh admin.
â€¢ Saldo ini bisa dipakai untuk beli akun langsung dari bot, tanpa perlu chat admin satu-satu.

<b>6. Program Reseller (harga lebih murah)</b>
â€¢ Kalau kamu mau jualan akun VPN sendiri, atau ingin harga akun lebih murah dari harga user biasa:
  â€¢ Tekan tombol "<b>ðŸ¤ Jadi Reseller harga lebih murah!!</b>" di menu utama.
  â€¢ Di sana ada format pesan yang bisa kamu salin dan kirim ke admin.
â€¢ Setelah disetujui dan diaktifkan sebagai reseller:
  â€¢ Kamu akan dapat harga akun lebih murah.
  â€¢ Kamu bisa jual lagi ke pelangganmu dengan harga sendiri.
  â€¢ Saldo yang kamu isi bisa dipakai untuk membuat akun lewat bot.

<b>7. Butuh bantuan / komplain?</b>
Kalau kamu mengalami kendala:
â€¢ Akun tidak bisa konek.
â€¢ Config error / tidak bisa di-import.
â€¢ Salah pilih paket / server, dll.

Silakan hubungi admin <b>${adminName}</b> melalui Telegram.
Saat menghubungi admin, sertakan:
â€¢ Username akun VPN.
â€¢ Jenis akun (VMess / VLess / Trojan / SSH).
â€¢ Server yang dipakai.
â€¢ Kendala yang kamu alami (sedetail mungkin).

<b>8. Peraturan singkat pemakaian VPN</b>
â€¢ Dilarang membagikan akun, 1 akun 1 perangkat, kecuali server yang ada keterangan [2 device].
â€¢ Dilarang menggunakan VPN untuk aktivitas yang melanggar hukum.
â€¢ Admin berhak memutus/mematikan akun yang melanggar ketentuan.

Terima kasih sudah memakai layanan ${storeName}.
Jika masih bingung, kamu selalu bisa tekan tombol ini lagi: "<b>â“ Bantuan</b>".
  `.trim();

    try {
    await sendCleanMenu(ctx, text, {
      parse_mode: 'HTML',
    });
  } catch (e) {
    logger.error('Gagal kirim pesan bantuan:', e.message || e);
  }
});

///////
bot.action('addserver_reseller', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  userState[ctx.chat.id] = { step: 'reseller_domain' };
  await ctx.reply('ðŸŒ Masukkan domain server reseller:');
});

////////
bot.action('tambah_saldo', async (ctx) => {
  // Hilangkan "loading" di tombol
  await ctx.answerCbQuery().catch(() => {});

  const adminId = ctx.from.id;

  // Pastikan hanya admin
  if (!adminIds.includes(adminId)) {
    return toastError(ctx, 'Kamu tidak memiliki izin');
  }

  // Set state agar handler teks tahu kita lagi mode tambah saldo
  userState[adminId] = { step: 'addsaldo_userid' };

  await ctx.reply('ðŸ”¢ Masukkan ID Telegram user yang ingin ditambahkan saldo:');
});


bot.action('sendMainMenu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    await sendMainMenu(ctx);
  } catch (error) {
    console.error('âŒ Error saat kembali ke menu utama:', error);
    await ctx.reply('âš ï¸ Terjadi kesalahan saat membuka menu utama.');
  }
});


bot.action('service_trial', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_trial:', e.message);
    }
    return;
  }

  // Cek status trial dari konfigurasi
  try {
    const cfg = await getTrialConfig();
    if (!cfg.enabled) {
  return sendCleanMenu(ctx,
    'âŒ› <b>Fitur trial sedang dimatikan oleh admin.</b>\n\n' +
    'Silakan gunakan menu <b>âž• Buat Akun</b> untuk membeli akun,\n' +
    'atau coba lagi nanti ketika trial diaktifkan kembali.',
    { parse_mode: 'HTML' }
  );
}

  } catch (err) {
    logger.error('âš ï¸ Gagal membaca konfigurasi trial:', err.message);
    // Kalau gagal baca config, biarkan lanjut supaya user tidak terkunci total
  }

  await handleServiceAction(ctx, 'trial');
});

bot.action('service_create', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_create:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'create');
});


bot.action('service_renew', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_renew:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'renew');
});


bot.action('service_del', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_del:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'del');
});


bot.action('service_lock', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_lock:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'lock');
});


bot.action('service_unlock', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error service_unlock:', e.message);
    }
    return;
  }
  await handleServiceAction(ctx, 'unlock');
});


const { exec, spawn } = require('child_process');
// ===== QRIS MUTASI via CURL (opsional: SOCKS5) =====
const SOCKS_POOL = (() => {
  const val = envJson('SOCKS_POOL', vars.SOCKS_POOL);
  return Array.isArray(val) ? val : [];
})();

function getRandomProxy() {
  if (!SOCKS_POOL.length) return null;
  return SOCKS_POOL[Math.floor(Math.random() * SOCKS_POOL.length)];
}

function parseSocks(proxyStr) {
  // "user:pass@host:port"
  const [auth, hostport] = proxyStr.split('@');
  const [user, pass] = auth.split(':');
  return { hostport, user, pass };
}

function cekQRISGopayHistory(webMutasi, authUser, authToken) {
  return new Promise((resolve, reject) => {
    const proxy = getRandomProxy();
    const args = [
      '--silent',
      '--compressed',
      '--connect-timeout',
      '10',
      '--max-time',
      '20',
      '-X',
      'POST',
      String(webMutasi || ''),
      '-H',
      'Content-Type: application/x-www-form-urlencoded',
      '-H',
      'Accept-Encoding: gzip',
      '-H',
      'User-Agent: okhttp/4.12.0',
      '--data-urlencode',
      'requests[qris_history][page]=1',
      '--data-urlencode',
      `auth_username=${String(authUser || '')}`,
      '--data-urlencode',
      `auth_token=${String(authToken || '')}`,
    ];

    if (proxy) {
      const { hostport, user, pass } = parseSocks(proxy);
      args.splice(
        6,
        0,
        '--socks5-hostname',
        String(hostport || ''),
        '--proxy-user',
        `${String(user || '')}:${String(pass || '')}`
      );
    }

    const child = spawn('curl', args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      const out = (stdout || '').trim();
      if (code !== 0) {
        return reject(new Error((stderr || `curl exit code ${code}`).trim()));
      }
      if (out) {
        try {
          return resolve(JSON.parse(out));
        } catch (e) {
          return reject(new Error(`Invalid JSON: ${out.slice(0, 200)}`));
        }
      }
      return reject(new Error((stderr || 'Empty response from curl').trim()));
    });
  });
}

function findTxByKredit(qrisData, amount) {
  const list = qrisData?.qris_history?.results || [];
  const target = Number(amount);

  return (
    list.find((tx) => {
      const kredit = Number(String(tx.kredit || '0').replace(/\./g, ''));
      return kredit === target && String(tx.status || '').toUpperCase() === 'IN';
    }) || null
  );
}

bot.action('cek_service', async (ctx) => {
  try {
    // Tutup loading di tombol inline
    await ctx.answerCbQuery().catch(() => {});

    const userId = ctx.from.id;
    const isAdmin = ADMIN_IDS.includes(userId);

    // ðŸ” Cek status reseller pakai helper yang sama dengan fitur lain
    let isReseller = false;
    try {
      isReseller = await isUserReseller(userId);
    } catch (e) {
      logger.error('âŒ Gagal cek status reseller:', e.message || e);
    }

    // Hanya Reseller & Admin yang boleh cek server
    if (!isReseller && !isAdmin) {
      return ctx.reply(
        'âŒ *Fitur cek server hanya untuk Reseller dan Admin.*\n\n' +
        'Kalau kamu ingin akses menu cek server & monitoring, kamu bisa daftar sebagai *Reseller* lewat menu yang tersedia atau hubungi admin.',
        { parse_mode: 'Markdown' }
      );
    }

    // âœ… Jika reseller / admin, lanjut jalankan cek service
    const loadingMsg = await ctx.reply('â³ Sedang mengecek status server, mohon tunggu sebentar...');

    const cekPortChild = spawn('bash', ['cek-port.sh'], { shell: false, windowsHide: true });
    let cekStdout = '';
    let cekStderr = '';
    cekPortChild.stdout.on('data', (chunk) => { cekStdout += chunk.toString(); });
    cekPortChild.stderr.on('data', (chunk) => { cekStderr += chunk.toString(); });
    cekPortChild.on('error', (error) => {
      logger.error(`Gagal menjalankan skrip cek-port.sh: ${error.message}`);
      ctx.telegram.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        undefined,
        '❌ Terjadi kesalahan saat menjalankan skrip pengecekan server.',
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    });
    cekPortChild.on('close', (code) => {
      const stdout = cekStdout;
      const stderr = cekStderr;
      if (code !== 0) {
        logger.error(`cek-port.sh exit code ${code}: ${stderr}`);
        return ctx.telegram.editMessageText(
          loadingMsg.chat.id,
          loadingMsg.message_id,
          undefined,
          '❌ Terjadi kesalahan saat menjalankan skrip pengecekan server.',
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }

      if (stderr) {
        logger.error(`Error dari skrip cek-port.sh: ${stderr}`);
      }

      // Bersihkan kode warna ANSI supaya rapi
      let cleanOutput = stdout.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (!cleanOutput) {
        cleanOutput = 'Tidak ada output dari skrip cek-port.sh.';
      }

      // Escape karakter berbahaya untuk HTML
      cleanOutput = cleanOutput
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Batasi panjang output supaya tidak terlalu panjang
      if (cleanOutput.length > 1500) {
        cleanOutput = cleanOutput.slice(0, 1500) + '\n... (dipotong, output terlalu panjang)';
      }

      const timestamp = new Date().toLocaleString('id-ID', {
        timeZone: TIME_ZONE,
      });

      const legend =
        '\n\n<b>Keterangan:</b>\n' +
        '• <b>OPEN</b>      : Port terbuka dan layanan merespons dengan baik.\n' +
        '• <b>CLOSED</b>    : Port tertutup atau layanan tidak aktif.\n' +
        '• <b>TIMEOUT</b>   : Tidak ada balasan dari server, kemungkinan gangguan koneksi.';

      const resultText =
        `<b>📶 STATUS SERVER </b>\n` +
        `Waktu cek: <b>${timestamp}</b>\n\n` +
        `<pre>${cleanOutput}</pre>` +
        legend;

      ctx.telegram.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        undefined,
        resultText,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    });
  } catch (err) {
    logger.error('âŒ Error cek_service:', err);
    try {
      await ctx.reply('âŒ Gagal menjalankan pengecekan server.');
    } catch (e) {}
  }
});

bot.action(/^qris_status:(.+)$/i, async (ctx) => {
  try {
    const invoiceId = String(ctx.match[1] || '').trim();
    if (!invoiceId) return ctx.answerCbQuery('Invoice kosong');
    await ctx.answerCbQuery('Mengecek...', { show_alert: false }).catch(() => {});


    db.get(
      'SELECT status, amount, base_amount, unique_suffix, created_at, paid_at FROM qris_payments WHERE invoice_id = ? ORDER BY id DESC LIMIT 1',
      [invoiceId],
      async (err, row) => {
        if (err || !row) {
          await ctx.answerCbQuery('Invoice tidak ditemukan', { show_alert: true }).catch(() => {});
          return;
        }

        const s = String(row.status || 'pending').toUpperCase();
        const msg =
          `ðŸ§¾ <b>Status QRIS</b>\n` +
          `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
          `Invoice : <code>${invoiceId}</code>\n` +
          `Status  : <b>${s}</b>\n` +
          `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
          `Catatan: Saldo masuk otomatis saat status <b>PAID</b>.`;

        // Kalau tombol ditekan dari caption foto, coba edit captionnya
        try {
          await ctx.editMessageCaption(msg, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'ðŸ”Ž Refresh Status', callback_data: `qris_status:${invoiceId}` }],
                [{ text: 'ðŸ  Menu Utama', callback_data: 'send_main_menu' }],
              ],
            },
          });
        } catch {
          await ctx.answerCbQuery('Tidak bisa edit pesan ini. Buat QRIS baru / buka pesan QR terakhir.', { show_alert: true }).catch(() => {});
        }
        

        await ctx.answerCbQuery('OK').catch(() => {});
      }
    );
  } catch {
    try { await ctx.answerCbQuery('Gagal cek status', { show_alert: true }); } catch {}
  }
});


bot.action('send_main_menu', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error send_main_menu:', e.message);
    }
    return;
  }
  await sendMainMenu(ctx);
});

// === HANDLER: Ringkasan Penjualan Reseller (pakai akun & hari) ===
bot.action('sales_summary', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from) return;

  const userId = ctx.from.id;

  if (!isResellerId(userId) && !adminIds.includes(userId)) {
    return ctx.reply(
      'âŒ Fitur <b>Penjualan Saya</b> hanya untuk reseller.',
      { parse_mode: 'HTML' }
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  db.all(
    `SELECT created_at, expires_at, type, username
     FROM accounts
     WHERE user_id = ?
       AND created_at >= ?
       AND created_at < ?
     ORDER BY created_at ASC`,
    [userId, monthStart, monthEnd],
    async (err, rows) => {
      if (err) {
        logger.error('Gagal ambil data penjualan reseller (sales_summary):', err.message || err);
        return ctx.reply('âŒ Gagal memuat ringkasan penjualan kamu. Silakan coba lagi.', { parse_mode: 'HTML' });
      }

      const bonusStats = await getResellerActiveBonusStats(userId, { offsetMonths: 0 });
      const bulanLabel = now.toLocaleDateString('id-ID', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: 'long'
      });

      let totalAccounts = 0;
      let totalDays = 0;
      let count30Days = 0;

      for (const acc of (rows || [])) {
        totalAccounts += 1;
        if (!acc.expires_at || !acc.created_at) continue;
        const durMs = acc.expires_at - acc.created_at;
        let durDays = Math.round(durMs / dayMs);
        if (durDays < 1) durDays = 1;
        totalDays += durDays;
        if (durDays >= 30) count30Days += 1;
      }

      const meets30 = count30Days >= RESELLER_TARGET_MIN_30D_ACCOUNTS;
      const meetsDays = totalDays >= RESELLER_TARGET_MIN_DAYS_PER_MONTH;

      let bonusProgressText = '';
      if (RESELLER_ACTIVE_BONUS_ENABLED) {
        bonusProgressText += `<b>ðŸŽ Progress Bonus Aktif</b>
`;
        bonusProgressText += `â€¢ Hari aktif valid       : <b>${bonusStats.validActiveDays}</b> hari
`;
        bonusProgressText += `â€¢ Akun valid bonus       : <b>${bonusStats.validAccounts}</b> akun
`;
        bonusProgressText += `â€¢ Omzet valid estimasi   : <b>Rp${Number(bonusStats.validOmzet || 0).toLocaleString('id-ID')}</b>
`;
        bonusProgressText += `â€¢ Min durasi dihitung    : <b>${RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS}</b> hari
`;
        bonusProgressText += `â€¢ Min omzet / hari       : <b>Rp${Number(RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET || 0).toLocaleString('id-ID')}</b>
`;
        if (bonusStats.currentTier) {
          bonusProgressText += `â€¢ Tier tercapai          : <b>${bonusStats.currentTier.label}</b> (Rp${Number(bonusStats.currentTier.bonusAmount || 0).toLocaleString('id-ID')})
`;
        } else {
          bonusProgressText += `â€¢ Tier tercapai          : <b>Belum ada</b>
`;
        }
        if (bonusStats.nextTier) {
          const need = Math.max(0, bonusStats.nextTier.minDays - bonusStats.validActiveDays);
          bonusProgressText += `â€¢ Target berikutnya      : <b>${bonusStats.nextTier.label}</b> â€” sisa <b>${need}</b> hari lagi
`;
        } else if (bonusStats.currentTier) {
          bonusProgressText += `â€¢ Target berikutnya      : <b>Tier tertinggi sudah tercapai</b>
`;
        }
        if (bonusStats.invalidShortAccounts > 0) {
          bonusProgressText += `â€¢ Akun terlalu pendek    : <b>${bonusStats.invalidShortAccounts}</b> akun tidak dihitung
`;
        }
        if (bonusStats.invalidLowOmzetDays > 0) {
          bonusProgressText += `â€¢ Hari omzet kurang      : <b>${bonusStats.invalidLowOmzetDays}</b> hari tidak dihitung
`;
        }
      }

      let text =
        `<b>ðŸ§¾ Penjualan Saya â€” ${bulanLabel}</b>

` +
        `â€¢ Total akun terjual       : <b>${totalAccounts}</b>
` +
        `â€¢ Akun durasi â‰¥ 30 hari    : <b>${count30Days}</b>
` +
        `â€¢ Total hari akumulasi     : <b>${totalDays}</b> hari

` +
        `<b>ðŸŽ¯ Target Bulanan</b>
` +
        `â€¢ Minimal <b>${RESELLER_TARGET_MIN_30D_ACCOUNTS}</b> akun berdurasi â‰¥ 30 hari
` +
        `â€¢ Atau total <b>${RESELLER_TARGET_MIN_DAYS_PER_MONTH}</b> hari dari semua akun

` +
        `<b>ðŸ“Œ Status Target Bulan Ini</b>
` +
        `â€¢ Target akun 30 hari : ${meets30 ? 'âœ… Tercapai' : 'âŒ Belum tercapai'}
` +
        `â€¢ Target total hari   : ${meetsDays ? 'âœ… Tercapai' : 'âŒ Belum tercapai'}

`;

      if (bonusProgressText) {
        text += bonusProgressText + `
`;
      }

      text += `<i>Catatan: bonus reseller aktif hanya menghitung akun berbayar yang memenuhi durasi minimum dan omzet harian minimum. Akun 1 hari / terlalu pendek tidak dihitung.</i>`;

      return sendCleanMenu(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'ðŸ”™ Kembali', callback_data: 'send_main_menu' }]
          ]
        }
      });
    }
  );
});



bot.action('trial_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_vmess:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL VMESS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // WATCHLIST & NORMAL tetap boleh trial (nanti bisa kita batasi lagi kalau mau)
  await startSelectServer(ctx, 'trial', 'vmess');
});

bot.action('trial_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_vless:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL VLESS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'trial', 'vless');
});

bot.action('trial_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_trojan:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL TROJAN</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'trial', 'trojan');
});

bot.action('trial_shadowsocks', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_shadowsocks:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL SHADOWSOCKS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'trial', 'shadowsocks');
});

bot.action('trial_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error trial_ssh:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses trial kamu dibatasi.', { show_alert: true });
    } catch (e) {}
    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>TRIAL SSH/OVPN</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'trial', 'ssh');
});


bot.action('create_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_vmess:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN VMESS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // NORMAL & WATCHLIST masih boleh buat akun (nanti bisa kita batasi kalau mau)
  await startSelectServer(ctx, 'create', 'vmess');
});


bot.action('create_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_vless:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN VLESS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'create', 'vless');
});

bot.action('create_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_trojan:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN TROJAN</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'create', 'trojan');
});

bot.action('create_shadowsocks', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_shadowsocks:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN SHADOWSOCKS</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'create', 'shadowsocks');
});

bot.action('create_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error create_ssh:', e.message);
    }
    return;
  }

  const userId = ctx.from.id;
  const flag = await getUserFlagStatus(userId);

  if (flag === 'NAKAL') {
    try {
      await ctx.answerCbQuery('âš ï¸ Akses buat akun kamu dibatasi.', { show_alert: true });
    } catch (e) {}

    await ctx.reply(
      'âš ï¸ Akun kamu saat ini berstatus <b>NAKAL</b>.\n' +
        'Fitur <b>BUAT AKUN SSH/OVPN</b> tidak dapat digunakan.\n' +
        'Silakan hubungi admin jika merasa ini salah.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await startSelectServer(ctx, 'create', 'ssh');
});


//DELETE SSH
bot.action('del_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'del', 'ssh');
});

bot.action('del_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'del', 'vmess');
});

bot.action('del_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'del', 'vless');
});

bot.action('del_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'del', 'trojan');
});
//DELETE BREAK

//LOCK
bot.action('lock_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'lock', 'ssh');
});

bot.action('lock_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'lock', 'vmess');
});

bot.action('lock_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'lock', 'vless');
});

bot.action('lock_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'lock', 'trojan');
});
//LOCK BREAK
//UNLOCK
bot.action('unlock_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'unlock', 'ssh');
});

bot.action('unlock_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'unlock', 'vmess');
});

bot.action('unlock_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'unlock', 'vless');
});

bot.action('unlock_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await startSelectServer(ctx, 'unlock', 'trojan');
});
//UNLOCK BREAK

bot.action('renew_vmess', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_vmess:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'vmess');
});


bot.action('renew_vless', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_vless:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'vless');
});


bot.action('renew_trojan', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_trojan:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'trojan');
});


bot.action('renew_shadowsocks', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_shadowsocks:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'shadowsocks');
});


bot.action('renew_ssh', async (ctx) => {
  if (!ctx || !ctx.match) {
    try {
      await ctx.answerCbQuery('âŒ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error renew_ssh:', e.message);
    }
    return;
  }
  await startSelectServer(ctx, 'renew', 'ssh');
});

async function startSelectServer(ctx, action, type, page = 0) {

try {
  const isR = await isUserReseller(ctx.from.id);
  const query = isR
    ? 'SELECT * FROM Server'
    : 'SELECT * FROM Server WHERE is_reseller_only = 0 OR is_reseller_only IS NULL';

  db.all(query, [], (err, servers) => {
    if (err) {
      logger.error('âš ï¸ Error fetching servers:', err.message);
      return ctx.reply('âš ï¸ Tidak ada server yang tersedia saat ini.', { parse_mode: 'HTML' });
    }

    // ==== mulai logika pagination di bawah ini ====
    const serversPerPage = 6;
    const totalPages = Math.ceil(servers.length / serversPerPage);
    const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = currentPage * serversPerPage;
    const end = start + serversPerPage;
    const currentServers = servers.slice(start, end);

    const keyboard = [];
    for (let i = 0; i < currentServers.length; i += 2) {
      const row = [];
      const server1 = currentServers[i];
      const server2 = currentServers[i + 1];
      row.push({ text: server1.nama_server, callback_data: `${action}_username_${type}_${server1.id}` });
      if (server2) {
        row.push({ text: server2.nama_server, callback_data: `${action}_username_${type}_${server2.id}` });
      }
      keyboard.push(row);
    }

    const navButtons = [];
    if (totalPages > 1) {
      if (currentPage > 0) {
        navButtons.push({ text: 'â¬…ï¸ Back', callback_data: `navigate_${action}_${type}_${currentPage - 1}` });
      }
      if (currentPage < totalPages - 1) {
        navButtons.push({ text: 'âž¡ï¸ Next', callback_data: `navigate_${action}_${type}_${currentPage + 1}` });
      }
    }
    if (navButtons.length > 0) keyboard.push(navButtons);
    keyboard.push([{ text: 'ðŸ”™ Kembali ke Menu Utama', callback_data: 'sendMainMenu' }]);

           const serverList = currentServers.map((server) => {
      // Sekarang server.harga dianggap harga paket 30 hari
      const hargaNormalPer30Hari = Number(server.harga) || 0;
      const hargaNormalPerHari =
        hargaNormalPer30Hari > 0
          ? Math.max(1, Math.round(hargaNormalPer30Hari / 30))
          : 0;

      // Hitung harga reseller (diskon dari harga 30 hari)
      const hargaResellerPer30Hari =
        hargaNormalPer30Hari > 0
          ? Math.max(1, Math.round(hargaNormalPer30Hari * RESELLER_DISCOUNT))
          : 0;
      const hargaResellerPerHari =
        hargaResellerPer30Hari > 0
          ? Math.max(1, Math.round(hargaResellerPer30Hari / 30))
          : 0;

      const isFull = server.total_create_akun >= server.batas_create_akun;

      let hargaText;
      if (isR) {
        // Tampilan khusus reseller
        hargaText =
          `ðŸ’° Harga normal 30 hari : <b>Rp${hargaNormalPer30Hari}</b>\n` +
          `ðŸ’° Harga reseller 30 hari : <b>Rp${hargaResellerPer30Hari}</b>\n` +
          `ðŸ“… Perkiraan reseller / hari : <b>Rp${hargaResellerPerHari}</b>`;
      } else {
        // User biasa
        hargaText =
          `ðŸ’° Harga 30 hari : <b>Rp${hargaNormalPer30Hari}</b>\n` +
          `ðŸ“… Perkiraan harga / hari : <b>Rp${hargaNormalPerHari}</b>`;
      }

      const statusText = isFull
        ? 'â›” <b>Server penuh, tidak bisa membuat akun baru.</b>'
        : `ðŸ‘¥ Total akun dibuat: <b>${server.total_create_akun}/${server.batas_create_akun}</b>`;

      return (
        `ðŸŒ <b>${server.nama_server}</b>\n` +
        `${hargaText}\n` +
        `ðŸ“Š Quota : <b>${server.quota} GB</b>\n` +
        `ðŸ”¢ Limit IP : <b>${server.iplimit} IP</b>\n` +
        statusText
      );
    }).join('\n\n');


       const header =
      `ðŸ“‹ <b>List Server</b>\n` +
      `Halaman ${currentPage + 1} dari ${totalPages}\n\n`;

    if (ctx.updateType === 'callback_query') {
      ctx.editMessageText(header + serverList, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });
    } else {
      ctx.reply(header + serverList, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });
    }


    userState[ctx.chat.id] = { step: `${action}_username_${type}`, page: currentPage };
  });
} catch (error) {
  logger.error(`âŒ Error saat memulai proses ${action} untuk ${type}:`, error);
  await ctx.reply(`âŒ *GAGAL!* Terjadi kesalahan saat memproses permintaan.`, { parse_mode: 'Markdown' });
}
}

bot.action(/navigate_(\w+)_(\w+)_(\d+)/, async (ctx) => {
  const [, action, type, page] = ctx.match;
  await startSelectServer(ctx, action, type, parseInt(page, 10));
});

bot.action(/(create|renew)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const type = ctx.match[2];
  const serverId = ctx.match[3];
  userState[ctx.chat.id] = { step: `username_${action}_${type}`, serverId, type, action };

  db.get('SELECT batas_create_akun, total_create_akun FROM Server WHERE id = ?', [serverId], async (err, server) => {
    if (err) {
      logger.error('âš ï¸ Error fetching server details:', err.message);
      return ctx.reply('âŒ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
    }

    if (!server) {
      return ctx.reply('âŒ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
    }

    const batasCreateAkun = server.batas_create_akun;
    const totalCreateAkun = server.total_create_akun;

    if (totalCreateAkun >= batasCreateAkun) {
  return sendCleanMenu(
    ctx,
    'âŒ <b>Server penuh.</b> Tidak dapat membuat akun baru di server ini.',
    { parse_mode: 'HTML' }
  );
}


await ctx.reply(
  'ðŸ‘¤ <b>Masukkan username:</b>',
  { parse_mode: 'HTML' }
);

  });
});

// === âš¡ï¸ KONFIRMASI TRIAL (semua tipe) ===
bot.action(/(trial)_username_(vmess|vless|trojan|shadowsocks|ssh)_(\d+)/, async (ctx) => {
  const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

  // Ambil nama server dari database
  db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
    if (err) {
      logger.error('âŒ Gagal mengambil data server:', err.message);
      return showErrorOnMenu(ctx, 'Terjadi kesalahan saat mengambil data server.');
    }

    if (!server) {
      return ctx.reply('âš ï¸ Server tidak ditemukan di database.');
    }

    // Simpan state untuk langkah berikutnya (konfirmasi trial)
    userState[ctx.chat.id] = {
      step: `username_${action}_${type}`,
      serverId,
      type,
      action,
      serverName: server.nama_server || server.domain
    };

    // Ambil pengaturan trial
    let cfg;
    try {
      cfg = await getTrialConfig();
    } catch (e) {
      cfg = DEFAULT_TRIAL_CONFIG;
      logger.error('âš ï¸ Gagal membaca konfigurasi trial di konfirmasi server:', e.message || e);
    }

    let durationHours =
      cfg && Number.isInteger(cfg.durationHours) && cfg.durationHours > 0
        ? cfg.durationHours
        : DEFAULT_TRIAL_CONFIG.durationHours;

    let maxPerDay =
      cfg && Number.isInteger(cfg.maxPerDay) && cfg.maxPerDay > 0
        ? cfg.maxPerDay
        : DEFAULT_TRIAL_CONFIG.maxPerDay;

    let minBalance =
      cfg && Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial > 0
        ? cfg.minBalanceForTrial
        : 0;

    const serverName = server.nama_server || server.domain || `ID ${server.id}`;

        let info =
      `âš ï¸ <b>Konfirmasi Trial ${type.toUpperCase()}</b>\n\n` +
      `Kamu akan membuat akun <b>trial ${type.toUpperCase()}</b> di server <b>${serverName}</b>.\n\n` +
      `<b>Pengaturan trial saat ini:</b>\n` +
      `â€¢ Masa aktif trial   : <b>${durationHours} jam</b>\n` +
      `â€¢ Batas trial / hari : <b>${maxPerDay}x per user</b>\n`;

    if (minBalance > 0) {
      info += `â€¢ Minimal saldo trial: <b>Rp${minBalance}</b>\n`;
    }

    info +=
      '\nUsername untuk akun trial akan dibuat <b>acak otomatis oleh server</b>.\n' +
      'Jadi kamu <b>tidak perlu menentukan username sendiri</b>.\n\n' +
      'Kalau setuju, balas pesan ini dengan teks apa saja (contoh: <code>ok</code>, <code>lanjut</code>, atau emoji).\n' +
      'Setelah itu bot akan langsung membuat akun trial dan menampilkan username & password yang dibuat otomatis.';

    await sendCleanMenu(ctx, info, { parse_mode: 'HTML' });

  });
});


// ========= ðŸ“‚ AKUN SAYA â€“ LIST AKUN MILIK USER (AKTIF / EXPIRED / SEMUA) =========
async function showMyAccounts(ctx, filter = 'active', page = 0) {
  try {
    // Tutup "loading" di tombol, kalau dipanggil dari callback
    try {
      await ctx.answerCbQuery().catch(() => {});
    } catch (e) {}

    if (!ctx.from) {
      return ctx.reply('âŒ Tidak bisa membaca data pengguna.');
    }

    const userId = ctx.from.id;

    // Hitung awal hari (00:00) dalam bentuk timestamp (ms)
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    ).getTime();

    // Tentukan filter & SQL
    let whereClause = 'a.user_id = ?';
    const params = [userId];
    let filterText;
    let filterNormalized;

    switch (filter) {
      case 'expired':
        // Expired = tanggal expire sebelum hari ini
        whereClause += ' AND a.expires_at IS NOT NULL AND a.expires_at < ?';
        params.push(todayStart);
        filterText = 'Menampilkan hanya akun <b>EXPIRED</b>.';
        filterNormalized = 'expired';
        break;

      case 'all':
        filterText = 'Menampilkan semua akun (aktif & expired).';
        filterNormalized = 'all';
        break;

      case 'active':
      default:
        // Aktif = belum ada expire ATAU tanggal expire hari ini atau sesudahnya
        whereClause += ' AND (a.expires_at IS NULL OR a.expires_at >= ?)';
        params.push(todayStart);
        filterText = 'Menampilkan hanya akun <b>AKTIF</b>.';
        filterNormalized = 'active';
        break;
    }
    const pageSize = 10;
    const safePage = Math.max(0, parseInt(page, 10) || 0);
    const offset = safePage * pageSize;

    db.all(
      `SELECT a.id, a.username, a.type, a.server_id, a.expires_at, s.nama_server
       FROM accounts a
       LEFT JOIN Server s ON a.server_id = s.id
       WHERE ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
       [...params, pageSize + 1, offset],
       async (err, rows) => {
        if (err) {
          logger.error('âŒ Gagal mengambil data akun:', err.message);
          try {
            await sendCleanMenu(ctx, 'âŒ Terjadi kesalahan saat mengambil data akun.', {
              parse_mode: 'HTML',
            });
          } catch (e) {
            logger.error('âŒ Gagal kirim pesan error showMyAccounts:', e);
          }
          return;
        }

        // Tombol filter di atas daftar
        const activeLabel = filterNormalized === 'active' ? 'âœ… Aktif â€¢' : 'âœ… Aktif';
        const expiredLabel = filterNormalized === 'expired' ? 'âŒ Expired â€¢' : 'âŒ Expired';
        const allLabel = filterNormalized === 'all' ? 'ðŸ“‹ Semua â€¢' : 'ðŸ“‹ Semua';

        const keyboard = [
          [
            { text: activeLabel, callback_data: 'my_accounts_active' },
            { text: expiredLabel, callback_data: 'my_accounts_expired' },
          ],
          [
            { text: allLabel, callback_data: 'my_accounts_all' },
          ],
        ];

        // Tidak ada data
        if (!rows || rows.length === 0) {
          let noDataMsg = 'Belum ada akun yang cocok dengan filter ini.';

          if (filterNormalized === 'active') {
            noDataMsg =
              'Belum ada akun aktif yang tercatat untuk kamu.\n' +
              'Coba lihat tab "ðŸ“‹ Semua" atau buat akun baru dari menu utama.';
          } else if (filterNormalized === 'expired') {
            noDataMsg =
              'Belum ada akun expired yang tercatat untuk kamu.\n' +
              'Coba lihat tab "âœ… Aktif" atau "ðŸ“‹ Semua".';
          }

          const text =
            'ðŸ“‚ <b>Akun Saya</b>\n\n' +
            filterText + '\n\n' +
            noDataMsg;

          try {
            await sendCleanMenu(ctx, text, {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: keyboard },
            });
          } catch (e) {
            logger.error('âŒ Gagal kirim menu Akun Saya (no data):', e);
          }

          return;
        }

        // Ada data
        let text = 'ðŸ“‚ <b>Akun Saya</b>\n\n' + filterText + '\n\n';
        text += `Tipe: VM=vmess, VL=vless, SH=ssh, TJ=trojan, SS=shadowsocks\n`;
        text += `Status: âœ…A#=aktif, âš ï¸A0=habis hari ini, âŒX=expired\n\n`;
  const hasNext = rows.length > pageSize;
  const pageRows = hasNext ? rows.slice(0, pageSize) : rows;
        pageRows.forEach((row, index) => {
  const nomor = offset + index + 1;
  const serverName =
    row.nama_server || (row.server_id ? `Server ${row.server_id}` : 'Server ?');

  let status = 'â³ Tidak diketahui';
  if (row.expires_at) {
    const daysLeft = getAccountDaysLeft(row.expires_at);

    if (daysLeft > 0) {
      status = `âœ… Aktif (~${daysLeft} hari lagi)`;
    } else if (daysLeft === 0) {
      status = 'âš ï¸ Aktif (habis HARI INI)';
    } else if (daysLeft < 0) {
      status = 'âŒ Sudah expired';
    }
  }

  // Tambah ke teks daftar (lebih ringkas)
  const tcode = typeCode(row.type);
  const st = shortStatus(row.expires_at);
  text += `${nomor}. [${tcode}] <b>${row.username}</b> â€¢ ${serverName} â€¢ ${st}\n`;

// ðŸ”˜ Tombol pilih akun: hanya untuk tab "active"
if (filterNormalized === 'active') {
  keyboard.push([
    {
      text: `${nomor}. ${row.username} [${row.type}]`,
      callback_data: `accsel:${row.id}`,
    },
  ]);
}
});
  const navRow = [];
      if (safePage > 0) {
        navRow.push({ text: 'â¬…ï¸ Sebelumnya', callback_data: `myacc_page:${filterNormalized}:${safePage - 1}` });
      }
      if (hasNext) {
        navRow.push({ text: 'Berikutnya âž¡ï¸', callback_data: `myacc_page:${filterNormalized}:${safePage + 1}` });
      }
      if (navRow.length) keyboard.push(navRow);
keyboard.push([{ text: 'ðŸ”™ Menu Utama', callback_data: 'send_main_menu' }]);

        try {
          await sendCleanMenu(ctx, text, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard },
          });
        } catch (e) {
          logger.error('âŒ Gagal kirim menu Akun Saya (ada data):', e);
        }
      }
    );
  } catch (err) {
    logger.error('âŒ Error di showMyAccounts:', err);
    try {
      await sendCleanMenu(ctx, 'âŒ Terjadi kesalahan saat menampilkan akun.', {
        parse_mode: 'HTML',
      });
    } catch (e) {
      logger.error('âŒ Gagal kirim pesan error luar showMyAccounts:', e);
    }
  }
}

// Default dari tombol ðŸ“‚ Akun Saya â†’ tampilkan akun AKTIF
bot.action('my_accounts', async (ctx) => {
  return showMyAccounts(ctx, 'active');
});

// Tombol filter
bot.action('my_accounts_active', async (ctx) => showMyAccounts(ctx, 'active', 0));
bot.action('my_accounts_expired', async (ctx) => showMyAccounts(ctx, 'expired', 0));
bot.action('my_accounts_all', async (ctx) => showMyAccounts(ctx, 'all', 0));
bot.action(/^myacc_page:(active|expired|all):(\d+)$/, async (ctx) => {
     const filter = ctx.match[1];
     const page = parseInt(ctx.match[2], 10) || 0;
     return showMyAccounts(ctx, filter, page);
   });

// ========= ðŸ“Š RIWAYAT / LAPORAN SAYA (VERSI DETAIL + PAGING) =========
const MY_STATS_PAGE_SIZE = 10; // ðŸ”§ ganti ke 15 / 20 kalau mau

    async function showMyStatsPage(ctx, page) {
  try {
    if (!ctx.from) {
      return ctx.reply('âŒ Tidak bisa membaca data pengguna.');
    }

    const userId = ctx.from.id;
    await ctx.answerCbQuery().catch(() => {});

    const nowTs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Awal hari ini (00:00) untuk logika aktif/expired berbasis TANGGAL
    const nowDate = new Date();
    const todayStart = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate()
    ).getTime();

    // ===== RINGKASAN AKUN DARI TABEL accounts =====
    function countAccounts(whereClause, params) {
      return new Promise((resolve) => {
        db.get(
          `SELECT COUNT(*) AS count FROM accounts WHERE ${whereClause}`,
          params,
          (err, row) => {
            if (err) {
              logger.error('Gagal ambil statistik accounts:', err.message);
              return resolve(0);
            }
            resolve(row ? row.count : 0);
          }
        );
      });
    }

    const [totalAll, totalActive, totalExpired] = await Promise.all([
      countAccounts('user_id = ?', [userId]),
      // Aktif = belum ada expire atau expire >= hari ini
      countAccounts(
        'user_id = ? AND (expires_at IS NULL OR expires_at >= ?)',
        [userId, todayStart]
      ),
      // Expired = expire < hari ini
      countAccounts(
        'user_id = ? AND expires_at IS NOT NULL AND expires_at < ?',
        [userId, todayStart]
      ),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalAll / MY_STATS_PAGE_SIZE));
    const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
    const offset = currentPage * MY_STATS_PAGE_SIZE;


    // ===== AKUN DI HALAMAN INI =====
    const recentAccounts = await new Promise((resolve) => {
      db.all(
        `SELECT a.username, a.type, a.server_id, a.created_at, a.expires_at,
                s.nama_server, s.domain
         FROM accounts a
         LEFT JOIN Server s ON a.server_id = s.id
         WHERE a.user_id = ?
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`,
        [userId, MY_STATS_PAGE_SIZE, offset],
        (err, rows) => {
          if (err) {
            logger.error('Gagal ambil riwayat accounts:', err.message);
            return resolve([]);
          }
          resolve(rows || []);
        }
      );
    });

    const typeLabel = (t) => {
      switch (t) {
        case 'ssh':          return 'ðŸ”‘ SSH';
        case 'vmess':        return 'ðŸ”· VMess';
        case 'vless':        return 'ðŸŸ¦ VLess';
        case 'trojan':       return 'ðŸ´ Trojan';
        case 'shadowsocks':  return 'ðŸ§¦ Shadowsocks';
        default:             return t || '-';
      }
    };

        const formatDateTime = (ts) => {
      if (!ts) return '-';
      return new Date(ts).toLocaleString('id-ID', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const formatExpireStatus = (expiresAt) => {
      if (!expiresAt) return 'Tanpa masa aktif';
      // Hanya tampilkan TANGGAL, tanpa jam, supaya tidak bikin bingung
      return new Date(expiresAt).toLocaleDateString('id-ID', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    };

        const lines = [];

    lines.push('<b>ðŸ“Š Riwayat Akun Kamu</b>');
    lines.push('<i>Catatan: Tanggal Expire adalah hari terakhir akun aktif. Setelah lewat tanggal itu, akun dianggap expired walaupun jam belum tertera di config.</i>\n');

    // Ringkasan akun
    lines.push('<code>Ringkasan Akun</code>');
    lines.push(`â€¢ Total dibuat   : <b>${totalAll}</b> akun`);
    lines.push(`â€¢ Aktif sekarang : <b>${totalActive}</b> akun`);
    lines.push(`â€¢ Sudah expired  : <b>${totalExpired}</b> akun\n`);

    lines.push(
      `<code>Riwayat Akun (halaman ${currentPage + 1} dari ${totalPages})</code>`
    );

    if (recentAccounts.length === 0) {
      lines.push('Belum ada akun yang tercatat di riwayat kamu.');
    } else {
      recentAccounts.forEach((row, idx) => {
        const dibuatText = formatDateTime(row.created_at);
        const expireText = formatExpireStatus(row.expires_at);

        const serverName =
          row.nama_server ||
          row.domain ||
          (row.server_id ? `Server #${row.server_id}` : '-');

        const username = row.username || '-';

        const nomor = offset + idx + 1;

        lines.push(
          `#${nomor} ${typeLabel(row.type)}\n` +
          `   User   : <b>${username}</b>\n` +
          `   Server : ${serverName}\n` +
          `   Dibuat : ${dibuatText}\n` +
          `   Expire : ${expireText}`
        );
      });
    }

    const text = lines.join('\n');

    // Inline keyboard untuk paging
    const navButtons = [];
    if (currentPage > 0) {
      navButtons.push({
        text: 'â¬…ï¸ Sebelumnya',
        callback_data: `my_stats:${currentPage - 1}`,
      });
    }
    if (currentPage < totalPages - 1) {
      navButtons.push({
        text: 'âž¡ï¸ Selanjutnya',
        callback_data: `my_stats:${currentPage + 1}`,
      });
    }

    const replyMarkup =
      navButtons.length > 0
        ? { inline_keyboard: [navButtons] }
        : undefined;

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    } catch (e) {
          await sendCleanMenu(ctx, text, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
    }
    } catch (err) {
    logger.error('âŒ Error di showMyStatsPage:', err);
    try {
      await sendCleanMenu(ctx, 'âŒ Terjadi kesalahan saat menampilkan riwayat.', {
        parse_mode: 'HTML',
      });
    } catch {}
  }
}


// Callback dari tombol utama (tanpa halaman) â†’ mulai dari halaman 0
bot.action('my_stats', async (ctx) => {
  return showMyStatsPage(ctx, 0);
});

// Callback dari tombol paging: my_stats:0, my_stats:1, dst
bot.action(/my_stats:(\d+)/, async (ctx) => {
  const page = parseInt(ctx.match[1], 10) || 0;
  return showMyStatsPage(ctx, page);
});

// ========= DETAIL AKUN â€“ SAAT SATU AKUN DIPILIH =========
bot.action(/accsel:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('âŒ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('âŒ ID akun tidak valid.');
  }

  db.get(
    `SELECT a.id, a.user_id, a.username, a.type, a.server_id, a.expires_at, s.nama_server
     FROM accounts a
     LEFT JOIN Server s ON a.server_id = s.id
     WHERE a.id = ?`,
    [accountId],
    (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil detail akun:', err.message);
        return ctx.reply('âŒ Terjadi kesalahan saat membaca detail akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('âŒ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

            const serverName =
        row.nama_server || (row.server_id ? `Server ${row.server_id}` : 'Server ?');

      let status = 'â³ Tidak diketahui';
      if (row.expires_at) {
        const daysLeft = getAccountDaysLeft(row.expires_at);

        if (daysLeft > 0) {
          status = `âœ… Aktif (~${daysLeft} hari lagi)`;
        } else if (daysLeft === 0) {
          status = 'âš ï¸ Aktif (habis HARI INI)';
        } else {
          status = 'âŒ Sudah expired';
        }
      }

      const detail =
        'ðŸ“„ <b>Detail Akun</b>\n\n' +
        `Tipe    : <b>${row.type}</b>\n` +
        `Username: <b>${row.username}</b>\n` +
        `Server  : ${serverName}\n` +
        `Status  : ${status}\n\n` +
        'Pilih aksi yang ingin kamu lakukan:';

      const keyboard = [
        [
          { text: 'â™»ï¸ Perpanjang Akun', callback_data: `accrenew:${row.id}` }
        ],
        [
          { text: 'âŒ Hapus Akun', callback_data: `accdel:${row.id}` }
        ],
        [
          { text: 'ðŸ—ï¸ Kunci Akun', callback_data: `acclock:${row.id}` },
          { text: 'ðŸ” Buka Kunci', callback_data: `accunlock:${row.id}` }
        ],
        [
          { text: 'ðŸ”™ Kembali ke daftar', callback_data: 'my_accounts' }
        ]
      ];

            return sendCleanMenu(ctx, detail, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  );
});
// ========= âŒ HAPUS AKUN DARI "AKUN SAYA" =========
bot.action(/accdel:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('âŒ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('âŒ ID akun tidak valid.');
  }

  db.get(
    'SELECT id, user_id, username, type, server_id FROM accounts WHERE id = ?',
    [accountId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil akun untuk hapus:', err.message);
        return ctx.reply('âŒ Terjadi kesalahan saat membaca data akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('âŒ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

      const delFunctions = {
        vmess: delvmess,
        vless: delvless,
        trojan: deltrojan,
        shadowsocks: delshadowsocks,
        ssh: delssh
      };

      const fn = delFunctions[row.type];
      if (!fn) {
        return ctx.reply('âŒ Tipe akun tidak dikenal, tidak bisa dihapus.');
      }

      try {
        const password = 'none', exp = 'none', iplimit = 'none';
        const msg = await fn(row.username, password, exp, iplimit, row.server_id);
        await recordAccountTransaction(userId, row.type);

        // Hapus dari tabel accounts agar tidak muncul di "Akun Saya" lagi
        db.run('DELETE FROM accounts WHERE id = ?', [accountId], (err2) => {
          if (err2) {
            logger.error('Kesalahan menghapus record dari tabel accounts:', err2.message);
          }
        });

        await ctx.reply(msg, { parse_mode: 'Markdown' });
        logger.info(`âœ… Akun ${row.type} (${row.username}) dihapus lewat Akun Saya oleh ${userId}`);
      } catch (e2) {
        logger.error('âŒ Gagal hapus akun dari menu Akun Saya:', e2.message);
        await ctx.reply('âŒ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
      }
    }
  );
});
// ========= ðŸ—ï¸ KUNCI AKUN DARI "AKUN SAYA" =========
bot.action(/acclock:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('âŒ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('âŒ ID akun tidak valid.');
  }

  db.get(
    'SELECT id, user_id, username, type, server_id FROM accounts WHERE id = ?',
    [accountId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil akun untuk lock:', err.message);
        return ctx.reply('âŒ Terjadi kesalahan saat membaca data akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('âŒ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

      const lockFunctions = {
        vmess: lockvmess,
        vless: lockvless,
        trojan: locktrojan,
        shadowsocks: lockshadowsocks,
        ssh: lockssh
      };

      const fn = lockFunctions[row.type];
      if (!fn) {
        return ctx.reply('âŒ Tipe akun tidak dikenal, tidak bisa dikunci.');
      }

      try {
        const password = 'none', exp = 'none', iplimit = 'none';
        const msg = await fn(row.username, password, exp, iplimit, row.server_id);
        await recordAccountTransaction(userId, row.type);

        await ctx.reply(msg, { parse_mode: 'Markdown' });
        logger.info(`âœ… Akun ${row.type} (${row.username}) dikunci lewat Akun Saya oleh ${userId}`);
      } catch (e2) {
        logger.error('âŒ Gagal lock akun dari menu Akun Saya:', e2.message);
        await ctx.reply('âŒ *Terjadi kesalahan saat mengunci akun.*', { parse_mode: 'Markdown' });
      }
    }
  );
});
// ========= ðŸ” BUKA KUNCI AKUN DARI "AKUN SAYA" =========
bot.action(/accunlock:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('âŒ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('âŒ ID akun tidak valid.');
  }

  db.get(
    'SELECT id, user_id, username, type, server_id FROM accounts WHERE id = ?',
    [accountId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil akun untuk unlock:', err.message);
        return ctx.reply('âŒ Terjadi kesalahan saat membaca data akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('âŒ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

      const unlockFunctions = {
        vmess: unlockvmess,
        vless: unlockvless,
        trojan: unlocktrojan,
        shadowsocks: unlockshadowsocks,
        ssh: unlockssh
      };

      const fn = unlockFunctions[row.type];
      if (!fn) {
        return ctx.reply('âŒ Tipe akun tidak dikenal, tidak bisa dibuka kuncinya.');
      }

      try {
        const password = 'none', exp = 'none', iplimit = 'none';
        const msg = await fn(row.username, password, exp, iplimit, row.server_id);
        await recordAccountTransaction(userId, row.type);

        await ctx.reply(msg, { parse_mode: 'Markdown' });
        logger.info(`âœ… Akun ${row.type} (${row.username}) di-unlock lewat Akun Saya oleh ${userId}`);
      } catch (e2) {
        logger.error('âŒ Gagal unlock akun dari menu Akun Saya:', e2.message);
        await ctx.reply('âŒ *Terjadi kesalahan saat membuka kunci akun.*', { parse_mode: 'Markdown' });
      }
    }
  );
});

// ========= â™»ï¸ PERPANJANG AKUN DARI "AKUN SAYA" =========
bot.action(/accrenew:(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) {
    return ctx.reply('âŒ Tidak bisa membaca data pengguna.');
  }

  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const accountId = parseInt(ctx.match[1], 10);
  if (!accountId) {
    return ctx.reply('âŒ ID akun tidak valid.');
  }

  db.get(
    `SELECT a.id, a.user_id, a.username, a.type, a.server_id, a.expires_at, s.nama_server
     FROM accounts a
     LEFT JOIN Server s ON a.server_id = s.id
     WHERE a.id = ?`,
    [accountId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil data akun untuk perpanjang:', err.message);
        return ctx.reply('âŒ Terjadi kesalahan saat membaca data akun.');
      }

      if (!row || row.user_id !== userId) {
        return ctx.reply('âŒ Akun ini tidak ditemukan atau bukan milik kamu.');
      }

      const serverName = row.nama_server || (row.server_id ? `Server ${row.server_id}` : 'Server ?');

      let status = 'â³ Tidak diketahui';
      if (row.expires_at) {
        const daysLeft = getAccountDaysLeft(row.expires_at);

        if (daysLeft > 0) {
          status = `âœ… Aktif (~${daysLeft} hari lagi)`;
        } else if (daysLeft === 0) {
          status = 'âš ï¸ Aktif (habis HARI INI)';
        } else {
          status = 'âŒ Sudah expired';
        }
      }

      // âœ… Set state langsung ke langkah "exp_renew_*"
      userState[chatId] = {
        action: 'renew',
        type: row.type,           // vmess / vless / trojan / shadowsocks / ssh
        username: row.username,
        serverId: row.server_id,
        password: 'none',         // renew biasanya tidak pakai password baru
        step: `exp_renew_${row.type}`
      };

      const infoText =
        'â™»ï¸ <b>PERPANJANG AKUN</b>\n\n' +
        `Tipe    : <b>${row.type}</b>\n` +
        `Username: <b>${row.username}</b>\n` +
        `Server  : ${serverName}\n` +
        `Status  : ${status}\n\n` +
        'Silakan kirim <b>masa aktif tambahan</b> dalam hari.\n' +
        'Contoh: <code>30</code>';

            await sendCleanMenu(ctx, infoText, {
        parse_mode: 'HTML'
      });

    }
  );
});

bot.action(/(del)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

  userState[ctx.chat.id] = {
    step: `username_${action}_${type}`,
    serverId, type, action
  };
  await ctx.reply('ðŸ‘¤ *Masukkan username yang ingin dihapus:*', { parse_mode: 'Markdown' });
});
bot.action(/(unlock)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

  userState[ctx.chat.id] = {
    step: `username_${action}_${type}`,
    serverId, type, action
  };
  await ctx.reply('ðŸ‘¤ *Masukkan username yang ingin dibuka:*', { parse_mode: 'Markdown' });
});
bot.action(/(lock)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const [action, type, serverId] = [ctx.match[1], ctx.match[2], ctx.match[3]];

  userState[ctx.chat.id] = {
    step: `username_${action}_${type}`,
    serverId, type, action
  };
  await ctx.reply('ðŸ‘¤ *Masukkan username yang ingin dikunci:*', { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
const text = (ctx.message.text || '').trim();   // <-- TAMBAHKAN BARIS INI
 // === TEST KIRIM KE GRUP DARI /tesgroub ===
  if (text === '/tesgroub') {
    try {
      await bot.telegram.sendMessage(
        GROUP_ID,
        '? Test kirim pesan ke grup dari bot.'
      );
      await ctx.reply('? Pesan test sudah dikirim ke grup.');
    } catch (e) {
      logger.error('Gagal kirim notif test ke grup:', e.message);
      await ctx.reply('? Gagal kirim ke grup, cek ID grup & izin bot.');
    }
    return; // jangan lanjut ke bawah
  }

      // ==== MODE PENGUMUMAN (MANUAL & TEMPLATE) DARI MENU ðŸ“¢ ====
  const fromId = ctx.from && ctx.from.id;
  if (fromId && adminIds.includes(fromId)) {
    const bState = broadcastSessions[fromId];

    // Kalau tidak ada sesi broadcast aktif â†’ lanjut ke logika lain
    if (!bState) {
      // lanjut ke bawah (state menu biasa)
    } else if (bState.step === 'wait_message') {
      // ----- MODE MANUAL: user kirim teks bebas -----
      if (text.startsWith('/')) {
        await ctx.reply(
          'â„¹ï¸ Pengumuman dibatalkan karena kamu mengirim perintah lain.\n' +
            'Kalau mau mulai lagi, buka menu admin lalu pilih "ðŸ“¢ Kirim Pengumuman".',
          { parse_mode: 'HTML' }
        );
        delete broadcastSessions[fromId];
        return;
      }

      bState.message = ctx.message.text;
      bState.step = 'confirm';

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') {
        targetLabel = 'semua reseller';
      } else if (bState.target === 'member') {
        targetLabel = 'member (bukan reseller & bukan admin)';
      }

      await ctx.reply(
        `ðŸ“„ <b>Preview Pengumuman</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          bState.message +
          '\n\nKirim pengumuman ini?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'âœ… Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: 'âŒ Batal', callback_data: 'broadcast_cancel' },
              ],
            ],
          },
        }
      );

      return;
    } else if (bState.step === 'tm_ask_layanan') {
      // ----- TEMPLATE MAINTENANCE: langkah 1 (nama layanan) -----
      bState.layanan = ctx.message.text;
      bState.step = 'tm_ask_waktu';

      await ctx.reply(
        '2ï¸âƒ£ Masukkan waktu maintenance (hari, tanggal, dan jam mulai).\n' +
          'Contoh:\n' +
          'â€¢ Sabtu, 22-11-2025, jam 21.00 WIT\n' +
          'â€¢ Malam ini jam 23.00 WIT',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'tm_ask_waktu') {
      // ----- TEMPLATE MAINTENANCE: langkah 2 (waktu) -----
      bState.waktu = ctx.message.text;
      bState.step = 'tm_ask_durasi';

      await ctx.reply(
        '3ï¸âƒ£ Masukkan perkiraan durasi maintenance.\n' +
          'Contoh:\n' +
          'â€¢ 30 menit\n' +
          'â€¢ 1 jam\n' +
          'â€¢ 2 jam',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'tm_ask_durasi') {
      // ----- TEMPLATE MAINTENANCE: langkah 3 (durasi) -----
      bState.durasi = ctx.message.text;
      bState.step = 'tm_ask_catatan';

      await ctx.reply(
        '4ï¸âƒ£ Masukkan catatan tambahan (opsional).\n' +
          'Jika tidak ada, kirim tanda <code>-</code> saja.',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'tm_ask_catatan') {
      // ----- TEMPLATE MAINTENANCE: langkah 4 (catatan + susun pesan) -----
      const catatanRaw = ctx.message.text;
      bState.catatan = catatanRaw === '-' ? '' : catatanRaw;

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') {
        targetLabel = 'semua reseller';
      } else if (bState.target === 'member') {
        targetLabel = 'member (bukan reseller & bukan admin)';
      }

      // Susun pesan maintenance otomatis
      const msgLines = [];

      msgLines.push('ðŸ”§ <b>PENGUMUMAN MAINTENANCE SERVER VPN</b>');
      msgLines.push('');
      msgLines.push('Kepada pengguna VPN,');
      msgLines.push(
        `Akan dilakukan maintenance pada layanan <b>${bState.layanan}</b>.`
      );
      msgLines.push('');
      msgLines.push(`ðŸ“… Waktu mulai : <b>${bState.waktu}</b>`);
      msgLines.push(`â± Durasi      : <b>${bState.durasi}</b>`);
      if (bState.catatan) {
        msgLines.push('');
        msgLines.push(`ðŸ“ Catatan: ${bState.catatan}`);
      }
      msgLines.push('');
      msgLines.push(
        'Selama proses maintenance, koneksi mungkin tidak stabil atau tidak dapat digunakan.'
      );
      msgLines.push('Terima kasih atas pengertian dan kerjasamanya.');

      const finalMessage = msgLines.join('\n');

      bState.message = finalMessage;
      bState.step = 'confirm';

      await ctx.reply(
        `ðŸ“„ <b>Preview Pengumuman Maintenance</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          finalMessage +
          '\n\nKirim pengumuman ini?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'âœ… Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: 'âŒ Batal', callback_data: 'broadcast_cancel' },
              ],
            ],
          },
        }
      );

      return;
    } else if (bState.step === 'promo_ask_paket') {
      // ----- TEMPLATE PROMO: langkah 1 (nama paket/promo) -----
      bState.paket = ctx.message.text;
      bState.step = 'promo_ask_detail';

      await ctx.reply(
        '2ï¸âƒ£ Masukkan detail promo/diskon singkat.\n' +
          'Contoh:\n' +
          'â€¢ Diskon 30%, dari 30K jadi 20K\n' +
          'â€¢ Beli 1 bulan gratis 7 hari\n' +
          'â€¢ Harga spesial hanya hari ini',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'promo_ask_detail') {
      // ----- TEMPLATE PROMO: langkah 2 (detail promo) -----
      bState.detail = ctx.message.text;
      bState.step = 'promo_ask_berlaku';

      await ctx.reply(
        '3ï¸âƒ£ Masukkan masa berlaku promo.\n' +
          'Contoh:\n' +
          'â€¢ Sampai 30-11-2025\n' +
          'â€¢ Hanya sampai akhir bulan ini\n' +
          'â€¢ Berlaku 3 hari ke depan',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'promo_ask_berlaku') {
      // ----- TEMPLATE PROMO: langkah 3 (berlaku sampai) -----
      bState.berlaku = ctx.message.text;
      bState.step = 'promo_ask_catatan';

      await ctx.reply(
        '4ï¸âƒ£ Masukkan catatan tambahan (opsional).\n' +
          'Jika tidak ada, kirim tanda <code>-</code> saja.',
        { parse_mode: 'HTML' }
      );
      return;
    } else if (bState.step === 'promo_ask_catatan') {
      // ----- TEMPLATE PROMO: langkah 4 (catatan + susun pesan) -----
      const catatanRaw = ctx.message.text;
      bState.catatan = catatanRaw === '-' ? '' : catatanRaw;

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') {
        targetLabel = 'semua reseller';
      } else if (bState.target === 'member') {
        targetLabel = 'member (bukan reseller & bukan admin)';
      }

      const lines = [];
      lines.push('ðŸŽ <b>PROMO / DISKON LAYANAN VPN</b>');
      lines.push('');
      lines.push(`Sekarang tersedia promo untuk <b>${bState.paket}</b>.`);
      lines.push(bState.detail);
      lines.push('');
      lines.push(`ðŸ“… Berlaku sampai: <b>${bState.berlaku}</b>`);
      if (bState.catatan) {
        lines.push('');
        lines.push(`ðŸ“ Catatan: ${bState.catatan}`);
      }
      lines.push('');
      lines.push('Minat? Silakan hubungi admin atau beli langsung melalui bot.');

      const finalMessage = lines.join('\n');

      bState.message = finalMessage;
      bState.step = 'confirm';

      await ctx.reply(
        `ðŸ“„ <b>Preview Pengumuman Promo/Diskon</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          finalMessage +
          '\n\nKirim pengumuman ini?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'âœ… Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: 'âŒ Batal', callback_data: 'broadcast_cancel' },
              ],
            ],
          },
        }
      );

      return;
    }
  }

  const state = userState[ctx.chat.id];

// ?? Tambahan penting:
  // Kalau userState belum ada, jangan lanjut supaya
  // tidak error "Cannot read properties of undefined (reading 'step')"
  if (!state || !state.step) {
    return;
  }
  
    
    const lowerText = text.toLowerCase();

processQrisTopupInvoice = async function processQrisTopupInvoice(ctx, baseAmount, forcedUniqueSuffix = null) {
  let loadingMsg = null;

  try {
    loadingMsg = await ctx.reply('â³ Sedang membuat QRIS...', {
      reply_markup: { remove_keyboard: true }
    });
  } catch (_) {}

  const cleanupLoadingMessage = async () => {
    if (!loadingMsg?.message_id) return;
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    } catch (_) {}
    loadingMsg = null;
  };

  try {
    const userId = ctx.from.id;
    const now = Date.now();
    const timeoutMin = QRIS_PAYMENT_TIMEOUT_MIN || 5;
    const expireThreshold = now - timeoutMin * 60 * 1000;

    const pendingRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM qris_payments
         WHERE user_id = ? AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (pendingRow) {
      if (pendingRow.created_at >= expireThreshold) {
        await ctx.reply(
          'âš ï¸ Kamu masih punya 1 topup QRIS yang <b>belum dibayar</b>.\n\n' +
            `ðŸ§¾ Invoice : <code>${pendingRow.invoice_id}</code>\n` +
            `ðŸ’³ Nominal : <b>Rp${pendingRow.amount.toLocaleString('id-ID')}</b>\n\n` +
            `Silakan selesaikan pembayaran QRIS tersebut dulu, atau tunggu sekitar <b>${timeoutMin} menit</b> sampai kadaluarsa sebelum membuat topup baru.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      db.run(
        `UPDATE qris_payments
         SET status = 'expired'
         WHERE id = ? AND status = 'pending'`,
        [pendingRow.id],
        (err) => {
          if (err) {
            logger.error(
              'âš ï¸ Gagal meng-update qris_payments ke expired dari handler nominal:',
              err
            );
          }
        }
      );
    }
  } catch (e) {
    logger.error('âš ï¸ Error saat cek invoice pending QRIS:', e);
  }

  try {
    const userId = ctx.from.id;

    const invoice = await createQrisInvoice(
      baseAmount,
      `Topup saldo user ${userId} (base=${baseAmount})`,
      forcedUniqueSuffix
    );

    async function markQrisStatus(id, status, paidAt = null) {
      return await new Promise((resolve) => {
        if (paidAt) {
          db.run(`UPDATE qris_payments SET status=?, paid_at=? WHERE id=?`, [status, paidAt, id], () => resolve());
        } else {
          db.run(`UPDATE qris_payments SET status=? WHERE id=?`, [status, id], () => resolve());
        }
      });
    }

    async function pollQrisPayments() {
      if (global.__pollQrisRunning) return;
      global.__pollQrisRunning = true;
      try {
        const now = Date.now();
        const timeoutMin = Number(QRIS_PAYMENT_TIMEOUT_MIN || 10);
        const rows = await new Promise((resolve, reject) => {
          const cutoff = now - ((timeoutMin + 15) * 60 * 1000);
          db.all(
            `SELECT id, user_id, invoice_id, amount, base_amount, unique_suffix, created_at
             FROM qris_payments
             WHERE status='pending' AND created_at >= ?
             ORDER BY created_at ASC
             LIMIT 50`,
            [cutoff],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
          );
        });

        if (!rows.length) return;

        logger.info(`ðŸ”Ž Poll QRIS GoPay: cek ${rows.length} transaksi pending...`);
        const transactions = await fetchGopayTransactions();

        for (const row of rows) {
          const expiresAt = Number(row.created_at) + (timeoutMin * 60 * 1000);
          if (now > expiresAt) {
            await markQrisStatus(row.id, 'expired');
            try {
              await bot.telegram.sendMessage(
                row.user_id,
                `â° <b>QRIS EXPIRED</b>\n` +
                  `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                  `QR sudah tidak berlaku (melewati batas waktu).\n` +
                  `Silakan buat QRIS baru untuk topup.\n` +
                  `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                  `Invoice: <code>${row.invoice_id}</code>`,
                {
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: 'ðŸ’³ Buat QRIS Baru', callback_data: 'topupqris_btn' }],
                      [{ text: 'ðŸ  Menu Utama', callback_data: 'send_main_menu' }],
                    ],
                  },
                }
              );
            } catch (_) {}
            logger.info(`âŒ› QRIS expired: invoice=${row.invoice_id} user=${row.user_id}`);
            continue;
          }

          const matchedTx = findMatchingSettlementTransaction(transactions, Number(row.amount), {
            createdAt: row.created_at,
            timeWindowMs: timeoutMin * 60 * 1000,
          });
          if (!matchedTx) continue;

          const finalRes = await finalizeQrisPayment({
            paymentRow: row,
            matchedTx,
            transactionType: 'qris_auto_topup',
            transactionRef: `qris_auto_${row.invoice_id}`,
          });
          if (!finalRes.applied) continue;

          const addSaldo = Number(row.base_amount);
          try {
            const { bonus, percent } = calculateTopupBonus(addSaldo);
            if (bonus > 0) {
              try {
                await applyQrisTopupBonus(row.user_id, row.invoice_id, bonus);
              } catch (e) {
                logger.error(`âš ï¸ Gagal mencatat bonus QRIS: ${e?.message || e}`);
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
            logger.error(`âš ï¸ Gagal kirim notif topup sukses: ${e?.message || e}`);
          }

          logger.info(`âœ… QRIS PAID: invoice=${row.invoice_id} user=${row.user_id} billed=${row.amount} add=${addSaldo} tx=${finalRes.providerTxId || '-'} `);
        }
      } catch (e) {
        logger.error(`âŒ pollQrisPayments fatal: ${e?.message || e}`);
      } finally {
        global.__pollQrisRunning = false;
      }
    }

    global.__qrisPollStarted = global.__qrisPollStarted || false;

    const IS_PRIMARY_INSTANCE = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    if (IS_PRIMARY_INSTANCE && !global.__qrisPollStarted) {
      global.__qrisPollStarted = true;
      setInterval(pollQrisPayments, Number(QRIS_CHECK_INTERVAL_MS || 15000));
      logger.info(`âœ… QRIS polling aktif. Interval=${Number(QRIS_CHECK_INTERVAL_MS || 15000)}ms`);
    } else if (!IS_PRIMARY_INSTANCE) {
      logger.info('â„¹ï¸ QRIS polling nonaktif di instance non-primary (PM2 cluster).');
    }

    const billedAmount = invoice.amount;
    const randomSuffix = invoice.unique_suffix;
    const now = Date.now();

    const providerPayloadJson = (() => {
      try { return JSON.stringify(invoice.raw || {}); } catch (_) { return null; }
    })();

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO qris_payments (
           user_id,
           invoice_id,
           amount,
           base_amount,
           unique_suffix,
           status,
           created_at,
           provider_tx_id,
           provider_tx_time,
           provider_payment_type,
           provider_issuer,
           provider_status,
           provider_payload_json
         )
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          invoice.invoice_id,
          invoice.amount,
          invoice.base_amount,
          invoice.unique_suffix,
          now,
          invoice.provider_transaction_id || null,
          invoice.provider_transaction_time || null,
          invoice.provider_payment_type || 'qris',
          invoice.provider_issuer || 'gopay',
          invoice.provider_status || 'pending',
          providerPayloadJson,
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    let caption =
      `âœ… <b>QRIS TOPUP DIBUAT</b>\n` +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
      `ðŸ§¾ <b>Invoice</b> : <code>${invoice.invoice_id}</code>\n` +
      `ðŸ’³ <b>Nominal</b> : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
      (randomSuffix > 0
        ? `ðŸŽ² <b>Kode unik</b> : <b>${randomSuffix.toString().padStart(3, '0')}</b>\n` +
          `ðŸ’° <b>Total bayar</b> : <b>Rp${billedAmount.toLocaleString('id-ID')}</b>\n`
        : `ðŸ’° <b>Total bayar</b> : <b>Rp${billedAmount.toLocaleString('id-ID')}</b>\n`) +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
      `ðŸ“Œ Scan QR lalu bayar sesuai <b>TOTAL BAYAR</b>\n` +
      `â° <b>Berlaku ${QRIS_PAYMENT_TIMEOUT_MIN} menit</b>\n` +
      `Saldo masuk otomatis setelah terdeteksi.`;

    const payKb = {
      inline_keyboard: [
        [{ text: 'ðŸ”Ž Cek Status', callback_data: `qris_status:${invoice.invoice_id}` }],
        [{ text: 'ðŸ  Menu Utama', callback_data: 'send_main_menu' }],
      ],
    };

    await cleanupLoadingMessage();

    if (invoice.qris_image_path) {
      await ctx.replyWithPhoto(
        { source: invoice.qris_image_path },
        { caption, parse_mode: 'HTML', reply_markup: payKb }
      );
    } else if (invoice.qris_image_url) {
      await ctx.replyWithPhoto(
        { url: invoice.qris_image_url },
        { caption, parse_mode: 'HTML', reply_markup: payKb }
      );
    } else if (invoice.payment_link) {
      await ctx.reply(caption + `\n\nðŸ”— Link Pembayaran:\n${invoice.payment_link}`, {
        parse_mode: 'HTML',
        reply_markup: payKb,
      });
    } else if (invoice.qris_text) {
      await ctx.reply(
        caption +
          `\n\nKode QRIS:\n<code>${invoice.qris_text}</code>\n\n` +
          'Silakan buat QR dari text di atas jika diperlukan.',
        { parse_mode: 'HTML', reply_markup: payKb }
      );
    } else {
      await ctx.reply('âš ï¸ Gagal membuat QRIS. Coba lagi nanti.', {
        parse_mode: 'HTML',
        reply_markup: payKb,
      });
    }
  } catch (e) {
    logger.error('âŒ Error saat proses topup QRIS dari input nominal:', e);
    await cleanupLoadingMessage();
    await ctx.reply(
      'âŒ Terjadi kesalahan saat membuat QRIS. Coba lagi beberapa saat.',
      { parse_mode: 'HTML' }
    );
  }
};

  // ========================================================================
  // SECTION: PAYMENT - STATE INPUT NOMINAL (QRIS AUTO TOPUP)
  // - Menangani step 'qris_topup_nominal'
  // - Validasi nominal, cek invoice pending, generate 3 digit acak,
  //   panggil createQrisInvoice, insert ke qris_payments
  // ========================================================================
  // === INPUT NOMINAL TOPUP QRIS OTOMATIS (DENGAN 3 DIGIT ACAK) ===
  if (state.step === 'qris_topup_nominal') {
    const chatId = ctx.chat.id;
    const text = (ctx.message?.text || '').trim().toLowerCase();

    if (text === 'batal' || text === 'âŒ batal') {
      delete userState[chatId];
      await ctx.reply('âœ… Topup dibatalkan.', {
        reply_markup: { remove_keyboard: true }
      });
      return;
    }

    const angkaBersih = text.replace(/[^\d]/g, '');
    const baseAmount = Number(angkaBersih);

    if (!baseAmount || baseAmount < QRIS_AUTO_TOPUP_MIN || baseAmount > QRIS_AUTO_TOPUP_MAX) {
      await ctx.reply(
        `âš ï¸ Nominal tidak valid.\n\n` +
          `Minimal: <b>Rp${QRIS_AUTO_TOPUP_MIN.toLocaleString('id-ID')}</b>\n` +
          `Maksimal: <b>Rp${QRIS_AUTO_TOPUP_MAX.toLocaleString('id-ID')}</b>\n\n` +
          `Ketik ulang nominal, contoh: <code>25000</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const previewUniqueSuffix = generateUniqueSuffix(50, 200);
    const payableAmount = baseAmount + previewUniqueSuffix;
    userState[chatId] = {
      step: 'qris_topup_confirm',
      baseAmount,
      previewUniqueSuffix,
      payableAmount,
    };

    const { bonus, percent } = calculateTopupBonus(baseAmount);
    const estimatedSaldo = baseAmount + bonus;
    const timeoutMin = Number(QRIS_PAYMENT_TIMEOUT_MIN || 10);

    const confirmText =
      'ðŸ§¾ <b>Konfirmasi Topup QRIS</b>\n\n' +
      `ðŸ’³ Nominal topup: <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
      `ðŸ’¸ Jumlah yang harus dibayar: <b>Rp${payableAmount.toLocaleString('id-ID')}</b>\n` +
      `ðŸ”– Kode unik QRIS: <b>Rp${previewUniqueSuffix.toLocaleString('id-ID')}</b>\n` +
      (bonus > 0
        ? `ðŸŽ Bonus topup: <b>${percent}%</b> ( +Rp${bonus.toLocaleString('id-ID')} )\n`
        : 'ðŸŽ Bonus topup: <b>Tidak ada</b>\n') +
      `ðŸ’° Estimasi saldo masuk: <b>Rp${estimatedSaldo.toLocaleString('id-ID')}</b>\n` +
      `â³ Masa berlaku QR: <b>${timeoutMin} menit</b>\n\n` +
      'ðŸ“Œ Tekan <b>âœ… Lanjut Topup</b> untuk membuat invoice QRIS dengan nominal di atas.\n' +
      'ðŸ“Œ Tekan <b>âŒ Batal</b> jika ingin membatalkan topup.\n\n' +
      'Pastikan nominal dan jumlah pembayaran sudah benar sebelum melanjutkan.';

    await ctx.reply(confirmText, {
      parse_mode: 'HTML',
      reply_markup: {
        remove_keyboard: true,
        inline_keyboard: [
          [{ text: 'âœ… Lanjut Topup', callback_data: 'qris_topup_confirm_yes' }],
          [{ text: 'âŒ Batal', callback_data: 'qris_topup_confirm_cancel' }],
        ],
      },
    });

    return;
  }
  // ===== END SECTION: PAYMENT - STATE INPUT NOMINAL (QRIS AUTO TOPUP) ======


  // === EDIT NAMA SERVER (via ketikan biasa) ===
  if (state.step === 'edit_nama') {
  // Bisa batal pakai kata "batal"
  if (lowerText === 'batal' || lowerText === '/batal') {
    delete userState[ctx.chat.id];
    await ctx.reply('âŒ Edit nama server dibatalkan.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const newName = text.trim();

  if (!newName) {
    await ctx.reply('âš ï¸ Nama server tidak boleh kosong. Silakan ketik lagi.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  // Boleh kamu sesuaikan panjang maksimalnya
  if (newName.length > 50) {
    await ctx.reply('âš ï¸ Nama server terlalu panjang. Maksimal 50 karakter.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const serverId = state.serverId;

  db.run(
    'UPDATE Server SET nama_server = ? WHERE id = ?',
    [newName, serverId],
    function (err) {
      if (err) {
        logger.error('âš ï¸ Kesalahan saat mengedit nama server:', err.message);
        ctx.reply('âš ï¸ Terjadi kesalahan saat mengupdate nama server.', {
          parse_mode: 'Markdown',
        });
        return;
      }

      if (this.changes === 0) {
        ctx.reply('âš ï¸ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
        return;
      }

      ctx.reply(
        `âœ… Nama berhasil diubah:\n*${newName}*`,
      { parse_mode: 'Markdown' }
      );
    }
  );
 
  delete userState[ctx.chat.id];
  return; // penting: jangan lanjut ke logika state lain
}
  // === EDIT DOMAIN SERVER (via ketikan biasa) ===
  if (state.step === 'edit_domain') {
    // Bisa batal pakai kata "batal"
    if (lowerText === 'batal' || lowerText === '/batal') {
      delete userState[ctx.chat.id];
      await ctx.reply('âŒ Edit domain server dibatalkan.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const newDomain = text.trim();

    if (!newDomain) {
      await ctx.reply('âš ï¸ Domain server tidak boleh kosong. Silakan ketik lagi.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    // Validasi sederhana: huruf, angka, titik, dash, tanpa spasi
    if (!/^[a-zA-Z0-9.-]+$/.test(newDomain)) {
      await ctx.reply(
        'âš ï¸ Format domain tidak valid.\n' +
          'Hanya boleh huruf, angka, titik, dan strip.\n' +
          'Contoh: `sg1.serverku.com`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (newDomain.length > 100) {
      await ctx.reply('âš ï¸ Domain terlalu panjang. Maksimal 100 karakter.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const serverId = state.serverId;
    const oldDomain = state.oldDomain || '-';

    db.run(
      'UPDATE Server SET domain = ? WHERE id = ?',
      [newDomain, serverId],
      function (err) {
        if (err) {
          logger.error('âš ï¸ Kesalahan saat mengedit domain server:', err.message);
          ctx.reply('âš ï¸ Terjadi kesalahan saat mengupdate domain server.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        if (this.changes === 0) {
          ctx.reply('âš ï¸ Server tidak ditemukan.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        ctx.reply(
          `âœ… Domain server berhasil diubah:\n` +
            `â€¢ Sebelumnya: \`${oldDomain}\`\n` +
            `â€¢ Menjadi   : \`${newDomain}\``,
          { parse_mode: 'Markdown' }
        );
      }
    );

    // Hapus state setelah berhasil / diproses
    delete userState[ctx.chat.id];
    return; // penting: jangan lanjut ke logika state lain
  }
  // === EDIT AUTH SERVER (via ketikan biasa) ===
  if (state.step === 'edit_auth') {
    // Bisa batal pakai kata "batal"
    if (lowerText === 'batal' || lowerText === '/batal') {
      delete userState[ctx.chat.id];
      await ctx.reply('âŒ Edit auth server dibatalkan.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const newAuth = text.trim();

    if (!newAuth) {
      await ctx.reply('âš ï¸ AUTH server tidak boleh kosong. Silakan ketik lagi.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    if (newAuth.length > 255) {
      await ctx.reply('âš ï¸ AUTH terlalu panjang. Maksimal 255 karakter.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const serverId = state.serverId;
    const oldAuth = state.oldAuth || '-';
    const domain = state.domain || '-';
    const nama = state.nama || '-';

    db.run(
      'UPDATE Server SET auth = ? WHERE id = ?',
      [newAuth, serverId],
      function (err) {
        if (err) {
          logger.error('âš ï¸ Kesalahan saat mengedit auth server:', err.message);
          ctx.reply('âš ï¸ Terjadi kesalahan saat mengupdate auth server.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        if (this.changes === 0) {
          ctx.reply('âš ï¸ Server tidak ditemukan.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        // Biar nggak tampil full AUTH di chat, kita mask
        let maskedOld = oldAuth;
        if (maskedOld.length > 8) {
          maskedOld = maskedOld.slice(0, 4) + '...' + maskedOld.slice(-4);
        }
        let maskedNew = newAuth;
        if (maskedNew.length > 8) {
          maskedNew = maskedNew.slice(0, 4) + '...' + maskedNew.slice(-4);
        }

        ctx.reply(
          'âœ… Auth server berhasil diubah:\n' +
            `â€¢ Server : \`${nama}\`\n` +
            `â€¢ Domain : \`${domain}\`\n` +
            `â€¢ Sebelumnya: \`${maskedOld}\`\n` +
            `â€¢ Menjadi   : \`${maskedNew}\``,
          { parse_mode: 'Markdown' }
        );
      }
    );

    // Hapus state setelah diproses
    delete userState[ctx.chat.id];
    return;
  }

  // === BATALKAN PROSES TAMBAH SERVER ===
  if (
    state.step &&
    state.step.startsWith('addserver') &&   // semua step: addserver, addserver_auth, dst
    (lowerText === 'batal' || lowerText === '/batal')
  ) {
    delete userState[ctx.chat.id];
    await ctx.reply('âŒ Proses tambah server dibatalkan.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  // === MODE TANDAI USER: INPUT ID USER ===
  if (state.step === 'flag_user_wait_id') {
    // Bisa batal
    if (lowerText === 'batal' || lowerText === '/batal') {
      delete userState[ctx.chat.id];
      await ctx.reply('âŒ Mode tandai user dibatalkan.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const targetId = text.trim();

    if (!/^\d+$/.test(targetId)) {
      await ctx.reply(
        'âš ï¸ ID Telegram harus berupa angka.\n' +
          'Silakan kirim ulang ID user yang ingin diatur statusnya, atau ketik *batal*.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    db.get(
      'SELECT user_id, saldo, flag_status, flag_note FROM users WHERE user_id = ?',
      [targetId],
      async (err, row) => {
        if (err) {
          logger.error('âŒ Gagal mengambil data user untuk flag:', err.message);
          await ctx.reply('âŒ Terjadi kesalahan saat mengambil data user.');
          return;
        }

        if (!row) {
          await ctx.reply(
            `âš ï¸ User dengan ID ${targetId} belum terdaftar di database.\n` +
              'Kirim ID lain atau ketik *batal* untuk membatalkan.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        const saldoText = Number(row.saldo || 0).toLocaleString('id-ID');
        const rawFlag = (row.flag_status || 'NORMAL').toString().toUpperCase();
        let flagLabel = 'âœ… NORMAL';
        if (rawFlag === 'WATCHLIST') flagLabel = 'âš ï¸ WATCHLIST';
        else if (rawFlag === 'NAKAL') flagLabel = 'ðŸš« NAKAL';

        const noteText =
          row.flag_note && row.flag_note.trim()
            ? `\nðŸ“ Catatan saat ini: ${row.flag_note.trim()}`
            : '';

        const keyboard = {
          inline_keyboard: [
            [
              {
                text: 'âœ… NORMAL',
                callback_data: `flag_user_set_NORMAL_${targetId}`,
              },
              {
                text: 'âš ï¸ WATCHLIST',
                callback_data: `flag_user_set_WATCHLIST_${targetId}`,
              },
              {
                text: 'ðŸš« NAKAL',
                callback_data: `flag_user_set_NAKAL_${targetId}`,
              },
            ],
          ],
        };

        await ctx.reply(
          `ðŸ‘¤ *Data user:*\n` +
            `â€¢ ID     : \`${targetId}\`\n` +
            `â€¢ Saldo  : \`Rp${saldoText}\`\n` +
            `â€¢ Status : ${flagLabel}${noteText}\n\n` +
            `Silakan pilih status baru untuk user ini:`,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );

        // Simpan state berikutnya (opsional, just in case)
        userState[ctx.chat.id] = {
          step: 'flag_user_choose',
          targetUserId: targetId,
        };
      }
    );

    return;
  }

//////
  if (state.step === 'cek_saldo_userid') {
    const targetId = ctx.message.text.trim();
    db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err, row) => {
      if (err) {
        logger.error('âŒ Gagal mengambil saldo:', err.message);
        return ctx.reply('âŒ Terjadi kesalahan saat mengambil data saldo.');
      }

      if (!row) {
        return ctx.reply(`âš ï¸ User dengan ID ${targetId} belum terdaftar di database.`);
      }

      ctx.reply(`ðŸ’° Saldo user ${targetId}: Rp${row.saldo.toLocaleString()}`);
      logger.info(`Admin ${ctx.from.id} mengecek saldo user ${targetId}: Rp${row.saldo}`);
      delete userState[ctx.from.id];
    });
  } else if (state.step === 'riwayat_saldo_userid') {
    const targetId = ctx.message.text.trim();

    // 1) Ambil saldo sekarang
    db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err, userRow) => {
      if (err) {
        logger.error('âŒ Gagal mengambil saldo (riwayat):', err.message);
        return ctx.reply('âŒ Terjadi kesalahan saat mengambil data saldo.');
      }

      if (!userRow) {
        return ctx.reply(`âš ï¸ User dengan ID ${targetId} belum terdaftar di database.`);
      }

      const currentSaldo = Number(userRow.saldo || 0);

    // 2) Ambil max 20 transaksi terakhir dari tabel transactions
    //    HANYA yang punya amount (transaksi saldo beneran)
    db.all(
      'SELECT amount, type, reference_id, timestamp FROM transactions WHERE user_id = ? AND amount IS NOT NULL ORDER BY timestamp DESC LIMIT 20',
      [targetId],
      (err2, rows) => {
          if (err2) {
            logger.error('âŒ Gagal mengambil riwayat transaksi saldo:', err2.message);
            return ctx.reply('âŒ Terjadi kesalahan saat mengambil riwayat saldo.');
          }

          if (!rows || rows.length === 0) {
            delete userState[ctx.from.id];
            return ctx.reply(
              `â„¹ï¸ Belum ada riwayat transaksi saldo untuk user ${targetId}.\n` +
              `Biasanya riwayat muncul dari deposit otomatis (QRIS) dan log transaksi lain.`
            );
          }

          const lines = [];
          lines.push('<b>ðŸ“œ RIWAYAT SALDO USER</b>');
          lines.push('');
          lines.push(`User ID: <code>${targetId}</code>`);
          lines.push(`Saldo sekarang: <b>Rp${currentSaldo.toLocaleString('id-ID')}</b>`);
          lines.push('');
          lines.push('<code>Max 20 transaksi terakhir</code>');

          rows.forEach((tr, idx) => {
            // Waktu
            let timeText = '-';
            if (tr.timestamp) {
              try {
                timeText = new Date(tr.timestamp).toLocaleString('id-ID', {
                  timeZone: TIME_ZONE,
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                });
              } catch (e) {
                timeText = '-';
              }
            }

            // Jenis transaksi
            const rawType = tr.type || '-';
const lowerType = rawType.toLowerCase();
let jenisText = rawType;

if (lowerType.includes('deposit')) {
  jenisText = 'TopUp (deposit otomatis)';
} else if (lowerType.includes('manual_addsaldo')) {
  jenisText = 'TopUp (manual admin)';
} else if (lowerType.includes('manual_minsaldo')) {
  jenisText = 'Pengurangan saldo (manual admin)';
} else if (lowerType.includes('buy_create')) {
  jenisText = 'Pembelian akun baru';
} else if (lowerType.includes('buy_renew')) {
  jenisText = 'Perpanjangan akun';
}

            // Jumlah (boleh null)
            let amountText = '-';
            if (typeof tr.amount === 'number' && !isNaN(tr.amount)) {
              const sign = tr.amount >= 0 ? '+' : '-';
              amountText = `${sign}Rp${Math.abs(tr.amount).toLocaleString('id-ID')}`;
            }

            const refId = tr.reference_id ? tr.reference_id : '';

            let block =
              `${idx + 1}) ${timeText}\n` +
              `   Jenis  : ${jenisText}\n`;

            if (amountText !== '-') {
              block += `   Jumlah : ${amountText}\n`;
            }

            if (refId) {
              block += `   Ref    : <code>${refId}</code>`;
            }

            lines.push(block);
          });

          const msg = lines.join('\n');
          ctx.reply(msg, { parse_mode: 'HTML' });

          delete userState[ctx.from.id];
        }
      );
    });
  }
///////
    if (state.step.startsWith('username_trial_')) {
		
// Hapus pesan konfirmasi user (biar chat tetap bersih)
  try { await ctx.deleteMessage().catch(() => {}); } catch (e) {}
  
  // Teks yang dikirim user hanya sebagai KONFIRMASI,
  // tidak dipakai sebagai username di server
  const userInput = text; // kalau mau, bisa dipakai untuk log
  const username = `trial${ctx.from.id}`; // username dummy, server akan buat username asli sendiri

  // Tidak perlu validasi format username, karena tidak dipakai oleh server

  const resselDbPath = './ressel.db';
  const idUser = ctx.from.id.toString().trim();
  // lanjut kode lama kamu di bawah ini...


// Baca file reseller
fs.readFile(resselDbPath, 'utf8', async (err, data) => {
  if (err) {
    logger.error('âŒ Gagal membaca file ressel.db:', err.message);
    return ctx.reply('âŒ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
  }

  const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);
  const isRessel = resselList.includes(idUser);

              // Cek jika bukan reseller, apakah sudah melewati batas trial harian
            // Cek jika BUKAN reseller
      if (!isRessel) {
        const cfg = await getTrialConfig();

        const maxPerDay = (cfg && Number.isInteger(cfg.maxPerDay) && cfg.maxPerDay > 0)
          ? cfg.maxPerDay
          : 1;

        const minBalance = (cfg && Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial > 0)
          ? cfg.minBalanceForTrial
          : 0;

        // ðŸ”¹ Kalau ada minimal saldo â†’ cek saldo user dulu
        if (minBalance > 0) {
          const saldoUser = await getUserBalance(ctx.from.id);
          if (saldoUser < minBalance) {
            return ctx.reply(
              'âŒ *Kamu belum memenuhi syarat saldo untuk memakai trial.*\n\n' +
              `â€¢ Minimal saldo untuk trial saat ini: *Rp${minBalance}*\n` +
              `â€¢ Saldo kamu saat ini              : *Rp${saldoUser}*\n\n` +
              'Silakan topup saldo terlebih dahulu lewat menu *ðŸ’° TopUp Saldo Otomatis / Manual via (QRIS)*,\n' +
              'lalu coba lagi fitur trial-nya.',
              { parse_mode: 'Markdown' }
            );
          }
        }

      // ðŸ”¹ Jika user WATCHLIST â†’ batas trial lebih ketat
      try {
        const flagStatus = await getUserFlagStatus(ctx.from.id);

        if (flagStatus === 'WATCHLIST') {
          // Contoh aturan: WATCHLIST hanya boleh 1x trial per hari
          const watchlistLimit = 1;
          const usedToday = await getTrialUsageToday(ctx.from.id);

          if (usedToday >= watchlistLimit) {
            return ctx.reply(
              'âŒ *Batas trial harian untuk akun WATCHLIST sudah tercapai.*\n\n' +
              `Saat ini akun kamu berstatus *WATCHLIST* sehingga fitur trial hanya bisa dipakai *${watchlistLimit}x per hari*.\n` +
              'Silakan coba lagi besok, atau beli akun lewat menu *âž• Buat Akun*.',
              { parse_mode: 'Markdown' }
            );
          }
        }
      } catch (e) {
        // Kalau gagal baca flag, anggap saja NORMAL
        logger.error('âš ï¸ Gagal membaca flag_status user saat cek trial WATCHLIST:', e.message || e);
      }

        // ðŸ”¹ Cek batas trial harian
        const sudahPakai = await checkTrialAccess(ctx.from.id);
        if (sudahPakai) {
          return ctx.reply(
            'âŒ *Batas trial harian sudah tercapai.*\n\n' +
            `Saat ini trial hanya bisa dipakai *${maxPerDay}x per hari* untuk 1 user.\n` +
            'Silakan coba lagi besok, atau beli akun lewat menu *âž• Buat Akun*.',
            { parse_mode: 'Markdown' }
          );
        }
      }

        // Lanjut buat trial
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

        try {
      // Ambil durasi trial dari konfigurasi (satuan JAM)
      const cfg = await getTrialConfig();
      let durationHours = 1;
      if (cfg && Number.isInteger(cfg.durationHours) && cfg.durationHours > 0) {
        durationHours = cfg.durationHours;
      }

      const password = 'none';
      const exp = durationHours;   // DIKIRIM ke script trial sebagai JUMLAH JAM
      const iplimit = 'none';

      const delFunctions = {
        vmess: trialvmess,
        vless: trialvless,
        trojan: trialtrojan,
        shadowsocks: trialshadowsocks,
        ssh: trialssh
      };

      if (delFunctions[type]) {
        const msg = await delFunctions[type](username, password, exp, iplimit, serverId);
await recordAccountTransaction(ctx.from.id, type);
await saveTrialAccess(ctx.from.id);

const extraInfo =
  '\n\nâ„¹ï¸ *Catatan:*\n' +
  'Username dan password yang tampil di atas dibuat *acak otomatis oleh server*.\n' +
  'Teks yang kamu kirim tadi hanya dipakai sebagai konfirmasi, bukan sebagai username akun.';

await ctx.reply(msg + extraInfo, { parse_mode: 'Markdown' });

        logger.info(`âœ… Trial ${type} oleh ${ctx.from.id}`);
      }

    } catch (err) {
      logger.error('âŒ Gagal proses trial akun:', err.message);
      await ctx.reply('âŒ *Terjadi kesalahan saat memproses trial akun.*', { parse_mode: 'Markdown' });
    }

  });
  return;
}

    if (state.step.startsWith('username_unlock_')) {
    const username = text;
    // Validasi username (hanya huruf kecil dan angka, 3-20 karakter)
    if (!/^[a-z0-9]{3,20}$/.test(username)) {
      return ctx.reply('âŒ *Username tidak valid. Gunakan huruf kecil dan angka (3â€“20 karakter).*', { parse_mode: 'Markdown' });
    }
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        logger.error('âŒ Gagal membaca file ressel.db:', err.message);
        return ctx.reply('âŒ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);

      console.log('ðŸ§ª ID Pengguna:', idUser);
      console.log('ðŸ“‚ Daftar Ressel:', resselList);

      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('âŒ *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
      }
  //izin ressel saja
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

    let msg = 'none';
    try {
      const password = 'none', exp = 'none', iplimit = 'none';

      const delFunctions = {
        vmess: unlockvmess,
        vless: unlockvless,
        trojan: unlocktrojan,
        shadowsocks: unlockshadowsocks,
        ssh: unlockssh
      };

      if (delFunctions[type]) {
        msg = await delFunctions[type](username, password, exp, iplimit, serverId);
        await recordAccountTransaction(ctx.from.id, type);
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
      logger.info(`âœ… Akun ${type} berhasil unlock oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('âŒ Gagal hapus akun:', err.message);
      await ctx.reply('âŒ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
    if (state.step.startsWith('username_lock_')) {
    const username = text;
    // Validasi username (hanya huruf kecil dan angka, 3-20 karakter)
    if (!/^[a-z0-9]{3,20}$/.test(username)) {
      return ctx.reply('âŒ *Username tidak valid. Gunakan huruf kecil dan angka (3â€“20 karakter).*', { parse_mode: 'Markdown' });
    }
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        logger.error('âŒ Gagal membaca file ressel.db:', err.message);
        return ctx.reply('âŒ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);

      console.log('ðŸ§ª ID Pengguna:', idUser);
      console.log('ðŸ“‚ Daftar Ressel:', resselList);

      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('âŒ *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
      }
  //izin ressel saja
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

    let msg = 'none';
    try {
      const password = 'none', exp = 'none', iplimit = 'none';

      const delFunctions = {
        vmess: lockvmess,
        vless: lockvless,
        trojan: locktrojan,
        shadowsocks: lockshadowsocks,
        ssh: lockssh
      };

      if (delFunctions[type]) {
        msg = await delFunctions[type](username, password, exp, iplimit, serverId);
        await recordAccountTransaction(ctx.from.id, type);
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
      logger.info(`âœ… Akun ${type} berhasil di kunci oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('âŒ Gagal hapus akun:', err.message);
      await ctx.reply('âŒ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
  if (state.step.startsWith('username_del_')) {
    const username = text;
    // Validasi username (hanya huruf kecil dan angka, 3-20 karakter)
    if (!/^[a-z0-9]{3,20}$/.test(username)) {
      return ctx.reply('âŒ *Username tidak valid. Gunakan huruf kecil dan angka (3â€“20 karakter).*', { parse_mode: 'Markdown' });
    }
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        logger.error('âŒ Gagal membaca file ressel.db:', err.message);
        return ctx.reply('âŒ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);

      console.log('ðŸ§ª ID Pengguna:', idUser);
      console.log('ðŸ“‚ Daftar Ressel:', resselList);

      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('âŒ *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
      }
  //izin ressel saja
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

    let msg = 'none';
    try {
      const password = 'none', exp = 'none', iplimit = 'none';

      const delFunctions = {
        vmess: delvmess,
        vless: delvless,
        trojan: deltrojan,
        shadowsocks: delshadowsocks,
        ssh: delssh
      };

      if (delFunctions[type]) {
        msg = await delFunctions[type](username, password, exp, iplimit, serverId);
        await recordAccountTransaction(ctx.from.id, type);
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
      logger.info(`âœ… Akun ${type} berhasil dihapus oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('âŒ Gagal hapus akun:', err.message);
      await ctx.reply('âŒ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
  if (state.step.startsWith('username_')) {
    state.username = text;

    if (!state.username) {
      return ctx.reply('âŒ *Username tidak valid. Masukkan username yang valid.*', { parse_mode: 'Markdown' });
    }
    if (state.username.length < 4 || state.username.length > 20) {
      return ctx.reply('âŒ *Username harus terdiri dari 4 hingga 20 karakter.*', { parse_mode: 'Markdown' });
    }
    if (/[A-Z]/.test(state.username)) {
      return ctx.reply('âŒ *Username tidak boleh menggunakan huruf kapital. Gunakan huruf kecil saja.*', { parse_mode: 'Markdown' });
    }
    if (/[^a-z0-9]/.test(state.username)) {
      return ctx.reply('âŒ *Username tidak boleh mengandung karakter khusus atau spasi. Gunakan huruf kecil dan angka saja.*', { parse_mode: 'Markdown' });
    }
    const { type, action } = state;
    if (action === 'create') {
      if (type === 'ssh') {
        state.step = `password_${state.action}_${state.type}`;
        await ctx.reply('ðŸ”‘ *Masukkan password:*', { parse_mode: 'Markdown' });
      } else {
        state.step = `exp_${state.action}_${state.type}`;
        await ctx.reply('â³ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
      }
    } else if (action === 'renew') {
      state.step = `exp_${state.action}_${state.type}`;
      await ctx.reply('â³ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
    }
  } else if (state.step.startsWith('password_')) {
    state.password = ctx.message.text.trim();
    if (!state.password) {
      return ctx.reply('âŒ *Password tidak valid. Masukkan password yang valid.*', { parse_mode: 'Markdown' });
    }
    if (state.password.length < 3) {
      return ctx.reply('âŒ *Password harus terdiri dari minimal 3 karakter.*', { parse_mode: 'Markdown' });
    }
    if (/[^a-zA-Z0-9]/.test(state.password)) {
      return ctx.reply('âŒ *Password tidak boleh mengandung karakter khusus atau spasi.*', { parse_mode: 'Markdown' });
    }
    state.step = `exp_${state.action}_${state.type}`;
    await ctx.reply('â³ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
  } else if (state.step.startsWith('exp_')) {
    const expInput = ctx.message.text.trim();
    
// Cek hanya angka
if (!/^\d+$/.test(expInput)) {
  return ctx.reply('âŒ *Masa aktif hanya boleh angka, contoh: 30*', { parse_mode: 'Markdown' });
}

const exp = parseInt(expInput, 10);

if (isNaN(exp) || exp <= 0) {
  return ctx.reply('âŒ *Masa aktif tidak valid. Masukkan angka yang valid.*', { parse_mode: 'Markdown' });
}

if (exp > 365) {
  return ctx.reply('âŒ *Masa aktif tidak boleh lebih dari 365 hari.*', { parse_mode: 'Markdown' });
}
    state.exp = exp;

    db.get('SELECT quota, iplimit FROM Server WHERE id = ?', [state.serverId], async (err, server) => {
      if (err) {
        logger.error('âš ï¸ Error fetching server details:', err.message);
        return ctx.reply('âŒ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
      }

      if (!server) {
        return ctx.reply('âŒ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
      }

      // baseQuota = kuota untuk paket 30 hari
  const baseQuota = server.quota;
  const days = state.exp || 30; // kalau exp nggak kebaca, anggap 30 hari

  let computedQuota = baseQuota;

  // Kalau baseQuota > 0 ? hitung proporsional
  if (baseQuota && baseQuota > 0) {
    computedQuota = Math.max(1, Math.floor(baseQuota * days / 30));
  }

  state.quota = computedQuota;
  state.iplimit = server.iplimit;

  const { username, password, exp, quota, iplimit, serverId, type, action } = state;
      let msg;

      db.get('SELECT harga FROM Server WHERE id = ?', [serverId], async (err, server) => {
        if (err) {
          logger.error('âš ï¸ Error fetching server price:', err.message);
          return ctx.reply('âŒ *Terjadi kesalahan saat mengambil harga server.*', { parse_mode: 'Markdown' });
        }

        if (!server) {
          return ctx.reply('âŒ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
        }

                // Harga dasar dari tabel Server (sebagai harga paket 30 hari)
const baseHarga30 = Number(server.harga) || 0;
const days = state.exp || 30;
// cek status reseller lebih awal agar bisa dipakai di bawah
const isR = await isUserReseller(ctx.from.id).catch(() => false);

let totalHarga = 0;
if (baseHarga30 > 0) {
  // Harga normal proporsional terhadap lama hari
  totalHarga = Math.max(1, Math.floor(baseHarga30 * days / 30));


  if (isR) {
    totalHarga = Math.max(1, Math.floor(totalHarga * RESELLER_DISCOUNT));
  }
} else {
  totalHarga = 0;
}


        db.get('SELECT saldo FROM users WHERE user_id = ?', [ctx.from.id], async (err, user) => {
          if (err) {
            logger.error('âš ï¸ Kesalahan saat mengambil saldo pengguna:', err.message);
            return ctx.reply('âŒ *Terjadi kesalahan saat mengambil saldo pengguna.*', { parse_mode: 'Markdown' });
          }

          if (!user) {
            return ctx.reply('âŒ *Pengguna tidak ditemukan.*', { parse_mode: 'Markdown' });
          }

          const saldo = user.saldo;
          if (saldo < totalHarga) {
            return ctx.reply('âŒ *Saldo Anda tidak mencukupi untuk melakukan transaksi ini.*', { parse_mode: 'Markdown' });
          }
		            // ðŸ”¹ Limit create per hari untuk WATCHLIST (non-reseller)
          // isR sudah dihitung di atas (pakai isUserReseller)
          if (action === 'create' && !isR) {
            try {
              const flagStatus = await getUserFlagStatus(ctx.from.id);

              if (flagStatus === 'WATCHLIST') {
                // Aturan: user WATCHLIST hanya boleh X akun baru per hari
                const watchlistCreateLimit = 3; // ðŸ‘‰ silakan ganti angkanya kalau mau
                const createdToday = await getCreateUsageToday(ctx.from.id);

                if (createdToday >= watchlistCreateLimit) {
                  return ctx.reply(
                    'âŒ *Batas pembuatan akun harian untuk akun WATCHLIST sudah tercapai.*\n\n' +
                      `Saat ini akun kamu berstatus *WATCHLIST* sehingga hanya boleh membuat *${watchlistCreateLimit} akun baru per hari*.\n` +
                      'Silakan coba lagi besok, atau gunakan akun yang sudah ada / hubungi admin.',
                    { parse_mode: 'Markdown' }
                  );
                }
              }
            } catch (e) {
              logger.error('âš ï¸ Gagal cek limit create user WATCHLIST:', e.message || e);
              // Kalau error, jangan blok user (anggap saja lolos)
            }
          }
          let paymentDebited = false;
          if (totalHarga > 0) {
            try {
              await processAccountPayment(
                ctx.from.id,
                totalHarga,
                type,
                action,
                serverId,
                username
              );
              paymentDebited = true;
            } catch (payErr) {
              logger.error('Gagal memproses pengurangan saldo & transaksi pembelian:', payErr.message || payErr);
              return ctx.reply('âŒ *Transaksi dibatalkan karena saldo gagal dipotong. Silakan coba lagi.*', { parse_mode: 'Markdown' });
            }
          }

          let waitCtrl = null;
          waitCtrl = await startWaiting(ctx, 'â³ Sedang membuat akun...');
          if (action === 'create') {
            if (type === 'vmess') {
              msg = await createvmess(username, exp, quota, iplimit, serverId);
            } else if (type === 'vless') {
              msg = await createvless(username, exp, quota, iplimit, serverId);
            } else if (type === 'trojan') {
              msg = await createtrojan(username, exp, quota, iplimit, serverId);
            } else if (type === 'shadowsocks') {
              msg = await createshadowsocks(username, exp, quota, iplimit, serverId);
            } else if (type === 'ssh') {
              msg = await createssh(username, password, exp, iplimit, serverId);
            }

            logger.info(`Account created and transaction recorded for user ${ctx.from.id}, type: ${type}`);
          } else if (action === 'renew') {
            if (type === 'vmess') {
              msg = await renewvmess(username, exp, quota, iplimit, serverId);
            } else if (type === 'vless') {
              msg = await renewvless(username, exp, quota, iplimit, serverId);
            } else if (type === 'trojan') {
              msg = await renewtrojan(username, exp, quota, iplimit, serverId);
            } else if (type === 'shadowsocks') {
              msg = await renewshadowsocks(username, exp, quota, iplimit, serverId);
            } else if (type === 'ssh') {
              msg = await renewssh(username, exp, iplimit, serverId);
            }

            logger.info(`Account renewed and transaction recorded for user ${ctx.from.id}, type: ${type}`);
          }

          if (msg.includes('âŒ')) {
            if (paymentDebited && totalHarga > 0) {
              try {
                await refundAccountPayment(
                  ctx.from.id,
                  totalHarga,
                  type,
                  action,
                  serverId,
                  username,
                  'provision_failed'
                );
              } catch (refundErr) {
                logger.error(`Refund gagal setelah provisioning gagal untuk user ${ctx.from.id}: ${refundErr.message || refundErr}`);
              }
            }
            logger.error(`Rollback transaksi user ${ctx.from.id}, type: ${type}, server: ${serverId}, respon: ${msg}`);
            try { if (waitCtrl) await waitCtrl.stop('âŒ Gagal membuat akun. Coba lagi ya.', true); } catch (_) {}
            return ctx.reply(msg, { parse_mode: 'Markdown' });
          }

          logger.info(`âœ… Transaksi sukses untuk user ${ctx.from.id}, type: ${type}, server: ${serverId}`);
          upsertAccount(ctx.from.id, username, type, serverId, exp);


db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId], (err) => {
  if (err) {
    logger.error('âš ï¸ Kesalahan saat menambahkan total_create_akun:', err.message);
  }
});
// ==== NOTIF PEMBELIAN / RENEW KE GRUP ====
try {
   // Info user Telegram
  let userInfo;
  try {
    userInfo = await bot.telegram.getChat(ctx.from.id);
  } catch (e) {
    userInfo = {};
  }

  // ambil username TANPA @, kalau nggak ada pakai first_name, tanpa ID
  let usernameTelegram = userInfo.username || userInfo.first_name || '';

  usernameTelegram = usernameTelegram.trim();
  if (usernameTelegram.startsWith('@')) {
    usernameTelegram = usernameTelegram.slice(1);
  }
  if (!usernameTelegram) {
    usernameTelegram = '-';
  }

 // tampil di notif grup hanya username (tanpa ID)
  const userDisplay = usernameTelegram;
  
  // Role: Reseller / Member
  let roleLabel = 'Member';
  try {
    const isRes = await isUserReseller(ctx.from.id);
    if (isRes) roleLabel = 'Reseller';
  } catch (e) {
    // kalau error, biarkan tetap "Member"
  }

  const actionText = (action === 'create') ? 'ACCOUNT CREATED' : 'ACCOUNT RENEWED';

  // Ambil nama server dari tabel Server
  let serverName = 'Server ID ' + serverId;
  try {
    const serverRow = await new Promise((resolve) => {
      db.get('SELECT nama_server FROM Server WHERE id = ?', [serverId], (err, row) => {
        if (err) {
          logger.error('Gagal ambil nama_server:', err.message);
          return resolve(null);
        }
        resolve(row);
      });
    });

    if (serverRow && serverRow.nama_server) {
      serverName = serverRow.nama_server;
    }
  } catch (e) {
    // sudah di-log di atas kalau error
  }

    // ====== HITUNG DURASI & EXPIRED DARI TABEL accounts ======
  let createdText    = '-';
  let expiredDateOnly = '-';
  let durasiHari     = exp;   // default fallback = exp input
  let sisaHari       = '-';

  try {
    const accountRow = await new Promise((resolve) => {
      db.get(
        'SELECT created_at, expires_at FROM accounts WHERE username = ? AND server_id = ? AND type = ? ORDER BY id DESC LIMIT 1',
        [username, serverId, type],
        (err, row) => {
          if (err) {
            logger.error('Gagal ambil data akun untuk notif grup:', err.message);
            return resolve(null);
          }
          resolve(row);
        }
      );
    });

    const options = {
      timeZone: 'Asia/Jayapura',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };
    const msPerDay = 24 * 60 * 60 * 1000;

    if (accountRow && accountRow.created_at && accountRow.expires_at) {
      const createdAtDate = new Date(accountRow.created_at);
      const expiredAtDate = new Date(accountRow.expires_at);

      createdText     = createdAtDate.toLocaleDateString('id-ID', options);
      expiredDateOnly = expiredAtDate.toLocaleDateString('id-ID', options);

      // Durasi = selisih hari antara created_at dan expires_at
      durasiHari = Math.max(
        1,
        Math.round((expiredAtDate.getTime() - createdAtDate.getTime()) / msPerDay)
      );

      // Sisa hari dari sekarang
      const diffNow = Math.ceil((expiredAtDate.getTime() - Date.now()) / msPerDay);
      sisaHari = diffNow > 0 ? diffNow : 0;
    } else {
      // Fallback kalau data di accounts belum ada / gagal ambil
      const now = new Date();
      const expiredAt = new Date(now.getTime() + exp * msPerDay);

      createdText     = now.toLocaleDateString('id-ID', options);
      expiredDateOnly = expiredAt.toLocaleDateString('id-ID', options);
      durasiHari      = exp;
      sisaHari        = exp;
    }
  } catch (e) {
    logger.error('Error hitung tanggal expired untuk notif grup:', e.message);
  }

  // Susun teks notif dengan garis '=' (aman di semua HP)
  let notifText = '';

  if (action === 'create') {
    // âžœ NOTIF UNTUK BUAT AKUN BARU
    notifText =
      '<blockquote>\n' +
      '<code>â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”</code>\n' +
      '<b>ACCOUNT CREATED</b>\n' +
      '<code>â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”</code>\n' +
      '<b>' + serverName + '</b>\n' +
      '<code>\n' + // <-- MULAI BLOK MONOSPACE
      '-> Client  : ' + userDisplay + '\n' +
      '-> Role    : ' + roleLabel + '\n' +
      '-> User    : <code>' + username + '</code>\n' +
      '-> Type    : ' + type.toUpperCase() + '\n' +
      '-> Durasi  : ' + exp + ' Hari\n' +       // durasi paket yang dipilih
     // '-> Sisa    : ' + sisaHari + ' Hari\n' +  // sisa sekarang (harusnya = exp kalau baru dibuat)
      '-> Expired : ' + expiredDateOnly + '\n' +
      '</code>\n' + // <-- AKHIR BLOK MONOSPACE
      '<code>â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”</code>\n' +
      '</blockquote>';
  } else {
    // âžœ NOTIF UNTUK RENEW / PERPANJANG
    const sisaSebelum = Math.max(sisaHari - exp, 0); // kira2 sisa sebelum tambah hari

    notifText =
      '<blockquote>\n' +
      '<code>â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”</code>\n' +
      '<b>ACCOUNT RENEWED</b>\n' +
      '<code>â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”</code>\n' +
      '<b>' + serverName + '</b>\n' +
      '<code>\n' + // <-- MULAI BLOK MONOSPACE
      '-> Client  : ' + userDisplay + '\n' +
      '-> Role    : ' + roleLabel + '\n' +
      '-> User    : <code>' + username + '</code>\n' +
      '-> Type    : ' + type.toUpperCase() + '\n' +
      '-> Sisa sebelum : ' + sisaSebelum + ' Hari\n' +
      '-> Perpanjang   : +' + exp + ' Hari\n' +
      '-> Sisa sekarang: ' + sisaHari + ' Hari\n' +
      '-> Expired      : ' + expiredDateOnly + '\n' +
      '</code>\n' + // <-- AKHIR BLOK MONOSPACE
      '<code>â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”</code>\n' +
      '</blockquote>';
  }

  await bot.telegram.sendMessage(GROUP_ID, notifText, { parse_mode: 'HTML' });

} catch (e) {
  logger.error('Gagal kirim notif pembelian ke grup:', e.message);
}
// ==== END NOTIF GRUP ====

if (waitCtrl) await waitCtrl.stop('âœ… Akun berhasil dibuat.', true);
await ctx.reply(msg, { parse_mode: 'Markdown' });
delete userState[ctx.chat.id];
//SALDO DATABES
          });
        });
      });
    }
  else if (state.step === 'addserver') {
    const domain = ctx.message.text.trim();
    if (!domain) {
      await ctx.reply('âš ï¸ *Domain tidak boleh kosong.* Silakan masukkan domain server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_auth';
    state.domain = domain;
    await ctx.reply('ðŸ”‘ *Silakan masukkan auth server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_auth') {
    const auth = ctx.message.text.trim();
    if (!auth) {
      await ctx.reply('âš ï¸ *Auth tidak boleh kosong.* Silakan masukkan auth server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_nama_server';
    state.auth = auth;
    await ctx.reply('ðŸ·ï¸ *Silakan masukkan nama server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_nama_server') {
    const nama_server = ctx.message.text.trim();
    if (!nama_server) {
      await ctx.reply('âš ï¸ *Nama server tidak boleh kosong.* Silakan masukkan nama server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_quota';
state.nama_server = nama_server;
await ctx.reply(
  'ðŸ“Š *Silakan masukkan quota server (dalam GB, contoh: 500):*',
  { parse_mode: 'Markdown' }
);
} else if (state.step === 'addserver_quota') {
  const quota = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(quota) || quota <= 0) {
    await ctx.reply(
      'âš ï¸ *Quota tidak valid.* Quota harus berupa angka dan lebih besar dari 0.\n' +
      'Contoh: `500` (untuk 500 GB).',
      { parse_mode: 'Markdown' }
    );
    return;
  }

    state.step = 'addserver_iplimit';
    state.quota = quota;
    await ctx.reply('ðŸ”¢ *Silakan masukkan limit IP server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_iplimit') {
  const iplimit = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(iplimit) || iplimit <= 0) {
    await ctx.reply(
      'âš ï¸ *Limit IP tidak valid.* Limit IP harus berupa angka dan lebih besar dari 0.\n' +
      'Contoh: `1` atau `2`.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

    state.step = 'addserver_batas_create_akun';
    state.iplimit = iplimit;
    await ctx.reply('ðŸ”¢ *Silakan masukkan batas create akun server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_batas_create_akun') {
  const batas_create_akun = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(batas_create_akun) || batas_create_akun <= 0) {
    await ctx.reply(
      'âš ï¸ *Batas create akun tidak valid.* Nilai harus berupa angka dan lebih besar dari 0.\n' +
      'Contoh: `100` (maksimal 100 akun).',
      { parse_mode: 'Markdown' }
    );
    return;
  }

    state.step = 'addserver_harga';
state.batas_create_akun = batas_create_akun;
await ctx.reply(
  'ðŸ’° *Silakan masukkan harga server untuk paket 30 hari* (dalam rupiah, tanpa titik. Contoh: 12000):',
  { parse_mode: 'Markdown' }
);

  } else if (state.step === 'addserver_harga') {
    const harga = parseFloat(ctx.message.text.trim());
    if (isNaN(harga) || harga <= 0) {
      await ctx.reply('âš ï¸ *Harga tidak valid.* Silakan masukkan harga server yang valid.', { parse_mode: 'Markdown' });
      return;
    }
    const { domain, auth, nama_server, quota, iplimit, batas_create_akun } = state;

  try {
    db.run('INSERT INTO Server (domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, 0], function(err) {        if (err) {
          logger.error('Error saat menambahkan server:', err.message);
          ctx.reply('âŒ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
        } else {
          ctx.reply(`âœ… *Server baru dengan domain ${domain} telah berhasil ditambahkan.*\n\nðŸ“„ *Detail Server:*\n- Domain: ${domain}\n- Auth: ${auth}\n- Nama Server: ${nama_server}\n- Quota: ${quota}\n- Limit IP: ${iplimit}\n- Batas Create Akun: ${batas_create_akun}\n- Harga: Rp ${harga}`, { parse_mode: 'Markdown' });
        }
      });
    } catch (error) {
      logger.error('Error saat menambahkan server:', error);
      await ctx.reply('âŒ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
  }
// === ðŸ·ï¸ TAMBAH SERVER UNTUK RESELLER ===
if (state && state.step === 'reseller_domain') {
  state.domain = text;
  state.step = 'reseller_auth';
  return ctx.reply('ðŸ”‘ Masukkan auth server:');
}

if (state && state.step === 'reseller_auth') {
  state.auth = text;
  state.step = 'reseller_harga';
  return ctx.reply('ðŸ’° Masukkan harga server (angka):');
}

if (state && state.step === 'reseller_harga') {
  state.harga = text;
  state.step = 'reseller_nama';
  return ctx.reply('ðŸ“ Masukkan nama server:');
}

if (state && state.step === 'reseller_nama') {
  state.nama_server = text;
  state.step = 'reseller_quota';
  return ctx.reply('ðŸ“Š Masukkan quota (GB):');
}

if (state && state.step === 'reseller_quota') {
  state.quota = text;
  state.step = 'reseller_iplimit';
  return ctx.reply('ðŸ“¶ Masukkan IP limit:');
}

if (state && state.step === 'reseller_iplimit') {
  state.iplimit = text;
  state.step = 'reseller_batas';
  return ctx.reply('ðŸ”¢ Masukkan batas create akun:');
}

if (state && state.step === 'reseller_batas') {
  state.batas_create_akun = text;

  db.run(
    `INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, total_create_akun, is_reseller_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
    [
      state.domain,
      state.auth,
      parseInt(state.harga),
      state.nama_server,
      parseInt(state.quota),
      parseInt(state.iplimit),
      parseInt(state.batas_create_akun),
    ],
    (err) => {
      if (err) {
        logger.error('âŒ Gagal menambah server reseller:', err.message);
        ctx.reply('âŒ Gagal menambah server reseller.');
      } else {
        ctx.reply(
          `âœ… Server reseller *${state.nama_server}* berhasil ditambahkan!`,
          { parse_mode: 'Markdown' }
        );
      }
      delete userState[ctx.chat.id];
    }
  );
  return;
}
// === ðŸ’° TAMBAH SALDO (LANGKAH 1: INPUT USER ID) ===
if (state && state.step === 'addsaldo_userid') {
  state.targetId = text.trim();
  state.step = 'addsaldo_amount';
  return ctx.reply('ðŸ’° Masukkan jumlah saldo yang ingin ditambahkan:');
}

// === ðŸ’° TAMBAH SALDO (LANGKAH 1: INPUT USER ID) ===
if (state && state.step === 'addsaldo_userid') {
  state.targetId = text.trim();
  state.step = 'addsaldo_amount';
  return ctx.reply('ðŸ’° Masukkan jumlah saldo yang ingin ditambahkan:');
}

// === ðŸ’° TAMBAH SALDO (LANGKAH 2: INPUT JUMLAH SALDO) ===
if (state && state.step === 'addsaldo_amount') {
  const amount = parseInt(text.trim());
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('âš ï¸ Jumlah saldo harus berupa angka dan lebih dari 0.');
  }

  const targetId = state.targetId;

// Tambahkan saldo
db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, targetId], (err) => {
  if (err) {
    logger.error('âŒ Gagal menambah saldo:', err.message);
    return ctx.reply('âŒ Gagal menambah saldo ke user.');
  }

          // Ambil saldo terbaru
      db.get(
        'SELECT saldo FROM users WHERE user_id = ?',
        [targetId],
        (err2, updated) => {
          const safeTargetId = Number(targetId);

          if (err2 || !updated) {
            // ðŸ§¾ Catat transaksi saldo
            recordSaldoTransaction(
              safeTargetId,
              amount,
              'manual_addsaldo',
              `addsaldo_by_${ctx.from.id}`
            );

            // ðŸ“© Notif ke user
bot.telegram
  .sendMessage(
    safeTargetId,
    'ðŸ’° Saldo kamu telah <b>ditambahkan</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n' +
      'ðŸ’³ Silakan cek saldo kamu di bot.',
    { parse_mode: 'HTML' }
  )
  .catch((e) => {
    logger.error(
      'âŒ Gagal mengirim notif saldo masuk ke user (menu tambah_saldo, saldo tidak terbaca):',
      e.message
    );
  });


            // ðŸŽ¯ Balas ke admin
            ctx.reply(
              `âœ… Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.`
            );
            logger.info(
              `Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId} (gagal membaca saldo terbaru).`
            );
          } else {
            // ðŸ§¾ Catat transaksi saldo
            recordSaldoTransaction(
              safeTargetId,
              amount,
              'manual_addsaldo',
              `addsaldo_by_${ctx.from.id}`
            );

            // ðŸ“© Notif ke user
bot.telegram
  .sendMessage(
    safeTargetId,
    'ðŸ’° Saldo kamu telah <b>ditambahkan</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n' +
      'ðŸ’³ Saldo sekarang: <b>Rp ' + updated.saldo.toLocaleString() + '</b>.',
    { parse_mode: 'HTML' }
  )
  .catch((e) => {
    logger.error(
      'âŒ Gagal mengirim notif saldo masuk ke user (menu tambah_saldo):',
      e.message
    );
  });


            // ðŸŽ¯ Balas ke admin
            ctx.reply(
              `âœ… Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.\n` +
                `ðŸ’³ Saldo sekarang: Rp${updated.saldo.toLocaleString()}`
            );
            logger.info(
              `Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId} (Saldo akhir: Rp${updated.saldo}).`
            );
          }

          // ðŸ“¨ NOTIF KE GRUP (LOG TOPUP MANUAL) â€“ dipanggil kalau GROUP_ID ada
          try {
            if (NOTIF_TOPUP_GROUP && typeof GROUP_ID !== 'undefined' && GROUP_ID) {
              (async () => {
                try {
                  // Nama admin
                  const adminName = ctx.from.username
                    ? '@' + ctx.from.username
                    : (ctx.from.first_name || ctx.from.id);

                  // Info user yang di-topup
                  let targetInfo;
                  try {
                    targetInfo = await bot.telegram.getChat(safeTargetId);
                  } catch (e) {
                    targetInfo = {};
                  }

                  const targetName = targetInfo.username
                    ? '@' + targetInfo.username
                    : (targetInfo.first_name || String(safeTargetId));

                  const waktu = new Date().toLocaleString('id-ID', {
                    timeZone: 'Asia/Jayapura',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  const notifTopup =
                    '<blockquote>\n' +
                    'â”â”â”â”â” TOPUP MANUAL â”â”â”â”â”\n\n' +
					'<code>\n' + // <-- MULAI BLOK MONOSPACE
                    'User   : ' + targetName + ' (' + safeTargetId + ')\n' +
                    'Topup  : Rp ' + amount.toLocaleString() + '\n' +
                    'Status : SUCCESS\n' +
                    'Tanggal: ' + waktu + '\n' +
					'</code>\n' + // <-- AKHIR BLOK MONOSPACE
                    'â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n' +
                    '</blockquote>';

                  await bot.telegram.sendMessage(
                    GROUP_ID,
                    notifTopup,
                    { parse_mode: 'HTML' }
                  );
                } catch (e) {
                  logger.error('âŒ Gagal kirim notif topup manual ke grup:', e.message);
                }
              })();
            }
          } catch (e) {
            logger.error('âŒ Error umum saat proses notif grup topup manual:', e.message);
          }
        }
      );

  delete userState[ctx.from.id];
});

  return;
}
});
////////
bot.action('addserver', async (ctx) => {
  try {
    logger.info('ðŸ“¥ Proses tambah server dimulai');
    await ctx.answerCbQuery();
       await ctx.reply(
      'ðŸŒ *Silakan masukkan domain/ip server.*\n' +
      'Ketik `batal` untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );

    userState[ctx.chat.id] = { step: 'addserver' };
  } catch (error) {
    logger.error('âŒ Kesalahan saat memulai proses tambah server:', error);
    await ctx.reply('âŒ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});
bot.action('detailserver', async (ctx) => {
  try {
    logger.info('ðŸ“‹ Proses detail server dimulai');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('âš ï¸ Kesalahan saat mengambil detail server:', err.message);
          return reject('âš ï¸ *PERHATIAN! Terjadi kesalahan saat mengambil detail server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      logger.info('âš ï¸ Tidak ada server yang tersedia');
      return ctx.reply('âš ï¸ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
    }

    const buttons = [];
    for (let i = 0; i < servers.length; i += 2) {
      const row = [];
      row.push({
        text: `${servers[i].nama_server}`,
        callback_data: `server_detail_${servers[i].id}`
      });
      if (i + 1 < servers.length) {
        row.push({
          text: `${servers[i + 1].nama_server}`,
          callback_data: `server_detail_${servers[i + 1].id}`
        });
      }
      buttons.push(row);
    }

    await ctx.reply('ðŸ“‹ *Silakan pilih server untuk melihat detail:*', {
      reply_markup: { inline_keyboard: buttons },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('âš ï¸ Kesalahan saat mengambil detail server:', error);
    await ctx.reply('âš ï¸ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
  }
});

bot.action('listserver', async (ctx) => {
  try {
    logger.info('ðŸ“œ Proses daftar server dimulai');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('âš ï¸ Kesalahan saat mengambil daftar server:', err.message);
          return reject('âš ï¸ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      logger.info('âš ï¸ Tidak ada server yang tersedia');
      return ctx.reply('âš ï¸ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
    }

    let serverList = 'ðŸ“œ *Daftar Server* ðŸ“œ\n\n';
    servers.forEach((server, index) => {
      serverList += `ðŸ”¹ ${index + 1}. ${server.domain}\n`;
    });

    serverList += `\nTotal Jumlah Server: ${servers.length}`;

    await ctx.reply(serverList, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('âš ï¸ Kesalahan saat mengambil daftar server:', error);
    await ctx.reply('âš ï¸ *Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' });
  }
});
bot.action('resetdb', async (ctx) => {
  try {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
    await ctx.answerCbQuery();
    await ctx.reply('ðŸš¨ *PERHATIAN! Anda akan menghapus semua server yang tersedia. Apakah Anda yakin?*', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'âœ… Ya', callback_data: 'confirm_resetdb' }],
          [{ text: 'âŒ Tidak', callback_data: 'cancel_resetdb' }]
        ]
      },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('âŒ Error saat memulai proses reset database:', error);
    await ctx.reply(`âŒ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('confirm_resetdb', async (ctx) => {
  try {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
    await ctx.answerCbQuery();
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM Server', (err) => {
        if (err) {
          logger.error('âŒ Error saat mereset tabel Server:', err.message);
          return reject('â—ï¸ *PERHATIAN! Terjadi KESALAHAN SERIUS saat mereset database. Harap segera hubungi administrator!*');
        }
        resolve();
      });
    });
    await ctx.reply('ðŸš¨ *PERHATIAN! Database telah DIRESET SEPENUHNYA. Semua server telah DIHAPUS TOTAL.*', { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('âŒ Error saat mereset database:', error);
    await ctx.reply(`âŒ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('cancel_resetdb', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('âŒ *Proses reset database dibatalkan.*', { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('âŒ Error saat membatalkan reset database:', error);
    await ctx.reply(`âŒ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('deleteserver', async (ctx) => {
  try {
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    logger.info('🗑️ Proses hapus server dimulai');
    await ctx.answerCbQuery();

    db.all('SELECT * FROM Server', [], (err, servers) => {
      if (err) {
        logger.error('⚠️ Kesalahan saat mengambil daftar server:', err.message);
        return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' });
      }
      if (!servers || servers.length === 0) {
        return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
      }

      const keyboard = servers.map((server) => [{ text: server.nama_server, callback_data: `confirm_delete_server_${server.id}` }]);
      keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'kembali_ke_menu' }]);

      ctx.reply('🗑️ *Pilih server yang ingin dihapus:*', {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown',
      });
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses hapus server:', error);
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});
bot.action(/edit_harga_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit harga server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_harga', serverId: serverId };

  await ctx.reply('?? *Silakan masukkan harga server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});

bot.action(/add_saldo_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const userId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk menambahkan saldo user dengan ID: ${userId}`);
  userState[ctx.chat.id] = { step: 'add_saldo', userId: userId };

  await ctx.reply('?? *Silakan masukkan jumlah saldo yang ingin ditambahkan:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});

bot.action(/edit_batas_create_akun_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit batas create akun server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_batas_create_akun', serverId: serverId };

  await ctx.reply('?? *Silakan masukkan batas create akun server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});

bot.action(/edit_total_create_akun_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit total create akun server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_total_create_akun', serverId: serverId };

  await ctx.reply('?? *Silakan masukkan total create akun server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});

bot.action(/edit_limit_ip_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit limit IP server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_limit_ip', serverId: serverId };

  await ctx.reply('?? *Silakan masukkan limit IP server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});

bot.action(/edit_quota_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit quota server dengan ID: ${serverId}`);
  userState[ctx.chat.id] = { step: 'edit_quota', serverId: serverId };

  await ctx.reply('?? *Silakan masukkan quota server baru:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});

bot.action(/edit_auth_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  await ctx.answerCbQuery().catch(() => {});
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit auth server dengan ID: ${serverId}`);

  db.get(
    'SELECT auth, domain, nama_server FROM Server WHERE id = ?',
    [serverId],
    async (err, row) => {
      if (err) {
        logger.error('Kesalahan saat mengambil data server untuk edit auth:', err.message);
        await ctx.reply('?? Terjadi kesalahan saat mengambil data server.');
        return;
      }

      if (!row) {
        await ctx.reply('?? Server tidak ditemukan.');
        return;
      }

      const currentAuth = row.auth || '-';
      const currentDomain = row.domain || '-';
      const currentNama = row.nama_server || '-';

      let maskedAuth = currentAuth;
      if (currentAuth.length > 8) {
        maskedAuth = currentAuth.slice(0, 4) + '...' + currentAuth.slice(-4);
      }

      userState[ctx.chat.id] = {
        step: 'edit_auth',
        serverId: serverId,
        oldAuth: currentAuth,
        domain: currentDomain,
        nama: currentNama,
      };

      await ctx.reply(
        '?? *Edit AUTH Server*\n' +
          `• Nama   : \`${currentNama}\`\n` +
          `• Domain : \`${currentDomain}\`\n` +
          `• Auth   : \`${maskedAuth}\`\n\n` +
          '?? *Silakan ketik AUTH server baru, lalu kirim sebagai pesan biasa.*\n' +
          '? Ketik *batal* untuk membatalkan.',
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.action(/edit_domain_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  await ctx.answerCbQuery().catch(() => {});
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit domain server dengan ID: ${serverId}`);

  db.get('SELECT domain FROM Server WHERE id = ?', [serverId], async (err, row) => {
    if (err) {
      logger.error('Kesalahan saat mengambil data server untuk edit domain:', err.message);
      await ctx.reply('?? Terjadi kesalahan saat mengambil data server.');
      return;
    }

    if (!row) {
      await ctx.reply('?? Server tidak ditemukan.');
      return;
    }

    const currentDomain = row.domain || '-';
    userState[ctx.chat.id] = {
      step: 'edit_domain',
      serverId: serverId,
      oldDomain: currentDomain,
    };

    await ctx.reply(
      '?? *Silakan ketik domain server baru, lalu kirim sebagai pesan biasa.*\n' +
        `?? Domain saat ini: \`${currentDomain}\`\n` +
        '?? Contoh: `sg1.serverku.com`\n' +
        '? Ketik *batal* untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );
  });
});

bot.action(/edit_nama_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit nama server dengan ID: ${serverId}`);

  db.get('SELECT nama_server FROM Server WHERE id = ?', [serverId], async (err, row) => {
    if (err) {
      logger.error('Kesalahan saat mengambil data server:', err.message);
      await ctx.reply('?? Terjadi kesalahan saat mengambil data server.');
      return;
    }

    if (!row) {
      await ctx.reply('?? Server tidak ditemukan.');
      return;
    }

    const currentName = row.nama_server || '-';
    userState[ctx.chat.id] = {
      step: 'edit_nama',
      serverId: serverId,
    };

    await ctx.reply(
      '??? *Silakan ketik nama server baru, lalu kirim sebagai pesan biasa.*\n' +
      `?? Contoh: \`${currentName}\`\n` +
      '? Ketik *batal* untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );
  });
});

bot.action(/confirm_delete_server_(\d+)/, async (ctx) => {
  try {
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    db.run('DELETE FROM Server WHERE id = ?', [ctx.match[1]], function(err) {
      if (err) {
        logger.error('Error deleting server:', err.message);
        return ctx.reply('?? *PERHATIAN! Terjadi kesalahan saat menghapus server.*', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
        logger.info('Server tidak ditemukan');
        return ctx.reply('?? *PERHATIAN! Server tidak ditemukan.*', { parse_mode: 'Markdown' });
      }

      logger.info(`Server dengan ID ${ctx.match[1]} berhasil dihapus`);
      ctx.reply('? *Server berhasil dihapus.*', { parse_mode: 'Markdown' });
    });
  } catch (error) {
    logger.error('Kesalahan saat menghapus server:', error);
    await ctx.reply('? *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});

bot.action(/server_detail_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('❌ *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const serverId = ctx.match[1];
  try {
    const server = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
        if (err) {
          logger.error('?? Kesalahan saat mengambil detail server:', err.message);
          return reject('?? *PERHATIAN! Terjadi kesalahan saat mengambil detail server.*');
        }
        resolve(server);
      });
    });

    if (!server) {
      logger.info('?? Server tidak ditemukan');
      return ctx.reply('?? *PERHATIAN! Server tidak ditemukan.*', { parse_mode: 'Markdown' });
    }

    const maskedAuth = String(server.auth || '').length > 8
      ? `${String(server.auth).slice(0, 4)}...${String(server.auth).slice(-4)}`
      : String(server.auth || '-');

    const serverDetails = `?? *Detail Server* ??\n\n` +
      `?? *Domain:* \`${server.domain}\`\n` +
      `?? *Auth:* \`${maskedAuth}\`\n` +
      `??? *Nama Server:* \`${server.nama_server}\`\n` +
      `?? *Quota:* \`${server.quota}\`\n` +
      `?? *Limit IP:* \`${server.iplimit}\`\n` +
      `?? *Batas Create Akun:* \`${server.batas_create_akun}\`\n` +
      `?? *Total Create Akun:* \`${server.total_create_akun}\`\n` +
      `?? *Harga 30 hari:* \`Rp ${server.harga}\`\n\n`;

    await ctx.reply(serverDetails, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('?? Kesalahan saat mengambil detail server:', error);
    await ctx.reply('?? *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
  }
});

bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;
  const userStateData = userState[ctx.chat.id];

  if (global.depositState && global.depositState[userId] && global.depositState[userId].action === 'request_amount') {
    await handleDepositState(ctx, userId, data);
  } else if (userStateData) {
    switch (userStateData.step) {
case 'addsaldo_userid':
  state.targetId = ctx.message.text.trim();
  state.step = 'addsaldo_jumlah';
  return ctx.reply('ðŸ’° Masukkan jumlah saldo yang ingin ditambahkan:');

case 'addsaldo_amount':
  const amount = parseInt(ctx.message.text.trim());
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('âš ï¸ Jumlah saldo harus berupa angka dan lebih dari 0.');
  }

  const targetId = state.targetId;
  db.get('SELECT * FROM users WHERE user_id = ?', [targetId], (err, row) => {
    if (err) {
      logger.error('âŒ Kesalahan saat memeriksa user_id:', err.message);
      return ctx.reply('âŒ Terjadi kesalahan saat memeriksa user.');
    }

    if (!row) {
      return ctx.reply(`âš ï¸ User dengan ID ${targetId} belum terdaftar di database.`);
    }

    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, targetId], function (err) {
      if (err) {
        logger.error('âŒ Gagal menambah saldo:', err.message);
        return ctx.reply('âŒ Gagal menambah saldo.');
      }

      // ðŸ”¥ Perbaikan di bawah ini
      db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err2, updatedRow) => {
        if (err2 || !updatedRow) {
          logger.info(`Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId}, namun gagal membaca saldo terbaru.`);
          return ctx.reply(`âœ… Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.`);
        }

        ctx.reply(`âœ… Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.\nðŸ’° Saldo user sekarang: Rp${updatedRow.saldo.toLocaleString()}`);
        logger.info(`Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId}. Saldo user sekarang: Rp${updatedRow.saldo}`);
      });

      delete userState[ctx.from.id];
    });
  });
  break;

  default:
    await ctx.reply('â“ Perintah tidak dikenali.');
        break;
///////////////////////////
      case 'edit_batas_create_akun':
        await handleEditBatasCreateAkun(ctx, userStateData, data);
        break;
      case 'edit_limit_ip':
        await handleEditiplimit(ctx, userStateData, data);
        break;
      case 'edit_quota':
        await handleEditQuota(ctx, userStateData, data);
        break;
      case 'edit_auth':
        await handleEditAuth(ctx, userStateData, data);
        break;
      case 'edit_domain':
        await handleEditDomain(ctx, userStateData, data);
        break;
      case 'edit_harga':
        await handleEditHarga(ctx, userStateData, data);
        break;
      case 'edit_nama':
        await handleEditNama(ctx, userStateData, data);
        break;
      case 'edit_total_create_akun':
        await handleEditTotalCreateAkun(ctx, userStateData, data);
        break;
    }
  }
});

async function handleDepositState(ctx, userId, data) {
  let currentAmount = global.depositState[userId].amount;

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentAmount.length === 0) {
      return await ctx.answerCbQuery('âš ï¸ Jumlah tidak boleh kosong!', { show_alert: true });
    }
    if (parseInt(currentAmount) < 5000) {
      return await ctx.answerCbQuery('âš ï¸ Jumlah minimal adalah 5.000 !', { show_alert: true });
    }
    global.depositState[userId].action = 'confirm_amount';
    await processDeposit(ctx, currentAmount);
    return;
  } else {
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('âš ï¸ Jumlah maksimal adalah 12 digit!', { show_alert: true });
    }
  }

  global.depositState[userId].amount = currentAmount;
  const newMessage = `ðŸ’° *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*\n\nJumlah saat ini: *Rp ${currentAmount || '0'}*`;

  try {
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
    } else {
      await ctx.answerCbQuery();
    }
  } catch (error) {
    await ctx.answerCbQuery();
    logger.error('Error editing message:', error.message);
  }
}

async function handleAddSaldo(ctx, userStateData, data) {
  let currentSaldo = userStateData.saldo || '';

  if (data === 'backspace') {
    currentSaldo = currentSaldo.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentSaldo.length === 0) {
      return await ctx.answerCbQuery('âš ï¸ *Jumlah saldo tidak boleh kosong!*', {
        show_alert: true,
      });
    }

    const amount = parseInt(currentSaldo, 10);
    if (isNaN(amount) || amount <= 0) {
      return await ctx.answerCbQuery('âš ï¸ *Jumlah saldo tidak valid!*', {
        show_alert: true,
      });
    }

    // Hitung bonus untuk topup manual oleh admin
    const { bonus, percent } = calculateTopupBonus(amount);
    const totalCredit = amount + bonus;

    try {
      // Tambah saldo ke user (jumlah yang benar-benar masuk = amount + bonus)
      await updateUserSaldo(userStateData.userId, totalCredit);

      // Catat transaksi saldo (opsional tapi disarankan)
      try {
        const refId = `admin_addsaldo_${ctx.from.id}_${Date.now()}`;
        recordSaldoTransaction(
          userStateData.userId,
          totalCredit,
          'manual_addsaldo',
          refId
        );
      } catch (e) {
        logger.error('âš ï¸ Gagal mencatat transaksi tambah saldo manual:', e.message);
      }

      let msg =
        'âœ… *Saldo user berhasil ditambahkan.*\n\n' +
        'ðŸ“„ *Detail:*\n' +
        `- Nominal Bayar : *Rp ${amount.toLocaleString('id-ID')}*\n`;

      if (bonus > 0) {
        msg +=
          `- Bonus        : *Rp ${bonus.toLocaleString('id-ID')} (${percent}%)*\n`;
      }

      msg += `- Saldo Masuk   : *Rp ${totalCredit.toLocaleString('id-ID')}*`;

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('âŒ Terjadi kesalahan saat menambahkan saldo user:', error.message);
      await ctx.reply(
        'âŒ *Terjadi kesalahan saat menambahkan saldo user.*',
        { parse_mode: 'Markdown' }
      );
    }

    delete userState[ctx.chat.id];
    return;
  } else if (data === 'cancel') {
    delete userState[ctx.chat.id];
    return await ctx.answerCbQuery('âŒ *Tambah saldo dibatalkan.*', {
      show_alert: true,
    });
  } else {
    if (currentSaldo.length < 10) {
      currentSaldo += data;
    } else {
      return await ctx.answerCbQuery(
        'âš ï¸ *Jumlah saldo maksimal adalah 10 karakter!*',
        { show_alert: true }
      );
    }
  }

  userStateData.saldo = currentSaldo;
  const newMessage =
    `ðŸ“Š *Silakan masukkan jumlah saldo yang ingin ditambahkan:*\n\n` +
    `Jumlah saldo saat ini: *${currentSaldo || '0'}*`;

  await ctx.editMessageText(newMessage, {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown',
  });
}


async function handleEditBatasCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'batasCreateAkun', 'batas create akun', 'UPDATE Server SET batas_create_akun = ? WHERE id = ?');
}

async function handleEditTotalCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'totalCreateAkun', 'total create akun', 'UPDATE Server SET total_create_akun = ? WHERE id = ?');
}

async function handleEditiplimit(ctx, userStateData, data) {
  await handleEditField(
    ctx,
    userStateData,
    data,
    'iplimit',
    'limit IP',
    'UPDATE Server SET iplimit = ? WHERE id = ?'
  );
}


async function handleEditQuota(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'quota', 'quota', 'UPDATE Server SET quota = ? WHERE id = ?');
}

async function handleEditAuth(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'auth', 'auth', 'UPDATE Server SET auth = ? WHERE id = ?');
}

async function handleEditDomain(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'domain', 'domain', 'UPDATE Server SET domain = ? WHERE id = ?');
}

async function handleEditHarga(ctx, userStateData, data) {
  let currentAmount = userStateData.amount || '';

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentAmount.length === 0) {
      return await ctx.answerCbQuery('âš ï¸ *Jumlah tidak boleh kosong!*', { show_alert: true });
    }
    const hargaBaru = parseFloat(currentAmount);
    if (isNaN(hargaBaru) || hargaBaru <= 0) {
      return ctx.reply('âŒ *Harga tidak valid. Masukkan angka yang valid.*', { parse_mode: 'Markdown' });
    }
    try {
      await updateServerField(userStateData.serverId, hargaBaru, 'UPDATE Server SET harga = ? WHERE id = ?');
      ctx.reply(`âœ… *Harga server berhasil diupdate.*\n\nðŸ“„ *Detail Server:*\n- Harga Baru: *Rp ${hargaBaru}*`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply('âŒ *Terjadi kesalahan saat mengupdate harga server.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^\d+$/.test(data)) {
      return await ctx.answerCbQuery('âš ï¸ *Hanya angka yang diperbolehkan!*', { show_alert: true });
    }
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('âš ï¸ *Jumlah maksimal adalah 12 digit!*', { show_alert: true });
    }
  }

  userStateData.amount = currentAmount;
 const newMessage = `ðŸ’° *Silakan masukkan harga server baru (paket 30 hari):*\n\nJumlah saat ini: *Rp ${currentAmount}*`;
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
  }
}
function keyboard_nomor() {
  return [
    [
      { text: '1', callback_data: '1' },
      { text: '2', callback_data: '2' },
      { text: '3', callback_data: '3' },
    ],
    [
      { text: '4', callback_data: '4' },
      { text: '5', callback_data: '5' },
      { text: '6', callback_data: '6' },
    ],
    [
      { text: '7', callback_data: '7' },
      { text: '8', callback_data: '8' },
      { text: '9', callback_data: '9' },
    ],
    [
      { text: 'âŒ«', callback_data: 'delete' },
      { text: '0', callback_data: '0' },
      { text: 'âœ…', callback_data: 'confirm' },
    ],
    [{ text: 'âŒ Batal', callback_data: 'cancel' }],
  ];
}
async function handleEditNama(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'name', 'nama server', 'UPDATE Server SET nama_server = ? WHERE id = ?');
}

async function handleEditField(ctx, userStateData, data, field, fieldName, query) {
  let currentValue = userStateData[field] || '';

if (data === 'cancel') {
  delete userState[ctx.chat.id];
  try { await ctx.answerCbQuery('âŒ Dibatalkan'); } catch {}

  const keyboard = [
    [
      { text: 'âž• Tambah Server', callback_data: 'addserver' },
      { text: 'âŒ Hapus Server', callback_data: 'deleteserver' }
    ],
    [
      { text: 'ðŸ’² Edit Harga', callback_data: 'editserver_harga' },
      { text: 'ðŸ“ Edit Nama', callback_data: 'nama_server_edit' }
    ],
    [
      { text: 'ðŸŒ Edit Domain', callback_data: 'editserver_domain' },
      { text: 'ðŸ”‘ Edit Auth', callback_data: 'editserver_auth' }
    ],
    [
      { text: 'ðŸ“Š Edit Quota', callback_data: 'editserver_quota' },
      { text: 'ðŸ“¶ Edit Limit IP', callback_data: 'editserver_limit_ip' }
    ],
    [
      { text: 'ðŸ”¢ Edit Batas Create', callback_data: 'editserver_batas_create_akun' },
      { text: 'ðŸ”¢ Edit Total Create', callback_data: 'editserver_total_create_akun' }
    ],
    [
      { text: 'ðŸ“‹ List Server', callback_data: 'listserver' },
      { text: 'â™»ï¸ Reset Server', callback_data: 'resetdb' }
    ],
    [
      { text: 'â„¹ï¸ Detail Server', callback_data: 'detailserver' }
    ],
    [
      { text: 'ðŸ”™ Kembali ke Menu Admin', callback_data: 'admin_menu' }
    ]
  ];

  try {
      await ctx.editMessageText(
        '<b>ðŸ› ï¸ MANAGEMEN SERVER</b>\n\nSilakan pilih menu di bawah:',
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
      );
    } catch (err) {
      // âœ… kalau "message is not modified", abaikan aja (jangan dianggap error)
      const desc = err?.response?.description || err?.description || '';
      if (desc.includes('message is not modified')) return;

      // fallback
      await ctx.reply(
        '<b>ðŸ› ï¸ MANAGEMEN SERVER</b>\n\nSilakan pilih menu di bawah:',
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } }
      );
    }

    return; // âœ… INI YANG BIKIN TIDAK LANJUT KE KEYPAD LAGI
  }

  if (data === 'delete') {
    currentValue = currentValue.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentValue.length === 0) {
      return await ctx.answerCbQuery(`âš ï¸ *${fieldName} tidak boleh kosong!*`, { show_alert: true });
    }
    try {
      await updateServerField(userStateData.serverId, currentValue, query);
      ctx.reply(`âœ… *${fieldName} server berhasil diupdate.*\n\nðŸ“„ *Detail Server:*\n- ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}: *${currentValue}*`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply(`âŒ *Terjadi kesalahan saat mengupdate ${fieldName} server.*`, { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^\d+$/.test(data)) {
  return await ctx.answerCbQuery('âš ï¸ *Hanya angka yang diperbolehkan!*', { show_alert: true });
}
    if (currentValue.length < 253) {
      currentValue += data;
    } else {
      return await ctx.answerCbQuery(`âš ï¸ *${fieldName} maksimal adalah 253 karakter!*`, { show_alert: true });
    }
  }

  userStateData[field] = currentValue;
  const newMessage = `ðŸ“Š *Silakan masukkan ${fieldName} server baru:*\n\n${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} saat ini: *${currentValue}*`;
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
  }
}
async function updateUserSaldo(userId, saldo) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [saldo, userId], function (err) {
      if (err) {
        logger.error('âš ï¸ Kesalahan saat menambahkan saldo user:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
// ðŸ” Helper: proses pengurangan saldo + catat transaksi pembelian akun
async function processAccountPayment(userId, amount, type, action, serverId, username) {
  // type: vmess/vless/trojan/ssh/shadowsocks
  // action: 'create' atau 'renew'

  const trxType = (action === 'create')
    ? `buy_create_${type}`
    : `buy_renew_${type}`;

  const refId = `buy-${serverId}-${username}-${Date.now()}`;

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION', (beginErr) => {
        if (beginErr) {
          logger.error('Gagal memulai transaksi pembayaran akun:', beginErr.message);
          return reject(beginErr);
        }

        db.run(
          'UPDATE users SET saldo = saldo - ? WHERE user_id = ? AND saldo >= ?',
          [amount, userId, amount],
          function (err) {
            if (err) {
              return db.run('ROLLBACK', () => {
                logger.error('Kesalahan saat mengurangi saldo pengguna:', err.message);
                reject(err);
              });
            }

            if (this.changes === 0) {
              const warnMsg = `Gagal mengurangi saldo (saldo tidak cukup) untuk user ${userId} saat proses pembelian.`;
              return db.run('ROLLBACK', () => {
                logger.warn(warnMsg);
                reject(new Error(warnMsg));
              });
            }

            db.run(
              'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
              [userId, -amount, trxType, refId, Date.now()],
              (err2) => {
                if (err2) {
                  return db.run('ROLLBACK', () => {
                    logger.error('Gagal mencatat transaksi saldo pembelian akun:', err2.message);
                    reject(err2);
                  });
                }

                db.run('COMMIT', (commitErr) => {
                  if (commitErr) {
                    logger.error('Gagal commit transaksi pembayaran akun:', commitErr.message);
                    return reject(commitErr);
                  }
                  resolve({ refId, trxType });
                });
              }
            );
          }
        );
      });
    });
  });
}

async function refundAccountPayment(userId, amount, type, action, serverId, username, reason = 'rollback_create_failed') {
  const trxType = (action === 'create')
    ? `refund_create_${type}`
    : `refund_renew_${type}`;
  const refId = `refund-${serverId}-${username}-${Date.now()}`;

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE TRANSACTION', (beginErr) => {
        if (beginErr) return reject(beginErr);

        db.run(
          'UPDATE users SET saldo = saldo + ? WHERE user_id = ?',
          [amount, userId],
          function (err) {
            if (err) return db.run('ROLLBACK', () => reject(err));
            if ((this.changes || 0) === 0) {
              return db.run('ROLLBACK', () => reject(new Error('User refund tidak ditemukan')));
            }

            db.run(
              'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
              [userId, amount, trxType, `${refId}:${reason}`, Date.now()],
              (err2) => {
                if (err2) return db.run('ROLLBACK', () => reject(err2));
                db.run('COMMIT', (commitErr) => (commitErr ? reject(commitErr) : resolve(true)));
              }
            );
          }
        );
      });
    });
  });
}

async function updateServerField(serverId, value, query) {
  return new Promise((resolve, reject) => {
    db.run(query, [value, serverId], function (err) {
      if (err) {
        // Jangan pakai fieldName karena tidak didefinisikan
        logger.error('âš ï¸ Kesalahan saat mengupdate data server:', err.message);
        return reject(err);
      }
      resolve();
    });
  });
}



function generateRandomAmount(baseAmount) {
  const random = Math.floor(Math.random() * 99) + 1;
  return baseAmount + random;
}

global.depositState = {};
global.pendingDeposits = {};
let lastRequestTime = 0;
const requestInterval = 1000;

db.all('SELECT * FROM pending_deposits WHERE status = "pending"', [], (err, rows) => {
  if (err) {
    logger.error('Gagal load pending_deposits:', err.message);
    return;
  }
  rows.forEach(row => {
    global.pendingDeposits[row.unique_code] = {
      amount: row.amount,
      originalAmount: row.original_amount,
      userId: row.user_id,
      timestamp: row.timestamp,
      status: row.status,
      qrMessageId: row.qr_message_id
    };
  });
  logger.info('Pending deposit loaded:', Object.keys(global.pendingDeposits).length);
});

// ============================================================================
// ============================================================================
// SECTION: PAYMENT - QRIS AUTO TOPUP (RAJASERVERPREMIUM GATEWAY)
// - processDeposit : buat QR dinamis (createpayment) + simpan pending
// - checkQRISStatus: cek status via gateway/mutasi tanpa branding OrderKuota
// ============================================================================

// PM2 cluster guard (biar interval cuma jalan 1x kalau pakai cluster)
const IS_PM2_PRIMARY = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

function _parseRupiahToInt(v) {
  if (typeof v === 'number') return Math.round(v);
  if (!v) return 0;
  return parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0;
}

function _getOrkutAccountId() {
  // token format: "2304754:xxxx"
  if (GOPAY_AUTH_TOKEN && String(GOPAY_AUTH_TOKEN).includes(':')) {
    return String(GOPAY_AUTH_TOKEN).split(':')[0];
  }
  return '';
}

function _getBaseQr() {
  // pakai GOPAY_BASE_QR kalau ada, fallback ke config lama lalu DATA_QRIS
  return GOPAY_BASE_QR || DATA_QRIS || '';
}

function _getTimeoutMs() {
  // pakai config kamu
  const ms = Number(QRIS_CHECK_INTERVAL_MS || 15000);
  return ms >= 2000 ? ms : 15000;
}

function _getPaymentTimeoutMin() {
  const m = Number(QRIS_PAYMENT_TIMEOUT_MIN || 5);
  return m > 0 ? m : 5;
}

function _getMinMaxTopup() {
  return {
    min: Number(QRIS_AUTO_TOPUP_MIN || 1000),
    max: Number(QRIS_AUTO_TOPUP_MAX || 300000),
  };
}

function _randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function processDeposit(ctx, amount) {
  const currentTime = Date.now();

  // Anti spam
  if (currentTime - lastRequestTime < requestInterval) {
    await ctx.editMessageText(
      'âš ï¸ *Terlalu banyak permintaan. Silakan tunggu sebentar sebelum mencoba lagi.*',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  lastRequestTime = currentTime;

  const userId = ctx.from.id;

  // batas nominal
  const amountNum = Number(amount || 0);
  const { min, max } = _getMinMaxTopup();
  if (!Number.isFinite(amountNum) || amountNum < min || amountNum > max) {
    await ctx.editMessageText(
      `âŒ *Nominal tidak valid!*\n\nMinimal: *Rp ${min.toLocaleString('id-ID')}*\nMaksimal: *Rp ${max.toLocaleString('id-ID')}*`,
      { parse_mode: 'Markdown' }
    );
    delete global.depositState[userId];
    return;
  }

  // pastikan API_KEY ada
  if (!API_KEY || API_KEY === 'NONE') {
    await ctx.editMessageText(
      'âŒ *API_KEY belum diisi.*\n\nIsi `API_KEY` di `.vars.json` dengan apikey dari rajaserverpremium.',
      { parse_mode: 'Markdown' }
    );
    delete global.depositState[userId];
    return;
  }

  const baseQr = _getBaseQr();
  if (!baseQr || baseQr.length < 10) {
    await ctx.editMessageText(
      'âŒ *QR String belum benar.*\n\nCek `GOPAY_BASE_QR` / `DATA_QRIS` di `.vars.json` (`ORDERKUOTA_BASE_QR` masih didukung sebagai fallback).',
      { parse_mode: 'Markdown' }
    );
    delete global.depositState[userId];
    return;
  }

  // Buat nominal unik (biar match pas cek status)
  const uniqueSuffix = _randomInt(1, 300);
  const finalAmount = amountNum + uniqueSuffix;
  const adminFee = uniqueSuffix;

  // kode unik internal + reference (buat info)
  const ts = Date.now();
  const uniqueCode = `TOPUP-${userId}-${ts}`;
  const referenceId = `REF-${ts}-${_randomInt(1000, 9999)}`;

  try {
    const dynamicQrText = buildDynamicQrisPayload(baseQr, finalAmount);
    const qrImageUrl = buildStaticQrisImageUrl(dynamicQrText);
    if (!qrImageUrl) {
      throw new Error('QR URL tidak valid dari QRIS dinamis');
    }

    const timeoutMin = _getPaymentTimeoutMin();
    const caption =
      `ðŸ’³ *INSTRUKSI PEMBAYARAN*

` +
      `ðŸ’° *TOP-UP:* Rp ${amountNum.toLocaleString('id-ID')}
` +
      `ðŸŽ² *ADMIN FEE:* Rp ${adminFee.toLocaleString('id-ID')}
` +
      `ðŸ’µ *TOTAL BAYAR:* Rp ${finalAmount.toLocaleString('id-ID')}

` +
      `ðŸ“Œ *CARA BAYAR:*
` +
      `1) Scan QR di atas
` +
      `2) Nominal akan terisi otomatis
` +
      `3) Pastikan bayar *tepat* Rp ${finalAmount.toLocaleString('id-ID')}

` +
      `â³ QR berlaku *${timeoutMin} menit*
` +
      `ðŸ†” Ref: \`${referenceId}\``;

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
      `INSERT INTO pending_deposits
        (unique_code, user_id, amount, original_amount, timestamp, status, qr_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uniqueCode, userId, finalAmount, amountNum, Date.now(), 'pending', qrMessage.message_id],
      (err) => {
        if (err) logger.error('âŒ Gagal insert pending_deposits:', err.message);
      }
    );

    delete global.depositState[userId];
    logger.info(`âœ… QR dynamic sent: user=${userId} amount=${finalAmount} ref=${referenceId}`);

  } catch (error) {
    logger.error('âŒ Deposit error:', error?.message || error);
    await ctx.editMessageText(
      'âŒ *GAGAL MEMBUAT PEMBAYARAN*\n\nSilakan coba lagi.',
      { parse_mode: 'Markdown' }
    );
    delete global.depositState[userId];
  }
}

async function createQrisInvoice(baseAmount, noteOrReference, forcedUniqueSuffix = null) {
  const base_amount = Number(baseAmount);
  if (!Number.isFinite(base_amount) || base_amount <= 0) {
    throw new Error('Nominal baseAmount tidak valid');
  }

  const gopayApiKey = getGopayApiKey();

  if (!gopayApiKey) {
    throw new Error('GOPAY_API_KEY belum diisi di .vars.json');
  }

  let unique_suffix = Number.isFinite(Number(forcedUniqueSuffix)) ? Number(forcedUniqueSuffix) : generateUniqueSuffix(50, 200);
  let amount = base_amount + unique_suffix;

  if (typeof QRIS_AUTO_TOPUP_MAX !== 'undefined') {
    const max = Number(QRIS_AUTO_TOPUP_MAX);
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
  }

  const generated = await generateGopayQris(amount);
  const invoice_id = String(generated.order_id || `GOPAY-${Date.now()}`);
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
    expired: parseProviderTransactionTime(generated.expiry_time) || (Date.now() + Number(QRIS_PAYMENT_TIMEOUT_MIN || 10) * 60 * 1000),
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

async function checkQRISStatus() {
  try {
    const entries = Object.entries(global.pendingDeposits || {}).filter(
      ([, d]) => d.status === 'pending'
    );
    if (entries.length === 0) return;

    const timeoutMin = Number(QRIS_PAYMENT_TIMEOUT_MIN || 10);
    const transactions = await fetchGopayTransactions();

    for (const [uniqueCode, deposit] of entries) {
      const expiredAt = deposit.expiresAt || (deposit.timestamp + (timeoutMin * 60 * 1000));
      if (Date.now() > expiredAt) {
        try {
          if (deposit.qrMessageId) {
            await bot.telegram.deleteMessage(deposit.userId, deposit.qrMessageId);
          }
        } catch (e) {}
        await markDepositExpired(uniqueCode, bot, db, logger);
        continue;
      }

      const matched = findMatchingSettlementTransaction(transactions, deposit.amount);
      if (matched) {
        await creditDeposit(uniqueCode, bot, db, logger);
        logger.info(`âœ… QRIS paid: ${uniqueCode} amount=${deposit.amount}`);
      }
    }
  } catch (error) {
    logger.error('Error in checkQRISStatus:', error?.message || error);
  }
}

// Jalankan auto check (pakai interval dari vars.json)
//if (IS_PM2_PRIMARY) {
//  setInterval(checkQRISStatus, _getTimeoutMs());
// logger.info(`âœ… Auto-topup QRIS aktif. Interval: ${_getTimeoutMs()}ms`);
//} else {
//  logger.info('â„¹ï¸ Auto-topup QRIS nonaktif di instance non-primary (PM2 cluster).');
//}

// ===== END SECTION: PAYMENT - QRIS AUTO TOPUP (RAJASERVERPREMIUM GATEWAY) ===


async function recordAccountTransaction(userId, type) {
  return new Promise((resolve, reject) => {
    const referenceId = `account-${type}-${userId}-${Date.now()}`;
    db.run(
      'INSERT INTO transactions (user_id, type, reference_id, timestamp) VALUES (?, ?, ?, ?)',
      [userId, type, referenceId, Date.now()],
      (err) => {
        if (err) {
          logger.error('Error recording account transaction:', err.message);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}
function upsertAccount(userId, username, type, serverId, expDays) {
  const nowTs  = Date.now();
  const dayMs  = 24 * 60 * 60 * 1000;

  // Ubah exp (hari) jadi mili detik yang mau DITAMBAHKAN
  let addMs = 0;
  if (expDays && Number.isFinite(expDays) && expDays > 0) {
    addMs = expDays * dayMs;
  }

  db.get(
    'SELECT id, created_at, expires_at FROM accounts WHERE user_id = ? AND username = ? AND type = ? AND server_id = ? ORDER BY id DESC LIMIT 1',
    [userId, username, type, serverId],
    (err, row) => {
      if (err) {
        logger.error('Kesalahan saat membaca tabel accounts:', err.message);
        return;
      }

      if (row) {
        // ==== RENEW: akun sudah ada, kita TAMBAH hari ====
        const oldCreated  = row.created_at || nowTs;
        const oldExpires  = row.expires_at || nowTs;

        // Kalau expired lama masih di depan, tambah dari sana.
        // Kalau sudah lewat, mulai dari sekarang.
        const baseTs      = oldExpires > nowTs ? oldExpires : nowTs;
        const newExpires  = baseTs + addMs;

        db.run(
          'UPDATE accounts SET created_at = ?, expires_at = ? WHERE id = ?',
          [oldCreated, newExpires, row.id],
          (err2) => {
            if (err2) {
              logger.error('Kesalahan memperbarui data akun di tabel accounts:', err2.message);
            } else {
              logger.info(`Accounts updated untuk user ${userId}, ${type}:${username} di server ${serverId}`);
            }
          }
        );
      } else {
        // ==== CREATE: belum ada, buat record baru ====
        const createdAt = nowTs;
        const expiresAt = addMs ? nowTs + addMs : null;

        db.run(
          'INSERT INTO accounts (user_id, username, type, server_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, username, type, serverId, createdAt, expiresAt],
          (err2) => {
            if (err2) {
              logger.error('Kesalahan menyimpan data akun ke tabel accounts:', err2.message);
            } else {
              logger.info(`Accounts inserted untuk user ${userId}, ${type}:${username} di server ${serverId}`);
            }
          }
        );
      }
    }
  );
}

if (EXPIRE_DATE) {
  const now = new Date();
  // Misal pakai zona waktu Jayapura
  const expire = new Date(EXPIRE_DATE + 'T23:59:59+09:00');

  if (now > expire) {
    console.log('âš ï¸ Lisensi bot sudah kadaluarsa. Harap hubungi pemilik panel.');
    // Kirim pesan ke admin bot kalau bisa
    try {
      const adminId = Number(vars.ADMIN_ID || envOr('MASTER_ID', MASTER_ID));
      if (adminId) {
        axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: adminId,
          text: 'Lisensi bot kamu sudah kadaluarsa. Silakan hubungi pemilik panel.'
        }).catch(() => {});
      }
    } catch (e) {}

    process.exit(1); // keluar, pm2 akan restart tapi langsung mati lagi
  }

  // Cek tiap beberapa menit saat sudah jalan
  setInterval(() => {
    const now2 = new Date();
    if (now2 > expire) {
      console.log('âš ï¸ Lisensi bot kadaluarsa saat berjalan, menghentikan bot.');
      process.exit(1);
    }
  }, 5 * 60 * 1000); // cek tiap 5 menit
}



function startQrisPaymentPolling(bot, db, logger) {
  const IS_PRIMARY_INSTANCE = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
  const qrisPollIntervalMs = Number(QRIS_CHECK_INTERVAL_MS || 15000);
  if (!IS_PRIMARY_INSTANCE) {
    logger.info('â„¹ï¸ QRIS polling nonaktif di instance non-primary (PM2 cluster).');
    return;
  }
  if (global.__qrisPollStarted) {
    logger.info(`â„¹ï¸ QRIS polling sudah aktif. Interval=${qrisPollIntervalMs}ms`);
    return;
  }

  async function getPendingQrisCount() {
    return await new Promise((resolve) => {
      db.get(`SELECT COUNT(*) AS cnt FROM qris_payments WHERE status='pending'`, [], (err, row) => {
        if (err) return resolve(-1);
        resolve(Number(row?.cnt || 0));
      });
    });
  }

  async function markQrisStatus(id, status, paidAt = null) {
    return await new Promise((resolve) => {
      if (paidAt) {
        db.run(`UPDATE qris_payments SET status=?, paid_at=? WHERE id=?`, [status, paidAt, id], () => resolve());
      } else {
        db.run(`UPDATE qris_payments SET status=? WHERE id=?`, [status, id], () => resolve());
      }
    });
  }

  async function pollQrisPaymentsStartup() {
    if (global.__pollQrisRunning) return;
    global.__pollQrisRunning = true;
    try {
      const now = Date.now();
      const timeoutMin = Number(QRIS_PAYMENT_TIMEOUT_MIN || 10);
      const rows = await new Promise((resolve, reject) => {
        const cutoff = now - ((timeoutMin + 15) * 60 * 1000);
        db.all(
          `SELECT id, user_id, invoice_id, amount, base_amount, unique_suffix, created_at
           FROM qris_payments
           WHERE status='pending' AND created_at >= ?
           ORDER BY created_at ASC
           LIMIT 50`,
          [cutoff],
          (err, rows) => (err ? reject(err) : resolve(rows || []))
        );
      });

      if (!rows.length) return;

      logger.info(`ðŸ”Ž Poll QRIS GoPay: cek ${rows.length} transaksi pending...`);

      for (const row of rows) {
        const expiresAt = Number(row.created_at) + (timeoutMin * 60 * 1000);
        if (now > expiresAt) {
          await markQrisStatus(row.id, 'expired');
          try {
            await bot.telegram.sendMessage(
              row.user_id,
              `â° <b>QRIS EXPIRED</b>
` +
                `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
` +
                `QR sudah tidak berlaku (melewati batas waktu).
` +
                `Silakan buat QRIS baru untuk topup.
` +
                `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
` +
                `Invoice: <code>${row.invoice_id}</code>`,
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'ðŸ’³ Buat QRIS Baru', callback_data: 'topupqris_btn' }],
                    [{ text: 'ðŸ  Menu Utama', callback_data: 'send_main_menu' }],
                  ],
                },
              }
            );
          } catch (_) {}
          logger.info(`âŒ› QRIS expired: invoice=${row.invoice_id} user=${row.user_id}`);
          continue;
        }

        const checkRes = await checkQrisInvoiceStatus(row.invoice_id, Number(row.amount), row.created_at);
        if (checkRes.status === 'EXPIRED') {
          await markQrisStatus(row.id, 'expired');
          try {
            await bot.telegram.sendMessage(
              row.user_id,
              `â° <b>QRIS EXPIRED</b>
` +
                `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
` +
                `QR sudah tidak berlaku (melewati batas waktu).
` +
                `Silakan buat QRIS baru untuk topup.
` +
                `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
` +
                `Invoice: <code>${row.invoice_id}</code>`,
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: 'ðŸ’³ Buat QRIS Baru', callback_data: 'topupqris_btn' }],
                    [{ text: 'ðŸ  Menu Utama', callback_data: 'send_main_menu' }],
                  ],
                },
              }
            );
          } catch (_) {}
          logger.info(`âŒ› QRIS expired: invoice=${row.invoice_id} user=${row.user_id}`);
          continue;
        }
        if (checkRes.status === 'CANCELED') {
          await markQrisStatus(row.id, 'canceled');
          logger.info(`ðŸš« QRIS canceled: invoice=${row.invoice_id} user=${row.user_id}`);
          continue;
        }
        if (checkRes.status !== 'PAID' || !checkRes.transaction) continue;

        const finalRes = await finalizeQrisPayment({
          paymentRow: row,
          matchedTx: checkRes.transaction,
          transactionType: 'qris_auto_topup',
          transactionRef: `qris_auto_${row.invoice_id}`,
        });
        if (!finalRes.applied) continue;

        const addSaldo = Number(row.base_amount);
        try {
          const { bonus, percent } = calculateTopupBonus(addSaldo);
          if (bonus > 0) {
            try {
              await applyQrisTopupBonus(row.user_id, row.invoice_id, bonus);
            } catch (e) {
              logger.error(`âš ï¸ Gagal mencatat bonus QRIS: ${e?.message || e}`);
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
          logger.error(`âš ï¸ Gagal kirim notif topup sukses: ${e?.message || e}`);
        }

        logger.info(`âœ… QRIS PAID: invoice=${row.invoice_id} user=${row.user_id} billed=${row.amount} add=${addSaldo} tx=${finalRes.providerTxId || '-'} `);
      }
    } catch (e) {
      logger.error(`âŒ pollQrisPayments fatal: ${e?.message || e}`);
    } finally {
      global.__pollQrisRunning = false;
    }
  }

  global.__qrisPollStarted = true;
  global.__qrisPollInterval = setInterval(pollQrisPaymentsStartup, qrisPollIntervalMs);
  setTimeout(() => { pollQrisPaymentsStartup().catch(() => {}); }, 2000);
  getPendingQrisCount()
    .then((pendingCount) => {
      if (pendingCount >= 0) {
        logger.info(`âœ… QRIS polling aktif. Interval=${qrisPollIntervalMs}ms, pending=${pendingCount}, source=startup`);
      } else {
        logger.info(`âœ… QRIS polling aktif. Interval=${qrisPollIntervalMs}ms, source=startup`);
      }
    })
    .catch(() => {
      logger.info(`âœ… QRIS polling aktif. Interval=${qrisPollIntervalMs}ms, source=startup`);
    });
}

// Jalankan bot
bot.launch()
  .then(() => {
    logger.info('Bot telah dimulai (build QRIS AUTO v3)');
  })
  .catch((error) => {
    logger.error('Error saat memulai bot:', error);
  });

// Jalankan scheduler di luar app.listen
startAutoTopupMutasi(bot, db, logger, axios);
startQrisPaymentPolling(bot, db, logger);
restartAutoBackupScheduler();
startDailyReportScheduler();
startExpiryReminderScheduler();
startResellerTargetScheduler();
// startQrisAutoTopupChecker(); // JANGAN dipanggil lagi di sini,
//                              // soalnya di atas sudah ada "startQrisAutoTopupChecker();"

// HTTP server
const HTTP_BIND = envOr('HTTP_BIND', '127.0.0.1');
app.listen(port, HTTP_BIND, () => {
  logger.info(`HTTP server listening on ${HTTP_BIND}:${port}`);
});

// ===== Error handler global + graceful shutdown =====
bot.catch((err, ctx) => {
  try {
    const info = ctx && ctx.update ? JSON.stringify(Object.keys(ctx.update)) : '';
    logger.error(`Telegraf error${info ? ' ' + info : ''}: ${err && err.message ? err.message : err}`);
  } catch (e) {
    logger.error(`Telegraf error (tanpa konteks): ${err && err.message ? err.message : err}`);
  }
});

let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Menerima ${signal}, shutdown...`);
  try { bot.stop(signal); } catch (e) { logger.warn(`bot.stop gagal: ${e && e.message ? e.message : e}`); }
  try {
    if (global.__qrisPollInterval) clearInterval(global.__qrisPollInterval);
  } catch (e) {}
  try { db.close(() => logger.info('SQLite closed')); } catch (e) {}
  setTimeout(() => process.exit(0), 1500).unref();
}
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error(`unhandledRejection: ${reason && reason.message ? reason.message : reason}`);
});
process.on('uncaughtException', (err) => {
  logger.error(`uncaughtException: ${err && err.message ? err.message : err}`);
});










