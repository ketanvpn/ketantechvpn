// Emoji admin cleanup, batch 5: permission/access denials -> \u1f6ab (\ud83d\udeab)
// Sisanya (Terjadi kesalahan/Gagal/logger.error/validation) memang error asli,
// jadi dibiarkan pakai \u274c.

const fs = require('fs');
let src = fs.readFileSync('app.js', 'utf8');

const rules = [
  // Permission denial 'Menu ini khusus admin' (ada ~11 occurrences)
  { re: /'\u274c \*Menu ini khusus admin\.\*'/g,
    rep: "'\ud83d\udeab *Menu ini khusus admin.*'", label: 'deny menu khusus admin' },
  // Permission denial 'Fitur ini hanya untuk Ressel VPN'
  { re: /'\u274c \*Fitur ini hanya untuk Ressel VPN\.\*'/g,
    rep: "'\ud83d\udeab *Fitur ini hanya untuk Ressel VPN.*'", label: 'deny ressel only' },
];

let total = 0;
for (const r of rules) {
  const before = src;
  src = src.replace(r.re, r.rep);
  const xBefore = (before.match(/\u274c/g) || []).length;
  const xAfter  = (src.match(/\u274c/g) || []).length;
  const diff = xBefore - xAfter;
  if (diff > 0) console.log('  ' + diff + 'x  ' + r.label);
  total += diff;
}
console.log('\nTotal batch-5: ' + total);
console.log('Sisa X-mark: ' + ((src.match(/\u274c/g) || []).length));
fs.writeFileSync('app.js', src);
console.log('Tulis ke app.js');
