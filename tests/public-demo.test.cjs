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
test('expired trial cleanup never removes ordinary establishments',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(__dirname+'/../backend/src/public-demo.js','utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
 const {cleanupExpiredPublicDemos}=vm.runInNewContext(source+';({cleanupExpiredPublicDemos})');
 const deleted=[];
 const items=[{id:'trial-old',publicDemo:true},{id:'venue-real',publicDemo:true},{id:'trial-other',publicDemo:false}];
 const db={collection:()=>({where:()=>({limit:()=>({get:async()=>({docs:items.map(item=>({id:item.id,ref:item.id,data:()=>item}))})})})}),recursiveDelete:async ref=>deleted.push(ref)};
 await cleanupExpiredPublicDemos(db);assert.deepEqual(deleted,['trial-old']);
});
