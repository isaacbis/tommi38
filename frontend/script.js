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
  playerSearches: [],
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

/* Keep lists within a phone-sized page without removing items or their actions. */
const listPages = new Map();
function paginateList(id, options = {}) {
  const list = qs(id);
  if (!list) return;
  const compact = window.innerWidth <= 760;
  const tall = window.innerHeight >= 760;
  const defaultSize = id === 'timeGrid' ? (compact ? (tall ? 9 : 6) : 15)
    : id === 'fieldButtons' ? (compact ? 2 : 5)
    : id === 'establishmentList' ? (compact ? 4 : 8)
    : id === 'creditHistory' ? (compact ? 3 : 8)
    : compact ? (tall ? 2 : 1) : 5;
  const size = Math.max(1, Number(options.pageSize) || defaultSize);
  const items = Array.from(list.children);
  let state = listPages.get(id);
  if (!items.length && state) { state.nav.classList.add('hidden'); return; }
  const scope = [typeof selectedEstablishment === 'undefined' ? '' : selectedEstablishment,STATE.me?.username,
    id === 'timeGrid' ? qs('datePick')?.value + ':' + qs('fieldSelect')?.value : '',
    id === 'agendaList' ? qs('agendaDate')?.value + ':' + qs('agendaField')?.value : ''].join(':');
  const signature = scope + '|' + items.map(item => item.dataset.time || item.dataset.id || item.textContent).join('\u001f');
  if (!state) {
    const nav = document.createElement('nav');
    nav.className = 'list-pager';
    nav.setAttribute('aria-label', 'Pagine ' + ({timeGrid:'orari',fieldButtons:'campi',usersList:'utenti',agendaList:'prenotazioni',platformEstablishmentList:'stabilimenti'}[id] || 'elenco'));
    const previous = document.createElement('button');
    previous.type = 'button'; previous.className = 'secondary-btn pager-previous'; previous.textContent = '‹'; previous.setAttribute('aria-label','Pagina precedente');
    const status = document.createElement('span'); status.className = 'pager-status'; status.setAttribute('role','status');
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'secondary-btn pager-next'; next.textContent = '›'; next.setAttribute('aria-label','Pagina successiva');
    nav.append(previous,status,next);
    state = {page:0,signature,nav,previous,status,next,options};
    listPages.set(id,state);
    previous.onclick = () => { state.page--; paginateList(id,state.options); };
    next.onclick = () => { state.page++; paginateList(id,state.options); };
  }
  if (state.signature !== signature) state.page = 0;
  else if (state.size && state.size !== size) state.page = Math.floor(state.page*state.size/size);
  state.signature = signature;
  state.size = size;
  state.options = options;
  const pages = Math.ceil(items.length / size);
  state.page = Math.max(0,Math.min(state.page,pages-1));
  list.classList.add('paged-list');
  items.forEach((item,index) => item.classList.toggle('page-hidden',index < state.page*size || index >= (state.page+1)*size));
  if (list.nextElementSibling !== state.nav) list.after(state.nav);
  state.nav.classList.toggle('hidden',pages <= 1);
  state.previous.disabled = state.page === 0;
  state.next.disabled = state.page >= pages-1;
  state.status.textContent = `${state.page+1} / ${Math.max(1,pages)}`;
}

