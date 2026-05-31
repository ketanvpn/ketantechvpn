// modules/user-dashboard.js
// User-facing dashboard/menu helpers: saldo, renew shortcut, transaction history,
// guide, and public server status. Kept separate from app.js so the main bot
// bootstrap stays smaller and safer to maintain.

function createUserDashboardHandlers({
  bot,
  db,
  logger,
  ensurePrivateChat,
  sendCleanMenu,
  htmlEscape,
  getUserSaldo,
  getUserLinkInfo,
  timeZone,
}) {
  if (!bot) throw new Error('createUserDashboardHandlers: bot required');
  if (!db) throw new Error('createUserDashboardHandlers: db required');
  if (!logger) throw new Error('createUserDashboardHandlers: logger required');
  if (typeof ensurePrivateChat !== 'function') throw new Error('createUserDashboardHandlers: ensurePrivateChat required');
  if (typeof sendCleanMenu !== 'function') throw new Error('createUserDashboardHandlers: sendCleanMenu required');
  if (typeof htmlEscape !== 'function') throw new Error('createUserDashboardHandlers: htmlEscape required');
  if (typeof getUserSaldo !== 'function') throw new Error('createUserDashboardHandlers: getUserSaldo required');
  if (typeof getUserLinkInfo !== 'function') throw new Error('createUserDashboardHandlers: getUserLinkInfo required');

  const TIME_ZONE = timeZone || 'Asia/Jakarta';

  function formatUserMenuDateTime(ts) {
    if (!ts) return '-';
    const n = Number(ts);
    const d = Number.isFinite(n) && n > 0 ? new Date(n) : new Date(ts);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('id-ID', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function paymentStatusLabel(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'paid' || s === 'success' || s === 'completed') return '✅ PAID';
    if (s === 'pending') return '⏳ PENDING';
    if (s === 'expired') return '⏰ EXPIRED';
    if (s === 'failed' || s === 'cancelled') return '❌ FAILED';
    return status ? htmlEscape(String(status).toUpperCase()) : '-';
  }

  function transactionTypeLabel(type) {
    const t = String(type || '').toLowerCase();
    if (t.includes('topup')) return '💳 TopUp Saldo';
    if (t.includes('bonus')) return '🎁 Bonus TopUp';
    if (t.includes('refund')) return '↩️ Refund';
    if (
      t.includes('create') ||
      t.includes('trial') ||
      t.includes('renew') ||
      t.includes('ssh') ||
      t.includes('vmess') ||
      t.includes('vless') ||
      t.includes('trojan') ||
      t.includes('shadowsocks')
    ) {
      return '🛍️ Transaksi Akun';
    }
    return type ? htmlEscape(String(type)) : 'Transaksi';
  }

  async function showUserBalanceMenu(ctx) {
    try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
    if (!ensurePrivateChat(ctx)) return;

    const userId = ctx.from && ctx.from.id;
    if (!userId) return;

    let saldo = 0;
    let saldoNote = '';
    try {
      saldo = await getUserSaldo(db, userId);
      const linkInfo = await getUserLinkInfo(userId);
      if (linkInfo && linkInfo.web_user_id) saldoNote = 'Saldo kamu tersinkron dengan akun web.';
    } catch (e) {
      logger.error('Gagal membaca saldo user:', e.message || e);
      return sendCleanMenu(ctx, '❌ Gagal membaca saldo. Silakan coba lagi.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }]] },
      });
    }

    const text =
      '💰 <b>SALDO KAMU</b>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      `Saldo saat ini: <b>Rp ${Number(saldo || 0).toLocaleString('id-ID')}</b>\n` +
      (saldoNote ? `\n<i>${htmlEscape(saldoNote)}</i>\n` : '\n') +
      'Saldo ini bisa dipakai untuk beli akun, perpanjang akun, dan paket EDU/Ilmupedia jika tersedia.';

    return sendCleanMenu(ctx, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 TopUp Saldo QRIS', callback_data: 'topupqris_btn' }],
          [{ text: '🧾 Riwayat Transaksi', callback_data: 'transaction_history:0' }],
          [{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }],
        ],
      },
    });
  }

  async function showRenewMenu(ctx) {
    try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
    if (!ensurePrivateChat(ctx)) return;

    const text =
      '♻️ <b>PERPANJANG AKUN</b>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      'Untuk perpanjang akun, buka <b>📂 Akun Saya</b>, pilih akun yang mau diperpanjang, lalu tekan <b>♻️ Perpanjang Akun</b>.\n\n' +
      'Cara ini lebih aman karena bot langsung memakai data akun yang benar: username, tipe akun, dan server.';

    return sendCleanMenu(ctx, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📂 Buka Akun Saya', callback_data: 'my_accounts' }],
          [{ text: '💰 Cek Saldo', callback_data: 'user_balance' }, { text: '💳 TopUp', callback_data: 'topupqris_btn' }],
          [{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }],
        ],
      },
    });
  }

  async function showTransactionHistoryPage(ctx, page = 0) {
    try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
    if (!ensurePrivateChat(ctx)) return;

    const userId = ctx.from && ctx.from.id;
    if (!userId) return;

    const PAGE_SIZE = 5;
    const currentPage = Math.max(0, Number(page) || 0);

    try {
      const total = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) AS count FROM qris_payments WHERE user_id = ?', [userId], (err, row) => {
          if (err) {
            logger.error('Gagal hitung riwayat qris_payments:', err.message);
            return resolve(0);
          }
          resolve(Number(row && row.count ? row.count : 0));
        });
      });

      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const safePage = Math.min(currentPage, totalPages - 1);
      const offset = safePage * PAGE_SIZE;

      const payments = await new Promise((resolve) => {
        db.all(
          `SELECT invoice_id, amount, base_amount, unique_suffix, status, created_at, paid_at
           FROM qris_payments
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
          [userId, PAGE_SIZE, offset],
          (err, rows) => {
            if (err) {
              logger.error('Gagal ambil riwayat qris_payments:', err.message);
              return resolve([]);
            }
            resolve(rows || []);
          }
        );
      });

      const recentLedger = await new Promise((resolve) => {
        db.all(
          `SELECT amount, type, reference_id, timestamp
           FROM transactions
           WHERE user_id = ?
           ORDER BY timestamp DESC
           LIMIT 3`,
          [userId],
          (err, rows) => {
            if (err) {
              logger.warn('Gagal ambil ringkasan transactions: ' + err.message);
              return resolve([]);
            }
            resolve(rows || []);
          }
        );
      });

      const lines = [];
      lines.push('🧾 <b>RIWAYAT TRANSAKSI</b>');
      lines.push('<i>Fokus utama: TopUp QRIS otomatis. Untuk riwayat akun, buka Statistik & Riwayat Akun.</i>');
      lines.push('');
      lines.push(`<code>TopUp QRIS (halaman ${safePage + 1} dari ${totalPages})</code>`);

      if (!payments.length) {
        lines.push('Belum ada transaksi QRIS yang tercatat.');
      } else {
        payments.forEach((row, idx) => {
          const no = offset + idx + 1;
          const nominal = Number(row.base_amount || row.amount || 0);
          const billed = Number(row.amount || 0);
          const suffix = Number(row.unique_suffix || 0);
          lines.push(
            `#${no} ${paymentStatusLabel(row.status)}\n` +
            `   Invoice : <code>${htmlEscape(row.invoice_id || '-')}</code>\n` +
            `   TopUp   : <b>Rp ${nominal.toLocaleString('id-ID')}</b>\n` +
            `   Dibayar : Rp ${billed.toLocaleString('id-ID')}${suffix ? ` (unik +${suffix})` : ''}\n` +
            `   Dibuat  : ${formatUserMenuDateTime(row.created_at)}\n` +
            `   Paid    : ${formatUserMenuDateTime(row.paid_at)}`
          );
        });
      }

      lines.push('');
      lines.push('<code>Aktivitas saldo terakhir</code>');
      if (!recentLedger.length) {
        lines.push('Belum ada aktivitas saldo tambahan.');
      } else {
        recentLedger.forEach((row) => {
          const amount = Number(row.amount || 0);
          lines.push(
            `• ${transactionTypeLabel(row.type)}: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n` +
            `  Ref: <code>${htmlEscape(row.reference_id || '-')}</code>\n` +
            `  Waktu: ${formatUserMenuDateTime(row.timestamp)}`
          );
        });
      }

      const nav = [];
      if (safePage > 0) nav.push({ text: '⬅️ Sebelumnya', callback_data: `transaction_history:${safePage - 1}` });
      if (safePage < totalPages - 1) nav.push({ text: 'Selanjutnya ➡️', callback_data: `transaction_history:${safePage + 1}` });

      const keyboard = [];
      if (nav.length) keyboard.push(nav);
      keyboard.push([{ text: '💳 TopUp Saldo QRIS', callback_data: 'topupqris_btn' }]);
      keyboard.push([{ text: '📈 Riwayat Akun', callback_data: 'my_stats:0' }]);
      keyboard.push([{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }]);

      return sendCleanMenu(ctx, lines.join('\n'), {
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (e) {
      logger.error('Gagal menampilkan riwayat transaksi:', e.message || e);
      return sendCleanMenu(ctx, '❌ Gagal menampilkan riwayat transaksi. Silakan coba lagi.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }]] },
      });
    }
  }

  async function showVpnGuide(ctx) {
    try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
    if (!ensurePrivateChat(ctx)) return;

    const text =
      '📘 <b>PANDUAN PAKAI VPN</b>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '<b>1. Setelah akun dibuat</b>\n' +
      '• Salin config/link yang dikirim bot.\n' +
      '• Import ke aplikasi VPN sesuai tipe akun.\n\n' +
      '<b>2. Aplikasi yang umum dipakai</b>\n' +
      '• SSH/OpenVPN: HTTP Custom, NapsternetV, v2rayNG sesuai config.\n' +
      '• VMess/VLess/Trojan/SS: v2rayNG, NekoBox, Shadowrocket/Streisand di iPhone.\n\n' +
      '<b>3. Kalau tidak konek</b>\n' +
      '• Cek masa aktif akun di <b>📂 Akun Saya</b>.\n' +
      '• Coba mode pesawat 10 detik lalu konek ulang.\n' +
      '• Coba server/protokol lain kalau tersedia.\n' +
      '• Sertakan username, tipe akun, server, dan screenshot error saat hubungi admin.\n\n' +
      '<b>4. Khusus EDU / Ilmupedia</b>\n' +
      'Pastikan paket Ilmupedia Telkomsel aktif. Akun VPN saja tidak cukup kalau paket/kuotanya belum ada.';

    return sendCleanMenu(ctx, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📂 Akun Saya', callback_data: 'my_accounts' }, { text: '🖥️ Status Server', callback_data: 'cek_service' }],
          [{ text: '❓ Bantuan / Support', callback_data: 'help_user' }],
          [{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }],
        ],
      },
    });
  }

  async function showPublicServerStatus(ctx) {
    const rows = await new Promise((resolve) => {
      db.all(
        `SELECT id, nama_server, domain, quota, iplimit, batas_create_akun, total_create_akun, is_reseller_only
         FROM Server
         WHERE COALESCE(is_reseller_only, 0) = 0
         ORDER BY id ASC
         LIMIT 20`,
        [],
        (err, rows) => {
          if (err) {
            logger.error('Gagal ambil status server publik:', err.message);
            return resolve([]);
          }
          resolve(rows || []);
        }
      );
    });

    const lines = [];
    lines.push('🖥️ <b>STATUS SERVER</b>');
    lines.push('<i>Ringkasan server yang bisa dipilih member. Detail port live khusus reseller/admin.</i>');
    lines.push('');

    if (!rows.length) {
      lines.push('Belum ada server publik yang tercatat. Silakan coba lagi nanti atau hubungi admin.');
    } else {
      rows.forEach((row, idx) => {
        const name = row.nama_server || row.domain || ('Server #' + row.id);
        const limit = Number(row.batas_create_akun || 0);
        const used = Number(row.total_create_akun || 0);
        const remaining = limit > 0 ? Math.max(0, limit - used) : null;
        const status = limit > 0 && used >= limit ? '⛔ Penuh' : '✅ Tersedia';
        lines.push(
          `#${idx + 1} <b>${htmlEscape(name)}</b> — ${status}\n` +
          `   Slot: ${limit > 0 ? `${used}/${limit} (sisa ${remaining})` : 'tidak dibatasi'}\n` +
          `   Quota: ${row.quota || '-'} GB • IP limit: ${row.iplimit || '-'}`
        );
      });
    }

    return sendCleanMenu(ctx, lines.join('\n'), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛍️ Buat Akun', callback_data: 'service_create' }],
          [{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }],
        ],
      },
    });
  }

  function register() {
    bot.action('user_balance', showUserBalanceMenu);
    bot.action('renew_menu', showRenewMenu);
    bot.action(/^transaction_history:(\d+)$/, async (ctx) => showTransactionHistoryPage(ctx, parseInt(ctx.match[1], 10) || 0));
    bot.action('vpn_guide', showVpnGuide);
  }

  return {
    register,
    showUserBalanceMenu,
    showRenewMenu,
    showTransactionHistoryPage,
    showVpnGuide,
    showPublicServerStatus,
  };
}

module.exports = { createUserDashboardHandlers };
