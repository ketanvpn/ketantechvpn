// Patch 3 blok remaining fs.readFile(resselDbPath) yang crash kalau file tidak ada.
// Ganti jadi tolerant ENOENT -> anggap user bukan reseller.
const fs = require('fs');

// Regex toleran terhadap CRLF dan indentation.
const re = /fs\.readFile\(resselDbPath, 'utf8', async \(err, data\) => \{\r?\n(\s+)if \(err\) \{\r?\n\s+logger\.error\('\u274c Gagal membaca file ressel\.db:', err\.message\);\r?\n\s+return ctx\.reply\('\u274c \*Terjadi kesalahan saat membaca data reseller\.\*', \{ parse_mode: 'Markdown' \}\);\r?\n\s+\}/g;

let s = fs.readFileSync('app.js', 'utf8');
const matches = s.match(re);
const before = matches ? matches.length : 0;
console.log('Matches found: ' + before);

s = s.replace(re, (full, indent) => {
  const NL = full.includes('\r\n') ? '\r\n' : '\n';
  return "fs.readFile(resselDbPath, 'utf8', async (err, data) => {" + NL
    + indent + "if (err) {" + NL
    + indent + "  if (err.code === 'ENOENT') {" + NL
    + indent + "    logger.warn('ressel.db belum ada, anggap user bukan reseller.');" + NL
    + indent + "    data = '';" + NL
    + indent + "  } else {" + NL
    + indent + "    logger.error('\u26a0\ufe0f Gagal membaca file ressel.db:', err.message);" + NL
    + indent + "    return ctx.reply('\u26a0\ufe0f *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });" + NL
    + indent + "  }" + NL
    + indent + "}";
});

fs.writeFileSync('app.js', s);
console.log('Replaced ' + before + ' occurrence(s).');
