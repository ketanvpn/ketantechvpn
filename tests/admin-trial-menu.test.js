'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatWatchlistTrialLabel,
  buildAdminTrialMenuText,
  buildAdminTrialMenuKeyboard,
  buildAdminTrialSaveSuccessText,
  buildAdminTrialBackKeyboard,
} = require('../lib/admin-trial-menu');

const cfg = {
  enabled: true,
  maxPerDay: 2,
  durationHours: 3,
  minBalanceForTrial: 10000,
  watchlistMaxPerDay: 1,
};

test('formatWatchlistTrialLabel: zero disables trial label', () => {
  assert.equal(formatWatchlistTrialLabel(0), 'tidak boleh trial');
  assert.equal(formatWatchlistTrialLabel(2), '2x per hari');
});

test('buildAdminTrialMenuText: renders current config', () => {
  const text = buildAdminTrialMenuText(cfg);
  assert.match(text, /Pengaturan Trial Akun/);
  assert.match(text, /Aktif ✅/);
  assert.match(text, /2x/);
  assert.match(text, /3 jam/);
  assert.match(text, /Rp10000/);
  assert.match(text, /1x per hari/);
  assert.match(text, /belum disimpan/);
});

test('buildAdminTrialMenuKeyboard: renders callbacks and labels', () => {
  const kb = buildAdminTrialMenuKeyboard(cfg);
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'admin_trial_toggle');
  assert.equal(kb.inline_keyboard[0][0].text, '⛔ Matikan Trial');
  assert.equal(kb.inline_keyboard[1][1].text, 'Max/Hari: 2x');
  assert.equal(kb.inline_keyboard[2][1].text, 'Lama: 3 jam');
  assert.equal(kb.inline_keyboard[3][1].text, 'Min Saldo: Rp10000');
  assert.equal(kb.inline_keyboard[4][1].text, 'WATCHLIST: 1x');
  assert.equal(kb.inline_keyboard[5][0].callback_data, 'admin_trial_save');
  assert.equal(kb.inline_keyboard[6][0].callback_data, 'admin_menu');
});

test('buildAdminTrialMenuKeyboard: toggle label when disabled', () => {
  const kb = buildAdminTrialMenuKeyboard({ ...cfg, enabled: false });
  assert.equal(kb.inline_keyboard[0][0].text, '✅ Aktifkan Trial');
});

test('buildAdminTrialSaveSuccessText and back keyboard', () => {
  const text = buildAdminTrialSaveSuccessText({ ...cfg, watchlistMaxPerDay: 0 });
  assert.match(text, /berhasil disimpan/);
  assert.match(text, /tidak boleh trial/);

  const kb = buildAdminTrialBackKeyboard();
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'admin_menu');
});
