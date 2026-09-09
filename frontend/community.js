/* Establishments and community dashboard share the existing API/session client. */
function rememberedEstablishment() {
  try { return localStorage.getItem('tommi38-establishment'); } catch { return null; }
}
let selectedEstablishment = rememberedEstablishment() || 'tommi38';
let establishmentItems = [];
async function chooseEstablishment() {
  if (STATE.me) {
    await api('/logout', {method:'POST'});
    try { localStorage.removeItem('tommi38-establishment'); } catch {}
    location.reload();
    return;
  }
  hide(qs('loginBox'));
  show(qs('establishmentPicker'));
  const list = qs('establishmentList');
  list.textContent = 'Caricamento…';
  try {
    const data = await api('/establishments');
    establishmentItems = data.items;
    list.innerHTML = '';
    data.items.forEach(item => {
      const button = document.createElement('button');
      button.className = 'secondary-btn venue-choice';
      button.textContent = item.name + ' →';
      button.onclick = async () => {
        selectedEstablishment = item.id;
        try { localStorage.setItem('tommi38-establishment', item.id); } catch {}
        applyEstablishmentName(item.name);
        hide(qs('establishmentPicker'));
        show(qs('loginBox'));
        await loadPublicLoginGallery();
      };
      list.appendChild(button);
    });
  } catch (e) {
    list.textContent = errorMessage(e);
    const retry = document.createElement('button');
    retry.className='secondary-btn'; retry.textContent='Riprova'; retry.onclick=chooseEstablishment; list.appendChild(retry);
  }
}
function applyEstablishmentName(name) {
  document.querySelectorAll('[data-establishment-name]').forEach(el=>el.textContent=name);
  document.title = name + ' · Campi e partite';
}
async function initializeCommunity() {
  if (!rememberedEstablishment()) {
    // Preserve an existing legacy session on first upgrade.
    try { await api('/me'); } catch(e) { if (e.status === 401) return chooseEstablishment(); throw e; }
    try { localStorage.setItem('tommi38-establishment','tommi38'); } catch {}
  }
  const data = await api('/establishments');
  if (!data.items.some(v=>v.id===selectedEstablishment)) { selectedEstablishment='tommi38'; return chooseEstablishment(); }
  applyEstablishmentName(data.items.find(v=>v.id===selectedEstablishment).name);
  await loadPublicLoginGallery();
  return loadAll(true);
}
let homeRequest = 0;
async function loadHome() {
  const request = ++homeRequest;
  const box = qs('homeSummary');
  box.textContent = 'Caricamento…';
  try {
    const [credits, waiting, matches, players] = await Promise.all([
      api('/credits'), api('/waitlist'), api('/reservations/mine'), api('/player-searches')
    ]);
    if (request !== homeRequest || !STATE.me) return;
    STATE.me.credits = credits.balance;
    qs('creditsBox').textContent = credits.balance + ' crediti';
    box.innerHTML = `<p class="eyebrow">Il tuo stabilimento, le tue partite</p><h1>Ciao, ${escapeHTML(STATE.me.username)}</h1>
      <div class="summary-grid"><div><strong>${Number(credits.balance)}</strong><span>Crediti</span></div><div><strong>${matches.items.length}</strong><span>Le tue partite</span></div><div><strong>${players.items.filter(p=>p.status==='open').length}</strong><span>Gruppi aperti</span></div></div>`;
    const next = matches.items[0];
    qs('homeNext').textContent = next ? `${fieldName(next.fieldId)} · ${next.date} alle ${next.time}` : 'Nessuna partita prenotata. Scegli un campo e torna a giocare.';
    qs('homeNotice').textContent = STATE.notes || 'Nessuna comunicazione dal gestore.';
    qs('creditHistory').innerHTML = credits.items.length ? credits.items.map(c=>`<div class="ledger-row"><span>${escapeHTML(c.reason)}<small>${c.at ? escapeHTML(new Date(c.at).toLocaleString('it-IT')) : ''}</small></span><strong>${c.delta>0?'+':''}${Number(c.delta)}</strong></div>`).join('') : '<p class="muted">I nuovi movimenti appariranno qui. Il saldo include i crediti già presenti prima dell’aggiornamento.</p>';
    const list=qs('waitlistItems'); list.innerHTML='';
    if (!waiting.items.length) list.innerHTML='<p class="muted">Tocca un orario occupato in Prenota per metterti in attesa.</p>';
    waiting.items.forEach(w=>{
      const row=document.createElement('div'); row.className='glass-card wait-row';
      row.innerHTML=`<strong>${escapeHTML(fieldName(w.fieldId))} · ${escapeHTML(w.date)} ${escapeHTML(w.time)}</strong><p>${w.available?'Si è liberato! Controlla e prenota.':'In attesa che si liberi'}</p>`;
      if(w.available){const go=document.createElement('button');go.className='primary-btn';go.textContent='Vai alla prenotazione';go.onclick=()=>{qs('datePick').value=w.date;qs('fieldSelect').value=w.fieldId;STATE.selectedTime='';updateDateUI();renderFieldButtonsState();switchView('book');};row.appendChild(go);}
      const remove=document.createElement('button');remove.className='secondary-btn';remove.textContent='Lascia la lista';remove.onclick=async()=>{remove.disabled=true;try{await api('/waitlist/'+encodeURIComponent(w.id),{method:'DELETE'});await loadHome();}catch(e){remove.disabled=false;alert(errorMessage(e));}};row.appendChild(remove);list.appendChild(row);
    });
  } catch(e) { if(request===homeRequest) box.textContent=errorMessage(e); }
}
async function joinWaitlist(reservation) {
  if(!await confirmAction('Vuoi metterti in attesa?',`${fieldName(reservation.fieldId)} · ${reservation.date} alle ${reservation.time}. Controlla la Home mentre l’app è aperta: la lista non riserva automaticamente il posto.`,'Avvisami nell’app'))return;
  try { await api('/waitlist',{method:'POST',body:JSON.stringify({reservationId:reservation.id})}); switchView('home'); }
  catch(e) { alert(e.error==='OWN_RESERVATION'?'Questa partita è già tua.':e.error==='SLOT_FREE'?'Il posto è già libero. Aggiorna e prenota.':errorMessage(e)); }
}
async function loadOperations() {
  openAppModal('Statistiche e chiusure', '<p>Caricamento…</p>');
  try {
    const data = await api('/admin/operations');
    qs('appModalBody').innerHTML=`<div class="summary-grid"><div><strong>${data.users}</strong><span>Utenti</span></div><div><strong>${data.upcoming}</strong><span>Prenotazioni da oggi</span></div><div><strong>${data.credits}</strong><span>Crediti totali</span></div></div>
      <p class="muted">Situazione corrente del tuo stabilimento. Consulta l’agenda per vedere le prenotazioni di una data.</p>
      ${Object.entries(data.byField).map(([f,n])=>`<p>${escapeHTML(fieldName(f))}: ${Number(n)} prenotazioni</p>`).join('')}
      <h3>Chiudi un campo</h3><p class="muted">Le fasce con prenotazioni esistenti non possono essere chiuse.</p>
      <form id="closureForm" class="form-stack"><label>Campo<select class="admin-input" id="closureField">${STATE.fields.map(f=>`<option value="${escapeHTML(f.id)}">${escapeHTML(f.name)}</option>`).join('')}</select></label>
      <label>Data<input class="admin-input" id="closureDate" type="date" min="${localISODate()}" required></label>
      <div class="admin-two-cols"><label>Dalle<input class="admin-input" id="closureStart" type="time" required></label><label>Alle<input class="admin-input" id="closureEnd" type="time" required></label></div>
      <label>Motivo<input class="admin-input" id="closureReason" maxlength="120" required placeholder="Manutenzione, torneo, maltempo…"></label><button class="primary-btn" type="submit">Salva chiusura</button><p id="closureError" role="status"></p></form><h3>Chiusure programmate</h3><div id="closureList"></div>`;
    const list=qs('closureList');
    data.closures.filter(c=>c.date>=localISODate()).forEach(c=>{
      const row=document.createElement('div');row.className='wait-row';
      const label=document.createElement('p');label.textContent=`${fieldName(c.fieldId)} · ${c.date} ${c.start}–${c.end} · ${c.reason}`;row.appendChild(label);
      const button=document.createElement('button');button.className='secondary-btn';button.textContent='Riapri fascia';button.onclick=async()=>{button.disabled=true;try{await api('/admin/closures/'+encodeURIComponent(c.id),{method:'DELETE'});await loadOperations();}catch(e){button.disabled=false;alert(errorMessage(e));}};row.appendChild(button);list.appendChild(row);
    });
    qs('closureForm').onsubmit=async e=>{
      e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;
      try {await api('/admin/closures',{method:'POST',body:JSON.stringify({fieldId:qs('closureField').value,date:qs('closureDate').value,start:qs('closureStart').value,end:qs('closureEnd').value,reason:qs('closureReason').value})});await loadOperations();}
      catch(error){qs('closureError').textContent=error.error==='EXISTING_RESERVATIONS'?'Ci sono prenotazioni nella fascia. Gestiscile prima di chiudere il campo.':'Chiusura non salvata. Verifica data, orari e connessione.';button.disabled=false;}
    };
  } catch(e){qs('appModalBody').textContent=errorMessage(e);}
}

