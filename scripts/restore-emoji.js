// Restore emoji '???' di app.js berdasarkan konteks.
// Replacement dilakukan context-aware: pola kalimat menentukan emoji yang tepat.
// Jalankan sekali dengan --dry-run dulu untuk preview:
//   node scripts/restore-emoji.js --dry-run
// Kalau sudah oke:
//   node scripts/restore-emoji.js

const fs = require('fs');

const DRY_RUN = process.argv.includes('--dry-run');
const APP_PATH = 'app.js';

const src = fs.readFileSync(APP_PATH, 'utf8');
const lines = src.split('\n');

// === Context-aware rules ===
// Setiap rule: [regex_pattern_di_line, replacement_function_atau_string]
// Ditulis sebagai substitusi string, emoji di-escape \u untuk safety.

// Emoji referensi:
//   ❌  = \u274c  tanda silang (error)
//   ⚠️ = \u26a0\ufe0f peringatan (warning)
//   ℹ️ = \u2139\ufe0f info
//   ✅  = \u2705 centang hijau (sukses)
//   🔙 = \ud83d\udd19 tombol kembali
//   💳 = \ud83d\udcb3 kartu kredit (payment)
//   📦 = \ud83d\udce6 paket (backup/kirim file)
//   👤 = \ud83d\udc64 user icon
//   🏠 = \ud83c\udfe0 rumah (menu utama)
//   🔒 = \ud83d\udd12 kunci
//   🔓 = \ud83d\udd13 buka kunci
//   💾 = \ud83d\udcbe disket/save
//   ⏰ = \u23f0 alarm/expired
//   🗑️ = trash
//   🔄 = refresh/renew

// Format: {match, replace, label}
// match: regex yang menemukan konteks + '???';
// replace: string hasil (??? sudah diganti dengan emoji yang benar).
// Urutan penting: rules di atas di-evaluate lebih dulu.

