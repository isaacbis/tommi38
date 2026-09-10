const {test}=require('node:test');
const assert=require('node:assert/strict');
const setupRoutes=require('./helpers/scoped-routes.cjs');
const setup=()=>setupRoutes('routes.js');
const period={fieldId:'volley',startDate:'2099-01-10',endDate:'2099-01-12',start:'09:00',end:'12:00',reason:'Torneo'};
const pathFor=(tenant,collection)=>`${tenant==='tommi38'?'':`establishments/${tenant}/`}${collection}`;
const close=(e,body=period,options={})=>e.call('post','/admin/closures',{user:'manager',body,...options});
const book=(e,date,time='09:00',options={})=>e.call('post','/reservations',{body:{fieldId:'volley',date,time},...options});
const readDay=(e,date,options={})=>e.call('get','/reservations',{query:{date},...options});

test('a period is one closure, inclusive on first, middle and final days, with a legacy-compatible daily response',async()=>{
  const e=setup();
  assert.equal((await close(e)).code,200);
  const stored=e.data.get('admin/closures').items;
  assert.equal(stored.length,1);
  assert.deepEqual({...stored[0],id:undefined},{...period,id:undefined});
  for(const date of ['2099-01-10','2099-01-11','2099-01-12']){
    const response=await readDay(e,date);
    assert.equal(response.code,200);
    assert.equal(response.body.closures.length,1);
    assert.equal(response.body.closures[0].date,date);
    assert.equal(response.body.closures[0].startDate,period.startDate);
    assert.equal(response.body.closures[0].endDate,period.endDate);
    assert.equal(response.body.closures[0].id,stored[0].id);
  }
  for(const date of ['2099-01-09','2099-01-13'])assert.equal((await readDay(e,date)).body.closures.length,0);
  assert.equal(e.data.get('admin/closures').items[0].date,undefined,'daily projection must not mutate the stored period');
});

test('first, middle and last day bookings are blocked without charging credits; outside dates remain available',async()=>{
  const e=setup();await close(e);
  const before=structuredClone(e.data);
  for(const date of ['2099-01-10','2099-01-11','2099-01-12']){
    const response=await book(e,date);
    assert.equal(response.code,409);assert.equal(response.body.error,'FIELD_CLOSED');
  }
  assert.deepEqual(e.data,before);
  assert.equal((await book(e,'2099-01-09')).code,200);
  assert.equal((await book(e,'2099-01-13')).code,200);
  assert.equal(e.data.get('users/alice').credits,1);
});

test('the same daily time interval applies throughout the period and adjacent slots stay available',async()=>{
  const e=setup();await close(e,{...period,start:'10:00'});
  assert.equal((await book(e,'2099-01-11','09:45')).body.error,'FIELD_CLOSED','a slot partially crossing the closure is blocked');
  assert.equal((await book(e,'2099-01-11','09:00')).code,200);
  assert.equal((await book(e,'2099-01-11','12:00')).code,200);
});

test('existing single-day documents and legacy inputs remain readable, enforced and independently removable',async()=>{
  const e=setup();
  const legacy={id:'legacy',fieldId:'volley',date:'2099-01-11',start:'09:00',end:'10:00',reason:'Manutenzione'};
  e.data.set('admin/closures',{items:[legacy]});
  assert.equal((await readDay(e,legacy.date)).body.closures[0].date,legacy.date);
  assert.equal((await book(e,legacy.date)).body.error,'FIELD_CLOSED');
  assert.equal((await readDay(e,'2099-01-12')).body.closures.length,0);
  assert.equal((await close(e,{...legacy,id:undefined,date:'2099-01-15',time:'09:00'})).code,200);
  const newLegacy=e.data.get('admin/closures').items[1];
  assert.equal(newLegacy.date,'2099-01-15');assert.equal(newLegacy.startDate,undefined);
  assert.equal(newLegacy.time,undefined,'legacy extra fields continue to be ignored');
  await e.call('delete','/admin/closures/:id',{user:'manager',params:{id:'legacy'}});
  assert.equal(e.data.get('admin/closures').items.length,1);
  assert.equal((await book(e,legacy.date)).code,200);
});

