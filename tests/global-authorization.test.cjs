const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AsyncLocalStorage } = require('node:async_hooks');
const { pathToFileURL } = require('node:url');
const express = require('../backend/node_modules/express');
const session = require('../backend/node_modules/express-session');
const bcrypt = require('../backend/node_modules/bcrypt');
const { z } = require('../backend/node_modules/zod');

function load(filename, bindings, exports) {
  const source = fs.readFileSync(path.join(__dirname, '../backend/src', filename), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export default router;/g, '').replace(/export /g, '');
  return vm.runInNewContext(`${source}\n;({${exports.join(',')}})`, { Buffer, console, ...bindings });
}

async function setup(t) {
  const data = new Map([
    ['users/admin', { role: 'admin', platformAdmin: true, credits: 17, identity: 'global-original' }],
    ['users/ordinary', { role: 'user', credits: 3 }],
    ['establishments/venue-a', { name: 'Venue A', enabled: true }],
    ['establishments/venue-b', { name: 'Venue B', enabled: true }],
    ['establishments/suspended', { name: 'Suspended', enabled: false }],
    ['establishments/venue-a/users/admin', { role: 'admin', platformAdmin: true, credits: 99, identity: 'local-duplicate' }],
    ['establishments/venue-a/users/player-a', { role: 'user', credits: 5 }],
    ['establishments/venue-b/users/manager-b', { role: 'admin', credits: 0 }],
    ['establishments/venue-b/users/player-b', { role: 'user', credits: 8 }],
    ['establishments/suspended/users/manager', { role: 'admin', credits: 0 }]
  ]);
  const reads = [];
  const snapshot = documentPath => ({
    id: documentPath.split('/').pop(), exists: data.has(documentPath),
    data: () => structuredClone(data.get(documentPath))
  });
  function doc(documentPath) {
    return {
      path: documentPath, collection: name => collection(`${documentPath}/${name}`),
      get: async () => { reads.push(documentPath); return snapshot(documentPath); },
      set: async value => data.set(documentPath, structuredClone(value))
    };
  }
  function collection(collectionPath, filters = []) {
    return {
      doc: id => doc(`${collectionPath}/${id}`),
      where: (...filter) => collection(collectionPath, [...filters, filter]),
      get: async () => ({ docs: [...data].filter(([key, value]) =>
        key.startsWith(`${collectionPath}/`) && key.split('/').length === collectionPath.split('/').length + 1 &&
        filters.every(([key, operator, expected]) => operator === '==' && value[key] === expected)
      ).map(([key]) => snapshot(key)) })
    };
  }
  const root = { collection };
  const authorization = load('authorization.js', { root }, ['readSessionIdentity', 'readEstablishment', 'validEstablishmentId', 'requirePlatformAdmin']);
  const tenancy = load('tenancy.js', { root, AsyncLocalStorage, ...authorization }, ['db', 'tenantId', 'tenantMiddleware']);
  const permissions = load('permissions.js', { ...authorization, ...tenancy }, ['requireAuth', 'requireAdmin']);
  const platformRoutes = load('platform-routes.js', {
    root, ...authorization, express, bcrypt, z, FieldValue: { serverTimestamp: () => new Date() }
  }, ['router']).router;
  const apiRoutes = express.Router();
  // Only this isolated test router can construct fixture sessions.
  apiRoutes.post('/fixture-session', (req, res) => {
    req.session.user = req.body.user;
    if (req.body.managementEstablishment) req.session.managementEstablishment = req.body.managementEstablishment;
    res.json({ ok: true });
  });
  apiRoutes.get('/public/probe', (req, res) => res.json({ establishment: req.establishment, managementMode: req.isPlatformManagement }));
  apiRoutes.get('/admin/probe', permissions.requireAdmin, async (req, res) => {
    const users = await tenancy.db.collection('users').get();
    res.json({
      username: req.session.user.username, origin: req.session.user.establishment || 'tommi38',
      role: req.session.user.role, platformAdmin: req.session.user.platformAdmin,
      establishment: req.establishment, managementMode: req.isPlatformManagement,
      identity: req.account.identity, actorId: req.actorId,
      usernames: users.docs.map(doc => doc.id)
    });
  });
  apiRoutes.post('/admin/probe', permissions.requireAdmin, async (req, res) => {
    await tenancy.db.collection('admin').doc('probe').set({ value: req.body.value, actorId: req.actorId });
    res.json({ ok: true });
  });
  const { createApp } = await import(pathToFileURL(path.join(__dirname, '../backend/server.js')));
  const app = createApp({
    secret: 'test-global-authorization-local-only-secret', sessionStore: new session.MemoryStore(),
    apiRoutes, platformRoutes, accountRoutes: express.Router(), tenantResolver: tenancy.tenantMiddleware
  });
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(method, route, options = {}) {
    const response = await fetch(`${base}/api${route}`, {
      method, headers: {
        Origin: base, 'Content-Type': 'application/json',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.tenant ? { 'X-Establishment': options.tenant } : {})
      }, body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    return {
      status: response.status, body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] || options.cookie
    };
  }
  async function login(user = { username: 'admin', role: 'admin', establishment: 'tommi38' }, managementEstablishment) {
    return (await request('POST', '/fixture-session', { body: { user, managementEstablishment } })).cookie;
  }
  return { data, reads, request, login };
}

