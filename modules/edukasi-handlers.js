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

function createEdukasiHandlers({
  bot,
  logger,
  edukasiService,
  isResellerId,
  ensurePrivateChat,
  sendCleanMenu,
  userState,
  getPriceConfig,
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

  // === RENDER FUNCTIONS ===

  async function renderMainMenu(ctx) {
    let products;
    try {
      products = await edukasiService.getProducts();
    } catch (err) {
      logger.error('Edukasi: gagal ambil produk:', err.message || err);
      await sendCleanMenu(ctx, '\u274C Gagal ambil daftar paket edukasi.\n\n' +
        '_' + (err.message || 'API tidak merespon') + '_\n\n' +
        'Silakan coba lagi nanti atau hubungi admin.', { parse_mode: 'Markdown' });
      return;
    }

    const servers = edukasiService.listServers(products);
    if (!servers.length) {
      await sendCleanMenu(ctx, '\u26A0\uFE0F Belum ada server yang tersedia untuk Paket Edukasi.', { parse_mode: 'Markdown' });
      return;
    }

    const userId = ctx.from.id;
    const isReseller = !!isResellerId(userId);
    const cfg = getPriceConfig() || {};
    const priceMonthly = isReseller ? Number(cfg.RESELLER_MONTHLY || 0) : Number(cfg.MEMBER_MONTHLY || 0);
    const priceWeekly = isReseller ? Number(cfg.RESELLER_WEEKLY || 0) : Number(cfg.MEMBER_WEEKLY || 0);

    const lines = [];
    lines.push('\uD83C\uDF93 *PAKET EDUKASI*');
    lines.push('');
    lines.push('Layanan VPN murah meriah dari provider kami.');
    lines.push('Cocok untuk belajar, browsing, & streaming ringan.');
    lines.push('');
    lines.push('\uD83D\uDCB0 *Harga kamu* (' + (isReseller ? 'Reseller' : 'Member') + '):');
    lines.push('\u2022 Bulanan : *' + formatRupiah(priceMonthly) + '* (100 GB)');
    lines.push('\u2022 Mingguan: *' + formatRupiah(priceWeekly) + '* (25 GB)');
    lines.push('\u2022 Trial   : *Gratis* (30 menit, 2 GB)');
    lines.push('');
    lines.push('Pilih server di bawah:');

    const keyboard = [];
    for (const s of servers) {
      const slotInfo = s.slot && typeof s.slot.available === 'number'
        ? ' (' + s.slot.available + ' slot)' : '';
      keyboard.push([{
        text: '\uD83C\uDF10 ' + s.name + slotInfo,
        callback_data: 'edukasi_srv:' + s.code,
      }]);
    }
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

    const keyboard = [];
    for (const svc of services) {
      keyboard.push([{
        text: '\u26A1 ' + svc.label,
        callback_data: 'edukasi_svc:' + server.code + ':' + svc.service,
      }]);
    }
    keyboard.push([{ text: '\u2B05\uFE0F Pilih Server Lain', callback_data: 'edukasi_menu' }]);
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

    const keyboard = [];
    if (periods.includes('monthly')) {
      keyboard.push([{
        text: '\uD83D\uDCC5 Bulanan - ' + formatRupiah(monthlyPrice),
        callback_data: 'edukasi_period:' + serverCode + ':' + service + ':monthly',
      }]);
    }
    if (periods.includes('weekly')) {
      keyboard.push([{
        text: '\uD83D\uDDD3\uFE0F Mingguan - ' + formatRupiah(weeklyPrice),
        callback_data: 'edukasi_period:' + serverCode + ':' + service + ':weekly',
      }]);
    }
    keyboard.push([{
      text: '\uD83C\uDD93 Trial Gratis (30 menit)',
      callback_data: 'edukasi_period:' + serverCode + ':' + service + ':trial',
    }]);
    keyboard.push([{ text: '\u2B05\uFE0F Layanan Lain', callback_data: 'edukasi_srv:' + serverCode }]);
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
    lines.push('\u270D\uFE0F *Input Akun Edukasi*');
    lines.push('');
    lines.push('Periode: *' + buildPeriodLabel(period) + '*');
    lines.push('Layanan: *' + ((edukasiService.SERVICE_LABELS && edukasiService.SERVICE_LABELS[service]) || service) + '*');
    lines.push('');
    lines.push('Kirim *username* untuk akun ini.');
    lines.push('Aturan: 3-16 karakter, hanya huruf & angka.');
    lines.push('');
    lines.push('Contoh: `userku01`');

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

    const keyboard = [
      [{ text: '\u2705 Ya, Buat Trial', callback_data: 'edukasi_trial_do:' + serverCode + ':' + service }],
      [{ text: '\u274C Batal', callback_data: 'edukasi_svc:' + serverCode + ':' + service }],
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
    lines.push('\uD83D\uDED2 *Konfirmasi Pembelian Edukasi*');
    lines.push('');
    lines.push('Layanan : ' + ((edukasiService.SERVICE_LABELS && edukasiService.SERVICE_LABELS[state.service]) || state.service));
    lines.push('Server  : ' + serverName);
    lines.push('Periode : ' + buildPeriodLabel(state.period));
    lines.push('Username: `' + state.username + '`');
    lines.push('Password: `' + state.password + '`');
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
      state.step = 'edukasi_ask_password';
      state.__t = Date.now();
      await ctx.reply('\uD83D\uDD11 Sekarang kirim *password* (3-32 karakter: huruf, angka, dan . _ ! @ # -).',
        { parse_mode: 'Markdown' });
      return true;
    }

    if (state.step === 'edukasi_ask_password') {
      if (!/^[A-Za-z0-9._!@#\-]{3,32}$/.test(text)) {
        await ctx.reply('\u274C Password tidak valid. Gunakan 3-32 karakter (huruf, angka, dan . _ ! @ # -). Coba lagi.');
        return true;
      }
      state.password = text;
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
            '\u274C Terjadi kesalahan saat memproses menu Paket Edukasi.\n\n' +
            '_' + detail + '_\n\n' +
            'Silakan coba lagi, atau hubungi admin.',
            { parse_mode: 'Markdown' }
          );
        } catch (_) {}
      }
    };
  }

  function register() {
    bot.action('edukasi_menu', safeAction('edukasi_menu', async (ctx) => {
      await renderMainMenu(ctx);
    }));

    bot.action(/^edukasi_srv:([A-Za-z0-9_-]+)$/, safeAction('edukasi_srv', async (ctx) => {
      const code = ctx.match[1];
      logger.info('Edukasi user ' + ctx.from.id + ' pilih server: ' + code);
      await renderServerMenu(ctx, code);
    }));

    bot.action(/^edukasi_svc:([A-Za-z0-9_-]+):([A-Za-z0-9_]+)$/, safeAction('edukasi_svc', async (ctx) => {
      const code = ctx.match[1];
      const service = ctx.match[2];
      logger.info('Edukasi user ' + ctx.from.id + ' pilih layanan: ' + code + '/' + service);
      await renderServiceMenu(ctx, code, service);
    }));

    bot.action(/^edukasi_period:([A-Za-z0-9_-]+):([A-Za-z0-9_]+):(monthly|weekly|trial)$/, safeAction('edukasi_period', async (ctx) => {
      const code = ctx.match[1];
      const service = ctx.match[2];
      const period = ctx.match[3];
      logger.info('Edukasi user ' + ctx.from.id + ' pilih period: ' + code + '/' + service + '/' + period);

      if (period === 'trial') {
        await startTrialConfirm(ctx, code, service);
        return;
      }
      const chatId = ctx.chat.id;
      delete userState[chatId];
      await startUsernameInput(ctx, code, service, period);
    }));

    bot.action(/^edukasi_trial_do:([A-Za-z0-9_-]+):([A-Za-z0-9_]+)$/, safeAction('edukasi_trial_do', async (ctx) => {
      const code = ctx.match[1];
      const service = ctx.match[2];
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
