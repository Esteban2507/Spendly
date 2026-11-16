const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/state.js'), 'utf8');
const expense = (id, amount = 100) => ({ id, desc: id, amount, cat: 'Otros', date: '2026-11-16' });
function environment(store = new Map(), overrides = {}, navigatorOverrides = {}) {
  const context = {
    console: { warn() {}, error() {} },
    navigator: { language: 'es-AR', ...navigatorOverrides },
    localStorage: { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value), ...overrides },
    Blob, URL, setTimeout
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.Spendly;
}
const data = (store) => JSON.parse(store.get('gastos-v1'));

test('amount parser supports decimal and grouped formats without guessing invalid text', () => {
  const s = environment();
  for (const [value, expected] of [['1.234,50',1234.5],['1,234.50',1234.5],['10.000',10000],['10,000',10000],['24,5',24.5],['$ 1.234',1234],['ARS 1.234,50',1234.5],['US$ 1,234.50',1234.5],['1 234,50',1234.5],['0.500',0.5],['0',0]]) {
    assert.equal(s.parseAmount(value), expected, value);
  }
  for (const value of ['-100','abc100','12 34','100 and 200','1.23.4','1,234,50','1.2.345','1e3','Infinity','12.', '', Infinity, -1]) {
    assert.ok(Number.isNaN(s.parseAmount(value)), String(value));
  }
});

test('legacy budgets migrate into historical and current months and later edits are independent', () => {
  const store = new Map([['gastos-v1', JSON.stringify({version:2,budget:1000,currency:'ARS',expenses:[expense('a')],recurring:[],dismissed:[]})]]);
  const s = environment(store);
  assert.equal(s.loadState().error, '');
  assert.equal(s.getBudget('2026-11').total,1000);
  assert.equal(s.persistChange(() => s.setBudget('2026-12',2000,{'Comida':500})),true);
  assert.equal(s.getBudget('2026-11').total,1000);
  assert.equal(s.getBudget('2026-12').categories.Comida,500);
  assert.equal(s.getBudget('2027-01').total,0);
  const copy = s.getBudget('2026-12'); copy.categories.Comida = 1;
  assert.equal(s.getBudget('2026-12').categories.Comida,500);
  assert.equal(data(store).version,3);
});

test('sanitization rejects inherited category names, invalid dates and nonfinite budgets, preserving receipt identity', () => {
  const s=environment();
  const clean=s.sanitizeState({expenses:[{...expense('a'),cat:'constructor',sourceHash:'abc',receiptFingerprint:'xyz'}, {...expense('b'),date:'2026-02-31'}],budget:Infinity,budgets:{'2026-13':{total:20},'2026-11':{total:Infinity,categories:{Comida:100,constructor:42}}}});
  assert.equal(clean.dropped,1);
  assert.equal(clean.expenses[0].cat,'Otros');
  assert.equal(clean.expenses[0].sourceHash,'abc');
  assert.equal(clean.expenses[0].receiptFingerprint,'xyz');
  assert.equal(clean.budgets['2026-11'].total,0);
  assert.equal(Object.hasOwn(clean.budgets['2026-11'].categories,'constructor'),false);
  assert.equal(Object.hasOwn(clean.budgets,'2026-13'),false);
});

test('independent additions and deletion in stale tabs merge without losing movements', () => {
  const store=new Map(); const a=environment(store),b=environment(store);
  a.loadState(); b.loadState();
  assert.equal(a.persistChange(()=>a.State.expenses.push(expense('a'))),true);
  assert.equal(b.persistChange(()=>b.State.expenses.push(expense('b'))),true);
  assert.deepEqual(data(store).expenses.map(e=>e.id).sort(),['a','b']);
  assert.equal(a.syncState().changed,true);
  assert.equal(b.persistChange(()=>b.State.expenses.push(expense('c'))),true);
  assert.equal(a.persistChange(()=>{ a.State.expenses=a.State.expenses.filter(e=>e.id!=='a'); }),true);
  assert.deepEqual(data(store).expenses.map(e=>e.id).sort(),['b','c']);
});

test('same-record edit conflicts preserve persisted data and roll back the failed local edit', () => {
  const store=new Map(); const a=environment(store);
  a.loadState(); a.persistChange(()=>a.State.expenses.push(expense('a')));
  const b=environment(store); b.loadState();
  assert.equal(a.persistChange(()=>a.State.expenses[0].amount=200),true);
  assert.equal(b.persistChange(()=>b.State.expenses[0].amount=300),false);
  assert.equal(data(store).expenses[0].amount,200);
  assert.equal(b.State.expenses[0].amount,100);
  assert.equal(b.getStorageStatus().code,'conflict');
  assert.equal(b.syncState().changed,true);
  assert.equal(b.State.expenses[0].amount,200);
});

