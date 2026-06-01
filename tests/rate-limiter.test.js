// tests/rate-limiter.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { createRateLimiter } = require('../lib/rate-limiter');

test('rate-limiter: allows requests within limit', () => {
  const limiter = createRateLimiter({ windowMs: 10000, maxRequests: 3 });

  const result1 = limiter.check(100);
  assert.strictEqual(result1.allowed, true, 'First request should be allowed');
  assert.strictEqual(result1.remaining, 2, 'Should have 2 remaining');

  const result2 = limiter.check(100);
  assert.strictEqual(result2.allowed, true, 'Second request should be allowed');
  assert.strictEqual(result2.remaining, 1, 'Should have 1 remaining');

  const result3 = limiter.check(100);
  assert.strictEqual(result3.allowed, true, 'Third request should be allowed');
  assert.strictEqual(result3.remaining, 0, 'Should have 0 remaining');
});

test('rate-limiter: blocks requests when limit exceeded', () => {
  const limiter = createRateLimiter({ windowMs: 10000, maxRequests: 2 });

  limiter.check(200); // 1st
  limiter.check(200); // 2nd

  const result = limiter.check(200); // 3rd - should be blocked
  assert.strictEqual(result.allowed, false, 'Should block 3rd request');
  assert.strictEqual(result.remaining, 0, 'Should have 0 remaining');
  assert.ok(result.resetMs > 0, 'Should have resetMs > 0');
});

test('rate-limiter: resets after window expires', async () => {
  const limiter = createRateLimiter({ windowMs: 100, maxRequests: 2 });

  limiter.check(300); // 1st
  limiter.check(300); // 2nd

  const blocked = limiter.check(300); // 3rd - blocked
  assert.strictEqual(blocked.allowed, false);

  // Wait for window to expire
  await new Promise(resolve => setTimeout(resolve, 150));

  const afterReset = limiter.check(300);
  assert.strictEqual(afterReset.allowed, true, 'Should allow after window reset');
});

test('rate-limiter: independent limits per user', () => {
  const limiter = createRateLimiter({ windowMs: 10000, maxRequests: 2 });

  limiter.check(400); // User 400 - 1st
  limiter.check(400); // User 400 - 2nd

  const user400blocked = limiter.check(400); // User 400 - 3rd blocked
  assert.strictEqual(user400blocked.allowed, false);

  const user500allowed = limiter.check(500); // User 500 - 1st allowed
  assert.strictEqual(user500allowed.allowed, true);
});

test('rate-limiter: cleanup removes expired entries', async () => {
  const limiter = createRateLimiter({ windowMs: 100, maxRequests: 5 });

  limiter.check(600);
  limiter.check(600);
  limiter.check(700);

  let stats = limiter.stats();
  assert.strictEqual(stats.totalKeys, 2, 'Should have 2 users');
  assert.strictEqual(stats.totalRequests, 3, 'Should have 3 requests');

  // Wait for window to expire
  await new Promise(resolve => setTimeout(resolve, 150));

  const cleaned = limiter.cleanup();
  assert.ok(cleaned >= 0, 'Should cleanup expired entries');

  stats = limiter.stats();
  assert.strictEqual(stats.totalKeys, 0, 'Should have 0 users after cleanup');
  assert.strictEqual(stats.totalRequests, 0, 'Should have 0 requests after cleanup');
});

test('rate-limiter: stats returns correct counts', () => {
  const limiter = createRateLimiter({ windowMs: 10000, maxRequests: 5 });

  limiter.check(800);
  limiter.check(800);
  limiter.check(900);

  const stats = limiter.stats();
  assert.strictEqual(stats.totalKeys, 2, 'Should track 2 users');
  assert.strictEqual(stats.totalRequests, 3, 'Should track 3 requests');
});

test('rate-limiter: clear removes all entries', () => {
  const limiter = createRateLimiter({ windowMs: 10000, maxRequests: 5 });

  limiter.check(1000);
  limiter.check(1000);
  limiter.check(1100);

  let stats = limiter.stats();
  assert.ok(stats.totalKeys > 0, 'Should have entries before clear');

  limiter.clear();

  stats = limiter.stats();
  assert.strictEqual(stats.totalKeys, 0, 'Should have 0 entries after clear');
  assert.strictEqual(stats.totalRequests, 0, 'Should have 0 requests after clear');
});

test('rate-limiter: keyPrefix separates different limiters', () => {
  const limiterA = createRateLimiter({ windowMs: 10000, maxRequests: 1, keyPrefix: 'a' });
  const limiterB = createRateLimiter({ windowMs: 10000, maxRequests: 1, keyPrefix: 'b' });

  limiterA.check(1200); // User 1200 in limiter A - 1st

  const resultA = limiterA.check(1200); // User 1200 in limiter A - 2nd (blocked)
  assert.strictEqual(resultA.allowed, false, 'Should block in limiter A');

  const resultB = limiterB.check(1200); // User 1200 in limiter B - 1st (allowed)
  assert.strictEqual(resultB.allowed, true, 'Should allow in limiter B (different prefix)');
});
