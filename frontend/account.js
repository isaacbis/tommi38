/* Account and credit requests use the currently selected establishment. */
(() => {
  const message = error => ({
    REGISTRATION_CLOSED: 'Le registrazioni sono chiuse. Rivolgiti al gestore.',
    USERNAME_UNAVAILABLE: 'Username già utilizzato. Scegline un altro.',
    WRONG_PASSWORD: 'La password attuale non è corretta.',
    BAD_BODY: 'Controlla i dati inseriti. La nuova password deve avere almeno 12 caratteri.',
    REQUEST_PENDING: 'Hai già una richiesta in attesa del gestore.',
    REQUEST_ALREADY_HANDLED: 'La richiesta è già stata gestita. Aggiorna la lista.'
  }[error?.error] || errorMessage(error));
  const button = (label, action, className = 'secondary-btn') => {
    const element = document.createElement('button');
    element.type = 'button'; element.className = className;
    element.textContent = label; element.onclick = action;
    return element;
  };
  function modal(title, html) {
    openAppModal(title, '<div id="accountContent" class="form-stack">' + html + '</div>');
    const root = qs('accountContent');
    const venue = selectedEstablishment;
    const username = STATE.me?.username;
    const epoch = managementContextEpoch;
    const current = () => root.isConnected && qs('appModal').open &&
      venue === selectedEstablishment && username === STATE.me?.username && epoch === managementContextEpoch;
    return {root, current};
  }
  const passwordInput = (id, label, current = false) => `<label class="field-label" for="${id}">${label}</label><input id="${id}" class="admin-input" type="password" required ${current ? '' : 'minlength="12"'} maxlength="72" autocomplete="${current ? 'current-password' : 'new-password'}">`;
  function bindForm(root, current, action) {
    const form = root.querySelector('form');
    const status = root.querySelector('[role="status"]');
    form.onsubmit = async event => {
      event.preventDefault();
      if (!current()) return;
      const submit = form.querySelector('[type="submit"]');
      if (submit.disabled) return;
      for (const input of form.querySelectorAll('input[type="password"]')) {
        if (!validManagementPassword(input, status)) return;
      }
      submit.disabled = true; status.textContent = '';
      try { await action(form, status); }
      catch (error) { if (current()) status.textContent = message(error); }
      finally { if (current()) submit.disabled = false; }
    };
  }
  function registration() {
    const {root,current} = modal('Registrati allo stabilimento', `<form class="form-stack"><label class="field-label" for="signupUsername">Username</label><input id="signupUsername" class="admin-input" required pattern="[a-zA-Z0-9._\\-]{3,40}" minlength="3" maxlength="40" autocomplete="username" autocapitalize="none">${passwordInput('signupPassword','Password')}<p class="helper-text">Il gestore deve approvare il tuo account prima del primo accesso.</p><button class="primary-btn" type="submit">Richiedi iscrizione</button><p role="status"></p></form>`);
    bindForm(root,current,async(form,status) => {
      await api('/auth/register',{method:'POST',body:JSON.stringify({username:form.querySelector('#signupUsername').value,password:form.querySelector('#signupPassword').value})});
      form.reset();
      if (current()) root.textContent = 'Richiesta inviata. Potrai accedere quando il gestore avrà approvato il tuo account.';
    });
  }
  function recovery() {
    const {root,current} = modal('Recupera accesso', '<form class="form-stack"><label class="field-label" for="recoveryUsername">Username</label><input id="recoveryUsername" class="admin-input" required minlength="3" maxlength="40" autocomplete="username" autocapitalize="none"><p class="helper-text">Il gestore verificherà la tua identità e ti aiuterà a impostare una nuova password.</p><button class="primary-btn" type="submit">Richiedi assistenza</button><p role="status"></p></form>');
    bindForm(root,current,async form => {
      await api('/auth/recovery-request',{method:'POST',body:JSON.stringify({username:form.querySelector('input').value})});
      if(current()) root.textContent = 'Se l’account esiste, la richiesta è stata registrata. Contatta il gestore per completare la verifica della tua identità.';
    });
  }
  function changePassword() {
    if(STATE.me?.managementMode)return;
    const {root,current} = modal('Cambia la tua password', `<form class="form-stack">${passwordInput('accountCurrent','Password attuale',true)}${passwordInput('accountNew','Nuova password')}<p class="helper-text">Almeno 12 caratteri. Gli altri dispositivi dovranno accedere di nuovo.</p><button class="primary-btn" type="submit">Salva password</button><p role="status"></p></form>`);
    bindForm(root,current,async form => {
      await api('/auth/password',{method:'POST',body:JSON.stringify({currentPassword:form.querySelector('#accountCurrent').value,newPassword:form.querySelector('#accountNew').value})});
      form.reset(); if(current()) root.textContent = 'Password aggiornata.';
    });
  }
  async function requestCredits() {
    const {root,current} = modal('Richiedi crediti', '<p>Caricamento…</p>');
    try {
      const [packages,requests] = await Promise.all([api('/auth/credit-packages'),api('/auth/credit-requests')]);
      if(!current())return;
      root.textContent='';
      const note=document.createElement('p'); note.className='muted';
      note.textContent='La ricarica richiede l’approvazione del gestore. Concorda con lui le modalità; qui non viene effettuato alcun pagamento.'; root.append(note);
      if(requests.item){const p=document.createElement('p');p.textContent=`Ultima richiesta: ${requests.item.packageTitle} · ${Number(requests.item.credits)} crediti · ${ {pending:'in attesa',approved:'approvata',rejected:'rifiutata'}[requests.item.status] || requests.item.status}`;root.append(p);}
      if(requests.item?.status==='pending')return;
      if(!packages.items.length){root.append(document.createTextNode('Nessun pacchetto disponibile. Rivolgiti al gestore.'));return;}
      for(const pack of packages.items) root.append(button(`${pack.title} · ${Number(pack.credits)} crediti`,async event => {
        const btn=event.currentTarget;btn.disabled=true;
        try { await api('/auth/credit-requests',{method:'POST',body:JSON.stringify({packageId:pack.id})});if(current())await requestCredits(); }
        catch(error){if(current()){note.textContent=message(error);btn.disabled=false;}}
      }));
    }catch(error){if(current())root.textContent=message(error);}
  }
  async function manageRequests() {
    const {root,current} = modal('Richieste utenti', '<p>Caricamento…</p>');
    try {
      const [credits,recoveries] = await Promise.all([api('/auth/admin/credit-requests'),api('/auth/admin/recovery-requests')]);
      if(!current())return;
      root.innerHTML='<h3>Ricariche da approvare</h3>';
      if(!credits.items.length) root.append(document.createTextNode('Nessuna ricarica in attesa.'));
      for(const item of credits.items){
        const row=document.createElement('div');row.className='wait-row';
        const label=document.createElement('p');label.textContent=`${item.username} · ${item.packageTitle} · ${Number(item.credits)} crediti`;row.append(label);
        for(const [status,label] of [['approved','Approva ricarica'],['rejected','Rifiuta']])row.append(button(label,async()=>{
          row.querySelectorAll('button').forEach(b=>b.disabled=true);
          try{await api('/auth/admin/credit-requests/'+encodeURIComponent(item.username),{method:'PATCH',body:JSON.stringify({status})});if(current())await manageRequests();}
          catch(error){if(current()){const p=document.createElement('p');p.textContent=message(error);row.append(p);row.querySelectorAll('button').forEach(b=>b.disabled=false);}}
        }));root.append(row);
      }
      const heading=document.createElement('h3');heading.textContent='Assistenza per l’accesso';root.append(heading);
      const note=document.createElement('p');note.className='helper-text';note.textContent='Verifica l’identità della persona prima di reimpostare la password. Una richiesta da sola non dimostra che sia il titolare dell’account.';root.append(note);
      if(!recoveries.items.length)root.append(document.createTextNode('Nessuna richiesta di assistenza.'));
      for(const item of recoveries.items)root.append(button('Assisti '+item.username,()=>openUserPassword({username:item.username})));
    }catch(error){if(current())root.textContent=message(error);}
  }
  async function managePackages() {
    const {root,current}=modal('Pacchetti crediti','<p>Caricamento…</p>');
    try {
      const data=await api('/auth/credit-packages');if(!current())return;
      const items=data.items.map(item=>({...item}));
      root.innerHTML='<p class="helper-text">Gli utenti possono richiedere un pacchetto. Sei tu ad approvare ogni ricarica.</p><div id="packageRows"></div><form class="form-stack"><label class="field-label" for="packageTitle">Nome pacchetto</label><input id="packageTitle" class="admin-input" maxlength="60" required placeholder="10 partite"><label class="field-label" for="packageCredits">Crediti</label><input id="packageCredits" class="admin-input" type="number" min="1" max="10000" step="1" required><button class="primary-btn" type="submit">Aggiungi pacchetto</button><p role="status"></p></form>';
      const rows=root.querySelector('#packageRows');
      const draw=()=>{
        rows.textContent='';
        for(const pack of items){const row=document.createElement('div');row.className='wait-row';const label=document.createElement('p');label.textContent=`${pack.title} · ${pack.credits} crediti`;row.append(label,button('Rimuovi',async event=>{
          event.currentTarget.disabled=true;
          try{const next=items.filter(p=>p.id!==pack.id);await api('/auth/admin/credit-packages',{method:'PUT',body:JSON.stringify({items:next})});if(current()){items.splice(0,items.length,...next);draw();}}
          catch(error){if(current()){root.querySelector('[role="status"]').textContent=message(error);event.target.disabled=false;}}
        }));rows.append(row);}
      };draw();
      bindForm(root,current,async(form,status)=>{
        if(items.length>=12){status.textContent='Puoi creare al massimo 12 pacchetti.';return;}
        const next=[...items,{id:crypto.randomUUID(),title:form.querySelector('#packageTitle').value.trim(),credits:Number(form.querySelector('#packageCredits').value)}];
        await api('/auth/admin/credit-packages',{method:'PUT',body:JSON.stringify({items:next})});
        if(current()){items.splice(0,items.length,...next);form.reset();draw();status.textContent='Pacchetto salvato.';}
      });
    }catch(error){if(current())root.textContent=message(error);}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const controls=document.createElement('div');controls.className='form-stack';
    const signup=button('Registrati',registration);signup.classList.add('hidden');
    controls.append(signup,button('Password dimenticata?',recovery));qs('loginForm').after(controls);
    const originalGallery=loadPublicLoginGallery;
    loadPublicLoginGallery=async function(...args){
      const venue=selectedEstablishment;signup.classList.add('hidden');
      const result=await originalGallery(...args);
      try{const config=await loadPublicConfig();if(venue===selectedEstablishment)signup.classList.toggle('hidden',config.registrationEnabled!==true);}catch{}
      return result;
    };
    const settings=document.createElement('section');settings.className='glass-card wait-row';settings.dataset.personalAccount='';
    settings.append(button('Cambia password',changePassword));qs('viewAlerts').append(settings);
    const ownAccount=button('Cambia la mia password',changePassword);ownAccount.dataset.personalAccount='';qs('adminMenu').append(ownAccount);
    const globalAccount=button('Cambia la password di amministratore',changePassword);globalAccount.dataset.personalAccount='';qs('adminEstablishments').append(globalAccount);
    qs('creditHistory').closest('section').append(button('Richiedi crediti',requestCredits));
    const admin=document.createElement('div');admin.className='home-actions';
    admin.append(button('Richieste utenti',manageRequests),button('Pacchetti crediti',managePackages));qs('adminUsers').prepend(admin);
  });
})();
