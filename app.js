const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const { Telegraf } = require('telegraf');
const app = express();
const axios = require('axios');
const { isUserReseller, addReseller, removeReseller, listResellersSync } = require('./modules/reseller');
const winston = require('winston');

// DB setup (connection + migrations) di-extract ke db/
const { createConnection } = require('./db/connection');
const { createDdlHelpers } = require('./db/ddl-safe');
const { runMigrations } = require('./db/migrations');

const { maskLogMessage, maskToken } = require('./lib/masker');
const {
  buildStaticQrisImageUrl,
  buildEmvTag,
  crc16Ccitt,
  removeTag54,
  buildDynamicQrisPayload,
  parseProviderTransactionTime,
  buildProviderTransactionFingerprint,
  findMatchingSettlementTransaction,
} = require('./lib/qris');
const {
  getTimeInConfiguredTimeZone: _getTimeInTZ,
  getAccountDaysLeft,
  getMonthRange: _getMonthRangeLib,
  typeCode,
  shortStatus,
} = require('./lib/time');
const { getLicenseInfo: _getLicenseInfoLib } = require('./lib/licence');
const {
  validateAccountUsernameInput,
  validateManageUsernameInput,
  validateAccountPasswordInput,
  validateAccountExpiryInput,
} = require('./lib/validators');
const {
  calculateAccountQuota,
  calculateAccountPrice,
} = require('./lib/account-pricing');
const { createAccountProviderDispatchers } = require('./lib/account-provider-dispatch');
const { formatProvisioningFailure } = require('./lib/provisioning-errors');
const { formatAccountGroupNotification } = require('./lib/account-notification');
const { createServerSlotManager } = require('./lib/server-slots');
const {
  isCancellableAccountFlowStep,
  isCancelText,
} = require('./lib/account-flow-state');
const {
  buildMainMenuMessage,
  buildMainMenuKeyboard,
} = require('./lib/main-menu');
const {
  buildAdminMenuHeader,
  buildAdminMenuKeyboard,
} = require('./lib/admin-menu');
const {
  buildTimezoneStatusText,
  buildTimezoneKeyboard: buildTimezoneKeyboardMarkup,
  buildExpiryReminderStatusText,
  buildExpiryReminderKeyboard: buildExpiryReminderKeyboardMarkup,
  buildAutoBackupStatusText,
  buildAutoBackupKeyboard: buildAutoBackupKeyboardMarkup,
} = require('./lib/admin-system-menu');
const {
  buildMyStatsText,
  buildMyStatsKeyboard,
} = require('./lib/user-stats-menu');
const {
  buildTopupQrisPromptText,
  buildTopupQrisPromptMarkup,
  buildInvalidTopupNominalText,
  buildTopupConfirmText,
  buildTopupConfirmMarkup,
  buildQrisInvoiceCaption,
  buildQrisInvoiceKeyboard,
} = require('./lib/qris-topup-menu');
const {
  buildWebLinkSuccessText,
  buildWebLinkSuccessKeyboard,
  buildWebLinkedStatusText,
  buildWebLinkedStatusKeyboard,
  buildWebLinkInstructionsText,
  buildWebLinkInstructionsKeyboard,
  buildWebUnlinkSuccessText,
  buildWebUnlinkSuccessKeyboard,
} = require('./lib/web-link-menu');
const {
  formatBotStatusLicenseText,
  formatTrialInfoText,
  buildBotStatusText,
  buildHelpAdminMessage,
  buildLicenseInfoText,
  buildHealthLicenseStatus,
  buildHealthText,
} = require('./lib/admin-status');
const {
  buildAdminServerMenuText,
  buildAdminServerMenuKeyboard,
  buildServerListText,
  buildServerMenuBackKeyboard,
  buildResetDbConfirmKeyboard,
  buildDeleteServerKeyboard,
  buildDetailServerKeyboard,
  buildEditNumericFieldPromptText,
} = require('./lib/admin-server-menu');
const {
  buildResellerListText,
  buildMemberListText,
  buildListResMemberBackKeyboard,
} = require('./lib/admin-user-list-menu');
const { buildServerStatusResultText } = require('./lib/server-status-menu');
const {
  buildQrisStatusText,
  buildQrisStatusKeyboard,
} = require('./lib/qris-status-menu');
const {
  buildAdminTrialMenuText,
  buildAdminTrialMenuKeyboard,
  buildAdminTrialSaveSuccessText,
  buildAdminTrialBackKeyboard,
} = require('./lib/admin-trial-menu');
const {
  buildFlowPickServerText,
  buildFlowPickServerKeyboard,
  buildFlowConfirmText,
  buildFlowConfirmKeyboard,
} = require('./lib/flow-trial-menu');
const {
  buildBroadcastTargetText,
  buildBroadcastTargetKeyboard,
  buildBroadcastModeText,
  buildBroadcastModeKeyboard,
  buildBroadcastCancelKeyboard,
  buildBroadcastBackToAdminKeyboard,
  buildBroadcastManualPromptText,
  buildBroadcastTemplatePromptText,
} = require('./lib/broadcast-menu');

// Masker otomatis untuk secrets di log (token Telegram, bearer, apikey, password).

const logger = winston.createLogger({
  // Bisa diatur via ENV, default 'info'
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${maskLogMessage(message)}`;
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

const { provisionAccount } = createAccountProviderDispatchers({
  createHandlers: {
    ssh: createssh,
    vmess: createvmess,
    vless: createvless,
    trojan: createtrojan,
    shadowsocks: createshadowsocks,
  },
  renewHandlers: {
    ssh: renewssh,
    vmess: renewvmess,
    vless: renewvless,
    trojan: renewtrojan,
    shadowsocks: renewshadowsocks,
  },
});

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
  minBalanceForTrial: 0,  // minimal saldo untuk bisa trial (0 = bebas)
  watchlistMaxPerDay: 1   // batas trial per hari khusus user WATCHLIST
};
// Cache in-memory untuk konfigurasi trial
let trialConfigCache = null;
let trialConfigCacheLoadedAt = 0;
const TRIAL_CONFIG_CACHE_TTL_MS = 60 * 1000; // 1 menit (boleh diubah kalau perlu)

// Baca / buat file konfigurasi trial (dengan cache in-memory)
async function getTrialConfig() {
  const now = Date.now();

  // Kalau masih dalam TTL dan cache ada → pakai cache saja
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
    // - Kalau durationHours ada → pakai itu
    // - Kalau cuma ada durationDays → konversi ke jam (x24)
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

    const watchlistMaxPerDay =
      Number.isInteger(cfg.watchlistMaxPerDay) && cfg.watchlistMaxPerDay >= 0
        ? cfg.watchlistMaxPerDay
        : DEFAULT_TRIAL_CONFIG.watchlistMaxPerDay;

    const result = {
      enabled,
      maxPerDay,
      durationHours,
      minBalanceForTrial,
      watchlistMaxPerDay,
    };

    // Simpan ke cache
    trialConfigCache = result;
    trialConfigCacheLoadedAt = Date.now();

    return result;
  } catch (err) {
    // Kalau file belum ada / rusak → tulis default
    try {
      await fsPromises.writeFile(
        trialConfigFile,
        JSON.stringify(DEFAULT_TRIAL_CONFIG, null, 2)
      );
    } catch (e) {
      logger.error('⚠️ Gagal membuat trial_config.json:', e.message);
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
    logger.error('⚠️ Gagal mengupdate trial_config.json:', e.message);
  }

  return updated;
}

// Trial counter sekarang pakai tabel SQLite `trial_usage` (PK (user_id, date)).
// `saveTrialAccess` pakai INSERT ... ON CONFLICT untuk atomic increment,
// mencegah race condition double-click yang sebelumnya ada di file JSON.
// Date key pakai TIME_ZONE lokal (via lib/time.js) bukan UTC.

function getTrialDateKey() {
  try {
    const info = getTimeInConfiguredTimeZone(TIME_ZONE);
    if (info && info.dateKey) return info.dateKey;
  } catch (_) {}
  // fallback pakai UTC kalau TZ helper belum siap (startup edge case)
  return new Date().toISOString().slice(0, 10);
}

function getTrialUsageTodayRow(userId) {
  return new Promise((resolve) => {
    const today = getTrialDateKey();
    db.get(
      'SELECT count FROM trial_usage WHERE user_id = ? AND date = ?',
      [Number(userId), today],
      (err, row) => {
        if (err) {
          logger.error('⚠️ Gagal baca trial_usage:', err.message || err);
          return resolve(0);
        }
        resolve(row && typeof row.count === 'number' ? row.count : 0);
      }
    );
  });
}

async function checkTrialAccess(userId) {
  let maxPerDay = DEFAULT_TRIAL_CONFIG.maxPerDay || 1;
  try {
    const cfg = await getTrialConfig();
    if (cfg && Number.isInteger(cfg.maxPerDay) && cfg.maxPerDay > 0) {
      maxPerDay = cfg.maxPerDay;
    }
  } catch (err) {
    if (typeof logger !== 'undefined') {
      logger.error('⚠️ Gagal membaca konfigurasi trial (maxPerDay):', err.message || err);
    }
  }
  const used = await getTrialUsageTodayRow(userId);
  return used >= maxPerDay;
}

async function getTrialUsageToday(userId) {
  return await getTrialUsageTodayRow(userId);
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
            logger.error('❌ Kesalahan saat membaca jumlah akun harian user:', err.message);
            return resolve(0); // kalau error, anggap 0 biar ga ganggu user baik
          }
          const cnt = row && row.cnt ? Number(row.cnt) : 0;
          resolve(cnt);
        }
      );
    } catch (e) {
      logger.error('❌ Error di getCreateUsageToday:', e.message || e);
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

// Atomic increment counter trial lewat SQLite (PK (user_id, date)).
// Dipakai setelah pembuatan akun trial sukses, counter bakal otomatis aman
// dari double-click race karena ON CONFLICT DO UPDATE.
async function saveTrialAccess(userId) {
  const today = getTrialDateKey();
  return new Promise((resolve) => {
    db.run(
      `INSERT INTO trial_usage (user_id, date, count) VALUES (?, ?, 1)
       ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1`,
      [Number(userId), today],
      (err) => {
        if (err) {
          logger.error('⚠️ Gagal update trial_usage:', err.message || err);
        }
        resolve();
      }
    );
  });
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
  const envKey = process.env.PAYMENT_GATEWAY_API_KEY || process.env.GOPAY_API_KEY;
  if (envKey && String(envKey).trim()) return String(envKey).trim();
  const fresh = readVarsFresh();
  return String(fresh.PAYMENT_GATEWAY_API_KEY || fresh.GOPAY_API_KEY || '').trim();
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
  envOr('PAYMENT_GATEWAY_BASE_URL', envOr('GOPAY_API_BASE_URL', envOr('GOPAY_BACKEND_BASE_URL',
  'https://pay.ketantech.my.id')));

const { createGopayClient } = require('./payment/gopay');
const gopayClient = createGopayClient({ getApiKey: getGopayApiKey, baseUrl: GOPAY_API_BASE_URL });

const { createQrisInvoiceChecker } = require('./payment/qris-invoice');
let __qrisInvoiceChecker = null;
function __getQrisInvoiceChecker() {
  if (!__qrisInvoiceChecker) {
    __qrisInvoiceChecker = createQrisInvoiceChecker({
      db,
      gopayClient,
      paymentTimeoutMin: QRIS_PAYMENT_TIMEOUT_MIN,
      getApiKey: getGopayApiKey,
      generateUniqueSuffix: (...args) => generateUniqueSuffix(...args),
      parseProviderTransactionTime: (...args) => parseProviderTransactionTime(...args),
      getMaxTopup: () => QRIS_AUTO_TOPUP_MAX,
    });
  }
  return __qrisInvoiceChecker;
}
async function checkQrisInvoiceStatus(invoiceId, billedAmount, createdAt) {
  return __getQrisInvoiceChecker().checkQrisInvoiceStatus(invoiceId, billedAmount, createdAt);
}
async function createQrisInvoice(baseAmount, noteOrReference, forcedUniqueSuffix = null) {
  return __getQrisInvoiceChecker().createQrisInvoice(baseAmount, noteOrReference, forcedUniqueSuffix);
}

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

// Supaya laporan hanya sekali per hari. Persist ke .vars.json agar survive restart.
let lastDailyReportDateKey = (vars && vars.LAST_DAILY_REPORT_DATE) || null;

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

// Supaya reminder hanya sekali per hari. Persist ke .vars.json agar survive restart.
let lastExpiryReminderDateKey = (vars && vars.LAST_EXPIRY_REMINDER_DATE) || null;

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

// --- Fase 5 lanjutan split: reseller handler "async function renderResellerBonusMenu" dipindah ke admin/reseller.js

// Tanggal kadaluarsa lisensi bot...
let EXPIRE_DATE = vars.EXPIRE_DATE || envOr('EXPIRE_DATE', null);

// Timezone yang dipakai untuk tampilan jam/tanggal lisensi & scheduler
let TIME_ZONE = vars.TIME_ZONE || envOr('TIME_ZONE', 'Asia/Jayapura'); // default awal

logger.info(`Time zone init: ${TIME_ZONE}`);

// Wrapper thin yang inject TIME_ZONE / EXPIRE_DATE ke helper lib/
function getTimeInConfiguredTimeZone() { return _getTimeInTZ(TIME_ZONE); }
function getMonthRange(offsetMonths = 0) { return _getMonthRangeLib(offsetMonths, TIME_ZONE); }
function getLicenseInfo() { return _getLicenseInfoLib(EXPIRE_DATE); }

// Helper: ambil tanggal & jam sesuai TIME_ZONE (bukan jam server)

// ===== Tambahan: helper sisa hari akun (berdasarkan TANGGAL, bukan jam) =====
// ===== Akhir helper =====


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
// Escape aman untuk interpolasi manual ke HTML Telegram
function htmlEscape(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Helper: validasi + escape input admin untuk langkah template broadcast.
// Returns { ok: true, value } kalau valid; { ok: false, reason } kalau teks
// kosong atau diawali '/' (user tidak sengaja kirim command saat input template).
function sanitizeBroadcastTemplateInput(rawText) {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (trimmed.startsWith('/')) return { ok: false, reason: 'command' };
  return { ok: true, value: htmlEscape(trimmed) };
}

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
      await ctx.answerCbQuery('Pelan-pelan ya⏳');
      return;
    }
    cbRateLimit.set(userId, now);

    // Lock tombol yang sama: cegah klik tombol yang sama berulang
    const key = `${userId}:${data}`;
    const lastSame = cbSameDataLock.get(key) || 0;
    if (now - lastSame < 1500) {
      await ctx.answerCbQuery('Sedang diproses⏳');
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

// === Helper navigasi menu admin: edit pesan kalau bisa, fallback reply ===
// Tujuan: saat admin klik tombol di menu, pesan menu di-edit langsung
// (bukan kirim pesan baru) supaya chat tidak numpuk. Cocok untuk:
//   - Pindah submenu (admin_menu → admin_server_menu → ...)
//   - Toggle setting (ON/OFF)
//   - Konfirmasi/batal aksi dengan tombol
// JANGAN dipakai untuk:
//   - Saat admin kirim teks/foto (tidak ada pesan tombol untuk di-edit)
//   - Saat hasil aksi berupa file/dokumen
//   - Saat kirim pesan ke user lain
async function editOrReply(ctx, text, extra = {}) {
  const opts = { parse_mode: 'HTML', ...extra };
  // Hanya coba edit kalau dipicu dari callback_query (klik tombol).
  if (ctx.callbackQuery && ctx.update?.callback_query?.message) {
    const msg = ctx.update.callback_query.message;
    try {
      // Kalau pesan asli berupa foto/dokumen, editMessageText akan gagal —
      // di catch kita fallback ke reply.
      if (msg.photo || msg.document || msg.video) {
        throw new Error('original message is media');
      }
      await ctx.editMessageText(text, opts);
      return;
    } catch (e) {
      const desc = e?.response?.description || e?.description || e?.message || '';
      if (desc.includes('message is not modified')) return;
      // fallback: kirim pesan baru
    }
  }
  await ctx.reply(text, opts);
}

// === Helper notifikasi singkat ke user (cbQuery / edit menu) ===
async function toast(ctx, text, { alert = false } = {}) {
  try { await ctx.answerCbQuery(text, { show_alert: alert }); } catch (_) {}
}
async function toastError(ctx, text) {
  await toast(ctx, `⚠️ ${text}`);
}
async function showErrorOnMenu(ctx, htmlText) {
  await sendCleanMenu(ctx, `⚠️ <b>Terjadi kesalahan</b>\n${htmlText}`, { parse_mode: 'HTML' });
}

// === Template pesan standar (HTML) ===
function msgSuccess(t){ return `✅ <b>Berhasil</b>\n${t}`; }
function msgError(t){ return `❌ <b>Gagal</b>\n${t}`; }
function msgInfo(t){ return `⚠️ <b>Info</b>\n${t}`; }
function rupiah(n) {
  return `Rp${Number(n || 0).toLocaleString('id-ID')}`;
}

// --- Fase 4 split: getUserSaldo dipindah ke accounts/


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
  // WAJIB stabil per-invoice untuk idempotency lintas jalur (auto poller, cek manual, retry).
  // Jangan pakai transactionRef caller karena bisa beda prefix (qris_auto_* vs qris_manual_*).
  const refIdAudit = `qris_pay_${invoiceId}`;

  if (!paymentId || !userId || !invoiceId || !Number.isFinite(baseAmount) || baseAmount <= 0) {
    throw new Error('Data finalize QRIS tidak valid');
  }

  // === Cek apakah user ini sudah link ke web ===
  // Kalau YA → saldo masuk ke web (bukan SQLite). Pattern aware-link sama
  // dengan /addsaldo & processAccountPayment supaya konsisten.
  let linkedToWeb = false;
  try {
    if (isWebLinkEnabled()) {
      const linkInfo = await getUserLinkInfo(userId);
      if (linkInfo && linkInfo.web_user_id) linkedToWeb = true;
    }
  } catch (e) {
    logger.warn('finalizeQrisPayment: gagal cek link status, fallback ke SQLite: ' + (e.message || e));
    linkedToWeb = false;
  }

  if (linkedToWeb) {
    // === PATH WEB: credit ke web SEBELUM update SQLite ===
    // Strategi: kalau web sukses → update qris_payments=paid + insert transactions
    // (sebagai audit). Saldo SQLite TIDAK di-update karena single source of
    // truth ada di web. Kalau web gagal → biarkan invoice tetap pending,
    // poller akan retry di loop berikutnya (idempotent via refId).
    let creditRes;
    try {
      creditRes = await webApiClient.creditBalance({
        telegramId: userId,
        amount: baseAmount,
        description: 'Topup QRIS otomatis (' + transactionType + ')',
        refId: refIdAudit,
      });
    } catch (eCredit) {
      logger.error(
        'finalizeQrisPayment: gagal credit ke web invoice ' + invoiceId + ': ' + (eCredit.message || eCredit) +
        '. Invoice tetap pending, poller akan retry.'
      );
      // Throw supaya poller tahu finalize gagal & retry next loop.
      throw new Error('Web credit gagal: ' + (eCredit.message || eCredit));
    }
    if (!creditRes || !creditRes.ok) {
      throw new Error('Web tidak ack credit (response.ok = false)');
    }

    // Web sukses (atau idempotent: applied=false karena refId duplicate, dianggap juga sukses).
    // Update qris_payments=paid + audit log di SQLite. Kalau gagal di sini,
    // log CRITICAL: web sudah credit, audit SQLite belum match. Kasih warning
    // ke admin tapi user tidak rugi.
    try {
      await new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
            if (err) return reject(err);
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
              (err1) => {
                if (err1) return db.run('ROLLBACK', () => reject(err1));
                db.run(
                  `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
                   VALUES (?, ?, ?, ?, ?)`,
                  [userId, baseAmount, transactionType + '_web', refIdAudit, matchedAt],
                  (err2) => {
                    if (err2) return db.run('ROLLBACK', () => reject(err2));
                    db.run('COMMIT', (err3) => err3 ? reject(err3) : resolve());
                  }
                );
              }
            );
          });
        });
      });
    } catch (eAudit) {
      logger.error(
        'CRITICAL: finalizeQrisPayment - web credit SUKSES tapi update SQLite GAGAL untuk invoice ' +
        invoiceId + ' user ' + userId + ' amount ' + baseAmount + ' refId ' + refIdAudit + ': ' +
        (eAudit.message || eAudit) + '. Saldo web sudah masuk, tapi qris_payments mungkin masih pending. Cek manual!'
      );
      // Tetap return applied=true karena dari sisi user, saldo sudah masuk.
    }

    return { applied: true, alreadyPaid: false, paidAt, matchedAt, source: 'web' };
  }

  // === PATH SQLite (legacy, untuk user yang belum link) ===
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
                      [userId, baseAmount, transactionType, refIdAudit, matchedAt],
                      (err3) => {
                        if (err3) {
                          return db.run('ROLLBACK', () => reject(err3));
                        }

                        db.run('COMMIT', (err4) => {
                          if (err4) return reject(err4);
                          resolve({ applied: true, alreadyPaid: false, paidAt, matchedAt, source: 'sqlite' });
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

  // === Cek apakah user ini sudah link ke web ===
  // Pattern aware-link sama dengan finalizeQrisPayment & /addsaldo. User
  // linked → bonus push ke web; user belum link → SQLite (legacy).
  let linkedToWeb = false;
  try {
    if (isWebLinkEnabled()) {
      const linkInfo = await getUserLinkInfo(uid);
      if (linkInfo && linkInfo.web_user_id) linkedToWeb = true;
    }
  } catch (e) {
    logger.warn('applyQrisTopupBonus: gagal cek link status, fallback ke SQLite: ' + (e.message || e));
    linkedToWeb = false;
  }

  if (linkedToWeb) {
    // === PATH WEB: bonus credit ke web (idempotent via refId) ===
    try {
      const credRes = await webApiClient.creditBalance({
        telegramId: uid,
        amount: bonus,
        description: 'Bonus topup QRIS auto',
        refId, // 'qris_bonus_<invoice>' → web reject duplicate
      });
      if (!credRes || !credRes.ok) {
        throw new Error('Web tidak ack credit bonus');
      }

      // Catat audit di transactions SQLite. Kalau gagal, log warning saja —
      // bonus sudah masuk ke web, audit trail telat tidak fatal.
      try {
        await new Promise((resolve) => {
          db.run(
            `INSERT INTO transactions (user_id, amount, type, reference_id, timestamp)
             VALUES (?, ?, ?, ?, ?)`,
            [uid, bonus, 'qris_topup_bonus_web', refId, now],
            (err) => {
              if (err) {
                logger.warn('applyQrisTopupBonus: gagal catat audit SQLite (non-fatal): ' + (err.message || err));
              }
              resolve();
            }
          );
        });
      } catch (_) { /* swallow */ }

      return { applied: true, alreadyApplied: !credRes.applied, refId, source: 'web' };
    } catch (eCredit) {
      logger.error(
        'applyQrisTopupBonus: gagal credit bonus ke web invoice ' + inv + ': ' +
        (eCredit.message || eCredit) + '. Bonus tidak masuk, tapi topup utama sudah masuk.'
      );
      // Tidak throw — biar topup utama tetap dianggap sukses. Bonus bisa
      // dicredit manual oleh admin via curl atau /addsaldo.
      return { applied: false, error: eCredit.message || String(eCredit) };
    }
  }

  // === PATH SQLite (legacy untuk user yang belum link) ===
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
                      resolve({ applied: true, alreadyApplied: false, refId, source: 'sqlite' });
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
  lines.push(`✅ <b>TOPUP BERHASIL</b>`);
  lines.push(`Metode: <b>${method || 'QRIS'}</b>`);
  lines.push(`Nominal: <b>${rupiah(baseAmount)}</b>`);
  if (Number(bonusAmount) > 0) {
    lines.push(`Bonus: <b>${rupiah(bonusAmount)}</b> <i>(${percent || 0}%)</i>`);
  }
  lines.push(`Total masuk: <b>${rupiah(total)}</b>`);
  if (saldoNow != null) lines.push(`Saldo sekarang: <b>${rupiah(saldoNow)}</b>`);
  lines.push(`Ref: <code>${ref}</code>`);
  lines.push(`\nTerima kasih 🙏`);

  try {
    await bot.telegram.sendMessage(userId, lines.join('\n'), { parse_mode: 'HTML' });
  } catch {}

// 2) Notif ke grup (kalau diaktifkan)
try {
  if (NOTIF_TOPUP_GROUP && GROUP_ID) {
    const saldoMasuk = Number(baseAmount || 0) + Number(bonusAmount || 0);

    const gLines = [];
    gLines.push(`✅ <b>TOPUP SUCCESS</b>`);
    gLines.push(`━━━━━━━━━━━━━━━━━━`);
    gLines.push(`👤 <b>User:</b> ${who}`);
    gLines.push(`🆔 <b>ID:</b> <code>${userId}</code>`);
    gLines.push(`💳 <b>Metode:</b> QRIS`);
    gLines.push(`💰 <b>Nominal:</b> ${rupiah(baseAmount)}`);
    gLines.push(`🎁 <b>Bonus:</b> ${rupiah(bonusAmount || 0)}`);
    gLines.push(`💰 <b>Saldo Masuk:</b> ${rupiah(saldoMasuk)}`);
    gLines.push(`🧾 <b>Ref:</b> <code>${ref}</code>`);
    gLines.push(`🕒 <b>Waktu:</b> ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' })}`);
    gLines.push(`━━━━━━━━━━━━━━━━━━`);

    await bot.telegram.sendMessage(GROUP_ID, gLines.join('\n'), { parse_mode: 'HTML' });
  }
} catch {}
}

async function notifyTopupExpired({ bot, userId, ref }) {
  const txt =
    `⏰ <b>QRIS Expired</b>\n` +
    `Ref: <code>${ref}</code>\n` +
    `QRIS kamu sudah lewat batas waktu.\n` +
    `Silakan buat QRIS baru dari menu topup.`;
  try { await bot.telegram.sendMessage(userId, txt, { parse_mode: 'HTML' }); } catch {}
}

