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
