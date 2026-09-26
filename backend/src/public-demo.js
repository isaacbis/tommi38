import { randomBytes } from 'node:crypto';

export const PUBLIC_DEMO_DURATION = 10 * 60 * 1000;
export async function cleanupExpiredPublicDemos(db, now = Date.now()) {
  const expired = await db.collection('establishments').where('expiresAt','<=',now).limit(10).get();
  for(const snapshot of expired.docs) {
    if(snapshot.data().publicDemo===true && snapshot.id.startsWith('trial-')) await db.recursiveDelete(snapshot.ref);
  }
}
export async function createPublicDemo(db, now = Date.now()) {
  const id = 'trial-' + randomBytes(16).toString('hex');
  const expiresAt = now + PUBLIC_DEMO_DURATION;
  const ref = db.collection('establishments').doc(id);
  const batch = db.batch();
  batch.create(ref, {name:'La tua demo · 10 minuti',enabled:true,visibility:'private',
    publicDemo:true,expiresAt,demoOwner:id+':demo-host'});
  batch.create(ref.collection('admin').doc('config'), {slotMinutes:40,dayStart:'08:00',dayEnd:'23:00',maxBookingsPerUserPerDay:5,maxActiveBookingsPerUser:10});
  batch.create(ref.collection('admin').doc('fields'), {fields:[{id:'volley-demo',name:'Beach volley'},{id:'tennis-demo',name:'Tennis'},{id:'padel-demo',name:'Padel'}]});
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