// ===== Helper: indikator menunggu saat proses panjang =====
async function startWaiting(ctx, text = '⏳ Sedang membuat akun...') {
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
      await sendCleanMenu(ctx,
        buildFlowPickServerText(st),
        { parse_mode:'HTML', reply_markup: buildFlowPickServerKeyboard(rows) }
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

  const srow = await new Promise((resolve)=> {
    db.get(`SELECT nama_server FROM Server WHERE id=?`, [serverId], (e, r) => resolve(r || null));
  });

  const msg = buildFlowConfirmText({
    type: st.type,
    serverName: srow?.nama_server,
    serverId,
    username,
    durationHours: trialCfg.durationHours,
  });

  await sendCleanMenu(ctx, msg, { parse_mode:'HTML', reply_markup: buildFlowConfirmKeyboard() });
}

// =====================================================
// Pengaman transaksi penting (create / trial / renew / topup)
// Mencegah dobel proses walau callback terkirim ulang
// =====================================================
const txLock = new Map(); // userId -> { action, until }

// Lock khusus flow trial yang jalan di bot.on('text'), bukan callback.
// Mencegah double-click text message dari user yang sama lolos double trial
// karena checkTrialAccess -> saveTrialAccess ada race window (file JSON).
const trialLock = new Set();

const { isTxAction } = require('./lib/service-action-router');

bot.on('callback_query', async (ctx, next) => {
  const userId = ctx.from?.id;
  const data = ctx.callbackQuery?.data || '';
  if (!userId || !isTxAction(data)) return next();

  const now = Date.now();
  const lock = txLock.get(userId);

  // kalau masih dalam lock window, hentikan proses
  if (lock && now < lock.until) {
    await ctx.answerCbQuery(`⏳ Sedang diproses (${lock.action})`, { show_alert: false });
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
      'ℹ️ <b>Mode input API key GoPay aktif.</b>\n\n' +
      'Silakan kirim API key baru pada pesan berikutnya.\n' +
      'API key akan disimpan ke <code>.vars.json</code> dan langsung dipakai tanpa restart.\n\n' +
      'Alternatif cepat:\n' +
      '• <code>/setgopayapikey API_KEY_BARU</code>\n' +
      '• reply pesan API key dengan <code>/setgopayapikey</code>\n\n' +
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
      '✅ <b>GOPAY_API_KEY berhasil diperbarui.</b>\n\n' +
      'Request GoPay berikutnya akan langsung memakai API key baru tanpa restart bot.',
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('Gagal menyimpan GOPAY_API_KEY:', e.message || e);
    return ctx.reply(
      '❌ <b>Gagal menyimpan GOPAY_API_KEY.</b>\n' +
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
  return ctx.reply('⛔ Mode input API key GoPay dibatalkan.', { parse_mode: 'HTML' });
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
      '✅ <b>GOPAY_API_KEY berhasil diperbarui.</b>\n\n' +
      'Request GoPay berikutnya akan langsung memakai API key baru tanpa restart bot.',
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('Gagal menyimpan GOPAY_API_KEY via mode input:', e.message || e);
    return ctx.reply(
      '❌ <b>Gagal menyimpan GOPAY_API_KEY.</b>\n' +
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
    const transactions = await gopayClient.fetchTransactions();
    return ctx.reply(
      `✅ <b>API key GoPay valid.</b>\n\nAPI key aktif: <code>${maskedApiKey}</code>\nEndpoint: <code>${GOPAY_API_BASE_URL}/transactions</code>\nBerhasil ambil <b>${transactions.length}</b> transaksi dari endpoint mutasi.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    const status = e?.response?.status;
    const apiMsg = e?.response?.data?.message || e?.message || e;
    logger.error(`Cek GOPAY API key gagal (${status || 'no-status'}): ${apiMsg}`);
    return ctx.reply(
      '❌ <b>API key GoPay gagal dipakai.</b>\n\n' +
      `Status: <code>${status || '-'}</code>\n` +
      `Pesan: <code>${String(apiMsg)}</code>`,
      { parse_mode: 'HTML' }
    );
  }
}

bot.command('cekgopayapikey', handleCheckGopayApiKey);

// ====== FUNGSI INFO LISENSI BOT ======
// ====== AKHIR FUNGSI INFO LISENSI ======

// === MIDDLEWARE KUNCI LISENSI ===
bot.use(async (ctx, next) => {
  // Kalau EXPIRE_DATE belum di-set → anggap free, jangan blokir
  if (!EXPIRE_DATE) {
    return next();
  }

  const info = getLicenseInfo();
  if (!info) {
    return next();
  }

  // Kalau lisensi masih aktif → lanjut ke handler berikutnya
  if (info.daysLeft > 0) {
    return next();
  }

  // Kalau yang akses adalah MASTER → tetap boleh lanjut (biar bisa /addhari dll)
  if (ctx.from && ctx.from.id === MASTER_ID) {
    return next();
  }

  // Selain MASTER: blokir, kasih info lisensi habis
  try {
    await ctx.reply(
      '⛔ *Bot sementara nonaktif karena lisensi sudah habis.*\n' +
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


// --- Fase 6 split: function restartAutoBackupScheduler() dipindah ke scheduler/

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
const db = createConnection(null, logger);
const serverSlotManager = createServerSlotManager({ db, logger });
const { ensureSqliteColumn, createUniqueIndexIfSafe, createUniqueIndexMultiIfSafe } = createDdlHelpers(db, logger);
runMigrations(db, logger, { ensureSqliteColumn, createUniqueIndexIfSafe, createUniqueIndexMultiIfSafe });

// Migrasi satu-kali: import counter dari trial.db JSON ke tabel trial_usage.
// Dijalankan sekali saat startup kalau file lama masih ada. Data JSON tidak
// dihapus, cuma di-rename ke .migrated supaya bisa dipakai ulang kalau perlu.
(function importLegacyTrialDb() {
  try {
    if (!fs.existsSync(trialFile)) return;
    const raw = fs.readFileSync(trialFile, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    const entries = Object.entries(parsed);
    if (!entries.length) return;

    db.serialize(() => {
      const stmt = db.prepare(
        `INSERT INTO trial_usage (user_id, date, count) VALUES (?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET count = MAX(count, excluded.count)`
      );
      let imported = 0;
      for (const [uid, entry] of entries) {
        const userId = Number(uid);
        if (!Number.isFinite(userId)) continue;
        let date = null;
        let count = 0;
        if (typeof entry === 'string') {
          date = entry;
          count = 1;
        } else if (entry && typeof entry === 'object' && entry.date) {
          date = entry.date;
          count = Number.isInteger(entry.count) ? entry.count : 1;
        }
        if (!date || !count) continue;
        stmt.run(userId, date, count);
        imported++;
      }
      stmt.finalize((err) => {
        if (err) {
          logger.error('Gagal import trial.db legacy:', err.message || err);
          return;
        }
        try {
          fs.renameSync(trialFile, trialFile + '.migrated');
          logger.info(`trial.db JSON diimport (${imported} entri) -> trial_usage, file lama di-rename ke trial.db.migrated`);
        } catch (e) {
          logger.warn('Gagal rename trial.db ke trial.db.migrated:', e.message || e);
        }
      });
    });
  } catch (e) {
    logger.warn('Lewati import trial.db legacy (file tidak valid / tidak bisa dibaca):', e.message || e);
  }
})();

// Start / restart scheduler auto-backup

// --- Fase 6 split: scheduler factory (scheduler/*.js)
const { createAutoBackupScheduler } = require('./scheduler/auto-backup');
const { createDailyReportScheduler } = require('./scheduler/daily-report');
const { createExpiryReminderScheduler } = require('./scheduler/expiry-reminder');
const { createResellerTargetScheduler } = require('./scheduler/reseller-target');

const __autoBackupScheduler = createAutoBackupScheduler({
  logger,
  bot,
  isEnabled: () => AUTO_BACKUP_ENABLED,
  getIntervalHours: () => AUTO_BACKUP_INTERVAL_HOURS,
  getBackupChatId: () => BACKUP_CHAT_ID,
  getTimeZone: () => TIME_ZONE,
  baseDir: __dirname,
});
function restartAutoBackupScheduler() { __autoBackupScheduler.restart(); }
const sendAutoBackup = (...args) => __autoBackupScheduler.sendAutoBackup(...args);

const __dailyReportScheduler = createDailyReportScheduler({
  logger,
  db,
  bot,
  getTimeInConfiguredTimeZone: () => getTimeInConfiguredTimeZone(),
  getTimeZone: () => TIME_ZONE,
  getMasterId: () => MASTER_ID,
  getResselFilePath: () => resselFilePath,
  getUsernameById: (...args) => getUsernameById(...args),
  isEnabled: () => DAILY_REPORT_ENABLED,
  getHour: () => DAILY_REPORT_HOUR,
  getMinute: () => DAILY_REPORT_MINUTE,
  getLastSentDateKey: () => lastDailyReportDateKey,
  setLastSentDateKey: (v) => {
    lastDailyReportDateKey = v;
    try { writeVarsPartial({ LAST_DAILY_REPORT_DATE: v }); }
    catch (e) { logger.warn('Gagal persist LAST_DAILY_REPORT_DATE: ' + (e && e.message ? e.message : e)); }
  },
});
function startDailyReportScheduler() { __dailyReportScheduler.start(); }
const sendDailyReport = (...args) => __dailyReportScheduler.sendDailyReport(...args);

const __expiryReminderScheduler = createExpiryReminderScheduler({
  logger,
  db,
  bot,
  getTimeInConfiguredTimeZone: () => getTimeInConfiguredTimeZone(),
  getTimeZone: () => TIME_ZONE,
  getMasterId: () => MASTER_ID,
  getDaysBefore: () => EXPIRY_REMINDER_DAYS_BEFORE,
  isEnabled: () => EXPIRY_REMINDER_ENABLED,
  getHour: () => EXPIRY_REMINDER_HOUR,
  getMinute: () => EXPIRY_REMINDER_MINUTE,
  getLastSentDateKey: () => lastExpiryReminderDateKey,
  setLastSentDateKey: (v) => {
    lastExpiryReminderDateKey = v;
    try { writeVarsPartial({ LAST_EXPIRY_REMINDER_DATE: v }); }
    catch (e) { logger.warn('Gagal persist LAST_EXPIRY_REMINDER_DATE: ' + (e && e.message ? e.message : e)); }
  },
});
function startExpiryReminderScheduler() { __expiryReminderScheduler.start(); }
const sendExpiryReminders = (...args) => __expiryReminderScheduler.sendExpiryReminders(...args);

const __resellerTargetScheduler = createResellerTargetScheduler({
  logger,
  db,
  bot,
  getTimeInConfiguredTimeZone: () => getTimeInConfiguredTimeZone(),
  getTimeZone: () => TIME_ZONE,
  getMasterId: () => MASTER_ID,
  getMin30dAccounts: () => RESELLER_TARGET_MIN_30D_ACCOUNTS,
  getMinDaysPerMonth: () => RESELLER_TARGET_MIN_DAYS_PER_MONTH,
  readResellerSetSync: () => readResellerSetSync(),
  removeResellerIdFromCache: (uid) => removeResellerIdFromCache(uid),
  isEnabled: () => RESELLER_TARGET_ENABLED,
  getCheckHour: () => RESELLER_TARGET_CHECK_HOUR,
  getCheckMinute: () => RESELLER_TARGET_CHECK_MINUTE,
  getLastProcessedMonthKey: () => lastResellerTargetMonthKey,
  setLastProcessedMonthKey: (v) => { lastResellerTargetMonthKey = v; },
});
function startResellerTargetScheduler() { __resellerTargetScheduler.start(); }
const checkAndDowngradeResellersForPreviousMonth = (...args) =>
  __resellerTargetScheduler.checkAndDowngradeResellersForPreviousMonth(...args);


// ============================================================================
// SECTION: WEB API LINKAGE (ketantech.my.id)
// Dideklarasikan di sini (sebelum accountService) supaya bisa di-inject ke
// account service. Account service jadi sadar-link: user yang sudah link akan
// pakai saldo web sebagai single source of truth, sementara user belum link
// tetap pakai SQLite (perilaku legacy).
// Konfigurasi di .vars.json:
//   WEB_LINK_ENABLED  - master switch (default: false sampai web siap)
//   WEB_API_BASE_URL  - mis. "https://ketantech.my.id/api"
//   WEB_DOMAIN        - URL public web (untuk pesan ke user)
//   WEB_API_BOT_KEY   - shared secret antara bot & web (hardcoded, jangan publik)
//   WEB_API_TIMEOUT_MS - default 15000
// Kalau salah satu kosong, fitur link otomatis di-disable (bot fallback ke
// SQLite lokal seperti sebelumnya).
// ============================================================================
const { createWebApiClient } = require('./modules/web-api-client');
function getWebApiBaseUrl() {
  return String(envOr('WEB_API_BASE_URL', '') || '').trim();
}
function getWebApiBotKey() {
  return String(envOr('WEB_API_BOT_KEY', '') || '').trim();
}
function getWebApiTimeout() {
  const v = Number(envOr('WEB_API_TIMEOUT_MS', 15000));
  return Number.isFinite(v) && v > 0 ? v : 15000;
}
function getWebDomain() {
  return String(envOr('WEB_DOMAIN', '') || '').trim();
}
function isWebLinkEnabled() {
  const flag = envOr('WEB_LINK_ENABLED', false);
  if (typeof flag === 'boolean') return flag;
  if (typeof flag === 'string') return flag.toLowerCase() === 'true';
  return !!flag;
}
const webApiClient = createWebApiClient({
  getBaseUrl: getWebApiBaseUrl,
  getBotKey: getWebApiBotKey,
  getTimeout: getWebApiTimeout,
  logger,
});
logger.info(
  'Web API linkage init: enabled=' + isWebLinkEnabled() +
  ', baseUrl=' + (getWebApiBaseUrl() || '<empty>') +
  ', domain=' + (getWebDomain() || '<empty>') +
  ', botKey=' + (getWebApiBotKey() ? maskToken(getWebApiBotKey()) : '<empty>')
);

// Helper: ambil status link (web_user_id) untuk user telegram.
// Dipanggil oleh accountService dan getEffectiveBalance.
function getUserLinkInfo(userId) {
  return new Promise((resolve) => {
    db.get(
      'SELECT web_user_id, web_linked_at FROM users WHERE user_id = ?',
      [Number(userId)],
      (err, row) => {
        if (err) return resolve(null);
        if (!row || !row.web_user_id) return resolve(null);
        resolve(row);
      }
    );
  });
}

// --- Fase 4 split: account service (accounts/service.js)
const { createAccountService } = require('./accounts/service');
const accountService = createAccountService({
  db,
  logger,
  webApiClient,
  getLinkInfo: getUserLinkInfo,
  isWebLinkEnabled,
});
const {
  getUserSaldo: _accountGetUserSaldo,
  recordSaldoTransaction,
  recordAccountTransaction,
  processAccountPayment,
  refundAccountPayment,
  upsertAccount,
} = accountService;
// Wrapper getUserSaldo tetap menerima (db, userId) untuk kompatibilitas call-site lama.
// Sekarang return saldo "efektif" — dari web kalau user sudah link, dari SQLite
// kalau belum.
async function getUserSaldo(dbArg, userId) {
  return _accountGetUserSaldo(userId);
}

// Helper: ambil flag_status user dari tabel users.
// Return string: 'NORMAL' | 'WATCHLIST' | 'NAKAL'. Kalau error / user tidak ada
// → 'NORMAL' (default aman, tidak memblokir user).
async function getUserFlagStatus(userId) {
  return await new Promise((resolve) => {
    db.get(
      'SELECT flag_status FROM users WHERE user_id = ?',
      [userId],
      (err, row) => {
        if (err) {
          logger.warn('getUserFlagStatus error: ' + (err.message || err));
          return resolve('NORMAL');
        }
        const raw = row && row.flag_status ? String(row.flag_status).trim().toUpperCase() : 'NORMAL';
        if (raw === 'WATCHLIST' || raw === 'NAKAL') {
          resolve(raw);
        } else {
          resolve('NORMAL');
        }
      }
    );
  });
}

// Helper: ambil username Telegram dari bot.telegram.getChat.
// Dipakai untuk label laporan harian + daftar user admin. Return string atau '' kalau gagal.
async function getUsernameById(userId) {
  try {
    const chat = await bot.telegram.getChat(userId);
    if (chat && chat.username) return String(chat.username);
    if (chat && chat.first_name) {
      return chat.last_name ? (chat.first_name + ' ' + chat.last_name) : chat.first_name;
    }
  } catch (e) {
    // Telegram mungkin balikin 400 kalau user belum /start ke bot. Silent.
  }
  return '';
}




// --- Fase 3 split: fungsi markDepositExpired / creditDeposit / pollMutasi / startAutoTopupMutasi
// dipindah ke payment/deposit.js (createDepositManager). Wrapper di-assign di bagian bawah.
// State in-memory deposit dipindah ke `state/deposit-state.js` supaya tidak nempel
// di `global.*`. Object yang sama di-share antar file lewat module cache.
const { depositState, pendingDeposits } = require('./state/deposit-state');

// ======================= END SECTION: PAYMENT - DATABASE TABLES =============

// ============================================================================


// --- Fase 4 split: recordSaldoTransaction dipindah ke accounts/

const adminTrialTemp = {}; // key: adminId, value: config trial sementara

const userState = {};

// === Session TTL cleanup (anti memory leak) ===
// Setiap entry di userState/broadcastSessions/adminState/adminTrialTemp/depositState
// di-stamp `__t` pertama kali ketemu sweeper. Kalau entry sudah ada > TTL, dihapus.
// User yang masih aktif akan reset state lewat /start atau klik tombol baru.
const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function sweepStaleEntries(bag, label) {
  if (!bag || typeof bag !== 'object') return 0;
  const now = Date.now();
  let purged = 0;
  for (const key of Object.keys(bag)) {
    const entry = bag[key];
    if (entry && typeof entry === 'object') {
      if (typeof entry.__t !== 'number') {
        entry.__t = now;
        continue;
      }
      if (now - entry.__t > SESSION_TTL_MS) {
        delete bag[key];
        purged++;
      }
    } else {
      // Entry primitif (jarang) atau null — hapus saja kalau bukan kosong.
      if (entry === null || entry === undefined) delete bag[key];
    }
  }
  if (purged > 0) {
    logger.info(`Session sweeper: ${purged} entri ${label} stale dihapus (TTL ${SESSION_TTL_MS / 60000}m).`);
  }
  return purged;
}

if (!global.__sessionSweeperStarted) {
  global.__sessionSweeperStarted = true;
  setInterval(() => {
    try {
      sweepStaleEntries(userState, 'userState');
      sweepStaleEntries(broadcastSessions, 'broadcastSessions');
      sweepStaleEntries(adminState, 'adminState');
      sweepStaleEntries(adminTrialTemp, 'adminTrialTemp');
      sweepStaleEntries(depositState, 'depositState');
    } catch (e) {
      logger.error('Session sweeper error:', e.message || e);
    }
  }, SESSION_SWEEP_INTERVAL_MS).unref?.();
}

// --- Fase 4 split: handler 'Akun Saya' dipindah ke accounts/my-accounts.js
const { createMyAccountsHandlers } = require('./accounts/my-accounts');
const myAccountsHandlers = createMyAccountsHandlers({
  bot,
  db,
  logger,
  userState,
  sendCleanMenu,
  recordAccountTransaction,
  getAccountDaysLeft,
  typeCode,
  shortStatus,
  delHandlers: { vmess: delvmess, vless: delvless, trojan: deltrojan, shadowsocks: delshadowsocks, ssh: delssh },
  lockHandlers: { vmess: lockvmess, vless: lockvless, trojan: locktrojan, shadowsocks: lockshadowsocks, ssh: lockssh },
  unlockHandlers: { vmess: unlockvmess, vless: unlockvless, trojan: unlocktrojan, shadowsocks: unlockshadowsocks, ssh: unlockssh },
});
const showMyAccounts = myAccountsHandlers.showMyAccounts;
myAccountsHandlers.register();

// ============================================================================
// SECTION: PAKET EDUKASI (vpnbiz reseller API)
// - Wrapper HTTP, business logic, handler user, handler admin.
// - API key disimpan di .vars.json (VPNBIZ_API_KEY), bisa di-rotate via
//   /setvpnbizapikey <key> tanpa restart bot.
// - Harga jual & limit trial tersimpan di .vars.json juga, dengan default
//   yang di-tweak via tombol +/- di admin menu.
// ============================================================================
const { createEdukasiClient } = require('./modules/edukasi-client');
const { createEdukasiService } = require('./modules/edukasi');
const { createEdukasiHandlers } = require('./modules/edukasi-handlers');
const { createEdukasiAdminHandlers } = require('./admin/edukasi');

// (SECTION WEB API LINKAGE dipindah ke atas, sebelum createAccountService,
//  supaya webApiClient bisa di-inject ke account service.)

function getVpnbizApiKey() {
  const envKey = process.env.VPNBIZ_API_KEY;
  if (envKey && String(envKey).trim()) return String(envKey).trim();
  const fresh = readVarsFresh();
  return String(fresh.VPNBIZ_API_KEY || '').trim();
}

const edukasiClient = createEdukasiClient({
  getApiKey: getVpnbizApiKey,
  baseUrl: vars.VPNBIZ_BASE_URL || undefined,
  logger,
});

// State harga & limit trial Paket Edukasi (default: Opsi B)
let __edukasiPriceMemberMonthly = Number(
  (vars.EDUKASI_PRICE_MEMBER_MONTHLY != null) ? vars.EDUKASI_PRICE_MEMBER_MONTHLY : 15000
);
let __edukasiPriceMemberWeekly = Number(
  (vars.EDUKASI_PRICE_MEMBER_WEEKLY != null) ? vars.EDUKASI_PRICE_MEMBER_WEEKLY : 5000
);
let __edukasiPriceResellerMonthly = Number(
  (vars.EDUKASI_PRICE_RESELLER_MONTHLY != null) ? vars.EDUKASI_PRICE_RESELLER_MONTHLY : 12000
);
let __edukasiPriceResellerWeekly = Number(
  (vars.EDUKASI_PRICE_RESELLER_WEEKLY != null) ? vars.EDUKASI_PRICE_RESELLER_WEEKLY : 4000
);
let __edukasiTrialMaxPerDay = Number(
  (vars.EDUKASI_TRIAL_MAX_PER_DAY != null) ? vars.EDUKASI_TRIAL_MAX_PER_DAY : 1
);

// Link paket Ilmupedia Telkomsel (untuk shortcut beli paket di menu Direct EDU).
// Disimpan sebagai array `[{ label, url }]` di .vars.json key ILMUPEDIA_LINKS.
// Bisa diedit lewat menu admin → Akun Direct EDU → Atur Link Paket Ilmupedia.
let __ilmupediaLinks = (() => {
  const raw = vars.ILMUPEDIA_LINKS;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it) => it && typeof it === 'object' && it.label && it.url)
    .map((it) => ({ label: String(it.label), url: String(it.url) }));
})();

function getEdukasiPriceConfig() {
  return {
    MEMBER_MONTHLY: __edukasiPriceMemberMonthly,
    MEMBER_WEEKLY: __edukasiPriceMemberWeekly,
    RESELLER_MONTHLY: __edukasiPriceResellerMonthly,
    RESELLER_WEEKLY: __edukasiPriceResellerWeekly,
  };
}

const edukasiService = createEdukasiService({
  db,
  logger,
  edukasiClient,
  accountService,
  isResellerId, // hoisted function declaration
  getPriceConfig: getEdukasiPriceConfig,
  getTrialMaxPerDay: () => __edukasiTrialMaxPerDay,
  getTimeZone: () => TIME_ZONE,
});

const edukasiHandlers = createEdukasiHandlers({
  bot,
  logger,
  edukasiService,
  isResellerId,
  ensurePrivateChat,
  sendCleanMenu,
  userState,
  getPriceConfig: getEdukasiPriceConfig,
  getIlmupediaLinks: () => __ilmupediaLinks,
  // Notif grup pakai flag yang sama dengan notif topup/buat akun lokal,
  // supaya admin cukup atur 1 toggle (NOTIF_TOPUP_GROUP) di .vars.json.
  getGroupId: () => GROUP_ID,
  isGroupNotifyEnabled: () => !!NOTIF_TOPUP_GROUP,
  getTimeZone: () => TIME_ZONE,
});
edukasiHandlers.register();

const edukasiAdmin = createEdukasiAdminHandlers({
  bot,
  logger,
  ADMIN_IDS,
  edukasiClient,
  edukasiService,
  state: {
    getMemberMonthly: () => __edukasiPriceMemberMonthly,
    setMemberMonthly: (v) => { __edukasiPriceMemberMonthly = Math.max(0, Number(v) || 0); },
    getMemberWeekly: () => __edukasiPriceMemberWeekly,
    setMemberWeekly: (v) => { __edukasiPriceMemberWeekly = Math.max(0, Number(v) || 0); },
    getResellerMonthly: () => __edukasiPriceResellerMonthly,
    setResellerMonthly: (v) => { __edukasiPriceResellerMonthly = Math.max(0, Number(v) || 0); },
    getResellerWeekly: () => __edukasiPriceResellerWeekly,
    setResellerWeekly: (v) => { __edukasiPriceResellerWeekly = Math.max(0, Number(v) || 0); },
    getTrialMaxPerDay: () => __edukasiTrialMaxPerDay,
    setTrialMaxPerDay: (v) => { __edukasiTrialMaxPerDay = Math.max(0, Math.min(50, Number(v) || 0)); },
    getIlmupediaLinks: () => __ilmupediaLinks,
    setIlmupediaLinks: (arr) => {
      if (!Array.isArray(arr)) { __ilmupediaLinks = []; return; }
      __ilmupediaLinks = arr
        .filter((it) => it && typeof it === 'object' && it.label && it.url)
        .map((it) => ({ label: String(it.label), url: String(it.url) }));
    },
  },
  updateVarsPartial: writeVarsPartial,
  adminState,
});
edukasiAdmin.register();

// Middleware text untuk konsumsi input multi-step Paket Edukasi (user) dan
// input API key vpnbiz (admin). Diletakkan SEBELUM bot.on('text') global
// di bawah, supaya step input edukasi tidak diserap handler global.
bot.on('text', async (ctx, next) => {
  if (!ctx || !ctx.from) return next();
  if (ctx.chat && ctx.chat.type !== 'private') return next();
  try {
    if (await edukasiAdmin.handleTextStep(ctx)) return;
    if (await edukasiHandlers.handleTextStep(ctx)) return;
  } catch (e) {
    logger.error('Edukasi text middleware error:', e.message || e);
  }
  return next();
});

logger.info(
  'Paket Edukasi init: member ' + __edukasiPriceMemberMonthly + '/bln, '
  + __edukasiPriceMemberWeekly + '/mgu | reseller '
  + __edukasiPriceResellerMonthly + '/bln, ' + __edukasiPriceResellerWeekly + '/mgu | trial '
  + __edukasiTrialMaxPerDay + 'x/hari'
);

logger.info('User state initialized');
// Pesan standar untuk akses ditolak
const NO_ACCESS_MESSAGE = '🚫 Kamu tidak punya akses untuk perintah ini.';
// Pesan standar untuk perintah khusus pemilik bot (MASTER)
const MASTER_ONLY_MESSAGE =
  '⚠️ <b>Perintah ini hanya bisa digunakan oleh pemilik bot (MASTER).</b>';

// Pastikan perintah hanya dipakai di private chat
function ensurePrivateChat(ctx) {
  const chatType = ctx.chat?.type;

  if (chatType && chatType !== 'private') {
    ctx.reply(
      '📩 Perintah ini hanya bisa digunakan di chat pribadi dengan bot.\n' +
      'Silakan klik nama bot ini lalu tekan tombol <b>Start</b>.',
      { parse_mode: 'HTML' }
    ).catch((e) => {
      console.error('❌ Gagal kirim instruksi private chat:', e.message);
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
        '📩 Untuk menggunakan bot ini, silakan buka chat pribadi dengan bot.\n' +
        'Klik nama bot ini lalu tekan tombol <b>Start</b>.',
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.error('❌ Gagal kirim pesan instruksi di grup:', e.message);
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

  // Deep link dari web: /start link_<token>
  // Web punya tombol "Hubungkan ke Telegram" yang generate URL
  //   https://t.me/<botname>?start=link_<token>
  // Saat user klik, Telegram kirim /start dengan parameter "link_<token>".
  // Bot baca token, panggil API web /telegram/verify-link-token,
  // kalau sukses kita simpan web_user_id ke DB lokal bot.
  try {
    const startPayload = (ctx.startPayload || ctx.message?.text || '')
      .replace(/^\/start(?:@\w+)?\s*/i, '')
      .trim();
    if (startPayload && startPayload.startsWith('link_') && isWebLinkEnabled()) {
      const token = startPayload.slice(5).trim();
      await handleWebLinkToken(ctx, token);
      return; // sudah dihandle, tidak perlu lanjut ke main menu
    }
  } catch (e) {
    logger.error('Gagal handle web link payload di /start:', e.message || e);
  }

  await sendMainMenu(ctx);
});

// === Handler verifikasi token "link akun" dari web ===
// Dipakai oleh /start link_<token> dan tombol "Hubungkan ke Web" di menu user.
async function handleWebLinkToken(ctx, token) {
  const userId = ctx.from.id;
  if (!token || token.length < 8) {
    return ctx.reply(
      '⚠️ Token koneksi tidak valid.\n' +
      'Silakan klik ulang link dari halaman <b>Hubungkan ke Telegram</b> di web.',
      { parse_mode: 'HTML' }
    );
  }

  // Cek dulu kalau user ini sudah punya web_user_id sebelumnya
  const existing = await new Promise((resolve) => {
    db.get(
      'SELECT web_user_id FROM users WHERE user_id = ?',
      [userId],
      (err, row) => resolve(err ? null : row)
    );
  });

  await ctx.reply('⏳ Sedang menghubungkan akun ke web...', { parse_mode: 'HTML' });

  let res;
  try {
    res = await webApiClient.verifyLinkToken({ token, telegramId: userId });
  } catch (e) {
    logger.error('Gagal verifikasi link token: ' + (e.message || e));
    const status = e.status;
    if (status === 404 || status === 410) {
      return ctx.reply(
        '⚠️ Token sudah tidak berlaku atau sudah dipakai.\n' +
        'Silakan buka kembali halaman <b>Hubungkan ke Telegram</b> di web,\n' +
        'klik tombol <b>Generate Link Baru</b>, lalu klik link-nya.',
        { parse_mode: 'HTML' }
      );
    }
    if (status === 401 || status === 403) {
      return ctx.reply(
        '❌ Konfigurasi koneksi web bermasalah. Silakan hubungi admin.',
        { parse_mode: 'HTML' }
      );
    }
    return ctx.reply(
      '❌ Gagal menghubungkan ke web: ' + htmlEscape(e.message || 'Unknown error') +
      '\n\nSilakan coba lagi atau hubungi admin.',
      { parse_mode: 'HTML' }
    );
  }

  const webUser = (res && (res.user || res.data)) || null;
  if (!webUser || !webUser.id) {
    return ctx.reply(
      '⚠️ Respon dari web tidak valid. Silakan coba lagi atau hubungi admin.',
      { parse_mode: 'HTML' }
    );
  }

  // Simpan web_user_id ke DB bot. Pastikan baris user ada dulu.
  await new Promise((resolve) => {
    db.run(
      'INSERT OR IGNORE INTO users (user_id) VALUES (?)',
      [userId],
      () => resolve()
    );
  });
  await new Promise((resolve) => {
    db.run(
      'UPDATE users SET web_user_id = ?, web_linked_at = ? WHERE user_id = ?',
      [Number(webUser.id), Date.now(), userId],
      (err) => {
        if (err) logger.error('Gagal simpan web_user_id: ' + (err.message || err));
        resolve();
      }
    );
  });

  // === Migrate saldo SQLite -> web (sekali, saat first link) ===
  // OPSI 1 (per pilihan user): saldo lokal SQLite di-transfer ke saldo web,
  // lalu saldo SQLite di-set ke 0 supaya tidak ada double-counting. Dari titik
  // ini bot pakai saldo web sebagai single source of truth.
  // refId pakai pola tetap 'migrate_<userId>' supaya idempotent di sisi web —
  // kalau bot ulangi proses link untuk user yang sama, tidak akan double-credit.
  let migratedAmount = 0;
  let migrateError = null;
  const wasLinked = existing && existing.web_user_id;
  if (!wasLinked) {
    // Cuma migrate saat FIRST link, bukan saat re-link.
    const localSaldo = await new Promise((resolve) => {
      db.get(
        'SELECT saldo FROM users WHERE user_id = ?',
        [userId],
        (err, row) => resolve(err ? 0 : Number(row?.saldo || 0))
      );
    });
    if (localSaldo > 0) {
      try {
        const creditRes = await webApiClient.creditBalance({
          telegramId: userId,
          amount: localSaldo,
          description: 'Migrasi saldo Bot Telegram saat link akun',
          refId: 'migrate_telegram_' + userId,
        });
        if (creditRes && creditRes.ok) {
          migratedAmount = creditRes.applied ? localSaldo : 0;
          // Zero-kan saldo lokal HANYA setelah credit ke web sukses, dan
          // catat di tabel transactions supaya audit trail jelas.
          await new Promise((resolve) => {
            db.run(
              'UPDATE users SET saldo = 0 WHERE user_id = ?',
              [userId],
              () => resolve()
            );
          });
          try {
            recordSaldoTransaction(
              userId,
              -localSaldo,
              'web_link_migration',
              'migrate_to_web_user_' + webUser.id
            );
          } catch (e) {
            logger.warn('Gagal catat tx migration ke transactions: ' + (e.message || e));
          }
          logger.info('Saldo bot ' + localSaldo + ' di-migrate ke web user ' + webUser.id + ' (telegramId ' + userId + ')');
        } else {
          migrateError = 'Web tidak ack credit (response.ok = false)';
          logger.error('Migrate saldo gagal: ' + migrateError);
        }
      } catch (e) {
        migrateError = e.message || String(e);
        logger.error('Gagal migrate saldo SQLite ke web: ' + migrateError);
      }
    }
  }

  // Ambil saldo web TERBARU setelah migrate (kalau migrate sukses, web sudah
  // bertambah; kalau gagal, fallback ke balance dari verifyLinkToken response).
  let finalWebBalance = Number(webUser.balance || 0);
  if (migratedAmount > 0) {
    try {
      const fresh = await webApiClient.getBalanceByTelegramId(userId);
      if (fresh && typeof fresh.balance === 'number') {
        finalWebBalance = fresh.balance;
      } else {
        finalWebBalance = Number(webUser.balance || 0) + migratedAmount;
      }
    } catch (_) {
      finalWebBalance = Number(webUser.balance || 0) + migratedAmount;
    }
  }

  const username = webUser.username || webUser.email || ('User #' + webUser.id);
  const webDomain = getWebDomain() || 'web';

  await ctx.reply(buildWebLinkSuccessText({
    wasLinked,
    webDomain,
    username,
    migratedAmount,
    migrateError,
    finalWebBalance,
  }), {
    parse_mode: 'HTML',
    reply_markup: buildWebLinkSuccessKeyboard(getWebDomain()),
  });
}

// === Handler tombol "🔗 Hubungkan ke Web" di menu utama bot ===
bot.action('web_link_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ctx.from) return;
  if (!isWebLinkEnabled()) {
    return sendCleanMenu(ctx,
      '⚠️ Fitur hubungkan akun web sedang nonaktif.\n' +
      'Silakan hubungi admin kalau membutuhkan.',
      { parse_mode: 'HTML' }
    );
  }

  const userId = ctx.from.id;
  const webDomain = getWebDomain() || 'https://ketantech.my.id';

  // Cek apakah user sudah punya web_user_id
  const row = await new Promise((resolve) => {
    db.get(
      'SELECT web_user_id, web_linked_at FROM users WHERE user_id = ?',
      [userId],
      (err, r) => resolve(err ? null : r)
    );
  });

  if (row && row.web_user_id) {
    // Sudah link → tampilkan info + opsi unlink
    let webUser = null;
    try {
      webUser = await webApiClient.getUserByTelegramId(userId);
    } catch (e) {
      logger.warn('Gagal ambil info user web (web_link_menu): ' + (e.message || e));
    }

    return sendCleanMenu(ctx, buildWebLinkedStatusText({ webDomain, webUser }), {
      parse_mode: 'HTML',
      reply_markup: buildWebLinkedStatusKeyboard(webDomain),
    });
  }

  // Belum link → kasih instruksi
  return sendCleanMenu(ctx, buildWebLinkInstructionsText(webDomain), {
    parse_mode: 'HTML',
    reply_markup: buildWebLinkInstructionsKeyboard(webDomain),
  });
});

// Putuskan koneksi web ↔ bot
bot.action('web_link_unlink', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (!ctx.from) return;
  const userId = ctx.from.id;

  // Optional: kasih tahu web supaya web juga reset telegramId
  try {
    if (isWebLinkEnabled()) await webApiClient.unlinkTelegram(userId);
  } catch (e) {
    logger.warn('Gagal unlink di sisi web: ' + (e.message || e));
  }

  // Hapus link di sisi bot
  await new Promise((resolve) => {
    db.run(
      'UPDATE users SET web_user_id = NULL, web_linked_at = NULL WHERE user_id = ?',
      [userId],
      () => resolve()
    );
  });

  await sendCleanMenu(ctx, buildWebUnlinkSuccessText(), {
    parse_mode: 'HTML',
    reply_markup: buildWebUnlinkSuccessKeyboard(),
  });
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
    buildTopupQrisPromptText({
      min: QRIS_AUTO_TOPUP_MIN,
      max: QRIS_AUTO_TOPUP_MAX,
    }),
    {
      parse_mode: 'HTML',
      reply_markup: buildTopupQrisPromptMarkup(),
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
    await bot.telegram.sendMessage(GROUP_ID, '✅ Test kirim notif ke grup berhasil!');
    await ctx.reply('✅ Pesan test sudah dikirim ke grup.');
  } catch (e) {
    console.error('Gagal kirim ke grup:', e.message);
    await ctx.reply('⚠️ Gagal kirim ke grup, cek ID grup & izin bot.');
  }
});


bot.command('daily_report_test', async (ctx) => {
	// Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;
  if (!ctx.from || ctx.from.id !== MASTER_ID) {
    return ctx.reply(MASTER_ONLY_MESSAGE, { parse_mode: 'HTML' });
}

  await ctx.reply('⏳ Mengirim laporan harian (test)...');
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
  //   return ctx.reply('???→ Perintah ini hanya untuk admin.');
  // }

  ctx.reply('⏳ Membuat preview pengingat expired dari akun kamu...').catch(() => {});

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
        logger.error('❌ Gagal ambil akun untuk expired_reminder_test:', err.message);
        return ctx.reply('❌ Gagal mengambil data akun untuk preview.');
      }

      let text = '';

      if (!rows || rows.length === 0) {
        // Tidak ada akun milik user ini -> kirim contoh dummy
        text =
          '⏰ <b>Peringatan Akun VPN Akan Berakhir</b>\n\n' +
          'Contoh tampilan pengingat expired akun (dummy):\n\n' +
          '1. <b>VMESS</b> <code>user-vmess</code> (server 1)\n' +
          '   • Expired: 01-01-2026 20:00\n\n' +
          '2. <b>SSH</b> <code>user-ssh</code> (server 2)\n' +
          '   • Expired: 02-01-2026 20:00\n\n' +
          'Kalau pengingat jalan beneran, daftar di atas akan diisi pakai akun asli milik kamu.\n\n' +
          'Pengingat otomatis tetap mengikuti pengaturan di menu:\n' +
          '• Jam & menit pengingat\n' +
          '• H-1 / H-2 / H-3.';
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
            }</code> (${serverLabel})\n   • Expired: ${expLabel}`;
          })
          .join('\n\n');

        text =
          '⏰ <b>Peringatan Akun VPN Akan Berakhir</b>\n\n' +
          'Ini contoh tampilan pengingat expired pakai beberapa akun milik kamu (maks 5):\n\n' +
          akunLines +
          '\n\n' +
          'Pengingat otomatis nanti isinya mirip seperti ini,\n' +
          'bedanya hanya akun yang tampil adalah yang benar-benar akan expired sesuai pengaturan H-n.\n\n' +
          'Atur jadwal & H-nya di:\n' +
          '• Menu Admin → 🔔 Pengingat Expired.';
      }

      try {
        await bot.telegram.sendMessage(chatId, text, {
          parse_mode: 'HTML',
        });
      } catch (e) {
        logger.error(
          '❌ Gagal kirim expired_reminder_test:',
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

  await ctx.reply('⏳ Menjalankan backup otomatis (test)...');
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
    return ctx.reply('⚠️ EXPIRE_DATE belum di-set di .vars.json untuk bot ini.');
  }

  const info = getLicenseInfo();
  return ctx.reply(buildLicenseInfoText({
    licenseInfo: info,
    now: new Date(),
    timeZone: TIME_ZONE,
  }), { parse_mode: 'HTML' });
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
  let dbStatus = '❌ Gagal cek database';
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT 1 AS ok', [], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (row && row.ok === 1) {
      dbStatus = '✅ Terhubung & bisa query';
    } else {
      dbStatus = '⚠️ Respons aneh dari database';
    }
  } catch (e) {
    dbStatus = `❌ Error DB: ${e.message || e}`;
  }

  // Info lisensi
  const licenseStatus = buildHealthLicenseStatus(
    EXPIRE_DATE,
    EXPIRE_DATE ? getLicenseInfo() : null,
    TIME_ZONE
  );

  const msg = buildHealthText({
    now: new Date(),
    timeZone: TIME_ZONE,
    uptimeSeconds: process.uptime(),
    licenseStatus,
    dbStatus,
    autoBackupEnabled: AUTO_BACKUP_ENABLED,
    autoBackupIntervalHours: AUTO_BACKUP_INTERVAL_HOURS,
    backupChatId: BACKUP_CHAT_ID,
    dailyReportEnabled: DAILY_REPORT_ENABLED,
    dailyReportHour: DAILY_REPORT_HOUR,
    dailyReportMinute: DAILY_REPORT_MINUTE,
    expiryReminderEnabled: EXPIRY_REMINDER_ENABLED,
    expiryReminderHour: EXPIRY_REMINDER_HOUR,
    expiryReminderMinute: EXPIRY_REMINDER_MINUTE,
    expiryReminderDaysBefore: EXPIRY_REMINDER_DAYS_BEFORE,
  });

  try {
    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e) {
    logger.error('❌ Gagal kirim pesan /health:', e.message || e);
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
      '⚠️ <b>Format salah.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/addhari 30</code>',
      { parse_mode: 'HTML' }
    );
  }

  const days = parseInt(parts[1], 10);
  if (isNaN(days) || days <= 0) {
       return ctx.reply(
    '⚠️ <b>Jumlah hari tidak valid.</b>\n' +
    'Harus berupa angka lebih dari 0.\n\n' +
    'Contoh:\n' +
    '<code>/addhari 7</code>',
    { parse_mode: 'HTML' }
  );
}
  
  const oldInfo = getLicenseInfo();
  let baseDate;

  // Kalau sebelumnya sudah ada tanggal lisensi → tambah dari tanggal itu
  if (oldInfo) {
    baseDate = new Date(oldInfo.expire.getTime());
  } else {
    // Kalau belum ada → mulai dari hari ini
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
    '<b>✅ Berhasil menambah masa aktif lisensi bot.</b>\n\n' +
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
      '⚠️ <b>Format salah.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/kuranghari 7</code>',
      { parse_mode: 'HTML' }
    );
  }

  const days = parseInt(parts[1], 10);
  if (isNaN(days) || days <= 0) {
    return ctx.reply(
    '⚠️ <b>Jumlah hari tidak valid.</b>\n' +
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
    '<b>✅ Berhasil mengurangi masa aktif lisensi bot.</b>\n\n' +
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
      '⚠️ <b>Format salah.</b>\n\n' +
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
      '⚠️ <b>user_id atau jumlah tidak valid.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/addsaldo 5439429147 50000</code>',
      { parse_mode: 'HTML' }
    );
  }

  // Hitung bonus tier dulu (sama untuk linked maupun non-linked).
  let bonusEnabled = true;
  if (typeof TOPUP_BONUS_ENABLED !== 'undefined') bonusEnabled = !!TOPUP_BONUS_ENABLED;

  let tier1Min = 50000, tier1Pct = 5;
  let tier2Min = 100000, tier2Pct = 7;
  let tier3Min = 200000, tier3Pct = 10;
  if (typeof TOPUP_BONUS_MIN_AMOUNT !== 'undefined') { const v = Number(TOPUP_BONUS_MIN_AMOUNT); if (!Number.isNaN(v)) tier1Min = v; }
  if (typeof TOPUP_BONUS_PERCENT !== 'undefined') { const v = Number(TOPUP_BONUS_PERCENT); if (!Number.isNaN(v)) tier1Pct = v; }
  if (typeof TOPUP_BONUS_TIER2_MIN !== 'undefined') { const v = Number(TOPUP_BONUS_TIER2_MIN); if (!Number.isNaN(v)) tier2Min = v; }
  if (typeof TOPUP_BONUS_TIER2_PERCENT !== 'undefined') { const v = Number(TOPUP_BONUS_TIER2_PERCENT); if (!Number.isNaN(v)) tier2Pct = v; }
  if (typeof TOPUP_BONUS_TIER3_MIN !== 'undefined') { const v = Number(TOPUP_BONUS_TIER3_MIN); if (!Number.isNaN(v)) tier3Min = v; }
  if (typeof TOPUP_BONUS_TIER3_PERCENT !== 'undefined') { const v = Number(TOPUP_BONUS_TIER3_PERCENT); if (!Number.isNaN(v)) tier3Pct = v; }
  let bonusPercent = 0;
  if (bonusEnabled) {
    if (amount >= tier3Min && tier3Min > 0 && tier3Pct > 0) bonusPercent = tier3Pct;
    else if (amount >= tier2Min && tier2Min > 0 && tier2Pct > 0) bonusPercent = tier2Pct;
    else if (amount >= tier1Min && tier1Min > 0 && tier1Pct > 0) bonusPercent = tier1Pct;
  }
  const bonus = bonusPercent > 0 ? Math.floor((amount * bonusPercent) / 100) : 0;
  const totalCredit = amount + bonus;

  // Cek apakah user ini sudah link ke web. Kalau iya, push saldo ke web
  // (single source of truth). Kalau tidak, update SQLite seperti sebelumnya.
  // Path linked async, jadi kita pakai async IIFE supaya bisa await dengan
  // bersih tanpa nested callback hell.
  (async () => {
    try {
      const linkInfo = isWebLinkEnabled()
        ? await getUserLinkInfo(targetId).catch(() => null)
        : null;

      // ===== PATH 1: USER LINKED → PUSH SALDO KE WEB =====
      if (linkInfo && linkInfo.web_user_id) {
        try {
          const refId = `addsaldo_admin_${ctx.from.id}_${targetId}_${Date.now()}`;
          const credRes = await webApiClient.creditBalance({
            telegramId: targetId,
            amount: totalCredit,
            description: `Topup manual oleh admin ${ctx.from.id}` + (bonus > 0 ? ` (bonus ${bonusPercent}%)` : ''),
            refId,
          });
          if (!credRes || !credRes.ok) {
            return ctx.reply('❌ Gagal credit saldo ke web. Server tidak ack.', { parse_mode: 'HTML' });
          }
          const newSaldoWeb = Number(credRes.newBalance || 0);

          // Audit ke transactions SQLite supaya admin tetap bisa lihat history.
          try {
            recordSaldoTransaction(
              targetId,
              totalCredit,
              'manual_addsaldo_web',
              `addsaldo_by_${ctx.from.id}`
            );
          } catch (e) {
            logger.warn('Gagal catat tx /addsaldo (web): ' + (e.message || e));
          }

          // Notif ke admin
          let msgAdmin = `✅ Saldo user web <code>${targetId}</code> berhasil ditambah (akun ter-link ke web).\n\n` +
            `💰 Nominal bayar : <b>Rp${amount.toLocaleString('id-ID')}</b>\n`;
          if (bonus > 0) {
            msgAdmin += `🎁 Bonus : <b>Rp${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n`;
          }
          msgAdmin += `💰 Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n` +
            `\n💰 Saldo web sekarang: <b>Rp${newSaldoWeb.toLocaleString('id-ID')}</b> 🌐`;
          await ctx.reply(msgAdmin, { parse_mode: 'HTML' });

          // Notif ke user
          try {
            let msgUser = '✅ Saldo kamu telah <b>ditambahkan</b>.\n\n' +
              `💰 Topup : <b>Rp ${amount.toLocaleString('id-ID')}</b>\n`;
            if (bonus > 0) {
              msgUser += `🎁 Bonus : <b>Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n`;
            }
            msgUser += `💰 Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n` +
              `\n💰 Saldo sekarang: <b>Rp ${newSaldoWeb.toLocaleString('id-ID')}</b> 🌐`;
            await bot.telegram.sendMessage(targetId, msgUser, { parse_mode: 'HTML' });
          } catch (e) {
            logger.error('Gagal kirim notif ke user (linked):', e.message);
          }

          // Notif ke grup
          if (typeof NOTIF_TOPUP_GROUP !== 'undefined' && NOTIF_TOPUP_GROUP && GROUP_ID) {
            try {
              let targetInfo = {};
              try { targetInfo = await bot.telegram.getChat(targetId); } catch (_) {}
              const userLabel = targetInfo.username || targetInfo.first_name || String(targetId);
              const waktu = new Date().toLocaleString('id-ID', {
                timeZone: TIME_ZONE,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
              });
              let notifTopup = '<blockquote>\n💵 TOPUP MANUAL (WEB) 💵\n<code>\n' +
                `👤 User : ${userLabel}\n` +
                `🆔 ID : ${targetId}\n` +
                `💳 Bayar : Rp ${amount.toLocaleString('id-ID')}\n`;
              if (bonus > 0) {
                notifTopup += `🎁 Bonus : Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)\n`;
              }
              notifTopup += `💰 Masuk : Rp ${totalCredit.toLocaleString('id-ID')}\n` +
                `💰 Saldo : Rp ${newSaldoWeb.toLocaleString('id-ID')} 🌐\n` +
                `📅 Tanggal : ${waktu}\n` +
                '</code>\n━━━━━━━━━━━━━━━━━━━━\n</blockquote>';
              await bot.telegram.sendMessage(GROUP_ID, notifTopup, { parse_mode: 'HTML' });
            } catch (e) {
              logger.error('Gagal kirim notif topup manual (linked) ke grup:', e.message);
            }
          }
          return;
        } catch (eWeb) {
          logger.error('Gagal credit saldo ke web di /addsaldo: ' + (eWeb.message || eWeb));
          return ctx.reply(
            '❌ Gagal menambah saldo ke web: <code>' + htmlEscape(eWeb.message || String(eWeb)) + '</code>\n' +
            'User ini sudah ter-link ke web. Tidak melakukan fallback ke SQLite supaya saldo tidak ganda.',
            { parse_mode: 'HTML' }
          );
        }
      }

      // ===== PATH 2: USER BELUM LINK → SQLite (PERILAKU LAMA) =====
      // Ambil saldo lama
      const row = await new Promise((resolve, reject) => {
        db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (e, r) => e ? reject(e) : resolve(r));
      });

      if (!row) {
        return ctx.reply(`❌ User dengan ID ${targetId} tidak ditemukan di database.`);
      }
      const oldSaldo = Number(row.saldo || 0);
      const newSaldo = oldSaldo + totalCredit;

      // Update saldo user
      await new Promise((resolve, reject) => {
        db.run('UPDATE users SET saldo = ? WHERE user_id = ?', [newSaldo, targetId], (err2) => err2 ? reject(err2) : resolve());
      });

      // === CATAT TRANSAKSI SALDO ===
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
        `✅ Saldo user ID <code>${targetId}</code> berhasil ditambah.\n\n` +
        `💰 Nominal bayar : <b>Rp${amount.toLocaleString('id-ID')}</b>\n`;
      if (bonus > 0) {
        msgAdmin +=
          `🎁 Bonus : <b>Rp${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n` +
          `💰 Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n`;
      } else {
        msgAdmin += `💰 Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n`;
      }
      msgAdmin += `\n💰 Saldo sekarang: <b>Rp${newSaldo.toLocaleString('id-ID')}</b>`;
      await ctx.reply(msgAdmin, { parse_mode: 'HTML' });

      // Notif ke user
      try {
        let msgUser =
          '✅ Saldo kamu telah <b>ditambahkan</b>.\n\n' +
          `💰 Topup : <b>Rp ${amount.toLocaleString('id-ID')}</b>\n`;
        if (bonus > 0) {
          msgUser +=
            `🎁 Bonus : <b>Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n` +
            `💰 Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n`;
        } else {
          msgUser += `💰 Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n`;
        }
        msgUser += `\n💰 Saldo sekarang: <b>Rp ${newSaldo.toLocaleString('id-ID')}</b>`;
        await bot.telegram.sendMessage(targetId, msgUser, { parse_mode: 'HTML' });
      } catch (e) {
        logger.error('Gagal kirim notif ke user:', e.message);
      }

      // Notif ke grup (jika diaktifkan)
      if (typeof NOTIF_TOPUP_GROUP !== 'undefined' && NOTIF_TOPUP_GROUP && GROUP_ID) {
        try {
          let targetInfo;
          try { targetInfo = await bot.telegram.getChat(targetId); } catch (e) { targetInfo = {}; }
          const userLabel = targetInfo.username || targetInfo.first_name || String(targetId);
          const waktu = new Date().toLocaleString('id-ID', {
            timeZone: TIME_ZONE,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
          });
          let notifTopup =
            '<blockquote>\n💵 TOPUP MANUAL 💵\n<code>\n' +
            `👤 User : ${userLabel}\n` +
            `🆔 ID : ${targetId}\n` +
            `💳 Bayar : Rp ${amount.toLocaleString('id-ID')}\n`;
          if (bonus > 0) {
            notifTopup +=
              `🎁 Bonus : Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)\n` +
              `💰 Masuk : Rp ${totalCredit.toLocaleString('id-ID')}\n`;
          } else {
            notifTopup += `💰 Masuk : Rp ${totalCredit.toLocaleString('id-ID')}\n`;
          }
          notifTopup +=
            `💰 Saldo : Rp ${newSaldo.toLocaleString('id-ID')}\n` +
            `📅 Tanggal : ${waktu}\n` +
            '</code>\n━━━━━━━━━━━━━━━━━━━━\n</blockquote>';
          await bot.telegram.sendMessage(GROUP_ID, notifTopup, { parse_mode: 'HTML' });
        } catch (e) {
          logger.error('Gagal kirim notif topup manual ke grup:', e.message);
        }
      }
    } catch (errOuter) {
      logger.error('Error /addsaldo (path SQLite/aware-link):', errOuter.message || errOuter);
      try { await ctx.reply('❌ Terjadi kesalahan saat menambah saldo. Coba lagi nanti.', { parse_mode: 'HTML' }); } catch (_) {}
    }
  })();
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
      '⚠️ <b>Format salah.</b>\n\n' +
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
      '⚠️ <b>user_id atau jumlah tidak valid.</b>\n' +
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
        return ctx.reply('❌ Gagal membaca data user. Coba lagi nanti.');
      }

      if (!row) {
        return ctx.reply(`⚠️ User dengan ID ${targetId} tidak ditemukan di database.`);
      }

      const oldSaldo = Number(row.saldo || 0);

      // Cek biar saldo tidak minus
      if (oldSaldo < amount) {
        return ctx.reply(
          `⚠️ Saldo user tidak cukup.\n` +
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
            return ctx.reply('❌ Gagal mengurangi saldo. Coba lagi nanti.');
          }
       // ?→ CATAT TRANSAKSI SALDO
          recordSaldoTransaction(
            targetId,
            amount,
            'manual_minsaldo',
            `minsaldo_by_${ctx.from.id}`
          );

          // Notif ke admin (chat ini)
          await ctx.reply(
            `✅ Saldo user ID <code>${targetId}</code> berhasil dikurangi Rp${amount.toLocaleString()}.\n` +
            `💰 Saldo sekarang: <b>Rp${newSaldo.toLocaleString()}</b>`,
            { parse_mode: 'HTML' }
          );

          // Notif ke user yang bersangkutan (kalau bisa di-chat)
try {
  await bot.telegram.sendMessage(
    targetId,
    '✅ Saldo kamu telah <b>dikurangi</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n' +
    '💰 Saldo sekarang: <b>Rp ' + newSaldo.toLocaleString() + '</b>.',
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
      '➖ PENGURANGAN SALDO ➖\n' +
      '<code>\n' + // <-- MULAI BLOK MONOSPACE
      `👤 User : ${userLabel}\n` +
      `💰 Jumlah : Rp ${amount.toLocaleString()}\n` +
      `📅 Tanggal : ${waktu}\n` +
      '</code>\n' + // <-- AKHIR BLOK MONOSPACE
      '━━━━━━━━━━━━━━━━━━━━\n' +
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
      '⚠️ <b>Format salah.</b>\n\n' +
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
      '⚠️ <b>user_id tidak valid.</b>\n' +
      'Contoh yang benar:\n' +
      '<code>/deluser 5439429147</code>',
      { parse_mode: 'HTML' }
    );
  }

  // Cek apakah user ada di tabel users
  db.get('SELECT * FROM users WHERE user_id = ?', [targetId], (err, row) => {
    if (err) {
      logger.error('❌ Kesalahan saat memeriksa user_id di /deluser:', err.message);
      return ctx.reply('❌ Terjadi kesalahan saat memeriksa user.');
    }

    if (!row) {
      return ctx.reply(`⚠️ User dengan ID ${targetId} tidak ditemukan di database.`);
    }

    // Hapus dari tabel users
    db.run('DELETE FROM users WHERE user_id = ?', [targetId], (err2) => {
      if (err2) {
        logger.error('❌ Gagal menghapus user di /deluser:', err2.message);
        return ctx.reply('❌ Gagal menghapus user dari database.');
      }

      logger.info(`ℹ️ User ${targetId} dihapus dari tabel users oleh admin ${ctx.from.id}`);

         // Setelah berhasil hapus dari users, hapus juga dari daftar reseller (cache + file)
      try {
        const removed = removeResellerIdFromCache(targetId);
        if (removed) {
          logger.info(`ℹ️ User ${targetId} juga dihapus dari daftar reseller (cache + ressel.db)`);
        }
      } catch (e) {
        logger.error('⚠️ Gagal mengupdate resellerCache di /deluser:', e.message || e);
      }
      ctx.reply(
        `✅ User dengan ID <code>${targetId}</code> berhasil dihapus dari database.`,
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
      return ctx.reply('❌ Terjadi kesalahan saat mengambil data user.');
    }

    const totalUser = row ? row.total : 0;

    // Ambil 10 user terakhir (berdasarkan id)
    db.all(
      'SELECT user_id, saldo FROM users ORDER BY id DESC LIMIT 10',
      [],
      (err2, rows) => {
        if (err2) {
          logger.error('Gagal mengambil daftar user:', err2.message);
          return ctx.reply('❌ Terjadi kesalahan saat mengambil daftar user.');
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
            msg += `${i + 1}. <code>${u.user_id}</code> → Saldo: Rp${saldo}\n`;
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
      '⚠️ Format salah.\n' +
        'Gunakan:\n' +
        '`/setflag <user_id> <NORMAL|WATCHLIST|NAKAL> [catatan...]`',
      { parse_mode: 'Markdown' }
    );
  }

  const targetId = args[1];
  const rawStatus = args[2].toUpperCase();
  const note = args.slice(3).join(' ').trim();

  if (!/^\d+$/.test(targetId)) {
    return ctx.reply('⚠️ user_id harus berupa angka.', { parse_mode: 'Markdown' });
  }

  if (!['NORMAL', 'WATCHLIST', 'NAKAL'].includes(rawStatus)) {
    return ctx.reply(
      '⚠️ Status tidak dikenal.\n' +
        'Gunakan salah satu: `NORMAL`, `WATCHLIST`, atau `NAKAL`.',
      { parse_mode: 'Markdown' }
    );
  }

  db.run(
    'UPDATE users SET flag_status = ?, flag_note = ? WHERE user_id = ?',
    [rawStatus, note || null, targetId],
    function (err) {
      if (err) {
        logger.error('❌ Gagal mengupdate flag_status user:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengupdate status user.');
      }

      if (this.changes === 0) {
        return ctx.reply(
          `⚠️ User dengan ID ${targetId} tidak ditemukan di tabel users.`,
          { parse_mode: 'Markdown' }
        );
      }

      let label = '✅ NORMAL';
      if (rawStatus === 'WATCHLIST') label = '⚠️ WATCHLIST';
      else if (rawStatus === 'NAKAL') label = '⛔ NAKAL';

      const noteText = note ? `\n📌 Catatan: ${note}` : '';
      ctx.reply(
        `✅ Status user \`${targetId}\` berhasil diubah menjadi: ${label}${noteText}`,
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
    return ctx.reply('⚠️ Belum ada data broadcast yang tersimpan (atau bot baru saja direstart).');
  }

  const info = lastBroadcastInfo;

  let targetLabel = info.target;
  if (info.target === 'all') targetLabel = 'semua user';
  else if (info.target === 'reseller') targetLabel = 'semua reseller';
  else if (info.target === 'member') targetLabel = 'member (bukan reseller & bukan admin)';

  await ctx.reply(
    `📢 <b>Broadcast Terakhir</b>\n\n` +
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
    await ctx.reply('🚫 Anda tidak memiliki izin untuk mengakses menu admin.');
    return;
  }

  await sendAdminMenu(ctx);
});
async function sendMainMenu(ctx) {
  if (!ctx.from) return;

  const userId = ctx.from.id;
  const userName = ctx.from.first_name || '-';

  // Ambil saldo user (efektif: web kalau linked, SQLite kalau belum link).
  // accountService.getUserSaldo() sudah cerdas — kalau user.web_user_id ada,
  // dia panggil API /telegram/balance dan return saldo web; kalau belum link
  // atau API error, dia fallback ke saldo SQLite lokal.
  let saldo = 0;
  let saldoSource = 'lokal';
  let webLinked = false;

  try {
    const v = await getUserSaldo(db, userId);
    saldo = Number(v || 0);
    if (isWebLinkEnabled()) {
      const link = await getUserLinkInfo(userId);
      if (link && link.web_user_id) {
        saldoSource = 'web';
        webLinked = true;
      }
    }
  } catch (e) {
    saldo = 0;
    logger.error('Gagal mengambil saldo di sendMainMenu:', e);
  }

  if (isWebLinkEnabled() && !webLinked) {
    try {
      const linkRow = await new Promise((resolve) => {
        db.get(
          'SELECT web_user_id FROM users WHERE user_id = ?',
          [userId],
          (err, row) => resolve(err ? null : row)
        );
      });
      webLinked = !!(linkRow && linkRow.web_user_id);
    } catch (e) {
      logger.warn('sendMainMenu: gagal cek status link web: ' + (e && e.message ? e.message : e));
    }
  }

  const isReseller = isResellerId(userId);
  const isAdmin = ADMIN_IDS.includes(userId);

  const messageText = buildMainMenuMessage({
    storeName: NAMA_STORE,
    userName,
    userId,
    saldo,
    saldoSource,
    isAdmin,
    isReseller,
    expireDate: EXPIRE_DATE,
    licenseInfo: EXPIRE_DATE ? getLicenseInfo() : null,
  });

  const keyboard = buildMainMenuKeyboard({
    isReseller,
    isAdmin,
    webLinkEnabled: isWebLinkEnabled(),
    webLinked,
  });

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

// === ?→ STATUS BOT (ADMIN) ===
// Cek cepat: lisensi, auto-backup, pengingat expired, dan trial
bot.command(['botstatus', 'statusbot'], async (ctx) => {
  // Wajib di private chat
  if (!ensurePrivateChat(ctx)) return;

  const adminId = ctx.from?.id;
  if (!adminId || !ADMIN_IDS.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const licenseInfo = EXPIRE_DATE ? getLicenseInfo() : null;
  const licenseText = formatBotStatusLicenseText(EXPIRE_DATE, licenseInfo);

  let trialInfoText = '';
  try {
    trialInfoText = formatTrialInfoText(await getTrialConfig());
  } catch (e) {
    logger.error('❌ Gagal membaca trial_config di /botstatus:', e);
    trialInfoText = formatTrialInfoText(null);
  }

  const text = buildBotStatusText({
    storeName: NAMA_STORE,
    licenseText,
    autoBackupEnabled: AUTO_BACKUP_ENABLED,
    autoBackupIntervalHours: AUTO_BACKUP_INTERVAL_HOURS,
    backupChatId: BACKUP_CHAT_ID,
    expiryReminderEnabled: EXPIRY_REMINDER_ENABLED,
    expiryReminderHour: EXPIRY_REMINDER_HOUR,
    expiryReminderMinute: EXPIRY_REMINDER_MINUTE,
    expiryReminderDaysBefore: EXPIRY_REMINDER_DAYS_BEFORE,
    timeZone: TIME_ZONE,
    trialInfoText,
  });

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


  return ctx.reply(buildHelpAdminMessage());
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
      return ctx.reply('⚠️ Format salah!\n\nGunakan:\n/addserver_reseller <domain> <auth> <harga> <nama_server> <quota> <iplimit> <batas_create_akun>');
    }

    const [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun] = args;

    // → TAMBAHKAN total_create_akun di VALUES
    db.run(`INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, is_reseller_only, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun],
      function (err) {
        if (err) {
          logger.error('❌ Gagal menambah server reseller:', err.message);
          return ctx.reply('❌ *Gagal menambah server reseller.*', { parse_mode: 'Markdown' });
        }
        ctx.reply('✅ *Server khusus reseller berhasil ditambahkan!*', { parse_mode: 'Markdown' });
      }
    );
  } catch (e) {
    logger.error('Error di /addserver_reseller:', e);
    ctx.reply('❌ *Terjadi kesalahan.*', { parse_mode: 'Markdown' });
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
    logger.info('⚠️ Pesan untuk broadcast tidak diberikan.');
    return ctx.reply(
      '⚠️ <b>Pesan broadcast kosong.</b>\n' +
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
      return ctx.reply('⚠️ Tidak ada user di database untuk dikirimi broadcast.', {
        parse_mode: 'HTML',
      });
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let sukses = 0;
    let gagal = 0;
    let totalTarget = 0;

    // Beri info awal ke admin
    await ctx.reply(
      `📢 Mulai broadcast ke <b>${rows.length}</b> user...\n` +
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
        logger.info(`ℹ️ Broadcast terkirim ke ${targetId}`);
            } catch (error) {
        gagal++;

        // Kalau kena limit Telegram (429), ikuti retry_after kalau ada
        const status = error?.response?.status;
        const retryAfter =
          error?.response?.data?.parameters?.retry_after || 0;

        if (status === 429) {
          logger.warn(
            `⏳ Kena limit Telegram (429) saat kirim ke ${targetId}. retry_after=${retryAfter}s`
          );
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          await sleep(delayMs);
        } else {
          logger.error(
            `⚠️ Gagal kirim broadcast ke ${targetId}:`,
            error.message || error
          );
        }
      }


      // Jeda kecil agar tidak ngebombardir API Telegram
      await sleep(80); // bisa diubah ke 30/100 ms sesuai kebutuhan
    }

    await ctx.reply(
      `✅ <b>Broadcast selesai.</b>\n\n` +
        `🎯 Target : <b>${totalTarget}</b> user\n` +
        `✅ Berhasil : <b>${sukses}</b>\n` +
        `⚠️ Gagal    : <b>${gagal}</b>\n\n` +
        `<i>Kalau sering kena limit, naikkan jeda di fungsi sleep (misal jadi 100ms).</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('⚠️ Kesalahan saat mengambil daftar pengguna untuk broadcast:', e);
    return ctx.reply(
      '⚠️ Terjadi kesalahan saat mengambil daftar pengguna untuk broadcast.',
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
    logger.info('⚠️ Pesan untuk broadcastres tidak diberikan.');
    return ctx.reply(
      '⚠️ <b>Pesan broadcast kosong.</b>\n' +
        'Kirim ulang perintah dengan teks, atau reply sebuah pesan lalu jalankan <code>/broadcastres</code>.',
      { parse_mode: 'HTML' }
    );
  }

  try {
    if (!fs.existsSync(resselFilePath)) {
      return ctx.reply(
        '⚠️ Belum ada reseller yang terdaftar (file <code>ressel.db</code> kosong).',
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
        '⚠️ Belum ada reseller yang terdaftar di <code>ressel.db</code>.',
        { parse_mode: 'HTML' }
      );
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let sukses = 0;
    let gagal = 0;
    let totalTarget = 0;

    // Info awal ke admin
    await ctx.reply(
      `📢 Mulai broadcast ke <b>${resellerList.length}</b> reseller...\n` +
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
        logger.info(`ℹ️ Broadcastres terkirim ke ${targetId}`);
            } catch (error) {
        gagal++;

        const status = error?.response?.status;
        const retryAfter =
          error?.response?.data?.parameters?.retry_after || 0;

        if (status === 429) {
          logger.warn(
            `⏳ Kena limit Telegram (429) saat broadcastres ke ${targetId}. retry_after=${retryAfter}s`
          );
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          await sleep(delayMs);
        } else {
          logger.error(
            `⚠️ Gagal kirim broadcastres ke ${targetId}:`,
            error.message || error
          );
        }
      }


      // Jeda kecil supaya aman dari limit
      await sleep(80);
    }

    await ctx.reply(
      `✅ <b>Broadcast ke reseller selesai.</b>\n\n` +
        `🎯 Target : <b>${totalTarget}</b> reseller\n` +
        `✅ Berhasil : <b>${sukses}</b>\n` +
        `⚠️ Gagal    : <b>${gagal}</b>\n\n` +
        `<i>Kalau mulai sering dapat error limit, jeda bisa dinaikkan lagi (misal 100–120 ms).</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('❌ Error di broadcastres:', e);
    return ctx.reply(
      '⚠️ Terjadi kesalahan saat menjalankan broadcast ke reseller.',
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
    logger.info('⚠️ Pesan untuk broadcastmem tidak diberikan.');
    return ctx.reply(
      '⚠️ <b>Pesan broadcast kosong.</b>\n' +
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
        logger.error('⚠️ Gagal membaca file reseller di broadcastmem:', e);
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
        '⚠️ Belum ada user yang terdaftar di database.',
        { parse_mode: 'HTML' }
      );
    }

    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let sukses = 0;
    let gagal = 0;
    let totalTarget = 0;

    // Info awal ke admin
    await ctx.reply(
      '📢 Mulai broadcast ke member (non-reseller & non-admin)...\n' +
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
        logger.info(`ℹ️ Broadcastmem terkirim ke ${targetId}`);
            } catch (error) {
        gagal++;

        const status = error?.response?.status;
        const retryAfter =
          error?.response?.data?.parameters?.retry_after || 0;

        if (status === 429) {
          logger.warn(
            `⏳ Kena limit Telegram (429) saat broadcastmem ke ${targetId}. retry_after=${retryAfter}s`
          );
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          await sleep(delayMs);
        } else {
          logger.error(
            `⚠️ Gagal kirim broadcastmem ke ${targetId}:`,
            error.message || error
          );
        }
      }

      // Jeda 80ms biar aman dari limit
      await sleep(80);
    }

    await ctx.reply(
      `✅ <b>Broadcast ke member selesai.</b>\n\n` +
        `🎯 Target : <b>${totalTarget}</b> user (bukan reseller & bukan admin)\n` +
        `✅ Berhasil : <b>${sukses}</b>\n` +
        `⚠️ Gagal    : <b>${gagal}</b>\n\n` +
        `<i>Kalau mulai sering kena limit, jeda bisa dinaikkan lagi (misal 100–120 ms).</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('❌ Error di broadcastmem:', e);
    return ctx.reply(
      '⚠️ Terjadi kesalahan saat broadcast ke member.',
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
      '⚠️ Penggunaan:\n<code>/cekqris INV123456789</code>',
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
        '❌ Invoice tidak ditemukan di tabel <code>qris_payments</code>.',
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
            '\n💼 Paid API: ' +
            new Date(apiPaidAt).toLocaleString('id-ID', {
              timeZone: TIME_ZONE,
            });
        }
      }
    } catch (e) {
      logger.error('⚠️ Gagal cek status QRIS ke API dari /cekqris:', e);
      apiStatus = 'ERROR';
      apiExtra = `\n⚠️ ${e.message || String(e)}`;
    }

    // 3. Kalau DB masih pending tapi API sudah PAID → langsung selesaikan topup
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
            '✅ <b>Topup Saldo Berhasil (Manual Sync)</b>\n\n' +
            '💳 Metode : <b>QRIS Otomatis</b>\n' +
            `🧾 Invoice : <code>${row.invoice_id}</code>\n` +
            `💰 Nominal : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n\n` +
            `💰 Saldo kamu sekarang: <b>${saldoNow.toLocaleString('id-ID')}</b>`;

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
              '💳 TOPUP SALDO (QRIS)' +
              '<code>\n' + // <-- MULAI BLOK MONOSPACE
              `👤 User : ${userLabel}\n` +
              `💰 Nominal : Rp${row.amount.toLocaleString('id-ID')}\n` +
              `🧾 Invoice : ${row.invoice_id}\n` +
              '</code>\n' + // <-- AKHIR BLOK MONOSPACE
              '━━━━━━━━━━━━━━━━━━━━\n' +
              '</blockquote>';

            await bot.telegram.sendMessage(GROUP_ID, msgGroup, {
              parse_mode: 'HTML',
            });
          }
        } catch (e) {
          logger.error(
            '❌ Gagal kirim notif ke user/grup setelah /cekqris:',
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
          `👤 Dipilih user : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
          `🔢 Kode unik    : <b>${uniqueSuffix
            .toString()
            .padStart(3, '0')}</b>\n` +
          `💵 Dibayar : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n`;
      } else {
        // base ada, tapi kode unik 0 (misalnya lagi dimatikan)
        nominalInfo =
          `👤 Dipilih user : <b>Rp${baseAmount.toLocaleString('id-ID')}</b>\n` +
          `💵 Dibayar : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n`;
      }
    } else {
      // data lama (waktu belum ada kolom base_amount / unique_suffix)
      nominalInfo =
        `💵 Dibayar : <b>Rp${row.amount.toLocaleString('id-ID')}</b>\n` +
        '<i>(base_amount tidak tersimpan → transaksi lama)</i>\n';
    }

    const msg =
      '🔍 <b>Cek Invoice QRIS</b>\n\n' +
      `🧾 Invoice : <code>${row.invoice_id}</code>\n` +
      `👤 User ID : <code>${row.user_id}</code>\n\n` +
      nominalInfo +
      '\n' +
      `💾 Status DB : <b>${dbStatus.toUpperCase()}</b>\n` +
      `📅 Dibuat : ${createdAtText}\n` +
      `• Dibayar   : ${paidAtDbText}\n\n` +
      `📡 Status API : <b>${apiStatus}</b>${apiExtra}`;

    await ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e) {
    logger.error('❌ Error di /cekqris:', e);
    await ctx.reply('❌ Terjadi kesalahan saat cek invoice QRIS.', {
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
      return ctx.reply('⚠️ Format salah. Gunakan: `/addserver <domain> <auth> <harga> <nama_server> <quota> <iplimit> <batas_create_account>`', { parse_mode: 'Markdown' });
  }

  const [domain, auth, harga, nama_server, quota, iplimit, batas_create_akun] = args.slice(1);

  const numberOnlyRegex = /^\d+$/;
  if (!numberOnlyRegex.test(harga) || !numberOnlyRegex.test(quota) || !numberOnlyRegex.test(iplimit) || !numberOnlyRegex.test(batas_create_akun)) {
      return ctx.reply('⚠️ `harga`, `quota`, `iplimit`, dan `batas_create_akun` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  // → QUERY YANG BENAR
  db.run("INSERT INTO Server (domain, auth, harga, nama_server, quota, iplimit, batas_create_akun, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      [domain, auth, parseInt(harga), nama_server, parseInt(quota), parseInt(iplimit), parseInt(batas_create_akun)],
      function(err) {
          if (err) {
              logger.error('⚠️ Kesalahan saat menambahkan server:', err.message);
              return ctx.reply('⚠️ Kesalahan saat menambahkan server.', { parse_mode: 'Markdown' });
          }
          ctx.reply(`✅ Server \`${nama_server}\` berhasil ditambahkan.`, { parse_mode: 'Markdown' });
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
      '⚠️ Format salah. Gunakan:\n`/editharga <domain> <harga>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const hargaStr = args[2];

  // Validasi harga harus angka positif
  if (!/^\d+$/.test(hargaStr)) {
    return ctx.reply(
      '⚠️ `harga` harus berupa angka (tanpa titik/koma).',
      { parse_mode: 'Markdown' }
    );
  }

  const hargaBaru = parseInt(hargaStr, 10);

  db.run(
    'UPDATE Server SET harga = ? WHERE domain = ?',
    [hargaBaru, domain],
    function (err) {
      if (err) {
        logger.error('⚠️ Kesalahan saat mengedit harga server:', err.message);
        return ctx.reply(
          '⚠️ Terjadi kesalahan saat mengedit harga server.',
          { parse_mode: 'Markdown' }
        );
      }

      // this.changes = berapa baris yang kena UPDATE
      if (this.changes === 0) {
        return ctx.reply(
          '⚠️ Server dengan domain tersebut tidak ditemukan.',
          { parse_mode: 'Markdown' }
        );
      }

      ctx.reply(
        `✅ Harga server \`${domain}\` berhasil diubah menjadi \`${hargaBaru}\`.`,
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
      '⚠️ Format salah.\nGunakan:\n`/editnama <domain> <nama_server_baru>`',
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
        logger.error('⚠️ Kesalahan saat mengedit nama server:', err.message);
        return ctx.reply('⚠️ Kesalahan saat mengedit nama server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Nama server untuk \`${domain}\` berhasil diubah menjadi \`${namaBaru}\`.`,
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.action(/edit_domain_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit domain server dengan ID: ${serverId}`);

  // Ambil domain sekarang dari database
  db.get('SELECT domain FROM Server WHERE id = ?', [serverId], async (err, row) => {
    if (err) {
      logger.error('Kesalahan saat mengambil data server untuk edit domain:', err.message);
      await ctx.reply('⚠️ Terjadi kesalahan saat mengambil data server.');
      return;
    }

    if (!row) {
      await ctx.reply('⚠️ Server tidak ditemukan.');
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
      '🖊️ *Silakan ketik domain server baru, lalu kirim sebagai pesan biasa.*\n' +
        `⚠️ Contoh: \`${currentDomain}\`\n` +
        'ℹ️ Ketik *batal* untuk membatalkan.',
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
      '⚠️ Format salah.\nGunakan:\n`/editauth <domain> <auth_baru>`',
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
        logger.error('⚠️ Kesalahan saat mengedit auth server:', err.message);
        return ctx.reply('⚠️ Kesalahan saat mengedit auth server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Auth server untuk \`${domain}\` berhasil diubah.`,
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
      '⚠️ Format salah.\nGunakan:\n`/editlimitquota <domain> <quota>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const quotaStr = args[2];

  if (!/^\d+$/.test(quotaStr)) {
    return ctx.reply('⚠️ `quota` harus berupa angka.', {
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
          '⚠️ Kesalahan saat mengedit quota server:',
          err.message
        );
        return ctx.reply('⚠️ Kesalahan saat mengedit quota server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Quota server \`${domain}\` berhasil diubah menjadi \`${quota}\`.`,
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
      '⚠️ Format salah.\nGunakan:\n`/editlimitip <domain> <iplimit>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const ipLimitStr = args[2];

  if (!/^\d+$/.test(ipLimitStr)) {
    return ctx.reply('⚠️ `iplimit` harus berupa angka.', {
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
          '⚠️ Kesalahan saat mengedit iplimit server:',
          err.message
        );
        return ctx.reply('⚠️ Kesalahan saat mengedit iplimit server.', {
          parse_mode: 'Markdown',
        });
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Limit IP server \`${domain}\` berhasil diubah menjadi \`${iplimit}\`.`,
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
      '⚠️ Format salah.\nGunakan:\n`/editlimitcreate <domain> <batas_create_akun>`',
      { parse_mode: 'Markdown' }
    );
  }

  const domain = args[1];
  const batasStr = args[2];

  if (!/^\d+$/.test(batasStr)) {
    return ctx.reply(
      '⚠️ `batas_create_akun` harus berupa angka.',
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
          '⚠️ Kesalahan saat mengedit batas_create_akun server:',
          err.message
        );
        return ctx.reply(
          '⚠️ Kesalahan saat mengedit batas_create_akun server.',
          { parse_mode: 'Markdown' }
        );
      }

      if (this.changes === 0) {
        return ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
      }

      ctx.reply(
        `✅ Batas create akun server \`${domain}\` berhasil diubah menjadi \`${batas}\`.`,
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
      return ctx.reply('⚠️ Format salah. Gunakan: `/edittotalcreate <domain> <total_create_akun>`', { parse_mode: 'Markdown' });
  }

  const [domain, total_create_akun] = args.slice(1);

  if (!/^\d+$/.test(total_create_akun)) {
      return ctx.reply('⚠️ `total_create_akun` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  db.run("UPDATE Server SET total_create_akun = ? WHERE domain = ?", [parseInt(total_create_akun), domain], function(err) {
      if (err) {
          logger.error('⚠️ Kesalahan saat mengedit total_create_akun server:', err.message);
          return ctx.reply('⚠️ Kesalahan saat mengedit total_create_akun server.', { parse_mode: 'Markdown' });
      }

      if (this.changes === 0) {
          return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      }

      ctx.reply(`✅ Total create akun server \`${domain}\` berhasil diubah menjadi \`${total_create_akun}\`.`, { parse_mode: 'Markdown' });
  });
});
// ========= → MENU LAYANAN USER =========
// --- Fase modularisasi: service_create/trial/renew/del/lock/unlock dipindah ke modules/service-menu.js


async function sendAdminMenu(ctx) {
  const headerText = buildAdminMenuHeader({
    expireDate: EXPIRE_DATE,
    licenseInfo: EXPIRE_DATE && ADMIN_IDS.includes(ctx.from.id) ? getLicenseInfo() : null,
    timeZone: TIME_ZONE,
  });
  const adminKeyboard = buildAdminMenuKeyboard();

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
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const cfg = await getTrialConfig();

    const tempCfg = {
      enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : DEFAULT_TRIAL_CONFIG.enabled,
      maxPerDay: Number.isInteger(cfg.maxPerDay) ? cfg.maxPerDay : DEFAULT_TRIAL_CONFIG.maxPerDay,
      durationHours: Number.isInteger(cfg.durationHours) ? cfg.durationHours : DEFAULT_TRIAL_CONFIG.durationHours,
      minBalanceForTrial: Number.isInteger(cfg.minBalanceForTrial) && cfg.minBalanceForTrial >= 0
        ? cfg.minBalanceForTrial
        : DEFAULT_TRIAL_CONFIG.minBalanceForTrial,
      // Audit fix: watchlistMaxPerDay dipakai aktif di flow trial untuk
      // batasi user WATCHLIST, tapi sebelumnya tidak ada tombolnya di UI
      // admin. Sekarang ikut di-load supaya bisa di-toggle dari menu.
      watchlistMaxPerDay: Number.isInteger(cfg.watchlistMaxPerDay) && cfg.watchlistMaxPerDay >= 0
        ? cfg.watchlistMaxPerDay
        : DEFAULT_TRIAL_CONFIG.watchlistMaxPerDay
    };

    adminTrialTemp[ctx.from.id] = tempCfg;

    await renderAdminTrialMenu(ctx, tempCfg, { edit: false });
  } catch (err) {
    logger.error('❌ Gagal membuka menu pengaturan trial:', err.message);
    ctx.reply('❌ Terjadi kesalahan saat membuka pengaturan trial.');
  }
});


bot.action('admin_trial_toggle', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }

    const temp = getAdminTrialTemp(ctx);
    temp.enabled = !temp.enabled;

    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal mengubah status trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah status trial.');
  }
});

bot.action('admin_trial_max_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
    logger.error('❌ Gagal menaikkan maxPerDay trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah batas trial per hari.');
  }
});

bot.action('admin_trial_max_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
    logger.error('❌ Gagal menurunkan maxPerDay trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah batas trial per hari.');
  }
});
bot.action('admin_trial_min_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
    logger.error('❌ Gagal menaikkan minBalanceForTrial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah minimal saldo trial.');
  }
});

bot.action('admin_trial_min_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
    logger.error('❌ Gagal menurunkan minBalanceForTrial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah minimal saldo trial.');
  }
});

bot.action('admin_trial_min_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

// Audit fix: tombol +/- untuk watchlistMaxPerDay (batas trial khusus user
// status WATCHLIST). Sebelumnya field ini cuma bisa diatur lewat edit JSON.
bot.action('admin_trial_wlmax_inc', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.watchlistMaxPerDay)
      ? temp.watchlistMaxPerDay
      : DEFAULT_TRIAL_CONFIG.watchlistMaxPerDay;
    current += 1;
    if (current > 5) current = 5; // Batas atas: WATCHLIST mestinya lebih ketat dari user normal
    temp.watchlistMaxPerDay = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal menaikkan watchlistMaxPerDay (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah batas trial WATCHLIST.');
  }
});

bot.action('admin_trial_wlmax_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    const temp = getAdminTrialTemp(ctx);
    let current = Number.isInteger(temp.watchlistMaxPerDay)
      ? temp.watchlistMaxPerDay
      : DEFAULT_TRIAL_CONFIG.watchlistMaxPerDay;
    current -= 1;
    if (current < 0) current = 0; // 0 = WATCHLIST tidak boleh trial sama sekali
    temp.watchlistMaxPerDay = current;
    await renderAdminTrialMenu(ctx, temp, { edit: true });
  } catch (err) {
    logger.error('❌ Gagal menurunkan watchlistMaxPerDay (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah batas trial WATCHLIST.');
  }
});

