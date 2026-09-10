/* Establishments and community dashboard share the existing API/session client. */
function rememberedEstablishment() {
  try { return localStorage.getItem('tommi38-establishment'); } catch { return null; }
}
let selectedEstablishment = rememberedEstablishment() || 'tommi38';
let establishmentItems = [];
let managementContextEpoch = 0;
let contextChanging = false;
function paginateCommunityList(id, options) {
  if (typeof paginateList === 'function') paginateList(id, options);
}
function compactCommunityDate(value) {
  return new Date(value + 'T12:00:00').toLocaleDateString('it-IT', {day:'numeric',month:'short'});
}
function showHomePanel(name) {
  const panels = {overview:'homeOverviewPanel',credits:'homeCreditsPanel',waiting:'homeWaitlistPanel',notice:'homeNoticePanel'};
  if (!panels[name]) name = 'overview';
  Object.entries(panels).forEach(([key,id]) => {
    const panel=qs(id);
    if (panel) { panel.hidden=key!==name; panel.classList.toggle('hidden',key!==name); panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby','home-tab-'+key); }
  });
  document.querySelectorAll('[data-home-panel]').forEach(button => {
    const selected=button.dataset.homePanel===name;
    button.id='home-tab-'+button.dataset.homePanel;
    button.setAttribute('role','tab');
    button.setAttribute('aria-controls',panels[button.dataset.homePanel]);
    button.classList.toggle('selected',selected);
    button.setAttribute('aria-selected',String(selected));
    button.tabIndex=selected?0:-1;
  });
}
async function chooseEstablishment() {
  if (STATE.me?.platformAdmin) return returnToPlatform();
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
    paginateCommunityList('establishmentList');
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
  // The server owns the active management scope. Local storage is only a login preference.
  try {
    const context = await api('/platform/context');
    if (context.establishment) {
      selectedEstablishment = context.establishment.id;
      try { localStorage.setItem('tommi38-establishment', selectedEstablishment); } catch {}
      applyEstablishmentName(context.establishment.name);
      return loadAll(true);
    }
  } catch (error) { if (![401,403].includes(error.status)) throw error; }
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
  if (STATE.me?.managementMode) return openAdminShell();
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
    box.innerHTML = `<h1>Ciao, ${escapeHTML(STATE.me.username)}</h1>
      <div class="summary-grid"><div><strong>${Number(credits.balance)}</strong><span>Crediti</span></div><div><strong>${matches.items.length}</strong><span>Le tue partite</span></div><div><strong>${players.items.filter(p=>p.status==='open').length}</strong><span>Gruppi aperti</span></div></div>`;
    const next = matches.items[0];
    qs('homeNext').textContent = next ? `${fieldName(next.fieldId)} · ${compactCommunityDate(next.date)} alle ${next.time}` : 'Nessuna partita in programma.';
    qs('homeNotice').textContent = STATE.notes || 'Nessuna comunicazione dal gestore.';
    qs('creditHistory').innerHTML = credits.items.length ? credits.items.map(c=>`<div class="ledger-row"><span>${escapeHTML(c.reason)}<small>${c.at ? escapeHTML(new Date(c.at).toLocaleString('it-IT')) : ''}</small></span><strong>${c.delta>0?'+':''}${Number(c.delta)}</strong></div>`).join('') : '<p class="muted">Non ci sono ancora movimenti.</p>';
    const list=qs('waitlistItems'); list.innerHTML='';
    if (!waiting.items.length) list.innerHTML='<p class="muted">Tocca un orario occupato in Prenota per metterti in attesa.</p>';
    waiting.items.forEach(w=>{
      const row=document.createElement('div'); row.className='glass-card wait-row';
      row.innerHTML=`<strong>${escapeHTML(fieldName(w.fieldId))} · ${escapeHTML(compactCommunityDate(w.date))} ${escapeHTML(w.time)}</strong><p>${w.available?'Si è liberato! Controlla e prenota.':'In attesa che si liberi'}</p>`;
      if(w.available){const go=document.createElement('button');go.className='primary-btn';go.textContent='Prenota';go.onclick=()=>{qs('datePick').value=w.date;qs('fieldSelect').value=w.fieldId;STATE.selectedTime='';updateDateUI();renderFieldButtonsState();switchView('book');};row.appendChild(go);}
      const remove=document.createElement('button');remove.className='secondary-btn';remove.textContent='Lascia la lista';remove.onclick=async()=>{remove.disabled=true;try{await api('/waitlist/'+encodeURIComponent(w.id),{method:'DELETE'});await loadHome();}catch(e){remove.disabled=false;alert(errorMessage(e));}};row.appendChild(remove);list.appendChild(row);
    });
    paginateCommunityList('creditHistory');
    paginateCommunityList('waitlistItems');
  } catch(e) { if(request===homeRequest) box.textContent=errorMessage(e); }
}
async function joinWaitlist(reservation) {
  if(!await confirmAction('Vuoi metterti in attesa?',`${fieldName(reservation.fieldId)} · ${reservation.date} alle ${reservation.time}. Controlla la Home mentre l’app è aperta: la lista non riserva automaticamente il posto.`,'Avvisami nell’app'))return;
  try { await api('/waitlist',{method:'POST',body:JSON.stringify({reservationId:reservation.id})}); showHomePanel('waiting'); switchView('home'); }
  catch(e) { alert(e.error==='OWN_RESERVATION'?'Questa partita è già tua.':e.error==='SLOT_FREE'?'Il posto è già libero. Aggiorna e prenota.':errorMessage(e)); }
}
async function loadOperations(activePanel = 'statistics') {
  const epoch=managementContextEpoch;
  if (!['statistics','create','planned'].includes(activePanel)) activePanel='statistics';
  openAppModal('Statistiche e chiusure', '<p id="operationsLoading">Caricamento…</p>');
  const loading=qs('operationsLoading');
  try {
    const data = await api('/admin/operations');
    if(epoch!==managementContextEpoch || !qs('appModal').open || !loading.isConnected)return;
    qs('appModalBody').innerHTML=`<div class="compact-tabs" role="tablist" aria-label="Statistiche e chiusure"><button class="secondary-btn" type="button" role="tab" data-operations-panel="statistics" aria-controls="operationsStatisticsPanel">Statistiche</button><button class="secondary-btn" type="button" role="tab" data-operations-panel="create" aria-controls="operationsCreatePanel">Nuova chiusura</button><button class="secondary-btn" type="button" role="tab" data-operations-panel="planned" aria-controls="operationsPlannedPanel">Programmate</button></div>
      <section id="operationsStatisticsPanel" role="tabpanel"><div class="summary-grid"><div><strong>${data.users}</strong><span>Utenti</span></div><div><strong>${data.upcoming}</strong><span>Prenotazioni</span></div><div><strong>${data.credits}</strong><span>Crediti totali</span></div></div>
      <p class="helper-text">Prenotazioni da oggi, divise per campo.</p><div id="operationsFieldList">${Object.entries(data.byField).map(([f,n])=>`<div class="ledger-row"><span>${escapeHTML(fieldName(f))}</span><strong>${Number(n)}</strong></div>`).join('') || '<p class="muted">Nessuna prenotazione in programma.</p>'}</div></section>
      <section id="operationsCreatePanel" role="tabpanel" hidden><form id="closureForm" class="form-stack"><label>Campo<select class="admin-input" id="closureField">${STATE.fields.map(f=>`<option value="${escapeHTML(f.id)}">${escapeHTML(f.name)}</option>`).join('')}</select></label>
      <label class="closure-date-row"><span>Dal</span><input class="admin-input" id="closureStartDate" aria-label="Data iniziale" type="date" min="${localISODate()}" value="${localISODate()}" required></label>
      <label class="closure-date-row"><span>Al</span><input class="admin-input" id="closureEndDate" aria-label="Data finale" type="date" min="${localISODate()}" value="${localISODate()}" required></label>
      <label class="checkbox-label closure-all-day"><input id="closureAllDay" type="checkbox" checked>Intera giornata</label>
      <div id="closureTimes" class="admin-two-cols hidden"><label>Dalle<input class="admin-input" id="closureStart" type="time" value="${escapeHTML(STATE.config.dayStart || '09:00')}" required disabled></label><label>Alle<input class="admin-input" id="closureEnd" type="time" value="${escapeHTML(STATE.config.dayEnd || '20:00')}" required disabled></label></div>
      <label>Motivo<input class="admin-input" id="closureReason" maxlength="120" required placeholder="Es. manutenzione o torneo"></label><p class="closure-hint">Date comprese. La fascia si ripete ogni giorno e deve essere libera da prenotazioni.</p><button class="primary-btn" type="submit">Blocca periodo</button><p id="closureError" role="status"></p></form></section>
      <section id="operationsPlannedPanel" role="tabpanel" hidden><div id="closureList"></div></section>`;
    const panelIds={statistics:'operationsStatisticsPanel',create:'operationsCreatePanel',planned:'operationsPlannedPanel'};
    const selectPanel=name=>{
      Object.entries(panelIds).forEach(([key,id])=>{qs(id).hidden=key!==name;qs(id).classList.toggle('hidden',key!==name);});
      qs('appModalBody').querySelectorAll('[data-operations-panel]').forEach(button=>{
        const selected=button.dataset.operationsPanel===name;
        button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected));
      });
    };
    qs('appModalBody').querySelectorAll('[data-operations-panel]').forEach(button=>{button.onclick=()=>selectPanel(button.dataset.operationsPanel);});
    const list=qs('closureList');
    const closures=data.closures.filter(c=>(c.endDate || c.date)>=localISODate())
      .sort((a,b)=>(a.startDate || a.date).localeCompare(b.startDate || b.date) || a.start.localeCompare(b.start));
    if(!closures.length)list.innerHTML='<p class="empty-state">Nessuna chiusura programmata.</p>';
    closures.forEach(c=>{
      const row=document.createElement('div');row.className='wait-row';
      const startDate=c.startDate || c.date, endDate=c.endDate || c.date;
      const dateLabel=startDate===endDate ? formatLongDate(startDate) : `Dal ${startDate.split('-').reverse().join('/')} al ${endDate.split('-').reverse().join('/')}`;
      const timeLabel=c.start==='00:00' && c.end==='23:59' ? 'Intera giornata' : `${c.start}–${c.end} ogni giorno`;
      row.innerHTML=`<strong>${escapeHTML(fieldName(c.fieldId))}</strong><p>${escapeHTML(dateLabel)}</p><p>${escapeHTML(timeLabel)}</p><p class="muted">${escapeHTML(c.reason)}</p>`;
      const button=document.createElement('button');button.className='secondary-btn';button.textContent='Riapri periodo';button.onclick=async()=>{
        if(epoch!==managementContextEpoch)return;
        if(!await confirmAction('Riapri questo periodo?',`${fieldName(c.fieldId)} · ${dateLabel}. La chiusura verrà rimossa per tutte le date indicate.`,'Riapri periodo'))return;
        if(epoch!==managementContextEpoch || !button.isConnected)return;
        button.disabled=true;
        try{await api('/admin/closures/'+encodeURIComponent(c.id),{method:'DELETE'});if(epoch===managementContextEpoch)await loadOperations('planned');}
        catch(e){button.disabled=false;if(epoch===managementContextEpoch)alert(errorMessage(e));}
      };
      row.appendChild(button);list.appendChild(row);
    });
    paginateCommunityList('operationsFieldList');
    paginateCommunityList('closureList');
    selectPanel(activePanel);
    qs('closureStartDate').onchange=()=>{
      const start=qs('closureStartDate').value;
      qs('closureEndDate').min=start || localISODate();
      if(start && qs('closureEndDate').value<start)qs('closureEndDate').value=start;
    };
    qs('closureAllDay').onchange=()=>{
      const allDay=qs('closureAllDay').checked;
      qs('closureTimes').classList.toggle('hidden',allDay);
      [qs('closureStart'),qs('closureEnd')].forEach(input=>{input.disabled=allDay;});
    };
    qs('closureForm').onsubmit=async e=>{
      e.preventDefault();if(epoch!==managementContextEpoch)return;
      const form=e.currentTarget;
      const current=()=>epoch===managementContextEpoch && form.isConnected && qs('appModal').open;
      const startDate=qs('closureStartDate').value,endDate=qs('closureEndDate').value;
      const allDay=qs('closureAllDay').checked;
      const start=allDay?'00:00':qs('closureStart').value,end=allDay?'23:59':qs('closureEnd').value;
      if(!startDate || !endDate || endDate<startDate || start>=end){qs('closureError').textContent='Controlla il periodo e gli orari: la fine deve seguire l’inizio.';return;}
      const button=e.currentTarget.querySelector('button');button.disabled=true;
      try {await api('/admin/closures',{method:'POST',body:JSON.stringify({fieldId:qs('closureField').value,startDate,endDate,start,end,reason:qs('closureReason').value})});if(current())await loadOperations('planned');}
      catch(error){if(current())qs('closureError').textContent=error.error==='EXISTING_RESERVATIONS'?'Esistono prenotazioni in questo periodo. Nessuna chiusura è stata applicata: scegli altre date o gestisci prima le prenotazioni.':'Chiusura non salvata. Verifica date, orari e connessione.';button.disabled=false;}
    };
  } catch(e){if(epoch===managementContextEpoch && qs('appModal').open && loading.isConnected)qs('appModalBody').textContent=errorMessage(e);}
}

