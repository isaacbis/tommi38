const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bcrypt = require('../backend/node_modules/bcrypt');
const { z } = require('../backend/node_modules/zod');

const source = fs.readFileSync(__dirname + '/../backend/src/platform-routes.js', 'utf8')
  .replace(/^import .*;$/gm, '').replace('export default router;', '');

function setup() {
  const data = new Map([
    ['users/owner', { role: 'admin', platformAdmin: true, passwordHash: 'private-root-hash', credits: 40 }],
    ['users/localadmin', { role: 'admin', credits: 4 }],
    ['users/alice', { role: 'user', credits: 8 }],
    ['establishments/beach-a', { name: 'Beach A', enabled: true }],
    ['establishments/beach-a/users/manager', { role: 'admin', passwordHash: 'private-manager-hash', credits: 0 }],
    ['establishments/beach-a/users/alice', { role: 'user', credits: 15 }],
    ['establishments/beach-b', { name: 'Beach B', enabled: false }],
    ['establishments/beach-b/users/manager', { role: 'admin', disabled: true, credits: 3 }]
  ]);
  const snapshot = path => ({
    id: path.split('/').pop(), ref: doc(path), exists: data.has(path),
    data: () => structuredClone(data.get(path))
  });
  function doc(path) {
    return {
      id: path.split('/').pop(), path,
      collection: name => collection(path + '/' + name),
      get: async () => snapshot(path),
      listCollections: async () => [...new Set([...data.keys()]
        .filter(key => key.startsWith(path + '/') && key.split('/').length > path.split('/').length + 1)
        .map(key => key.slice(path.length + 1).split('/')[0]))]
        .map(name => collection(path + '/' + name))
    };
  }
  function collection(path, filters = []) {
    return {
      doc: id => doc(path + '/' + id),
      where: (...filter) => collection(path, [...filters, filter]),
      get: async () => ({ docs: [...data].filter(([key, value]) =>
        key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1 &&
        filters.every(([field, operator, expected]) => operator === '==' && value[field] === expected)
      ).map(([key]) => snapshot(key)) })
    };
  }
  let queue = Promise.resolve();
  let failCommit = false;
  const root = {
    collection,
    runTransaction: work => {
      const task = queue.then(async () => {
        const writes = [];
        let hasWrites = false;
        const result = await work({
          get: async ref => {
            assert.equal(hasWrites, false, 'all Firestore reads must precede writes');
            return ref.get();
          },
          create: (ref, value) => { hasWrites = true; writes.push({ path: ref.path, value, create: true }); },
          set: (ref, value) => { hasWrites = true; writes.push({ path: ref.path, value }); }
        });
        if (failCommit) { failCommit = false; throw new Error('Simulated storage failure'); }
        for (const write of writes) {
          if (write.create && data.has(write.path)) throw new Error('Document already exists');
        }
        for (const write of writes) data.set(write.path, structuredClone(write.value));
        return result;
      });
      queue = task.catch(() => {});
      return task;
    }
  };
  const routes = {};
  const router = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path, ...handlers) => { routes[method + ' ' + path] = handlers; };
  }
  const context = vm.createContext({
    root, z, bcrypt, Buffer, console, tenantId: () => context.currentTenant || 'tommi38',
    FieldValue: { serverTimestamp: () => ({ timestamp: true }) },
    express: { Router: () => router }
  });
  vm.runInContext(fs.readFileSync(__dirname+'/../backend/src/authorization.js','utf8').replace(/^import .*;$/gm,'').replace(/export /g,''),context);
  vm.runInContext(source, context);
  async function call(method, path, options = {}) {
    context.currentTenant = options.tenant || 'tommi38';
    const sessionUser = Object.hasOwn(options, 'user') ? options.user : { username: 'owner', role: 'admin', establishment: 'tommi38' };
    const req = { session: sessionUser ? { user: sessionUser } : {}, body: options.body || {}, params: options.params || {} };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    for (const handler of routes[method + ' ' + path]) {
      let proceed = false;
      await handler(req, res, error => { if (error) throw error; proceed = true; });
      if (!proceed) break;
    }
    return res;
  }
  return { data, call, failNextCommit: () => { failCommit = true; } };
}

const newVenue = {
  id: 'new-beach', name: 'New Beach', managerUsername: 'new.manager', managerPassword: 'Long-secret-2026!'
};

