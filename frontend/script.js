/***********************
 * CONFIG
 ***********************/
const API_BASE = "/api";

const TIME_SLOTS = [
  "08:45","09:30","10:15",
  "11:00","11:45","12:30","13:15",
  "14:00","14:45","15:30","16:15",
  "17:00","17:45","18:30","19:15"
];
const SLOT_LENGTH_MINUTES = 45;

// Meteo Senigallia
const METEO_LAT = 43.72;
const METEO_LON = 13.22;

/***********************
 * STATE
 ***********************/
let currentUser = null; // { username, role, credits }
let maxBookingsPerUser = 2;
let fieldsList = [
  { id: "BeachVolley", name: "Beach Volley" },
  { id: "Calcio", name: "Beach Soccer" },
  { id: "Multi", name: "Multi-Sport" }
];

let adminNotesText = "";
let adminImages = {}; // image1URL, image1Link, image1Caption ...
let reservations = {}; // map: reservations[fieldId][date][time] = username

let refreshTimer = null;


/* =========================
   API HELPER (CRITICO)
========================= */
async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include", // 🔥 OBBLIGATORIO
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || "API_ERROR");
  }

  return data;
}
/***********************
 * UTILS
 ***********************/
function getTodayDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function formatDateToDDMMYYYY(iso) {
  if (!iso) return "";
  const [yyyy, mm, dd] = iso.split("-");
  return `${dd}/${mm}/${yyyy}`;
}
function getSelectedDate() {
  const el = document.getElementById("booking-date");
  return el && el.value ? el.value : getTodayDate();
}
function showNotification(message, type = "info") {
  const container = document.getElementById("notification-container");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "notification " + (type || "info");
  div.textContent = message;
  container.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}
function toggleSections(isLoggedIn) {
  const loginArea = document.getElementById("login-area");
  const appArea = document.getElementById("app-area");
  if (!loginArea || !appArea) return;
  loginArea.style.display = isLoggedIn ? "none" : "block";
  appArea.style.display = isLoggedIn ? "block" : "none";
}
function isAdmin() {
  return currentUser && currentUser.role === "admin";
}

/***********************
 * THEME
 ***********************/
function applyThemeFromStorage() {
  const saved = localStorage.getItem("theme");
  document.documentElement.classList.toggle("light", saved === "light");
  updateThemeIcon();
}
function updateThemeIcon() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const icon = btn.querySelector("i");
  const isLight = document.documentElement.classList.contains("light");
  if (icon) icon.className = isLight ? "fas fa-sun" : "fas fa-moon";
}
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle("light");
  localStorage.setItem("theme", isLight ? "light" : "dark");
  updateThemeIcon();
}

/***********************
 * METEO
 ***********************/
function weatherCodeToEmoji(code){
  if ([0].includes(code)) return "☀️";
  if ([1,2].includes(code)) return "🌤️";
  if ([3].includes(code)) return "☁️";
  if ([45,48].includes(code)) return "🌫️";
  if ([51,53,55,56,57].includes(code)) return "🌦️";
  if ([61,63,65,66,67].includes(code)) return "🌧️";
  if ([71,73,75,77].includes(code)) return "❄️";
  if ([80,81,82].includes(code)) return "🌧️";
  if ([95,96,99].includes(code)) return "⛈️";
  return "🌡️";
}
async function loadDailyWeather(days = 6){
  const container = document.getElementById("weather-container");
  if (!container) return;
  container.innerHTML = "Caricamento meteo...";

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${METEO_LAT}&longitude=${METEO_LON}` +
      `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
      `&timezone=Europe%2FRome`;

    const res = await fetch(url);
    const data = await res.json();

    const t = data.daily?.time || [];
    const code = data.daily?.weathercode || [];
    const tmax = data.daily?.temperature_2m_max || [];
    const tmin = data.daily?.temperature_2m_min || [];

    container.innerHTML = "";
    for (let i = 0; i < Math.min(days, t.length); i++) {
      const card = document.createElement("div");
      card.style.padding = "8px 10px";
      card.style.borderRadius = "10px";
      card.style.border = "1px solid rgba(255,255,255,.15)";
      card.style.minWidth = "120px";

      const d = t[i];
      card.innerHTML = `
        <div style="font-weight:700;">${formatDateToDDMMYYYY(d)}</div>
        <div style="font-size:22px; margin:6px 0;">${weatherCodeToEmoji(code[i])}</div>
        <div style="opacity:.9;">${Math.round(tmin[i])}° / ${Math.round(tmax[i])}°</div>
      `;
      container.appendChild(card);
    }
  } catch (e) {
    container.innerHTML = "";
    showNotification("Errore meteo.", "error");
  }
}

