import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import session from "express-session";

import routes from "./src/routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Render / reverse proxy
app.set("trust proxy", 1);

// CSP: niente inline script/style
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

app.use(express.json());
app.use(cookieParser());

app.use(
  session({
    name: process.env.SESSION_COOKIE_NAME || "tommi38sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  })
);

// API
app.use("/api", routes);

// Frontend static
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

// Health
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => console.log("Server unico avviato sulla porta", PORT));
