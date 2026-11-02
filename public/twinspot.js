function sessionClient(){let id=sessionStorage.getItem('arcade-client');if(!id){id=crypto.randomUUID();sessionStorage.setItem('arcade-client',id)}return id}
const $=selector=>document.querySelector(selector),clientId=sessionClient();
let socket,state,clockOffset=0,cardKeys=[],roundSeen=false,reconnectTimer,reconnectDelay=500;
function send(message){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message))}
const me=()=>state?.players.find(player=>player.id===state.selfId);
const now=()=>Date.now()+clockOffset;
const ordinal=n=>{const rest=n%100,suffix=['th','st','nd','rd'];return n+(suffix[(rest-20)%10]||suffix[rest]||suffix[0])};
// Items are placed in the unit circle by the server: x and y are fractions of the card radius, fs is the font size as a
// fraction of the card width, and rot is a random rotation. Buttons are built once per round so focus survives updates.
function buildCards(){
  // Only a card whose contents changed is rebuilt, so the card that stays on the table is left alone and the new one is dealt in.
  state.cards.forEach((items,card)=>{
    const key=JSON.stringify(items);if(cardKeys[card]===key)return;cardKeys[card]=key;
    const element=$(`#card${card}`);
    element.replaceChildren(...items.map((item,index)=>{
      const button=document.createElement('button');button.type='button';button.className=`item ${item.kind}`;button.dataset.card=card;button.dataset.item=index;
      button.style.left=`${50+item.x*50}%`;button.style.top=`${50+item.y*50}%`;button.style.fontSize=`${item.fs*100}cqw`;button.style.setProperty('--rot',`${item.rot}deg`);
      button.textContent=item.label;button.setAttribute('aria-label',item.kind==='word'?`the word ${item.name}`:item.name);return button}));
    fitCard(element);
    if(roundSeen)element.classList.remove('dealing'),void element.offsetWidth,element.classList.add('dealing');
  });
  if(!state.cards.length){cardKeys=[];$('#card0').replaceChildren();$('#card1').replaceChildren()}else roundSeen=true;
}
// Safety net: the server places items using typical font sizes, but a different emoji or text font can be wider. After a card is
// built, measure every item (its rotated box, using at most 1.2em of an emoji's width, since that is what is drawn) and shrink
// any item that comes within 3.5% of the circle's edge. Only shrinking, so no new overlaps appear.
function fitCard(element){
  const width=element.clientWidth,radius=width/2,limit=radius*0.965;
  if(!width)return;
  element.querySelectorAll('.item').forEach(button=>{
    for(let step=0;step<40;step++){
      const font=parseFloat(getComputedStyle(button).fontSize),angle=(parseFloat(button.style.getPropertyValue('--rot'))||0)*Math.PI/180;
      const w=button.classList.contains('emoji')?Math.min(button.offsetWidth,font*1.2):button.offsetWidth,h=button.offsetHeight;
      const cx=parseFloat(button.style.left)/100*width,cy=parseFloat(button.style.top)/100*width;let far=0;
      for(const[sx,sy]of[[-1,-1],[1,-1],[1,1],[-1,1]]){const dx=sx*w/2,dy=sy*h/2,x=cx+dx*Math.cos(angle)-dy*Math.sin(angle)-radius,y=cy+dx*Math.sin(angle)+dy*Math.cos(angle)-radius;far=Math.max(far,Math.hypot(x,y))}
      if(far<=limit)break;
      button.style.fontSize=`${parseFloat(button.style.fontSize)*0.95}cqw`;
    }
  });
}
function paintMatch(){
  document.querySelectorAll('.item').forEach(button=>button.classList.toggle('match',state.phase==='revealed'&&state.match?.[Number(button.dataset.card)]===Number(button.dataset.item)));
  document.querySelectorAll('.card').forEach(card=>card.classList.toggle('revealed',state.phase==='revealed'));
}
function paintPlayers(){
  // The server sends the room already ranked; ties share a rank. Bars are scaled to the leader (at least 100 points).
  const top=Math.max(100,...state.players.map(player=>player.score));
  let rank=0,last=null;
  $('#players').replaceChildren(...state.players.map((player,index)=>{
    if(player.score!==last){rank=index+1;last=player.score}
    const self=player.id===state.selfId,row=document.createElement('li'),place=document.createElement('i'),name=document.createElement('b'),bar=document.createElement('em');
    row.classList.toggle('self',self);place.textContent=ordinal(rank);name.textContent=self?`${player.name} (you)`:player.name;
    bar.style.width=`${Math.max(0,player.score)/top*100}%`;bar.classList.toggle('negative',player.score<0);
    row.title=`${player.score} points · ${player.found} spotted · ${player.misses} wrong`;
    row.setAttribute('aria-label',`${ordinal(rank)}, ${player.name}, ${player.score} points`);row.append(bar,place,name);return row}));
  $('#spectators').textContent=state.spectators?`+ ${state.spectators} watching`:'';
}
function setStatus(){
  const locked=state.phase==='playing'&&(me()?.lockedUntil||0)>now();
  if(locked){$('#status').textContent='Wrong! −25 points. Hold on for a moment…';return}
  if(state.phase==='revealed'){const winner=state.players.find(player=>player.id===state.winner);
    $('#status').textContent=state.winner?`${winner?winner.name:'Someone'}${state.winner===state.selfId?' (you)':''} spotted it! Next pair coming up…`:'Skipped: here is the match. Next pair coming up…';return}
  if(state.phase==='playing')$('#status').textContent=state.role==='spectator'?'The room is full — you are watching.':'Find the one symbol that is on both cards. Click either copy.';
  else $('#status').textContent='Waiting for players…';
}
function render(){
  const player=state.role==='player';
  document.body.classList.toggle('spectator',!player);
  buildCards();paintMatch();paintPlayers();setStatus();
  $('#reset').disabled=!player||socket?.readyState!==WebSocket.OPEN;
  $('#skip').hidden=!(player&&state.phase==='playing');
  document.querySelectorAll('[data-level]').forEach(button=>{const on=button.dataset.level===state.level;button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));button.disabled=!player});
  $('#card0').parentElement.classList.toggle('locked',state.phase==='playing'&&(me()?.lockedUntil||0)>now());
}
document.fonts?.ready.then(()=>document.querySelectorAll('.card').forEach(fitCard));
function connect(){
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/?room=twinspot&client=${encodeURIComponent(clientId)}`);
  socket.onopen=()=>{reconnectDelay=500;const name=sessionStorage.getItem('arcade-name');if(name)send({type:'setName',name})};
  socket.onclose=()=>{$('#reset').disabled=true;$('#status').textContent='Reconnecting…';clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,reconnectDelay);reconnectDelay=Math.min(5000,reconnectDelay*2)};
  socket.onmessage=event=>{
    let message;try{message=JSON.parse(event.data)}catch{return}
    if(message.type==='platformPresence'){renderArcadePresence(message.players);return}
    if(message.type==='switchGame'&&message.path!==location.pathname){location.assign(message.path);return}
    if(message.type==='twinState'){state=message;clockOffset=message.serverTime-Date.now();render()}
  };
}
document.querySelector('.cards').addEventListener('click',event=>{const button=event.target.closest('.item');if(!button||!state||state.phase!=='playing'||state.role!=='player')return;send({type:'pick',card:Number(button.dataset.card),item:Number(button.dataset.item)})});
document.querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>send({type:'level',level:button.dataset.level}));
$('#reset').onclick=()=>send({type:'reset'});$('#skip').onclick=()=>send({type:'skip'});
setInterval(()=>{if(state){setStatus();$('.cards').classList.toggle('locked',state.phase==='playing'&&(me()?.lockedUntil||0)>now())}},150);
connect();