bot.action('admin_trial_wlmax_nop', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
});

bot.action('admin_trial_dur_inc', async (ctx) => {

  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
    logger.error('❌ Gagal menaikkan durasi trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah durasi trial.');
  }
});

bot.action('admin_trial_dur_dec', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
    logger.error('❌ Gagal menurunkan durasi trial (temp):', err.message);
    ctx.reply('❌ Terjadi kesalahan saat mengubah durasi trial.');
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
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
          : DEFAULT_TRIAL_CONFIG.minBalanceForTrial,
      // Audit fix: persist juga watchlistMaxPerDay supaya nilai yang
      // diatur lewat tombol +/- benar-benar tersimpan ke trial_config.json.
      watchlistMaxPerDay:
        Number.isInteger(temp.watchlistMaxPerDay) && temp.watchlistMaxPerDay >= 0
          ? temp.watchlistMaxPerDay
          : DEFAULT_TRIAL_CONFIG.watchlistMaxPerDay
    };

    await updateTrialConfig(normalized);

    // Hapus draft sementara
    delete adminTrialTemp[adminId];

    // Audit fix MEDIUM: pakai editOrReply biar pesan menu di-update jadi
    // notif "berhasil disimpan", bukan kirim pesan baru di bawah menu lama.
    await editOrReply(
      ctx,
      buildAdminTrialSaveSuccessText(normalized),
      {
        parse_mode: 'Markdown',
        reply_markup: buildAdminTrialBackKeyboard(),
      }
    );
  } catch (err) {
    logger.error('❌ Gagal menyimpan pengaturan trial:', err.message);
    ctx.reply('❌ Terjadi kesalahan saat menyimpan pengaturan trial.');
  }
});


