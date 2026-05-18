// modules/edukasi.js
// Business logic untuk Paket Edukasi (akun VPN dari vpnbiz.id reseller API).
// Tugas:
//   - Cache produk vpnbiz (5 menit)
//   - Hitung harga jual lokal (member vs reseller, monthly vs weekly)
//   - Orchestrate order/renew/trial: potong saldo lokal -> call API -> simpan ke `accounts`
//     -> kalau API gagal, refund saldo lokal
//   - Format pesan akun (konsisten dengan style modul existing)
//
// Tidak menyentuh logika modul existing (create.js / renew.js / trial.js).

const SUPPORTED_SERVICES = ['bundle_vmess', 'bundle_vless', 'bundle_trojan', 'bundle_shadowsocks'];

const SERVICE_LABELS = {
  bundle_vmess: 'VMess',
  bundle_vless: 'VLess',
  bundle_trojan: 'Trojan',
  bundle_shadowsocks: 'Shadowsocks',
};

const TYPE_FROM_SERVICE = {
  bundle_vmess: 'vmess',
  bundle_vless: 'vless',
  bundle_trojan: 'trojan',
  bundle_shadowsocks: 'shadowsocks',
};

const PRODUCTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit

function formatRupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

function nowMs() {
  return Date.now();
}

function dayMs() {
  return 24 * 60 * 60 * 1000;
}