/* The platform administrator creates venues; every venue manager keeps a scoped workspace. */
let agendaRequest = 0;
let platformRequest = 0;
let agendaItems = [];
let agendaDisplayedDate = '';

function configureManagementAccess() {
  const manager = STATE.me?.role === 'admin';
  const platform = STATE.me?.platformAdmin === true;
  const label = platform ? 'Amministratore globale' : 'Amministratore del tuo stabilimento';
  qs('managerHomeRole').textContent = label;
  qs('adminRoleLabel').textContent = label;
  qs('adminTitle').textContent = platform && !STATE.me.managementMode ? 'Tutti gli stabilimenti' : (STATE.me.establishment?.name || 'Il tuo stabilimento');
  qs('headerRole').textContent = label;
  qs('headerRole').classList.toggle('hidden', !manager && !platform);
  qs('switchBathBtn').textContent = platform ? 'Stabilimenti' : 'Cambia';
  qs('managementBanner').classList.toggle('hidden', !STATE.me.managementMode);
  qs('managementVenueName').textContent = STATE.me.establishment?.name || '';
  document.body.classList.toggle('is-management-context', STATE.me.managementMode === true);
  qs('newUserRoleField').classList.toggle('hidden', !platform);
  qs('managerUserRoleHelp').classList.toggle('hidden', !platform);
  qs('newUserRole').value = 'user';
  qs('newUserRole').disabled = !platform;
  qs('managerPlayBtn').classList.toggle('hidden', platform);
  qs('managerSettingsBtn').classList.toggle('hidden', !platform);
  qs('managerNav').classList.toggle('platform-navigation', platform);
  qs('closeAdminBtn').classList.toggle('hidden', platform);
  qs('createUserHeading').textContent = platform ? 'Crea utente o gestore' : 'Crea un utente';
  document.querySelectorAll('[data-personal-account]').forEach(el=>el.classList.toggle('hidden',STATE.me.managementMode===true));
  [qs('managerHome'), qs('openAdminBtn')].forEach(el => (manager || platform ? show : hide)(el));
  [qs('homePlatformBtn'), qs('btnPlatformEstablishments')].forEach(el => (platform ? show : hide)(el));
  qs('homeAgendaBtn').classList.toggle('hidden', !manager);
  qs('homeManagementBtn').classList.toggle('hidden', !manager);
  ['btnAdminAgenda', 'btnAdminOperations', 'btnAdminConfig', 'btnAdminNotes', 'btnAdminFields', 'btnAdminUsers', 'btnAdminGallery'].forEach(id => qs(id).classList.toggle('hidden', !manager));
}

