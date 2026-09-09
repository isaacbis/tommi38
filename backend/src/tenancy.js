import { AsyncLocalStorage } from 'node:async_hooks';
import { db as root } from './db.js';

export const tenantContext = new AsyncLocalStorage();
export const tenantId = () => tenantContext.getStore() || 'tommi38';
// Preserve all legacy paths. Every collection in the router is scoped here.
export const db = {
  collection(name) {
    return tenantId() === 'tommi38' ? root.collection(name)
      : root.collection('establishments').doc(tenantId()).collection(name);
  },
  batch: () => root.batch(),
  runTransaction: fn => root.runTransaction(fn)
};
export async function establishments() {
  const snap = await root.collection('establishments').get();
  const legacy = snap.docs.find(d=>d.id === 'tommi38');
  const items = [{ id: 'tommi38', name: String(legacy?.data().name || 'Tommi38').slice(0,80) }];
  for (const doc of snap.docs) {
    const value = doc.data();
    if (doc.id !== 'tommi38' && value.enabled === true && /^[a-z0-9-]{1,60}$/.test(doc.id)) {
      items.push({ id: doc.id, name: String(value.name || doc.id).slice(0,80) });
    }
  }
  return items;
}
export async function tenantMiddleware(req, res, next) {
  try {
    if (req.path === "/establishments" || req.path === "/logout") return next();
    const id = req.get('X-Establishment') || 'tommi38';
    if (!/^[a-z0-9-]{1,60}$/.test(id)) return res.status(400).json({error:'INVALID_ESTABLISHMENT'});
    if (id !== 'tommi38' && !(await establishments()).some(item => item.id === id)) {
      return res.status(404).json({error:'ESTABLISHMENT_NOT_FOUND'});
    }
    // A legacy session belongs only to Tommi38. Headers cannot grant membership.
    if (req.session?.user && (req.session.user.establishment || 'tommi38') !== id) {
      return res.status(401).json({error:'ESTABLISHMENT_LOGIN_REQUIRED'});
    }
    tenantContext.run(id, next);
  } catch (error) { next(error); }
}
