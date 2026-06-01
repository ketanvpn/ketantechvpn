// tests/rate-limit-middleware.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { createRateLimitMiddleware } = require('../lib/rate-limit-middleware');

// Mock Telegraf context
function createMockContext(type, userId) {
  const ctx = {
    from: { id: userId },
    answerCbQuery: async (text) => ({ text }),
    reply: async (text) => ({ text }),
  };

  if (type === 'callback') {
    ctx.callbackQuery = { data: 'test_action' };
  } else if (type === 'command') {
    ctx.message = { text: '/test' };
  }

  return ctx;
}

test('rate-limit-middleware: allows requests within limit (callback)', async () => {
  const middleware = createRateLimitMiddleware({ type: 'callback', windowMs: 10000, maxRequests: 2 });
  const ctx = createMockContext('callback', 100);

  let nextCalled = 0;
  const next = async () => { nextCalled++; };

  // 1st request - allowed
  await middleware(ctx, next);
  assert.strictEqual(nextCalled, 1, 'Should call next on 1st request');

  // 2nd request - allowed
  await middleware(ctx, next);
  assert.strictEqual(nextCalled, 2, 'Should call next on 2nd request');
});

test('rate-limit-middleware: blocks requests when limit exceeded (callback)', async () => {
  const middleware = createRateLimitMiddleware({ type: 'callback', windowMs: 10000, maxRequests: 2 });
  const ctx = createMockContext('callback', 200);

  let nextCalled = 0;
  let answerCalled = false;
  ctx.answerCbQuery = async (text) => {
    answerCalled = true;
    return { text };
  };
  const next = async () => { nextCalled++; };

  // 1st & 2nd allowed
  await middleware(ctx, next);
  await middleware(ctx, next);

  // 3rd - blocked
  await middleware(ctx, next);
  assert.strictEqual(nextCalled, 2, 'Should not call next on 3rd request');
  assert.strictEqual(answerCalled, true, 'Should call answerCbQuery with cooldown message');
});

test('rate-limit-middleware: allows requests within limit (command)', async () => {
  const middleware = createRateLimitMiddleware({ type: 'command', windowMs: 10000, maxRequests: 2 });
  const ctx = createMockContext('command', 300);

  let nextCalled = 0;
  const next = async () => { nextCalled++; };

  // 1st request - allowed
  await middleware(ctx, next);
  assert.strictEqual(nextCalled, 1, 'Should call next on 1st request');

  // 2nd request - allowed
  await middleware(ctx, next);
  assert.strictEqual(nextCalled, 2, 'Should call next on 2nd request');
});

test('rate-limit-middleware: blocks requests when limit exceeded (command)', async () => {
  const middleware = createRateLimitMiddleware({ type: 'command', windowMs: 10000, maxRequests: 2 });
  const ctx = createMockContext('command', 400);

  let nextCalled = 0;
  let replyCalled = false;
  ctx.reply = async (text) => {
    replyCalled = true;
    return { text };
  };
  const next = async () => { nextCalled++; };

  // 1st & 2nd allowed
  await middleware(ctx, next);
  await middleware(ctx, next);

  // 3rd - blocked
  await middleware(ctx, next);
  assert.strictEqual(nextCalled, 2, 'Should not call next on 3rd request');
  assert.strictEqual(replyCalled, true, 'Should call reply with cooldown message');
});

test('rate-limit-middleware: independent limits per user', async () => {
  const middleware = createRateLimitMiddleware({ type: 'callback', windowMs: 10000, maxRequests: 1 });
  const ctx1 = createMockContext('callback', 500);
  const ctx2 = createMockContext('callback', 600);

  let next1Called = 0;
  let next2Called = 0;
  const next1 = async () => { next1Called++; };
  const next2 = async () => { next2Called++; };

  // User 500 - 1st allowed
  await middleware(ctx1, next1);
  assert.strictEqual(next1Called, 1);

  // User 500 - 2nd blocked
  await middleware(ctx1, next1);
  assert.strictEqual(next1Called, 1, 'User 500 should be blocked');

  // User 600 - 1st allowed (independent limit)
  await middleware(ctx2, next2);
  assert.strictEqual(next2Called, 1, 'User 600 should be allowed');
});

test('rate-limit-middleware: skips non-matching type', async () => {
  const middleware = createRateLimitMiddleware({ type: 'callback', windowMs: 10000, maxRequests: 1 });
  const ctx = createMockContext('command', 700); // Command context, tapi middleware untuk callback

  let nextCalled = 0;
  const next = async () => { nextCalled++; };

  await middleware(ctx, next);
  assert.strictEqual(nextCalled, 1, 'Should skip rate limit for non-matching type');
});

test('rate-limit-middleware: custom cooldown message', async () => {
  const customMessage = 'Custom cooldown!';
  const middleware = createRateLimitMiddleware({
    type: 'callback',
    windowMs: 10000,
    maxRequests: 1,
    message: customMessage,
  });
  const ctx = createMockContext('callback', 800);

  let answerText = null;
  ctx.answerCbQuery = async (text) => {
    answerText = text;
    return { text };
  };
  const next = async () => {};

  // 1st allowed
  await middleware(ctx, next);

  // 2nd blocked with custom message
  await middleware(ctx, next);
  assert.strictEqual(answerText, customMessage, 'Should use custom cooldown message');
});

test('rate-limit-middleware: skips when no userId', async () => {
  const middleware = createRateLimitMiddleware({ type: 'callback', windowMs: 10000, maxRequests: 1 });
  const ctx = createMockContext('callback', null);
  ctx.from = null; // No userId

  let nextCalled = 0;
  const next = async () => { nextCalled++; };

  await middleware(ctx, next);
  assert.strictEqual(nextCalled, 1, 'Should skip rate limit when no userId');
});
