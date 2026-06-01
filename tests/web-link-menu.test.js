'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildWebLinkSuccessText,
  buildWebLinkSuccessKeyboard,
  buildWebLinkedStatusText,
  buildWebLinkedStatusKeyboard,
  buildWebLinkInstructionsText,
  buildWebLinkInstructionsKeyboard,
  buildWebUnlinkSuccessText,
  buildWebUnlinkSuccessKeyboard,
} = require('../lib/web-link-menu');

test('buildWebLinkSuccessText: success with migrated saldo', () => {
  const text = buildWebLinkSuccessText({
    wasLinked: false,
    webDomain: 'https://web.test',
    username: 'eko<admin>',
    migratedAmount: 25000,
    finalWebBalance: 75000,
  });

  assert.match(text, /berhasil terhubung/);
  assert.match(text, /https:\/\/web.test/);
  assert.match(text, /eko&lt;admin&gt;/);
  assert.match(text, /\+Rp 25\.000/);
  assert.match(text, /Rp 75\.000/);
});

test('buildWebLinkSuccessText: migration error is escaped', () => {
  const text = buildWebLinkSuccessText({
    wasLinked: true,
    webDomain: 'web',
    username: 'eko',
    migrateError: '<boom>',
    finalWebBalance: 0,
  });

  assert.match(text, /terhubung ulang/);
  assert.match(text, /&lt;boom&gt;/);
  assert.match(text, /Saldo lokal kamu tidak hilang/);
});

test('buildWebLinkSuccessKeyboard: uses fallback URL', () => {
  const kb = buildWebLinkSuccessKeyboard(null);
  assert.equal(kb.inline_keyboard[0][0].url, 'https://ketantech.my.id');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'send_main_menu');
});

test('buildWebLinkedStatusText: linked user with balance', () => {
  const text = buildWebLinkedStatusText({
    webDomain: 'https://web.test',
    webUser: { id: 9, username: 'user&name', balance: 123456 },
  });

  assert.match(text, /Akun Web Sudah Terhubung/);
  assert.match(text, /user&amp;name/);
  assert.match(text, /Rp 123\.456/);
});

test('buildWebLinkedStatusText: web user unavailable', () => {
  const text = buildWebLinkedStatusText({ webDomain: 'https://web.test', webUser: null });
  assert.match(text, /Tidak bisa ambil info terbaru/);
});

test('buildWebLinkedStatusKeyboard: unlink and menu callbacks', () => {
  const kb = buildWebLinkedStatusKeyboard('https://web.test');
  assert.equal(kb.inline_keyboard[0][0].url, 'https://web.test');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'web_link_unlink');
  assert.equal(kb.inline_keyboard[2][0].callback_data, 'send_main_menu');
});

test('buildWebLinkInstructionsText and keyboard', () => {
  const text = buildWebLinkInstructionsText('https://web.test');
  const kb = buildWebLinkInstructionsKeyboard('https://web.test');
  assert.match(text, /Hubungkan Akun ke Web/);
  assert.match(text, /Login \(atau daftar\)/);
  assert.equal(kb.inline_keyboard[0][0].url, 'https://web.test');
});

test('buildWebUnlinkSuccessText and keyboard', () => {
  assert.match(buildWebUnlinkSuccessText(), /sudah diputuskan/);
  assert.equal(buildWebUnlinkSuccessKeyboard().inline_keyboard[0][0].callback_data, 'send_main_menu');
});
