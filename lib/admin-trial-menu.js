'use strict';

function formatWatchlistTrialLabel(value) {
  return Number(value) === 0 ? 'tidak boleh trial' : `${value}x per hari`;
}

function buildAdminTrialMenuText(cfg = {}) {
  const statusText = cfg.enabled ? 'Aktif ✅' : 'Nonaktif ⛔';
  const maxPerDay = cfg.maxPerDay;
  const durationHours = cfg.durationHours;
  const minBalance = cfg.minBalanceForTrial || 0;
  const watchlistMax = cfg.watchlistMaxPerDay;
  const watchlistLabel = formatWatchlistTrialLabel(watchlistMax);

  return (
    '🧪 *Pengaturan Trial Akun*\n\n' +
    `Status trial saat ini           : *${statusText}*\n` +
    `Maksimal trial / user / hari    : *${maxPerDay}x*\n` +
    `Lama trial (masa aktif akun)    : *${durationHours} jam*\n` +
    `Minimal saldo untuk trial       : *Rp${minBalance}*\n` +
    `Batas trial user WATCHLIST      : *${watchlistLabel}*\n\n` +
    'Silakan atur nilai di bawah ini.\n' +
    'Perubahan *belum disimpan* sebelum kamu menekan tombol *💾 Simpan Pengaturan*.\n'
  );
}

function buildAdminTrialMenuKeyboard(cfg = {}) {
  const toggleText = cfg.enabled ? '⛔ Matikan Trial' : '✅ Aktifkan Trial';
  const maxPerDay = cfg.maxPerDay;
  const durationHours = cfg.durationHours;
  const minBalance = cfg.minBalanceForTrial || 0;
  const watchlistMax = cfg.watchlistMaxPerDay;

  return {
    inline_keyboard: [
      [{ text: toggleText, callback_data: 'admin_trial_toggle' }],
      [
        { text: '➖', callback_data: 'admin_trial_max_dec' },
        { text: `Max/Hari: ${maxPerDay}x`, callback_data: 'admin_trial_nop' },
        { text: '➕', callback_data: 'admin_trial_max_inc' },
      ],
      [
        { text: '➖', callback_data: 'admin_trial_dur_dec' },
        { text: `Lama: ${durationHours} jam`, callback_data: 'admin_trial_dur_nop' },
        { text: '➕', callback_data: 'admin_trial_dur_inc' },
      ],
      [
        { text: '➖➖', callback_data: 'admin_trial_min_dec' },
        { text: `Min Saldo: Rp${minBalance}`, callback_data: 'admin_trial_min_nop' },
        { text: '➕➕', callback_data: 'admin_trial_min_inc' },
      ],
      [
        { text: '➖', callback_data: 'admin_trial_wlmax_dec' },
        { text: `WATCHLIST: ${watchlistMax}x`, callback_data: 'admin_trial_wlmax_nop' },
        { text: '➕', callback_data: 'admin_trial_wlmax_inc' },
      ],
      [{ text: '💾 Simpan Pengaturan', callback_data: 'admin_trial_save' }],
      [{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }],
    ],
  };
}

function buildAdminTrialSaveSuccessText(cfg = {}) {
  const statusText = cfg.enabled ? 'Aktif ✅' : 'Nonaktif ⛔';
  const wlLabel = formatWatchlistTrialLabel(cfg.watchlistMaxPerDay);
  return (
    '✅ *Pengaturan trial berhasil disimpan.*\n\n' +
    `Status trial          : *${statusText}*\n` +
    `Max trial / hari      : *${cfg.maxPerDay}x per user*\n` +
    `Lama trial per akun   : *${cfg.durationHours} jam*\n` +
    `Min saldo untuk trial : *Rp${cfg.minBalanceForTrial}*\n` +
    `Batas WATCHLIST       : *${wlLabel}*`
  );
}

function buildAdminTrialBackKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }],
    ],
  };
}

module.exports = {
  formatWatchlistTrialLabel,
  buildAdminTrialMenuText,
  buildAdminTrialMenuKeyboard,
  buildAdminTrialSaveSuccessText,
  buildAdminTrialBackKeyboard,
};
