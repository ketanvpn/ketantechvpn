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

module.exports = {
  buildAdminServerMenuText,
  buildAdminServerMenuKeyboard,
};