function initializeListPagination() {
  const ids = ['establishmentList','platformEstablishmentList','agendaList','usersList','fieldsList','galleryList','matchesList','openGamesList','ownedGamesList','myJoinRequestsList','timeGrid','fieldButtons','waitlistItems','creditHistory'];
  ids.forEach(id => {
    const list = qs(id);
    if (!list) return;
    const observer = new MutationObserver(() => paginateList(id,listPages.get(id)?.options));
    observer.observe(list,{childList:true});
    paginateList(id);
  });
  let resizing;
  window.addEventListener('resize',() => {
    clearTimeout(resizing);
    resizing = setTimeout(() => [...new Set([...ids,...listPages.keys()])].forEach(id => paginateList(id,listPages.get(id)?.options)),100);
  });
}

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
  if (error?.status === 403) return "Non hai accesso a questa funzione con il tuo account.";
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
  const epoch = typeof managementContextEpoch === 'undefined' ? 0 : managementContextEpoch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(API + path, {
      credentials: "include", cache: "no-store", ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Establishment": typeof selectedEstablishment === "undefined" ? "tommi38" : selectedEstablishment, ...options.headers }
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw { error: "INVALID_RESPONSE", status: response.status };
    }
    const data = await response.json();
    if (typeof managementContextEpoch !== 'undefined' && epoch !== managementContextEpoch) throw {error:'CONTEXT_CHANGED'};
    if (!response.ok) {
      if (response.status === 401 && STATE.me && path !== "/login" && (typeof managementContextEpoch === 'undefined' || epoch === managementContextEpoch)) {
        stopAutoRefresh();
        STATE.me = null;
        reservationRequest++;
        matchesRequest++;
        playersRequest++;
        STATE.playerSearches = [];
        resetManagementViews();
        closeAppModal();
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
  if (!publicConfigRequest) {
    const pending = api("/public/config").finally(() => { if(publicConfigRequest===pending)publicConfigRequest=null; });
    publicConfigRequest = pending;
  }
  return publicConfigRequest;
}

/* ===================== NATIVE BRIDGE ===================== */
function nativeMessage(payload) {
  if (typeof selectedEstablishment !== "undefined" && selectedEstablishment !== "tommi38" && payload.id) {
    payload = {...payload, id: selectedEstablishment + ":" + payload.id};
  }
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
  qs("bookingDock")?.classList.toggle("has-selection", Boolean(field && time));
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
  if (STATE.me?.platformAdmin) {
    selectedEstablishment='tommi38';
    try{localStorage.setItem('tommi38-establishment','tommi38');}catch{}
    applyEstablishmentName('Tommi38');
  }
  reservationRequest++;
  matchesRequest++;
  playersRequest++;
  STATE.playerSearches = [];
  resetManagementViews();
  closeAppModal();
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


/* ===================== LOAD APP ===================== */
async function loadAll(setToday = false) {
  const epoch = managementContextEpoch;
  const [me, pub] = await Promise.all([
    api("/me"),
    loadPublicConfig()
  ]);
  if (epoch !== managementContextEpoch) return;

  STATE.me = me;
  if (me.establishment?.name) applyEstablishmentName(me.establishment.name);
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
  qs("roleBadge").textContent = me.platformAdmin ? "Amministratore globale" : me.role === "admin" ? "Amministratore del tuo stabilimento" : "";
  me.role === "admin" || me.platformAdmin ? show(qs("roleBadge")) : hide(qs("roleBadge"));
  configureManagementAccess();
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
    qs("cfgRegistrationEnabled").checked = pub.registrationEnabled === true;
    qs("notesText").value = STATE.notes;
    renderFieldsAdmin();
    renderGalleryAdmin();
  } else {
    if (!me.platformAdmin) hide(qs("openAdminBtn"));
  }

  if (me.platformAdmin && !me.managementMode) await openPlatformEstablishments();
  else if (me.role === 'admin') openAdminShell();
  else {
    await Promise.all([loadReservations(),loadMyReservations()]);
    switchView("home", false);
  }
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
    STATE.closures = response.closures || [];
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
    const closure = (STATE.closures || []).find(c=>c.fieldId===fieldId && c.date===date && time<c.end && m+slot>minutes(c.start));
    const selectable = !past && !busy && !closure;
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
    button.disabled = past || Boolean(closure);
    button.dataset.time = time;
    button.innerHTML = `<strong>${escapeHTML(time)}</strong><small>${closure ? "Chiuso" : busy ? "Lista attesa" : past ? "Passato" : "Libero"}</small>`;

    if (closure) button.title = closure.reason;
    if (busy && !closure) button.addEventListener("click",()=>joinWaitlist(STATE.dayReservationsAll.find(r=>r.fieldId===fieldId && r.time===time)));
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
    await Promise.allSettled([refreshCredits(), loadReservations(), loadMyReservations(), loadPlayerSearches()]);
    setBookMessage(`Prenotazione confermata: ${field.name}, ore ${time}.`, "success");
  } catch (error) {
    const message =
      error?.error === "ACTIVE_BOOKING_LIMIT" ? "Hai raggiunto il limite di prenotazioni attive." :
      error?.error === "MAX_PER_DAY_LIMIT" ? "Hai raggiunto il limite di prenotazioni per questo giorno." :
      error?.error === "SLOT_TAKEN" ? "Questo orario è appena stato prenotato." :
      error?.error === "CONFIG_CHANGED" ? "Il gestore ha aggiornato gli orari. Aggiorna e scegli di nuovo." :
      error?.error === "NO_CREDITS" ? "Non hai crediti disponibili." :
      error?.error === "PAST_TIME_NOT_ALLOWED" ? "Questo orario è già iniziato." :
      error?.error === "NETWORK" || error?.error === "TIMEOUT" ? "Non abbiamo ricevuto conferma. Controlla Le mie partite prima di riprovare." :
      errorMessage(error);

    await loadReservations().catch(() => {});
    setBookMessage(message, "error");
  } finally {
    bookingBusy = false;
    qs("bookBtn").textContent = "Prenota";
    updateBookingPreview();
  }
}

async function deleteReservation(id) {
  if (deleting.has(id)) return;
  deleting.add(id);
  const item = STATE.myReservations.find(reservation => reservation.id === id);
  const refund = item?.creditsCharged === 0 || STATE.me?.role === "admin" ? "Questa prenotazione non ha consumato crediti." : item?.date > localISODate() ? "Riceverai il rimborso di 1 credito." : "Per le cancellazioni del giorno stesso non è previsto un rimborso.";
  if (!await confirmAction("Cancella la partita", "La prenotazione verrà rimossa e il campo tornerà disponibile.\n" + refund, "Cancella partita")) { deleting.delete(id); return; }

  try {
    await api(`/reservations/${encodeURIComponent(id)}`, { method: "DELETE" });
    cancelNativeBookingNotification(id);
    await Promise.allSettled([refreshCredits(), loadReservations(), loadMyReservations(), loadPlayerSearches()]);
  } catch (error) {
    qs("matchesStatus").textContent = errorMessage(error);
  } finally { deleting.delete(id); }
}

async function refreshCredits() {
  if (STATE.me?.managementMode) return;
  const venue = selectedEstablishment;
  const me = await api("/me");
  if (!STATE.me || STATE.me.username !== me.username || venue !== selectedEstablishment) return;
  STATE.me.credits = me.credits;
  qs("creditsBox").textContent = `${Number(me.credits || 0)} ${Number(me.credits) === 1 ? "credito" : "crediti"}`;
  updateBookingPreview();
}

/* ===================== MY MATCHES ===================== */
async function loadMyReservations() {
  if (!STATE.me || STATE.me.managementMode) return;
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
    const actions = document.createElement("div");
    actions.className = "match-actions";
    const repeat = document.createElement("button");
    repeat.type = "button";
    repeat.className = "secondary-btn";
    repeat.textContent = "Prenota di nuovo";
    repeat.onclick = () => {
      qs("fieldSelect").value = item.fieldId;
      STATE.selectedTime = "";
      renderFieldButtonsState();
      setDate(item.date >= localISODate() ? item.date : localISODate());
      switchView("book", false);
    };
    actions.appendChild(repeat);
    const search = STATE.playerSearches.find(search => search.reservationId === item.id);
    if (search || item.date > localISODate() || (item.date === localISODate() && (Number(item.time.slice(0, 2)) * 60 + Number(item.time.slice(3))) > nowMinutes())) {
      const players = document.createElement("button");
      players.type = "button";
      players.className = "secondary-btn";
      players.textContent = search ? "Gestisci giocatori" : "Cerca giocatori";
      players.onclick = () => search ? openManagePlayerSearch(search.id) : openCreatePlayerSearch(item.id);
      actions.appendChild(players);
    }
    actions.appendChild(button);
    card.appendChild(actions);
    box.appendChild(card);
  });
}

