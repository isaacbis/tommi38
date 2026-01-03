/* =========================
   CONFIG
========================= */
const API_BASE = "/api";

/* =========================
   API HELPER (COOKIE FIRST-PARTY)
========================= */
async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {}

  if (!res.ok) {
    throw new Error(data?.error || "API_ERROR");
  }

  return data;
}

/* =========================
   AUTH
========================= */
async function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!username || !password) {
    alert("Inserisci username e password");
    return;
  }

  try {
    await api("/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    location.reload();
  } catch (e) {
    alert("Login fallito");
  }
}

async function logout() {
  try {
    await api("/logout", { method: "POST" });
    location.reload();
  } catch (_) {
    location.reload();
  }
}

/* =========================
   INIT SESSION
========================= */
async function init() {
  try {
    const me = await api("/me");

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("app").style.display = "block";

    document.getElementById("welcome").innerText =
      `Ciao ${me.username}`;
    document.getElementById("creditsBox").innerText =
      `Crediti disponibili: ${me.credits}`;

    if (me.role === "admin") {
      document.getElementById("adminPanel").style.display = "block";
      await loadAdminData();
    }
  } catch (_) {
    document.getElementById("loginBox").style.display = "block";
    document.getElementById("app").style.display = "none";
  }
}

/* =========================
   ADMIN DATA
========================= */
async function loadAdminData() {
  try {
    const cfg = await api("/public/config");

    document.getElementById("notesText").value =
      cfg.notesText || "";

    document.getElementById("fieldsText").value =
      (cfg.fields || []).join("\n");

  } catch (e) {
    alert("Errore caricamento dati admin");
  }
}

async function saveNotes() {
  const text = document.getElementById("notesText").value;

  try {
    await api("/admin/notes", {
      method: "PUT",
      body: JSON.stringify({ text }),
    });
    alert("Note salvate");
  } catch (e) {
    alert("Errore salvataggio note");
  }
}

async function saveFields() {
  const raw = document.getElementById("fieldsText").value;
  const fields = raw
    .split("\n")
    .map(f => f.trim())
    .filter(Boolean);

  try {
    await api("/admin/fields", {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
    alert("Campi salvati");
  } catch (e) {
    alert("Errore salvataggio campi");
  }
}

/* =========================
   EVENT BIND (CSP SAFE)
========================= */
document.addEventListener("DOMContentLoaded", () => {

  document.getElementById("loginBtn")
    ?.addEventListener("click", login);

  document.getElementById("logoutBtn")
    ?.addEventListener("click", logout);

  document.getElementById("saveNotesBtn")
    ?.addEventListener("click", saveNotes);

  document.getElementById("saveFieldsBtn")
    ?.addEventListener("click", saveFields);

  init();
});
