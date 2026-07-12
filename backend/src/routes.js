import express from "express";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, FieldValue } from "./db.js";

let lastCleanup = 0;
const CLEANUP_COOLDOWN_MS = 60_000; // 1 minuto

const router = express.Router();

/* =================== MIDDLEWARE =================== */
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  }
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
  max: 10
});

/* =================== UTILS =================== */
function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function romeDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(
    parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
  );
}

function localISODate() {
  const parts = romeDateParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localMinutes() {
  const parts = romeDateParts();
  return Number(parts.hour) * 60 + Number(parts.minute);
}

async function cleanupExpiredReservations() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_COOLDOWN_MS) return;
  lastCleanup = now;

  const cfgSnap = await db.collection("admin").doc("config").get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const slotMinutes = Number(cfg.slotMinutes || 45);

  const today = localISODate();
  const nowMinutes = localMinutes();

  const snap = await db
    .collection("reservations")
    .where("date", "<=", today)
    .get();

  if (snap.empty) return;

  const batch = db.batch();

  snap.forEach(doc => {
    const r = doc.data();
    let expired = false;

    if (r.date < today) expired = true;

    if (r.date === today) {
      const end = timeToMinutes(r.time) + slotMinutes;
      if (end <= nowMinutes) expired = true;
    }

    if (expired) batch.delete(doc.ref);
  });

  await batch.commit();
}


/* =================== AUTH =================== */
router.post("/login", loginLimiter, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const { username, password } = parsed.data;
  const ref = db.collection("users").doc(username);
  const snap = await ref.get();

  if (!snap.exists) return res.status(401).json({ error: "INVALID_LOGIN" });

  const user = snap.data();
  if (user.disabled) return res.status(403).json({ error: "USER_DISABLED" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "INVALID_LOGIN" });

  req.session.user = {
    username,
    role: user.role || "user"
  };

  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", requireAuth, async (req, res) => {
  const username = req.session.user.username;
  const snap = await db.collection("users").doc(username).get();
  const u = snap.exists ? snap.data() : {};

  res.json({
    username,
    role: u.role || "user",
    credits: u.credits ?? 0,
    disabled: !!u.disabled
  });
});

/* =================== PUBLIC CONFIG =================== */
router.get("/public/config", async (req, res) => {
  const cfgSnap = await db.collection("admin").doc("config").get();
  const fieldsSnap = await db.collection("admin").doc("fields").get();
  const notesSnap = await db.collection("admin").doc("notes").get();
  const gallerySnap = await db.collection("admin").doc("gallery").get();

  const cfg = cfgSnap.exists ? cfgSnap.data() : {};

  res.json({
    slotMinutes: Number(cfg.slotMinutes || 45),
    dayStart: cfg.dayStart || "09:00",
    dayEnd: cfg.dayEnd || "20:00",
    maxBookingsPerUserPerDay: Number(cfg.maxBookingsPerUserPerDay || 1),
    maxActiveBookingsPerUser: Number(cfg.maxActiveBookingsPerUser || 1),
    fields: fieldsSnap.exists ? (fieldsSnap.data().fields || []) : [],
    notesText: notesSnap.exists ? (notesSnap.data().text || "") : "",
    gallery: gallerySnap.exists ? (gallerySnap.data().images || []) : []
  });
});

/* =================== RESERVATIONS =================== */
router.get("/reservations", requireAuth, async (req, res) => {
  await cleanupExpiredReservations(); // ⬅️ QUI

  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "BAD_DATE" });
  }

  const snap = await db.collection("reservations")
    .where("date", "==", date)
    .get();

  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  res.json({ items });
});

