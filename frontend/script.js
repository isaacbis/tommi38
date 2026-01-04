const API_BASE = "/api";

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP_${res.status}`);
  return data;
}

function qs(id){ return document.getElementById(id); }
function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }
function setText(id, t){ qs(id).textContent = t; }

let STATE = {
  me: null,
  config: null,
  fields: [],
  notesText: "",
  reservations: [],
  fieldsDraft: [],
  users: []
};

function todayISO(){
  const d = new Date();
  const pad = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function minutes(t){
  const [h,m]=String(t).split(":").map(Number);
  return h*60+m;
}
function timeStr(min){
  const h=String(Math.floor(min/60)).padStart(2,"0");
  const m=String(min%60).padStart(2,"0");
  return `${h}:${m}`;
}

async function login(){
  const username = qs("username").value.trim();
  const password = qs("password").value.trim();
  hide(qs("loginErr"));
  if(!username || !password){
    qs("loginErr").textContent = "Inserisci username e password";
    show(qs("loginErr"));
    return;
  }
  try{
    await api("/login",{ method:"POST", body: JSON.stringify({username,password}) });
    location.reload();
  }catch(e){
    qs("loginErr").textContent = "Login fallito";
    show(qs("loginErr"));
  }
}

async function logout(){
  try{ await api("/logout",{ method:"POST" }); }catch{}
  location.reload();
}

async function loadPublic(){
  const cfg = await api("/public/config",{ method:"GET" });
  STATE.config = cfg;
  STATE.fields = cfg.fields || [];
  STATE.notesText = cfg.notesText || "";
}

async function loadMe(){
  STATE.me = await api("/me",{ method:"GET" });
}

function renderHeader(){
  setText("welcome", `Ciao ${STATE.me.username}`);
  setText("creditsBox", `Crediti disponibili: ${STATE.me.credits}`);
  setText("roleBadge", STATE.me.role.toUpperCase());
  show(qs("logoutBtn"));
}

function renderTabs(){
  const adminBtn = qs("adminTabBtn");
  if (STATE.me.role !== "admin") {
    adminBtn.classList.add("hidden");
    hide(qs("adminTab"));
  } else {
    adminBtn.classList.remove("hidden");
  }
}

function setActiveTab(tabId){
  document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".card[id$='Tab']").forEach(p=>p.classList.add("hidden"));
  document.querySelector(`.tab[data-tab="${tabId}"]`).classList.add("active");
  show(qs(tabId));
}

function setActiveSub(subId){
  document.querySelectorAll(".subtab").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".subpanel").forEach(p=>p.classList.add("hidden"));
  document.querySelector(`.subtab[data-sub="${subId}"]`).classList.add("active");
  show(qs(subId));
}

/* -------- Booking UI -------- */
function renderFieldSelect(){
  const sel = qs("fieldSelect");
  sel.innerHTML = "";
  (STATE.fields || []).forEach(f=>{
    const opt=document.createElement("option");
    opt.value=f.id;
    opt.textContent=f.name;
    sel.appendChild(opt);
  });
}

function renderTimeSelect(){
  const sel = qs("timeSelect");
  sel.innerHTML = "";
  const slot = Number(STATE.config.slotMinutes || 45);
  const start = minutes(STATE.config.dayStart || "09:00");
  const end = minutes(STATE.config.dayEnd || "20:00");
  for(let m=start; m+slot<=end; m+=slot){
    const t=timeStr(m);
    const opt=document.createElement("option");
    opt.value=t;
    opt.textContent=t;
    sel.appendChild(opt);
  }
}

async function loadReservations(){
  const date = qs("datePick").value;
  const r = await api(`/reservations?date=${encodeURIComponent(date)}`,{ method:"GET" });
  STATE.reservations = r.items || [];
  renderReservations();
}

function renderReservations(){
  const list = qs("reservationsList");
  list.innerHTML = "";
  const mapField = new Map((STATE.fields||[]).map(f=>[f.id,f.name]));

  const items = [...STATE.reservations].sort((a,b)=>{
    if(a.time!==b.time) return a.time.localeCompare(b.time);
    return (a.fieldId||"").localeCompare(b.fieldId||"");
  });

  if(items.length===0){
    const d=document.createElement("div");
    d.className="muted";
    d.textContent="Nessuna prenotazione per questa data.";
    list.appendChild(d);
    return;
  }

  items.forEach(r=>{
    const div=document.createElement("div");
    div.className="item";

    const top=document.createElement("div");
    top.className="top";
    const left=document.createElement("div");
    left.innerHTML = `<b>${mapField.get(r.fieldId) || r.fieldId}</b> • ${r.time} — <span class="small">utente: ${r.user}</span>`;
    const actions=document.createElement("div");
    actions.className="actions";

    const canDelete = (STATE.me.role==="admin" || r.user===STATE.me.username);
    if(canDelete){
      const btn=document.createElement("button");
      btn.className="btn-ghost";
      btn.textContent="Cancella";
      btn.addEventListener("click", async ()=>{
        try{
          await api(`/reservations/${encodeURIComponent(r.id)}`,{ method:"DELETE" });
          await loadMe(); // aggiorna crediti se refund
          renderHeader();
          await loadReservations();
        }catch(e){
          alert("Errore cancellazione");
        }
      });
      actions.appendChild(btn);
    }

    top.appendChild(left);
    top.appendChild(actions);
    div.appendChild(top);
    list.appendChild(div);
  });
}

async function book(){
  const fieldId = qs("fieldSelect").value;
  const date = qs("datePick").value;
  const time = qs("timeSelect").value;

  setText("bookMsg","");
  try{
    await api("/reservations",{
      method:"POST",
      body: JSON.stringify({ fieldId, date, time })
    });
    await loadMe();
    renderHeader();
    await loadReservations();
    setText("bookMsg","Prenotazione effettuata ✅");
  }catch(e){
    const msg = String(e.message||"");
    if(msg.includes("NO_CREDITS")) setText("bookMsg","Crediti insufficienti ❌");
    else if(msg.includes("SLOT_TAKEN")) setText("bookMsg","Slot già occupato ❌");
    else if(msg.includes("DAILY_LIMIT")) setText("bookMsg","Limite giornaliero raggiunto ❌");
    else setText("bookMsg","Errore prenotazione ❌");
  }
}

/* -------- Admin UI -------- */
function renderAdminConfig(){
  qs("slotMinutes").value = STATE.config.slotMinutes;
  qs("dayStart").value = STATE.config.dayStart;
  qs("dayEnd").value = STATE.config.dayEnd;
  qs("maxPerDay").value = STATE.config.maxBookingsPerUserPerDay;
}

async function saveConfig(){
  setText("cfgMsg","");
  try{
    const payload = {
      slotMinutes: Number(qs("slotMinutes").value),
      dayStart: qs("dayStart").value,
      dayEnd: qs("dayEnd").value,
      maxBookingsPerUserPerDay: Number(qs("maxPerDay").value),
    };
    await api("/admin/config",{ method:"PUT", body: JSON.stringify(payload) });
    await loadPublic();
    renderTimeSelect();
    setText("cfgMsg","Config salvata ✅");
  }catch{
    setText("cfgMsg","Errore salvataggio config ❌");
  }
}

async function saveNotes(){
  setText("notesMsg","");
  try{
    await api("/admin/notes",{ method:"PUT", body: JSON.stringify({ text: qs("notesText").value }) });
    setText("notesMsg","Note salvate ✅");
  }catch{
    setText("notesMsg","Errore salvataggio note ❌");
  }
}

function renderFieldsAdmin(){
  const list = qs("fieldsList");
  list.innerHTML = "";
  if(STATE.fieldsDraft.length===0){
    const d=document.createElement("div");
    d.className="muted";
    d.textContent="Nessun campo. Aggiungine uno.";
    list.appendChild(d);
    return;
  }

  STATE.fieldsDraft.forEach((f,idx)=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="top">
        <div><b>${f.id}</b> — ${f.name}</div>
        <div class="actions"></div>
      </div>
    `;
    const actions = div.querySelector(".actions");

    const del=document.createElement("button");
    del.className="btn-ghost";
    del.textContent="Rimuovi";
    del.addEventListener("click", ()=>{
      STATE.fieldsDraft.splice(idx,1);
      renderFieldsAdmin();
    });

    actions.appendChild(del);
    list.appendChild(div);
  });
}

