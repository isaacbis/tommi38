const {test}=require('node:test');const assert=require('node:assert/strict');const setup=()=>require('./helpers/scoped-routes.cjs')('routes.js');
const booking={fieldId:'volley',date:'2099-01-01',time:'09:00'};
test('manager agenda includes owners in its venue; ordinary users see availability without other names',async()=>{
 const e=setup();await e.call('post','/reservations',{tenant:'beach-a',body:booking});await e.call('post','/reservations',{tenant:'beach-b',body:{...booking,time:'09:45'}});
 const agenda=await e.call('get','/admin/reservations',{tenant:'beach-a',user:'manager',query:{date:booking.date}});assert.equal(agenda.body.items.length,1);assert.equal(agenda.body.items[0].user,'alice');assert.equal(agenda.body.items[0].time,'09:00');
 assert.equal((await e.call('get','/admin/reservations',{tenant:'beach-a',query:{date:booking.date}})).code,403);
 e.data.set('establishments/beach-a/users/bob',{role:'user'});const publicBookings=await e.call('get','/reservations',{tenant:'beach-a',user:'bob',query:{date:booking.date}});assert.equal(publicBookings.body.items[0].user,'');
});
test('cancellation retains agenda history while returning credit only once',async()=>{
 const e=setup();await e.call('post','/reservations',{tenant:'beach-a',body:booking});const params={id:'volley_2099-01-01_09:00'};await e.call('delete','/reservations/:id',{tenant:'beach-a',params});await e.call('delete','/reservations/:id',{tenant:'beach-a',params});
 const r=await e.call('get','/admin/reservations',{tenant:'beach-a',user:'manager',query:{date:booking.date}});assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].status,'cancelled');assert.equal(e.data.get('establishments/beach-a/users/alice').credits,3);
});
test('expired reservations are archived once instead of disappearing from manager history',async()=>{
 const e=setup();e.data.set('establishments/beach-a/reservations/old',{fieldId:'volley',date:'2000-01-01',time:'09:00',user:'alice',slotMinutes:45});
 const result=await e.call('get','/admin/reservations',{tenant:'beach-a',user:'manager',query:{date:'2000-01-01'}});assert.equal(result.body.items[0].status,'completed');assert.ok(!e.data.has('establishments/beach-a/reservations/old'));
 await e.call('get','/admin/reservations',{tenant:'beach-a',user:'manager',query:{date:'2000-01-01'}});assert.equal([...e.data.keys()].filter(k=>k.includes('reservationHistory')).length,1);
});
test('manager cannot grant administrative roles when creating a user or mutate another venue',async()=>{
 const e=setup();const body={username:'new.user',password:'Fixture-secret-2026!',credits:8};assert.equal((await e.call('post','/admin/users',{tenant:'beach-a',user:'manager',body:{...body,role:'admin'}})).code,400);
 assert.equal((await e.call('post','/admin/users',{tenant:'beach-a',user:'manager',body})).code,201);assert.equal(e.data.get('establishments/beach-a/users/new.user').role,'user');assert.ok(!e.data.has('users/new.user'));
});
test('changing duration or removing a booked court cannot invalidate active bookings',async()=>{
 const e=setup();await e.call('post','/reservations',{tenant:'beach-a',body:booking});const config={...e.data.get('establishments/beach-a/admin/config'),slotMinutes:60};
 assert.equal((await e.call('put','/admin/config',{tenant:'beach-a',user:'manager',body:config})).code,409);assert.equal((await e.call('put','/admin/fields',{tenant:'beach-a',user:'manager',body:{fields:[]}})).code,409);
 assert.equal(e.data.get('establishments/beach-a/admin/config').slotMinutes,45);assert.equal(e.data.get('establishments/beach-a/users/alice').credits,2);
});
test('revoked manager sessions fail before any data write',async()=>{
 const e=setup();e.data.get('establishments/beach-a/users/manager').sessionVersion=1;assert.equal((await e.call('put','/admin/users/credits',{tenant:'beach-a',user:'manager',body:{username:'alice',delta:20}})).code,401);assert.equal(e.data.get('establishments/beach-a/users/alice').credits,3);
});
test('renaming a user atomically keeps history, pending requests and player participation attached',async()=>{
 const e=setup();const p='establishments/beach-a/';
 e.data.set(p+'reservationHistory/past',{fieldId:'volley',date:'2000-01-01',time:'09:00',user:'alice',status:'completed'});
 e.data.set(p+'creditRequests/alice',{user:'alice',status:'pending',credits:5});
 e.data.set(p+'playerSearches/group',{ownerUser:'alice'});
 e.data.set(p+'playerSearches/group/requests/one',{requesterUser:'alice'});
 const r=await e.call('post','/admin/users/rename',{tenant:'beach-a',user:'manager',body:{oldUsername:'alice',newUsername:'alice.new'}});assert.equal(r.code,200);
 assert.equal(e.data.get(p+'reservationHistory/past').user,'alice.new');assert.equal(e.data.get(p+'creditRequests/alice.new').user,'alice.new');assert.equal(e.data.get(p+'playerSearches/group').ownerUser,'alice.new');assert.equal(e.data.get(p+'playerSearches/group/requests/one').requesterUser,'alice.new');assert.ok(!e.data.has(p+'users/alice'));assert.equal(e.data.get('users/alice').credits,3);
});
