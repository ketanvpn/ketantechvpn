// modules/edukasi-handlers.js
// Telegram handler untuk menu Paket Edukasi (user-facing).
// Register-kan callback action: edukasi_menu, edukasi_srv:<code>,
// edukasi_svc:<code>:<service>, edukasi_period:<code>:<service>:<period>,
// edukasi_confirm, edukasi_renew_ask:<accountId>, edukasi_renew_do:<accountId>:<period>.
//
// Pakai userState bersama (yang sama dengan menu existing) untuk multi-step input.

function formatRupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

function buildPeriodLabel(p) {
  if (p === 'weekly') return 'Mingguan';
  if (p === 'monthly') return 'Bulanan';
  if (p === 'trial') return 'Trial';
  return String(p || '-');
}

// Telegram callback_data dibatasi 64 bytes (UTF-8). Server code vpnbiz pakai
// UUID 36-char, jadi callback `edukasi_svc:<uuid>:bundle_shadowsocks` (67 byte)
// langsung melewati batas itu. Solusinya: kita pakai short-id mapping in-memory:
//   server UUID -> 8-char hex (sha1 first 8)
//   service -> 1 char (v/l/t/s)
// Mapping disimpan di Map yang refresh tiap kali listServers dipanggil.
const crypto = require('crypto');

const SERVICE_TO_SHORT = {
  bundle_vmess: 'v',
  bundle_vless: 'l',
  bundle_trojan: 't',
  bundle_shadowsocks: 's',
};
const SHORT_TO_SERVICE = {
  v: 'bundle_vmess',
  l: 'bundle_vless',
  t: 'bundle_trojan',
  s: 'bundle_shadowsocks',
};

function shortServerId(code) {
  return crypto.createHash('sha1').update(String(code)).digest('hex').slice(0, 8);
}

// Cache mapping server short id -> full code untuk session bot ini.
// Refresh setiap call listServers (via getProducts cache yg 5 menit).
const __serverShortMap = new Map();

function rememberServer(code) {
  if (!code) return null;
  const sid = shortServerId(code);
  __serverShortMap.set(sid, code);
  return sid;
}
function resolveServerShort(sid) {
  return __serverShortMap.get(String(sid)) || null;
}