function addField(){
  const id = qs("newFieldId").value.trim();
  const name = qs("newFieldName").value.trim();
  if(!id || !name) return;
  if(STATE.fieldsDraft.some(f=>f.id===id)){
    alert("ID già esistente");
    return;
  }
  STATE.fieldsDraft.push({ id, name });
  qs("newFieldId").value="";
  qs("newFieldName").value="";
  renderFieldsAdmin();
}

async function saveFields(){
  setText("fieldsMsg","");
  try{
    await api("/admin/fields",{ method:"PUT", body: JSON.stringify({ fields: STATE.fieldsDraft }) });
    await loadPublic();
    STATE.fieldsDraft = [...STATE.fields];
    renderFieldSelect();
    setText("fieldsMsg","Campi salvati ✅");
    await loadReservations();
  }catch{
    setText("fieldsMsg","Errore salvataggio campi ❌");
  }
}

/* Users */
async function loadUsers(){
  const r = await api("/admin/users",{ method:"GET" });
  STATE.users = r.items || [];
  renderUsers();
}

function userRow(u){
  const div=document.createElement("div");
  div.className="item";
  div.innerHTML = `
    <div class="top">
      <div>
        <b>${u.username}</b>
        <span class="badge" style="margin-left:8px">${u.role}</span>
      </div>
      <div class="actions"></div>
    </div>
    <div class="small">Crediti: <b>${u.credits}</b> • Disabilitato: <b>${u.disabled ? "SI" : "NO"}</b></div>
  `;
  const actions=div.querySelector(".actions");

  const plus=document.createElement("button");
  plus.className="btn-ghost";
  plus.textContent="+10 crediti";
  plus.addEventListener("click", ()=>adjustCredits(u.username, 10));

  const minus=document.createElement("button");
  minus.className="btn-ghost";
  minus.textContent="-10 crediti";
  minus.addEventListener("click", ()=>adjustCredits(u.username, -10));

  const toggle=document.createElement("button");
  toggle.className="btn-ghost";
  toggle.textContent=u.disabled ? "Abilita" : "Disabilita";
  toggle.addEventListener("click", ()=>toggleUser(u.username, !u.disabled));

  const reset=document.createElement("button");
  reset.className="btn-ghost";
  reset.textContent="Reset password";
  reset.addEventListener("click", ()=>{
    const np = prompt("Nuova password per " + u.username);
    if(!np) return;
    resetPassword(u.username, np);
  });

  actions.append(plus, minus, toggle, reset);
  return div;
}

