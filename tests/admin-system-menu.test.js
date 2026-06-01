'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTimezoneStatusText,
  buildTimezoneKeyboard,
  buildExpiryReminderStatusText,
  buildExpiryReminderKeyboard,
  buildAutoBackupStatusText,
  buildAutoBackupKeyboard,
} = require('../lib/admin-system-menu');

test('buildTimezoneStatusText: includes current timezone and purpose', () => {
  const text = buildTimezoneStatusText({
    timeZone: 'Asia/Jayapura',
    now: new Date('2026-06-01T01:00:00Z'),
  });

  assert.match(text, /PENGATURAN TIMEZONE BOT/);
  assert.match(text, /Timezone saat ini: <b>Asia\/Jayapura<\/b>/);
  assert.match(text, /Laporan harian/);
});

test('buildTimezoneKeyboard: keeps timezone actions', () => {
  const callbacks = buildTimezoneKeyboard().inline_keyboard.flat().map((btn) => btn.callback_data);
  assert.deepEqual(callbacks, [
    'timezone_set_wib',
    'timezone_set_wita',
    'timezone_set_wit',
    'admin_menu',
  ]);
});

test('buildExpiryReminderStatusText: formats time and enabled status', () => {
  const text = buildExpiryReminderStatusText({
    enabled: true,
    hour: 7,
    minute: 5,
    daysBefore: 2,
  });

  assert.match(text, /Status       : <b>🟢 ON<\/b>/);
  assert.match(text, /Waktu kirim  : <b>07:05<\/b>/);
  assert.match(text, /Hari sebelum : <b>H-2<\/b>/);
});

test('buildExpiryReminderKeyboard: toggle label follows enabled state', () => {
  const off = buildExpiryReminderKeyboard({ enabled: false }).inline_keyboard[0][0].text;
  const on = buildExpiryReminderKeyboard({ enabled: true }).inline_keyboard[0][0].text;
  assert.equal(off, '🔔 Nyalakan Pengingat');
  assert.equal(on, '⛔ Matikan Pengingat');
});

test('buildAutoBackupStatusText: includes interval and destination', () => {
  const text = buildAutoBackupStatusText({
    enabled: false,
    intervalHours: 12,
    backupChatId: '-100123',
  });

  assert.match(text, /Status   : <b>🔴 OFF<\/b>/);
  assert.match(text, /Interval : <b>12<\/b> jam/);
  assert.match(text, /Tujuan   : <code>-100123<\/code>/);
});

test('buildAutoBackupKeyboard: toggle label follows enabled state', () => {
  const off = buildAutoBackupKeyboard({ enabled: false }).inline_keyboard[0][0].text;
  const on = buildAutoBackupKeyboard({ enabled: true }).inline_keyboard[0][0].text;
  assert.equal(off, '💾 Nyalakan Auto Backup');
  assert.equal(on, '⛔ Matikan Auto Backup');
});
