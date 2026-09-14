const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {createMemoryFirestore}=require('./helpers/memory-firestore.cjs');
function setup(){
  const memory=createMemoryFirestore();const routes={};
  const context=vm.createContext({db:memory.db,createHash,validEstablishmentId:value=>/^[a-z0-9-]{1,60}$/.test(value),express:{Router:()=>({post:(path,handler)=>routes[path]=handler})},readSessionIdentity:async req=>{
    const user=req.session.user;if(!user || user.disabled)return null;
    return {origin:user.establishment,username:user.username,account:{role:user.role},platformAdmin:false};
  }});
  vm.runInContext(fs.readFileSync(__dirname+'/../backend/src/demo-routes.js','utf8').replace(/^import .*;$/gm,'').replace('export default router;',''),context);
  const call=async(path,session,body={})=>{const res={code:200,status(n){this.code=n;return this;},json(value){this.body=value;return this;}};await routes[path]({session,body},res,error=>{throw error;});return res;};
  return {call,memory};
}
test('demo entry rejects anonymous and ordinary accounts',async()=>{
  const {call}=setup();assert.equal((await call('/enter',{}, {role:'admin'})).code,403);
  assert.equal((await call('/enter',{user:{username:'a',role:'user',establishment:'venue-a'}},{role:'admin'})).code,403);
});
test('manager demo isolates venues, preserves original identity and supports role switching and exit',async()=>{
  const {call}=setup();const session={user:{username:'manager',role:'admin',establishment:'venue-a'}};
  const original=structuredClone(session.user);
  const first=await call('/enter',session,{role:'admin'});assert.equal(first.code,200);
  assert.match(first.body.establishmentId,/^demo-/);assert.equal(session.user.role,'admin');
  const second=await call('/enter',session,{role:'user'});assert.equal(second.body.establishmentId,first.body.establishmentId);assert.equal(session.user.role,'user');
  const other=await call('/enter',{user:{...original,establishment:'venue-b'}},{role:'admin'});assert.notEqual(other.body.establishmentId,first.body.establishmentId);
  assert.equal((await call('/exit',session)).code,200);assert.deepEqual(structuredClone(session.user),original);assert.equal(session.demoOriginal,undefined);
});
test('reset creates a fresh private demo, disables the old one and preserves other venues',async()=>{
  const {call,memory}=setup();const session={user:{username:'manager',role:'admin',establishment:'venue-a'}};
  const first=await call('/enter',session,{role:'user'});
  const old=first.body.establishmentId;
  await memory.db.collection('establishments').doc(old).collection('users').doc('demo-user').update({credits:3});
  const reset=await call('/enter',session,{role:'admin',reset:true});
  assert.notEqual(reset.body.establishmentId,old);
  assert.equal((await memory.db.collection('establishments').doc(old).get()).data().enabled,false);
  const ref=memory.db.collection('establishments').doc(reset.body.establishmentId);
  assert.equal((await ref.get()).data().visibility,'private');
  assert.equal((await ref.collection('users').doc('demo-user').get()).data().credits,100);
  assert.equal((await call('/enter',session,{role:'user'})).body.establishmentId,reset.body.establishmentId);
});

test('simulated purchases and two videos credit only the demo user and are idempotent',async()=>{
  const {call,memory}=setup();const session={user:{username:'manager',role:'admin',establishment:'venue-a'}};
  assert.equal((await call('/simulate',session,{action:'purchase',requestId:'purchase-001'})).code,403);
  const demo=await call('/enter',session,{role:'user'});
  const purchase=await call('/simulate',session,{action:'purchase',requestId:'purchase-001'});
  assert.equal(purchase.body.credits,105);
  assert.equal((await call('/simulate',session,{action:'purchase',requestId:'purchase-001'})).body.credits,105);
  assert.equal((await call('/simulate',session,{action:'video',requestId:'video-001'})).body.added,0);
  assert.equal((await call('/simulate',session,{action:'video',requestId:'video-002'})).body.credits,106);
  await memory.db.collection('establishments').doc(demo.body.establishmentId).update({demoOwner:'other'});
  assert.equal((await call('/simulate',session,{action:'purchase',requestId:'purchase-002'})).code,403);
});
test('copy imports only scheduling and field labels into a fresh demo',async()=>{
  const {call,memory}=setup();const source=memory.db.collection('establishments').doc('venue-a');
  await source.collection('admin').doc('config').set({dayStart:'08:00',secret:'do not copy'});
  await source.collection('admin').doc('fields').set({fields:[{id:'court',name:'Campo',privateNote:'private'}]});
  const session={user:{username:'manager',role:'admin',establishment:'venue-a'}};
  const demo=await call('/enter',session,{role:'admin',reset:true,copySettings:true});
  const target=memory.db.collection('establishments').doc(demo.body.establishmentId);
  const config=(await target.collection('admin').doc('config').get()).data();
  assert.equal(config.dayStart,'08:00');assert.equal(config.secret,undefined);
  assert.deepEqual((await target.collection('admin').doc('fields').get()).data(),{fields:[{id:'court',name:'Campo'}]});
});