function getAdminTrialTemp(ctx) {
  const adminId = ctx.from.id;
  let temp = adminTrialTemp[adminId];
  if (!temp) {
    temp = {
      enabled: DEFAULT_TRIAL_CONFIG.enabled,
      maxPerDay: DEFAULT_TRIAL_CONFIG.maxPerDay,
      durationHours: DEFAULT_TRIAL_CONFIG.durationHours,
      minBalanceForTrial: DEFAULT_TRIAL_CONFIG.minBalanceForTrial,
      // Audit fix: include watchlistMaxPerDay default supaya tombol +/-
      // tidak start dari undefined kalau temp baru dibuat lewat fallback ini.
      watchlistMaxPerDay: DEFAULT_TRIAL_CONFIG.watchlistMaxPerDay
    };
    adminTrialTemp[adminId] = temp;
  }
  return temp;
}

// --- Fase 5 lanjutan split: reseller handler "async function renderResellerTargetMenu" dipindah ke admin/reseller.js

async function renderAdminTrialMenu(ctx, cfg, options = {}) {
  // options.edit dipakai untuk pemanggil internal yang sudah pegang pesan
  // (mis. saat tombol +/-). Saat options.edit=false (buka pertama dari Menu
  // Admin), kita pakai editOrReply supaya tidak buat pesan baru.
  const isEdit = options.edit || false;

  const menuCfg = {
    ...cfg,
    minBalanceForTrial: cfg.minBalanceForTrial || 0,
    watchlistMaxPerDay: Number.isInteger(cfg.watchlistMaxPerDay)
      ? cfg.watchlistMaxPerDay
      : DEFAULT_TRIAL_CONFIG.watchlistMaxPerDay,
  };
  const message = buildAdminTrialMenuText(menuCfg);
  const replyMarkup = buildAdminTrialMenuKeyboard(menuCfg);

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
    // Buka pertama kali → editOrReply supaya pesan Menu Admin di-edit, tidak
    // numpuk pesan baru.
    await editOrReply(ctx, message, {
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
    logger.error('⚠️ Gagal load resellerCache dari ressel.db:', e.message || e);
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
      '⚠️ Gagal menyimpan resellerCache ke ressel.db:',
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
          logger.error('⚠️ Kesalahan saat mengambil daftar pengguna (broadcast menu all):', err.message);
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
          logger.error('⚠️ Kesalahan saat mengambil daftar pengguna (broadcast menu member):', err.message);
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

    // target tidak dikenal → kosong
    resolve(new Set());
  });
}

// ============================================================================

// ============ END SECTION: PAYMENT - QRIS AUTO TOPUP (GOPAY) ===========



// Kirim pengumuman ke target yang sudah dihitung
async function sendBroadcastFromMenu(ctx, target, message) {
  try {
    const adminId = ctx.from?.id || 0;

    // Audit fix #3: cek concurrent job. Kalau admin masih punya job 'running'
    // di DB, refuse buat job baru. Cegah dobel-tap "Kirim Sekarang" yang lolos
    // dari rate-limit callback dan/atau resume job yang masih jalan.
    if (adminId) {
      try {
        const runningJobId = await hasRunningBroadcastJobForAdmin(adminId);
        if (runningJobId) {
          await ctx.reply(
            '⚠️ Masih ada broadcast yang berjalan untuk akun admin kamu.\n' +
              `Job ID: <b>#${runningJobId}</b>\n\n` +
              'Tunggu sampai broadcast tersebut selesai (kamu akan dapat ringkasan otomatis), ' +
              'lalu coba kirim pengumuman lagi.',
            { parse_mode: 'HTML' }
          );
          return;
        }
      } catch (eRunning) {
        logger.warn('Gagal cek running broadcast job: ' + (eRunning.message || eRunning));
        // Tidak abort: lebih baik kirim daripada blok admin permanen kalau DB error.
      }
    }

    // Audit fix #1: pra-validasi HTML pesan dengan dry-run ke admin sendiri.
    // Telegram reject 400 kalau tag HTML rusak / tidak balanced. Lebih baik
    // ketahuan sekarang (1 pesan) daripada gagal N pesan ke user.
    if (adminId) {
      const v = await validateBroadcastMessageHtml(adminId, message);
      if (!v.ok) {
        const errExcerpt = String(v.error || 'unknown error').slice(0, 200);
        await ctx.reply(
          '❌ <b>Pengumuman tidak dikirim — pesan ditolak Telegram.</b>\n\n' +
            'Telegram mengembalikan error saat parse HTML:\n' +
            `<code>${htmlEscape(errExcerpt)}</code>\n\n` +
            'Penyebab umum:\n' +
            '• Karakter <code>&lt;</code> <code>&gt;</code> <code>&amp;</code> di teks polos (harus di-escape).\n' +
            '• Tag HTML tidak balanced (mis. <code>&lt;b&gt;</code> tanpa <code>&lt;/b&gt;</code>).\n' +
            '• Tag yang tidak didukung Telegram.\n\n' +
            'Edit pesan kamu lalu kirim ulang dari menu 📢 Kirim Pengumuman.',
          { parse_mode: 'HTML' }
        );
        return;
      }
    }

    const targets = await getBroadcastTargetsFromMenu(target);

    if (!targets || targets.size === 0) {
      await ctx.reply('⚠️ Tidak ada target yang cocok untuk pengumuman ini.');
      return;
    }

    // Persist job ke broadcast_jobs supaya bisa di-resume kalau bot restart
    // di tengah pengiriman.
    const targetList = Array.from(targets).map((x) => Number(x));
    const jobId = await createBroadcastJob({
      adminId,
      targetType: target,
      message,
      targetList,
    });

    const { sukses, gagal } = await runBroadcastJob(jobId, 0);
    await emitBroadcastSummary(ctx, target, targetList.length, sukses, gagal, message);
  } catch (err) {
    logger.error('❌ Error di sendBroadcastFromMenu:', err);
    await ctx.reply('❌ Terjadi kesalahan saat mengirim pengumuman.');
  }
}

// Test mode: kirim pengumuman HANYA ke admin yang klik (bukan ke user asli).
// Tetap melewati HTML pre-validation + concurrent lock + persist ke broadcast_jobs
// dengan target_type='self_test'. Pesan diberi prefix label 🧪 supaya admin
// langsung bisa beda kan dari pengumuman beneran. Sesi broadcast tidak dihapus
// (admin masih bisa klik Kirim Sekarang setelah test).
async function sendBroadcastSelfTest(ctx, originalTargetType, message) {
  try {
    const adminId = ctx.from?.id || 0;
    if (!adminId) return;

    // Concurrent lock: kalau admin masih punya broadcast running (test atau real),
    // tolak dulu supaya tidak overlap.
    try {
      const runningJobId = await hasRunningBroadcastJobForAdmin(adminId);
      if (runningJobId) {
        await ctx.reply(
          '⚠️ Masih ada broadcast/test yang berjalan untuk akun admin kamu.\n' +
            `Job ID: <b>#${runningJobId}</b>\n\n` +
            'Tunggu sampai selesai dulu, lalu coba test lagi.',
          { parse_mode: 'HTML' }
        );
        return;
      }
    } catch (eRunning) {
      logger.warn('Gagal cek running broadcast job (self_test): ' + (eRunning.message || eRunning));
    }

    // HTML pre-validation: sama seperti sendBroadcastFromMenu, supaya behavior
    // test mode persis seperti broadcast asli (termasuk error path).
    const v = await validateBroadcastMessageHtml(adminId, message);
    if (!v.ok) {
      const errExcerpt = String(v.error || 'unknown error').slice(0, 200);
      await ctx.reply(
        '❌ <b>Test gagal — pesan ditolak Telegram.</b>\n\n' +
          'Telegram mengembalikan error saat parse HTML:\n' +
          `<code>${htmlEscape(errExcerpt)}</code>\n\n` +
          'Edit pesan kamu lalu coba test ulang.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Tambah label test mode di header pesan supaya admin tahu ini cuma preview.
    // Diletakkan SEBELUM pesan asli, dipisah \n\n.
    const testHeader =
      '🧪 <i>[TEST MODE — pesan ini hanya kamu yang lihat. ' +
      `Target asli kalau di-kirim beneran: <b>${htmlEscape(originalTargetType)}</b>]</i>\n\n`;
    const finalMessage = testHeader + message;

    const targetList = [adminId];
    const jobId = await createBroadcastJob({
      adminId,
      targetType: 'self_test',
      message: finalMessage,
      targetList,
    });

    const { sukses, gagal } = await runBroadcastJob(jobId, 0);

    // Ringkasan pendek (bukan emitBroadcastSummary supaya gak cetak ke MASTER_ID).
    if (sukses > 0) {
      await ctx.reply(
        '✅ <b>Test selesai.</b>\n' +
          'Pesan di atas sudah dikirim ke kamu sebagai preview, tidak ke user asli.\n\n' +
          'Kalau preview-nya sudah benar, klik <b>📢 Kirim Sekarang</b> di pesan konfirmasi sebelumnya untuk kirim ke target asli.',
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(
        '⚠️ <b>Test gagal kirim ke kamu</b> (gagal: ' + gagal + ').\n' +
          'Mungkin admin belum pernah /start ke bot ini, atau sedang ada gangguan Telegram.',
        { parse_mode: 'HTML' }
      );
    }
  } catch (err) {
    logger.error('❌ Error di sendBroadcastSelfTest:', err);
    try { await ctx.reply('❌ Terjadi kesalahan saat menjalankan test broadcast.'); } catch (_) {}
  }
}


// ============================================================================
// Broadcast job persistence (table broadcast_jobs)
// - createBroadcastJob: insert job, return id
// - loadBroadcastJob: ambil row
// - updateBroadcastJobProgress: update cursor + counter (per 10 pesan)
// - markBroadcastJobDone: tandai status final
// - runBroadcastJob: loop kirim pesan, support resume dari startIndex
// - emitBroadcastSummary: kirim ringkasan ke admin + MASTER_ID + simpan in-memory
// - resumePendingBroadcastJobs: dipanggil saat startup
// ============================================================================
function createBroadcastJob({ adminId, targetType, message, targetList }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO broadcast_jobs
         (admin_id, target_type, message, parse_mode, target_list_json,
          total_target, cursor, sent_count, gagal_count, status, started_at)
       VALUES (?, ?, ?, 'HTML', ?, ?, 0, 0, 0, 'running', ?)`,
      [
        Number(adminId),
        String(targetType),
        String(message),
        JSON.stringify(targetList),
        targetList.length,
        Date.now(),
      ],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function loadBroadcastJob(jobId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM broadcast_jobs WHERE job_id = ?',
      [Number(jobId)],
      (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      }
    );
  });
}

function updateBroadcastJobProgress(jobId, cursor, sukses, gagal) {
  return new Promise((resolve) => {
    db.run(
      'UPDATE broadcast_jobs SET cursor = ?, sent_count = ?, gagal_count = ? WHERE job_id = ?',
      [cursor, sukses, gagal, Number(jobId)],
      () => resolve()
    );
  });
}

function markBroadcastJobDone(jobId, status) {
  return new Promise((resolve) => {
    db.run(
      'UPDATE broadcast_jobs SET status = ?, finished_at = ? WHERE job_id = ?',
      [status, Date.now(), Number(jobId)],
      () => resolve()
    );
  });
}

// Audit fix #3: cek apakah admin masih punya broadcast job 'running'.
// Dipakai sebelum membuat job baru supaya 1 admin = 1 job aktif (anti dobel-tap
// "Kirim Sekarang" yang lolos dari rate-limit callback).
function hasRunningBroadcastJobForAdmin(adminId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT job_id FROM broadcast_jobs WHERE admin_id = ? AND status = 'running' LIMIT 1",
      [Number(adminId)],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? Number(row.job_id) : 0);
      }
    );
  });
}

// Audit fix #1: validasi HTML pesan broadcast SEBELUM kirim massal.
// Cara: kirim pesan itu sendiri ke admin (silent), lalu langsung dihapus.
// Telegram akan reject dengan 400 kalau tag HTML rusak / tidak balanced.
// Return { ok: true } kalau valid, { ok: false, error } kalau parse error.
async function validateBroadcastMessageHtml(adminId, message) {
  if (!adminId) return { ok: true }; // skip kalau tidak tahu admin (resume case)
  try {
    const sent = await bot.telegram.sendMessage(adminId, message, {
      parse_mode: 'HTML',
      disable_notification: true,
    });
    // Hapus pesan test secepatnya supaya tidak nyampah di chat admin.
    try {
      await bot.telegram.deleteMessage(adminId, sent.message_id);
    } catch (_e) {
      // Ignore: kalau gagal delete (mis. terlalu lama), biarkan saja.
    }
    return { ok: true };
  } catch (e) {
    const status = e?.response?.error_code || e?.code;
    const errMsg = e?.response?.description || e?.message || String(e);
    return { ok: false, status, error: errMsg };
  }
}

async function runBroadcastJob(jobId, startIndex = 0) {
  const job = await loadBroadcastJob(jobId);
  if (!job) throw new Error('Broadcast job tidak ditemukan: ' + jobId);

  const targetList = JSON.parse(job.target_list_json || '[]');
  const message = job.message;
  let sukses = Number(job.sent_count) || 0;
  let gagal = Number(job.gagal_count) || 0;

  for (let i = startIndex; i < targetList.length; i++) {
    const id = targetList[i];
    let sent = false;
    for (let attempt = 0; attempt < 2 && !sent; attempt++) {
      try {
        await bot.telegram.sendMessage(id, message, { parse_mode: 'HTML' });
        sukses++;
        sent = true;
      } catch (e) {
        const status = e?.response?.error_code || e?.code;
        const retryAfter = Number(
          e?.response?.parameters?.retry_after ||
            e?.parameters?.retry_after ||
            0
        );
        if (status === 429 && attempt === 0) {
          const delayMs = (retryAfter > 0 ? retryAfter + 1 : 3) * 1000;
          logger.warn(
            `⏳ Kena limit Telegram (429) saat broadcast job=${jobId} ke ${id}. retry_after=${retryAfter}s`
          );
          await sleep(delayMs);
        } else {
          gagal++;
          logger.error(
            `⚠️ Gagal kirim pengumuman ke ${id}:`,
            e.message
          );
          sent = true;
        }
      }
    }

    // Audit fix #2: persist cursor tiap iterasi (sebelumnya tiap 10 pesan).
    // Cost 1 DB write per pesan kecil, tapi kalau bot crash kita kehilangan
    // maksimal 1 pesan (bukan 9) saat resume → tidak ada user yang dapat
    // pengumuman dobel.
    await updateBroadcastJobProgress(jobId, i + 1, sukses, gagal);
    await sleep(80);
  }

  await markBroadcastJobDone(jobId, 'done');
  return { sukses, gagal };
}

async function emitBroadcastSummary(ctx, target, totalTarget, sukses, gagal, message) {
  try {
    const now = new Date();
    const timeLabel = now.toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const maxPreviewLen = 300;
    let previewMessage = message;
    if (previewMessage.length > maxPreviewLen) {
      previewMessage = previewMessage.slice(0, maxPreviewLen) + '...';
    }

    lastBroadcastInfo = {
      time: timeLabel,
      target,
      totalTarget,
      sukses,
      gagal,
      messagePreview: previewMessage,
      fullMessage: message,
    };

    if (ctx && ctx.reply) {
      await ctx.reply(
        `✅ Pengumuman selesai dikirim.\n` +
          `Waktu   : <b>${timeLabel}</b>\n` +
          `Target  : <b>${target}</b>\n` +
          `Total   : <b>${totalTarget}</b> user\n` +
          `Berhasil: <b>${sukses}</b>, Gagal: <b>${gagal}</b>.`,
        { parse_mode: 'HTML' }
      );
    }

    try {
      if (MASTER_ID && ctx?.from && ctx.from.id !== MASTER_ID) {
        await bot.telegram.sendMessage(
          MASTER_ID,
          `📋 <b>Ringkasan Pengumuman</b>\n` +
            `Dikirim oleh: <code>${ctx.from.id}</code>\n` +
            `Waktu   : <b>${timeLabel}</b>\n` +
            `Target  : <b>${target}</b>\n` +
            `Total   : <b>${totalTarget}</b> user\n` +
            `Berhasil: <b>${sukses}</b>, Gagal: <b>${gagal}</b>\n\n` +
            `<b>Preview Pesan:</b>\n` +
            previewMessage,
          { parse_mode: 'HTML' }
        );
      }
    } catch (e) {
      logger.error('⚠️ Gagal kirim ringkasan broadcast ke MASTER_ID:', e.message);
    }
  } catch (e) {
    logger.error('⚠️ Gagal emit broadcast summary:', e.message || e);
  }
}

// Resume semua broadcast_jobs yang state-nya masih 'running' (mis. bot crash
// di tengah loop kirim). Lanjut dari cursor terakhir, kirim pesan ke user
// sisa, lalu mark done. Notif ringkasan akhir dikirim ke admin (kalau bisa).
async function resumePendingBroadcastJobs() {
  return new Promise((resolve) => {
    db.all(
      "SELECT * FROM broadcast_jobs WHERE status = 'running' ORDER BY started_at ASC",
      [],
      async (err, rows) => {
        if (err) {
          logger.error('⚠️ Gagal cek broadcast jobs pending:', err.message);
          return resolve();
        }
        if (!rows || rows.length === 0) return resolve();
        logger.info(`⏮️ Resume ${rows.length} broadcast job(s) yang sempat terputus`);
        for (const job of rows) {
          const startIdx = Number(job.cursor) || 0;
          try {
            const total = Number(job.total_target) || 0;
            if (startIdx >= total) {
              await markBroadcastJobDone(job.job_id, 'done');
              continue;
            }
            logger.info(
              `⏮️ Lanjut broadcast job=${job.job_id} dari ${startIdx}/${total} (target=${job.target_type})`
            );
            const { sukses, gagal } = await runBroadcastJob(job.job_id, startIdx);
            // Notif ringkasan ke admin dengan ctx ringan (cuma adminId)
            try {
              if (job.admin_id) {
                await bot.telegram.sendMessage(
                  Number(job.admin_id),
                  `✅ Broadcast yang sempat terputus sudah selesai.\n` +
                    `Job   : <b>#${job.job_id}</b>\n` +
                    `Target: <b>${job.target_type}</b>\n` +
                    `Total : <b>${total}</b> user\n` +
                    `Berhasil: <b>${sukses}</b>, Gagal: <b>${gagal}</b>.`,
                  { parse_mode: 'HTML' }
                );
              }
            } catch (notifErr) {
              logger.warn(
                `Tidak bisa kirim notif resume broadcast ke admin ${job.admin_id}: ${notifErr.message}`
              );
            }
          } catch (e) {
            logger.error(`⚠️ Gagal resume broadcast job=${job.job_id}:`, e.message || e);
            await markBroadcastJobDone(job.job_id, 'failed');
          }
        }
        resolve();
      }
    );
  });
}

// ==== MENU ?→ PENGUMUMAN DI ADMIN ====
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

  // Edit pesan menu admin saat tombol "Kirim Pengumuman" diklik supaya tidak
  // numpuk pesan baru. Kalau gagal edit (mis. pesan lama hilang), fallback reply.
  return editOrReply(ctx, buildBroadcastTargetText(), {
    parse_mode: 'HTML',
    reply_markup: buildBroadcastTargetKeyboard(),
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

  // Simpan target, dan tunggu user pilih MODE (manual / template)
  broadcastSessions[adminId] = {
    step: 'choose_mode',
    target,
  };

  // Edit pesan pilih target jadi pilih mode (tidak numpuk pesan baru).
  await editOrReply(
    ctx,
    buildBroadcastModeText(target),
    {
      parse_mode: 'HTML',
      reply_markup: buildBroadcastModeKeyboard(),
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
    return ctx.reply('⚠️ Tidak ada sesi pengumuman yang aktif. Mulai dari menu 📢 lagi.');
  }

  state.step = 'wait_message';

  await ctx.reply(
    buildBroadcastManualPromptText(),
    {
      parse_mode: 'HTML',
      reply_markup: buildBroadcastCancelKeyboard(),
    }
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
    return ctx.reply('⚠️ Tidak ada sesi pengumuman yang aktif. Mulai dari menu 📢 lagi.');
  }

  // Step pertama: minta nama server/layanan
  state.step = 'tm_ask_layanan';

  await ctx.reply(
    buildBroadcastTemplatePromptText('maintenance'),
    {
      parse_mode: 'HTML',
      reply_markup: buildBroadcastCancelKeyboard(),
    }
  );
});

// Mode: Template Maintenance Selesai (after-maintenance announcement)
// Pattern sama persis dengan broadcast_mode_maintenance — minta layanan,
// durasi aktual, catatan tambahan; lalu susun pesan otomatis.
bot.action('broadcast_mode_maintenance_done', async (ctx) => {
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
    return ctx.reply('⚠️ Tidak ada sesi pengumuman yang aktif. Mulai dari menu 📢 lagi.');
  }

  // Step pertama: minta nama server/layanan yang sudah selesai maintenance
  state.step = 'mtdone_ask_layanan';

  await ctx.reply(
    buildBroadcastTemplatePromptText('maintenanceDone'),
    {
      parse_mode: 'HTML',
      reply_markup: buildBroadcastCancelKeyboard(),
    }
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
    return ctx.reply('⚠️ Tidak ada sesi pengumuman yang aktif. Mulai dari menu 📢 lagi.');
  }

  // Step pertama: minta nama paket promo
  state.step = 'promo_ask_paket';

  await ctx.reply(
    buildBroadcastTemplatePromptText('promo'),
    {
      parse_mode: 'HTML',
      reply_markup: buildBroadcastCancelKeyboard(),
    }
  );
});

// Mode: Template Slot / Stok Terbatas (urgency announcement)
// Pattern: minta nama produk/layanan, sisa slot (opsional), deadline (opsional),
// catatan (opsional). Cocok untuk "Akun Direct EDU slot terbatas",
// "Server SG-1 slot habis", dll.
bot.action('broadcast_mode_slot', async (ctx) => {
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
    return ctx.reply('⚠️ Tidak ada sesi pengumuman yang aktif. Mulai dari menu 📢 lagi.');
  }

  state.step = 'slot_ask_layanan';

  await ctx.reply(
    buildBroadcastTemplatePromptText('slot'),
    {
      parse_mode: 'HTML',
      reply_markup: buildBroadcastCancelKeyboard(),
    }
  );
});

// Mode: Template Info / Pengumuman Umum (catch-all)
// Pattern simpel: minta judul + isi + catatan opsional. Untuk pengumuman yang
// tidak fit ke maintenance / promo / slot terbatas — mis. server baru, libur,
// peraturan baru, dll.
bot.action('broadcast_mode_info', async (ctx) => {
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
    return ctx.reply('⚠️ Tidak ada sesi pengumuman yang aktif. Mulai dari menu 📢 lagi.');
  }

  state.step = 'info_ask_judul';

  await ctx.reply(
    buildBroadcastTemplatePromptText('info'),
    {
      parse_mode: 'HTML',
      reply_markup: buildBroadcastCancelKeyboard(),
    }
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

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const state = broadcastSessions[adminId];
  if (!state || state.step !== 'confirm' || !state.message || !state.target) {
    return ctx.reply('⚠️ Tidak ada pengumuman yang menunggu konfirmasi.');
  }

  const target = state.target;
  const message = state.message;

  delete broadcastSessions[adminId];

  await ctx.reply('⏳ Mengirim pengumuman, mohon tunggu...');
  await sendBroadcastFromMenu(ctx, target, message);
});

// Test Mode: kirim pengumuman HANYA ke admin yang klik (preview real, bukan
// dummy). Tetap melewati HTML pre-validation + concurrent lock + persist ke
// broadcast_jobs (target_type='self_test') supaya admin bisa verifikasi semua
// behavior fix HIGH (HTML safety, concurrent lock) tanpa risiko kirim ke user
// asli.
bot.action('broadcast_test_self', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  const state = broadcastSessions[adminId];
  if (!state || state.step !== 'confirm' || !state.message || !state.target) {
    return ctx.reply('⚠️ Tidak ada pengumuman yang menunggu konfirmasi.');
  }

  const targetLabelOrig = state.target;
  const message = state.message;

  // Sesi sengaja TIDAK dihapus di sini supaya admin masih bisa klik
  // 📢 Kirim Sekarang setelah test selesai. Sesi akan di-clear lewat sweeper
  // TTL 30 menit kalau admin tidak melanjutkan.

  await ctx.reply(
    '🧪 <b>Mode Test</b> — pesan akan dikirim hanya ke kamu (bukan ke user).\n' +
      'Mengirim test, mohon tunggu...',
    { parse_mode: 'HTML' }
  );
  await sendBroadcastSelfTest(ctx, targetLabelOrig, message);
});


bot.action('broadcast_cancel', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}

  if (!ctx.from) return;
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
  }

  if (broadcastSessions[adminId]) {
    delete broadcastSessions[adminId];
  }

  // Edit pesan konfirmasi jadi notif "dibatalkan" + tombol kembali ke Menu Admin.
  await editOrReply(ctx, '⛔ Pengumuman dibatalkan.', {
    reply_markup: buildBroadcastBackToAdminKeyboard(),
  });
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
    await ctx.reply('⚠️ Sesi topup sudah tidak aktif. Silakan mulai lagi dari menu topup.', {
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
    await ctx.editMessageText('⛔ Topup dibatalkan.', {
      parse_mode: 'HTML'
    });
  } catch (_) {
    await ctx.reply('⛔ Topup dibatalkan.', {
      parse_mode: 'HTML'
    });
  }
});
// ===== END SECTION: PAYMENT - TRIGGER TOPUP OTOMATIS =======================

