'use strict';

const { htmlEscape } = require('./html');

function buildFlowPickServerText(state = {}) {
  const modeLabel = state.mode === 'trial' ? 'Trial' : 'Buat Akun';
  const type = String(state.type || '').toUpperCase();
  return `<b>${htmlEscape(modeLabel)} ${htmlEscape(type)}</b>\nPilih server:`;
}

function buildFlowPickServerKeyboard(servers = []) {
  const inline_keyboard = servers.map((server) => ([{
    text: String(server.nama_server || `Server #${server.id}`),
    callback_data: `flow_pick_server:${server.id}`,
  }]));
  inline_keyboard.push([{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]);
  return { inline_keyboard };
}

function buildFlowConfirmText(options = {}) {
  const {
    type = '',
    serverName = '',
    serverId = '',
    username = '',
    durationHours = 1,
  } = options;
  const days = Math.max(1, Math.ceil(Number(durationHours || 1) / 24));
  const namaServer = serverName || `Server #${serverId}`;

  return [
    `<b>Konfirmasi Trial ${htmlEscape(String(type).toUpperCase())}</b>`,
    `Server   : <b>${htmlEscape(namaServer)}</b>`,
    `Username : <code>${htmlEscape(username)}</code>`,
    `Durasi   : ~<b>${htmlEscape(durationHours)} jam</b> (${days} hari dibulatkan)`,
  ].join('\n');
}

function buildFlowConfirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Konfirmasi', callback_data: 'flow_confirm' }],
      [{ text: '✏️ Ubah Server', callback_data: 'flow_back_server' }],
      [{ text: '❌ Batal', callback_data: 'flow_cancel' }],
    ],
  };
}

module.exports = {
  buildFlowPickServerText,
  buildFlowPickServerKeyboard,
  buildFlowConfirmText,
  buildFlowConfirmKeyboard,
};