/***********************
 * PUBLIC CONFIG (notes/images/fields/max)
 ***********************/
async function loadPublicConfig() {
  // endpoint: GET /api/public/config
  // ritorna: { maxBookingsPerUser, fields, notesText, images }
  const data = await api("/public/config");
  maxBookingsPerUser = Number(data.maxBookingsPerUser || 2);
  fieldsList = Array.isArray(data.fields) ? data.fields : fieldsList;
  adminNotesText = data.notesText || "";
  adminImages = data.images || {};

  // UI note
  const notesEl = document.getElementById("notes-content");
  if (notesEl) notesEl.textContent = adminNotesText;

  // immagini login/app
  renderLoginImages();
  renderAppImages();

  // UI admin inputs (se admin, poi li vediamo dopo login)
  const maxEl = document.getElementById("maxBookingsPerUser");
  if (maxEl) maxEl.value = String(maxBookingsPerUser);

  buildImagesForm(); // crea i 12 input admin
}

/***********************
 * IMMAGINI
 ***********************/
function figureForImage(url, link, cap, idx){
  const fig = document.createElement("figure");
  fig.classList.add("img-caption");

  const a = document.createElement("a");
  a.href = link || "#";
  a.target = "_blank";

  const img = document.createElement("img");
  img.src = url;
  img.alt = `Immagine ${idx}`;
  a.appendChild(img);
  fig.appendChild(a);

  if (cap) {
    const fc = document.createElement("figcaption");
    fc.textContent = cap;
    fig.appendChild(fc);
  }
  return fig;
}

function renderLoginImages(){
  const top = document.getElementById("login-images-container-top");
  const bottom = document.getElementById("login-images-container-bottom");
  if (!top || !bottom) return;

  top.innerHTML = "";
  bottom.innerHTML = "";

  for (let i = 1; i <= 12; i++) {
    const url = adminImages[`image${i}URL`] || "";
    const link = adminImages[`image${i}Link`] || "";
    const cap = adminImages[`image${i}Caption`] || "";
    if (!url) continue;
    const fig = figureForImage(url, link, cap, i);
    (i <= 8 ? top : bottom).appendChild(fig);
  }
}

function renderAppImages(){
  const container = document.getElementById("app-images-container");
  if (!container) return;
  container.innerHTML = "";

  // in app mostriamo 1..8
  for (let i = 1; i <= 8; i++) {
    const url = adminImages[`image${i}URL`] || "";
    const link = adminImages[`image${i}Link`] || "";
    const cap = adminImages[`image${i}Caption`] || "";
    if (!url) continue;
    container.appendChild(figureForImage(url, link, cap, i));
  }
}