bot.action('qris_auto_topup', async (ctx) => {
  try {
    const userId = String(ctx.from.id);

    // pastikan object-nya ada
    depositState[userId] = { amount: '' };

    const msg =
      `💰 *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*\n\n` +
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
        '⚠️ <b>Format salah.</b>\n\n' +
          'Gunakan:\n' +
          '<code>/addressel &lt;user_id&gt;</code>\n\n' +
          'Contoh:\n' +
          '<code>/addressel 5439429147</code>',
        { parse_mode: 'HTML' }
      );
    }

    const targetId = args[1].trim();

    if (!targetId) {
      return ctx.reply('⚠️ user_id tidak valid.', { parse_mode: 'HTML' });
    }

    // Cek di cache dulu
    if (isResellerId(targetId)) {
      return ctx.reply(
        `⚠️ User dengan ID <code>${targetId}</code> sudah menjadi reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    // Tambah ke cache + simpan ke file
    const added = addResellerIdToCache(targetId);
    if (!added) {
      return ctx.reply(
        `⚠️ Gagal menambahkan ID <code>${targetId}</code> ke daftar reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    ctx.reply(
      `✅ User dengan ID <code>${targetId}</code> berhasil dijadikan reseller.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('❌ Error di command /addressel:', e.message || e);
    ctx.reply('❌ Terjadi kesalahan saat menjalankan perintah.');
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
        '⚠️ <b>Format salah.</b>\n\n' +
          'Gunakan:\n' +
          '<code>/delressel &lt;user_id&gt;</code>\n\n' +
          'Contoh:\n' +
          '<code>/delressel 5439429147</code>',
        { parse_mode: 'HTML' }
      );
    }

    const targetId = args[1].trim();

    if (!targetId) {
      return ctx.reply('⚠️ user_id tidak valid.', { parse_mode: 'HTML' });
    }

    if (!isResellerId(targetId)) {
      return ctx.reply(
        `⚠️ User dengan ID <code>${targetId}</code> tidak ada di daftar reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    const removed = removeResellerIdFromCache(targetId);
    if (!removed) {
      return ctx.reply(
        `⚠️ Gagal menghapus ID <code>${targetId}</code> dari daftar reseller.`,
        { parse_mode: 'HTML' }
      );
    }

    ctx.reply(
      `✅ User dengan ID <code>${targetId}</code> berhasil dihapus dari daftar reseller.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    logger.error('❌ Error di command /delressel:', e.message || e);
    ctx.reply('❌ Terjadi kesalahan saat menjalankan perintah.');
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

  await ctx.reply('✅ Gambar QRIS berhasil diunggah!');
  logger.info('ℹ️ QRIS image uploaded by admin');
  delete userState[adminId];
});
// === ????→ UPLOAD GAMBAR QRIS ===
bot.action('upload_qris', async (ctx) => {
  const adminId = ctx.from.id;
  if (!adminIds.includes(adminId)) {
    return ctx.reply(NO_ACCESS_MESSAGE, { parse_mode: 'HTML' });
}

  await ctx.reply('🖼️ Kirim gambar QRIS yang ingin digunakan:');
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
<b>💳 Top Up Saldo Manual via QRIS - ${storeName}</b>

1️⃣ Scan QRIS di atas dengan aplikasi pembayaran kamu.
2️⃣ Masukkan nominal sesuai saldo yang ingin kamu isi.
⚠️ Minimal top up: <b>Rp15.000</b>.
3️⃣ Setelah pembayaran <b>BERHASIL</b>, kirim bukti ke admin ${adminName}.

<b>✏️ Format pesan ke admin:</b>
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
        `⚠️ QRIS belum diunggah oleh admin. Silakan hubungi ${adminName}.`;

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
    logger.error('❌ Error di topup_manual:', err.message);
    try {
      await sendCleanMenu(ctx, '❌ Terjadi kesalahan saat menampilkan QRIS.', {
        parse_mode: 'HTML',
      });
    } catch (e) {}
  }
});
// ===== END SECTION: PAYMENT - HANDLER TOPUP MANUAL (ADMIN & USER) ==========

/////
// ====== FUNGSI BACKUP OTOMATIS KE TELEGRAM ======
// --- Body sendAutoBackup dipindah ke scheduler/auto-backup.js (wrapper di atas)

// ===== LAPORAN HARIAN KE MASTER =====
// --- Body sendDailyReport dipindah ke scheduler/daily-report.js (wrapper di atas)
// ===============================
// PENGINGAT AKUN AKAN EXPIRED (H-n)
// ===============================
// --- Body sendExpiryReminders dipindah ke scheduler/expiry-reminder.js (wrapper di atas)
// --- Fase 6 split: function startDailyReportScheduler() dipindah ke scheduler/


// --- Fase 6 split: function startExpiryReminderScheduler() dipindah ke scheduler/

// === CEK TARGET RESELLER & AUTO-DOWNGRADE BULANAN ===
// --- Body checkAndDowngradeResellersForPreviousMonth dipindah ke scheduler/reseller-target.js (wrapper di atas)

// --- Fase 6 split: function startResellerTargetScheduler() dipindah ke scheduler/


// === ????→ BACKUP DATABASE DAN KIRIM KE ADMIN ===
bot.action('backup_db', async (ctx) => {
  try {
    const adminId = ctx.from.id;

    // Hanya admin yang bisa pakai
    if (!adminIds.includes(adminId)) {
      return ctx.reply('🚫 Kamu tidak memiliki izin untuk melakukan tindakan ini.');
    }

    const dbPath = path.join(__dirname, 'sellvpn.db');
    if (!fs.existsSync(dbPath)) {
      return ctx.reply('⚠️ File database tidak ditemukan.');
    }

    // Kirim file sellvpn.db ke admin
    await ctx.replyWithDocument({ source: dbPath, filename: 'sellvpn.db' }, {
      caption: '✅ Backup database berhasil dikirim!',
    });

    logger.info(`📦 Backup database dikirim ke admin ${adminId}`);
  } catch (error) {
    logger.error('❌ Gagal mengirim file backup ke admin:', error);
    ctx.reply('❌ Terjadi kesalahan saat mengirim file backup.');
  }

});

// Audit fix MEDIUM: refactor pattern `editMessageText + try/catch reply`
// jadi `editOrReply` (sama seperti yang sudah dilakukan di Auto Backup &
// Trial menu). Konsisten dan handle "message is not modified" silently.

// Buka menu pengingat expired
bot.action('expiry_reminder_menu', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  await ctx.answerCbQuery().catch(() => {});
  await editOrReply(ctx, getExpiryReminderStatusText(), {
    parse_mode: 'HTML',
    reply_markup: buildExpiryReminderKeyboard(),
  });
});

// ====== ADMIN: TIMEZONE BOT ======

function getTimezoneStatusText() {
  return buildTimezoneStatusText({ timeZone: TIME_ZONE });
}

function buildTimezoneKeyboard() {
  return buildTimezoneKeyboardMarkup();
}

function getExpiryReminderStatusText() {
  return buildExpiryReminderStatusText({
    enabled: EXPIRY_REMINDER_ENABLED,
    hour: EXPIRY_REMINDER_HOUR,
    minute: EXPIRY_REMINDER_MINUTE,
    daysBefore: EXPIRY_REMINDER_DAYS_BEFORE,
  });
}

function buildExpiryReminderKeyboard() {
  return buildExpiryReminderKeyboardMarkup({ enabled: EXPIRY_REMINDER_ENABLED });
}

function getAutoBackupStatusText() {
  return buildAutoBackupStatusText({
    enabled: AUTO_BACKUP_ENABLED,
    intervalHours: AUTO_BACKUP_INTERVAL_HOURS,
    backupChatId: BACKUP_CHAT_ID,
  });
}

function buildAutoBackupKeyboard() {
  return buildAutoBackupKeyboardMarkup({ enabled: AUTO_BACKUP_ENABLED });
}

// Buka menu timezone
bot.action('timezone_menu', async (ctx) => {
  const adminId = ctx.from.id;
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  await ctx.answerCbQuery().catch(() => {});

  try {
    await editOrReply(ctx, getTimezoneStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildTimezoneKeyboard(),
    });
  } catch (e) {
    logger.error('❌ Gagal kirim menu timezone:', e.message || e);
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

// ON/OFF pengingat expired
bot.action('expiry_reminder_toggle', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
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

  await editOrReply(ctx, getExpiryReminderStatusText(), {
    parse_mode: 'HTML',
    reply_markup: buildExpiryReminderKeyboard(),
  });
});

// Ubah jam/menit dan refresh tampilan
async function adjustReminderTimeAndRefresh(ctx, deltaHour, deltaMinute) {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  if (deltaHour) {
    EXPIRY_REMINDER_HOUR = (EXPIRY_REMINDER_HOUR + deltaHour + 24) % 24;
  }

  if (deltaMinute) {
    let total = EXPIRY_REMINDER_MINUTE + deltaMinute;
    while (total < 0) total += 60;
    while (total >= 60) total -= 60;
    EXPIRY_REMINDER_MINUTE = total;
  }

  saveExpiryReminderConfig();

  await ctx.answerCbQuery('Waktu pengingat diubah.', { show_alert: false });

  await editOrReply(ctx, getExpiryReminderStatusText(), {
    parse_mode: 'HTML',
    reply_markup: buildExpiryReminderKeyboard(),
  });
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

// Audit fix HIGH: handler auto-backup sebelumnya pakai `adminId !== MASTER_ID`
// padahal tombol Auto Backup tampil di Menu Admin untuk SEMUA admin. Akibatnya
// admin non-master klik tombol -> kena alert "Tidak ada izin", inkonsisten
// dengan tombol lain di Menu Admin yang pakai ADMIN_IDS.includes(). Sekarang
// pakai ADMIN_IDS supaya semua admin bisa toggle auto-backup.
//
// Audit fix MEDIUM: ganti `editMessageText + try/catch reply` -> `editOrReply`
// supaya konsisten dengan handler menu admin lain (mis. trial, broadcast).
// editOrReply sudah handle "message is not modified" + fallback ke reply
// kalau pesan asli sudah hilang/expired.

// Buka menu pengaturan auto-backup
bot.action('backup_auto_menu', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  await ctx.answerCbQuery().catch(() => {});
  try {
    await editOrReply(ctx, getAutoBackupStatusText(), {
      parse_mode: 'HTML',
      reply_markup: buildAutoBackupKeyboard(),
    });
  } catch (e) {
    logger.error('❌ Gagal kirim menu auto backup:', e.message);
  }
});

// Toggle ON/OFF
bot.action('backup_auto_toggle', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  AUTO_BACKUP_ENABLED = !AUTO_BACKUP_ENABLED;
  saveAutoBackupConfig();
  restartAutoBackupScheduler();

  await ctx.answerCbQuery(
    AUTO_BACKUP_ENABLED ? 'Auto-backup diaktifkan.' : 'Auto-backup dimatikan.',
    { show_alert: false }
  );

  await editOrReply(ctx, getAutoBackupStatusText(), {
    parse_mode: 'HTML',
    reply_markup: buildAutoBackupKeyboard(),
  });
});

// Ubah interval ±1 jam
async function adjustIntervalAndRefresh(ctx, delta) {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  // Audit fix MEDIUM: tambah cap atas 168 jam (1 minggu) supaya tidak bisa
  // di-spam ke nilai absurd (mis. 999 jam = 41 hari tanpa backup).
  const next = AUTO_BACKUP_INTERVAL_HOURS + delta;
  AUTO_BACKUP_INTERVAL_HOURS = Math.max(1, Math.min(168, next));
  saveAutoBackupConfig();
  restartAutoBackupScheduler();

  await ctx.answerCbQuery(`Interval diatur: ${AUTO_BACKUP_INTERVAL_HOURS} jam.`, {
    show_alert: false,
  });

  await editOrReply(ctx, getAutoBackupStatusText(), {
    parse_mode: 'HTML',
    reply_markup: buildAutoBackupKeyboard(),
  });
}

bot.action('backup_auto_interval_minus', (ctx) => adjustIntervalAndRefresh(ctx, -1));
bot.action('backup_auto_interval_plus', (ctx) => adjustIntervalAndRefresh(ctx, +1));

// Preset interval 6 / 12 / 24 jam
async function setIntervalPreset(ctx, value) {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.answerCbQuery('Tidak ada izin.', { show_alert: true });
  }

  AUTO_BACKUP_INTERVAL_HOURS = value;
  saveAutoBackupConfig();
  restartAutoBackupScheduler();

  await ctx.answerCbQuery(`Interval diatur: ${value} jam.`, { show_alert: false });

  await editOrReply(ctx, getAutoBackupStatusText(), {
    parse_mode: 'HTML',
    reply_markup: buildAutoBackupKeyboard(),
  });
}

bot.action('backup_auto_set_6',  (ctx) => setIntervalPreset(ctx, 6));
bot.action('backup_auto_set_12', (ctx) => setIntervalPreset(ctx, 12));
bot.action('backup_auto_set_24', (ctx) => setIntervalPreset(ctx, 24));

// === ?→ CEK SALDO USER ===
bot.action('cek_saldo_user', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery();
  await ctx.reply('🆔 Masukkan ID Telegram user yang ingin dicek saldonya:');
  userState[adminId] = { step: 'cek_saldo_userid' };
});

// === ?→ RIWAYAT SALDO USER ===
bot.action('riwayat_saldo_user', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('🆔 Masukkan ID Telegram user/reseller yang ingin dilihat riwayat saldonya:');

  userState[adminId] = { step: 'riwayat_saldo_userid' };
});

// === ?→ TANDAI / ATUR STATUS USER (NORMAL / WATCHLIST / NAKAL) ===
bot.action('flag_user_start', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    '🚩 *Mode tandai user*\n\n' +
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
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan fitur ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  const newStatus = ctx.match[1]; // NORMAL / WATCHLIST / NAKAL
  const targetId = ctx.match[2];

  db.run(
    'UPDATE users SET flag_status = ? WHERE user_id = ?',
    [newStatus, targetId],
    function (err) {
      if (err) {
        logger.error('❌ Gagal mengupdate flag_status user:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengupdate status user.');
      }

      if (this.changes === 0) {
        return ctx.reply(
          `⚠️ User dengan ID ${targetId} tidak ditemukan di tabel users.`
        );
      }

      let label = '✅ NORMAL';
      if (newStatus === 'WATCHLIST') label = '⚠️ WATCHLIST';
      else if (newStatus === 'NAKAL') label = '⛔ NAKAL';

      ctx.reply(
        `✅ Status user \`${targetId}\` berhasil diubah menjadi: ${label}`,
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

// === ?→ MONITOR USER & RESELLER ===
bot.action('monitor_panel', async (ctx) => {
  const adminId = ctx.from.id;

  // Hanya admin yang boleh akses menu ini
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
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
    lines.push('<b>📊 Monitor User & Reseller</b>\n');

    // Ringkasan pengguna
    lines.push('<code>Ringkasan Pengguna</code>');
    lines.push(`• Total user terdaftar : <b>${totalUsers}</b>`);
    lines.push(`• Total reseller       : <b>${totalReseller}</b>\n`);

    // Ringkasan akun
    lines.push('<code>Ringkasan Akun</code>');
    lines.push(`• Total akun dibuat    : <b>${totalAccounts}</b>`);
    lines.push(`• Akun aktif sekarang  : <b>${totalActiveAccounts}</b>`);
    lines.push(`• Akun sudah expired   : <b>${totalExpiredAccounts}</b>\n`);

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
          `${no}. ${displayName} • bulan ini: <b>${totalMonth}</b> akun | total: <b>${totalAll}</b> akun`
        );
        no++;
      }
    }

    const text = lines.join('\n');

    // Edit pesan menu admin → tampilan monitor (tidak buat pesan baru)
    await editOrReply(ctx, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }],
        ],
      },
    });
  } catch (err) {
    logger.error('❌ Error di monitor_panel:', err);
    await ctx.reply('❌ Terjadi kesalahan saat menampilkan monitor user & reseller.');
  }
});

// === ?→ MENU LIST RESELLER & MEMBER ===
bot.action('list_res_mem', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
  }

  await ctx.answerCbQuery().catch(() => {});

  // Edit pesan menu admin → submenu pilih list (tidak buat pesan baru)
  await editOrReply(ctx, 'Pilih daftar yang ingin ditampilkan:', {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💎 List Reseller', callback_data: 'list_reseller' },
          { text: '👤 List Member',  callback_data: 'list_member'  }
        ],
        [
          { text: '🔙 Kembali ke Menu Reseller & Saldo', callback_data: 'admin_reseller_menu' }
        ]
      ]
    }
  });
});

// Tombol balik ke menu admin

// --- Fase 5 split: register handler admin/menu + admin/promo
const { createAdminMenuHandlers } = require('./admin/menu');
const { createPromoHandlers } = require('./admin/promo');
createAdminMenuHandlers({ bot, logger, adminIds, ADMIN_IDS, sendAdminMenu }).register();
createPromoHandlers({ bot, logger, adminIds }).register();

// --- Fase 5 lanjutan: register handler admin/reseller (target + bonus menu)
const { createResellerAdminHandlers } = require('./admin/reseller');
const __resellerAdminHandlers = createResellerAdminHandlers({
  bot,
  logger,
  ADMIN_IDS,
  state: {
    getTargetEnabled: () => RESELLER_TARGET_ENABLED,
    setTargetEnabled: (v) => { RESELLER_TARGET_ENABLED = v; },
    getTargetMin30d: () => RESELLER_TARGET_MIN_30D_ACCOUNTS,
    setTargetMin30d: (v) => { RESELLER_TARGET_MIN_30D_ACCOUNTS = v; },
    getTargetMinDays: () => RESELLER_TARGET_MIN_DAYS_PER_MONTH,
    setTargetMinDays: (v) => { RESELLER_TARGET_MIN_DAYS_PER_MONTH = v; },
    getBonusEnabled: () => RESELLER_ACTIVE_BONUS_ENABLED,
    setBonusEnabled: (v) => { RESELLER_ACTIVE_BONUS_ENABLED = v; },
    getBonusMinDuration: () => RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS,
    setBonusMinDuration: (v) => { RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS = v; },
    getBonusMinOmzet: () => RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET,
    setBonusMinOmzet: (v) => { RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET = v; },
    getBonusTier1Days: () => RESELLER_ACTIVE_BONUS_TIER1_DAYS,
    setBonusTier1Days: (v) => { RESELLER_ACTIVE_BONUS_TIER1_DAYS = v; },
    getBonusTier1Amount: () => RESELLER_ACTIVE_BONUS_TIER1_AMOUNT,
    setBonusTier1Amount: (v) => { RESELLER_ACTIVE_BONUS_TIER1_AMOUNT = v; },
    getBonusTier2Days: () => RESELLER_ACTIVE_BONUS_TIER2_DAYS,
    setBonusTier2Days: (v) => { RESELLER_ACTIVE_BONUS_TIER2_DAYS = v; },
    getBonusTier2Amount: () => RESELLER_ACTIVE_BONUS_TIER2_AMOUNT,
    setBonusTier2Amount: (v) => { RESELLER_ACTIVE_BONUS_TIER2_AMOUNT = v; },
    getBonusTier3Days: () => RESELLER_ACTIVE_BONUS_TIER3_DAYS,
    setBonusTier3Days: (v) => { RESELLER_ACTIVE_BONUS_TIER3_DAYS = v; },
    getBonusTier3Amount: () => RESELLER_ACTIVE_BONUS_TIER3_AMOUNT,
    setBonusTier3Amount: (v) => { RESELLER_ACTIVE_BONUS_TIER3_AMOUNT = v; },
  },
  getTiers: () => getResellerActiveBonusTiers(),
  getMonthRange: (offset) => getMonthRange(offset),
  getEligiblePreview: (offset) => getEligibleResellerActiveBonusPreview(offset),
  grantBonus: (params) => grantResellerActiveBonus(params),
  updateTargetVars: (partial) => updateResellerTargetVars(partial),
  updateBonusVars: (partial) => updateResellerBonusVars(partial),
});
__resellerAdminHandlers.register();
const renderResellerTargetMenu = (...args) => __resellerAdminHandlers.renderResellerTargetMenu(...args);
const renderResellerBonusMenu = (...args) => __resellerAdminHandlers.renderResellerBonusMenu(...args);

// --- Fase 5 split: bot.action('admin_menu', async dipindah ke admin/
// === SUBMENU: RESELLER & SALDO ===
// --- Fase 5 split: bot.action('admin_reseller_menu', async dipindah ke admin/

// Buka menu "?→ Target Reseller"
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_reseller_target', async" dipindah ke admin/reseller.js

// ON/OFF target reseller
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_target_toggle', async" dipindah ke admin/reseller.js

// Naikkan minimal akun 30 hari
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_target_min30_inc', async" dipindah ke admin/reseller.js

// Turunkan minimal akun 30 hari (minimal 1)
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_target_min30_dec', async" dipindah ke admin/reseller.js

// Naikkan minimal total hari (step 30 hari)
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_target_days_inc', async" dipindah ke admin/reseller.js

// Turunkan minimal total hari (minimal 30)
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_target_days_dec', async" dipindah ke admin/reseller.js

// Tombol tengah (NOP) biar nggak error kalau kepencet
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_target_min30_nop', async" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_target_days_nop', async" dipindah ke admin/reseller.js



// Buka menu bonus reseller aktif
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_reseller_bonus_menu', async" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_bonus_nop', async" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_bonus_toggle', async" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "function clampResellerBonusConfig" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "async function updateAndRenderResellerBonusMenu" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_bonus_mindur_inc', async" dipindah ke admin/reseller.js
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_bonus_mindur_dec', async" dipindah ke admin/reseller.js
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_bonus_omzet_inc', async" dipindah ke admin/reseller.js
// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_bonus_omzet_dec', async" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "function adjustResellerBonusVar" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "for(tier days/amount handlers)" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_bonus_preview', async" dipindah ke admin/reseller.js

// --- Fase 5 lanjutan split: reseller handler "bot.action('admin_res_bonus_process', async" dipindah ke admin/reseller.js

// === SUBMENU: MANAGEMEN SERVER ===
bot.action('admin_server_menu', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    // Biar kalau ada user biasa iseng klik, dapat notif
    return ctx.answerCbQuery('🚫 Khusus admin.', { show_alert: true }).catch(() => {});
  }

  await ctx.answerCbQuery().catch(() => {});

  const text = buildAdminServerMenuText();
  const keyboard = buildAdminServerMenuKeyboard();

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
// --- Fase 5 split: bot.action('promo_template_menu', async dipindah ke admin/
// Helper kecil untuk ambil username bot
// --- Fase 5 split: getBotTagForPromo dipindah ke admin/

// ?→ Template 1: Katalog Paket VPN
// --- Fase 5 split: bot.action('promo_tpl_catalog', async dipindah ke admin/

// ?→ Template 2: Open Reseller
// --- Fase 5 split: bot.action('promo_tpl_reseller', async dipindah ke admin/

// → Template 3: Promo Singkat Bot Auto Order
// --- Fase 5 split: bot.action('promo_tpl_short', async dipindah ke admin/

// ?→ Template 4: Style ???Kaisar Store→
// --- Fase 5 split: bot.action('promo_tpl_kaisar', async dipindah ke admin/

// === ?→ LIST RESELLER ===
bot.action('list_reseller', async (ctx) => {
  const adminId = ctx.from.id;

  if (!adminIds.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
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
      return ctx.reply('⚠️ Belum ada reseller terdaftar.');
    }

    const items = [];

    for (const idStr of resellerList) {
      const userId = Number(idStr);
      if (!userId) continue;

      let username = '';
      try {
        username = await getUsernameById(userId);
      } catch (e) {
        username = '';
      }

      const saldoRow = await new Promise((resolve) => {
        db.get(
          'SELECT saldo FROM users WHERE user_id = ?',
          [userId],
          (err, row) => resolve(err || !row ? null : row)
        );
      });

      items.push({
        userId,
        username,
        saldo: saldoRow ? saldoRow.saldo : 0,
      });
    }

    await editOrReply(ctx, buildResellerListText(items), {
      parse_mode: 'HTML',
      reply_markup: buildListResMemberBackKeyboard(),
    });
  } catch (err) {
    logger.error('❌ Error saat menampilkan daftar reseller:', err);
    await ctx.reply('❌ Terjadi kesalahan saat menampilkan daftar reseller.');
  }
});

// === ?→ LIST MEMBER (USER BIASA) ===
bot.action('list_member', async (ctx) => {
  const adminId = ctx.from.id;

  // Pakai ADMIN_IDS (array angka) untuk cek admin
  if (!ADMIN_IDS.includes(adminId)) {
    return ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
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
      logger.error('⚠️ Gagal membaca ressel.db saat list_member:', e);
    }

    // Filter: user yang bukan reseller dan bukan admin
    const memberUsers = allUsers.filter((u) => {
      const uidStr = String(u.user_id);
      if (resellerSet.has(uidStr)) return false;                // buang reseller
      if (ADMIN_IDS.includes(Number(u.user_id))) return false;  // buang admin
      return true;
    });

    if (memberUsers.length === 0) {
      return ctx.reply('⚠️ Belum ada member biasa yang terdaftar.');
    }

    const items = [];

    for (const user of memberUsers) {
      const userId = user.user_id;

      let username = '';
      try {
        username = await getUsernameById(userId);
      } catch (e) {
        username = '';
      }

      items.push({
        userId,
        username,
        saldo: user.saldo || 0,
      });
    }

    await editOrReply(ctx, buildMemberListText(items), {
      parse_mode: 'HTML',
      reply_markup: buildListResMemberBackKeyboard(),
    });
  } catch (error) {
    logger.error('❌ Error saat menampilkan daftar member:', error);
    await ctx.reply('❌ Terjadi kesalahan saat menampilkan daftar member.');
  }
});

// === ?→ LIST SEMUA USER (ADMIN + RESELLER + MEMBER) + PAGING ===
const LIST_USERS_PAGE_SIZE = 40; // Ubah kalau mau lebih/kurang per halaman

async function renderAllUsersPage(ctx, page, editMessage) {
  try {
    const adminId = ctx.from?.id;
    if (!adminId || !ADMIN_IDS.includes(adminId)) {
      // kalau bukan admin, jangan apa-apa
      if (!editMessage) {
        await ctx.reply('🚫 Anda tidak memiliki izin untuk menggunakan menu ini.');
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
          await ctx.editMessageText('⚠️ Belum ada user terdaftar di database.', {
            parse_mode: 'HTML',
          });
        } catch (e) {
          await ctx.reply('⚠️ Belum ada user terdaftar di database.', {
            parse_mode: 'HTML',
          });
        }
      } else {
        await ctx.reply('⚠️ Belum ada user terdaftar di database.', {
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
      logger.error('⚠️ Gagal membaca ressel.db saat list_all_users:', e);
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
      '<b>📜 DAFTAR SEMUA USER</b>\n' +
      `Hal ${page}/${totalPages} (maks ${pageSize} user/halaman)\n\n`;

    const message = header + '<pre>' + body + '</pre>';

    // Keyboard paging
    const buttons = [];
    if (page > 1) {
      buttons.push({
        text: '⚠️ Sebelumnya',
        callback_data: `list_all_users_p_${page - 1}`,
      });
    }
    if (page < totalPages) {
      buttons.push({
        text: 'Berikutnya ➡️',
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
    logger.error('❌ Error di renderAllUsersPage:', err);
    if (!editMessage) {
      await ctx.reply('❌ Terjadi kesalahan saat menampilkan daftar semua user.', {
        parse_mode: 'HTML',
      });
    }
  }
}

// Tombol di menu admin → buka halaman 1
bot.action('list_all_users', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await renderAllUsersPage(ctx, 1, false);
});

// Tombol paging (Next / Prev) → ganti halaman di pesan yang sama
bot.action(/list_all_users_p_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const page = parseInt(ctx.match[1], 10) || 1;
  await renderAllUsersPage(ctx, page, true);
});


///////////////

// ====== PROGRAM RESELLER ======
// --- Fase modularisasi: jadi_reseller dipindah ke modules/reseller-upgrade.js

// ========= → MENU CEPAT: SALDO, RENEW, TRANSAKSI, PANDUAN =========
// --- Fase modularisasi: handler dashboard user dipindah ke modules/user-dashboard.js
const { createUserDashboardHandlers } = require('./modules/user-dashboard');
const userDashboardHandlers = createUserDashboardHandlers({
  bot,
  db,
  logger,
  ensurePrivateChat,
  sendCleanMenu,
  htmlEscape,
  getUserSaldo,
  getUserLinkInfo,
  getTrialConfig,
  storeName: NAMA_STORE,
  adminUsername: ADMIN_USERNAME,
  timeZone: TIME_ZONE,
});
userDashboardHandlers.register();

// ========= → RINGKASAN PENJUALAN RESELLER =========
// --- Fase modularisasi: sales_summary dipindah ke modules/reseller-sales.js
const { createResellerSalesHandlers } = require('./modules/reseller-sales');
const resellerSalesHandlers = createResellerSalesHandlers({
  bot,
  db,
  logger,
  ensurePrivateChat,
  sendCleanMenu,
  isResellerId,
  adminIds,
  getResellerActiveBonusStats,
  getTargetMin30dAccounts: () => RESELLER_TARGET_MIN_30D_ACCOUNTS,
  getTargetMinDaysPerMonth: () => RESELLER_TARGET_MIN_DAYS_PER_MONTH,
  getBonusEnabled: () => RESELLER_ACTIVE_BONUS_ENABLED,
  getBonusMinDurationDays: () => RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS,
  getBonusMinDailyOmzet: () => RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET,
  timeZone: TIME_ZONE,
});
resellerSalesHandlers.register();

// ========= → UPGRADE RESELLER USER =========
// --- Fase modularisasi: jadi_reseller dipindah ke modules/reseller-upgrade.js
const { createResellerUpgradeHandlers } = require('./modules/reseller-upgrade');
const resellerUpgradeHandlers = createResellerUpgradeHandlers({
  bot,
  sendCleanMenu,
  htmlEscape,
  storeName: NAMA_STORE,
  adminUsername: ADMIN_USERNAME,
});
resellerUpgradeHandlers.register();

// ========= → BANTUAN UNTUK PENGGUNA =========
// --- Fase modularisasi: help_user dipindah ke modules/user-dashboard.js

///////
bot.action('addserver_reseller', async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  userState[ctx.chat.id] = { step: 'reseller_domain' };
  await ctx.reply('🌐 Masukkan domain server reseller:');
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

  await ctx.reply('🆔 Masukkan ID Telegram user yang ingin ditambahkan saldo:');
});


bot.action('sendMainMenu', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});
    await sendMainMenu(ctx);
  } catch (error) {
    console.error('❌ Error saat kembali ke menu utama:', error);
    await ctx.reply('⚠️ Terjadi kesalahan saat membuka menu utama.');
  }
});


