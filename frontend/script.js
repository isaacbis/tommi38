const API_BASE = "/api";

const qs = id => document.getElementById(id);
const show = el => el.classList.remove("hidden");
const hide = el => el.classList.add("hidden");

let STATE = {
  me: null,
  config: null,
  fields: [],
  fieldsDraft: [],
  notes: "",
  reservations: [],
  users: []
};

/* ================= API ================= */
async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "API_ERROR");
  return data;
}

/* ================= AUTH ================= */
async function login() {
  try {
    await api("/login", {
      method: "POST",
      body: JSON.stringify({
        username: qs("username").value,
        password: qs("password").value
      })
    });
    location.reload();
  } catch {
    qs("loginErr").textContent = "Login fallito";
    show(qs("loginErr"));
  }
}

async function logout() {
  await api("/logout", { method: "POST" });
  location.reload();
}

/* ================= LOAD ================= */
async function loadAll() {
  STATE.me = await api("/me");
  const pub = await api("/public/config");
  STATE.fields = pub.fields || [];
  STATE.fieldsDraft = [...STATE.fields];
  STATE.notes = pub.notesText || "";
  qs("notesView").textContent = STATE.notes || "Nessuna comunicazione.";

  qs("welcome").textContent = `Ciao ${STATE.me.username}`;
  qs("creditsBox").textContent = `Crediti disponibili: ${STATE.me.credits}`;
  qs("roleBadge").textContent = STATE.me.role;

  hide(qs("loginBox"));
  show(qs("app"));
  show(qs("logoutBtn"));

  if (STATE.me.role === "admin") {
    show(qs("adminPanel"));
    qs("notesText").value = STATE.notes;
    await loadUsers();
  }

  renderFields();
  qs("datePick").valueAsDate = new Date();
  await loadReservations();
}

/* ================= PRENOTAZIONI ================= */
function minutes(t){ const [h,m]=t.split(":").map(Number); return h*60+m; }
function timeStr(m){ return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"); }

async function loadReservations() {
  const date = qs("datePick").value;
  const res = await api(`/reservations?date=${date}`);
  STATE.reservations = res.items || [];
  renderTimeSelect();
  renderReservations();
}

function renderTimeSelect() {
  const sel = qs("timeSelect");
  sel.innerHTML = "";

  const slot = STATE.config?.slotMinutes || 45;
  const start = minutes(STATE.config?.dayStart || "09:00");
  const end = minutes(STATE.config?.dayEnd || "20:00");
  const fieldId = qs("fieldSelect").value;

  const taken = new Set(
    STATE.reservations.filter(r => r.fieldId === fieldId).map(r => r.time)
  );

  for(let m=start; m+slot<=end; m+=slot){
    const t = timeStr(m);
    const opt = document.createElement("option");
    opt.value = t;
    if (taken.has(t)) {
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
  } catch {
    qs("bookMsg").textContent = "Errore prenotazione ❌";
  }
}

function renderReservations() {
  const list = qs("reservationsList");
  list.innerHTML = "";
  STATE.reservations.forEach(r => {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = `${r.time} – ${r.fieldId} – ${r.user}`;
    list.appendChild(div);
  });
}

/* ================= CAMPI ================= */
function renderFields() {
  const sel = qs("fieldSelect");
  sel.innerHTML = "";
  STATE.fields.forEach(f => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });

  const list = qs("fieldsList");
  list.innerHTML = "";
  STATE.fieldsDraft.forEach((f,i) => {
    const div = document.createElement("div");
    div.className="item";
    div.textContent = `${f.id} – ${f.name}`;
    list.appendChild(div);
  });
}

async function saveFields() {
  await api("/admin/fields", {
    method: "PUT",
    body: JSON.stringify({ fields: STATE.fieldsDraft })
  });
  qs("fieldsMsg").textContent = "Campi salvati ✅";
}

/* ================= NOTE ================= */
async function saveNotes() {
  await api("/admin/notes", {
    method:"PUT",
    body: JSON.stringify({ text: qs("notesText").value })
  });
  qs("notesMsg").textContent = "Note salvate ✅";
}

/* ================= UTENTI ================= */
async function loadUsers() {
  const res = await api("/admin/users");
  STATE.users = res.items || [];
  const list = qs("usersList");
  list.innerHTML = "";
  STATE.users.forEach(u => {
    const div = document.createElement("div");
    div.className="item";
    const btn = document.createElement("button");
    btn.textContent="✏️ Crediti";
    btn.className="btn-ghost";
    btn.onclick = async () => {
      const v = prompt("Nuovi crediti per "+u.username, u.credits);
      if(v===null) return;
      await api("/admin/users/credits", {
        method:"PUT",
        body: JSON.stringify({
          username: u.username,
          delta: Number(v) - u.credits
        })
      });
      await loadUsers();
    };
    div.textContent = `${u.username} – crediti: ${u.credits} `;
    div.appendChild(btn);
    list.appendChild(div);
  });
}

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {
  qs("loginBtn").addEventListener("click", login);
  qs("logoutBtn").addEventListener("click", logout);
  qs("bookBtn").addEventListener("click", book);
  qs("datePick").addEventListener("change", loadReservations);
  qs("fieldSelect").addEventListener("change", renderTimeSelect);
  qs("saveFieldsBtn").addEventListener("click", saveFields);
  qs("saveNotesBtn").addEventListener("click", saveNotes);

  loadAll().catch(()=>{});
});