function buildImagesForm(){
  const form = document.getElementById("images-form");
  if (!form) return;
  form.innerHTML = "";

  for (let i = 1; i <= 12; i++) {
    const wrap = document.createElement("div");
    wrap.style.border = "1px solid rgba(255,255,255,.15)";
    wrap.style.borderRadius = "12px";
    wrap.style.padding = "10px";
    wrap.style.marginBottom = "10px";

    wrap.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">Immagine ${i}</div>
      <label>URL:</label>
      <input id="image${i}URL" type="text" placeholder="https://..." style="width:100%; margin-bottom:6px;">
      <label>Link:</label>
      <input id="image${i}Link" type="text" placeholder="https://..." style="width:100%; margin-bottom:6px;">
      <label>Didascalia:</label>
      <input id="image${i}Caption" type="text" placeholder="Testo..." style="width:100%;">
    `;
    form.appendChild(wrap);
  }

  // riempi se già caricate
  for (let i = 1; i <= 12; i++) {
    const u = document.getElementById(`image${i}URL`);
    const l = document.getElementById(`image${i}Link`);
    const c = document.getElementById(`image${i}Caption`);
    if (u) u.value = adminImages[`image${i}URL`] || "";
    if (l) l.value = adminImages[`image${i}Link`] || "";
    if (c) c.value = adminImages[`image${i}Caption`] || "";
  }
}

/***********************
 * LOGIN / LOGOUT / SESSION RESTORE
 ***********************/
async function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!username || !password) {
    showNotification("Inserisci username e password.", "warn");
    return;
  }

  try {
    const me = await api("/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    currentUser = me;
    onLoggedIn();
    showNotification(`Benvenuto, ${me.username}!`, "success");
  } catch (e) {
    showNotification("Credenziali errate o utente disabilitato.", "error");
  }
}

async function logout() {
  if (!confirm("Vuoi davvero uscire?")) return;
  try { await api("/logout", { method: "POST" }); } catch {}
  currentUser = null;
  stopAutoRefresh();
  toggleSections(false);
  showNotification("Sei uscito con successo.", "success");
}

async function restoreSession() {
  try {
    const me = await api("/me");
    currentUser = me;
    onLoggedIn();
  } catch {
    // non loggato
  }
}

function onLoggedIn(){
  toggleSections(true);

  // admin area
  const adminArea = document.getElementById("admin-area");
  if (adminArea) adminArea.style.display = isAdmin() ? "block" : "none";

  // note textarea admin
  const ta = document.getElementById("admin-notes");
  if (ta && isAdmin()) ta.value = adminNotesText;

  // crediti UI
  updateUserCreditsUI();

  // carica prenotazioni data selezionata
  loadReservations();

  // refresh auto
  startAutoRefresh();

  // aggiorna tabelle admin se serve
  if (isAdmin()) {
    loadAdminUsers();
    populateAdminTable();
  }
}

function updateUserCreditsUI() {
  const el = document.getElementById("user-credits");
  if (!el) return;
  const credits = (currentUser && typeof currentUser.credits === "number") ? currentUser.credits : 0;
  el.textContent = `Crediti: ${credits}`;
}

/***********************
 * PRENOTAZIONI
 ***********************/
async function loadReservations(){
  const date = getSelectedDate();
  reservations = {};

  try {
    const data = await api(`/reservations?date=${encodeURIComponent(date)}`);
    // data.items: [{id, fieldId, date, time, user}]
    for (const r of (data.items || [])) {
      const f = r.fieldId;
      if (!reservations[f]) reservations[f] = {};
      if (!reservations[f][date]) reservations[f][date] = {};
      reservations[f][date][r.time] = r.user;
    }
    populateAllFields();
    populateAdminTable();
  } catch (e) {
    showNotification("Errore caricamento prenotazioni.", "error");
  }
}

function getUserTotalReservationsLocal(){
  // conta SOLO sulle prenotazioni del giorno selezionato
  if (!currentUser) return 0;
  const date = getSelectedDate();
  let count = 0;
  for (const f of Object.keys(reservations)) {
    const day = reservations[f]?.[date] || {};
    for (const t of Object.keys(day)) {
      if (day[t] === currentUser.username) count++;
    }
  }
  return count;
}

function askBookingConfirmation(fieldName, slot, date){
  return confirm(`Confermi la prenotazione per ${fieldName} alle ${slot} del ${formatDateToDDMMYYYY(date)}?`);
}

async function bookSlot(fieldId, slot){
  if (!currentUser) return;

  const date = getSelectedDate();
  const today = getTodayDate();
  const now = new Date();

  if (date < today) {
    showNotification("Non puoi prenotare per giorni passati!", "warn");
    return;
  }

  if (date === today) {
    const slotStart = new Date(`${date}T${slot}:00`);
    const slotEnd = new Date(slotStart.getTime() + SLOT_LENGTH_MINUTES * 60000);
    if (now >= slotEnd) {
      showNotification("Non puoi prenotare uno slot già terminato!", "warn");
      return;
    }
  }

  if (!askBookingConfirmation(fieldId, slot, date)) return;

  // limiti user (admin no)
  if (!isAdmin()) {
    const total = getUserTotalReservationsLocal();
    if (total >= maxBookingsPerUser) {
      showNotification(`Hai già raggiunto il numero massimo di prenotazioni (${maxBookingsPerUser}).`, "warn");
      return;
    }
    if ((currentUser.credits || 0) <= 0) {
      showNotification("Non hai crediti sufficienti.", "error");
      return;
    }
  }

  try {
    await api("/reservations", {
      method: "POST",
      body: JSON.stringify({ fieldId, date, time: slot })
    });

    // backend scala crediti per user
    if (!isAdmin()) currentUser.credits = Math.max(0, (currentUser.credits || 0) - 1);
    updateUserCreditsUI();

    showNotification(`Prenotazione salvata per ${fieldId} alle ${slot}`, "success");
    await loadReservations();
  } catch (e) {
    if (e.message === "SLOT_TAKEN") showNotification("Slot già occupato.", "error");
    else if (e.message === "NO_CREDITS") showNotification("Non hai crediti sufficienti.", "error");
    else showNotification("Errore nel salvataggio della prenotazione.", "error");
  }
}

async function cancelUserReservation(fieldId, slot){
  const date = getSelectedDate();
  const today = getTodayDate();

  if (!currentUser) return;

  // trova l'id prenotazione con una lookup: ricarico e poi cerco
  await loadReservations();

  // se non è prenotato da lui e non è admin -> niente
  const bookedUser = reservations[fieldId]?.[date]?.[slot] || null;
  if (!bookedUser) return;

  const isMine = bookedUser === currentUser.username;
  if (!isMine && !isAdmin()) {
    showNotification("Non puoi annullare prenotazioni altrui.", "error");
    return;
  }

  if (date === today && !confirm("Se annulli una prenotazione odierna, il credito non verrà rimborsato. Vuoi procedere?")) {
    return;
  }

  // ricostruisco docId come fa il backend:
  // backend usa id = `${fieldId}_${date}_${time}` (vedi backend che ti ho dato)
  const reservationId = `${fieldId}_${date}_${slot}`;

  try {
    await api(`/reservations/${encodeURIComponent(reservationId)}`, { method: "DELETE" });

    // rimborso crediti? nel backend NON lo facciamo (perché vuoi manualità),
    // ma qui mantengo la tua vecchia logica: se cancelli FUTURO e sei user, rimborso +1.
    if (!isAdmin() && date > today) {
      // endpoint admin-only non serve: questo è rimborso automatico
      // SE vuoi togliere anche questo, dimmelo e lo elimino.
      currentUser.credits = (currentUser.credits || 0) + 1;
      updateUserCreditsUI();
    }

    showNotification(`Prenotazione annullata per ${fieldId} alle ${slot}`, "success");
    await loadReservations();
  } catch (e) {
    showNotification("Errore durante la cancellazione.", "error");
  }
}

/***********************
 * UI CAMPI & SLOT
 ***********************/
function populateAllFields(){
  const container = document.getElementById("fields-container");
  if (!container) return;

  const date = getSelectedDate();
  container.innerHTML = "";

  fieldsList.forEach(fieldObj => {
    const fieldId = fieldObj.id;
    const fieldName = fieldObj.name || fieldId;

    const wrap = document.createElement("div");
    wrap.id = `field-${fieldId}`;
    wrap.style.border = "1px solid rgba(255,255,255,.15)";
    wrap.style.borderRadius = "14px";
    wrap.style.padding = "12px";
    wrap.style.marginBottom = "12px";

    const title = document.createElement("h3");
    title.textContent = fieldName;
    title.style.cursor = "pointer";
    wrap.appendChild(title);

    const slotsDiv = document.createElement("div");
    slotsDiv.id = `slots-${fieldId}`;
    slotsDiv.style.marginTop = "10px";
    slotsDiv.classList.add("hidden");

    TIME_SLOTS.forEach(slot => {
      const slotId = `slot-${fieldId}-${slot.replace(":","")}`;
      const btn = document.createElement("button");
      btn.id = slotId;
      btn.style.margin = "6px 6px 0 0";

      const bookedBy = reservations[fieldId]?.[date]?.[slot] || null;

      if (!bookedBy) {
        btn.textContent = `${slot} - Libero`;
        btn.onclick = () => bookSlot(fieldId, slot);
      } else {
        const mine = currentUser && bookedBy === currentUser.username;
        btn.textContent = `${slot} - Occupato (${bookedBy})`;
        btn.disabled = !mine && !isAdmin();
        btn.onclick = () => cancelUserReservation(fieldId, slot);
      }

      slotsDiv.appendChild(btn);
    });

    title.addEventListener("click", () => {
      slotsDiv.classList.toggle("hidden");
    });

    wrap.appendChild(slotsDiv);
    container.appendChild(wrap);
  });
}

/***********************
 * ADMIN: CONFIG / FIELDS / NOTES / IMAGES / USERS
 ***********************/
async function saveBookingParameters(){
  if (!isAdmin()) return showNotification("Non hai i permessi.", "error");
  const el = document.getElementById("maxBookingsPerUser");
  const v = parseInt(el.value, 10);
  if (isNaN(v) || v < 1) return showNotification("Valore non valido.", "warn");

  try {
    await api("/admin/config", {
      method: "PUT",
      body: JSON.stringify({ maxBookingsPerUser: v })
    });
    maxBookingsPerUser = v;
    showNotification("Parametri salvati.", "success");
  } catch {
    showNotification("Errore salvataggio parametri.", "error");
  }
}

function displayFieldConfigInAdmin(){
  const container = document.getElementById("field-config-container");
  if (!container) return;
  container.innerHTML = "";

  fieldsList.forEach((f, idx) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginBottom = "8px";
    row.innerHTML = `
      <input id="fieldId-${idx}" placeholder="ID" value="${f.id}" style="width:140px;">
      <input id="fieldName-${idx}" placeholder="Nome" value="${f.name}" style="flex:1;">
      <button id="removeField-${idx}">Rimuovi</button>
    `;
    container.appendChild(row);
    row.querySelector(`#removeField-${idx}`).onclick = () => {
      fieldsList.splice(idx, 1);
      displayFieldConfigInAdmin();
    };
  });
}

