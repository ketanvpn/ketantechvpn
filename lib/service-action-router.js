'use strict';

const TX_ACTION_PREFIXES = [
  'create_',
  'renew_',
  'trial_',
];

const TX_ACTION_EXACT = new Set([
  'topup_manual',
  'topup_saldo',
  'qris_topup_confirm_yes',
]);

function isTxAction(data = '') {
  const value = String(data || '');
  return TX_ACTION_PREFIXES.some((prefix) => value.startsWith(prefix)) || TX_ACTION_EXACT.has(value);
}

module.exports = {
  TX_ACTION_PREFIXES,
  TX_ACTION_EXACT,
  isTxAction,
};
