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

/* TRUST PROXY (Render) */
app.set("trust proxy", 1);

/* SECURITY (CSP attiva) */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
      },
    },
  })
);

/* BODY & COOKIE */
app.use(express.json());
app.use(cookieParser());

/* SESSION (FIRST-PARTY) */
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

/* API */
app.use("/api", routes);

/* FRONTEND STATIC */
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

/* SPA FALLBACK */
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

/* START */
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log("Server unico avviato sulla porta", PORT);
});
