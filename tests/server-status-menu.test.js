'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  escapeHtml,
  cleanServerStatusOutput,
  buildServerStatusResultText,
} = require('../lib/server-status-menu');

test('escapeHtml: escapes telegram HTML chars', () => {
  assert.equal(escapeHtml('<a&b>'), '&lt;a&amp;b&gt;');
});

test('cleanServerStatusOutput: strips ansi, escapes html, handles empty', () => {
  assert.equal(cleanServerStatusOutput('\x1b[32mOPEN\x1b[0m <ok>'), 'OPEN &lt;ok&gt;');
  assert.equal(cleanServerStatusOutput(''), 'Tidak ada output dari skrip cek-port.sh.');
});

test('cleanServerStatusOutput: truncates long output', () => {
  const text = cleanServerStatusOutput('abcdef', 3);
  assert.equal(text, 'abc\n... (dipotong, output terlalu panjang)');
});

test('buildServerStatusResultText: renders timestamp, output and legend', () => {
  const text = buildServerStatusResultText({
    stdout: '443 OPEN',
    timestamp: '01/06/2026 12.00',
  });

  assert.match(text, /STATUS SERVER/);
  assert.match(text, /Waktu cek: <b>01\/06\/2026 12\.00<\/b>/);
  assert.match(text, /<pre>443 OPEN<\/pre>/);
  assert.match(text, /OPEN/);
  assert.match(text, /CLOSED/);
  assert.match(text, /TIMEOUT/);
});
