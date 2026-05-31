// lib/validators.js - validator input user & SQL identifier
const SQL_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const USERNAME_RE = /^[A-Za-z0-9]+$/;
const PASSWORD_RE = /^[A-Za-z0-9._!@#\-]{3,32}$/;

function isSafeSqlIdent(name) {
  return typeof name === 'string' && SQL_IDENT_RE.test(name);
}

function isSafeSqlIdentList(csv) {
  if (typeof csv !== 'string') return false;
  return csv.split(',').every((part) => isSafeSqlIdent(part.trim()));
}

function isValidUsername(value) {
  return typeof value === 'string' && USERNAME_RE.test(value);
}

function isValidPassword(value) {
  return typeof value === 'string' && PASSWORD_RE.test(value);
}

function isValidPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

function isValidNonNegativeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

function validateAccountUsernameInput(value) {
  const username = String(value || '').trim();
  if (!username) {
    return { ok: false, message: '❌ *Username tidak valid. Masukkan username yang valid.*' };
  }
  if (username.length < 4 || username.length > 20) {
    return { ok: false, message: '❌ *Username harus terdiri dari 4 hingga 20 karakter.*' };
  }
  if (/[A-Z]/.test(username)) {
    return { ok: false, message: '❌ *Username tidak boleh menggunakan huruf kapital. Gunakan huruf kecil saja.*' };
  }
  if (/[^a-z0-9]/.test(username)) {
    return { ok: false, message: '❌ *Username tidak boleh mengandung karakter khusus atau spasi. Gunakan huruf kecil dan angka saja.*' };
  }
  return { ok: true, value: username };
}

function validateManageUsernameInput(value) {
  const username = String(value || '').trim();
  if (!/^[a-z0-9]{3,20}$/.test(username)) {
    return { ok: false, message: '❌ *Username tidak valid. Gunakan huruf kecil dan angka (3–20 karakter).*' };
  }
  return { ok: true, value: username };
}

function validateAccountPasswordInput(value) {
  const password = String(value || '').trim();
  if (!password) {
    return { ok: false, message: '❌ *Password tidak valid. Masukkan password yang valid.*' };
  }
  if (password.length < 3) {
    return { ok: false, message: '❌ *Password harus terdiri dari minimal 3 karakter.*' };
  }
  if (/[^a-zA-Z0-9]/.test(password)) {
    return { ok: false, message: '❌ *Password tidak boleh mengandung karakter khusus atau spasi.*' };
  }
  return { ok: true, value: password };
}

function validateAccountExpiryInput(value) {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) {
    return { ok: false, message: '❌ *Masa aktif hanya boleh angka, contoh: 30*' };
  }
  const exp = parseInt(raw, 10);
  if (Number.isNaN(exp) || exp <= 0) {
    return { ok: false, message: '❌ *Masa aktif tidak valid. Masukkan angka yang valid.*' };
  }
  if (exp > 365) {
    return { ok: false, message: '❌ *Masa aktif tidak boleh lebih dari 365 hari.*' };
  }
  return { ok: true, value: exp };
}

module.exports = {
  isSafeSqlIdent,
  isSafeSqlIdentList,
  isValidUsername,
  isValidPassword,
  isValidPositiveInt,
  isValidNonNegativeInt,
  validateAccountUsernameInput,
  validateManageUsernameInput,
  validateAccountPasswordInput,
  validateAccountExpiryInput,
};
