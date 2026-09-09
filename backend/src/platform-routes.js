import express from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { db as root, FieldValue } from "./db.js";
import { requirePlatformAdmin, readEstablishment } from "./authorization.js";

const router = express.Router();
const establishmentId = /^(?=.{1,60}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const establishmentName = z.string().trim().min(1).max(80);
const managerUsername = z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._@-]*$/);
const managerPassword = z.string().min(12).refine(value => Buffer.byteLength(value, "utf8") <= 72);

const createSchema = z.object({
  id: z.string().regex(establishmentId),
  name: establishmentName,
  managerUsername,
  managerPassword
}).strict();
const updateSchema = z.object({
  name: establishmentName.optional(),
  enabled: z.boolean().optional()
}).strict().refine(value => Object.keys(value).length > 0);

const wrap = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
const register = (method, path, ...handlers) => router[method](path, ...handlers.map(wrap));

const contextSchema = z.object({ establishmentId: z.string().regex(establishmentId) }).strict();

register("get", "/context", requirePlatformAdmin, async (req, res) => {
  const establishment = await readEstablishment(req.session.managementEstablishment || "tommi38");
  if (!establishment) return res.status(404).json({ error: "ESTABLISHMENT_NOT_FOUND" });
  res.json({ establishment, managementMode: !!req.session.managementEstablishment });
});

register("post", "/context", requirePlatformAdmin, async (req, res) => {
  const parsed = contextSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });
  const establishment = await readEstablishment(parsed.data.establishmentId);
  if (!establishment) return res.status(404).json({ error: "ESTABLISHMENT_NOT_FOUND" });
  // Keep the signed-in identity intact. This is an explicit administrative view.
  req.session.managementEstablishment = establishment.id;
  res.json({ establishment, managementMode: true });
});

register("delete", "/context", requirePlatformAdmin, async (req, res) => {
  delete req.session.managementEstablishment;
  res.json({ establishment: await readEstablishment("tommi38"), managementMode: false });
});

function establishmentSummary(id, value, managers = []) {
  return {
    id,
    name: String(value.name || (id === "tommi38" ? "Tommi38" : id)).slice(0, 80),
    enabled: id === "tommi38" || value.enabled === true,
    legacy: id === "tommi38",
    managers
  };
}

async function managerSummaries(id) {
  const users = id === "tommi38" ? root.collection("users")
    : root.collection("establishments").doc(id).collection("users");
  const snap = await users.where("role", "==", "admin").get();
  return snap.docs.map(doc => ({ username: doc.id, disabled: !!doc.data().disabled }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

register("get", "/establishments", requirePlatformAdmin, async (req, res) => {
  const snap = await root.collection("establishments").get();
  const metadata = new Map([["tommi38", {}]]);
  for (const doc of snap.docs) {
    if (establishmentId.test(doc.id)) metadata.set(doc.id, doc.data());
  }
  const items = await Promise.all([...metadata].map(async ([id, value]) =>
    establishmentSummary(id, value, await managerSummaries(id))));
  items.sort((a, b) => a.id === "tommi38" ? -1 : b.id === "tommi38" ? 1 : a.name.localeCompare(b.name));
  res.json({ items });
});

register("post", "/establishments", requirePlatformAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });
  const { id, name, managerUsername: username, managerPassword: password } = parsed.data;
  if (id === "tommi38") return res.status(409).json({ error: "ESTABLISHMENT_EXISTS" });

  const ref = root.collection("establishments").doc(id);
  const userRef = ref.collection("users").doc(username);
  const configRef = ref.collection("admin").doc("config");
  const fieldsRef = ref.collection("admin").doc("fields");
  // Firestore can retain subcollections after a parent document was removed.
  // Never claim such a namespace, even if the metadata document is absent.
  if ((await ref.listCollections()).length) {
    return res.status(409).json({ error: "ESTABLISHMENT_EXISTS" });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const created = await root.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    if (existing.exists) return false;
    const createdAt = FieldValue.serverTimestamp();
    transaction.create(ref, { name, enabled: true, createdAt, createdBy: req.session.user.username });
    transaction.create(userRef, {
      passwordHash, role: "admin", platformAdmin: false, credits: 0, disabled: false,
      createdAt, createdBy: req.session.user.username
    });
    transaction.create(configRef, {
      slotMinutes: 45, dayStart: "09:00", dayEnd: "20:00",
      maxBookingsPerUserPerDay: 1, maxActiveBookingsPerUser: 1
    });
    transaction.create(fieldsRef, { fields: [] });
    return true;
  });
  if (!created) return res.status(409).json({ error: "ESTABLISHMENT_EXISTS" });
  res.status(201).json({
    ok: true,
    establishment: establishmentSummary(id, { name, enabled: true }, [{ username, disabled: false }])
  });
});

register("patch", "/establishments/:id", requirePlatformAdmin, async (req, res) => {
  const id = req.params.id;
  if (!establishmentId.test(id)) return res.status(400).json({ error: "INVALID_ESTABLISHMENT" });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "BAD_BODY" });
  if (id === "tommi38" && parsed.data.enabled === false) {
    return res.status(400).json({ error: "LEGACY_ESTABLISHMENT_REQUIRED" });
  }
  const ref = root.collection("establishments").doc(id);
  const value = await root.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    if (!snap.exists && id !== "tommi38") return null;
    const updated = {
      ...(snap.exists ? snap.data() : { name: "Tommi38", enabled: true }),
      ...parsed.data,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.session.user.username
    };
    transaction.set(ref, updated);
    return updated;
  });
  if (!value) return res.status(404).json({ error: "ESTABLISHMENT_NOT_FOUND" });
  res.json({ ok: true, establishment: establishmentSummary(id, value, await managerSummaries(id)) });
});

export default router;