test('only the explicitly appointed central administrator can create establishments', async () => {
  const e = setup();
  const before = structuredClone(e.data);
  for (const user of [null, { username: 'alice', role: 'user' }, { username: 'localadmin', role: 'admin', platformAdmin: true }]) {
    const result = await e.call('post', '/establishments', { user, body: newVenue });
    assert.equal(result.code, user ? 403 : 401);
  }
  assert.deepEqual(e.data, before);
});

test('a tenant manager cannot use a matching username or a forged platform flag to become central administrator', async () => {
  const e = setup();
  e.data.set('establishments/beach-a/users/owner', { role: 'admin', platformAdmin: true });
  for (const tenant of ['beach-a', 'tommi38']) {
    const result = await e.call('get', '/establishments', {
      tenant, user: { username: 'owner', role: 'admin', establishment: 'beach-a', platformAdmin: true }
    });
    assert.equal(result.code, 403);
  }
  assert.equal((await e.call('get', '/establishments', {
    tenant: 'beach-a', user: { username: 'owner', role: 'admin', establishment: 'tommi38' }
  })).code, 200);
});

test('central authority is checked again after disabling or revoking the user', async () => {
  const e = setup();
  assert.equal((await e.call('get', '/establishments')).code, 200);
  e.data.get('users/owner').platformAdmin = false;
  assert.equal((await e.call('get', '/establishments')).code, 403);
  e.data.get('users/owner').platformAdmin = true;
  e.data.get('users/owner').disabled = true;
  assert.equal((await e.call('get', '/establishments')).code, 401);
  e.data.delete('users/owner');
  assert.equal((await e.call('get', '/establishments')).code, 401);
});

test('a session invalidated by password reset cannot retain central access', async () => {
  const e = setup();
  e.data.get('users/owner').sessionVersion = 1;
  assert.equal((await e.call('get', '/establishments')).code, 401);
  assert.equal((await e.call('get', '/establishments', {
    user: { username: 'owner', role: 'admin', establishment: 'tommi38', sessionVersion: 1 }
  })).code, 200);
});

