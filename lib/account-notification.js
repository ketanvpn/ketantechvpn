'use strict';

const { htmlEscape } = require('./html');

function formatAccountGroupNotification({
  action,
  serverName,
  userDisplay,
  roleLabel,
  username,
  type,
  exp,
  sisaHari,
  expiredDateOnly,
} = {}) {
  if (action === 'create') {
    return '<blockquote>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '<b>ACCOUNT CREATED</b>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '<b>' + htmlEscape(serverName) + '</b>\n' +
      '<code>\n' +
      '-> Client  : ' + htmlEscape(userDisplay) + '\n' +
      '-> Role    : ' + htmlEscape(roleLabel) + '\n' +
      '-> User    : <code>' + htmlEscape(username) + '</code>\n' +
      '-> Type    : ' + htmlEscape(type).toUpperCase() + '\n' +
      '-> Durasi  : ' + exp + ' Hari\n' +
      '-> Expired : ' + expiredDateOnly + '\n' +
      '</code>\n' +
      '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
      '</blockquote>';
  }

  const sisaSebelum = Math.max(Number(sisaHari) - Number(exp), 0);
  return '<blockquote>\n' +
    '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
    '<b>ACCOUNT RENEWED</b>\n' +
    '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
    '<b>' + htmlEscape(serverName) + '</b>\n' +
    '<code>\n' +
    '-> Client  : ' + htmlEscape(userDisplay) + '\n' +
    '-> Role    : ' + htmlEscape(roleLabel) + '\n' +
    '-> User    : <code>' + htmlEscape(username) + '</code>\n' +
    '-> Type    : ' + htmlEscape(type).toUpperCase() + '\n' +
    '-> Sisa sebelum : ' + sisaSebelum + ' Hari\n' +
    '-> Perpanjang   : +' + exp + ' Hari\n' +
    '-> Sisa sekarang: ' + sisaHari + ' Hari\n' +
    '-> Expired      : ' + expiredDateOnly + '\n' +
    '</code>\n' +
    '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
    '</blockquote>';
}

module.exports = { formatAccountGroupNotification };
