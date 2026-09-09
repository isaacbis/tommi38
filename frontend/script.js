const API = "/api";
const qs = id => document.getElementById(id);
const show = el => el && el.classList.remove("hidden");
const hide = el => el && el.classList.add("hidden");
const escapeHTML = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[char]));

let STATE = {
  me: null,
  config: {},
  fields: [],
  fieldsDraft: [],
  notes: "",
  users: [],
  reservations: [],
  dayReservationsAll: [],
  myReservations: [],
  gallery: [],
  galleryDraft: [],
  selectedTime: "",
  nativeSynced: false
};

let AUTO_REFRESH_TIMER = null;

/* ===================== DATE / TIME ===================== */
function localISODate(date = new Date()) {
  const tz = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tz).toISOString().slice(0, 10);
}

function tomorrowISODate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localISODate(d);
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function minutes(time) {
  const [h, m] = String(time || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function timeStr(total) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function isPastDate(dateStr) {
  return dateStr < localISODate();
}

function formatLongDate(dateStr) {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

function formatMatchDate(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return {
    day: String(day),
    month: d.toLocaleDateString("it-IT", { month: "short" }).replace(".", "")
  };
}

function setDate(dateStr) {
  if (!dateStr || isPastDate(dateStr)) return;
  qs("datePick").value = dateStr;
  STATE.selectedTime = "";
  updateDateUI();
  loadReservations();
}

function updateDateUI() {
  const date = qs("datePick")?.value || localISODate();
  qs("selectedDateLabel").textContent = formatLongDate(date);
  qs("quickToday").classList.toggle("active", date === localISODate());
  qs("quickTomorrow").classList.toggle("active", date === tomorrowISODate());
}

/* ===================== API ===================== */
async function api(path, options = {}) {
  const response = await fetch(API + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw data;
  return data;
}

/* ===================== NATIVE BRIDGE ===================== */
function nativeMessage(payload) {
  try {
    const handler = window.webkit?.messageHandlers?.tommi38Notifications;
    if (handler) handler.postMessage(payload);
  } catch (error) {
    console.warn("Bridge iOS non disponibile", error);
  }
}

function scheduleNativeBookingNotification({ id, field, date, time }) {
  nativeMessage({
    type: "bookingCreated",
    id,
    field,
    date,
    time,
    minutesBefore: 30
  });
}

function cancelNativeBookingNotification(id) {
  nativeMessage({ type: "bookingCancelled", id });
}

/* ===================== COMMON UI ===================== */
function setBookMessage(message = "", type = "") {
  const el = qs("bookMsg");
  if (!el) return;
  el.textContent = message;
  el.className = `form-message ${type}`.trim();
}

function currentField() {
  const fieldId = qs("fieldSelect")?.value;
  return STATE.fields.find(field => field.id === fieldId) || null;
}

function currentSlotMinutes() {
  return Number(STATE.config.slotMinutes || 40);
}

function fieldName(fieldId) {
  return STATE.fields.find(field => field.id === fieldId)?.name || fieldId;
}

function updateBookingPreview() {
  const box = qs("bookingPreview");
  if (!box) return;

  const field = currentField();
  const time = STATE.selectedTime;
  const slot = currentSlotMinutes();

  if (!field || !time) {
    box.innerHTML = `
      <img src="/icon-192.png" alt="" class="preview-logo">
      <div class="preview-copy">
        <strong>${escapeHTML(field?.name || "Scegli campo e orario")}</strong>
        <span>Seleziona un orario libero per continuare</span>
      </div>
    `;
    qs("bookBtn").disabled = true;
    return;
  }

  const end = timeStr(minutes(time) + slot);
  const credits = Number(STATE.me?.credits || 0);
  const remaining = Math.max(0, credits - (STATE.me?.role === "admin" ? 0 : 1));
  const creditText = STATE.me?.role === "admin"
    ? "Prenotazione amministratore"
    : `1 credito · Ne resteranno ${remaining}`;

  box.innerHTML = `
    <img src="/icon-192.png" alt="" class="preview-logo">
    <div class="preview-copy">
      <strong>${escapeHTML(field.name)} · ${escapeHTML(time)}–${escapeHTML(end)}</strong>
      <span>${escapeHTML(creditText)}</span>
    </div>
  `;

  qs("bookBtn").disabled = false;
}

/* ===================== LOGIN ===================== */
async function loadPublicLoginGallery() {
  try {
    const pub = await api("/public/config");
    STATE.gallery = pub.gallery || [];
    renderLoginGallery();
  } catch {}
}

async function login() {
  hide(qs("loginErr"));
  qs("loginBtn").disabled = true;
  qs("loginBtn").textContent = "Accesso…";

  try {
    await api("/login", {
      method: "POST",
      body: JSON.stringify({
        username: qs("username").value.trim(),
        password: qs("password").value
      })
    });
    await loadAll(true);
  } catch {
    qs("loginErr").textContent = "Username o password non corretti.";
    show(qs("loginErr"));
  } finally {
    qs("loginBtn").disabled = false;
    qs("loginBtn").textContent = "Accedi";
  }
}

async function logout() {
  try { await api("/logout", { method: "POST" }); } catch {}
  stopAutoRefresh();
  STATE.me = null;
  STATE.nativeSynced = false;
  hide(qs("app"));
  show(qs("loginBox"));
  qs("password").value = "";
}

function togglePassword() {
  const input = qs("password");
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  qs("passwordToggle").setAttribute("aria-label", isPassword ? "Nascondi password" : "Mostra password");
}

function unavailableEstablishmentMessage() {
  alert("Al momento in questa versione è disponibile solo Tommi38.");
}

/* ===================== LOAD APP ===================== */
async function loadAll(setToday = false) {
  const [me, pub] = await Promise.all([
    api("/me"),
    api("/public/config")
  ]);

  STATE.me = me;
  STATE.config = pub;
  STATE.fields = pub.fields || [];
  STATE.fieldsDraft = [...STATE.fields];
  STATE.notes = pub.notesText || "";
  STATE.gallery = pub.gallery || [];
  STATE.galleryDraft = [...STATE.gallery];

  hide(qs("loginBox"));
  show(qs("app"));

  const firstName = String(me.username || "").split(/[._\-\s]/)[0] || me.username;
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  qs("welcome").innerHTML = `Ciao <strong>${escapeHTML(displayName)}</strong>`;
  qs("creditsBox").textContent = `${Number(me.credits || 0)} ${Number(me.credits) === 1 ? "credito" : "crediti"}`;
  qs("roleBadge").textContent = me.role === "admin" ? "Admin" : "";
  me.role === "admin" ? show(qs("roleBadge")) : hide(qs("roleBadge"));
  qs("notesView").textContent = STATE.notes || "Nessuna comunicazione al momento.";

  qs("datePick").min = localISODate();
  if (setToday || !qs("datePick").value || isPastDate(qs("datePick").value)) {
    qs("datePick").value = localISODate();
  }
  updateDateUI();

  qs("slotDurationLabel").textContent = `${currentSlotMinutes()} minuti`;
  renderFields();

  if (STATE.fields.length && !qs("fieldSelect").value) {
    qs("fieldSelect").value = STATE.fields[0].id;
  }

  if (me.role === "admin") {
    show(qs("openAdminBtn"));
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
  } else {
    hide(qs("openAdminBtn"));
  }

  await Promise.all([
    loadReservations(),
    loadMyReservations(),
    loadWeather()
  ]);

  switchView("book");
  startAutoRefresh();
}

/* ===================== FIELDS ===================== */
function renderFields() {
  const select = qs("fieldSelect");
  const buttons = qs("fieldButtons");
  const previous = select.value;

  select.innerHTML = "";
  buttons.innerHTML = "";

  STATE.fields.forEach((field, index) => {
    const option = document.createElement("option");
    option.value = field.id;
    option.textContent = field.name;
    select.appendChild(option);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "field-chip";
    button.dataset.fieldId = field.id;
    button.textContent = field.name;
    button.addEventListener("click", () => {
      select.value = field.id;
      STATE.selectedTime = "";
      renderFieldButtonsState();
      renderTimeGrid();
      updateBookingPreview();
      setBookMessage();
    });
    buttons.appendChild(button);

    if (index === 0 && !previous) select.value = field.id;
  });

  if (previous && STATE.fields.some(field => field.id === previous)) {
    select.value = previous;
  }

  renderFieldButtonsState();
}

function renderFieldButtonsState() {
  const selected = qs("fieldSelect").value;
  document.querySelectorAll(".field-chip").forEach(button => {
    button.classList.toggle("active", button.dataset.fieldId === selected);
  });
}

/* ===================== RESERVATIONS / SLOTS ===================== */
async function loadReservations() {
  const date = qs("datePick").value;
  if (!date || isPastDate(date)) return;

  const response = await api(`/reservations?date=${encodeURIComponent(date)}`);
  STATE.dayReservationsAll = response.items || [];
  STATE.reservations = STATE.me?.role === "admin"
    ? STATE.dayReservationsAll
    : STATE.dayReservationsAll.filter(item => item.user === STATE.me.username);

  renderTimeGrid();
  updateBookingPreview();
}

function renderTimeGrid() {
  const box = qs("timeGrid");
  if (!box) return;

  const fieldId = qs("fieldSelect").value;
  const date = qs("datePick").value;
  const slot = currentSlotMinutes();
  const start = minutes(STATE.config.dayStart || "09:00");
  const end = minutes(STATE.config.dayEnd || "20:00");
  const today = localISODate();
  const now = nowMinutes();
  const taken = new Set(
    STATE.dayReservationsAll
      .filter(item => item.fieldId === fieldId)
      .map(item => item.time)
  );

  const available = [];
  box.innerHTML = "";
  qs("timeSelect").innerHTML = "";

  for (let m = start; m + slot <= end; m += slot) {
    const time = timeStr(m);
    const past = date < today || (date === today && m <= now);
    const busy = taken.has(time);
    const selectable = !past && !busy;

    if (selectable) available.push(time);

    const option = document.createElement("option");
    option.value = time;
    option.disabled = !selectable;
    option.textContent = time;
    qs("timeSelect").appendChild(option);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `time-slot ${busy ? "busy" : past ? "past" : "free"}`;
    button.disabled = !selectable;
    button.dataset.time = time;
    button.innerHTML = `<strong>${escapeHTML(time)}</strong><small>${busy ? "Occupato" : past ? "Passato" : "Libero"}</small>`;

    if (selectable) {
      button.addEventListener("click", () => {
        STATE.selectedTime = time;
        qs("timeSelect").value = time;
        renderTimeSelectionState();
        updateBookingPreview();
        setBookMessage();
      });
    }

    box.appendChild(button);
  }

  if (!available.includes(STATE.selectedTime)) {
    STATE.selectedTime = "";
  }

  if (STATE.selectedTime) qs("timeSelect").value = STATE.selectedTime;
  renderTimeSelectionState();

  if (!available.length) {
    box.innerHTML = `<div class="empty-state" style="grid-column:1/-1">Nessun orario disponibile per questo campo.</div>`;
  }
}

function renderTimeSelectionState() {
  document.querySelectorAll(".time-slot").forEach(button => {
    const selected = button.dataset.time === STATE.selectedTime && !button.disabled;
    button.classList.toggle("selected", selected);
    const small = button.querySelector("small");
    if (selected && small) small.textContent = "Selezionato";
    else if (small && button.classList.contains("free")) small.textContent = "Libero";
  });
}

async function book() {
  const fieldId = qs("fieldSelect").value;
  const field = currentField();
  const date = qs("datePick").value;
  const time = STATE.selectedTime;

  if (!fieldId || !date || !time) {
    setBookMessage("Seleziona campo, data e orario.", "error");
    return;
  }

  const slot = currentSlotMinutes();
  const end = timeStr(minutes(time) + slot);
  if (!confirm(`Confermi la prenotazione?\n\n${field.name}\n${formatLongDate(date)}\n${time}–${end}`)) return;

  qs("bookBtn").disabled = true;
  qs("bookBtn").textContent = "Prenotazione…";

  try {
    await api("/reservations", {
      method: "POST",
      body: JSON.stringify({ fieldId, date, time })
    });

    const reservationId = `${fieldId}_${date}_${time}`;
    scheduleNativeBookingNotification({
      id: reservationId,
      field: field.name,
      date,
      time
    });

    STATE.selectedTime = "";
    await Promise.all([
      refreshCredits(),
      loadReservations(),
      loadMyReservations()
    ]);
    setBookMessage(`Prenotazione confermata: ${field.name}, ore ${time}.`, "success");
  } catch (error) {
    const message =
      error?.error === "ACTIVE_BOOKING_LIMIT" ? "Hai raggiunto il limite di prenotazioni attive." :
      error?.error === "MAX_PER_DAY_LIMIT" ? "Hai raggiunto il limite di prenotazioni per questo giorno." :
      error?.error === "SLOT_TAKEN" ? "Questo orario è appena stato prenotato." :
      error?.error === "NO_CREDITS" ? "Non hai crediti disponibili." :
      error?.error === "PAST_TIME_NOT_ALLOWED" ? "Questo orario è già iniziato." :
      "Non è stato possibile completare la prenotazione.";

    await loadReservations().catch(() => {});
    setBookMessage(message, "error");
  } finally {
    qs("bookBtn").textContent = "Conferma prenotazione";
    updateBookingPreview();
  }
}

async function deleteReservation(id) {
  if (!confirm("Vuoi cancellare questa prenotazione?")) return;

  try {
    await api(`/reservations/${encodeURIComponent(id)}`, { method: "DELETE" });
    cancelNativeBookingNotification(id);
    await Promise.all([
      refreshCredits(),
      loadReservations(),
      loadMyReservations()
    ]);
  } catch {
    alert("Non è stato possibile cancellare la prenotazione.");
  }
}

async function refreshCredits() {
  const me = await api("/me");
  STATE.me.credits = me.credits;
  qs("creditsBox").textContent = `${Number(me.credits || 0)} ${Number(me.credits) === 1 ? "credito" : "crediti"}`;
}

/* ===================== MY MATCHES ===================== */
async function loadMyReservations() {
  let items = [];

  try {
    const response = await api("/reservations/mine");
    items = response.items || [];
  } catch {
    // Compatibilità temporanea finché il backend non viene aggiornato.
    items = STATE.reservations || [];
  }

  const today = localISODate();
  STATE.myReservations = items
    .filter(item => item.date >= today)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  // Al primo caricamento nell'app iPhone sincronizza anche prenotazioni già esistenti.
  // I successivi refresh automatici non le riprogrammano continuamente.
  if (!STATE.nativeSynced) {
    STATE.myReservations.forEach(item => {
      scheduleNativeBookingNotification({
        id: item.id,
        field: fieldName(item.fieldId),
        date: item.date,
        time: item.time
      });
    });
    STATE.nativeSynced = true;
  }

  renderMyReservations();
}

function renderMyReservations() {
  const box = qs("matchesList");
  if (!box) return;
  box.innerHTML = "";

  if (!STATE.myReservations.length) {
    box.innerHTML = `<div class="empty-state">Non hai prenotazioni attive.</div>`;
    return;
  }

  STATE.myReservations.forEach(item => {
    const date = formatMatchDate(item.date);
    const card = document.createElement("article");
    card.className = "match-card";

    card.innerHTML = `
      <div class="match-date">
        <strong>${escapeHTML(date.day)}</strong>
        <span>${escapeHTML(date.month)}</span>
      </div>
      <div class="match-main">
        <strong>${escapeHTML(fieldName(item.fieldId))}</strong>
        <span>${escapeHTML(item.time)} · ${escapeHTML(formatLongDate(item.date))}</span>
      </div>
    `;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "match-delete";
    button.textContent = "Cancella";
    button.addEventListener("click", () => deleteReservation(item.id));
    card.appendChild(button);
    box.appendChild(card);
  });
}

/* ===================== WEATHER ===================== */
function weatherEmoji(code) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code <= 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌦️";
  if (code <= 99) return "⛈️";
  return "•";
}

async function loadWeather() {
  const box = qs("weatherBox");
  const row = qs("weatherRow");
  if (!box || !row) return;

  const CACHE_KEY = "weather_cache_v3";
  const CACHE_TTL = 30 * 60 * 1000;

  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    const now = Date.now();

    if (cached && now - cached.time < CACHE_TTL) {
      renderWeather(cached.data);
      show(box);
      return;
    }

    const data = await api("/weather");
    localStorage.setItem(CACHE_KEY, JSON.stringify({ time: now, data }));
    renderWeather(data);
    show(box);
  } catch (error) {
    console.warn("Meteo non disponibile", error);
  }
}

function renderWeather(data) {
  const row = qs("weatherRow");
  const daily = data?.daily;
  if (!row || !daily?.time?.length) return;

  row.innerHTML = "";
  const count = Math.min(7, daily.time.length);

  for (let i = 0; i < count; i++) {
    const [year, month, day] = daily.time[i].split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const item = document.createElement("div");
    item.className = "weather-day";
    item.innerHTML = `
      <span>${escapeHTML(date.toLocaleDateString("it-IT", { weekday: "short" }))}</span>
      <span class="weather-emoji">${weatherEmoji(daily.weathercode?.[i])}</span>
      <span class="weather-temp">${Math.round(daily.temperature_2m_max?.[i])}° / ${Math.round(daily.temperature_2m_min?.[i])}°</span>
    `;
    row.appendChild(item);
  }
}

/* ===================== NAVIGATION ===================== */
function switchView(name) {
  hide(qs("viewBook"));
  hide(qs("viewMatches"));
  hide(qs("viewAlerts"));
  hide(qs("adminShell"));
  show(qs("bottomNav"));

  const target = name === "matches" ? qs("viewMatches") : name === "alerts" ? qs("viewAlerts") : qs("viewBook");
  show(target);
  target.classList.add("active-view");

  document.querySelectorAll(".bottom-nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  if (name === "matches") loadMyReservations();
  if (name === "alerts") loadWeather();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openAdminShell() {
  if (STATE.me?.role !== "admin") return;
  hide(qs("viewBook"));
  hide(qs("viewMatches"));
  hide(qs("viewAlerts"));
  hide(qs("bottomNav"));
  show(qs("adminShell"));
  openAdmin("adminMenu");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeAdminShell() {
  switchView("alerts");
}

function openAdmin(id) {
  ["adminMenu", "adminConfig", "adminNotes", "adminFields", "adminUsers", "adminGallery"]
    .forEach(sectionId => hide(qs(sectionId)));
  show(qs(id));
}

/* ===================== ADMIN ===================== */
function renderFieldsAdmin() {
  const list = qs("fieldsList");
  list.innerHTML = "";

  STATE.fieldsDraft.forEach((field, index) => {
    const item = document.createElement("div");
    item.className = "admin-item";
    item.innerHTML = `<div class="admin-item-main"><strong>${escapeHTML(field.name)}</strong><span>${escapeHTML(field.id)}</span></div>`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "admin-small-btn";
    del.textContent = "Elimina";
    del.onclick = () => {
      STATE.fieldsDraft.splice(index, 1);
      renderFieldsAdmin();
    };
    item.appendChild(del);
    list.appendChild(item);
  });
}

function addField() {
  const id = qs("newFieldId").value.trim();
  const name = qs("newFieldName").value.trim();
  if (!id || !name) return;
  if (STATE.fieldsDraft.some(field => field.id === id)) return alert("Esiste già un campo con questo ID.");

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

  const pub = await api("/public/config");
  STATE.fields = pub.fields || [];
  STATE.fieldsDraft = [...STATE.fields];
  renderFields();
  renderFieldsAdmin();
  await loadReservations();
  alert("Campi aggiornati.");
}

async function saveNotes() {
  await api("/admin/notes", {
    method: "PUT",
    body: JSON.stringify({ text: qs("notesText").value })
  });
  STATE.notes = qs("notesText").value;
  qs("notesView").textContent = STATE.notes || "Nessuna comunicazione al momento.";
  alert("Comunicazione aggiornata.");
}

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

  const pub = await api("/public/config");
  STATE.config = pub;
  qs("slotDurationLabel").textContent = `${currentSlotMinutes()} minuti`;
  await loadReservations();
  alert("Configurazione aggiornata.");
}

async function loadUsers() {
  const response = await api("/admin/users");
  STATE.users = response.items || [];
  renderUsers(qs("userSearch")?.value || "");
}

function renderUsers(filter = "") {
  const list = qs("usersList");
  if (!list) return;
  list.innerHTML = "";

  const users = STATE.users.filter(user => user.username.toLowerCase().includes(filter.toLowerCase()));
  if (!users.length) {
    list.innerHTML = `<div class="empty-state">Nessun utente trovato.</div>`;
    return;
  }

  users.forEach(user => {
    const item = document.createElement("div");
    item.className = "admin-item";

    const main = document.createElement("div");
    main.className = "admin-item-main";
    main.innerHTML = `<strong>${escapeHTML(user.username)}</strong><span>${Number(user.credits || 0)} crediti · ${user.disabled ? "disabilitato" : "attivo"}</span>`;

    const actions = document.createElement("div");
    actions.className = "admin-item-actions";

    const credits = adminButton("Crediti", async () => {
      const value = prompt("Nuovi crediti", user.credits);
      if (value === null || !Number.isFinite(Number(value))) return;
      await api("/admin/users/credits", {
        method: "PUT",
        body: JSON.stringify({ username: user.username, delta: Number(value) - Number(user.credits) })
      });
      await loadUsers();
    });

    const password = adminButton("Password", async () => {
      const newPassword = prompt("Nuova password");
      if (!newPassword) return;
      await api("/admin/users/password", {
        method: "PUT",
        body: JSON.stringify({ username: user.username, newPassword })
      });
      alert("Password aggiornata.");
    });

    const rename = adminButton("Rinomina", async () => {
      const newUsername = prompt("Nuovo username", user.username)?.trim();
      if (!newUsername || newUsername === user.username) return;
      try {
        await api("/admin/users/rename", {
          method: "POST",
          body: JSON.stringify({ oldUsername: user.username, newUsername })
        });
        await loadUsers();
      } catch (error) {
        alert(error?.error === "USERNAME_TAKEN" ? "Username già utilizzato." : "Rinomina non riuscita.");
      }
    });

    const toggle = adminButton(user.disabled ? "Abilita" : "Disabilita", async () => {
      await api("/admin/users/status", {
        method: "PUT",
        body: JSON.stringify({ username: user.username, disabled: !user.disabled })
      });
      await loadUsers();
    });

    actions.append(credits, password, rename, toggle);
    item.append(main, actions);
    list.appendChild(item);
  });
}

function adminButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "admin-small-btn";
  button.textContent = label;
  button.onclick = handler;
  return button;
}

function renderGalleryAdmin() {
  const list = qs("galleryList");
  if (!list) return;
  list.innerHTML = "";

  STATE.galleryDraft.forEach((image, index) => {
    const item = document.createElement("div");
    item.className = "admin-item";
    item.innerHTML = `<div class="admin-item-main"><strong>${escapeHTML(image.caption || "Immagine")}</strong><span>${escapeHTML(image.url)}</span></div>`;

    const del = adminButton("Elimina", () => {
      STATE.galleryDraft.splice(index, 1);
      renderGalleryAdmin();
    });
    item.appendChild(del);
    list.appendChild(item);
  });
}

function addGalleryItem() {
  if (STATE.galleryDraft.length >= 10) return alert("Puoi inserire massimo 10 immagini.");
  const url = qs("galleryUrl").value.trim();
  const caption = qs("galleryCaption").value.trim();
  const link = qs("galleryLink").value.trim();

  if (!url.startsWith("http") || !link.startsWith("http")) return alert("Inserisci URL e link validi.");

  STATE.galleryDraft.push({ url, caption, link });
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
  STATE.gallery = [...STATE.galleryDraft];
  renderLoginGallery();
  alert("Galleria aggiornata.");
}

function renderLoginGallery() {
  const box = qs("loginGallery");
  if (!box) return;
  box.innerHTML = "";

  STATE.gallery.forEach(image => {
    if (!image.url || !image.link) return;
    const wrap = document.createElement("div");
    wrap.className = "login-gallery-item";
    const link = document.createElement("a");
    link.href = image.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const img = document.createElement("img");
    img.src = image.url;
    img.alt = image.caption || "";
    img.loading = "lazy";
    link.appendChild(img);
    wrap.appendChild(link);
    box.appendChild(wrap);
  });
}

/* ===================== AUTO REFRESH ===================== */
function startAutoRefresh() {
  stopAutoRefresh();
  AUTO_REFRESH_TIMER = setInterval(async () => {
    if (document.hidden || !STATE.me) return;
    try {
      await loadReservations();
      await refreshCredits();
      if (!qs("viewMatches").classList.contains("hidden")) await loadMyReservations();
    } catch (error) {
      console.warn("Aggiornamento automatico fallito", error);
    }
  }, 10_000);
}

function stopAutoRefresh() {
  if (AUTO_REFRESH_TIMER) clearInterval(AUTO_REFRESH_TIMER);
  AUTO_REFRESH_TIMER = null;
}

/* ===================== INIT ===================== */
document.addEventListener("DOMContentLoaded", () => {
  qs("loginBtn").onclick = login;
  qs("logoutBtn").onclick = logout;
  qs("passwordToggle").onclick = togglePassword;
  qs("loginBackBtn").onclick = unavailableEstablishmentMessage;
  qs("loginChangeBtn").onclick = unavailableEstablishmentMessage;
  qs("switchBathBtn").onclick = unavailableEstablishmentMessage;

  [qs("username"), qs("password")].forEach(input => {
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") login();
    });
  });

  qs("quickToday").onclick = () => setDate(localISODate());
  qs("quickTomorrow").onclick = () => setDate(tomorrowISODate());
  qs("datePick").onchange = () => {
    STATE.selectedTime = "";
    updateDateUI();
    loadReservations();
  };

  qs("bookBtn").onclick = book;
  qs("refreshMatchesBtn").onclick = loadMyReservations;

  document.querySelectorAll(".bottom-nav-item").forEach(button => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  qs("openAdminBtn").onclick = openAdminShell;
  qs("closeAdminBtn").onclick = closeAdminShell;
  qs("btnAdminConfig").onclick = () => openAdmin("adminConfig");
  qs("btnAdminNotes").onclick = () => openAdmin("adminNotes");
  qs("btnAdminFields").onclick = () => openAdmin("adminFields");
  qs("btnAdminUsers").onclick = () => openAdmin("adminUsers");
  qs("btnAdminGallery").onclick = () => openAdmin("adminGallery");
  document.querySelectorAll(".backAdmin").forEach(button => button.onclick = () => openAdmin("adminMenu"));

  qs("saveConfigBtn").onclick = saveConfig;
  qs("saveNotesBtn").onclick = saveNotes;
  qs("addFieldBtn").onclick = addField;
  qs("saveFieldsBtn").onclick = saveFields;
  qs("addGalleryBtn").onclick = addGalleryItem;
  qs("saveGalleryBtn").onclick = saveGallery;
  qs("userSearch").addEventListener("input", event => renderUsers(event.target.value));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(error => console.warn("Service worker", error));
  }

  loadPublicLoginGallery();

  loadAll(true)
    .catch(() => {
      show(qs("loginBox"));
      hide(qs("app"));
    })
    .finally(() => {
      const loader = qs("appLoader");
      loader?.classList.add("hide");
      setTimeout(() => loader?.remove(), 350);
    });

  setInterval(() => fetch("/api/health").catch(() => {}), 5 * 60 * 1000);
});
