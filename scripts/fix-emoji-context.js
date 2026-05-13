// Second-pass emoji fix: ganti ❌ jadi ✅/⏳/⚠️/dll berdasarkan konteks kalimat.
// Sebagian besar issue: saat fix pertama (restore-emoji.js) saya default ❌ untuk
// error-sounding prefix, tapi banyak yang sebenarnya konteks sukses/info/warning.

const fs = require('fs');

let src = fs.readFileSync('app.js', 'utf8');

// Helper: replacement yang aman dari backtick/single quote issues
const rules = [
  // '❌ Berhasil' / '❌ ...berhasil' di pesan sukses -> '✅'
  { re: /\u274c(\s+(?:<b>)?Berhasil)/g, rep: '\u2705$1', label: 'success: Berhasil' },
  { re: /\u274c(\s+<b>TOPUP\s+BERHASIL)/g, rep: '\u2705$1', label: 'success: TOPUP BERHASIL' },
  { re: /\u274c(\s+<b>Topup\s+Saldo\s+Berhasil)/g, rep: '\u2705$1', label: 'success: Topup Saldo Berhasil' },
  { re: /\u274c(\s+<b>GOPAY_API_KEY\s+berhasil)/g, rep: '\u2705$1', label: 'success: API key berhasil' },
  { re: /\u274c(\s+<b>API\s+key\s+GoPay\s+valid)/g, rep: '\u2705$1', label: 'success: API key valid' },

  // Lisensi aktif / sisa hari
  { re: /\u274c(\s+Lisensi\s+masih\s+aktif)/g, rep: '\u2705$1', label: 'lisensi aktif' },
  { re: /\u274c(\s+Aktif,\s+sisa)/g, rep: '\u2705$1', label: 'lisensi aktif sisa' },
  { re: /\u274c(\s+Sisa\s+:)/g, rep: '\ud83d\udcc5$1', label: 'sisa hari kalender' },
  { re: /\u274c(\s+Lewat\s+:)/g, rep: '\ud83d\udcc5$1', label: 'lewat hari kalender' },

  // Hasil action admin: Saldo/User/Status/Server/Harga/Nama/Auth/Quota berhasil
  { re: /\u274c(\s+Saldo\s+user\s+ID)/g, rep: '\u2705$1', label: 'admin saldo ok' },
  { re: /\u274c(\s+User\s+dengan\s+ID[^\n]*berhasil)/g, rep: '\u2705$1', label: 'admin user ok' },
  { re: /\u274c(\s+Status\s+user[^\n]*berhasil)/g, rep: '\u2705$1', label: 'admin status ok' },
  { re: /\u274c(\s+Server\s+\\`[^`]+\\`\s+berhasil)/g, rep: '\u2705$1', label: 'admin server ok' },
  { re: /\u274c(\s+Harga\s+server)/g, rep: '\u2705$1', label: 'admin harga ok' },
  { re: /\u274c(\s+Nama\s+server\s+untuk)/g, rep: '\u2705$1', label: 'admin nama ok' },
  { re: /\u274c(\s+Auth\s+server\s+untuk)/g, rep: '\u2705$1', label: 'admin auth ok' },
  { re: /\u274c(\s+Quota\s+server)/g, rep: '\u2705$1', label: 'admin quota ok' },
  { re: /\u274c(\s+\*Server\s+khusus\s+reseller\s+berhasil)/g, rep: '\u2705$1', label: 'server reseller ok' },

  // Broadcast summary '❌ Berhasil' / '❌ Gagal' adalah counter: ganti ke bullet.
  // Hanya yang diapit spasi + angka di template string.
  { re: /\u274c(\s+Berhasil\s*:\s*<b>)/g, rep: '\u2705$1', label: 'broadcast berhasil count' },
  { re: /\u274c(\s+Gagal\s*:\s*<b>)/g, rep: '\u274c$1', label: 'broadcast gagal count' },

  // Info "Sedang diproses" -> hourglass
  { re: /\u274c(\s+Sedang\s+diproses)/g, rep: '\u23f3$1', label: 'sedang diproses' },

  // 'Bot sementara nonaktif' warning -> ⛔
  { re: /\u274c(\s+\*Bot\s+sementara\s+nonaktif)/g, rep: '\u26d4$1', label: 'bot nonaktif' },

  // Lisensi habis / Habis date prefix
  { re: /`\u274c(\s+Lisensi\s+habis:)/g, rep: '`\ud83d\udd12$1', label: 'lisensi habis' },
  { re: /`\u274c(\s+Habis\s+:)/g, rep: '`\ud83d\udd52$1', label: 'habis waktu' },
  { re: /`\u274c(\s+Lewat:)/g, rep: '`\ud83d\udcc5$1', label: 'lewat kalender' },
  { re: /\u274c(\s+Lisensi\s+sudah\s+kadaluarsa)/g, rep: '\u26d4$1', label: 'lisensi expired' },

  // Logger info (bukan error) -> ℹ️
  { re: /logger\.info\(`\u274c(\s+User\s+[^`]+\s+dihapus)/g, rep: 'logger.info(`\u2139\ufe0f$1', label: 'log info user dihapus' },
  { re: /logger\.info\(`\u274c(\s+User\s+[^`]+juga\s+dihapus)/g, rep: 'logger.info(`\u2139\ufe0f$1', label: 'log info user juga dihapus' },
  { re: /logger\.info\(`\u274c(\s+Broadcast[a-z]*\s+terkirim)/g, rep: 'logger.info(`\u2139\ufe0f$1', label: 'log info broadcast terkirim' },

  // Admin field: Limit IP / Batas create / Total create -> sukses
  { re: /\u274c(\s+Limit\s+IP\s+server)/g, rep: '\u2705$1', label: 'admin limit ip ok' },
  { re: /\u274c(\s+Batas\s+create\s+akun\s+server)/g, rep: '\u2705$1', label: 'admin batas create ok' },
  { re: /\u274c(\s+Total\s+create\s+akun\s+server)/g, rep: '\u2705$1', label: 'admin total create ok' },

  // Pengaturan trial berhasil disimpan
  { re: /'\u274c(\s+\*Pengaturan\s+trial\s+berhasil)/g, rep: "'\u2705$1", label: 'trial config ok' },

  // Tombol Toggle: "❌ Matikan Trial" -> "⛔", "❌ Aktifkan Trial" -> "✅"
  { re: /'\u274c\s+Matikan\s+Trial'/g, rep: "'\u26d4 Matikan Trial'", label: 'btn matikan trial' },
  { re: /'\u274c\s+Aktifkan\s+Trial'/g, rep: "'\u2705 Aktifkan Trial'", label: 'btn aktifkan trial' },

  // Gambar QRIS berhasil diunggah
  { re: /'\u274c\s+Gambar\s+QRIS\s+berhasil\s+diunggah!'/g, rep: "'\u2705 Gambar QRIS berhasil diunggah!'", label: 'qris uploaded' },

  // Info lisensi health
  { re: /'\u274c(\s+Tampilan\s+info\s+lisensi)/g, rep: "'\u2139\ufe0f$1", label: 'info lisensi header' },

  // Field label count (akun aktif / hari aktif): pakai bullet
  { re: /`\u274c(\s+Akun\s+aktif\s+sekarang)/g, rep: '`\u2022$1', label: 'bullet akun aktif' },
  { re: /`\u274c(\s+Hari\s+aktif\s+valid)/g, rep: '`\u2022$1', label: 'bullet hari aktif' },

  // Inline button: 'Konfirmasi' -> ✅, 'Batal' -> ❌ (keep), 'Tekan tombol Batal'
  { re: /'\u274c\s+Konfirmasi'/g, rep: "'\u2705 Konfirmasi'", label: 'btn Konfirmasi' },
  // '❌ Batal' di tombol TETAP benar (action cancel). Tidak kita ubah.

  // Help text GOPAY: bullet info
  { re: /'\u274c(\s+<code>\/setgopayapikey)/g, rep: "'\u2022$1", label: 'bullet setgopay cmd' },
  { re: /'\u274c(\s+reply\s+pesan\s+API\s+key)/g, rep: "'\u2022$1", label: 'bullet setgopay reply' },

  // 'Mode input API key GoPay dibatalkan' -> cancel info
  { re: /'\u274c(\s+Mode\s+input\s+API\s+key\s+GoPay\s+dibatalkan)/g, rep: "'\u26d4$1", label: 'input api key canceled' },

  // "Mengirim laporan harian" / "Membuat preview" / "Menjalankan backup" = info hourglass
  { re: /'\u274c(\s+Mengirim\s+laporan\s+harian)/g, rep: "'\u23f3$1", label: 'mengirim laporan' },
  { re: /'\u274c(\s+Membuat\s+preview)/g, rep: "'\u23f3$1", label: 'membuat preview' },
  { re: /'\u274c(\s+Menjalankan\s+backup)/g, rep: "'\u23f3$1", label: 'menjalankan backup' },

  // Ringkasan expired reminder bullet info
  { re: /'\u274c(\s+Jam\s+&\s+menit\s+pengingat)/g, rep: "'\u2022$1", label: 'bullet jam pengingat' },
  { re: /'\u274c(\s+H-1\s+\/\s+H-2)/g, rep: "'\u2022$1", label: 'bullet h-1 h-2' },
  { re: /'\u274c(\s+Menu\s+Admin\s+\u2192)/g, rep: "'\u2022$1", label: 'bullet menu admin breadcrumb' },

  // STATUS BOT template: banyak bullet label pakai ❌. Ganti ke bullet •.
  { re: /`\u274c(\s+\$\{nowText\})/g, rep: '`\u23f0$1', label: 'status waktu sekarang' },
  { re: /`\u274c(\s+Uptime\s+bot:)/g, rep: '`\u23f1\ufe0f$1', label: 'status uptime' },
  { re: /`\u274c(\s+\$\{licenseStatus\})/g, rep: '`\ud83d\udcc5$1', label: 'status licenseStatus' },
  { re: /`\u274c(\s+\$\{dbStatus\})/g, rep: '`\ud83d\udcbe$1', label: 'status dbStatus' },
  { re: /`\u274c(\s+Status\s+\s*:\s*\$\{abStatus\})/g, rep: '`\u2022$1', label: 'status auto-backup status' },
  { re: /`\u274c(\s+Status\s+\s*:\s*\$\{drStatus\})/g, rep: '`\u2022$1', label: 'status daily report' },
  { re: /`\u274c(\s+Status\s+\s*:\s*\$\{erStatus\})/g, rep: '`\u2022$1', label: 'status expiry reminder' },
  { re: /`\u274c(\s+Jam\s+\s*:\s*<b>\$\{drTime\})/g, rep: '`\u2022$1', label: 'bullet jam daily' },
  { re: /`\u274c(\s+Jadwal\s+\s*:\s*<b>\$\{erTime\})/g, rep: '`\u2022$1', label: 'bullet jadwal expiry' },
  { re: /`\u274c(\s+\$\{abDetail\})/g, rep: '`\u2022$1', label: 'bullet ab detail' },

  // 'Terhubung & bisa query' = DB sukses
  { re: /'\u274c\s+Terhubung\s+&\s+bisa\s+query'/g, rep: "'\u2705 Terhubung & bisa query'", label: 'db connect ok' },

  // 'Sudah kadaluarsa N hari' di license = warning/expired
  { re: /`\u274c\s+Sudah\s+kadaluarsa/g, rep: '`\u26d4 Sudah kadaluarsa', label: 'lisensi sudah kadaluarsa' },

  // cbQuery 'Terjadi kesalahan, silakan coba lagi.' ❌ is correct here, keep as-is.
  // (no rule)
];

let total = 0;
for (const r of rules) {
  const before = src;
  src = src.replace(r.re, r.rep);
  const delta = (before.match(/\u274c/g) || []).length - (src.match(/\u274c/g) || []).length;
  if (delta > 0) console.log('  ' + delta + 'x  ' + r.label);
  total += delta;
}

console.log('\nTotal ' + '\u274c' + ' → emoji konteks: ' + total);
const remaining = (src.match(/\u274c/g) || []).length;
console.log('Sisa ' + '\u274c' + ' di app.js: ' + remaining);

fs.writeFileSync('app.js', src);
console.log('Tulis ke app.js');
