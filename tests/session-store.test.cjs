const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const express = require('../backend/node_modules/express');
const storeModule = import(pathToFileURL(path.join(__dirname, '../backend/src/session-store.js')));
const SECRET = 'isolated-session-test-secret-not-a-production-value';

function database() {
  const records = new Map();
  let queue = Promise.resolve();
  let reads = 0;
  const ref = key => ({
    key,
    get: async () => { reads++; return { exists: records.has(key), data: () => structuredClone(records.get(key)) }; },
    set: async value => { records.set(key, structuredClone(value)); },
    delete: async () => { records.delete(key); }
  });
  return {
    records,
    get reads() { return reads; },
    collection: name => ({ doc: id => ref(`${name}/${id}`) }),
    runTransaction(fn) {
      const operation = queue.then(async () => {
        const writes = [];
        const result = await fn({
          get: document => document.get(),
          set: (document, value) => writes.push(() => document.set(value)),
          delete: document => writes.push(() => document.delete())
        });
        for (const write of writes) await write();
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
}
function call(store, method, ...args) {
  return new Promise((resolve, reject) => store[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}
const sessionValue = expires => ({ cookie: { expires: new Date(expires), originalMaxAge: 8 * 60 * 60 * 1000 }, user: { username: 'sample-manager', role: 'admin', establishment: 'example' } });

// Store tests use no Firebase project, real accounts, or external services.
test('sessions survive store recreation and never persist plaintext tokens or users', async () => {
  const { FirestoreSessionStore } = await storeModule;
  const db = database();
  const options = { db, secret: SECRET, now: () => 1000 };
  const before = new FirestoreSessionStore(options);
  await call(before, 'set', 'private-test-session-id', sessionValue(2000));
  const after = new FirestoreSessionStore(options);
  const restored = await call(after, 'get', 'private-test-session-id');
  assert.equal(restored.user.username, 'sample-manager');
  assert.equal(restored.user.establishment, 'example');
  const saved = JSON.stringify([...db.records]);
  assert.equal(saved.includes('private-test-session-id'), false);
  assert.equal(saved.includes('sample-manager'), false);
  assert.equal([...db.records.keys()][0].startsWith('_privateSessions/'), true);
});

test('expiry is enforced at its boundary and expired records are removed', async () => {
  const { FirestoreSessionStore } = await storeModule;
  const db = database();
  let now = 1000;
  const store = new FirestoreSessionStore({ db, secret: SECRET, now: () => now });
  await call(store, 'set', 'expiry', sessionValue(2000));
  now = 1999;
  assert.ok(await call(store, 'get', 'expiry'));
  now = 2000;
  assert.equal(await call(store, 'get', 'expiry'), null);
  assert.equal(db.records.size, 0);
});

test('touch renews a live session while retaining fresh authorization data', async () => {
  const { FirestoreSessionStore } = await storeModule;
  const db = database();
  let now = 1000;
  const store = new FirestoreSessionStore({ db, secret: SECRET, now: () => now });
  const stale = sessionValue(2000);
  await call(store, 'set', 'rolling', { ...stale, user: { ...stale.user, role: 'user' } });
  now = 1500;
  await call(store, 'touch', 'rolling', { ...stale, cookie: { ...stale.cookie, expires: new Date(3000) } });
  now = 2200;
  const actual = await call(store, 'get', 'rolling');
  assert.equal(actual.user.role, 'user');
  assert.equal(new Date(actual.cookie.expires).getTime(), 3000);
  now = 3000;
  assert.equal(await call(store, 'get', 'rolling'), null);
});

test('touch never resurrects a logged-out or expired session', async () => {
  const { FirestoreSessionStore } = await storeModule;
  const db = database();
  let now = 1000;
  const store = new FirestoreSessionStore({ db, secret: SECRET, now: () => now });
  await call(store, 'set', 'logout', sessionValue(2000));
  await call(store, 'destroy', 'logout');
  await call(store, 'touch', 'logout', sessionValue(4000));
  assert.equal(await call(store, 'get', 'logout'), null);
  await call(store, 'set', 'expired', sessionValue(2000));
  now = 2000;
  await call(store, 'touch', 'expired', sessionValue(4000));
  assert.equal(await call(store, 'get', 'expired'), null);
});

test('tampered payloads, copied sessions and changed secrets fail closed', async () => {
  const { FirestoreSessionStore } = await storeModule;
  const db = database();
  const store = new FirestoreSessionStore({ db, secret: SECRET, now: () => 1000 });
  await call(store, 'set', 'source', sessionValue(2000));
  const record = structuredClone(db.records.get(store.reference('source').key));
  db.records.set(store.reference('copied').key, record);
  assert.equal(await call(store, 'get', 'copied'), null);
  db.records.get(store.reference('source').key).payload = 'tampered';
  assert.equal(await call(store, 'get', 'source'), null);
  await call(store, 'set', 'changed-key', sessionValue(2000));
  const changed = new FirestoreSessionStore({ db, secret: `${SECRET}-changed`, now: () => 1000 });
  assert.equal(await call(changed, 'get', 'changed-key'), null);
});

test('editing the database expiry cannot extend authenticated session expiry', async () => {
  const { FirestoreSessionStore } = await storeModule;
  const db = database();
  let now = 1000;
  const store = new FirestoreSessionStore({ db, secret: SECRET, now: () => now });
  await call(store, 'set', 'tampered-expiry', sessionValue(2000));
  db.records.get(store.reference('tampered-expiry').key).expiresAt = new Date(99999);
  now = 2000;
  assert.equal(await call(store, 'get', 'tampered-expiry'), null);
});

test('database failures propagate to Express instead of pretending logout or save succeeded', async () => {
  const { FirestoreSessionStore } = await storeModule;
  const failure = new Error('database unavailable');
  const store = new FirestoreSessionStore({ secret: SECRET, db: {
    collection: () => ({ doc: () => ({ set: async () => { throw failure; }, delete: async () => { throw failure; } }) }),
    runTransaction: async () => { throw failure; }
  } });
  for (const [method, args] of [['get', []], ['set', [sessionValue(2000)]], ['touch', [sessionValue(2000)]], ['destroy', []]]) {
    await assert.rejects(call(store, method, 'failure', ...args), { message: 'database unavailable' });
  }
});

async function serve(app, callback) {
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  try { return await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function routeOptions() {
  const apiRoutes = express.Router();
  apiRoutes.post('/session-test', (req, res) => { req.session.user = { username: 'local-test' }; res.json({ ok: true }); });
  apiRoutes.get('/session-test', (req, res) => res.json({ username: req.session.user?.username || null }));
  apiRoutes.post('/session-logout', (req, res, next) => req.session.destroy(error => error ? next(error) : res.json({ ok: true })));
  return { apiRoutes, platformRoutes: express.Router(), accountRoutes: express.Router(), tenantResolver: (req, res, next) => next() };
}

test('HTTP sessions retain signed cookies across app recreation and logout clears them', async () => {
  const { createApp } = await import(pathToFileURL(path.join(__dirname, '../backend/server.js')));
  const { FirestoreSessionStore } = await storeModule;
  const db = database();
  const options = () => ({ ...routeOptions(), secret: SECRET, sessionStore: new FirestoreSessionStore({ db, secret: SECRET }) });
  const cookie = await serve(createApp(options()), async base => {
    const response = await fetch(`${base}/api/session-test`, { method: 'POST', headers: { Origin: base } });
    assert.equal(response.status, 200);
    const value = response.headers.get('set-cookie');
    assert.match(value, /HttpOnly/);
    assert.match(value, /SameSite=Lax/);
    await response.json();
    return value.split(';')[0];
  });
  await serve(createApp(options()), async base => {
    let response = await fetch(`${base}/api/session-test`, { headers: { Cookie: cookie } });
    assert.deepEqual(await response.json(), { username: 'local-test' });
    response = await fetch(`${base}/api/session-logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    await response.json();
    response = await fetch(`${base}/api/session-test`, { headers: { Cookie: cookie } });
    assert.deepEqual(await response.json(), { username: null });
  });
});

test('only intended frontend assets are public; internal paths never return the app', async () => {
  const { createApp } = await import(pathToFileURL(path.join(__dirname, '../backend/server.js')));
  const { FirestoreSessionStore } = await storeModule;
  const db = database();
  const app = createApp({ ...routeOptions(), secret: SECRET, sessionStore: new FirestoreSessionStore({ db, secret: SECRET }) });
  await serve(app, async base => {
    for (const pathname of ['/', '/index.html', '/script.js', '/manifest.json']) {
      const response = await fetch(base + pathname);
      assert.equal(response.status, 200, pathname);
      await response.arrayBuffer();
    }
    for (const pathname of ['/info', '/info/', '/info/private.txt', '/info/qr%20code.png', '/.env', '/backend/server.js', '/unknown-page', '/%69nfo/private.txt']) {
      const response = await fetch(base + pathname);
      assert.equal(response.status, 404, pathname);
      assert.equal(await response.text(), 'Not found');
    }
    const health = await fetch(`${base}/api/health`);
    assert.equal((await health.json()).ok, true);
    assert.equal(db.reads, 0);
    const unknownApi = await fetch(`${base}/api/unknown-route`);
    assert.equal(unknownApi.status, 404);
    assert.deepEqual(await unknownApi.json(), { error: 'NOT_FOUND' });
  });
});

test('cross-origin mutations are refused, same-origin and native requests are accepted', async () => {
  const { createApp } = await import(pathToFileURL(path.join(__dirname, '../backend/server.js')));
  const { FirestoreSessionStore } = await storeModule;
  const db = database();
  const app = createApp({ ...routeOptions(), secret: SECRET, sessionStore: new FirestoreSessionStore({ db, secret: SECRET }) });
  await serve(app, async base => {
    for (const headers of [{ Origin: 'https://unrelated.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const response = await fetch(`${base}/api/session-test`, { method: 'POST', headers });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'CROSS_ORIGIN_REQUEST' });
    }
    assert.equal(db.records.size, 0);
    for (const headers of [{ Origin: base }, {}]) {
      const response = await fetch(`${base}/api/session-test`, { method: 'POST', headers });
      assert.equal(response.status, 200);
      await response.json();
    }
  });
});
