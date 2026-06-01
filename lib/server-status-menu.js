'use strict';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cleanServerStatusOutput(stdout, maxLength = 1500) {
  let cleanOutput = String(stdout || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (!cleanOutput) cleanOutput = 'Tidak ada output dari skrip cek-port.sh.';
  cleanOutput = escapeHtml(cleanOutput);
  if (cleanOutput.length > maxLength) {
    cleanOutput = cleanOutput.slice(0, maxLength) + '\n... (dipotong, output terlalu panjang)';
  }
  return cleanOutput;
}

function buildServerStatusResultText(options = {}) {
  const {
    stdout = '',
    timestamp = '',
    maxLength = 1500,
  } = options;

  const cleanOutput = cleanServerStatusOutput(stdout, maxLength);
  const legend =
    '\n\n<b>Keterangan:</b>\n' +
    '? <b>OPEN</b>      : Port terbuka dan layanan merespons dengan baik.\n' +
    '? <b>CLOSED</b>    : Port tertutup atau layanan tidak aktif.\n' +
    '? <b>TIMEOUT</b>   : Tidak ada balasan dari server, kemungkinan gangguan koneksi.';

  return (
    '<b>?? STATUS SERVER </b>\n' +
    `Waktu cek: <b>${escapeHtml(timestamp)}</b>\n\n` +
    `<pre>${cleanOutput}</pre>` +
    legend
  );
}

module.exports = {
  escapeHtml,
  cleanServerStatusOutput,
  buildServerStatusResultText,
};
