const test = require('node:test');
const assert = require('node:assert/strict');
const { isTxAction } = require('../lib/service-action-router');

test('isTxAction: protects account creation, renewal, and trial callbacks', () => {
  [
    'create_ssh',
    'create_vmess',
    'renew_vless',
    'trial_trojan',
    'create_username_ssh_1',
    'renew_username_vmess_2',
    'trial_username_vless_3',
  ].forEach((value) => assert.equal(isTxAction(value), true, value));
});

test('isTxAction: protects topup callbacks', () => {
  [
    'topup_manual',
    'topup_saldo',
    'qris_topup_confirm_yes',
  ].forEach((value) => assert.equal(isTxAction(value), true, value));
});

test('isTxAction: ignores unrelated callbacks', () => {
  [
    '',
    null,
    undefined,
    'service_create',
    'service_trial',
    'send_main_menu',
    'admin_menu',
    'navigate_create_ssh_1',
    'my_accounts',
  ].forEach((value) => assert.equal(isTxAction(value), false, String(value)));
});