test('invalid, reversed and partial date ranges or time intervals reject without modifying stored data',async()=>{
  const e=setup();const before=structuredClone(e.data);
  const invalid=[
    {...period,startDate:'2099-02-29'}, {...period,startDate:'2100-02-29',endDate:'2100-03-01'},
    {...period,endDate:'2099-04-31'}, {...period,startDate:'2099-13-01'},
    {...period,endDate:'2099-01-09'}, {...period,startDate:'2000-01-01'},
    {...period,startDate:undefined}, {...period,endDate:undefined},
    {...period,date:'2099-01-10'}, {...period,start:'12:00',end:'12:00'},
    {...period,start:'13:00',end:'12:00'}, {...period,start:'24:00'},
    {...period,reason:' '}, {...period,startDate:null},
    {fieldId:'volley',date:'2099-02-29',start:'09:00',end:'10:00',reason:'Test'}
  ];
  for(const body of invalid){assert.equal((await close(e,body)).code,400,JSON.stringify(body));assert.deepEqual(e.data,before);}
});

test('real leap dates and long periods are accepted without expanding into daily records',async()=>{
  const e=setup();
  assert.equal((await close(e,{...period,startDate:'2096-02-29',endDate:'2196-02-29'})).code,200);
  const items=e.data.get('admin/closures').items;
  assert.equal(items.length,1);assert.equal(items[0].endDate,'2196-02-29');
  assert.equal((await readDay(e,'2100-01-01')).body.closures.length,1);
});

test('a conflicting booking on an intermediate day rejects the entire period with no partial write or pruning',async()=>{
  const e=setup();
  e.data.set('admin/closures',{items:[{id:'expired',fieldId:'volley',date:'2000-01-01',start:'09:00',end:'10:00',reason:'Old'}]});
  e.data.set('reservations/middle',{fieldId:'volley',date:'2099-01-11',time:'09:45',slotMinutes:45,user:'alice'});
  const before=structuredClone(e.data);
  const response=await close(e,{...period,start:'10:00',end:'11:00'});
  assert.equal(response.code,409);assert.equal(response.body.error,'EXISTING_RESERVATIONS');
  assert.deepEqual(e.data,before);
});

test('conflicts use the booked duration and ignore other fields, outside dates and adjacent intervals',async()=>{
  const e=setup();
  const bookings=[
    {fieldId:'other',date:'2099-01-11',time:'10:00',slotMinutes:90},
    {fieldId:'volley',date:'2099-01-09',time:'10:00',slotMinutes:90},
    {fieldId:'volley',date:'2099-01-13',time:'10:00',slotMinutes:90},
    {fieldId:'volley',date:'2099-01-11',time:'09:00',slotMinutes:60},
    {fieldId:'volley',date:'2099-01-11',time:'11:00',slotMinutes:45}
  ];
  bookings.forEach((value,index)=>e.data.set('reservations/fixture-'+index,{...value,user:'alice'}));
  assert.equal((await close(e,{...period,start:'10:00',end:'11:00'})).code,200);
  const other=setup();
  other.data.set('reservations/long-game',{fieldId:'volley',date:'2099-01-11',time:'09:00',slotMinutes:90,user:'alice'});
  assert.equal((await close(other,{...period,start:'10:00',end:'11:00'})).body.error,'EXISTING_RESERVATIONS');
});

test('operations and pruning retain periods already started when their ending date is still current',async()=>{
  const e=setup();
  e.context.localISODate=()=> '2099-01-11';
  e.context.localMinutes=()=>0;
  const ongoing={...period,id:'ongoing',startDate:'2000-01-01',endDate:'2099-01-11'};
  const expired={...period,id:'expired',startDate:'2000-01-01',endDate:'2099-01-10'};
  const legacy={id:'legacy-current',fieldId:'volley',date:'2099-01-20',start:'09:00',end:'10:00',reason:'Legacy'};
  e.data.set('admin/closures',{items:[ongoing,expired,legacy]});
  const operations=await e.call('get','/admin/operations',{user:'manager'});
  assert.deepEqual([...operations.body.closures.map(item=>item.id)],['ongoing','legacy-current']);
  assert.equal(e.data.get('admin/closures').items.length,3,'read-only operations do not rewrite history');
  assert.equal((await close(e,{...period,startDate:'2099-01-21',endDate:'2099-01-22'})).code,200);
  const ids=e.data.get('admin/closures').items.map(item=>item.id);
  assert.equal(ids.includes('ongoing'),true);assert.equal(ids.includes('legacy-current'),true);assert.equal(ids.includes('expired'),false);
  assert.equal((await book(e,'2099-01-11')).body.error,'FIELD_CLOSED');
});

