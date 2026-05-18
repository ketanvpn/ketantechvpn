// scripts/smoke-edukasi.js
// Smoke test untuk modul Paket Edukasi.
// Verifikasi: require sukses, factory bisa di-instantiate, syntax OK,
// fungsi-fungsi kunci callable. Tidak hit network.

const path = require('path');
const fs = require('fs');

const errors = [];
function pass(msg) { console.log('[ok]   ' + msg); }
function fail(msg, e) {
  console.log('[FAIL] ' + msg + (e ? ' :: ' + (e && e.message ? e.message : e) : ''));
  errors.push(msg);
}

// 1) Require semua module
let edukasiClientMod, edukasiServiceMod, edukasiHandlersMod, edukasiAdminMod;
try {
  edukasiClientMod = require('../modules/edukasi-client');
  pass('require modules/edukasi-client');
} catch (e) { fail('require modules/edukasi-client', e); process.exit(1); }

try {
  edukasiServiceMod = require('../modules/edukasi');
  pass('require modules/edukasi');
} catch (e) { fail('require modules/edukasi', e); process.exit(1); }

try {
  edukasiHandlersMod = require('../modules/edukasi-handlers');
  pass('require modules/edukasi-handlers');
} catch (e) { fail('require modules/edukasi-handlers', e); process.exit(1); }

try {
  edukasiAdminMod = require('../admin/edukasi');
  pass('require admin/edukasi');
} catch (e) { fail('require admin/edukasi', e); process.exit(1); }

// 2) Bikin client dummy
const dummyLogger = {
  info: () => {}, warn: () => {}, error: () => {},
};

let client;
try {
  client = edukasiClientMod.createEdukasiClient({
    getApiKey: () => 'dummy',
    logger: dummyLogger,
  });
  pass('createEdukasiClient (dummy key)');
} catch (e) { fail('createEdukasiClient', e); }

// 3) Bikin service dummy (dengan in-memory mock)
const dummyDb = {
  get: (sql, params, cb) => cb(null, null),
  run: (sql, params, cb) => cb && cb(null),
  serialize: (fn) => fn(),
  all: (sql, params, cb) => cb(null, []),
};
const dummyAccountService = {
  processAccountPayment: () => Promise.resolve({ refId: 'x', trxType: 't' }),
  refundAccountPayment: () => Promise.resolve(true),
};

let service;
try {
  service = edukasiServiceMod.createEdukasiService({
    db: dummyDb,
    logger: dummyLogger,
    edukasiClient: client,
    accountService: dummyAccountService,
    isResellerId: () => false,
    getPriceConfig: () => ({
      MEMBER_MONTHLY: 15000,
      MEMBER_WEEKLY: 5000,
      RESELLER_MONTHLY: 12000,
      RESELLER_WEEKLY: 4000,
    }),
    getTrialMaxPerDay: () => 1,
    getTimeZone: () => 'Asia/Jakarta',
  });
  pass('createEdukasiService');
} catch (e) { fail('createEdukasiService', e); }

// 4) Verify pricing logic
try {
  const memberMonthly = service.calculateUserPrice(123, 'monthly');
  if (memberMonthly.price !== 15000 || memberMonthly.isReseller !== false) {
    throw new Error('member monthly tidak match: ' + JSON.stringify(memberMonthly));
  }
  pass('calculateUserPrice (member, monthly) = 15000');

  const memberWeekly = service.calculateUserPrice(123, 'weekly');
  if (memberWeekly.price !== 5000) throw new Error('member weekly tidak 5000');
  pass('calculateUserPrice (member, weekly) = 5000');
} catch (e) { fail('calculateUserPrice', e); }

// Bikin service untuk reseller path
try {
  const svcRes = edukasiServiceMod.createEdukasiService({
    db: dummyDb,
    logger: dummyLogger,
    edukasiClient: client,
    accountService: dummyAccountService,
    isResellerId: (uid) => uid === 999,
    getPriceConfig: () => ({
      MEMBER_MONTHLY: 15000, MEMBER_WEEKLY: 5000,
      RESELLER_MONTHLY: 12000, RESELLER_WEEKLY: 4000,
    }),
    getTrialMaxPerDay: () => 1,
    getTimeZone: () => 'Asia/Jakarta',
  });
  const r = svcRes.calculateUserPrice(999, 'monthly');
  if (r.price !== 12000 || r.isReseller !== true) {
    throw new Error('reseller monthly tidak match: ' + JSON.stringify(r));
  }
  pass('calculateUserPrice (reseller, monthly) = 12000');
} catch (e) { fail('calculateUserPrice (reseller)', e); }

