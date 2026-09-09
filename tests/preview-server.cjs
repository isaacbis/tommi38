'use strict';

// Local browser fixture. All persistence and identities are synthetic and reset
// on restart. The production Firebase module and environment are never loaded.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { createMemoryFirestore, MemoryTimestamp } = require('./helpers/memory-firestore.cjs');
const backendPath = path.resolve(__dirname, '../backend');
const dependency = createRequire(path.join(backendPath, 'package.json'));
const express = dependency('express');
const session = dependency('express-session');
const bcrypt = dependency('bcrypt');
const PREVIEW_SECRET = 'synthetic-local-preview-session-secret-only';
const PREVIEW_COOKIE = 'tommi38-preview';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FIXTURE_PASSWORD = 'Synthetic-preview-2026!';
const PERSONAS = Object.freeze({
  root: { username: 'rootadmin', establishment: 'tommi38', role: 'admin' },
  'manager-a': { username: 'manager', establishment: 'venue-a', role: 'admin' },
  'manager-b': { username: 'manager', establishment: 'venue-b', role: 'admin' },
  'user-a': { username: 'alice', establishment: 'venue-a', role: 'user' }
});

function fixtureDates() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const day = offset => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  return { today, tomorrow: day(1), days: Array.from({ length: 7 }, (_, index) => day(index)) };
}

function seedDocuments(dates) {
  const data = new Map();
  const passwordHash = bcrypt.hashSync(FIXTURE_PASSWORD, 4);
  const createdAt = new MemoryTimestamp(Date.now() - 3600000);
  const venues = [
    { id: 'tommi38', name: 'Tommi38 · Demo', user: 'alice', credits: 8 },
    { id: 'venue-a', name: 'Lido Aurora · Demo', user: 'alice', credits: 12 },
    { id: 'venue-b', name: 'Lido Brezza · Demo', user: 'bob', credits: 4 }
  ];
  for (const venue of venues) {
    const prefix = venue.id === 'tommi38' ? '' : `establishments/${venue.id}/`;
    const put = (key, value) => data.set(prefix + key, value);
    const account = (role, credits = 0) => ({ role, credits, passwordHash, disabled: false, sessionVersion: 0, platformAdmin: false, createdAt });
    data.set(`establishments/${venue.id}`, { name: venue.name, enabled: true, createdAt });
    put('admin/config', {
      slotMinutes: 45, dayStart: '09:00', dayEnd: '20:15',
      maxBookingsPerUserPerDay: 2, maxActiveBookingsPerUser: 3, registrationEnabled: true
    });
    put('admin/fields', { fields: [{ id: 'volley', name: `Beach volley · ${venue.id}` }, { id: 'tennis', name: `Tennis · ${venue.id}` }] });
    put('admin/notes', { text: `Dati sintetici di ${venue.name}. Le modifiche restano in memoria.` });
    put('admin/gallery', { images: [] });
    put('admin/closures', { items: [] });
    put('admin/creditPackages', { items: [{ id: 'five', title: '5 partite', credits: 5 }, { id: 'ten', title: '10 partite', credits: 10 }] });
    put('users/manager', account('admin'));
    put(`users/${venue.user}`, account('user', venue.credits));
    // The colliding local username catches accidental impersonation in management mode.
    put('users/rootadmin', venue.id === 'tommi38'
      ? { ...account('admin', 20), platformAdmin: true } : account('user', venue.id === 'venue-a' ? 31 : 47));
    put('users/pending-demo', { ...account('user'), disabled: true, pendingApproval: true });
    const reservationId = `volley_${dates.tomorrow}_10:30`;
    const reservation = { fieldId: 'volley', date: dates.tomorrow, time: '10:30', slotMinutes: 45, user: venue.user, createdAt };
    put(`reservations/${reservationId}`, reservation);
    put('reservationHistory/demo-history', {
      ...reservation, date: dates.today, time: '09:00', status: 'completed', reservationId: 'demo-completed', archivedAt: createdAt
    });
    put(`creditLedger/demo-${venue.user}`, { user: venue.user, delta: venue.credits, reason: `Saldo iniziale demo ${venue.id}`, createdAt });
    put(`creditRequests/${venue.user}`, { user: venue.user, packageTitle: '5 partite', credits: 5, status: 'pending', createdAt });
    put(`recoveryRequests/${venue.user}`, { username: venue.user, status: 'pending', createdAt });
    put(`playerSearches/${reservationId}`, {
      reservationId, ownerUser: venue.user, fieldId: 'volley', date: dates.tomorrow, time: '10:30',
      spotsNeeded: 2, spotsFilled: 0, status: 'open', note: `Partita demo ${venue.id}`, createdAt, updatedAt: createdAt
    });
  }
  return data;
}