test('failed writes roll back changes and return visible error information', () => {
  const s=environment(new Map(),{setItem(){throw new Error('QuotaExceededError');}});
  s.loadState();
  assert.equal(s.persistChange(()=>s.State.expenses.push(expense('a'))),false);
  assert.equal(s.State.expenses.length,0);
  assert.equal(s.getStorageStatus().code,'write');
  assert.match(s.getStorageStatus().error,/No se pudo guardar/);
});

test('corrupted source stays intact until explicit successful backup restoration', () => {
  const original='{broken-json'; const store=new Map([['gastos-v1',original]]);
  const s=environment(store); const info=s.loadState();
  assert.ok(info.error); assert.equal(info.recoverySaved,true);
  assert.equal(s.persistChange(()=>s.State.expenses.push(expense('a'))),false);
  assert.equal(store.get('gastos-v1'),original);
  assert.equal(s.replaceState(s.sanitizeState({expenses:[expense('recovered')],currency:'ARS'})),true);
  assert.equal(data(store).expenses[0].id,'recovered');
  assert.equal(s.getStorageStatus().ok,true);
});

test('partially damaged data are readable but original is never silently rewritten', () => {
  const original=JSON.stringify({expenses:[expense('a'),{bad:true}],currency:'ARS'});
  const store=new Map([['gastos-v1',original]]); const s=environment(store);
  const info=s.loadState();
  assert.equal(info.dropped,1); assert.ok(info.error);
  assert.equal(s.State.expenses.length,1);
  assert.equal(s.saveState(),false);
  assert.equal(store.get('gastos-v1'),original);
});

test('restoration rejects stale data and prevents old tabs merging into a restored backup', () => {
  const store=new Map(); const a=environment(store),b=environment(store);
  a.loadState(); b.loadState();
  assert.equal(a.replaceState(a.sanitizeState({expenses:[expense('restored')],currency:'ARS'})),true);
  assert.equal(b.persistChange(()=>b.State.expenses.push(expense('stale'))),false);
  assert.equal(b.replaceState(b.sanitizeState({expenses:[]})),false);
  assert.deepEqual(data(store).expenses.map(e=>e.id),['restored']);
  const c=environment(store);c.loadState();
  assert.equal(c.persistChange(()=>c.State.expenses.push(expense('new'))),true);
  assert.equal(a.persistChange(()=>a.State.expenses.push(expense('also-new'))),true);
  assert.deepEqual(data(store).expenses.map(e=>e.id).sort(),['also-new','new','restored']);
});

test('same automatic recurring charge created by stale tabs is stored only once', () => {
  const store=new Map();const a=environment(store),b=environment(store);a.loadState();b.loadState();
  assert.equal(a.persistChange(()=>a.State.expenses.push({...expense('a'),rid:'rule'})),true);
  assert.equal(b.persistChange(()=>b.State.expenses.push({...expense('b'),desc:'a',rid:'rule'})),true);
  assert.equal(data(store).expenses.length,1);
});

test('currency locks once a movement, recurring rule or budget contains financial data', () => {
  const s=environment(); assert.equal(s.hasFinancialData(),false);
  s.setBudget('2026-11',0,{Comida:100});assert.equal(s.hasFinancialData(),true);
});

test('single-currency policy survives stale tabs and cannot relabel existing amounts', () => {
  const store=new Map();const a=environment(store),b=environment(store);a.loadState();b.loadState();
  assert.equal(a.persistChange(()=>a.State.expenses.push(expense('a'))),true);
  assert.equal(b.persistChange(()=>b.State.currency='USD'),false);
  assert.equal(data(store).currency,'ARS');
  assert.equal(a.persistChange(()=>a.State.currency='USD'),false);
  assert.equal(a.State.currency,'ARS');
});

test('synchronization reflects externally cleared data', () => {
  const store=new Map();const s=environment(store);s.loadState();s.persistChange(()=>s.State.expenses.push(expense('a')));
  store.delete('gastos-v1');
  assert.equal(s.syncState().changed,true);
  assert.equal(s.State.expenses.length,0);
});

test('future-version backups cannot be silently downgraded', () => {
  const s=environment();
  assert.throws(()=>s.sanitizeState({version:99,expenses:[]}),/versión más reciente/);
});

test('Web Locks queue simultaneous tab mutations inside the shared write lock', async () => {
  const store=new Map(); const trace=[];let queue=Promise.resolve();
  const locks={request(name,operation){
    assert.equal(name,'spendly-state-write');
    const result=queue.then(async()=>{trace.push('enter');const value=await operation();trace.push('leave');return value;});
    queue=result.catch(()=>{});return result;
  }};
  const a=environment(store,{}, {locks}),b=environment(store,{}, {locks});a.loadState();b.loadState();
  const result=await Promise.all([
    a.persistChangeAsync(()=>{trace.push('a');a.State.expenses.push(expense('a'));}),
    b.persistChangeAsync(()=>{trace.push('b');b.State.expenses.push(expense('b'));})
  ]);
  assert.deepEqual(result,[true,true]);
  assert.deepEqual(trace,['enter','a','leave','enter','b','leave']);
  assert.deepEqual(data(store).expenses.map(e=>e.id).sort(),['a','b']);
});

