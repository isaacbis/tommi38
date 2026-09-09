const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {AsyncLocalStorage}=require('node:async_hooks');
const {z}=require('../backend/node_modules/zod');
const source=fs.readFileSync(__dirname+'/../backend/src/routes.js','utf8').replace(/^import .*;$/gm,'').replace('export default router;','');
function setup(){
 const data=new Map([['admin/config',{slotMinutes:45,maxActiveBookingsPerUser:1,maxBookingsPerUserPerDay:1}],['admin/fields',{fields:[{id:'volley',name:'Volley'}]}],['users/admin',{role:'admin',credits:0}],['users/alice',{role:'user',credits:3}],['users/bob',{credits:4}]]);
 let id=0;
 const snapshot=path=>({id:path.split('/').pop(),ref:doc(path),exists:data.has(path),data:()=>data.get(path)});
 const apply=(path,changes)=>{const value={...data.get(path)};for(const [k,v] of Object.entries(changes))value[k]=v && typeof v==='object' && 'increment' in v ? (value[k]||0)+v.increment:v;data.set(path,value);};
 function doc(path){return {id:path.split('/').pop(),path,get:async()=>snapshot(path),collection:n=>collection(path+'/'+n),set:async value=>data.set(path,value),update:async value=>apply(path,value),delete:async()=>data.delete(path)}}
 function collection(path,filters=[],limit=Infinity){return {doc:(key='id'+(++id))=>doc(path+'/'+key),where:(...f)=>collection(path,[...filters,f],limit),limit:n=>collection(path,filters,n),get:async()=>{const docs=[...data].filter(([key,v])=>key.startsWith(path+'/') && key.split('/').length===path.split('/').length+1 && filters.every(([k,op,x])=>op==='=='?v[k]===x:op==='>='?v[k]>=x:v[k]<=x)).slice(0,limit).map(([key])=>snapshot(key));return {docs,size:docs.length,empty:!docs.length,forEach:f=>docs.forEach(f)}}}}
 let queue=Promise.resolve();
 const db={collection,batch:()=>({delete:ref=>data.delete(ref.path),commit:async()=>{}}),runTransaction:fn=>{
  const run=queue.then(async()=>{const writes=[];let wrote=false;const result=await fn({get:ref=>{assert.equal(wrote,false,'Firestore reads must precede writes');return ref.get()},set:(ref,value)=>{wrote=true;writes.push(()=>data.set(ref.path,value))},update:(ref,value)=>{wrote=true;writes.push(()=>apply(ref.path,value))},delete:ref=>{wrote=true;writes.push(()=>data.delete(ref.path))}});writes.forEach(f=>f());return result});queue=run.catch(()=>{});return run;
 }};
 const routes={};const router={};for(const method of ['get','post','put','patch','delete'])router[method]=(path,...handlers)=>routes[method+' '+path]=handlers;
 const ctx=vm.createContext({console,Buffer,Date,Intl,db,z,tenantId:()=> 'tommi38',FieldValue:{increment:n=>({increment:n}),serverTimestamp:()=>({toDate:()=>new Date()})},express:{Router:()=>router},rateLimit:()=> (req,res,next)=>next(),bcrypt:require('../backend/node_modules/bcrypt'),establishments:async()=>[]});
 vm.runInContext(fs.readFileSync(__dirname+'/../backend/src/permissions.js','utf8').replace(/^import .*;$/gm,'').replace(/export /g,''),ctx);
 vm.runInContext(source,ctx);
 async function call(method,path,user='alice',body={},params={},query={}){
  const req={session:user?{user:{username:user,role:user==='admin'?'admin':'user'}}:{},body,params,query};
  const res={code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}};
  for(const handler of routes[method+' '+path]){let proceed=false;await handler(req,res,error=>{if(error)throw error;proceed=true});if(!proceed)break;}return res;
 }
 return {call,data};
}
const slot={fieldId:'volley',date:'2099-01-01',time:'09:00'};
test('booking records debit and cancellation refunds exactly once',async()=>{
 const e=setup();assert.equal((await e.call('post','/reservations','alice',slot)).code,200);
 assert.equal(e.data.get('users/alice').credits,2);
 const id='volley_2099-01-01_09:00';
 assert.equal((await e.call('delete','/reservations/:id','bob',{}, {id})).code,403);
 await e.call('delete','/reservations/:id','alice',{}, {id});await e.call('delete','/reservations/:id','alice',{}, {id});
 assert.equal(e.data.get('users/alice').credits,3);
 assert.equal([...e.data.keys()].filter(k=>k.startsWith('creditLedger/')).length,2);
});
test('concurrent booking attempts enforce active limit without extra debit',async()=>{
 const e=setup();const results=await Promise.all([e.call('post','/reservations','alice',slot),e.call('post','/reservations','alice',{...slot,time:'09:45'})]);
 assert.equal(results.filter(r=>r.code===200).length,1);assert.equal(e.data.get('users/alice').credits,2);
});
test('closures reject existing reservations; blocked slots never debit credits',async()=>{
 const e=setup();const c={...slot,start:'09:15',end:'10:00',reason:'Manutenzione'};
 assert.equal((await e.call('post','/admin/closures','alice',c)).code,403);
 assert.equal((await e.call('post','/admin/closures','admin',c)).code,200);
 assert.equal((await e.call('post','/reservations','alice',slot)).body.error,'FIELD_CLOSED');assert.equal(e.data.get('users/alice').credits,3);
 const id=e.data.get('admin/closures').items[0].id;await e.call('delete','/admin/closures/:id','admin',{}, {id});
 await e.call('post','/reservations','alice',slot);
 assert.equal((await e.call('post','/admin/closures','admin',c)).body.error,'EXISTING_RESERVATIONS');
});
test('waitlist is private and observes availability after cancellation',async()=>{
 const e=setup();await e.call('post','/reservations','alice',slot);const reservationId='volley_2099-01-01_09:00';
 assert.equal((await e.call('post','/waitlist','alice',{reservationId})).body.error,'OWN_RESERVATION');
 await e.call('post','/waitlist','bob',{reservationId});
 assert.equal((await e.call('get','/waitlist','alice')).body.items.length,0);
 let item=(await e.call('get','/waitlist','bob')).body.items[0];assert.equal(item.available,false);
 await e.call('delete','/waitlist/:id','alice',{}, {id:item.id});assert.equal((await e.call('get','/waitlist','bob')).body.items.length,1);
 await e.call('delete','/reservations/:id','alice',{}, {id:reservationId});assert.equal((await e.call('get','/waitlist','bob')).body.items[0].available,true);
});
test('ledger access is private and admin cannot make balance negative or fractional',async()=>{
 const e=setup();await e.call('post','/reservations','alice',slot);
 assert.equal((await e.call('get','/credits','bob')).body.items.length,0);
 for(const delta of [-100,0.5])assert.equal((await e.call('put','/admin/users/credits','admin',{username:'alice',delta})).code,400);
 assert.equal(e.data.get('users/alice').credits,2);
 assert.equal((await e.call('get','/credits',null)).code,401);
});
test('tenant middleware preserves legacy paths and isolates concurrent contexts',async()=>{
 const tenancy=fs.readFileSync(__dirname+'/../backend/src/tenancy.js','utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
 const root={collection:name=>({doc:id=>({collection:child=>`${name}/${id}/${child}`}),get:async()=>({docs:[{id:'claudia',data:()=>({name:'Claudia',enabled:true})}]}),name})};
 const context=vm.createContext({AsyncLocalStorage,root});vm.runInContext(tenancy,context);
 assert.equal(vm.runInContext("db.collection('users').name",context),'users');
 const results=await vm.runInContext("Promise.all(['claudia','other'].map(id=>tenantContext.run(id,async()=>{await Promise.resolve();return db.collection('users')})))",context);
 assert.deepEqual([...results],['establishments/claudia/users','establishments/other/users']);
 context.req={get:()=> 'claudia',session:{user:{username:'admin',role:'admin'}}};context.res={status(n){this.code=n;return this},json(body){this.body=body}};context.next=()=>assert.fail('cross-tenant session passed');
 await vm.runInContext('tenantMiddleware(req,res,next)',context);assert.equal(context.res.code,401);
 context.req={get:()=> '../users',session:{}};await vm.runInContext('tenantMiddleware(req,res,next)',context);assert.equal(context.res.code,400);
});