// ========= → MENU LAYANAN USER =========
// --- Fase modularisasi: service_create/trial/renew/del/lock/unlock dipindah ke modules/service-menu.js
const { createServiceMenuHandlers } = require('./modules/service-menu');
const serviceMenuHandlers = createServiceMenuHandlers({
  bot,
  logger,
  sendCleanMenu,
  getTrialConfig,
});
serviceMenuHandlers.register();


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

    // ?→ Cek status reseller pakai helper yang sama dengan fitur lain
    let isReseller = false;
    try {
      isReseller = await isUserReseller(userId);
    } catch (e) {
      logger.error('❌ Gagal cek status reseller:', e.message || e);
    }

    // Member biasa tetap dapat ringkasan server publik. Detail port live
    // (cek-port.sh) tetap khusus reseller/admin karena output-nya lebih teknis.
    if (!isReseller && !isAdmin) {
      return userDashboardHandlers.showPublicServerStatus(ctx);
    }

    // → Jika reseller / admin, lanjut jalankan cek service
    const loadingMsg = await ctx.reply('⏳ Sedang mengecek status server, mohon tunggu sebentar...');

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
        '? Terjadi kesalahan saat menjalankan skrip pengecekan server.',
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
          '? Terjadi kesalahan saat menjalankan skrip pengecekan server.',
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }

      if (stderr) {
        logger.error(`Error dari skrip cek-port.sh: ${stderr}`);
      }

      const timestamp = new Date().toLocaleString('id-ID', {
        timeZone: TIME_ZONE,
      });
      const resultText = buildServerStatusResultText({
        stdout,
        timestamp,
      });

      ctx.telegram.editMessageText(
        loadingMsg.chat.id,
        loadingMsg.message_id,
        undefined,
        resultText,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    });
  } catch (err) {
    logger.error('❌ Error cek_service:', err);
    try {
      await ctx.reply('❌ Gagal menjalankan pengecekan server.');
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

        const msg = buildQrisStatusText({
          invoiceId,
          status: row.status || 'pending',
        });

        // Kalau tombol ditekan dari caption foto, coba edit captionnya
        try {
          await ctx.editMessageCaption(msg, {
            parse_mode: 'HTML',
            reply_markup: buildQrisStatusKeyboard(invoiceId),
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
      await ctx.answerCbQuery('❌ Terjadi kesalahan, silakan coba lagi.', { show_alert: true });
    } catch (e) {
      console.error('Gagal kirim callback error send_main_menu:', e.message);
    }
    return;
  }
  await sendMainMenu(ctx);
});

// === HANDLER: Ringkasan Penjualan Reseller (pakai akun & hari) ===
// --- Fase modularisasi: dipindah ke modules/reseller-sales.js



// ========= → SERVER SELECTION =========
// --- Fase modularisasi: startSelectServer + navigate_* dipindah ke modules/server-selection.js
const { createServerSelectionHandlers } = require('./modules/server-selection');
const serverSelectionHandlers = createServerSelectionHandlers({
  bot,
  db,
  logger,
  userState,
  isUserReseller,
  resellerDiscount: RESELLER_DISCOUNT,
});
const startSelectServer = serverSelectionHandlers.startSelectServer;
serverSelectionHandlers.register();

// ========= → PROTOCOL SERVICE ACTIONS =========
// --- Fase modularisasi: create_*/trial_*/renew_*/del_*/lock_*/unlock_* wrapper dipindah ke modules/service-protocol.js
const { createServiceProtocolHandlers } = require('./modules/service-protocol');
const serviceProtocolHandlers = createServiceProtocolHandlers({
  bot,
  logger,
  getUserFlagStatus,
  startSelectServer,
});
serviceProtocolHandlers.register();

// ========= → USERNAME SELECTION =========
// --- Fase modularisasi: create|renew_username_* + trial_username_* dipindah ke modules/service-username-selection.js
const { createServiceUsernameSelectionHandlers } = require('./modules/service-username-selection');
const serviceUsernameSelectionHandlers = createServiceUsernameSelectionHandlers({
  bot,
  db,
  logger,
  userState,
  sendCleanMenu,
  showErrorOnMenu,
  getTrialConfig,
  defaultTrialConfig: DEFAULT_TRIAL_CONFIG,
});
serviceUsernameSelectionHandlers.register();


// ========= ?→ AKUN SAYA → LIST AKUN MILIK USER (AKTIF / EXPIRED / SEMUA) =========
// --- Fase 4 split: showMyAccounts dipindah ke accounts/

// Default dari tombol ?→ Akun Saya → tampilkan akun AKTIF
// --- Fase 4 split: my_accounts action dipindah ke accounts/

// Tombol filter
// --- Fase 4 split: my_accounts_active/expired/all dipindah ke accounts/
// --- Fase 4 split: myacc_page dipindah ke accounts/

// ========= ?→ RIWAYAT / LAPORAN SAYA (VERSI DETAIL + PAGING) =========
const MY_STATS_PAGE_SIZE = 10; // ?→ ganti ke 15 / 20 kalau mau

async function showMyStatsPage(ctx, page) {
  try {
    if (!ctx.from) {
      return ctx.reply('⚠️ Tidak bisa membaca data pengguna.');
    }

    const userId = ctx.from.id;
    await ctx.answerCbQuery().catch(() => {});

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

    const text = buildMyStatsText({
      totalAll,
      totalActive,
      totalExpired,
      currentPage,
      totalPages,
      offset,
      accounts: recentAccounts,
      timeZone: TIME_ZONE,
    });
    const replyMarkup = buildMyStatsKeyboard({ currentPage, totalPages });

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
    logger.error('❌ Error di showMyStatsPage:', err);
    try {
      await sendCleanMenu(ctx, '❌ Terjadi kesalahan saat menampilkan riwayat.', {
        parse_mode: 'HTML',
      });
    } catch {}
  }
}


// Callback dari tombol utama (tanpa halaman) → mulai dari halaman 0
bot.action('my_stats', async (ctx) => {
  return showMyStatsPage(ctx, 0);
});

// Callback dari tombol paging: my_stats:0, my_stats:1, dst
bot.action(/my_stats:(\d+)/, async (ctx) => {
  const page = parseInt(ctx.match[1], 10) || 0;
  return showMyStatsPage(ctx, page);
});

// ========= DETAIL AKUN → SAAT SATU AKUN DIPILIH =========
// --- Fase 4 split: accsel dipindah ke accounts/
// ========= → HAPUS AKUN DARI "AKUN SAYA" =========
// --- Fase 4 split: accdel dipindah ke accounts/
// ========= ????→ KUNCI AKUN DARI "AKUN SAYA" =========
// --- Fase 4 split: acclock dipindah ke accounts/
// ========= ?→ BUKA KUNCI AKUN DARI "AKUN SAYA" =========
// --- Fase 4 split: accunlock dipindah ke accounts/

// ========= ???→ PERPANJANG AKUN DARI "AKUN SAYA" =========
// --- Fase 4 split: accrenew dipindah ke accounts/

// --- Service username selection callbacks dipindah ke modules/service-username-selection.js
bot.action('account_flow_cancel', async (ctx) => {
  try { await ctx.answerCbQuery('Dibatalkan').catch(() => {}); } catch (_) {}
  const chatId = ctx.chat && ctx.chat.id;
  const state = chatId ? userState[chatId] : null;
  if (state && isCancellableAccountFlowStep(state.step)) {
    delete userState[chatId];
    return sendCleanMenu(ctx, '⛔ Proses akun dibatalkan. Tidak ada saldo yang dipotong.', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }]] },
    });
  }
  return sendCleanMenu(ctx, 'ℹ️ Tidak ada proses akun yang bisa dibatalkan saat ini.', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }]] },
  });
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

      // ==== MODE PENGUMUMAN (MANUAL & TEMPLATE) DARI MENU ?→ ====
  const fromId = ctx.from && ctx.from.id;
  if (fromId && adminIds.includes(fromId)) {
    const bState = broadcastSessions[fromId];

    // Kalau tidak ada sesi broadcast aktif → lanjut ke logika lain
    if (!bState) {
      // lanjut ke bawah (state menu biasa)
    } else if (bState.step === 'wait_message') {
      // ----- MODE MANUAL: user kirim teks bebas -----
      if (text.startsWith('/')) {
        await ctx.reply(
          '⚠️ Pengumuman dibatalkan karena kamu mengirim perintah lain.\n' +
            'Kalau mau mulai lagi, buka menu admin lalu pilih "📢 Kirim Pengumuman".',
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
        `📋 <b>Preview Pengumuman</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          bState.message +
          '\n\nKirim pengumuman ini? Atau test dulu ke kamu sendiri?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📢 Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: '❌ Batal', callback_data: 'broadcast_cancel' },
              ],
              [
                { text: '🧪 Test ke Saya (preview)', callback_data: 'broadcast_test_self' },
              ],
            ],
          },
        }
      );

      return;
    } else if (bState.step === 'tm_ask_layanan') {
      // ----- TEMPLATE MAINTENANCE: langkah 1 (nama layanan) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks nama layanan saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang nama layanan.'
        );
        return;
      }
      bState.layanan = r.value;
      bState.step = 'tm_ask_waktu';

      await ctx.reply(
        '2️⃣ Masukkan waktu maintenance (hari, tanggal, dan jam mulai).\n' +
          'Contoh:\n' +
          '• Sabtu, 22-11-2025, jam 21.00 WIT\n' +
          '• Malam ini jam 23.00 WIT',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'tm_ask_waktu') {
      // ----- TEMPLATE MAINTENANCE: langkah 2 (waktu) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks waktu saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang waktu maintenance.'
        );
        return;
      }
      bState.waktu = r.value;
      bState.step = 'tm_ask_durasi';

      await ctx.reply(
        '3️⃣ Masukkan perkiraan durasi maintenance.\n' +
          'Contoh:\n' +
          '• 30 menit\n' +
          '• 1 jam\n' +
          '• 2 jam',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'tm_ask_durasi') {
      // ----- TEMPLATE MAINTENANCE: langkah 3 (durasi) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks durasi saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang durasi maintenance.'
        );
        return;
      }
      bState.durasi = r.value;
      bState.step = 'tm_ask_catatan';

      await ctx.reply(
        '4️⃣ Masukkan catatan tambahan (opsional).\n' +
          'Jika tidak ada, kirim tanda <code>-</code> saja.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'tm_ask_catatan') {
      // ----- TEMPLATE MAINTENANCE: langkah 4 (catatan + susun pesan) -----
      const catatanRaw = (ctx.message.text || '').trim();
      if (catatanRaw.startsWith('/')) {
        await ctx.reply(
          '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks catatan atau "-" untuk kosong.'
        );
        return;
      }
      bState.catatan = catatanRaw === '-' ? '' : htmlEscape(catatanRaw);

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') {
        targetLabel = 'semua reseller';
      } else if (bState.target === 'member') {
        targetLabel = 'member (bukan reseller & bukan admin)';
      }

      // Susun pesan maintenance otomatis
      const msgLines = [];

      msgLines.push('🛠️ <b>PENGUMUMAN MAINTENANCE SERVER VPN</b>');
      msgLines.push('');
      msgLines.push('Kepada pengguna VPN,');
      msgLines.push(
        `Akan dilakukan maintenance pada layanan <b>${bState.layanan}</b>.`
      );
      msgLines.push('');
      msgLines.push(`⏰ Waktu mulai : <b>${bState.waktu}</b>`);
      msgLines.push(`• Durasi      : <b>${bState.durasi}</b>`);
      if (bState.catatan) {
        msgLines.push('');
        msgLines.push(`📌 Catatan: ${bState.catatan}`);
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
        `📋 <b>Preview Pengumuman Maintenance</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          finalMessage +
          '\n\nKirim pengumuman ini? Atau test dulu ke kamu sendiri?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📢 Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: '❌ Batal', callback_data: 'broadcast_cancel' },
              ],
              [
                { text: '🧪 Test ke Saya (preview)', callback_data: 'broadcast_test_self' },
              ],
            ],
          },
        }
      );

      return;
    } else if (bState.step === 'mtdone_ask_layanan') {
      // ----- TEMPLATE MAINTENANCE SELESAI: langkah 1 (nama layanan) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks nama layanan saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang nama layanan.'
        );
        return;
      }
      bState.layanan = r.value;
      bState.step = 'mtdone_ask_durasi';

      await ctx.reply(
        '2️⃣ Masukkan durasi maintenance yang sudah berlangsung (waktu aktual).\n' +
          'Contoh:\n' +
          '• 30 menit\n' +
          '• 1 jam\n' +
          '• Lebih cepat dari estimasi\n' +
          '• 2 jam (sesuai estimasi)',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'mtdone_ask_durasi') {
      // ----- TEMPLATE MAINTENANCE SELESAI: langkah 2 (durasi aktual) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks durasi saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang durasi maintenance.'
        );
        return;
      }
      bState.durasi = r.value;
      bState.step = 'mtdone_ask_catatan';

      await ctx.reply(
        '3️⃣ Masukkan catatan tambahan (opsional).\n' +
          'Contoh: apa yang sudah di-fix, peningkatan performa, dll.\n' +
          'Jika tidak ada catatan, kirim tanda <code>-</code> saja.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'mtdone_ask_catatan') {
      // ----- TEMPLATE MAINTENANCE SELESAI: langkah 3 (catatan + susun pesan) -----
      const catatanRaw = (ctx.message.text || '').trim();
      if (catatanRaw.startsWith('/')) {
        await ctx.reply(
          '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks catatan atau "-" untuk kosong.'
        );
        return;
      }
      bState.catatan = catatanRaw === '-' ? '' : htmlEscape(catatanRaw);

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') {
        targetLabel = 'semua reseller';
      } else if (bState.target === 'member') {
        targetLabel = 'member (bukan reseller & bukan admin)';
      }

      // Susun pesan maintenance selesai otomatis
      const msgLines = [];
      msgLines.push('✅ <b>MAINTENANCE SELESAI</b>');
      msgLines.push('');
      msgLines.push('Kepada pengguna VPN,');
      msgLines.push(
        `Maintenance pada layanan <b>${bState.layanan}</b> sudah selesai dilaksanakan.`
      );
      msgLines.push('');
      msgLines.push(`⏱️ Durasi : <b>${bState.durasi}</b>`);
      if (bState.catatan) {
        msgLines.push(`📌 Catatan: ${bState.catatan}`);
      }
      msgLines.push('');
      msgLines.push('Layanan VPN sudah kembali normal dan stabil.');
      msgLines.push('Selamat menggunakan layanan VPN kembali. 🚀');
      msgLines.push('');
      msgLines.push(
        'Kalau masih ada kendala koneksi, silakan reconnect terlebih dahulu atau hubungi admin untuk bantuan.'
      );
      msgLines.push('Terima kasih atas pengertian dan kesabarannya.');

      const finalMessage = msgLines.join('\n');

      bState.message = finalMessage;
      bState.step = 'confirm';

      await ctx.reply(
        `📋 <b>Preview Pengumuman Maintenance Selesai</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          finalMessage +
          '\n\nKirim pengumuman ini? Atau test dulu ke kamu sendiri?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📢 Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: '❌ Batal', callback_data: 'broadcast_cancel' },
              ],
              [
                { text: '🧪 Test ke Saya (preview)', callback_data: 'broadcast_test_self' },
              ],
            ],
          },
        }
      );

      return;
    } else if (bState.step === 'promo_ask_paket') {
      // ----- TEMPLATE PROMO: langkah 1 (nama paket/promo) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks nama paket saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang nama paket.'
        );
        return;
      }
      bState.paket = r.value;
      bState.step = 'promo_ask_detail';

      await ctx.reply(
        '2️⃣ Masukkan detail promo/diskon singkat.\n' +
          'Contoh:\n' +
          '• Diskon 30%, dari 30K jadi 20K\n' +
          '• Beli 1 bulan gratis 7 hari\n' +
          '• Harga spesial hanya hari ini',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'promo_ask_detail') {
      // ----- TEMPLATE PROMO: langkah 2 (detail promo) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks detail promo saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang detail promo.'
        );
        return;
      }
      bState.detail = r.value;
      bState.step = 'promo_ask_berlaku';

      await ctx.reply(
        '3️⃣ Masukkan masa berlaku promo.\n' +
          'Contoh:\n' +
          '• Sampai 30-11-2025\n' +
          '• Hanya sampai akhir bulan ini\n' +
          '• Berlaku 3 hari ke depan',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'promo_ask_berlaku') {
      // ----- TEMPLATE PROMO: langkah 3 (berlaku sampai) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks masa berlaku saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang masa berlaku.'
        );
        return;
      }
      bState.berlaku = r.value;
      bState.step = 'promo_ask_catatan';

      await ctx.reply(
        '4️⃣ Masukkan catatan tambahan (opsional).\n' +
          'Jika tidak ada, kirim tanda <code>-</code> saja.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'promo_ask_catatan') {
      // ----- TEMPLATE PROMO: langkah 4 (catatan + susun pesan) -----
      const catatanRaw = (ctx.message.text || '').trim();
      if (catatanRaw.startsWith('/')) {
        await ctx.reply(
          '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks catatan atau "-" untuk kosong.'
        );
        return;
      }
      bState.catatan = catatanRaw === '-' ? '' : htmlEscape(catatanRaw);

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') {
        targetLabel = 'semua reseller';
      } else if (bState.target === 'member') {
        targetLabel = 'member (bukan reseller & bukan admin)';
      }

      const lines = [];
      lines.push('🎁 <b>PROMO / DISKON LAYANAN VPN</b>');
      lines.push('');
      lines.push(`Sekarang tersedia promo untuk <b>${bState.paket}</b>.`);
      lines.push(bState.detail);
      lines.push('');
      lines.push(`📅 Berlaku sampai: <b>${bState.berlaku}</b>`);
      if (bState.catatan) {
        lines.push('');
        lines.push(`📌 Catatan: ${bState.catatan}`);
      }
      lines.push('');
      lines.push('Minat? Silakan hubungi admin atau beli langsung melalui bot.');

      const finalMessage = lines.join('\n');

      bState.message = finalMessage;
      bState.step = 'confirm';

      await ctx.reply(
        `📋 <b>Preview Pengumuman Promo/Diskon</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          finalMessage +
          '\n\nKirim pengumuman ini? Atau test dulu ke kamu sendiri?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📢 Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: '❌ Batal', callback_data: 'broadcast_cancel' },
              ],
              [
                { text: '🧪 Test ke Saya (preview)', callback_data: 'broadcast_test_self' },
              ],
            ],
          },
        }
      );

      return;
    } else if (bState.step === 'slot_ask_layanan') {
      // ----- TEMPLATE SLOT TERBATAS: langkah 1 (nama layanan/produk) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks nama layanan/produk saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang nama layanan/produk.'
        );
        return;
      }
      bState.layanan = r.value;
      bState.step = 'slot_ask_sisa';

      await ctx.reply(
        '2️⃣ Masukkan info sisa slot/stok (opsional).\n' +
          'Contoh:\n' +
          '• Stok terakhir\n' +
          '• Tinggal 5 slot\n' +
          '• Tinggal 10 akun\n\n' +
          'Jika tidak ingin sebut angka spesifik, kirim tanda <code>-</code> saja.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'slot_ask_sisa') {
      // ----- TEMPLATE SLOT: langkah 2 (sisa slot, opsional) -----
      const sisaRaw = (ctx.message.text || '').trim();
      if (sisaRaw.startsWith('/')) {
        await ctx.reply(
          '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks atau "-" untuk skip.'
        );
        return;
      }
      bState.sisa = sisaRaw === '-' ? '' : htmlEscape(sisaRaw);
      bState.step = 'slot_ask_deadline';

      await ctx.reply(
        '3️⃣ Masukkan deadline / sampai kapan (opsional).\n' +
          'Contoh:\n' +
          '• Selama persediaan masih ada\n' +
          '• Sampai akhir minggu ini\n' +
          '• Sampai 25-12-2025\n\n' +
          'Jika tidak ada deadline spesifik, kirim tanda <code>-</code> saja.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'slot_ask_deadline') {
      // ----- TEMPLATE SLOT: langkah 3 (deadline, opsional) -----
      const dlRaw = (ctx.message.text || '').trim();
      if (dlRaw.startsWith('/')) {
        await ctx.reply(
          '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks atau "-" untuk skip.'
        );
        return;
      }
      bState.deadline = dlRaw === '-' ? '' : htmlEscape(dlRaw);
      bState.step = 'slot_ask_catatan';

      await ctx.reply(
        '4️⃣ Masukkan catatan / call-to-action tambahan (opsional).\n' +
          'Contoh:\n' +
          '• Buruan order sebelum kehabisan!\n' +
          '• Hubungi admin untuk slot tersisa.\n\n' +
          'Jika tidak ada, kirim tanda <code>-</code> saja.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'slot_ask_catatan') {
      // ----- TEMPLATE SLOT: langkah 4 (catatan + susun pesan) -----
      const catatanRaw = (ctx.message.text || '').trim();
      if (catatanRaw.startsWith('/')) {
        await ctx.reply(
          '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks catatan atau "-" untuk kosong.'
        );
        return;
      }
      bState.catatan = catatanRaw === '-' ? '' : htmlEscape(catatanRaw);

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') targetLabel = 'semua reseller';
      else if (bState.target === 'member') targetLabel = 'member (bukan reseller & bukan admin)';

      const lines = [];
      lines.push('🔥 <b>SLOT TERBATAS — JANGAN SAMPAI KEHABISAN</b>');
      lines.push('');
      lines.push('Kepada pengguna VPN,');
      lines.push(`Saat ini layanan <b>${bState.layanan}</b>`);
      lines.push('ketersediaannya sangat terbatas.');
      lines.push('');
      if (bState.sisa) {
        lines.push(`📦 Sisa slot   : <b>${bState.sisa}</b>`);
      }
      if (bState.deadline) {
        lines.push(`⏰ Berlaku     : <b>${bState.deadline}</b>`);
      }
      if (bState.catatan) {
        lines.push(`📌 Catatan     : ${bState.catatan}`);
      }
      if (bState.sisa || bState.deadline || bState.catatan) {
        lines.push('');
      }
      lines.push('Buruan order sebelum kehabisan slot.');
      lines.push('Order langsung lewat menu di bot ini.');

      const finalMessage = lines.join('\n');
      bState.message = finalMessage;
      bState.step = 'confirm';

      await ctx.reply(
        `📋 <b>Preview Pengumuman Slot/Stok Terbatas</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          finalMessage +
          '\n\nKirim pengumuman ini? Atau test dulu ke kamu sendiri?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📢 Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: '❌ Batal', callback_data: 'broadcast_cancel' },
              ],
              [
                { text: '🧪 Test ke Saya (preview)', callback_data: 'broadcast_test_self' },
              ],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'info_ask_judul') {
      // ----- TEMPLATE INFO UMUM: langkah 1 (judul) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks judul saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang judul pengumuman.'
        );
        return;
      }
      bState.judul = r.value;
      bState.step = 'info_ask_isi';

      await ctx.reply(
        '2️⃣ Masukkan isi pengumuman.\n' +
          'Contoh:\n' +
          '• Server SG-3 sudah online dan siap dipakai.\n' +
          '• Mulai 1 Januari 2026, pemakaian VPN dibatasi 1 device per akun.\n' +
          '• Bot akan offline tanggal 25 Des untuk libur Natal.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'info_ask_isi') {
      // ----- TEMPLATE INFO UMUM: langkah 2 (isi) -----
      const r = sanitizeBroadcastTemplateInput(ctx.message.text);
      if (!r.ok) {
        await ctx.reply(
          r.reason === 'command'
            ? '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks isi pengumuman saja.'
            : '⚠️ Teks tidak boleh kosong. Kirim ulang isi pengumuman.'
        );
        return;
      }
      bState.isi = r.value;
      bState.step = 'info_ask_catatan';

      await ctx.reply(
        '3️⃣ Masukkan catatan tambahan (opsional).\n' +
          'Jika tidak ada, kirim tanda <code>-</code> saja.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
            ],
          },
        }
      );
      return;
    } else if (bState.step === 'info_ask_catatan') {
      // ----- TEMPLATE INFO UMUM: langkah 3 (catatan + susun pesan) -----
      const catatanRaw = (ctx.message.text || '').trim();
      if (catatanRaw.startsWith('/')) {
        await ctx.reply(
          '⚠️ Tolong jangan kirim command (/...) di sini. Kirim teks catatan atau "-" untuk kosong.'
        );
        return;
      }
      bState.catatan = catatanRaw === '-' ? '' : htmlEscape(catatanRaw);

      let targetLabel = 'semua user';
      if (bState.target === 'reseller') targetLabel = 'semua reseller';
      else if (bState.target === 'member') targetLabel = 'member (bukan reseller & bukan admin)';

      const lines = [];
      lines.push(`📋 <b>${bState.judul}</b>`);
      lines.push('');
      lines.push(bState.isi);
      if (bState.catatan) {
        lines.push('');
        lines.push(`📌 Catatan: ${bState.catatan}`);
      }
      lines.push('');
      lines.push('Terima kasih atas perhatiannya.');

      const finalMessage = lines.join('\n');
      bState.message = finalMessage;
      bState.step = 'confirm';

      await ctx.reply(
        `📋 <b>Preview Pengumuman Info / Umum</b>\n` +
          `Target: <b>${targetLabel}</b>\n\n` +
          finalMessage +
          '\n\nKirim pengumuman ini? Atau test dulu ke kamu sendiri?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📢 Kirim Sekarang', callback_data: 'broadcast_confirm' },
                { text: '❌ Batal', callback_data: 'broadcast_cancel' },
              ],
              [
                { text: '🧪 Test ke Saya (preview)', callback_data: 'broadcast_test_self' },
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

  if (isCancellableAccountFlowStep(state.step) && isCancelText(text)) {
    delete userState[ctx.chat.id];
    return ctx.reply('⛔ Proses akun dibatalkan. Tidak ada saldo yang dipotong.', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }]] },
    });
  }

processQrisTopupInvoice = async function processQrisTopupInvoice(ctx, baseAmount, forcedUniqueSuffix = null) {
  let loadingMsg = null;

  try {
    loadingMsg = await ctx.reply('⏳ Sedang membuat QRIS...', {
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
          '⚠️ Kamu masih punya 1 topup QRIS yang <b>belum dibayar</b>.\n\n' +
            `🧾 Invoice : <code>${pendingRow.invoice_id}</code>\n` +
            `💰 Nominal : <b>Rp${pendingRow.amount.toLocaleString('id-ID')}</b>\n\n` +
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
              '⚠️ Gagal meng-update qris_payments ke expired dari handler nominal:',
              err
            );
          }
        }
      );
    }
  } catch (e) {
    logger.error('⚠️ Error saat cek invoice pending QRIS:', e);
  }

  try {
    const userId = ctx.from.id;

    const invoice = await createQrisInvoice(
      baseAmount,
      `Topup saldo user ${userId} (base=${baseAmount})`,
      forcedUniqueSuffix
    );

    // QRIS polling sekarang dijalankan oleh payment/polling.js saat startup.
    // Jangan start interval dari dalam create invoice supaya tidak ada scheduler duplikat.

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

    const caption = buildQrisInvoiceCaption({
      invoiceId: invoice.invoice_id,
      baseAmount,
      billedAmount,
      uniqueSuffix: randomSuffix,
      timeoutMin: QRIS_PAYMENT_TIMEOUT_MIN,
    });
    const payKb = buildQrisInvoiceKeyboard(invoice.invoice_id);

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
      await ctx.reply(caption + `\n\n🔗 Link Pembayaran:\n${invoice.payment_link}`, {
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
      await ctx.reply('⚠️ Gagal membuat QRIS. Coba lagi nanti.', {
        parse_mode: 'HTML',
        reply_markup: payKb,
      });
    }
  } catch (e) {
    logger.error('❌ Error saat proses topup QRIS dari input nominal:', e);
    await cleanupLoadingMessage();
    await ctx.reply(
      '❌ Terjadi kesalahan saat membuat QRIS. Coba lagi beberapa saat.',
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

    if (text === 'batal' || text === '❌ batal') {
      delete userState[chatId];
      await ctx.reply('⛔ Topup dibatalkan.', {
        reply_markup: { remove_keyboard: true }
      });
      return;
    }

    const angkaBersih = text.replace(/[^\d]/g, '');
    const baseAmount = Number(angkaBersih);

    if (!baseAmount || baseAmount < QRIS_AUTO_TOPUP_MIN || baseAmount > QRIS_AUTO_TOPUP_MAX) {
      await ctx.reply(
        buildInvalidTopupNominalText({
          min: QRIS_AUTO_TOPUP_MIN,
          max: QRIS_AUTO_TOPUP_MAX,
        }),
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

    const confirmText = buildTopupConfirmText({
      baseAmount,
      payableAmount,
      uniqueSuffix: previewUniqueSuffix,
      bonus,
      percent,
      estimatedSaldo,
      timeoutMin,
    });

    await ctx.reply(confirmText, {
      parse_mode: 'HTML',
      reply_markup: buildTopupConfirmMarkup(),
    });

    return;
  }
  // ===== END SECTION: PAYMENT - STATE INPUT NOMINAL (QRIS AUTO TOPUP) ======


  // === EDIT NAMA SERVER (via ketikan biasa) ===
  if (state.step === 'edit_nama') {
  // Bisa batal pakai kata "batal"
  if (lowerText === 'batal' || lowerText === '/batal') {
    delete userState[ctx.chat.id];
    await ctx.reply('⛔ Edit nama server dibatalkan.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const newName = text.trim();

  if (!newName) {
    await ctx.reply('⚠️ Nama server tidak boleh kosong. Silakan ketik lagi.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  // Boleh kamu sesuaikan panjang maksimalnya
  if (newName.length > 50) {
    await ctx.reply('⚠️ Nama server terlalu panjang. Maksimal 50 karakter.', {
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
        logger.error('⚠️ Kesalahan saat mengedit nama server:', err.message);
        ctx.reply('⚠️ Terjadi kesalahan saat mengupdate nama server.', {
          parse_mode: 'Markdown',
        });
        return;
      }

      if (this.changes === 0) {
        ctx.reply('⚠️ Server tidak ditemukan.', {
          parse_mode: 'Markdown',
        });
        return;
      }

      ctx.reply(
        `✅ Nama berhasil diubah:\n*${newName}*`,
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
      await ctx.reply('⛔ Edit domain server dibatalkan.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const newDomain = text.trim();

    if (!newDomain) {
      await ctx.reply('⚠️ Domain server tidak boleh kosong. Silakan ketik lagi.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    // Validasi sederhana: huruf, angka, titik, dash, tanpa spasi
    if (!/^[a-zA-Z0-9.-]+$/.test(newDomain)) {
      await ctx.reply(
        '⚠️ Format domain tidak valid.\n' +
          'Hanya boleh huruf, angka, titik, dan strip.\n' +
          'Contoh: `sg1.serverku.com`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (newDomain.length > 100) {
      await ctx.reply('⚠️ Domain terlalu panjang. Maksimal 100 karakter.', {
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
          logger.error('⚠️ Kesalahan saat mengedit domain server:', err.message);
          ctx.reply('⚠️ Terjadi kesalahan saat mengupdate domain server.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        if (this.changes === 0) {
          ctx.reply('⚠️ Server tidak ditemukan.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        ctx.reply(
          `✅ Domain server berhasil diubah:\n` +
            `• Sebelumnya: \`${oldDomain}\`\n` +
            `• Menjadi   : \`${newDomain}\``,
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
      await ctx.reply('⛔ Edit auth server dibatalkan.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const newAuth = text.trim();

    if (!newAuth) {
      await ctx.reply('⚠️ AUTH server tidak boleh kosong. Silakan ketik lagi.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    if (newAuth.length > 255) {
      await ctx.reply('⚠️ AUTH terlalu panjang. Maksimal 255 karakter.', {
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
          logger.error('⚠️ Kesalahan saat mengedit auth server:', err.message);
          ctx.reply('⚠️ Terjadi kesalahan saat mengupdate auth server.', {
            parse_mode: 'Markdown',
          });
          return;
        }

        if (this.changes === 0) {
          ctx.reply('⚠️ Server tidak ditemukan.', {
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
          '✅ Auth server berhasil diubah:\n' +
            `• Server : \`${nama}\`\n` +
            `• Domain : \`${domain}\`\n` +
            `• Sebelumnya: \`${maskedOld}\`\n` +
            `• Menjadi   : \`${maskedNew}\``,
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
    await ctx.reply('⛔ Proses tambah server dibatalkan.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  // === MODE TANDAI USER: INPUT ID USER ===
  if (state.step === 'flag_user_wait_id') {
    // Bisa batal
    if (lowerText === 'batal' || lowerText === '/batal') {
      delete userState[ctx.chat.id];
      await ctx.reply('⛔ Mode tandai user dibatalkan.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const targetId = text.trim();

    if (!/^\d+$/.test(targetId)) {
      await ctx.reply(
        '⚠️ ID Telegram harus berupa angka.\n' +
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
          logger.error('❌ Gagal mengambil data user untuk flag:', err.message);
          await ctx.reply('❌ Terjadi kesalahan saat mengambil data user.');
          return;
        }

        if (!row) {
          await ctx.reply(
            `⚠️ User dengan ID ${targetId} belum terdaftar di database.\n` +
              'Kirim ID lain atau ketik *batal* untuk membatalkan.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        const saldoText = Number(row.saldo || 0).toLocaleString('id-ID');
        const rawFlag = (row.flag_status || 'NORMAL').toString().toUpperCase();
        let flagLabel = '✅ NORMAL';
        if (rawFlag === 'WATCHLIST') flagLabel = '⚠️ WATCHLIST';
        else if (rawFlag === 'NAKAL') flagLabel = '⛔ NAKAL';

        const noteText =
          row.flag_note && row.flag_note.trim()
            ? `\n📌 Catatan saat ini: ${row.flag_note.trim()}`
            : '';

        const keyboard = {
          inline_keyboard: [
            [
              {
                text: '✅ NORMAL',
                callback_data: `flag_user_set_NORMAL_${targetId}`,
              },
              {
                text: '⚠️ WATCHLIST',
                callback_data: `flag_user_set_WATCHLIST_${targetId}`,
              },
              {
                text: '⛔ NAKAL',
                callback_data: `flag_user_set_NAKAL_${targetId}`,
              },
            ],
          ],
        };

        await ctx.reply(
          `👤 *Data user:*\n` +
            `• ID     : \`${targetId}\`\n` +
            `• Saldo  : \`Rp${saldoText}\`\n` +
            `• Status : ${flagLabel}${noteText}\n\n` +
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
        logger.error('❌ Gagal mengambil saldo:', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengambil data saldo.');
      }

      if (!row) {
        return ctx.reply(`⚠️ User dengan ID ${targetId} belum terdaftar di database.`);
      }

      ctx.reply(`💰 Saldo user ${targetId}: Rp${row.saldo.toLocaleString()}`);
      logger.info(`Admin ${ctx.from.id} mengecek saldo user ${targetId}: Rp${row.saldo}`);
      delete userState[ctx.from.id];
    });
  } else if (state.step === 'riwayat_saldo_userid') {
    const targetId = ctx.message.text.trim();

    // [AUDIT FIX Bug 2] Aware-link saldo: dulu ambil dari SQLite langsung, jadi
    // user yang sudah link ke web selalu kelihatan saldo 0 (SQLite-nya
    // di-zero saat migrasi). Sekarang pakai getUserSaldo() yang otomatis
    // resolve ke saldo web kalau user linked, fallback SQLite kalau belum.
    db.get('SELECT user_id, web_user_id FROM users WHERE user_id = ?', [targetId], async (err, userRow) => {
      if (err) {
        logger.error('❌ Gagal mengambil saldo (riwayat):', err.message);
        return ctx.reply('❌ Terjadi kesalahan saat mengambil data saldo.');
      }

      if (!userRow) {
        return ctx.reply(`⚠️ User dengan ID ${targetId} belum terdaftar di database.`);
      }

      let currentSaldo = 0;
      try {
        const v = await getUserSaldo(db, targetId);
        currentSaldo = Number(v || 0);
      } catch (eSaldo) {
        logger.warn('Gagal ambil saldo aware-link untuk riwayat: ' + (eSaldo.message || eSaldo));
        currentSaldo = 0;
      }
      const saldoSourceLabel = userRow.web_user_id ? ' 🌐 (web)' : '';

    // 2) Ambil max 20 transaksi terakhir dari tabel transactions
    //    HANYA yang punya amount (transaksi saldo beneran)
    db.all(
      'SELECT amount, type, reference_id, timestamp FROM transactions WHERE user_id = ? AND amount IS NOT NULL ORDER BY timestamp DESC LIMIT 20',
      [targetId],
      (err2, rows) => {
          if (err2) {
            logger.error('❌ Gagal mengambil riwayat transaksi saldo:', err2.message);
            return ctx.reply('❌ Terjadi kesalahan saat mengambil riwayat saldo.');
          }

          if (!rows || rows.length === 0) {
            delete userState[ctx.from.id];
            return ctx.reply(
              `⚠️ Belum ada riwayat transaksi saldo untuk user ${targetId}.\n` +
              `Biasanya riwayat muncul dari deposit otomatis (QRIS) dan log transaksi lain.`
            );
          }

          const lines = [];
          lines.push('<b>📜 RIWAYAT SALDO USER</b>');
          lines.push('');
          lines.push(`User ID: <code>${targetId}</code>`);
          lines.push(`Saldo sekarang: <b>Rp${currentSaldo.toLocaleString('id-ID')}</b>${saldoSourceLabel}`);
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
    if (err.code === 'ENOENT') {
      // File reseller belum ada — anggap user bukan reseller, lanjut flow.
      logger.warn('ressel.db belum ada, anggap user bukan reseller.');
      data = '';
    } else {
      logger.error('⚠\ufe0f Gagal membaca file ressel.db:', err.message);
      return ctx.reply('⚠\ufe0f *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
    }
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

        // ?→ Kalau ada minimal saldo → cek saldo user dulu
        if (minBalance > 0) {
          const saldoUser = await getUserBalance(ctx.from.id);
          if (saldoUser < minBalance) {
            return ctx.reply(
              '⚠️ *Kamu belum memenuhi syarat saldo untuk memakai trial.*\n\n' +
              `• Minimal saldo untuk trial saat ini: *Rp${minBalance}*\n` +
              `• Saldo kamu saat ini              : *Rp${saldoUser}*\n\n` +
              'Silakan topup saldo terlebih dahulu lewat menu *💳 TopUp Saldo Otomatis / Manual via (QRIS)*,\n' +
              'lalu coba lagi fitur trial-nya.',
              { parse_mode: 'Markdown' }
            );
          }
        }

      // ?→ Jika user WATCHLIST → batas trial lebih ketat
      try {
        const flagStatus = await getUserFlagStatus(ctx.from.id);

        if (flagStatus === 'WATCHLIST') {
          // Batas trial per hari untuk user WATCHLIST, dikonfigurasi lewat
          // `trial_config.json` field watchlistMaxPerDay (default 1).
          let watchlistLimit = DEFAULT_TRIAL_CONFIG.watchlistMaxPerDay;
          try {
            const cfg = await getTrialConfig();
            if (
              cfg &&
              Number.isInteger(cfg.watchlistMaxPerDay) &&
              cfg.watchlistMaxPerDay >= 0
            ) {
              watchlistLimit = cfg.watchlistMaxPerDay;
            }
          } catch (_) {}
          const usedToday = await getTrialUsageToday(ctx.from.id);

          if (usedToday >= watchlistLimit) {
            return ctx.reply(
              '⛔ *Batas trial harian untuk akun WATCHLIST sudah tercapai.*\n\n' +
              `Saat ini akun kamu berstatus *WATCHLIST* sehingga fitur trial hanya bisa dipakai *${watchlistLimit}x per hari*.\n` +
              'Silakan coba lagi besok, atau beli akun lewat menu *🛍️ Buat Akun*.',
              { parse_mode: 'Markdown' }
            );
          }
        }
      } catch (e) {
        // Kalau gagal baca flag, anggap saja NORMAL
        logger.error('⚠️ Gagal membaca flag_status user saat cek trial WATCHLIST:', e.message || e);
      }

        // ?→ Cek batas trial harian
        const sudahPakai = await checkTrialAccess(ctx.from.id);
        if (sudahPakai) {
          return ctx.reply(
            '⛔ *Batas trial harian sudah tercapai.*\n\n' +
            `Saat ini trial hanya bisa dipakai *${maxPerDay}x per hari* untuk 1 user.\n` +
            'Silakan coba lagi besok, atau beli akun lewat menu *🛍️ Buat Akun*.',
            { parse_mode: 'Markdown' }
          );
        }
      }

        // Lanjut buat trial
    const { type, serverId } = state;
    delete userState[ctx.chat.id];

    // Mutex per-user supaya double-click text di flow trial tidak lolos double.
    if (trialLock.has(ctx.from.id)) {
      return ctx.reply(
        '⏳ Trial kamu sedang diproses, mohon tunggu sebentar.',
        { parse_mode: 'Markdown' }
      );
    }
    trialLock.add(ctx.from.id);

        try {
      // Ambil durasi trial dari konfigurasi (satuan JAM)
      const cfg = await getTrialConfig();
      let durationHours = 1;
      if (cfg && Number.isInteger(cfg.durationHours) && cfg.durationHours > 0) {
        durationHours = cfg.durationHours;
      }

      const password = 'none';
      const exp = durationHours;   // DIKIRIM ke script trial sebagai JUMLAH JAM
      const iplimit = 1;           // trial default 1 IP
      const quota = 1;             // trial default 1 GB (hanya dipakai non-ssh)

      // Signature berbeda per type:
      //   trialssh(username, password, exp, iplimit, serverId)
      //   trialvmess/vless/trojan/shadowsocks(username, exp, quota, limitip, serverId)
      let msg;
      if (type === 'ssh') {
        msg = await trialssh(username, password, exp, iplimit, serverId);
      } else if (type === 'vmess') {
        msg = await trialvmess(username, exp, quota, iplimit, serverId);
      } else if (type === 'vless') {
        msg = await trialvless(username, exp, quota, iplimit, serverId);
      } else if (type === 'trojan') {
        msg = await trialtrojan(username, exp, quota, iplimit, serverId);
      } else if (type === 'shadowsocks') {
        msg = await trialshadowsocks(username, exp, quota, iplimit, serverId);
      }

      if (msg) {
        // Deteksi success: error path di modules/trial.js selalu return string
        // yang DIAWALI '❌'. Pesan sukses panjang dan tidak pernah dimulai '❌'.
        // '???' = placeholder template gagal di-render → anggap error juga.
        const trimmed = String(msg).trimStart();
        const isError = !trimmed || trimmed.startsWith('❌') || trimmed.includes('???');
        if (!isError) {
          await recordAccountTransaction(ctx.from.id, type);
          await saveTrialAccess(ctx.from.id);
          logger.info(`✅ Trial ${type} oleh ${ctx.from.id}`);
        } else {
          logger.warn(
            `⚠️ Trial ${type} oleh ${ctx.from.id} gagal di server, counter tidak dinaikkan.`
          );
        }

        const extraInfo = isError
          ? ''
          : '\n\n⚠️ *Catatan:*\n' +
            'Username dan password yang tampil di atas dibuat *acak otomatis oleh server*.\n' +
            'Teks yang kamu kirim tadi hanya dipakai sebagai konfirmasi, bukan sebagai username akun.';

        const replyText = isError ? formatProvisioningFailure(msg, { trial: true }) : msg + extraInfo;
        await ctx.reply(replyText, { parse_mode: 'Markdown' });
      }

    } catch (err) {
      logger.error('❌ Gagal proses trial akun:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat memproses trial akun.*', { parse_mode: 'Markdown' });
    } finally {
      trialLock.delete(ctx.from.id);
    }

  });
  return;
}

    if (state.step.startsWith('username_unlock_')) {
    const usernameCheck = validateManageUsernameInput(text);
    if (!usernameCheck.ok) {
      return ctx.reply(usernameCheck.message, { parse_mode: 'Markdown' });
    }
    const username = usernameCheck.value;
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          logger.warn('ressel.db belum ada, anggap user bukan reseller.');
          data = '';
        } else {
          logger.error('⚠️ Gagal membaca file ressel.db:', err.message);
          return ctx.reply('⚠️ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
        }
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);

      console.log('🆔 ID Pengguna:', idUser);
      console.log('📜 Daftar Ressel:', resselList);

      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('🚫 *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
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
      logger.info(`✅ Akun ${type} berhasil unlock oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('❌ Gagal hapus akun:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
    if (state.step.startsWith('username_lock_')) {
    const usernameCheck = validateManageUsernameInput(text);
    if (!usernameCheck.ok) {
      return ctx.reply(usernameCheck.message, { parse_mode: 'Markdown' });
    }
    const username = usernameCheck.value;
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          logger.warn('ressel.db belum ada, anggap user bukan reseller.');
          data = '';
        } else {
          logger.error('⚠️ Gagal membaca file ressel.db:', err.message);
          return ctx.reply('⚠️ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
        }
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);

      console.log('🆔 ID Pengguna:', idUser);
      console.log('📜 Daftar Ressel:', resselList);

      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('🚫 *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
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
      logger.info(`✅ Akun ${type} berhasil di kunci oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('❌ Gagal hapus akun:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
  if (state.step.startsWith('username_del_')) {
    const usernameCheck = validateManageUsernameInput(text);
    if (!usernameCheck.ok) {
      return ctx.reply(usernameCheck.message, { parse_mode: 'Markdown' });
    }
    const username = usernameCheck.value;
       //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          logger.warn('ressel.db belum ada, anggap user bukan reseller.');
          data = '';
        } else {
          logger.error('⚠️ Gagal membaca file ressel.db:', err.message);
          return ctx.reply('⚠️ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
        }
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);

      console.log('🆔 ID Pengguna:', idUser);
      console.log('📜 Daftar Ressel:', resselList);

      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('🚫 *Fitur ini hanya untuk Ressel VPN.*', { parse_mode: 'Markdown' });
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
      logger.info(`✅ Akun ${type} berhasil dihapus oleh ${ctx.from.id}`);
    } catch (err) {
      logger.error('❌ Gagal hapus akun:', err.message);
      await ctx.reply('❌ *Terjadi kesalahan saat menghapus akun.*', { parse_mode: 'Markdown' });
    }});
    return; // Penting! Jangan lanjut ke case lain
  }
  if (state.step.startsWith('username_')) {
    const usernameCheck = validateAccountUsernameInput(text);
    if (!usernameCheck.ok) {
      return ctx.reply(usernameCheck.message, { parse_mode: 'Markdown' });
    }
    state.username = usernameCheck.value;
    const { type, action } = state;
    if (action === 'create') {
      if (type === 'ssh') {
        state.step = `password_${state.action}_${state.type}`;
        await ctx.reply('🔑 *Masukkan password:*\n\nKetik *batal* atau tekan tombol di bawah untuk membatalkan.', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'account_flow_cancel' }]] },
        });
      } else {
        state.step = `exp_${state.action}_${state.type}`;
        await ctx.reply('✏️ *Masukkan masa aktif (hari):*\n\nKetik *batal* atau tekan tombol di bawah untuk membatalkan.', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'account_flow_cancel' }]] },
        });
      }
    } else if (action === 'renew') {
      state.step = `exp_${state.action}_${state.type}`;
      await ctx.reply('✏️ *Masukkan masa aktif (hari):*\n\nKetik *batal* atau tekan tombol di bawah untuk membatalkan.', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'account_flow_cancel' }]] },
      });
    }
  } else if (state.step.startsWith('password_')) {
    const passwordCheck = validateAccountPasswordInput(ctx.message.text);
    if (!passwordCheck.ok) {
      return ctx.reply(passwordCheck.message, { parse_mode: 'Markdown' });
    }
    state.password = passwordCheck.value;
    state.step = `exp_${state.action}_${state.type}`;
    await ctx.reply('✏️ *Masukkan masa aktif (hari):*\n\nKetik *batal* atau tekan tombol di bawah untuk membatalkan.', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '❌ Batal', callback_data: 'account_flow_cancel' }]] },
    });
  } else if (state.step.startsWith('exp_')) {
    const expCheck = validateAccountExpiryInput(ctx.message.text);
    if (!expCheck.ok) {
      return ctx.reply(expCheck.message, { parse_mode: 'Markdown' });
    }
    state.exp = expCheck.value;

    db.get('SELECT quota, iplimit FROM Server WHERE id = ?', [state.serverId], async (err, server) => {
      if (err) {
        logger.error('⚠️ Error fetching server details:', err.message);
        return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
      }

      if (!server) {
        return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
      }

      // baseQuota = kuota untuk paket 30 hari
  const baseQuota = server.quota;
  const days = state.exp || 30; // kalau exp nggak kebaca, anggap 30 hari

  state.quota = calculateAccountQuota(baseQuota, days);
  state.iplimit = server.iplimit;

  const { username, password, exp, quota, iplimit, serverId, type, action } = state;
      const paymentRef = state.paymentRef || `buy_${action}_${type}_${serverId}_${username}_${ctx.from.id}_${state.flowStartedAt || Date.now()}`;
      state.paymentRef = paymentRef;
      let msg;

      db.get('SELECT harga FROM Server WHERE id = ?', [serverId], async (err, server) => {
        if (err) {
          logger.error('⚠️ Error fetching server price:', err.message);
          return ctx.reply('❌ *Terjadi kesalahan saat mengambil harga server.*', { parse_mode: 'Markdown' });
        }

        if (!server) {
          return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' });
        }

                // Harga dasar dari tabel Server (sebagai harga paket 30 hari)
const days = state.exp || 30;
// cek status reseller lebih awal agar bisa dipakai di bawah
const isR = await isUserReseller(ctx.from.id).catch(() => false);
const totalHarga = calculateAccountPrice(server.harga, days, isR, RESELLER_DISCOUNT);


        // Pre-check saldo. PENTING: pakai getUserSaldo() yang aware-link.
        // Kalau user sudah link ke web (web_user_id != NULL), getUserSaldo
        // ambil saldo dari API web (single source of truth). Kalau belum link,
        // fallback ke saldo SQLite seperti perilaku lama. Sebelumnya di sini
        // kita query SQLite langsung, yang bikin user linked SELALU dianggap
        // saldo 0 karena saldo SQLite-nya sudah di-zero saat migrasi.
        let saldo = 0;
        try {
          const v = await getUserSaldo(db, ctx.from.id);
          saldo = Number(v || 0);
        } catch (eSaldo) {
          logger.error('⚠️ Kesalahan saat mengambil saldo pengguna (efektif):', eSaldo.message || eSaldo);
          return ctx.reply('❌ *Terjadi kesalahan saat mengambil saldo pengguna.*', { parse_mode: 'Markdown' });
        }
        // Bungkus sisa flow sebagai async IIFE supaya minimal merubah indent
        // dan struktur callback existing yang panjang di bawah.
        await (async () => {
          if (saldo < totalHarga) {
            return ctx.reply(
              '⚠️ *Saldo kamu tidak mencukupi.*\n' +
              `Saldo sekarang: <b>Rp ${Number(saldo).toLocaleString('id-ID')}</b>\n` +
              `Harga paket   : <b>Rp ${Number(totalHarga).toLocaleString('id-ID')}</b>\n\n` +
              'Silakan topup saldo dulu lewat menu *💳 TopUp Saldo* atau di web kalau akun kamu sudah ter-link.',
              { parse_mode: 'HTML' }
            );
          }
		            // ?→ Limit create per hari untuk WATCHLIST (non-reseller)
          // isR sudah dihitung di atas (pakai isUserReseller)
          if (action === 'create' && !isR) {
            try {
              const flagStatus = await getUserFlagStatus(ctx.from.id);

              if (flagStatus === 'WATCHLIST') {
                // Aturan: user WATCHLIST hanya boleh X akun baru per hari
                const watchlistCreateLimit = 3; // ?→ silakan ganti angkanya kalau mau
                const createdToday = await getCreateUsageToday(ctx.from.id);

                if (createdToday >= watchlistCreateLimit) {
                  return ctx.reply(
                    '⛔ *Batas pembuatan akun harian untuk akun WATCHLIST sudah tercapai.*\n\n' +
                      `Saat ini akun kamu berstatus *WATCHLIST* sehingga hanya boleh membuat *${watchlistCreateLimit} akun baru per hari*.\n` +
                      'Silakan coba lagi besok, atau gunakan akun yang sudah ada / hubungi admin.',
                    { parse_mode: 'Markdown' }
                  );
                }
              }
            } catch (e) {
              logger.error('⚠️ Gagal cek limit create user WATCHLIST:', e.message || e);
              // Kalau error, jangan blok user (anggap saja lolos)
            }
          }
          let slotReserved = false;
          const releaseCreateSlot = async () => {
            slotReserved = await serverSlotManager.releaseCreateSlot(action, serverId, slotReserved);
          };

          if (action === 'create') {
            slotReserved = await serverSlotManager.reserveCreateSlot(action, serverId);
            if (!slotReserved) {
              return ctx.reply('⛔ *Server penuh atau sedang sibuk. Coba beberapa saat lagi atau pilih server lain.*', { parse_mode: 'Markdown' });
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
                username,
                paymentRef
              );
              paymentDebited = true;
            } catch (payErr) {
              await releaseCreateSlot();
              logger.error('Gagal memproses pengurangan saldo & transaksi pembelian:', payErr.message || payErr);
              return ctx.reply('❌ *Transaksi dibatalkan karena saldo gagal dipotong. Silakan coba lagi.*', { parse_mode: 'Markdown' });
            }
          }

          let waitCtrl = null;
          waitCtrl = await startWaiting(ctx, '⏳ Sedang membuat akun...');
          msg = await provisionAccount(action, {
            type,
            username,
            password,
            exp,
            quota,
            iplimit,
            serverId,
          });
          if (action === 'create') {
            logger.info(`Account created and transaction recorded for user ${ctx.from.id}, type: ${type}`);
          } else if (action === 'renew') {
            logger.info(`Account renewed and transaction recorded for user ${ctx.from.id}, type: ${type}`);
          }

          const normalizedMsg = String(msg || '').trim();
          const isProvisionSuccess = normalizedMsg.startsWith('✅');

          if (!isProvisionSuccess) {
            let refundFailed = false;
            let refundErrorText = '';
            if (paymentDebited && totalHarga > 0) {
              try {
                await refundAccountPayment(
                  ctx.from.id,
                  totalHarga,
                  type,
                  action,
                  serverId,
                  username,
                  'provision_failed',
                  `refund_${paymentRef}`
                );
              } catch (refundErr) {
                refundFailed = true;
                refundErrorText = String(refundErr?.message || refundErr || 'unknown');
                logger.error(`Refund gagal setelah provisioning gagal untuk user ${ctx.from.id}: ${refundErrorText}`);
                try {
                  if (GROUP_ID) {
                    await bot.telegram.sendMessage(
                      GROUP_ID,
                      `🚨 <b>CRITICAL REFUND FAILURE</b>\n` +
                      `User: <code>${ctx.from.id}</code>\n` +
                      `Type: <code>${action}_${type}</code>\n` +
                      `Server: <code>${serverId}</code>\n` +
                      `Amount: <b>${rupiah(totalHarga)}</b>\n` +
                      `Ref: <code>refund_${paymentRef}</code>\n` +
                      `Error: <code>${htmlEscape(refundErrorText)}</code>\n` +
                      `Action: refund manual diperlukan.`,
                      { parse_mode: 'HTML' }
                    );
                  }
                } catch (_) {}
              }
            }
            await releaseCreateSlot();
            logger.error(`Rollback transaksi user ${ctx.from.id}, type: ${type}, server: ${serverId}, respon: ${normalizedMsg}`);
            const failText = formatProvisioningFailure(normalizedMsg, { refundFailed });
            if (waitCtrl) {
              try { await waitCtrl.stop(failText, true); } catch (_) {}
              return;
            }
            return ctx.reply(failText, { parse_mode: 'Markdown' });
          }

          logger.info(`✅ Transaksi sukses untuk user ${ctx.from.id}, type: ${type}, server: ${serverId}`);
          upsertAccount(ctx.from.id, username, type, serverId, exp);
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

  const notifText = formatAccountGroupNotification({
    action,
    serverName,
    userDisplay,
    roleLabel,
    username,
    type,
    exp,
    sisaHari,
    expiredDateOnly,
  });

  await bot.telegram.sendMessage(GROUP_ID, notifText, { parse_mode: 'HTML' });

} catch (e) {
  logger.error('Gagal kirim notif pembelian ke grup:', e.message);
}
// ==== END NOTIF GRUP ====

if (waitCtrl) await waitCtrl.stop('✅ Akun berhasil dibuat.', true);
await ctx.reply(msg, { parse_mode: 'Markdown' });
delete userState[ctx.chat.id];
//SALDO DATABES
          })();
        });
      });
    }
  else if (state.step === 'addserver') {
    const domain = ctx.message.text.trim();
    if (!domain) {
      await ctx.reply('⚠️ *Domain tidak boleh kosong.* Silakan masukkan domain server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_auth';
    state.domain = domain;
    await ctx.reply('✏️ *Silakan masukkan auth server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_auth') {
    const auth = ctx.message.text.trim();
    if (!auth) {
      await ctx.reply('⚠️ *Auth tidak boleh kosong.* Silakan masukkan auth server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_nama_server';
    state.auth = auth;
    await ctx.reply('?⚠️ *Silakan masukkan nama server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_nama_server') {
    const nama_server = ctx.message.text.trim();
    if (!nama_server) {
      await ctx.reply('⚠️ *Nama server tidak boleh kosong.* Silakan masukkan nama server yang valid.', { parse_mode: 'Markdown' });
      return;
    }

    state.step = 'addserver_quota';
state.nama_server = nama_server;
await ctx.reply(
  '✏️ *Silakan masukkan quota server (dalam GB, contoh: 500):*',
  { parse_mode: 'Markdown' }
);
} else if (state.step === 'addserver_quota') {
  const quota = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(quota) || quota <= 0) {
    await ctx.reply(
      '⚠️ *Quota tidak valid.* Quota harus berupa angka dan lebih besar dari 0.\n' +
      'Contoh: `500` (untuk 500 GB).',
      { parse_mode: 'Markdown' }
    );
    return;
  }

    state.step = 'addserver_iplimit';
    state.quota = quota;
    await ctx.reply('✏️ *Silakan masukkan limit IP server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_iplimit') {
  const iplimit = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(iplimit) || iplimit <= 0) {
    await ctx.reply(
      '⚠️ *Limit IP tidak valid.* Limit IP harus berupa angka dan lebih besar dari 0.\n' +
      'Contoh: `1` atau `2`.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

    state.step = 'addserver_batas_create_akun';
    state.iplimit = iplimit;
    await ctx.reply('✏️ *Silakan masukkan batas create akun server:*', { parse_mode: 'Markdown' });
  } else if (state.step === 'addserver_batas_create_akun') {
  const batas_create_akun = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(batas_create_akun) || batas_create_akun <= 0) {
    await ctx.reply(
      '⚠️ *Batas create akun tidak valid.* Nilai harus berupa angka dan lebih besar dari 0.\n' +
      'Contoh: `100` (maksimal 100 akun).',
      { parse_mode: 'Markdown' }
    );
    return;
  }

    state.step = 'addserver_harga';
state.batas_create_akun = batas_create_akun;
await ctx.reply(
  '✏️ *Silakan masukkan harga server untuk paket 30 hari* (dalam rupiah, tanpa titik. Contoh: 12000):',
  { parse_mode: 'Markdown' }
);

  } else if (state.step === 'addserver_harga') {
    const harga = parseFloat(ctx.message.text.trim());
    if (isNaN(harga) || harga <= 0) {
      await ctx.reply('⚠️ *Harga tidak valid.* Silakan masukkan harga server yang valid.', { parse_mode: 'Markdown' });
      return;
    }
    const { domain, auth, nama_server, quota, iplimit, batas_create_akun } = state;

  try {
    db.run('INSERT INTO Server (domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, 0], function(err) {        if (err) {
          logger.error('Error saat menambahkan server:', err.message);
          ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
        } else {
          ctx.reply(`✅ *Server baru dengan domain ${domain} telah berhasil ditambahkan.*\n\n📝 *Detail Server:*\n- Domain: ${domain}\n- Auth: ${auth}\n- Nama Server: ${nama_server}\n- Quota: ${quota}\n- Limit IP: ${iplimit}\n- Batas Create Akun: ${batas_create_akun}\n- Harga: Rp ${harga}`, { parse_mode: 'Markdown' });
        }
      });
    } catch (error) {
      logger.error('Error saat menambahkan server:', error);
      await ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
  }
// === ????→ TAMBAH SERVER UNTUK RESELLER ===
if (state && state.step === 'reseller_domain') {
  state.domain = text;
  state.step = 'reseller_auth';
  return ctx.reply('✏️ Masukkan auth server:');
}

if (state && state.step === 'reseller_auth') {
  state.auth = text;
  state.step = 'reseller_harga';
  return ctx.reply('✏️ Masukkan harga server (angka):');
}

if (state && state.step === 'reseller_harga') {
  state.harga = text;
  state.step = 'reseller_nama';
  return ctx.reply('✏️ Masukkan nama server:');
}

if (state && state.step === 'reseller_nama') {
  state.nama_server = text;
  state.step = 'reseller_quota';
  return ctx.reply('✏️ Masukkan quota (GB):');
}

if (state && state.step === 'reseller_quota') {
  state.quota = text;
  state.step = 'reseller_iplimit';
  return ctx.reply('✏️ Masukkan IP limit:');
}

if (state && state.step === 'reseller_iplimit') {
  state.iplimit = text;
  state.step = 'reseller_batas';
  return ctx.reply('✏️ Masukkan batas create akun:');
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
        logger.error('❌ Gagal menambah server reseller:', err.message);
        ctx.reply('❌ Gagal menambah server reseller.');
      } else {
        ctx.reply(
          `✅ Server reseller *${state.nama_server}* berhasil ditambahkan!`,
          { parse_mode: 'Markdown' }
        );
      }
      delete userState[ctx.chat.id];
    }
  );
  return;
}
// === [AUDIT FIX Bug 3,4] TAMBAH SALDO LANGKAH 1: INPUT USER ID + VALIDASI ===
// Sebelumnya: handler ini cuma `state.targetId = text.trim()` lalu lanjut ke
// step jumlah, tanpa validasi format ID maupun keberadaan user di DB.
// Akibat: salah ketik ID lolos ke step jumlah → UPDATE no-op tapi notif
// "berhasil" tetap dikirim, admin lupa sudah top-up siapa.
// Sekarang: regex validate /^\d+$/ + SELECT user_id untuk pastikan user ada
// di tabel users (artinya user pernah /start ke bot).
if (state && state.step === 'addsaldo_userid') {
  const idRaw = text.trim();
  if (!/^\d+$/.test(idRaw)) {
    return ctx.reply(
      '⚠️ <b>ID Telegram tidak valid.</b>\n' +
        'Harus berupa angka saja (mis. <code>5439429147</code>).\n' +
        'Kirim ulang ID, atau ketik perintah lain (mis. /start) untuk batal.',
      { parse_mode: 'HTML' }
    );
  }

  db.get(
    'SELECT user_id, web_user_id FROM users WHERE user_id = ?',
    [idRaw],
    async (errChk, row) => {
      if (errChk) {
        logger.error('Gagal cek user di addsaldo step 1:', errChk.message);
        return ctx.reply('❌ Terjadi kesalahan saat memeriksa user. Coba lagi.');
      }
      if (!row) {
        return ctx.reply(
          `⚠️ User dengan ID <code>${idRaw}</code> belum terdaftar.\n` +
            'User harus pernah /start ke bot ini dulu sebelum saldo bisa ditambahkan.\n' +
            'Kirim ulang ID, atau ketik /start untuk batal.',
          { parse_mode: 'HTML' }
        );
      }

      state.targetId = idRaw;
      state.step = 'addsaldo_amount';

      const linkedNote = row.web_user_id
        ? '\n🌐 <i>User ini sudah link ke web — saldo akan masuk ke akun web-nya.</i>'
        : '\n💾 <i>User ini belum link ke web — saldo akan masuk ke akun bot lokal.</i>';

      await ctx.reply(
        `✏️ User ditemukan: <code>${idRaw}</code>${linkedNote}\n\n` +
          'Masukkan <b>jumlah saldo</b> yang ingin ditambahkan (angka saja):',
        { parse_mode: 'HTML' }
      );
    }
  );
  return;
}

// === [AUDIT FIX] TAMBAH SALDO LANGKAH 2: aware-link ke web ===
// Sebelumnya: handler ini langsung UPDATE saldo SQLite. Akibat: user yang sudah
// link ke web tidak terima saldo (saldo asli mereka di web, SQLite di-zero saat
// migrasi). Sekarang: cek link info, kalau linked push ke web pakai
// webApiClient.creditBalance, kalau belum link fallback ke SQLite.
if (state && state.step === 'addsaldo_amount') {
  const amount = parseInt(text.trim());
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('⚠️ Jumlah saldo harus berupa angka dan lebih dari 0.');
  }

  const targetId = Number(state.targetId);
  const adminId = ctx.from.id;

  // Hitung bonus tier (sama dengan command /addsaldo).
  const bonusEnabled = !!TOPUP_BONUS_ENABLED;
  let bonusPercent = 0;
  if (bonusEnabled) {
    if (amount >= TOPUP_BONUS_TIER3_MIN && TOPUP_BONUS_TIER3_PERCENT > 0) bonusPercent = TOPUP_BONUS_TIER3_PERCENT;
    else if (amount >= TOPUP_BONUS_TIER2_MIN && TOPUP_BONUS_TIER2_PERCENT > 0) bonusPercent = TOPUP_BONUS_TIER2_PERCENT;
    else if (amount >= TOPUP_BONUS_MIN_AMOUNT && TOPUP_BONUS_PERCENT > 0) bonusPercent = TOPUP_BONUS_PERCENT;
  }
  const bonus = bonusPercent > 0 ? Math.floor((amount * bonusPercent) / 100) : 0;
  const totalCredit = amount + bonus;

  delete userState[ctx.chat.id];

  (async () => {
    try {
      const linkInfo = isWebLinkEnabled()
        ? await getUserLinkInfo(targetId).catch(() => null)
        : null;

      // PATH 1: USER LINKED → push saldo ke web
      if (linkInfo && linkInfo.web_user_id) {
        try {
          const refId = `addsaldo_menu_${adminId}_${targetId}_${Date.now()}`;
          const credRes = await webApiClient.creditBalance({
            telegramId: targetId,
            amount: totalCredit,
            description: `Topup manual oleh admin ${adminId} (menu)` + (bonus > 0 ? ` (bonus ${bonusPercent}%)` : ''),
            refId,
          });
          if (!credRes || !credRes.ok) {
            return ctx.reply('❌ Gagal credit saldo ke web. Server tidak ack.', { parse_mode: 'HTML' });
          }
          const newSaldoWeb = Number(credRes.newBalance || 0);

          try {
            recordSaldoTransaction(targetId, totalCredit, 'manual_addsaldo_web', `addsaldo_menu_by_${adminId}`);
          } catch (e) {
            logger.warn('Gagal catat tx addsaldo menu (web): ' + (e.message || e));
          }

          // Notif admin
          let msgAdmin = `✅ Saldo user web <code>${targetId}</code> berhasil ditambah (akun ter-link ke web).\n\n` +
            `💰 Nominal bayar : <b>Rp${amount.toLocaleString('id-ID')}</b>\n`;
          if (bonus > 0) msgAdmin += `🎁 Bonus : <b>Rp${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n`;
          msgAdmin += `💰 Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n` +
            `\n💰 Saldo web sekarang: <b>Rp${newSaldoWeb.toLocaleString('id-ID')}</b> 🌐`;
          await ctx.reply(msgAdmin, { parse_mode: 'HTML' });

          // Notif user
          try {
            let msgUser = '✅ Saldo kamu telah <b>ditambahkan</b>.\n\n' +
              `💰 Topup : <b>Rp ${amount.toLocaleString('id-ID')}</b>\n`;
            if (bonus > 0) msgUser += `🎁 Bonus : <b>Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n`;
            msgUser += `💰 Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n` +
              `\n💰 Saldo sekarang: <b>Rp ${newSaldoWeb.toLocaleString('id-ID')}</b> 🌐`;
            await bot.telegram.sendMessage(targetId, msgUser, { parse_mode: 'HTML' });
          } catch (e) {
            logger.error('Gagal kirim notif ke user (linked menu):', e.message);
          }

          // Notif grup
          if (NOTIF_TOPUP_GROUP && GROUP_ID) {
            try {
              let targetInfo = {};
              try { targetInfo = await bot.telegram.getChat(targetId); } catch (_) {}
              const userLabel = targetInfo.username || targetInfo.first_name || String(targetId);
              const waktu = new Date().toLocaleString('id-ID', {
                timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
              });
              let notifTopup = '<blockquote>\n💵 TOPUP MANUAL (WEB) 💵\n<code>\n' +
                `👤 User : ${userLabel}\n🆔 ID : ${targetId}\n💳 Bayar : Rp ${amount.toLocaleString('id-ID')}\n`;
              if (bonus > 0) notifTopup += `🎁 Bonus : Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)\n`;
              notifTopup += `💰 Masuk : Rp ${totalCredit.toLocaleString('id-ID')}\n` +
                `💰 Saldo : Rp ${newSaldoWeb.toLocaleString('id-ID')} 🌐\n📅 Tanggal : ${waktu}\n` +
                '</code>\n━━━━━━━━━━━━━━━━━━━━\n</blockquote>';
              await bot.telegram.sendMessage(GROUP_ID, notifTopup, { parse_mode: 'HTML' });
            } catch (e) {
              logger.error('Gagal kirim notif topup manual menu (linked) ke grup:', e.message);
            }
          }
          return;
        } catch (eWeb) {
          logger.error('Gagal credit saldo ke web di menu addsaldo: ' + (eWeb.message || eWeb));
          return ctx.reply(
            '❌ Gagal menambah saldo ke web: <code>' + htmlEscape(eWeb.message || String(eWeb)) + '</code>\n' +
              'User ini sudah ter-link ke web. Tidak fallback ke SQLite supaya saldo tidak ganda.',
            { parse_mode: 'HTML' }
          );
        }
      }

      // PATH 2: USER BELUM LINK → SQLite (perilaku lama, tapi pakai totalCredit)
      const row = await new Promise((resolve, reject) => {
        db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (e, r) => e ? reject(e) : resolve(r));
      });
      if (!row) {
        return ctx.reply(`❌ User dengan ID ${targetId} tidak ditemukan di database (race condition?).`);
      }
      const oldSaldo = Number(row.saldo || 0);
      const newSaldo = oldSaldo + totalCredit;

      await new Promise((resolve, reject) => {
        db.run('UPDATE users SET saldo = ? WHERE user_id = ?', [newSaldo, targetId], (err2) => err2 ? reject(err2) : resolve());
      });
      try {
        recordSaldoTransaction(targetId, totalCredit, 'manual_addsaldo', `addsaldo_menu_by_${adminId}`);
      } catch (e) {
        logger.error('Gagal mencatat transaksi tambah saldo manual (menu):', e.message);
      }

      let msgAdmin = `✅ Saldo user ID <code>${targetId}</code> berhasil ditambah.\n\n` +
        `💰 Nominal bayar : <b>Rp${amount.toLocaleString('id-ID')}</b>\n`;
      if (bonus > 0) msgAdmin += `🎁 Bonus : <b>Rp${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n`;
      msgAdmin += `💰 Saldo masuk   : <b>Rp${totalCredit.toLocaleString('id-ID')}</b>\n` +
        `\n💰 Saldo sekarang: <b>Rp${newSaldo.toLocaleString('id-ID')}</b>`;
      await ctx.reply(msgAdmin, { parse_mode: 'HTML' });

      try {
        let msgUser = '✅ Saldo kamu telah <b>ditambahkan</b>.\n\n' +
          `💰 Topup : <b>Rp ${amount.toLocaleString('id-ID')}</b>\n`;
        if (bonus > 0) msgUser += `🎁 Bonus : <b>Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)</b>\n`;
        msgUser += `💰 Masuk : <b>Rp ${totalCredit.toLocaleString('id-ID')}</b>\n` +
          `\n💰 Saldo sekarang: <b>Rp ${newSaldo.toLocaleString('id-ID')}</b>`;
        await bot.telegram.sendMessage(targetId, msgUser, { parse_mode: 'HTML' });
      } catch (e) {
        logger.error('Gagal kirim notif ke user (menu addsaldo):', e.message);
      }

      if (NOTIF_TOPUP_GROUP && GROUP_ID) {
        try {
          let targetInfo = {};
          try { targetInfo = await bot.telegram.getChat(targetId); } catch (_) {}
          const userLabel = targetInfo.username || targetInfo.first_name || String(targetId);
          const waktu = new Date().toLocaleString('id-ID', {
            timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          });
          let notifTopup = '<blockquote>\n💵 TOPUP MANUAL 💵\n<code>\n' +
            `👤 User : ${userLabel}\n🆔 ID : ${targetId}\n💳 Bayar : Rp ${amount.toLocaleString('id-ID')}\n`;
          if (bonus > 0) notifTopup += `🎁 Bonus : Rp ${bonus.toLocaleString('id-ID')} (${bonusPercent}%)\n`;
          notifTopup += `💰 Masuk : Rp ${totalCredit.toLocaleString('id-ID')}\n` +
            `💰 Saldo : Rp ${newSaldo.toLocaleString('id-ID')}\n📅 Tanggal : ${waktu}\n` +
            '</code>\n━━━━━━━━━━━━━━━━━━━━\n</blockquote>';
          await bot.telegram.sendMessage(GROUP_ID, notifTopup, { parse_mode: 'HTML' });
        } catch (e) {
          logger.error('Gagal kirim notif topup manual menu ke grup:', e.message);
        }
      }
    } catch (errOuter) {
      logger.error('Error addsaldo menu (path SQLite/aware-link):', errOuter.message || errOuter);
      try { await ctx.reply('❌ Terjadi kesalahan saat menambah saldo. Coba lagi nanti.', { parse_mode: 'HTML' }); } catch (_) {}
    }
  })();

  return;
}