test('waitlist availability remains blocked throughout a closure period after the original booking disappears',async()=>{
  const e=setup();await close(e);
  for(const date of ['2099-01-10','2099-01-11','2099-01-12','2099-01-13']){
    e.data.set('waitlist/'+date,{user:'alice',reservationId:'missing-'+date,fieldId:'volley',date,time:'09:00',end:'09:45'});
  }
  const response=await e.call('get','/waitlist');
  assert.equal(response.code,200);
  assert.deepEqual([...response.body.items.map(item=>[item.date,item.available])],[
    ['2099-01-10',false],['2099-01-11',false],['2099-01-12',false],['2099-01-13',true]
  ]);
});

test('a full-day period still blocks slots after opening hours change, including midnight and late evening',async()=>{
  const e=setup();await close(e,{...period,start:'00:00',end:'23:59'});
  e.data.get('admin/config').dayStart='00:00';
  e.data.get('admin/config').dayEnd='23:59';
  for(const time of ['00:00','22:30'])assert.equal((await book(e,'2099-01-11',time)).body.error,'FIELD_CLOSED');
  assert.equal(e.data.get('users/alice').credits,3);
});

test('closures, bookings and period deletion remain isolated by venue and manager authority',async()=>{
  const e=setup();
  assert.equal((await close(e,period,{user:'alice',tenant:'beach-a'})).code,403);
  assert.equal((await close(e,period,{tenant:'beach-a'})).code,200);
  assert.equal((await readDay(e,'2099-01-11',{tenant:'beach-b'})).body.closures.length,0);
  assert.equal((await book(e,'2099-01-11','09:00',{tenant:'beach-b'})).code,200);
  assert.equal((await book(e,'2099-01-11','09:00',{tenant:'beach-a'})).body.error,'FIELD_CLOSED');
  const before=structuredClone(e.data);
  const managerA={user:{username:'manager',role:'admin',establishment:'beach-a'}};
  assert.equal((await close(e,period,{tenant:'beach-b',session:managerA})).code,401);
  assert.deepEqual(e.data,before);
  const id=e.data.get(pathFor('beach-a','admin/closures')).items[0].id;
  await e.call('delete','/admin/closures/:id',{tenant:'beach-b',user:'manager',params:{id}});
  assert.equal(e.data.get(pathFor('beach-a','admin/closures')).items.length,1);
});

test('an authorized global context writes only its selected venue and preserves the original account',async()=>{
  const e=setup();
  e.data.set('users/platform',{role:'admin',platformAdmin:true,credits:20});
  const session={user:{username:'platform',role:'admin',establishment:'tommi38'},managementEstablishment:'beach-a'};
  assert.equal((await close(e,period,{tenant:'beach-a',session})).code,200);
  assert.equal(e.data.has('admin/closures'),false);
  assert.equal(e.data.has(pathFor('beach-b','admin/closures')),false);
  assert.equal(e.data.get(pathFor('beach-a','admin/closures')).items.length,1);
  assert.equal(e.data.get('users/platform').credits,20);
  assert.equal(session.user.username,'platform');assert.equal(session.user.establishment,'tommi38');
});

test('concurrent booking and closure attempts never leave a booking inside a saved period',async()=>{
  for(const closureFirst of [true,false]){
    const e=setup();
    const first=closureFirst?close(e):book(e,'2099-01-11');
    const second=closureFirst?book(e,'2099-01-11'):close(e);
    const results=await Promise.all([first,second]);
    assert.equal(results.filter(result=>result.code===200).length,1);
    const reserved=e.data.has('reservations/volley_2099-01-11_09:00');
    const closed=(e.data.get('admin/closures')?.items.length || 0)>0;
    assert.notEqual(reserved,closed);
    assert.equal(e.data.get('users/alice').credits,reserved?2:3);
    const error=results.find(result=>result.code!==200).body.error;
    assert.ok(['FIELD_CLOSED','EXISTING_RESERVATIONS'].includes(error));
  }
});

test('a storage failure does not persist any part of a closure period',async()=>{
  const e=setup();const before=structuredClone(e.data);e.failCommit();
  await assert.rejects(close(e),/Storage failure/);
  assert.deepEqual(e.data,before);
});
