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
let reservationRequest = 0;
let matchesRequest = 0;
let loadedDate = "";
let bookingBusy = false;
let refreshBusy = false;
const deleting = new Set();

function confirmAction(title, details, action = "Conferma") {
  const dialog = qs("confirmDialog");
  if (dialog.open) return Promise.resolve(false);
  qs("confirmTitle").textContent = title;
  qs("confirmDetails").textContent = details;
  qs("confirmAction").textContent = action;
  dialog.returnValue = "cancel";
  document.body.classList.add("dialog-open");
  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      document.body.classList.remove("dialog-open");
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    dialog.showModal();
  });
}

function errorMessage(error) {
  if (error?.status === 401) return "La sessione è scaduta. Accedi di nuovo.";
  if (error?.status === 429) return "Troppe richieste. Attendi un momento e riprova.";
  if (error?.error === "NETWORK") return "Connessione non disponibile. Controlla Internet e riprova.";
  if (error?.error === "TIMEOUT") return "La risposta sta impiegando troppo tempo. Riprova tra poco.";
  return "Non è stato possibile aggiornare i dati. Riprova.";
}

function connectionChanged() {
  qs("connectionStatus").classList.toggle("hidden", navigator.onLine);
  updateBookingPreview();
  if (navigator.onLine && STATE.me) refreshVisibleData();
}

/* ===================== DATE / TIME ===================== */
function localISODate(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function tomorrowISODate() {
  const d = new Date(localISODate() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return localISODate(d);
}

function nowMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find(p => p.type === "hour").value) * 60 + Number(parts.find(p => p.type === "minute").value);
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
  qs("quickToday").setAttribute("aria-pressed", String(date === localISODate()));
  qs("quickTomorrow").setAttribute("aria-pressed", String(date === tomorrowISODate()));
}

/* ===================== API ===================== */
async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(API + path, {
      credentials: "include", cache: "no-store", ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...options.headers }
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw { error: "INVALID_RESPONSE", status: response.status };
    }
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && STATE.me && path !== "/login") {
        stopAutoRefresh();
        STATE.me = null;
        reservationRequest++;
        matchesRequest++;
        loadedDate = "";
        hide(qs("app"));
        show(qs("loginBox"));
        qs("password").value = "";
        qs("loginErr").textContent = "La sessione è scaduta. Accedi di nuovo.";
        show(qs("loginErr"));
      }
      throw { ...data, status: response.status };
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw { error: "TIMEOUT" };
    if (error instanceof TypeError) throw { error: "NETWORK" };
    throw error;
  } finally { clearTimeout(timer); }
}

let publicConfigRequest = null;
function loadPublicConfig() {
  if (!publicConfigRequest) publicConfigRequest = api("/public/config").finally(() => { publicConfigRequest = null; });
  return publicConfigRequest;
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
    : (credits < 1 ? "Crediti esauriti: rivolgiti al gestore" : `1 credito · Ne resteranno ${remaining}`);

  box.innerHTML = `
    <img src="/icon-192.png" alt="" class="preview-logo">
    <div class="preview-copy">
      <strong>${escapeHTML(field.name)} · ${escapeHTML(time)}–${escapeHTML(end)}</strong>
      <span>${escapeHTML(creditText)}</span>
    </div>
  `;

  qs("bookBtn").disabled = bookingBusy || !navigator.onLine || loadedDate !== qs("datePick").value || (STATE.me?.role !== "admin" && credits < 1);
}

/* ===================== LOGIN ===================== */
async function loadPublicLoginGallery() {
  try {
    const pub = await loadPublicConfig();
    STATE.gallery = pub.gallery || [];
    renderLoginGallery();
  } catch {}
}

async function login() {
  if (qs("loginBtn").disabled || !qs("loginForm").reportValidity()) return;
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
    qs("password").value = "";
  } catch (error) {
    qs("loginErr").textContent = error?.status === 401 ? "Username o password non corretti." : errorMessage(error);
    show(qs("loginErr"));
  } finally {
    qs("loginBtn").disabled = false;
    qs("loginBtn").textContent = "Accedi";
  }
}

async function logout() {
  if (!await confirmAction("Vuoi uscire?", "Potrai accedere di nuovo con le tue credenziali.", "Esci")) return;
  try { await api("/logout", { method: "POST" }); }
  catch (error) { setBookMessage(errorMessage(error), "error"); return; }
  reservationRequest++;
  matchesRequest++;
  loadedDate = "";
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
    loadPublicConfig()
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
    loadUsers().catch(() => { qs("usersList").textContent = "Impossibile caricare gli utenti. Riapri questa sezione per riprovare."; });
  } else {
    hide(qs("openAdminBtn"));
  }

  await Promise.all([
    loadReservations(),
    loadMyReservations()
  ]);

  switchView("book", false);
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
      if (loadedDate === qs("datePick").value) renderTimeGrid();
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
    button.setAttribute("aria-pressed", String(button.dataset.fieldId === selected));
  });
}

