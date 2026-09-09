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
      <p class="muted">Situazione corrente: le prenotazioni scadute vengono eliminate dal sistema esistente.</p>
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
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-home-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.homeView));
  qs('refreshHomeBtn').onclick=loadHome;
  qs('btnAdminOperations').onclick=loadOperations;
});
