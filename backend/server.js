import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import session from "express-session";

import routes from "./src/routes.js";

const app = express();

/* =========================
   TRUST PROXY (RENDER)
========================= */
app.set("trust proxy", 1);

/* =========================
   SECURITY
========================= */
app.use(helmet());

/* =========================
   CORS
========================= */
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN, // https://tommi38.onrender.com
    credentials: true,
  })
);

/* =========================
   BODY / COOKIE
========================= */
app.use(express.json());
app.use(cookieParser());

/* =========================
   SESSION (FIX REALE)
========================= */
app.use(
  session({
    name: process.env.SESSION_COOKIE_NAME || "tommi38sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "none", // 🔥 FIX CRITICO
      secure: true,     // 🔥 OBBLIGATORIO con sameSite none
    },
  })
);

/* =========================
   ROUTES
========================= */
app.use("/api", routes);

/* =========================
   HEALTH
========================= */
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* =========================
   START
========================= */
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log("Backend avviato sulla porta", PORT);
});