function escapeMarkdownV1(s) {
  if (s === null || s === undefined) return '';
  // Markdown legacy (parse_mode 'Markdown') sensitive char: _ * [ ` (sebagian)
  // Untuk konten dinamis di code-block backtick, biasanya cukup escape backtick.
  return String(s).replace(/`/g, '\\`');
}

function createEdukasiService({
  db,
  logger,
  edukasiClient,
  accountService,
  isResellerId,
  getPriceConfig,
  getTrialMaxPerDay,
  getTimeZone,
}) {
  if (!db) throw new Error('createEdukasiService: db required');
  if (!logger) throw new Error('createEdukasiService: logger required');
  if (!edukasiClient) throw new Error('createEdukasiService: edukasiClient required');
  if (!accountService) throw new Error('createEdukasiService: accountService required');
  if (typeof isResellerId !== 'function') {
    throw new Error('createEdukasiService: isResellerId harus fungsi');
  }
  if (typeof getPriceConfig !== 'function') {
    throw new Error('createEdukasiService: getPriceConfig harus fungsi');
  }
  if (typeof getTrialMaxPerDay !== 'function') {
    throw new Error('createEdukasiService: getTrialMaxPerDay harus fungsi');
  }
  const tz = typeof getTimeZone === 'function' ? getTimeZone : () => 'Asia/Jakarta';

  // === CACHE PRODUK ===
  let productsCache = null;
  let productsCacheAt = 0;

  async function getProducts({ force = false } = {}) {
    if (!force && productsCache && nowMs() - productsCacheAt < PRODUCTS_CACHE_TTL_MS) {
      return productsCache;
    }
    const data = await edukasiClient.getProducts();
    productsCache = data;
    productsCacheAt = nowMs();
    return data;
  }

  function clearProductsCache() {
    productsCache = null;
    productsCacheAt = 0;
  }

  // === LIST SERVER & PRODUK YANG DIDUKUNG ===
  function listServers(productsData) {
    const servers = (productsData && productsData.servers) || [];
    return servers.map((s) => ({
      code: s.code,
      name: s.name,
      slot: s.slot || null,
    }));
  }

  function findServer(productsData, serverCode) {
    const servers = (productsData && productsData.servers) || [];
    return servers.find((s) => s.code === serverCode) || null;
  }

  function findProduct(server, service) {
    if (!server || !server.products) return null;
    return server.products.find((p) => p.service === service) || null;
  }

  function listSupportedServices(server) {
    if (!server || !server.products) return [];
    return server.products
      .filter((p) => SUPPORTED_SERVICES.includes(p.service))
      .map((p) => ({
        service: p.service,
        label: SERVICE_LABELS[p.service] || p.label || p.service,
        billingPeriods: Array.isArray(p.billing_periods) ? p.billing_periods : [],
      }));
  }

  function getTrialInfo(productsData) {
    return (productsData && productsData.trial) || { duration_minutes: 30, traffic_quota: { gb: 2, label: '2 GB' } };
  }

  // === HARGA JUAL LOKAL ===
  function calculateUserPrice(userId, billingPeriod) {
    const cfg = getPriceConfig() || {};
    const isReseller = !!isResellerId(userId);
    const period = billingPeriod === 'weekly' ? 'weekly' : 'monthly';

    let price = 0;
    if (isReseller) {
      price = period === 'weekly'
        ? Number(cfg.RESELLER_WEEKLY || 0)
        : Number(cfg.RESELLER_MONTHLY || 0);
    } else {
      price = period === 'weekly'
        ? Number(cfg.MEMBER_WEEKLY || 0)
        : Number(cfg.MEMBER_MONTHLY || 0);
    }

    return {
      price,
      isReseller,
      period,
      label: period === 'weekly' ? 'Mingguan' : 'Bulanan',
    };
  }

  // === DB HELPERS ===
  function getUserSaldoOrZero(userId) {
    return new Promise((resolve) => {
      db.get('SELECT saldo FROM users WHERE user_id = ?', [Number(userId)], (err, row) => {
        if (err) return resolve(0);
        resolve(row && typeof row.saldo === 'number' ? row.saldo : 0);
      });
    });
  }

  function getEdukasiTrialDateKey() {
    try {
      const zone = tz() || 'Asia/Jakarta';
      return new Date().toLocaleDateString('en-CA', { timeZone: zone });
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function getEdukasiTrialUsageToday(userId) {
    return new Promise((resolve) => {
      const today = getEdukasiTrialDateKey();
      db.get(
        'SELECT count FROM edukasi_trial_usage WHERE user_id = ? AND date = ?',
        [Number(userId), today],
        (err, row) => {
          if (err) {
            logger.error('Gagal baca edukasi_trial_usage:', err.message || err);
            return resolve(0);
          }
          resolve(row && typeof row.count === 'number' ? row.count : 0);
        }
      );
    });
  }

  function incrementEdukasiTrialUsage(userId) {
    return new Promise((resolve) => {
      const today = getEdukasiTrialDateKey();
      db.run(
        `INSERT INTO edukasi_trial_usage (user_id, date, count) VALUES (?, ?, 1)
         ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1`,
        [Number(userId), today],
        (err) => {
          if (err) logger.error('Gagal update edukasi_trial_usage:', err.message || err);
          resolve();
        }
      );
    });
  }

  // Simpan akun edukasi ke tabel accounts dengan kolom external_*.
  // Skip upsertAccount lokal supaya kita bisa set external_order_id sekaligus dengan satu insert.
  function saveEdukasiAccount({ userId, username, type, externalOrderId, billingPeriod, expiresAtIso }) {
    return new Promise((resolve, reject) => {
      const createdAt = nowMs();
      let expiresAt = null;
      if (expiresAtIso) {
        const ts = Date.parse(expiresAtIso);
        if (!Number.isNaN(ts)) expiresAt = ts;
      }
      // server_id NULL karena server vpnbiz tidak ada di tabel Server lokal.
      db.run(
        `INSERT INTO accounts
           (user_id, username, type, server_id, created_at, expires_at,
            external_order_id, external_provider, billing_period)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          Number(userId),
          String(username),
          String(type),
          createdAt,
          expiresAt,
          String(externalOrderId),
          'vpnbiz',
          billingPeriod ? String(billingPeriod) : null,
        ],
        function (err) {
          if (err) {
            logger.error('Gagal simpan akun edukasi:', err.message || err);
            return reject(err);
          }
          resolve({ id: this.lastID, createdAt, expiresAt });
        }
      );
    });
  }

  function updateEdukasiAccountExpiry(accountId, expiresAtIso) {
    return new Promise((resolve) => {
      let expiresAt = null;
      if (expiresAtIso) {
        const ts = Date.parse(expiresAtIso);
        if (!Number.isNaN(ts)) expiresAt = ts;
      }
      db.run(
        'UPDATE accounts SET expires_at = ? WHERE id = ?',
        [expiresAt, Number(accountId)],
        (err) => {
          if (err) logger.error('Gagal update expires_at akun edukasi:', err.message || err);
          resolve();
        }
      );
    });
  }

  function getEdukasiAccountById(accountId, userId) {
    return new Promise((resolve) => {
      db.get(
        `SELECT id, user_id, username, type, expires_at, external_order_id,
                external_provider, billing_period
         FROM accounts WHERE id = ?`,
        [Number(accountId)],
        (err, row) => {
          if (err) {
            logger.error('Gagal baca akun edukasi:', err.message || err);
            return resolve(null);
          }
          if (!row) return resolve(null);
          if (Number(row.user_id) !== Number(userId)) return resolve(null);
          if (row.external_provider !== 'vpnbiz') return resolve(null);
          resolve(row);
        }
      );
    });
  }

  // === ORDER (paid) ===
  // params: { userId, serverCode, service, username, password, billingPeriod, duration }
  async function orderEdukasi(params) {
    const userId = Number(params.userId);
    const serverCode = String(params.serverCode || '');
    const service = String(params.service || '');
    const username = String(params.username || '').trim();
    const password = String(params.password || '').trim();
    const billingPeriod = params.billingPeriod === 'weekly' ? 'weekly' : 'monthly';
    const duration = Number(params.duration || 1);

    if (!userId) throw new Error('userId wajib');
    if (!SUPPORTED_SERVICES.includes(service)) {
      throw new Error('Layanan tidak didukung untuk Paket Edukasi');
    }
    if (!/^[A-Za-z0-9]{3,16}$/.test(username)) {
      throw new Error('Username tidak valid (3-16 karakter, hanya huruf & angka)');
    }
    if (!/^[A-Za-z0-9._!@#\-]{3,32}$/.test(password)) {
      throw new Error('Password tidak valid (3-32 karakter)');
    }

    // Validasi server & produk dari API (juga refresh cache)
    const products = await getProducts();
    const server = findServer(products, serverCode);
    if (!server) throw new Error('Server vpnbiz tidak ditemukan');
    const product = findProduct(server, service);
    if (!product) throw new Error('Produk tidak tersedia di server ini');
    const supported = Array.isArray(product.billing_periods) && product.billing_periods.includes(billingPeriod);
    if (!supported) {
      throw new Error('Periode ' + billingPeriod + ' tidak tersedia untuk produk ini');
    }

    // Hitung harga jual
    const priceInfo = calculateUserPrice(userId, billingPeriod);
    if (!priceInfo.price || priceInfo.price <= 0) {
      throw new Error('Harga jual untuk paket ini belum di-set. Hubungi admin.');
    }

    // Cek saldo
    const saldo = await getUserSaldoOrZero(userId);
    if (saldo < priceInfo.price) {
      throw new Error('Saldo kamu tidak cukup. Saldo: ' + formatRupiah(saldo)
        + ', butuh: ' + formatRupiah(priceInfo.price));
    }

    // Potong saldo lokal (atomic, lewat accounts/service.js)
    let payment;
    try {
      payment = await accountService.processAccountPayment(
        userId,
        priceInfo.price,
        'edukasi_' + TYPE_FROM_SERVICE[service],
        'create',
        0, // serverId 0 (vpnbiz tidak ada di tabel Server lokal)
        username
      );
    } catch (err) {
      throw new Error('Gagal memotong saldo: ' + (err.message || err));
    }

    // Call API order
    let apiData;
    try {
      apiData = await edukasiClient.orderVpn({
        server_code: serverCode,
        service,
        username,
        password,
        duration,
        billing_period: billingPeriod,
      });
    } catch (err) {
      // Refund saldo lokal kalau API gagal
      try {
        await accountService.refundAccountPayment(
          userId,
          priceInfo.price,
          'edukasi_' + TYPE_FROM_SERVICE[service],
          'create',
          0,
          username,
          'edukasi_api_failed'
        );
      } catch (refundErr) {
        logger.error('Gagal refund saldo edukasi:', refundErr.message || refundErr);
      }
      const apiErrMsg = err && err.providerMessage ? err.providerMessage : (err.message || 'Unknown error');
      const errorOut = new Error(apiErrMsg);
      errorOut.code = err.code || 'edukasi_api_error';
      errorOut.refunded = true;
      throw errorOut;
    }

    // Simpan ke accounts
    const type = TYPE_FROM_SERVICE[service];
    let saved;
    try {
      saved = await saveEdukasiAccount({
        userId,
        username: apiData.username || username,
        type,
        externalOrderId: apiData.order_id,
        billingPeriod,
        expiresAtIso: apiData.expired_at,
      });
    } catch (e) {
      // API sudah sukses tapi DB lokal gagal -> jangan refund (akun sudah jadi).
      // Hanya log warning, user tetap dapat info akun.
      logger.warn('Akun edukasi berhasil di vpnbiz tapi gagal disimpan ke DB lokal: '
        + (e.message || e) + '; order_id=' + apiData.order_id);
    }

    return {
      apiData,
      payment,
      priceInfo,
      server,
      product,
      type,
      account: saved || null,
    };
  }

  // === TRIAL ===
  // params: { userId, serverCode, service }
  async function trialEdukasi(params) {
    const userId = Number(params.userId);
    const serverCode = String(params.serverCode || '');
    const service = String(params.service || '');

    if (!userId) throw new Error('userId wajib');
    if (!SUPPORTED_SERVICES.includes(service)) {
      throw new Error('Trial hanya tersedia untuk VMess, VLess, Trojan, Shadowsocks');
    }

    const max = Number(getTrialMaxPerDay() || 1);
    const used = await getEdukasiTrialUsageToday(userId);
    if (used >= max) {
      throw new Error('Kamu sudah pakai trial edukasi hari ini (' + used + '/' + max + '). Coba lagi besok ya.');
    }

    const products = await getProducts();
    const server = findServer(products, serverCode);
    if (!server) throw new Error('Server vpnbiz tidak ditemukan');

    let apiData;
    try {
      apiData = await edukasiClient.orderVpn({
        server_code: serverCode,
        service,
        trial: true,
      });
    } catch (err) {
      const apiErrMsg = err && err.providerMessage ? err.providerMessage : (err.message || 'Unknown error');
      const errorOut = new Error(apiErrMsg);
      errorOut.code = err.code || 'edukasi_api_error';
      throw errorOut;
    }

    // Increment counter setelah sukses
    await incrementEdukasiTrialUsage(userId);

    const type = TYPE_FROM_SERVICE[service];
    let saved;
    try {
      saved = await saveEdukasiAccount({
        userId,
        username: apiData.username,
        type,
        externalOrderId: apiData.order_id,
        billingPeriod: 'trial',
        expiresAtIso: apiData.expired_at,
      });
    } catch (e) {
      logger.warn('Trial edukasi sukses tapi gagal disimpan ke DB lokal: '
        + (e.message || e) + '; order_id=' + apiData.order_id);
    }

    return {
      apiData,
      server,
      type,
      account: saved || null,
      isTrial: true,
    };
  }

  // === RENEW ===
  // params: { userId, accountId, billingPeriod, duration }
  async function renewEdukasi(params) {
    const userId = Number(params.userId);
    const accountId = Number(params.accountId);
    const billingPeriod = params.billingPeriod === 'weekly' ? 'weekly' : 'monthly';
    const duration = Number(params.duration || 1);

    const account = await getEdukasiAccountById(accountId, userId);
    if (!account) throw new Error('Akun edukasi tidak ditemukan atau bukan milik kamu');
    if (!account.external_order_id) throw new Error('Akun ini tidak punya order_id eksternal, tidak bisa diperpanjang');
    if (account.billing_period === 'trial') {
      throw new Error('Akun trial tidak bisa diperpanjang. Silakan beli paket berbayar.');
    }

    const priceInfo = calculateUserPrice(userId, billingPeriod);
    if (!priceInfo.price || priceInfo.price <= 0) {
      throw new Error('Harga jual untuk renew belum di-set. Hubungi admin.');
    }

    const saldo = await getUserSaldoOrZero(userId);
    if (saldo < priceInfo.price) {
      throw new Error('Saldo kamu tidak cukup. Saldo: ' + formatRupiah(saldo)
        + ', butuh: ' + formatRupiah(priceInfo.price));
    }

    let payment;
    try {
      payment = await accountService.processAccountPayment(
        userId,
        priceInfo.price,
        'edukasi_' + account.type,
        'renew',
        0,
        account.username
      );
    } catch (err) {
      throw new Error('Gagal memotong saldo: ' + (err.message || err));
    }

    let apiData;
    try {
      apiData = await edukasiClient.renewVpn({
        order_id: account.external_order_id,
        duration,
        billing_period: billingPeriod,
      });
    } catch (err) {
      try {
        await accountService.refundAccountPayment(
          userId,
          priceInfo.price,
          'edukasi_' + account.type,
          'renew',
          0,
          account.username,
          'edukasi_renew_api_failed'
        );
      } catch (refundErr) {
        logger.error('Gagal refund saldo renew edukasi:', refundErr.message || refundErr);
      }
      const apiErrMsg = err && err.providerMessage ? err.providerMessage : (err.message || 'Unknown error');
      const errorOut = new Error(apiErrMsg);
      errorOut.code = err.code || 'edukasi_api_error';
      errorOut.refunded = true;
      throw errorOut;
    }

    // Update expires_at di DB lokal
    if (apiData.expired_at) {
      await updateEdukasiAccountExpiry(accountId, apiData.expired_at);
    }

    return {
      apiData,
      payment,
      priceInfo,
      account,
      isRenew: true,
    };
  }

  // === FORMAT PESAN AKUN (Markdown legacy, kompatibel dgn modul lain) ===
  function formatAccountMessage(result) {
    const apiData = result.apiData || {};
    const isTrial = !!result.isTrial || !!apiData.trial;
    const isRenew = !!result.isRenew;
    const type = result.type || (apiData.service ? TYPE_FROM_SERVICE[apiData.service] : 'vpn');
    const label = SERVICE_LABELS[apiData.service] || (type ? type.toUpperCase() : 'VPN');
    const periode = apiData.billing_period === 'weekly' ? 'Mingguan' : 'Bulanan';
    const periodeOrTrial = isTrial ? 'Trial (30 menit)' : periode;
    const serverName = (result.server && result.server.name) || apiData.server || '-';
    const harga = isTrial ? 0 : (result.priceInfo ? result.priceInfo.price : (apiData.price || 0));
    const expired = apiData.expired_at ? String(apiData.expired_at).replace('T', ' ').replace('.000000Z', ' UTC').replace('Z', ' UTC') : '-';

    let header;
    if (isTrial) {
      header = '\u{1F386} *Akun Trial Edukasi ' + label + ' Berhasil Dibuat!*';
    } else if (isRenew) {
      header = '\u267B\uFE0F *Renew Akun Edukasi ' + label + ' Berhasil!*';
    } else {
      header = '\u2705 *Akun Edukasi ' + label + ' Berhasil Dibuat!*';
    }

    let traffic = '';
    if (isTrial) {
      traffic = '2 GB';
    } else if (apiData.billing_period === 'weekly') {
      traffic = '25 GB';
    } else {
      traffic = '100 GB';
    }

    const lines = [];
    lines.push(header);
    lines.push('');
    lines.push('\u{1F393} *Paket Edukasi ' + label + '*');
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    if (apiData.username) lines.push('\u{1F464} *Username*   : `' + escapeMarkdownV1(apiData.username) + '`');
    if (apiData.password) lines.push('\u{1F511} *Password*   : `' + escapeMarkdownV1(apiData.password) + '`');
    lines.push('\u{1F310} *Server*     : ' + escapeMarkdownV1(serverName));
    lines.push('\u23F1\uFE0F *Periode*    : ' + periodeOrTrial);
    lines.push('\u{1F4E6} *Traffic*    : ' + traffic);
    lines.push('\u{1F4C5} *Expired*    : `' + escapeMarkdownV1(expired) + '`');
    if (!isTrial) {
      lines.push('\u{1F4B0} *Harga*      : ' + formatRupiah(harga));
    }
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    if (apiData.order_id) {
      lines.push('\u{1F194} *Order ID*   : `' + escapeMarkdownV1(apiData.order_id) + '`');
      if (!isTrial) {
        lines.push('_Simpan Order ID untuk renew nanti._');
      }
    }

    // API kasih `output` (config detail). Kalau ada, attach apa adanya di code-block.
    if (apiData.output && typeof apiData.output === 'string' && apiData.output.trim()) {
      lines.push('');
      lines.push('\u{1F517} *Detail Konfigurasi*:');
      lines.push('```');
      lines.push(String(apiData.output).slice(0, 3500));
      lines.push('```');
    }

    lines.push('');
    lines.push('_Powered by Paket Edukasi_');

    return lines.join('\n');
  }

  return {
    // products
    getProducts,
    clearProductsCache,
    listServers,
    findServer,
    findProduct,
    listSupportedServices,
    getTrialInfo,
    // pricing
    calculateUserPrice,
    // operations
    orderEdukasi,
    trialEdukasi,
    renewEdukasi,
    // db helpers (dipakai handler)
    getEdukasiTrialUsageToday,
    getEdukasiAccountById,
    // formatting
    formatAccountMessage,
    // constants
    SUPPORTED_SERVICES,
    SERVICE_LABELS,
    TYPE_FROM_SERVICE,
  };
}

module.exports = {
  createEdukasiService,
  SUPPORTED_SERVICES,
  SERVICE_LABELS,
  TYPE_FROM_SERVICE,
};