function loadApplication(memory, dates) {
  const cached = new Map();
  const localModules = new Set([
    'server.js', 'src/authorization.js', 'src/tenancy.js', 'src/permissions.js',
    'src/management-guards.js', 'src/routes.js', 'src/account-routes.js', 'src/platform-routes.js'
  ]);
  const packages = new Set(['express', 'express-session', 'bcrypt', 'zod', 'express-rate-limit', 'helmet', 'cookie-parser']);
  const builtins = new Set(['node:path', 'node:url', 'node:async_hooks']);
  const environment = Object.freeze({
    NODE_ENV: 'test', SESSION_COOKIE_NAME: PREVIEW_COOKIE, SESSION_SECRET: PREVIEW_SECRET, RENDER_GIT_COMMIT: 'local-synthetic-preview'
  });
  const context = vm.createContext({
    console, Buffer, Date, Intl, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
    structuredClone, process: Object.freeze({ env: environment, argv: [] }),
    // The weather proxy executes its real route against a deterministic response.
    // No host fetch, Firebase, Redis, dotenv, or other network client is exposed.
    fetch: async url => {
      if (typeof url !== 'string' || !url.startsWith('https://api.open-meteo.com/v1/forecast?')) {
        throw new Error('Outbound network disabled in preview');
      }
      return { ok: true, json: async () => ({ daily: {
        time: dates.days, weathercode: dates.days.map(() => 0),
        temperature_2m_max: dates.days.map(() => 26), temperature_2m_min: dates.days.map(() => 18)
      } }) };
    }
  });

  function imported(specifier, parent) {
    if (packages.has(specifier)) return dependency(specifier);
    if (builtins.has(specifier)) return require(specifier);
    if (!specifier.startsWith('.')) throw new Error(`Preview dependency is not allowed: ${specifier}`);
    const relative = path.relative(backendPath, path.resolve(backendPath, path.dirname(parent), specifier)).replaceAll(path.sep, '/');
    if (relative === 'src/db.js') return { db: memory.db, FieldValue: memory.FieldValue };
    if (relative === 'src/session-store.js') return {
      SESSION_MAX_AGE_MS,
      FirestoreSessionStore: class { constructor() { throw new Error('Preview requires an explicit MemoryStore'); } }
    };
    if (relative === 'src/platform-migration.js') return {
      appointInitialPlatformAdmin: () => { throw new Error('Production migration is disabled in preview'); }
    };
    return load(relative);
  }

  function load(relative) {
    if (cached.has(relative)) return cached.get(relative);
    if (!localModules.has(relative)) throw new Error(`Preview module is not allowed: ${relative}`);
    let source = fs.readFileSync(path.join(backendPath, relative), 'utf8');
    if (relative === 'server.js') {
      // The CLI entry point owns production migration/listening. Only createApp is used.
      const entryPoint = source.indexOf('\nif (process.argv[1]');
      if (entryPoint < 0) throw new Error('Production entry point changed; review preview loader');
      source = source.slice(0, entryPoint);
    }
    const dependencies = [];
    source = source.replace(/^import\s+(['"])dotenv\/config\1;?\s*$/gm, '');
    source = source.replace(/^import\s+(.+?)\s+from\s+(['"])(.+?)\2;?\s*$/gm, (statement, binding, quote, specifier) => {
      const index = dependencies.push(imported(specifier, relative)) - 1;
      if (binding.startsWith('{')) return `const ${binding.replace(/\bas\b/g, ':')} = __dependencies[${index}];`;
      if (/^[A-Za-z_$][\w$]*$/.test(binding)) return `const ${binding} = __dependencies[${index}].default ?? __dependencies[${index}];`;
      throw new Error(`Unsupported preview import in ${relative}`);
    });
    source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(backendPath, relative)).href));
    const exported = [];
    source = source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*))/g, (statement, name) => {
      exported.push(name); return '';
    });
    source = source.replace(/\bexport\s+default\s+([A-Za-z_$][\w$]*);?/g, (statement, name) => {
      exported.push(`default: ${name}`); return '';
    });
    const factory = new vm.Script(`(function (__dependencies) {\n'use strict';\n${source}\nreturn { ${exported.join(', ')} };\n})`, {
      filename: path.join(backendPath, relative)
    }).runInContext(context);
    const exports = factory(dependencies);
    cached.set(relative, exports);
    return exports;
  }

  return { ...load('server.js'), context, modules: cached };
}

