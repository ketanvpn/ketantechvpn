'use strict';

function createAccountProviderDispatchers({ createHandlers = {}, renewHandlers = {} } = {}) {
  async function provisionAccount(action, payload = {}) {
    const {
      type,
      username,
      password,
      exp,
      quota,
      iplimit,
      serverId,
    } = payload;

    if (action === 'create') {
      const fn = createHandlers[type];
      if (!fn) return undefined;
      if (type === 'ssh') return fn(username, password, exp, iplimit, serverId);
      return fn(username, exp, quota, iplimit, serverId);
    }

    if (action === 'renew') {
      const fn = renewHandlers[type];
      if (!fn) return undefined;
      if (type === 'ssh') return fn(username, exp, iplimit, serverId);
      return fn(username, exp, quota, iplimit, serverId);
    }

    return undefined;
  }

  return { provisionAccount };
}

module.exports = { createAccountProviderDispatchers };