// === DEAD CODE: handler legacy di bawah tidak akan pernah dipanggil karena
// blok di atas sudah `return`. Sengaja dibiarkan untuk audit trail; akan
// dibersihkan di refactor terpisah supaya diff fix ini minimal.
if (false && state && state.step === 'addsaldo_amount_legacy_unused') {
  const amount = parseInt(text.trim());
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('⚠️ Jumlah saldo harus berupa angka dan lebih dari 0.');
  }

  const targetId = state.targetId;

// Tambahkan saldo
db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, targetId], (err) => {
  if (err) {
    logger.error('❌ Gagal menambah saldo:', err.message);
    return ctx.reply('❌ Gagal menambah saldo ke user.');
  }

          // Ambil saldo terbaru
      db.get(
        'SELECT saldo FROM users WHERE user_id = ?',
        [targetId],
        (err2, updated) => {
          const safeTargetId = Number(targetId);

          if (err2 || !updated) {
            // ?→ Catat transaksi saldo
            recordSaldoTransaction(
              safeTargetId,
              amount,
              'manual_addsaldo',
              `addsaldo_by_${ctx.from.id}`
            );

            // ?→ Notif ke user
bot.telegram
  .sendMessage(
    safeTargetId,
    '✅ Saldo kamu telah <b>ditambahkan</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n' +
      'ℹ️ Silakan cek saldo kamu di bot.',
    { parse_mode: 'HTML' }
  )
  .catch((e) => {
    logger.error(
      '❌ Gagal mengirim notif saldo masuk ke user (menu tambah_saldo, saldo tidak terbaca):',
      e.message
    );
  });


            // ?→ Balas ke admin
            ctx.reply(`✅ Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.`
            );
            logger.info(
              `Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId} (gagal membaca saldo terbaru).`
            );
          } else {
            // ?→ Catat transaksi saldo
            recordSaldoTransaction(
              safeTargetId,
              amount,
              'manual_addsaldo',
              `addsaldo_by_${ctx.from.id}`
            );

            // ?→ Notif ke user
bot.telegram
  .sendMessage(
    safeTargetId,
    '✅ Saldo kamu telah <b>ditambahkan</b> sebesar <b>Rp ' + amount.toLocaleString() + '</b>.\n' +
      '💰 Saldo sekarang: <b>Rp ' + updated.saldo.toLocaleString() + '</b>.',
    { parse_mode: 'HTML' }
  )
  .catch((e) => {
    logger.error(
      '❌ Gagal mengirim notif saldo masuk ke user (menu tambah_saldo):',
      e.message
    );
  });


            // ?→ Balas ke admin
            ctx.reply(`✅ Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.\n` +
                `💰 Saldo sekarang: Rp${updated.saldo.toLocaleString()}`
            );
            logger.info(
              `Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId} (Saldo akhir: Rp${updated.saldo}).`
            );
          }

          // ?→ NOTIF KE GRUP (LOG TOPUP MANUAL) → dipanggil kalau GROUP_ID ada
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
                    '━━━━━ TOPUP MANUAL ━━━━━\n\n' +
					'<code>\n' + // <-- MULAI BLOK MONOSPACE
                    'User   : ' + targetName + ' (' + safeTargetId + ')\n' +
                    'Topup  : Rp ' + amount.toLocaleString() + '\n' +
                    'Status : SUCCESS\n' +
                    'Tanggal: ' + waktu + '\n' +
					'</code>\n' + // <-- AKHIR BLOK MONOSPACE
                    '━━━━━━━━━━━━━━━━━━━━\n' +
                    '</blockquote>';

                  await bot.telegram.sendMessage(
                    GROUP_ID,
                    notifTopup,
                    { parse_mode: 'HTML' }
                  );
                } catch (e) {
                  logger.error('❌ Gagal kirim notif topup manual ke grup:', e.message);
                }
              })();
            }
          } catch (e) {
            logger.error('❌ Error umum saat proses notif grup topup manual:', e.message);
          }
        }
      );

  delete userState[ctx.from.id];
});

  return;
}
});
////////
// =====================================================================
// SUBMENU MENU SERVER: tombol "Edit X" di admin_server_menu
// callback_data: editserver_harga, editserver_nama (alias nama_server_edit),
// editserver_domain, editserver_auth, editserver_quota, editserver_limit_ip,
// editserver_batas_create_akun, editserver_total_create_akun.
// Flow: tombol -> tampilkan list server -> klik server -> callback ke handler
//   `edit_<field>_<id>` yang sudah ada. Sebelum ini, tombol-tombol di submenu
//   server tidak punya handler sehingga klik = tidak terjadi apa-apa.
// =====================================================================
// Mapping fieldKey (callback) -> { dbColumn, displayLabel, formatter }
// Dipakai picker untuk ambil nilai lama dari kolom yang tepat lalu simpan ke
// userState supaya handler edit_<field> bisa tampilkan before/after.
const _EDIT_FIELD_MAP = {
  harga:                 { col: 'harga',              fmt: (v) => 'Rp ' + Number(v || 0).toLocaleString('id-ID') },
  nama:                  { col: 'nama_server',        fmt: (v) => String(v || '-') },
  domain:                { col: 'domain',             fmt: (v) => String(v || '-') },
  auth:                  { col: 'auth',               fmt: (v) => {
    const s = String(v || '');
    return s.length > 8 ? s.slice(0, 4) + '...' + s.slice(-4) : (s || '-');
  } },
  quota:                 { col: 'quota',              fmt: (v) => Number(v || 0) + ' GB' },
  limit_ip:              { col: 'iplimit',            fmt: (v) => Number(v || 0) + ' IP' },
  batas_create_akun:     { col: 'batas_create_akun',  fmt: (v) => Number(v || 0).toLocaleString('id-ID') + ' akun' },
  total_create_akun:     { col: 'total_create_akun',  fmt: (v) => Number(v || 0).toLocaleString('id-ID') + ' akun' },
};