function resetManagementViews() {
  managementContextEpoch++;
  homeRequest++;
  agendaRequest++;
  platformRequest++;
  agendaItems = [];
  agendaDisplayedDate = '';
  STATE.users = [];
  ['agendaList', 'platformEstablishmentList', 'usersList', 'agendaStatus', 'establishmentStatus', 'createUserStatus'].forEach(id => { if (qs(id)) qs(id).textContent = ''; });
  ['agendaList', 'platformEstablishmentList'].forEach(id=>paginateCommunityList(id));
  ['establishmentCreateForm', 'createUserForm'].forEach(id => qs(id)?.reset());
  ['managerHome', 'adminShell', 'openAdminBtn', 'homePlatformBtn', 'btnPlatformEstablishments'].forEach(id => hide(qs(id)));
  hide(qs('managerNav'));
  hide(qs('managementBanner'));
}

function clearEstablishmentData() {
  stopAutoRefresh();
  reservationRequest++; matchesRequest++; playersRequest++;
  resetManagementViews();
  closeAppModal();
  if (qs('confirmDialog').open) qs('confirmDialog').close('cancel');
  qs('appModalBody').textContent='';qs('appModalTitle').textContent='';qs('confirmDetails').textContent='';
  loadedDate = ''; publicConfigRequest = null;
  STATE.me = null;
  Object.assign(STATE, {config:{},fields:[],fieldsDraft:[],users:[],reservations:[],dayReservationsAll:[],myReservations:[],playerSearches:[],closures:[],gallery:[],galleryDraft:[],notes:'',selectedTime:'',nativeSynced:false});
  ['homeSummary','homeNext','homeNotice','creditHistory','waitlistItems','matchesList','matchesStatus','openGamesList','ownedGamesList','myJoinRequestsList','playersStatus','timeGrid','bookingPreview','bookMsg','fieldsList','galleryList','notesView','managerDaySummary'].forEach(id => { if(qs(id)) qs(id).textContent=''; });
  ['creditHistory','waitlistItems'].forEach(id=>paginateCommunityList(id));
  showHomePanel('overview');
  ['agendaDate','userSearch','notesText','newFieldId','newFieldName','galleryUrl','galleryCaption','galleryLink'].forEach(id => { qs(id).value=''; });
  document.querySelectorAll('input[type="password"]').forEach(input=>{input.value='';});
  document.querySelectorAll('#app .app-view').forEach(hide);
}

