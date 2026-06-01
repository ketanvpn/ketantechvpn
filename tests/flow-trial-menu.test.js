'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFlowPickServerText,
  buildFlowPickServerKeyboard,
  buildFlowConfirmText,
  buildFlowConfirmKeyboard,
} = require('../lib/flow-trial-menu');

test('buildFlowPickServerText: renders mode and type', () => {
  assert.equal(
    buildFlowPickServerText({ mode: 'trial', type: 'ssh' }),
    '<b>Trial SSH</b>\nPilih server:'
  );
  assert.equal(
    buildFlowPickServerText({ mode: 'create', type: 'vmess' }),
    '<b>Buat Akun VMESS</b>\nPilih server:'
  );
});

test('buildFlowPickServerKeyboard: server buttons and back', () => {
  const kb = buildFlowPickServerKeyboard([
    { id: 1, nama_server: 'SG-1' },
    { id: 2, nama_server: 'ID-1' },
  ]);
  assert.equal(kb.inline_keyboard[0][0].text, 'SG-1');
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'flow_pick_server:1');
  assert.equal(kb.inline_keyboard[2][0].callback_data, 'send_main_menu');
});

test('buildFlowConfirmText: renders escaped confirmation', () => {
  const text = buildFlowConfirmText({
    type: 'ssh',
    serverName: '<SG&1>',
    serverId: 1,
    username: '<eko&vpn>',
    durationHours: 25,
  });
  assert.match(text, /Konfirmasi Trial SSH/);
  assert.match(text, /&lt;SG&amp;1&gt;/);
  assert.match(text, /&lt;eko&amp;vpn&gt;/);
  assert.match(text, /25 jam/);
  assert.match(text, /2 hari dibulatkan/);
});

test('buildFlowConfirmKeyboard: confirm/back/cancel callbacks', () => {
  const kb = buildFlowConfirmKeyboard();
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'flow_confirm');
  assert.equal(kb.inline_keyboard[1][0].callback_data, 'flow_back_server');
  assert.equal(kb.inline_keyboard[2][0].callback_data, 'flow_cancel');
});
