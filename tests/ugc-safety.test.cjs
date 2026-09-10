const {test}=require('node:test');
const assert=require('node:assert/strict');
const setup=require('./helpers/scoped-routes.cjs');
const requestId=user=>Buffer.from(user).toString('base64url');
const prefix=tenant=>tenant==='tommi38'?'':`establishments/${tenant}/`;
function fixture(){
  const env=setup('routes.js');
  for(const tenant of ['tommi38','beach-a','beach-b']){
    const p=prefix(tenant);
    for(const username of ['bob','carol'])env.data.set(p+'users/'+username,{role:'user',credits:3});
    for(const username of ['alice','bob']){
      env.data.set(p+'reservations/'+username+'-game',{user:username,fieldId:'volley',date:'2099-01-01',time:'18:00'});
      env.data.set(p+'playerSearches/'+username+'-game',{ownerUser:username,reservationId:username+'-game',fieldId:'volley',date:'2099-01-01',time:'18:00',spotsNeeded:3,spotsFilled:0,status:'open',note:'Partita amatoriale'});
    }
  }
  return env;
}
const join=(env,user='bob',tenant='beach-a')=>env.call('post','/player-searches/:id/requests',{user,tenant,params:{id:'alice-game'},body:{participantNames:['Nome Sintetico'],phone:'3331234567'}});
const block=(env,user='bob',tenant='beach-a',body={searchId:'alice-game'})=>env.call('post','/community/blocks',{user,tenant,body});
const report=(env,user='bob',tenant='beach-a',body={reason:'harassment'})=>env.call('post','/player-searches/:id/report',{user,tenant,params:{id:'alice-game'},body});

test('community reports require login and a supported reason; unauthorized users cannot inspect participants',async()=>{
  const e=fixture();
  assert.equal((await report(e,null)).code,401);
  assert.equal((await report(e,'bob','beach-a',{reason:'arbitrary text'})).code,400);
  await join(e);
  const denied=await report(e,'carol','beach-a',{reason:'privacy',requestId:requestId('bob')});
  assert.equal(denied.body.error,'NOT_ALLOWED');
  assert.equal([...e.data.keys()].filter(key=>key.includes('/communityReports/')).length,0);
});

test('reporting is idempotent, tenant scoped and visible only to a manager',async()=>{
  const e=fixture();
  assert.equal((await report(e)).code,200);
  assert.equal((await report(e)).code,200);
  assert.equal((await e.call('get','/admin/community-reports',{user:'bob',tenant:'beach-a'})).code,403);
  const reports=await e.call('get','/admin/community-reports',{user:'manager',tenant:'beach-a'});
  assert.equal(reports.body.items.length,1);
  assert.equal(reports.body.items[0].reportedUser,'alice');
  assert.equal(reports.body.items[0].reporterUser,'bob');
  assert.equal((await e.call('get','/admin/community-reports',{user:'manager',tenant:'beach-b'})).body.items.length,0);
});

test('an organizer can report a participant without copying their phone into the report',async()=>{
  const e=fixture();await join(e);
  assert.equal((await report(e,'alice','beach-a',{reason:'offensive',requestId:requestId('bob')})).code,200);
  const result=await e.call('get','/admin/community-reports',{user:'manager',tenant:'beach-a'});
  assert.equal(result.body.items[0].reportedUser,'bob');
  assert.equal(result.body.items[0].content,'Nome Sintetico');
  assert.ok(!JSON.stringify(result.body).includes('3331234567'));
});

test('a resolved report can be reported again so later abuse still reaches moderation',async()=>{
  const e=fixture();await report(e);
  const result=await e.call('get','/admin/community-reports',{user:'manager',tenant:'beach-a'});
  await e.call('patch','/admin/community-reports/:id',{user:'manager',tenant:'beach-a',params:{id:result.body.items[0].id},body:{action:'resolve'}});
  e.data.get(prefix('beach-a')+'playerSearches/alice-game').note='Messaggio diverso';
  await report(e,'bob','beach-a',{reason:'privacy'});
  const reopened=await e.call('get','/admin/community-reports',{user:'manager',tenant:'beach-a'});
  assert.equal(reopened.body.items.length,1);
  assert.equal(reopened.body.items[0].reason,'privacy');
  assert.equal(reopened.body.items[0].content,'Messaggio diverso');
});