router.post("/reservations", requireAuth, async (req, res) => {
  await cleanupExpiredReservations();

  const schema = z.object({
    fieldId: z.string().min(1).max(80),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const { fieldId, date, time } = parsed.data;
  const username = req.session.user.username;
  const isAdmin = req.session.user.role === "admin";

  const [cfgSnap, fieldsSnap] = await Promise.all([
    db.collection("admin").doc("config").get(),
    db.collection("admin").doc("fields").get()
  ]);

  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const slotMinutes = Number(cfg.slotMinutes || 45);
  const dayStart = cfg.dayStart || "09:00";
  const dayEnd = cfg.dayEnd || "20:00";
  const maxPerDay = Number(cfg.maxBookingsPerUserPerDay || 1);
  const maxActive = Number(cfg.maxActiveBookingsPerUser || 1);

  const fields = fieldsSnap.exists ? (fieldsSnap.data().fields || []) : [];
  if (!fields.some(field => field.id === fieldId)) {
    return res.status(400).json({ error: "INVALID_FIELD" });
  }

  const requestedMinutes = timeToMinutes(time);
  const startMinutes = timeToMinutes(dayStart);
  const endMinutes = timeToMinutes(dayEnd);
  const isAligned = (requestedMinutes - startMinutes) % slotMinutes === 0;

  if (
    requestedMinutes < startMinutes ||
    requestedMinutes + slotMinutes > endMinutes ||
    !isAligned
  ) {
    return res.status(400).json({ error: "INVALID_SLOT" });
  }

  const today = localISODate();
  const currentMinutes = localMinutes();

  if (date < today) {
    return res.status(400).json({ error: "PAST_DATE_NOT_ALLOWED" });
  }

  if (date === today && requestedMinutes <= currentMinutes) {
    return res.status(400).json({ error: "PAST_TIME_NOT_ALLOWED" });
  }

  if (!isAdmin) {
    const userReservations = await db.collection("reservations")
      .where("user", "==", username)
      .get();

    let activeCount = 0;
    let perDayCount = 0;

    userReservations.forEach(doc => {
      const reservation = doc.data();

      if (reservation.date === date) perDayCount++;

      if (reservation.date > today) {
        activeCount++;
      } else if (reservation.date === today) {
        const reservationEnd = timeToMinutes(reservation.time) + slotMinutes;
        if (reservationEnd > currentMinutes) activeCount++;
      }
    });

    if (perDayCount >= maxPerDay) {
      return res.status(403).json({ error: "MAX_PER_DAY_LIMIT" });
    }

    if (activeCount >= maxActive) {
      return res.status(403).json({ error: "ACTIVE_BOOKING_LIMIT" });
    }
  }

  const reservationId = `${fieldId}_${date}_${time}`;
  const reservationRef = db.collection("reservations").doc(reservationId);
  const userRef = db.collection("users").doc(username);

  try {
    await db.runTransaction(async transaction => {
      const reservationSnap = await transaction.get(reservationRef);
      if (reservationSnap.exists) {
        const error = new Error("SLOT_TAKEN");
        error.code = "SLOT_TAKEN";
        throw error;
      }

      if (!isAdmin) {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists || Number(userSnap.data().credits || 0) <= 0) {
          const error = new Error("NO_CREDITS");
          error.code = "NO_CREDITS";
          throw error;
        }

        transaction.update(userRef, {
          credits: FieldValue.increment(-1)
        });
      }

      transaction.set(reservationRef, {
        fieldId,
        date,
        time,
        user: username,
        createdAt: FieldValue.serverTimestamp()
      });
    });
  } catch (error) {
    if (error?.code === "SLOT_TAKEN") {
      return res.status(409).json({ error: "SLOT_TAKEN" });
    }
    if (error?.code === "NO_CREDITS") {
      return res.status(403).json({ error: "NO_CREDITS" });
    }
    console.error("Errore creazione prenotazione", error);
    return res.status(500).json({ error: "BOOKING_ERROR" });
  }

  res.json({ ok: true });
});

router.delete("/reservations/:id", requireAuth, async (req, res) => {
  const reservationRef = db.collection("reservations").doc(req.params.id);
  const username = req.session.user.username;
  const isAdmin = req.session.user.role === "admin";
  const today = localISODate();

  try {
    await db.runTransaction(async transaction => {
      const reservationSnap = await transaction.get(reservationRef);
      if (!reservationSnap.exists) return;

      const reservation = reservationSnap.data();
      if (!isAdmin && reservation.user !== username) {
        const error = new Error("NOT_ALLOWED");
        error.code = "NOT_ALLOWED";
        throw error;
      }

      if (!isAdmin && reservation.date > today) {
        transaction.update(db.collection("users").doc(username), {
          credits: FieldValue.increment(1)
        });
      }

      transaction.delete(reservationRef);
    });
  } catch (error) {
    if (error?.code === "NOT_ALLOWED") {
      return res.status(403).json({ error: "NOT_ALLOWED" });
    }
    console.error("Errore cancellazione prenotazione", error);
    return res.status(500).json({ error: "DELETE_ERROR" });
  }

  res.json({ ok: true });
});

/* =================== ADMIN =================== */
router.put("/admin/config", requireAdmin, async (req, res) => {
  await db.collection("admin").doc("config")
    .set(req.body || {}, { merge: true });
  res.json({ ok: true });
});

router.put("/admin/notes", requireAdmin, async (req, res) => {
  await db.collection("admin").doc("notes")
    .set({ text: req.body.text || "" }, { merge: true });
  res.json({ ok: true });
});

router.put("/admin/fields", requireAdmin, async (req, res) => {
  await db.collection("admin").doc("fields")
    .set({ fields: req.body.fields || [] }, { merge: true });
  res.json({ ok: true });
});

router.put("/admin/gallery", requireAdmin, async (req, res) => {
  const images = Array.isArray(req.body.images)
    ? req.body.images.slice(0, 10)
    : [];
  await db.collection("admin").doc("gallery")
    .set({ images }, { merge: true });
  res.json({ ok: true });
});

/* =================== ADMIN USERS =================== */
router.get("/admin/users", requireAdmin, async (req, res) => {
  const snap = await db.collection("users").get();
  const items = [];
  snap.forEach(d => {
    const u = d.data();
    items.push({
      username: d.id,
      role: u.role || "user",
      credits: u.credits ?? 0,
      disabled: !!u.disabled
    });
  });
  res.json({ items });
});

router.put("/admin/users/credits", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    delta: z.number().finite()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const ref = db.collection("users").doc(parsed.data.username);
  if (!(await ref.get()).exists) return res.status(404).json({ error: "USER_NOT_FOUND" });

  await ref.update({ credits: FieldValue.increment(parsed.data.delta) });
  res.json({ ok: true });
});

