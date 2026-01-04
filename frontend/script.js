const API_BASE = "/api";

/* API */
async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  let data = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) throw new Error(data?.error || "API_ERROR");
  return data;
}

/* AUTH */
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
  } catch {
    alert("Login fallito");
  }
}

async function logout() {
  await api("/logout", { method: "POST" });
  location.reload();
}

/* INIT */
async function init() {
  try {
    const me = await api("/me");

    document.getElementById("loginBox").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");

    document.getElementById("welcome").innerText = `Ciao ${me.username}`;
    document.getElementById("creditsBox").innerText =
      `Crediti disponibili: ${me.credits}`;

    if (me.role === "admin") {
      document.getElementById("adminPanel").classList.remove("hidden");
      loadAdmin();
    }
  } catch {
    document.getElementById("loginBox").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
  }
}

/* ADMIN */
async function loadAdmin() {
  const cfg = await api("/public/config");
  document.getElementById("notesText").value = cfg.notesText || "";
  document.getElementById("fieldsText").value =
    (cfg.fields || []).join("\n");
}

async function saveNotes() {
  const text = document.getElementById("notesText").value;
  await api("/admin/notes", {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
  alert("Note salvate");
}

async function saveFields() {
  const fields = document.getElementById("fieldsText").value
    .split("\n")
    .map(v => v.trim())
    .filter(Boolean);

  await api("/admin/fields", {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
  alert("Campi salvati");
}

/* EVENT BIND */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginBtn").addEventListener("click", login);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("saveNotesBtn").addEventListener("click", saveNotes);
  document.getElementById("saveFieldsBtn").addEventListener("click", saveFields);
  init();
});