test('blocking hides searches in both directions while another venue with the same usernames stays unchanged',async()=>{
  const e=fixture();assert.equal((await block(e)).code,200);
  for(const [user,hidden] of [['alice','bob-game'],['bob','alice-game']]){
    const result=await e.call('get','/player-searches',{user,tenant:'beach-a'});
    assert.ok(!result.body.items.some(item=>item.id===hidden));
    const other=await e.call('get','/player-searches',{user,tenant:'beach-b'});
    assert.ok(other.body.items.some(item=>item.id===hidden));
  }
  assert.equal((await join(e)).body.error,'COMMUNITY_BLOCKED');
});

test('blocked contacts are hidden and pending requests cannot be accepted or withdrawn through direct calls',async()=>{
  const e=fixture();await join(e);await block(e);
  const owner=await e.call('get','/player-searches',{user:'alice',tenant:'beach-a'});
  assert.equal(owner.body.items.find(item=>item.id==='alice-game').requests.length,0);
  const params={id:'alice-game',requestId:requestId('bob')};
  assert.equal((await e.call('patch','/player-searches/:id/requests/:requestId',{tenant:'beach-a',user:'alice',params,body:{status:'accepted'}})).body.error,'COMMUNITY_BLOCKED');
  assert.equal((await e.call('delete','/player-searches/:id/requests/:requestId',{tenant:'beach-a',user:'bob',params})).body.error,'COMMUNITY_BLOCKED');
  assert.equal(e.data.get(prefix('beach-a')+'playerSearches/alice-game').spotsFilled,0);
});

test('only the blocker removes their own direction; another user cannot clear the pair',async()=>{
  const e=fixture(),first=await block(e);
  await block(e,'alice','beach-a',{searchId:'bob-game'});
  const params={id:first.body.id};
  assert.equal((await e.call('delete','/community/blocks/:id',{tenant:'beach-a',user:'carol',params})).code,403);
  await e.call('delete','/community/blocks/:id',{tenant:'beach-a',user:'bob',params});
  assert.equal((await join(e)).body.error,'COMMUNITY_BLOCKED');
  await e.call('delete','/community/blocks/:id',{tenant:'beach-a',user:'alice',params});
  assert.equal((await join(e)).code,200);
});

test('concurrent block then join obey the shared transaction document',async()=>{
  const e=fixture();
  const results=await Promise.all([block(e),join(e)]);
  assert.equal(results[0].code,200);
  assert.equal(results[1].body.error,'COMMUNITY_BLOCKED');
  assert.ok(!e.data.has(prefix('beach-a')+'playerSearches/alice-game/requests/'+requestId('bob')));
});

test('the server rejects basic abusive notes and participant names, while ordinary text still works',async()=>{
  const e=fixture(),p=prefix('beach-a');
  e.data.delete(p+'playerSearches/alice-game');
  const create=note=>e.call('post','/player-searches',{tenant:'beach-a',user:'alice',body:{reservationId:'alice-game',spotsNeeded:2,note}});
  assert.equal((await create('Ti uccido')).body.error,'CONTENT_NOT_ALLOWED');
  assert.ok(!e.data.has(p+'playerSearches/alice-game'));
  assert.equal((await create('Livello amatoriale, benvenuti!')).code,200);
  const invalid=await e.call('post','/player-searches/:id/requests',{tenant:'beach-a',user:'bob',params:{id:'alice-game'},body:{participantNames:['Vaffanculo'],phone:'3331234567'}});
  assert.equal(invalid.body.error,'CONTENT_NOT_ALLOWED');
  assert.equal((await join(e)).code,200);
});

