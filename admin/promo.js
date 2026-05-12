// admin/promo.js - handler template promosi admin.
// Factory: butuh bot, logger, adminIds.

function createPromoHandlers({ bot, logger, adminIds }) {
  if (!bot) throw new Error('createPromoHandlers: bot required');
  if (!logger) throw new Error('createPromoHandlers: logger required');
  if (!Array.isArray(adminIds)) {
    throw new Error('createPromoHandlers: adminIds harus array');
  }

  async function getBotTagForPromo() {
    let botTag = '@BOT_KAMU';
    try {
      const me = await bot.telegram.getMe();
      if (me && me.username) botTag = '@' + me.username;
    } catch (e) {
      logger.error('Gagal ambil info bot untuk template promosi:', e.message);
    }
    return botTag;
  }

  function registerMenu() {
    bot.action('promo_template_menu', async (ctx) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}

      if (!ctx.from || !adminIds.includes(ctx.from.id)) {
        return ctx.reply('\ud83d\udeab Menu ini khusus admin.');
      }

      const keyboard = [
        [{ text: '\ud83d\udcdc Katalog Paket VPN', callback_data: 'promo_tpl_catalog' }],
        [{ text: '\ud83d\udc8e Open Reseller', callback_data: 'promo_tpl_reseller' }],
        [{ text: '\u26a1 Promo Singkat Bot', callback_data: 'promo_tpl_short' }],
        [{ text: '\ud83d\udc51 Template Kaisar', callback_data: 'promo_tpl_kaisar' }],
        [{ text: '\ud83d\udd19 Kembali ke Menu Admin', callback_data: 'admin_menu' }],
      ];

      const text = '<b>\ud83d\udce2 TEMPLATE PROMOSI</b>\n\n'
        + 'Pilih template yang ingin dipakai.\n'
        + 'Bot akan kirim teks iklan siap copas, '
        + 'bisa kamu edit dulu sebelum dikirim ke channel / grup.';

      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      } catch (_) {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
      }
    });
  }

  function registerCatalog() {
    bot.action('promo_tpl_catalog', async (ctx) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
      if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

      const botTag = await getBotTagForPromo();

      const text =
        '\u256d\u2500\u25a0  N A M A  S T O R E  \u25a0\n' +
        '\u2502 \ud83d\udd10 Pasti Aman \u26a1 Anti Ngebug\n' +
        '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n' +
        '   \u2728 READY CONFIG PREMIUM \u2728\n' +
        '\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f\n' +
        '\u2502 \ud83d\udd30 SSH WS / UDP\n' +
        '\u2502 \ud83d\udd30 XRAY VMESS WS & GRPC\n' +
        '\u2502 \ud83d\udd30 XRAY VLESS WS & GRPC\n' +
        '\u2502 \ud83d\udd30 TROJAN WS & GRPC\n' +
        '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n' +
        '   \ud83c\udf10 PILIH LOKASI SERVER\n' +
        '\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f\n' +
        '\u2502 \ud83c\uddf8\ud83c\uddec SG DIGITALOCEAN\n' +
        '\u2502   Rp. 10.000 / 30 Hari \u2022 2 Device\n' +
        '\u2502 \ud83c\uddee\ud83c\udde9 ID NUSA\n' +
        '\u2502   Rp. 12.000 / 30 Hari \u2022 2 Device\n' +
        '\u2502 \ud83c\uddee\ud83c\udde9 ID RAJASA\n' +
        '\u2502   Rp. 13.000 / 30 Hari \u2022 2 Device\n' +
        '\u2502 \ud83c\uddee\ud83c\udde9 ID MSA\n' +
        '\u2502   Rp. 12.000 / 30 Hari \u2022 2 Device\n' +
        '\u2502 \ud83c\udf10 Lokasi lain bisa request\n' +
        '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2508\n' +
        '\n' +
        '\u2705 Anti Lag \u2022 Stabil Harian\n' +
        '\u2705 Cocok Game / Streaming / Zoom\n' +
        '\u2705 Bisa Trial dulu sebelum beli\n' +
        '\n' +
        '\ud83d\udce9 Order via bot:\n' +
        '\ud83d\udc49 ' + botTag;

      await ctx.reply(text);
    });
  }

  function registerReseller() {
    bot.action('promo_tpl_reseller', async (ctx) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
      if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

      const botTag = await getBotTagForPromo();

      const text =
        '\u256d\u2501\u2501\u2501\u25a0  OPEN RESELLER VPN  \u25a0\u2501\u2501\u2501\u256e\n' +
        '\u2503  Saatnya cuan dari jualan akun \ud83d\udcb8\n' +
        '\u2570\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u256f\n\n' +
        '\u2728 HARGA RESELLER MULAI:\n' +
        '\u2022 Dari Rp. 4.500 / akun\n' +
        '\u2022 Bot auto create akun 24 jam\n' +
        '\u2022 Banyak pilihan server premium\n' +
        '\u2022 Trial bisa kapan saja\n\n' +
        '\ud83d\udcb3 HARGA MEMBER MULAI:\n' +
        '\u2022 Rp. 10.000 / bulan\n' +
        '\u2022 Support 2 Device\n\n' +
        '\ud83e\uddfe JOIN RESELLER:\n' +
        '\u2022 Minimal deposit: Rp. 25.000\n' +
        '\u2022 Sistem saldo, tinggal klik akun jadi\n\n' +
        '\ud83c\udfaf KEUNGGULAN:\n' +
        '\u2022 Panel dan bot mudah dipahami\n' +
        '\u2022 Bebas tentukan harga jual sendiri\n\n' +
        '\ud83d\udcf2 Minat daftar reseller?\n' +
        'Order langsung via bot:\n' +
        '\ud83d\udc49 ' + botTag;

      await ctx.reply(text);
    });
  }

  function registerShort() {
    bot.action('promo_tpl_short', async (ctx) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
      if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

      const botTag = await getBotTagForPromo();

      const text =
        '\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25a0  VPN AUTO ORDER  \u25a0\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n' +
        '\u2502   Bot siap melayani 24 jam non-stop \u26a1\n' +
        '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f\n\n' +
        '\ud83d\ude80 PROTOKOL:\n' +
        '\u2022 SSH & UDP\n' +
        '\u2022 VMESS \u2022 VLESS \u2022 TROJAN\n\n' +
        '\ud83c\udf10 SERVER:\n' +
        '\u2022 \ud83c\uddf8\ud83c\uddec Singapore\n' +
        '\u2022 \ud83c\uddee\ud83c\udde9 Indonesia\n\n' +
        '\ud83d\udc8e KEUNGGULAN:\n' +
        '\u2022 Banyak promo menarik\n' +
        '\u2022 Speed kencang dan stabil\n' +
        '\u2022 Akun langsung jadi tanpa tunggu admin\n' +
        '\u2022 Garansi sesuai masa aktif\n\n' +
        '\ud83e\udd16 Order otomatis di bot:\n' +
        '\ud83d\udc49 ' + botTag;

      await ctx.reply(text);
    });
  }

  function registerKaisar() {
    bot.action('promo_tpl_kaisar', async (ctx) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch (_) {}
      if (!ctx.from || !adminIds.includes(ctx.from.id)) return;

      const botTag = await getBotTagForPromo();

      const text =
        '\ud83d\udc51 NAMA STORE KAMU \ud83d\udc51\n' +
        '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
        'AKUN PREMIUM INDONESIA \ud83c\uddee\ud83c\udde9\n\n' +
        '\ud83c\uddee\ud83c\udde9 ID CLOUD 1  :  Rp. 8K\n' +
        '\ud83c\uddee\ud83c\udde9 ID CLOUD 2  :  Rp. 8K\n' +
        '\ud83c\uddee\ud83c\udde9 ID CLOUD 3  :  Rp. 8K\n' +
        '\ud83c\uddee\ud83c\udde9 ID HERZA 1  :  Rp. 8K\n' +
        '\ud83c\uddee\ud83c\udde9 ID HERZA 2  :  Rp. 8K\n' +
        '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
        'TERSEDIA:\n' +
        '\ud83d\udef0 SSH\n' +
        '\ud83d\udef0 VMESS\n' +
        '\ud83d\udef0 SSH UDP\n' +
        '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
        '\u2705 Wajib trial dulu biar makin yakin\n' +
        '\u2705 Support 2 device\n' +
        '\u2705 Support STB / HP / Laptop\n\n' +
        '\ud83d\udcb3 Pembayaran:\n' +
        '\u2705 DANA\n' +
        '\u2705 OVO\n' +
        '\u2705 QRIS (All Payment)\n\n' +
        '\ud83d\udcde Order / tanya tanya via bot:\n' +
        '\ud83d\udc49 ' + botTag;

      await ctx.reply(text);
    });
  }

  function register() {
    registerMenu();
    registerCatalog();
    registerReseller();
    registerShort();
    registerKaisar();
  }

  return { register, getBotTagForPromo };
}

module.exports = { createPromoHandlers };