function addFieldRow(){
  fieldsList.push({ id: "", name: "" });
  displayFieldConfigInAdmin();
}

async function saveFieldConfig(){
  if (!isAdmin()) return showNotification("Non hai i permessi.", "error");

  // leggo input
  const cleaned = [];
  for (let i = 0; i < fieldsList.length; i++) {
    const idEl = document.getElementById(`fieldId-${i}`);
    const nameEl = document.getElementById(`fieldName-${i}`);
    if (!idEl || !nameEl) continue;
    const id = idEl.value.trim();
    const name = nameEl.value.trim();
    if (!id || !name) continue;
    cleaned.push({ id, name });
  }

  try {
    await api("/admin/fields", {
      method: "PUT",
      body: JSON.stringify({ fields: cleaned })
    });
    fieldsList = cleaned;
    showNotification("Campi salvati.", "success");
    populateAllFields();
    displayFieldConfigInAdmin();
  } catch {
    showNotification("Errore salvataggio campi.", "error");
  }
}

async function saveAdminNotes(){
  if (!isAdmin()) return showNotification("Non hai i permessi.", "error");
  const text = (document.getElementById("admin-notes")?.value || "");
  try {
    await api("/admin/notes", { method:"PUT", body: JSON.stringify({ text }) });
    adminNotesText = text;
    const notesEl = document.getElementById("notes-content");
    if (notesEl) notesEl.textContent = adminNotesText;
    showNotification("Note salvate.", "success");
  } catch {
    showNotification("Errore salvataggio note.", "error");
  }
}

