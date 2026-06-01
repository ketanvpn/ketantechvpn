'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatLicenseInfoText,
  buildMainMenuMessage,
  buildMainMenuKeyboard,
} = require('../lib/main-menu');

test('formatLicenseInfoText: lifetime fallback when no expire date', () => {
  assert.equal(
    formatLicenseInfoText(null, null),
    '⚠️ Lisensi bot tidak dibatasi tanggal (lifetime) atau belum diatur.\n'
  );
});

test('formatLicenseInfoText: expired state', () => {
  const text = formatLicenseInfoText('2026-01-01', {
    expire: new Date('2026-01-01T00:00:00Z'),
    daysLeft: -2,
  });

  assert.match(text, /🔒 Lisensi habis:/);
  assert.match(text, /Lewat: <b>2<\/b> hari lalu/);
});

test('buildMainMenuMessage: shows web saldo marker and admin panel', () => {
  const msg = buildMainMenuMessage({
    storeName: 'KetanVPN',
    userName: 'Bos',
    userId: 123,
    saldo: 25000,
    saldoSource: 'web',
    isAdmin: true,
    expireDate: null,
  });

  assert.match(msg, /BOT VPN KetanVPN/);
  assert.match(msg, /Nama   : <b>Bos<\/b>/);
  assert.match(msg, /Saldo  : <code>Rp 25\.000<\/code> 🌐/);
  assert.match(msg, /Status : <code>👑 Admin<\/code>/);
  assert.match(msg, /COMMAND PANEL/);
});

test('buildMainMenuKeyboard: member has reseller upgrade button', () => {
  const keyboard = buildMainMenuKeyboard({ isReseller: false, isAdmin: false });
  assert.ok(keyboard.flat().some((btn) => btn.callback_data === 'jadi_reseller'));
  assert.ok(!keyboard.flat().some((btn) => btn.callback_data === 'sales_summary'));
});

test('buildMainMenuKeyboard: reseller gets sales button and no upgrade button', () => {
  const keyboard = buildMainMenuKeyboard({ isReseller: true, isAdmin: false });
  assert.ok(keyboard.flat().some((btn) => btn.callback_data === 'sales_summary'));
  assert.ok(!keyboard.flat().some((btn) => btn.callback_data === 'jadi_reseller'));
});

test('buildMainMenuKeyboard: web link label follows linked state', () => {
  const unlinked = buildMainMenuKeyboard({ webLinkEnabled: true, webLinked: false }).flat();
  const linked = buildMainMenuKeyboard({ webLinkEnabled: true, webLinked: true }).flat();

  assert.ok(unlinked.some((btn) => btn.text === '🔗 Hubungkan Akun ke Web'));
  assert.ok(linked.some((btn) => btn.text === '✅ Akun Web Terhubung'));
});
