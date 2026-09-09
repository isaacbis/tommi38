const {test}=require('node:test');
const assert=require('node:assert/strict');
const bcrypt=require('../backend/node_modules/bcrypt');
const setup=require('./helpers/scoped-routes.cjs');
const signup={username:'new.user',password:'Unique-fixture-2026!'};
test('registration creates a pending ordinary user only in the selected venue',async()=>{
 const e=setup();const r=await e.call('post','/register',{tenant:'beach-a',user:null,body:signup});assert.equal(r.code,201);
 const account=e.data.get('establishments/beach-a/users/new.user');assert.equal(account.role,'user');assert.equal(account.disabled,true);assert.equal(account.pendingApproval,true);assert.equal(account.credits,0);assert.ok(await bcrypt.compare(signup.password,account.passwordHash));assert.ok(!e.data.has('users/new.user'));
 assert.equal((await e.call('get','/credit-packages',{tenant:'beach-a',user:'new.user'})).code,401);
 for(const extra of [{role:'admin'},{platformAdmin:true},{credits:99}])assert.equal((await e.call('post','/register',{user:null,body:{...signup,...extra}})).code,400);
});
test('closed registration and duplicate usernames preserve current accounts',async()=>{
 const e=setup();e.data.get('admin/config').registrationEnabled=false;assert.equal((await e.call('post','/register',{user:null,body:signup})).code,403);
 const before=structuredClone(e.data.get('establishments/beach-a/users/alice'));assert.equal((await e.call('post','/register',{tenant:'beach-a',user:null,body:{...signup,username:'alice'}})).code,409);assert.deepEqual(e.data.get('establishments/beach-a/users/alice'),before);
});
test('password changes require the current secret, revoke other sessions and preserve other venues',async()=>{
 const e=setup();const other=e.data.get('establishments/beach-a/users/alice').passwordHash;
 assert.equal((await e.call('post','/password',{body:{currentPassword:'incorrect',newPassword:signup.password}})).code,403);
 const r=await e.call('post','/password',{body:{currentPassword:'Fixture-secret-2026!',newPassword:signup.password}});assert.equal(r.code,200);assert.equal(r.session.user.sessionVersion,1);
 assert.equal((await e.call('get','/credit-packages')).code,401);assert.equal((await e.call('get','/credit-packages',{session:r.session})).code,200);
 assert.equal(e.data.get('establishments/beach-a/users/alice').passwordHash,other);
 assert.equal((await e.call('post','/register',{user:null,body:{...signup,password:'é'.repeat(37)}})).code,400);
});
test('recovery requests hide account existence and are visible only to the local manager',async()=>{
 const e=setup();const existing=await e.call('post','/recovery-request',{tenant:'beach-a',user:null,body:{username:'alice'}});const missing=await e.call('post','/recovery-request',{tenant:'beach-a',user:null,body:{username:'absent'}});assert.equal(JSON.stringify(existing.body),JSON.stringify(missing.body));
 assert.equal((await e.call('get','/admin/recovery-requests')).code,403);
 assert.equal((await e.call('get','/admin/recovery-requests',{user:'manager'})).body.items.length,0);
 assert.equal((await e.call('get','/admin/recovery-requests',{tenant:'beach-a',user:'manager'})).body.items[0].username,'alice');
});
async function pending(e){await e.call('put','/admin/credit-packages',{tenant:'beach-a',user:'manager',body:{items:[{id:'ten',title:'10 partite',credits:10}]}});return e.call('post','/credit-requests',{tenant:'beach-a',body:{packageId:'ten'}});}
test('credit requests do not charge or credit users until the venue manager approves',async()=>{
 const e=setup();assert.equal((await pending(e)).code,200);assert.equal(e.data.get('establishments/beach-a/users/alice').credits,3);
 assert.equal((await e.call('post','/credit-requests',{tenant:'beach-a',body:{packageId:'ten'}})).code,409);
 assert.equal((await e.call('patch','/admin/credit-requests/:username',{tenant:'beach-a',params:{username:'alice'},body:{status:'approved'}})).code,403);
 const results=await Promise.all([1,2].map(()=>e.call('patch','/admin/credit-requests/:username',{tenant:'beach-a',user:'manager',params:{username:'alice'},body:{status:'approved'}})));
 assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);assert.equal(e.data.get('establishments/beach-a/users/alice').credits,13);assert.equal(e.data.get('users/alice').credits,3);assert.equal(e.data.get('establishments/beach-b/users/alice').credits,3);assert.equal([...e.data.keys()].filter(k=>k.includes('/creditLedger/')).length,1);
});
test('failed approval is atomic and does not consume a pending request',async()=>{
 const e=setup();await pending(e);e.failCommit();await assert.rejects(e.call('patch','/admin/credit-requests/:username',{tenant:'beach-a',user:'manager',params:{username:'alice'},body:{status:'approved'}}),/Storage failure/);
 assert.equal(e.data.get('establishments/beach-a/users/alice').credits,3);assert.equal(e.data.get('establishments/beach-a/creditRequests/alice').status,'pending');
});
test('manager endpoints reject a session belonging to another venue even with matching username',async()=>{
 const e=setup();const r=await e.call('get','/admin/credit-requests',{tenant:'beach-b',session:{user:{username:'manager',role:'admin',establishment:'beach-a'}}});assert.equal(r.code,401);
});
