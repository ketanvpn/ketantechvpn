'use strict';

function createServerSelectionHandlers(options = {}) {
  const {
    bot,
    db,
    logger = console,
    userState,
    isUserReseller,
    resellerDiscount = 0.65,
  } = options;

  if (!bot) throw new Error('createServerSelectionHandlers: bot is required');
  if (!db) throw new Error('createServerSelectionHandlers: db is required');
  if (!userState) throw new Error('createServerSelectionHandlers: userState is required');
  if (typeof isUserReseller !== 'function') throw new Error('createServerSelectionHandlers: isUserReseller is required');

  async function startSelectServer(ctx, action, type, page = 0) {
    try {
      const isR = await isUserReseller(ctx.from.id);
      const query = isR
        ? 'SELECT * FROM Server'
        : 'SELECT * FROM Server WHERE is_reseller_only = 0 OR is_reseller_only IS NULL';

      db.all(query, [], (err, servers) => {
        if (err) {
          logger.error?.('⚠️ Error fetching servers:', err.message || err);
          return ctx.reply('⚠️ Tidak ada server yang tersedia saat ini.', { parse_mode: 'HTML' });
        }

        const list = Array.isArray(servers) ? servers : [];
        if (list.length === 0) {
          return ctx.reply('⚠️ Tidak ada server yang tersedia saat ini.', { parse_mode: 'HTML' });
        }

        const serversPerPage = 6;
        const totalPages = Math.ceil(list.length / serversPerPage);
        const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
        const start = currentPage * serversPerPage;
        const end = start + serversPerPage;
        const currentServers = list.slice(start, end);

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
            navButtons.push({ text: '⚠️ Back', callback_data: `navigate_${action}_${type}_${currentPage - 1}` });
          }
          if (currentPage < totalPages - 1) {
            navButtons.push({ text: '⚠️ Next', callback_data: `navigate_${action}_${type}_${currentPage + 1}` });
          }
        }
        if (navButtons.length > 0) keyboard.push(navButtons);
        keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'sendMainMenu' }]);

        const serverList = currentServers.map((server) => {
          const hargaNormalPer30Hari = Number(server.harga) || 0;
          const hargaNormalPerHari = hargaNormalPer30Hari > 0
            ? Math.max(1, Math.round(hargaNormalPer30Hari / 30))
            : 0;

          const hargaResellerPer30Hari = hargaNormalPer30Hari > 0
            ? Math.max(1, Math.round(hargaNormalPer30Hari * resellerDiscount))
            : 0;
          const hargaResellerPerHari = hargaResellerPer30Hari > 0
            ? Math.max(1, Math.round(hargaResellerPer30Hari / 30))
            : 0;

          const isFull = server.total_create_akun >= server.batas_create_akun;

          let hargaText;
          if (isR) {
            hargaText =
              `💵 Harga normal 30 hari : <b>Rp${hargaNormalPer30Hari}</b>\n` +
              `💎 Harga reseller 30 hari : <b>Rp${hargaResellerPer30Hari}</b>\n` +
              `💰 Perkiraan reseller / hari : <b>Rp${hargaResellerPerHari}</b>`;
          } else {
            hargaText =
              `💵 Harga 30 hari : <b>Rp${hargaNormalPer30Hari}</b>\n` +
              `💰 Perkiraan harga / hari : <b>Rp${hargaNormalPerHari}</b>`;
          }

          const statusText = isFull
            ? '⛔ <b>Server penuh, tidak bisa membuat akun baru.</b>'
            : `📊 Total akun dibuat: <b>${server.total_create_akun}/${server.batas_create_akun}</b>`;

          return (
            `🖥️ <b>${server.nama_server}</b>\n` +
            `${hargaText}\n` +
            `📊 Quota : <b>${server.quota} GB</b>\n` +
            `🔢 Limit IP : <b>${server.iplimit} IP</b>\n` +
            statusText
          );
        }).join('\n\n');

        const header =
          `🖥️ <b>List Server</b>\n` +
          `Halaman ${currentPage + 1} dari ${totalPages}\n\n`;

        if (ctx.updateType === 'callback_query') {
          ctx.editMessageText(header + serverList, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'HTML',
          });
        } else {
          ctx.reply(header + serverList, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'HTML',
          });
        }

        userState[ctx.chat.id] = { step: `${action}_username_${type}`, page: currentPage };
      });
    } catch (error) {
      logger.error?.(`❌ Error saat memulai proses ${action} untuk ${type}:`, error);
      await ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan.', { parse_mode: 'Markdown' });
    }
  }

  function register() {
    bot.action(/navigate_(\w+)_(\w+)_(\d+)/, async (ctx) => {
      const [, action, type, page] = ctx.match;
      await startSelectServer(ctx, action, type, parseInt(page, 10));
    });
  }

  return {
    register,
    startSelectServer,
  };
}

module.exports = { createServerSelectionHandlers };
