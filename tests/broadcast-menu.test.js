'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBroadcastTargetText,
  buildBroadcastTargetKeyboard,
  getBroadcastTargetLabel,
  buildBroadcastModeText,
  buildBroadcastModeKeyboard,
  buildBroadcastCancelKeyboard,
  buildBroadcastBackToAdminKeyboard,
  buildBroadcastManualPromptText,
  buildBroadcastTemplatePromptText,
} = require('../lib/broadcast-menu');

test('buildBroadcastTargetText and keyboard: target menu', () => {
  assert.match(buildBroadcastTargetText(), /Kirim Pengumuman/);
  const kb = buildBroadcastTargetKeyboard();
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'broadcast_target_all');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'broadcast_target_reseller');
  assert.equal(kb.inline_keyboard[1][1].callback_data, 'broadcast_target_member');
  assert.equal(kb.inline_keyboard[2][0].callback_data, 'admin_menu');
});

test('getBroadcastTargetLabel and mode text', () => {
  assert.equal(getBroadcastTargetLabel('all'), 'semua user');
  assert.equal(getBroadcastTargetLabel('reseller'), 'semua reseller');
  assert.equal(getBroadcastTargetLabel('member'), 'member (bukan reseller & bukan admin)');
  assert.match(buildBroadcastModeText('member'), /member \(bukan reseller &amp; bukan admin\)/);
});

test('buildBroadcastModeKeyboard: mode callbacks', () => {
  const kb = buildBroadcastModeKeyboard();
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'broadcast_mode_manual');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'broadcast_mode_maintenance');
  assert.equal(kb.inline_keyboard[2][0].callback_data, 'broadcast_mode_maintenance_done');
  assert.equal(kb.inline_keyboard[3][0].callback_data, 'broadcast_mode_promo');
  assert.equal(kb.inline_keyboard[4][0].callback_data, 'broadcast_mode_slot');
  assert.equal(kb.inline_keyboard[5][0].callback_data, 'broadcast_mode_info');
  assert.equal(kb.inline_keyboard[6][0].callback_data, 'broadcast_cancel');
});

test('cancel/back keyboards and manual prompt', () => {
  assert.equal(buildBroadcastCancelKeyboard().inline_keyboard[0][0].callback_data, 'broadcast_cancel');
  assert.equal(buildBroadcastBackToAdminKeyboard().inline_keyboard[0][0].callback_data, 'admin_menu');
  assert.match(buildBroadcastManualPromptText(), /kirim teks pengumuman/);
});

test('buildBroadcastTemplatePromptText: template prompts', () => {
  assert.match(buildBroadcastTemplatePromptText('maintenance'), /Template Maintenance VPN/);
  assert.match(buildBroadcastTemplatePromptText('maintenanceDone'), /Maintenance Selesai/);
  assert.match(buildBroadcastTemplatePromptText('promo'), /Promo \/ Diskon VPN/);
  assert.match(buildBroadcastTemplatePromptText('slot'), /Slot \/ Stok Terbatas/);
  assert.match(buildBroadcastTemplatePromptText('info'), /Pengumuman Umum/);
});