router.put("/admin/users/status", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    disabled: z.boolean()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  await db.collection("users").doc(parsed.data.username)
    .update({ disabled: parsed.data.disabled });
  res.json({ ok: true });
});

router.put("/admin/users/password", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    newPassword: z.string().min(4).max(100)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db.collection("users").doc(parsed.data.username)
    .update({ passwordHash: hash });
  res.json({ ok: true });
});

router.post("/admin/users/rename", requireAdmin, async (req, res) => {
  const schema = z.object({
    oldUsername: z.string().min(1).max(80),
    newUsername: z.string().regex(/^[a-zA-Z0-9._-]{3,40}$/)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const { oldUsername, newUsername } = parsed.data;
  if (oldUsername === newUsername) return res.json({ ok: true });
  if (oldUsername === req.session.user.username) {
    return res.status(400).json({ error: "CANNOT_RENAME_CURRENT_USER" });
  }

  const oldRef = db.collection("users").doc(oldUsername);
  const newRef = db.collection("users").doc(newUsername);
  const [oldSnap, newSnap, reservationsSnap] = await Promise.all([
    oldRef.get(),
    newRef.get(),
    db.collection("reservations").where("user", "==", oldUsername).get()
  ]);

  if (!oldSnap.exists) return res.status(404).json({ error: "USER_NOT_FOUND" });
  if (newSnap.exists) return res.status(409).json({ error: "USERNAME_TAKEN" });
  if (reservationsSnap.size > 498) {
    return res.status(409).json({ error: "TOO_MANY_RESERVATIONS" });
  }

  const batch = db.batch();
  batch.set(newRef, oldSnap.data());
  batch.delete(oldRef);
  reservationsSnap.forEach(doc => batch.update(doc.ref, { user: newUsername }));
  await batch.commit();

  res.json({ ok: true });
});

// ===== METEO (proxy backend per CSP) =====
router.get("/weather", async (req, res) => {
  try {
    const lat = 43.716;
    const lon = 13.218;

    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Europe/Rome`
    );

    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "WEATHER_ERROR" });
  }
});


export default router;