/* The platform administrator creates venues; every venue manager keeps a scoped workspace. */
let agendaRequest = 0;
let platformRequest = 0;
let agendaItems = [];

function configureManagementAccess() {
  const manager = STATE.me?.role === 'admin';
  const platform = STATE.me?.platformAdmin === true;
  const label = platform ? 'Amministratore della piattaforma' : 'Gestore dello stabilimento';
  qs('managerHomeRole').textContent = label;
  qs('adminRoleLabel').textContent = label;
  qs('adminTitle').textContent = platform ? 'Amministrazione' : 'Gestisci stabilimento';
  [qs('managerHome'), qs('openAdminBtn')].forEach(el => (manager || platform ? show : hide)(el));
  [qs('homePlatformBtn'), qs('btnPlatformEstablishments')].forEach(el => (platform ? show : hide)(el));
  qs('homeAgendaBtn').classList.toggle('hidden', !manager);
  qs('homeManagementBtn').classList.toggle('hidden', !manager);
  ['btnAdminAgenda', 'btnAdminOperations', 'btnAdminConfig', 'btnAdminNotes', 'btnAdminFields', 'btnAdminUsers', 'btnAdminGallery'].forEach(id => qs(id).classList.toggle('hidden', !manager));
}

function resetManagementViews() {
  agendaRequest++;
  platformRequest++;
  agendaItems = [];
  STATE.users = [];
  ['agendaList', 'platformEstablishmentList', 'usersList', 'agendaStatus', 'establishmentStatus', 'createUserStatus'].forEach(id => { if (qs(id)) qs(id).textContent = ''; });
  ['establishmentCreateForm', 'createUserForm'].forEach(id => qs(id)?.reset());
  ['managerHome', 'adminShell', 'openAdminBtn', 'homePlatformBtn', 'btnPlatformEstablishments'].forEach(id => hide(qs(id)));
}

