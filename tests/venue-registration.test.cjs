const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const {z}=require('../backend/node_modules/zod');const {randomInt}=require('node:crypto');
const input={requestId:'12345678-1234-4234-8234-123456789abc',name:'Nuovo lido',city:'Ancona',managerUsername:'gestore',managerPassword:'Manager-test-secret!',fields:['Volley','Basket'],dayStart:'09:00',dayEnd:'20:00',slotMinutes:45,userCount:3,userPrefix:'user'};
function setup(){
 const data=new Map();let fail=false;
 const doc=path=>({path,get:async()=>({exists:data.has(path)}),collection:name=>({doc:id=>doc(path+'/'+name+'/'+id)})});
 const db={collection:name=>({doc:id=>doc(name+'/'+id)}),runTransaction:async fn=>{const writes=[];let writing=false;await fn({get:async ref=>{assert.ok(!writing);return ref.get()},create:(ref,value)=>{writing=true;writes.push([ref.path,value])}});if(fail)throw Error('Storage failure');for(const [path]of writes)assert.ok(!data.has(path));for(const [path,value]of writes)data.set(path,value)}};
 const context=vm.createContext({z,Buffer,randomInt,root:db,FieldValue:{serverTimestamp:()=>0},bcrypt:{hash:async password=>'hashed:'+password}});
 vm.runInContext(fs.readFileSync(__dirname+'/../backend/src/venue-registration.js','utf8').replace(/^import .*;$/gm,'').replace(/export /g,''),context);
 return{data,create:value=>context.createVenueRegistration(value),fail:()=>fail=true};
}
test('self registration creates private active venue, scoped manager and numbered zero-credit users atomically',async()=>{
 const e=setup();const result=await e.create(input);const p='establishments/'+result.establishmentId;
 assert.equal(e.data.get(p).enabled,true);assert.equal(e.data.get(p).visibility,'private');
 assert.equal(e.data.get(p+'/users/gestore').platformAdmin,false);assert.equal(e.data.get(p+'/users/gestore').role,'admin');
 assert.deepEqual(Array.from(result.credentials,c=>c.username),['user001','user002','user003']);
 for(const c of result.credentials){assert.match(c.password,/^[A-Za-z0-9]{6}$/);const user=e.data.get(p+'/users/'+c.username);assert.equal(user.credits,0);assert.equal(user.role,'user');assert.equal(user.platformAdmin,false);assert.ok(!('password'in user));assert.equal(user.passwordHash,'hashed:'+c.password)}
 assert.equal(e.data.get(p+'/admin/config').dayStart,'09:00');assert.equal(e.data.get(p+'/admin/fields').fields[0].name,'Volley');assert.ok(!e.data.has('users/gestore'));
 await assert.rejects(e.create(input),/REGISTRATION_ALREADY_CREATED/);
});
test('self registration cannot inject credits, global roles or invalid settings',async()=>{
 for(const change of [{credits:99},{platformAdmin:true},{enabled:true},{userCount:101},{userCount:0},{managerPassword:'abcdef'},{fields:['Volley','volley']},{dayEnd:'08:00'},{dayStart:'29:00'},{managerUsername:'user001'},{userPrefix:'../'}]){
  const e=setup();await assert.rejects(e.create({...input,...change}));assert.equal(e.data.size,0);
 }
});
test('failed registration transaction leaves no partial users or venue',async()=>{
 const e=setup();e.fail();await assert.rejects(e.create(input),/Storage failure/);assert.equal(e.data.size,0);
});
test('registration HTTP flow accepts six-character user login and preserves venue and credit restrictions',async t=>{
 const fixture=require('./preview-server.cjs').createPreviewServer();
 const server=fixture.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port+'/api';let cookie='';
 const call=async(path,method='GET',body,venue='tommi38')=>{
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Establishment':venue,...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return{status:response.status,data:await response.json()};
 };
 const created=await call('/venue-registration','POST',input);assert.equal(created.status,201);assert.equal(created.data.status,'active');
 const id=created.data.establishmentId;assert.ok(!(await call('/establishments')).data.items.some(v=>v.id===id));
 assert.equal((await call('/establishments?code='+id)).data.items[0].name,input.name);
 const credential=created.data.credentials[0];assert.equal((await call('/login','POST',credential,id)).status,200);
 const me=await call('/me','GET',undefined,id);assert.equal(me.data.credits,0);assert.equal(me.data.role,'user');
 assert.equal((await call('/me','GET',undefined,'venue-a')).status,401);
 assert.equal((await call('/platform/establishments','GET',undefined,id)).status,403);
 await call('/logout','POST',{},id);
 assert.equal((await call('/login','POST',{username:input.managerUsername,password:input.managerPassword},id)).status,200);
 assert.equal((await call('/admin/users/credits','PUT',{username:credential.username,delta:5},id)).status,403);
 assert.equal((await call('/platform/establishments','GET',undefined,id)).status,403);
 assert.equal((await call('/public/config','GET',undefined,id)).data.fields.length,2);
});
