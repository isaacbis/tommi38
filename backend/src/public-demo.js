import { randomBytes } from 'node:crypto';

export const PUBLIC_DEMO_DURATION = 10 * 60 * 1000;
const DEFAULT_DEMO_FIELDS = [{id:'volley-demo',name:'Beach volley'},{id:'tennis-demo',name:'Tennis'},{id:'padel-demo',name:'Padel'}];

export function normalizePublicDemoSetup(setup) {
  const invalid = () => { throw Object.assign(new Error('Controlla il nome, i campi e gli orari della demo.'), {code:'INVALID_DEMO_SETUP'}); };
  const allowed = ['name','fields','dayStart','dayEnd','slotMinutes'];
  if (setup === undefined) setup = {};
  if (!setup || typeof setup !== 'object' || Array.isArray(setup) || Object.keys(setup).some(key=>!allowed.includes(key))) invalid();
  const plainName = value => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) invalid();
    return value.trim();
  };
  const name = setup.name === undefined ? 'La tua demo · 10 minuti' : plainName(setup.name);
  let fields = DEFAULT_DEMO_FIELDS.map(field=>({...field}));
  if (setup.fields !== undefined) {
    if (!Array.isArray(setup.fields) || setup.fields.length < 1 || setup.fields.length > 6) invalid();
    const names = setup.fields.map(plainName);
    if (new Set(names.map(value=>value.toLocaleLowerCase('it'))).size !== names.length) invalid();
    fields = names.map((fieldName,index)=>({id:'campo-demo-'+(index+1),name:fieldName}));
  }
  const dayStart = setup.dayStart === undefined ? '08:00' : setup.dayStart;
  const dayEnd = setup.dayEnd === undefined ? '23:00' : setup.dayEnd;
  const slotMinutes = setup.slotMinutes === undefined ? 40 : setup.slotMinutes;
  const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const minutes = value => Number(value.slice(0,2))*60+Number(value.slice(3));
  if (!validTime(dayStart) || !validTime(dayEnd) || ![15,30,40,60,90].includes(slotMinutes) || minutes(dayEnd)-minutes(dayStart) < slotMinutes) invalid();
  return {name,fields,dayStart,dayEnd,slotMinutes};
}

export async function cleanupExpiredPublicDemos(db, now = Date.now()) {
  const expired = await db.collection('establishments').where('expiresAt','<=',now).limit(10).get();
  for(const snapshot of expired.docs) {
    if(snapshot.data().publicDemo===true && snapshot.id.startsWith('trial-')) await db.recursiveDelete(snapshot.ref);
  }
}
export async function createPublicDemo(db, now = Date.now(), setup) {
  // Validate everything before allocating documents; a skipped wizard uses the
  // same ready-to-book defaults as the original public demo.
  const settings = normalizePublicDemoSetup(setup);
  const id = 'trial-' + randomBytes(16).toString('hex');
  const expiresAt = now + PUBLIC_DEMO_DURATION;
  const ref = db.collection('establishments').doc(id);
  const batch = db.batch();
  batch.create(ref, {name:settings.name,enabled:true,visibility:'private',
    publicDemo:true,expiresAt,demoOwner:id+':demo-host'});
  batch.create(ref.collection('admin').doc('config'), {slotMinutes:settings.slotMinutes,dayStart:settings.dayStart,dayEnd:settings.dayEnd,maxBookingsPerUserPerDay:5,maxActiveBookingsPerUser:10});
  batch.create(ref.collection('admin').doc('fields'), {fields:settings.fields});
  for (const [username,role] of [['demo-host','admin'],['demo-manager','admin'],['demo-user','user']]) {
    batch.create(ref.collection('users').doc(username), {role,credits:100,disabled:false,platformAdmin:false,sessionVersion:0,expiresAt});
  }
  await batch.commit();
  return {id,expiresAt};
}

export function enterPublicDemoRole(session, role) {
  const trial = session.publicDemo;
  if (!trial || trial.expiresAt <= Date.now() || !['admin','user'].includes(role)) return false;
  session.user = {username:role==='admin'?'demo-manager':'demo-user',role,establishment:trial.id,sessionVersion:0};
  delete session.managementEstablishment;
  return true;
}
