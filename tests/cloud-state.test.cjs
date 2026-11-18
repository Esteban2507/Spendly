const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const stateSource=fs.readFileSync(path.join(__dirname,'../js/state.js'),'utf8');
const cloudSource=fs.readFileSync(path.join(__dirname,'../js/cloud.js'),'utf8');
const expense=(id,amount=100)=>({id,desc:id,amount,cat:'Otros',date:'2026-11-18'});
const empty=()=>({version:2,expenses:[],budget:0,currency:'ARS',recurring:[],dismissed:[]});
function fixture({store=new Map(),readError=false,writeError=false}={}){
  const docs=new Map(),reads=[],writes=[],timers=new Map();let nextTimer=0;
  let blockedGet=null;
  const snapshot=uid=>({exists:docs.has(uid),data:()=>JSON.parse(JSON.stringify(docs.get(uid)))});
  const reference=uid=>({uid,get:async options=>{reads.push(options);if(readError)throw new Error('server unavailable');if(blockedGet)await blockedGet;return snapshot(uid);}});
  const db={collection(){return {doc(uid){return {collection(){return {doc(){return reference(uid);}};}};}};},async runTransaction(operation){
    let staged;
    await operation({get:async ref=>{if(blockedGet)await blockedGet;return snapshot(ref.uid);},set:(ref,payload)=>{staged={uid:ref.uid,payload};}});
    if(writeError)throw new Error('permission denied');
    if(staged){docs.set(staged.uid,staged.payload);writes.push(staged);}
  }};
  const firestore=()=>db;firestore.FieldValue={serverTimestamp:()=>({seconds:123,nanoseconds:0})};
  const context={console:{warn(){},error(){}},navigator:{language:'es-AR'},document:{getElementById(){return null;}},firebase:{firestore},localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)},setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),crypto:{randomUUID:()=>`revision-${Math.random()}`}};
  context.window=context;vm.createContext(context);vm.runInContext(stateSource,context);vm.runInContext(cloudSource,context);
  const s=context.Spendly;s.Cloud.init();
  function account(uid){s.Cloud.setActiveUser(uid);s.switchProfile(uid);}
  return {s,store,docs,reads,writes,account,setBlockedGet:p=>{blockedGet=p;},runTimers:async()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}await new Promise(resolve=>setImmediate(resolve));}};
}

test('guest and each signed-in account have separate exact local state, including logout',()=>{
  const f=fixture();const s=f.s;s.loadState();s.State.expenses.push(expense('guest'));assert.equal(s.saveState(),true);
  f.account('alice');assert.equal(s.State.expenses.length,0);s.State.expenses.push(expense('alice'));s.saveState();
  f.account('bob');assert.equal(s.State.expenses.length,0);s.State.expenses.push(expense('bob'));s.saveState();
  f.account('alice');assert.equal(s.State.expenses[0].id,'alice');assert.equal(s.isCloudDirty(),true);
  f.account(null);assert.equal(s.State.expenses[0].id,'guest');
  assert.equal(JSON.parse(f.store.get('gastos-v1')).expenses[0].id,'guest');
});

test('server-only reads distinguish missing document from read failures',async()=>{
  const f=fixture();f.account('alice');assert.equal((await f.s.Cloud.loadFromCloud('alice')).revision,null);assert.equal(f.reads[0].source,'server');
  const bad=fixture({readError:true});bad.account('alice');await assert.rejects(bad.s.Cloud.loadFromCloud('alice'),/server unavailable/);
  bad.s.State.expenses.push(expense('pending'));bad.s.saveState();assert.equal(bad.writes.length,0);
});

test('scheduleSave captures the original snapshot and cancels it on account switch',async()=>{
  const f=fixture();const s=f.s;f.account('alice');s.saveCloudBaseline(null,'alice');s.Cloud.resume();
  s.State.expenses.push(expense('alice'));s.saveState();
  f.account('bob');s.State.expenses.push(expense('bob'));s.saveState();await f.runTimers();
  assert.equal(f.writes.length,0);assert.equal(s.State.expenses[0].id,'bob');
});

