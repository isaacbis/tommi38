/* ================= CONFIG ================= */
const API = "/api";
const qs = id => document.getElementById(id);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");
const escapeHTML = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[char]));

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
  playerSearches: [],
  gallery: [],
  galleryDraft: []
};

let AUTO_REFRESH_TIMER = null;
let LAST_RESERVATIONS_SIGNATURE = "";
let LAST_PLAYER_SEARCHES_SIGNATURE = "";

function reservationsSignature(items = []) {
  return items
    .map(item => `${item.id || ""}|${item.fieldId || ""}|${item.date || ""}|${item.time || ""}|${item.user || ""}`)
    .sort()
    .join("||");
}

function setBookMessage(message = "", type = "") {
  const element = qs("bookMsg");
  if (!element) return;
  element.textContent = message;
  element.className = `form-message ${type}`.trim();
}

function startAutoRefresh() {
  stopAutoRefresh();
  AUTO_REFRESH_TIMER = setInterval(async () => {
    // Evita aggiornamenti inutili quando l'app non è visibile.
    if (document.hidden) return;

    try {
      // In background aggiorna il DOM solo quando le prenotazioni cambiano.
      // Questo impedisce alla pagina di spostarsi ogni 10 secondi.
      await loadReservations({ background: true });
      await loadPlayerSearches({ background: true });

      if (STATE.me && STATE.me.role === "user") {
        await refreshCredits();
      }
    } catch (e) {
      console.warn("Auto-refresh fallito", e);
    }
  }, 10_000);
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
function getFieldDayData(fieldId) {
  const slotMinutes = Number(STATE.config.slotMinutes || 45);
  const start = minutes(STATE.config.dayStart || "09:00");
  const end = minutes(STATE.config.dayEnd || "20:00");
  const reservations = STATE.dayReservationsAll
    .filter(r => r.fieldId === fieldId)
    .sort((a, b) => minutes(a.time) - minutes(b.time));

  const totalSlots = Math.max(0, Math.floor((end - start) / slotMinutes));
  return {
    slotMinutes,
    start,
    end,
    reservations,
    totalSlots,
    availableSlots: Math.max(0, totalSlots - reservations.length)
  };
}

function formatSelectedDate(dateStr) {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

function formatBookingDate(dateStr) {
  if (!dateStr) return "Data da scegliere";

  const today = localISODate();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localISODate(tomorrowDate);

  if (dateStr === today) return "Oggi";
  if (dateStr === tomorrow) return "Domani";

  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
}

function updateBookingPreview() {
  const box = qs("bookingPreview");
  const fieldSelect = qs("fieldSelect");
  const date = qs("datePick")?.value;
  const time = qs("timeSelect")?.value;
  if (!box || !fieldSelect) return;

  const fieldName = fieldSelect.selectedOptions[0]?.textContent || "Campo da scegliere";
  const readableDate = formatBookingDate(date);

  box.innerHTML = `
    <div>
      <div class="booking-preview-label">La tua scelta</div>
      <div class="booking-preview-value">${escapeHTML(fieldName)} · ${escapeHTML(readableDate)}</div>
    </div>
    <div class="booking-preview-time">${escapeHTML(time || "--:--")}</div>
  `;
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

  const CACHE_KEY = "weather_cache_v2";
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
  } catch (e) {
    console.error("Errore meteo", e);
  }
}

function renderWeather(data) {
  const row = qs("weatherRow");
  const daily = data?.daily;
  if (!row || !daily?.time?.length) return;

  row.innerHTML = "";
  const days = Math.min(7, daily.time.length);

  for (let i = 0; i < days; i++) {
    const [year, month, dayNumber] = daily.time[i].split("-").map(Number);
    const date = new Date(year, month - 1, dayNumber);
    const day = date.toLocaleDateString("it-IT", { weekday: "short" });
    const max = daily.temperature_2m_max?.[i];
    const min = daily.temperature_2m_min?.[i];

    const el = document.createElement("div");
    el.className = "weather-day";
    el.innerHTML = `
      <span>${day}</span>
      <span class="weather-emoji">${weatherEmoji(daily.weathercode[i])}</span>
      ${Number.isFinite(max) && Number.isFinite(min)
        ? `<span class="weather-temp">${Math.round(max)}° / ${Math.round(min)}°</span>`
        : ""}
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
  qs("creditsBox").textContent = `${STATE.me.credits} ${Number(STATE.me.credits) === 1 ? "credito disponibile" : "crediti disponibili"}`;
  qs("roleBadge").textContent = STATE.me.role === "admin" ? "Admin" : "Utente";
  qs("notesView").textContent = STATE.notes || "Nessuna comunicazione.";

  qs("datePick").min = localISODate();
  if (setDateToday || !qs("datePick").value) {
    qs("datePick").value = localISODate();
  }

renderFields();

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
  await loadPlayerSearches();

}



/* ================= RESERVATIONS ================= */
async function loadReservations({ background = false } = {}) {
  const date = qs("datePick").value;

  if (isPastDate(date)) {
    qs("bookBtn").disabled = true;
    setBookMessage("Non puoi prenotare una giornata passata", "error");

    STATE.dayReservationsAll = [];
    STATE.reservations = [];
    LAST_RESERVATIONS_SIGNATURE = `${date}::past`;

    renderTimeSelect();
    renderReservations();
    renderFieldInfo({ preserveScroll: background });
    return;
  }

  qs("bookBtn").disabled = false;
  const res = await api(`/reservations?date=${date}`);
  const nextReservations = res.items || [];
  const nextSignature = `${date}::${reservationsSignature(nextReservations)}`;
  const reservationsChanged = nextSignature !== LAST_RESERVATIONS_SIGNATURE;

  STATE.dayReservationsAll = nextReservations;
  STATE.reservations =
    STATE.me.role === "admin"
      ? STATE.dayReservationsAll
      : STATE.dayReservationsAll.filter(r => r.user === STATE.me.username);

  // Se il refresh automatico non trova cambiamenti, non ricrea tutta la pagina.
  if (background && !reservationsChanged) {
    updateFieldStatusOnly();
    return;
  }

  LAST_RESERVATIONS_SIGNATURE = nextSignature;
  renderTimeSelect();
  renderReservations();
  renderFieldInfo({ preserveScroll: background });
}

function getFieldSummaryView(fieldId) {
  const fieldName = qs("fieldSelect").selectedOptions[0]?.textContent || fieldId;
  const date = qs("datePick").value;
  const today = localISODate();
  const now = nowMinutes();
  const data = getFieldDayData(fieldId);

  let statusText;
  let statusClass;
  let detailText;

  if (date === today) {
    const current = data.reservations.find(r => {
      const start = minutes(r.time);
      return now >= start && now < start + data.slotMinutes;
    });

    const next = data.reservations.find(r => minutes(r.time) > now);

    if (current) {
      statusText = "Partita in corso";
      statusClass = "is-playing";
      detailText = `Il campo torna libero alle ${timeStr(minutes(current.time) + data.slotMinutes)}`;
    } else {
      statusText = "Campo libero adesso";
      statusClass = "is-free";
      detailText = next
        ? `Prossima prenotazione alle ${next.time}`
        : "Nessun'altra prenotazione prevista oggi";
    }
  } else {
    statusText = fieldName;
    statusClass = "is-day";
    detailText = formatSelectedDate(date);
  }

  return { ...data, statusText, statusClass, detailText };
}

function updateFieldStatusOnly() {
  const fieldId = qs("fieldSelect")?.value;
  const box = qs("fieldInfo");
  if (!fieldId || !box) return;

  const view = getFieldSummaryView(fieldId);
  const status = box.querySelector(".field-status");
  const detail = box.querySelector(".field-countdown");
  const availability = box.querySelector(".availability-pill");

  if (status) {
    status.className = `field-status ${view.statusClass}`;
    status.textContent = view.statusText;
  }
  if (detail) detail.textContent = view.detailText;
  if (availability) availability.textContent = `${view.availableSlots} liberi`;
}

function renderFieldInfo({ preserveScroll = true } = {}) {
  const fieldId = qs("fieldSelect")?.value;
  const box = qs("fieldInfo");
  if (!fieldId || !box) return;

  const previousTimeline = qs("timeline");
  const savedScroll = preserveScroll && previousTimeline
    ? previousTimeline.scrollLeft
    : null;
  const view = getFieldSummaryView(fieldId);

  box.innerHTML = `
    <div class="field-summary">
      <div>
        <div class="field-status ${view.statusClass}">${escapeHTML(view.statusText)}</div>
        <div class="field-countdown">${escapeHTML(view.detailText)}</div>
      </div>
      <span class="availability-pill">${view.availableSlots} liberi</span>
    </div>
    <div class="timeline-label">Tocca un orario libero per selezionarlo</div>
    <div id="timeline" class="timeline" aria-label="Disponibilità orari"></div>
    <div class="timeline-legend" aria-hidden="true">
      <span class="legend-item"><span class="legend-dot free"></span>Libero</span>
      <span class="legend-item"><span class="legend-dot busy"></span>Occupato</span>
      <span class="legend-item"><span class="legend-dot selected"></span>Selezionato</span>
    </div>
  `;

  renderTimeline(fieldId, {
    scrollLeft: savedScroll,
    centerSelected: savedScroll === null
  });
}

function renderTimeSelect() {
  const sel = qs("timeSelect");
  const bookBtn = qs("bookBtn");
  const previousValue = sel.value;
  sel.innerHTML = "";

  const slot = Number(STATE.config.slotMinutes || 45);
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
    const option = document.createElement("option");
    option.value = t;

    if (isPastDate(date)) {
      option.textContent = `${t} — giorno passato`;
      option.disabled = true;
    } else if (isToday && m <= nowMinutes()) {
      option.textContent = `${t} — passato`;
      option.disabled = true;
    } else if (taken.has(t)) {
      option.textContent = `${t} — occupato`;
      option.disabled = true;
    } else {
      option.textContent = `${t} — libero`;
    }

    sel.appendChild(option);
  }

  const availableOptions = [...sel.options].filter(option => !option.disabled);
  const previousOption = availableOptions.find(option => option.value === previousValue);

  if (previousOption) {
    sel.value = previousOption.value;
  } else if (availableOptions[0]) {
    sel.value = availableOptions[0].value;
  }

  sel.disabled = availableOptions.length === 0;
  bookBtn.disabled = isPastDate(date) || availableOptions.length === 0;

  if (availableOptions.length === 0 && !isPastDate(date)) {
    setBookMessage("Nessun orario disponibile per questo campo");
  }

  updateBookingPreview();
}

function renderTimeline(fieldId, { scrollLeft = null, centerSelected = false } = {}) {
  const box = qs("timeline");
  if (!box) return;

  const slotMinutes = Number(STATE.config.slotMinutes || 45);
  const start = minutes(STATE.config.dayStart || "09:00");
  const end = minutes(STATE.config.dayEnd || "20:00");
  const date = qs("datePick").value;
  const today = localISODate();
  const now = nowMinutes();
  const selectedTime = qs("timeSelect").value;
  const isPastDay = isPastDate(date);

  box.innerHTML = "";

  for (let m = start; m + slotMinutes <= end; m += slotMinutes) {
    const time = timeStr(m);
    const isBusy = STATE.dayReservationsAll.some(
      reservation => reservation.fieldId === fieldId && reservation.time === time
    );
    const isPast = isPastDay || (date === today && m <= now);
    const isCurrent = date === today && now >= m && now < m + slotMinutes;
    const isSelected = !isBusy && !isPast && time === selectedTime;

    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "slot",
      isBusy ? "busy" : isPast ? "past" : "free",
      isCurrent ? "current" : "",
      isSelected ? "selected" : ""
    ].filter(Boolean).join(" ");

    button.textContent = time;
    button.dataset.stateLabel = isBusy ? "Occupato" : isPast ? "Passato" : isSelected ? "Scelto" : "Libero";
    button.disabled = isBusy || isPast;
    button.setAttribute(
      "aria-label",
      `${time}, ${isBusy ? "occupato" : isPast ? "non disponibile" : "libero"}`
    );

    if (!button.disabled) {
      button.addEventListener("click", () => {
        const currentScroll = box.scrollLeft;
        qs("timeSelect").value = time;
        setBookMessage();
        updateBookingPreview();
        renderTimeline(fieldId, { scrollLeft: currentScroll });
      });
    }

    box.appendChild(button);
  }

  const selected = box.querySelector(".slot.selected");

  // Muove soltanto la barra interna degli orari, mai la pagina intera.
  requestAnimationFrame(() => {
    if (!box.isConnected) return;

    if (Number.isFinite(scrollLeft)) {
      box.scrollLeft = scrollLeft;
      return;
    }

    if (centerSelected && selected) {
      const target = selected.offsetLeft - (box.clientWidth - selected.offsetWidth) / 2;
      box.scrollLeft = Math.max(0, target);
    }
  });
}

/* ===== PRENOTA (UI OTTIMISTICA) ===== */
async function book() {
  const fieldId = qs("fieldSelect").value;
  const fieldName = qs("fieldSelect").selectedOptions[0]?.textContent || fieldId;
  const date = qs("datePick").value;
  const time = qs("timeSelect").value;
  const selectedTimeOption = qs("timeSelect").selectedOptions[0];

  if (!fieldId || !date || !time) {
    setBookMessage("Seleziona campo, data e orario", "error");
    return;
  }

  if (isPastDate(date)) {
    setBookMessage("Non puoi prenotare un giorno passato", "error");
    return;
  }

  if (isPastTimeToday(date, time)) {
    setBookMessage("Orario già passato", "error");
    return;
  }

  if (selectedTimeOption?.disabled) {
    setBookMessage("Questo orario non è disponibile", "error");
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

    await refreshCredits();
    await loadReservations();
    setBookMessage(`Prenotazione effettuata: ${fieldName}, ore ${time}`, "success");

  } catch (e) {
    const message =
      e?.error === "ACTIVE_BOOKING_LIMIT"
        ? "Hai raggiunto il limite di prenotazioni attive"
        : e?.error === "MAX_PER_DAY_LIMIT"
        ? "Hai raggiunto il limite di prenotazioni per questo giorno"
        : e?.error === "SLOT_TAKEN"
        ? "Questo orario è già stato prenotato"
        : e?.error === "NO_CREDITS"
        ? "Non hai crediti disponibili"
        : e?.error === "PAST_TIME_NOT_ALLOWED"
        ? "Questo orario è già iniziato"
        : "Errore durante la prenotazione";

    await loadReservations();

    const selectedOption = [...qs("timeSelect").options]
      .find(option => option.value === time && !option.disabled);
    if (selectedOption) qs("timeSelect").value = time;
    renderFieldInfo();
    setBookMessage(message, "error");
  }

  qs("bookBtn").disabled = qs("timeSelect").disabled || isPastDate(qs("datePick").value);
  qs("bookBtn").textContent = "Conferma prenotazione";
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
    await loadPlayerSearches();
  } catch {
    await loadReservations();
    await loadPlayerSearches();
  }
}

function renderReservations() {
  const list = qs("reservationsList");
  list.innerHTML = "";

  if (STATE.reservations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nessuna prenotazione per la data selezionata";
    list.appendChild(empty);
    return;
  }

  STATE.reservations
    .slice()
    .sort((a, b) => minutes(a.time) - minutes(b.time))
    .forEach(reservation => {
      const item = document.createElement("div");
      item.className = "item reservation-item";

      const fieldName = STATE.fields.find(field => field.id === reservation.fieldId)?.name || reservation.fieldId;
      const search = STATE.playerSearches.find(playerSearch => playerSearch.reservationId === reservation.id);

      const time = document.createElement("div");
      time.className = "reservation-time";
      time.textContent = reservation.time;

      const main = document.createElement("div");
      main.className = "reservation-main";

      const field = document.createElement("div");
      field.className = "reservation-field";
      field.textContent = fieldName;
      main.appendChild(field);

      if (STATE.me.role === "admin") {
        const meta = document.createElement("div");
        meta.className = "reservation-meta";
        meta.textContent = `Prenotata da ${reservation.user}`;
        main.appendChild(meta);
      }

      if (search) {
        const pending = (search.requests || []).filter(request => request.status === "pending").length;
        const summary = document.createElement("div");
        summary.className = "player-search-summary";
        summary.textContent = search.status === "open"
          ? `${search.spotsAvailable} posti liberi · ${pending} richieste in attesa`
          : search.status === "full"
          ? "Gruppo completo"
          : "Ricerca giocatori chiusa";
        main.appendChild(summary);
      }

      item.append(time, main);

      if (STATE.me.role === "admin" || reservation.user === STATE.me.username) {
        const actions = document.createElement("div");
        actions.className = "reservation-actions";

        const searchButton = document.createElement("button");
        searchButton.className = search ? "btn-secondary" : "btn-ghost";
        searchButton.type = "button";

        if (search) {
          const pending = (search.requests || []).filter(request => request.status === "pending").length;
          searchButton.textContent = pending > 0 ? `Gestisci (${pending})` : "Gestisci giocatori";
          searchButton.onclick = () => openManagePlayerSearch(search.id);
        } else {
          searchButton.textContent = "Cerco giocatori";
          searchButton.onclick = () => openCreatePlayerSearch(reservation.id);
        }

        const deleteButton = document.createElement("button");
        deleteButton.className = "btn-ghost";
        deleteButton.type = "button";
        deleteButton.textContent = "Cancella";
        deleteButton.onclick = () => deleteReservation(reservation.id);

        if (search || !isPastTimeToday(reservation.date, reservation.time)) {
          actions.appendChild(searchButton);
        }
        actions.appendChild(deleteButton);
        item.appendChild(actions);
      }

      list.appendChild(item);
    });
}

/* ================= CERCA GIOCATORI ================= */
function playerSearchesSignature(items = []) {
  return JSON.stringify(items.map(item => ({
    id: item.id,
    status: item.status,
    spotsAvailable: item.spotsAvailable,
    spotsFilled: item.spotsFilled,
    myRequest: item.myRequest ? {
      id: item.myRequest.id,
      status: item.myRequest.status,
      count: item.myRequest.count
    } : null,
    requests: (item.requests || []).map(request => ({
      id: request.id,
      status: request.status,
      count: request.count,
      phone: request.phone,
      participantNames: request.participantNames
    }))
  })));
}

async function loadPlayerSearches({ background = false } = {}) {
  const response = await api("/player-searches");
  const nextItems = response.items || [];
  const nextSignature = playerSearchesSignature(nextItems);

  if (background && nextSignature === LAST_PLAYER_SEARCHES_SIGNATURE) return;

  LAST_PLAYER_SEARCHES_SIGNATURE = nextSignature;
  STATE.playerSearches = nextItems;
  renderPlayerSearches();
  renderReservations();
}

function fieldNameById(fieldId) {
  return STATE.fields.find(field => field.id === fieldId)?.name || fieldId;
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

function requestStatusLabel(status) {
  if (status === "accepted") return "Accettata";
  if (status === "rejected") return "Rifiutata";
  if (status === "cancelled") return "Annullata";
  return "In attesa";
}

function renderPlayerSearches() {
  const openList = qs("openGamesList");
  const myWrap = qs("myJoinRequestsWrap");
  const myList = qs("myJoinRequestsList");
  if (!openList || !myWrap || !myList) return;

  openList.innerHTML = "";
  myList.innerHTML = "";

  const openGames = STATE.playerSearches.filter(search =>
    !search.isOwner && search.status === "open" && search.spotsAvailable > 0 && !search.myRequest
  );

  if (openGames.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nessuna partita aperta in questo momento";
    openList.appendChild(empty);
  } else {
    openGames.forEach(search => {
      const card = document.createElement("div");
      card.className = "item game-card";
      card.innerHTML = `
        <div class="game-card-top">
          <div class="game-card-main">
            <div class="game-field">${escapeHTML(fieldNameById(search.fieldId))}</div>
            <div class="game-date">${escapeHTML(formatLongDate(search.date))}</div>
          </div>
          <div class="game-time">${escapeHTML(search.time)}</div>
        </div>
        ${search.note ? `<div class="game-note">${escapeHTML(search.note)}</div>` : ""}
        <div class="game-card-footer">
          <span class="spots-pill">${search.spotsAvailable} ${search.spotsAvailable === 1 ? "posto disponibile" : "posti disponibili"}</span>
          <button class="btn-ghost btn-small join-game-btn" type="button">Richiedi di partecipare</button>
        </div>
      `;
      card.querySelector(".join-game-btn").onclick = () => openJoinPlayerSearch(search.id);
      openList.appendChild(card);
    });
  }

  const myRequests = STATE.playerSearches.filter(search => search.myRequest);
  if (myRequests.length === 0) {
    hide(myWrap);
    return;
  }

  show(myWrap);
  myRequests.forEach(search => {
    const request = search.myRequest;
    const card = document.createElement("div");
    card.className = "item join-request-card";
    card.innerHTML = `
      <div class="request-card-top">
        <div class="request-card-main">
          <div class="game-field">${escapeHTML(fieldNameById(search.fieldId))}</div>
          <div class="game-date">${escapeHTML(formatLongDate(search.date))} · ore ${escapeHTML(search.time)}</div>
          <div class="player-names">${request.participantNames.map(escapeHTML).join("<br>")}</div>
        </div>
        <span class="request-status ${escapeHTML(request.status)}">${escapeHTML(requestStatusLabel(request.status))}</span>
      </div>
      <div class="request-card-footer">
        <span class="muted">${request.count} ${request.count === 1 ? "partecipante" : "partecipanti"}</span>
        ${request.status === "pending"
          ? '<button class="btn-ghost btn-small cancel-join-btn" type="button">Annulla richiesta</button>'
          : request.status === "rejected" && search.status === "open" && search.spotsAvailable > 0
          ? '<button class="btn-ghost btn-small retry-join-btn" type="button">Invia di nuovo</button>'
          : ""}
      </div>
    `;

    const cancelButton = card.querySelector(".cancel-join-btn");
    if (cancelButton) {
      cancelButton.onclick = () => cancelJoinRequest(search.id, request.id);
    }
    const retryButton = card.querySelector(".retry-join-btn");
    if (retryButton) {
      retryButton.onclick = () => openJoinPlayerSearch(search.id);
    }
    myList.appendChild(card);
  });
}

function openAppModal(title, html) {
  qs("appModalTitle").textContent = title;
  qs("appModalBody").innerHTML = html;
  show(qs("appModal"));
  document.body.classList.add("modal-open");
}

function closeAppModal() {
  hide(qs("appModal"));
  qs("appModalBody").innerHTML = "";
  document.body.classList.remove("modal-open");
}

function searchSummaryHTML(search) {
  return `
    <div class="modal-summary">
      <strong>${escapeHTML(fieldNameById(search.fieldId))} · ore ${escapeHTML(search.time)}</strong>
      <span>${escapeHTML(formatLongDate(search.date))}</span>
    </div>
  `;
}

function openCreatePlayerSearch(reservationId) {
  const reservation = STATE.reservations.find(item => item.id === reservationId);
  if (!reservation) return;

  const tempSearch = {
    fieldId: reservation.fieldId,
    date: reservation.date,
    time: reservation.time
  };

  const options = Array.from({ length: 12 }, (_, index) => {
    const value = index + 1;
    return `<option value="${value}">${value}</option>`;
  }).join("");

  openAppModal("Cerca giocatori", `
    ${searchSummaryHTML(tempSearch)}
    <label class="field-label" for="searchSpots">Quanti giocatori mancano?</label>
    <select id="searchSpots">${options}</select>

    <label class="field-label" for="searchNote">Messaggio facoltativo</label>
    <textarea id="searchNote" maxlength="200" placeholder="Es. Partita tranquilla, livello amatoriale"></textarea>

    <button id="createSearchBtn" class="btn btn-book" type="button">Pubblica la ricerca</button>
    <div id="playerSearchModalMsg" class="form-message" aria-live="polite"></div>
  `);

  qs("createSearchBtn").onclick = async () => {
    const button = qs("createSearchBtn");
    button.disabled = true;
    try {
      await api("/player-searches", {
        method: "POST",
        body: JSON.stringify({
          reservationId,
          spotsNeeded: Number(qs("searchSpots").value),
          note: qs("searchNote").value.trim()
        })
      });
      await loadPlayerSearches();
      closeAppModal();
    } catch (error) {
      const message = error?.error === "SEARCH_ALREADY_EXISTS"
        ? "La ricerca giocatori è già attiva"
        : "Non è stato possibile pubblicare la ricerca";
      qs("playerSearchModalMsg").textContent = message;
      qs("playerSearchModalMsg").className = "form-message error";
      button.disabled = false;
    }
  };
}

function renderParticipantNameFields(count) {
  const box = qs("participantNameFields");
  if (!box) return;
  box.innerHTML = "";

  for (let index = 0; index < count; index++) {
    const label = document.createElement("label");
    label.className = "field-label";
    label.htmlFor = `participantName${index}`;
    label.textContent = count === 1 ? "Nome e cognome" : `Nome e cognome partecipante ${index + 1}`;

    const input = document.createElement("input");
    input.id = `participantName${index}`;
    input.className = "participant-name-input";
    input.autocomplete = "name";
    input.maxLength = 80;
    input.placeholder = "Nome e cognome";

    box.append(label, input);
  }
}

function openJoinPlayerSearch(searchId) {
  const search = STATE.playerSearches.find(item => item.id === searchId);
  if (!search || search.spotsAvailable <= 0) return;

  const options = Array.from({ length: search.spotsAvailable }, (_, index) => {
    const value = index + 1;
    return `<option value="${value}">${value}</option>`;
  }).join("");

  openAppModal("Richiedi di partecipare", `
    ${searchSummaryHTML(search)}
    <label class="field-label" for="joinCount">Quante persone partecipano?</label>
    <select id="joinCount">${options}</select>

    <div id="participantNameFields" class="participant-fields"></div>

    <label class="field-label" for="joinPhone">Numero di telefono di riferimento</label>
    <input id="joinPhone" type="tel" autocomplete="tel" maxlength="30" placeholder="Es. 333 1234567">
    <p class="modal-help">Il nome e il numero saranno visibili solamente a chi ha prenotato il campo, così potrà accettare la richiesta e contattarti.</p>

    <button id="sendJoinRequestBtn" class="btn btn-book" type="button">Invia richiesta</button>
    <div id="playerSearchModalMsg" class="form-message" aria-live="polite"></div>
  `);

  renderParticipantNameFields(1);
  qs("joinCount").onchange = () => renderParticipantNameFields(Number(qs("joinCount").value));

  qs("sendJoinRequestBtn").onclick = async () => {
    const participantNames = [...document.querySelectorAll(".participant-name-input")]
      .map(input => input.value.trim());
    const phone = qs("joinPhone").value.trim();
    const messageBox = qs("playerSearchModalMsg");

    if (participantNames.some(name => name.length < 2) || phone.length < 6) {
      messageBox.textContent = "Inserisci tutti i nomi e un numero di telefono valido";
      messageBox.className = "form-message error";
      return;
    }

    const button = qs("sendJoinRequestBtn");
    button.disabled = true;

    try {
      await api(`/player-searches/${encodeURIComponent(searchId)}/requests`, {
        method: "POST",
        body: JSON.stringify({ participantNames, phone })
      });
      await loadPlayerSearches();
      closeAppModal();
    } catch (error) {
      const messages = {
        ALREADY_REQUESTED: "Hai già inviato una richiesta per questa partita",
        NOT_ENOUGH_SPOTS: "Non ci sono più abbastanza posti disponibili",
        CANNOT_JOIN_OWN_SEARCH: "Non puoi partecipare alla tua stessa ricerca"
      };
      messageBox.textContent = messages[error?.error] || "Invio della richiesta non riuscito";
      messageBox.className = "form-message error";
      button.disabled = false;
    }
  };
}

function whatsappNumber(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("3")) digits = `39${digits}`;
  return digits;
}

function openManagePlayerSearch(searchId) {
  const search = STATE.playerSearches.find(item => item.id === searchId);
  if (!search) return;

  const requests = search.requests || [];
  const requestCards = requests.length === 0
    ? '<div class="empty-state">Non hai ancora ricevuto richieste</div>'
    : requests.map(request => {
        const phoneHref = escapeHTML(String(request.phone || "").replace(/[^0-9+]/g, ""));
        const waNumber = whatsappNumber(request.phone);
        return `
          <div class="item player-request-card">
            <div class="request-card-top">
              <div class="request-card-main">
                <div class="game-field">${request.count} ${request.count === 1 ? "partecipante" : "partecipanti"}</div>
                <div class="player-names">${request.participantNames.map(escapeHTML).join("<br>")}</div>
              </div>
              <span class="request-status ${escapeHTML(request.status)}">${escapeHTML(requestStatusLabel(request.status))}</span>
            </div>
            <div class="contact-row">
              <a class="contact-link" href="tel:${phoneHref}">${escapeHTML(request.phone)}</a>
              ${waNumber ? `<a class="contact-link" href="https://wa.me/${waNumber}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}
            </div>
            ${request.status === "pending" ? `
              <div class="request-actions">
                <button class="btn-ghost btn-accept request-decision" data-request-id="${escapeHTML(request.id)}" data-status="accepted" type="button">Accetta</button>
                <button class="btn-ghost btn-reject request-decision" data-request-id="${escapeHTML(request.id)}" data-status="rejected" type="button">Rifiuta</button>
              </div>
            ` : ""}
          </div>
        `;
      }).join("");

  openAppModal("Gestisci giocatori", `
    ${searchSummaryHTML(search)}
    <div class="game-card-footer" style="margin: 0 0 14px;">
      <span class="spots-pill">${search.spotsAvailable} ${search.spotsAvailable === 1 ? "posto libero" : "posti liberi"}</span>
      <span class="request-status ${search.status === "open" ? "accepted" : "closed"}">${search.status === "open" ? "Ricerca attiva" : search.status === "full" ? "Gruppo completo" : "Ricerca chiusa"}</span>
    </div>
    <div id="manageRequestsList">${requestCards}</div>
    ${search.status === "open" ? '<button id="closePlayerSearchBtn" class="btn-ghost btn-book" type="button">Chiudi la ricerca</button>' : ""}
    <div id="playerSearchModalMsg" class="form-message" aria-live="polite"></div>
  `);

  document.querySelectorAll(".request-decision").forEach(button => {
    button.onclick = () => decideJoinRequest(search.id, button.dataset.requestId, button.dataset.status);
  });

  const closeButton = qs("closePlayerSearchBtn");
  if (closeButton) closeButton.onclick = () => closePlayerSearch(search.id);
}

async function decideJoinRequest(searchId, requestId, status) {
  const messageBox = qs("playerSearchModalMsg");
  try {
    await api(`/player-searches/${encodeURIComponent(searchId)}/requests/${encodeURIComponent(requestId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await loadPlayerSearches();
    openManagePlayerSearch(searchId);
  } catch (error) {
    messageBox.textContent = error?.error === "NOT_ENOUGH_SPOTS"
      ? "Non ci sono abbastanza posti per accettare questa richiesta"
      : "Operazione non riuscita";
    messageBox.className = "form-message error";
  }
}

async function closePlayerSearch(searchId) {
  if (!confirm("Chiudere la ricerca giocatori? Le richieste ancora in attesa verranno rifiutate.")) return;

  try {
    await api(`/player-searches/${encodeURIComponent(searchId)}`, { method: "DELETE" });
    await loadPlayerSearches();
    closeAppModal();
  } catch {
    const messageBox = qs("playerSearchModalMsg");
    messageBox.textContent = "Non è stato possibile chiudere la ricerca";
    messageBox.className = "form-message error";
  }
}

async function cancelJoinRequest(searchId, requestId) {
  if (!confirm("Annullare la richiesta di partecipazione?")) return;
  try {
    await api(`/player-searches/${encodeURIComponent(searchId)}/requests/${encodeURIComponent(requestId)}`, {
      method: "DELETE"
    });
    await loadPlayerSearches();
  } catch {
    alert("Non è stato possibile annullare la richiesta");
  }
}

/* ================= CREDITI ================= */
async function refreshCredits() {
  const me = await api("/me");
  STATE.me.credits = me.credits;
  qs("creditsBox").textContent = `${me.credits} ${Number(me.credits) === 1 ? "credito disponibile" : "crediti disponibili"}`;
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
  const list = qs("usersList");
  list.innerHTML = "";

  const users = STATE.users.filter(user =>
    user.username.toLowerCase().includes(filter.toLowerCase())
  );

  if (users.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nessun utente trovato";
    list.appendChild(empty);
    return;
  }

  users.forEach(user => {
    const item = document.createElement("div");
    item.className = "item";

    const info = document.createElement("div");
    info.style.width = "100%";
    info.innerHTML = `
      <strong>${escapeHTML(user.username)}</strong>
      <div class="muted">${user.credits} crediti · ${user.disabled ? "disabilitato" : "attivo"}</div>
      <input type="text" placeholder="Nuovo username" class="rename-input">
    `;
    item.appendChild(info);

    const edit = document.createElement("button");
    edit.className = "btn-ghost";
    edit.textContent = "Crediti";
    edit.onclick = async () => {
      const value = prompt("Nuovi crediti", user.credits);
      if (value === null || !Number.isFinite(Number(value))) return;
      await api("/admin/users/credits", {
        method: "PUT",
        body: JSON.stringify({
          username: user.username,
          delta: Number(value) - Number(user.credits)
        })
      });
      await loadUsers();
    };

    const rename = document.createElement("button");
    rename.className = "btn-ghost";
    rename.textContent = "Rinomina";
    rename.onclick = async () => {
      const newUsername = item.querySelector(".rename-input").value.trim();
      if (!newUsername) {
        alert("Inserisci il nuovo username");
        return;
      }
      if (!confirm(`Rinominare ${user.username} in ${newUsername}?`)) return;

      try {
        await api("/admin/users/rename", {
          method: "POST",
          body: JSON.stringify({ oldUsername: user.username, newUsername })
        });
        await loadUsers();
      } catch (error) {
        alert(error?.error === "USERNAME_TAKEN" ? "Username già utilizzato" : "Rinomina non riuscita");
      }
    };

    const reset = document.createElement("button");
    reset.className = "btn-ghost";
    reset.textContent = "Password";
    reset.onclick = async () => {
      const newPassword = prompt("Nuova password");
      if (!newPassword) return;
      await api("/admin/users/password", {
        method: "PUT",
        body: JSON.stringify({ username: user.username, newPassword })
      });
      alert("Password aggiornata");
    };

    const toggle = document.createElement("button");
    toggle.className = "btn-ghost";
    toggle.textContent = user.disabled ? "Abilita" : "Disabilita";
    toggle.onclick = async () => {
      await api("/admin/users/status", {
        method: "PUT",
        body: JSON.stringify({ username: user.username, disabled: !user.disabled })
      });
      await loadUsers();
    };

    item.append(edit, rename, reset, toggle);
    list.appendChild(item);
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
  qs("appModalClose").onclick = closeAppModal;
  qs("appModal").addEventListener("click", event => {
    if (event.target.dataset.closeModal === "true") closeAppModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !qs("appModal").classList.contains("hidden")) closeAppModal();
  });

  [qs("username"), qs("password")].forEach(input => {
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") login();
    });
  });

  qs("datePick").onchange = () => {
    setBookMessage();
    loadReservations();
  };
  qs("timeSelect").onchange = () => {
    setBookMessage();
    updateBookingPreview();
    renderFieldInfo({ preserveScroll: false });
  };
  qs("fieldSelect").onchange = () => {
    setBookMessage();
    renderTimeSelect();
    renderFieldInfo({ preserveScroll: false });
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

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(error => {
      console.warn("Service worker non registrato", error);
    });
  }

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
