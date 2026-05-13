// Emoji admin cleanup, batch 1: TOMBOL & TOGGLE menu admin.
// Context-aware: ganti \u274c (X merah) yang dipakai sebagai ikon tombol/toggle/arithmetic
// jadi emoji yang lebih sesuai. Tidak menyentuh \u274c yang memang error.

const fs = require('fs');
let src = fs.readFileSync('app.js', 'utf8');

const rules = [
  // Status lisensi "HARI INI" di sendAdminMenu -> warning
  { re: /`\u274c Status: <b>HARI INI<\/b>`/g, rep: '`\u26a0\ufe0f Status: <b>HARI INI</b>`', label: 'admin license HARI INI' },

  // === Admin top-level buttons ===
  { re: /\{ text: '\u274c Pengaturan Trial', callback_data: 'admin_trial_menu' \}/g,
    rep: "{ text: '\ud83e\uddea Pengaturan Trial', callback_data: 'admin_trial_menu' }",
    label: 'btn Pengaturan Trial' },
  { re: /\{ text: '\u274c Pengingat Expired',\s+callback_data: 'expiry_reminder_menu' \}/g,
    rep: "{ text: '\ud83d\udd14 Pengingat Expired',   callback_data: 'expiry_reminder_menu' }",
    label: 'btn Pengingat Expired' },

  // === Expiry Reminder menu buttons ===
  { re: /: '\u274c Nyalakan Pengingat'/g, rep: ": '\ud83d\udd14 Nyalakan Pengingat'", label: 'btn Nyalakan Pengingat' },
  { re: /\{ text: '\u274c Jam -1', callback_data: 'expiry_hour_minus' \}/g,
    rep: "{ text: '\u2796 Jam -1', callback_data: 'expiry_hour_minus' }", label: 'btn Jam -1' },
  { re: /\{ text: '\u274c Jam \+1', callback_data: 'expiry_hour_plus' \}/g,
    rep: "{ text: '\u2795 Jam +1', callback_data: 'expiry_hour_plus' }", label: 'btn Jam +1' },
  { re: /\{ text: '\u274c Menit -5', callback_data: 'expiry_minute_minus' \}/g,
    rep: "{ text: '\u2796 Menit -5', callback_data: 'expiry_minute_minus' }", label: 'btn Menit -5' },
  { re: /\{ text: '\u274c Menit \+5', callback_data: 'expiry_minute_plus' \}/g,
    rep: "{ text: '\u2795 Menit +5', callback_data: 'expiry_minute_plus' }", label: 'btn Menit +5' },

  // === Auto Backup menu buttons ===
  { re: /: '\u274c Nyalakan Auto Backup'/g, rep: ": '\ud83d\udcbe Nyalakan Auto Backup'", label: 'btn Nyalakan Auto Backup' },
  { re: /\{ text: '\u274c -1 jam', callback_data: 'backup_auto_interval_minus' \}/g,
    rep: "{ text: '\u2796 -1 jam', callback_data: 'backup_auto_interval_minus' }", label: 'btn -1 jam' },
  { re: /\{ text: '\u274c \+1 jam', callback_data: 'backup_auto_interval_plus' \}/g,
    rep: "{ text: '\u2795 +1 jam', callback_data: 'backup_auto_interval_plus' }", label: 'btn +1 jam' },

  // === Broadcast flow: tombol Kirim Sekarang (Batal tetap pakai X merah) ===
  { re: /\{ text: '\u274c Kirim Sekarang', callback_data: 'broadcast_confirm' \}/g,
    rep: "{ text: '\ud83d\udce2 Kirim Sekarang', callback_data: 'broadcast_confirm' }", label: 'btn Kirim Sekarang' },

  // === Reset DB confirmation ===
  { re: /\[\{ text: '\u274c Ya', callback_data: 'confirm_resetdb' \}\]/g,
    rep: "[{ text: '\u2705 Ya', callback_data: 'confirm_resetdb' }]", label: 'btn Reset DB Ya' },
  { re: /\[\{ text: '\u274c Tidak', callback_data: 'cancel_resetdb' \}\]/g,
    rep: "[{ text: '\u26d4 Tidak', callback_data: 'cancel_resetdb' }]", label: 'btn Reset DB Tidak' },

  // === Server management menu buttons ===
  { re: /\{ text: '\u274c Tambah Server', callback_data: 'addserver' \}/g,
    rep: "{ text: '\u2795 Tambah Server', callback_data: 'addserver' }", label: 'btn Tambah Server' },
  { re: /\{ text: '\u274c Hapus Server', callback_data: 'deleteserver' \}/g,
    rep: "{ text: '\ud83d\uddd1\ufe0f Hapus Server', callback_data: 'deleteserver' }", label: 'btn Hapus Server' },

  // === QRIS topup confirmation ===
  { re: /\[\{ text: '\u274c Lanjut Topup', callback_data: 'qris_topup_confirm_yes' \}\]/g,
    rep: "[{ text: '\u27a1\ufe0f Lanjut Topup', callback_data: 'qris_topup_confirm_yes' }]",
    label: 'btn Lanjut Topup' },
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

console.log('\nTotal batch-1: ' + total);
console.log('Sisa X-mark: ' + ((src.match(/\u274c/g) || []).length));
fs.writeFileSync('app.js', src);
console.log('Tulis ke app.js');
