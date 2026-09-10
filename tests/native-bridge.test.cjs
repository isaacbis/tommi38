const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function environment() {
  const events = [];
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {value:'',textContent:'',open:false,
      classList:{add(){},remove(){},toggle(){}},setAttribute(){},reset(){}});
    return nodes.get(id);
  };
  const context = vm.createContext({
    console,Intl,Date,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,
    navigator:{onLine:true},
    document:{getElementById:node,addEventListener(){},querySelectorAll(){return [];},body:{classList:{add(){},remove(){}}}},
    localStorage:{getItem:()=> 'beach-a',removeItem:()=>events.push({type:'forget-venue'}),setItem(){}},
    location:{reload:()=>events.push({type:'reload'})},
    window:{webkit:{messageHandlers:{tommi38Notifications:{postMessage:message=>events.push(structuredClone(message))}}}},
    fetch:async()=>{throw new Error('Unexpected network request');}
  });
  for(const file of ['script.js','community.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend',file),'utf8'),context);
  }
  vm.runInContext('STATE.me={username:"alice",role:"user"}; STATE.nativeSynced=true; resetManagementViews=()=>{}; closeAppModal=()=>{}; paginateCommunityList=()=>{}; showHomePanel=()=>{};',context);
  return {events,context,run:source=>vm.runInContext(source,context)};
}

test('changing establishment signs out and clears native reminders before resetting account and reloading', async()=>{
  const e=environment();
  e.context.recordLogout=()=>e.events.push({type:'logout'});
  e.run('api=async(path)=>{if(path!=="/logout")throw Error("Unexpected endpoint");recordLogout();return {ok:true};};');
  await e.run('chooseEstablishment()');
  assert.deepEqual(e.events,[
    {type:'logout'},
    {type:'clearBookings',account:'alice',establishment:'beach-a'},
    {type:'forget-venue'},
    {type:'reload'}
  ]);
  assert.equal(e.run('STATE.me'),null);
  assert.equal(e.run('STATE.nativeSynced'),false);
});

test('a failed establishment sign-out keeps the account and its reminders available for retry', async()=>{
  const e=environment();
  e.run('api=async()=>{throw {error:"NETWORK"};};');
  await assert.rejects(e.run('chooseEstablishment()'),error=>error.error==='NETWORK');
  assert.deepEqual(e.events,[]);
  assert.equal(e.run('STATE.me.username'),'alice');
  assert.equal(e.run('STATE.nativeSynced'),true);
});

test('entering venue management clears the original personal scope before switching and never impersonates a local account', async()=>{
  const e=environment();
  e.run(`
    selectedEstablishment='tommi38';
    STATE.me={username:'admin',role:'admin',platformAdmin:true,managementMode:false};
    api=async(path,options)=>({establishment:{id:options.method==='DELETE'?'tommi38':'beach-b',name:'Fixture'}});
    loadAll=async()=>{STATE.me={username:'admin',role:'admin',platformAdmin:true,managementMode:selectedEstablishment!=='tommi38'};};
  `);
  await e.run('changeManagementContext("beach-b")');
  assert.deepEqual(e.events,[{type:'clearBookings',account:'admin',establishment:'tommi38'}]);
  assert.equal(e.run('selectedEstablishment'),'beach-b');
  assert.equal(e.run('STATE.me.managementMode'),true);
  await e.run('returnToPlatform()');
  assert.deepEqual(e.events,[{type:'clearBookings',account:'admin',establishment:'tommi38'}]);
  assert.equal(e.run('selectedEstablishment'),'tommi38');
  assert.equal(e.run('STATE.me.managementMode'),false);
});

test('Home sends complete updated personal booking snapshots to the native reminder store', async()=>{
  const e=environment();
  e.run(`
    window.tommi38Native={notificationsVersion:2};
    STATE.fields=[{id:'volley',name:'Volley'}];
    homeBookings=[{id:'booking1',fieldId:'volley',date:'2099-01-01',time:'16:00'}];
    api=async(path)=>path==='/credits'?{balance:3,items:[]}:path==='/reservations/mine'?{items:homeBookings}:{items:[]};
  `);
  await e.run('loadHome()');
  assert.deepEqual(e.events,[{type:'syncBookings',account:'alice',establishment:'beach-a',items:[
    {id:'beach-a:booking1',field:'Volley',date:'2099-01-01',time:'16:00',minutesBefore:30}
  ]}]);
  e.run('homeBookings=[];');
  await e.run('loadHome()');
  assert.deepEqual(e.events[1],{type:'syncBookings',account:'alice',establishment:'beach-a',items:[]});
});

test('an obsolete Home response cannot schedule reminders for a newly selected account', async()=>{
  const e=environment();
  e.context.pending=[];
  e.run('window.tommi38Native={notificationsVersion:2}; api=()=>new Promise(resolve=>pending.push(resolve));');
  const loading=e.run('loadHome()');
  e.run('homeRequest++; selectedEstablishment="beach-b"; STATE.me={username:"bob",role:"user"};');
  for(const resolve of e.context.pending)resolve({balance:0,items:[]});
  await loading;
  assert.deepEqual(e.events,[]);
});
