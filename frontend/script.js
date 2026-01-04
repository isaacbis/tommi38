const API = "/api";
const qs = id => document.getElementById(id);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

let STATE = {
  me: null,
  fields: [],
  fieldsDraft: [],
  notes: "",
  reservations: [],
  users: [],
  config: {}
};

/* ================== UTILS ================== */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

/* ================== API ================== */
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

/* ================== AUTH ================== */
async function login() {
  try {
    await api("/login", {
      method: "POST",
      body: JSON.stringify({
        username: qs("username").value.trim(),
        password: qs("password").value.trim()
      })
    });
    await loadAll();
  } catch {
    qs("loginErr").textContent = "Login fallito";
    show(qs("loginErr"));
  }
}
async function logout() {
  await api("/logout", { method: "POST" });
  location.reload();
}

/* ================== LOAD ================== */
async function loadAll() {
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

  if (STATE.me.role === "admin") {
    show(qs("adminMenu"));
    qs("cfgSlotMinutes").value = pub.slotMinutes;
    qs("cfgDayStart").value = pub.dayStart;
    qs("cfgDayEnd").value = pub.dayEnd;
    qs("cfgMaxPerDay").value = pub.maxBookingsPerUserPerDay;
    await loadUsers();
  }

  renderFields();
  qs("datePick").value = todayISO();
  await loadReservations();
}

/* ================== PRENOTAZIONI ================== */
async function loadReservations() {
  const date = qs("datePick").value;
  const res = await api(`/reservations?date=${date}`);
  STATE.reservations = STATE.me.role === "admin"
    ? res.items
    : res.items.filter(r => r.user === STATE.me.username);

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
  const isToday = qs("datePick").value === todayISO();

  const taken = new Set(
    STATE.reservations.filter(r => r.fieldId === field).map(r => r.time)
  );

  for (let m = start; m + slot <= end; m += slot) {
    const t = timeStr(m);
    const opt = document.createElement("option");
    opt.value = t;

    if (isToday && m <= nowMinutes()) {
      opt.textContent = `${t} ⏰ Terminato`;
      opt.disabled = true;
    } else if (taken.has(t)) {
      opt.textContent = `${t} ❌ Occupato`;
      opt.disabled = true;
    } else {
      opt.textContent = `${t} ✅ Libero`;
    }
    sel.appendChild(opt);
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
    await loadReservations();
    await loadAll();
  } catch {
    qs("bookMsg").textContent = "Errore prenotazione ❌";
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
      `${r.time} – ${r.fieldId}` +
      (STATE.me.role === "admin" ? ` – ${r.user}` : "");

    const canDelete =
      STATE.me.role === "admin" ||
      r.user === STATE.me.username;

    if (canDelete) {
      const btn = document.createElement("button");
      btn.className = "btn-ghost";
      btn.textContent = "❌ Cancella";
      btn.onclick = async () => {
        if (!confirm("Vuoi cancellare la prenotazione?")) return;
        await api(`/reservations/${r.id}`, { method: "DELETE" });
        await loadReservations();
        await loadAll();
      };
      d.appendChild(btn);
    }
    list.appendChild(d);
  });
}

/* ================== CAMPI ================== */
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
async function saveFields() {
  await api("/admin/fields", {
    method: "PUT",
    body: JSON.stringify({ fields: STATE.fieldsDraft })
  });
}

/* ================== NOTE ================== */
async function saveNotes() {
  await api("/admin/notes", {
    method: "PUT",
    body: JSON.stringify({ text: qs("notesText").value })
  });
}

/* ================== CONFIG ================== */
async function saveConfig() {
  try {
    await api("/admin/config", {
      method: "PUT",
      body: JSON.stringify({
        slotMinutes: Number(qs("cfgSlotMinutes").value),
        dayStart: qs("cfgDayStart").value,
        dayEnd: qs("cfgDayEnd").value,
        maxBookingsPerUserPerDay: Number(qs("cfgMaxPerDay").value)
      })
    });
    STATE.config = await api("/public/config");
    renderTimeSelect();
    qs("configMsg").textContent = "Configurazione salvata ✅";
  } catch {
    qs("configMsg").textContent = "Errore salvataggio ❌";
  }
}

/* ================== UTENTI ================== */
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
    edit.textContent = "✏️ Crediti";
    edit.className = "btn-ghost";
    edit.onclick = () => setCredits(u);

    const reset = document.createElement("button");
    reset.textContent = "Reset PW";
    reset.className = "btn-ghost";
    reset.onclick = () => resetPw(u.username);

    const toggle = document.createElement("button");
    toggle.textContent = u.disabled ? "Abilita" : "Disabilita";
    toggle.className = "btn-ghost";
    toggle.onclick = () => toggleUser(u);

    d.append(edit, reset, toggle);
    l.appendChild(d);
  });
}
async function setCredits(u) {
  const v = prompt("Crediti per " + u.username, u.credits);
  if (v === null) return;
  await api("/admin/users/credits", {
    method: "PUT",
    body: JSON.stringify({
      username: u.username,
      delta: Number(v) - u.credits
    })
  });
  loadUsers();
}
async function resetPw(username) {
  const p = prompt("Nuova password");
  if (!p) return;
  await api("/admin/users/password", {
    method: "PUT",
    body: JSON.stringify({ username, newPassword: p })
  });
}
async function toggleUser(u) {
  await api("/admin/users/status", {
    method: "PUT",
    body: JSON.stringify({
      username: u.username,
      disabled: !u.disabled
    })
  });
  loadUsers();
}

/* ================== ADMIN NAV ================== */
function openAdmin(section) {
  ["adminMenu","adminConfig","adminNotes","adminFields","adminUsers"]
    .forEach(id => hide(qs(id)));
  show(qs(section));
}

/* ================== INIT ================== */
document.addEventListener("DOMContentLoaded", () => {
  qs("loginBtn").onclick = login;
  qs("logoutBtn").onclick = logout;
  qs("bookBtn").onclick = book;

  let dateTimer;
  qs("datePick").onchange = () => {
    clearTimeout(dateTimer);
    dateTimer = setTimeout(loadReservations, 120);
  };

  qs("fieldSelect").onchange = renderTimeSelect;

  qs("btnAdminConfig").onclick = () => openAdmin("adminConfig");
  qs("btnAdminNotes").onclick = () => openAdmin("adminNotes");
  qs("btnAdminFields").onclick = () => openAdmin("adminFields");
  qs("btnAdminUsers").onclick = () => openAdmin("adminUsers");
  document.querySelectorAll(".backAdmin")
    .forEach(b => b.onclick = () => openAdmin("adminMenu"));

  qs("saveConfigBtn").onclick = saveConfig;
  qs("saveNotesBtn").onclick = saveNotes;
  qs("saveFieldsBtn").onclick = saveFields;

  loadAll().catch(() => {});
});
