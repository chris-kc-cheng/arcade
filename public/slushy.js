(() => {
  const flavors=[['Cherry pop','#f16c91'],['Blue razz','#50caec'],['Mango tango','#ffbd5b'],['Lime time','#b5e678']];
  const $=id=>document.getElementById(id);
  flavors.forEach(([name,color],i)=>{
    $('tanks').insertAdjacentHTML('beforeend',`<div class="flavor" style="--flavor:${color}"><div class="tank"></div><span class="flavor-name">${name.toUpperCase()}</span></div>`);
    $('lanes').insertAdjacentHTML('beforeend',`<div class="lane" style="--flavor:${color}"><button class="lever" data-lane="${i}" aria-label="Hold ${i+1} to pour ${name}" disabled><span>${i+1}</span></button><div class="stream"></div><div class="cup-wrap" hidden><div class="dome"><div class="dome-fill"></div></div><div class="cup"><div class="fill"></div><div class="cup-logo">FROSTY'S<b>✳</b></div></div><span class="fill-mark">FILL ↙</span><span class="cup-size"></span></div><span class="empty-slot">NEXT CUP<br>COMING SOON</span></div>`);
  });
  let socket, state, reconnect;
  const held=new Set(), lanes=[...document.querySelectorAll('.lane')];
  let client=sessionStorage.getItem('arcade-client');
  if(!client){client=crypto.randomUUID();sessionStorage.setItem('arcade-client',client);}
  function send(value){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
  function pour(lane,down){
    if(down){if(state?.phase!=='playing'||!state.cups[lane])return;held.add(lane);}else held.delete(lane);
    send({type:'pour',lane,down});renderHeld();
  }
  function renderHeld(){lanes.forEach((lane,i)=>lane.classList.toggle('pouring',held.has(i)&&state?.phase==='playing'&&!!state.cups[i]));}
  function release(){for(const lane of [...held])pour(lane,false);}
  function render(){
    $('reset').disabled=socket?.readyState!==WebSocket.OPEN;
    $('best').textContent=state.best.toLocaleString();
    $('time').innerHTML=`${Math.floor(state.remaining/1000)}<small>.${Math.floor(state.remaining%1000/100)} s</small>`;
    $('timebar').style.width=`${state.remaining/600}%`;
    $('score').textContent=String(state.score).padStart(4,'0');$('served').textContent=String(state.served).padStart(2,'0');
    const capacity=state.served<3?1:state.served<7?2:state.served<12?3:4;
    $('capacity').innerHTML=`${capacity}<small> / 4</small>`;
    if($('message').textContent!==state.message)$('message').textContent=state.message;
    const cleaning=state.phase==='cleaning';
    $('phase').textContent=cleaning?'CLOCK PAUSED':state.phase==='finished'?'SHIFT COMPLETE':'SOLO SHIFT';
    document.querySelector('.stage').classList.toggle('cleaning',cleaning);
    $('spill').hidden=$('cloth').hidden=!cleaning;
    $('spill').style.setProperty('--spill-left',`${7+(state.spillLane||0)*21}%`);
    $('spill').style.setProperty('--spill-color',flavors[state.spillLane||0][1]);
    if(state.phase!=='playing')held.clear();renderHeld();
    lanes.forEach((lane,i)=>{
      const cup=state.cups[i],wrap=lane.querySelector('.cup-wrap');
      wrap.hidden=!cup;lane.querySelector('.empty-slot').hidden=!!cup;
      lane.querySelector('.lever').disabled=state.phase!=='playing'||!cup;
      if(cup){wrap.style.setProperty('--size',['S','M','L','XL'].indexOf(cup.name));wrap.style.setProperty('--fill',Math.min(1,cup.fill));wrap.style.setProperty('--dome',Math.max(0,(cup.fill-1)/.24));lane.querySelector('.cup-size').textContent=`${cup.name} · ${cup.points} PTS`;}
    });
    $('overlay').hidden=!['ready','finished'].includes(state.phase);
    $('start').disabled=socket?.readyState!==WebSocket.OPEN;
    if(state.phase==='finished'){
      document.querySelector('.badge').textContent='THAT WAS ICE COLD';
      document.querySelector('.overlay h2').innerHTML=`${state.served} cups.<br><em>${state.score} points.</em>`;
      document.querySelector('.overlay p').textContent=`${state.spills} spills cleaned. House record: ${state.best}. Can you top it?`;
      $('start').innerHTML='ANOTHER SHIFT <span>↗</span>';
    }
  }
  function connect(){
    socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/?room=slushy&client=${encodeURIComponent(client)}`);
    socket.addEventListener('open',()=>{const name=sessionStorage.getItem('arcade-name');if(name)send({type:'setName',name});$('start').disabled=false;});
    socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.type==='slushyState'){state=msg;render();}else if(msg.type==='slushyBest'){$('best').textContent=msg.best.toLocaleString();if(state)state.best=msg.best;}else if(msg.clientId){client=msg.clientId;sessionStorage.setItem('arcade-client',client);}});
    socket.addEventListener('close',()=>{held.clear();renderHeld();$('message').textContent='Connection lost. Your shift is paused; reconnecting…';$('start').disabled=true;$('reset').disabled=true;lanes.forEach(l=>l.querySelector('button').disabled=true);clearTimeout(reconnect);reconnect=setTimeout(connect,1000);});
  }
  document.querySelectorAll('.lever').forEach(button=>{
    const lane=Number(button.dataset.lane);
    button.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();button.setPointerCapture(event.pointerId);pour(lane,true);});
    button.addEventListener('pointerup',()=>pour(lane,false));button.addEventListener('pointercancel',()=>pour(lane,false));button.addEventListener('lostpointercapture',()=>{if(held.has(lane))pour(lane,false);});
    button.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();if(!event.repeat)pour(lane,true);}});
    button.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();pour(lane,false);}});
  });
  document.addEventListener('keydown',event=>{
    if(document.activeElement?.closest('.arcade-topbar,.arcade-debug-panel,input,textarea,select'))return;
    if(/^[1-4]$/.test(event.key)){event.preventDefault();if(!event.repeat)pour(Number(event.key)-1,true);}
  });
  document.addEventListener('keyup',event=>{if(/^[1-4]$/.test(event.key))pour(Number(event.key)-1,false);});
  window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
  $('start').onclick=()=>{release();send({type:'start'});};$('reset').onclick=()=>{release();send({type:'reset'});};
  setInterval(()=>{for(const lane of held)send({type:'pour',lane,down:true});},200);
  connect();
})();