test('moderation removes a reported search from all feeds and rejects pending requests',async()=>{
  const e=fixture();await join(e);await report(e);
  const reports=await e.call('get','/admin/community-reports',{tenant:'beach-a',user:'manager'});
  const params={id:reports.body.items[0].id},body={action:'close-search'};
  assert.equal((await e.call('patch','/admin/community-reports/:id',{tenant:'beach-a',user:'carol',params,body})).code,403);
  assert.equal((await e.call('patch','/admin/community-reports/:id',{tenant:'beach-a',user:'manager',params,body})).code,200);
  for(const user of ['alice','bob','carol'])assert.ok(!(await e.call('get','/player-searches',{tenant:'beach-a',user})).body.items.some(item=>item.id==='alice-game'));
  assert.equal(e.data.get(prefix('beach-a')+'playerSearches/alice-game/requests/'+requestId('bob')).status,'rejected');
  assert.equal((await join(e)).body.error,'SEARCH_CLOSED');
  const reopen=await e.call('post','/player-searches',{tenant:'beach-a',user:'alice',body:{reservationId:'alice-game',spotsNeeded:2,note:'Riprova'}});
  assert.equal(reopen.body.error,'SEARCH_MODERATED');
  assert.equal((await e.call('get','/admin/community-reports',{tenant:'beach-a',user:'manager'})).body.items.length,0);
});

test('disabling a reported account uses existing authorization and removes their public content and contacts',async()=>{
  const e=fixture();await join(e);
  assert.equal((await e.call('put','/admin/users/status',{tenant:'beach-a',user:'carol',body:{username:'bob',disabled:true}})).code,403);
  assert.equal((await e.call('put','/admin/users/status',{tenant:'beach-a',user:'manager',body:{username:'bob',disabled:true}})).code,200);
  const result=await e.call('get','/player-searches',{tenant:'beach-a',user:'alice'});
  assert.ok(!result.body.items.some(item=>item.id==='bob-game'));
  assert.equal(result.body.items.find(item=>item.id==='alice-game').requests.length,0);
  assert.equal((await join(e)).code,401);
});

test('renaming an account preserves blocks and the manager report references atomically',async()=>{
  const e=fixture();await block(e);await report(e);
  assert.equal((await e.call('post','/admin/users/rename',{tenant:'beach-a',user:'manager',body:{oldUsername:'bob',newUsername:'bob.new'}})).code,200);
  const session={user:{username:'bob.new',role:'user',establishment:'beach-a',sessionVersion:1}};
  const blocks=await e.call('get','/community/blocks',{tenant:'beach-a',session});
  assert.equal(blocks.body.items.length,1);
  assert.equal(blocks.body.items[0].username,'alice');
  assert.equal((await e.call('post','/player-searches/:id/requests',{tenant:'beach-a',session,params:{id:'alice-game'},body:{participantNames:['Nome Sintetico'],phone:'3331234567'}})).body.error,'COMMUNITY_BLOCKED');
  const reports=await e.call('get','/admin/community-reports',{tenant:'beach-a',user:'manager'});
  assert.equal(reports.body.items[0].reporterUser,'bob.new');
});

test('deletion-pending targets cannot gain new reports, blocks, requests, status changes or renames',async()=>{
  const e=fixture(),p=prefix('beach-a');
  e.data.get(p+'users/alice').deletionPending=true;
  assert.equal((await report(e)).body.error,'COMMUNITY_UNAVAILABLE');
  assert.equal((await block(e)).body.error,'COMMUNITY_UNAVAILABLE');
  assert.equal((await join(e)).body.error,'COMMUNITY_UNAVAILABLE');
  assert.equal((await e.call('put','/admin/users/status',{tenant:'beach-a',user:'manager',body:{username:'alice',disabled:false}})).body.error,'ACCOUNT_CHANGED');
  assert.equal((await e.call('post','/admin/users/rename',{tenant:'beach-a',user:'manager',body:{oldUsername:'alice',newUsername:'alice.new'}})).body.error,'ACCOUNT_CHANGED');
  assert.ok(!e.data.has(p+'users/alice.new'));
});

