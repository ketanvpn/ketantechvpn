'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatTelegramDisplayName,
  formatRupiah,
  buildResellerListText,
  buildMemberListText,
  buildListResMemberBackKeyboard,
} = require('../lib/admin-user-list-menu');

test('formatTelegramDisplayName: username and fallback id', () => {
  assert.equal(formatTelegramDisplayName(123, 'eko'), '@eko');
  assert.equal(formatTelegramDisplayName(123, '@eko'), '@eko');
  assert.equal(formatTelegramDisplayName(123, ''), 'ID:123');
});

test('formatRupiah: formats id-ID numbers', () => {
  assert.equal(formatRupiah(25000), '25.000');
  assert.equal(formatRupiah(null), '0');
});

test('buildResellerListText: empty and rows', () => {
  assert.equal(buildResellerListText([]), '⚠️ Belum ada reseller terdaftar.');
  const text = buildResellerListText([
    { userId: 1, username: 'reseller1', saldo: 5000 },
    { userId: 2, username: '', saldo: 0 },
  ]);
  assert.match(text, /DAFTAR RESELLER/);
  assert.match(text, /1\. @reseller1 \(1\) • Saldo: Rp5000/);
  assert.match(text, /2\. ID:2 \(2\) • Saldo: Rp0/);
});

test('buildMemberListText: empty and rows', () => {
  assert.equal(buildMemberListText([]), '⚠️ Belum ada member biasa yang terdaftar.');
  const text = buildMemberListText([
    { userId: 3, username: 'member1', saldo: 25000 },
  ]);
  assert.match(text, /DAFTAR MEMBER/);
  assert.match(text, /@member1 \(3\) • Saldo: Rp25\.000/);
});

test('buildListResMemberBackKeyboard: back callback', () => {
  const kb = buildListResMemberBackKeyboard();
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'list_res_mem');
});
