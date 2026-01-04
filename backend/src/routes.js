import express from "express";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, FieldValue } from "./db.js";

const router = express.Router();

/* -------------------------
   Helpers
------------------------- */
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "NOT_AUTHORIZED" });
  }
  next();
}
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

async function getConfig() {
  const cfgSnap = await db.collection("admin").doc("config").get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  return {
    slotMinutes: Number(cfg.slotMinutes ?? 45),
    dayStart: String(cfg.dayStart ?? "09:00"),
    dayEnd: String(cfg.dayEnd ?? "20:00"),
    maxBookingsPerUserPerDay: Number(cfg.maxBookingsPerUserPerDay ?? 2),
  };
}

function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/* -------------------------
   Auth
------------------------- */
router.post("/login", loginLimiter, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(50),
    password: z.string().min(1).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const { username, password } = parsed.data;

  const ref = db.collection("users").doc(username);
  const snap = await ref.get();
  if (!snap.exists) return res.status(401).json({ error: "INVALID_LOGIN" });

  const user = snap.data();

  if (user.disabled) return res.status(403).json({ error: "USER_DISABLED" });

  // lock
  if (user.lockUntil && user.lockUntil.toDate) {
    const lockDate = user.lockUntil.toDate();
    if (lockDate > new Date()) {
      return res.status(423).json({ error: "ACCOUNT_LOCKED", until: lockDate.toISOString() });
    }
  }

  if (!user.passwordHash) return res.status(500).json({ error: "PASSWORD_NOT_SET" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const attempts = (user.failedAttempts || 0) + 1;
    const updates = { failedAttempts: attempts };
    if (attempts >= 5) {
      updates.failedAttempts = 0;
      updates.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    }
    await ref.update(updates);
    return res.status(401).json({ error: "INVALID_LOGIN" });
  }

  await ref.update({ failedAttempts: 0, lockUntil: null });

  req.session.user = { username, role: user.role || "user" };

  res.json({ ok: true, username, role: user.role || "user", credits: user.credits ?? 0 });
});

router.post("/logout", (req, res) => {
  req.session?.destroy(() => res.json({ ok: true }));
});

router.get("/me", requireAuth, async (req, res) => {
  const username = req.session.user.username;
  const snap = await db.collection("users").doc(username).get();
  const user = snap.exists ? snap.data() : {};
  res.json({
    username,
    role: user.role || "user",
    credits: user.credits ?? 0,
    disabled: !!user.disabled,
  });
});

/* -------------------------
   Public config + fields + notes
------------------------- */
router.get("/public/config", async (req, res) => {
  const cfg = await getConfig();
  const fieldsSnap = await db.collection("admin").doc("fields").get();
  const notesSnap = await db.collection("admin").doc("notes").get();

  res.json({
    ...cfg,
    fields: fieldsSnap.exists ? (fieldsSnap.data().fields || []) : [],
    notesText: notesSnap.exists ? (notesSnap.data().text || "") : "",
  });
});

/* -------------------------
   Reservations
   id = `${fieldId}_${date}_${time}`
------------------------- */
router.get("/reservations", requireAuth, async (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "BAD_DATE" });

  const snap = await db.collection("reservations").where("date", "==", date).get();
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
  res.json({ items });
});

