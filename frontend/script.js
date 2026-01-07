/* ================= CONFIG ================= */
const API = "/api";
const qs = id => document.getElementById(id);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

/* ================= CSRF ================= */
let CSRF_TOKEN = null;

async function loadCsrf() {
  const r = await fetch(API + "/csrf", { credentials: "include" });
  if (!r.ok) throw new Error("CSRF fetch failed");
  const j = await r.json();
  CSRF_TOKEN = j.csrfToken;
}

/* ================= API WRAPPER ================= */
async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (CSRF_TOKEN && options.method && options.method !== "GET") {
    headers["X-CSRF-Token"] = CSRF_TOKEN;
  }

  const r = await fetch(API + path, {
    credentials: "include",
    headers,
    ...options
  });

  // CSRF scaduto / sessione rigenerata
  if (r.status === 403) {
    await loadCsrf();
    return api(path, options);
  }

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw j;
  return j;
}

/* ================= STATE ================= */
let STATE = {
  me: null,
  config: {},
  fields: [],
  fieldsDraft: [],
  notes: "",
  users: [],
  reservations: [],
  dayReservationsAll: [],
  gallery: [],
  galleryDraft: []
};

let AUTO_REFRESH_TIMER = null;

/* ================= AUTO REFRESH ================= */
function startAutoRefresh() {
  stopAutoRefresh();
  AUTO_REFRESH_TIMER = setInterval(async () => {
    try {
      await loadReservations();
      if (STATE.me?.role === "user") {
        await refreshCredits();
      }
    } catch (e) {
      console.warn("Auto-refresh fallito", e);
    }
  }, 5_000);
}

function stopAutoRefresh() {
  if (AUTO_REFRESH_TIMER) clearInterval(AUTO_REFRESH_TIMER);
  AUTO_REFRESH_TIMER = null;
}

/* ================= DATE / TIME ================= */
function localISODate(d = new Date()) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function minutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function timeStr(m) {
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" +
         String(m % 60).padStart(2, "0");
}

/* ================= AUTH ================= */
async function login() {
  try {
    await api("/login", {
      method: "POST",
      body: JSON.stringify({
        username: qs("username").value.trim(),
        password: qs("password").value.trim()
      })
    });

    // 🔐 ricarica CSRF dopo login (nuova sessione)
    await loadCsrf();

    await loadAll(true);
  } catch {
    qs("loginErr").textContent = "Login fallito";
    show(qs("loginErr"));
  }
}

async function logout() {
  try {
    await api("/logout", { method: "POST" });
  } finally {
    location.reload();
  }
}

/* ================= LOAD BASE ================= */
async function loadAll(setDateToday = false) {
  STATE.me = await api("/me");
  const pub = await api("/public/config");

  STATE.config = pub;
  STATE.fields = pub.fields || [];
  STATE.fieldsDraft = [...STATE.fields];
  STATE.notes = pub.notesText || "";
  STATE.gallery = pub.gallery || [];
  STATE.galleryDraft = [...STATE.gallery];

  hide(qs("loginBox"));
  show(qs("app"));
  show(qs("logoutBtn"));

  qs("welcome").textContent = `Ciao ${STATE.me.username}`;
  qs("creditsBox").textContent = `Crediti: ${STATE.me.credits}`;
  qs("roleBadge").textContent = STATE.me.role;
  qs("notesView").textContent = STATE.notes || "Nessuna comunicazione.";

  if (setDateToday || !qs("datePick").value) {
    qs("datePick").value = localISODate();
  }

  renderFields();

  if (STATE.me.role === "admin") {
    show(qs("adminMenu"));
    qs("cfgSlotMinutes").value = pub.slotMinutes;
    qs("cfgDayStart").value = pub.dayStart;
    qs("cfgDayEnd").value = pub.dayEnd;
    qs("cfgMaxPerDay").value = pub.maxBookingsPerUserPerDay;
    qs("cfgMaxActive").value = pub.maxActiveBookingsPerUser;
    qs("notesText").value = STATE.notes;
    renderFieldsAdmin();
    renderGalleryAdmin();
    await loadUsers();
  }

  await loadReservations();
}

/* ================= RESERVATIONS ================= */
async function loadReservations() {
  const date = qs("datePick").value;
  const res = await api(`/reservations?date=${date}`);

  STATE.dayReservationsAll = res.items || [];
  STATE.reservations =
    STATE.me.role === "admin"
      ? STATE.dayReservationsAll
      : STATE.dayReservationsAll.filter(r => r.user === STATE.me.username);

  renderTimeSelect();
  renderReservations();
}