// 5) Format pesan akun (paid, monthly)
try {
  const fakeResult = {
    apiData: {
      order_id: 'VPN12345',
      username: 'userku',
      password: 'passku',
      service: 'bundle_vmess',
      billing_period: 'monthly',
      server: 'Singapore 01',
      expired_at: '2026-06-18T12:00:00.000000Z',
      output: 'vmess://abcdef...',
    },
    priceInfo: { price: 15000, period: 'monthly', label: 'Bulanan' },
    server: { name: 'Singapore 01' },
    type: 'vmess',
  };
  const msg = service.formatAccountMessage(fakeResult);
  if (!msg.includes('VMess')) throw new Error('label VMess tidak ada di pesan');
  if (!msg.includes('VPN12345')) throw new Error('order_id tidak ada di pesan');
  if (!msg.includes('15.000')) throw new Error('harga tidak ter-format');
  pass('formatAccountMessage paid monthly mengandung label, order_id, harga');
} catch (e) { fail('formatAccountMessage paid', e); }

// 6) Format pesan trial
try {
  const trialRes = {
    isTrial: true,
    apiData: {
      order_id: 'TRIAL01',
      username: 'TRIALuser',
      service: 'bundle_vmess',
      trial: true,
      billing_period: 'monthly',
      expired_at: '2026-05-18T12:30:00.000000Z',
    },
    server: { name: 'Singapore 01' },
    type: 'vmess',
  };
  const msg = service.formatAccountMessage(trialRes);
  if (!msg.includes('Trial')) throw new Error('label Trial tidak ada');
  if (msg.includes('Harga')) throw new Error('field Harga seharusnya tidak ada di trial');
  pass('formatAccountMessage trial benar (no harga, ada label Trial)');
} catch (e) { fail('formatAccountMessage trial', e); }

// 7) Validasi service yang didukung
try {
  const supported = edukasiServiceMod.SUPPORTED_SERVICES;
  for (const s of ['bundle_vmess', 'bundle_vless', 'bundle_trojan', 'bundle_shadowsocks']) {
    if (!supported.includes(s)) throw new Error('SUPPORTED_SERVICES kurang: ' + s);
  }
  if (supported.includes('bundle_complete')) throw new Error('SUPPORTED_SERVICES seharusnya tidak punya bundle_complete');
  pass('SUPPORTED_SERVICES sesuai (4 bundle dasar saja)');
} catch (e) { fail('SUPPORTED_SERVICES', e); }

// 8) Cek migrasi punya kolom & tabel baru
try {
  const migPath = path.join(__dirname, '..', 'db', 'migrations.js');
  const txt = fs.readFileSync(migPath, 'utf8');
  if (!txt.includes("ensureSqliteColumn('accounts', 'external_order_id'")) {
    throw new Error('migrasi external_order_id tidak ditemukan');
  }
  if (!txt.includes('CREATE TABLE IF NOT EXISTS edukasi_trial_usage')) {
    throw new Error('tabel edukasi_trial_usage tidak ditemukan');
  }
  pass('migrations.js punya kolom external_* dan tabel edukasi_trial_usage');
} catch (e) { fail('migrations.js content', e); }

// 9) Validasi .vars.example.json memiliki key baru
try {
  const examplePath = path.join(__dirname, '..', '.vars.example.json');
  const cfg = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  for (const k of [
    'VPNBIZ_API_KEY', 'EDUKASI_PRICE_MEMBER_MONTHLY',
    'EDUKASI_PRICE_MEMBER_WEEKLY', 'EDUKASI_PRICE_RESELLER_MONTHLY',
    'EDUKASI_PRICE_RESELLER_WEEKLY', 'EDUKASI_TRIAL_MAX_PER_DAY',
  ]) {
    if (!(k in cfg)) throw new Error('key hilang: ' + k);
  }
  pass('.vars.example.json punya semua key VPNBIZ/EDUKASI');
} catch (e) { fail('.vars.example.json keys', e); }

// 10) app.js bisa di-parse (sekedar AST check via require parser)
try {
  // Hanya verifikasi syntax (tanpa execute) dengan vm.compileFunction.
  const vm = require('vm');
  const txt = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  // Test compile saja, tidak jalankan.
  new vm.Script(txt, { filename: 'app.js' });
  pass('app.js syntax valid (vm.Script compile OK)');
} catch (e) { fail('app.js syntax', e); }

console.log('');
if (errors.length === 0) {
  console.log('SMOKE EDUKASI: ALL OK (' + errors.length + ' fail)');
  process.exit(0);
} else {
  console.log('SMOKE EDUKASI: ' + errors.length + ' fail');
  process.exit(1);
}
