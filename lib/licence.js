// lib/licence.js - helper untuk cek lisensi EXPIRE_DATE

function getLicenseInfo(expireDate) {
  if (!expireDate) return null;

  const now = new Date();
  const expire = new Date(expireDate + 'T23:59:59');
  if (!Number.isFinite(expire.getTime())) return null;

  const diffMs = expire - now;
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return { expire, daysLeft };
}

module.exports = { getLicenseInfo };