/* ================= CERCA GIOCATORI ================= */
let playersRequest = 0;
async function loadPlayerSearches() {
  if (!STATE.me || STATE.me.managementMode) return;
  const request = ++playersRequest;
  const user = STATE.me;
  try {
    const response = await api("/player-searches");
    if (request !== playersRequest || !user || STATE.me !== user) return;
    STATE.playerSearches = response.items || [];
    qs("playersStatus").textContent = "";
    renderPlayerSearches();
    renderMyReservations();
  } catch (error) {
    if (request === playersRequest && STATE.me) qs("playersStatus").textContent = errorMessage(error);
  }
}

function fieldNameById(fieldId) {
  return STATE.fields.find(field => field.id === fieldId)?.name || fieldId;
}

function requestStatusLabel(status) {
  if (status === "accepted") return "Accettata";
  if (status === "rejected") return "Rifiutata";
  if (status === "cancelled") return "Annullata";
  return "In attesa";
}

let activePlayersPanel = 'open';
function renderPlayersPanel() {
  const panels = {open:'openGamesWrap',owned:'ownedGamesWrap',requests:'myJoinRequestsWrap'};
  Object.entries(panels).forEach(([name,id]) => qs(id)?.classList.toggle('hidden',name!==activePlayersPanel));
  document.querySelectorAll('[data-player-panel]').forEach(button => {
    const selected = button.dataset.playerPanel === activePlayersPanel;
    button.classList.toggle('active',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
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
          <button class="secondary-btn btn-small join-game-btn" type="button">Richiedi di partecipare</button>
        </div>
      `;
      card.querySelector(".join-game-btn").onclick = () => openJoinPlayerSearch(search.id);
      openList.appendChild(card);
    });
  }

  const owned = qs("ownedGamesList");
  owned.innerHTML = "";
  STATE.playerSearches.filter(search => search.canManage).forEach(search => {
    const card = document.createElement("article");
    card.className = "game-card";
    const pending = search.requests.filter(request => request.status === "pending").length;
    card.innerHTML = `${searchSummaryHTML(search)}<div class="game-card-footer"><span class="spots-pill">${search.status === "closed" ? "Ricerca chiusa" : search.spotsAvailable + (search.spotsAvailable === 1 ? " posto libero" : " posti liberi")}${pending ? " · " + pending + " richieste" : ""}</span><button class="secondary-btn" type="button">Gestisci giocatori</button></div>`;
    card.querySelector("button").onclick = () => openManagePlayerSearch(search.id);
    owned.appendChild(card);
  });
  if (!owned.children.length) owned.innerHTML = '<p class="empty-state">Non hai ricerche da gestire.</p>';
  const myRequests = STATE.playerSearches.filter(search => search.myRequest);
  if (myRequests.length === 0) {
    myList.innerHTML = '<p class="empty-state">Non hai richieste di partecipazione.</p>';
    renderPlayersPanel();
    return;
  }

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
          ? '<button class="secondary-btn btn-small cancel-join-btn" type="button">Annulla richiesta</button>'
          : request.status === "rejected" && search.status === "open" && search.spotsAvailable > 0
          ? '<button class="secondary-btn btn-small retry-join-btn" type="button">Invia di nuovo</button>'
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
  renderPlayersPanel();
}

function openAppModal(title, html) {
  qs("appModalTitle").textContent = title;
  qs("appModalBody").innerHTML = html;
  if (!qs("appModal").open) qs("appModal").showModal();
  document.body.classList.add("modal-open");
  qs('appModal').scrollTop = 0;
  qs('appModalBody').scrollTop = 0;
  qs('appModalClose').focus({preventScroll:true});
}

function closeAppModal() {
  qs("appModal").close();
  qs("appModalBody").querySelectorAll('input[type="password"]').forEach(input=>{input.value='';});
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
  const reservation = STATE.myReservations.find(item => item.id === reservationId);
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

    <button id="createSearchBtn" class="primary-btn" type="button">Pubblica la ricerca</button>
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
    <p class="modal-help">Il nome e il numero saranno visibili all’organizzatore e al gestore, così potrà accettare la richiesta e contattarti.</p>

    <button id="sendJoinRequestBtn" class="primary-btn" type="button">Invia richiesta</button>
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
                <button class="secondary-btn btn-accept request-decision" data-request-id="${escapeHTML(request.id)}" data-status="accepted" type="button">Accetta</button>
                <button class="secondary-btn btn-reject request-decision" data-request-id="${escapeHTML(request.id)}" data-status="rejected" type="button">Rifiuta</button>
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
    ${search.status === "open" ? '<button id="closePlayerSearchBtn" class="secondary-btn btn-book" type="button">Chiudi la ricerca</button>' : ""}
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
  if (!await confirmAction("Chiudere la ricerca?", "Le richieste ancora in attesa verranno rifiutate.", "Chiudi ricerca")) return;

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
  if (!await confirmAction("Annullare la richiesta?", "Potrai inviarla di nuovo se ci saranno posti disponibili.", "Annulla richiesta")) return;
  try {
    await api(`/player-searches/${encodeURIComponent(searchId)}/requests/${encodeURIComponent(requestId)}`, {
      method: "DELETE"
    });
    await loadPlayerSearches();
  } catch {
    qs("playersStatus").textContent = "Non è stato possibile annullare la richiesta";
  }
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
  if (STATE.me?.managementMode) return openAdminShell();
  hide(qs("viewHome"));
  hide(qs("viewBook"));
  hide(qs("viewMatches"));
  hide(qs("viewPlayers"));
  hide(qs("viewAlerts"));
  hide(qs("adminShell"));
  hide(qs("managerNav"));
  show(qs("bottomNav"));

  const target = name === "home" ? qs("viewHome") : name === "players" ? qs("viewPlayers") : name === "matches" ? qs("viewMatches") : name === "alerts" ? qs("viewAlerts") : qs("viewBook");
  show(target);
  target.scrollTop = 0;
  target.classList.add("active-view");

  document.querySelectorAll(".bottom-nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === name);
    if (button.dataset.view === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (name === "home") loadHome();
  if (name === "book" && STATE.me && refresh) loadReservations();
  if (name === "matches") { loadMyReservations(); loadPlayerSearches(); }
  if (name === "players") loadPlayerSearches();
  if (name === "alerts") loadWeather();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openAdminShell(skipPlatformLoad = false) {
  if (STATE.me?.role !== "admin" && !STATE.me?.platformAdmin) return;
  hide(qs("viewHome"));
  hide(qs("viewBook"));
  hide(qs("viewMatches"));
  hide(qs("viewPlayers"));
  hide(qs("viewAlerts"));
  hide(qs("bottomNav"));
  show(qs("adminShell"));
  if(STATE.me.platformAdmin && !STATE.me.managementMode){
    hide(qs('managerNav'));
    openAdmin('adminEstablishments');
    if(skipPlatformLoad !== true)loadPlatformEstablishments();
    return;
  }
  show(qs('managerNav'));
  openAdmin("adminMenu");
  loadManagementSummary();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeAdminShell() {
  switchView("home");
}

function openAdmin(id) {
  ["adminMenu", "adminConfig", "adminNotes", "adminFields", "adminUsers", "adminGallery", "adminAgenda", "adminEstablishments"]
    .forEach(sectionId => hide(qs(sectionId)));
  show(qs(id));
  qs('adminShell').scrollTop = 0;
  qs(id).scrollTop = 0;
  document.querySelectorAll('#managerNav [data-admin-section]').forEach(button=>{
    const active=button.dataset.adminSection===id;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  window.scrollTo({top:0,behavior:'smooth'});
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
      maxActiveBookingsPerUser: Number(qs("cfgMaxActive").value),
      registrationEnabled: qs("cfgRegistrationEnabled").checked
    })
  });

  const pub = await loadPublicConfig();
  STATE.config = pub;
  qs("slotDurationLabel").textContent = `${currentSlotMinutes()} minuti`;
  await loadReservations();
  alert("Configurazione aggiornata.");
}

async function loadUsers() {
  const user = STATE.me;
  const venue = selectedEstablishment;
  const epoch = managementContextEpoch;
  const response = await api("/admin/users");
  if (user !== STATE.me || venue !== selectedEstablishment || epoch !== managementContextEpoch) return;
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
    main.innerHTML = `<strong>${escapeHTML(user.username)}</strong><span>${Number(user.credits || 0)} crediti · ${user.role === "admin" ? "gestore · " : ""}${user.pendingApproval ? "in attesa di approvazione" : user.disabled ? "disabilitato" : "attivo"}</span>`;

    const actions = document.createElement("div");
    actions.className = "admin-item-actions";

    const credits = adminButton("Crediti", () => openUserCredits(user));

    const password = adminButton("Password", () => openUserPassword(user));

    const rename = adminButton("Rinomina", async () => {
      const newUsername = prompt("Nuovo username", user.username)?.trim();
      if (!newUsername || newUsername === user.username) return;
      try {
        await api("/admin/users/rename", {
          method: "POST",
          body: JSON.stringify({ oldUsername: user.username, newUsername })
        });
        await loadUsers();
        closeAppModal();
      } catch (error) {
        alert(error?.error === "USERNAME_TAKEN" ? "Username già utilizzato." : "Rinomina non riuscita.");
      }
    });

    const toggle = adminButton(user.pendingApproval ? "Approva iscrizione" : user.disabled ? "Abilita" : "Disabilita", async () => {
      await api("/admin/users/status", {
        method: "PUT",
        body: JSON.stringify({ username: user.username, disabled: !user.disabled })
      });
      await loadUsers();
      closeAppModal();
    });

    if (user.platformAdmin) {
      const protectedLabel=document.createElement('p');protectedLabel.className='helper-text';protectedLabel.textContent='Amministratore globale · account protetto';actions.append(protectedLabel);
    } else {
      const manage = adminButton('Gestisci',() => {
        openAppModal('Gestisci ' + user.username,'<div id="userMenuActions" class="form-stack"></div>');
        qs('userMenuActions').append(password,rename,toggle);
        if(STATE.me?.platformAdmin)qs('userMenuActions').append(adminButton('Cambia ruolo',()=>openUserRole(user)));
      });
      actions.append(credits,manage);
    }
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
    try { await handler(); } catch (error) { alert(managementError(error)); }
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
    if(STATE.me.role==='admin' && !qs('adminShell').classList.contains('hidden')){
      if(!qs('adminAgenda').classList.contains('hidden'))await loadManagerAgenda();
      else if(!qs('adminMenu').classList.contains('hidden'))await loadManagementSummary();
      return;
    }
    if(STATE.me.managementMode)return;
    qs("datePick").min = localISODate();
    if (isPastDate(qs("datePick").value)) setDate(localISODate());
    const jobs = [refreshCredits()];
    if (!qs("viewHome").classList.contains("hidden")) jobs.push(loadHome());
    if (!qs("viewBook").classList.contains("hidden")) jobs.push(loadReservations());
    if (!qs("viewMatches").classList.contains("hidden")) jobs.push(loadMyReservations(), loadPlayerSearches());
    if (!qs("viewPlayers").classList.contains("hidden")) jobs.push(loadPlayerSearches());
    if (!qs("adminShell").classList.contains("hidden") && !qs("adminAgenda").classList.contains("hidden")) jobs.push(loadManagerAgenda());
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
  initializeListPagination();
  document.querySelectorAll('[data-player-panel]').forEach(button => {
    button.onclick = () => { activePlayersPanel = button.dataset.playerPanel; renderPlayersPanel(); };
  });
  qs("loginForm").onsubmit = event => { event.preventDefault(); login(); };
  qs("logoutBtn").onclick = logout;
  qs("passwordToggle").onclick = togglePassword;
  qs("loginBackBtn").onclick = () => chooseEstablishment().catch(e=>alert(errorMessage(e)));
  qs("loginChangeBtn").onclick = () => chooseEstablishment().catch(e=>alert(errorMessage(e)));
  qs("switchBathBtn").onclick = () => chooseEstablishment().catch(e=>alert(errorMessage(e)));

  qs("quickToday").onclick = () => setDate(localISODate());
  qs("quickTomorrow").onclick = () => setDate(tomorrowISODate());
  qs("datePick").onchange = () => {
    const date = qs("datePick").value;
    setDate(!date || isPastDate(date) ? localISODate() : date);
  };
  qs('fieldSelect').onchange = () => {
    STATE.selectedTime = '';
    renderFieldButtonsState();
    renderTimeGrid();
    updateBookingPreview();
    setBookMessage();
  };

  qs("bookBtn").onclick = book;
  qs("refreshMatchesBtn").onclick = () => { loadMyReservations(); loadPlayerSearches(); };
  qs("refreshPlayersBtn").onclick = loadPlayerSearches;
  qs("findPlayersBookingBtn").onclick = () => switchView("matches");
  qs("appModalClose").onclick = closeAppModal;
  qs("appModal").addEventListener("close", () => document.body.classList.remove("modal-open"));

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
    try { await handler(); } catch (error) { alert(managementError(error)); }
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

  initializeCommunity()
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
