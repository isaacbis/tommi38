import express from "express";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { FieldValue } from "./db.js";
import { db, tenantId, establishments } from "./tenancy.js";
import { requireAuth, requireAdmin, validDate } from "./permissions.js";

const cleanupTimes = new Map();
const CLEANUP_COOLDOWN_MS = 60_000; // 1 minuto

const router = express.Router();
// Express 4 forwards synchronous errors only; route promises must reach the error handler.
for (const method of ['get','post','put','patch','delete']) {
  const register = router[method].bind(router);
  router[method] = (path,...handlers) => register(path,...handlers.map(handler =>
    (req,res,next) => Promise.resolve().then(() => handler(req,res,next)).catch(next)));
}
/* =================== MIDDLEWARE =================== */
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
  return timeToMinutes(reservation.time) + Number(reservation.slotMinutes || slotMinutes) <= nowMinutes;
}

function playerSearchIsExpired(search, today, nowMinutes) {
  if (search.date < today) return true;
  if (search.date > today) return false;
  return timeToMinutes(search.time) <= nowMinutes;
}

async function cleanupExpiredReservations() {
  const now = Date.now();
  if (now - (cleanupTimes.get(tenantId()) || 0) < CLEANUP_COOLDOWN_MS) return;
  cleanupTimes.set(tenantId(), now);

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

  for (const doc of expiredDocs) {
    await db.runTransaction(async tx => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || !reservationIsExpired(fresh.data(), slotMinutes, today, nowMinutes)) return;
      tx.set(db.collection("reservationHistory").doc(), { ...fresh.data(), reservationId:doc.id, status:"completed", archivedAt:FieldValue.serverTimestamp() });
      tx.delete(doc.ref);
    });
  }
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
router.get("/establishments", async (req, res) => res.json({ items: await establishments() }));

