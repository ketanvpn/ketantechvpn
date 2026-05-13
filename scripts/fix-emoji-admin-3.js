// Emoji admin cleanup, batch 3: BULLETS & LABELS.
// Ganti \u274c yang dipakai sebagai bullet di template (monitor, reseller bonus,
// stats, trial admin info, broadcast templates, timezone, server management).

const fs = require('fs');
let src = fs.readFileSync('app.js', 'utf8');

const rules = [
  // === Trial admin menu header ===
  { re: /'\u274c \*Pengaturan Trial Akun\*/g,
    rep: "'\ud83e\uddea *Pengaturan Trial Akun*", label: 'header trial admin' },
  // Tombol Simpan Pengaturan (trial)
  { re: /\{ text: '\u274c Simpan Pengaturan', callback_data: 'admin_trial_save' \}/g,
    rep: "{ text: '\ud83d\udcbe Simpan Pengaturan', callback_data: 'admin_trial_save' }",
    label: 'btn simpan pengaturan trial' },

  // === Broadcast selesai header ===
  { re: /`\u274c <b>Broadcast selesai\.<\/b>/g,
    rep: '`\u2705 <b>Broadcast selesai.</b>', label: 'header broadcast selesai' },
  { re: /`\u274c <b>Broadcast ke reseller selesai\.<\/b>/g,
    rep: '`\u2705 <b>Broadcast ke reseller selesai.</b>', label: 'header broadcast reseller selesai' },
  { re: /`\u274c <b>Broadcast ke member selesai\.<\/b>/g,
    rep: '`\u2705 <b>Broadcast ke member selesai.</b>', label: 'header broadcast member selesai' },
  { re: /`\u274c Pengumuman selesai dikirim\./g,
    rep: '`\u2705 Pengumuman selesai dikirim.', label: 'header pengumuman selesai' },

  // === Broadcast target list (bullet) ===
  { re: /'\u274c \ud83d\udc65 Semua User\\n'/g,
    rep: "'\u2022 \ud83d\udc65 Semua User\\n'", label: 'bullet target semua user' },
  { re: /'\u274c \ud83d\udc8e\u200d\ud83d\udcb8 Reseller\\n'/g,
    rep: "'\u2022 \ud83d\udc8e\u200d\ud83d\udcb8 Reseller\\n'", label: 'bullet target reseller' },
  { re: /'\u274c \ud83d\udc64 Member \(bukan reseller & bukan admin\)\\n\\n'/g,
    rep: "'\u2022 \ud83d\udc64 Member (bukan reseller & bukan admin)\\n\\n'", label: 'bullet target member' },

  // === Broadcast mode list (bullet) ===
  { re: /'\u274c \?\?\u270f\ufe0f Tulis manual \(ketik bebas\)\\n'/g,
    rep: "'\u2022 \u270f\ufe0f Tulis manual (ketik bebas)\\n'", label: 'bullet mode manual' },
  { re: /'\u274c \ud83d\udee0\ufe0f Template Maintenance VPN\\n'/g,
    rep: "'\u2022 \ud83d\udee0\ufe0f Template Maintenance VPN\\n'", label: 'bullet mode maintenance' },
  { re: /'\u274c \ud83c\udf81 Template Promo\/Diskon VPN'/g,
    rep: "'\u2022 \ud83c\udf81 Template Promo/Diskon VPN'", label: 'bullet mode promo' },

  // === Broadcast templates (maintenance) contoh bullet ===
  { re: /'\u274c Semua server VPN\\n'/g, rep: "'\u2022 Semua server VPN\\n'", label: 'bullet contoh server vpn' },
  { re: /'\u274c Server SG-1 & SG-2\\n'/g, rep: "'\u2022 Server SG-1 & SG-2\\n'", label: 'bullet contoh sg-1 sg-2' },
  { re: /'\u274c Layanan SSH & VMESS'/g, rep: "'\u2022 Layanan SSH & VMESS'", label: 'bullet contoh ssh vmess' },

  // Promo templates
  { re: /'\u274c Paket 30 Hari All Server\\n'/g, rep: "'\u2022 Paket 30 Hari All Server\\n'", label: 'bullet contoh paket 30' },
  { re: /'\u274c Promo Akhir Bulan 7 Hari\\n'/g, rep: "'\u2022 Promo Akhir Bulan 7 Hari\\n'", label: 'bullet contoh promo akhir bulan' },
  { re: /'\u274c Diskon 30% semua paket bulanan'/g, rep: "'\u2022 Diskon 30% semua paket bulanan'", label: 'bullet contoh diskon 30' },

  // Template maintenance example waktu
  { re: /'\u274c Sabtu, 22-11-2025, jam 21\.00 WIT\\n'/g, rep: "'\u2022 Sabtu, 22-11-2025, jam 21.00 WIT\\n'", label: 'bullet contoh waktu sabtu' },
  { re: /'\u274c Malam ini jam 23\.00 WIT'/g, rep: "'\u2022 Malam ini jam 23.00 WIT'", label: 'bullet contoh waktu malam' },

  // Template maintenance example durasi
  { re: /'\u274c 30 menit\\n'/g, rep: "'\u2022 30 menit\\n'", label: 'bullet contoh durasi 30 menit' },
  { re: /'\u274c 1 jam\\n'/g, rep: "'\u2022 1 jam\\n'", label: 'bullet contoh durasi 1 jam' },
  { re: /'\u274c 2 jam'/g, rep: "'\u2022 2 jam'", label: 'bullet contoh durasi 2 jam' },

  // Promo template detail
  { re: /'\u274c Diskon 30%, dari 30K jadi 20K\\n'/g, rep: "'\u2022 Diskon 30%, dari 30K jadi 20K\\n'", label: 'bullet contoh diskon 30%' },
  { re: /'\u274c Beli 1 bulan gratis 7 hari\\n'/g, rep: "'\u2022 Beli 1 bulan gratis 7 hari\\n'", label: 'bullet contoh beli 1 bln' },
  { re: /'\u274c Harga spesial hanya hari ini'/g, rep: "'\u2022 Harga spesial hanya hari ini'", label: 'bullet contoh harga spesial' },

  { re: /'\u274c Sampai 30-11-2025\\n'/g, rep: "'\u2022 Sampai 30-11-2025\\n'", label: 'bullet contoh sampai 30-11' },
  { re: /'\u274c Hanya sampai akhir bulan ini\\n'/g, rep: "'\u2022 Hanya sampai akhir bulan ini\\n'", label: 'bullet contoh akhir bulan' },
  { re: /'\u274c Berlaku 3 hari ke depan'/g, rep: "'\u2022 Berlaku 3 hari ke depan'", label: 'bullet contoh berlaku 3 hari' },

  // Broadcast state durasi
  { re: /msgLines\.push\(`\u274c Durasi\s+: <b>\$\{bState\.durasi\}<\/b>`\);/g,
    rep: 'msgLines.push(`\u2022 Durasi      : <b>${bState.durasi}</b>`);', label: 'bullet state durasi' },

  // === Timezone menu bullet ===
  { re: /'\u274c Laporan harian\\n'/g, rep: "'\u2022 Laporan harian\\n'", label: 'bullet timezone laporan' },
  { re: /'\u274c Pengingat expired akun\\n'/g, rep: "'\u2022 Pengingat expired akun\\n'", label: 'bullet timezone pengingat' },

  // === Monitor panel (admin) ===
  { re: /lines\.push\(`\u274c Total user terdaftar : <b>\$\{totalUsers\}<\/b>`\);/g,
    rep: 'lines.push(`\u2022 Total user terdaftar : <b>${totalUsers}</b>`);', label: 'bullet total user' },
  { re: /lines\.push\(`\u274c Total reseller\s+: <b>\$\{totalReseller\}<\/b>\\n`\);/g,
    rep: 'lines.push(`\u2022 Total reseller       : <b>${totalReseller}</b>\\n`);', label: 'bullet total reseller' },
  { re: /lines\.push\(`\u274c Total akun dibuat\s+: <b>\$\{totalAccounts\}<\/b>`\);/g,
    rep: 'lines.push(`\u2022 Total akun dibuat    : <b>${totalAccounts}</b>`);', label: 'bullet total akun' },
  { re: /lines\.push\(`\u274c Akun sudah expired\s+: <b>\$\{totalExpiredAccounts\}<\/b>\\n`\);/g,
    rep: 'lines.push(`\u2022 Akun sudah expired   : <b>${totalExpiredAccounts}</b>\\n`);', label: 'bullet akun expired monitor' },

  // === Server management header bullets ===
  { re: /'\u274c Tambah \/ Hapus server\\n'/g, rep: "'\u2022 Tambah / Hapus server\\n'", label: 'bullet srv tambah/hapus' },
  { re: /'\u274c Edit harga, nama, domain, auth\\n'/g, rep: "'\u2022 Edit harga, nama, domain, auth\\n'", label: 'bullet srv edit 1' },
  { re: /'\u274c Edit quota, limit IP, batas & total create\\n'/g, rep: "'\u2022 Edit quota, limit IP, batas & total create\\n'", label: 'bullet srv edit 2' },
  { re: /'\u274c Lihat list & detail server\\n'/g, rep: "'\u2022 Lihat list & detail server\\n'", label: 'bullet srv lihat list' },

  // === Trial confirm info bullets ===
  { re: /`\u274c Masa aktif trial\s+: <b>\$\{durationHours\} jam<\/b>\\n`/g,
    rep: '`\u2022 Masa aktif trial   : <b>${durationHours} jam</b>\\n`', label: 'bullet trial durasi' },
  { re: /`\u274c Batas trial \/ hari : <b>\$\{maxPerDay\}x per user<\/b>\\n`/g,
    rep: '`\u2022 Batas trial / hari : <b>${maxPerDay}x per user</b>\\n`', label: 'bullet trial max per hari' },
  { re: /`\u274c Minimal saldo trial: <b>Rp\$\{minBalance\}<\/b>\\n`/g,
    rep: '`\u2022 Minimal saldo trial: <b>Rp${minBalance}</b>\\n`', label: 'bullet trial min saldo' },

  // === Riwayat saya (showMyStatsPage) ===
  { re: /lines\.push\(`\u274c Total dibuat\s+: <b>\$\{totalAll\}<\/b> akun`\);/g,
    rep: 'lines.push(`\u2022 Total dibuat   : <b>${totalAll}</b> akun`);', label: 'bullet stats total dibuat' },
  { re: /lines\.push\(`\u274c Aktif sekarang : <b>\$\{totalActive\}<\/b> akun`\);/g,
    rep: 'lines.push(`\u2022 Aktif sekarang : <b>${totalActive}</b> akun`);', label: 'bullet stats aktif sekarang' },
  { re: /lines\.push\(`\u274c Sudah expired\s+: <b>\$\{totalExpired\}<\/b> akun\\n`\);/g,
    rep: 'lines.push(`\u2022 Sudah expired  : <b>${totalExpired}</b> akun\\n`);', label: 'bullet stats sudah expired' },

  // === Reseller bonus progress ===
  { re: /bonusProgressText \+= `\u274c Akun valid bonus\s+: <b>\$\{bonusStats\.validAccounts\}<\/b> akun\n/g,
    rep: 'bonusProgressText += `\u2022 Akun valid bonus       : <b>${bonusStats.validAccounts}</b> akun\n', label: 'bullet bonus akun valid' },
  { re: /bonusProgressText \+= `\u274c Omzet valid estimasi\s+: <b>Rp\$\{Number\(bonusStats\.validOmzet \|\| 0\)\.toLocaleString\('id-ID'\)\}<\/b>\n/g,
    rep: "bonusProgressText += `\u2022 Omzet valid estimasi   : <b>Rp${Number(bonusStats.validOmzet || 0).toLocaleString('id-ID')}</b>\n", label: 'bullet bonus omzet' },
  { re: /bonusProgressText \+= `\u274c Min durasi dihitung\s+: <b>\$\{RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS\}<\/b> hari\n/g,
    rep: 'bonusProgressText += `\u2022 Min durasi dihitung    : <b>${RESELLER_ACTIVE_BONUS_MIN_DURATION_DAYS}</b> hari\n', label: 'bullet bonus min durasi' },
  { re: /bonusProgressText \+= `\u274c Min omzet \/ hari\s+: <b>Rp\$\{Number\(RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET \|\| 0\)\.toLocaleString\('id-ID'\)\}<\/b>\n/g,
    rep: "bonusProgressText += `\u2022 Min omzet / hari       : <b>Rp${Number(RESELLER_ACTIVE_BONUS_MIN_DAILY_OMZET || 0).toLocaleString('id-ID')}</b>\n", label: 'bullet bonus min omzet' },
  { re: /bonusProgressText \+= `\u274c Tier tercapai\s+: <b>\$\{bonusStats\.currentTier\.label\}<\/b> \(Rp\$\{Number\(bonusStats\.currentTier\.bonusAmount \|\| 0\)\.toLocaleString\('id-ID'\)\}\)\n/g,
    rep: "bonusProgressText += `\u2022 Tier tercapai          : <b>${bonusStats.currentTier.label}</b> (Rp${Number(bonusStats.currentTier.bonusAmount || 0).toLocaleString('id-ID')})\n", label: 'bullet bonus tier tercapai' },
  { re: /bonusProgressText \+= `\u274c Tier tercapai\s+: <b>Belum ada<\/b>\n/g,
    rep: 'bonusProgressText += `\u2022 Tier tercapai          : <b>Belum ada</b>\n', label: 'bullet bonus tier belum ada' },
  { re: /bonusProgressText \+= `\u274c Target berikutnya\s+: <b>\$\{bonusStats\.nextTier\.label\}<\/b> \u2192 sisa <b>\$\{need\}<\/b> hari lagi\n/g,
    rep: 'bonusProgressText += `\u2022 Target berikutnya      : <b>${bonusStats.nextTier.label}</b> \u2192 sisa <b>${need}</b> hari lagi\n', label: 'bullet bonus target next' },
  { re: /bonusProgressText \+= `\u274c Target berikutnya\s+: <b>Tier tertinggi sudah tercapai<\/b>\n/g,
    rep: 'bonusProgressText += `\u2022 Target berikutnya      : <b>Tier tertinggi sudah tercapai</b>\n', label: 'bullet bonus target top' },
  { re: /bonusProgressText \+= `\u274c Akun terlalu pendek\s+: <b>\$\{bonusStats\.invalidShortAccounts\}<\/b> akun tidak dihitung\n/g,
    rep: 'bonusProgressText += `\u2022 Akun terlalu pendek    : <b>${bonusStats.invalidShortAccounts}</b> akun tidak dihitung\n', label: 'bullet bonus akun pendek' },
  { re: /bonusProgressText \+= `\u274c Hari omzet kurang\s+: <b>\$\{bonusStats\.invalidLowOmzetDays\}<\/b> hari tidak dihitung\n/g,
    rep: 'bonusProgressText += `\u2022 Hari omzet kurang      : <b>${bonusStats.invalidLowOmzetDays}</b> hari tidak dihitung\n', label: 'bullet bonus hari omzet' },

  // === Reseller penjualan saya section ===
  { re: /`\u274c Total akun terjual\s+: <b>\$\{totalAccounts\}<\/b>\n/g,
    rep: '`\u2022 Total akun terjual       : <b>${totalAccounts}</b>\n', label: 'bullet penjualan total' },
  { re: /`\u274c Akun durasi \u2265 30 hari\s+: <b>\$\{count30Days\}<\/b>\n/g,
    rep: '`\u2022 Akun durasi \u2265 30 hari    : <b>${count30Days}</b>\n', label: 'bullet penjualan 30 hari' },
  { re: /`\u274c Total hari akumulasi\s+: <b>\$\{totalDays\}<\/b> hari\n\n/g,
    rep: '`\u2022 Total hari akumulasi     : <b>${totalDays}</b> hari\n\n', label: 'bullet penjualan total hari' },
  { re: /`\u274c Minimal <b>\$\{RESELLER_TARGET_MIN_30D_ACCOUNTS\}<\/b> akun berdurasi \u2265 30 hari\n/g,
    rep: '`\u2022 Minimal <b>${RESELLER_TARGET_MIN_30D_ACCOUNTS}</b> akun berdurasi \u2265 30 hari\n', label: 'bullet target minimal 30' },
  { re: /`\u274c Atau total <b>\$\{RESELLER_TARGET_MIN_DAYS_PER_MONTH\}<\/b> hari dari semua akun\n\n/g,
    rep: '`\u2022 Atau total <b>${RESELLER_TARGET_MIN_DAYS_PER_MONTH}</b> hari dari semua akun\n\n', label: 'bullet target atau total' },

  // Status target dua baris - ini ternary: ❌ Tercapai / ❌ Belum tercapai
  { re: /`\u274c Target akun 30 hari : \$\{meets30 \? '\u274c Tercapai' : '\u274c Belum tercapai'\}\n/g,
    rep: "`\u2022 Target akun 30 hari : ${meets30 ? '\u2705 Tercapai' : '\u274c Belum tercapai'}\n", label: 'bullet target akun 30 status' },
  { re: /`\u274c Target total hari   : \$\{meetsDays \? '\u274c Tercapai' : '\u274c Belum tercapai'\}\n\n/g,
    rep: "`\u2022 Target total hari   : ${meetsDays ? '\u2705 Tercapai' : '\u274c Belum tercapai'}\n\n", label: 'bullet target total hari status' },

  // === Broadcast info 'kirim perintah lain' bullet ===
  { re: /'\u274c Kalau ingin batal, kirim perintah lain \(misalnya \/start\)\.'/g,
    rep: "'\u2139\ufe0f Kalau ingin batal, kirim perintah lain (misalnya /start).'", label: 'info broadcast batal' },

  // === Flag user bullet detail ===
  { re: /`\u274c ID\s+: \\`\$\{targetId\}\\`\\n`/g,
    rep: '`\u2022 ID     : \\`${targetId}\\`\\n`', label: 'bullet flag ID' },
  { re: /`\u274c Saldo\s+: \\`Rp\$\{saldoText\}\\`\\n`/g,
    rep: '`\u2022 Saldo  : \\`Rp${saldoText}\\`\\n`', label: 'bullet flag saldo' },
  { re: /`\u274c Status : \$\{flagLabel\}\$\{noteText\}\\n\\n`/g,
    rep: '`\u2022 Status : ${flagLabel}${noteText}\\n\\n`', label: 'bullet flag status' },

  // Flag keyboard label "NORMAL" -> check green icon
  { re: /text: '\u274c NORMAL',\s+callback_data: `flag_user_set_NORMAL_\$\{targetId\}`,/g,
    rep: "text: '\u2705 NORMAL',\n                callback_data: `flag_user_set_NORMAL_${targetId}`,",
    label: 'btn flag normal' },

  // Flag status display (existing) "let label = '\u274c NORMAL';"
  { re: /let label = '\u274c NORMAL';/g, rep: "let label = '\u2705 NORMAL';", label: 'label NORMAL default' },
  { re: /let flagLabel = '\u274c NORMAL';/g, rep: "let flagLabel = '\u2705 NORMAL';", label: 'flagLabel NORMAL default' },

  // === QRIS cekqris bullet ===
  { re: /`\u274c Dibayar\s+: \$\{paidAtDbText\}\\n\\n`/g,
    rep: '`\u2022 Dibayar   : ${paidAtDbText}\\n\\n`', label: 'bullet cekqris dibayar' },

  // === /health 'Mode' bullet ===
  { re: /`\u274c Mode\s+: <b>\$\{erDays\}<\/b>\\n\\n`/g,
    rep: '`\u2022 Mode   : <b>${erDays}</b>\\n\\n`', label: 'bullet health mode' },

  // === editdomain help 'Ketik batal' bullet ===
  { re: /'\u274c Ketik \*batal\* untuk membatalkan\.'/g,
    rep: "'\u2139\ufe0f Ketik *batal* untuk membatalkan.'", label: 'info ketik batal' },
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

console.log('\nTotal batch-3: ' + total);
console.log('Sisa X-mark: ' + ((src.match(/\u274c/g) || []).length));
fs.writeFileSync('app.js', src);
console.log('Tulis ke app.js');