// Escape karakter untuk pesan HTML Telegram. Dipakai untuk username, nama
// server, dan label lain yang mungkin punya karakter < > &.
function htmlEscape(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createEdukasiHandlers({
  bot,
  logger,
  edukasiService,
  isResellerId,
  ensurePrivateChat,
  sendCleanMenu,
  userState,
  getPriceConfig,
  getIlmupediaLinks,
  getGroupId,
  isGroupNotifyEnabled,
  getTimeZone,
}) {
  if (!bot) throw new Error('createEdukasiHandlers: bot required');
  if (!logger) throw new Error('createEdukasiHandlers: logger required');
  if (!edukasiService) throw new Error('createEdukasiHandlers: edukasiService required');
  if (typeof isResellerId !== 'function') {
    throw new Error('createEdukasiHandlers: isResellerId harus fungsi');
  }
  if (typeof ensurePrivateChat !== 'function') {
    throw new Error('createEdukasiHandlers: ensurePrivateChat harus fungsi');
  }
  if (typeof sendCleanMenu !== 'function') {
    throw new Error('createEdukasiHandlers: sendCleanMenu harus fungsi');
  }
  if (!userState || typeof userState !== 'object') {
    throw new Error('createEdukasiHandlers: userState required');
  }
  if (typeof getPriceConfig !== 'function') {
    throw new Error('createEdukasiHandlers: getPriceConfig harus fungsi');
  }
  // getIlmupediaLinks opsional. Kalau tidak di-set / return array kosong,
  // tombol "Beli Paket Ilmupedia" otomatis tidak muncul.
  const _getIlpedLinks = typeof getIlmupediaLinks === 'function'
    ? getIlmupediaLinks
    : () => [];

  // Group notification helpers (opsional). Kalau tidak di-wire, notif grup
  // otomatis tidak dikirim - tidak akan crash.
  const _getGroupId = typeof getGroupId === 'function' ? getGroupId : () => '';
  const _isGroupNotifyEnabled = typeof isGroupNotifyEnabled === 'function'
    ? isGroupNotifyEnabled
    : () => false;
  const _getTimeZone = typeof getTimeZone === 'function'
    ? getTimeZone
    : () => 'Asia/Jakarta';

  // Format timestamp ke string lokal sesuai timezone bot.
  function formatGroupDate(ts) {
    try {
      return new Date(ts).toLocaleString('id-ID', {
        timeZone: _getTimeZone() || 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_) {
      return new Date(ts).toISOString();
    }
  }

  // Ambil display name dari ctx.from (untuk notif grup). Prioritas: @username,
  // first_name, fallback "ID:<id>".
  function pickUserDisplay(ctx) {
    const from = ctx.from || {};
    if (from.username) return '@' + from.username;
    if (from.first_name) {
      return from.last_name ? from.first_name + ' ' + from.last_name : from.first_name;
    }
    return 'ID:' + from.id;
  }

  // Kirim notif grup untuk transaksi Akun Direct EDU. Trial sengaja silent
  // supaya grup tidak terisi notif gratisan.
  // kind = 'created' | 'renewed'
  async function sendGroupNotificationEdu(ctx, kind, result) {
    try {
      if (!_isGroupNotifyEnabled()) return;
      const groupId = _getGroupId();
      if (!groupId) return;
      if (!result || !result.apiData) return;
      if (result.isTrial) return; // trial silent

      const apiData = result.apiData;
      const userId = ctx.from && ctx.from.id;
      const userDisplay = pickUserDisplay(ctx);
      const role = isResellerId(userId) ? 'Reseller' : 'Member';

      const SERVICE_LABELS = (edukasiService && edukasiService.SERVICE_LABELS) || {};
      const typeLabel = SERVICE_LABELS[apiData.service]
        || (apiData.service ? String(apiData.service).toUpperCase() : 'VPN');
      const periodLabel = apiData.billing_period === 'weekly' ? 'Mingguan' : 'Bulanan';
      const serverName = (result.server && result.server.name)
        || apiData.server || '-';
      const harga = (result.priceInfo && result.priceInfo.price)
        || apiData.price || 0;

      // Hitung durasi & sisa hari dari expired_at API.
      let durasiText = '-';
      let expiredText = '-';
      try {
        if (apiData.expired_at) {
          const expDate = new Date(apiData.expired_at);
          const tz = _getTimeZone() || 'Asia/Jakarta';
          expiredText = expDate.toLocaleDateString('id-ID', {
            timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          });
          const diffDays = Math.max(
            1,
            Math.round((expDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
          );
          durasiText = diffDays + ' Hari';
        }
      } catch (_) {}

      const headerText = (kind === 'renewed')
        ? '<b>EDU ACCOUNT RENEWED</b>'
        : '<b>EDU ACCOUNT CREATED</b>';

      const emoji = kind === 'renewed' ? '\u267B\uFE0F' : '\uD83C\uDF93';
      const lines = [];
      lines.push('<blockquote>');
      lines.push('<code>━━━━━━━━━━━━━━━━━━━━</code>');
      lines.push(emoji + ' ' + headerText);
      lines.push('<code>━━━━━━━━━━━━━━━━━━━━</code>');
      lines.push('<b>Akun Direct EDU</b>');
      lines.push('<code>');
      lines.push('-> Client  : ' + htmlEscape(userDisplay));
      lines.push('-> Role    : ' + role);
      lines.push('-> User    : ' + htmlEscape(apiData.username || '-'));
      lines.push('-> Type    : ' + typeLabel + ' (' + periodLabel + ')');
      lines.push('-> Server  : ' + htmlEscape(serverName));
      if (Number(harga) > 0) {
        lines.push('-> Harga   : Rp ' + Number(harga).toLocaleString('id-ID'));
      }
      lines.push('-> Durasi  : ' + durasiText);
      lines.push('-> Expired : ' + expiredText);
      if (apiData.order_id) {
        lines.push('-> OrderID : ' + htmlEscape(apiData.order_id));
      }
      lines.push('-> Waktu   : ' + formatGroupDate(Date.now()));
      lines.push('</code>');
      lines.push('<code>━━━━━━━━━━━━━━━━━━━━</code>');
      lines.push('</blockquote>');

      await bot.telegram.sendMessage(groupId, lines.join('\n'), {
        parse_mode: 'HTML',
      });
    } catch (e) {
      // Notif grup tidak boleh ganggu flow utama
      logger.warn('sendGroupNotificationEdu gagal: ' + (e && e.message ? e.message : e));
    }
  }

  // === RENDER FUNCTIONS ===

  // Landing page Akun Direct EDU. Tujuan: bantu user awam paham bahwa untuk
  // pakai layanan ini mereka butuh 2 hal terpisah:
  //   1. Paket Ilmupedia (kuota Telkomsel) -> beli di MyTelkomsel
  //   2. Akun VPN Edukasi -> dibuat oleh bot ini
  // Halaman ini cuma menjelaskan + memberi 2 tombol langkah eksplisit.
  // Tidak hit API vpnbiz (cepat & tidak bikin error kalau API down).
  async function renderMainMenu(ctx) {
    const userId = ctx.from.id;
    const isReseller = !!isResellerId(userId);
    const cfg = getPriceConfig() || {};
    const priceMonthly = isReseller ? Number(cfg.RESELLER_MONTHLY || 0) : Number(cfg.MEMBER_MONTHLY || 0);
    const priceWeekly = isReseller ? Number(cfg.RESELLER_WEEKLY || 0) : Number(cfg.MEMBER_WEEKLY || 0);

    const ilpedLinks = (_getIlpedLinks() || []).filter((l) => l && l.url);
    const hasIlped = ilpedLinks.length > 0;

    const lines = [];
    lines.push('\uD83C\uDF93 *AKUN DIRECT EDU*');
    lines.push('');
    lines.push('Layanan VPN murah memakai jaringan *Paket Ilmupedia* Telkomsel.');
    lines.push('Untuk bisa pakai, kamu butuh *2 hal* yang terpisah:');
    lines.push('');
    lines.push('1\uFE0F\u20E3 *Paket Ilmupedia* (kuota internet dari Telkomsel)');
    lines.push('2\uFE0F\u20E3 *Akun VPN Edukasi* (dibuat di bot ini)');
    lines.push('');
    lines.push('\uD83D\uDCB0 *Harga akun VPN* (' + (isReseller ? 'Reseller' : 'Member') + '):');
    lines.push('\u2022 Bulanan : *' + formatRupiah(priceMonthly) + '* (100 GB)');
    lines.push('\u2022 Mingguan: *' + formatRupiah(priceWeekly) + '* (25 GB)');
    lines.push('\u2022 Trial   : *Gratis* (30 menit, 2 GB)');
    lines.push('');
    lines.push('_Pilih langkah yang mau kamu lakukan:_');

    const keyboard = [];
    if (hasIlped) {
      keyboard.push([{
        text: '\uD83D\uDCF1 Langkah 1 \u2014 Beli Paket Ilmupedia',
        callback_data: 'edukasi_ilped',
      }]);
    }
    keyboard.push([{
      text: '\uD83C\uDF10 Langkah 2 \u2014 Buat Akun VPN Edukasi',
      callback_data: 'edukasi_servers',
    }]);
    keyboard.push([{
      text: '\u2753 Apa Bedanya? Kenapa Butuh 2-2-nya?',
      callback_data: 'edukasi_help_compare',
    }]);
    keyboard.push([{ text: '\uD83D\uDD19 Menu Utama', callback_data: 'send_main_menu' }]);

    await sendCleanMenu(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  // Halaman penjelasan untuk user yang masih bingung.
  async function renderHelpCompare(ctx) {
    const lines = [];
    lines.push('\u2753 *Apa Bedanya?*');
    lines.push('');
    lines.push('Bayangin kayak nonton di bioskop:');
    lines.push('\u2022 *Paket Ilmupedia* = tiket masuk bioskop (dari Telkomsel)');
    lines.push('\u2022 *Akun VPN Edukasi* = filmnya sendiri (dari kami)');
    lines.push('');
    lines.push('Tanpa tiket, kamu nggak bisa masuk ke bioskop.');
    lines.push('Tanpa film, ya nggak ada yang ditonton.');
    lines.push('Jadi *dua-duanya wajib aktif*.');
    lines.push('');
    lines.push('\uD83D\uDD39 *Cara kerjanya:*');
    lines.push('1. Beli Paket *Ilmupedia* di MyTelkomsel (1/5/11/22 GB)');
    lines.push('2. Buat *Akun VPN Edukasi* di sini (Bulanan / Mingguan / Trial)');
    lines.push('3. Pasang konfigurasi VPN ke aplikasi pilihan kamu');
    lines.push('4. Konek \u2014 internet kamu jalan pakai kuota Ilmupedia');
    lines.push('');
    lines.push('\uD83D\uDCA1 Akun trial *30 menit gratis* tersedia kalau kamu mau coba dulu sebelum beli.');

    const keyboard = [
      [{ text: '\uD83D\uDCF1 Beli Paket Ilmupedia', callback_data: 'edukasi_ilped' }],
      [{ text: '\uD83C\uDF10 Buat Akun VPN Edukasi', callback_data: 'edukasi_servers' }],
      [{ text: '\u2B05\uFE0F Kembali', callback_data: 'edukasi_menu' }],
    ];

    await sendCleanMenu(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  // List server VPN. Sebelumnya ini isi default `renderMainMenu`. Sekarang
  // dipanggil khusus saat user klik "Langkah 2 - Buat Akun VPN Edukasi".
  async function renderServerListMenu(ctx) {
    let products;
    try {
      products = await edukasiService.getProducts();
    } catch (err) {
      logger.error('Edukasi: gagal ambil produk:', err.message || err);
      await sendCleanMenu(ctx, '\u274C Gagal ambil daftar server VPN Edukasi.\n\n' +
        '_' + (err.message || 'API tidak merespon') + '_\n\n' +
        'Silakan coba lagi nanti atau hubungi admin.', { parse_mode: 'Markdown' });
      return;
    }

    const servers = edukasiService.listServers(products);
    if (!servers.length) {
      await sendCleanMenu(ctx, '\u26A0\uFE0F Belum ada server VPN Edukasi yang tersedia.', { parse_mode: 'Markdown' });
      return;
    }

    const userId = ctx.from.id;
    const isReseller = !!isResellerId(userId);
    const cfg = getPriceConfig() || {};
    const priceMonthly = isReseller ? Number(cfg.RESELLER_MONTHLY || 0) : Number(cfg.MEMBER_MONTHLY || 0);
    const priceWeekly = isReseller ? Number(cfg.RESELLER_WEEKLY || 0) : Number(cfg.MEMBER_WEEKLY || 0);

    const lines = [];
    lines.push('\uD83C\uDF10 *Pilih Server VPN Edukasi*');
    lines.push('');
    lines.push('\uD83D\uDCB0 Harga kamu (' + (isReseller ? 'Reseller' : 'Member') + '):');
    lines.push('\u2022 Bulanan : *' + formatRupiah(priceMonthly) + '* (100 GB)');
    lines.push('\u2022 Mingguan: *' + formatRupiah(priceWeekly) + '* (25 GB)');
    lines.push('\u2022 Trial   : *Gratis* (30 menit, 2 GB)');
    lines.push('');
    lines.push('Pilih server di bawah:');

    const keyboard = [];
    for (const s of servers) {
      if (!s || !s.code) continue;
      const sid = rememberServer(s.code);
      const slotInfo = s.slot && typeof s.slot.available === 'number'
        ? ' (' + s.slot.available + ' slot)' : '';
      keyboard.push([{
        text: '\uD83C\uDF10 ' + (s.name || s.code) + slotInfo,
        callback_data: 'edukasi_srv:' + sid,
      }]);
    }
    if (keyboard.length === 0) {
      await sendCleanMenu(ctx, '\u26A0\uFE0F Tidak ada server valid yang bisa ditampilkan.\n\nKemungkinan API vpnbiz mengembalikan format yang tidak terduga. Cek `pm2 logs` untuk detail.',
        { parse_mode: 'Markdown' });
      return;
    }
    keyboard.push([{ text: '\u2B05\uFE0F Kembali', callback_data: 'edukasi_menu' }]);
    keyboard.push([{ text: '\uD83D\uDD19 Menu Utama', callback_data: 'send_main_menu' }]);

    await sendCleanMenu(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async function renderServerMenu(ctx, serverCode) {
    let products;
    try {
      products = await edukasiService.getProducts();
    } catch (err) {
      logger.error('Edukasi: gagal ambil produk (server menu):', err.message || err);
      await sendCleanMenu(ctx, '\u274C Gagal ambil produk. Coba lagi.', { parse_mode: 'Markdown' });
      return;
    }
    const server = edukasiService.findServer(products, serverCode);
    if (!server) {
      await sendCleanMenu(ctx, '\u274C Server tidak ditemukan.', { parse_mode: 'Markdown' });
      return;
    }

    const services = edukasiService.listSupportedServices(server);
    if (!services.length) {
      await sendCleanMenu(ctx, '\u26A0\uFE0F Belum ada layanan yang tersedia di server ini.', { parse_mode: 'Markdown' });
      return;
    }

    const slotInfo = server.slot
      ? '\nSlot: ' + (server.slot.used || 0) + '/' + (server.slot.max || '?') + ' (sisa ' + (server.slot.available || 0) + ')'
      : '';

    const lines = [];
    lines.push('\uD83C\uDF10 *Server: ' + server.name + ' (' + server.code + ')*' + slotInfo);
    lines.push('');
    lines.push('Pilih layanan VPN:');

    const sid = rememberServer(server.code);
    const keyboard = [];
    for (const svc of services) {
      const svcShort = SERVICE_TO_SHORT[svc.service];
      if (!svcShort) continue;
      keyboard.push([{
        text: '\u26A1 ' + svc.label,
        callback_data: 'edukasi_svc:' + sid + ':' + svcShort,
      }]);
    }
    keyboard.push([{ text: '\u2B05\uFE0F Pilih Server Lain', callback_data: 'edukasi_servers' }]);
    keyboard.push([{ text: '\uD83D\uDD19 Menu Utama', callback_data: 'send_main_menu' }]);

    await sendCleanMenu(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async function renderServiceMenu(ctx, serverCode, service) {
    let products;
    try {
      products = await edukasiService.getProducts();
    } catch (err) {
      logger.error('Edukasi: gagal ambil produk (service menu):', err.message || err);
      await sendCleanMenu(ctx, '\u274C Gagal ambil produk. Coba lagi.', { parse_mode: 'Markdown' });
      return;
    }
    const server = edukasiService.findServer(products, serverCode);
    if (!server) {
      await sendCleanMenu(ctx, '\u274C Server tidak ditemukan.', { parse_mode: 'Markdown' });
      return;
    }
    const product = edukasiService.findProduct(server, service);
    if (!product) {
      await sendCleanMenu(ctx, '\u274C Produk tidak tersedia.', { parse_mode: 'Markdown' });
      return;
    }

    const userId = ctx.from.id;
    const monthlyPrice = edukasiService.calculateUserPrice(userId, 'monthly').price;
    const weeklyPrice = edukasiService.calculateUserPrice(userId, 'weekly').price;
    const periods = Array.isArray(product.billing_periods) ? product.billing_periods : [];

    const label = (edukasiService.SERVICE_LABELS && edukasiService.SERVICE_LABELS[service]) || product.label || service;

    const lines = [];
    lines.push('\u26A1 *' + label + '* di ' + server.name);
    lines.push('');
    lines.push('Pilih paket:');
    lines.push('');
    if (periods.includes('monthly')) {
      lines.push('\uD83D\uDCC5 *Bulanan*: ' + formatRupiah(monthlyPrice) + ' / 100 GB');
    }
    if (periods.includes('weekly')) {
      lines.push('\uD83D\uDDD3\uFE0F *Mingguan*: ' + formatRupiah(weeklyPrice) + ' / 25 GB');
    }
    lines.push('\uD83C\uDD93 *Trial*: Gratis (30 menit, 2 GB)');

    const sid = rememberServer(server.code);
    const svcShort = SERVICE_TO_SHORT[service] || service;
    const keyboard = [];
    if (periods.includes('monthly')) {
      keyboard.push([{
        text: '\uD83D\uDCC5 Bulanan - ' + formatRupiah(monthlyPrice),
        callback_data: 'edukasi_period:' + sid + ':' + svcShort + ':m',
      }]);
    }
    if (periods.includes('weekly')) {
      keyboard.push([{
        text: '\uD83D\uDDD3\uFE0F Mingguan - ' + formatRupiah(weeklyPrice),
        callback_data: 'edukasi_period:' + sid + ':' + svcShort + ':w',
      }]);
    }
    keyboard.push([{
      text: '\uD83C\uDD93 Trial Gratis (30 menit)',
      callback_data: 'edukasi_period:' + sid + ':' + svcShort + ':t',
    }]);
    keyboard.push([{ text: '\u2B05\uFE0F Layanan Lain', callback_data: 'edukasi_srv:' + sid }]);
    keyboard.push([{ text: '\uD83D\uDD19 Menu Utama', callback_data: 'send_main_menu' }]);

    await sendCleanMenu(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  // === FLOW INPUT (paid order) ===
  // Setelah pilih period (monthly/weekly): minta username, lalu password, lalu konfirmasi.

  async function startUsernameInput(ctx, serverCode, service, period) {
    const chatId = ctx.chat.id;
    userState[chatId] = {
      action: 'edukasi_order',
      serverCode,
      service,
      period,
      step: 'edukasi_ask_username',
      __t: Date.now(),
    };
    const lines = [];
    lines.push('\u270D\uFE0F *Input Akun Direct EDU*');
    lines.push('');
    lines.push('Periode: *' + buildPeriodLabel(period) + '*');
    lines.push('Layanan: *' + ((edukasiService.SERVICE_LABELS && edukasiService.SERVICE_LABELS[service]) || service) + '*');
    lines.push('');
    lines.push('Kirim *username* untuk akun ini.');
    lines.push('Aturan: 3-16 karakter, hanya huruf & angka.');
    lines.push('');
    lines.push('Contoh: `userku01`');
    lines.push('');
    lines.push('_Untuk VMess/VLess/Trojan/Shadowsocks, autentikasi pakai UUID/key (di-generate otomatis oleh server). Tidak perlu password._');

    await sendCleanMenu(ctx, lines.join('\n'), { parse_mode: 'Markdown' });
  }

  async function startTrialConfirm(ctx, serverCode, service) {
    let products;
    try {
      products = await edukasiService.getProducts();
    } catch (err) {
      await sendCleanMenu(ctx, '\u274C Gagal ambil produk.', { parse_mode: 'Markdown' });
      return;
    }
    const server = edukasiService.findServer(products, serverCode);
    if (!server) return sendCleanMenu(ctx, '\u274C Server tidak ditemukan.', { parse_mode: 'Markdown' });

    const used = await edukasiService.getEdukasiTrialUsageToday(ctx.from.id);

    const lines = [];
    lines.push('\uD83C\uDD93 *Konfirmasi Trial Edukasi*');
    lines.push('');
    lines.push('Server : ' + server.name);
    lines.push('Layanan: ' + ((edukasiService.SERVICE_LABELS && edukasiService.SERVICE_LABELS[service]) || service));
    lines.push('Durasi : 30 menit');
    lines.push('Quota  : 2 GB');
    lines.push('Trial dipakai hari ini: ' + used + 'x');
    lines.push('');
    lines.push('Lanjut buat trial?');

    const sid = rememberServer(server.code);
    const svcShort = SERVICE_TO_SHORT[service] || service;
    const keyboard = [
      [{ text: '\u2705 Ya, Buat Trial', callback_data: 'edukasi_trial_do:' + sid + ':' + svcShort }],
      [{ text: '\u274C Batal', callback_data: 'edukasi_svc:' + sid + ':' + svcShort }],
    ];

    await sendCleanMenu(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async function renderConfirmOrder(ctx, state) {
    const userId = ctx.from.id;
    const priceInfo = edukasiService.calculateUserPrice(userId, state.period);
    let products;
    try {
      products = await edukasiService.getProducts();
    } catch (err) {
      await sendCleanMenu(ctx, '\u274C Gagal ambil produk.', { parse_mode: 'Markdown' });
      return;
    }
    const server = edukasiService.findServer(products, state.serverCode);
    const serverName = server ? server.name : state.serverCode;

    const lines = [];
    lines.push('\uD83D\uDED2 *Konfirmasi Pembelian Direct EDU*');
    lines.push('');
    lines.push('Layanan : ' + ((edukasiService.SERVICE_LABELS && edukasiService.SERVICE_LABELS[state.service]) || state.service));
    lines.push('Server  : ' + serverName);
    lines.push('Periode : ' + buildPeriodLabel(state.period));
    lines.push('Username: `' + state.username + '`');
    lines.push('Harga   : *' + formatRupiah(priceInfo.price) + '*');
    lines.push('');
    lines.push('Lanjut bayar dari saldo kamu?');

    const keyboard = [
      [{ text: '\u2705 Bayar Sekarang', callback_data: 'edukasi_confirm' }],
      [{ text: '\u274C Batal', callback_data: 'edukasi_cancel' }],
    ];
    await sendCleanMenu(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  // Kirim pesan follow-up berisi tombol URL link Ilmupedia. Dipanggil setelah
  // akun edukasi berhasil dibuat (paid/trial), supaya user tahu di mana beli
  // paket Ilmupedia Telkomsel yang jadi syarat akun bisa dipakai.
  async function sendIlmupediaFollowup(ctx) {
    try {
      const links = (_getIlpedLinks() || []).filter((l) => l && l.url);
      if (links.length === 0) return;

      const lines = [];
      lines.push('\uD83D\uDCF1 *Belum punya Paket Ilmupedia?*');
      lines.push('');
      lines.push('Akun di atas baru bisa dipakai kalau nomor Telkomsel kamu aktif paket *Ilmupedia*.');
      lines.push('Pilih ukuran paket sesuai kebutuhan:');

      const keyboard = links.map((l) => ([{
        text: '\uD83D\uDED2 ' + l.label,
        url: l.url,
      }]));

      await ctx.reply(lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (e) {
      // Jangan ganggu flow utama kalau follow-up gagal — cukup log warning.
      logger.warn('sendIlmupediaFollowup gagal: ' + (e && e.message ? e.message : e));
    }
  }

  async function executeOrder(ctx, state) {
    const userId = ctx.from.id;
    try {
      await ctx.reply('\u23F3 Memproses pembuatan akun edukasi, mohon tunggu...', { parse_mode: 'Markdown' });
      const result = await edukasiService.orderEdukasi({
        userId,
        serverCode: state.serverCode,
        service: state.service,
        username: state.username,
        password: state.password,
        billingPeriod: state.period,
        duration: 1,
      });
      const msg = edukasiService.formatAccountMessage(result);
      await ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
      await sendIlmupediaFollowup(ctx);
      await sendGroupNotificationEdu(ctx, 'created', result);
      logger.info('Edukasi order sukses untuk user ' + userId
        + ' service=' + state.service + ' period=' + state.period
        + ' order_id=' + (result.apiData && result.apiData.order_id));
    } catch (err) {
      const refunded = !!err.refunded;
      const msg = '\u274C *Gagal membuat akun edukasi.*\n\n'
        + '_' + (err.message || 'Unknown error') + '_'
        + (refunded ? '\n\n\uD83D\uDCB0 Saldo kamu sudah dikembalikan.' : '');
      await ctx.reply(msg, { parse_mode: 'Markdown' });
      logger.error('Edukasi order gagal user=' + userId + ' err=' + (err.message || err));
    }
  }

  async function executeTrial(ctx, serverCode, service) {
    const userId = ctx.from.id;
    try {
      await ctx.reply('\u23F3 Memproses trial edukasi, mohon tunggu...', { parse_mode: 'Markdown' });
      const result = await edukasiService.trialEdukasi({
        userId,
        serverCode,
        service,
      });
      const msg = edukasiService.formatAccountMessage(result);
      await ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
      await sendIlmupediaFollowup(ctx);
      // Trial silent untuk grup (sengaja tidak notif).
      logger.info('Edukasi trial sukses user=' + userId + ' service=' + service);
    } catch (err) {
      await ctx.reply('\u274C *Gagal membuat trial edukasi.*\n\n_' + (err.message || 'Unknown error') + '_',
        { parse_mode: 'Markdown' });
      logger.error('Edukasi trial gagal user=' + userId + ' err=' + (err.message || err));
    }
  }

  // === RENEW FLOW (dipanggil dari menu Akun Saya via callback) ===

  async function renderRenewMenu(ctx, accountId) {
    const userId = ctx.from.id;
    const account = await edukasiService.getEdukasiAccountById(accountId, userId);
    if (!account) {
      await sendCleanMenu(ctx, '\u274C Akun edukasi tidak ditemukan.', { parse_mode: 'Markdown' });
      return;
    }
    if (account.billing_period === 'trial') {
      await sendCleanMenu(ctx, '\u26A0\uFE0F Akun trial tidak bisa diperpanjang. Silakan beli paket berbayar.', { parse_mode: 'Markdown' });
      return;
    }

    const monthlyPrice = edukasiService.calculateUserPrice(userId, 'monthly').price;
    const weeklyPrice = edukasiService.calculateUserPrice(userId, 'weekly').price;

    const lines = [];
    lines.push('\u267B\uFE0F *Renew Akun Edukasi*');
    lines.push('');
    lines.push('Username  : `' + account.username + '`');
    lines.push('Tipe      : ' + account.type);
    lines.push('Order ID  : `' + account.external_order_id + '`');
    lines.push('');
    lines.push('Pilih periode renew:');

    const keyboard = [
      [{ text: '\uD83D\uDCC5 Bulanan - ' + formatRupiah(monthlyPrice), callback_data: 'edukasi_renew_do:' + accountId + ':monthly' }],
      [{ text: '\uD83D\uDDD3\uFE0F Mingguan - ' + formatRupiah(weeklyPrice), callback_data: 'edukasi_renew_do:' + accountId + ':weekly' }],
      [{ text: '\u274C Batal', callback_data: 'my_accounts' }],
    ];

    await sendCleanMenu(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async function executeRenew(ctx, accountId, period) {
    const userId = ctx.from.id;
    try {
      await ctx.reply('\u23F3 Memproses renew akun edukasi...', { parse_mode: 'Markdown' });
      const result = await edukasiService.renewEdukasi({
        userId,
        accountId,
        billingPeriod: period,
        duration: 1,
      });
      const msg = edukasiService.formatAccountMessage(result);
      await ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
      await sendIlmupediaFollowup(ctx);
      await sendGroupNotificationEdu(ctx, 'renewed', result);
      logger.info('Edukasi renew sukses user=' + userId + ' accountId=' + accountId + ' period=' + period);
    } catch (err) {
      const refunded = !!err.refunded;
      const msg = '\u274C *Gagal renew akun edukasi.*\n\n'
        + '_' + (err.message || 'Unknown error') + '_'
        + (refunded ? '\n\n\uD83D\uDCB0 Saldo kamu sudah dikembalikan.' : '');
      await ctx.reply(msg, { parse_mode: 'Markdown' });
      logger.error('Edukasi renew gagal user=' + userId + ' err=' + (err.message || err));
    }
  }

  // === TEXT HANDLER (untuk multi-step input username/password) ===
  // Dipanggil dari app.js bot.on('text') existing.
  // Return true kalau text sudah dikonsumsi oleh handler edukasi.

  async function handleTextStep(ctx) {
    if (!ctx.from || !ctx.chat) return false;
    const chatId = ctx.chat.id;
    const state = userState[chatId];
    if (!state || state.action !== 'edukasi_order') return false;

    const text = (ctx.message && ctx.message.text || '').trim();

    if (state.step === 'edukasi_ask_username') {
      if (!/^[A-Za-z0-9]{3,16}$/.test(text)) {
        await ctx.reply('\u274C Username tidak valid. Gunakan 3-16 karakter, hanya huruf & angka. Coba lagi.');
        return true;
      }
      state.username = text;
      // Untuk VMess/VLess/Trojan/Shadowsocks, password TIDAK diperlukan
      // (server pakai UUID/key auto-generate). Langsung skip ke konfirmasi.
      state.password = '';
      state.step = 'edukasi_confirm';
      state.__t = Date.now();
      await renderConfirmOrder(ctx, state);
      return true;
    }

    return false;
  }

  // === REGISTER HANDLER ===

  // Wrapper supaya semua bot.action handler tidak silent kalau throw error.
  // Setiap error akan di-log + dikirim ke user, jadi nggak ada "klik tapi
  // tidak terjadi apa-apa" lagi.
  function safeAction(label, fn) {
    return async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        if (!ensurePrivateChat(ctx)) return;
        await fn(ctx);
      } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        logger.error('Edukasi handler [' + label + '] error: ' + detail);
        try {
          await ctx.reply(
            '\u274C Terjadi kesalahan saat memproses menu Akun Direct EDU.\n\n' +
            '_' + detail + '_\n\n' +
            'Silakan coba lagi, atau hubungi admin.',
            { parse_mode: 'Markdown' }
          );
        } catch (_) {}
      }
    };
  }

  // Helper: kalau short-id tidak ada di map (mis. bot baru restart, user
  // klik tombol lama), refresh produk dulu supaya map terisi.
  async function ensureShortIdResolved(sid) {
    let full = resolveServerShort(sid);
    if (full) return full;
    try {
      const products = await edukasiService.getProducts({ force: true });
      const servers = edukasiService.listServers(products);
      for (const s of servers) {
        if (s && s.code) rememberServer(s.code);
      }
    } catch (_) {}
    return resolveServerShort(sid);
  }

  // === RENDER MENU ILMUPEDIA (Opsi A) ===
  // Tampilkan list paket Ilmupedia dengan tombol URL langsung ke Telkomsel.
  async function renderIlmupediaMenu(ctx) {
    const links = (_getIlpedLinks() || []).filter((l) => l && l.url);
    if (links.length === 0) {
      await sendCleanMenu(ctx, '\u26A0\uFE0F Link paket Ilmupedia belum di-set oleh admin.', { parse_mode: 'Markdown' });
      return;
    }

    const lines = [];
    lines.push('\uD83D\uDCF1 *Beli Paket Ilmupedia (Telkomsel)*');
    lines.push('');
    lines.push('Akun Direct EDU butuh *Paket Ilmupedia* Telkomsel aktif di nomor kamu.');
    lines.push('Tap tombol di bawah untuk beli paket sesuai kebutuhan:');
    lines.push('');
    lines.push('_Tombol akan membuka aplikasi MyTelkomsel (atau in-app browser) untuk pembelian._');

    const keyboard = links.map((l) => ([{
      text: '\uD83D\uDED2 ' + l.label,
      url: l.url,
    }]));
    keyboard.push([{ text: '\u2B05\uFE0F Kembali', callback_data: 'edukasi_menu' }]);
    keyboard.push([{ text: '\uD83D\uDD19 Menu Utama', callback_data: 'send_main_menu' }]);

    await sendCleanMenu(ctx, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  function register() {
    bot.action('edukasi_menu', safeAction('edukasi_menu', async (ctx) => {
      await renderMainMenu(ctx);
    }));

    bot.action('edukasi_ilped', safeAction('edukasi_ilped', async (ctx) => {
      await renderIlmupediaMenu(ctx);
    }));

    bot.action('edukasi_servers', safeAction('edukasi_servers', async (ctx) => {
      await renderServerListMenu(ctx);
    }));

    bot.action('edukasi_help_compare', safeAction('edukasi_help_compare', async (ctx) => {
      await renderHelpCompare(ctx);
    }));

    bot.action(/^edukasi_srv:([A-Za-z0-9_-]+)$/, safeAction('edukasi_srv', async (ctx) => {
      const sid = ctx.match[1];
      const code = await ensureShortIdResolved(sid);
      if (!code) {
        await ctx.reply('\u26A0\uFE0F Sesi tombol kadaluarsa. Silakan buka ulang menu Akun Direct EDU.');
        return;
      }
      logger.info('Edukasi user ' + ctx.from.id + ' pilih server: ' + sid + ' (' + code + ')');
      await renderServerMenu(ctx, code);
    }));

    bot.action(/^edukasi_svc:([A-Za-z0-9_-]+):([a-z])$/, safeAction('edukasi_svc', async (ctx) => {
      const sid = ctx.match[1];
      const svcShort = ctx.match[2];
      const code = await ensureShortIdResolved(sid);
      const service = SHORT_TO_SERVICE[svcShort];
      if (!code || !service) {
        await ctx.reply('\u26A0\uFE0F Sesi tombol kadaluarsa. Silakan buka ulang menu Akun Direct EDU.');
        return;
      }
      logger.info('Edukasi user ' + ctx.from.id + ' pilih layanan: ' + sid + '/' + service);
      await renderServiceMenu(ctx, code, service);
    }));

    bot.action(/^edukasi_period:([A-Za-z0-9_-]+):([a-z]):(m|w|t)$/, safeAction('edukasi_period', async (ctx) => {
      const sid = ctx.match[1];
      const svcShort = ctx.match[2];
      const periodShort = ctx.match[3];
      const code = await ensureShortIdResolved(sid);
      const service = SHORT_TO_SERVICE[svcShort];
      const period = periodShort === 'm' ? 'monthly' : (periodShort === 'w' ? 'weekly' : 'trial');
      if (!code || !service) {
        await ctx.reply('\u26A0\uFE0F Sesi tombol kadaluarsa. Silakan buka ulang menu Akun Direct EDU.');
        return;
      }
      logger.info('Edukasi user ' + ctx.from.id + ' pilih period: ' + sid + '/' + service + '/' + period);

      if (period === 'trial') {
        await startTrialConfirm(ctx, code, service);
        return;
      }
      const chatId = ctx.chat.id;
      delete userState[chatId];
      await startUsernameInput(ctx, code, service, period);
    }));

    bot.action(/^edukasi_trial_do:([A-Za-z0-9_-]+):([a-z])$/, safeAction('edukasi_trial_do', async (ctx) => {
      const sid = ctx.match[1];
      const svcShort = ctx.match[2];
      const code = await ensureShortIdResolved(sid);
      const service = SHORT_TO_SERVICE[svcShort];
      if (!code || !service) {
        await ctx.reply('\u26A0\uFE0F Sesi tombol kadaluarsa. Silakan buka ulang menu Akun Direct EDU.');
        return;
      }
      await executeTrial(ctx, code, service);
    }));

    bot.action('edukasi_confirm', safeAction('edukasi_confirm', async (ctx) => {
      const chatId = ctx.chat.id;
      const state = userState[chatId];
      if (!state || state.action !== 'edukasi_order' || state.step !== 'edukasi_confirm') {
        await ctx.reply('\u26A0\uFE0F Sesi pembelian sudah tidak aktif. Silakan ulang dari menu Paket Edukasi.');
        return;
      }
      delete userState[chatId];
      await executeOrder(ctx, state);
    }));

    bot.action('edukasi_cancel', async (ctx) => {
      await ctx.answerCbQuery('Dibatalkan').catch(() => {});
      const chatId = ctx.chat.id;
      delete userState[chatId];
      await ctx.reply('\u274C Pembelian dibatalkan.');
    });

    bot.action(/^edukasi_renew_ask:(\d+)$/, safeAction('edukasi_renew_ask', async (ctx) => {
      const accountId = parseInt(ctx.match[1], 10);
      await renderRenewMenu(ctx, accountId);
    }));

    bot.action(/^edukasi_renew_do:(\d+):(monthly|weekly)$/, safeAction('edukasi_renew_do', async (ctx) => {
      const accountId = parseInt(ctx.match[1], 10);
      const period = ctx.match[2];
      await executeRenew(ctx, accountId, period);
    }));
  }

  return {
    register,
    handleTextStep,
    renderMainMenu,
  };
}

module.exports = { createEdukasiHandlers };
