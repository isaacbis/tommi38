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

async function commitDeleteRefs(refs = []) {
  for (let index = 0; index < refs.length; index += 450) {
    const batch = db.batch();
    refs.slice(index, index + 450).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

async function deletePlayerSearchTree(searchId) {
  const searchRef = db.collection("playerSearches").doc(searchId);
  const requestsSnap = await searchRef.collection("requests").get();
  const refs = requestsSnap.docs.map(doc => doc.ref);
  refs.push(searchRef);
  await commitDeleteRefs(refs);
}

function reservationIsExpired(reservation, slotMinutes, today, nowMinutes) {
  if (reservation.date < today) return true;
  if (reservation.date > today) return false;
  return timeToMinutes(reservation.time) + slotMinutes <= nowMinutes;
}

function playerSearchIsExpired(search, today, nowMinutes) {
  if (search.date < today) return true;
  if (search.date > today) return false;
  return timeToMinutes(search.time) <= nowMinutes;
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

  const expiredDocs = snap.docs.filter(doc =>
    reservationIsExpired(doc.data(), slotMinutes, today, nowMinutes)
  );

  if (expiredDocs.length === 0) return;

  await commitDeleteRefs(expiredDocs.map(doc => doc.ref));
  await Promise.all(expiredDocs.map(doc => deletePlayerSearchTree(doc.id)));
}

function playerRequestId(username) {
  return Buffer.from(username, "utf8").toString("base64url");
}

function publicRequestData(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    participantNames: Array.isArray(data.participantNames) ? data.participantNames : [],
    phone: data.phone || "",
    count: Number(data.count || 0),
    status: data.status || "pending"
  };
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
  const currentMinutes = localMinutes();

  const cfgSnap = await db.collection("admin").doc("config").get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const slotMinutes = Number(cfg.slotMinutes || 45);

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

      const ownerRef = db.collection("users").doc(reservation.user);
      const ownerSnap = await transaction.get(ownerRef);
      const isStillActive = !reservationIsExpired(reservation, slotMinutes, today, currentMinutes);
      const ownerIsAdmin = ownerSnap.exists && (ownerSnap.data().role || "user") === "admin";

      if (ownerSnap.exists && !ownerIsAdmin && isStillActive) {
        transaction.update(ownerRef, {
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

  await deletePlayerSearchTree(req.params.id);
  res.json({ ok: true });
});

/* =================== CERCA GIOCATORI =================== */
router.get("/player-searches", requireAuth, async (req, res) => {
  await cleanupExpiredReservations();

  const username = req.session.user.username;
  const isAdmin = req.session.user.role === "admin";
  const today = localISODate();
  const currentMinutes = localMinutes();

  const cfgSnap = await db.collection("admin").doc("config").get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const slotMinutes = Number(cfg.slotMinutes || 45);

  const snap = await db.collection("playerSearches")
    .where("date", ">=", today)
    .get();

  const items = [];

  for (const doc of snap.docs) {
    const search = doc.data();
    if (playerSearchIsExpired(search, today, currentMinutes)) continue;

    const requestsSnap = await doc.ref.collection("requests").get();
    const allRequests = requestsSnap.docs.map(publicRequestData);
    const myRequest = requestsSnap.docs.find(requestDoc =>
      requestDoc.data().requesterUser === username
    );

    const isOwner = search.ownerUser === username;
    const canManage = isOwner || isAdmin;
    const spotsNeeded = Number(search.spotsNeeded || 0);
    const spotsFilled = Number(search.spotsFilled || 0);
    const spotsAvailable = Math.max(0, spotsNeeded - spotsFilled);
    const status = search.status || "open";

    const shouldInclude =
      status === "open" ||
      status === "full" ||
      canManage ||
      Boolean(myRequest);

    if (!shouldInclude) continue;

    items.push({
      id: doc.id,
      reservationId: search.reservationId || doc.id,
      fieldId: search.fieldId,
      date: search.date,
      time: search.time,
      note: search.note || "",
      status,
      spotsNeeded,
      spotsFilled,
      spotsAvailable,
      isOwner,
      canManage,
      requests: canManage ? allRequests : [],
      myRequest: myRequest ? publicRequestData(myRequest) : null
    });
  }

  items.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  res.json({ items });
});

router.post("/player-searches", requireAuth, async (req, res) => {
  const schema = z.object({
    reservationId: z.string().min(1).max(180),
    spotsNeeded: z.number().int().min(1).max(12),
    note: z.string().max(200).optional().default("")
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const { reservationId, spotsNeeded, note } = parsed.data;
  const username = req.session.user.username;
  const isAdmin = req.session.user.role === "admin";
  const reservationRef = db.collection("reservations").doc(reservationId);
  const reservationSnap = await reservationRef.get();

  if (!reservationSnap.exists) return res.status(404).json({ error: "RESERVATION_NOT_FOUND" });

  const reservation = reservationSnap.data();
  if (!isAdmin && reservation.user !== username) {
    return res.status(403).json({ error: "NOT_ALLOWED" });
  }

  const cfgSnap = await db.collection("admin").doc("config").get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const slotMinutes = Number(cfg.slotMinutes || 45);
  if (playerSearchIsExpired(reservation, localISODate(), localMinutes())) {
    return res.status(400).json({ error: "RESERVATION_EXPIRED" });
  }

  const searchRef = db.collection("playerSearches").doc(reservationId);
  const existing = await searchRef.get();
  if (existing.exists && ["open", "full"].includes(existing.data().status || "open")) {
    return res.status(409).json({ error: "SEARCH_ALREADY_EXISTS" });
  }

  if (existing.exists) await deletePlayerSearchTree(reservationId);

  await searchRef.set({
    reservationId,
    fieldId: reservation.fieldId,
    date: reservation.date,
    time: reservation.time,
    ownerUser: reservation.user,
    spotsNeeded,
    spotsFilled: 0,
    status: "open",
    note: note.trim(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  res.json({ ok: true, id: reservationId });
});

router.post("/player-searches/:id/requests", requireAuth, async (req, res) => {
  const schema = z.object({
    participantNames: z.array(z.string().trim().min(2).max(80)).min(1).max(12),
    phone: z.string().trim().min(6).max(30).regex(/^[0-9+().\s-]+$/)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const username = req.session.user.username;
  const searchRef = db.collection("playerSearches").doc(req.params.id);
  const requestRef = searchRef.collection("requests").doc(playerRequestId(username));
  const participantNames = parsed.data.participantNames.map(name => name.replace(/\s+/g, " "));
  const count = participantNames.length;

  try {
    await db.runTransaction(async transaction => {
      const [searchSnap, requestSnap] = await Promise.all([
        transaction.get(searchRef),
        transaction.get(requestRef)
      ]);

      if (!searchSnap.exists) {
        const error = new Error("SEARCH_NOT_FOUND");
        error.code = "SEARCH_NOT_FOUND";
        throw error;
      }

      const search = searchSnap.data();
      if (playerSearchIsExpired(search, localISODate(), localMinutes())) {
        const error = new Error("SEARCH_CLOSED");
        error.code = "SEARCH_CLOSED";
        throw error;
      }
      if (search.ownerUser === username) {
        const error = new Error("CANNOT_JOIN_OWN_SEARCH");
        error.code = "CANNOT_JOIN_OWN_SEARCH";
        throw error;
      }

      if ((search.status || "open") !== "open") {
        const error = new Error("SEARCH_CLOSED");
        error.code = "SEARCH_CLOSED";
        throw error;
      }

      const available = Math.max(0, Number(search.spotsNeeded || 0) - Number(search.spotsFilled || 0));
      if (count > available) {
        const error = new Error("NOT_ENOUGH_SPOTS");
        error.code = "NOT_ENOUGH_SPOTS";
        throw error;
      }

      if (requestSnap.exists && ["pending", "accepted"].includes(requestSnap.data().status)) {
        const error = new Error("ALREADY_REQUESTED");
        error.code = "ALREADY_REQUESTED";
        throw error;
      }

      transaction.set(requestRef, {
        requesterUser: username,
        participantNames,
        phone: parsed.data.phone,
        count,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    });
  } catch (error) {
    const known = [
      "SEARCH_NOT_FOUND",
      "CANNOT_JOIN_OWN_SEARCH",
      "SEARCH_CLOSED",
      "NOT_ENOUGH_SPOTS",
      "ALREADY_REQUESTED"
    ];
    if (known.includes(error?.code)) {
      return res.status(error.code === "SEARCH_NOT_FOUND" ? 404 : 409).json({ error: error.code });
    }
    console.error("Errore richiesta partecipazione", error);
    return res.status(500).json({ error: "JOIN_REQUEST_ERROR" });
  }

  res.json({ ok: true });
});

router.patch("/player-searches/:id/requests/:requestId", requireAuth, async (req, res) => {
  const schema = z.object({ status: z.enum(["accepted", "rejected"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const username = req.session.user.username;
  const isAdmin = req.session.user.role === "admin";
  const searchRef = db.collection("playerSearches").doc(req.params.id);
  const requestRef = searchRef.collection("requests").doc(req.params.requestId);

  try {
    await db.runTransaction(async transaction => {
      const [searchSnap, requestSnap] = await Promise.all([
        transaction.get(searchRef),
        transaction.get(requestRef)
      ]);

      if (!searchSnap.exists || !requestSnap.exists) {
        const error = new Error("NOT_FOUND");
        error.code = "NOT_FOUND";
        throw error;
      }

      const search = searchSnap.data();
      const request = requestSnap.data();

      if (playerSearchIsExpired(search, localISODate(), localMinutes())) {
        const error = new Error("SEARCH_CLOSED");
        error.code = "SEARCH_CLOSED";
        throw error;
      }

      if (!isAdmin && search.ownerUser !== username) {
        const error = new Error("NOT_ALLOWED");
        error.code = "NOT_ALLOWED";
        throw error;
      }

      if (request.status !== "pending") {
        const error = new Error("REQUEST_ALREADY_HANDLED");
        error.code = "REQUEST_ALREADY_HANDLED";
        throw error;
      }

      if (parsed.data.status === "rejected") {
        transaction.update(requestRef, {
          status: "rejected",
          updatedAt: FieldValue.serverTimestamp()
        });
        return;
      }

      if ((search.status || "open") !== "open") {
        const error = new Error("SEARCH_CLOSED");
        error.code = "SEARCH_CLOSED";
        throw error;
      }

      const spotsNeeded = Number(search.spotsNeeded || 0);
      const spotsFilled = Number(search.spotsFilled || 0);
      const count = Number(request.count || 0);
      const available = Math.max(0, spotsNeeded - spotsFilled);

      if (count > available) {
        const error = new Error("NOT_ENOUGH_SPOTS");
        error.code = "NOT_ENOUGH_SPOTS";
        throw error;
      }

      const nextFilled = spotsFilled + count;
      transaction.update(requestRef, {
        status: "accepted",
        updatedAt: FieldValue.serverTimestamp()
      });
      transaction.update(searchRef, {
        spotsFilled: nextFilled,
        status: nextFilled >= spotsNeeded ? "full" : "open",
        updatedAt: FieldValue.serverTimestamp()
      });
    });
  } catch (error) {
    const known = [
      "NOT_FOUND",
      "NOT_ALLOWED",
      "REQUEST_ALREADY_HANDLED",
      "SEARCH_CLOSED",
      "NOT_ENOUGH_SPOTS"
    ];
    if (known.includes(error?.code)) {
      return res.status(error.code === "NOT_FOUND" ? 404 : 409).json({ error: error.code });
    }
    console.error("Errore gestione richiesta", error);
    return res.status(500).json({ error: "REQUEST_UPDATE_ERROR" });
  }

  const updatedSearchSnap = await searchRef.get();
  if (updatedSearchSnap.exists && updatedSearchSnap.data().status === "full") {
    const pendingSnap = await searchRef.collection("requests")
      .where("status", "==", "pending")
      .get();

    if (!pendingSnap.empty) {
      const batch = db.batch();
      pendingSnap.docs.forEach(doc => batch.update(doc.ref, {
        status: "rejected",
        updatedAt: FieldValue.serverTimestamp()
      }));
      await batch.commit();
    }
  }

  res.json({ ok: true });
});

router.delete("/player-searches/:id/requests/:requestId", requireAuth, async (req, res) => {
  const searchRef = db.collection("playerSearches").doc(req.params.id);
  const requestRef = searchRef.collection("requests").doc(req.params.requestId);
  const requestSnap = await requestRef.get();

  if (!requestSnap.exists) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
  const request = requestSnap.data();

  if (request.requesterUser !== req.session.user.username) {
    return res.status(403).json({ error: "NOT_ALLOWED" });
  }
  if (request.status !== "pending") {
    return res.status(409).json({ error: "REQUEST_ALREADY_HANDLED" });
  }

  await requestRef.delete();
  res.json({ ok: true });
});

router.delete("/player-searches/:id", requireAuth, async (req, res) => {
  const searchRef = db.collection("playerSearches").doc(req.params.id);
  const searchSnap = await searchRef.get();
  if (!searchSnap.exists) return res.status(404).json({ error: "SEARCH_NOT_FOUND" });

  const search = searchSnap.data();
  const isAdmin = req.session.user.role === "admin";
  if (!isAdmin && search.ownerUser !== req.session.user.username) {
    return res.status(403).json({ error: "NOT_ALLOWED" });
  }

  const requestsSnap = await searchRef.collection("requests").get();
  const batch = db.batch();
  batch.update(searchRef, {
    status: "closed",
    updatedAt: FieldValue.serverTimestamp()
  });

  requestsSnap.docs.forEach(doc => {
    if (doc.data().status === "pending") {
      batch.update(doc.ref, {
        status: "rejected",
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });

  await batch.commit();
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
