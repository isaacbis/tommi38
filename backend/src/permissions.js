import { tenantId } from './tenancy.js';
import { readSessionIdentity, readEstablishment } from './authorization.js';

export async function requireAuth(req, res, next) {
  try {
    const identity = await readSessionIdentity(req);
    if (!identity) return res.status(401).json({error:'NOT_AUTHENTICATED'});
    const expected = identity.platformAdmin ? req.session.managementEstablishment || 'tommi38' : identity.origin;
    if (expected !== tenantId()) return res.status(identity.platformAdmin ? 409 : 401).json({
      error: identity.platformAdmin ? 'MANAGEMENT_CONTEXT_CHANGED' : 'NOT_AUTHENTICATED'
    });
    if (!identity.platformAdmin && req.session.managementEstablishment) {
      delete req.session.managementEstablishment;
      return res.status(403).json({error:'NOT_AUTHORIZED'});
    }
    const establishment = req.establishment || await readEstablishment(expected);
    if (!establishment || (!establishment.enabled && !identity.platformAdmin)) {
      return res.status(404).json({error:'ESTABLISHMENT_NOT_FOUND'});
    }
    req.account = identity.account;
    req.establishment = establishment;
    req.isPlatformManagement = identity.platformAdmin && !!req.session.managementEstablishment;
    req.actorId = req.isPlatformManagement ? `platform:${identity.username}` : identity.username;
    req.session.user.role = identity.platformAdmin || identity.account.role === 'admin' ? 'admin' : 'user';
    req.session.user.platformAdmin = identity.platformAdmin;
    next();
  } catch(error) { next(error); }
}
export function requireAdmin(req, res, next) {
  return requireAuth(req, res, (error) => {
    if (error) return next(error);
    if (req.session.user.role !== 'admin') return res.status(403).json({error:'NOT_AUTHORIZED'});
    next();
  });
}
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
}
