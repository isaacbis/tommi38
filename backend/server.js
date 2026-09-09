import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import session from "express-session";

import routes from "./src/routes.js";
import platformRouter from "./src/platform-routes.js";
import accountRouter from "./src/account-routes.js";
import { db, FieldValue } from "./src/db.js";
import { appointInitialPlatformAdmin } from "./src/platform-migration.js";
import { tenantMiddleware } from "./src/tenancy.js";
import { FirestoreSessionStore, SESSION_MAX_AGE_MS } from "./src/session-store.js";

const __filename = fileURLToPath(import.meta.url);
const frontendPath = path.join(path.dirname(__filename), "../frontend");

// New public assets must be added deliberately. Never serve the frontend folder
// wholesale: it previously contained internal operational files.
export const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ...[
    "index.html", "success.html", "style.css", "script.js", "community.js",
    "account.js", "service-worker.js", "manifest.json",
    "icon-192.png", "icon-512.png", "icons/apple-touch-icon-v2.png"
  ].map(file => [`/${file}`, file])
]);

export function sameOriginMutation(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("Origin");
  const expected = `${req.protocol}://${req.get("Host")}`;
  if ((origin && origin !== expected) || req.get("Sec-Fetch-Site") === "cross-site") {
    return res.status(403).json({ error: "CROSS_ORIGIN_REQUEST" });
  }
  next();
}

export function createApp({
  sessionStore,
  secret = process.env.SESSION_SECRET,
  apiRoutes = routes,
  platformRoutes = platformRouter,
  accountRoutes = accountRouter,
  tenantResolver = tenantMiddleware
} = {}) {
  const app = express();
  // Render terminates TLS at its reverse proxy.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'self'"],
        "img-src": ["'self'", "data:", "https:"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "connect-src": ["'self'"],
        "upgrade-insecure-requests": []
      }
    }
  }));

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  // Health and public assets do not need a database round trip or session.
  app.get("/api/health", (req, res) => res.json({
    ok: true,
    version: process.env.RENDER_GIT_COMMIT || "local",
    time: new Date().toISOString()
  }));

  app.use("/api", sameOriginMutation, express.json(), cookieParser(), session({
    store: sessionStore || new FirestoreSessionStore({ db, secret }),
    name: process.env.SESSION_COOKIE_NAME || "tommi38sid",
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE_MS
    }
  }));
  app.use("/api/platform", tenantResolver, platformRoutes);
  app.use("/api/auth", tenantResolver, accountRoutes);
  app.use("/api", tenantResolver, apiRoutes);
  app.use("/api", (req, res) => res.status(404).json({ error: "NOT_FOUND" }));

  app.use((req, res, next) => {
    const file = PUBLIC_FILES.get(req.path);
    if (!["GET", "HEAD"].includes(req.method) || !file) return next();
    res.sendFile(file, {
      root: frontendPath,
      dotfiles: "deny",
      headers: { "Cache-Control": "no-cache" }
    }, error => { if (error) next(error); });
  });
  // Navigation is entirely in-page; arbitrary paths are never SPA fallbacks.
  app.use((req, res) => res.status(404).type("text").send("Not found"));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status === 404 ? 404 : error.type === "entity.parse.failed" ? 400 : 500;
    if (status === 500) console.error("Request failed");
    if (req.path.startsWith("/api/")) {
      return res.status(status).json({ error: status === 400 ? "INVALID_JSON" : status === 404 ? "NOT_FOUND" : "SERVER_ERROR" });
    }
    res.status(status).type("text").send(status === 404 ? "Not found" : "Request failed");
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const PORT = Number(process.env.PORT || 3001);
  try {
    const outcome = await appointInitialPlatformAdmin(db, () => FieldValue.serverTimestamp());
    console.log("Platform administrator migration:", outcome);
  } catch {
    console.error("Platform administrator migration deferred: database unavailable");
  }
  createApp().listen(PORT, () => console.log("Server Tommi38 avviato sulla porta", PORT));
}
