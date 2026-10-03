const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const scores = document.querySelector('#scores');
const respawn = document.querySelector('#respawn');
const respawnCount = respawn.querySelector('b');
const messageBox = document.querySelector('#message');
const minimap = document.querySelector('#minimap');
const mapCtx = minimap.getContext('2d');
const MAP_HALF_SIZE = 120;
const sectorObstacles = [
  {x:-20,z:-13,w:15,d:10,h:8},{x:15,z:-18,w:9,d:18,h:11},{x:-4,z:3,w:13,d:13,h:7},
  {x:-25,z:19,w:10,d:15,h:10},{x:23,z:19,w:14,d:9,h:6},{x:30,z:-4,w:7,d:8,h:5}
];
const obstacles = [-80,0,80].flatMap(offsetX=>[-80,0,80].flatMap(offsetZ=>sectorObstacles.map(box=>({...box,x:box.x+offsetX,z:box.z+offsetZ}))));
const keys = new Set();
let socket, selfId, state = { players:[], bullets:[] }, last = performance.now(), reconnectTimer, lastSent = 0, deathAt = 0;
let aim = {x:0,y:0};

function resize(){ const dpr=Math.min(devicePixelRatio||1,2); canvas.width=innerWidth*dpr; canvas.height=innerHeight*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
function me(){ return state.players.find(player=>player.id===selfId); }
function project(x,y,z,camera){
  const dx=x-camera.x, dz=z-camera.z, cos=Math.cos(camera.angle), sin=Math.sin(camera.angle);
  const rx=dx*cos-dz*sin, rz=dx*sin+dz*cos;
  const depth=rz+42, scale=Math.min(innerWidth,innerHeight)*.88/Math.max(15,depth);
  return {x:innerWidth/2+rx*scale,y:innerHeight*.53+(camera.height-y)*scale,scale,depth};
}
function poly(points,fill,stroke){ ctx.beginPath(); points.forEach((p,i)=>(i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y))); ctx.closePath(); ctx.fillStyle=fill; ctx.fill(); if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();} }
function box(object,camera){
  const {x,z,w,d,h}=object, corners=[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]];
  const low=corners.map(([cx,cz])=>project(cx,0,cz,camera)), high=corners.map(([cx,cz])=>project(cx,h,cz,camera));
  const faces=[{p:[low[0],low[1],high[1],high[0]],c:'#283228'},{p:[low[1],low[2],high[2],high[1]],c:'#354035'},{p:[low[2],low[3],high[3],high[2]],c:'#222b22'}];
  faces.sort((a,b)=>b.p.reduce((s,p)=>s+p.depth,0)-a.p.reduce((s,p)=>s+p.depth,0)).forEach(f=>poly(f.p,f.c,'#526052'));
  poly(high,'#4d5949','#687665');
}
function tank(player,camera){
  const p=project(player.x,0,player.z,camera); if(p.depth<4)return;
  const s=Math.max(3,p.scale), bodyW=s*2.1, bodyH=s*.72;
  ctx.save();ctx.translate(p.x,p.y-s*.45);ctx.scale(1,.62);ctx.rotate(-player.heading-camera.angle);
  ctx.fillStyle='#111';ctx.fillRect(-bodyW*.62,-bodyH*.7,bodyW*1.24,bodyH*1.4);
  ctx.fillStyle=player.color;ctx.fillRect(-bodyW/2,-bodyH/2,bodyW,bodyH);
  ctx.strokeStyle='#0c100c';ctx.lineWidth=2;ctx.strokeRect(-bodyW/2,-bodyH/2,bodyW,bodyH);ctx.restore();
  ctx.save();ctx.translate(p.x,p.y-s*.7);ctx.scale(1,.62);ctx.rotate(-player.turret-camera.angle);
  ctx.fillStyle='#202820';ctx.fillRect(0,-s*.11,s*2.2,s*.22);ctx.beginPath();ctx.arc(0,0,s*.48,0,Math.PI*2);ctx.fillStyle=player.color;ctx.fill();ctx.restore();
  ctx.fillStyle=player.id===selfId?'#d8ff3e':'#fff';ctx.textAlign='center';ctx.font='600 11px Barlow Condensed';ctx.fillText(`${player.name}  ${player.score}`,p.x,p.y-s*1.55);
}
function drawGrid(camera){
  ctx.fillStyle='#171f18';ctx.fillRect(0,0,innerWidth,innerHeight);
  const sky=ctx.createLinearGradient(0,0,0,innerHeight*.7);sky.addColorStop(0,'#7d8b7b');sky.addColorStop(1,'#303b31');ctx.fillStyle=sky;ctx.fillRect(0,0,innerWidth,innerHeight*.53);
  const points=[project(-MAP_HALF_SIZE,0,-MAP_HALF_SIZE,camera),project(MAP_HALF_SIZE,0,-MAP_HALF_SIZE,camera),project(MAP_HALF_SIZE,0,MAP_HALF_SIZE,camera),project(-MAP_HALF_SIZE,0,MAP_HALF_SIZE,camera)];poly(points,'#333d32','#d8ff3e');
  ctx.strokeStyle='rgba(203,221,194,.11)';ctx.lineWidth=1;
  for(let n=-MAP_HALF_SIZE;n<=MAP_HALF_SIZE;n+=10){let a=project(n,.02,-MAP_HALF_SIZE,camera),b=project(n,.02,MAP_HALF_SIZE,camera);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();a=project(-MAP_HALF_SIZE,.02,n,camera);b=project(MAP_HALF_SIZE,.02,n,camera);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
}
function drawMinimap(){
  const size=minimap.width, scale=size/(MAP_HALF_SIZE*2), point=value=>(value+MAP_HALF_SIZE)*scale;
  mapCtx.clearRect(0,0,size,size);mapCtx.fillStyle='#151d16';mapCtx.fillRect(0,0,size,size);
  mapCtx.strokeStyle='rgba(216,255,62,.1)';mapCtx.lineWidth=1;
  for(let n=-80;n<=80;n+=80){const p=point(n);mapCtx.beginPath();mapCtx.moveTo(p,0);mapCtx.lineTo(p,size);mapCtx.moveTo(0,p);mapCtx.lineTo(size,p);mapCtx.stroke();}
  mapCtx.fillStyle='#596558';for(const box of obstacles)mapCtx.fillRect(point(box.x-box.w/2),point(box.z-box.d/2),box.w*scale,box.d*scale);
  for(const player of state.players){if(!player.alive)continue;const x=point(player.x),y=point(player.z),isMe=player.id===selfId;mapCtx.save();mapCtx.translate(x,y);mapCtx.rotate(-player.heading);mapCtx.beginPath();mapCtx.moveTo(0,-(isMe?8:6));mapCtx.lineTo(isMe?6:5,isMe?7:5);mapCtx.lineTo(-(isMe?6:5),isMe?7:5);mapCtx.closePath();mapCtx.fillStyle=isMe?'#d8ff3e':player.color;mapCtx.shadowColor=mapCtx.fillStyle;mapCtx.shadowBlur=isMe?10:4;mapCtx.fill();mapCtx.restore();}
  mapCtx.strokeStyle='rgba(216,255,62,.65)';mapCtx.lineWidth=2;mapCtx.strokeRect(1,1,size-2,size-2);
}
function render(){
  const player=me(), camera={x:player?.x||0,z:player?.z||0,angle:-(player?.turret||0)-Math.PI/2,height:13};
  drawGrid(camera);
  const items=[...obstacles.map(o=>({depth:project(o.x,0,o.z,camera).depth,draw:()=>box(o,camera)})),...state.players.filter(p=>p.alive).map(p=>({depth:project(p.x,0,p.z,camera).depth,draw:()=>tank(p,camera)}))];
  items.sort((a,b)=>b.depth-a.depth).forEach(item=>item.draw());
  for(const bullet of state.bullets){const p=project(bullet.x,.8,bullet.z,camera);ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,p.scale*.15),0,Math.PI*2);ctx.fillStyle='#fff4a1';ctx.shadowColor='#d8ff3e';ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;}
  drawMinimap();
  requestAnimationFrame(render);
}
function send(type,data={}){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type,...data}));}
function connect(){
  const protocol=location.protocol==='https:'?'wss':'ws';socket=new WebSocket(`${protocol}://${location.host}?room=tanks`);
  socket.onopen=()=>{const name=sessionStorage.getItem('arcade-name');if(name)send('setName',{name});};
  socket.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.type==='switchGame'&&msg.path!==location.pathname){location.assign(msg.path);return;}if(msg.type==='tankWelcome')selfId=msg.selfId;if(msg.type==='tankState'){state=msg;document.querySelector('#reset').disabled=false;renderScores();const player=me();if(player&&!player.alive){deathAt=player.respawnAt;respawn.classList.add('show');}else respawn.classList.remove('show');}if(msg.type==='kill'&&msg.killerId===selfId)notify(`TARGET ELIMINATED  +1`);};
  socket.onclose=()=>{document.querySelector('#reset').disabled=true;clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,1200);};
}
function renderScores(){scores.innerHTML=[...state.players].sort((a,b)=>b.score-a.score).map(p=>`<div class="score-row ${p.id===selfId?'me':''}"><span><i class="dot" style="--tank-color:${p.color}"></i>${p.name}${p.id===selfId?' · YOU':''}</span><span>${p.score}</span></div>`).join('');}
function notify(text){messageBox.textContent=text;messageBox.classList.add('show');setTimeout(()=>messageBox.classList.remove('show'),1700);}
function inputLoop(now){
  const player=me();if(player?.alive&&now-lastSent>45){const forward=(keys.has('w')||keys.has('arrowup')?1:0)-(keys.has('s')||keys.has('arrowdown')?1:0),turn=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);send('tankInput',{forward,turn,aimX:aim.x,aimY:aim.y});lastSent=now;}
  if(deathAt){respawnCount.textContent=Math.max(0,Math.ceil((deathAt-Date.now())/1000));}
  last=now;requestAnimationFrame(inputLoop);
}
addEventListener('keydown',e=>{if(window.ArcadePlatform.isInteractiveTarget(e.target))return;keys.add(e.key.toLowerCase());if(e.code==='Space'){e.preventDefault();send('tankFire');}});addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
canvas.addEventListener('pointermove',e=>{aim={x:(e.clientX/innerWidth)*2-1,y:(e.clientY/innerHeight)*2-1};});canvas.addEventListener('pointerdown',()=>send('tankFire'));
addEventListener('resize',resize);resize();connect();requestAnimationFrame(render);requestAnimationFrame(inputLoop);


document.querySelector('#reset').onclick=()=>{if(confirm('Reset all Tank scores and redeploy everyone?'))send('tankReset')};
