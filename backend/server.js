import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import session from "express-session";

import routes from "./src/routes.js";

const app = express();

/* SECURITY */
app.use(helmet());

/* CORS */
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
  })
);

/* BODY */
app.use(express.json());
app.use(cookieParser());

/* SESSION */
app.use(
  session({
    name: process.env.SESSION_COOKIE_NAME,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
cookie: {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
},
  })
);

/* ROUTES */
app.use("/api", routes);

/* HEALTH */
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* START */
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log("Backend avviato sulla porta", PORT);
});