test('new cloud write uses a transaction and acknowledges exactly its sent snapshot',async()=>{
  const f=fixture();const s=f.s;f.account('alice');s.saveCloudBaseline(null,'alice');s.Cloud.resume();s.State.expenses.push(expense('a'));s.saveState();
  assert.equal(await s.Cloud.saveNow('alice',s.State,s.getCloudBaseline()),true);
  assert.equal(f.docs.get('alice').state.expenses[0].id,'a');assert.equal(s.isCloudDirty(),false);assert.equal(s.getCloudBaseline(),f.docs.get('alice').revision);
});

test('remote revision conflicts never overwrite or resurrect deleted data',async()=>{
  const f=fixture();const s=f.s;f.account('alice');s.saveCloudBaseline('old','alice');s.Cloud.resume();s.State.expenses.push(expense('old-deleted'));s.saveState();f.docs.set('alice',{state:empty(),revision:'new'});
  assert.equal(await s.Cloud.saveNow('alice',s.State,'old'),false);assert.equal(f.writes.length,0);assert.equal(f.docs.get('alice').state.expenses.length,0);assert.equal(s.isCloudDirty(),true);assert.equal(s.Cloud.getStatus().phase,'conflict');
  assert.equal(s.Cloud.scheduleSave('alice',s.State,'old'),false);
});

test('in-flight acknowledgement preserves later local changes and advances only the cloud base',async()=>{
  const f=fixture();const s=f.s;f.account('alice');s.saveCloudBaseline(null,'alice');s.Cloud.resume();
  s.State.expenses.push(expense('first'));s.saveState();const sent=JSON.parse(JSON.stringify(s.State));
  s.State.expenses.push(expense('second'));s.saveState();
  assert.equal(s.acceptCloudWrite('alice','next',sent,null),true);assert.equal(s.isCloudDirty(),true);assert.equal(s.State.expenses.length,2);assert.equal(s.getCloudBaseline(),'next');
});

test('stale account reads cannot apply after switching users',async()=>{
  const f=fixture();f.account('alice');f.docs.set('alice',{state:{...empty(),expenses:[expense('secret-a')]},revision:'a'});
  let release;f.setBlockedGet(new Promise(resolve=>{release=resolve;}));const result=f.s.Cloud.loadFromCloud('alice');f.account('bob');release();await assert.rejects(result,/cuenta cambió/);assert.equal(f.s.State.expenses.length,0);
});

test('malformed source is preserved until explicit successful restore, and cross-tab local replacement is rejected',()=>{
  const store=new Map([['gastos-v1','{broken']]);const f=fixture({store});assert.ok(f.s.loadState().error);assert.equal(f.s.saveState(),false);assert.equal(store.get('gastos-v1'),'{broken');
  assert.equal(f.s.replaceLocalState({...empty(),expenses:[expense('recovered')]}),true);assert.equal(f.s.State.expenses[0].id,'recovered');
  f.account('alice');f.s.saveCloudBaseline(null,'alice');const key='gastos-v1:user:alice';store.set(key,JSON.stringify({owner:'alice',format:'spendly-profile-v1',state:{...empty(),expenses:[expense('other-tab')]},cloudRevision:null,dirty:true}));
  assert.equal(f.s.replaceFromCloud(empty(),null,'alice'),false);assert.equal(JSON.parse(store.get(key)).state.expenses[0].id,'other-tab');
});

test('localStorage failure returns false and never queues a cloud write',()=>{
  const f=fixture();f.account('alice');f.s.saveCloudBaseline(null,'alice');f.s.Cloud.resume();f.s.State.expenses.push(expense('a'));
  // Simulates a second tab changing the local envelope before this tab saves.
  f.store.set('gastos-v1:user:alice','changed elsewhere');assert.equal(f.s.saveState(),false);assert.equal(f.writes.length,0);assert.ok(f.s.getStorageStatus().error);
});
