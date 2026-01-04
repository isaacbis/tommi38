/* ================= CONFIG ================= */
const API = "/api";
const qs = id => document.getElementById(id);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

async function loadPublicLoginGallery() {
  try {
    const pub = await api("/public/config");
    STATE.gallery = pub.gallery || [];
    renderLoginGallery();
  } catch {
    // silenzioso
  }
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

/* ================= API ================= */
async function api(path, options = {}) {
  const r = await fetch(API + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw j;
  return j;
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
    await loadAll({ setDateToToday: true });
  } catch {
    qs("loginErr").textContent = "Login fallito";
    show(qs("loginErr"));
  }
}
async function logout() {
  await api("/logout", { method: "POST" });
  location.reload();
}

/* ================= LOAD ================= */
async function loadAll({ setDateToToday = false } = {}) {
  STATE.me = await api("/me");
  const pub = await api("/public/config");

  STATE.config = pub;
  STATE.fields = pub.fields || [];
  STATE.fieldsDraft = [...STATE.fields];
  STATE.notes = pub.notesText || "";
  STATE.gallery = pub.gallery || [];
  STATE.galleryDraft = [...STATE.gallery];

  qs("welcome").textContent = `Ciao ${STATE.me.username}`;
  qs("creditsBox").textContent = `Crediti: ${STATE.me.credits}`;
  qs("roleBadge").textContent = STATE.me.role;
  qs("notesView").textContent = STATE.notes || "Nessuna comunicazione.";

  hide(qs("loginBox"));
  show(qs("app"));
  show(qs("logoutBtn"));

  if (setDateToToday || !qs("datePick").value) {
    qs("datePick").value = localISODate();
  }

  renderLoginGallery();
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
  const date = qs("datePick").value || localISODate();
  const res = await api(`/reservations?date=${date}`);

  STATE.dayReservationsAll = res.items || [];
  STATE.reservations =
    STATE.me.role === "admin"
      ? STATE.dayReservationsAll
      : STATE.dayReservationsAll.filter(r => r.user === STATE.me.username);

  renderTimeSelect();
  renderReservations();
}

function renderTimeSelect() {
  const sel = qs("timeSelect");
  sel.innerHTML = "";

  const slot = STATE.config.slotMinutes || 45;
  const start = minutes(STATE.config.dayStart || "09:00");
  const end = minutes(STATE.config.dayEnd || "20:00");
  const field = qs("fieldSelect").value;
  const isToday = qs("datePick").value === localISODate();

  const taken = new Set(
    STATE.dayReservationsAll
      .filter(r => r.fieldId === field)
      .map(r => r.time)
  );

  for (let m = start; m + slot <= end; m += slot) {
    const t = timeStr(m);
    const o = document.createElement("option");
    o.value = t;

    if (isToday && m <= nowMinutes()) {
      o.textContent = `${t} ⏰ Terminato`;
      o.disabled = true;
    } else if (taken.has(t)) {
      o.textContent = `${t} ❌ Occupato`;
      o.disabled = true;
    } else {
      o.textContent = `${t} ✅ Libero`;
    }

    sel.appendChild(o);
  }
}

async function book() {
  try {
    await api("/reservations", {
      method: "POST",
      body: JSON.stringify({
        fieldId: qs("fieldSelect").value,
        date: qs("datePick").value,
        time: qs("timeSelect").value
      })
    });
    qs("bookMsg").textContent = "Prenotazione effettuata ✅";
    await loadAll({ setDateToToday: false });
  } catch (e) {
    qs("bookMsg").textContent =
      e?.error === "ACTIVE_BOOKING_LIMIT"
        ? "Hai già una prenotazione attiva"
        : "Errore prenotazione";
  }
}

async function deleteReservation(id) {
  if (!confirm("Cancellare la prenotazione?")) return;
  await api(`/reservations/${id}`, { method: "DELETE" });
  await loadAll({ setDateToToday: false });
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
      `${r.time} – ${r.fieldId}` +
      (STATE.me.role === "admin" ? ` – ${r.user}` : "");

    const canDelete =
      STATE.me.role === "admin" || r.user === STATE.me.username;

    if (canDelete) {
      const b = document.createElement("button");
      b.className = "btn-ghost";
      b.textContent = "❌ Cancella";
      b.onclick = () => deleteReservation(r.id);
      d.appendChild(b);
    }
    list.appendChild(d);
  });
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
async function addField() {
  const id = qs("newFieldId").value.trim();
  const name = qs("newFieldName").value.trim();
  if (!id || !name) return;
  STATE.fieldsDraft.push({ id, name });
  qs("newFieldId").value = "";
  qs("newFieldName").value = "";
  renderFieldsAdmin();
}
async function saveFields() {
  await api("/admin/fields", {
    method: "PUT",
    body: JSON.stringify({ fields: STATE.fieldsDraft })
  });
  await loadAll({ setDateToToday: false });
}

