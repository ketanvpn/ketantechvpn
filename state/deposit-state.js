// state/deposit-state.js
// State in-memory bersama untuk flow topup deposit (numpad input + pending QRIS).
// Sebelumnya disimpan di `global.depositState` & `global.pendingDeposits`. Sekarang
// di-export sebagai object reference: object yang sama di-share antara app.js,
// payment/deposit.js, dan modul lain yang require file ini (module cache).
//
// Bentuk:
//   depositState[userId]      = { amount: '', action?: 'request_amount'|'confirm_amount', __t: ts }
//   pendingDeposits[uniqueCode] = { userId, baseAmount, totalAmount, ..., __t: ts }
//
// `__t` di-stamp oleh sweeper TTL di app.js untuk anti memory leak.

const depositState = {};
const pendingDeposits = {};

module.exports = {
  depositState,
  pendingDeposits,
};
