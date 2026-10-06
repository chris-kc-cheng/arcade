(() => {
  const faces='URFDLB', names={U:'White',R:'Red',F:'Green',D:'Yellow',L:'Orange',B:'Blue'}, colors={U:'#f5f5e9',R:'#e05d52',F:'#5d9e73',D:'#efcd58',L:'#ef9855',B:'#5a8ece'};
  const $=id=>document.getElementById(id); let state, socket, animationTimer, view=-35, online=false;
  const header=ArcadePlatform.mount(document.querySelector('header'),{game:'cube',onReset:()=>send('reset'),resetDisabled:false});
  const tiles=[];
  for(const face of 'ULFRBD') {
    const grid=document.createElement('div');grid.className='face';grid.dataset.face=face;grid.setAttribute('aria-label',face+' face');
    for(let j=0;j<9;j++){const index=faces.indexOf(face)*9+j, tile=document.createElement('button');tile.className='tile';tile.onclick=()=>send('paint',{index,revision:state.revision});grid.append(tile);tiles[index]=tile;}
    $('net').append(grid);
  }
  for(const f of faces){const item=document.createElement('span'), dot=document.createElement('i');dot.style.background=colors[f];item.append(dot,document.createTextNode(names[f]));$('palette').append(item);}
  function geometry(index){const face=faces[Math.floor(index/9)],r=Math.floor(index%9/3),c=index%3;
    const coords={U:[c-1,1,r-1],R:[1,1-r,1-c],F:[c-1,1-r,1],D:[c-1,-1,1-r],L:[-1,1-r,c-1],B:[1-c,1-r,-1]}[face];
    const normal={U:[0,1,0],R:[1,0,0],F:[0,0,1],D:[0,-1,0],L:[-1,0,0],B:[0,0,-1]}[face];
    const rot={U:'rotateX(90deg)',D:'rotateX(-90deg)',R:'rotateY(90deg)',L:'rotateY(-90deg)',F:'',B:'rotateY(180deg)'}[face];
    return {coords, transform:`translate3d(${coords[0]*66+normal[0]*33}px,${-coords[1]*66-normal[1]*33}px,${coords[2]*66+normal[2]*33}px) ${rot}`};
  }
  function draw(stickers,move){$('cube').replaceChildren();const slice=document.createElement('div');slice.className='slice';$('cube').append(slice);
    const spec=move&&{U:[1,1,'Y',-1],D:[1,-1,'Y',1],R:[0,1,'X',1],L:[0,-1,'X',-1],F:[2,1,'Z',1],B:[2,-1,'Z',-1]}[move[0]];
    for(let i=0;i<54;i++){const piece=document.createElement('div'),g=geometry(i);piece.className='sticker';piece.style.background=colors[stickers[i]];piece.style.transform=g.transform;(spec&&g.coords[spec[0]]===spec[1]?slice:$('cube')).append(piece);}
    if(spec){const angle=90*spec[3]*(move.endsWith('2')?2:move.endsWith("'")?-1:1);if(!matchMedia('(prefers-reduced-motion: reduce)').matches) slice.animate([{transform:'rotate'+spec[2]+'(0deg)'},{transform:'rotate'+spec[2]+'('+angle+'deg)'}],{duration:950,easing:'ease-in-out',fill:'forwards'});}
  }
  function render(next){state=next;clearTimeout(animationTimer);
    tiles.forEach((tile,i)=>{tile.style.background=colors[state.stickers[i]];tile.textContent=i%9===4?faces[Math.floor(i/9)]:'';tile.disabled=!online||i%9===4||['playing','computing'].includes(state.phase);tile.setAttribute('aria-label',`${faces[Math.floor(i/9)]} face, row ${Math.floor(i%9/3)+1}, column ${i%3+1}, ${names[state.stickers[i]]}${i%9===4?', fixed center':', click to change color'}`);});
    if(state.before&&Date.now()-state.animatedAt<1000){draw(state.before,state.move);animationTimer=setTimeout(()=>draw(state.stickers),1000);}else draw(state.stickers);
    $('counter').textContent=state.moves.length?`TURN ${state.step} / ${state.moves.length}`:'READY TO SOLVE';
    $('notation').textContent=state.step?state.moves[state.step-1]:'—';
    const move=state.moves[state.step-1],faceNames={U:'Top',R:'Right',F:'Front',D:'Bottom',L:'Left',B:'Back'};
    $('description').textContent=move?`${faceNames[move[0]]} face · ${move.endsWith('2')?'half turn (180°)':move.endsWith("'")?'counterclockwise (90°)':'clockwise (90°)'}`:'Your cube, in 3D.';
    $('sequence').replaceChildren(...state.moves.map((m,i)=>{const el=document.createElement('span');el.textContent=m;el.className=i===state.step-1?'current':i<state.step?'done':'';return el;}));
    $('status').textContent=online?state.message:'Connection lost. Reconnecting…';
    $('start').textContent=state.phase==='paused'?'RESUME →':state.phase==='computing'?'FINDING SOLUTION…':'START SOLVING →';
    $('start').disabled=!online||!['editing','paused'].includes(state.phase);$('pause').disabled=!online||state.phase!=='playing';
    $('next').disabled=!online||state.phase!=='paused'||state.step>=state.moves.length;$('back').disabled=!online||!['paused','complete'].includes(state.phase)||state.step===0;
    $('scramble').disabled=!online;header.update({resetDisabled:!online});
  }
  function send(type,extra={}){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type,...extra}));}
  ['start','scramble','pause','next','back'].forEach(id=>$(id).onclick=()=>send(id));
  $('left').onclick=()=>{$('cube').style.transform=`rotateX(-25deg) rotateY(${view-=90}deg)`;};$('right').onclick=()=>{$('cube').style.transform=`rotateX(-25deg) rotateY(${view+=90}deg)`;};
  let key=sessionStorage.getItem('arcade-client');if(!key){key=crypto.randomUUID();sessionStorage.setItem('arcade-client',key);}
  function connect(){socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/?room=cube&client=${encodeURIComponent(key)}`);socket.onopen=()=>{online=true;const name=sessionStorage.getItem('arcade-name');if(name)send('setName',{name});};socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='cubeState')render(m);if(m.type==='switchGame'&&m.path!==location.pathname)location.href=m.path;};socket.onclose=()=>{online=false;if(state)render(state);setTimeout(connect,1200);};}
  connect();
})();