router.post("/login", loginLimiter, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(80).refine(value=>!value.includes("/")),
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

  await new Promise((resolve,reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.user = {
    username,
    role: user.role || "user",
    establishment: tenantId(),
    sessionVersion: Number(user.sessionVersion || 0)
  };

  res.json({ ok: true });
});

router.post("/logout", (req, res, next) => {
  req.session.destroy(error => error ? next(error) : res.json({ ok: true }));
});

router.get("/me", requireAuth, async (req, res) => {
  const username = req.session.user.username;
  const snap = await db.collection("users").doc(username).get();
  const u = snap.exists ? snap.data() : {};

  res.json({
    username,
    role: u.role || "user",
    credits: u.credits ?? 0,
    disabled: !!u.disabled,
    platformAdmin: tenantId() === "tommi38" && u.platformAdmin === true
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
    gallery: gallerySnap.exists ? (gallerySnap.data().images || []) : [],
    registrationEnabled: cfg.registrationEnabled === true
  });
});

/* =================== RESERVATIONS =================== */
router.get("/reservations", requireAuth, async (req, res) => {
  await cleanupExpiredReservations(); // ⬅️ QUI

  const date = String(req.query.date || "");
  if (!validDate(date)) {
    return res.status(400).json({ error: "BAD_DATE" });
  }

  const snap = await db.collection("reservations")
    .where("date", "==", date)
    .get();

  const items = [];
  snap.forEach(d => {
    const r = d.data();
    items.push({id:d.id, fieldId:r.fieldId, date:r.date, time:r.time, user:req.session.user.role === "admin" || r.user === req.session.user.username ? r.user : ""});
  });
  const closed = await db.collection("admin").doc("closures").get();
  res.json({ items, closures: closed.exists ? (closed.data().items || []).filter(c => c.date === date) : [] });
});


router.get("/reservations/mine", requireAuth, async (req, res) => {
  await cleanupExpiredReservations();

  const username = req.session.user.username;
  const today = localISODate();
  const now = localMinutes();

  const cfgSnap = await db.collection("admin").doc("config").get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const slotMinutes = Number(cfg.slotMinutes || 45);

  const snap = await db.collection("reservations")
    .where("user", "==", username)
    .get();

  const items = [];
  snap.forEach(doc => {
    const reservation = { id: doc.id, ...doc.data() };

    if (reservation.date > today) {
      items.push(reservation);
      return;
    }

    if (reservation.date === today) {
      const end = timeToMinutes(reservation.time) + Number(reservation.slotMinutes || slotMinutes);
      if (end > now) items.push(reservation);
    }
  });

  items.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  res.json({ items });
});

router.post("/reservations", requireAuth, async (req, res) => {
  await cleanupExpiredReservations();

  const schema = z.object({
    fieldId: z.string().min(1).max(80),
    date: z.string().refine(validDate),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
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
        const reservationEnd = timeToMinutes(reservation.time) + Number(reservation.slotMinutes || slotMinutes);
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
      const [reservationSnap, currentConfig, currentFields, dayBookings] = await Promise.all([
        transaction.get(reservationRef), transaction.get(db.collection("admin").doc("config")),
        transaction.get(db.collection("admin").doc("fields")), transaction.get(db.collection("reservations").where("date","==",date))
      ]);
      if (JSON.stringify(currentConfig.data() || {}) !== JSON.stringify(cfg) ||
          !(currentFields.data()?.fields || []).some(field=>field.id===fieldId)) {
        throw Object.assign(new Error("CONFIG_CHANGED"),{code:"CONFIG_CHANGED"});
      }
      if (dayBookings.docs.some(doc=>{const r=doc.data();return r.fieldId===fieldId && requestedMinutes < timeToMinutes(r.time)+Number(r.slotMinutes || slotMinutes) && requestedMinutes+slotMinutes > timeToMinutes(r.time);})) {
        throw Object.assign(new Error("SLOT_TAKEN"),{code:"SLOT_TAKEN"});
      }
      const closureSnap = await transaction.get(db.collection("admin").doc("closures"));
      const closures = closureSnap.exists ? closureSnap.data().items || [] : [];
      if (closures.some(c => c.date === date && c.fieldId === fieldId && time < c.end && timeToMinutes(time) + slotMinutes > timeToMinutes(c.start))) {
        throw Object.assign(new Error("FIELD_CLOSED"), {code:"FIELD_CLOSED"});
      }
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

        if (userSnap.data().disabled) throw Object.assign(new Error("NO_CREDITS"), {code:"NO_CREDITS"});
        const active = await transaction.get(db.collection("reservations").where("user", "==", username));
        const current = active.docs.map(d => d.data()).filter(r => !reservationIsExpired(r, slotMinutes, today, currentMinutes));
        if (current.length >= maxActive || current.filter(r => r.date === date).length >= maxPerDay) {
          throw Object.assign(new Error("BOOKING_LIMIT"), {code:"BOOKING_LIMIT"});
        }
        transaction.update(userRef, { credits: FieldValue.increment(-1) });
        transaction.set(db.collection("creditLedger").doc(), { user:username, delta:-1, reason:"Prenotazione", reservationId, createdAt:FieldValue.serverTimestamp() });
      }

      transaction.set(reservationRef, {
        fieldId,
        date,
        time,
        user: username,
        slotMinutes,
        createdAt: FieldValue.serverTimestamp()
      });
    });
  } catch (error) {
    if (["FIELD_CLOSED", "BOOKING_LIMIT"].includes(error?.code)) return res.status(409).json({error:error.code});
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

      if (!isAdmin && reservation.date > today) {
        transaction.set(db.collection("creditLedger").doc(), {user:username, delta:1, reason:"Rimborso cancellazione", reservationId:req.params.id, createdAt:FieldValue.serverTimestamp()});
      }
      transaction.set(db.collection("reservationHistory").doc(), { ...reservation, reservationId:req.params.id, status:"cancelled", cancelledBy:username, archivedAt:FieldValue.serverTimestamp() });
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
  const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
  const parsed = z.object({slotMinutes:z.number().int().min(5).max(240), dayStart:time, dayEnd:time,
    maxBookingsPerUserPerDay:z.number().int().min(1).max(50), maxActiveBookingsPerUser:z.number().int().min(1).max(100),
    registrationEnabled:z.boolean().optional()}).strict().safeParse(req.body);
  if (!parsed.success || timeToMinutes(parsed.data.dayEnd)-timeToMinutes(parsed.data.dayStart)<parsed.data.slotMinutes) return res.status(400).json({error:"BAD_CONFIG"});
  await cleanupExpiredReservations();
  const changed = await db.runTransaction(async tx => {
    const ref=db.collection("admin").doc("config");
    const [old,bookings]=await Promise.all([tx.get(ref),tx.get(db.collection("reservations"))]);
    if (Number(old.data()?.slotMinutes || 45)!==parsed.data.slotMinutes && !bookings.empty) return false;
    tx.set(ref,{...(old.data() || {}),...parsed.data});return true;
  });
  if(!changed)return res.status(409).json({error:"ACTIVE_DURATION_CHANGE"});
  res.json({ok:true});
});

