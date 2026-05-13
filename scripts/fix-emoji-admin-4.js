// Emoji admin cleanup, batch 4: context messages that are NOT plain errors.
// Covers QRIS captions, rate-limit warnings, user status messages, and a few
// leftover bullets/prompts.

const fs = require('fs');
let src = fs.readFileSync('app.js', 'utf8');

const rules = [
  // === /health HARI INI di status lisensi (warning) ===
  { re: /'\u274c Status: <b>HARI INI<\/b>';/g,
    rep: "'\u26a0\ufe0f Status: <b>HARI INI</b>';", label: 'health license HARI INI' },

  // === Rate-limit warning (logger.warn) ===
  { re: /logger\.warn\(\s*`\u274c Kena limit Telegram \(429\) saat kirim ke \$\{targetId\}\. retry_after=\$\{retryAfter\}s`\s*\)/g,
    rep: 'logger.warn(\n            `\u23f3 Kena limit Telegram (429) saat kirim ke ${targetId}. retry_after=${retryAfter}s`\n          )',
    label: 'warn rate-limit broadcast all' },
  { re: /logger\.warn\(\s*`\u274c Kena limit Telegram \(429\) saat broadcastres ke \$\{targetId\}\. retry_after=\$\{retryAfter\}s`\s*\)/g,
    rep: 'logger.warn(\n            `\u23f3 Kena limit Telegram (429) saat broadcastres ke ${targetId}. retry_after=${retryAfter}s`\n          )',
    label: 'warn rate-limit broadcastres' },
  { re: /logger\.warn\(\s*`\u274c Kena limit Telegram \(429\) saat broadcastmem ke \$\{targetId\}\. retry_after=\$\{retryAfter\}s`\s*\)/g,
    rep: 'logger.warn(\n            `\u23f3 Kena limit Telegram (429) saat broadcastmem ke ${targetId}. retry_after=${retryAfter}s`\n          )',
    label: 'warn rate-limit broadcastmem' },

  // === QRIS template captions (user-facing, informational) ===
  { re: /`\u274c <b>QRIS EXPIRED<\/b>\\n`/g,
    rep: '`\u23f0 <b>QRIS EXPIRED</b>\\n`', label: 'qris expired header' },
  { re: /`\u274c <b>QRIS TOPUP DIBUAT<\/b>\\n`/g,
    rep: '`\ud83d\udcb3 <b>QRIS TOPUP DIBUAT</b>\\n`', label: 'qris topup header' },
  { re: /`\u274c <b>Berlaku \$\{QRIS_PAYMENT_TIMEOUT_MIN\} menit<\/b>\\n`/g,
    rep: '`\u23f3 <b>Berlaku ${QRIS_PAYMENT_TIMEOUT_MIN} menit</b>\\n`', label: 'qris berlaku' },
  { re: /`\u274c Masa berlaku QR: <b>\$\{timeoutMin\} menit<\/b>\\n\\n`/g,
    rep: '`\u23f3 Masa berlaku QR: <b>${timeoutMin} menit</b>\\n\\n`', label: 'qris masa berlaku' },

  // === Trial fitur admin disable (warning) ===
  { re: /'\u274c <b>Fitur trial sedang dimatikan oleh admin\.<\/b>\\n\\n'/g,
    rep: "'\u26d4 <b>Fitur trial sedang dimatikan oleh admin.</b>\\n\\n'", label: 'warn trial dimatikan' },

  // === Fitur penjualan hanya reseller (warning) ===
  { re: /'\u274c Fitur <b>Penjualan Saya<\/b> hanya untuk reseller\.'/g,
    rep: "'\ud83d\udeab Fitur <b>Penjualan Saya</b> hanya untuk reseller.'", label: 'warn penjualan hanya reseller' },

  // === Server penuh ===
  { re: /\? '\u274c <b>Server penuh, tidak bisa membuat akun baru\.<\/b>'/g,
    rep: "? '\u26d4 <b>Server penuh, tidak bisa membuat akun baru.</b>'", label: 'warn server penuh inline' },
  { re: /'\u274c <b>Server penuh\.<\/b> Tidak dapat membuat akun baru di server ini\.'/g,
    rep: "'\u26d4 <b>Server penuh.</b> Tidak dapat membuat akun baru di server ini.'", label: 'warn server penuh standalone' },

  // === Saldo & batas trial (warning) ===
  { re: /'\u274c \*Kamu belum memenuhi syarat saldo untuk memakai trial\.\*\\n\\n'/g,
    rep: "'\u26a0\ufe0f *Kamu belum memenuhi syarat saldo untuk memakai trial.*\\n\\n'", label: 'warn saldo trial' },
  { re: /`\u274c Minimal saldo untuk trial saat ini: \*Rp\$\{minBalance\}\*\\n`/g,
    rep: '`\u2022 Minimal saldo untuk trial saat ini: *Rp${minBalance}*\\n`', label: 'bullet minimal saldo trial' },
  { re: /`\u274c Saldo kamu saat ini\s+: \*Rp\$\{saldoUser\}\*\\n\\n`/g,
    rep: '`\u2022 Saldo kamu saat ini              : *Rp${saldoUser}*\\n\\n`', label: 'bullet saldo user trial' },
  { re: /'\u274c \*Batas trial harian untuk akun WATCHLIST sudah tercapai\.\*\\n\\n'/g,
    rep: "'\u26d4 *Batas trial harian untuk akun WATCHLIST sudah tercapai.*\\n\\n'", label: 'warn trial watchlist' },
  { re: /'\u274c \*Batas trial harian sudah tercapai\.\*\\n\\n'/g,
    rep: "'\u26d4 *Batas trial harian sudah tercapai.*\\n\\n'", label: 'warn trial harian' },
  { re: /'\u274c \*Saldo Anda tidak mencukupi untuk melakukan transaksi ini\.\*'/g,
    rep: "'\u26a0\ufe0f *Saldo Anda tidak mencukupi untuk melakukan transaksi ini.*'", label: 'warn saldo tidak cukup' },
  { re: /'\u274c \*Batas pembuatan akun harian untuk akun WATCHLIST sudah tercapai\.\*\\n\\n'/g,
    rep: "'\u26d4 *Batas pembuatan akun harian untuk akun WATCHLIST sudah tercapai.*\\n\\n'", label: 'warn create watchlist' },

  // === Prompt masukan username/password/masa aktif ===
  { re: /ctx\.reply\('\u274c \*Masukkan masa aktif \(hari\):\*'/g,
    rep: "ctx.reply('\u270f\ufe0f *Masukkan masa aktif (hari):*", label: 'prompt masukkan masa aktif' },
  { re: /ctx\.reply\('\u274c \*Masukkan username yang ingin dihapus:\*'/g,
    rep: "ctx.reply('\u270f\ufe0f *Masukkan username yang ingin dihapus:*", label: 'prompt masukkan username hapus' },

  // === Pilih server yang ingin dihapus ===
  { re: /ctx\.reply\('\u274c \*Pilih server yang ingin dihapus:\*'/g,
    rep: "ctx.reply('\ud83d\uddd1\ufe0f *Pilih server yang ingin dihapus:*", label: 'prompt pilih server hapus' },

  // === Edit nama server prompt ===
  { re: /'\u274c \*Silakan ketik nama server baru, lalu kirim sebagai pesan biasa\.\*\\n'/g,
    rep: "'\u270f\ufe0f *Silakan ketik nama server baru, lalu kirim sebagai pesan biasa.*\\n'", label: 'prompt edit nama server' },

  // === Detail server bullet Nama Server ===
  { re: /`\u274c \*Nama Server:\* \\`\$\{server\.nama_server\}\\`\\n`/g,
    rep: '`\u2022 *Nama Server:* \\`${server.nama_server}\\`\\n`', label: 'bullet detail nama server' },

  // === Perintah tidak dikenali ===
  { re: /ctx\.reply\('\u274c Perintah tidak dikenali\.'\)/g,
    rep: "ctx.reply('\u26a0\ufe0f Perintah tidak dikenali.')", label: 'warn perintah tidak dikenali' },

  // === list_all_users legend: bullet "Sudah expired" ===
  { re: /\u2022 \u274c Sudah expired/g, rep: '\u2022 \ud83d\udd12 Sudah expired', label: 'legend sudah expired' },

  // === 'Tidak bisa membaca data pengguna' (warning) ===
  { re: /ctx\.reply\('\u274c Tidak bisa membaca data pengguna\.'\)/g,
    rep: "ctx.reply('\u26a0\ufe0f Tidak bisa membaca data pengguna.')", label: 'warn baca data pengguna' },
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
console.log('\nTotal batch-4: ' + total);
console.log('Sisa X-mark: ' + ((src.match(/\u274c/g) || []).length));
fs.writeFileSync('app.js', src);
console.log('Tulis ke app.js');
