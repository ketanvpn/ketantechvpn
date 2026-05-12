// lib/time.js - helper waktu dengan timezone konfigurasi

function getTimeInConfiguredTimeZone(timeZone) {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);

  const dateKey = `${year}-${month}-${day}`;

  return { dateKey, hour, minute };
}

function getAccountDaysLeft(expiresAtMs) {
  if (!expiresAtMs) return null;

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  const expDate = new Date(expiresAtMs);
  const expDayStart = new Date(
    expDate.getFullYear(),
    expDate.getMonth(),
    expDate.getDate()
  ).getTime();

  const diffDays = Math.round(
    (expDayStart - todayStart) / (1000 * 60 * 60 * 24)
  );

  return diffDays;
}

function getMonthRange(offsetMonths = 0, timeZone) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 1);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    year: start.getFullYear(),
    month: start.getMonth() + 1,
    monthKey: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
    label: start.toLocaleDateString('id-ID', {
      timeZone,
      year: 'numeric',
      month: 'long',
    }),
  };
}

function typeCode(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'vmess') return 'VM';
  if (t === 'vless') return 'VL';
  if (t === 'ssh') return 'SH';
  if (t === 'trojan') return 'TJ';
  if (t === 'shadowsocks') return 'SS';
  return (t.slice(0, 2) || '??').toUpperCase();
}

function shortStatus(expiresAtMs, emojiSet) {
  const daysLeft = getAccountDaysLeft(expiresAtMs);
  const emoji = emojiSet || {};
  if (daysLeft === null || typeof daysLeft === 'undefined') return emoji.unknown || '\u2753';
  if (daysLeft > 0) return `${emoji.active || '\u2705'}A${daysLeft}`;
  if (daysLeft === 0) return `${emoji.warning || '\u26A0\uFE0F'}A0`;
  return `${emoji.expired || '\u274C'}X`;
}

module.exports = {
  getTimeInConfiguredTimeZone,
  getAccountDaysLeft,
  getMonthRange,
  typeCode,
  shortStatus,
};
