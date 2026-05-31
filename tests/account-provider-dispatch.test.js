const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountProviderDispatchers } = require('../lib/account-provider-dispatch');

function recorder(label, calls) {
  return async (...args) => {
    calls.push({ label, args });
    return `ok:${label}`;
  };
}

test('provisionAccount dispatches create ssh with password signature', async () => {
  const calls = [];
  const { provisionAccount } = createAccountProviderDispatchers({
    createHandlers: { ssh: recorder('create-ssh', calls) },
  });

  const result = await provisionAccount('create', {
    type: 'ssh', username: 'u', password: 'p', exp: 30, quota: 10, iplimit: 1, serverId: 7,
  });

  assert.equal(result, 'ok:create-ssh');
  assert.deepEqual(calls, [{ label: 'create-ssh', args: ['u', 'p', 30, 1, 7] }]);
});

test('provisionAccount dispatches create non-ssh with quota signature', async () => {
  const calls = [];
  const { provisionAccount } = createAccountProviderDispatchers({
    createHandlers: { vmess: recorder('create-vmess', calls) },
  });

  const result = await provisionAccount('create', {
    type: 'vmess', username: 'u', password: 'p', exp: 30, quota: 10, iplimit: 1, serverId: 7,
  });

  assert.equal(result, 'ok:create-vmess');
  assert.deepEqual(calls, [{ label: 'create-vmess', args: ['u', 30, 10, 1, 7] }]);
});

test('provisionAccount dispatches renew ssh with renew signature', async () => {
  const calls = [];
  const { provisionAccount } = createAccountProviderDispatchers({
    renewHandlers: { ssh: recorder('renew-ssh', calls) },
  });

  const result = await provisionAccount('renew', {
    type: 'ssh', username: 'u', password: 'p', exp: 30, quota: 10, iplimit: 1, serverId: 7,
  });

  assert.equal(result, 'ok:renew-ssh');
  assert.deepEqual(calls, [{ label: 'renew-ssh', args: ['u', 30, 1, 7] }]);
});

test('provisionAccount dispatches renew non-ssh with quota signature', async () => {
  const calls = [];
  const { provisionAccount } = createAccountProviderDispatchers({
    renewHandlers: { trojan: recorder('renew-trojan', calls) },
  });

  const result = await provisionAccount('renew', {
    type: 'trojan', username: 'u', password: 'p', exp: 30, quota: 10, iplimit: 1, serverId: 7,
  });

  assert.equal(result, 'ok:renew-trojan');
  assert.deepEqual(calls, [{ label: 'renew-trojan', args: ['u', 30, 10, 1, 7] }]);
});

test('provisionAccount returns undefined for unknown action/type', async () => {
  const { provisionAccount } = createAccountProviderDispatchers();
  assert.equal(await provisionAccount('create', { type: 'unknown' }), undefined);
  assert.equal(await provisionAccount('other', { type: 'ssh' }), undefined);
});