function createPreviewServer() {
  const dates = fixtureDates();
  const memory = createMemoryFirestore(seedDocuments(dates));
  const application = loadApplication(memory, dates);
  const sessionStore = new session.MemoryStore();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const address = req.socket.remoteAddress;
    const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    if (!loopback || !['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return res.status(403).end();
    next();
  });
  app.use('/__preview', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (req.get('Sec-Fetch-Site') === 'cross-site' ||
        (req.get('Origin') && req.get('Origin') !== `${req.protocol}://${req.get('Host')}`)) return res.status(403).end();
    next();
  }, session({
    store: sessionStore, name: PREVIEW_COOKIE, secret: PREVIEW_SECRET,
    resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: SESSION_MAX_AGE_MS }
  }));
  app.get('/__preview/session', (req, res, next) => {
    const persona = typeof req.query.persona === 'string' && Object.hasOwn(PERSONAS, req.query.persona) ? PERSONAS[req.query.persona] : null;
    if (!persona) return res.status(400).json({ error: 'UNKNOWN_PREVIEW_PERSONA', personas: Object.keys(PERSONAS) });
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.user = { ...persona, sessionVersion: 0 };
      req.session.previewEstablishment = persona.establishment;
      req.session.save(error => {
        if (error) return next(error);
        res.type('html').send('<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anteprima locale</title><p>Apertura della sessione dimostrativa…</p><script src="/__preview/bootstrap.js"></script></html>');
      });
    });
  });
  app.get('/__preview/bootstrap.js', (req, res) => {
    const establishment = req.session.previewEstablishment;
    if (!req.session.user || !['tommi38', 'venue-a', 'venue-b'].includes(establishment)) return res.status(401).end();
    res.type('js').send(`'use strict';\ntry { localStorage.setItem('tommi38-establishment', ${JSON.stringify(establishment)}); } finally { location.replace('/'); }\n`);
  });
  app.use(application.createApp({ sessionStore, secret: PREVIEW_SECRET }));
  return { app, memory, dates, personas: PERSONAS, sessionStore, application };
}

if (require.main === module) {
  const port = Number(process.argv[2] || 4173);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Provide a local port from 1 to 65535');
  const { app } = createPreviewServer();
  app.listen(port, '127.0.0.1', () => {
    console.log(`Synthetic Tommi38 preview: http://127.0.0.1:${port}`);
    for (const persona of Object.keys(PERSONAS)) console.log(`  ${persona}: http://127.0.0.1:${port}/__preview/session?persona=${persona}`);
    console.log('Memory only. Restart to reset. No production database or outbound network.');
  });
}

module.exports = { createPreviewServer, FIXTURE_PASSWORD };
