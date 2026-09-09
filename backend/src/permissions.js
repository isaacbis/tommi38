import { db, tenantId } from './tenancy.js';

export async function requireAuth(req, res, next) {
  try {
    const sessionUser = req.session?.user;
    if (!sessionUser || (sessionUser.establishment || 'tommi38') !== tenantId()) return res.status(401).json({error:'NOT_AUTHENTICATED'});
    const snap = await db.collection('users').doc(sessionUser.username).get();
    const user = snap.data();
    if (!snap.exists || user.disabled || Number(user.sessionVersion || 0) !== Number(sessionUser.sessionVersion || 0)) {
      delete req.session.user;
      return res.status(401).json({error:'NOT_AUTHENTICATED'});
    }
    req.account = user;
    req.session.user.role = user.role === 'admin' ? 'admin' : 'user';
    req.session.user.platformAdmin = tenantId() === 'tommi38' && user.platformAdmin === true;
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
