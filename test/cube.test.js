const test = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { Cube, solved, validate, cleanAction } = require('../lib/cube');
const delay = ms => new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){for(let i=0;i<400;i++){if(fn())return;await delay(25);}throw Error('Timed out');}
test('cube validates physical solvability, not just color counts',()=>{
  assert.ok(validate(solved));assert.ok(validate(new Cube().move("R U F2 L D' B").asString()));
  assert.equal(validate('U'.repeat(54)),false);assert.equal(validate(null),false);
  for(const mutation of [c=>c.eo[0]=1,c=>c.co[0]=1,c=>[c.ep[0],c.ep[1]]=[c.ep[1],c.ep[0]],c=>c.cp[0]=c.cp[1]]){const cube=new Cube();mutation(cube);assert.equal(validate(cube.asString()),false);}
});
test('cube protocol rejects center edits, invalid indexes, forged state and stale format',()=>{
  for(const a of [{type:'paint',index:4,revision:1},{type:'paint',index:54,revision:1},{type:'paint',index:0},{type:'paint',index:1.1,revision:1},{type:'solution',moves:['R']},null])assert.equal(cleanAction(a),null);
  assert.deepEqual(cleanAction({type:'paint',index:0,revision:1,color:'X'}),{type:'paint',index:0,revision:1});
});
test('worker solutions solve a cube entered as facelet colors',async()=>{
  const cube=new Cube().move("R U2 F' L B2 D R2 U' F");
  const worker=new Worker(require.resolve('../lib/cube-worker'),{workerData:cube.asString()});
  const moves=await new Promise((r,j)=>{worker.once('message',r);worker.once('error',j);});
  assert.ok(moves.length);cube.move(moves.join(' '));assert.equal(cube.asString(),solved);
});
test('cube synchronizes edits, solve, playback and reset across reconnects',async t=>{
  const { WebSocket }=require('ws'),{server,wss}=require('../server');
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const clients=[],states=[];
  async function join(){const i=clients.length,s=new WebSocket(`ws://127.0.0.1:${server.address().port}/?room=cube&client=cube-test-${i}`);clients.push(s);states[i]=[];s.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='cubeState')states[i].push(m);});await new Promise(r=>s.once('open',r));await waitFor(()=>states[i].length);return s;}
  t.after(async()=>{clients.forEach(s=>s.terminate());await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));});
  const a=await join(),b=await join(),send=m=>a.send(JSON.stringify(m)),last=()=>states[0].at(-1);
  send({type:'paint',index:0,revision:0});await waitFor(()=>last().revision===1);assert.equal(states[1].at(-1).stickers,last().stickers);
  send({type:'paint',index:1,revision:0});await delay(70);assert.equal(last().revision,1);
  send({type:'start'});await waitFor(()=>last().message.includes('Impossible'));assert.equal(last().phase,'editing');
  send({type:'scramble'});await waitFor(()=>last().revision===2);assert.ok(validate(last().stickers));
  send({type:'start'});await waitFor(()=>last().phase==='playing');send({type:'pause'});await waitFor(()=>last().phase==='paused');
  const original=last().stickers;send({type:'next'});await waitFor(()=>last().step===1);const turned=last().stickers;assert.notEqual(turned,original);
  assert.equal(new Cube(Cube.fromString(original).toJSON()).move(last().moves[0]).asString(),turned);
  send({type:'back'});await waitFor(()=>last().step===0);assert.equal(last().stickers,original);
  b.close();await join();assert.equal(states[2].at(-1).stickers,original);
  for(let i=0;i<last().moves.length;i++){send({type:'next'});await waitFor(()=>last().step===i+1);}
  assert.equal(last().phase,'complete');assert.equal(last().stickers,solved);
  send({type:'reset'});await waitFor(()=>last().phase==='editing');assert.equal(last().stickers,solved);
});