/* ===================== RESERVATIONS / SLOTS ===================== */
async function loadReservations() {
  const date = qs("datePick").value;
  if (!STATE.me || !date || isPastDate(date)) return;
  const request = ++reservationRequest;
  if (loadedDate !== date) {
    loadedDate = "";
    STATE.selectedTime = "";
    qs("timeGrid").innerHTML = '<div class="empty-state">Caricamento degli orari…</div>';
    qs("availabilityStatus").textContent = "Controllo le disponibilità";
    updateBookingPreview();
  }
  qs("timeGrid").setAttribute("aria-busy", "true");
  try {
    const response = await api(`/reservations?date=${encodeURIComponent(date)}`);
    if (request !== reservationRequest || date !== qs("datePick").value || !STATE.me) return;
    STATE.dayReservationsAll = response.items || [];
    STATE.reservations = STATE.dayReservationsAll.filter(item => item.user === STATE.me.username);
    loadedDate = date;
    renderTimeGrid();
    updateBookingPreview();
  } catch (error) {
    if (request !== reservationRequest || !STATE.me) return;
    loadedDate = "";
    STATE.selectedTime = "";
    qs("availabilityStatus").textContent = "Disponibilità non aggiornata";
    const box = qs("timeGrid");
    box.innerHTML = `<div class="empty-state">${escapeHTML(errorMessage(error))}<br><button class="secondary-btn" type="button">Riprova</button></div>`;
    box.querySelector("button").onclick = loadReservations;
    updateBookingPreview();
  } finally {
    if (request === reservationRequest) qs("timeGrid").setAttribute("aria-busy", "false");
  }
}

function renderTimeGrid() {
  const box = qs("timeGrid");
  if (!box) return;

  const fieldId = qs("fieldSelect").value;
  const date = qs("datePick").value;
  const slot = currentSlotMinutes();
  if (!Number.isFinite(slot) || slot <= 0) {
    box.innerHTML = '<div class="empty-state">Orari non disponibili. Contatta il gestore.</div>';
    STATE.selectedTime = "";
    return;
  }
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
    if (past) continue;

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

  qs("availabilityStatus").textContent = available.length
    ? `${available.length} ${available.length === 1 ? "orario disponibile" : "orari disponibili"} · ${fieldName(fieldId)}`
    : "Nessun orario libero. Prova un altro campo o un’altra data.";
  if (!box.children.length) box.innerHTML = '<div class="empty-state">Non ci sono orari programmati.</div>';
}

function renderTimeSelectionState() {
  document.querySelectorAll(".time-slot").forEach(button => {
    const selected = button.dataset.time === STATE.selectedTime && !button.disabled;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    const small = button.querySelector("small");
    if (selected && small) small.textContent = "Selezionato";
    else if (small && button.classList.contains("free")) small.textContent = "Libero";
  });
}

async function book() {
  if (bookingBusy || qs("bookBtn").disabled) return;
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
  bookingBusy = true;
  const confirmed = await confirmAction("Conferma la tua partita", `${field.name}\n${formatLongDate(date)}\n${time}–${end}\n${STATE.me?.role === "admin" ? "Prenotazione amministratore" : "Costo: 1 credito"}`, "Prenota");
  if (!confirmed || !STATE.me) { bookingBusy = false; updateBookingPreview(); return; }

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
    await Promise.allSettled([refreshCredits(), loadReservations(), loadMyReservations()]);
    setBookMessage(`Prenotazione confermata: ${field.name}, ore ${time}.`, "success");
  } catch (error) {
    const message =
      error?.error === "ACTIVE_BOOKING_LIMIT" ? "Hai raggiunto il limite di prenotazioni attive." :
      error?.error === "MAX_PER_DAY_LIMIT" ? "Hai raggiunto il limite di prenotazioni per questo giorno." :
      error?.error === "SLOT_TAKEN" ? "Questo orario è appena stato prenotato." :
      error?.error === "NO_CREDITS" ? "Non hai crediti disponibili." :
      error?.error === "PAST_TIME_NOT_ALLOWED" ? "Questo orario è già iniziato." :
      error?.error === "NETWORK" || error?.error === "TIMEOUT" ? "Non abbiamo ricevuto conferma. Controlla Le mie partite prima di riprovare." :
      errorMessage(error);

    await loadReservations().catch(() => {});
    setBookMessage(message, "error");
  } finally {
    bookingBusy = false;
    qs("bookBtn").textContent = "Conferma prenotazione";
    updateBookingPreview();
  }
}

async function deleteReservation(id) {
  if (deleting.has(id)) return;
  deleting.add(id);
  if (!await confirmAction("Cancella la partita", "La prenotazione verrà rimossa e il campo tornerà disponibile.", "Cancella partita")) { deleting.delete(id); return; }

  try {
    await api(`/reservations/${encodeURIComponent(id)}`, { method: "DELETE" });
    cancelNativeBookingNotification(id);
    await Promise.allSettled([refreshCredits(), loadReservations(), loadMyReservations()]);
  } catch (error) {
    qs("matchesStatus").textContent = errorMessage(error);
  } finally { deleting.delete(id); }
}

