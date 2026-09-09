'use strict';

// Deliberately in-memory: this helper never imports the production database.
class MemoryTimestamp {
  constructor(milliseconds = Date.now()) { this.milliseconds = milliseconds; }
  toDate() { return new Date(this.milliseconds); }
  toMillis() { return this.milliseconds; }
}

function clone(value) {
  if (value instanceof MemoryTimestamp) return new MemoryTimestamp(value.milliseconds);
  if (Object.prototype.toString.call(value) === '[object Date]') return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

const FieldValue = Object.freeze({
  increment: amount => ({ __previewTransform: 'increment', amount }),
  serverTimestamp: () => ({ __previewTransform: 'timestamp' }),
  delete: () => ({ __previewTransform: 'delete' })
});

function createMemoryFirestore(seed = new Map()) {
  const data = new Map([...seed].map(([key, value]) => [key, clone(value)]));
  let nextId = 0;
  let queue = Promise.resolve();
  let failNext = false;

  const enqueue = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const validatePath = (path, document) => {
    const parts = typeof path === 'string' ? path.split('/') : [];
    if (!parts.length || parts.some(part => !part) || parts.length % 2 !== (document ? 0 : 1)) {
      throw new Error(`Invalid preview Firestore ${document ? 'document' : 'collection'} path`);
    }
    return path;
  };
  const field = (value, name) => name.split('.').reduce((item, key) => item?.[key], value);
  const resolve = (value, previous, timestamp) => {
    if (value?.__previewTransform === 'increment') {
      if (typeof value.amount !== 'number' || !Number.isFinite(value.amount)) throw new Error('Invalid increment');
      return (typeof previous === 'number' ? previous : 0) + value.amount;
    }
    if (value?.__previewTransform === 'timestamp') return new MemoryTimestamp(timestamp);
    if (value instanceof MemoryTimestamp || Object.prototype.toString.call(value) === '[object Date]') return clone(value);
    if (Array.isArray(value)) return value.map(item => resolve(item, undefined, timestamp));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([, item]) => item?.__previewTransform !== 'delete')
        .map(([key, item]) => [key, resolve(item, previous?.[key], timestamp)]));
    }
    if (value === undefined) throw new Error('Undefined document value');
    return value;
  };
  const patch = (previous, value, timestamp) => {
    const updated = clone(previous || {});
    for (const [name, item] of Object.entries(value)) {
      const keys = name.split('.');
      let parent = updated;
      for (const key of keys.slice(0, -1)) {
        if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {};
        parent = parent[key];
      }
      const key = keys.at(-1);
      if (item?.__previewTransform === 'delete') delete parent[key];
      else parent[key] = resolve(item, parent[key], timestamp);
    }
    return updated;
  };
  const commit = writes => {
    // Validate and apply against a copy so failed create/update cannot partially commit.
    const staged = new Map([...data].map(([key, value]) => [key, clone(value)]));
    const timestamp = Date.now();
    for (const { operation, path, value, options } of writes) {
      if (operation === 'delete') { staged.delete(path); continue; }
      if (operation === 'create' && staged.has(path)) throw new Error('ALREADY_EXISTS');
      if (operation === 'update' && !staged.has(path)) throw new Error('NOT_FOUND');
      staged.set(path, operation === 'update' || options?.merge
        ? patch(staged.get(path), value, timestamp) : resolve(value, staged.get(path), timestamp));
    }
    if (failNext) { failNext = false; throw new Error('Preview storage failure'); }
    data.clear();
    for (const [key, value] of staged) data.set(key, value);
  };
  const snapshot = (path, view = data) => {
    const exists = view.has(path);
    const value = clone(view.get(path));
    return { id: path.split('/').at(-1), exists, ref: document(path), data: () => clone(value), get: key => clone(field(value, key)) };
  };

  function document(path) {
    validatePath(path, true);
    const ref = {
      path, id: path.split('/').at(-1),
      get: async () => snapshot(path),
      _read: view => snapshot(path, view),
      collection: name => collection(`${path}/${name}`),
      listCollections: async () => [...new Set([...data.keys()]
        .filter(key => key.startsWith(`${path}/`))
        .map(key => key.slice(path.length + 1).split('/')[0]))].map(name => collection(`${path}/${name}`))
    };
    for (const operation of ['set', 'create', 'update', 'delete']) {
      ref[operation] = (value, options) => enqueue(() => commit([{ operation, path, value: clone(value), options }]));
    }
    return ref;
  }

  function collection(path, filters = [], maximum = Infinity, ordering = []) {
    validatePath(path, false);
    const read = view => {
      let matches = [...view].filter(([key, value]) => key.startsWith(`${path}/`) &&
        key.split('/').length === path.split('/').length + 1 &&
        filters.every(([name, operator, expected]) => {
          const actual = field(value, name);
          return actual !== undefined && (operator === '==' ? actual === expected : operator === '>=' ? actual >= expected : actual <= expected);
        }));
      if (ordering.length) matches.sort((left, right) => {
        for (const [name, direction] of ordering) {
          const a = field(left[1], name), b = field(right[1], name);
          if (a !== b) return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1);
        }
        return left[0].localeCompare(right[0]);
      });
      const docs = matches.slice(0, maximum).map(([key]) => snapshot(key, view));
      return { docs, size: docs.length, empty: docs.length === 0, forEach: callback => docs.forEach(callback) };
    };
    return {
      path, id: path.split('/').at(-1),
      doc: (id = `preview-${++nextId}`) => {
        if (typeof id !== 'string' || !id || id.includes('/')) throw new Error('Invalid document id');
        return document(`${path}/${id}`);
      },
      where: (name, operator, value) => {
        if (!['==', '>=', '<='].includes(operator)) throw new Error(`Unsupported preview query operator: ${operator}`);
        return collection(path, [...filters, [name, operator, value]], maximum, ordering);
      },
      limit: amount => {
        if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Invalid query limit');
        return collection(path, filters, amount, ordering);
      },
      orderBy: (name, direction = 'asc') => {
        if (!['asc', 'desc'].includes(direction)) throw new Error('Invalid query direction');
        return collection(path, filters, maximum, [...ordering, [name, direction]]);
      },
      get: async () => read(data), _read: read
    };
  }

  function writer(writes, markWrite = () => {}) {
    const result = {};
    for (const operation of ['set', 'create', 'update', 'delete']) {
      result[operation] = (ref, value, options) => {
        validatePath(ref.path, true);
        markWrite();
        writes.push({ operation, path: ref.path, value: clone(value), options });
        return result;
      };
    }
    return result;
  }

  const db = {
    collection,
    doc: document,
    runTransaction: callback => enqueue(async () => {
      const view = new Map([...data].map(([key, value]) => [key, clone(value)]));
      const writes = [];
      let dirty = false;
      const transaction = writer(writes, () => { dirty = true; });
      transaction.get = async ref => {
        if (dirty) throw new Error('Firestore transactions require all reads before writes');
        return ref._read(view);
      };
      const result = await callback(transaction);
      commit(writes);
      return result;
    }),
    batch: () => {
      const writes = [];
      const batch = writer(writes);
      batch.commit = () => enqueue(() => commit(writes));
      return batch;
    }
  };
  return { db, data, FieldValue, Timestamp: MemoryTimestamp, failNextCommit: () => { failNext = true; } };
}

module.exports = { createMemoryFirestore, FieldValue, MemoryTimestamp };
