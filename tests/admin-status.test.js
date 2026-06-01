'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatBotStatusLicenseText,
  formatTrialInfoText,
  buildBotStatusText,
  buildHelpAdminMessage,
} = require('../lib/admin-status');

test('formatBotStatusLicenseText: lifetime and invalid info', () => {
  assert.equal(formatBotStatusLicenseText(null, null), '⚠️ Lisensi: <b>lifetime / belum diatur</b>');
  assert.equal(formatBotStatusLicenseText('2026-01-01', null), '⚠️ Tidak dapat membaca informasi lisensi.');
});

test('formatBotStatusLicenseText: active/today/expired states', () => {
  const expire = new Date('2026-01-01T00:00:00Z');
  assert.match(formatBotStatusLicenseText('x', { expire, daysLeft: 3 }), /Sisa  : <b>3<\/b> hari/);
  assert.match(formatBotStatusLicenseText('x', { expire, daysLeft: 0 }), /HARI INI/);
  assert.match(formatBotStatusLicenseText('x', { expire, daysLeft: -2 }), /Lewat : <b>2<\/b> hari/);
});

test('formatTrialInfoText: trial config and fallback', () => {
  assert.equal(formatTrialInfoText(null), '⚠️ Gagal membaca konfigurasi trial.');
  const text = formatTrialInfoText({
    enabled: true,
    maxPerDay: 2,
    durationHours: 3,
    minBalanceForTrial: 1000,
  });
  assert.match(text, /Status   : 🟢 ON/);
  assert.match(text, /Max\/hari : <b>2<\/b> x/);
  assert.match(text, /Durasi   : <b>3<\/b> jam/);
});

test('buildBotStatusText: includes major status sections', () => {
  const text = buildBotStatusText({
    storeName: 'KetanVPN',
    licenseText: 'lisensi ok',
    autoBackupEnabled: true,
    autoBackupIntervalHours: 12,
    backupChatId: '-1001',
    expiryReminderEnabled: false,
    expiryReminderHour: 7,
    expiryReminderMinute: 5,
    expiryReminderDaysBefore: 2,
    timeZone: 'Asia/Jayapura',
    trialInfoText: 'trial ok',
  });

  assert.match(text, /STATUS BOT VPN KetanVPN/);
  assert.match(text, /AUTO BACKUP DB/);
  assert.match(text, /Interval : <b>12 jam<\/b>/);
  assert.match(text, /Chat ID  : <code>-1001<\/code>/);
  assert.match(text, /Jam      : <b>07:05<\/b> \(zona Asia\/Jayapura\)/);
  assert.match(text, /trial ok/);
});

test('buildBotStatusText: backup fallback values', () => {
  const text = buildBotStatusText({ licenseText: '-', trialInfoText: '-' });
  assert.match(text, /Interval : <b>tidak di-set<\/b>/);
  assert.match(text, /Chat ID  : <i>belum di-set<\/i>/);
});

test('buildHelpAdminMessage: includes important admin commands', () => {
  const text = buildHelpAdminMessage();
  for (const expected of ['/admin', '/helpadmin', '/addsaldo', '/cekqris', '/health', '/setflag']) {
    assert.ok(text.includes(expected), `missing ${expected}`);
  }
});
