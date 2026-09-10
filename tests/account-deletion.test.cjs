const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {AsyncLocalStorage}=require('node:async_hooks');
const setupRoutes=require('./helpers/scoped-routes.cjs');
const secret='Fixture-secret-2026!';
const request={username:'alice',currentPassword:secret,confirm:true};
const remove=(e,body=request,options={})=>e.call('delete','/account',{body,...options});
const fixture=()=>{
  const e=setupRoutes('account-routes.js');
  const root='establishments/beach-a/';
  const put=(name,value)=>e.data.set(root+name,value);
  put('users/bob',{role:'user',credits:9,createdBy:'alice'});
  for(const collection of ['reservations','reservationHistory','creditLedger','waitlist']){
    put(collection+'/alice-record',{user:'alice',fieldId:'volley',date:'2099-01-01',time:'09:00',credits:3});
    put(collection+'/bob-record',{user:'bob',fieldId:'volley',date:'2099-01-02',time:'09:00',createdBy:'alice',actor:'alice'});
  }
  put('creditRequests/alice',{user:'alice',credits:10,status:'pending'});
  put('recoveryRequests/alice',{username:'alice',status:'pending'});
  put('playerSearches/alice-search',{ownerUser:'alice',status:'open',spotsNeeded:4,spotsFilled:0,note:'Private fixture note'});
  put('playerSearches/alice-search/requests/from-bob',{requesterUser:'bob',participantNames:['Bob Fixture'],phone:'0000000',status:'pending'});
  put('playerSearches/bob-search',{ownerUser:'bob',status:'full',spotsNeeded:4,spotsFilled:4,note:'Keep this note'});
  put('playerSearches/bob-search/requests/from-alice',{requesterUser:'alice',participantNames:['Alice Fixture'],phone:'1111111',status:'accepted',count:2});
  put('playerSearches/bob-search/requests/from-manager',{requesterUser:'manager',participantNames:['Manager Fixture'],phone:'2222222',status:'accepted',count:2});
  put('communityBlocks/alice-bob',{firstUser:'alice',secondUser:'bob',blockedBy:['alice','bob']});
  put('communityBlocks/aaa-alice',{firstUser:'aaa',secondUser:'alice',blockedBy:['aaa']});
  put('communityBlocks/bob-manager',{firstUser:'bob',secondUser:'manager',blockedBy:['bob']});
  put('communityReports/own',{reporterUser:'alice',reportedUser:'bob',content:'Own report',status:'open'});
  put('communityReports/about',{reporterUser:'bob',reportedUser:'alice',content:'Report about the deleted user',status:'open'});
  put('communityReports/unrelated',{reporterUser:'bob',reportedUser:'manager',content:'Unrelated report',status:'open'});
  put('adminAudit/action',{actor:'alice',user:'bob',action:'user_role_changed'});
  return {...e,root,put};
};

test('deletion removes personal records and content only in the selected venue while preserving other users',async()=>{
  const e=fixture();const before=structuredClone(e.data);
  const response=await remove(e,request,{tenant:'beach-a'});
  assert.equal(response.code,200);assert.equal(response.body.deleted,true);
  for(const key of [
    'users/alice','reservations/alice-record','reservationHistory/alice-record','creditLedger/alice-record','waitlist/alice-record',
    'creditRequests/alice','recoveryRequests/alice','accountDeletionRequests/alice','playerSearches/alice-search',
    'playerSearches/alice-search/requests/from-bob','playerSearches/bob-search/requests/from-alice',
    'communityBlocks/alice-bob','communityBlocks/aaa-alice','communityReports/own','communityReports/about'
  ])assert.equal(e.data.has(e.root+key),false,key);
  for(const [key,value] of before)if(!key.startsWith(e.root))assert.deepEqual(e.data.get(key),value,key);
  assert.equal(e.data.get(e.root+'users/bob').credits,9);
  assert.equal(e.data.get(e.root+'users/bob').createdBy,null);
  assert.equal(e.data.get(e.root+'reservations/bob-record').user,'bob');
  assert.equal(e.data.get(e.root+'reservations/bob-record').createdBy,null);
  assert.equal(e.data.get(e.root+'creditLedger/bob-record').actor,null);
  assert.equal(e.data.get(e.root+'adminAudit/action').actor,null);
  assert.equal(e.data.get(e.root+'adminAudit/action').user,'bob');
  assert.deepEqual(e.data.get(e.root+'communityReports/unrelated'),before.get(e.root+'communityReports/unrelated'));
  assert.equal(response.session.user,undefined);
});

