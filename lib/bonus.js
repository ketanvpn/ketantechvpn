// lib/bonus.js - kalkulasi bonus top up tier
function calculateTopupBonus(amount, cfg) {
  const {
    enabled = true,
    tier1Min = 10000,
    tier1Percent = 5,
    tier2Min = 100000,
    tier2Percent = 7,
    tier3Min = 200000,
    tier3Percent = 10,
  } = cfg || {};

  if (!enabled) return { bonus: 0, percent: 0 };

  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return { bonus: 0, percent: 0 };

  let percent = 0;
  if (n >= tier3Min) percent = tier3Percent;
  else if (n >= tier2Min) percent = tier2Percent;
  else if (n >= tier1Min) percent = tier1Percent;

  if (percent <= 0) return { bonus: 0, percent: 0 };

  const bonus = Math.floor((n * percent) / 100);
  return { bonus, percent };
}

module.exports = { calculateTopupBonus };
