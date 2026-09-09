const {test}=require('node:test');
const assert=require('node:assert/strict');
const setup=require('./helpers/scoped-routes.cjs');
function environment(file='routes.js'){
 const e=setup(file);e.data.set('users/admin',{role:'admin',platformAdmin:true,credits:90,passwordHash:'root-fixture'});e.data.set('establishments/beach-a/users/admin',{role:'user',credits:7,passwordHash:'local-fixture'});
 const session=()=>({user:{username:'admin',role:'admin',establishment:'tommi38'},managementEstablishment:'beach-a'});
 return {...e,global:(method,path,options={})=>e.call(method,path,{tenant:'beach-a',...options,session:session()})};
}
const slot={fieldId:'volley',date:'2099-01-01',time:'09:00'};
test('global management shows the original identity and cannot run personal actions as a namesake',async()=>{
 const e=environment();const r=await e.global('get','/me');assert.equal(r.code,200);assert.equal(r.body.username,'admin');assert.equal(r.body.platformAdmin,true);assert.equal(r.body.managementMode,true);assert.equal(r.body.credits,0);assert.equal(r.body.establishment.id,'beach-a');
 const before=structuredClone(e.data);
 for(const [method,path,body]of [['get','/credits',{}],['get','/reservations/mine',{}],['post','/reservations',slot],['post','/waitlist',{reservationId:'anything'}],['post','/player-searches',{}]])assert.equal((await e.global(method,path,{body})).body.error,'MANAGEMENT_CONTEXT_ONLY');
 assert.deepEqual(e.data,before);
});
test('global account cannot change a target namesake password or request personal credits',async()=>{
 const e=environment('account-routes.js');const before=structuredClone(e.data);
 for(const [method,path,body]of [['post','/password',{currentPassword:'local-fixture',newPassword:'New-fixture-secret'}],['post','/credit-requests',{packageId:'ten'}],['get','/credit-requests',{}]])assert.equal((await e.global(method,path,{body})).body.error,'MANAGEMENT_CONTEXT_ONLY');
 assert.deepEqual(e.data,before);assert.equal((await e.global('get','/credit-packages')).code,200);
});
test('global administrator can manage selected venue users and appoint a scoped manager only',async()=>{
 const e=environment();assert.equal((await e.global('put','/admin/users/credits',{body:{username:'alice',delta:4}})).code,200);assert.equal(e.data.get('establishments/beach-a/users/alice').credits,7);assert.equal(e.data.get('establishments/beach-b/users/alice').credits,3);
 assert.equal((await e.global('put','/admin/users/role',{body:{username:'alice',role:'admin'}})).code,200);assert.equal(e.data.get('establishments/beach-a/users/alice').role,'admin');assert.equal(e.data.get('establishments/beach-a/users/alice').sessionVersion,1);assert.equal(e.data.get('establishments/beach-a/users/alice').platformAdmin,undefined);
 assert.equal((await e.call('put','/admin/users/role',{tenant:'beach-b',user:'manager',body:{username:'alice',role:'admin'}})).code,403);
 assert.equal((await e.global('post','/admin/users',{body:{username:'new.manager',password:'Long-fixture-2026!',credits:0,role:'admin'}})).code,201);assert.equal(e.data.get('establishments/beach-a/users/new.manager').role,'admin');assert.equal(e.data.get('establishments/beach-a/users/new.manager').platformAdmin,false);
});
test('the global account is protected while an unrelated namesake can be managed locally',async()=>{
 const e=environment();assert.equal((await e.global('put','/admin/users/status',{body:{username:'admin',disabled:true}})).code,200);assert.equal(e.data.get('users/admin').disabled,undefined);
 const r=await e.call('put','/admin/users/role',{session:{user:{username:'admin',establishment:'tommi38'},managementEstablishment:'tommi38'},body:{username:'admin',role:'user'}});assert.equal(r.body.error,'PROTECTED_ACCOUNT');assert.equal(e.data.get('users/admin').role,'admin');
});
test('administrator booking records the actual local owner, has no debit and cannot mint a cancellation refund',async()=>{
 const e=environment();assert.equal((await e.global('post','/admin/reservations',{body:{...slot,username:'alice'}})).code,200);
 const id='volley_2099-01-01_09:00';const saved=e.data.get('establishments/beach-a/reservations/'+id);assert.equal(saved.user,'alice');assert.equal(saved.createdBy,'platform:admin');assert.equal(saved.creditsCharged,0);assert.equal(e.data.get('establishments/beach-a/users/alice').credits,3);
 assert.equal((await e.call('delete','/reservations/:id',{tenant:'beach-a',params:{id}})).code,200);assert.equal(e.data.get('establishments/beach-a/users/alice').credits,3);
 const history=[...e.data].filter(([path])=>path.startsWith('establishments/beach-a/reservationHistory/'));assert.equal(history.length,1);assert.equal(history[0][1].creditsCharged,0);
});
test('venue managers may book and cancel for their own members but cannot use global context',async()=>{
 const e=environment();assert.equal((await e.call('post','/admin/reservations',{tenant:'beach-b',user:'manager',body:{...slot,username:'alice'}})).code,200);assert.equal((await e.global('delete','/admin/reservations/:id',{params:{id:'volley_2099-01-01_09:00'}})).code,200);assert.ok(e.data.has('establishments/beach-b/reservations/volley_2099-01-01_09:00'));
 assert.equal((await e.call('delete','/admin/reservations/:id',{tenant:'beach-b',user:'manager',params:{id:'volley_2099-01-01_09:00'}})).code,200);assert.ok(!e.data.has('establishments/beach-b/reservations/volley_2099-01-01_09:00'));
 assert.equal((await e.global('post','/admin/reservations',{body:{...slot,username:'missing-user'}})).body.error,'USER_NOT_FOUND');
});
test('a global administrator moderates groups without becoming a local namesake participant',async()=>{
 const e=environment();const base='establishments/beach-a/playerSearches/group';e.data.set(base,{fieldId:'volley',ownerUser:'admin',date:'2099-01-01',time:'09:00',spotsNeeded:2,spotsFilled:0,status:'open'});e.data.set(base+'/requests/request',{requesterUser:'admin',count:1,status:'pending'});
 const list=await e.global('get','/player-searches');assert.equal(list.body.items[0].isOwner,false);assert.equal(list.body.items[0].myRequest,null);
 const deletion=await e.global('delete','/player-searches/:id/requests/:requestId',{params:{id:'group',requestId:'request'}});assert.equal(deletion.body.error,'MANAGEMENT_CONTEXT_ONLY');assert.ok(e.data.has(base+'/requests/request'));
});