/* ================= NOTES ================= */
async function saveNotes() {
  await api("/admin/notes", {
    method: "PUT",
    body: JSON.stringify({ text: qs("notesText").value })
  });
  await loadAll({ setDateToToday: false });
}

/* ================= CONFIG ================= */
async function saveConfig() {
  await api("/admin/config", {
    method: "PUT",
    body: JSON.stringify({
      slotMinutes: Number(qs("cfgSlotMinutes").value),
      dayStart: qs("cfgDayStart").value,
      dayEnd: qs("cfgDayEnd").value,
      maxBookingsPerUserPerDay: Number(qs("cfgMaxPerDay").value),
      maxActiveBookingsPerUser: Number(qs("cfgMaxActive").value)
    })
  });
  await loadAll({ setDateToToday: false });
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

    const edit = document.createElement("button");
    edit.className = "btn-ghost";
    edit.textContent = "✏️ Crediti";
    edit.onclick = async () => {
      const v = prompt("Crediti:", u.credits);
      if (v === null) return;
      await api("/admin/users/credits", {
        method: "PUT",
        body: JSON.stringify({ username: u.username, delta: v - u.credits })
      });
      loadUsers();
    };

    const reset = document.createElement("button");
    reset.className = "btn-ghost";
    reset.textContent = "🔑 Reset PW";
    reset.onclick = async () => {
      const p = prompt("Nuova password");
      if (!p) return;
      await api("/admin/users/password", {
        method: "PUT",
        body: JSON.stringify({ username: u.username, newPassword: p })
      });
    };

    const toggle = document.createElement("button");
    toggle.className = "btn-ghost";
    toggle.textContent = u.disabled ? "✅ Abilita" : "⛔ Disabilita";
    toggle.onclick = async () => {
      await api("/admin/users/status", {
        method: "PUT",
        body: JSON.stringify({ username: u.username, disabled: !u.disabled })
      });
      loadUsers();
    };

    d.appendChild(edit);
    d.appendChild(reset);
    d.appendChild(toggle);
    l.appendChild(d);
  });
}

/* ================= GALLERY ================= */
function renderLoginGallery() {
  const box = qs("loginGallery");
  box.innerHTML = "";
  STATE.gallery.forEach(g => {
    const w = document.createElement("div");
    w.className = "login-gallery-item";

    const i = document.createElement("img");
    i.src = g.url;
    i.loading = "lazy";

    const c = document.createElement("div");
    c.className = "login-gallery-caption";
    c.textContent = g.caption || "";

    w.appendChild(i);
    w.appendChild(c);
    box.appendChild(w);
  });
}
function renderGalleryAdmin() {
  const l = qs("galleryList");
  l.innerHTML = "";
  STATE.galleryDraft.forEach((g, i) => {
    const d = document.createElement("div");
    d.className = "item";
    d.textContent = g.caption || g.url;

    const b = document.createElement("button");
    b.className = "btn-ghost";
    b.textContent = "🗑️";
    b.onclick = () => {
      STATE.galleryDraft.splice(i, 1);
      renderGalleryAdmin();
    };

    d.appendChild(b);
    l.appendChild(d);
  });
}
function addGalleryItem() {
  if (STATE.galleryDraft.length >= 10) return alert("Max 10 immagini");
  const url = qs("galleryUrl").value.trim();
  const cap = qs("galleryCaption").value.trim();
  if (!url) return;
  STATE.galleryDraft.push({ url, caption: cap });
  qs("galleryUrl").value = "";
  qs("galleryCaption").value = "";
  renderGalleryAdmin();
}
async function saveGallery() {
  await api("/admin/gallery", {
    method: "PUT",
    body: JSON.stringify({ images: STATE.galleryDraft })
  });
  await loadAll({ setDateToToday: false });
}

/* ================= ADMIN NAV ================= */
function openAdmin(id) {
  ["adminMenu","adminConfig","adminNotes","adminFields","adminUsers","adminGallery"]
    .forEach(s => hide(qs(s)));
  show(qs(id));
}

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {
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

  qs("saveConfigBtn").onclick = saveConfig;
  qs("saveNotesBtn").onclick = saveNotes;
  qs("addFieldBtn").onclick = addField;
  qs("saveFieldsBtn").onclick = saveFields;
  qs("addGalleryBtn").onclick = addGalleryItem;
  qs("saveGalleryBtn").onclick = saveGallery;

  loadPublicLoginGallery();
loadAll({ setDateToToday: true }).catch(() => {});

});
