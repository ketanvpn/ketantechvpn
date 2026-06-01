'use strict';

function buildAdminServerMenuText() {
  return (
    '<b>🗑️ MANAGEMEN SERVER</b>\n\n' +
    'Pilih pengaturan yang berhubungan dengan server:\n\n' +
    '• Tambah / Hapus server\n' +
    '• Edit harga, nama, domain, auth\n' +
    '• Edit quota, limit IP, batas & total create\n' +
    '• Lihat list & detail server\n'
  );
}

function buildAdminServerMenuKeyboard() {
  return [
    [
      { text: '➕ Tambah Server', callback_data: 'addserver' },
      { text: '🗑️ Hapus Server', callback_data: 'deleteserver' },
    ],
    [
      { text: '✏️ Edit Harga', callback_data: 'editserver_harga' },
      { text: '✏️ Edit Nama', callback_data: 'nama_server_edit' },
    ],
    [
      { text: '✏️ Edit Domain', callback_data: 'editserver_domain' },
      { text: '✏️ Edit Auth', callback_data: 'editserver_auth' },
    ],
    [
      { text: '✏️ Edit Quota', callback_data: 'editserver_quota' },
      { text: '✏️ Edit Limit IP', callback_data: 'editserver_limit_ip' },
    ],
    [
      { text: '✏️ Edit Batas Create', callback_data: 'editserver_batas_create_akun' },
      { text: '✏️ Edit Total Create', callback_data: 'editserver_total_create_akun' },
    ],
    [
      { text: '🗑️ List Server', callback_data: 'listserver' },
      { text: '⚠️ Reset Server', callback_data: 'resetdb' },
    ],
    [
      { text: '⚠️ Detail Server', callback_data: 'detailserver' },
    ],
    [
      { text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' },
    ],
  ];
}

function buildServerListText(servers = []) {
  let text = '🗑️ *Daftar Server* 🗑️\n\n';
  servers.forEach((server, index) => {
    text += `• ${index + 1}. ${server.domain}\n`;
  });
  text += `\nTotal Jumlah Server: ${servers.length}`;
  return text;
}

function buildServerMenuBackKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 Kembali ke Menu Server', callback_data: 'admin_server_menu' }],
    ],
  };
}

function buildResetDbConfirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Ya', callback_data: 'confirm_resetdb' }],
      [{ text: '⛔ Tidak', callback_data: 'cancel_resetdb' }],
    ],
  };
}

function buildDeleteServerKeyboard(servers = []) {
  const inline_keyboard = servers.map((server) => ([{
    text: String(server.nama_server || `Server #${server.id}`),
    callback_data: `confirm_delete_server_${server.id}`,
  }]));
  inline_keyboard.push([{ text: '🔙 Kembali ke Menu Server', callback_data: 'admin_server_menu' }]);
  return { inline_keyboard };
}

module.exports = {
  buildAdminServerMenuText,
  buildAdminServerMenuKeyboard,
  buildServerListText,
  buildServerMenuBackKeyboard,
  buildResetDbConfirmKeyboard,
  buildDeleteServerKeyboard,
};
