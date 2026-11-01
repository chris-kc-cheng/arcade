function sessionClient(){let id=sessionStorage.getItem('arcade-client');if(!id){id=crypto.randomUUID();sessionStorage.setItem('arcade-client',id)}return id}
const $=selector=>document.querySelector(selector),clientId=sessionClient(),LABELS={spelling:'SPELLING',homophone:'WRONG WORD',grammar:'GRAMMAR',agreement:'AGREEMENT',apostrophe:'APOSTROPHE',article:'A / AN',preposition:'PREPOSITION',tense:'VERB FORM',plural:'PLURAL',wordchoice:'WORD CHOICE'};
let celebrated=0,socket,state,clockOffset=0,roundKey='',buttons=[],reconnectTimer,reconnectDelay=500;
function send(message){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message))}
const me=()=>state?.players.find(player=>player.id===state.selfId);
const now=()=>Date.now()+clockOffset;
const clock=ms=>{const seconds=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`};
// Word buttons are created once per round so keyboard focus survives every state update.
function buildWords(){
  const key=`${state.round}|${state.tokens.length}`;if(key===roundKey)return;roundKey=key;
  buttons=state.tokens.map((token,index)=>{const button=document.createElement('button');button.type='button';button.className='word';button.dataset.index=index;button.textContent=token;button.tabIndex=index===0?0:-1;return button});
  $('#words').replaceChildren(...buttons.flatMap(button=>[button,document.createTextNode(' ')]));
}
// A wrong pick is never marked in the passage; only found (and, after the round, missed) words get a note.
function paintWords(){
  const active=state.phase==='hunting';
  buttons.forEach((button,index)=>{
    const hit=state.found[index],missed=state.missed.find(item=>item.index===index),info=hit||missed;
    button.classList.toggle('found',Boolean(hit));button.classList.toggle('mine',hit?.by===state.selfId);button.classList.toggle('missed',Boolean(missed));
    button.setAttribute('aria-disabled',String(!active||Boolean(info)));
    const word=document.createElement('span');word.textContent=state.tokens[index];if(info)word.className='was';button.replaceChildren(word);
    if(info){const note=document.createElement('small');note.textContent=`→ ${info.right} · ${LABELS[info.kind]||info.kind}`;button.append(note)}
    button.setAttribute('aria-label',info?`${state.tokens[index]}: ${hit?'found':'missed'}, should be ${info.right} (${LABELS[info.kind]||info.kind})`:`${state.tokens[index]}, word ${index+1} of ${state.tokens.length}`);
  });
}
const ordinal=n=>{const rest=n%100,suffix=['th','st','nd','rd'];return n+(suffix[(rest-20)%10]||suffix[rest]||suffix[0])};
function paintPlayers(){
  // The server sends the room already ranked; ties share a rank. Bars are scaled to the leader (at least 100 points).
  const top=Math.max(100,...state.players.map(player=>player.score));
  let rank=0,last=null;
  $('#players').replaceChildren(...state.players.map((player,index)=>{
    if(player.score!==last){rank=index+1;last=player.score}
    const self=player.id===state.selfId,row=document.createElement('li'),place=document.createElement('i'),name=document.createElement('b'),bar=document.createElement('em');
    row.classList.toggle('self',self);place.textContent=ordinal(rank);name.textContent=self?`${player.name} (you)`:player.name;
    bar.style.width=`${Math.max(0,player.score)/top*100}%`;bar.classList.toggle('negative',player.score<0);
    row.title=`${player.score} points · ${player.found} found · ${player.misses} wrong`;
    row.setAttribute('aria-label',`${ordinal(rank)}, ${player.name}, ${player.score} points`);row.append(bar,place,name);return row}));
  $('#spectators').textContent=state.spectators?`+ ${state.spectators} watching`:'';
}
// Every mistake found or missed, with the fix and why it was wrong.
function paintAnswers(){
  const rows=[...Object.entries(state.found).map(([index,info])=>({index:Number(index),info,found:true})),...state.missed.map(info=>({index:info.index,info,found:false}))].sort((a,b)=>a.index-b.index);
  $('#answers').hidden=!rows.length;
  $('#answerList').replaceChildren(...rows.map(({index,info,found})=>{
    const row=document.createElement('li'),line=document.createElement('p'),why=document.createElement('p');
    row.className=found?'got':'gave-up';
    line.innerHTML='<span class="wrong"></span> → <strong></strong> <em></em>';
    line.querySelector('.wrong').textContent=state.tokens[index];line.querySelector('strong').textContent=info.right;
    line.querySelector('em').textContent=`${LABELS[info.kind]||info.kind}${found?'':' · missed'}`;
    why.textContent=info.reason||'';row.append(line,why);return row}));
}
// Confetti for a clean finish: every mistake found, at least one of them by you, and no wrong click this round.
// It is drawn on a temporary canvas; with reduced motion only the banner is shown.
function celebrate(){
  const banner=document.createElement('div');banner.className='celebration';banner.setAttribute('aria-hidden','true');banner.innerHTML='<strong>PERFECT!</strong><span>Every mistake found, no wrong clicks</span>';document.body.append(banner);
  const done=()=>{banner.remove();canvas?.remove()};
  let canvas;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){setTimeout(done,2200);return}
  canvas=document.createElement('canvas');canvas.className='confetti';canvas.setAttribute('aria-hidden','true');canvas.width=innerWidth;canvas.height=innerHeight;document.body.append(canvas);
  const context=canvas.getContext('2d'),colors=['#b9f36b','#ffc857','#ff9b8c','#7fd6ff','#d9a7ff','#ffffff'];
  const pieces=Array.from({length:160},()=>({x:innerWidth/2+(Math.random()-.5)*innerWidth*.3,y:innerHeight*.35,vx:(Math.random()-.5)*16,vy:-Math.random()*14-4,size:6+Math.random()*8,turn:Math.random()*6,spin:(Math.random()-.5)*.4,color:colors[Math.floor(Math.random()*colors.length)]}));
  const start=performance.now();
  (function frame(time){
    const age=time-start;context.clearRect(0,0,canvas.width,canvas.height);
    for(const piece of pieces){piece.vy+=.35;piece.vx*=.99;piece.x+=piece.vx;piece.y+=piece.vy;piece.turn+=piece.spin;
      context.save();context.globalAlpha=Math.max(0,1-Math.max(0,age-1800)/700);context.translate(piece.x,piece.y);context.rotate(piece.turn);context.fillStyle=piece.color;context.fillRect(-piece.size/2,-piece.size/4,piece.size,piece.size/2);context.restore()}
    if(age<2500)requestAnimationFrame(frame);else done();
  })(start);
}
function setStatus(){
  const found=Object.keys(state.found).length;
  if(state.phase==='countdown')return;
  if(state.phase==='finished'){
    const leader=state.players[0];
    $('#status').textContent=`${found===state.total?'All mistakes found!':`Round over: ${found} of ${state.total} found.`} ${leader?`${leader.name} leads with ${leader.score}. `:''}Read the answers, then ask for the next question.`;
  }else if(state.role==='spectator')$('#status').textContent='The room is full — you are watching.';
  else $('#status').textContent=`Level ${state.level}: find ${state.total} mistake${state.total===1?'':'s'} before anyone else does.`;
}
function paintClock(){
  if(!state)return;
  let text='0:00',fraction=0;
  if(state.phase==='hunting'){const left=state.endsAt-now();text=clock(left);fraction=Math.max(0,left/(state.endsAt-state.startedAt))}
  else if(state.phase==='countdown'){fraction=1}
  $('#time').textContent=text;$('#timebar').style.width=`${fraction*100}%`;
  if(state.phase==='countdown')$('#status').textContent=`Get ready — ${Math.max(1,Math.ceil((state.countdownEndsAt-now())/1000))}`;
  if(state.phase==='finished')setStatus();
  const locked=state.phase==='hunting'&&(me()?.lockedUntil||0)>now();
  $('#huntPane').classList.toggle('locked',locked);
  if(locked)$('#status').textContent='Wrong word! −25 points. Hold on for a moment…';
  else if($('#status').textContent.startsWith('Wrong word'))setStatus();
}
function render(){
  const player=state.role==='player';
  document.body.classList.toggle('spectator',!player);
  buildWords();paintWords();paintPlayers();paintAnswers();
  $('#found').replaceChildren(document.createTextNode(Object.keys(state.found).length),Object.assign(document.createElement('small'),{textContent:` / ${state.total}`}));
  $('#reset').disabled=!player||socket?.readyState!==WebSocket.OPEN;
  document.querySelectorAll('[data-level]').forEach(button=>{const on=Number(button.dataset.level)===state.level;button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));button.disabled=!player});
  $('#skip').hidden=!(player&&state.phase==='hunting');$('#next').hidden=!(player&&state.phase==='finished');
  $('#words').hidden=state.phase==='countdown'||state.phase==='waiting';
  if(state.phase==='finished'&&celebrated!==state.round&&Object.keys(state.found).length===state.total){celebrated=state.round;const self=me();if(self&&self.roundFound>0&&self.roundMisses===0)celebrate()}
  setStatus();paintClock();
}
function connect(){
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/?room=typohunt&client=${encodeURIComponent(clientId)}`);
  socket.onopen=()=>{reconnectDelay=500;const name=sessionStorage.getItem('arcade-name');if(name)send({type:'setName',name})};
  socket.onclose=()=>{$('#reset').disabled=true;$('#status').textContent='Reconnecting…';clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,reconnectDelay);reconnectDelay=Math.min(5000,reconnectDelay*2)};
  socket.onmessage=event=>{
    let message;try{message=JSON.parse(event.data)}catch{return}
    if(message.type==='platformPresence'){renderArcadePresence(message.players);return}
    if(message.type==='switchGame'&&message.path!==location.pathname){location.assign(message.path);return}
    if(message.type==='typoState'){state=message;clockOffset=message.serverTime-Date.now();render()}
  };
}
$('#words').addEventListener('click',event=>{const button=event.target.closest('.word');if(!button||!state||state.phase!=='hunting'||state.role!=='player'||state.found[button.dataset.index])return;send({type:'pick',index:Number(button.dataset.index)})});
$('#words').addEventListener('keydown',event=>{
  const index=buttons.indexOf(document.activeElement);if(index<0)return;
  const target={ArrowRight:index+1,ArrowDown:index+1,ArrowLeft:index-1,ArrowUp:index-1,Home:0,End:buttons.length-1}[event.key];
  if(target===undefined)return;event.preventDefault();
  buttons[Math.max(0,Math.min(buttons.length-1,target))].focus();
});
$('#words').addEventListener('focusin',event=>{const index=buttons.indexOf(event.target);if(index>=0)buttons.forEach((button,i)=>{button.tabIndex=i===index?0:-1})});
document.querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>send({type:'level',level:Number(button.dataset.level)}));
$('#reset').onclick=()=>send({type:'reset'});
$('#skip').onclick=()=>send({type:'skip'});$('#next').onclick=()=>send({type:'next'});
setInterval(paintClock,150);
connect();
