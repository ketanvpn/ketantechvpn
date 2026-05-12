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

module.exports = {
  isSafeSqlIdent,
  isSafeSqlIdentList,
  isValidUsername,
  isValidPassword,
  isValidPositiveInt,
  isValidNonNegativeInt,
};
