import session from "express-session";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

// This store always receives the root database, never the tenant-scoped wrapper.
// Tokens are hashed in document IDs; session contents and expiry are authenticated
// and encrypted with the same stable secret that signs the session cookie.
export class FirestoreSessionStore extends session.Store {
  constructor({ db, secret, now = Date.now, maxAge = SESSION_MAX_AGE_MS }) {
    super();
    if (!db || typeof secret !== "string" || !secret) {
      throw new Error("A database and stable session secret are required");
    }
    this.db = db;
    this.collection = db.collection("_privateSessions");
    this.key = createHash("sha256").update(`tommi38-session-store:${secret}`).digest();
    this.now = now;
    this.maxAge = maxAge;
  }

  reference(sid) {
    return this.collection.doc(createHash("sha256").update(sid).digest("hex"));
  }

  expiry(value) {
    const expires = value.cookie?.expires;
    const parsed = expires ? new Date(expires).getTime() : NaN;
    return Number.isFinite(parsed) ? parsed : this.now() + this.maxAge;
  }

  encode(sid, value, expiresAt) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(sid));
    const payload = Buffer.concat([
      cipher.update(JSON.stringify({ session: value, expiresAt }), "utf8"),
      cipher.final()
    ]);
    return {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      payload: payload.toString("base64"),
      expiresAt: new Date(expiresAt)
    };
  }

  decode(sid, record) {
    try {
      if (record?.version !== 1) return null;
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(record.iv, "base64"));
      decipher.setAAD(Buffer.from(sid));
      decipher.setAuthTag(Buffer.from(record.tag, "base64"));
      const value = JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(record.payload, "base64")), decipher.final()
      ]).toString("utf8"));
      if (!value.session || typeof value.session !== "object" || !Number.isFinite(value.expiresAt)) return null;
      return value;
    } catch {
      // Corrupt or tampered records fail closed without printing any contents.
      return null;
    }
  }

  get(sid, callback) {
    const ref = this.reference(sid);
    this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const value = this.decode(sid, snapshot.data());
      if (!value || value.expiresAt <= this.now()) {
        transaction.delete(ref);
        return null;
      }
      return value.session;
    }).then(value => callback(null, value), callback);
  }

  set(sid, value, callback = () => {}) {
    let record;
    try { record = this.encode(sid, value, this.expiry(value)); }
    catch (error) { callback(error); return; }
    this.reference(sid).set(record).then(() => callback(null), callback);
  }

  destroy(sid, callback = () => {}) {
    this.reference(sid).delete().then(() => callback(null), callback);
  }

  touch(sid, value, callback = () => {}) {
    const ref = this.reference(sid);
    this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const stored = this.decode(sid, snapshot.data());
      if (!stored || stored.expiresAt <= this.now()) {
        transaction.delete(ref);
        return;
      }
      // Preserve concurrently updated authorization data; touch renews only cookie.
      stored.session.cookie = value.cookie;
      transaction.set(ref, this.encode(sid, stored.session, this.expiry(value)));
    }).then(() => callback(null), callback);
  }
}
