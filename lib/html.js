// lib/html.js - helper HTML escape untuk Telegram
function htmlEscape(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mdToHtml(text) {
  if (text == null) return '';
  let escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  escaped = escaped.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  return escaped;
}

module.exports = { htmlEscape, mdToHtml };
