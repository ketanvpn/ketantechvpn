// Emoji admin cleanup, batch 2: SUCCESS & LOGGER.INFO.
// Ganti \u274c yang dipakai di pesan sukses / info log / loading state.
// \u274c di logger.error TETAP, karena memang error.

const fs = require('fs');
let src = fs.readFileSync('app.js', 'utf8');

const rules = [
  // === Success messages (admin actions) ===
  { re: /'\u274c \*Saldo user berhasil ditambahkan\.\*/g,
    rep: "'\u2705 *Saldo user berhasil ditambahkan.*", label: 'success saldo user' },

  // Server reseller berhasil ditambahkan
  { re: /`\u274c Server reseller \*\$\{state\.nama_server\}\* berhasil ditambahkan!`/g,
    rep: '`\u2705 Server reseller *${state.nama_server}* berhasil ditambahkan!`', label: 'success server reseller' },

  // Akun berhasil dibuat (waitCtrl.stop)
  { re: /waitCtrl\.stop\('\u274c Akun berhasil dibuat\./g,
    rep: "waitCtrl.stop('\u2705 Akun berhasil dibuat.", label: 'success akun dibuat' },

  // Server baru berhasil ditambahkan (ctx.reply)
  { re: /ctx\.reply\(`\u274c \*Server baru dengan domain \$\{domain\} telah berhasil ditambahkan\.\*/g,
    rep: 'ctx.reply(`\u2705 *Server baru dengan domain ${domain} telah berhasil ditambahkan.*', label: 'success server baru' },

  // Edit nama server berhasil
  { re: /`\u274c Nama berhasil diubah:\\n\*\$\{newName\}\*`/g,
    rep: '`\u2705 Nama berhasil diubah:\\n*${newName}*`', label: 'success nama server' },

  // Edit domain server berhasil
  { re: /`\u274c Domain server berhasil diubah:\\n`/g,
    rep: '`\u2705 Domain server berhasil diubah:\\n`', label: 'success domain server' },
  { re: /`\u274c Sebelumnya: \\`\$\{oldDomain\}\\`\\n`/g,
    rep: '`\u2022 Sebelumnya: \\`${oldDomain}\\`\\n`', label: 'bullet sebelumnya domain' },
  { re: /`\u274c Menjadi   : \\`\$\{newDomain\}\\``/g,
    rep: '`\u2022 Menjadi   : \\`${newDomain}\\``', label: 'bullet menjadi domain' },

  // Edit auth server berhasil
  { re: /'\u274c Auth server berhasil diubah:\\n'/g,
    rep: "'\u2705 Auth server berhasil diubah:\\n'", label: 'success auth server' },
  { re: /`\u274c Server : \\`\$\{nama\}\\`\\n`/g,
    rep: '`\u2022 Server : \\`${nama}\\`\\n`', label: 'bullet server auth' },
  { re: /`\u274c Domain : \\`\$\{domain\}\\`\\n`/g,
    rep: '`\u2022 Domain : \\`${domain}\\`\\n`', label: 'bullet domain auth' },
  { re: /`\u274c Sebelumnya: \\`\$\{maskedOld\}\\`\\n`/g,
    rep: '`\u2022 Sebelumnya: \\`${maskedOld}\\`\\n`', label: 'bullet sebelumnya auth' },
  { re: /`\u274c Menjadi   : \\`\$\{maskedNew\}\\``/g,
    rep: '`\u2022 Menjadi   : \\`${maskedNew}\\``', label: 'bullet menjadi auth' },

  // Edit harga server berhasil
  { re: /`\u274c \*Harga server berhasil diupdate\.\*/g,
    rep: '`\u2705 *Harga server berhasil diupdate.*', label: 'success harga server' },

  // Edit ${fieldName} server berhasil (quota/limit/batas/dll)
  { re: /`\u274c \*\$\{fieldName\} server berhasil diupdate\.\*/g,
    rep: '`\u2705 *${fieldName} server berhasil diupdate.*', label: 'success fieldName server' },

  // Saldo user berhasil ditambahkan (reply admin, 2 variasi)
  { re: /ctx\.reply\(`\u274c Saldo sebesar Rp\$\{amount\.toLocaleString\(\)\} berhasil ditambahkan ke user \$\{targetId\}\.`\)/g,
    rep: "ctx.reply(`\u2705 Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.`)",
    label: 'success admin saldo simple' },
  { re: /ctx\.reply\(\s*`\u274c Saldo sebesar Rp\$\{amount\.toLocaleString\(\)\} berhasil ditambahkan ke user \$\{targetId\}\./g,
    rep: 'ctx.reply(`\u2705 Saldo sebesar Rp${amount.toLocaleString()} berhasil ditambahkan ke user ${targetId}.', label: 'success admin saldo detail' },

  // === Info / Cancel messages (batal) ===
  { re: /'\u274c Pengumuman dibatalkan\.'/g, rep: "'\u26d4 Pengumuman dibatalkan.'", label: 'info pengumuman dibatalkan' },
  { re: /'\u274c Mengirim pengumuman, mohon tunggu\.\.\.'/g, rep: "'\u23f3 Mengirim pengumuman, mohon tunggu...'", label: 'loading pengumuman' },
  { re: /'\u274c Topup dibatalkan\.'/g, rep: "'\u26d4 Topup dibatalkan.'", label: 'info topup dibatalkan' },
  { re: /'\u274c Edit nama server dibatalkan\.'/g, rep: "'\u26d4 Edit nama server dibatalkan.'", label: 'info edit nama dibatalkan' },
  { re: /'\u274c Edit domain server dibatalkan\.'/g, rep: "'\u26d4 Edit domain server dibatalkan.'", label: 'info edit domain dibatalkan' },
  { re: /'\u274c Edit auth server dibatalkan\.'/g, rep: "'\u26d4 Edit auth server dibatalkan.'", label: 'info edit auth dibatalkan' },
  { re: /'\u274c Proses tambah server dibatalkan\.'/g, rep: "'\u26d4 Proses tambah server dibatalkan.'", label: 'info tambah server dibatalkan' },
  { re: /'\u274c Mode tandai user dibatalkan\.'/g, rep: "'\u26d4 Mode tandai user dibatalkan.'", label: 'info tandai user dibatalkan' },
  { re: /'\u274c \*Proses reset database dibatalkan\.\*'/g, rep: "'\u26d4 *Proses reset database dibatalkan.*'", label: 'info reset db dibatalkan' },
  { re: /ctx\.editMessageText\('\u274c Topup dibatalkan\./g,
    rep: "ctx.editMessageText('\u26d4 Topup dibatalkan.", label: 'info edit topup dibatalkan' },

  // answerCbQuery 'Tambah saldo dibatalkan' -> info cancel
  { re: /answerCbQuery\('\u274c \*Tambah saldo dibatalkan\.\*'/g,
    rep: "answerCbQuery('\u26d4 *Tambah saldo dibatalkan.*'", label: 'info tambah saldo dibatalkan' },

  // answerCbQuery 'Dibatalkan' tombol cancel generic
  { re: /answerCbQuery\('\u274c Dibatalkan'\)/g, rep: "answerCbQuery('\u26d4 Dibatalkan')", label: 'info cbquery dibatalkan' },

  // === Loading states ===
  { re: /ctx\.reply\('\u274c Sedang membuat QRIS\.\.\.'/g,
    rep: "ctx.reply('\u23f3 Sedang membuat QRIS...'", label: 'loading membuat QRIS' },
  { re: /startWaiting\(ctx, '\u274c Sedang membuat akun\.\.\.'\)/g,
    rep: "startWaiting(ctx, '\u23f3 Sedang membuat akun...')", label: 'loading membuat akun' },

  // === Logger.info (sukses / event info, bukan error) ===
  { re: /logger\.info\(`\u274c Akun \$\{type\} berhasil unlock/g,
    rep: 'logger.info(`\u2705 Akun ${type} berhasil unlock', label: 'log info unlock' },
  { re: /logger\.info\(`\u274c Akun \$\{type\} berhasil di kunci/g,
    rep: 'logger.info(`\u2705 Akun ${type} berhasil di kunci', label: 'log info lock' },
  { re: /logger\.info\(`\u274c Akun \$\{type\} berhasil dihapus/g,
    rep: 'logger.info(`\u2705 Akun ${type} berhasil dihapus', label: 'log info akun dihapus' },
  { re: /logger\.info\('\u274c Proses hapus server dimulai'\)/g,
    rep: "logger.info('\u2139\ufe0f Proses hapus server dimulai')", label: 'log info hapus server' },
  { re: /logger\.info\(`\u274c QRIS expired:/g,
    rep: 'logger.info(`\u23f0 QRIS expired:', label: 'log info qris expired' },
  { re: /logger\.info\(`\u274c QRIS PAID:/g,
    rep: 'logger.info(`\u2705 QRIS PAID:', label: 'log info qris paid' },
  { re: /logger\.info\(`\u274c QRIS polling aktif/g,
    rep: 'logger.info(`\u2139\ufe0f QRIS polling aktif', label: 'log info qris polling' },
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

console.log('\nTotal batch-2: ' + total);
console.log('Sisa X-mark: ' + ((src.match(/\u274c/g) || []).length));
fs.writeFileSync('app.js', src);
console.log('Tulis ke app.js');
