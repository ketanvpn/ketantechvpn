// Emoji admin cleanup, batch 3b: bullets di template literal multi-line
// (reseller bonus progress + penjualan saya). String literal pakai newline
// asli, jadi rule perlu tanpa \n escape.

const fs = require('fs');
let src = fs.readFileSync('app.js', 'utf8');

const rules = [
  // Reseller bonus progress
  { re: /\u274c Akun valid bonus\s+: <b>\$\{bonusStats\.validAccounts\}<\/b> akun/g,
    rep: '\u2022 Akun valid bonus       : <b>${bonusStats.validAccounts}</b> akun', label: 'bullet bonus akun valid' },
  { re: /\u274c Omzet valid estimasi\s+: <b>Rp\$\{Number\(bonusStats\.validOmzet \|\| 0\)\.toLocaleString\('id-ID'\)\}<\/b>/g,
    rep: "\u2022 Omzet valid estimasi   : <b>Rp${Number(bonusStats.validOmzet || 0).toLocaleString('id-ID')}</b>", label: 'bullet bonus omzet' },
  { re: /\u274c Min durasi dihitung\s+: <b>\$\{RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS\}<\/b> hari/g,
    rep: '\u2022 Min durasi dihitung    : <b>${RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS}</b> hari', label: 'bullet bonus min durasi' },
  { re: /\u274c Min omzet \/ hari\s+: <b>Rp\$\{Number\(RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET \|\| 0\)\.toLocaleString\('id-ID'\)\}<\/b>/g,
    rep: "\u2022 Min omzet / hari       : <b>Rp${Number(RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET || 0).toLocaleString('id-ID')}</b>", label: 'bullet bonus min omzet' },
  { re: /\u274c Tier tercapai\s+: <b>\$\{bonusStats\.currentTier\.label\}<\/b> \(Rp\$\{Number\(bonusStats\.currentTier\.bonusAmount \|\| 0\)\.toLocaleString\('id-ID'\)\}\)/g,
    rep: "\u2022 Tier tercapai          : <b>${bonusStats.currentTier.label}</b> (Rp${Number(bonusStats.currentTier.bonusAmount || 0).toLocaleString('id-ID')})", label: 'bullet bonus tier tercapai' },
  { re: /\u274c Tier tercapai\s+: <b>Belum ada<\/b>/g,
    rep: '\u2022 Tier tercapai          : <b>Belum ada</b>', label: 'bullet bonus tier belum ada' },
  { re: /\u274c Target berikutnya\s+: <b>\$\{bonusStats\.nextTier\.label\}<\/b> \u2192 sisa <b>\$\{need\}<\/b> hari lagi/g,
    rep: '\u2022 Target berikutnya      : <b>${bonusStats.nextTier.label}</b> \u2192 sisa <b>${need}</b> hari lagi', label: 'bullet bonus target next' },
  { re: /\u274c Target berikutnya\s+: <b>Tier tertinggi sudah tercapai<\/b>/g,
    rep: '\u2022 Target berikutnya      : <b>Tier tertinggi sudah tercapai</b>', label: 'bullet bonus target top' },
  { re: /\u274c Akun terlalu pendek\s+: <b>\$\{bonusStats\.invalidShortAccounts\}<\/b> akun tidak dihitung/g,
    rep: '\u2022 Akun terlalu pendek    : <b>${bonusStats.invalidShortAccounts}</b> akun tidak dihitung', label: 'bullet bonus akun pendek' },
  { re: /\u274c Hari omzet kurang\s+: <b>\$\{bonusStats\.invalidLowOmzetDays\}<\/b> hari tidak dihitung/g,
    rep: '\u2022 Hari omzet kurang      : <b>${bonusStats.invalidLowOmzetDays}</b> hari tidak dihitung', label: 'bullet bonus hari omzet' },

  // Penjualan saya bullets
  { re: /\u274c Total akun terjual\s+: <b>\$\{totalAccounts\}<\/b>/g,
    rep: '\u2022 Total akun terjual       : <b>${totalAccounts}</b>', label: 'bullet penjualan total' },
  { re: /\u274c Akun durasi \u2265 30 hari\s+: <b>\$\{count30Days\}<\/b>/g,
    rep: '\u2022 Akun durasi \u2265 30 hari    : <b>${count30Days}</b>', label: 'bullet penjualan 30 hari' },
  { re: /\u274c Total hari akumulasi\s+: <b>\$\{totalDays\}<\/b> hari/g,
    rep: '\u2022 Total hari akumulasi     : <b>${totalDays}</b> hari', label: 'bullet penjualan total hari' },
  { re: /\u274c Minimal <b>\$\{RESELLER_TARGET_MIN_30D_ACCOUNTS\}<\/b> akun berdurasi \u2265 30 hari/g,
    rep: '\u2022 Minimal <b>${RESELLER_TARGET_MIN_30D_ACCOUNTS}</b> akun berdurasi \u2265 30 hari', label: 'bullet target minimal 30' },
  { re: /\u274c Atau total <b>\$\{RESELLER_TARGET_MIN_DAYS_PER_MONTH\}<\/b> hari dari semua akun/g,
    rep: '\u2022 Atau total <b>${RESELLER_TARGET_MIN_DAYS_PER_MONTH}</b> hari dari semua akun', label: 'bullet target atau total' },

  // Status target ternary (kebetulan ada di multi-line literal)
  { re: /\u274c Target akun 30 hari : \$\{meets30 \? '\u274c Tercapai' : '\u274c Belum tercapai'\}/g,
    rep: "\u2022 Target akun 30 hari : ${meets30 ? '\u2705 Tercapai' : '\u274c Belum tercapai'}", label: 'bullet target 30 status' },
  { re: /\u274c Target total hari   : \$\{meetsDays \? '\u274c Tercapai' : '\u274c Belum tercapai'\}/g,
    rep: "\u2022 Target total hari   : ${meetsDays ? '\u2705 Tercapai' : '\u274c Belum tercapai'}", label: 'bullet target total status' },
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
console.log('\nTotal batch-3b: ' + total);
console.log('Sisa X-mark: ' + ((src.match(/\u274c/g) || []).length));
fs.writeFileSync('app.js', src);
console.log('Tulis ke app.js');