async function refreshCredits() {
  const me = await api("/me");
  if (!STATE.me || STATE.me.username !== me.username) return;
  STATE.me.credits = me.credits;
  qs("creditsBox").textContent = `${Number(me.credits || 0)} ${Number(me.credits) === 1 ? "credito" : "crediti"}`;
  updateBookingPreview();
}

/* ===================== MY MATCHES ===================== */
async function loadMyReservations() {
  if (!STATE.me) return;
  const request = ++matchesRequest;
  let items;
  qs("refreshMatchesBtn").disabled = true;
  qs("matchesList").setAttribute("aria-busy", "true");
  try {
    const response = await api("/reservations/mine");
    if (request !== matchesRequest || !STATE.me) return;
    items = response.items || [];
    qs("matchesStatus").textContent = items.length ? `${items.length} ${items.length === 1 ? "partita in programma" : "partite in programma"}` : "";
  } catch (error) {
    if (request === matchesRequest && STATE.me) qs("matchesStatus").textContent = errorMessage(error);
    return;
  } finally {
    if (request === matchesRequest) {
      qs("refreshMatchesBtn").disabled = false;
      qs("matchesList").setAttribute("aria-busy", "false");
    }
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
    box.innerHTML = '<div class="empty-state"><strong>Il campo ti aspetta</strong><br>Non hai partite in programma.<br><button class="secondary-btn" type="button">Prenota una partita</button></div>';
    box.querySelector("button").onclick = () => switchView("book");
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
function switchView(name, refresh = true) {
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
    if (button.dataset.view === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (name === "book" && STATE.me && refresh) loadReservations();
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

  const pub = await loadPublicConfig();
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

  const pub = await loadPublicConfig();
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
  button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true;
    try { await handler(); } catch (error) { alert(errorMessage(error)); }
    finally { button.disabled = false; }
  };
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
async function refreshVisibleData() {
  if (refreshBusy || document.hidden || !STATE.me || !navigator.onLine || bookingBusy) return;
  refreshBusy = true;
  try {
    qs("datePick").min = localISODate();
    if (isPastDate(qs("datePick").value)) setDate(localISODate());
    const jobs = [refreshCredits()];
    if (!qs("viewBook").classList.contains("hidden")) jobs.push(loadReservations());
    if (!qs("viewMatches").classList.contains("hidden")) jobs.push(loadMyReservations());
    await Promise.allSettled(jobs);
  } finally { refreshBusy = false; }
}

function startAutoRefresh() {
  stopAutoRefresh();
  AUTO_REFRESH_TIMER = setInterval(refreshVisibleData, 30000);
}

function stopAutoRefresh() {
  if (AUTO_REFRESH_TIMER) clearInterval(AUTO_REFRESH_TIMER);
  AUTO_REFRESH_TIMER = null;
}

/* ===================== INIT ===================== */
document.addEventListener("DOMContentLoaded", () => {
  qs("loginForm").onsubmit = event => { event.preventDefault(); login(); };
  qs("logoutBtn").onclick = logout;
  qs("passwordToggle").onclick = togglePassword;
  qs("loginBackBtn").onclick = unavailableEstablishmentMessage;
  qs("loginChangeBtn").onclick = unavailableEstablishmentMessage;
  qs("switchBathBtn").onclick = unavailableEstablishmentMessage;

  qs("quickToday").onclick = () => setDate(localISODate());
  qs("quickTomorrow").onclick = () => setDate(tomorrowISODate());
  qs("datePick").onchange = () => {
    const date = qs("datePick").value;
    setDate(!date || isPastDate(date) ? localISODate() : date);
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
  qs("btnAdminUsers").onclick = () => { openAdmin("adminUsers"); loadUsers().catch(error => { qs("usersList").textContent = errorMessage(error); }); };
  qs("btnAdminGallery").onclick = () => openAdmin("adminGallery");
  document.querySelectorAll(".backAdmin").forEach(button => button.onclick = () => openAdmin("adminMenu"));

  const guarded = handler => async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try { await handler(); } catch (error) { alert(errorMessage(error)); }
    finally { button.disabled = false; }
  };
  qs("saveConfigBtn").onclick = guarded(saveConfig);
  qs("saveNotesBtn").onclick = guarded(saveNotes);
  qs("addFieldBtn").onclick = addField;
  qs("saveFieldsBtn").onclick = guarded(saveFields);
  qs("addGalleryBtn").onclick = addGalleryItem;
  qs("saveGalleryBtn").onclick = guarded(saveGallery);
  qs("userSearch").addEventListener("input", event => renderUsers(event.target.value));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(error => console.warn("Service worker", error));
  }

  loadPublicLoginGallery();

  loadAll(true)
    .catch(error => {
      show(qs("loginBox"));
      hide(qs("app"));
      if (error?.status !== 401) {
        qs("loginErr").textContent = errorMessage(error);
        show(qs("loginErr"));
      }
    })
    .finally(() => {
      const loader = qs("appLoader");
      loader?.classList.add("hide");
      setTimeout(() => loader?.remove(), 350);
    });

  window.addEventListener("online", connectionChanged);
  window.addEventListener("offline", connectionChanged);
  document.addEventListener("visibilitychange", refreshVisibleData);
  connectionChanged();
});