function managementError(error) {
  const messages = {
    ACTIVE_DURATION_CHANGE: 'Ci sono prenotazioni attive. Attendi che terminino prima di cambiare la durata delle partite.',
    FIELD_HAS_RESERVATIONS: 'Il campo ha prenotazioni attive e non può essere rimosso.',
    BAD_BODY: 'Controlla i dati: username valido, password di almeno 12 caratteri e crediti interi non negativi.',
    ESTABLISHMENT_EXISTS: 'Questo codice stabilimento è già in uso. Scegline un altro.',
    USERNAME_TAKEN: 'Questo username è già usato nel tuo stabilimento.',
    USER_EXISTS: 'Questo username è già usato nel tuo stabilimento.',
    INVALID_BALANCE: 'Il saldo deve essere un numero intero e non può scendere sotto zero.',
    LEGACY_ESTABLISHMENT_REQUIRED: 'Lo stabilimento principale deve rimanere attivo.',
    PROTECTED_ACCOUNT: 'Questo account è protetto. Non puoi modificarlo da qui.'
  };
  return messages[error?.error] || errorMessage(error);
}

function validManagementPassword(input, status) {
  if (new TextEncoder().encode(input.value).length <= 72) return true;
  status.textContent = 'La password è troppo lunga: usa al massimo 72 caratteri semplici o meno caratteri accentati e simboli.';
  input.focus();
  return false;
}