async function saveAdminImages(){
  if (!isAdmin()) return showNotification("Non hai i permessi.", "error");

  const payload = {};
  for (let i = 1; i <= 12; i++) {
    payload[`image${i}URL`] = (document.getElementById(`image${i}URL`)?.value || "").trim();
    payload[`image${i}Link`] = (document.getElementById(`image${i}Link`)?.value || "").trim();
    payload[`image${i}Caption`] = (document.getElementById(`image${i}Caption`)?.value || "").trim();
  }

  try {
    await api("/admin/images", { method:"PUT", body: JSON.stringify({ images: payload }) });
    adminImages = payload;
    renderLoginImages();
    renderAppImages();
    showNotification("Immagini salvate.", "success");
  } catch {
    showNotification("Errore salvataggio immagini.", "error");
  }
}

async function loadAdminUsers(){
  if (!isAdmin()) return;
  try {
    const data = await api("/admin/users"); // {items:[{username, credits, disabled, role}]}
    populateCredentialsTable(data.items || []);
  } catch {
    showNotification("Errore caricamento utenti.", "error");
  }
}

function populateCredentialsTable(items){
  const tbody = document.getElementById("credentials-table");
  if (!tbody) return;
  tbody.innerHTML = "";

  // ordina “ombrelloneXX / userXX” come facevi
  items.sort((a,b)=>{
    const getNum = (id) => {
      const lower = id.toLowerCase();
      if (lower.startsWith("ombrellone")) return parseInt(id.slice("ombrellone".length),10) || 999999;
      if (lower.startsWith("user")) return parseInt(id.slice(4),10) || 999999;
      return 999999;
    };
    return getNum(a.username) - getNum(b.username);
  });

  for (const u of items) {
    const tr = document.createElement("tr");
    const statusTxt = u.disabled ? "Disabilitato" : "Attivo";

    tr.innerHTML = `
      <td>${u.username}</td>
      <td>${u.credits ?? 0}</td>
      <td>${statusTxt}</td>
      <td style="display:flex; gap:6px; flex-wrap:wrap;">
        <button data-act="cplus">+1</button>
        <button data-act="cminus">-1</button>
        <button data-act="toggle">${u.disabled ? "Attiva" : "Dis"}</button>
        <button data-act="pass">Mod Pass</button>
      </td>
    `;

    const btns = tr.querySelectorAll("button");
    btns.forEach(b=>{
      const act = b.dataset.act;
      if (act === "cplus") b.onclick = () => modifyUserCredits(u.username, +1);
      if (act === "cminus") b.onclick = () => modifyUserCredits(u.username, -1);
      if (act === "toggle") b.onclick = () => toggleUserStatus(u.username, u.disabled);
      if (act === "pass") b.onclick = () => modifyUserPassword(u.username);
    });

    tbody.appendChild(tr);
  }
}

