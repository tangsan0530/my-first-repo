import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('offline answer retry, UUID deduplication, progress merge and result confirmation', async () => {
 const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/\r/g,'');
 const local=new Map();const queuedTimers=[];let saves=0;let posted=0;let rendered=0;
 const sandbox={console,Intl,Date,Map,Set,AbortController,crypto:globalThis.crypto,
  localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)},
  navigator:{onLine:false},document:{addEventListener(){},querySelector(){return {classList:{add(){},remove(){}}}}},
  window:{addEventListener(){}},confirm:()=>true,setInterval(){},setTimeout:fn=>{queuedTimers.push(fn);return queuedTimers.length;},clearTimeout(){}};
 const ctx=vm.createContext(sandbox);
 // Load the shipped application's actual implementation, excluding only startup I/O.
 vm.runInContext(source.slice(0,source.lastIndexOf('\ntry {\n  const [pr, lr]')),ctx);
 vm.runInContext(`user='zyl';session={username:user,access_token:'test'};practiceBank={version:'2026.11.24-v2.0'};progress=fresh();progress.lessons.local=100;progress.notes.local={text:'local',at:100};queue=[{id:'same-uuid',set_id:1,answers:Array.from({length:20},()=>[])}];attempts=[{id:'same-uuid',synced:false}];results={id:'same-uuid'};`,ctx);
 sandbox.stubApi=async(action,body)=>{
  if(action==='progress-get')return {data:{lessons:{remote:200},notes:{remote:{text:'remote',at:200}},updated:200}};
  if(action==='progress-save'){saves++;return {ok:true};}
  if(action==='submit'){posted++;if(posted===1)throw Error('temporary network failure');return {ok:true,correct:12};}
  if(action==='scores')return {scores:[]};throw Error('unknown action');
 };
 sandbox.countRender=()=>{rendered++;};
 vm.runInContext('api=stubApi;render=countRender;',ctx);
 await vm.runInContext('sync()',ctx);assert.equal(posted,0);
 sandbox.navigator.onLine=true;
 await vm.runInContext('sync()',ctx);assert.equal(posted,1);
 assert.equal(vm.runInContext('queue.length',ctx),1);
 await vm.runInContext('sync()',ctx);assert.equal(posted,2);
 assert.equal(vm.runInContext('queue.length',ctx),0);
 assert.equal(vm.runInContext('attempts[0].synced',ctx),true);
 assert.equal(vm.runInContext('attempts[0].correct',ctx),12);
 assert.equal(vm.runInContext('progress.lessons.local',ctx),100);
 assert.equal(vm.runInContext('progress.lessons.remote',ctx),200);
 await vm.runInContext('sync()',ctx);assert.equal(posted,2);
 assert(rendered>=2,'results are refreshed after cloud confirmation');assert(saves>=2);
 // A change made during an outstanding sync schedules another upload.
 let release;
 sandbox.stubApi=async(action)=>action==='progress-save'?new Promise(resolve=>{release=()=>resolve({ok:true});}):action==='scores'?{scores:[]}:{data:{}};
 vm.runInContext('api=stubApi;',ctx);
 const pending=vm.runInContext('sync(false)',ctx);await Promise.resolve();
 await vm.runInContext('sync()',ctx);assert.equal(vm.runInContext('syncAgain',ctx),true);
 release();await pending;
 assert.equal(vm.runInContext('syncAgain',ctx),false);assert(queuedTimers.length>0);
 vm.runInContext("quiz={mode:'race',set_id:50,version:practiceBank.version,ids:['q'],answers:[[1]],index:0};persistQuiz();quiz=null;begin(['q'],'race',50)",ctx);
 assert.equal(vm.runInContext('quiz.answers[0][0]',ctx),1,'unfinished answers survive a reload');
});