function openManagerAgenda() {
  if (STATE.me?.role !== 'admin') return;
  openAdminShell();
  openAdmin('adminAgenda');
  qs('agendaDate').value ||= localISODate();
  const filter = qs('agendaField');
  const previous = filter.value;
  filter.innerHTML = '<option value="">Tutti i campi</option>';
  STATE.fields.forEach(field => {
    const option = document.createElement('option');
    option.value = field.id;
    option.textContent = field.name;
    filter.appendChild(option);
  });
  if (STATE.fields.some(field => field.id === previous)) filter.value = previous;
  loadManagerAgenda();
}

async function loadManagerAgenda() {
  if (STATE.me?.role !== 'admin') return;
  const date = qs('agendaDate').value || localISODate();
  qs('agendaDate').value = date;
  const request = ++agendaRequest;
  const user = STATE.me;
  const status = qs('agendaStatus');
  const list = qs('agendaList');
  agendaItems = [];
  list.textContent = '';
  status.textContent = 'Caricamento prenotazioni…';
  list.setAttribute('aria-busy', 'true');
  qs('refreshAgendaBtn').disabled = true;
  [['agendaTodayBtn', localISODate()], ['agendaTomorrowBtn', tomorrowISODate()]].forEach(([id, value]) => {
    qs(id).setAttribute('aria-pressed', String(date === value));
    qs(id).classList.toggle('selected', date === value);
  });
  try {
    const data = await api('/admin/reservations?date=' + encodeURIComponent(date));
    if (request !== agendaRequest || user !== STATE.me || qs('agendaDate').value !== date) return;
    agendaItems = data.items || [];
    renderManagerAgenda();
  } catch (error) {
    if (request === agendaRequest && user === STATE.me) status.textContent = managementError(error);
  } finally {
    if (request === agendaRequest) {
      list.setAttribute('aria-busy', 'false');
      qs('refreshAgendaBtn').disabled = false;
    }
  }
}

function renderManagerAgenda() {
  const date = qs('agendaDate').value;
  const items = agendaItems.filter(item => !qs('agendaField').value || item.fieldId === qs('agendaField').value)
    .sort((a,b) => String(a.time).localeCompare(String(b.time)) || fieldName(a.fieldId).localeCompare(fieldName(b.fieldId)));
  qs('agendaStatus').textContent = `${formatLongDate(date)} · ${items.length} ${items.length === 1 ? 'prenotazione' : 'prenotazioni'}`;
  const list = qs('agendaList');
  list.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Nessuna prenotazione per il giorno e il campo selezionati.';
    list.appendChild(empty);
  }
  items.forEach(item => {
    const row = document.createElement('article');
    row.className = 'agenda-card';
    const status = item.status === 'cancelled' ? 'Cancellata' : item.status === 'completed' ? 'Conclusa' : 'Confermata';
    row.innerHTML = `<div class="agenda-card-top"><strong>${escapeHTML(item.time)}${item.endTime ? '–' + escapeHTML(item.endTime) : ''}</strong><span class="request-status ${item.status === 'cancelled' ? 'rejected' : 'accepted'}">${status}</span></div><h3>${escapeHTML(fieldName(item.fieldId))}</h3><p>Prenotata da <strong>${escapeHTML(item.user)}</strong></p>`;
    list.appendChild(row);
  });
}

async function openPlatformEstablishments() {
  if (!STATE.me?.platformAdmin) return;
  openAdminShell();
  openAdmin('adminEstablishments');
  qs('establishmentStatus').textContent = '';
  await loadPlatformEstablishments();
}

