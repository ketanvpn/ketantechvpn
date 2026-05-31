'use strict';

function isCancellableAccountFlowStep(step) {
  if (!step || typeof step !== 'string') return false;
  return (
    step.startsWith('username_create_') ||
    step.startsWith('username_renew_') ||
    step.startsWith('username_trial_') ||
    step.startsWith('username_del_') ||
    step.startsWith('username_lock_') ||
    step.startsWith('username_unlock_') ||
    step.startsWith('password_create_') ||
    step.startsWith('password_renew_') ||
    step.startsWith('exp_create_') ||
    step.startsWith('exp_renew_')
  );
}

function isCancelText(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'batal' || text === '/batal' || text === '❌ batal' || text === 'cancel' || text === '/cancel';
}

module.exports = {
  isCancellableAccountFlowStep,
  isCancelText,
};