router.post("/reservations", requireAuth, async (req, res) => {
  const schema = z.object({
    fieldId: z.string().min(1).max(50),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const { fieldId, date, time } = parsed.data;
  const { slotMinutes, dayStart, dayEnd, maxBookingsPerUserPerDay } = await getConfig();

  // validate time range
  const tMin = timeToMinutes(time);
  if (tMin < timeToMinutes(dayStart) || tMin + slotMinutes > timeToMinutes(dayEnd)) {
    return res.status(400).json({ error: "TIME_OUT_OF_RANGE" });
  }

  const id = `${fieldId}_${date}_${time}`;
  const ref = db.collection("reservations").doc(id);

  // slot taken?
  if ((await ref.get()).exists) return res.status(409).json({ error: "SLOT_TAKEN" });

  const username = req.session.user.username;
  const isAdmin = req.session.user.role === "admin";

  // limit per user/day (non-admin)
  if (!isAdmin) {
    const userDaySnap = await db
      .collection("reservations")
      .where("date", "==", date)
      .where("user", "==", username)
      .get();

    if (userDaySnap.size >= maxBookingsPerUserPerDay) {
      return res.status(403).json({ error: "DAILY_LIMIT" });
    }

    // credits
    const userRef = db.collection("users").doc(username);
    const userSnap = await userRef.get();
    const credits = userSnap.exists ? (userSnap.data().credits ?? 0) : 0;
    if (credits <= 0) return res.status(403).json({ error: "NO_CREDITS" });

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
  const id = String(req.params.id || "");
  const snap = await db.collection("reservations").doc(id).get();
  if (!snap.exists) return res.json({ ok: true });

  const data = snap.data();
  const username = req.session.user.username;
  const isAdmin = req.session.user.role === "admin";

  if (!isAdmin && data.user !== username) return res.status(403).json({ error: "NOT_ALLOWED" });

  // refund credit to user if non-admin cancelled own booking
  if (!isAdmin && data.user === username) {
    await db.collection("users").doc(username).update({ credits: FieldValue.increment(1) });
  }

  await snap.ref.delete();
  res.json({ ok: true });
});

/* -------------------------
   Admin: config / notes / fields
------------------------- */
router.put("/admin/config", requireAdmin, async (req, res) => {
  const schema = z.object({
    slotMinutes: z.number().int().min(15).max(180).optional(),
    dayStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    dayEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    maxBookingsPerUserPerDay: z.number().int().min(1).max(10).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  await db.collection("admin").doc("config").set(parsed.data, { merge: true });
  res.json({ ok: true });
});

router.put("/admin/notes", requireAdmin, async (req, res) => {
  const schema = z.object({ text: z.string().max(5000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  await db.collection("admin").doc("notes").set({ text: parsed.data.text }, { merge: true });
  res.json({ ok: true });
});

router.put("/admin/fields", requireAdmin, async (req, res) => {
  // fields: [{id, name}]
  const schema = z.object({
    fields: z
      .array(
        z.object({
          id: z.string().min(1).max(50),
          name: z.string().min(1).max(80),
        })
      )
      .max(50),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  await db.collection("admin").doc("fields").set({ fields: parsed.data.fields }, { merge: true });
  res.json({ ok: true });
});

/* -------------------------
   Admin: users
------------------------- */
router.get("/admin/users", requireAdmin, async (req, res) => {
  const snap = await db.collection("users").get();
  const items = [];
  snap.forEach((d) => {
    const u = d.data();
    items.push({
      username: d.id,
      role: u.role || "user",
      credits: u.credits ?? 0,
      disabled: !!u.disabled,
    });
  });
  items.sort((a, b) => a.username.localeCompare(b.username));
  res.json({ items });
});

router.post("/admin/users", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(50),
    password: z.string().min(4).max(200),
    role: z.enum(["user", "admin"]).default("user"),
    credits: z.number().int().min(0).max(99999).default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const { username, password, role, credits } = parsed.data;

  const ref = db.collection("users").doc(username);
  if ((await ref.get()).exists) return res.status(409).json({ error: "USER_EXISTS" });

  const hash = await bcrypt.hash(password, 10);

  await ref.set({
    role,
    credits,
    disabled: false,
    passwordHash: hash,
    failedAttempts: 0,
    lockUntil: null,
    createdAt: FieldValue.serverTimestamp(),
  });

  res.json({ ok: true });
});

router.put("/admin/users/credits", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(50),
    delta: z.number().int().min(-99999).max(99999),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  await db.collection("users").doc(parsed.data.username).update({
    credits: FieldValue.increment(parsed.data.delta),
  });
  res.json({ ok: true });
});

router.put("/admin/users/status", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(50),
    disabled: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  await db.collection("users").doc(parsed.data.username).update({ disabled: parsed.data.disabled });
  res.json({ ok: true });
});

router.put("/admin/users/password", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(50),
    newPassword: z.string().min(4).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db.collection("users").doc(parsed.data.username).update({ passwordHash: hash });

  res.json({ ok: true });
});

export default router;
