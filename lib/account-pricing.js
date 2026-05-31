'use strict';

function calculateAccountQuota(baseQuota, days) {
  let computedQuota = baseQuota;
  if (baseQuota && baseQuota > 0) {
    computedQuota = Math.max(1, Math.floor(baseQuota * days / 30));
  }
  return computedQuota;
}

function calculateAccountPrice(basePrice30Days, days, isReseller, resellerDiscount) {
  const baseHarga30 = Number(basePrice30Days) || 0;
  if (baseHarga30 <= 0) return 0;

  let totalHarga = Math.max(1, Math.floor(baseHarga30 * days / 30));
  if (isReseller) {
    totalHarga = Math.max(1, Math.floor(totalHarga * resellerDiscount));
  }
  return totalHarga;
}

module.exports = {
  calculateAccountQuota,
  calculateAccountPrice,
};
