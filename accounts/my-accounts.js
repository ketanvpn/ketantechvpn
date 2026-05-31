// accounts/my-accounts.js - menu "Akun Saya" + handler aksi per akun.
// Factory: butuh deps berat (modul provider del/lock/unlock + sendCleanMenu + userState).

function createMyAccountsHandlers({
  bot,
  db,
  logger,
  userState,
  sendCleanMenu,
  recordAccountTransaction,
  getAccountDaysLeft,
  typeCode,
  shortStatus,
  delHandlers,
  lockHandlers,
  unlockHandlers,
}) {
  if (!bot) throw new Error('createMyAccountsHandlers: bot required');
  if (!db) throw new Error('createMyAccountsHandlers: db required');
  if (!logger) throw new Error('createMyAccountsHandlers: logger required');
  if (!userState) throw new Error('createMyAccountsHandlers: userState required');
  if (typeof sendCleanMenu !== 'function') {
    throw new Error('createMyAccountsHandlers: sendCleanMenu harus fungsi');
  }
  if (typeof recordAccountTransaction !== 'function') {
    throw new Error('createMyAccountsHandlers: recordAccountTransaction harus fungsi');
  }
  if (typeof getAccountDaysLeft !== 'function') {
    throw new Error('createMyAccountsHandlers: getAccountDaysLeft harus fungsi');
  }
  if (typeof typeCode !== 'function') {
    throw new Error('createMyAccountsHandlers: typeCode harus fungsi');
  }
  if (typeof shortStatus !== 'function') {
    throw new Error('createMyAccountsHandlers: shortStatus harus fungsi');
  }
  if (!delHandlers || !lockHandlers || !unlockHandlers) {
    throw new Error('createMyAccountsHandlers: del/lock/unlock handler map required');
  }

  async function showMyAccounts(ctx, filter = 'active', page = 0) {
    try {
      try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}

      if (!ctx.from) {
        return ctx.reply('\u274c Tidak bisa membaca data pengguna.');
      }

      const userId = ctx.from.id;

      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0
      ).getTime();

      let whereClause = 'a.user_id = ?';
      const params = [userId];
      let filterText;
      let filterNormalized;

      switch (filter) {
        case 'expired':
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
        'SELECT a.id, a.username, a.type, a.server_id, a.expires_at, '
        + 'a.external_provider, a.billing_period, s.nama_server '
        + 'FROM accounts a LEFT JOIN Server s ON a.server_id = s.id '
        + 'WHERE ' + whereClause + ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?',
        [...params, pageSize + 1, offset],
        async (err, rows) => {
          if (err) {
            logger.error('\u274c Gagal mengambil data akun:', err.message);
            try {
              await sendCleanMenu(ctx, '\u274c Terjadi kesalahan saat mengambil data akun.', { parse_mode: 'HTML' });
            } catch (e) {
              logger.error('\u274c Gagal kirim pesan error showMyAccounts:', e);
            }
            return;
          }

          const mark = (label, isActive) => (isActive ? '\u2022 ' + label + ' \u2022' : label);
          const activeLabel = mark('\u2705 Aktif', filterNormalized === 'active');
          const expiredLabel = mark('\u274c Expired', filterNormalized === 'expired');
          const allLabel = mark('\ud83d\udccb Semua', filterNormalized === 'all');

          const keyboard = [
            [
              { text: activeLabel, callback_data: 'my_accounts_active' },
              { text: expiredLabel, callback_data: 'my_accounts_expired' },
              { text: allLabel, callback_data: 'my_accounts_all' },
            ],
          ];

          if (!rows || rows.length === 0) {
            let noDataMsg = 'Belum ada akun yang cocok dengan filter ini.';
            if (filterNormalized === 'active') {
              noDataMsg = 'Belum ada akun aktif yang tercatat untuk kamu.\nCoba lihat tab "\ud83d\udccb Semua" atau buat akun baru dari menu utama.';
            } else if (filterNormalized === 'expired') {
              noDataMsg = 'Belum ada akun expired yang tercatat untuk kamu.\nCoba lihat tab "\u2705 Aktif" atau "\ud83d\udccb Semua".';
            }

            const text = '\ud83d\udcc2 <b>Akun Saya</b>\n\n' + filterText + '\n\n' + noDataMsg;
            try {
              await sendCleanMenu(ctx, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
            } catch (e) {
              logger.error('\u274c Gagal kirim menu Akun Saya (no data):', e);
            }
            return;
          }

          let text = '\ud83d\udcc2 <b>Akun Saya</b>\n\n' + filterText + '\n\n';
          text += 'Tipe: VM=vmess, VL=vless, SH=ssh, TJ=trojan, SS=shadowsocks\n';
          text += 'Status: \u2705A#=aktif, \u26a0\ufe0fA0=habis hari ini, \u274cX=expired\n\n';

          const hasNext = rows.length > pageSize;
          const pageRows = hasNext ? rows.slice(0, pageSize) : rows;
          pageRows.forEach((row, index) => {
            const nomor = offset + index + 1;
            const serverName = row.nama_server
              || (row.external_provider === 'vpnbiz' ? '\uD83C\uDF93 Direct EDU' : (row.server_id ? 'Server ' + row.server_id : 'Server ?'));
            const tcode = typeCode(row.type);
            const st = shortStatus(row.expires_at);
            text += nomor + '. [' + tcode + '] <b>' + row.username + '</b> \u2022 ' + serverName + ' \u2022 ' + st + '\n';

            if (filterNormalized === 'active') {
              keyboard.push([
                {
                  text: nomor + '. ' + row.username + ' [' + row.type + ']',
                  callback_data: 'accsel:' + row.id,
                },
              ]);
            }
          });

          const navRow = [];
          if (safePage > 0) {
            navRow.push({ text: '\u2b05\ufe0f Sebelumnya', callback_data: 'myacc_page:' + filterNormalized + ':' + (safePage - 1) });
          }
          if (hasNext) {
            navRow.push({ text: 'Berikutnya \u27a1\ufe0f', callback_data: 'myacc_page:' + filterNormalized + ':' + (safePage + 1) });
          }
          if (navRow.length) keyboard.push(navRow);
          keyboard.push([{ text: '\ud83d\udd19 Menu Utama', callback_data: 'send_main_menu' }]);

          try {
            await sendCleanMenu(ctx, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
          } catch (e) {
            logger.error('\u274c Gagal kirim menu Akun Saya (ada data):', e);
          }
        }
      );
    } catch (err) {
      logger.error('\u274c Error di showMyAccounts:', err);
      try {
        await sendCleanMenu(ctx, '\u274c Terjadi kesalahan saat menampilkan akun.', { parse_mode: 'HTML' });
      } catch (e) {
        logger.error('\u274c Gagal kirim pesan error luar showMyAccounts:', e);
      }
    }
  }

  function describeAccountStatus(expiresAt) {
    if (!expiresAt) return '\u23f3 Tidak diketahui';
    const daysLeft = getAccountDaysLeft(expiresAt);
    if (daysLeft > 0) return '\u2705 Aktif (~' + daysLeft + ' hari lagi)';
    if (daysLeft === 0) return '\u26a0\ufe0f Aktif (habis HARI INI)';
    return '\u274c Sudah expired';
  }

  function registerAccountSelect() {
    bot.action(/accsel:(\d+)/, async (ctx) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
      if (!ctx.from) return ctx.reply('\u274c Tidak bisa membaca data pengguna.');

      const userId = ctx.from.id;
      const accountId = parseInt(ctx.match[1], 10);
      if (!accountId) return ctx.reply('\u274c ID akun tidak valid.');

      db.get(
        'SELECT a.id, a.user_id, a.username, a.type, a.server_id, a.expires_at, '
        + 'a.external_provider, a.billing_period, s.nama_server '
        + 'FROM accounts a LEFT JOIN Server s ON a.server_id = s.id WHERE a.id = ?',
        [accountId],
        (err, row) => {
          if (err) {
            logger.error('Kesalahan saat mengambil detail akun:', err.message);
            return ctx.reply('\u274c Terjadi kesalahan saat membaca detail akun.');
          }
          if (!row || row.user_id !== userId) {
            return ctx.reply('\u274c Akun ini tidak ditemukan atau bukan milik kamu.');
          }

          const serverName = row.nama_server
            || (row.external_provider === 'vpnbiz' ? '\uD83C\uDF93 Direct EDU' : (row.server_id ? 'Server ' + row.server_id : 'Server ?'));
          const status = describeAccountStatus(row.expires_at);

          const detail = '\ud83d\udcc4 <b>Detail Akun</b>\n\n'
            + 'Tipe    : <b>' + row.type + '</b>\n'
            + 'Username: <b>' + row.username + '</b>\n'
            + 'Server  : ' + serverName + '\n'
            + 'Status  : ' + status + '\n\n'
            + 'Pilih aksi yang ingin kamu lakukan:';

          const keyboard = [
            [{ text: '\u267b\ufe0f Perpanjang Akun', callback_data: 'accrenew:' + row.id }],
            [{ text: '\u274c Hapus Akun', callback_data: 'accdel:' + row.id }],
            [
              { text: '\ud83d\udd12 Kunci Akun', callback_data: 'acclock:' + row.id },
              { text: '\ud83d\udd13 Buka Kunci', callback_data: 'accunlock:' + row.id },
            ],
            [{ text: '\ud83d\udd19 Kembali ke daftar', callback_data: 'my_accounts' }],
          ];

          return sendCleanMenu(ctx, detail, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
        }
      );
    });
  }

  function registerSimpleAction(prefix, handlers, successVerb, failVerb) {
    const re = new RegExp('^' + prefix + ':(\\d+)$');
    bot.action(re, async (ctx) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
      if (!ctx.from) return ctx.reply('\u274c Tidak bisa membaca data pengguna.');

      const userId = ctx.from.id;
      const accountId = parseInt(ctx.match[1], 10);
      if (!accountId) return ctx.reply('\u274c ID akun tidak valid.');

      db.get(
        'SELECT id, user_id, username, type, server_id, external_provider FROM accounts WHERE id = ?',
        [accountId],
        async (err, row) => {
          if (err) {
            logger.error('Kesalahan saat mengambil akun untuk ' + prefix + ':', err.message);
            return ctx.reply('\u274c Terjadi kesalahan saat membaca data akun.');
          }
          if (!row || row.user_id !== userId) {
            return ctx.reply('\u274c Akun ini tidak ditemukan atau bukan milik kamu.');
          }

          // Akun Direct EDU (vpnbiz) tidak punya server_id lokal. Aksi
          // lock/unlock tidak applicable; del cukup hapus catatan lokal saja.
          if (row.external_provider === 'vpnbiz') {
            if (prefix === 'accdel') {
              db.run('DELETE FROM accounts WHERE id = ?', [accountId], (err2) => {
                if (err2) {
                  logger.error('Kesalahan menghapus record akun edukasi dari tabel accounts:', err2.message);
                  return ctx.reply('\u274c Terjadi kesalahan saat menghapus catatan akun.');
                }
                ctx.reply(
                  '\u2705 Catatan akun Direct EDU dihapus dari daftar kamu.\n\n'
                  + '_Catatan: akun di sisi provider tetap aktif sampai expired sesuai paket. '
                  + 'Aksi ini hanya menghilangkan dari daftar Akun Saya._',
                  { parse_mode: 'Markdown' }
                );
              });
              return;
            }
            // Lock/unlock tidak didukung untuk akun edukasi
            return ctx.reply(
              '\u26a0\ufe0f Aksi *' + failVerb + '* tidak tersedia untuk akun Direct EDU.\n'
              + 'Akun edukasi mengikuti masa aktif paket dan tidak bisa di-lock/unlock manual.',
              { parse_mode: 'Markdown' }
            );
          }

          const fn = handlers[row.type];
          if (!fn) return ctx.reply('\u274c Tipe akun tidak dikenal, tidak bisa di' + failVerb + '.');

          try {
            const password = 'none', exp = 'none', iplimit = 'none';
            const msg = await fn(row.username, password, exp, iplimit, row.server_id);
            await recordAccountTransaction(userId, row.type);

            if (prefix === 'accdel') {
              db.run('DELETE FROM accounts WHERE id = ?', [accountId], (err2) => {
                if (err2) {
                  logger.error('Kesalahan menghapus record dari tabel accounts:', err2.message);
                }
              });
            }

            await ctx.reply(msg, { parse_mode: 'Markdown' });
            logger.info('\u2705 Akun ' + row.type + ' (' + row.username + ') ' + successVerb + ' lewat Akun Saya oleh ' + userId);
          } catch (e2) {
            logger.error('\u274c Gagal ' + prefix + ' akun dari menu Akun Saya:', e2.message);
            await ctx.reply('\u274c *Terjadi kesalahan saat ' + failVerb + ' akun.*', { parse_mode: 'Markdown' });
          }
        }
      );
    });
  }

  function registerRenew() {
    bot.action(/accrenew:(\d+)/, async (ctx) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
      if (!ctx.from) return ctx.reply('\u274c Tidak bisa membaca data pengguna.');

      const userId = ctx.from.id;
      const chatId = ctx.chat.id;
      const accountId = parseInt(ctx.match[1], 10);
      if (!accountId) return ctx.reply('\u274c ID akun tidak valid.');

      db.get(
        'SELECT a.id, a.user_id, a.username, a.type, a.server_id, a.expires_at, '
        + 'a.external_provider, a.billing_period, s.nama_server '
        + 'FROM accounts a LEFT JOIN Server s ON a.server_id = s.id WHERE a.id = ?',
        [accountId],
        async (err, row) => {
          if (err) {
            logger.error('Kesalahan saat mengambil data akun untuk perpanjang:', err.message);
            return ctx.reply('\u274c Terjadi kesalahan saat membaca data akun.');
          }
          if (!row || row.user_id !== userId) {
            return ctx.reply('\u274c Akun ini tidak ditemukan atau bukan milik kamu.');
          }

          const now = new Date();
          const todayStart = new Date(
            now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0
          ).getTime();
          if (row.expires_at !== null && row.expires_at < todayStart) {
            return sendCleanMenu(ctx,
              '\u26a0\ufe0f <b>Akun ini sudah expired.</b>\n\n'
              + 'Untuk keamanan, menu perpanjang hanya tersedia untuk akun yang masih aktif/belum expired.\n'
              + 'Silakan buat akun baru atau hubungi admin kalau butuh bantuan.',
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '\ud83d\udcc2 Lihat Akun Aktif', callback_data: 'my_accounts_active' }],
                    [{ text: '\ud83d\uded2 Buat Akun Baru', callback_data: 'service_create' }],
                  ],
                },
              }
            );
          }

          // Akun Direct EDU (vpnbiz) tidak punya server_id lokal, dan flow renew
          // lokal akan memanggil renewssh/renewvmess yang butuh server lokal.
          // Redirect ke flow edukasi_renew_ask supaya pakai vpnbiz API.
          if (row.external_provider === 'vpnbiz') {
            // Trial tidak bisa renew, kasih info user.
            if (row.billing_period === 'trial') {
              return sendCleanMenu(ctx,
                '\u26a0\ufe0f Akun trial Direct EDU tidak bisa diperpanjang.\n'
                + 'Silakan beli paket berbayar (Bulanan/Mingguan) dari menu '
                + '\uD83C\uDF93 Akun Direct EDU.',
                { parse_mode: 'HTML' }
              );
            }
            // Forward ke handler edukasi via emit ulang callback.
            // Cara aman: kirim pesan dengan tombol arah ke flow edukasi.
            const keyboard = [
              [{ text: '\uD83D\uDCC5 Renew Bulanan', callback_data: 'edukasi_renew_do:' + row.id + ':monthly' }],
              [{ text: '\uD83D\uDDD3\uFE0F Renew Mingguan', callback_data: 'edukasi_renew_do:' + row.id + ':weekly' }],
              [{ text: '\u274C Batal', callback_data: 'my_accounts' }],
            ];
            const infoText = '\u267b\uFE0F <b>PERPANJANG AKUN DIRECT EDU</b>\n\n'
              + 'Tipe    : <b>' + row.type + '</b>\n'
              + 'Username: <b>' + row.username + '</b>\n'
              + 'Status  : ' + describeAccountStatus(row.expires_at) + '\n\n'
              + 'Pilih periode renew:';
            return sendCleanMenu(ctx, infoText, {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: keyboard },
            });
          }

          const serverName = row.nama_server
            || (row.server_id ? 'Server ' + row.server_id : 'Server ?');
          const status = describeAccountStatus(row.expires_at);

          userState[chatId] = {
            action: 'renew',
            type: row.type,
            username: row.username,
            serverId: row.server_id,
            password: 'none',
            step: 'exp_renew_' + row.type,
          };

          const infoText = '\u267b\ufe0f <b>PERPANJANG AKUN</b>\n\n'
            + 'Tipe    : <b>' + row.type + '</b>\n'
            + 'Username: <b>' + row.username + '</b>\n'
            + 'Server  : ' + serverName + '\n'
            + 'Status  : ' + status + '\n\n'
            + 'Silakan kirim <b>masa aktif tambahan</b> dalam hari.\n'
            + 'Contoh: <code>30</code>';

          await sendCleanMenu(ctx, infoText, { parse_mode: 'HTML' });
        }
      );
    });
  }

  function register() {
    bot.action('my_accounts', async (ctx) => showMyAccounts(ctx, 'active'));
    bot.action('my_accounts_active', async (ctx) => showMyAccounts(ctx, 'active', 0));
    bot.action('my_accounts_expired', async (ctx) => showMyAccounts(ctx, 'expired', 0));
    bot.action('my_accounts_all', async (ctx) => showMyAccounts(ctx, 'all', 0));
    bot.action(/^myacc_page:(active|expired|all):(\d+)$/, async (ctx) => {
      const filter = ctx.match[1];
      const page = parseInt(ctx.match[2], 10) || 0;
      return showMyAccounts(ctx, filter, page);
    });

    registerAccountSelect();
    registerSimpleAction('accdel', delHandlers, 'dihapus', 'menghapus');
    registerSimpleAction('acclock', lockHandlers, 'dikunci', 'mengunci');
    registerSimpleAction('accunlock', unlockHandlers, 'di-unlock', 'membuka kunci');
    registerRenew();
  }

  return { register, showMyAccounts };
}

module.exports = { createMyAccountsHandlers };