test('deleting accepted participation releases exactly its seats and preserves other requests',async()=>{
  const e=fixture();await remove(e,request,{tenant:'beach-a'});
  const search=e.data.get(e.root+'playerSearches/bob-search');
  assert.equal(search.spotsFilled,2);assert.equal(search.status,'open');assert.equal(search.note,'Keep this note');
  assert.equal(e.data.get(e.root+'playerSearches/bob-search/requests/from-manager').count,2);
});

test('deleting a moderator anonymizes resolution attribution on other users reports',async()=>{
  const e=fixture();
  const report={reporterUser:'bob',reportedUser:'manager',content:'Preserve moderation record',status:'resolved',resolvedBy:'platform:alice'};
  e.put('communityReports/moderated-by-alice',report);
  assert.equal((await remove(e,request,{tenant:'beach-a'})).code,200);
  assert.deepEqual(e.data.get(e.root+'communityReports/moderated-by-alice'),{...report,resolvedBy:null});
});

test('credit approval cannot recreate a ledger entry after account deletion has started',async()=>{
  const e=fixture();
  Object.assign(e.data.get(e.root+'users/alice'),{deletionPending:true,disabled:true});
  const before=structuredClone(e.data);
  const response=await e.call('patch','/admin/credit-requests/:username',{
    tenant:'beach-a',user:'manager',params:{username:'alice'},body:{status:'approved'}
  });
  assert.equal(response.code,409);assert.equal(response.body.error,'ACCOUNT_CHANGED');
  assert.deepEqual(e.data,before);
});

test('wrong credentials, missing confirmation and a different signed-in identity cannot delete data',async()=>{
  const e=fixture();const before=structuredClone(e.data);
  for(const [body,code] of [
    [{...request,currentPassword:'wrong'},403],[{...request,confirm:false},400],
    [{...request,username:'../alice'},400],[{...request,admin:true},400]
  ]){assert.equal((await remove(e,body,{tenant:'beach-a'})).code,code);assert.deepEqual(e.data,before);}
  const foreign={user:{username:'manager',establishment:'beach-a',role:'admin'}};
  assert.equal((await remove(e,request,{tenant:'beach-a',session:foreign})).code,403);
  assert.deepEqual(e.data,before);
});

test('a global management context cannot delete a local account with a matching name',async()=>{
  const e=fixture();const before=structuredClone(e.data);
  const session={user:{username:'alice',establishment:'tommi38',role:'admin'},managementEstablishment:'beach-a'};
  assert.equal((await remove(e,request,{tenant:'beach-a',session})).body.error,'MANAGEMENT_CONTEXT_ONLY');
  assert.deepEqual(e.data,before);
});

test('global owner and last manager deletion requests are recorded without disabling or deleting their accounts',async()=>{
  const e=fixture();
  e.data.get('users/manager').platformAdmin=true;
  let response=await remove(e,{...request,username:'manager'},{user:'manager'});
  assert.equal(response.body.error,'PLATFORM_HANDOFF_REQUIRED');
  assert.equal(response.body.requested,true);
  assert.equal(e.data.get('accountDeletionRequests/manager').status,'platform_handoff_required');
  assert.equal(e.data.get('users/manager').disabled,undefined);
  response=await remove(e,{...request,username:'manager'},{tenant:'beach-a',user:'manager'});
  assert.equal(response.body.error,'MANAGER_HANDOFF_REQUIRED');
  assert.equal(e.data.get(e.root+'accountDeletionRequests/manager').status,'manager_handoff_required');
  assert.equal(e.data.get(e.root+'users/manager').deletionPending,undefined);
});

test('a manager may complete deletion after another active manager has been appointed',async()=>{
  const e=fixture();
  e.put('users/replacement',{role:'admin',disabled:false,credits:0});
  const response=await remove(e,{...request,username:'manager'},{tenant:'beach-a',user:'manager'});
  assert.equal(response.code,200);assert.equal(e.data.has(e.root+'users/manager'),false);
  assert.equal(e.data.has(e.root+'users/replacement'),true);
  assert.equal(e.data.has(e.root+'users/alice'),true);
});

test('concurrent managers cannot both delete the last management access',async()=>{
  const e=fixture();
  e.put('users/replacement',{...e.data.get(e.root+'users/manager')});
  const responses=await Promise.all(['manager','replacement'].map(username=>remove(e,{...request,username},{tenant:'beach-a',user:username})));
  assert.equal(responses.filter(response=>response.code===200).length,1);
  assert.equal(responses.find(response=>response.code!==200).body.error,'MANAGER_HANDOFF_REQUIRED');
  assert.equal(['manager','replacement'].filter(username=>e.data.has(e.root+'users/'+username)).length,1);
});