async function loadPlatformEstablishments() {
  if (!STATE.me?.platformAdmin) return;
  const request = ++platformRequest;
  const user = STATE.me;
  const list = qs('platformEstablishmentList');
  list.textContent = 'Caricamento stabilimenti…';
  try {
    const data = await api('/platform/establishments');
    if (request !== platformRequest || user !== STATE.me) return;
    list.innerHTML = '';
    (data.items || []).forEach(item => {
      const card = document.createElement('article');
      card.className = 'venue-management-card';
      const managers = (item.managers || []).map(manager => `${manager.username}${manager.disabled ? ' (disabilitato)' : ''}`).join(', ') || 'Nessun gestore';
      card.innerHTML = `<div class="agenda-card-top"><h3>${escapeHTML(item.name)}</h3><span class="request-status ${item.enabled ? 'accepted' : 'rejected'}">${item.enabled ? 'Attivo' : 'Sospeso'}</span></div><p class="muted">Codice: ${escapeHTML(item.id)}</p><p>Gestore: <strong>${escapeHTML(managers)}</strong></p>`;
      const actions = document.createElement('div');
      actions.className = 'action-row';
      actions.appendChild(adminButton('Modifica nome', () => openEstablishmentName(item)));
      if (!item.legacy) actions.appendChild(adminButton(item.enabled ? 'Sospendi' : 'Riattiva', async () => {
        if (item.enabled && !await confirmAction('Sospendi ' + item.name + '?', 'Gli utenti e il gestore non potranno accedere finché non lo riattivi. Le prenotazioni e i dati saranno conservati.', 'Sospendi stabilimento')) return;
        await api('/platform/establishments/' + encodeURIComponent(item.id), {method:'PATCH', body:JSON.stringify({enabled:!item.enabled})});
        qs('establishmentStatus').textContent = `${item.name}: ${item.enabled ? 'accesso sospeso' : 'accesso riattivato'}.`;
        await loadPlatformEstablishments();
      }));
      card.appendChild(actions);
      list.appendChild(card);
    });
  } catch (error) {
    if (request === platformRequest && user === STATE.me) list.textContent = managementError(error);
  }
}

async function createEstablishment(event) {
  event.preventDefault();
  if (!STATE.me?.platformAdmin || qs('createEstablishmentBtn').disabled) return;
  const form = event.currentTarget;
  const status = qs('establishmentStatus');
  if (!form.reportValidity() || !validManagementPassword(qs('establishmentPassword'), status)) return;
  const button = qs('createEstablishmentBtn');
  const user = STATE.me;
  button.disabled = true;
  status.textContent = 'Creazione dello stabilimento…';
  try {
    const data = await api('/platform/establishments', {method:'POST', body:JSON.stringify({
      id:qs('establishmentId').value.trim(), name:qs('establishmentName').value.trim(),
      managerUsername:qs('establishmentManager').value.trim(), managerPassword:qs('establishmentPassword').value
    })});
    form.reset();
    if (user !== STATE.me) return;
    status.textContent = `${data.establishment.name} è pronto. Il gestore può selezionarlo all’accesso e usare le credenziali appena impostate. Aggiungerà campi e orari dalla sua area di gestione.`;
    form.closest('details').open = false;
    await loadPlatformEstablishments();
  } catch (error) {
    if (user === STATE.me) status.textContent = managementError(error);
  } finally { button.disabled = false; }
}

function openEstablishmentName(item) {
  openAppModal('Modifica nome stabilimento', `<form id="venueNameForm" class="form-stack"><label class="field-label" for="venueNewName">Nome</label><input id="venueNewName" class="admin-input" value="${escapeHTML(item.name)}" required maxlength="80"><p class="helper-text">Il codice e le credenziali del gestore restano gli stessi.</p><button class="primary-btn" type="submit">Salva nome</button><p id="venueNameStatus" class="form-message" role="status"></p></form>`);
  qs('venueNameForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const name = qs('venueNewName').value.trim();
      await api('/platform/establishments/' + encodeURIComponent(item.id), {method:'PATCH',body:JSON.stringify({name})});
      if (item.id === selectedEstablishment) applyEstablishmentName(name);
      closeAppModal();
      qs('establishmentStatus').textContent = 'Nome dello stabilimento aggiornato.';
      await loadPlatformEstablishments();
    } catch (error) { if (qs('venueNameStatus')) qs('venueNameStatus').textContent = managementError(error); button.disabled = false; }
  };
}

async function createManagedUser(event) {
  event.preventDefault();
  if (STATE.me?.role !== 'admin' || qs('createUserBtn').disabled) return;
  const form = event.currentTarget;
  const status = qs('createUserStatus');
  if (!form.reportValidity() || !validManagementPassword(qs('newUserPassword'), status)) return;
  const user = STATE.me;
  const username = qs('newUserUsername').value.trim();
  qs('createUserBtn').disabled = true;
  status.textContent = 'Creazione account…';
  try {
    await api('/admin/users',{method:'POST',body:JSON.stringify({username,password:qs('newUserPassword').value,credits:Number(qs('newUserCredits').value)})});
    form.reset();
    if (user !== STATE.me) return;
    status.textContent = `Utente ${username} creato. Può accedere selezionando questo stabilimento.`;
    await loadUsers();
  } catch (error) { if (user === STATE.me) status.textContent = managementError(error); }
  finally { qs('createUserBtn').disabled = false; }
}

