import express from "express";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { db, FieldValue } from "./db.js";

const router = express.Router();

/* =========================
   MIDDLEWARE
========================= */
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "NOT_AUTHORIZED" });
  }
  next();
}

/* =========================
   RATE LIMIT LOGIN
========================= */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

/* =========================
   AUTH
========================= */
router.post("/login", loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "MISSING_CREDENTIALS" });
  }

  const ref = db.collection("users").doc(username);
  const snap = await ref.get();

  if (!snap.exists) {
    return res.status(401).json({ error: "INVALID_LOGIN" });
  }

  const user = snap.data();

  if (user.disabled) {
    return res.status(403).json({ error: "USER_DISABLED" });
  }

  /* ACCOUNT LOCK */
  if (user.lockUntil && user.lockUntil.toDate) {
    const now = new Date();
    const lockDate = user.lockUntil.toDate();
    if (lockDate > now) {
      return res.status(423).json({
        error: "ACCOUNT_LOCKED",
        until: lockDate.toISOString(),
      });
    }
  }

  if (!user.passwordHash) {
    return res.status(500).json({ error: "PASSWORD_NOT_MIGRATED" });
  }

  const match = await bcrypt.compare(password, user.passwordHash);

  if (!match) {
    const attempts = (user.failedAttempts || 0) + 1;
    const updates = { failedAttempts: attempts };

    if (attempts >= 5) {
      updates.failedAttempts = 0;
      updates.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    }

    await ref.update(updates);
    return res.status(401).json({ error: "INVALID_LOGIN" });
  }

  /* LOGIN OK */
  await ref.update({
    failedAttempts: 0,
    lockUntil: null,
  });

  req.session.user = {
    username,
    role: user.role || "user",
  };

  res.json({
    username,
    role: user.role || "user",
    credits: user.credits ?? 0,
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const snap = await db.collection("users").doc(req.session.user.username).get();
  const data = snap.data();

  res.json({
    username: req.session.user.username,
    role: data.role || "user",
    credits: data.credits ?? 0,
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/* =========================
   PUBLIC CONFIG
========================= */
router.get("/public/config", async (req, res) => {
  const cfg = await db.collection("admin").doc("config").get();
  const fields = await db.collection("admin").doc("fields").get();
  const notes = await db.collection("admin").doc("notes").get();
  const images = await db.collection("admin").doc("images").get();

  res.json({
    maxBookingsPerUser: cfg.exists ? cfg.data().maxBookingsPerUser : 2,
    fields: fields.exists ? fields.data().fields : [],
    notesText: notes.exists ? notes.data().text : "",
    images: images.exists ? images.data() : {},
  });
});

/* =========================
   PRENOTAZIONI
========================= */
router.get("/reservations", requireAuth, async (req, res) => {
  const { date } = req.query;
  const snap = await db.collection("reservations").where("date", "==", date).get();

  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  res.json({ items });
});

router.post("/reservations", requireAuth, async (req, res) => {
  const { fieldId, date, time } = req.body;
  const username = req.session.user.username;
  const role = req.session.user.role;

  const id = `${fieldId}_${date}_${time}`;
  const ref = db.collection("reservations").doc(id);

  if ((await ref.get()).exists) {
    return res.status(409).json({ error: "SLOT_TAKEN" });
  }

  if (role !== "admin") {
    const userRef = db.collection("users").doc(username);
    const userSnap = await userRef.get();
    if ((userSnap.data().credits ?? 0) <= 0) {
      return res.status(403).json({ error: "NO_CREDITS" });
    }
    await userRef.update({ credits: FieldValue.increment(-1) });
  }

  await ref.set({
    fieldId,
    date,
    time,
    user: username,
    createdAt: FieldValue.serverTimestamp(),
  });

  res.json({ ok: true });
});

router.delete("/reservations/:id", requireAuth, async (req, res) => {
  const snap = await db.collection("reservations").doc(req.params.id).get();
  if (!snap.exists) return res.json({ ok: true });

  const data = snap.data();
  const isAdmin = req.session.user.role === "admin";

  if (data.user !== req.session.user.username && !isAdmin) {
    return res.status(403).json({ error: "NOT_ALLOWED" });
  }

  await snap.ref.delete();
  res.json({ ok: true });
});

/* =========================
   ADMIN
========================= */
router.get("/admin/users", requireAdmin, async (req, res) => {
  const snap = await db.collection("users").get();
  const items = [];
  snap.forEach(d => items.push({ username: d.id, ...d.data() }));
  res.json({ items });
});

router.put("/admin/users/credits", requireAdmin, async (req, res) => {
  const { username, delta } = req.body;
  await db.collection("users").doc(username).update({
    credits: FieldValue.increment(delta),
  });
  res.json({ ok: true });
});

router.put("/admin/users/status", requireAdmin, async (req, res) => {
  const { username, disabled } = req.body;
  await db.collection("users").doc(username).update({ disabled });
  res.json({ ok: true });
});

router.put("/admin/users/password", requireAdmin, async (req, res) => {
  const { username, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
  }

  const hash = await bcrypt.hash(newPassword, 10);

  await db.collection("users").doc(username).update({
    passwordHash: hash,
    password: FieldValue.delete(),
  });

  res.json({ ok: true });
});

router.put("/admin/config", requireAdmin, async (req, res) => {
  await db.collection("admin").doc("config").set(req.body, { merge: true });
  res.json({ ok: true });
});

router.put("/admin/fields", requireAdmin, async (req, res) => {
  await db.collection("admin").doc("fields").set(req.body);
  res.json({ ok: true });
});

router.put("/admin/notes", requireAdmin, async (req, res) => {
  await db.collection("admin").doc("notes").set({ text: req.body.text });
  res.json({ ok: true });
});

router.put("/admin/images", requireAdmin, async (req, res) => {
  await db.collection("admin").doc("images").set(req.body.images);
  res.json({ ok: true });
});

export default router;
