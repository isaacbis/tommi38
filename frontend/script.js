/* ================= CONFIG ================= */
const API = "/api";
const qs = id => document.getElementById(id);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

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

function weatherEmoji(code) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code <= 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌦️";
  if (code <= 99) return "⛈️";
  return "❓";
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

/* ================= PUBLIC (LOGIN) ================= */
async function loadPublicLoginGallery() {
  try {
    const pub = await api("/public/config");
    STATE.gallery = pub.gallery || [];
    renderLoginGallery();
  } catch {}
}

async function loadWeather() {
  const box = document.getElementById("weatherBox");
  const row = document.getElementById("weatherRow");

  if (!box || !row) return;

  try {
    // ⚠️ api() restituisce GIÀ il JSON
    const data = await api("/weather");

    row.innerHTML = "";

    for (let i = 0; i < 7; i++) {
      const d = new Date(data.daily.time[i]);
      const day = d.toLocaleDateString("it-IT", { weekday: "short" });

      const el = document.createElement("div");
      el.className = "weather-day";
      el.innerHTML = `
        ${day}
        <span class="weather-emoji">
          ${weatherEmoji(data.daily.weathercode[i])}
        </span>
      `;
      row.appendChild(el);
    }

    // MOSTRA LA CARD
    box.classList.remove("hidden");

  } catch (e) {
    console.error("Errore meteo frontend", e);
  }
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
    await loadAll(true);
  } catch {
    qs("loginErr").textContent = "Login fallito";
    show(qs("loginErr"));
  }
}
async function logout() {
  await api("/logout", { method: "POST" });
  location.reload();
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
  renderLoginGallery();

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

/* ===== PRENOTA (UI OTTIMISTICA) ===== */
async function book() {
  const fieldId = qs("fieldSelect").value;
  const date = qs("datePick").value;
  const time = qs("timeSelect").value;

  qs("bookBtn").disabled = true;
  qs("bookBtn").textContent = "Salvataggio…";

  // UI immediata
  STATE.reservations.push({
    id: "tmp_" + Date.now(),
    fieldId,
    date,
    time,
    user: STATE.me.username
  });
  renderReservations();
  renderTimeSelect();

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
    await loadReservations();
  }

  qs("bookBtn").disabled = false;
  qs("bookBtn").textContent = "Prenota";
}

async function deleteReservation(id) {
  if (!confirm("Cancellare la prenotazione?")) return;

  // UI immediata
  STATE.reservations = STATE.reservations.filter(r => r.id !== id);
  renderReservations();
  renderTimeSelect();

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
      `${r.time} – ${r.fieldId}` +
      (STATE.me.role === "admin" ? ` – ${r.user}` : "");

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
}

/* ================= NOTES ================= */
async function saveNotes() {
  await api("/admin/notes", {
    method: "PUT",
    body: JSON.stringify({ text: qs("notesText").value })
  });
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
      const v = prompt("Nuovi crediti", u.credits);
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
  if (!box) return;

  box.innerHTML = "";
  STATE.gallery.forEach(g => {
    if (!g.url || !g.link) return;

    const wrap = document.createElement("div");
    wrap.className = "login-gallery-item";

    const a = document.createElement("a");
    a.href = g.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("click", e => e.stopPropagation());

    const img = document.createElement("img");
    img.src = g.url;
    img.loading = "lazy";

    a.appendChild(img);
    wrap.appendChild(a);
    box.appendChild(wrap);
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
  const link = qs("galleryLink").value.trim();
  if (!url || !link.startsWith("http")) {
    alert("URL e link devono essere validi");
    return;
  }
  STATE.galleryDraft.push({ url, caption: cap, link });
  qs("galleryUrl").value = "";
  qs("galleryCaption").value = "";
  qs("galleryLink").value = "";
  renderGalleryAdmin();
}
async function saveGallery() {
  await api("/admin/gallery", {
    method: "PUT",
    body: JSON.stringify({ images: STATE.galleryDraft })
  });
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

loadAll(true)
  .then(() => {
    // forza il meteo per gli utenti
    if (STATE.me && STATE.me.role === "user") {
      loadWeather();
    }
  })
  .catch(err => console.error(err));

}); // ⬅️ CHIUSURA DOMContentLoaded (OBBLIGATORIA)
