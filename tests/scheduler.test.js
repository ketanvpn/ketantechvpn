// Tests scheduler factory dengan node:test mock timer.
// Verifikasi: start() memasang interval, tick memicu callback, restart() clear timer lama.

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { createAutoBackupScheduler } = require('../scheduler/auto-backup');
const { createDailyReportScheduler } = require('../scheduler/daily-report');
const { createExpiryReminderScheduler } = require('../scheduler/expiry-reminder');
const { createResellerTargetScheduler } = require('../scheduler/reseller-target');

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function stubBot() {
  const sent = [];
  return {
    telegram: {
      async sendMessage(chatId, text) { sent.push({ type: 'msg', chatId, text }); },
      async sendDocument() { sent.push({ type: 'doc' }); },
    },
    _sent: sent,
  };
}

// ===== auto-backup =====

test('auto-backup: disabled -> no timer', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const scheduler = createAutoBackupScheduler({
      logger: silentLogger(),
      bot: stubBot(),
      isEnabled: () => false,
      getIntervalHours: () => 12,
      getBackupChatId: () => null,
      getTimeZone: () => 'Asia/Jakarta',
      baseDir: __dirname,
      backupFiles: [],
    });
    scheduler.restart();
    // tick 24 jam, tidak boleh ada error
    mock.timers.tick(24 * 60 * 60 * 1000);
  } finally {
    mock.timers.reset();
  }
});

test('auto-backup: enabled -> sendAutoBackup dipanggil tiap interval', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const bot = stubBot();
    const scheduler = createAutoBackupScheduler({
      logger: silentLogger(),
      bot,
      isEnabled: () => true,
      getIntervalHours: () => 1, // 1 jam = 3600000 ms
      getBackupChatId: () => 12345,
      getTimeZone: () => 'Asia/Jakarta',
      baseDir: __dirname,
      backupFiles: [], // kosong -> sendAutoBackup kirim warning msg tapi tidak throw
    });
    scheduler.restart();

    // Interval 1 jam belum terpicu
    assert.equal(bot._sent.length, 0);

    // Majukan 1 jam + 1 ms -> harus ada 1 tick
    mock.timers.tick(60 * 60 * 1000 + 1);
    // sendAutoBackup async, beri microtask flush
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(bot._sent.length >= 1, 'Minimal 1 pesan terkirim setelah 1 jam tick');
  } finally {
    mock.timers.reset();
  }
});

test('auto-backup: restart() kedua clear timer pertama', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const bot = stubBot();
    let intervalHours = 1;
    const scheduler = createAutoBackupScheduler({
      logger: silentLogger(),
      bot,
      isEnabled: () => true,
      getIntervalHours: () => intervalHours,
      getBackupChatId: () => 999,
      getTimeZone: () => 'Asia/Jakarta',
      baseDir: __dirname,
      backupFiles: [],
    });
    scheduler.restart();

    // Ubah interval jadi 2 jam, restart
    intervalHours = 2;
    scheduler.restart();

    // Tick 1 jam -> belum terpicu (interval sekarang 2 jam)
    mock.timers.tick(60 * 60 * 1000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(bot._sent.length, 0, 'Timer lama harus sudah di-clear');

    // Tick 1 jam lagi (total 2 jam) -> terpicu 1x
    mock.timers.tick(60 * 60 * 1000 + 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(bot._sent.length >= 1, 'Setelah 2 jam, scheduler baru harus kirim');
  } finally {
    mock.timers.reset();
  }
});

// ===== daily-report =====