test('global context A → B → home preserves identity and scopes reads, writes and audit actor', async t => {
  const e = await setup(t);
  const cookie = await e.login();
  let response = await e.request('GET', '/platform/context', { cookie });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { establishment: { id: 'tommi38', name: 'Tommi38', enabled: true }, managementMode: false });
  for (const tenant of ['venue-a', 'venue-b']) {
    response = await e.request('POST', '/platform/context', { cookie, tenant: 'unrelated', body: { establishmentId: tenant } });
    assert.equal(response.status, 200);
    assert.equal(response.body.managementMode, true);
    const before = e.reads.length;
    response = await e.request('GET', '/admin/probe', { cookie, tenant });
    assert.equal(response.status, 200);
    assert.equal(response.body.username, 'admin');
    assert.equal(response.body.origin, 'tommi38');
    assert.equal(response.body.identity, 'global-original');
    assert.equal(response.body.establishment.id, tenant);
    assert.equal(response.body.actorId, 'platform:admin');
    assert.equal(response.body.usernames.includes(tenant === 'venue-a' ? 'player-b' : 'player-a'), false);
    assert.equal(e.reads.slice(before).filter(key => key === 'users/admin').length, 1);
    assert.equal(e.reads.slice(before).includes(`establishments/${tenant}/users/admin`), false);
    assert.equal((await e.request('POST', '/admin/probe', { cookie, tenant, body: { value: tenant } })).status, 200);
    assert.deepEqual(e.data.get(`establishments/${tenant}/admin/probe`), { value: tenant, actorId: 'platform:admin' });
  }
  assert.equal(e.data.has('admin/probe'), false);
  response = await e.request('DELETE', '/platform/context', { cookie, tenant: 'venue-a' });
  assert.equal(response.body.managementMode, false);
  response = await e.request('GET', '/admin/probe', { cookie });
  assert.equal(response.status, 200);
  assert.equal(response.body.actorId, 'admin');
  assert.equal(response.body.establishment.id, 'tommi38');
});

