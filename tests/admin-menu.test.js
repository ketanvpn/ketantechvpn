'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatAdminLicenseStatus,
  buildAdminMenuHeader,
  buildAdminMenuKeyboard,
} = require('../lib/admin-menu');

test('formatAdminLicenseStatus: active license', () => {
  const text = formatAdminLicenseStatus({
    expire: new Date('2026-12-31T00:00:00Z'),
    daysLeft: 10,
  }, 'Asia/Jayapura');

  assert.match(text, /INFO LISENSI BOT/);
  assert.match(text, /Aktif sampai:/);
  assert.match(text, /Sisa: <b>10<\/b> hari/);
});

test('formatAdminLicenseStatus: expires today', () => {
  const text = formatAdminLicenseStatus({
    expire: new Date('2026-12-31T00:00:00Z'),
    daysLeft: 0,
  }, 'Asia/Jayapura');

  assert.match(text, /Berakhir:/);
  assert.match(text, /HARI INI/);
});

test('formatAdminLicenseStatus: expired license', () => {
  const text = formatAdminLicenseStatus({
    expire: new Date('2026-12-31T00:00:00Z'),
    daysLeft: -3,
  }, 'Asia/Jayapura');

  assert.match(text, /Habis:/);
  assert.match(text, /Lewat: <b>3<\/b> hari lalu/);
});

test('buildAdminMenuHeader: includes license info when available', () => {
  const header = buildAdminMenuHeader({
    expireDate: '2026-12-31',
    licenseInfo: {
      expire: new Date('2026-12-31T00:00:00Z'),
      daysLeft: 5,
    },
    timeZone: 'Asia/Jayapura',
  });

  assert.match(header, /MENU ADMIN/);
  assert.match(header, /INFO LISENSI BOT/);
});

test('buildAdminMenuKeyboard: keeps key admin actions', () => {
  const buttons = buildAdminMenuKeyboard().flat();
  const callbacks = buttons.map((btn) => btn.callback_data);

  for (const expected of [
    'monitor_panel',
    'admin_trial_menu',
    'admin_reseller_menu',
    'admin_server_menu',
    'backup_auto_menu',
    'timezone_menu',
    'send_main_menu',
  ]) {
    assert.ok(callbacks.includes(expected), `missing callback ${expected}`);
  }
});