router.put("/admin/notes", requireAdmin, async (req, res) => {
  await db.collection("admin").doc("notes")
    .set({ text: req.body.text || "" }, { merge: true });
  res.json({ ok: true });
});

router.put("/admin/fields", requireAdmin, async (req, res) => {
  const parsed = z.object({fields:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),name:z.string().trim().min(1).max(80)})).max(50)}).safeParse(req.body);
  if (!parsed.success || new Set(parsed.data.fields.map(f=>f.id)).size !== parsed.data.fields.length) return res.status(400).json({error:"BAD_FIELDS"});
  await cleanupExpiredReservations();
  const saved=await db.runTransaction(async tx=>{
    const bookings=await tx.get(db.collection("reservations"));
    if(bookings.docs.some(d=>!parsed.data.fields.some(f=>f.id===d.data().fieldId)))return false;
    tx.set(db.collection("admin").doc("fields"),parsed.data);return true;
  });
  if(!saved)return res.status(409).json({error:"FIELD_HAS_RESERVATIONS"});
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
      disabled: !!u.disabled,
      pendingApproval: !!u.pendingApproval
    });
  });
  res.json({ items });
});

router.put("/admin/users/credits", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(80).refine(value=>!value.includes("/")),
    delta: z.number().finite()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const ref = db.collection("users").doc(parsed.data.username);
  if (!(await ref.get()).exists) return res.status(404).json({ error: "USER_NOT_FOUND" });

  try {
    await db.runTransaction(async tx => {
      const user = await tx.get(ref);
      const next = Number(user.data().credits || 0) + parsed.data.delta;
      if (!Number.isSafeInteger(next) || next < 0) throw new Error("INVALID_BALANCE");
      tx.update(ref, {credits:next});
      tx.set(db.collection("creditLedger").doc(), {user:parsed.data.username, delta:parsed.data.delta, reason:"Rettifica amministratore", actor:req.session.user.username, createdAt:FieldValue.serverTimestamp()});
    });
  } catch { return res.status(400).json({error:"INVALID_BALANCE"}); }
  res.json({ ok: true });
});

router.put("/admin/users/status", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(80).refine(value=>!value.includes("/")),
    disabled: z.boolean()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  if (parsed.data.username === req.session.user.username && parsed.data.disabled) return res.status(400).json({error:"CANNOT_DISABLE_SELF"});
  const ref=db.collection("users").doc(parsed.data.username);
  const snap=await ref.get();
  if (!snap.exists) return res.status(404).json({error:"USER_NOT_FOUND"});
  if (snap.data().platformAdmin && !req.session.user.platformAdmin) return res.status(403).json({error:"NOT_AUTHORIZED"});
  await ref.update({disabled:parsed.data.disabled,pendingApproval:false,sessionVersion:FieldValue.increment(1)});
  res.json({ ok: true });
});

