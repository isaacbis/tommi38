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
  users: []
};

async function api(path, options={}) {
  const r = await fetch(API+path, {
    credentials:"include",
    headers:{ "Content-Type":"application/json" },
    ...options
  });
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw j;
  return j;
}

/* AUTH */
async function login(){
  try{
    await api("/login",{method:"POST",body:JSON.stringify({
      username:qs("username").value,
      password:qs("password").value
    })});
    location.reload();
  }catch{
    qs("loginErr").textContent="Login fallito";
    show(qs("loginErr"));
  }
}
async function logout(){ await api("/logout",{method:"POST"}); location.reload(); }

/* LOAD */
async function loadAll(){
  STATE.me = await api("/me");
  const pub = await api("/public/config");
  STATE.fields = pub.fields || [];
  STATE.fieldsDraft = [...STATE.fields];
  STATE.notes = pub.notesText || "";

  qs("welcome").textContent = `Ciao ${STATE.me.username}`;
  qs("creditsBox").textContent = `Crediti: ${STATE.me.credits}`;
  qs("roleBadge").textContent = STATE.me.role;
  qs("notesView").textContent = STATE.notes || "Nessuna comunicazione.";

  hide(qs("loginBox"));
  show(qs("app"));
  show(qs("logoutBtn"));

  if(STATE.me.role==="admin"){
    show(qs("adminMenu"));
    await loadUsers();
  }

  renderFields();
  qs("datePick").valueAsDate = new Date();
  await loadReservations();
}

/* PRENOTAZIONI */
function minutes(t){ const [h,m]=t.split(":").map(Number); return h*60+m; }
function timeStr(m){ return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"); }

async function loadReservations(){
  const date = qs("datePick").value;
  const res = await api(`/reservations?date=${date}`);
  STATE.reservations = STATE.me.role==="admin"
    ? res.items
    : res.items.filter(r=>r.user===STATE.me.username);
  renderTimeSelect();
  renderReservations();
}

function renderTimeSelect(){
  const sel = qs("timeSelect");
  sel.innerHTML="";
  const slot=45, start=minutes("09:00"), end=minutes("20:00");
  const field=qs("fieldSelect").value;
  const taken=new Set(
    STATE.reservations.filter(r=>r.fieldId===field).map(r=>r.time)
  );
  for(let m=start;m+slot<=end;m+=slot){
    const t=timeStr(m);
    const o=document.createElement("option");
    o.value=t;
    if(taken.has(t)){ o.textContent=`${t} ❌`; o.disabled=true; }
    else o.textContent=`${t} ✅`;
    sel.appendChild(o);
  }
}

async function book(){
  try{
    await api("/reservations",{method:"POST",body:JSON.stringify({
      fieldId:qs("fieldSelect").value,
      date:qs("datePick").value,
      time:qs("timeSelect").value
    })});
    await loadReservations();
  }catch{ qs("bookMsg").textContent="Errore prenotazione"; }
}

function renderReservations(){
  const list = qs("reservationsList");
  list.innerHTML = "";

  if (STATE.reservations.length === 0) {
    const d = document.createElement("div");
    d.className = "muted";
    d.textContent = "Nessuna prenotazione per questo giorno.";
    list.appendChild(d);
    return;
  }

  STATE.reservations.forEach(r => {
    const item = document.createElement("div");
    item.className = "item";

    const info = document.createElement("div");
    info.textContent =
      `${r.time} – ${r.fieldId}` +
      (STATE.me.role === "admin" ? ` – utente: ${r.user}` : "");

    item.appendChild(info);

    // 🔴 pulsante cancella (admin SEMPRE, user solo le proprie)
    const canDelete =
      STATE.me.role === "admin" ||
      r.user === STATE.me.username;

    if (canDelete) {
      const btn = document.createElement("button");
      btn.className = "btn-ghost";
      btn.textContent = "❌ Cancella";

      btn.addEventListener("click", async () => {
        if (!confirm("Vuoi cancellare questa prenotazione?")) return;

        try {
          await api(`/reservations/${r.id}`, {
            method: "DELETE"
          });

          // aggiorna lista + crediti
          await loadReservations();
          await loadAll(); // ricarica crediti se admin/user
        } catch {
          alert("Errore cancellazione");
        }
      });

      item.appendChild(btn);
    }

    list.appendChild(item);
  });
}

/* CAMPI */
function renderFields(){
  const s=qs("fieldSelect");
  s.innerHTML="";
  STATE.fields.forEach(f=>{
    const o=document.createElement("option");
    o.value=f.id; o.textContent=f.name;
    s.appendChild(o);
  });

  const l=qs("fieldsList");
  l.innerHTML="";
  STATE.fieldsDraft.forEach(f=>{
    const d=document.createElement("div");
    d.className="item";
    d.textContent=`${f.id} – ${f.name}`;
    l.appendChild(d);
  });
}

async function saveFields(){
  await api("/admin/fields",{method:"PUT",body:JSON.stringify({fields:STATE.fieldsDraft})});
}

/* NOTE */
async function saveNotes(){
  await api("/admin/notes",{method:"PUT",body:JSON.stringify({text:qs("notesText").value})});
}

/* UTENTI */
async function loadUsers(){
  const r=await api("/admin/users");
  STATE.users=r.items;
  const l=qs("usersList");
  l.innerHTML="";
  STATE.users.forEach(u=>{
    const d=document.createElement("div");
    d.className="item";
    d.innerHTML=`<b>${u.username}</b> – crediti ${u.credits}`;
    const edit=document.createElement("button");
    edit.textContent="✏️ Crediti";
    edit.onclick=()=>setCredits(u);
    const reset=document.createElement("button");
    reset.textContent="Reset PW";
    reset.onclick=()=>resetPw(u.username);
    const toggle=document.createElement("button");
    toggle.textContent=u.disabled?"Abilita":"Disabilita";
    toggle.onclick=()=>toggleUser(u);
    d.append(edit,reset,toggle);
    l.appendChild(d);
  });
}

async function setCredits(u){
  const v=prompt("Crediti per "+u.username,u.credits);
  if(v===null)return;
  await api("/admin/users/credits",{method:"PUT",
    body:JSON.stringify({username:u.username,delta:Number(v)-u.credits})});
  loadUsers();
}
async function resetPw(u){
  const p=prompt("Nuova password");
  if(!p)return;
  await api("/admin/users/password",{method:"PUT",body:JSON.stringify({username:u,newPassword:p})});
}
async function toggleUser(u){
  await api("/admin/users/status",{method:"PUT",
    body:JSON.stringify({username:u.username,disabled:!u.disabled})});
  loadUsers();
}

/* ADMIN NAV */
function openAdmin(section){
  ["adminMenu","adminNotes","adminFields","adminUsers"].forEach(id=>hide(qs(id)));
  show(qs(section));
}
document.addEventListener("DOMContentLoaded",()=>{
  qs("loginBtn").onclick=login;
  qs("logoutBtn").onclick=logout;
  qs("bookBtn").onclick=book;
  qs("datePick").onchange=loadReservations;
  qs("fieldSelect").onchange=renderTimeSelect;

  qs("btnAdminNotes").onclick=()=>openAdmin("adminNotes");
  qs("btnAdminFields").onclick=()=>openAdmin("adminFields");
  qs("btnAdminUsers").onclick=()=>openAdmin("adminUsers");
  document.querySelectorAll(".backAdmin").forEach(b=>b.onclick=()=>openAdmin("adminMenu"));

  qs("saveNotesBtn").onclick=saveNotes;
  qs("saveFieldsBtn").onclick=saveFields;

  loadAll().catch(()=>{});
});
