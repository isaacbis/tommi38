/* The trial starts only after setup, so all ten minutes remain for testing. */
function openPublicDemoSetup() {
  const draft = {name:'La tua demo',fields:['Beach volley','Tennis','Padel'],dayStart:'08:00',dayEnd:'23:00',slotMinutes:40};
  let step = 0;
  openAppModal('Prepara la tua demo', '<form id="demoSetupForm" class="demo-setup" novalidate></form>');
  const form = qs('demoSetupForm');
  const labels = ['Campi','Orari','Riepilogo'];
  const syncDraft = () => {
    if (step === 0) {
      draft.name = form.querySelector('#demoSetupName').value;
      draft.fields = Array.from(form.querySelectorAll('[data-setup-field]'), input=>input.value);
    } else if (step === 1) {
      draft.dayStart = form.querySelector('#demoSetupStart').value;
      draft.dayEnd = form.querySelector('#demoSetupEnd').value;
      draft.slotMinutes = Number(form.querySelector('#demoSetupDuration').value);
    }
  };
  const validation = stage => {
    const validName = value => value.trim().length > 0 && value.trim().length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
    if (stage === 0) {
      if (!validName(draft.name)) return {message:'Dai un nome alla tua demo, fino a 80 caratteri.',id:'demoSetupName'};
      const empty = draft.fields.findIndex(value=>!validName(value));
      if (empty >= 0) return {message:'Scrivi un nome per ogni campo, fino a 80 caratteri.',id:'demoSetupField'+empty};
      if (new Set(draft.fields.map(value=>value.trim().toLocaleLowerCase('it'))).size !== draft.fields.length) return {message:'Usa nomi diversi per i campi, ad esempio Volley 1 e Volley 2.',id:'demoSetupField0'};
      if (draft.fields.length < 1 || draft.fields.length > 6) return {message:'Puoi provare da uno a sei campi.',id:'demoSetupName'};
    } else {
      const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
      if (!time.test(draft.dayStart)) return {message:'Scegli un orario di apertura valido.',id:'demoSetupStart'};
      if (!time.test(draft.dayEnd)) return {message:'Scegli un orario di chiusura valido.',id:'demoSetupEnd'};
      if (![15,30,40,60,90].includes(draft.slotMinutes)) return {message:'Scegli la durata di una prenotazione.',id:'demoSetupDuration'};
      const minutes = value=>Number(value.slice(0,2))*60+Number(value.slice(3));
      if (minutes(draft.dayEnd)-minutes(draft.dayStart) < draft.slotMinutes) return {message:'La chiusura deve essere dopo l’apertura e consentire almeno una prenotazione completa.',id:'demoSetupEnd'};
    }
    return null;
  };
  const showError = error => {
    qs('demoSetupError').textContent = error.message;
    form.querySelector('#'+error.id)?.focus();
  };
  const render = () => {
    const progress = `<div class="setup-progress" aria-label="Passaggio ${step+1} di 3">${labels.map((label,index)=>`<span class="${index===step?'current':index<step?'complete':''}"${index===step?' aria-current="step"':''}>${index+1} · ${label}</span>`).join('')}</div>`;
    let body;
    if (step === 0) {
      body = `<h3 class="setup-question">Come si chiamano i tuoi campi?</h3><label class="field-label" for="demoSetupName">Nome dello stabilimento demo</label><input class="admin-input" id="demoSetupName" value="${escapeHTML(draft.name)}" maxlength="80" autocomplete="off" required><div id="demoSetupFields">${draft.fields.map((name,index)=>`<div class="setup-field-row"><label for="demoSetupField${index}">Campo ${index+1}</label><input class="admin-input" id="demoSetupField${index}" data-setup-field="${index}" value="${escapeHTML(name)}" maxlength="80" autocomplete="off" required><button class="secondary-btn" type="button" data-setup-remove="${index}" aria-label="Rimuovi campo ${index+1}"${draft.fields.length===1?' disabled':''}>×</button></div>`).join('')}</div><button class="secondary-btn" type="button" data-setup-action="add"${draft.fields.length>=6?' disabled':''}>+ Aggiungi campo</button><p class="setup-note">Da 1 a 6 campi. Potrai modificarli anche durante la prova.</p>`;
    } else if (step === 1) {
      body = `<h3 class="setup-question">Quando si può giocare?</h3><div class="setup-hours"><label class="field-label" for="demoSetupStart">Apertura<input class="admin-input" id="demoSetupStart" type="time" value="${escapeHTML(draft.dayStart)}" required></label><label class="field-label" for="demoSetupEnd">Chiusura<input class="admin-input" id="demoSetupEnd" type="time" value="${escapeHTML(draft.dayEnd)}" required></label></div><label class="field-label" for="demoSetupDuration">Durata di una prenotazione</label><select class="admin-input" id="demoSetupDuration">${[15,30,40,60,90].map(minutes=>`<option value="${minutes}"${draft.slotMinutes===minutes?' selected':''}>${minutes} minuti</option>`).join('')}</select><p class="setup-note">Gli stessi orari valgono per tutti i campi. Il tempo della demo inizierà quando premi «Avvia la demo».</p>`;
    } else {
      body = `<h3 class="setup-question">È tutto pronto per provare</h3><div class="setup-summary"><div><span>Stabilimento</span><strong>${escapeHTML(draft.name.trim())}</strong></div><div><span>Campi</span><strong>${draft.fields.map(name=>escapeHTML(name.trim())).join(' · ')}</strong></div><div><span>Orari</span><strong>${escapeHTML(draft.dayStart)}–${escapeHTML(draft.dayEnd)}</strong></div><div><span>Prenotazioni</span><strong>${draft.slotMinutes} minuti · 1 credito</strong></div></div><p class="setup-note">10 minuti per provare, 100 crediti fittizi. Entri come gestore e puoi passare a utente per prenotare. Nessun pagamento.</p>`;
    }
    form.innerHTML = `${progress}${body}<p id="demoSetupError" class="form-message" role="alert"></p><div class="setup-actions">${step>0?'<button class="secondary-btn" type="button" data-setup-action="back">Indietro</button>':''}<button class="primary-btn" type="submit">${step===2?'Avvia la demo':'Continua'}</button></div><button class="setup-skip" type="button" data-setup-action="skip">Salta · usa impostazioni base</button><p class="setup-defaults">Base: Beach volley, Tennis e Padel · 08:00–23:00 · 40 minuti.</p>`;
    qs('appModalBody').scrollTop = 0;
  };
  form.addEventListener('input', () => {
    syncDraft();
    qs('demoSetupError').textContent = '';
  });
  form.addEventListener('change', syncDraft);
  form.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled || !form.contains(button)) return;
    const action = button.dataset.setupAction;
    if (action === 'skip') { launchPublicDemo(null,button); return; }
    if (!action && button.dataset.setupRemove === undefined) return;
    syncDraft();
    if (action === 'back') step = Math.max(0,step-1);
    else if (action === 'add') {
      if (draft.fields.length >= 6) return;
      let number = draft.fields.length+1;
      while (draft.fields.some(name=>name.trim().toLocaleLowerCase('it')==='campo '+number)) number++;
      draft.fields.push('Campo '+number);
    } else if (button.dataset.setupRemove !== undefined) {
      if (draft.fields.length <= 1) return;
      draft.fields.splice(Number(button.dataset.setupRemove),1);
    } else return;
    render();
    if (action === 'add') qs('demoSetupField'+(draft.fields.length-1))?.focus();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    syncDraft();
    if (step < 2) {
      const error = validation(step);
      if (error) { showError(error); return; }
      step++;
      render();
      return;
    }
    for (const stage of [0,1]) {
      const error = validation(stage);
      if (error) { step=stage;render();showError(error);return; }
    }
    launchPublicDemo({...draft,name:draft.name.trim(),fields:draft.fields.map(name=>name.trim())},event.submitter || form.querySelector('[type="submit"]'));
  });
  render();
}
