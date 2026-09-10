import { AsyncLocalStorage } from 'node:async_hooks';
import { db as root } from './db.js';
import { readSessionIdentity, readEstablishment, validEstablishmentId } from './authorization.js';

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
    req.isPlatformManagement = false;
    if (req.path === "/establishments" || req.path === "/logout") return next();
    const id = req.get('X-Establishment') || 'tommi38';
    if (!validEstablishmentId(id)) return res.status(400).json({error:'INVALID_ESTABLISHMENT'});
    // Deletion authenticates the current password itself so an interrupted
    // deletion can resume after its first batch has revoked the login session.
    if(req.method==='DELETE' && req.baseUrl==='/api/auth' && req.path==='/account'){
      const establishment=await readEstablishment(id);
      if(!establishment)return res.status(404).json({error:'ESTABLISHMENT_NOT_FOUND'});
      req.establishment=establishment;
      return tenantContext.run(id,next);
    }
    let identity = null;
    if (req.session?.user) {
      identity = await readSessionIdentity(req);
      if (!identity) return res.status(401).json({error:'NOT_AUTHENTICATED'});
      if (identity.platformAdmin) {
        const selected = req.session.managementEstablishment || 'tommi38';
        if (!validEstablishmentId(selected) || id !== selected) {
          return res.status(409).json({error:'MANAGEMENT_CONTEXT_CHANGED'});
        }
      } else {
        // A revoked central role cannot retain a previous management context.
        if (req.session.managementEstablishment) {
          delete req.session.managementEstablishment;
          return res.status(403).json({error:'NOT_AUTHORIZED'});
        }
        if (identity.origin !== id) return res.status(401).json({error:'ESTABLISHMENT_LOGIN_REQUIRED'});
      }
    }
    const establishment = await readEstablishment(id);
    if (!establishment || (!establishment.enabled && !identity?.platformAdmin)) {
      return res.status(404).json({error:'ESTABLISHMENT_NOT_FOUND'});
    }
    req.establishment = establishment;
    req.isPlatformManagement = !!identity?.platformAdmin && !!req.session.managementEstablishment;
    if (identity) req.actorId = req.isPlatformManagement ? `platform:${identity.username}` : identity.username;
    tenantContext.run(id, next);
  } catch (error) { next(error); }
}
