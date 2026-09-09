const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../backend/src/routes.js'),'utf8').replace(/^import .*;$/gm,'').replace('export default router;','');
function setup(){
 const data=new Map([
 ['admin/config',{}],
 ['playerSearches/game',{ownerUser:'owner',date:'2099-01-01',time:'18:00',spotsNeeded:2,spotsFilled:0,status:'open'}],
 ['playerSearches/game/requests/a',{requesterUser:'alice',participantNames:['Alice Test'],phone:'3331234567',count:2,status:'pending'}],
 ['playerSearches/game/requests/b',{requesterUser:'bob',participantNames:['Bob Test'],phone:'3337654321',count:1,status:'pending'}]
 ]);
 function doc(path){return {id:path.split('/').pop(),path,collection:n=>collection(path+'/'+n),get:async()=>({id:path.split('/').pop(),ref:doc(path),exists:data.has(path),data:()=>data.get(path)}),delete:async()=>data.delete(path)}}
 function collection(path,filters=[]){return {doc:id=>doc(path+'/'+id),where:(...f)=>collection(path,[...filters,f]),get:async()=>{const docs=[];for(const [key,value] of data){if(key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1&&filters.every(([k,op,v])=>op==='=='?value[k]===v:op==='>='?value[k]>=v:value[k]<=v))docs.push(await doc(key).get());}return {docs,empty:!docs.length,forEach:f=>docs.forEach(f)}}}}
 const update=(ref,changes)=>data.set(ref.path,{...data.get(ref.path),...changes});
 const db={collection,batch:()=>({update,delete:ref=>data.delete(ref.path),commit:async()=>{}}),runTransaction:async fn=>fn({get:ref=>ref.get(),update,delete:ref=>data.delete(ref.path)})};
 const routes={};const router={};for(const method of ['get','post','put','patch','delete'])router[method]=(path,...handlers)=>routes[method+' '+path]=handlers;
 const ctx=vm.createContext({console,Buffer,Date,Intl,db,FieldValue:{serverTimestamp:()=>0},express:{Router:()=>router},rateLimit:()=>()=>{},z:{enum:()=>({}),object:()=>({safeParse:body=>({success:true,data:body})})}});
 vm.runInContext(source,ctx);
 async function call(method,path,user,body={},params={}){const req={session:user?{user:{username:user,role:user==='admin'?'admin':'user'}}:{},body,params};const res={code:200,status(n){this.code=n;return this},json(value){this.body=value;return this}};const handlers=routes[method+' '+path];let allowed=false;handlers[0](req,res,()=>allowed=true);if(allowed)await handlers[1](req,res);return res;}
 return {call,data};
}
test('player searches require authentication',async()=>{assert.equal((await setup().call('get','/player-searches',null)).code,401)});
test('contacts are restricted to organizer, admin and the individual requester',async()=>{const e=setup();for(const user of ['stranger','alice','owner','admin']){const res=await e.call('get','/player-searches',user);const item=res.body.items[0];assert.equal(item.requests.length,['owner','admin'].includes(user)?2:0);assert.equal(item.myRequest?.phone,user==='alice'?'3331234567':undefined);}});
test('acceptance fills the group and rejects remaining pending requests',async()=>{const e=setup();const res=await e.call('patch','/player-searches/:id/requests/:requestId','owner',{status:'accepted'},{id:'game',requestId:'a'});assert.equal(res.code,200);assert.equal(e.data.get('playerSearches/game').status,'full');assert.equal(e.data.get('playerSearches/game').spotsFilled,2);assert.equal(e.data.get('playerSearches/game/requests/b').status,'rejected');});
test('another user cannot accept requests and capacity cannot be exceeded',async()=>{const e=setup();let res=await e.call('patch','/player-searches/:id/requests/:requestId','bob',{status:'accepted'},{id:'game',requestId:'a'});assert.equal(res.body.error,'NOT_ALLOWED');e.data.get('playerSearches/game').spotsFilled=1;res=await e.call('patch','/player-searches/:id/requests/:requestId','owner',{status:'accepted'},{id:'game',requestId:'a'});assert.equal(res.body.error,'NOT_ENOUGH_SPOTS');assert.equal(e.data.get('playerSearches/game/requests/a').status,'pending');});