test('large histories are deleted in bounded batches without modifying another account',async()=>{
  const e=fixture();
  for(let index=0;index<725;index++)e.put('creditLedger/history-'+index,{user:'alice',delta:1,reason:'Fixture'});
  assert.equal((await remove(e,request,{tenant:'beach-a'})).code,200);
  assert.equal([...e.data].some(([key,value])=>key.startsWith(e.root+'creditLedger/') && value.user==='alice'),false);
  assert.equal(e.data.get(e.root+'creditLedger/bob-record').user,'bob');
});

test('a partial storage failure leaves a revoked, locked account and can resume without a valid login session',async()=>{
  const e=fixture();let transactions=0;const original=e.context.db.runTransaction;
  e.context.db.runTransaction=work=>++transactions===7?Promise.reject(new Error('Simulated storage interruption')):original(work);
  const beforeVersion=e.data.get(e.root+'users/alice').sessionVersion || 0;
  let response=await remove(e,request,{tenant:'beach-a'});
  assert.equal(response.code,503);assert.equal(response.body.pending,true);
  assert.equal(e.data.get(e.root+'users/alice').disabled,true);
  assert.equal(e.data.get(e.root+'users/alice').deletionPending,true);
  assert.equal(e.data.get(e.root+'users/alice').sessionVersion,beforeVersion+1);
  assert.equal((await e.call('get','/credit-requests',{tenant:'beach-a'})).code,401);
  assert.equal((await remove(e,{...request,currentPassword:'wrong'},{tenant:'beach-a',user:null})).code,403);
  response=await remove(e,request,{tenant:'beach-a',user:null});
  assert.equal(response.code,200);assert.equal(e.data.has(e.root+'users/alice'),false);
  assert.equal(e.data.get(e.root+'playerSearches/bob-search').spotsFilled,2);
});

test('recreating the username does not restore an old session after account deletion',async()=>{
  const e=fixture();await remove(e,request,{tenant:'beach-a'});
  const response=await e.call('post','/register',{tenant:'beach-a',user:null,body:{username:'alice',password:secret}});
  assert.equal(response.code,201);
  const account=e.data.get(e.root+'users/alice');
  assert.ok(account.sessionVersion>0);account.disabled=false;
  const old={user:{username:'alice',establishment:'beach-a',sessionVersion:0}};
  assert.equal((await e.call('get','/credit-requests',{tenant:'beach-a',session:old})).code,401);
});

test('simultaneous deletion retries neither double-release seats nor remove unrelated records',async()=>{
  const e=fixture();
  const responses=await Promise.all([remove(e,request,{tenant:'beach-a'}),remove(e,request,{tenant:'beach-a'})]);
  assert.ok(responses.every(response=>response.code===200));
  assert.equal(e.data.get(e.root+'playerSearches/bob-search').spotsFilled,2);
  assert.equal(e.data.has(e.root+'users/bob'),true);
});

test('a deletion job stops if the username is replaced with a different account during cleanup',async()=>{
  const e=fixture();let transactions=0;const original=e.context.db.runTransaction;
  e.context.db.runTransaction=work=>{
    if(++transactions===7){
      e.put('users/alice',{role:'user',credits:100,sessionVersion:888,passwordHash:'unrelated-new-hash'});
      e.put('reservationHistory/new-account',{user:'alice',note:'Preserve new account data'});
    }
    return original(work);
  };
  const response=await remove(e,request,{tenant:'beach-a'});
  assert.equal(response.code,409);assert.equal(response.body.error,'DELETION_CONTEXT_CHANGED');
  assert.equal(e.data.get(e.root+'users/alice').credits,100);
  assert.equal(e.data.get(e.root+'reservationHistory/new-account').note,'Preserve new account data');
});

test('the tenant exception is limited to the exact password-authenticated account deletion route',async()=>{
  const calls=[];
  const context=vm.createContext({
    AsyncLocalStorage,root:{},validEstablishmentId:value=>/^[a-z0-9-]+$/.test(value),
    readEstablishment:async id=>id==='beach-a'?{id,name:'A',enabled:false}:null,
    readSessionIdentity:async()=>{calls.push('auth');return null;}
  });
  const source=fs.readFileSync(__dirname+'/../backend/src/tenancy.js','utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
  vm.runInContext(source,context);
  async function run(method,path,baseUrl='/api/auth'){
    let passed=false;
    const req={method,path,baseUrl,get:()=> 'beach-a',session:{user:{username:'alice',establishment:'beach-a'}}};
    const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await context.tenantMiddleware(req,res,()=>{passed=true;});return {passed,res};
  }
  assert.equal((await run('DELETE','/account')).passed,true);
  assert.equal(calls.length,0);
  for(const args of [['POST','/account'],['DELETE','/password'],['DELETE','/account','/api']]){
    const result=await run(...args);assert.equal(result.passed,false);assert.equal(result.res.code,401);
  }
});
