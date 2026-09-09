const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/script.js'), 'utf8');
function environment() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', disabled: false,
      setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      querySelector() { return { onclick: null }; } });
    return nodes.get(id);
  };
  const context = vm.createContext({ console, Intl, Date, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    navigator: { onLine: true }, document: { getElementById: node, addEventListener() {}, querySelectorAll() { return []; } },
    fetch: async () => { throw new Error('unexpected fetch'); }, window: {} });
  vm.runInContext(source, context);
  return { context, node, run: text => vm.runInContext(text, context) };
}
test('dates use the venue timezone across midnight and daylight-saving changes', () => {
  const e = environment();
  assert.equal(e.run('localISODate(new Date("2026-09-09T22:30:00Z"))'), '2026-09-10');
  assert.equal(e.run('localISODate(new Date("2026-01-09T23:30:00Z"))'), '2026-01-10');
});
test('a late response cannot overwrite the newly selected date', async () => {
  const e = environment();
  e.run('STATE.me = {username:"test"}; renderTimeGrid = () => {}; updateBookingPreview = () => {}; api = () => new Promise(resolve => { pending.push(resolve); });');
  e.context.pending = [];
  e.node('datePick').value = '2099-01-01';
  const first = e.run('loadReservations()');
  e.node('datePick').value = '2099-01-02';
  const second = e.run('loadReservations()');
  e.context.pending[1]({items:[{id:'new',user:'test'}]}); await second;
  e.context.pending[0]({items:[{id:'old',user:'test'}]}); await first;
  assert.equal(e.run('STATE.dayReservationsAll[0].id'), 'new');
  assert.equal(e.run('loadedDate'), '2099-01-02');
});
test('failed availability clears selection and exposes retry', async () => {
  const e = environment();
  e.node('datePick').value = '2099-01-01';
  e.run('STATE.me = {username:"test"}; loadedDate = "2099-01-01"; STATE.selectedTime = "14:00"; updateBookingPreview = () => {}; api = async () => {throw {error:"NETWORK"};};');
  await e.run('loadReservations()');
  assert.equal(e.run('STATE.selectedTime'), '');
  assert.equal(e.run('loadedDate'), '');
  assert.match(e.node('timeGrid').innerHTML, /Riprova/);
});
test('HTML fallback is rejected instead of being treated as empty bookings', async () => {
  const e = environment();
  e.context.fetch = async () => ({status:200,headers:{get:()=> 'text/html'}});
  await assert.rejects(e.run('api("/reservations/mine")'), error => error.error === 'INVALID_RESPONSE');
});
test('failed personal bookings never display other users’ reservations', async () => {
  const e = environment();
  e.run('STATE.me={username:"test"}; STATE.reservations=[{user:"other"}]; api=async()=>{throw {error:"NETWORK"};};');
  await e.run('loadMyReservations()');
  assert.equal(e.run('STATE.myReservations.length'), 0);
  assert.match(e.node('matchesStatus').textContent, /Connessione/);
});
test('booking stays disabled while submitting, offline, or without credits', () => {
  const e = environment();
  e.node('fieldSelect').value = 'volley'; e.node('datePick').value = '2099-01-01';
  e.run('STATE.fields=[{id:"volley",name:"Volley"}]; STATE.selectedTime="14:00"; STATE.me={role:"user",credits:0}; loadedDate="2099-01-01"; updateBookingPreview();');
  assert.equal(e.node('bookBtn').disabled,true);
  e.run('STATE.me.credits=2; bookingBusy=true; updateBookingPreview();');
  assert.equal(e.node('bookBtn').disabled,true);
  e.run('bookingBusy=false; navigator.onLine=false; updateBookingPreview();');
  assert.equal(e.node('bookBtn').disabled,true);
  e.run('navigator.onLine=true; updateBookingPreview();');
  assert.equal(e.node('bookBtn').disabled,false);
});