function _registerEditServerPicker(callbackName, fieldKey, label) {
  bot.action(callbackName, async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(() => {});
      if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
        return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
      }

      const meta = _EDIT_FIELD_MAP[fieldKey];
      const dbCol = meta ? meta.col : null;
      const fmt = meta ? meta.fmt : ((v) => String(v == null ? '-' : v));

      // Ambil daftar server beserta nilai field yang akan diedit, supaya tombol
      // bisa tampilkan "Nama (nilai sekarang)" dan kita bisa cache nilainya
      // di userState saat user klik salah satu server.
      const sql = dbCol
        ? 'SELECT id, nama_server, domain, ' + dbCol + ' AS val FROM Server ORDER BY id ASC'
        : 'SELECT id, nama_server, domain FROM Server ORDER BY id ASC';

      db.all(sql, [], async (err, servers) => {
        if (err) {
          logger.error('Gagal ambil daftar server (' + callbackName + '):', err.message);
          return ctx.reply('⚠️ Gagal mengambil daftar server.', { parse_mode: 'Markdown' });
        }
        if (!servers || servers.length === 0) {
          return ctx.reply('⚠️ Belum ada server yang terdaftar. Tambah server dulu lewat tombol *➕ Tambah Server*.',
            { parse_mode: 'Markdown' });
        }

        const inlineButtons = [];
        const lines = [];
        lines.push('✏️ *Edit ' + label + '*');
        lines.push('');
        lines.push('Pilih server yang ingin diedit. Nilai sekarang ditampilkan di bawah:');
        lines.push('');
        for (const srv of servers) {
          const safeName = (srv.nama_server || srv.domain || ('Server #' + srv.id)).slice(0, 60);
          const valNow = (typeof srv.val !== 'undefined') ? fmt(srv.val) : null;
          if (valNow) {
            lines.push('• *' + safeName + '* — sekarang: `' + valNow + '`');
          } else {
            lines.push('• *' + safeName + '*');
          }
          inlineButtons.push([{
            text: safeName + (valNow ? ' (' + valNow + ')' : ''),
            callback_data: 'edit_' + fieldKey + '_' + srv.id,
          }]);
        }
        inlineButtons.push([{ text: '🔙 Kembali ke Menu Server', callback_data: 'admin_server_menu' }]);

        // Edit pesan menu server, fallback reply kalau pesan asli sudah hilang.
        await editOrReply(ctx, lines.join('\n'),
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: inlineButtons },
          });
      });
    } catch (err) {
      logger.error('Error pada ' + callbackName + ':', err.message || err);
      try { await ctx.reply('❌ Terjadi kesalahan saat membuka menu edit server.'); } catch (_) {}
    }
  });
}

_registerEditServerPicker('editserver_harga', 'harga', 'Harga Server (paket 30 hari)');
_registerEditServerPicker('editserver_domain', 'domain', 'Domain Server');
_registerEditServerPicker('editserver_auth', 'auth', 'Auth Server');
_registerEditServerPicker('editserver_quota', 'quota', 'Quota (GB)');
_registerEditServerPicker('editserver_limit_ip', 'limit_ip', 'Limit IP per Akun');
_registerEditServerPicker('editserver_batas_create_akun', 'batas_create_akun', 'Batas Create Akun');
_registerEditServerPicker('editserver_total_create_akun', 'total_create_akun', 'Total Create Akun');
// Alias lama: tombol "✏️ Edit Nama" di submenu pakai callback_data nama_server_edit
_registerEditServerPicker('nama_server_edit', 'nama', 'Nama Server');

bot.action('addserver', async (ctx) => {
  try {
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    logger.info('⏳ Proses tambah server dimulai');
    await ctx.answerCbQuery();
       await ctx.reply(
      '✏️ *Silakan masukkan domain/ip server.*\n' +
      'Ketik `batal` untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );

    userState[ctx.chat.id] = { step: 'addserver' };
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses tambah server:', error);
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});
bot.action('detailserver', async (ctx) => {
  try {
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    logger.info('⏳ Proses detail server dimulai');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil detail server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil detail server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      logger.info('⚠️ Tidak ada server yang tersedia');
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
    }

    // Edit pesan menu server, fallback reply kalau pesan asli sudah hilang.
    await editOrReply(ctx, '🔍 *Silakan pilih server untuk melihat detail:*', {
      reply_markup: buildDetailServerKeyboard(servers),
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.error('⚠️ Kesalahan saat mengambil detail server:', error);
    await ctx.reply('⚠️ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' });
  }
});

bot.action('listserver', async (ctx) => {

  try {
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.answerCbQuery('\ud83d\udeab Khusus admin.', { show_alert: true }).catch(() => {});
    }
    logger.info('⏳ Proses daftar server dimulai');
    await ctx.answerCbQuery();

    const servers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err) {
          logger.error('⚠️ Kesalahan saat mengambil daftar server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*');
        }
        resolve(servers);
      });
    });

    if (servers.length === 0) {
      logger.info('⚠️ Tidak ada server yang tersedia');
      return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
    }

    const serverList = buildServerListText(servers);

    // Edit pesan menu server, tambah tombol kembali biar admin gampang balik.
    await editOrReply(ctx, serverList, {
      parse_mode: 'Markdown',
      reply_markup: buildServerMenuBackKeyboard(),
    });
  } catch (error) {
    logger.error('⚠️ Kesalahan saat mengambil daftar server:', error);
    await ctx.reply('⚠️ *Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' });
  }
});
bot.action('resetdb', async (ctx) => {
  try {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('? *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
    await ctx.answerCbQuery();
    await ctx.reply('⚠️ *PERHATIAN! Anda akan menghapus semua server yang tersedia. Apakah Anda yakin?*', {
      reply_markup: buildResetDbConfirmKeyboard(),
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Error saat memulai proses reset database:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('confirm_resetdb', async (ctx) => {
  try {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
    await ctx.answerCbQuery();
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM Server', (err) => {
        if (err) {
          logger.error('❌ Error saat mereset tabel Server:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi KESALAHAN SERIUS saat mereset database. Harap segera hubungi administrator!*');
        }
        resolve();
      });
    });
    await ctx.reply('⚠️ *PERHATIAN! Database telah DIRESET SEPENUHNYA. Semua server telah DIHAPUS TOTAL.*', { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('❌ Error saat mereset database:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('cancel_resetdb', async (ctx) => {
  try {
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    await ctx.answerCbQuery();
    await ctx.reply('⛔ *Proses reset database dibatalkan.*', { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('❌ Error saat membatalkan reset database:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action('deleteserver', async (ctx) => {
  try {
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('? *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
    }
    logger.info('ℹ️ Proses hapus server dimulai');
    await ctx.answerCbQuery();

    db.all('SELECT * FROM Server', [], (err, servers) => {
      if (err) {
        logger.error('?? Kesalahan saat mengambil daftar server:', err.message);
        return ctx.reply('?? *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' });
      }
      if (!servers || servers.length === 0) {
        return ctx.reply('?? *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' });
      }

      // Edit pesan menu server, fallback reply kalau pesan asli sudah hilang.
      editOrReply(ctx, '🗑️ *Pilih server yang ingin dihapus:*', {
        reply_markup: buildDeleteServerKeyboard(servers),
        parse_mode: 'Markdown',
      });
    });
  } catch (error) {
    logger.error('? Kesalahan saat memulai proses hapus server:', error);
    await ctx.reply('? *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});
bot.action(/edit_harga_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  await ctx.answerCbQuery().catch(() => {});
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit harga server dengan ID: ${serverId}`);

  // Ambil nilai lama dari DB supaya bisa ditampilkan di header & pesan sukses (before/after).
  db.get('SELECT nama_server, domain, harga FROM Server WHERE id = ?', [serverId], async (err, row) => {
    if (err) {
      logger.error('Gagal ambil server untuk edit harga:', err.message);
      return ctx.reply('⚠️ Gagal mengambil data server.', { parse_mode: 'Markdown' });
    }
    if (!row) return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });

    const oldHarga = Number(row.harga) || 0;
    const namaServer = row.nama_server || row.domain || ('Server #' + serverId);
    userState[ctx.chat.id] = {
      step: 'edit_harga',
      serverId: serverId,
      oldValue: oldHarga,
      serverName: namaServer,
    };

    await ctx.reply(
      '✏️ *Edit Harga Server (paket 30 hari)*\n\n' +
        '📍 Server: *' + namaServer + '*\n' +
        '💰 Harga sekarang: *Rp ' + oldHarga.toLocaleString('id-ID') + '*\n\n' +
        '_Silakan masukkan harga baru menggunakan keypad di bawah._\n' +
        '_Tekan ❌ Batal untuk membatalkan._',
      {
        reply_markup: { inline_keyboard: keyboard_nomor() },
        parse_mode: 'Markdown',
      }
    );
  });
});

bot.action(/add_saldo_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('? *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  const userId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk menambahkan saldo user dengan ID: ${userId}`);
  userState[ctx.chat.id] = { step: 'add_saldo', userId: userId };

  await ctx.reply('?? *Silakan masukkan jumlah saldo yang ingin ditambahkan:*', {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown'
  });
});

// Helper: buka prompt keypad untuk edit field numerik server (selain harga).
// Ambil nilai sekarang dari DB lalu simpan oldValue + serverName ke userState
// supaya `handleEditField` bisa tampilkan before/after dengan format unit.
function _openEditNumericFieldPrompt(ctx, serverId, dbCol, step, label, fmt) {
  db.get(
    'SELECT nama_server, domain, ' + dbCol + ' AS val FROM Server WHERE id = ?',
    [serverId],
    async (err, row) => {
      if (err) {
        logger.error('Gagal ambil server untuk edit ' + dbCol + ':', err.message);
        return ctx.reply('⚠️ Gagal mengambil data server.', { parse_mode: 'Markdown' });
      }
      if (!row) return ctx.reply('⚠️ Server tidak ditemukan.', { parse_mode: 'Markdown' });
      const oldValue = row.val;
      const namaServer = row.nama_server || row.domain || ('Server #' + serverId);
      userState[ctx.chat.id] = {
        step: step,
        serverId: serverId,
        oldValue: oldValue,
        serverName: namaServer,
      };
      await ctx.reply(
        buildEditNumericFieldPromptText({
          label,
          serverName: namaServer,
          formattedValue: fmt(oldValue),
        }),
        {
          reply_markup: { inline_keyboard: keyboard_nomor() },
          parse_mode: 'Markdown',
        }
      );
    }
  );
}

bot.action(/edit_batas_create_akun_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  await ctx.answerCbQuery().catch(() => {});
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit batas create akun server dengan ID: ${serverId}`);
  _openEditNumericFieldPrompt(ctx, serverId, 'batas_create_akun', 'edit_batas_create_akun', 'Batas Create Akun',
    (v) => Number(v || 0).toLocaleString('id-ID') + ' akun');
});

bot.action(/edit_total_create_akun_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  await ctx.answerCbQuery().catch(() => {});
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit total create akun server dengan ID: ${serverId}`);
  _openEditNumericFieldPrompt(ctx, serverId, 'total_create_akun', 'edit_total_create_akun', 'Total Create Akun',
    (v) => Number(v || 0).toLocaleString('id-ID') + ' akun');
});

bot.action(/edit_limit_ip_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  await ctx.answerCbQuery().catch(() => {});
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit limit IP server dengan ID: ${serverId}`);
  _openEditNumericFieldPrompt(ctx, serverId, 'iplimit', 'edit_limit_ip', 'Limit IP per Akun',
    (v) => Number(v || 0) + ' IP');
});

bot.action(/edit_quota_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('🚫 *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
  }
  await ctx.answerCbQuery().catch(() => {});
  const serverId = ctx.match[1];
  logger.info(`User ${ctx.from.id} memilih untuk mengedit quota server dengan ID: ${serverId}`);
  _openEditNumericFieldPrompt(ctx, serverId, 'quota', 'edit_quota', 'Quota',
    (v) => Number(v || 0) + ' GB');
});

bot.action(/edit_auth_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('? *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
          `? Nama   : \`${currentNama}\`\n` +
          `? Domain : \`${currentDomain}\`\n` +
          `? Auth   : \`${maskedAuth}\`\n\n` +
          '?? *Silakan ketik AUTH server baru, lalu kirim sebagai pesan biasa.*\n' +
          '? Ketik *batal* untuk membatalkan.',
        { parse_mode: 'Markdown' }
      );
    }
  );
});

bot.action(/edit_domain_(\d+)/, async (ctx) => {
  if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('? *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
    return ctx.reply('? *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
      '✏️ *Silakan ketik nama server baru, lalu kirim sebagai pesan biasa.*\n' +
      `?? Contoh: \`${currentName}\`\n` +
      '? Ketik *batal* untuk membatalkan.',
      { parse_mode: 'Markdown' }
    );
  });
});

bot.action(/confirm_delete_server_(\d+)/, async (ctx) => {
  try {
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
      return ctx.reply('? *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
    return ctx.reply('? *Menu ini khusus admin.*', { parse_mode: 'Markdown' });
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
      `• *Nama Server:* \`${server.nama_server}\`\n` +
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

  if (depositState[userId] && depositState[userId].action === 'request_amount') {
    await handleDepositState(ctx, userId, data);
  } else if (userStateData) {
    switch (userStateData.step) {
case 'addsaldo_userid':
  state.targetId = ctx.message.text.trim();
  state.step = 'addsaldo_jumlah';
  return ctx.reply('✏️ Masukkan jumlah saldo yang ingin ditambahkan:');

case 'addsaldo_amount':
  const amount = parseInt(ctx.message.text.trim());
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('⚠️ Jumlah saldo harus berupa angka dan lebih dari 0.');
  }

  const targetId = state.targetId;
  db.get('SELECT * FROM users WHERE user_id = ?', [targetId], (err, row) => {
    if (err) {
      logger.error('❌ Kesalahan saat memeriksa user_id:', err.message);
      return ctx.reply('❌ Terjadi kesalahan saat memeriksa user.');
    }

    if (!row) {
      return ctx.reply(`⚠️ User dengan ID ${targetId} belum terdaftar di database.`);
    }

    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, targetId], function (err) {
      if (err) {
        logger.error('❌ Gagal menambah saldo:', err.message);
        return ctx.reply('❌ Gagal menambah saldo.');
      }

      // ?→ Perbaikan di bawah ini
      db.get('SELECT saldo FROM users WHERE user_id = ?', [targetId], (err2, updatedRow) => {
        if (err2 || !updatedRow) {
          logger.info(`Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId}, namun gagal membaca saldo terbaru.`);
          return ctx.reply(`✅ Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.`);
        }

        ctx.reply(`✅ Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.\n💰 Saldo user sekarang: Rp${updatedRow.saldo.toLocaleString()}`);
        logger.info(`Admin ${ctx.from.id} menambah saldo Rp${amount} ke user ${targetId}. Saldo user sekarang: Rp${updatedRow.saldo}`);
      });

      delete userState[ctx.from.id];
    });
  });
  break;

  default:
    await ctx.reply('⚠️ Perintah tidak dikenali.');
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
  let currentAmount = depositState[userId].amount;

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentAmount.length === 0) {
      return await ctx.answerCbQuery('⚠️ Jumlah tidak boleh kosong!', { show_alert: true });
    }
    if (parseInt(currentAmount) < 5000) {
      return await ctx.answerCbQuery('⚠️ Jumlah minimal adalah 5.000 !', { show_alert: true });
    }
    depositState[userId].action = 'confirm_amount';
    await processDeposit(ctx, currentAmount);
    return;
  } else {
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('⚠️ Jumlah maksimal adalah 12 digit!', { show_alert: true });
    }
  }

  depositState[userId].amount = currentAmount;
  const newMessage = `💰 *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*\n\nJumlah saat ini: *Rp ${currentAmount || '0'}*`;

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
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo tidak boleh kosong!*', {
        show_alert: true,
      });
    }

    const amount = parseInt(currentSaldo, 10);
    if (isNaN(amount) || amount <= 0) {
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo tidak valid!*', {
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
        logger.error('⚠️ Gagal mencatat transaksi tambah saldo manual:', e.message);
      }

      let msg =
        '✅ *Saldo user berhasil ditambahkan.*\n\n' +
        '📋 *Detail:*\n' +
        `- Nominal Bayar : *Rp ${amount.toLocaleString('id-ID')}*\n`;

      if (bonus > 0) {
        msg +=
          `- Bonus        : *Rp ${bonus.toLocaleString('id-ID')} (${percent}%)*\n`;
      }

      msg += `- Saldo Masuk   : *Rp ${totalCredit.toLocaleString('id-ID')}*`;

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('❌ Terjadi kesalahan saat menambahkan saldo user:', error.message);
      await ctx.reply(
        '❌ *Terjadi kesalahan saat menambahkan saldo user.*',
        { parse_mode: 'Markdown' }
      );
    }

    delete userState[ctx.chat.id];
    return;
  } else if (data === 'cancel') {
    delete userState[ctx.chat.id];
    return await ctx.answerCbQuery('⛔ *Tambah saldo dibatalkan.*', {
      show_alert: true,
    });
  } else {
    if (currentSaldo.length < 10) {
      currentSaldo += data;
    } else {
      return await ctx.answerCbQuery(
        '⚠️ *Jumlah saldo maksimal adalah 10 karakter!*',
        { show_alert: true }
      );
    }
  }

  userStateData.saldo = currentSaldo;
  const newMessage =
    `💰 *Silakan masukkan jumlah saldo yang ingin ditambahkan:*\n\n` +
    `Jumlah saldo saat ini: *${currentSaldo || '0'}*`;

  await ctx.editMessageText(newMessage, {
    reply_markup: { inline_keyboard: keyboard_nomor() },
    parse_mode: 'Markdown',
  });
}


async function handleEditBatasCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'batasCreateAkun', 'Batas Create Akun',
    'UPDATE Server SET batas_create_akun = ? WHERE id = ?',
    (v) => Number(v || 0).toLocaleString('id-ID') + ' akun');
}

async function handleEditTotalCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'totalCreateAkun', 'Total Create Akun',
    'UPDATE Server SET total_create_akun = ? WHERE id = ?',
    (v) => Number(v || 0).toLocaleString('id-ID') + ' akun');
}

async function handleEditiplimit(ctx, userStateData, data) {
  await handleEditField(
    ctx,
    userStateData,
    data,
    'iplimit',
    'Limit IP per Akun',
    'UPDATE Server SET iplimit = ? WHERE id = ?',
    (v) => Number(v || 0) + ' IP'
  );
}


async function handleEditQuota(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'quota', 'Quota',
    'UPDATE Server SET quota = ? WHERE id = ?',
    (v) => Number(v || 0) + ' GB');
}

async function handleEditAuth(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'auth', 'auth', 'UPDATE Server SET auth = ? WHERE id = ?');
}

async function handleEditDomain(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'domain', 'domain', 'UPDATE Server SET domain = ? WHERE id = ?');
}

async function handleEditHarga(ctx, userStateData, data) {
  let currentAmount = userStateData.amount || '';

  // Tombol "❌ Batal" di keypad: hentikan flow & kembali ke menu server.
  // Sebelumnya callback 'cancel' jatuh ke else → "Hanya angka yang diperbolehkan".
  if (data === 'cancel') {
    delete userState[ctx.chat.id];
    try { await ctx.answerCbQuery('⛔ Dibatalkan'); } catch (_) {}
    try {
      await ctx.editMessageText('⛔ *Edit harga dibatalkan.*', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Kembali ke Menu Server', callback_data: 'admin_server_menu' }],
          ],
        },
      });
    } catch (_) {}
    return;
  }

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentAmount.length === 0) {
      return await ctx.answerCbQuery('⚠️ *Jumlah tidak boleh kosong!*', { show_alert: true });
    }
    const hargaBaru = parseFloat(currentAmount);
    if (isNaN(hargaBaru) || hargaBaru <= 0) {
      return ctx.reply('❌ *Harga tidak valid. Masukkan angka yang valid.*', { parse_mode: 'Markdown' });
    }
    const oldHarga = Number(userStateData.oldValue) || 0;
    const serverName = userStateData.serverName || ('Server #' + userStateData.serverId);
    try {
      await updateServerField(userStateData.serverId, hargaBaru, 'UPDATE Server SET harga = ? WHERE id = ?');
      ctx.reply(
        '✅ *Harga server berhasil diubah.*\n\n' +
          '📍 Server: *' + serverName + '*\n' +
          '• Sebelumnya : Rp ' + oldHarga.toLocaleString('id-ID') + '\n' +
          '• Sekarang   : *Rp ' + Number(hargaBaru).toLocaleString('id-ID') + '*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Kembali ke Menu Server', callback_data: 'admin_server_menu' }],
            ],
          },
        }
      );
    } catch (err) {
      ctx.reply('❌ *Terjadi kesalahan saat mengupdate harga server.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^\d+$/.test(data)) {
      return await ctx.answerCbQuery('⚠️ *Hanya angka yang diperbolehkan!*', { show_alert: true });
    }
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('⚠️ *Jumlah maksimal adalah 12 digit!*', { show_alert: true });
    }
  }

  userStateData.amount = currentAmount;
  const oldHarga = Number(userStateData.oldValue) || 0;
  const serverName = userStateData.serverName || ('Server #' + userStateData.serverId);
  const newMessage =
    '✏️ *Edit Harga Server (paket 30 hari)*\n\n' +
    '📍 Server: *' + serverName + '*\n' +
    '💰 Harga sekarang: *Rp ' + oldHarga.toLocaleString('id-ID') + '*\n' +
    '🆕 Input baru: *Rp ' + (currentAmount || '0') + '*\n\n' +
    '_Tekan ✅ untuk simpan atau ❌ Batal untuk membatalkan._';
  const oldText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || '';
  if (newMessage !== oldText) {
    try {
      await ctx.editMessageText(newMessage, {
        reply_markup: { inline_keyboard: keyboard_nomor() },
        parse_mode: 'Markdown',
      });
    } catch (e) {
      // "message is not modified" / pesan asli sudah hilang, ignore
    }
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
      { text: '🗑️', callback_data: 'delete' },
      { text: '0', callback_data: '0' },
      { text: '✅', callback_data: 'confirm' },
    ],
    [{ text: '❌ Batal', callback_data: 'cancel' }],
  ];
}
async function handleEditNama(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'name', 'nama server', 'UPDATE Server SET nama_server = ? WHERE id = ?');
}

// Helper generik untuk semua handler edit field numerik di Menu Server
// (Quota, Limit IP, Batas Create, Total Create). Edit Harga tidak pakai
// helper ini karena perlu format Rupiah khusus & sudah jadi di handleEditHarga.
//
// Behavior baru (konsisten dengan handleEditHarga):
//   - Header pesan tampilkan: nama server, nilai sekarang, input baru
//   - Tombol ❌ Batal: clear state + pesan + tombol kembali ke Menu Server
//   - Tombol ✅ Simpan: tampilkan before/after lengkap dengan unit
//   - Format unit per-field via callback `formatValue` (mis. "500 GB", "1 IP")
async function handleEditField(ctx, userStateData, data, field, fieldName, query, formatValue) {
  let currentValue = userStateData[field] || '';
  const fmt = typeof formatValue === 'function'
    ? formatValue
    : (v) => String(v == null ? '-' : v);

  // Tombol "❌ Batal" di keypad: stop flow, kembali ke Menu Server.
  if (data === 'cancel') {
    delete userState[ctx.chat.id];
    try { await ctx.answerCbQuery('⛔ Dibatalkan'); } catch (_) {}
    try {
      await ctx.editMessageText('⛔ *Edit ' + fieldName + ' dibatalkan.*', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Kembali ke Menu Server', callback_data: 'admin_server_menu' }],
          ],
        },
      });
    } catch (_) {}
    return;
  }

  if (data === 'delete') {
    currentValue = currentValue.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentValue.length === 0) {
      return await ctx.answerCbQuery('⚠️ *' + fieldName + ' tidak boleh kosong!*', { show_alert: true });
    }
    const oldValue = userStateData.oldValue;
    const serverName = userStateData.serverName || ('Server #' + userStateData.serverId);
    try {
      await updateServerField(userStateData.serverId, currentValue, query);
      ctx.reply(
        '✅ *' + fieldName + ' berhasil diubah.*\n\n' +
          '📍 Server: *' + serverName + '*\n' +
          '• Sebelumnya : ' + fmt(oldValue) + '\n' +
          '• Sekarang   : *' + fmt(currentValue) + '*',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Kembali ke Menu Server', callback_data: 'admin_server_menu' }],
            ],
          },
        }
      );
    } catch (err) {
      ctx.reply('❌ *Terjadi kesalahan saat mengupdate ' + fieldName + '.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^\d+$/.test(data)) {
      return await ctx.answerCbQuery('⚠️ *Hanya angka yang diperbolehkan!*', { show_alert: true });
    }
    if (currentValue.length < 253) {
      currentValue += data;
    } else {
      return await ctx.answerCbQuery('⚠️ *' + fieldName + ' maksimal adalah 253 karakter!*', { show_alert: true });
    }
  }

  userStateData[field] = currentValue;
  const oldValue = userStateData.oldValue;
  const serverName = userStateData.serverName || ('Server #' + userStateData.serverId);
  const newMessage =
    '✏️ *Edit ' + fieldName + '*\n\n' +
    '📍 Server: *' + serverName + '*\n' +
    '🔢 Nilai sekarang: *' + fmt(oldValue) + '*\n' +
    '🆕 Input baru: *' + (currentValue ? fmt(currentValue) : fmt(0)) + '*\n\n' +
    '_Tekan ✅ untuk simpan atau ❌ Batal untuk membatalkan._';
  const oldText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || '';
  if (newMessage !== oldText) {
    try {
      await ctx.editMessageText(newMessage, {
        reply_markup: { inline_keyboard: keyboard_nomor() },
        parse_mode: 'Markdown',
      });
    } catch (_) {
      // "message is not modified" / pesan asli sudah hilang, ignore
    }
  }
}
async function updateUserSaldo(userId, saldo) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [saldo, userId], function (err) {
      if (err) {
        logger.error('⚠️ Kesalahan saat menambahkan saldo user:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
// ?→ Helper: proses pengurangan saldo + catat transaksi pembelian akun
// --- Fase 4 split: processAccountPayment dipindah ke accounts/

// --- Fase 4 split: refundAccountPayment dipindah ke accounts/

async function updateServerField(serverId, value, query) {
  return new Promise((resolve, reject) => {
    db.run(query, [value, serverId], function (err) {
      if (err) {
        // Jangan pakai fieldName karena tidak didefinisikan
        logger.error('⚠️ Kesalahan saat mengupdate data server:', err.message);
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

// --- Fase 3 split: state topup dikelola depositManager (payment/deposit.js)
// State sudah di-require di atas via `state/deposit-state.js`. Tidak perlu deklarasi ulang.

db.all('SELECT * FROM pending_deposits WHERE status = "pending"', [], (err, rows) => {
  if (err) { logger.error('Gagal load pending_deposits:', err.message); return; }
  const timeoutMinOnBoot = Number(QRIS_PAYMENT_TIMEOUT_MIN || 5);
  const nowBoot = Date.now();
  let restored = 0;
  let expiredOnBoot = 0;
  rows.forEach((row) => {
    const amount = Number(row.amount || 0);
    const originalAmount = Number(row.original_amount || 0);
    const adminFee = amount > originalAmount ? amount - originalAmount : 0;
    const ts = Number(row.timestamp || nowBoot);
    const expiresAt = ts + timeoutMinOnBoot * 60 * 1000;
    if (nowBoot > expiresAt) {
      db.run(
        'UPDATE pending_deposits SET status = ? WHERE unique_code = ? AND status = ?',
        ['expired', row.unique_code, 'pending'],
        (uerr) => {
          if (uerr) logger.warn('Gagal tandai expired saat boot: ' + uerr.message);
        }
      );
      expiredOnBoot++;
      return;
    }
    pendingDeposits[row.unique_code] = {
      amount,
      originalAmount,
      adminFee,
      userId: row.user_id,
      timestamp: ts,
      status: row.status,
      qrMessageId: row.qr_message_id,
      expiresAt,
      restoredFromDb: true,
    };
    restored++;
  });
  logger.info(`Pending deposit restored: ${restored} aktif, ${expiredOnBoot} di-expired saat boot`);
});

// PM2 cluster guard tetap dipakai di beberapa tempat lama (misal HTTP bind).
const IS_PM2_PRIMARY = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

function _getBaseQr() {
  return GOPAY_BASE_QR || DATA_QRIS || '';
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

const { createDepositManager } = require('./payment/deposit');
const depositManager = createDepositManager({
  db,
  bot,
  logger,
  gopayClient,
  findMatchingSettlementTransaction,
  parseProviderTransactionTime,
  buildDynamicQrisPayload,
  buildStaticQrisImageUrl,
  getTimeZone: () => TIME_ZONE,
  getPaymentTimeoutMin: _getPaymentTimeoutMin,
  getMinMaxTopup: _getMinMaxTopup,
  getBaseQr: _getBaseQr,
  getApiKey: () => API_KEY,
  pollIntervalMs: 10000,
  depositExpireMs: 5 * 60 * 1000,
  requestIntervalMs: 1000,
});
const {
  markDepositExpired,
  creditDeposit,
  checkQRISStatus,
  findAvailableTopupAmount,
  processDeposit,
} = depositManager;

const { createQrisPaymentPoller } = require('./payment/polling');
const qrisPaymentPoller = createQrisPaymentPoller({
  db,
  bot,
  logger,
  checkQrisInvoiceStatus,
  finalizeQrisPayment,
  calculateTopupBonus,
  applyQrisTopupBonus,
  notifyTopupSuccess,
  intervalMs: Number(QRIS_CHECK_INTERVAL_MS || 15000),
  paymentTimeoutMin: Number(QRIS_PAYMENT_TIMEOUT_MIN || 10),
});

// --- Body createQrisInvoice dipindah ke payment/qris-invoice.js (wrapper di atas)

// --- Fase 4 split: recordAccountTransaction dipindah ke accounts/
// --- Fase 4 split: upsertAccount dipindah ke accounts/

if (EXPIRE_DATE) {
  const now = new Date();
  // Misal pakai zona waktu Jayapura
  const expire = new Date(EXPIRE_DATE + 'T23:59:59+09:00');

  if (now > expire) {
    console.log('⚠️ Lisensi bot sudah kadaluarsa. Harap hubungi pemilik panel.');
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
      console.log('⚠️ Lisensi bot kadaluarsa saat berjalan, menghentikan bot.');
      process.exit(1);
    }
  }, 5 * 60 * 1000); // cek tiap 5 menit
}




// Jalankan bot
bot.launch()
  .then(() => {
    logger.info('Bot telah dimulai (build QRIS AUTO v3)');
    // Resume broadcast job yang state-nya masih 'running' setelah restart.
    // Pakai setImmediate biar tidak blocking startup.
    setImmediate(() => {
      resumePendingBroadcastJobs().catch((e) =>
        logger.error('⚠️ resumePendingBroadcastJobs gagal:', e.message || e)
      );
    });
  })
  .catch((error) => {
    logger.error('Error saat memulai bot:', error);
  });

// Jalankan scheduler di luar app.listen
// --- Fase 3 split: scheduler auto-topup dipindah ke payment/deposit.js & payment/polling.js
depositManager.startAutoTopupMutasi();
qrisPaymentPoller.start();
restartAutoBackupScheduler();
startDailyReportScheduler();
startExpiryReminderScheduler();
startResellerTargetScheduler();
// startQrisAutoTopupChecker(); // JANGAN dipanggil lagi di sini,
//                              // soalnya di atas sudah ada "startQrisAutoTopupChecker();"

// HTTP server
const HTTP_BIND = envOr('HTTP_BIND', '127.0.0.1');

// === Health check endpoint ===
// Bind ke 127.0.0.1, jadi cuma bisa diakses dari local machine.
// Berguna untuk monitoring eksternal: cron, systemd watcher, atau reverse proxy.
// Return JSON ringkas: status, uptime, db reachable, scheduler state, version.
const HTTP_BOOT_TS = Date.now();
app.get('/healthz', (req, res) => {
  const uptimeSec = Math.floor((Date.now() - HTTP_BOOT_TS) / 1000);
  const checkDb = () => new Promise((resolve) => {
    try {
      db.get('SELECT 1 AS ok', [], (err, row) => {
        if (err || !row) return resolve(false);
        resolve(row.ok === 1);
      });
    } catch (e) {
      resolve(false);
    }
  });
  checkDb().then((dbOk) => {
    const payload = {
      status: dbOk ? 'ok' : 'degraded',
      uptime_sec: uptimeSec,
      db: dbOk ? 'ok' : 'down',
      ts: new Date().toISOString(),
    };
    res.status(dbOk ? 200 : 503).json(payload);
  });
});

// Endpoint tambahan untuk liveness sederhana (tanpa DB check) — selalu 200 selama proses idup.
app.get('/livez', (req, res) => {
  res.status(200).json({ status: 'alive', uptime_sec: Math.floor((Date.now() - HTTP_BOOT_TS) / 1000) });
});

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