async function changeManagementContext(establishmentId) {
  if (!STATE.me?.platformAdmin || contextChanging) return;
  contextChanging = true;
  managementContextEpoch++; homeRequest++; agendaRequest++; platformRequest++; reservationRequest++; matchesRequest++; playersRequest++;
  document.body.classList.add('context-changing');
  qs('contextStatus').textContent='Apertura della gestione…';
  show(qs('contextStatus'));
  stopAutoRefresh();
  try {
    const data = await api('/platform/context', establishmentId
      ? {method:'POST',body:JSON.stringify({establishmentId})} : {method:'DELETE'});
    clearEstablishmentData();
    selectedEstablishment = data.establishment.id;
    try { localStorage.setItem('tommi38-establishment', selectedEstablishment); } catch {}
    applyEstablishmentName(data.establishment.name);
    await loadAll(true);
  } catch(error) {
    if (STATE.me) { startAutoRefresh(); alert(managementError(error)); }
    else { show(qs('loginBox')); hide(qs('app')); qs('loginErr').textContent=managementError(error);show(qs('loginErr')); }
  } finally { contextChanging=false; document.body.classList.remove('context-changing'); hide(qs('contextStatus')); }
}

async function returnToPlatform() {
  if (STATE.me?.managementMode) return changeManagementContext();
  return openPlatformEstablishments();
}

