/* Native ads are optional. Browser users and older iOS builds remain fully usable. */
window.CampoAds = (() => {
  const supported=()=>window.tommi38Native?.adsVersion===1 && !!window.webkit?.messageHandlers?.campoprontoAds;
  let busy=false;
  function native(action,token) {
    return new Promise(resolve=>{
      if(!supported())return resolve({status:'unavailable'});
      const id=crypto.randomUUID();
      const timer=setTimeout(()=>finish({status:'timeout'}),180000);
      function finish(result){clearTimeout(timer);window.removeEventListener('campoprontoAd',receive);resolve(result);}
      function receive(event){if(event.detail?.id===id)finish(event.detail);}
      window.addEventListener('campoprontoAd',receive);
      window.webkit.messageHandlers.campoprontoAds.postMessage({action,id,...(token?{token}:{})});
    });
  }
  async function privacy(){
    const result=await native('privacy');
    if(result.status==='unavailable')alert('Preferenze pubblicitarie momentaneamente non disponibili. Riprova più tardi.');
  }
  async function credits(root,current){
    const status=document.createElement('p');status.setAttribute('role','status');root.append(status);
    const refresh=document.createElement('button');refresh.className='secondary-btn';refresh.textContent='Aggiorna premio';
    const watch=document.createElement('button');watch.className='primary-btn';root.append(watch,refresh);
    let data;
    async function update(){
      try{
        data=await api('/ads/status');if(!current())return;
        status.textContent=data.earned?'Credito premio di oggi assegnato. Torna domani.':`${data.videos}/2 video verificati oggi. Due video completati danno un credito personale, non trasferibile e non convertibile in denaro.`;
        watch.textContent=data.videos===1?'Guarda il secondo video':'Guarda il primo video';
        watch.disabled=busy || data.earned || !data.available || !supported();
        if(!supported())status.textContent+=' I video sono disponibili nell’app iPhone aggiornata.';
        else if(!data.available)status.textContent+=' I video premio non sono ancora disponibili in questo ambiente.';
      }catch{if(current()){watch.disabled=true;status.textContent='Impossibile aggiornare il premio. Riprova.';}}
    }
    refresh.onclick=update;
    watch.onclick=async()=>{
      if(busy || !current())return;
      busy=true;watch.disabled=true;let token;
      const venue=selectedEstablishment;
      try{
        status.textContent='Preparazione del video… Puoi chiuderlo senza premio.';
        const consent=await native('prepare');
        if(consent.status!=='ready')throw {error:'ADS_UNAVAILABLE'};
        if(!current())return;
        ({token}=await api('/ads/start',{method:'POST',body:'{}'}));
        if(!current())return;
        const result=await native('reward',token);
        if(!current())return;
        if(result.status==='earned'){
          status.textContent='Video completato. Attendo la verifica di Google…';
          const before=data.videos;
          for(let i=0;i<10 && current();i++){
            await new Promise(resolve=>setTimeout(resolve,2000));
            const next=await api('/ads/status');
            if(next.videos>before){await update();if(typeof refreshHome==='function')refreshHome();return;}
          }
          if(current())status.textContent='Video completato: la verifica è ancora in corso. Premi Aggiorna premio tra poco; non serve riguardarlo.';
        } else {
          await api('/ads/cancel',{method:'POST',body:JSON.stringify({token})});
          status.textContent=result.status==='closed'?'Video chiuso prima del premio. Puoi riprovare.':'Nessun video disponibile ora. Riprova più tardi.';
        }
      }catch(error){if(current())status.textContent=({REWARD_PENDING:'Una visione è in attesa di verifica. Aggiorna il premio tra poco.',DAILY_REWARD_LIMIT:'Hai già ottenuto il premio di oggi.'}[error?.error] || 'Video non disponibile ora. Le prenotazioni restano accessibili.');}
      finally{busy=false;if(current())watch.disabled=!data?.available||data?.earned||!supported();if(token && venue!==selectedEstablishment){/* Never cancel under another tenant. */}}
    };
    await update();
  }
  async function afterLogin(){
    if(!supported() || !STATE.me || STATE.me.demo || STATE.me.role==='admin')return;
    const venue=selectedEstablishment,user=STATE.me.username;
    try{
      const data=await api('/ads/status');
      if(!data.available || venue!==selectedEstablishment || user!==STATE.me?.username)return;
      // A dedicated transition before interacting with the venue; never on a booking confirmation.
      const cancel=()=>window.webkit.messageHandlers.campoprontoAds.postMessage({action:'cancel',id:'navigation'});
      document.addEventListener('pointerdown',cancel,{once:true});
      try{await native('interstitial');}finally{document.removeEventListener('pointerdown',cancel);}
    }catch{/* Advertising never blocks login or booking. */}
  }
  async function testReward(){
    const result=await native('testReward','0'.repeat(64));
    alert(result.status==='earned'?'Annuncio di test completato. Nessun credito reale assegnato.':'Annuncio di test chiuso o non disponibile. Nessun credito reale assegnato.');
  }
  document.addEventListener('DOMContentLoaded',()=>{
    if(window.tommi38Native?.adsTesting){
      const test=document.createElement('button');test.className='secondary-btn';test.textContent='Test AdMob (sviluppo)';test.onclick=testReward;
      document.getElementById('loginBox')?.append(test);
    }
  });
  return {supported,privacy,credits,afterLogin,testReward};
})();
