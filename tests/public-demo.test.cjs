const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPreviewServer}=require('./preview-server.cjs');
test('public trial isolates visitors, switches roles without extending expiry, and expires on server',async t=>{
 const fixture=createPreviewServer();
 const server=fixture.app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 let cookie='';
 const call=async(path,body,venue='tommi38',useCookie=true)=>{
  const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Establishment':venue,...(useCookie&&cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  if(useCookie && response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return {status:response.status,data:await response.json()};
 };
 const first=await call('/demo/public',{});assert.equal(first.status,200); const id=first.data.establishmentId;
 assert.match(id,/^trial-/);assert.ok(first.data.expiresAt>Date.now()+590000);
 const defaults=(await call('/public/config',undefined,id)).data;
 assert.equal(defaults.dayStart,'08:00');assert.equal(defaults.dayEnd,'23:00');assert.equal(defaults.slotMinutes,40);
 assert.deepEqual(defaults.fields.map(field=>field.name),['Beach volley','Tennis','Padel']);
 const second=await call('/demo/public',{});assert.equal(second.data.establishmentId,id);assert.equal(second.data.expiresAt,first.data.expiresAt);
 const other=await call('/demo/public',{},'tommi38',false);assert.notEqual(other.data.establishmentId,id);
 const venues=await call('/establishments');assert.ok(!venues.data.items.some(v=>v.id===id));assert.ok(venues.data.items.some(v=>v.id==='tommi38'));
 assert.equal((await call('/me',undefined,id)).data.role,'admin');
 assert.equal((await call('/me',undefined,'venue-a')).status,401);
 assert.equal((await call('/platform/establishments',undefined,id)).status,403);
 assert.equal((await call('/demo/enter',{role:'user',reset:true},id)).status,400);
 assert.equal((await call('/demo/enter',{role:'user'},id)).status,200);
 const user=await call('/me',undefined,id);assert.equal(user.data.role,'user');assert.equal(user.data.credits,100);assert.equal(user.data.demoExpiresAt,first.data.expiresAt);
 assert.equal((await call('/demo/checkout',{},id)).status,403);
 assert.equal((await call('/ads/status',undefined,id)).data.available,false);
 const all=await new Promise((resolve,reject)=>fixture.sessionStore.all((e,s)=>e?reject(e):resolve(s)));
 for(const [sid,session]of Object.entries(all))if(session.publicDemo?.id===id){session.publicDemo.expiresAt=Date.now()-1;await new Promise((r,j)=>fixture.sessionStore.set(sid,session,e=>e?j(e):r()));}
 assert.equal((await call('/me',undefined,id)).data.error,'DEMO_EXPIRED');
 assert.equal((await call('/demo/enter',{role:'admin'},id)).status,401);
 assert.equal((await call('/demo/exit',{},id)).status,200);
 assert.equal((await call('/me',undefined,id)).status,401);
});
test('public trial setup stores custom fields and hours atomically without resetting an active trial',async t=>{
 const fixture=createPreviewServer();
 const server=fixture.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 let cookie='';
 const start=async setup=>{
  const response=await fetch(base+'/api/demo/public',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({setup})});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return {status:response.status,data:await response.json()};
 };
 const before=fixture.memory.data.size;
 const invalid=await start({fields:[],dayStart:'23:00',dayEnd:'08:00'});
 assert.equal(invalid.status,400);assert.equal(invalid.data.error,'INVALID_DEMO_SETUP');assert.equal(fixture.memory.data.size,before);
 const setup={name:'  Lido della prova  ',fields:[' Volley 1 ','Tennis 2'],dayStart:'10:00',dayEnd:'18:30',slotMinutes:30};
 const first=await start(setup);assert.equal(first.status,200);
 const prefix='establishments/'+first.data.establishmentId;
 assert.equal(fixture.memory.data.get(prefix).name,'Lido della prova');
 const config=fixture.memory.data.get(prefix+'/admin/config');
 assert.equal(config.dayStart,'10:00');assert.equal(config.dayEnd,'18:30');assert.equal(config.slotMinutes,30);
 const fields=fixture.memory.data.get(prefix+'/admin/fields').fields;
 assert.deepEqual(Array.from(fields,field=>field.name),['Volley 1','Tennis 2']);assert.equal(new Set(fields.map(field=>field.id)).size,2);
 for(const username of ['demo-host','demo-manager','demo-user'])assert.equal(fixture.memory.data.get(prefix+'/users/'+username).credits,100);
 const repeated=await start({...setup,name:'Un altro nome',dayStart:'09:00'});
 assert.equal(repeated.data.establishmentId,first.data.establishmentId);assert.equal(repeated.data.expiresAt,first.data.expiresAt);
 assert.equal(fixture.memory.data.get(prefix).name,'Lido della prova');assert.equal(fixture.memory.data.get(prefix+'/admin/config').dayStart,'10:00');
});
test('invalid public trial setup is rejected before any database access',async()=>{
 const {createPublicDemo}=await import('../backend/src/public-demo.js');
 let accesses=0;
 const db={collection(){accesses++;throw Error('Unexpected database access');},batch(){accesses++;throw Error('Unexpected database access');}};
 const invalid=[null,[],{name:''},{name:'x'.repeat(81)},{name:'Lido\nprova'},{fields:[]},{fields:Array(7).fill('Volley')},
  {fields:['Volley',' volley ']},{fields:[{name:'Volley'}]},{fields:['']},{fields:['x'.repeat(81)]},
  {dayStart:'8:00'},{dayEnd:'24:00'},{dayStart:'23:00',dayEnd:'08:00'},{dayStart:'10:00',dayEnd:'10:15',slotMinutes:30},
  {slotMinutes:'30'},{slotMinutes:45},{slotMinutes:0},{publicDemo:false}];
 for(const setup of invalid)await assert.rejects(createPublicDemo(db,Date.now(),setup),error=>error.code==='INVALID_DEMO_SETUP');
 assert.equal(accesses,0);
});
test('trial defaults are ready to book when skipped and a failed batch leaves no partial demo',async()=>{
 const {createPublicDemo}=await import('../backend/src/public-demo.js');
 const {createMemoryFirestore}=require('./helpers/memory-firestore.cjs');
 const memory=createMemoryFirestore();
 const now=Date.now();
 const demo=await createPublicDemo(memory.db,now,{});
 assert.equal(demo.expiresAt,now+600000);
 const prefix='establishments/'+demo.id;
 assert.equal(memory.data.get(prefix).name,'La tua demo · 10 minuti');
 assert.equal(memory.data.get(prefix+'/admin/config').slotMinutes,40);
 assert.equal(memory.data.get(prefix+'/admin/fields').fields.length,3);
 const count=memory.data.size;
 memory.failNextCommit();
 await assert.rejects(createPublicDemo(memory.db,now,{name:'Seconda prova',fields:['Solo padel']}));
 assert.equal(memory.data.size,count);
});
test('expired trial cleanup never removes ordinary establishments',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(__dirname+'/../backend/src/public-demo.js','utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
 const {cleanupExpiredPublicDemos}=vm.runInNewContext(source+';({cleanupExpiredPublicDemos})');
 const deleted=[];
 const items=[{id:'trial-old',publicDemo:true},{id:'venue-real',publicDemo:true},{id:'trial-other',publicDemo:false}];
 const db={collection:()=>({where:()=>({limit:()=>({get:async()=>({docs:items.map(item=>({id:item.id,ref:item.id,data:()=>item}))})})})}),recursiveDelete:async ref=>deleted.push(ref)};
 await cleanupExpiredPublicDemos(db);assert.deepEqual(deleted,['trial-old']);
});
