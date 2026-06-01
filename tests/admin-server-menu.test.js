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
  buildEditHargaPromptText,
  buildEditHargaInputText,
  maskServerAuth,
  buildServerDetailText,
  buildEditAuthPromptText,
  buildEditDomainPromptText,
  buildEditNamaPromptText,
  buildEditHargaCancelText,
  buildEditHargaSuccessText,
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

test('buildEditHargaPromptText: renders current price prompt', () => {
  const text = buildEditHargaPromptText({ serverName: 'SG-1', oldHarga: 15000 });
  assert.match(text, /Edit Harga Server/);
  assert.match(text, /Server: \*SG-1\*/);
  assert.match(text, /Harga sekarang: \*Rp 15\.000\*/);
  assert.match(text, /masukkan harga baru/);
});

test('buildEditHargaInputText: renders typed amount preview', () => {
  const text = buildEditHargaInputText({
    serverName: 'SG-1',
    oldHarga: 15000,
    currentAmount: '25000',
  });
  assert.match(text, /Harga sekarang: \*Rp 15\.000\*/);
  assert.match(text, /Input baru: \*Rp 25000\*/);
  assert.match(text, /Tekan ✅ untuk simpan/);
});

test('maskServerAuth: masks long auth and keeps short/fallback', () => {
  assert.equal(maskServerAuth('abcd1234xyz'), 'abcd...4xyz');
  assert.equal(maskServerAuth('short'), 'short');
  assert.equal(maskServerAuth(''), '-');
});

test('buildServerDetailText: renders masked server detail', () => {
  const text = buildServerDetailText({
    domain: 'sg.example.com',
    auth: 'abcd1234xyz',
    nama_server: 'SG-1',
    quota: 100,
    iplimit: 2,
    batas_create_akun: 50,
    total_create_akun: 10,
    harga: 15000,
  });
  assert.match(text, /Detail Server/);
  assert.match(text, /sg\.example\.com/);
  assert.match(text, /abcd\.\.\.4xyz/);
  assert.match(text, /SG-1/);
  assert.match(text, /Rp 15000/);
});

test('edit auth/domain/nama prompt builders: render current values', () => {
  const authText = buildEditAuthPromptText({
    currentName: 'SG-1',
    currentDomain: 'sg.example.com',
    currentAuth: 'abcd1234xyz',
  });
  assert.match(authText, /Edit AUTH Server/);
  assert.match(authText, /SG-1/);
  assert.match(authText, /sg\.example\.com/);
  assert.match(authText, /abcd\.\.\.4xyz/);

  const domainText = buildEditDomainPromptText('old.example.com');
  assert.match(domainText, /domain server baru/);
  assert.match(domainText, /old\.example\.com/);
  assert.match(domainText, /sg1\.serverku\.com/);

  const namaText = buildEditNamaPromptText('SG Old');
  assert.match(namaText, /nama server baru/);
  assert.match(namaText, /SG Old/);
});

test('edit harga cancel/success builders: render expected messages', () => {
  assert.equal(buildEditHargaCancelText(), '⛔ *Edit harga dibatalkan.*');

  const text = buildEditHargaSuccessText({
    serverName: 'SG-1',
    oldHarga: 15000,
    newHarga: 25000,
  });
  assert.match(text, /Harga server berhasil diubah/);
  assert.match(text, /Server: \*SG-1\*/);
  assert.match(text, /Sebelumnya : Rp 15\.000/);
  assert.match(text, /Sekarang   : \*Rp 25\.000\*/);
});
