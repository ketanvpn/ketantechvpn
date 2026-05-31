'use strict';

function formatProvisioningFailure(rawMsg, options = {}) {
  const isTrial = Boolean(options.trial);
  const refundFailed = Boolean(options.refundFailed);
  const lowerFail = String(rawMsg || '').toLowerCase();
  const prefix = isTrial ? '❌ Gagal membuat akun trial.' : '❌ Gagal membuat akun.';

  let failText = `${prefix} Server sedang bermasalah, silakan coba lagi beberapa saat.`;

  if (lowerFail.includes('unauthorized') || lowerFail.includes('401')) {
    failText = `${prefix} Server target tidak terautentikasi (unauthorized). Silakan hubungi admin.`;
  } else if (lowerFail.includes('timeout') || lowerFail.includes('timed out') || lowerFail.includes('etimedout')) {
    failText = `${prefix} Server target terlalu lama merespons (timeout). Silakan coba lagi.`;
  } else if (lowerFail.includes('502') || lowerFail.includes('503') || lowerFail.includes('504') || lowerFail.includes('bad gateway')) {
    failText = `${prefix} Server target sedang gangguan. Silakan coba lagi beberapa saat.`;
  }

  if (refundFailed) {
    failText += '\n\n⚠️ Refund otomatis sedang bermasalah. Admin sudah diberi notifikasi untuk pengecekan manual.';
  }

  return failText;
}

module.exports = { formatProvisioningFailure };
