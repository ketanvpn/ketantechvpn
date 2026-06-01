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

function buildDetailServerKeyboard(servers = []) {
  const inline_keyboard = [];
  for (let i = 0; i < servers.length; i += 2) {
    const row = [{
      text: String(servers[i].nama_server || `Server #${servers[i].id}`),
      callback_data: `server_detail_${servers[i].id}`,
    }];
    if (i + 1 < servers.length) {
      row.push({
        text: String(servers[i + 1].nama_server || `Server #${servers[i + 1].id}`),
        callback_data: `server_detail_${servers[i + 1].id}`,
      });
    }
    inline_keyboard.push(row);
  }
  inline_keyboard.push([{ text: '🔙 Kembali ke Menu Server', callback_data: 'admin_server_menu' }]);
  return { inline_keyboard };
}

function buildEditNumericFieldPromptText(options = {}) {
  const {
    label = '',
    serverName = '',
    formattedValue = '',
  } = options;
  return (
    '✏️ *Edit ' + label + '*\n\n' +
    '📍 Server: *' + serverName + '*\n' +
    '🔢 Nilai sekarang: *' + formattedValue + '*\n\n' +
    '_Silakan masukkan nilai baru menggunakan keypad di bawah._\n' +
    '_Tekan ❌ Batal untuk membatalkan._'
  );
}

function buildEditHargaPromptText(options = {}) {
  const {
    serverName = '',
    oldHarga = 0,
  } = options;
  return (
    '✏️ *Edit Harga Server (paket 30 hari)*\n\n' +
    '📍 Server: *' + serverName + '*\n' +
    '💰 Harga sekarang: *Rp ' + Number(oldHarga || 0).toLocaleString('id-ID') + '*\n\n' +
    '_Silakan masukkan harga baru menggunakan keypad di bawah._\n' +
    '_Tekan ❌ Batal untuk membatalkan._'
  );
}

function buildEditHargaInputText(options = {}) {
  const {
    serverName = '',
    oldHarga = 0,
    currentAmount = '',
  } = options;
  return (
    '✏️ *Edit Harga Server (paket 30 hari)*\n\n' +
    '📍 Server: *' + serverName + '*\n' +
    '💰 Harga sekarang: *Rp ' + Number(oldHarga || 0).toLocaleString('id-ID') + '*\n' +
    '🆕 Input baru: *Rp ' + (currentAmount || '0') + '*\n\n' +
    '_Tekan ✅ untuk simpan atau ❌ Batal untuk membatalkan._'
  );
}

function maskServerAuth(auth) {
  const value = String(auth || '');
  if (!value) return '-';
  return value.length > 8 ? value.slice(0, 4) + '...' + value.slice(-4) : value;
}

function buildServerDetailText(server = {}) {
  const maskedAuth = maskServerAuth(server.auth);
  return (
    '?? *Detail Server* ??\n\n' +
    `?? *Domain:* \`${server.domain}\`\n` +
    `?? *Auth:* \`${maskedAuth}\`\n` +
    `• *Nama Server:* \`${server.nama_server}\`\n` +
    `?? *Quota:* \`${server.quota}\`\n` +
    `?? *Limit IP:* \`${server.iplimit}\`\n` +
    `?? *Batas Create Akun:* \`${server.batas_create_akun}\`\n` +
    `?? *Total Create Akun:* \`${server.total_create_akun}\`\n` +
    `?? *Harga 30 hari:* \`Rp ${server.harga}\`\n\n`
  );
}

function buildEditAuthPromptText(options = {}) {
  const {
    currentName = '-',
    currentDomain = '-',
    currentAuth = '-',
  } = options;
  const maskedAuth = maskServerAuth(currentAuth);
  return (
    '?? *Edit AUTH Server*\n' +
    `? Nama   : \`${currentName}\`\n` +
    `? Domain : \`${currentDomain}\`\n` +
    `? Auth   : \`${maskedAuth}\`\n\n` +
    '?? *Silakan ketik AUTH server baru, lalu kirim sebagai pesan biasa.*\n' +
    '? Ketik *batal* untuk membatalkan.'
  );
}

function buildEditDomainPromptText(currentDomain = '-') {
  return (
    '?? *Silakan ketik domain server baru, lalu kirim sebagai pesan biasa.*\n' +
    `?? Domain saat ini: \`${currentDomain}\`\n` +
    '?? Contoh: `sg1.serverku.com`\n' +
    '? Ketik *batal* untuk membatalkan.'
  );
}

function buildEditNamaPromptText(currentName = '-') {
  return (
    '✏️ *Silakan ketik nama server baru, lalu kirim sebagai pesan biasa.*\n' +
    `?? Contoh: \`${currentName}\`\n` +
    '? Ketik *batal* untuk membatalkan.'
  );
}

function buildEditHargaCancelText() {
  return '⛔ *Edit harga dibatalkan.*';
}

function buildEditHargaSuccessText(options = {}) {
  const {
    serverName = '',
    oldHarga = 0,
    newHarga = 0,
  } = options;
  return (
    '✅ *Harga server berhasil diubah.*\n\n' +
    '📍 Server: *' + serverName + '*\n' +
    '• Sebelumnya : Rp ' + Number(oldHarga || 0).toLocaleString('id-ID') + '\n' +
    '• Sekarang   : *Rp ' + Number(newHarga || 0).toLocaleString('id-ID') + '*'
  );
}

module.exports = {
  buildAdminServerMenuText,
  buildAdminServerMenuKeyboard,
  buildServerListText,
  buildServerMenuBackKeyboard,
  buildResetDbConfirmKeyboard,
  buildDeleteServerKeyboard,
  buildDetailServerKeyboard,
  buildEditNumericFieldPromptText,
  buildEditHargaPromptText,
  buildEditHargaInputText,
  maskServerAuth,
  buildServerDetailText,
  buildEditAuthPromptText,
  buildEditDomainPromptText,
  buildEditNamaPromptText,
  buildEditHargaCancelText,
  buildEditHargaSuccessText,
};