test('the central list includes disabled establishments and manager usernames but never credentials', async () => {
  const e = setup();
  const result = await e.call('get', '/establishments');
  assert.equal(result.code, 200);
  assert.equal(result.body.items.length, 3);
  assert.equal(result.body.items[0].id, 'tommi38');
  const a = result.body.items.find(item => item.id === 'beach-a');
  assert.equal(a.managers.length, 1);
  assert.equal(a.managers[0].username, 'manager');
  assert.equal(result.body.items.find(item => item.id === 'beach-b').enabled, false);
  const serialized = JSON.stringify(result.body);
  for (const secret of ['passwordHash', 'private-root-hash', 'private-manager-hash', 'credits', 'platformAdmin']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('creation atomically prepares one isolated venue and a manager with a bcrypt hash', async () => {
  const e = setup();
  const original = structuredClone(e.data);
  const result = await e.call('post', '/establishments', { body: newVenue });
  assert.equal(result.code, 201);
  assert.equal(result.body.establishment.managers[0].username, 'new.manager');
  const base = 'establishments/new-beach/';
  const manager = e.data.get(base + 'users/new.manager');
  assert.equal(manager.role, 'admin');
  assert.equal(manager.platformAdmin, false);
  assert.equal(manager.credits, 0);
  assert.equal(manager.disabled, false);
  assert.equal(await bcrypt.compare(newVenue.managerPassword, manager.passwordHash), true);
  assert.equal(bcrypt.getRounds(manager.passwordHash), 12);
  assert.equal(e.data.get(base + 'admin/config').dayStart, '09:00');
  assert.deepEqual(e.data.get(base + 'admin/fields').fields, []);
  assert.equal([...e.data.keys()].filter(key => key.startsWith(base)).length, 3);
  for (const [key, value] of original) assert.deepEqual(e.data.get(key), value, key + ' must remain unchanged');
  assert.equal(JSON.stringify(result.body).includes(newVenue.managerPassword), false);
  assert.equal(JSON.stringify(result.body).includes(manager.passwordHash), false);
  assert.equal(JSON.stringify([...e.data]).includes(newVenue.managerPassword), false);
});

test('duplicate and legacy ids cannot overwrite metadata or existing users', async () => {
  const e = setup();
  const before = structuredClone(e.data);
  for (const id of ['tommi38', 'beach-a', 'beach-b']) {
    assert.equal((await e.call('post', '/establishments', { body: { ...newVenue, id } })).code, 409);
  }
  assert.deepEqual(e.data, before);
});

test('creation refuses orphaned subcollections even when the parent metadata is missing', async () => {
  const e = setup();
  e.data.set('establishments/abandoned/reservations/booked-slot', { user: 'alice' });
  const before = structuredClone(e.data);
  assert.equal((await e.call('post', '/establishments', { body: { ...newVenue, id: 'abandoned' } })).code, 409);
  assert.deepEqual(e.data, before);
});

test('creation rejects unsafe ids, credentials, extra privilege fields and malformed bodies', async () => {
  const e = setup();
  const before = structuredClone(e.data);
  const changes = [
    { id: '../users' }, { id: '-beach' }, { id: 'Uppercase' }, { id: 'a'.repeat(61) },
    { name: '   ' }, { name: 'a'.repeat(81) }, { managerUsername: '../owner' },
    { managerUsername: 'ab' }, { managerPassword: 'too-short' },
    { managerPassword: 'é'.repeat(37) }, { managerPassword: 'a'.repeat(73) },
    { platformAdmin: true }, { role: 'admin' }, { enabled: false }
  ];
  for (const change of changes) {
    assert.equal((await e.call('post', '/establishments', { body: { ...newVenue, ...change } })).code, 400);
  }
  assert.deepEqual(e.data, before);
});

test('concurrent attempts to create the same id produce exactly one complete establishment', async () => {
  const e = setup();
  const results = await Promise.all([
    e.call('post', '/establishments', { body: newVenue }),
    e.call('post', '/establishments', { body: { ...newVenue, managerUsername: 'second-manager' } })
  ]);
  assert.deepEqual(results.map(result => result.code).sort(), [201, 409]);
  const managers = [...e.data.keys()].filter(key => key.startsWith('establishments/new-beach/users/'));
  assert.equal(managers.length, 1);
  assert.ok(e.data.has('establishments/new-beach/admin/config'));
  assert.ok(e.data.has('establishments/new-beach/admin/fields'));
});

test('a storage failure leaves no partial establishment or initial manager', async () => {
  const e = setup();
  const before = structuredClone(e.data);
  e.failNextCommit();
  await assert.rejects(e.call('post', '/establishments', { body: newVenue }), /Simulated storage failure/);
  assert.deepEqual(e.data, before);
});

test('central metadata edits preserve all tenant users, balances and other establishments', async () => {
  const e = setup();
  const before = structuredClone(e.data);
  const result = await e.call('patch', '/establishments/:id', {
    params: { id: 'beach-a' }, body: { name: 'Renamed Beach', enabled: false }
  });
  assert.equal(result.code, 200);
  assert.equal(result.body.establishment.name, 'Renamed Beach');
  assert.equal(result.body.establishment.enabled, false);
  for (const [key, value] of before) {
    if (key !== 'establishments/beach-a') assert.deepEqual(e.data.get(key), value);
  }
  assert.equal(e.data.get('establishments/beach-a').updatedBy, 'owner');
  assert.equal(JSON.stringify(result.body).includes('passwordHash'), false);
});

test('legacy establishment may be renamed but cannot be disabled', async () => {
  const e = setup();
  assert.equal((await e.call('patch', '/establishments/:id', {
    params: { id: 'tommi38' }, body: { enabled: false }
  })).body.error, 'LEGACY_ESTABLISHMENT_REQUIRED');
  const result = await e.call('patch', '/establishments/:id', {
    params: { id: 'tommi38' }, body: { name: 'Tommi 38 Beach' }
  });
  assert.equal(result.code, 200);
  assert.equal(result.body.establishment.name, 'Tommi 38 Beach');
  assert.equal(result.body.establishment.enabled, true);
});

test('metadata edits reject missing establishments, malformed fields and tenant manager access', async () => {
  const e = setup();
  const before = structuredClone(e.data);
  assert.equal((await e.call('patch', '/establishments/:id', {
    params: { id: 'missing-beach' }, body: { enabled: true }
  })).code, 404);
  assert.equal((await e.call('patch', '/establishments/:id', {
    params: { id: '../users' }, body: { enabled: true }
  })).code, 400);
  for (const body of [{}, { enabled: 'false' }, { platformAdmin: true }, { name: '' }, { managerPassword: 'arbitrary-secret' }]) {
    assert.equal((await e.call('patch', '/establishments/:id', { params: { id: 'beach-a' }, body })).code, 400);
  }
  assert.equal((await e.call('patch', '/establishments/:id', {
    user: { username: 'localadmin', role: 'admin' }, params: { id: 'beach-a' }, body: { enabled: false }
  })).code, 403);
  assert.deepEqual(e.data, before);
});
