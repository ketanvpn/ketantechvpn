// lib/masker.js - masker untuk log & token

function maskLogMessage(msg) {
  if (msg == null) return msg;
  let text = typeof msg === 'string' ? msg : String(msg);
  text = text.replace(/bot\d{6,}:[A-Za-z0-9_-]{20,}/g, 'bot<REDACTED>');
  text = text.replace(/(BOT_TOKEN[=: ]+)([^\s"']+)/gi, '$1<REDACTED>');
  text = text.replace(/(Authorization[:=]\s*(?:Bearer\s+)?)([A-Za-z0-9._~+/=\-]{12,})/gi, '$1<REDACTED>');
  text = text.replace(/(api[_-]?key[=: ]+)([^\s"']+)/gi, '$1<REDACTED>');
  text = text.replace(/(token[=: ]+)([^\s"']+)/gi, '$1<REDACTED>');
  text = text.replace(/(password[=: ]+)([^\s"']+)/gi, '$1<REDACTED>');
  text = text.replace(/(auth_token[=: ]+)([^\s"']+)/gi, '$1<REDACTED>');
  return text;
}

function maskToken(token, head = 12, tail = 8) {
  const value = String(token || '').trim();
  if (!value) return '-';
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

module.exports = { maskLogMessage, maskToken };