function openUserPassword(user) {
  openAppModal('Imposta password', `<form id="userPasswordForm" class="form-stack"><p>Account: <strong>${escapeHTML(user.username)}</strong></p><label class="field-label" for="managedNewPassword">Nuova password</label><input id="managedNewPassword" class="admin-input" type="password" required minlength="12" maxlength="72" autocomplete="new-password"><p class="helper-text">Almeno 12 caratteri. Comunica la nuova password all’utente con un canale riservato.</p><button class="primary-btn" type="submit">Aggiorna password</button><p id="managedPasswordStatus" class="form-message" role="status"></p></form>`);
  qs('userPasswordForm').onsubmit = async event => {
    event.preventDefault();
    if (!validManagementPassword(qs('managedNewPassword'), qs('managedPasswordStatus'))) return;
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await api('/admin/users/password',{method:'PUT',body:JSON.stringify({username:user.username,newPassword:qs('managedNewPassword').value})});
      if (qs('managedNewPassword')) qs('managedNewPassword').value = '';
      closeAppModal();
      await loadUsers();
      qs('createUserStatus').textContent = `Password di ${user.username} aggiornata.`;
      qs('createUserForm').closest('details').open = true;
    } catch (error) { if (qs('managedPasswordStatus')) qs('managedPasswordStatus').textContent = managementError(error); button.disabled = false; }
  };
}

function openUserCredits(user) {
  openAppModal('Gestisci crediti', `<form id="userCreditsForm" class="form-stack"><p><strong>${escapeHTML(user.username)}</strong> · saldo attuale: ${Number(user.credits || 0)} crediti</p><label class="field-label" for="creditOperation">Operazione</label><select id="creditOperation" class="admin-input"><option value="1">Aggiungi crediti</option><option value="-1">Rimuovi crediti</option></select><label class="field-label" for="creditAmount">Numero di crediti</label><input id="creditAmount" class="admin-input" type="number" min="1" max="100000" step="1" required value="1"><p class="helper-text">Il movimento viene registrato nello storico dell’utente.</p><button class="primary-btn" type="submit">Salva movimento</button><p id="managedCreditsStatus" class="form-message" role="status"></p></form>`);
  qs('userCreditsForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await api('/admin/users/credits',{method:'PUT',body:JSON.stringify({username:user.username,delta:Number(qs('creditAmount').value)*Number(qs('creditOperation').value)})});
      closeAppModal();
      await loadUsers();
      if (user.username === STATE.me?.username) await refreshCredits();
    } catch (error) { if (qs('managedCreditsStatus')) qs('managedCreditsStatus').textContent = managementError(error); button.disabled = false; }
  };
}

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-home-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.homeView));
  qs('refreshHomeBtn').onclick=loadHome;
  qs('btnAdminOperations').onclick=loadOperations;
  qs('homeAgendaBtn').onclick = openManagerAgenda;
  qs('btnAdminAgenda').onclick = openManagerAgenda;
  qs('homeManagementBtn').onclick = openAdminShell;
  qs('homePlatformBtn').onclick = openPlatformEstablishments;
  qs('btnPlatformEstablishments').onclick = openPlatformEstablishments;
  qs('establishmentCreateForm').onsubmit = createEstablishment;
  qs('createUserForm').onsubmit = createManagedUser;
  qs('refreshAgendaBtn').onclick = loadManagerAgenda;
  qs('agendaDate').onchange = loadManagerAgenda;
  qs('agendaField').onchange = renderManagerAgenda;
  qs('agendaTodayBtn').onclick = () => { qs('agendaDate').value = localISODate(); loadManagerAgenda(); };
  qs('agendaTomorrowBtn').onclick = () => { qs('agendaDate').value = tomorrowISODate(); loadManagerAgenda(); };
  qs('appModal').addEventListener('close', () => {
    qs('appModalBody').querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
  });
});