async function modifyUserCredits(username, delta){
  if (!isAdmin()) return;
  try {
    await api("/admin/users/credits", {
      method: "PUT",
      body: JSON.stringify({ username, delta })
    });
    showNotification(`Crediti aggiornati per ${username}`, "success");
    await loadAdminUsers();
  } catch {
    showNotification("Errore aggiornamento crediti.", "error");
  }
}

async function toggleUserStatus(username, isDisabled){
  if (!isAdmin()) return;
  try {
    await api("/admin/users/status", {
      method: "PUT",
      body: JSON.stringify({ username, disabled: !isDisabled })
    });
    showNotification(`Stato aggiornato per ${username}`, "success");
    await loadAdminUsers();
  } catch {
    showNotification("Errore aggiornamento stato.", "error");
  }
}

async function modifyUserPassword(username){
  if (!isAdmin()) return;
  const newPassword = prompt(`Inserisci la nuova password per ${username}:`);
  if (!newPassword) return;

  try {
    await api("/admin/users/password", {
      method: "PUT",
      body: JSON.stringify({ username, newPassword })
    });
    showNotification(`Password aggiornata per ${username}`, "success");
  } catch {
    showNotification("Errore aggiornamento password.", "error");
  }
}

/***********************
 * ADMIN TABLE (prenotazioni giorno selezionato)
 ***********************/
