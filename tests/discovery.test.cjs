const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {AsyncLocalStorage}=require('node:async_hooks');
const {createMemoryFirestore}=require('./helpers/memory-firestore.cjs');
test('public discovery omits private and disabled venues but exact codes resolve enabled private venues',async()=>{
  const memory=createMemoryFirestore(new Map([
    ['establishments/hidden',{name:'Private',enabled:true,visibility:'private'}],
    ['establishments/public',{name:'Public',enabled:true,visibility:'public',city:'Senigallia',latitude:43.7,longitude:13.2}],
    ['establishments/disabled',{name:'Disabled',enabled:false,visibility:'public'}]
  ]));
  const context=vm.createContext({root:memory.db,AsyncLocalStorage});
  vm.runInContext(fs.readFileSync(__dirname+'/../backend/src/tenancy.js','utf8').replace(/^import .*;$/gm,'').replace(/export /g,''),context);
  const listed=await context.establishments();
  assert.deepEqual(Array.from(listed,x=>x.id),['tommi38','public']);
  assert.equal(listed[1].city,'Senigallia');
  assert.equal((await context.establishments('hidden'))[0].name,'Private');
  assert.equal((await context.establishments('disabled')).length,0);
});