test('daily-report: scheduler kirim laporan saat jam + menit target tercapai', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const calls = [];
    let currentHour = 22;
    let currentMinute = 59;
    let currentDateKey = '2026-01-15';
    let lastSent = null;

    const scheduler = createDailyReportScheduler({
      logger: silentLogger(),
      db: {
        get(sql, params, cb) { cb(null, { count: 0 }); },
        all(sql, params, cb) { cb(null, []); },
      },
      bot: {
        telegram: {
          async sendMessage(chatId, text) { calls.push({ chatId, text }); },
        },
      },
      getTimeInConfiguredTimeZone: () => ({ dateKey: currentDateKey, hour: currentHour, minute: currentMinute }),
      getTimeZone: () => 'Asia/Jakarta',
      getMasterId: () => 777,
      getResselFilePath: () => null,
      getUsernameById: async () => '',
      isEnabled: () => true,
      getHour: () => 23,
      getMinute: () => 0,
      getLastSentDateKey: () => lastSent,
      setLastSentDateKey: (v) => { lastSent = v; },
      checkIntervalMs: 60 * 1000,
    });
    scheduler.start();

    // Tick 1 menit: belum jam target (22:59)
    mock.timers.tick(60 * 1000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 0);

    // Pindahkan ke 23:00 — tick 1 menit lagi
    currentHour = 23;
    currentMinute = 0;
    mock.timers.tick(60 * 1000);
    // Flush promise chain sendDailyReport (ada beberapa await di dalam)
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1, 'Laporan harus dikirim tepat 1x saat jam target');
    assert.equal(lastSent, '2026-01-15');

    // Tick lagi 1 menit tanpa ganti dateKey → tidak boleh kirim ulang
    mock.timers.tick(60 * 1000);
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1, 'Tidak boleh kirim double di hari yang sama');
  } finally {
    mock.timers.reset();
    delete global.__dailyReportSchedulerStarted;
  }
});

// ===== expiry-reminder =====

test('expiry-reminder: terpicu saat menit >= target & dateKey baru', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const calls = [];
    let currentHour = 20;
    let currentMinute = 5;
    let currentDateKey = '2026-02-01';
    let lastSent = null;

    const scheduler = createExpiryReminderScheduler({
      logger: silentLogger(),
      db: { all(sql, params, cb) { cb(null, []); } },
      bot: { telegram: { async sendMessage(chatId, text) { calls.push({ chatId, text }); } } },
      getTimeInConfiguredTimeZone: () => ({ dateKey: currentDateKey, hour: currentHour, minute: currentMinute }),
      getTimeZone: () => 'Asia/Jakarta',
      getMasterId: () => 888,
      getDaysBefore: () => 3,
      isEnabled: () => true,
      getHour: () => 20,
      getMinute: () => 0,
      getLastSentDateKey: () => lastSent,
      setLastSentDateKey: (v) => { lastSent = v; },
    });
    scheduler.start();

    // Saat ini 20:05, target 20:00 -> nowMinutes(1205) >= target(1200) -> should fire on first tick
    mock.timers.tick(60 * 1000);
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lastSent, '2026-02-01', 'lastSent harus di-set setelah fire pertama');

    // Tick lagi tanpa ganti dateKey -> tidak boleh fire ulang (calls stuck di count pertama)
    const beforeCount = calls.length;
    mock.timers.tick(60 * 1000);
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, beforeCount);
  } finally {
    mock.timers.reset();
    delete global.__expiryReminderSchedulerStarted;
  }
});

// ===== reseller-target =====

test('reseller-target: hanya fire di hari ke-1 tiap bulan', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let runCheckCalls = 0;
    let lastMonthKey = null;
    let currentDateKey = '2026-03-15';
    let currentHour = 1;
    let currentMinute = 5;

    const scheduler = createResellerTargetScheduler({
      logger: silentLogger(),
      db: { all(sql, params, cb) { cb(null, []); } },
      bot: { telegram: { async sendMessage() {} } },
      getTimeInConfiguredTimeZone: () => ({ dateKey: currentDateKey, hour: currentHour, minute: currentMinute }),
      getTimeZone: () => 'Asia/Jakarta',
      getMasterId: () => 555,
      getMin30dAccounts: () => 3,
      getMinDaysPerMonth: () => 90,
      readResellerSetSync: () => new Set([]),
      removeResellerIdFromCache: () => true,
      isEnabled: () => true,
      getCheckHour: () => 1,
      getCheckMinute: () => 5,
      getLastProcessedMonthKey: () => lastMonthKey,
      setLastProcessedMonthKey: (v) => { lastMonthKey = v; runCheckCalls++; },
    });
    scheduler.start();

    // Hari 15, tidak fire
    mock.timers.tick(60 * 1000);
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runCheckCalls, 0);

    // Pindah ke hari 1 bulan berikut
    currentDateKey = '2026-04-01';
    mock.timers.tick(60 * 1000);
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runCheckCalls, 1, 'Harus fire tepat 1x di hari ke-1');
    assert.equal(lastMonthKey, '2026-03'); // periode yg dicek = bulan sebelumnya

    // Tick lagi di tanggal sama -> tidak fire ulang (lastMonthKey sudah di-set)
    mock.timers.tick(60 * 1000);
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runCheckCalls, 1);
  } finally {
    mock.timers.reset();
    delete global.__resellerTargetSchedulerStarted;
  }
});
