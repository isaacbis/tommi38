const API = "/api";
const qs = id => document.getElementById(id);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

let STATE = {
  me: null,
  fields: [],
  fieldsDraft: [],
  notes: "",
  // prenotazioni del giorno (TUTTE, serve per "occupato")
  dayReservationsAll: [],
  // prenotazioni visibili (filtrate per user se non admin)
  reservations: [],
  users: [],
  config: {}
};

/* ===== DATE/ORARI (LOCALE, NON UTC) ===== */
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

/* ===== API ===== */
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

/* ===== AUTH ===== */
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

/* ===== UI ADMIN NAV ===== */
function openAdmin(sectionId) {
  ["adminMenu","adminConfig","adminNotes","adminFields","adminUsers"]
    .forEach(id => hide(qs(id)));
  show(qs(sectionId));
}

/* ===== LOAD ===== */
async function loadAll({ setDateToToday = false } = {}) {
  STATE.me = await api("/me");
  const pub = await api("/public/config");

  STATE.fields = pub.fields || [];
  STATE.fieldsDraft = [...STATE.fields];
  STATE.notes = pub.notesText || "";
  STATE.config = pub;

  qs("welcome").textContent = `Ciao ${STATE.me.username}`;
  qs("creditsBox").textContent = `Crediti: ${STATE.me.credits}`;
  qs("roleBadge").textContent = STATE.me.role;
  qs("notesView").textContent = STATE.notes || "Nessuna comunicazione.";

  hide(qs("loginBox"));
  show(qs("app"));
  show(qs("logoutBtn"));

  // set data: SOLO al primo login / primo load, non ad ogni refresh
  if (setDateToToday || !qs("datePick").value) {
    qs("datePick").value = localISODate();
  }

  renderFields(); // riempie fieldSelect

  if (STATE.me.role === "admin") {
    show(qs("adminMenu"));
    // popola config admin
    qs("cfgSlotMinutes").value = pub.slotMinutes;
    qs("cfgDayStart").value = pub.dayStart;
    qs("cfgDayEnd").value = pub.dayEnd;
    qs("cfgMaxPerDay").value = pub.maxBookingsPerUserPerDay;
    qs("cfgMaxActive").value = pub.maxActiveBookingsPerUser;

    // per admin, di default mostra il menu (non lascia tutto nascosto)
    openAdmin("adminMenu");

    await loadUsers();
    renderFieldsAdmin();
    qs("notesText").value = STATE.notes;
  }

  await loadReservations();
}

/* ===== RESERVATIONS ===== */
async function loadReservations() {
  const date = qs("datePick").value || localISODate();
  const res = await api(`/reservations?date=${date}`);

  STATE.dayReservationsAll = res.items || [];

  STATE.reservations = (STATE.me.role === "admin")
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

  const isToday = (qs("datePick").value === localISODate());
  const taken = new Set(
    // IMPORTANT: "occupato" dipende da TUTTE le prenotazioni del giorno
    STATE.dayReservationsAll.filter(r => r.fieldId === field).map(r => r.time)
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
    await refreshAfterAction();
  } catch (e) {
    qs("bookMsg").textContent =
      e?.error === "ACTIVE_BOOKING_LIMIT"
        ? "❌ Hai già una prenotazione attiva (deve finire prima di poterne fare un'altra)."
        : e?.error === "SLOT_TAKEN"
          ? "❌ Slot già occupato."
          : "Errore prenotazione ❌";
  }
}

async function deleteReservation(id) {
  if (!confirm("Cancellare la prenotazione?")) return;
  await api(`/reservations/${id}`, { method: "DELETE" });
  await refreshAfterAction();
}

