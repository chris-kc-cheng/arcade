const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const net = require('node:net');
const WebSocket = require('ws');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('named rooms isolate games and drawing, allow moves, and release empty rooms', async t => {
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,PORT:String(port),ROOM_GRACE_MS:'250'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
  async function connect(client,arcade,room='doodle') {
    const params=new URLSearchParams({client,room});if(arcade)params.set('arcade',arcade);
    const socket=new WebSocket(`ws://127.0.0.1:${port}/?${params}`),messages=[];
    socket.on('message',raw=>messages.push(JSON.parse(raw)));t.after(()=>socket.terminate());
    await once(socket,'open');return {socket,messages,send:message=>socket.send(JSON.stringify(message))};
  }
  async function packet(peer,type,predicate=()=>true) {
    for(let i=0;i<100;i++){const message=peer.messages.findLast(message=>message.type===type&&predicate(message));if(message)return message;await pause(20);}
    throw Error(`Missing ${type}`);
  }
  const a=await connect('rooms-player-a');
  const directory=await packet(a,'arcadeRooms');const first=directory.currentRoom;
  assert.equal(directory.rooms.length,1);assert.match(directory.rooms[0].name,/^[A-Za-z]+ [A-Za-z]+ [0-9A-F]{4}$/);
  const b=await connect('rooms-player-b',first);await packet(b,'welcome');
  a.send({type:'createRoom'});const created=await packet(a,'roomJoined');assert.notEqual(created.id,first);
  const c=await connect('rooms-player-c',created.id);const welcome=await packet(c,'welcome');assert.equal(welcome.users.length,1);
  const two=await packet(c,'arcadeRooms',m=>m.rooms.length===2);assert.equal(two.rooms.find(r=>r.id===first).players,2);
  a.send({type:'stroke',from:{x:.1,y:.2},to:{x:.3,y:.4},size:4,tool:'pen'});
  await packet(b,'stroke');await pause(60);assert.equal(c.messages.some(m=>m.type==='stroke'),false);
  c.send({type:'stroke',from:{x:.6,y:.6},to:{x:.7,y:.7},size:4,tool:'pen'});
  const d=await connect('rooms-player-d',created.id);const otherHistory=await packet(d,'welcome');assert.equal(otherHistory.history.length,1);assert.equal(otherHistory.history[0].from.x,.6);
  a.send({type:'switchGame',path:'/snake'});await packet(b,'switchGame',m=>m.path==='/snake');
  const listing=await packet(c,'arcadeRooms',m=>m.rooms.find(r=>r.id===first)?.path==='/snake');
  assert.equal(listing.rooms.find(r=>r.id===created.id).path,'/');
  assert.equal(c.messages.some(m=>m.type==='clear'||m.type==='switchGame'&&m.path==='/snake'),false);
  const oneSnake=await connect('rooms-snake-one',first,'snake');await packet(oneSnake,'snakeState');
  const twoSnake=await connect('rooms-snake-two',created.id,'snake');const separate=await packet(twoSnake,'snakeState');
  assert.equal(separate.players.length,1);
  a.send({type:'joinRoom',id:created.id});const move=await packet(a,'roomJoined',m=>m.id===created.id);assert.equal(move.path,'/');
  a.send({type:'joinRoom',id:{bad:true}});await packet(a,'roomError');
  const moving=await connect('rooms-player-a',move.id);assert.equal((await packet(moving,'welcome')).users.length,3);
  a.socket.close();b.socket.close();oneSnake.socket.close();
  await pause(450);
  c.send({type:'joinRoom',id:first});await packet(c,'roomError',m=>m.message.includes('closed'));
  assert.equal((await packet(c,'arcadeRooms',m=>m.rooms.length===1)).rooms[0].id,created.id);
  const fresh=await connect('rooms-after-expiry',first);assert.equal((await packet(fresh,'arcadeRooms')).currentRoom,created.id);
});
