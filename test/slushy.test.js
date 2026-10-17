const test=require('node:test');
const assert=require('node:assert/strict');
const {newShift,start,action,tick,slots,cleanSlushyAction}=require('../lib/slushy');
test('slushy protocol accepts bounded controls, never client scores or volumes',()=>{
  for(const value of [null,[],{}, {type:'score',score:9999},{type:'pour',lane:4,down:true},{type:'pour',lane:-1,down:true},{type:'pour',lane:1.2,down:true},{type:'pour',lane:0,down:1}])assert.equal(cleanSlushyAction(value),null);
  assert.deepEqual(cleanSlushyAction({type:'pour',lane:2,down:true,fill:100,score:900}),{type:'pour',lane:2,down:true});
  assert.deepEqual(cleanSlushyAction({type:'reset'}),{type:'reset'});
});
test('cups fill by server time; release serves only a filled cup with dome bonus',()=>{
  const g=newShift();start(g);g.cups[0]={name:'S',volume:1,points:100,fill:0};
  action(g,{type:'pour',lane:0,down:true},1000);tick(g,600,1100);
  action(g,{type:'pour',lane:0,down:false},1100);assert.equal(g.served,0);assert.equal(g.cups[0].fill,.5);
  action(g,{type:'pour',lane:0,down:true},1200);tick(g,720,1300);
  action(g,{type:'pour',lane:0,down:false},1300);assert.equal(g.served,1);assert.equal(g.score,150);assert.equal(g.cups[0],null);
});
test('spill loses the cup, clears held controls and pauses the sixty-second clock during cleanup',()=>{
  const g=newShift();start(g);g.cups[0]={name:'S',volume:1,points:100,fill:1.23};
  action(g,{type:'pour',lane:0,down:true},1000);tick(g,100,1100);
  assert.equal(g.phase,'cleaning');assert.equal(g.spills,1);assert.equal(g.score,0);assert.ok(g.held.every(x=>!x));
  const remaining=g.remaining;tick(g,900,2000);tick(g,900,2900);
  assert.equal(g.remaining,remaining);assert.equal(g.phase,'playing');assert.equal(g.cups.filter(Boolean).length,1);
});
test('progression unlocks four concurrent cups; expired shifts and stale holds cannot pour',()=>{
  const g=newShift();start(g);
  for(const [served,count] of [[0,1],[3,2],[7,3],[12,4]]){g.served=served;assert.equal(slots(g),count);}
  action(g,{type:'pour',lane:0,down:true},1000);tick(g,100,1700);assert.equal(g.cups[0].fill,0);
  g.remaining=20;tick(g,50,1800);assert.equal(g.phase,'finished');assert.equal(g.remaining,0);
  action(g,{type:'pour',lane:0,down:true},1900);assert.ok(g.held.every(x=>!x));
});

test('private shifts and reset are isolated; best score is shared and score spoofing ignored',async t=>{
  const {spawn}=require('node:child_process'), {once}=require('node:events'),net=require('node:net'),WebSocket=require('ws');
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const child=spawn(process.execPath,['server.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('server timeout')),5000);child.stdout.on('data',()=>{clearTimeout(timeout);resolve();});});
  async function connect(id,arcade=''){const ws=new WebSocket(`ws://127.0.0.1:${port}/?room=slushy&client=${id}&arcade=${arcade}`);const messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));t.after(()=>ws.terminate());await once(ws,'open');return {ws,messages,send:m=>ws.send(JSON.stringify(m))};}
  async function state(peer,check){const end=Date.now()+6000;while(Date.now()<end){const m=peer.messages.findLast(m=>m.type==='slushyState'&&check(m));if(m)return m;await new Promise(r=>setTimeout(r,25));}throw Error('state timeout');}
  const a=await connect('slushy-test-a');await state(a,m=>m.phase==='ready');
  const firstRoom=a.messages.find(m=>m.type==='arcadeRooms').currentRoom;
  a.send({type:'createRoom'});
  for(let i=0;i<100&&!a.messages.some(m=>m.type==='roomJoined');i++)await new Promise(r=>setTimeout(r,10));
  const secondRoom=a.messages.find(m=>m.type==='roomJoined').id;
  const b=await connect('slushy-test-b',secondRoom);
  a.send({type:'start'});const initial=await state(a,m=>m.phase==='playing');
  await state(b,m=>m.phase==='ready'&&m.score===0);
  a.send({type:'score',score:999999});a.send(null);
  const volume=initial.cups[0].volume;const end=Date.now()+1250*volume;
  while(Date.now()<end){a.send({type:'pour',lane:0,down:true});await new Promise(r=>setTimeout(r,100));}
  a.send({type:'pour',lane:0,down:false});const served=await state(a,m=>m.served===1);
  assert.ok(served.score>0&&served.score<500);
  await state(b,m=>m.best===served.score&&m.score===0&&m.phase==='ready');
  b.send({type:'reset'});await state(b,m=>m.phase==='playing');await state(a,m=>m.served===1);
  a.ws.close();await once(a.ws,'close');await new Promise(r=>setTimeout(r,100));
  const returning=await connect('slushy-test-a',firstRoom);const resumed=await state(returning,m=>m.served===1);
  assert.equal(resumed.score,served.score);assert.ok(resumed.held.every(x=>!x));
});
