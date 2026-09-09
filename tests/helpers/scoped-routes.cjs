const fs=require('node:fs');
const vm=require('node:vm');
const {AsyncLocalStorage}=require('node:async_hooks');
const assert=require('node:assert/strict');
const bcrypt=require('../../backend/node_modules/bcrypt');
const {z}=require('../../backend/node_modules/zod');
const fixtureHash=bcrypt.hashSync('Fixture-secret-2026!',4);
module.exports=function setup(file='account-routes.js'){
 const data=new Map();let id=0;const scope=new AsyncLocalStorage();
 for(const tenant of ['tommi38','beach-a','beach-b']){
  const prefix=tenant==='tommi38'?'':`establishments/${tenant}/`;
  if(tenant!=='tommi38')data.set('establishments/'+tenant,{name:tenant,enabled:true});
  data.set(prefix+'admin/config',{slotMinutes:45,dayStart:'09:00',dayEnd:'20:00',maxBookingsPerUserPerDay:2,maxActiveBookingsPerUser:3,registrationEnabled:true});
  data.set(prefix+'admin/fields',{fields:[{id:'volley',name:'Volley'}]});
  data.set(prefix+'users/manager',{role:'admin',credits:0,passwordHash:fixtureHash});
  data.set(prefix+'users/alice',{role:'user',credits:3,passwordHash:fixtureHash});
 }
 const apply=(path,value)=>{const next={...data.get(path)};for(const [key,v]of Object.entries(value))next[key]=v&&typeof v==='object'&&'increment'in v?(next[key]||0)+v.increment:v;data.set(path,next);};
 const snapshot=path=>({id:path.split('/').pop(),exists:data.has(path),ref:doc(path),data:()=>structuredClone(data.get(path))});
 function doc(path){return{path,id:path.split('/').pop(),get:async()=>snapshot(path),collection:name=>collection(path+'/'+name),set:async value=>data.set(path,structuredClone(value)),update:async value=>apply(path,value),delete:async()=>data.delete(path)};}
 function collection(path,filters=[],limit=Infinity){return{doc:(key='generated-'+(++id))=>doc(path+'/'+key),where:(...args)=>collection(path,[...filters,args],limit),limit:n=>collection(path,filters,n),get:async()=>{const docs=[...data].filter(([key,value])=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1&&filters.every(([k,op,v])=>op==='=='?value[k]===v:op==='>='?value[k]>=v:value[k]<=v)).slice(0,limit).map(([key])=>snapshot(key));return{docs,size:docs.length,empty:!docs.length,forEach:fn=>docs.forEach(fn)}}};}
 let queue=Promise.resolve();let fail=false;
 const db={collection:name=>collection((scope.getStore()==='tommi38'?'':`establishments/${scope.getStore()}/`)+name),runTransaction:fn=>{const result=queue.then(async()=>{const writes=[];let dirty=false;const tx={get:ref=>{assert.equal(dirty,false,'all reads before writes');return ref.get()},set:(ref,v)=>{dirty=true;writes.push(()=>data.set(ref.path,structuredClone(v)))},update:(ref,v)=>{dirty=true;writes.push(()=>apply(ref.path,v))},delete:ref=>{dirty=true;writes.push(()=>data.delete(ref.path))}};tx.create=tx.set;const value=await fn(tx);if(fail){fail=false;throw Error('Storage failure');}writes.forEach(fn=>fn());return value;});queue=result.catch(()=>{});return result;},batch:()=>{const writes=[];return{set:(r,v)=>writes.push(()=>data.set(r.path,v)),update:(r,v)=>writes.push(()=>apply(r.path,v)),delete:r=>writes.push(()=>data.delete(r.path)),commit:async()=>writes.forEach(fn=>fn())}}};
 const routes={};const router={};for(const method of ['get','post','put','patch','delete'])router[method]=(path,...handlers)=>routes[method+' '+path]=handlers;
 const context=vm.createContext({db,root:{...db,collection},z,bcrypt,Buffer,console,Date,Intl,tenantId:()=>scope.getStore(),FieldValue:{increment:n=>({increment:n}),serverTimestamp:()=>0},express:{Router:()=>router},rateLimit:()=> (req,res,next)=>next(),establishments:async()=>[]});
 for(const module of ['authorization.js','management-guards.js','permissions.js',file])vm.runInContext(fs.readFileSync(__dirname+'/../../backend/src/'+module,'utf8').replace(/^import .*;$/gm,'').replace('export default router;','').replace(/export /g,''),context);
 async function call(method,path,{tenant='tommi38',user='alice',session,body={},params={},query={}}={}){
  return scope.run(tenant,async()=>{
   const req={session:session || (user?{user:{username:user,role:user==='manager'?'admin':'user',establishment:tenant}}:{}),body,params,query};
   const res={code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}};
   for(const handler of routes[method+' '+path]){let proceed=false;await handler(req,res,error=>{if(error)throw error;proceed=true});if(!proceed)break;}
   return {...res,session:req.session};
  });
 }
 return{call,data,failCommit:()=>fail=true,context};
};