router.put("/admin/users/password", requireAdmin, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(80).refine(value=>!value.includes("/")),
    newPassword: z.string().min(12).max(72).refine(value => Buffer.byteLength(value,"utf8") <= 72)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });

  const ref=db.collection("users").doc(parsed.data.username);
  const snap=await ref.get();
  if (!snap.exists) return res.status(404).json({error:"USER_NOT_FOUND"});
  if (snap.data().platformAdmin && !req.session.user.platformAdmin) return res.status(403).json({error:"NOT_AUTHORIZED"});
  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  await db.runTransaction(async tx => {
    const fresh=await tx.get(ref);
    if (!fresh.exists || (fresh.data().platformAdmin && !req.session.user.platformAdmin)) throw new Error("ACCOUNT_CHANGED");
    tx.update(ref,{passwordHash:hash,sessionVersion:FieldValue.increment(1)});
    tx.delete(db.collection("recoveryRequests").doc(parsed.data.username));
  });
  res.json({ ok: true });
});

router.post("/admin/users/rename", requireAdmin, async (req, res) => {
  const schema = z.object({
    oldUsername: z.string().min(1).max(80).refine(value=>!value.includes("/")),
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
  const error=await db.runTransaction(async tx=>{
    const userCollections=['reservations','creditLedger','waitlist','reservationHistory'];
    const namedCollections=['creditRequests','recoveryRequests'];
    const [oldSnap,newSnap,...records]=await Promise.all([
      tx.get(oldRef),tx.get(newRef),
      ...userCollections.map(name=>tx.get(db.collection(name).where('user','==',oldUsername))),
      ...namedCollections.flatMap(name=>[tx.get(db.collection(name).doc(oldUsername)),tx.get(db.collection(name).doc(newUsername))]),
      tx.get(db.collection('playerSearches'))
    ]);
    if(!oldSnap.exists)return 'USER_NOT_FOUND';
    if(oldSnap.data().platformAdmin)return 'CANNOT_RENAME_PLATFORM_ADMIN';
    if(newSnap.exists)return 'USERNAME_TAKEN';
    const history=records.slice(0,userCollections.length);
    const named=records.slice(userCollections.length,userCollections.length+namedCollections.length*2);
    if(named.some((doc,index)=>index%2===1 && doc.exists))return 'USERNAME_TAKEN';
    const searches=records.at(-1);
    const requests=await Promise.all(searches.docs.map(search=>tx.get(search.ref.collection('requests').where('requesterUser','==',oldUsername))));
    const owned=searches.docs.filter(search=>search.data().ownerUser===oldUsername);
    const writes=2+history.reduce((sum,snap)=>sum+snap.size,0)+named.filter((snap,index)=>index%2===0 && snap.exists).length*2+owned.length+requests.reduce((sum,snap)=>sum+snap.size,0);
    if(writes>490)return 'TOO_MANY_RESERVATIONS';
    tx.set(newRef,{...oldSnap.data(),sessionVersion:Number(oldSnap.data().sessionVersion || 0)+1});
    tx.delete(oldRef);
    history.forEach(snap=>snap.docs.forEach(doc=>tx.update(doc.ref,{user:newUsername})));
    namedCollections.forEach((name,index)=>{
      const source=named[index*2];if(!source.exists)return;
      const value={...source.data()};if('user' in value)value.user=newUsername;if('username' in value)value.username=newUsername;
      tx.set(db.collection(name).doc(newUsername),value);tx.delete(db.collection(name).doc(oldUsername));
    });
    owned.forEach(doc=>tx.update(doc.ref,{ownerUser:newUsername}));
    requests.forEach(snap=>snap.docs.forEach(doc=>tx.update(doc.ref,{requesterUser:newUsername})));
    return null;
  });
  if(error)return res.status(error==='USER_NOT_FOUND'?404:409).json({error});

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


/* =================== WAITLIST / CREDITS / OPERATIONS =================== */
router.get('/credits', requireAuth, async (req, res) => {
  const user = req.session.user.username;
  const [account, history] = await Promise.all([
    db.collection('users').doc(user).get(),
    db.collection('creditLedger').where('user', '==', user).get()
  ]);
  const items = history.docs.map(d => ({id:d.id, delta:d.data().delta, reason:d.data().reason, at:d.data().createdAt?.toDate?.().toISOString() || null}));
  items.sort((a,b) => (b.at || '').localeCompare(a.at || ''));
  res.json({balance:account.data()?.credits || 0, items:items.slice(0,100)});
});
router.get('/waitlist', requireAuth, async (req,res) => {
  const snap = await db.collection('waitlist').where('user','==',req.session.user.username).get();
  const closures = await db.collection('admin').doc('closures').get();
  const items = [];
  for (const doc of snap.docs) {
    const value = doc.data();
    if (value.date < localISODate() || (value.date === localISODate() && value.time <= `${romeDateParts().hour}:${romeDateParts().minute}`)) continue;
    const booked = await db.collection('reservations').doc(value.reservationId).get();
    const blocked = (closures.data()?.items || []).some(c => c.date === value.date && c.fieldId === value.fieldId && value.time < c.end && value.end > c.start);
    items.push({id:doc.id, fieldId:value.fieldId, date:value.date, time:value.time, available:!booked.exists && !blocked});
  }
  items.sort((a,b)=>`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  res.json({items});
});
router.post('/waitlist', requireAuth, async (req,res) => {
  const schema = z.object({reservationId:z.string().min(1).max(120).refine(v=>!v.includes('/'))});
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:'BAD_BODY'});
  const {reservationId} = parsed.data;
  const username = req.session.user.username;
  const own = await db.collection('waitlist').where('user','==',username).get();
  if (own.docs.filter(d => !playerSearchIsExpired(d.data(), localISODate(), localMinutes())).length >= 30) return res.status(409).json({error:'WAITLIST_LIMIT'});
  const ref = db.collection('waitlist').doc(`${reservationId}_${playerRequestId(username)}`);
  const result = await db.runTransaction(async tx => {
    const reservation = await tx.get(db.collection('reservations').doc(reservationId));
    const cfg = await tx.get(db.collection('admin').doc('config'));
    if (!reservation.exists) return 'SLOT_FREE';
    const r = reservation.data();
    if (r.user === username) return 'OWN_RESERVATION';
    if (playerSearchIsExpired(r,localISODate(),localMinutes())) return 'PAST_TIME_NOT_ALLOWED';
    const total = timeToMinutes(r.time) + Number(cfg.data()?.slotMinutes || 45);
    tx.set(ref,{user:username,reservationId,fieldId:r.fieldId,date:r.date,time:r.time,end:`${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`});
    return null;
  });
  if (result) return res.status(409).json({error:result});
  res.json({ok:true});
});
router.delete('/waitlist/:id', requireAuth, async (req,res) => {
  const ref = db.collection('waitlist').doc(req.params.id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().user === req.session.user.username) tx.delete(ref);
  });
  res.json({ok:true});
});
router.get('/admin/operations', requireAdmin, async (req,res) => {
  const [users, reservations, closures] = await Promise.all([
    db.collection('users').get(), db.collection('reservations').get(), db.collection('admin').doc('closures').get()
  ]);
  const counts = {};
  const active = reservations.docs.map(d=>d.data()).filter(r=>r.date >= localISODate());
  active.forEach(r=>{counts[r.fieldId]=(counts[r.fieldId] || 0)+1;});
  res.json({users:users.size, credits:users.docs.reduce((n,d)=>n+Number(d.data().credits || 0),0), upcoming:active.length, byField:counts, closures:closures.data()?.items || []});
});
router.post('/admin/closures', requireAdmin, async (req,res) => {
  const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
  const schema = z.object({fieldId:z.string().min(1).max(80),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),start:time,end:time,reason:z.string().trim().min(1).max(120)});
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || parsed.data.start >= parsed.data.end || !validDate(parsed.data.date) || parsed.data.date < localISODate()) return res.status(400).json({error:'BAD_BODY'});
  const value = parsed.data;
  const ref = db.collection('admin').doc('closures');
  const result = await db.runTransaction(async tx => {
    const [snap, fields, cfg, reservations] = await Promise.all([
      tx.get(ref),tx.get(db.collection('admin').doc('fields')),tx.get(db.collection('admin').doc('config')),
      tx.get(db.collection('reservations').where('date','==',value.date))
    ]);
    if (!(fields.data()?.fields || []).some(f=>f.id===value.fieldId)) return 'INVALID_FIELD';
    if (reservations.docs.some(d=>{const r=d.data();return r.fieldId===value.fieldId && r.time < value.end && timeToMinutes(r.time)+Number(r.slotMinutes || cfg.data()?.slotMinutes || 45)>timeToMinutes(value.start);})) return 'EXISTING_RESERVATIONS';
    const items = (snap.data()?.items || []).filter(c=>c.date>=localISODate());
    if (items.length >= 300) return 'CLOSURE_LIMIT';
    items.push({...value,id:db.collection('closureIds').doc().id});
    tx.set(ref,{items});
    return null;
  });
  if (result) return res.status(409).json({error:result});
  res.json({ok:true});
});
router.delete('/admin/closures/:id', requireAdmin, async (req,res) => {
  const ref=db.collection('admin').doc('closures');
  await db.runTransaction(async tx=>{const snap=await tx.get(ref);tx.set(ref,{items:(snap.data()?.items || []).filter(c=>c.id!==req.params.id)});});
  res.json({ok:true});
});


router.get("/admin/reservations", requireAdmin, async (req,res) => {
  await cleanupExpiredReservations();
  const date=String(req.query.date || localISODate());
  if (!validDate(date)) return res.status(400).json({error:"BAD_DATE"});
  const [active,history]=await Promise.all([db.collection("reservations").where("date","==",date).get(),db.collection("reservationHistory").where("date","==",date).get()]);
  const items=[...active.docs.map(d=>({id:d.id,...d.data(),status:"active"})),...history.docs.map(d=>({id:d.id,...d.data()}))];
  const cfg=await db.collection("admin").doc("config").get();
  for(const item of items){const end=timeToMinutes(item.time)+Number(item.slotMinutes || cfg.data()?.slotMinutes || 45);item.endTime=String(Math.floor(end/60)).padStart(2,'0')+':'+String(end%60).padStart(2,'0');}
  items.sort((a,b)=>a.time.localeCompare(b.time)||a.fieldId.localeCompare(b.fieldId));
  res.json({items,date});
});
router.post("/admin/users", requireAdmin, async (req,res) => {
  const parsed=z.object({username:z.string().regex(/^[a-zA-Z0-9._-]{3,40}$/),password:z.string().min(12).max(72).refine(value => Buffer.byteLength(value,"utf8") <= 72),credits:z.number().int().min(0).max(100000)}).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:"BAD_BODY"});
  const {username,password,credits}=parsed.data;
  const passwordHash=await bcrypt.hash(password,12);
  const ref=db.collection("users").doc(username);
  const created=await db.runTransaction(async tx=>{
    if ((await tx.get(ref)).exists) return false;
    tx.set(ref,{passwordHash,credits,role:"user",disabled:false,sessionVersion:0});
    if(credits) tx.set(db.collection("creditLedger").doc(),{user:username,delta:credits,reason:"Crediti iniziali",actor:req.session.user.username,createdAt:FieldValue.serverTimestamp()});
    return true;
  });
  if(!created)return res.status(409).json({error:"USERNAME_TAKEN"});
  res.status(201).json({ok:true});
});

export default router;