const rules = [
  // --- '????' (4 char) di komentar = arrow '→' karena dulu '→' (3 byte UTF-8 jadi 3 '?')
  // tapi kadang ada juga emoji 4-byte yang corrupt jadi 4 '?'. Komentar dulu.
  // Komentar // ... ??? ... berarti arrow logic flow.
  { match: /(\/\/[^\n]*?)\?\?\?(\s)/g, replace: '$1\u2192$2', label: 'comment arrow' },

  // --- Pesan instruksi umum di awal ctx.reply template (multi-line) ---
  { match: /'\?{3,4}\s+Perintah\s+ini\s+hanya/g, replace: "'\ud83d\udce9 Perintah ini hanya", label: 'perintah hanya' },
  { match: /'\?{3,4}\s+Untuk\s+menggunakan/g, replace: "'\ud83d\udce9 Untuk menggunakan", label: 'untuk menggunakan' },

  // --- Header pesan ('???? <b>...</b>') jadi icon topik ---
  { match: /'\?{3,4}\s+<b>Topup\s+Saldo/g, replace: "'\ud83d\udcb3 <b>Topup Saldo", label: 'header topup' },
  { match: /'\?{3,4}\s+<b>Peringatan/g, replace: "'\u23f0 <b>Peringatan", label: 'header peringatan' },
  { match: /'\?{3,4}\s+<b>STATUS\s+BOT/g, replace: "'\ud83d\udcca <b>STATUS BOT", label: 'header status bot' },
  { match: /'\?{3,4}\s+<b>INFO\s+LISENSI/g, replace: "'\ud83d\udcdc <b>INFO LISENSI", label: 'header info lisensi' },
  { match: /'\?{3,4}\s+<b>Mode/g, replace: "'\u2139\ufe0f <b>Mode", label: 'header mode' },
  { match: /'\?{3,4}\s+<b>Menu/g, replace: "'\ud83d\udcdd <b>Menu", label: 'header menu' },
  { match: /'\?{3,4}\s+<b>Detail/g, replace: "'\ud83d\udccb <b>Detail", label: 'header detail' },
  { match: /'\?{3,4}\s+<b>Pengaturan/g, replace: "'\u2699\ufe0f <b>Pengaturan", label: 'header pengaturan' },
  { match: /'\?{3,4}\s+<b>Laporan/g, replace: "'\ud83d\udcca <b>Laporan", label: 'header laporan' },

  // --- Success checkmark ---
  { match: /<b>\?{3,4}\s+Berhasil/g, replace: '<b>\u2705 Berhasil', label: 'success html bold' },
  { match: /'\?{3,4}\s+Saldo\s+kamu/g, replace: "'\u2705 Saldo kamu", label: 'saldo success' },

  // --- Warning double ?????? di middle text ---
  { match: /\?{6}\s+EXPIRE_DATE/g, replace: '\u26a0\ufe0f EXPIRE_DATE', label: 'warn expire date' },
  { match: /\?{6}\s+Lisensi/g, replace: '\u26a0\ufe0f Lisensi', label: 'warn lisensi' },
  { match: /\?{6}\s+Respons/g, replace: '\u26a0\ufe0f Respons', label: 'warn respons' },
  { match: /\?{6}\s+Akan\s+berakhir/g, replace: '\u26a0\ufe0f Akan berakhir', label: 'warn akan berakhir' },
  { match: /\?{6}\s+BACKUP_CHAT_ID/g, replace: '\u26a0\ufe0f BACKUP_CHAT_ID', label: 'warn backup chat' },

  // --- ON/OFF status ---
  { match: /'\?{3,4}\s+ON'/g, replace: "'\ud83d\udfe2 ON'", label: 'status on' },
  { match: /'\?{3,4}\s+OFF'/g, replace: "'\ud83d\udd34 OFF'", label: 'status off' },

  // --- Line item bullet '   ??? Expired: ' ---
  { match: /\s{2,}\?{3}\s+Expired:/g, replace: '   \u2022 Expired:', label: 'bullet expired' },

  // --- Detail line '???? Nominal' ---
  { match: /`\?{3,4}\s+Nominal\s+bayar/g, replace: '`\ud83d\udcb0 Nominal bayar', label: 'detail nominal' },
  { match: /`\?{3,4}\s+Bonus\s+/g, replace: '`\ud83c\udf81 Bonus ', label: 'detail bonus' },
  { match: /`\?{3,4}\s+Saldo\s+masuk/g, replace: '`\ud83d\udcb0 Saldo masuk', label: 'detail saldo masuk' },
  { match: /\?{3,4}\s+Saldo\s+sekarang/g, replace: '\ud83d\udcb0 Saldo sekarang', label: 'detail saldo sekarang' },

  // --- Inline button text '<b>??? Batal</b>' ---
  { match: /<b>\?{3}\s+Batal<\/b>/g, replace: '<b>\u274c Batal</b>', label: 'inline btn batal' },

  // --- Detail keyed lines '???? Topup : ...', '???? Masuk : ...' dst ---
  { match: /`\?{3,4}\s+Topup\s*:/g, replace: '`\ud83d\udcb0 Topup :', label: 'detail topup' },
  { match: /`\?{3,4}\s+Masuk\s*:/g, replace: '`\ud83d\udcb0 Masuk :', label: 'detail masuk' },
  { match: /`\?{3,4}\s+User\s+/g, replace: '`\ud83d\udc64 User ', label: 'detail user' },
  { match: /`\?{3,4}\s+ID\s+/g, replace: '`\ud83c\udd94 ID ', label: 'detail id' },
  { match: /`\?{3,4}\s+Bayar\s+/g, replace: '`\ud83d\udcb3 Bayar ', label: 'detail bayar' },
  { match: /`\?{3,4}\s+Saldo\s+/g, replace: '`\ud83d\udcb0 Saldo ', label: 'detail saldo' },
  { match: /`\?{3,4}\s+Tanggal\s*:/g, replace: '`\ud83d\udcc5 Tanggal :', label: 'detail tanggal' },
  { match: /`\?{3,4}\s+Jumlah\s*:/g, replace: '`\ud83d\udcb0 Jumlah :', label: 'detail jumlah' },
  { match: /`\?{3,4}\s+Catatan/g, replace: '`\ud83d\udccc Catatan', label: 'detail catatan' },

  // --- Header banner '????????? TOPUP MANUAL ?????????' ---
  { match: /\?{6,}\s+TOPUP\s+MANUAL\s+\?{6,}/g, replace: '\ud83d\udcb5 TOPUP MANUAL \ud83d\udcb5', label: 'banner topup manual' },
  { match: /\?{6,}\s+PENGURANGAN\s+SALDO\s+\?{6,}/g, replace: '\u2796 PENGURANGAN SALDO \u2796', label: 'banner pengurangan' },

  // --- Header bold '<b>???? INFO LISENSI BOT</b>' ---
  { match: /<b>\?{3,4}\s+INFO\s+LISENSI\s+BOT/g, replace: '<b>\ud83d\udcdc INFO LISENSI BOT', label: 'header info lisensi b' },
  { match: /<b>\?{3,4}\s+STATUS\s+BOT\s+/g, replace: '<b>\ud83d\udcca STATUS BOT ', label: 'header status bot b' },
  { match: /<b>\?{3,4}\s+Broadcast\s+Terakhir/g, replace: '<b>\ud83d\udce2 Broadcast Terakhir', label: 'header broadcast' },

  // --- User status icon ---
  { match: /'\?{3,4}\s+Member'/g, replace: "'\ud83d\udc64 Member'", label: 'status member' },
  { match: /'\?{3,4}\s+Admin'/g, replace: "'\ud83d\udc51 Admin'", label: 'status admin' },
  { match: /'\?{3,4}\s+WATCHLIST'/g, replace: "'\u26a0\ufe0f WATCHLIST'", label: 'status watchlist' },
  { match: /'\?{3,4}\s+NAKAL'/g, replace: "'\u26d4 NAKAL'", label: 'status nakal' },

  // --- Generic warn 6-char prefix in template ---
  { match: /`\?{6}\s+/g, replace: '`\u26a0\ufe0f ', label: 'tmpl warning prefix' },
  { match: /'\?{6}\s+/g, replace: "'\u26a0\ufe0f ", label: 'string warning prefix' },

  // --- Comment di tengah dengan '???' diapit '??? ???' (breadcrumb) ---
  { match: /\?{3}\s+\?{3}\s+Pengingat\s+Expired/g, replace: '\u2192 \ud83d\udd14 Pengingat Expired', label: 'breadcrumb pengingat' },

  // --- Listing line: '. <code>... </code> ??? Saldo:' = arrow ---
  { match: /<\/code>\s*\?{3}\s+Saldo:/g, replace: '</code> \u2192 Saldo:', label: 'listing arrow saldo' },

  // --- Inline command list arrow: '/start ??? Menu Utama' = arrow ---
  { match: /\/(\w+)(\s+)\?{3}\s+/g, replace: '/$1$2\u2192 ', label: 'cmd arrow' },
  { match: /-\s+\/(\w+)(\s+)\?{3}\s+/g, replace: '- /$1$2\u2192 ', label: 'cmd arrow dash' },
  { match: /'-\s+\/(\w+)(\s+)\?{3}\s+/g, replace: "'- /$1$2\u2192 ", label: 'cmd arrow string' },

  // --- Bullet '???' di awal line (di template menu) jadi '\u2022' ---
  { match: /(\n\s+)\?{3}\s+(Nama|ID|Saldo|Status|Editor|Interval|Chat|H-|Jam|Tanggal)\s+/g, replace: '$1\u2022 $2 ', label: 'bullet field' },
  { match: /(\n\s+)\?{3}\s+(Nama|ID|Saldo|Status|Editor)/g, replace: '$1\u2022 $2', label: 'bullet field 2' },

  // --- Lisensi line '???? Lisensi aktif sampai' / '???? Lisensi berakhir' ---
  { match: /`\?{3,4}\s+Lisensi\s+aktif/g, replace: '`\u2705 Lisensi aktif', label: 'lisensi aktif' },
  { match: /`\?{3,4}\s+Lisensi\s+berakhir/g, replace: '`\u26a0\ufe0f Lisensi berakhir', label: 'lisensi berakhir' },
  { match: /`\?{3,4}\s+Lisensi\s+habis/g, replace: '`\u274c Lisensi habis', label: 'lisensi habis' },

  // --- 'Sampai/Habis' label di template lisensi ---
  { match: /`\?{3,4}\s+Sampai:/g, replace: '`\u2705 Sampai:', label: 'lisensi sampai' },
  { match: /`\?{3,4}\s+Habis\s*:/g, replace: '`\u274c Habis :', label: 'lisensi habis label' },

  // --- '<code>?????? COMMAND PANEL</code>' = '\u2728 COMMAND PANEL' ---
  { match: /<code>\?{6,}\s+COMMAND\s+PANEL/g, replace: '<code>\u2728 COMMAND PANEL', label: 'command panel banner' },

  // --- Header utama '<b>??? BOT VPN ${NAMA_STORE} ???</b>' (dua emoji bracket) ---
  { match: /<b>\?{3}\s+BOT\s+VPN(\s+\$\{NAMA_STORE\}\s+)\?{3}<\/b>/g, replace: '<b>\u26a1 BOT VPN$1\u26a1</b>', label: 'header bot vpn' },

  // --- '<i>???? Koneksi cepat' = signal icon ---
  { match: /<i>\?{3,4}\s+Koneksi/g, replace: '<i>\ud83d\udce1 Koneksi', label: 'koneksi cepat' },

  // --- Menu utama tombol: '???? Akun Saya', '???? Cek Server', dll ---
  { match: /'\?{3,4}\s+Akun\s+Saya'/g, replace: "'\ud83d\udcc2 Akun Saya'", label: 'btn akun saya' },
  { match: /'\?{3,4}\s+Cek\s+Server'/g, replace: "'\ud83d\udda5\ufe0f Cek Server'", label: 'btn cek server' },
  { match: /'\?{3,4}\s+Riwayat\s+Saya'/g, replace: "'\ud83d\udcca Riwayat Saya'", label: 'btn riwayat saya' },
  { match: /'\?{3,4}\s+Jadi\s+Reseller/g, replace: "'\ud83d\udc8e Jadi Reseller", label: 'btn jadi reseller' },
  { match: /'\?{3,4}\s+TopUp/g, replace: "'\ud83d\udcb3 TopUp", label: 'btn topup' },
  { match: /'\?{3,4}\s+Topup/g, replace: "'\ud83d\udcb3 Topup", label: 'btn topup small' },
  { match: /'\?{3,4}\s+Penjualan\s+Saya/g, replace: "'\ud83d\udcb5 Penjualan Saya", label: 'btn penjualan' },
  { match: /'\?{3,4}\s+Reseller'/g, replace: "'\ud83d\udc8e Reseller'", label: 'status reseller' },

  // --- '??????? Admin' (7 char) = double emoji "⚡👑 Admin" ---
  { match: /\?{7}\s+Admin'/g, replace: '\u26a1\ud83d� Admin\'', label: 'status admin double' },

  // --- 'Anda tidak memiliki izin' = no access reply ---
  { match: /'\?{3,4}\s+Anda\s+tidak\s+memiliki\s+izin/g, replace: "'\ud83d\udeab Anda tidak memiliki izin", label: 'tidak punya izin' },

  // --- 'noteText' template `\n???? Catatan: ` ---
  { match: /\\n\?{3,4}\s+Catatan:/g, replace: '\\n\ud83d\udccc Catatan:', label: 'note catatan' },

  // --- DAFTAR PERINTAH ADMIN ---
  { match: /'\?{3,4}\s+DAFTAR\s+PERINTAH/g, replace: "'\ud83d\udcdc DAFTAR PERINTAH", label: 'daftar perintah' },

  // --- Header utama template multi-line: leading '???? /start' / '???? /admin' (command list) ---
  { match: /\n\?{3,4}\s+\//g, replace: '\n\u2022 /', label: 'newline bullet cmd' },
  { match: /^\?{3,4}\s+\//gm, replace: '\u2022 /', label: 'leading bullet cmd' },

  // --- '??????? /helpadmin' (7 char) triple emoji -> star emoji ---
  { match: /\?{7}\s+\//g, replace: '\u2b50 /', label: 'leading star cmd' },

  // --- Field line dalam template: '??? Nama   :' / '??? ID :' dsb ---
  { match: /\n\?{3}\s+(Nama|ID|Saldo|Status|Editor|Interval|Chat ID|H-|Jam|Tanggal)\s/g, replace: '\n\u2022 $1 ', label: 'newline field label' },
  // Stand-alone baris dimulai dengan '??? Nama'
  { match: /^\?{3}\s+(Nama|ID|Saldo|Status|Editor|Interval|Chat ID|H-|Jam|Tanggal)\s/gm, replace: '\u2022 $1 ', label: 'line field label' },

  // --- '???? Broadcast Terakhir' / '???? Mulai broadcast' ---
  { match: /`\?{3,4}\s+<b>Broadcast\s+Terakhir/g, replace: '`\ud83d\udce2 <b>Broadcast Terakhir', label: 'broadcast terakhir' },
  { match: /`\?{3,4}\s+Mulai\s+broadcast/g, replace: '`\ud83d\udce2 Mulai broadcast', label: 'mulai broadcast' },
  { match: /'\?{3,4}\s+Mulai\s+broadcast/g, replace: "'\ud83d\udce2 Mulai broadcast", label: 'mulai broadcast str' },

  // --- Broadcast summary '???? Target : <b>N</b>' ---
  { match: /`\?{3,4}\s+Target\s+/g, replace: '`\ud83c\udfaf Target ', label: 'target broadcast' },

  // --- Template '100???120 ms' (range dash) ---
  { match: /(\d+)\?{3,4}(\d+)\s+ms/g, replace: '$1\u2013$2 ms', label: 'range ms' },

  // --- Paid API / error inline in template ---
  { match: /`\?{3,4}\s+Paid\s+API:/g, replace: '`\ud83d\udcbc Paid API:', label: 'paid api' },
  { match: /`\?{6}\s+\$\{e\.message/g, replace: '`\u26a0\ufe0f ${e.message', label: 'inline error msg' },

  // --- QRIS topup detail lines: '???? Metode', '???? Invoice', '???? Nominal', '???? Kode unik', '???? Dibayar', '???? Dipilih user' ---
  { match: /`\?{3,4}\s+Metode\s*:/g, replace: '`\ud83d\udcb3 Metode :', label: 'qris metode' },
  { match: /`\?{3,4}\s+Invoice\s*:/g, replace: '`\ud83e\uddfe Invoice :', label: 'qris invoice' },
  { match: /`\?{3,4}\s+Nominal\s*:/g, replace: '`\ud83d\udcb0 Nominal :', label: 'qris nominal' },
  { match: /`\?{3,4}\s+Kode\s+unik/g, replace: '`\ud83d\udd22 Kode unik', label: 'qris kode unik' },
  { match: /`\?{3,4}\s+Dibayar\s+/g, replace: '`\ud83d\udcb5 Dibayar ', label: 'qris dibayar' },
  { match: /`\?{3,4}\s+Dipilih\s+user/g, replace: '`\ud83d\udc64 Dipilih user', label: 'qris dipilih' },

  // --- QRIS header '???? TOPUP SALDO (QRIS)' ---
  { match: /'\?{3,4}\s+TOPUP\s+SALDO/g, replace: "'\ud83d\udcb3 TOPUP SALDO", label: 'qris header topup saldo' },

  // --- Broadcast header '???? Pengumuman ke' ---
  { match: /`\?{3,4}\s+Pengumuman\s+ke/g, replace: '`\ud83d\udce2 Pengumuman ke', label: 'pengumuman ke' },

  // --- Broadcast mode button labels ---
  { match: /\?{3,4}\s+Tulis\s+manual/g, replace: '\u270f\ufe0f Tulis manual', label: 'tulis manual' },
  { match: /\?{3,4}\s+Template\s+Maintenance/g, replace: '\ud83d\udee0\ufe0f Template Maintenance', label: 'tmpl maintenance' },
  { match: /\?{3,4}\s+Template\s+Promo/g, replace: '\ud83c\udf81 Template Promo', label: 'tmpl promo' },
  { match: /'\?{3,4}\s+Maintenance\s+VPN/g, replace: "'\ud83d\udee0\ufe0f Maintenance VPN", label: 'btn maintenance' },
  { match: /'\?{3,4}\s+Promo\s+\/\s+Diskon/g, replace: "'\ud83c\udf81 Promo / Diskon", label: 'btn promo diskon' },

  // --- 'dari menu ???? lagi' = speaker icon for broadcast menu ---
  { match: /menu\s+\?{3,4}\s+lagi/g, replace: 'menu \ud83d\udce2 lagi', label: 'menu broadcast lagi' },

  // --- Step marker '1?????? Masukkan' (6 char) = step emoji 1️⃣ ---
  { match: /(\d)\?{6}\s+/g, replace: '$1\ufe0f\u20e3 ', label: 'step number' },

  // --- 'Silakan masukkan jumlah nominal' = money icon ---
  { match: /`\?{3,4}\s+\*Silakan\s+masukkan/g, replace: '`\ud83d\udcb0 *Silakan masukkan', label: 'silakan masukkan' },

  // --- Upload QRIS info/action icons ---
  { match: /'\?{3,4}\s+Kirim\s+gambar\s+QRIS/g, replace: "'\ud83d\uddbc\ufe0f Kirim gambar QRIS", label: 'kirim gambar qris' },
  { match: /'\u2139\ufe0f QRIS image/g, replace: "'\u2139\ufe0f QRIS image", label: 'noop keep' }, // placeholder, tidak mengubah apa2
  { match: /\?{7}\s+QRIS\s+image/g, replace: '\u2139\ufe0f QRIS image', label: 'qris image info' },

  // --- Header store top-up manual QRIS template ---
  { match: /<b>\?{3,4}\s+Top\s+Up\s+Saldo\s+Manual/g, replace: '<b>\ud83d\udcb3 Top Up Saldo Manual', label: 'header topup manual' },
  { match: /<b>\?{3,4}\s+Format\s+pesan/g, replace: '<b>\u270f\ufe0f Format pesan', label: 'header format pesan' },
  { match: /\?{3,4}\s+Minimal\s+top\s+up:/g, replace: '\u26a0\ufe0f Minimal top up:', label: 'minimal topup' },

  // --- Permission denied ---
  { match: /'\?{3,4}\s+Kamu\s+tidak\s+memiliki\s+izin/g, replace: "'\ud83d\udeab Kamu tidak memiliki izin", label: 'kamu tidak punya izin' },

  // --- Backup DB info/log ---
  { match: /'\?{3,4}\s+Backup\s+database\s+berhasil/g, replace: "'\u2705 Backup database berhasil", label: 'backup berhasil' },
  { match: /`\?{3,4}\s+Backup\s+database\s+dikirim/g, replace: '`\ud83d\udce6 Backup database dikirim', label: 'backup dikirim log' },

  // --- Timezone/Expiry/Auto-backup header admin menu ---
  { match: /'\?{3,4}\s+<b>PENGATURAN\s+TIMEZONE/g, replace: "'\ud83c\udf10 <b>PENGATURAN TIMEZONE", label: 'header timezone' },
  { match: /<b>\?{3,4}\s+Pengaturan\s+Pengingat/g, replace: '<b>\u23f0 Pengaturan Pengingat', label: 'header pengingat' },
  { match: /<b>\?{7}\s+Pengaturan\s+Auto\s+Backup/g, replace: '<b>\ud83d\udcbe Pengaturan Auto Backup', label: 'header auto backup' },
  { match: /'\?{3,4}\s+Matikan\s+Pengingat/g, replace: "'\u26d4 Matikan Pengingat", label: 'btn matikan pengingat' },
  { match: /'\?{3,4}\s+Matikan\s+Auto\s+Backup/g, replace: "'\u26d4 Matikan Auto Backup", label: 'btn matikan backup' },

  // --- Admin: check saldo / flag user / monitor ---
  { match: /'\?{3,4}\s+Masukkan\s+ID\s+Telegram/g, replace: "'\ud83c\udd94 Masukkan ID Telegram", label: 'masukkan id' },
  { match: /'\?{3,4}\s+\*Mode\s+tandai/g, replace: "'\ud83d\udea9 *Mode tandai", label: 'mode tandai' },
  { match: /<b>\?{3,4}\s+Monitor\s+User/g, replace: '<b>\ud83d\udcca Monitor User', label: 'monitor user' },
  { match: /<b>\?{3,4}\s+MANAGEMEN\s+SERVER/g, replace: '<b>\ud83d\uddd1\ufe0f MANAGEMEN SERVER', label: 'management server' },

  // --- List Reseller/Member button ---
  { match: /'\?{3,4}\s+List\s+Reseller'/g, replace: "'\ud83d\udc8e List Reseller'", label: 'btn list reseller' },
  { match: /'\?{3,4}\s+List\s+Member'/g, replace: "'\ud83d\udc64 List Member'", label: 'btn list member' },
  { match: /'\?{3,4}\s+List\s+Server'/g, replace: "'\ud83d\uddd1\ufe0f List Server'", label: 'btn list server' },

  // --- Khusus admin alert ---
  { match: /'\?{3,4}\s+Khusus\s+admin\.'/g, replace: "'\ud83d\udeab Khusus admin.'", label: 'khusus admin' },

  // --- Breadcrumb "... bulan ini: N | total: N" ---
  { match: /}\s+\?{3}\s+bulan\s+ini:/g, replace: '} \u2022 bulan ini:', label: 'breadcrumb bulan ini' },

  // --- Admin menu tombol top-level ---
  { match: /'\?{3,4}\s+Menu\s+Reseller\s+&\s+Saldo/g, replace: "'\ud83e\uddfe Menu Reseller & Saldo", label: 'btn menu reseller saldo' },
  { match: /'\?{3,4}\s+Monitor\s+User\s+&\s+Reseller/g, replace: "'\ud83d\udcca Monitor User & Reseller", label: 'btn monitor user reseller' },
  { match: /'\?{3,4}\s+List\s+Semua\s+User/g, replace: "'\ud83d\udccb List Semua User", label: 'btn list semua user' },
  { match: /'\?{3,4}\s+Tandai\s+User/g, replace: "'\ud83d\udea9 Tandai User", label: 'btn tandai user' },
  { match: /'\?{3,4}\s+Backup\s+Database/g, replace: "'\ud83d\udce6 Backup Database", label: 'btn backup database' },
  { match: /'\?{7}\s+Auto\s+Backup'/g, replace: "'\ud83d\udcbe Auto Backup'", label: 'btn auto backup' },
  { match: /'\?{3,4}\s+Timezone\s+Bot/g, replace: "'\ud83c\udf10 Timezone Bot", label: 'btn timezone bot' },
  { match: /'\?{7}\s+Upload\s+Gambar\s+QRIS/g, replace: "'\ud83d\uddbc\ufe0f Upload Gambar QRIS", label: 'btn upload qris' },
  { match: /'\?{3,4}\s+Kirim\s+Pengumuman/g, replace: "'\ud83d\udce2 Kirim Pengumuman", label: 'btn kirim pengumuman' },
  { match: /'\?{3,4}\s+Semua\s+User'/g, replace: "'\ud83d\udc65 Semua User'", label: 'btn target semua user' },
  { match: /'\?{3,4}\s+Member\s+\(bukan/g, replace: "'\ud83d\udc64 Member (bukan", label: 'btn target member' },
  { match: /'\?{7,}\s+Reseller',/g, replace: "'\ud83d\udc8e\u200d\ud83d\udcb8 Reseller',", label: 'btn target reseller compound' },

  // --- Menu admin header ---
  { match: /'<b>\?{3,4}\s+MENU\s+ADMIN<\/b>'/g, replace: "'<b>\u2699\ufe0f MENU ADMIN</b>'", label: 'header menu admin' },

  // --- Info Lisensi Bot template ---
  { match: /`\?{3,4}\s+<b>INFO\s+LISENSI\s+BOT/g, replace: '`\ud83d\udcdc <b>INFO LISENSI BOT', label: 'tmpl info lisensi' },

  // --- Cek Invoice QRIS header ---
  { match: /'\?{3,4}\s+<b>Cek\s+Invoice\s+QRIS/g, replace: "'\ud83d\udd0d <b>Cek Invoice QRIS", label: 'header cek invoice' },
  { match: /`\?{3,4}\s+Status\s+DB\s*:/g, replace: '`\ud83d\udcbe Status DB :', label: 'status db' },
  { match: /`\?{3,4}\s+Dibuat\s+/g, replace: '`\ud83d\udcc5 Dibuat ', label: 'dibuat' },
  { match: /`\?{3,4}\s+Status\s+API\s*:/g, replace: '`\ud83d\udce1 Status API :', label: 'status api' },
  { match: /'\\n\?{3,4}\s+Paid\s+API/g, replace: "'\\n\ud83d\udcbc Paid API", label: 'str paid api' },
  { match: /\\n\?{6}\s+\$\{e\.message/g, replace: '\\n\u26a0\ufe0f ${e.message', label: 'str error msg' },

  // --- 'Silakan ketik domain server baru' ---
  { match: /'\?{3,4}\s+\*Silakan\s+ketik/g, replace: "'\ud83d\udd8a\ufe0f *Silakan ketik", label: 'silakan ketik' },

  // --- 'Menu ??? Buat Akun' di info (reseller flow) ---
  { match: /\*\?{3}\s+Buat\s+Akun\*/g, replace: '*\ud83d\udecd\ufe0f Buat Akun*', label: 'mention buat akun' },

  // --- '(base_amount tidak tersimpan ??? transaksi lama)' = arrow ---
  { match: /tersimpan\s+\?{3}\s+transaksi/g, replace: 'tersimpan \u2192 transaksi', label: 'arrow transaksi' },

  // --- 'Aktif ???' / 'Nonaktif ???' di trial config ---
  { match: /Aktif\s+\?{3}'/g, replace: "Aktif \u2705'", label: 'trial aktif' },
  { match: /Nonaktif\s+\?{3}'/g, replace: "Nonaktif \u26d4'", label: 'trial nonaktif' },

  // --- Trial config button '???' (standalone) = - / + adjuster ---
  // Context: admin_trial_max_dec/inc. Ada 2 set tombol (max, dur) + 2 nop.
  // Pattern: { text: '???', callback_data: 'admin_trial_max_dec' }
  { match: /text:\s*'\?{3}',\s*callback_data:\s*'admin_trial_(\w+)_dec'/g, replace: "text: '\u2796', callback_data: 'admin_trial_$1_dec'", label: 'trial btn dec' },
  { match: /text:\s*'\?{3}',\s*callback_data:\s*'admin_trial_(\w+)_inc'/g, replace: "text: '\u2795', callback_data: 'admin_trial_$1_inc'", label: 'trial btn inc' },
  { match: /text:\s*'\?{6}',\s*callback_data:\s*'admin_trial_min_dec'/g, replace: "text: '\u2796\u2796', callback_data: 'admin_trial_min_dec'", label: 'trial btn min dec' },
  { match: /text:\s*'\?{6}',\s*callback_data:\s*'admin_trial_min_inc'/g, replace: "text: '\u2795\u2795', callback_data: 'admin_trial_min_inc'", label: 'trial btn min inc' },

  // --- '*??? Simpan Pengaturan*' (inline text) ---
  { match: /\*\?{3}\s+Simpan\s+Pengaturan\*/g, replace: '*\ud83d\udcbe Simpan Pengaturan*', label: 'mention simpan pengaturan' },

  // --- Ringkasan Pengumuman ---
  { match: /`\?{3,4}\s+<b>Ringkasan\s+Pengumuman/g, replace: '`\ud83d\udccb <b>Ringkasan Pengumuman', label: 'ringkasan pengumuman' },
  { match: /'\?{3,4}\s+<b>Kirim\s+Pengumuman/g, replace: "'\ud83d\udce2 <b>Kirim Pengumuman", label: 'kirim pengumuman header' },

  // --- List line ... ??? Saldo: ---
  { match: /\)\s+\?{3}\s+Saldo:/g, replace: ') \u2022 Saldo:', label: 'list item saldo' },

  // --- '??? ' (3 char + space) di awal line = bullet • (karakter 3-byte UTF-8 corrupt)
  // Pattern aman: whitespace + ???  + space, di template string multi-line.
  // Kita handle terpisah dari 'comment arrow' yang sudah diatas.
  { match: /\n(\s*)\?{3}\s+/g, replace: '\n$1\u2022 ', label: 'newline bullet' },

  // --- Tombol navigation 'Berikutnya ??????' di pagination -> '➡️' ---
  { match: /Berikutnya\s+\?{6}/g, replace: 'Berikutnya \u27a1\ufe0f', label: 'nav next' },
  { match: /\?{6}\s+Sebelumnya/g, replace: '\u2b05\ufe0f Sebelumnya', label: 'nav prev' },

  // --- Tombol arrow standalone: '?????? dan ??????' (pagination body text) ---
  { match: /tombol\s+\?{6}\s+dan\s+\?{6}/g, replace: 'tombol \u2b05\ufe0f dan \u27a1\ufe0f', label: 'nav both' },

  // --- Header 'DAFTAR RESELLER/MEMBER/SEMUA USER' ---
  { match: /<b>\?{3,4}\s+DAFTAR\s+RESELLER<\/b>/g, replace: '<b>\ud83d\udc8e DAFTAR RESELLER</b>', label: 'daftar reseller' },
  { match: /<b>\?{3,4}\s+DAFTAR\s+MEMBER<\/b>/g, replace: '<b>\ud83d\udc64 DAFTAR MEMBER</b>', label: 'daftar member' },
  { match: /<b>\?{3,4}\s+DAFTAR\s+SEMUA\s+USER<\/b>/g, replace: '<b>\ud83d\udcdc DAFTAR SEMUA USER</b>', label: 'daftar semua user' },

  // --- Reseller program header + keuntungan bullets ---
  { match: /<b>\?{3,4}\s+Program\s+Reseller/g, replace: '<b>\ud83d\udc8e Program Reseller', label: 'header program reseller' },
  { match: /<b>\?{3}\s+Keuntungan/g, replace: '<b>\u2728 Keuntungan', label: 'header keuntungan' },
  { match: /<b>\?{3,4}\s+Cara\s+daftar/g, replace: '<b>\u270d\ufe0f Cara daftar', label: 'header cara daftar' },
  { match: /<b>\?{6}\s+Keterangan\s+tambahan/g, replace: '<b>\u2139\ufe0f Keterangan tambahan', label: 'header keterangan' },

  // --- Metode : QRIS Otomatis (tmpl) ---
  { match: /'\?{3,4}\s+Metode\s*:/g, replace: "'\ud83d\udcb3 Metode :", label: 'str metode' },

  // --- Broadcast target list (body) ---
  { match: /\?{3,4}\s+Semua\s+User\\n/g, replace: '\ud83d\udc65 Semua User\\n', label: 'txt semua user' },
  { match: /\?{11}\s+Reseller\\n/g, replace: '\ud83d\udc8e\u200d\ud83d\udcb8 Reseller\\n', label: 'txt reseller' },
  { match: /\?{3,4}\s+Member\s+\(bukan/g, replace: '\ud83d\udc64 Member (bukan', label: 'txt member bukan' },

  // --- Status aktif/expired/habis (inline) ---
  { match: /\?{6}\s+Aktif\s+\(habis/g, replace: '\u26a0\ufe0f Aktif (habis', label: 'status aktif habis' },
  { match: /\?{3}\s+Aktif\s+\(~/g, replace: '\u2705 Aktif (~', label: 'status aktif tilde' },
  { match: /\?{3}\s+Sudah\s+expired/g, replace: '\u274c Sudah expired', label: 'status sudah expired' },

  // --- Help text inline emoji setelah '• ' bullet (?? + button name) ---
  // Pattern: '• ???? Dapat harga' / '• ???? Bebas atur'
  // Karena bullet sudah •, '????' setelahnya adalah emoji icon -> sparkle
  { match: /(\u2022\s+)\?{3,4}\s+(Dapat\s+harga|Bebas\s+atur|Prioritas|Support)/g, replace: '$1\u2728 $2', label: 'bullet sparkle' },

  // --- Inline mention button '"<b>??? Buat Akun</b>"' di teks help ---
  { match: /"<b>\?{3}\s+Buat\s+Akun<\/b>"/g, replace: '"<b>\ud83d\udecd\ufe0f Buat Akun</b>"', label: 'help btn buat akun' },
  { match: /"<b>\?{3,4}\s+Akun\s+Saya<\/b>"/g, replace: '"<b>\ud83d\udcc2 Akun Saya</b>"', label: 'help btn akun saya' },
  { match: /"<b>\?{3,4}\s+Riwayat\s+Saya<\/b>"/g, replace: '"<b>\ud83d\udcca Riwayat Saya</b>"', label: 'help btn riwayat' },
  { match: /"<b>\?{3}\s+Trial\s+Akun<\/b>"/g, replace: '"<b>\ud83c\udd93 Trial Akun</b>"', label: 'help btn trial' },
  { match: /"<b>\?{3,4}\s+TopUp\s+Saldo\s+Manual/g, replace: '"<b>\ud83d\udcb3 TopUp Saldo Manual', label: 'help btn topup manual' },
  { match: /"<b>\?{3,4}\s+Jadi\s+Reseller/g, replace: '"<b>\ud83d\udc8e Jadi Reseller', label: 'help btn jadi reseller' },
  { match: /"<b>\?{3}\s+Bantuan<\/b>"/g, replace: '"<b>\u2753 Bantuan</b>"', label: 'help btn bantuan' },
  { match: /<b>\?{3}\s+Buat\s+Akun<\/b>/g, replace: '<b>\ud83d\udecd\ufe0f Buat Akun</b>', label: 'inline buat akun' },

  // --- 'Masukkan domain server reseller' ---
  { match: /'\?{3,4}\s+Masukkan\s+domain\s+server/g, replace: "'\ud83c\udf10 Masukkan domain server", label: 'masukkan domain' },

  // --- QRIS status template '???? <b>Status QRIS</b>' + 'Refresh Status' button ---
  { match: /`\?{3,4}\s+<b>Status\s+QRIS<\/b>/g, replace: '`\ud83d\udd0d <b>Status QRIS</b>', label: 'status qris header' },
  { match: /'\?{3,4}\s+Refresh\s+Status'/g, replace: "'\ud83d\udd04 Refresh Status'", label: 'btn refresh status' },

  // --- Penjualan / target / progress headers ---
  { match: /<b>\?{3,4}\s+Progress\s+Bonus\s+Aktif/g, replace: '<b>\ud83c\udf81 Progress Bonus Aktif', label: 'header progress bonus' },
  { match: /<b>\?{3,4}\s+Penjualan\s+Saya/g, replace: '<b>\ud83d\udcb5 Penjualan Saya', label: 'header penjualan saya' },
  { match: /<b>\?{3,4}\s+Target\s+Bulanan<\/b>/g, replace: '<b>\ud83c\udfaf Target Bulanan</b>', label: 'header target bulanan' },
  { match: /<b>\?{3,4}\s+Status\s+Target\s+Bulan\s+Ini/g, replace: '<b>\ud83d\udcca Status Target Bulan Ini', label: 'header status target' },

  // --- ' ??? sisa <b>N</b>' arrow di kalimat reseller bonus ---
  { match: /\}<\/b>\s+\?{3}\s+sisa\s+<b>/g, replace: '}</b> \u2192 sisa <b>', label: 'arrow sisa' },

  // --- 'Penjualan Saya ??? bulanLabel' breadcrumb ---
  { match: /Penjualan\s+Saya\s+\?{3}\s+\$\{bulanLabel/g, replace: 'Penjualan Saya \u2022 ${bulanLabel', label: 'breadcrumb penjualan' },

  // --- 'durasi ??? 30 hari' / 'berdurasi ??? 30 hari' = greater-equal symbol ---
  { match: /durasi\s+\?{3}\s+(\d+)\s+hari/g, replace: 'durasi \u2265 $1 hari', label: 'gte hari' },

  // --- Server detail template '???? Harga normal' / '???? Harga reseller' / '???? Quota' / '???? Total akun' ---
  { match: /`\?{3,4}\s+Harga\s+normal/g, replace: '`\ud83d\udcb5 Harga normal', label: 'detail harga normal' },
  { match: /`\?{3,4}\s+Harga\s+reseller/g, replace: '`\ud83d\udc8e Harga reseller', label: 'detail harga reseller' },
  { match: /`\?{3,4}\s+Perkiraan\s+(reseller|harga)/g, replace: '`\ud83d\udcb0 Perkiraan $1', label: 'detail perkiraan' },
  { match: /`\?{3,4}\s+Harga\s+(\d+)\s+hari/g, replace: '`\ud83d\udcb5 Harga $1 hari', label: 'detail harga days' },
  { match: /`\?{3,4}\s+Total\s+akun\s+dibuat/g, replace: '`\ud83d\udcca Total akun dibuat', label: 'detail total akun' },
  { match: /`\?{3,4}\s+<b>\$\{server\.nama_server/g, replace: '`\ud83d\udda5\ufe0f <b>${server.nama_server', label: 'detail server name' },
  { match: /`\?{3,4}\s+Quota\s+/g, replace: '`\ud83d\udcca Quota ', label: 'detail quota' },

  // --- Server detail tambahan ---
  { match: /`\?{3,4}\s+Limit\s+IP\s+/g, replace: '`\ud83d\udd22 Limit IP ', label: 'detail limit ip' },
  { match: /`\?{3,4}\s+<b>List\s+Server<\/b>/g, replace: '`\ud83d\udda5\ufe0f <b>List Server</b>', label: 'header list server' },

  // --- 'Masukkan username:' (input prompt) ---
  { match: /'\?{3,4}\s+<b>Masukkan\s+username/g, replace: "'\ud83d\udc64 <b>Masukkan username", label: 'masukkan username html' },
  { match: /'\?{3,4}\s+\*Masukkan\s+username\s+yang\s+ingin\s+(dihapus|dibuka|dikunci)/g, replace: (m, action) => {
    const map = { 'dihapus': '\u274c', 'dibuka': '\ud83d\udd13', 'dikunci': '\ud83d\udd12' };
    return "'" + map[action] + ' *Masukkan username yang ingin ' + action;
  }, label: 'username action prompt' },

  // --- VPN type icon (case statement) ---
  { match: /'\?{3,4}\s+SSH'/g, replace: "'\ud83d\uddff SSH'", label: 'type ssh' },
  { match: /'\?{3,4}\s+VMess'/g, replace: "'\ud83d\udd17 VMess'", label: 'type vmess' },
  { match: /'\?{3,4}\s+VLess'/g, replace: "'\ud83d\udd17 VLess'", label: 'type vless' },
  { match: /'\?{3,4}\s+Trojan'/g, replace: "'\ud83c\udfa0 Trojan'", label: 'type trojan' },
  { match: /'\?{3,4}\s+Shadowsocks'/g, replace: "'\ud83d\udc7b Shadowsocks'", label: 'type shadowsocks' },

  // --- 'Riwayat Akun Kamu' header ---
  { match: /<b>\?{3,4}\s+Riwayat\s+Akun\s+Kamu/g, replace: '<b>\ud83d\udcc8 Riwayat Akun Kamu', label: 'header riwayat akun' },

  // --- '"???? Kirim Pengumuman"' inline mention text ---
  { match: /"\?{3,4}\s+Kirim\s+Pengumuman"/g, replace: '"\ud83d\udce2 Kirim Pengumuman"', label: 'mention kirim pengumuman' },

  // --- Preview Pengumuman headers ---
  { match: /`\?{3,4}\s+<b>Preview\s+Pengumuman\s+Maintenance/g, replace: '`\ud83d\udccb <b>Preview Pengumuman Maintenance', label: 'preview maintenance' },
  { match: /`\?{3,4}\s+<b>Preview\s+Pengumuman\s+Promo/g, replace: '`\ud83d\udccb <b>Preview Pengumuman Promo', label: 'preview promo' },
  { match: /`\?{3,4}\s+<b>Preview\s+Pengumuman</g, replace: '`\ud83d\udccb <b>Preview Pengumuman<', label: 'preview pengumuman generic' },

  // --- Pengumuman maintenance + promo body ---
  { match: /'\?{3,4}\s+<b>PENGUMUMAN\s+MAINTENANCE/g, replace: "'\ud83d\udee0\ufe0f <b>PENGUMUMAN MAINTENANCE", label: 'pengumuman maintenance body' },
  { match: /'\?{3,4}\s+<b>PROMO\s+\/\s+DISKON/g, replace: "'\ud83c\udf81 <b>PROMO / DISKON", label: 'pengumuman promo body' },
  { match: /`\?{3,4}\s+Waktu\s+mulai\s*:/g, replace: '`\u23f0 Waktu mulai :', label: 'waktu mulai' },
  { match: /`\?{3,4}\s+Berlaku\s+sampai:/g, replace: '`\ud83d\udcc5 Berlaku sampai:', label: 'berlaku sampai' },

  // --- Logger info '???? Poll QRIS GoPay: ' ---
  { match: /`\?{3,4}\s+Poll\s+QRIS\s+GoPay/g, replace: '`\ud83d\udd0d Poll QRIS GoPay', label: 'log poll qris' },

  // --- Tombol QRIS '???? Buat QRIS Baru' / '???? Cek Status' ---
  { match: /'\?{3,4}\s+Buat\s+QRIS\s+Baru'/g, replace: "'\ud83d\udcb3 Buat QRIS Baru'", label: 'btn buat qris baru' },
  { match: /'\?{3,4}\s+Cek\s+Status'/g, replace: "'\ud83d\udd04 Cek Status'", label: 'btn cek status' },

  // --- QRIS invoice template detail '???? <b>Invoice</b>' / '???? <b>Nominal</b>' / '???? <b>Kode unik</b>' / '???? <b>Total bayar</b>' ---
  { match: /`\?{3,4}\s+<b>Invoice<\/b>/g, replace: '`\ud83e\uddfe <b>Invoice</b>', label: 'qris detail invoice' },
  { match: /`\?{3,4}\s+<b>Nominal<\/b>/g, replace: '`\ud83d\udcb0 <b>Nominal</b>', label: 'qris detail nominal' },
  { match: /`\?{3,4}\s+<b>Kode\s+unik<\/b>/g, replace: '`\ud83d\udd22 <b>Kode unik</b>', label: 'qris detail kode unik' },
  { match: /`\?{3,4}\s+<b>Total\s+bayar<\/b>/g, replace: '`\ud83d\udcb5 <b>Total bayar</b>', label: 'qris detail total bayar' },

  // --- 'Scan QR lalu bayar' instruksi ---
  { match: /`\?{3,4}\s+Scan\s+QR\s+/g, replace: '`\ud83d\udcf2 Scan QR ', label: 'scan qr' },

  // --- 'Link Pembayaran:' ---
  { match: /\\n\\n\?{3,4}\s+Link\s+Pembayaran:/g, replace: '\\n\\n\ud83d\udd17 Link Pembayaran:', label: 'link pembayaran' },

  // --- Konfirmasi Topup QRIS template ---
  { match: /'\?{3,4}\s+<b>Konfirmasi\s+Topup\s+QRIS/g, replace: "'\ud83d\udcb3 <b>Konfirmasi Topup QRIS", label: 'konfirmasi topup' },
  { match: /`\?{3,4}\s+Nominal\s+topup:/g, replace: '`\ud83d\udcb0 Nominal topup:', label: 'nominal topup' },
  { match: /`\?{3,4}\s+Jumlah\s+yang\s+harus\s+dibayar:/g, replace: '`\ud83d\udcb5 Jumlah yang harus dibayar:', label: 'jumlah dibayar' },
  { match: /'\?{3,4}\s+Bonus\s+topup:/g, replace: "'\ud83c\udf81 Bonus topup:", label: 'bonus topup tidak' },
  { match: /`\?{3,4}\s+Estimasi\s+saldo\s+masuk:/g, replace: '`\ud83d\udcb0 Estimasi saldo masuk:', label: 'estimasi saldo' },
  { match: /'\?{3,4}\s+Tekan\s+<b>/g, replace: "'\u2139\ufe0f Tekan <b>", label: 'tekan tombol info' },
  { match: /<b>\?{3}\s+Lanjut\s+Topup<\/b>/g, replace: '<b>\u27a1\ufe0f Lanjut Topup</b>', label: 'mention lanjut topup' },

  // --- 'Catatan saat ini: ' template ---
  { match: /\\n\?{3,4}\s+Catatan\s+saat\s+ini:/g, replace: '\\n\ud83d\udccc Catatan saat ini:', label: 'catatan saat ini' },

  // --- Header 'Data user' / 'RIWAYAT SALDO USER' ---
  { match: /`\?{3,4}\s+\*Data\s+user:/g, replace: '`\ud83d\udc64 *Data user:', label: 'header data user' },
  { match: /<b>\?{3,4}\s+RIWAYAT\s+SALDO\s+USER<\/b>/g, replace: '<b>\ud83d\udcdc RIWAYAT SALDO USER</b>', label: 'header riwayat saldo' },

  // --- 'Silakan topup saldo' inline mention ---
  { match: /\*\?{3,4}\s+TopUp\s+Saldo/g, replace: '*\ud83d\udcb3 TopUp Saldo', label: 'mention topup saldo bold' },

  // --- Range '3???20 karakter' = endash ---
  { match: /(\d+)\?{3,4}(\d+)\s+karakter/g, replace: '$1\u2013$2 karakter', label: 'range karakter' },

  // --- console.log informational icons ---
  { match: /'\?{3,4}\s+ID\s+Pengguna:/g, replace: "'\ud83c\udd94 ID Pengguna:", label: 'log id pengguna' },
  { match: /'\?{3,4}\s+Daftar\s+Ressel:/g, replace: "'\ud83d\udcdc Daftar Ressel:", label: 'log daftar ressel' },

  // --- Input prompts dengan markdown bold '*Silakan masukkan ...*' ---
  { match: /'\?{3,4}\s+\*Masukkan\s+password:/g, replace: "'\ud83d\udd11 *Masukkan password:", label: 'masukkan password' },
  { match: /'\?{3,4}\s+\*Silakan\s+masukkan\s+(auth|quota|limit|batas|harga)/g, replace: "'\u270f\ufe0f *Silakan masukkan $1", label: 'silakan masukkan generic' },
  { match: /'\?{3,4}\s+Masukkan\s+(auth|harga)\s+server/g, replace: "'\u270f\ufe0f Masukkan $1 server", label: 'masukkan generic server' },

  // --- Detail server pada notif setelah create '???? *Detail Server:*' ---
  { match: /\\n\\n\?{3,4}\s+\*Detail\s+Server:/g, replace: '\\n\\n\ud83d\udcdd *Detail Server:', label: 'detail server label' },

  // --- 'msg.includes("???")' (case lookup msg di provider response) ---
  // Ini bukan emoji corrupt, tapi pattern check '???' literal dari API response.
  // Skip: keep as-is.

  // --- Admin prompt server config ---
  { match: /'\?{3,4}\s+Masukkan\s+(nama|quota|IP\s+limit|batas|jumlah)\s+/g, replace: "'\u270f\ufe0f Masukkan $1 ", label: 'masukkan admin prompt' },
  { match: /'\?{3,4}\s+Silakan\s+cek\s+saldo/g, replace: "'\u2139\ufe0f Silakan cek saldo", label: 'info cek saldo' },

  // --- logger info startup '???? Proses ...' ---
  { match: /'\?{3,4}\s+Proses\s+(tambah|detail|daftar)/g, replace: "'\u23f3 Proses $1", label: 'log proses' },

  // --- Admin list server header '???? *Daftar Server* ????' ---
  { match: /'\?{3,4}\s+\*Daftar\s+Server\*\s+\?{3,4}/g, replace: "'\ud83d\uddd1\ufe0f *Daftar Server* \ud83d\uddd1\ufe0f", label: 'header daftar server bangsa' },

  // --- Numbered list item server '???? ${index + 1}. ${server.domain}' ---
  { match: /`\?{3,4}\s+\$\{index\s*\+\s*1\}\./g, replace: '`\u2022 ${index + 1}.', label: 'list server bullet' },

  // --- 'PERHATIAN!' warning admin destructive ---
  { match: /'\?{3,4}\s+\*PERHATIAN!/g, replace: "'\u26a0\ufe0f *PERHATIAN!", label: 'perhatian warning' },

  // --- 'Saldo user sekarang' inline result ---
  { match: /\\n\?{3,4}\s+Saldo\s+user\s+sekarang:/g, replace: '\\n\ud83d\udcb0 Saldo user sekarang:', label: 'saldo user sekarang' },

  // --- '???? *Detail:*' ---
  { match: /'\?{3,4}\s+\*Detail:\*/g, replace: "'\ud83d\udccb *Detail:*", label: 'detail label admin' },

  // --- Inline mention '*Silakan pilih server untuk melihat detail*' ---
  { match: /'\?{3,4}\s+\*Silakan\s+pilih\s+server/g, replace: "'\ud83d\udd0d *Silakan pilih server", label: 'silakan pilih server' },
  { match: /'\?{3,4}\s+\*Silakan\s+masukkan\s+domain/g, replace: "'\u270f\ufe0f *Silakan masukkan domain", label: 'silakan masukkan domain' },

  // --- Delete/confirm button (admin server) '???' standalone ---
  { match: /text:\s*'\?{3}',\s*callback_data:\s*'delete'/g, replace: "text: '\ud83d\uddd1\ufe0f', callback_data: 'delete'", label: 'btn delete admin' },
  { match: /text:\s*'\?{3}',\s*callback_data:\s*'confirm'/g, replace: "text: '\u2705', callback_data: 'confirm'", label: 'btn confirm admin' },

  // --- 'MANAGEMEN SERVER' header 7-char '??????? MANAGEMEN' ---
  { match: /<b>\?{7}\s+MANAGEMEN\s+SERVER/g, replace: '<b>\ud83d\uddd1\ufe0f MANAGEMEN SERVER', label: 'header managemen server 7' },

  // --- 'IP limit' admin prompt sisa ---
  { match: /'\?{3,4}\s+Masukkan\s+IP\s+limit/g, replace: "'\u270f\ufe0f Masukkan IP limit", label: 'masukkan ip limit' },

  // --- Template string gLines.push('???? <b>...:</b> ...') = label icon ---
  // Pattern aman: list line di notifikasi topup. Default ke '\u2022' (bullet) tapi
  // beberapa khusus: User=👤 ID=🆔 Metode=💳 Nominal=💰 Bonus=🎁
  // Saldo Masuk=💰 Ref=🧾 Waktu=🕒
  { match: /\?{3,4}\s+<b>User:<\/b>/g, replace: '\ud83d\udc64 <b>User:</b>', label: 'icon user' },
  { match: /\?{3,4}\s+<b>ID:<\/b>/g, replace: '\ud83c\udd94 <b>ID:</b>', label: 'icon id' },
  { match: /\?{3,4}\s+<b>Metode:<\/b>/g, replace: '\ud83d\udcb3 <b>Metode:</b>', label: 'icon metode' },
  { match: /\?{3,4}\s+<b>Nominal:<\/b>/g, replace: '\ud83d\udcb0 <b>Nominal:</b>', label: 'icon nominal' },
  { match: /\?{3,4}\s+<b>Bonus:<\/b>/g, replace: '\ud83c\udf81 <b>Bonus:</b>', label: 'icon bonus' },
  { match: /\?{3,4}\s+<b>Saldo[^<]*<\/b>/g, replace: (m) => '\ud83d\udcb0 ' + m.replace(/\?{3,4}\s+/, ''), label: 'icon saldo' },
  { match: /\?{3,4}\s+<b>Ref:<\/b>/g, replace: '\ud83e\uddfe <b>Ref:</b>', label: 'icon ref' },
  { match: /\?{3,4}\s+<b>Waktu:<\/b>/g, replace: '\ud83d\udd52 <b>Waktu:</b>', label: 'icon waktu' },
  { match: /\?{3,4}\s+<b>Tipe:<\/b>/g, replace: '\ud83c\udf9f\ufe0f <b>Tipe:</b>', label: 'icon tipe' },
  { match: /\?{3,4}\s+<b>Server:<\/b>/g, replace: '\ud83d\udda5\ufe0f <b>Server:</b>', label: 'icon server' },
  { match: /\?{3,4}\s+<b>Status:<\/b>/g, replace: '\u2139\ufe0f <b>Status:</b>', label: 'icon status' },
  { match: /\?{3,4}\s+<b>Aksi:<\/b>/g, replace: '\u26a1 <b>Aksi:</b>', label: 'icon aksi' },

  // --- '???? Terima kasih' (di akhir notif) -> '🙏 Terima kasih' ---
  { match: /Terima\s+kasih\s+\?{3,4}/g, replace: 'Terima kasih \ud83d\ude4f', label: 'thanks emoji' },

  // --- Tombol '???? Kembali' / '???? Ubah ...' / '???? Menu Utama' (4 char) ---
  { match: /'\?{3,4}\s+Kembali/g, replace: "'\ud83d\udd19 Kembali", label: 'btn kembali 4' },
  { match: /'\?{3,4}\s+Menu\s+Utama/g, replace: "'\ud83c\udfe0 Menu Utama", label: 'btn menu utama' },
  { match: /'\?{3,4}\s+Ubah\s+([A-Z])/g, replace: "'\u270f\ufe0f Ubah $1", label: 'btn ubah' },
  { match: /'\?{3,4}\s+(Lanjut|Lanjutkan)/g, replace: "'\u27a1\ufe0f $1", label: 'btn lanjut' },
  { match: /'\?{3,4}\s+(Batal|Batalkan)/g, replace: "'\u274c $1", label: 'btn batal' },
  { match: /'\?{3,4}\s+(Konfirmasi|Setuju|Ya|OK)/g, replace: "'\u2705 $1", label: 'btn konfirmasi' },
  { match: /'\?{3,4}\s+(Salin|Copy)/g, replace: "'\ud83d\udccb $1", label: 'btn salin' },
  { match: /'\?{3,4}\s+(Hapus|Delete)/g, replace: "'\ud83d\uddd1\ufe0f $1", label: 'btn hapus' },
  { match: /'\?{3,4}\s+(Edit|Ubah)/g, replace: "'\u270f\ufe0f $1", label: 'btn edit' },
  { match: /'\?{3,4}\s+(Detail|Info)/g, replace: "'\u2139\ufe0f $1", label: 'btn detail' },

  // --- '???? <b>Mode input API key' = info icon ---
  { match: /'\?{3,4}\s+<b>Mode\s+input/g, replace: "'\u2139\ufe0f <b>Mode input", label: 'mode input' },

  // --- NO_ACCESS_MESSAGE = '???? Kamu tidak punya akses' -> '🚫 Kamu tidak punya akses' ---
  { match: /'\?{3,4}\s+Kamu\s+tidak\s+punya\s+akses/g, replace: "'\ud83d\udeab Kamu tidak punya akses", label: 'no access' },

  // --- Toast pattern `?????? ${text}` -> warning ---
  { match: /`\?\?\?\?\?\?\s+\$\{/g, replace: '`\u26a0\ufe0f ${', label: 'toast warning' },

  // --- Double-emoji warning di awal logger.error, ctx.reply ---
  // '?????? *GAGAL!*' -> '⚠️ *GAGAL!*'
  { match: /'\?\?\?\?\?\?\s+([*_])([A-Z])/g, replace: "'\u26a0\ufe0f $1$2", label: 'warning prefix cap text' },
  { match: /'\?\?\?\?\?\?\s+(Gagal|Terjadi|Tidak|Kesalahan|Server|Admin|Pengaturan)/g, replace: "'\u26a0\ufe0f $1", label: 'warning prefix' },
  { match: /\?\?\?\?\?\?\s+<b>/g, replace: '\u26a0\ufe0f <b>', label: 'warning html prefix' },
  { match: /\?\?\?\?\?\?\s+\*/g, replace: '\u26a0\ufe0f *', label: 'warning markdown prefix' },

  // --- Single emoji error (3 char ???) di awal log/reply ---
  { match: /logger\.error\('\?\?\?\s/g, replace: "logger.error('\u274c ", label: 'logger error' },
  { match: /logger\.warn\('\?\?\?\s/g, replace: "logger.warn('\u26a0\ufe0f ", label: 'logger warn' },
  { match: /console\.error\('\?\?\?\s/g, replace: "console.error('\u274c ", label: 'console error' },
  { match: /ctx\.reply\('\?\?\?\s+([*_])/g, replace: "ctx.reply('\u274c $1", label: 'reply error md' },
  { match: /ctx\.reply\('\?\?\?\s+(Terjadi|Kesalahan|Gagal|Tidak|Username|Server|Data|User|ID)/g, replace: "ctx.reply('\u274c $1", label: 'reply error text' },
  { match: /ctx\.reply\('\?\?\?\s+<b>/g, replace: "ctx.reply('\u274c <b>", label: 'reply error html' },
  { match: /answerCbQuery\('\?\?\?\s/g, replace: "answerCbQuery('\u274c ", label: 'cbquery error' },
  { match: /editMessageText\('\?\?\?\s+([*_])/g, replace: "editMessageText('\u274c $1", label: 'edit error md' },
  { match: /editMessageText\('\?\?\?\s+<b>/g, replace: "editMessageText('\u274c <b>", label: 'edit error html' },

  // --- Emoji di template string ---
  { match: /`\?\?\?\s+<b>/g, replace: '`\u274c <b>', label: 'tmpl error html' },
  { match: /`\?\?\?\?\?\?\s+<b>/g, replace: '`\u26a0\ufe0f <b>', label: 'tmpl warning html' },

  // --- Return error di string concat ---
  { match: /\|\|\s*'\?\?\?'/g, replace: "|| '\u2753'", label: 'question mark fallback' },
  { match: /'\?\?\?'\s*:/g, replace: "'\u2753':", label: 'question mark value' },

  // --- Tombol '??? Kembali' -> '🔙 Kembali' ---
  { match: /text:\s*'\?\?\?\s+Kembali/g, replace: "text: '\ud83d\udd19 Kembali", label: 'btn kembali' },
  { match: /'\?\?\?\s+Kembali/g, replace: "'\ud83d\udd19 Kembali", label: 'kembali prefix' },

  // --- Pelan-pelan ya???  -> Pelan-pelan ya⏳ ---
  { match: /Pelan-pelan ya\?\?\?/g, replace: 'Pelan-pelan ya\u23f3', label: 'slow tag' },
  { match: /Sedang diproses\?\?\?/g, replace: 'Sedang diproses\u23f3', label: 'processing tag' },

  // --- Separator line di <code> block ---
  // '???' panjang (>= 15 char) dalam <code>...</code> = garis pemisah
  { match: /<code>(\?{15,})<\/code>/g, replace: (m, g1) => '<code>' + '\u2501'.repeat(Math.floor(g1.length / 3)) + '</code>', label: 'separator <code>' },
  // panjang (>= 15) standalone di template string
  { match: /(\?{15,})/g, replace: (m) => '\u2501'.repeat(Math.floor(m.length / 3)), label: 'long separator' },

  // --- Cleanup: ??? yang masih tersisa dalam pesan user-facing ---
  // Pola umum: '??? ' di awal kalimat = error/warning. Kita default ke '❌ '.
  { match: /'\?\?\?\s/g, replace: "'\u274c ", label: 'generic error prefix' },
  { match: /`\?\?\?\s/g, replace: '`\u274c ', label: 'generic tmpl error prefix' },
];

let totalReplaced = 0;
const perRule = {};

let text = lines.join('\n');
for (const rule of rules) {
  const before = text;
  if (typeof rule.replace === 'function') {
    text = text.replace(rule.match, rule.replace);
  } else {
    text = text.replace(rule.match, rule.replace);
  }
  const delta = (before.match(/\?\?\?/g) || []).length - (text.match(/\?\?\?/g) || []).length;
  perRule[rule.label] = delta;
  totalReplaced += delta;
}

console.log('Rule breakdown (emoji restored per rule):');
for (const [k, v] of Object.entries(perRule)) {
  if (v > 0) console.log('  ' + v + 'x  ' + k);
}

const remaining = (text.match(/\?\?\?/g) || []).length;
console.log('\nTotal ??? restored: ' + totalReplaced);
console.log('Remaining ???: ' + remaining);

if (DRY_RUN) {
  console.log('\n[dry-run] Tidak menulis file. Jalankan tanpa --dry-run untuk apply.');
} else {
  fs.writeFileSync(APP_PATH, text);
  console.log('\nTulis ke ' + APP_PATH);
}
