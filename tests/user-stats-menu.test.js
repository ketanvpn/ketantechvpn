'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getAccountTypeLabel,
  formatAccountDateTime,
  formatAccountExpireDate,
  buildMyStatsText,
  buildMyStatsKeyboard,
} = require('../lib/user-stats-menu');

test('getAccountTypeLabel: known and unknown types', () => {
  assert.equal(getAccountTypeLabel('ssh'), '🖥️ SSH');
  assert.equal(getAccountTypeLabel('vmess'), '🔐 VMess');
  assert.equal(getAccountTypeLabel('vless'), '🔒 VLess');
  assert.equal(getAccountTypeLabel('trojan'), '🛡️ Trojan');
  assert.equal(getAccountTypeLabel('shadowsocks'), '🌶️ Shadowsocks');
  assert.equal(getAccountTypeLabel('custom'), 'custom');
  assert.equal(getAccountTypeLabel(null), '-');
});

test('formatAccountDateTime and expire date handle empty values', () => {
  assert.equal(formatAccountDateTime(null), '-');
  assert.equal(formatAccountExpireDate(null), 'Tanpa masa aktif');
});

test('buildMyStatsText: empty account list', () => {
  const text = buildMyStatsText({
    totalAll: 0,
    totalActive: 0,
    totalExpired: 0,
    currentPage: 0,
    totalPages: 1,
    accounts: [],
  });

  assert.match(text, /Riwayat Akun Kamu/);
  assert.match(text, /Total dibuat   : <b>0<\/b> akun/);
  assert.match(text, /Belum ada akun yang tercatat/);
});

test('buildMyStatsText: renders account rows with pagination offset', () => {
  const text = buildMyStatsText({
    totalAll: 11,
    totalActive: 8,
    totalExpired: 3,
    currentPage: 1,
    totalPages: 2,
    offset: 10,
    timeZone: 'Asia/Jayapura',
    accounts: [
      {
        username: 'eko1',
        type: 'vless',
        server_id: 7,
        nama_server: 'SG-1',
        domain: 'sg.example.com',
        created_at: Date.UTC(2026, 0, 1, 1, 0),
        expires_at: Date.UTC(2026, 0, 31, 1, 0),
      },
    ],
  });

  assert.match(text, /halaman 2 dari 2/);
  assert.match(text, /#11 🔒 VLess/);
  assert.match(text, /User   : <b>eko1<\/b>/);
  assert.match(text, /Server : SG-1/);
});

test('buildMyStatsKeyboard: previous and next buttons', () => {
  const keyboard = buildMyStatsKeyboard({ currentPage: 1, totalPages: 3 }).inline_keyboard;
  assert.deepEqual(keyboard[0], [
    { text: '⬅️ Sebelumnya', callback_data: 'my_stats:0' },
    { text: 'Selanjutnya ➡️', callback_data: 'my_stats:2' },
  ]);
  assert.equal(keyboard[1][0].callback_data, 'send_main_menu');
});

test('buildMyStatsKeyboard: first page only next', () => {
  const keyboard = buildMyStatsKeyboard({ currentPage: 0, totalPages: 2 }).inline_keyboard;
  assert.deepEqual(keyboard[0], [
    { text: 'Selanjutnya ➡️', callback_data: 'my_stats:1' },
  ]);
});
