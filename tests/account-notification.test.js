const test = require('node:test');
const assert = require('node:assert/strict');
const { formatAccountGroupNotification } = require('../lib/account-notification');

test('formatAccountGroupNotification: create notification keeps existing shape and escapes HTML', () => {
  const text = formatAccountGroupNotification({
    action: 'create',
    serverName: 'Server <A>',
    userDisplay: 'eko&co',
    roleLabel: 'Member',
    username: 'user123',
    type: 'vmess',
    exp: 30,
    sisaHari: 30,
    expiredDateOnly: '30/06/2026',
  });

  assert.equal(text,
    '<blockquote>\n' +
    '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
    '<b>ACCOUNT CREATED</b>\n' +
    '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
    '<b>Server &lt;A&gt;</b>\n' +
    '<code>\n' +
    '-> Client  : eko&amp;co\n' +
    '-> Role    : Member\n' +
    '-> User    : <code>user123</code>\n' +
    '-> Type    : VMESS\n' +
    '-> Durasi  : 30 Hari\n' +
    '-> Expired : 30/06/2026\n' +
    '</code>\n' +
    '<code>━━━━━━━━━━━━━━━━━━━━</code>\n' +
    '</blockquote>'
  );
});

test('formatAccountGroupNotification: renew notification calculates previous remaining days', () => {
  const text = formatAccountGroupNotification({
    action: 'renew',
    serverName: 'Server A',
    userDisplay: 'reseller1',
    roleLabel: 'Reseller',
    username: 'abc123',
    type: 'ssh',
    exp: 7,
    sisaHari: 10,
    expiredDateOnly: '10/06/2026',
  });

  assert.match(text, /<b>ACCOUNT RENEWED<\/b>/);
  assert.match(text, /-> Sisa sebelum : 3 Hari/);
  assert.match(text, /-> Perpanjang   : \+7 Hari/);
  assert.match(text, /-> Sisa sekarang: 10 Hari/);
  assert.match(text, /-> Type    : SSH/);
});

test('formatAccountGroupNotification: renew previous remaining days never negative', () => {
  const text = formatAccountGroupNotification({
    action: 'renew', serverName: 'S', userDisplay: 'U', roleLabel: 'Member',
    username: 'abc', type: 'vless', exp: 30, sisaHari: 5, expiredDateOnly: 'x',
  });
  assert.match(text, /-> Sisa sebelum : 0 Hari/);
});
