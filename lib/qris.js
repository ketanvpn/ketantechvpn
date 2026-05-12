// lib/qris.js
// Encoder QRIS dinamis (EMV) + helper matcher transaksi dari provider.
// Pure, tidak akses db/logger/bot. Bisa di-test isolated.

function buildStaticQrisImageUrl(qrString) {
  const payload = String(qrString || '').trim();
  if (!payload) return '';
  return `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(payload)}`;
}

function buildEmvTag(tag, value) {
  const v = String(value ?? '');
  return `${tag}${String(v.length).padStart(2, '0')}${v}`;
}

function crc16Ccitt(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function removeTag54(payload) {
  const idx = payload.indexOf('54');
  if (idx === -1) return payload;
  const len = Number.parseInt(payload.slice(idx + 2, idx + 4), 10);
  if (!Number.isFinite(len) || len < 0) return payload;
  return payload.slice(0, idx) + payload.slice(idx + 4 + len);
}

function buildDynamicQrisPayload(baseQrString, amount) {
  const nominal = Number(amount || 0);
  if (!Number.isFinite(nominal) || nominal <= 0) {
    throw new Error('Nominal QRIS dinamis tidak valid');
  }

  let payload = String(baseQrString || '').trim();
  if (!payload) {
    throw new Error('Base QRIS kosong');
  }

  const crcPos = payload.lastIndexOf('6304');
  if (crcPos >= 0) {
    payload = payload.slice(0, crcPos);
  }

  if (payload.includes('010211')) {
    payload = payload.replace('010211', '010212');
  } else if (!payload.includes('010212') && payload.startsWith('00020101')) {
    payload = payload.replace('00020101', '000201010212');
  }

  payload = removeTag54(payload);

  const amountTag = buildEmvTag('54', String(Math.round(nominal)));
  if (payload.includes('5802ID')) {
    payload = payload.replace('5802ID', `${amountTag}5802ID`);
  } else {
    payload += amountTag;
  }

  const unsignedPayload = `${payload}6304`;
  return `${unsignedPayload}${crc16Ccitt(unsignedPayload)}`;
}

function parseProviderTransactionTime(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const directTs = Number(raw);
  if (Number.isFinite(directTs) && directTs > 0) {
    return directTs > 1e12 ? directTs : directTs * 1000;
  }

  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildProviderTransactionFingerprint(trx) {
  if (!trx || typeof trx !== 'object') return '';
  const explicitId = String(trx.id || trx.transaction_id || trx.tx_id || '').trim();
  if (explicitId) return `id:${explicitId}`;

  const amount = Number(trx.amount || 0);
  const timeMs = parseProviderTransactionTime(trx.time || trx.created_at || trx.updated_at || trx.transaction_time) || 0;
  const issuer = String(trx.issuer || '').trim().toLowerCase();
  const paymentType = String(trx.payment_type || '').trim().toLowerCase();
  const status = String(trx.status || '').trim().toLowerCase();
  return `fp:${amount}|${timeMs}|${issuer}|${paymentType}|${status}`;
}

function findMatchingSettlementTransaction(transactions, expectedAmount, options = {}) {
  const expected = Number(expectedAmount || 0);
  if (!Array.isArray(transactions) || expected <= 0) return null;

  const { createdAt = 0, windowBeforeMs = 5 * 60 * 1000, windowAfterMs = 60 * 60 * 1000 } = options || {};
  const minTime = createdAt > 0 ? createdAt - windowBeforeMs : 0;
  const maxTime = createdAt > 0 ? createdAt + windowAfterMs : Infinity;

  return (
    transactions.find((trx) => {
      const amount = Number(trx?.amount || 0);
      const status = String(trx?.status || '').toLowerCase();
      if (amount !== expected || status !== 'settlement') return false;
      if (createdAt <= 0) return true;
      const trxTime = parseProviderTransactionTime(
        trx?.transaction_time || trx?.time || trx?.paid_at || trx?.created_at || trx?.updated_at
      );
      if (!trxTime) return true;
      return trxTime >= minTime && trxTime <= maxTime;
    }) || null
  );
}

module.exports = {
  buildStaticQrisImageUrl,
  buildEmvTag,
  crc16Ccitt,
  removeTag54,
  buildDynamicQrisPayload,
  parseProviderTransactionTime,
  buildProviderTransactionFingerprint,
  findMatchingSettlementTransaction,
};