async function book() {
  const fieldId = qs("fieldSelect").value;
  const date = qs("datePick").value;
  const time = qs("timeSelect").value;

  qs("bookBtn").disabled = true;
  qs("bookBtn").textContent = "Salvataggio…";

  try {
    await api("/reservations", {
      method: "POST",
      body: JSON.stringify({ fieldId, date, time })
    });

    qs("bookMsg").textContent = "Prenotazione effettuata ✅";
    await refreshCredits();
    await loadReservations();
  } catch (e) {
    qs("bookMsg").textContent =
      e?.error === "ACTIVE_BOOKING_LIMIT"
        ? "Hai già una prenotazione attiva"
        : "Errore prenotazione";
  }

  qs("bookBtn").disabled = false;
  qs("bookBtn").textContent = "Prenota";
}

async function deleteReservation(id) {
  if (!confirm("Cancellare la prenotazione?")) return;

  try {
    await api(`/reservations/${id}`, { method: "DELETE" });
    await refreshCredits();
    await loadReservations();
  } catch {
    await loadReservations();
  }
}

function renderReservations() {
  const list = qs("reservationsList");
  list.innerHTML = "";

  if (STATE.reservations.length === 0) {
    list.textContent = "Nessuna prenotazione.";
    return;
  }

  STATE.reservations.forEach(r => {
    const d = document.createElement("div");
    d.className = "item";

    d.textContent =
      STATE.me.role === "admin"
        ? `${r.time} – ${r.fieldId} – 👤 ${r.user}`
        : `${r.time} – ${r.fieldId}`;

    if (STATE.me.role === "admin" || r.user === STATE.me.username) {
      const b = document.createElement("button");
      b.className = "btn-ghost";
      b.textContent = "❌ Cancella";
      b.onclick = () => deleteReservation(r.id);
      d.appendChild(b);
    }

    list.appendChild(d);
  });
}

/* ================= CREDITI ================= */
async function refreshCredits() {
  const me = await api("/me");
  STATE.me.credits = me.credits;
  qs("creditsBox").textContent = `Crediti: ${me.credits}`;
}

/* ================= FIELDS ================= */
function renderFields() {
  const s = qs("fieldSelect");
  s.innerHTML = "";
  STATE.fields.forEach(f => {
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = f.name;
    s.appendChild(o);
  });
}

function renderFieldsAdmin() {
  const l = qs("fieldsList");
  l.innerHTML = "";
  STATE.fieldsDraft.forEach((f, i) => {
    const d = document.createElement("div");
    d.className = "item";
    d.textContent = `${f.id} – ${f.name}`;

    const b = document.createElement("button");
    b.className = "btn-ghost";
    b.textContent = "🗑️";
    b.onclick = () => {
      STATE.fieldsDraft.splice(i, 1);
      renderFieldsAdmin();
    };

    d.appendChild(b);
    l.appendChild(d);
  });
}

/* ================= USERS ================= */
async function loadUsers() {
  const r = await api("/admin/users");
  STATE.users = r.items;
  const l = qs("usersList");
  l.innerHTML = "";

  STATE.users.forEach(u => {
    const d = document.createElement("div");
    d.className = "item";
    d.textContent = `${u.username} – crediti ${u.credits}`;
    l.appendChild(d);
  });
}

/* ================= ADMIN NAV ================= */
function openAdmin(id) {
  ["adminMenu","adminConfig","adminNotes","adminFields","adminUsers","adminGallery"]
    .forEach(s => hide(qs(s)));
  show(qs(id));
}

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", async () => {
  qs("loginBtn").onclick = login;
  qs("logoutBtn").onclick = logout;
  qs("bookBtn").onclick = book;

  qs("datePick").onchange = loadReservations;
  qs("fieldSelect").onchange = renderTimeSelect;

  qs("btnAdminConfig").onclick = () => openAdmin("adminConfig");
  qs("btnAdminNotes").onclick = () => openAdmin("adminNotes");
  qs("btnAdminFields").onclick = () => openAdmin("adminFields");
  qs("btnAdminUsers").onclick = () => openAdmin("adminUsers");
  qs("btnAdminGallery").onclick = () => openAdmin("adminGallery");

  document.querySelectorAll(".backAdmin")
    .forEach(b => b.onclick = () => openAdmin("adminMenu"));

  // 🔐 carica CSRF appena parte l’app
  await loadCsrf();

  loadAll(true)
    .then(startAutoRefresh)
    .catch(() => {});
});
