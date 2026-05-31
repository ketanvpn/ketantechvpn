const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isCancellableAccountFlowStep,
  isCancelText,
} = require('../lib/account-flow-state');

test('isCancellableAccountFlowStep: account pre-payment states are cancellable', () => {
  [
    'username_create_vmess',
    'username_renew_ssh',
    'username_trial_trojan',
    'username_del_vless',
    'username_lock_ssh',
    'username_unlock_shadowsocks',
    'password_create_ssh',
    'password_renew_ssh',
    'exp_create_vmess',
    'exp_renew_ssh',
  ].forEach((step) => assert.equal(isCancellableAccountFlowStep(step), true, step));
});

test('isCancellableAccountFlowStep: unrelated states are not cancellable by account cancel', () => {
  [
    '',
    null,
    'qris_topup_nominal',
    'addserver',
    'edit_nama',
    'wait_message',
    'reseller_domain',
  ].forEach((step) => assert.equal(isCancellableAccountFlowStep(step), false, String(step)));
});

test('isCancelText: supports common cancel words', () => {
  ['batal', '/batal', '❌ batal', 'cancel', '/cancel', ' BATAL '].forEach((value) => {
    assert.equal(isCancelText(value), true, value);
  });
  ['lanjut', 'ok', '', null].forEach((value) => {
    assert.equal(isCancelText(value), false, String(value));
  });
});
