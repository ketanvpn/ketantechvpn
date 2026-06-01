'use strict';

function formatTelegramDisplayName(userId, username) {
  if (username) return username.startsWith('@') ? username : '@' + username;
  return `ID:${userId}`;
}

function formatRupiah(value) {
  return Number(value || 0).toLocaleString('id-ID');
}

function buildResellerListText(items = []) {
  if (!items.length) return '⚠️ Belum ada reseller terdaftar.';
  const lines = items.map((item, idx) => {
    const displayName = formatTelegramDisplayName(item.userId, item.username || '');
    return `${idx + 1}. ${displayName} (${item.userId}) • Saldo: Rp${item.saldo || 0}`;
  });
  return '<b>💎 DAFTAR RESELLER</b>\n\n' + lines.join('\n');
}

function buildMemberListText(items = []) {
  if (!items.length) return '⚠️ Belum ada member biasa yang terdaftar.';
  const lines = items.map((item, idx) => {
    const displayName = formatTelegramDisplayName(item.userId, item.username || '');
    return `${idx + 1}. ${displayName} (${item.userId}) • Saldo: Rp${formatRupiah(item.saldo)}`;
  });
  return '<b>👤 DAFTAR MEMBER</b>\n\n' + lines.join('\n');
}

function buildListResMemberBackKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 Kembali', callback_data: 'list_res_mem' }],
    ],
  };
}

module.exports = {
  formatTelegramDisplayName,
  formatRupiah,
  buildResellerListText,
  buildMemberListText,
  buildListResMemberBackKeyboard,
};
