// tests/html.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlEscape, mdToHtml } = require('../lib/html');

test('htmlEscape: null/undefined returns empty', () => {
  assert.equal(htmlEscape(null), '');
  assert.equal(htmlEscape(undefined), '');
});

test('htmlEscape: basic tags', () => {
  assert.equal(htmlEscape('<script>'), '&lt;script&gt;');
  assert.equal(htmlEscape('a & b'), 'a &amp; b');
  assert.equal(htmlEscape('"quoted"'), '&quot;quoted&quot;');
  assert.equal(htmlEscape("it's"), 'it&#39;s');
});

test('htmlEscape: mixed payload', () => {
  const input = `<b>admin</b> & "evil" 'hack'`;
  assert.equal(htmlEscape(input), '&lt;b&gt;admin&lt;/b&gt; &amp; &quot;evil&quot; &#39;hack&#39;');
});

test('mdToHtml: escapes then applies markdown', () => {
  assert.equal(mdToHtml('*bold* `code`'), '<b>bold</b> <code>code</code>');
  assert.equal(mdToHtml('<hack>'), '&lt;hack&gt;');
  assert.equal(mdToHtml(''), '');
});

test('mdToHtml: mixed content does not double-escape code', () => {
  assert.equal(mdToHtml('before `x<y>` after'), 'before <code>x&lt;y&gt;</code> after');
});