async function loadManagementSummary() {
  if (STATE.me?.role !== 'admin') return;
  const epoch=managementContextEpoch, user=STATE.me;
  qs('managerDaySummary').textContent='Caricamento di oggi…';
  try {
    const data=await api('/admin/reservations?date='+localISODate());
    if(epoch!==managementContextEpoch || user!==STATE.me)return;
    const active=(data.items||[]).filter(item=>item.status==='active');
    qs('managerDaySummary').innerHTML=`<span class="mini-label">Oggi · ${escapeHTML(compactCommunityDate(localISODate()))}</span><strong>${active.length} ${active.length===1?'prenotazione':'prenotazioni'}</strong><span>${STATE.fields.length} ${STATE.fields.length===1?'campo':'campi'} · ${escapeHTML(STATE.config.dayStart || '—')}–${escapeHTML(STATE.config.dayEnd || '—')}</span>`;
  }catch(error){if(epoch===managementContextEpoch)qs('managerDaySummary').textContent=managementError(error);}
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
    , SLOT_TAKEN: 'Questo orario è già occupato. Scegli un altro orario.'
    , SLOT_CLOSED: 'Il campo è chiuso in questo orario.'
    , USER_NOT_FOUND: 'Seleziona un utente attivo dello stabilimento.'
    , USER_DISABLED: 'Questo utente è disabilitato. Abilitalo prima di prenotare.'
    , INVALID_SLOT: 'Scegli un orario tra quelli disponibili.'
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
  if (agendaDisplayedDate !== date) {
    agendaItems = [];
    list.textContent = '';
    paginateCommunityList('agendaList');
  }
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
    if (request === agendaRequest && user === STATE.me) status.textContent = managementError(error) + (agendaDisplayedDate === date ? ' Sono mostrate le ultime prenotazioni caricate.' : '');
  } finally {
    if (request === agendaRequest) {
      list.setAttribute('aria-busy', 'false');
      qs('refreshAgendaBtn').disabled = false;
    }
  }
}

function renderManagerAgenda() {
  const date = qs('agendaDate').value;
  agendaDisplayedDate = date;
  const items = agendaItems.filter(item => !qs('agendaField').value || item.fieldId === qs('agendaField').value)
    .sort((a,b) => String(a.time).localeCompare(String(b.time)) || fieldName(a.fieldId).localeCompare(fieldName(b.fieldId)));
  qs('agendaStatus').textContent = `${compactCommunityDate(date)} · ${items.length} ${items.length === 1 ? 'prenotazione' : 'prenotazioni'}`;
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
    row.innerHTML = `<div class="agenda-card-top"><strong>${escapeHTML(item.time)}${item.endTime ? '–' + escapeHTML(item.endTime) : ''}</strong><span class="request-status ${item.status === 'cancelled' ? 'rejected' : 'accepted'}">${status}</span></div><div class="agenda-booking-info"><h3>${escapeHTML(fieldName(item.fieldId))}</h3><p>Prenotata da <strong>${escapeHTML(item.user)}</strong></p></div>`;
    if (item.status === 'active') {
      const epoch = managementContextEpoch;
      row.appendChild(adminButton('Annulla', async () => {
        if (!await confirmAction('Annulla questa prenotazione?', `${item.user} · ${fieldName(item.fieldId)} · ${formatLongDate(item.date)} alle ${item.time}. Il campo tornerà disponibile. L’annullamento dalla gestione non rimborsa crediti automaticamente.`, 'Annulla prenotazione')) return;
        if (epoch !== managementContextEpoch) return;
        await api('/admin/reservations/'+encodeURIComponent(item.id), {method:'DELETE'});
        if (epoch === managementContextEpoch) await loadManagerAgenda();
      }));
    }
    list.appendChild(row);
  });
  paginateCommunityList('agendaList');
}

async function openPlatformEstablishments() {
  if (!STATE.me?.platformAdmin) return;
  if (STATE.me.managementMode) return returnToPlatform();
  openAdminShell(true);
  openAdmin('adminEstablishments');
  qs('establishmentStatus').textContent = '';
  await loadPlatformEstablishments();
}

async function loadPlatformEstablishments() {
  if (!STATE.me?.platformAdmin) return;
  const request = ++platformRequest;
  const user = STATE.me;
  const list = qs('platformEstablishmentList');
  if (!list.children.length) list.textContent = 'Caricamento stabilimenti…';
  list.setAttribute('aria-busy','true');
  try {
    const data = await api('/platform/establishments');
    if (request !== platformRequest || user !== STATE.me) return;
    list.innerHTML = '';
    (data.items || []).forEach(item => {
      const card = document.createElement('article');
      card.className = 'venue-management-card';
      const managers = item.managers || [];
      const managerLabel = managers.length ? `${managers[0].username}${managers.length>1?' + '+(managers.length-1):''}` : 'Nessun gestore';
      card.innerHTML = `<div class="agenda-card-top"><h3>${escapeHTML(item.name)}</h3><span class="request-status ${item.enabled ? 'accepted' : 'rejected'}">${item.enabled ? 'Attivo' : 'Sospeso'}</span></div><p class="venue-manager-label">Gestore: <strong>${escapeHTML(managerLabel)}</strong></p>`;
      const actions = document.createElement('div');
      actions.className = 'action-row';
      const manage = adminButton('Gestisci →', () => changeManagementContext(item.id));
      manage.className = 'primary-btn manage-venue-btn';
      actions.appendChild(manage);
      actions.appendChild(adminButton('Opzioni', () => openEstablishmentOptions(item)));
      card.appendChild(actions);
      list.appendChild(card);
    });
    paginateCommunityList('platformEstablishmentList');
  } catch (error) {
    if (request === platformRequest && user === STATE.me) list.textContent = managementError(error);
  } finally {
    if (request === platformRequest && user === STATE.me) list.setAttribute('aria-busy','false');
  }
}

