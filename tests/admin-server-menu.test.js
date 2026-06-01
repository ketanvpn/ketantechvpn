'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdminServerMenuText,
  buildAdminServerMenuKeyboard,
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