test('a manager deletion starting after authentication prevents a personal booking from recreating their data',async()=>{
  const e=fixture(),p=prefix('beach-a'),run=e.context.db.runTransaction;
  e.context.db.runTransaction=fn=>{
    Object.assign(e.data.get(p+'users/manager'),{disabled:true,deletionPending:true});
    return run(fn);
  };
  const result=await e.call('post','/reservations',{tenant:'beach-a',user:'manager',body:{fieldId:'volley',date:'2099-01-02',time:'09:00'}});
  assert.equal(result.body.error,'USER_NOT_FOUND');
  assert.ok(!e.data.has(p+'reservations/volley_2099-01-02_09:00'));
});

test('a reused username gets its own report after the previous account was renamed',async()=>{
  const e=fixture(),p=prefix('beach-a');await report(e);
  await e.call('post','/admin/users/rename',{tenant:'beach-a',user:'manager',body:{oldUsername:'bob',newUsername:'bob.new'}});
  e.data.set(p+'users/bob',{role:'user',credits:3});
  assert.equal((await report(e,'bob','beach-a',{reason:'privacy'})).code,200);
  const result=await e.call('get','/admin/community-reports',{tenant:'beach-a',user:'manager'});
  assert.equal(result.body.items.length,2);
  assert.equal(result.body.items.find(item=>item.reporterUser==='bob').reason,'privacy');
  assert.equal(result.body.items.find(item=>item.reporterUser==='bob.new').reason,'harassment');
});

test('renaming cannot duplicate participation and reusing a username cannot overwrite the original contacts',async()=>{
  const e=fixture(),p=prefix('beach-a');await join(e);
  await e.call('post','/admin/users/rename',{tenant:'beach-a',user:'manager',body:{oldUsername:'bob',newUsername:'bob.new'}});
  const session={user:{username:'bob.new',role:'user',establishment:'beach-a',sessionVersion:1}};
  const repeat=await e.call('post','/player-searches/:id/requests',{tenant:'beach-a',session,params:{id:'alice-game'},body:{participantNames:['Altro Nome'],phone:'3330000000'}});
  assert.equal(repeat.body.error,'ALREADY_REQUESTED');
  e.data.set(p+'users/bob',{role:'user',credits:3});
  assert.equal((await join(e)).code,200);
  const result=await e.call('get','/player-searches',{tenant:'beach-a',user:'alice'});
  const requests=result.body.items.find(item=>item.id==='alice-game').requests;
  assert.equal(requests.length,2);
  assert.equal(e.data.get(p+'playerSearches/alice-game/requests/'+requestId('bob')).requesterUser,'bob.new');
  assert.equal(e.data.get(p+'playerSearches/alice-game/requests/'+requestId('bob')).phone,'3331234567');
});

test('a moderator deletion after authentication cannot write a new resolution attribution',async()=>{
  const e=fixture(),p=prefix('beach-a');await report(e);
  const reports=await e.call('get','/admin/community-reports',{tenant:'beach-a',user:'manager'}),run=e.context.db.runTransaction;
  e.context.db.runTransaction=fn=>{Object.assign(e.data.get(p+'users/manager'),{disabled:true,deletionPending:true});return run(fn);};
  const result=await e.call('patch','/admin/community-reports/:id',{tenant:'beach-a',user:'manager',params:{id:reports.body.items[0].id},body:{action:'resolve'}});
  assert.equal(result.code,403);
  const saved=e.data.get(p+'communityReports/'+reports.body.items[0].id);
  assert.equal(saved.status,'open');
  assert.equal(saved.resolvedBy,undefined);
});
