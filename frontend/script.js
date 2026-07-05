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

let AUTO_REFRESH_TIMER = null;

function startAutoRefresh() {
  stopAutoRefresh();
  AUTO_REFRESH_TIMER = setInterval(async () => {
    try {
      // aggiorna prenotazioni (e quindi timeline, stato, ecc.)
      await loadReservations();

      // aggiorna crediti (solo se user)
      if (STATE.me && STATE.me.role === "user") {
        await refreshCredits();
      }
    } catch (e) {
      // se la sessione è scaduta o il server dorme, non blocchiamo la UI
      console.warn("Auto-refresh fallito", e);
    }
  }, 5_000);
}

function stopAutoRefresh() {
  if (AUTO_REFRESH_TIMER) clearInterval(AUTO_REFRESH_TIMER);
  AUTO_REFRESH_TIMER = null;
}

/* ================= DATE / TIME ================= */
function isPastDate(dateStr) {
  return dateStr < localISODate();
}

function localISODate(d = new Date()) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function isPastTimeToday(dateStr, timeStr) {
  if (dateStr !== localISODate()) return false;
  return minutes(timeStr) <= nowMinutes();
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

// ===== STATO CAMPO =====
function getFieldStatus(fieldId) {
  const now = nowMinutes();
  const slot = STATE.config.slotMinutes || 45;

  const current = STATE.dayReservationsAll.find(r => {
    if (r.fieldId !== fieldId) return false;
    const start = minutes(r.time);
    return now >= start && now < start + slot;
  });

  if (current) return { status: "playing", user: current.user };

  const todayHas = STATE.dayReservationsAll.some(r => r.fieldId === fieldId);
  if (todayHas) return { status: "busy" };

  return { status: "free" };
}

// ===== COUNTDOWN PROSSIMA PARTITA =====
function getNextMatchCountdown(fieldId) {
  const now = nowMinutes();

  const next = STATE.dayReservationsAll
    .filter(r => r.fieldId === fieldId)
    .map(r => minutes(r.time))
    .filter(t => t > now)
    .sort((a, b) => a - b)[0];

  return next ? next - now : null;
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
  const box = qs("weatherBox");
  const row = qs("weatherRow");
  if (!box || !row) return;

  const CACHE_KEY = "weather_cache";
  const CACHE_TTL = 30 * 60 * 1000; // 30 minuti

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    const now = Date.now();

    // ✅ usa cache se valida
    if (cached && now - cached.time < CACHE_TTL) {
      renderWeather(cached.data);
      box.classList.remove("hidden");
      return;
    }

    // 🔄 fetch reale
    const data = await api("/weather");

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ time: now, data })
    );

    renderWeather(data);
    box.classList.remove("hidden");

  } catch (e) {
    console.error("Errore meteo", e);
  }
}

function renderWeather(data) {
  const row = qs("weatherRow");
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
    location.reload(); // 🔁 lascia che sia INIT a fare loadAll
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

// 👇 AGGIUNGI QUESTO
if (STATE.fields.length > 0) {
  qs("fieldSelect").value = STATE.fields[0].id;
}
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

  // ❌ BLOCCO GIORNI PASSATI
  if (isPastDate(date)) {
    qs("bookBtn").disabled = true;
    qs("bookMsg").textContent = "❌ Non puoi prenotare una giornata passata";

    STATE.dayReservationsAll = [];
    STATE.reservations = [];

    renderTimeSelect();
    renderReservations();
    renderFieldInfo();
    return;
  }

  qs("bookBtn").disabled = false;
  qs("bookMsg").textContent = "";

  const res = await api(`/reservations?date=${date}`);

  STATE.dayReservationsAll = res.items || [];
  STATE.reservations =
    STATE.me.role === "admin"
      ? STATE.dayReservationsAll
      : STATE.dayReservationsAll.filter(r => r.user === STATE.me.username);

  renderTimeSelect();
  renderReservations();
  renderFieldInfo();
}

function renderFieldInfo() {
  const fieldId = qs("fieldSelect")?.value;
  if (!fieldId) return;
  const box = qs("fieldInfo");

  if (!box) return;

  const status = getFieldStatus(fieldId);
  const countdown = getNextMatchCountdown(fieldId);

  let statusText = "🟢 Campo libero";
  if (status.status === "playing") statusText = "🟡 Partita in corso";
  if (status.status === "busy") statusText = "🔴 Campo occupato oggi";

  let countdownText = "Nessuna partita prevista";
  if (countdown !== null) {
    countdownText = `⏳ Prossima partita tra ${countdown} min`;
  }

  box.innerHTML = `
  <div class="field-status glow">${statusText}</div>
  <div class="field-countdown">${countdownText}</div>

  <!-- TIMELINE GIORNATA -->
  <div id="timeline" class="timeline"></div>
`;

renderTimeline(fieldId);
}