test('headers cannot select a global management venue and stale tab writes are rejected', async t => {
  const e = await setup(t); const cookie = await e.login();
  assert.equal((await e.request('GET', '/admin/probe', { cookie, tenant: 'venue-a' })).status, 409);
  await e.request('POST', '/platform/context', { cookie, body: { establishmentId: 'venue-a' } });
  await e.request('POST', '/platform/context', { cookie, body: { establishmentId: 'venue-b' } });
  const stale = await e.request('POST', '/admin/probe', { cookie, tenant: 'venue-a', body: { value: 'incorrect venue' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'MANAGEMENT_CONTEXT_CHANGED');
  assert.equal(e.data.has('establishments/venue-a/admin/probe'), false);
  assert.equal(e.data.has('establishments/venue-b/admin/probe'), false);
});

test('same-name manager with forged platform flag remains limited to the original venue', async t => {
  const e = await setup(t);
  const cookie = await e.login({ username: 'admin', establishment: 'venue-a', role: 'admin', platformAdmin: true });
  const own = await e.request('GET', '/admin/probe', { cookie, tenant: 'venue-a' });
  assert.equal(own.status, 200);
  assert.equal(own.body.platformAdmin, false);
  assert.equal(own.body.managementMode, false);
  assert.equal(own.body.identity, 'local-duplicate');
  for (const tenant of ['tommi38', 'venue-b']) {
    assert.equal((await e.request('GET', '/admin/probe', { cookie, tenant })).status, 401);
  }
  for (const [method, route, body] of [
    ['GET', '/platform/establishments'], ['GET', '/platform/context'],
    ['POST', '/platform/context', { establishmentId: 'venue-b' }], ['DELETE', '/platform/context']
  ]) assert.equal((await e.request(method, route, { cookie, tenant: 'venue-a', body })).status, 403);
});

test('a forged management context never expands a manager account', async t => {
  const e = await setup(t);
  const cookie = await e.login({ username: 'admin', establishment: 'venue-a', role: 'admin', platformAdmin: true }, 'venue-b');
  const result = await e.request('POST', '/admin/probe', { cookie, tenant: 'venue-b', body: { value: 'invalid' } });
  assert.equal(result.status, 403);
  assert.equal(e.data.has('establishments/venue-b/admin/probe'), false);
  assert.equal((await e.request('GET', '/admin/probe', { cookie, tenant: 'venue-a' })).status, 200);
});

test('a suspended venue is manageable only through an authorized global context', async t => {
  const e = await setup(t); const cookie = await e.login();
  assert.equal((await e.request('GET', '/public/probe', { tenant: 'suspended' })).status, 404);
  const managerCookie = await e.login({ username: 'manager', establishment: 'suspended', role: 'admin' });
  assert.equal((await e.request('GET', '/admin/probe', { cookie: managerCookie, tenant: 'suspended' })).status, 404);
  const selected = await e.request('POST', '/platform/context', { cookie, body: { establishmentId: 'suspended' } });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.establishment.enabled, false);
  assert.equal((await e.request('GET', '/public/probe', { cookie, tenant: 'suspended' })).status, 200);
  assert.equal((await e.request('GET', '/admin/probe', { cookie, tenant: 'suspended' })).status, 200);
  assert.equal((await e.request('GET', '/platform/establishments', { cookie, tenant: 'suspended' })).status, 200);
});

test('central role revocation immediately denies management and platform actions', async t => {
  const e = await setup(t); const cookie = await e.login();
  await e.request('POST', '/platform/context', { cookie, body: { establishmentId: 'venue-a' } });
  e.data.get('users/admin').platformAdmin = false;
  assert.equal((await e.request('GET', '/admin/probe', { cookie, tenant: 'venue-a' })).status, 403);
  assert.equal((await e.request('GET', '/platform/establishments', { cookie })).status, 403);
  assert.equal((await e.request('GET', '/admin/probe', { cookie, tenant: 'venue-a' })).status, 401);
});

test('disabling, deleting or resetting the original global account revokes active target access', async t => {
  for (const revoke of [
    data => { data.get('users/admin').disabled = true; },
    data => { data.delete('users/admin'); },
    data => { data.get('users/admin').sessionVersion = 1; }
  ]) {
    const e = await setup(t); const cookie = await e.login();
    await e.request('POST', '/platform/context', { cookie, body: { establishmentId: 'venue-a' } });
    revoke(e.data);
    assert.equal((await e.request('GET', '/admin/probe', { cookie, tenant: 'venue-a' })).status, 401);
    assert.equal((await e.request('GET', '/platform/context', { cookie })).status, 401);
    assert.equal(e.data.get('establishments/venue-a/users/admin').disabled, undefined);
  }
});

test('invalid or missing context targets never change the current venue; deleted targets can be exited', async t => {
  const e = await setup(t); const cookie = await e.login();
  await e.request('POST', '/platform/context', { cookie, body: { establishmentId: 'venue-a' } });
  for (const [body, expected] of [
    [{ establishmentId: '../users' }, 400], [{ establishmentId: 'missing' }, 404],
    [{ establishmentId: 'venue-b', username: 'manager-b' }, 400]
  ]) assert.equal((await e.request('POST', '/platform/context', { cookie, body })).status, expected);
  assert.equal((await e.request('GET', '/platform/context', { cookie })).body.establishment.id, 'venue-a');
  e.data.delete('establishments/venue-a');
  assert.equal((await e.request('GET', '/admin/probe', { cookie, tenant: 'venue-a' })).status, 404);
  assert.equal((await e.request('DELETE', '/platform/context', { cookie })).status, 200);
  assert.equal((await e.request('GET', '/admin/probe', { cookie })).status, 200);
});

test('ordinary users and anonymous requests cannot acquire a management context', async t => {
  const e = await setup(t);
  const cookie = await e.login({ username: 'ordinary', establishment: 'tommi38', role: 'admin', platformAdmin: true });
  assert.equal((await e.request('POST', '/platform/context', { cookie, body: { establishmentId: 'venue-a' } })).status, 403);
  assert.equal((await e.request('GET', '/admin/probe', { cookie })).status, 403);
  assert.equal((await e.request('POST', '/platform/context', { body: { establishmentId: 'venue-a' } })).status, 401);
});