function renderUsers(){
  const list=qs("usersList");
  list.innerHTML="";
  if(STATE.users.length===0){
    const d=document.createElement("div");
    d.className="muted";
    d.textContent="Nessun utente trovato.";
    list.appendChild(d);
    return;
  }
  STATE.users.forEach(u=>list.appendChild(userRow(u)));
}

async function createUser(){
  setText("createUserMsg","");
  try{
    const payload = {
      username: qs("newUserUsername").value.trim(),
      password: qs("newUserPassword").value.trim(),
      role: qs("newUserRole").value,
      credits: Number(qs("newUserCredits").value || 0),
    };
    await api("/admin/users",{ method:"POST", body: JSON.stringify(payload) });
    qs("newUserUsername").value="";
    qs("newUserPassword").value="";
    qs("newUserCredits").value="0";
    setText("createUserMsg","Utente creato ✅");
    await loadUsers();
  }catch(e){
    setText("createUserMsg","Errore creazione utente ❌");
  }
}

async function adjustCredits(username, delta){
  try{
    await api("/admin/users/credits",{ method:"PUT", body: JSON.stringify({ username, delta }) });
    await loadUsers();
    if(username===STATE.me.username){
      await loadMe();
      renderHeader();
    }
  }catch{
    alert("Errore crediti");
  }
}

async function toggleUser(username, disabled){
  try{
    await api("/admin/users/status",{ method:"PUT", body: JSON.stringify({ username, disabled }) });
    await loadUsers();
  }catch{
    alert("Errore status utente");
  }
}

async function resetPassword(username, newPassword){
  try{
    await api("/admin/users/password",{ method:"PUT", body: JSON.stringify({ username, newPassword }) });
    alert("Password aggiornata ✅");
  }catch{
    alert("Errore reset password");
  }
}

/* -------- Init -------- */
async function init(){
  // default date
  qs("datePick").value = todayISO();

  try{
    await loadMe();
    await loadPublic();

    hide(qs("loginBox"));
    show(qs("app"));

    renderHeader();
    renderTabs();

    // Booking
    renderFieldSelect();
    renderTimeSelect();
    await loadReservations();

    // Admin
    if(STATE.me.role==="admin"){
      qs("notesText").value = STATE.notesText;
      STATE.fieldsDraft = [...STATE.fields];
      renderAdminConfig();
      renderFieldsAdmin();
      await loadUsers();
    }

  }catch{
    show(qs("loginBox"));
    hide(qs("app"));
    hide(qs("logoutBtn"));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  qs("loginBtn").addEventListener("click", login);
  qs("logoutBtn").addEventListener("click", logout);

  // tabs
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      setActiveTab(btn.dataset.tab);
    });
  });
  document.querySelectorAll(".subtab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      setActiveSub(btn.dataset.sub);
    });
  });

  // booking
  qs("datePick").addEventListener("change", loadReservations);
  qs("bookBtn").addEventListener("click", book);

  // admin
  qs("saveCfgBtn").addEventListener("click", saveConfig);
  qs("saveNotesBtn").addEventListener("click", saveNotes);
  qs("addFieldBtn").addEventListener("click", addField);
  qs("saveFieldsBtn").addEventListener("click", saveFields);
  qs("createUserBtn").addEventListener("click", createUser);

  init();
});