// evita che loadAll resetti la data
async function refreshAfterAction() {
  // aggiorna crediti e note/config/fields senza toccare datePick
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

    const label =
      `${r.time} – ${r.fieldId}` + (STATE.me.role === "admin" ? ` – ${r.user}` : "");
    const info = document.createElement("div");
    info.textContent = label;

    d.appendChild(info);

    const canDelete = (STATE.me.role === "admin") || (r.user === STATE.me.username);
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

/* ===== FIELDS ===== */
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
  const list = qs("fieldsList");
  if (!list) return;
  list.innerHTML = "";
  STATE.fieldsDraft.forEach((f, idx) => {
    const row = document.createElement("div");
    row.className = "item";
    row.textContent = `${f.id} – ${f.name}`;

    const del = document.createElement("button");
    del.className = "btn-ghost";
    del.textContent = "🗑️ Rimuovi";
    del.onclick = () => {
      STATE.fieldsDraft.splice(idx, 1);
      renderFieldsAdmin();
    };

    row.appendChild(del);
    list.appendChild(row);
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
  try {
    await api("/admin/fields", {
      method: "PUT",
      body: JSON.stringify({ fields: STATE.fieldsDraft })
    });
    qs("fieldsMsg").textContent = "Campi salvati ✅";
    await loadAll({ setDateToToday: false });
  } catch {
    qs("fieldsMsg").textContent = "Errore salvataggio campi ❌";
  }
}

/* ===== NOTES ===== */
async function saveNotes() {
  try {
    await api("/admin/notes", {
      method: "PUT",
      body: JSON.stringify({ text: qs("notesText").value })
    });
    qs("notesView").textContent = qs("notesText").value || "Nessuna comunicazione.";
  } catch {
    // opzionale: msg
  }
}

/* ===== CONFIG ===== */
async function saveConfig() {
  try {
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
    qs("configMsg").textContent = "Config salvata ✅";
    await loadAll({ setDateToToday: false });
  } catch {
    qs("configMsg").textContent = "Errore salvataggio config ❌";
  }
}

/* ===== USERS (ADMIN) ===== */
async function loadUsers() {
  const r = await api("/admin/users");
  STATE.users = r.items || [];

  const l = qs("usersList");
  l.innerHTML = "";

  STATE.users.forEach(u => {
    const row = document.createElement("div");
    row.className = "item";

    const info = document.createElement("div");
    info.textContent = `${u.username} – crediti ${u.credits}` + (u.disabled ? " (DISABILITATO)" : "");
    row.appendChild(info);

    const edit = document.createElement("button");
    edit.className = "btn-ghost";
    edit.textContent = "✏️ Crediti";
    edit.onclick = async () => {
      const v = prompt("Crediti per " + u.username, String(u.credits));
      if (v === null) return;
      const newCredits = Number(v);
      if (Number.isNaN(newCredits) || newCredits < 0) return;

      await api("/admin/users/credits", {
        method: "PUT",
        body: JSON.stringify({ username: u.username, delta: newCredits - u.credits })
      });
      await loadUsers();
    };

    const reset = document.createElement("button");
    reset.className = "btn-ghost";
    reset.textContent = "🔑 Reset PW";
    reset.onclick = async () => {
      const p = prompt("Nuova password per " + u.username);
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
      await loadUsers();
    };

    row.appendChild(edit);
    row.appendChild(reset);
    row.appendChild(toggle);

    l.appendChild(row);
  });
}

/* ===== INIT ===== */
document.addEventListener("DOMContentLoaded", () => {
  qs("loginBtn").onclick = login;
  qs("logoutBtn").onclick = logout;
  qs("bookBtn").onclick = book;

  qs("datePick").onchange = loadReservations;
  qs("fieldSelect").onchange = renderTimeSelect;

  // admin nav
  qs("btnAdminConfig").onclick = () => openAdmin("adminConfig");
  qs("btnAdminNotes").onclick = () => openAdmin("adminNotes");
  qs("btnAdminFields").onclick = () => openAdmin("adminFields");
  qs("btnAdminUsers").onclick = () => openAdmin("adminUsers");
  document.querySelectorAll(".backAdmin")
    .forEach(b => b.onclick = () => openAdmin("adminMenu"));

  // admin actions
  qs("saveConfigBtn").onclick = saveConfig;
  qs("saveNotesBtn").onclick = saveNotes;
  qs("addFieldBtn").onclick = addField;
  qs("saveFieldsBtn").onclick = saveFields;

  loadAll({ setDateToToday: true }).catch(() => {});
});
