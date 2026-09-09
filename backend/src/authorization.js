import { db as root } from './db.js';

export const validEstablishmentId = value => typeof value === 'string' && /^[a-z0-9-]{1,60}$/.test(value);
const identities = new WeakMap();

function invalidateSession(req) {
  if (!req.session) return;
  delete req.session.user;
  delete req.session.managementEstablishment;
}

// One fresh database read per request. Authority always belongs to the account
// that signed in, never to an identically named account in the selected venue.
export async function readSessionIdentity(req) {
  if (identities.has(req)) return identities.get(req);
  const sessionUser = req.session?.user;
  if (!sessionUser) return null;
  const origin = sessionUser.establishment || 'tommi38';
  if (!validEstablishmentId(origin) || typeof sessionUser.username !== 'string' ||
      !sessionUser.username || sessionUser.username.includes('/') || sessionUser.username.length > 80) {
    invalidateSession(req);
    identities.set(req, null);
    return null;
  }
  const users = origin === 'tommi38' ? root.collection('users')
    : root.collection('establishments').doc(origin).collection('users');
  const snap = await users.doc(sessionUser.username).get();
  const account = snap.data();
  if (!snap.exists || account.disabled ||
      Number(account.sessionVersion || 0) !== Number(sessionUser.sessionVersion || 0)) {
    invalidateSession(req);
    identities.set(req, null);
    return null;
  }
  const identity = {
    account,
    username: sessionUser.username,
    origin,
    platformAdmin: origin === 'tommi38' && account.platformAdmin === true
  };
  identities.set(req, identity);
  return identity;
}

export async function readEstablishment(id) {
  if (!validEstablishmentId(id)) return null;
  const snap = await root.collection('establishments').doc(id).get();
  if (!snap.exists && id !== 'tommi38') return null;
  const value = snap.data() || {};
  return {
    id,
    name: String(value.name || (id === 'tommi38' ? 'Tommi38' : id)).slice(0, 80),
    enabled: id === 'tommi38' || value.enabled === true
  };
}

export async function requirePlatformAdmin(req, res, next) {
  try {
    const identity = await readSessionIdentity(req);
    if (!identity) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    if (!identity.platformAdmin) return res.status(403).json({ error: 'NOT_AUTHORIZED' });
    req.account = identity.account;
    req.session.user.role = 'admin';
    req.session.user.platformAdmin = true;
    next();
  } catch (error) { next(error); }
}