test('async restoration uses the lock and rejects a queued stale replacement', async () => {
  const store=new Map(); let queue=Promise.resolve();let requests=0;
  const locks={request(name,operation){requests++;const result=queue.then(operation);queue=result.catch(()=>{});return result;}};
  const a=environment(store,{}, {locks}),b=environment(store,{}, {locks});a.loadState();b.loadState();
  const result=await Promise.all([
    a.replaceStateAsync(a.sanitizeState({expenses:[expense('restored')]})),
    b.replaceStateAsync(b.sanitizeState({expenses:[expense('stale')]}))
  ]);
  assert.deepEqual(result,[true,false]);
  assert.equal(requests,2);
  assert.deepEqual(data(store).expenses.map(e=>e.id),['restored']);
  assert.equal((await b.syncStateAsync()).changed,true);
});

test('lock rejection does not run the mutation or fall back to an unlocked write', async () => {
  const store=new Map();let called=false;
  const s=environment(store,{}, {locks:{request(){return Promise.reject(new Error('Unavailable'));}}});s.loadState();
  assert.equal(await s.persistChangeAsync(()=>{called=true;s.State.expenses.push(expense('a'));}),false);
  assert.equal(called,false);assert.equal(store.has('gastos-v1'),false);
  assert.equal(s.getStorageStatus().code,'lock');
});

test('async writes retain the synchronous fallback when Web Locks are unavailable', async () => {
  const store=new Map();const s=environment(store);s.loadState();
  assert.equal(await s.persistChangeAsync(()=>s.State.expenses.push(expense('a'))),true);
  assert.deepEqual(data(store).expenses.map(e=>e.id),['a']);
});

test('migration rounds monetary decimals consistently and rejects boolean monetary values', () => {
  const s=environment();
  const clean=s.sanitizeState({expenses:[expense('a',1.005),expense('b',true)],budgets:{'2026-11':{total:10.075,categories:{Comida:1.005,Otros:true}},'0000-01':{total:100}},recurring:[{id:'r',desc:'x',amount:true,day:1,from:'2026-11'}]});
  assert.equal(clean.expenses[0].amount,1.01);
  assert.equal(clean.dropped,2);
  assert.equal(clean.budgets['2026-11'].total,10.08);
  assert.equal(clean.budgets['2026-11'].categories.Comida,1.01);
  assert.equal(clean.budgets['2026-11'].categories.Otros,0);
  assert.equal(Object.hasOwn(clean.budgets,'0000-01'),false);
});

test('receipt-like checks refresh under the lock before testing for duplicate data', async () => {
  const store=new Map();let queue=Promise.resolve();
  const locks={request(name,operation){const result=queue.then(operation);queue=result.catch(()=>{});return result;}};
  const a=environment(store,{}, {locks}),b=environment(store,{}, {locks});a.loadState();b.loadState();
  const add=(s,id)=>s.persistChangeAsync(()=>{
    if(s.State.expenses.some(e=>e.sourceHash==='same-file'))return false;
    s.State.expenses.push({...expense(id),sourceHash:'same-file'});
  },{refresh:true});
  assert.deepEqual(await Promise.all([add(a,'a'),add(b,'b')]),[true,false]);
  assert.equal(data(store).expenses.length,1);
  assert.equal(b.getStorageStatus().code,'cancelled');
  assert.equal(b.getStorageStatus().error,'');
});

test('explicit cancellation rolls back partial mutation without writing or reporting a storage failure', () => {
  const store=new Map();const s=environment(store);s.loadState();
  assert.equal(s.persistChange(()=>{s.State.expenses.push(expense('a'));return false;}),false);
  assert.equal(s.State.expenses.length,0);
  assert.equal(store.has('gastos-v1'),false);
  assert.equal(s.getStorageStatus().ok,true);
  assert.equal(s.getStorageStatus().code,'cancelled');
});

test('legacy missing or duplicate IDs migrate deterministically across tabs', () => {
  const original=JSON.stringify({expenses:[{...expense('a'),id:undefined},expense('same'),expense('same')],currency:'ARS'});
  const store=new Map([['gastos-v1',original]]);const a=environment(store),b=environment(store);a.loadState();b.loadState();
  assert.deepEqual(Array.from(a.State.expenses,e=>e.id),Array.from(b.State.expenses,e=>e.id));
  assert.equal(new Set(a.State.expenses.map(e=>e.id)).size,3);
  assert.equal(a.persistChange(()=>a.State.expenses.push(expense('new-a'))),true);
  assert.equal(b.persistChange(()=>b.State.expenses.push(expense('new-b'))),true);
  assert.equal(data(store).expenses.length,5);
});
