// modules/reseller-upgrade.js
// User-facing "💎 Upgrade ke Reseller" info flow.

function createResellerUpgradeHandlers({
  bot,
  sendCleanMenu,
  htmlEscape,
  storeName,
  adminUsername,
}) {
  if (!bot) throw new Error('createResellerUpgradeHandlers: bot required');
  if (typeof sendCleanMenu !== 'function') throw new Error('createResellerUpgradeHandlers: sendCleanMenu required');
  if (typeof htmlEscape !== 'function') throw new Error('createResellerUpgradeHandlers: htmlEscape required');

  const STORE_NAME = storeName || 'Layanan VPN';
  const ADMIN_NAME = adminUsername || 'Admin';

  async function showUpgradeInfo(ctx) {
    await ctx.answerCbQuery().catch(() => {});

    const userId = ctx.from && ctx.from.id;
    if (!userId) return;

    const safeStore = htmlEscape(STORE_NAME);
    const safeAdmin = htmlEscape(ADMIN_NAME);

    const msg = `
<b>💎 Program Reseller ${safeStore}</b>

Pengen jualan akun VPN sendiri dengan modal lebih hemat?
Kamu bisa daftar sebagai <b>reseller resmi</b> di ${safeStore}.

<b>✨ Keuntungan jadi reseller:</b>
• 💰 Dapat harga akun lebih murah dari harga user biasa.
• 💵 Bebas atur harga jual ke pelanggan kamu sendiri.
• ⚡ Prioritas akses server & bantuan kalau ada kendala teknis.
• 💬 Support langsung dari admin ${safeAdmin} lewat chat.

<b>✍️ Cara daftar reseller:</b>
1. Salin format pesan di bawah ini.
2. Kirim ke ${safeAdmin} lewat chat Telegram.

<code>
Mau jadi reseller.
ID Telegram : ${userId}
Nama        : ....
</code>

<b>ℹ️ Keterangan tambahan:</b>
• Minimal deposit, list harga reseller, dan aturan lengkap akan dijelaskan oleh admin.
• Saldo reseller nantinya bisa dipakai untuk membuat akun VPN langsung dari bot.
• Disarankan pakai nomor & akun Telegram yang aktif agar mudah dihubungi.
`.trim();

    return sendCleanMenu(ctx, msg, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 Cek Saldo', callback_data: 'user_balance' }],
          [{ text: '🔙 Menu Utama', callback_data: 'send_main_menu' }],
        ],
      },
    });
  }

  function register() {
    bot.action('jadi_reseller', showUpgradeInfo);
  }

  return { register, showUpgradeInfo };
}

module.exports = { createResellerUpgradeHandlers };
