'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdminServerMenuText,
  buildAdminServerMenuKeyboard,
  buildServerListText,
  buildServerMenuBackKeyboard,
  buildResetDbConfirmKeyboard,
  buildDeleteServerKeyboard,
  buildDetailServerKeyboard,
  buildEditNumericFieldPromptText,
} = require('../lib/admin-server-menu');

test('buildAdminServerMenuText: includes server management sections', () => {
  const text = buildAdminServerMenuText();
  assert.match(text, /MANAGEMEN SERVER/);
  assert.match(text, /Tambah \/ Hapus server/);
  assert.match(text, /Edit harga, nama, domain, auth/);
  assert.match(text, /Lihat list & detail server/);
});

test('buildAdminServerMenuKeyboard: keeps server admin callbacks', () => {
  const callbacks = buildAdminServerMenuKeyboard().flat().map((btn) => btn.callback_data);
  for (const expected of [
    'addserver',
    'deleteserver',
    'editserver_harga',
    'nama_server_edit',
    'editserver_domain',
    'editserver_auth',
    'editserver_quota',
    'editserver_limit_ip',
    'editserver_batas_create_akun',
    'editserver_total_create_akun',
    'listserver',
    'resetdb',
    'detailserver',
    'admin_menu',
  ]) {
    assert.ok(callbacks.includes(expected), `missing ${expected}`);
  }
});

test('buildServerListText: numbers servers and totals', () => {
  const text = buildServerListText([
    { domain: 'a.example.com' },
    { domain: 'b.example.com' },
  ]);
  assert.match(text, /Daftar Server/);
  assert.match(text, /• 1\. a\.example\.com/);
  assert.match(text, /• 2\. b\.example\.com/);
  assert.match(text, /Total Jumlah Server: 2/);
});

test('buildServerMenuBackKeyboard: back to server menu', () => {
  const kb = buildServerMenuBackKeyboard();
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'admin_server_menu');
});

test('buildResetDbConfirmKeyboard: confirm/cancel callbacks', () => {
  const kb = buildResetDbConfirmKeyboard();
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'confirm_resetdb');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'cancel_resetdb');
});

test('buildDeleteServerKeyboard: per-server delete + back', () => {
  const kb = buildDeleteServerKeyboard([
    { id: 1, nama_server: 'SG-1' },
    { id: 2, nama_server: 'ID-1' },
  ]);
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'confirm_delete_server_1');
  assert.equal(kb.inline_keyboard[0][0].text, 'SG-1');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'confirm_delete_server_2');
  assert.equal(kb.inline_keyboard[2][0].callback_data, 'admin_server_menu');
});

test('buildDetailServerKeyboard: two columns + back', () => {
  const kb = buildDetailServerKeyboard([
    { id: 1, nama_server: 'SG-1' },
    { id: 2, nama_server: 'ID-1' },
    { id: 3, nama_server: 'JP-1' },
  ]);
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'server_detail_1');
  assert.equal(kb.inline_keyboard[0][1].callback_data, 'server_detail_2');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'server_detail_3');
  assert.equal(kb.inline_keyboard[1].length, 1);
  assert.equal(kb.inline_keyboard[2][0].callback_data, 'admin_server_menu');
});

test('buildEditNumericFieldPromptText: renders label/server/value', () => {
  const text = buildEditNumericFieldPromptText({
    label: 'Limit IP per Akun',
    serverName: 'SG-1',
    formattedValue: '2 IP',
  });
  assert.match(text, /Edit Limit IP per Akun/);
  assert.match(text, /Server: \*SG-1\*/);
  assert.match(text, /Nilai sekarang: \*2 IP\*/);
  assert.match(text, /Batal untuk membatalkan/);
});
