const {test}=require('node:test');
const assert=require('node:assert/strict');
async function setup(account={role:'admin',passwordHash:'unchanged',credits:12}) {
  const {appointInitialPlatformAdmin}=await import('../backend/src/platform-migration.js');
  const data=new Map(account?[['users/admin',account]]:[]);
  const doc=path=>({path});
  const root={collection:path=>({doc:id=>doc(path+'/'+id),where:(key,op,value)=>({query:path,key,value})}),runTransaction:async work=>{
    const writes=[];const result=await work({get:async ref=>ref.query?{docs:[...data].filter(([path,value])=>path.startsWith(ref.query+'/')&&value[ref.key]===ref.value).map(([path])=>({id:path.split('/').pop()}))}:{exists:data.has(ref.path),data:()=>data.get(ref.path)},update:(ref,value)=>writes.push(()=>data.set(ref.path,{...data.get(ref.path),...value})),set:(ref,value)=>writes.push(()=>data.set(ref.path,value))});writes.forEach(fn=>fn());return result;
  }};
  return {data,run:()=>appointInitialPlatformAdmin(root,()=>0)};
}
test('appointment changes only the explicitly named existing legacy administrator',async()=>{
 const e=await setup();e.data.set('users/other',{role:'admin'});e.data.set('establishments/beach-a/users/admin',{role:'admin'});
 assert.equal(await e.run(),'applied');assert.deepEqual(e.data.get('users/admin'),{role:'admin',passwordHash:'unchanged',credits:12,platformAdmin:true});assert.equal(e.data.get('users/other').platformAdmin,undefined);assert.equal(e.data.get('establishments/beach-a/users/admin').platformAdmin,undefined);
});
test('restarting cannot regrant central authority after a later revocation',async()=>{
 const e=await setup();await e.run();e.data.get('users/admin').platformAdmin=false;assert.equal(await e.run(),'already_applied');assert.equal(e.data.get('users/admin').platformAdmin,false);
});
test('missing, ordinary or disabled accounts are never promoted',async()=>{
 for(const account of [null,{role:'user'},{role:'admin',disabled:true}]){const e=await setup(account);const before=structuredClone(e.data);assert.equal(await e.run(),'account_not_eligible');assert.deepEqual(e.data,before);}
});
test('an existing different central administrator is preserved',async()=>{
 const e=await setup();e.data.set('users/another',{role:'admin',platformAdmin:true});assert.equal(await e.run(),'existing_administrator');assert.equal(e.data.get('users/admin').platformAdmin,undefined);
});
