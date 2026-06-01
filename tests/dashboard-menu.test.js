// tests/dashboard-menu.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  formatTimestamp,
  formatRupiahShort,
  buildDashboardText,
  buildDashboardKeyboard,
  buildQrisPendingText,
  buildErrorLogsText,
  buildBackToDashboardKeyboard,
} = require('../lib/dashboard-menu');

test('formatTimestamp: formats epoch ms to readable string', () => {
  const ts = new Date('2026-06-01T10:30:00Z').getTime();
  const result = formatTimestamp(ts, 'Asia/Jakarta');
  assert.ok(result.includes('01') || result.includes('1'), 'Should include day');
  assert.ok(result.includes('06') || result.includes('6'), 'Should include month');
});

test('formatTimestamp: returns dash for null/undefined', () => {
  assert.strictEqual(formatTimestamp(null), '-');
  assert.strictEqual(formatTimestamp(undefined), '-');
  assert.strictEqual(formatTimestamp(0), '-');
});

test('formatRupiahShort: formats amounts with shorthand', () => {
  assert.strictEqual(formatRupiahShort(0), 'Rp0');
  assert.strictEqual(formatRupiahShort(500), 'Rp500');
  assert.strictEqual(formatRupiahShort(15000), 'Rp15rb');
  assert.strictEqual(formatRupiahShort(1500000), 'Rp1.5jt');
  assert.strictEqual(formatRupiahShort(10000000), 'Rp10.0jt');
});

test('buildDashboardText: includes all sections', () => {
  const data = {
    qrisPending: { count: 5, items: [] },
    errorCount: 10,
    activeUsers: 50,
    revenue: { today: 150000, week: 1000000, month: 5000000 },
    totalUsers: 100,
    accounts: { active: 30, expired: 20 },
  };

  const text = buildDashboardText(data);
  assert.ok(text.includes('Admin Dashboard'), 'Should have title');
  assert.ok(text.includes('QRIS Pending'), 'Should have QRIS section');
  assert.ok(text.includes('5 invoice'), 'Should show QRIS count');
  assert.ok(text.includes('Error 24 Jam'), 'Should have error section');
  assert.ok(text.includes('10 error'), 'Should show error count');
  assert.ok(text.includes('50 aktif'), 'Should show active users');
  assert.ok(text.includes('100 total'), 'Should show total users');
  assert.ok(text.includes('30 aktif'), 'Should show active accounts');
  assert.ok(text.includes('Revenue'), 'Should have revenue section');
});

test('buildDashboardKeyboard: has all buttons', () => {
  const keyboard = buildDashboardKeyboard();
  assert.ok(keyboard.inline_keyboard, 'Should have inline_keyboard');
  assert.strictEqual(keyboard.inline_keyboard.length, 2, 'Should have 2 rows');
  
  const firstRow = keyboard.inline_keyboard[0];
  assert.strictEqual(firstRow.length, 2, 'First row should have 2 buttons');
  assert.strictEqual(firstRow[0].callback_data, 'dashboard_qris');
  assert.strictEqual(firstRow[1].callback_data, 'dashboard_errors');

  const secondRow = keyboard.inline_keyboard[1];
  assert.strictEqual(secondRow[0].callback_data, 'dashboard_refresh');
  assert.strictEqual(secondRow[1].callback_data, 'admin_menu');
});

test('buildQrisPendingText: empty state', () => {
  const data = { count: 0, items: [] };
  const text = buildQrisPendingText(data);
  assert.ok(text.includes('QRIS Pending'), 'Should have title');
  assert.ok(text.includes('Total:') && text.includes('0'), 'Should show zero count');
  assert.ok(text.includes('Tidak ada invoice pending'), 'Should show empty message');
});

test('buildQrisPendingText: with items', () => {
  const data = {
    count: 2,
    items: [
      { invoice_id: 'INV-001', user_id: 100, amount: 50000, created_at: Date.now() },
      { invoice_id: 'INV-002', user_id: 200, amount: 100000, created_at: Date.now() },
    ],
  };
  const text = buildQrisPendingText(data);
  assert.ok(text.includes('Total:') && text.includes('2'), 'Should show count');
  assert.ok(text.includes('INV-001'), 'Should show first invoice');
  assert.ok(text.includes('INV-002'), 'Should show second invoice');
  assert.ok(text.includes('User: 100'), 'Should show user ID');
  assert.ok(text.includes('Rp50rb'), 'Should format amount');
});

test('buildErrorLogsText: empty state', () => {
  const data = { count: 0, items: [] };
  const text = buildErrorLogsText(data);
  assert.ok(text.includes('Error Logs'), 'Should have title');
  assert.ok(text.includes('Total:') && text.includes('0'), 'Should show zero count');
  assert.ok(text.includes('Tidak ada error'), 'Should show empty message');
});

test('buildErrorLogsText: with items', () => {
  const data = {
    count: 3,
    items: [
      { source: 'payment/deposit', error_message: 'Insufficient balance', timestamp: Date.now() },
      { source: 'bot.action.addserver', error_message: 'Validation failed', timestamp: Date.now() },
    ],
  };
  const text = buildErrorLogsText(data);
  assert.ok(text.includes('Total:') && text.includes('3'), 'Should show count');
  assert.ok(text.includes('payment/deposit'), 'Should show first source');
  assert.ok(text.includes('Insufficient balance'), 'Should show first error message');
  assert.ok(text.includes('bot.action.addserver'), 'Should show second source');
});

test('buildBackToDashboardKeyboard: has back buttons', () => {
  const keyboard = buildBackToDashboardKeyboard();
  assert.ok(keyboard.inline_keyboard, 'Should have inline_keyboard');
  assert.strictEqual(keyboard.inline_keyboard.length, 1, 'Should have 1 row');
  
  const row = keyboard.inline_keyboard[0];
  assert.strictEqual(row.length, 2, 'Row should have 2 buttons');
  assert.strictEqual(row[0].callback_data, 'dashboard_refresh');
  assert.strictEqual(row[1].callback_data, 'admin_menu');
});
