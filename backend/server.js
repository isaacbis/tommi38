// =======================
// ENV
// =======================
import "dotenv/config";

// =======================
// CORE
// =======================
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// =======================
// SECURITY
// =======================
import helmet from "helmet";
import cookieParser from "cookie-parser";
import session from "express-session";
import csrf from "csurf";

// =======================
// REDIS SESSION STORE
// =======================
import { RedisStore } from "connect-redis";
import { createClient } from "redis";

// =======================
// ROUTES
// =======================
import routes from "./src/routes.js";

// =======================
// PATH FIX (ESM)
// =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =======================
// APP
// =======================
const app = express();

// Render / reverse proxy (OBBLIGATORIO)
app.set("trust proxy", 1);

// =======================
// HELMET + CSP
// =======================
app.use(
  helmet({
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
        "upgrade-insecure-requests": [],
      },
    },
  })
);

// =======================
// BODY + COOKIE
// =======================
app.use(express.json());
app.use(cookieParser());

// =======================
// REDIS CLIENT
// =======================
if (!process.env.REDIS_URL) {
  console.error("❌ REDIS_URL mancante nelle variabili ambiente");
  process.exit(1);
}

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", err => {
  console.error("❌ Redis error:", err);
});

await redisClient.connect();

// =======================
// SESSION (REDIS STORE)
// =======================
app.use(
  session({
    store: new RedisStore({
      client: redisClient,
      prefix: "tommi38:sess:",
    }),
    name: process.env.SESSION_COOKIE_NAME || "tommi38sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8, // 8 ore
    },
  })
);

// =======================
// CSRF (USA SESSION)
// =======================
const csrfProtection = csrf({ cookie: false });
app.use(csrfProtection);

// =======================
// API
// =======================
app.use("/api", routes);

// =======================
// FRONTEND STATIC
// =======================
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

// =======================
// HEALTHCHECK
// =======================
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    redis: redisClient.isReady,
  });
});

// =======================
// SPA FALLBACK
// =======================
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// =======================
// START SERVER
// =======================
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log("✅ Tommi38 server avviato sulla porta", PORT);
});