function openEstablishmentOptions(item) {
  if (!STATE.me?.platformAdmin) return;
  const epoch=managementContextEpoch;
  openAppModal(item.name, `<p class="helper-text">Codice: <strong>${escapeHTML(item.id)}</strong> · ${item.enabled?'Attivo':'Sospeso'}</p><h3>Gestori</h3><div id="venueManagersList">${(item.managers || []).map(manager=>`<p class="ledger-row"><strong>${escapeHTML(manager.username)}</strong><span>${manager.disabled?'Disabilitato':'Attivo'}</span></p>`).join('') || '<p class="muted">Nessun gestore assegnato.</p>'}</div><div id="venueOptionsActions" class="form-stack"></div>`);
  const actions=qs('venueOptionsActions');
  actions.appendChild(adminButton('Modifica nome', () => {
    if(epoch===managementContextEpoch)openEstablishmentName(item);
  }));
  if (!item.legacy) actions.appendChild(adminButton(item.enabled ? 'Sospendi stabilimento' : 'Riattiva stabilimento', async () => {
    if (item.enabled && !await confirmAction('Sospendi ' + item.name + '?', 'Gli utenti e il gestore non potranno accedere finché non lo riattivi. Le prenotazioni e i dati saranno conservati.', 'Sospendi stabilimento')) return;
    if(epoch!==managementContextEpoch)return;
    await api('/platform/establishments/' + encodeURIComponent(item.id), {method:'PATCH', body:JSON.stringify({enabled:!item.enabled})});
    if(epoch!==managementContextEpoch)return;
    closeAppModal();
    qs('establishmentStatus').textContent = `${item.name}: ${item.enabled ? 'accesso sospeso' : 'accesso riattivato'}.`;
    await loadPlatformEstablishments();
  }));
  paginateCommunityList('venueManagersList');
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
  const epoch=managementContextEpoch;
  openAppModal('Modifica nome stabilimento', `<form id="venueNameForm" class="form-stack"><label class="field-label" for="venueNewName">Nome</label><input id="venueNewName" class="admin-input" value="${escapeHTML(item.name)}" required maxlength="80"><p class="helper-text">Il codice e le credenziali del gestore restano gli stessi.</p><button class="primary-btn" type="submit">Salva nome</button><p id="venueNameStatus" class="form-message" role="status"></p></form>`);
  qs('venueNameForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const name = qs('venueNewName').value.trim();
      await api('/platform/establishments/' + encodeURIComponent(item.id), {method:'PATCH',body:JSON.stringify({name})});
      if(epoch!==managementContextEpoch)return;
      if (item.id === selectedEstablishment) applyEstablishmentName(name);
      closeAppModal();
      qs('establishmentStatus').textContent = 'Nome dello stabilimento aggiornato.';
      await loadPlatformEstablishments();
    } catch (error) { if (epoch===managementContextEpoch && qs('venueNameStatus')) qs('venueNameStatus').textContent = managementError(error); button.disabled = false; }
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
    const role = STATE.me.platformAdmin ? qs('newUserRole').value : 'user';
    await api('/admin/users',{method:'POST',body:JSON.stringify({username,password:qs('newUserPassword').value,credits:Number(qs('newUserCredits').value), ...(STATE.me.platformAdmin ? {role} : {})})});
    form.reset();
    if (user !== STATE.me) return;
    status.textContent = `${role==='admin'?'Gestore':'Utente'} ${username} creato. Può accedere selezionando questo stabilimento.`;
    await loadUsers();
  } catch (error) { if (user === STATE.me) status.textContent = managementError(error); }
  finally { qs('createUserBtn').disabled = false; }
}

function openUserPassword(user) {
  const epoch=managementContextEpoch;
  openAppModal('Imposta password', `<form id="userPasswordForm" class="form-stack"><p>Account: <strong>${escapeHTML(user.username)}</strong></p><label class="field-label" for="managedNewPassword">Nuova password</label><input id="managedNewPassword" class="admin-input" type="password" required minlength="12" maxlength="72" autocomplete="new-password"><p class="helper-text">Almeno 12 caratteri. Comunica la nuova password all’utente con un canale riservato.</p><button class="primary-btn" type="submit">Aggiorna password</button><p id="managedPasswordStatus" class="form-message" role="status"></p></form>`);
  qs('userPasswordForm').onsubmit = async event => {
    event.preventDefault();
    if (!validManagementPassword(qs('managedNewPassword'), qs('managedPasswordStatus'))) return;
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await api('/admin/users/password',{method:'PUT',body:JSON.stringify({username:user.username,newPassword:qs('managedNewPassword').value})});
      if(epoch!==managementContextEpoch)return;
      if (qs('managedNewPassword')) qs('managedNewPassword').value = '';
      closeAppModal();
      await loadUsers();
      qs('createUserStatus').textContent = `Password di ${user.username} aggiornata.`;
      qs('createUserForm').closest('details').open = true;
    } catch (error) { if (epoch===managementContextEpoch && qs('managedPasswordStatus')) qs('managedPasswordStatus').textContent = managementError(error); button.disabled = false; }
  };
}