function renderTimeSelect() {
  const sel = qs("timeSelect");

  // Salva l'orario scelto prima del refresh automatico.
  // Così non torna al primo orario disponibile.
  const previousValue = sel.value;

  sel.innerHTML = "";

  const slot = STATE.config.slotMinutes || 45;
  const start = minutes(STATE.config.dayStart || "09:00");
  const end = minutes(STATE.config.dayEnd || "20:00");
  const field = qs("fieldSelect").value;
  const date = qs("datePick").value;
  const isToday = date === localISODate();

  const taken = new Set(
    STATE.dayReservationsAll
      .filter(r => r.fieldId === field)
      .map(r => r.time)
  );

  for (let m = start; m + slot <= end; m += slot) {
    const t = timeStr(m);
    const o = document.createElement("option");
    o.value = t;

    if (isPastDate(date)) {
      o.textContent = `${t} ⛔ Giorno passato`;
      o.disabled = true;
    } else if (isToday && m <= nowMinutes()) {
      o.textContent = `${t} ⏰ Orario passato`;
      o.disabled = true;
    } else if (taken.has(t)) {
      o.textContent = `${t} ❌ Occupato`;
      o.disabled = true;
    } else {
      o.textContent = `${t} ✅ Libero`;
    }

    sel.appendChild(o);
  }

  // Rimette l'orario scelto prima del refresh, se esiste ancora.
  const previousOption = [...sel.options].find(o => o.value === previousValue);
  if (previousOption) {
    sel.value = previousValue;
    return;
  }

  // Solo se l'orario precedente non esiste più, sceglie il primo disponibile.
  const firstAvailable = [...sel.options].find(o => !o.disabled);
  if (firstAvailable) {
    sel.value = firstAvailable.value;
  }
}

function renderTimeline(fieldId) {
  const slotMinutes = STATE.config.slotMinutes || 45;
  const start = minutes(STATE.config.dayStart);
  const end = minutes(STATE.config.dayEnd);
  const now = nowMinutes();

  const box = qs("timeline");
  if (!box) return;
  box.innerHTML = "";

  const slots = [];

  for (let m = start; m + slotMinutes <= end; m += slotMinutes) {
    const t = timeStr(m);
    const el = document.createElement("div");

    const isBusy = STATE.dayReservationsAll.some(
      r => r.fieldId === fieldId && r.time === t
    );

    el.className = "slot " + (isBusy ? "busy" : "free");
    el.dataset.start = m;

    el.innerHTML = `<div class="slot-time">${t}</div>`;
    box.appendChild(el);
    slots.push(el);
  }

  // === MARKER ORA ===
  const marker = document.createElement("div");
  marker.className = "now-marker";
  box.appendChild(marker);

  // fuori orario → nasconde
  if (now < start || now > end) {
    marker.style.display = "none";
    return;
  }

  // trova lo slot corretto
  const currentIndex = Math.floor((now - start) / slotMinutes);
  const currentSlot = slots[currentIndex];
  if (!currentSlot) {
    marker.style.display = "none";
    return;
  }

  // posiziona la linea sopra lo slot reale
  const slotRect = currentSlot.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();

  marker.style.display = "block";

marker.style.left =
  `${slotRect.left - boxRect.left + slotRect.width / 2}px`;

marker.style.top =
  `${slotRect.top - boxRect.top + (slotRect.height - marker.offsetHeight) / 2}px`;

}

/* ===== PRENOTA (UI OTTIMISTICA) ===== */
async function book() {
  const fieldId = qs("fieldSelect").value;
  const fieldName = qs("fieldSelect").selectedOptions[0]?.textContent || fieldId;
  const date = qs("datePick").value;
  const time = qs("timeSelect").value;
  const selectedTimeOption = qs("timeSelect").selectedOptions[0];

  if (!fieldId || !date || !time) {
    qs("bookMsg").textContent = "❌ Seleziona campo, data e orario";
    return;
  }

  if (isPastDate(date)) {
    qs("bookMsg").textContent = "❌ Non puoi prenotare un giorno passato";
    return;
  }

  if (isPastTimeToday(date, time)) {
    qs("bookMsg").textContent = "❌ Orario già passato";
    return;
  }

  if (selectedTimeOption?.disabled) {
    qs("bookMsg").textContent = "❌ Questo orario non è disponibile";
    return;
  }

  const ok = confirm(
    `Confermi la prenotazione?

Campo: ${fieldName}
Data: ${date}
Orario: ${time}`
  );

  if (!ok) return;

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

    // Dopo la prenotazione resta sull'orario scelto.
    qs("timeSelect").value = time;

  } catch (e) {
    qs("bookMsg").textContent =
      e?.error === "ACTIVE_BOOKING_LIMIT"
        ? "Hai raggiunto il limite di prenotazioni attive"
        : e?.error === "MAX_PER_DAY_LIMIT"
        ? "Hai raggiunto il limite di prenotazioni per questo giorno"
        : e?.error === "SLOT_TAKEN"
        ? "Questo orario è già stato prenotato"
        : "Errore prenotazione";

    await loadReservations();

    // Anche in caso di errore non cambia orario da solo.
    qs("timeSelect").value = time;
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

  // 🔄 ricarica campi aggiornati
  const pub = await api("/public/config");
  STATE.fields = pub.fields || [];
  STATE.fieldsDraft = [...STATE.fields];

  renderFields();
  renderFieldsAdmin();

  alert("Campi aggiornati ✅");
}

