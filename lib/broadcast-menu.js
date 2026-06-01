'use strict';

const { htmlEscape } = require('./html');

function buildBroadcastTargetText() {
  return (
    '📢 <b>Kirim Pengumuman</b>\n\n' +
    'Silakan pilih target pengumuman:\n' +
    '• 👥 Semua User\n' +
    '• 💎💸 Reseller\n' +
    '• 👤 Member (bukan reseller & bukan admin)\n\n' +
    'Setelah pilih target, kirim teks pengumuman di chat ini.'
  );
}

function buildBroadcastTargetKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '👥 Semua User', callback_data: 'broadcast_target_all' }],
      [
        { text: '💎💸 Reseller', callback_data: 'broadcast_target_reseller' },
        { text: '👤 Member', callback_data: 'broadcast_target_member' },
      ],
      [{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }],
    ],
  };
}

function getBroadcastTargetLabel(target) {
  if (target === 'reseller') return 'semua reseller';
  if (target === 'member') return 'member (bukan reseller & bukan admin)';
  return 'semua user';
}

function buildBroadcastModeText(target) {
  const targetLabel = htmlEscape(getBroadcastTargetLabel(target));
  return (
    `📢 Pengumuman ke <b>${targetLabel}</b>\n\n` +
    'Pilih cara membuat pengumuman:\n' +
    '• ✏️ Tulis manual (ketik bebas)\n' +
    '• 🛠️ Template Maintenance VPN\n' +
    '• ✅ Template Maintenance Selesai\n' +
    '• 🎁 Template Promo/Diskon VPN\n' +
    '• 🔥 Template Slot/Stok Terbatas\n' +
    '• 📋 Template Info / Pengumuman Umum'
  );
}

function buildBroadcastModeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⚠️ Tulis Manual', callback_data: 'broadcast_mode_manual' }],
      [{ text: '🛠️ Maintenance VPN', callback_data: 'broadcast_mode_maintenance' }],
      [{ text: '✅ Maintenance Selesai', callback_data: 'broadcast_mode_maintenance_done' }],
      [{ text: '🎁 Promo / Diskon', callback_data: 'broadcast_mode_promo' }],
      [{ text: '🔥 Slot/Stok Terbatas', callback_data: 'broadcast_mode_slot' }],
      [{ text: '📋 Info / Pengumuman Umum', callback_data: 'broadcast_mode_info' }],
      [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
    ],
  };
}

function buildBroadcastCancelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '❌ Batal', callback_data: 'broadcast_cancel' }],
    ],
  };
}

function buildBroadcastBackToAdminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }],
    ],
  };
}

function buildBroadcastManualPromptText() {
  return (
    '⚠️ Silakan kirim teks pengumuman yang ingin dikirim.\n' +
    'ℹ️ Atau tekan ❌ Batal di bawah untuk membatalkan.'
  );
}

const TEMPLATE_PROMPTS = {
  maintenance:
    '🛠️ Template Maintenance VPN\n\n' +
    '1️⃣ Masukkan nama server atau layanan yang terkena maintenance.\n' +
    'Contoh:\n' +
    '• Semua server VPN\n' +
    '• Server SG-1 & SG-2\n' +
    '• Layanan SSH & VMESS',
  maintenanceDone:
    '✅ Template Maintenance Selesai\n\n' +
    '1️⃣ Masukkan nama server atau layanan yang maintenance-nya sudah selesai.\n' +
    'Contoh:\n' +
    '• Semua server VPN\n' +
    '• Server SG-1 & SG-2\n' +
    '• Layanan SSH & VMESS',
  promo:
    '🎁 Template Promo / Diskon VPN\n\n' +
    '1️⃣ Masukkan nama paket atau jenis promo.\n' +
    'Contoh:\n' +
    '• Paket 30 Hari All Server\n' +
    '• Promo Akhir Bulan 7 Hari\n' +
    '• Diskon 30% semua paket bulanan',
  slot:
    '🔥 Template Slot / Stok Terbatas\n\n' +
    '1️⃣ Masukkan nama layanan / produk yang slotnya terbatas.\n' +
    'Contoh:\n' +
    '• Akun Direct EDU\n' +
    '• Slot promo bulanan\n' +
    '• Server SG-1 reseller',
  info:
    '📋 Template Info / Pengumuman Umum\n\n' +
    '1️⃣ Masukkan judul pengumuman.\n' +
    'Contoh:\n' +
    '• Server Baru Tersedia\n' +
    '• Update Aturan Pemakaian\n' +
    '• Libur Lebaran',
};

function buildBroadcastTemplatePromptText(kind) {
  return TEMPLATE_PROMPTS[kind] || '';
}

module.exports = {
  buildBroadcastTargetText,
  buildBroadcastTargetKeyboard,
  getBroadcastTargetLabel,
  buildBroadcastModeText,
  buildBroadcastModeKeyboard,
  buildBroadcastCancelKeyboard,
  buildBroadcastBackToAdminKeyboard,
  buildBroadcastManualPromptText,
  buildBroadcastTemplatePromptText,
};