function openUserCredits(user) {
  const epoch=managementContextEpoch;
  openAppModal('Gestisci crediti', `<form id="userCreditsForm" class="form-stack"><p><strong>${escapeHTML(user.username)}</strong> · saldo attuale: ${Number(user.credits || 0)} crediti</p><label class="field-label" for="creditOperation">Operazione</label><select id="creditOperation" class="admin-input"><option value="1">Aggiungi crediti</option><option value="-1">Rimuovi crediti</option></select><label class="field-label" for="creditAmount">Numero di crediti</label><input id="creditAmount" class="admin-input" type="number" min="1" max="100000" step="1" required value="1"><p class="helper-text">Il movimento viene registrato nello storico dell’utente.</p><button class="primary-btn" type="submit">Salva movimento</button><p id="managedCreditsStatus" class="form-message" role="status"></p></form>`);
  qs('userCreditsForm').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await api('/admin/users/credits',{method:'PUT',body:JSON.stringify({username:user.username,delta:Number(qs('creditAmount').value)*Number(qs('creditOperation').value)})});
      if(epoch!==managementContextEpoch)return;
      closeAppModal();
      await loadUsers();
      if (!STATE.me?.managementMode && user.username === STATE.me?.username) await refreshCredits();
    } catch (error) { if (epoch===managementContextEpoch && qs('managedCreditsStatus')) qs('managedCreditsStatus').textContent = managementError(error); button.disabled = false; }
  };
}

async function openManagedBooking() {
  if (STATE.me?.role !== 'admin') return;
  const epoch=managementContextEpoch;
  openAppModal('Nuova prenotazione', '<p>Caricamento utenti…</p>');
  try {
    await loadUsers();
    if(epoch!==managementContextEpoch || !qs('appModal').open)return;
    const users=STATE.users.filter(user=>!user.disabled && !user.platformAdmin);
    if(!STATE.fields.length || !users.length){qs('appModalBody').textContent=!STATE.fields.length?'Aggiungi prima almeno un campo da Orari e campi.':'Crea prima un utente attivo da Utenti e crediti.';return;}
    qs('appModalBody').innerHTML=`<form id="managedBookingForm" class="form-stack"><p class="booking-admin-note">Prenoti per un utente di questo stabilimento. Non verranno scalati crediti.</p><label class="field-label" for="managedBookingUser">A nome di</label><select id="managedBookingUser" class="admin-input" required><option value="">Scegli un utente</option>${users.map(user=>`<option value="${escapeHTML(user.username)}">${escapeHTML(user.username)}</option>`).join('')}</select><label class="field-label" for="managedBookingDate">Giorno</label><input id="managedBookingDate" class="admin-input" type="date" min="${localISODate()}" value="${escapeHTML(qs('agendaDate').value>=localISODate()?qs('agendaDate').value:localISODate())}" required><label class="field-label" for="managedBookingField">Campo</label><select id="managedBookingField" class="admin-input" required>${STATE.fields.map(field=>`<option value="${escapeHTML(field.id)}">${escapeHTML(field.name)}</option>`).join('')}</select><label class="field-label" for="managedBookingTime">Orario</label><select id="managedBookingTime" class="admin-input" required></select><p id="managedBookingAvailability" class="helper-text" role="status"></p><button id="managedBookingSubmit" class="primary-btn" type="submit">Conferma prenotazione</button><p id="managedBookingStatus" class="form-message" role="status"></p></form>`;
    let availabilityRequest=0;
    const refresh=async()=>{
      const request=++availabilityRequest;
      const select=qs('managedBookingTime'),submit=qs('managedBookingSubmit');
      select.innerHTML=''; submit.disabled=true;
      qs('managedBookingAvailability').textContent='Controllo disponibilità…';
      try {
        const date=qs('managedBookingDate').value, field=qs('managedBookingField').value;
        if(!date)return;
        const data=await api('/reservations?date='+encodeURIComponent(date));
        if(epoch!==managementContextEpoch || request!==availabilityRequest || !select.isConnected)return;
        const occupied=(data.items||[]).filter(item=>item.fieldId===field);
        const closures=(data.closures||[]).filter(item=>item.fieldId===field);
        for(let t=minutes(STATE.config.dayStart);t+currentSlotMinutes()<=minutes(STATE.config.dayEnd);t+=currentSlotMinutes()){
          const time=timeStr(t);
          if(date===localISODate() && t<=nowMinutes())continue;
          if(occupied.some(item=>item.time===time) || closures.some(item=>t<minutes(item.end) && t+currentSlotMinutes()>minutes(item.start)))continue;
          const option=document.createElement('option');option.value=time;option.textContent=time+'–'+timeStr(t+currentSlotMinutes());select.append(option);
        }
        submit.disabled=!select.options.length;
        qs('managedBookingAvailability').textContent=select.options.length?'Durata '+currentSlotMinutes()+' minuti.':'Nessun orario libero: prova un altro giorno o campo.';
      }catch(error){if(epoch===managementContextEpoch && select.isConnected)qs('managedBookingAvailability').textContent=managementError(error);}
    };
    qs('managedBookingDate').onchange=refresh;qs('managedBookingField').onchange=refresh;
    qs('managedBookingForm').onsubmit=async event=>{
      event.preventDefault();if(epoch!==managementContextEpoch || qs('managedBookingSubmit').disabled)return;
      const submit=qs('managedBookingSubmit');submit.disabled=true;
      const date=qs('managedBookingDate').value;
      try {
        await api('/admin/reservations',{method:'POST',body:JSON.stringify({username:qs('managedBookingUser').value,fieldId:qs('managedBookingField').value,date,time:qs('managedBookingTime').value})});
        if(epoch!==managementContextEpoch)return;
        closeAppModal();qs('agendaDate').value=date;await loadManagerAgenda();
      }catch(error){if(epoch===managementContextEpoch && submit.isConnected){qs('managedBookingStatus').textContent=managementError(error);submit.disabled=false;}}
    };
    await refresh();
  }catch(error){if(epoch===managementContextEpoch && qs('appModal').open)qs('appModalBody').textContent=managementError(error);}
}