/* ================= NOTES ================= */
async function saveNotes() {
  await api("/admin/notes", {
    method: "PUT",
    body: JSON.stringify({ text: qs("notesText").value })
  });

  STATE.notes = qs("notesText").value;
  qs("notesView").textContent = STATE.notes || "Nessuna comunicazione.";

  alert("Note aggiornate ✅");
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

  // 🔄 ricarica config aggiornata
  const pub = await api("/public/config");
  STATE.config = pub;

  // 🔁 aggiorna UI che dipende dagli orari
  renderTimeSelect();
  renderFieldInfo();
  await loadReservations();

  alert("Configurazione aggiornata ✅");
}

/* ================= USERS ================= */

function renderUsers(filter = "") {
  const l = qs("usersList");
  l.innerHTML = "";

  STATE.users
    .filter(u =>
      u.username.toLowerCase().includes(filter.toLowerCase())
    )
    .forEach(u => {
      const d = document.createElement("div");
      d.className = "item";

      d.innerHTML = `
        <strong>${u.username}</strong> – crediti ${u.credits}
        <br>
        <input
          type="text"
          placeholder="Nuovo username"
          class="rename-input"
          style="width:120px;margin-top:4px;"
        >
      `;

      // ✏️ CREDITI
      const edit = document.createElement("button");
      edit.className = "btn-ghost";
      edit.textContent = "✏️ Crediti";
      edit.onclick = async () => {
        const v = prompt("Nuovi crediti", u.credits);
        if (v === null) return;
        await api("/admin/users/credits", {
          method: "PUT",
          body: JSON.stringify({
            username: u.username,
            delta: v - u.credits
          })
        });
        loadUsers();
      };

      // ✏️ RINOMINA
      const rename = document.createElement("button");
      rename.className = "btn-ghost";
      rename.textContent = "✏️ Rinomina";
      rename.onclick = async () => {
        const newUsername = d
          .querySelector(".rename-input")
          .value.trim();

        if (!newUsername) {
          alert("Inserisci il nuovo username");
          return;
        }

        if (!confirm(`Rinominare ${u.username} in ${newUsername}?`)) return;

        await api("/admin/users/rename", {
          method: "POST",
          body: JSON.stringify({
            oldUsername: u.username,
            newUsername
          })
        });

        loadUsers();
      };

      // 🔑 RESET PASSWORD
      const reset = document.createElement("button");
      reset.className = "btn-ghost";
      reset.textContent = "🔑 Reset PW";
      reset.onclick = async () => {
        const newPw = prompt("Nuova password");
if (!newPw) return;

await api("/admin/users/password", {
  method: "PUT",
  body: JSON.stringify({
    username: u.username,
    newPassword: newPw
  })
});

        alert("Password resettata");
      };

      // ⛔ DISABILITA / ABILITA
      const toggle = document.createElement("button");
      toggle.className = "btn-ghost";
      toggle.textContent = u.disabled ? "✅ Abilita" : "⛔ Disabilita";
      toggle.onclick = async () => {
        await api("/admin/users/status", {
  method: "PUT",
  body: JSON.stringify({
    username: u.username,
    disabled: !u.disabled
  })
});

        loadUsers();
      };

      d.appendChild(edit);
      d.appendChild(rename);
      d.appendChild(reset);
      d.appendChild(toggle);

      l.appendChild(d);
    });
}

async function loadUsers() {
  const r = await api("/admin/users");
  STATE.users = r.items;
  renderUsers();
}

const userSearch = qs("userSearch");
if (userSearch) {
  userSearch.addEventListener("input", e => {
    renderUsers(e.target.value);
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
const appLoader = qs("appLoader");

  qs("loginBtn").onclick = login;
  qs("logoutBtn").onclick = logout;
  qs("bookBtn").onclick = book;

  qs("datePick").onchange = loadReservations;
  qs("fieldSelect").onchange = () => {
    renderTimeSelect();
    renderFieldInfo();
  };

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

  // login gallery pubblica
  loadPublicLoginGallery();

  // avvio APP
loadAll(true)
  .then(() => {
    loadWeather();


    startAutoRefresh();
    if (appLoader) {
  appLoader.classList.add("hide");
  setTimeout(() => appLoader.remove(), 450);
}

  })
  .catch(err => {
    console.warn("INIT ERROR (non loggato)", err);

    // 👉 MOSTRA LOGIN, NASCONDE APP E LOADER
    show(qs("loginBox"));
    hide(qs("app"));
    hide(qs("logoutBtn"));
    hide(appLoader);
  });

  // 🔁 KEEP SERVER SVEGLIO (Render free)
  setInterval(() => {
    fetch("/api/health").catch(() => {});
  }, 5 * 60 * 1000);
});