function populateAdminTable(){
  const tbody = document.getElementById("admin-table");
  if (!tbody) return;
  tbody.innerHTML = "";

  const date = getSelectedDate();
  const displayedDate = formatDateToDDMMYYYY(date);

  for (const fieldId of Object.keys(reservations)) {
    const day = reservations[fieldId]?.[date];
    if (!day) continue;

    for (const time of Object.keys(day)) {
      const user = day[time];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fieldId}</td>
        <td>${displayedDate}</td>
        <td>${time}</td>
        <td>${user}</td>
        <td>
          <button class="cancel-btn">C</button>
        </td>
      `;
      tr.querySelector("button").onclick = () => deleteAdminReservation(fieldId, date, time, user);
      tbody.appendChild(tr);
    }
  }
}

async function deleteAdminReservation(fieldId, date, time, user){
  if (!isAdmin()) return showNotification("Admin only.", "error");
  const id = `${fieldId}_${date}_${time}`;
  try {
    await api(`/reservations/${encodeURIComponent(id)}`, { method:"DELETE" });
    showNotification(`Prenotazione eliminata (${fieldId} ${time} ${user})`, "success");
    await loadReservations();
  } catch {
    showNotification("Errore durante la cancellazione.", "error");
  }
}

/***********************
 * AUTO REFRESH (al posto del realtime Firestore)
 ***********************/
function startAutoRefresh(){
  stopAutoRefresh();
  refreshTimer = setInterval(async () => {
    if (!currentUser) return;
    try {
      // aggiorna me (crediti ecc)
      const me = await api("/me");
      currentUser = me;
      updateUserCreditsUI();

      // aggiorna prenotazioni
      await loadReservations();

      // admin: utenti ogni tanto
      if (isAdmin()) await loadAdminUsers();
    } catch {}
  }, 8000);
}
function stopAutoRefresh(){
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

/***********************
 * ADMIN TOGGLES
 ***********************/
function setupAdminSectionToggles(){
  document.querySelectorAll(".admin-toggle").forEach(title=>{
    const targetId = title.dataset.target;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.classList.add("hidden");
    title.style.cursor = "pointer";
    title.addEventListener("click", ()=> target.classList.toggle("hidden"));
  });
}

/***********************
 * INIT
 ***********************/
document.addEventListener("DOMContentLoaded", async () => {
  applyThemeFromStorage();

  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
  document.getElementById("login-btn")?.addEventListener("click", login);
  document.getElementById("logout-btn")?.addEventListener("click", (e)=>{ e.preventDefault(); logout(); });

  // admin buttons
  document.getElementById("save-max-bookings")?.addEventListener("click", saveBookingParameters);
  document.getElementById("add-field")?.addEventListener("click", addFieldRow);
  document.getElementById("save-fields")?.addEventListener("click", saveFieldConfig);
  document.getElementById("save-notes")?.addEventListener("click", saveAdminNotes);
  document.getElementById("save-images")?.addEventListener("click", saveAdminImages);

  setupAdminSectionToggles();

  // date picker
  const datePicker = document.getElementById("booking-date");
  const today = getTodayDate();
  if (datePicker) {
    datePicker.value = today;
    datePicker.min = today;
    datePicker.addEventListener("change", () => loadReservations());
  }

  // meteo
  loadDailyWeather(6);

  // carica config pubblico (note/images/fields/max)
  try {
    await loadPublicConfig();
    displayFieldConfigInAdmin(); // prepara UI admin campi
  } catch (e) {
    showNotification("Errore caricamento configurazione.", "error");
  }

  // prova ripristino sessione
  await restoreSession();
});