function openUserRole(user) {
  if (!STATE.me?.platformAdmin || user.platformAdmin) return;
  const epoch=managementContextEpoch;
  openAppModal('Ruolo nello stabilimento', `<form id="userRoleForm" class="form-stack"><p>Account: <strong>${escapeHTML(user.username)}</strong></p><label class="field-label" for="managedUserRole">Ruolo</label><select id="managedUserRole" class="admin-input"><option value="user" ${user.role==='admin'?'':'selected'}>Utente · prenota e gioca</option><option value="admin" ${user.role==='admin'?'selected':''}>Gestore · amministra questo stabilimento</option></select><p class="helper-text">Il gestore può modificare orari, campi, prenotazioni, utenti e crediti soltanto in questo stabilimento.</p><button class="primary-btn" type="submit">Salva ruolo</button><p id="managedRoleStatus" class="form-message" role="status"></p></form>`);
  qs('userRoleForm').onsubmit=async event=>{
    event.preventDefault();if(epoch!==managementContextEpoch)return;
    const button=event.currentTarget.querySelector('button');button.disabled=true;
    try{await api('/admin/users/role',{method:'PUT',body:JSON.stringify({username:user.username,role:qs('managedUserRole').value})});if(epoch===managementContextEpoch){closeAppModal();await loadUsers();}}
    catch(error){if(epoch===managementContextEpoch && qs('managedRoleStatus')){qs('managedRoleStatus').textContent=managementError(error);button.disabled=false;}}
  };
}

document.addEventListener('DOMContentLoaded',()=>{
  const homeTabs=[...document.querySelectorAll('[data-home-panel]')];
  homeTabs[0]?.parentElement.setAttribute('role','tablist');
  homeTabs.forEach((button,index)=>{
    button.onclick=()=>showHomePanel(button.dataset.homePanel);
    button.onkeydown=event=>{
      let next=index;
      if(event.key==='ArrowRight')next=(index+1)%homeTabs.length;
      else if(event.key==='ArrowLeft')next=(index+homeTabs.length-1)%homeTabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=homeTabs.length-1;
      else return;
      event.preventDefault();showHomePanel(homeTabs[next].dataset.homePanel);homeTabs[next].focus();
    };
  });
  showHomePanel('overview');
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
  qs('newManagedBookingBtn').onclick = openManagedBooking;
  qs('returnToPlatformBtn').onclick = returnToPlatform;
  qs('managerDashboardBtn').onclick = openAdminShell;
  qs('managerAgendaBtn').onclick = openManagerAgenda;
  qs('managerUsersBtn').onclick = () => {openAdminShell();openAdmin('adminUsers');loadUsers().catch(error=>{qs('usersList').textContent=managementError(error);});};
  qs('managerPlayBtn').onclick = () => switchView('home');
  qs('managerSettingsBtn').onclick = () => {openAdminShell();openAdmin('adminConfig');};
  qs('managerQuickAgendaBtn').onclick = () => {qs('agendaDate').value=localISODate();openManagerAgenda();};
  qs('agendaDate').onchange = loadManagerAgenda;
  qs('agendaField').onchange = renderManagerAgenda;
  qs('agendaTodayBtn').onclick = () => { qs('agendaDate').value = localISODate(); loadManagerAgenda(); };
  qs('agendaTomorrowBtn').onclick = () => { qs('agendaDate').value = tomorrowISODate(); loadManagerAgenda(); };
  qs('appModal').addEventListener('close', () => {
    qs('appModalBody').querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
  });
});
