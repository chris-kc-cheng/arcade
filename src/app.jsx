import React, {useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {mountTankRenderer} from './tank-renderer.js';
import {PenaltyScene,Scorebug} from './penalty-view.jsx';

// React single-page arcade entry.

const ROUTES={'/':'board','/tank':'tank','/penalty':'penalty','/fighter':'fighter','/snake':'snake','/bigtwo':'bigtwo'};
let platformId=sessionStorage.getItem('arcade-client')||crypto.randomUUID();
sessionStorage.setItem('arcade-client',platformId);

function useStylesheet(href){useEffect(()=>{const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.reactStyle='true';document.head.append(link);return()=>link.remove();},[href]);}
function useRoom(room,onMessage,onSwitch){
  const [online,setOnline]=useState(false),socketRef=useRef(),messageRef=useRef(onMessage),switchRef=useRef(onSwitch);
  messageRef.current=onMessage;switchRef.current=onSwitch;
  useEffect(()=>{let stopped=false,timer;
    function connect(){const protocol=location.protocol==='https:'?'wss':'ws',socket=new WebSocket(`${protocol}://${location.host}?room=${room}&client=${encodeURIComponent(platformId)}`);socketRef.current=socket;
      socket.onopen=()=>{setOnline(true);const name=sessionStorage.getItem('arcade-name');if(name)socket.send(JSON.stringify({type:'setName',name}));};
      socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.clientId){platformId=message.clientId;sessionStorage.setItem('arcade-client',platformId);}if(message.type==='switchGame')switchRef.current(message.path);else if(message.type!=='platformPresence') messageRef.current(message);};
      socket.onclose=()=>{setOnline(false);if(!stopped)timer=setTimeout(connect,1200);};
    }connect();return()=>{stopped=true;clearTimeout(timer);socketRef.current?.close();};
  },[room]);
  const send=useCallback(message=>{if(socketRef.current?.readyState===WebSocket.OPEN)socketRef.current.send(JSON.stringify(message));},[]);
  return {online,send};
}
// The platform owns the exact same header DOM and behavior for React and legacy games.
function SharedHeader({game,onReset,resetLabel='RESET',resetDisabled=false,roomCount}){
  const header=useRef(),controller=useRef();
  useEffect(()=>{controller.current=window.ArcadePlatform.mount(header.current,{game});return()=>controller.current?.destroy();},[game]);
  useEffect(()=>{controller.current?.update({onReset,resetLabel,resetDisabled,roomCount});},[onReset,resetLabel,resetDisabled,roomCount]);
  return <header ref={header} className="arcade-topbar" data-arcade-game={game}/>;
}

function Board({onSwitch}){
  useStylesheet('/styles.css');
  const canvasRef=useRef(),strokesRef=useRef([]),drawing=useRef(false),previous=useRef(),toastTimer=useRef(),[self,setSelf]=useState(),[users,setUsers]=useState([]),[chats,setChats]=useState([]),[tool,setTool]=useState('pen'),[size,setSize]=useState(4),[cursors,setCursors]=useState({}),[toast,setToast]=useState('');
  const drawStroke=useCallback(stroke=>{const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext('2d'),rect=canvas.getBoundingClientRect();ctx.beginPath();ctx.moveTo(stroke.from.x*rect.width,stroke.from.y*rect.height);ctx.lineTo(stroke.to.x*rect.width,stroke.to.y*rect.height);ctx.lineWidth=stroke.size;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalCompositeOperation=stroke.tool==='eraser'?'destination-out':'source-over';ctx.strokeStyle=stroke.color;ctx.stroke();ctx.globalCompositeOperation='source-over';},[]);
  const redraw=useCallback(()=>{const canvas=canvasRef.current;if(!canvas)return;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);strokesRef.current.forEach(drawStroke);},[drawStroke]);
  const {online,send}=useRoom('doodle',message=>{
    if(message.type==='welcome'){setSelf(message.self);setUsers(message.users);setCursors({});strokesRef.current=message.history;setChats(message.chatHistory||[]);requestAnimationFrame(redraw);}
    if(message.type==='stroke'){strokesRef.current.push(message);drawStroke(message);}
    if(message.type==='presence'||message.type==='left'){setUsers(message.users);const active=new Set(message.users.map(user=>user.id));setCursors(value=>Object.fromEntries(Object.entries(value).filter(([id])=>active.has(id))));}
    if(message.type==='cursor')setCursors(value=>({...value,[message.userId]:message.point}));
    if(message.type==='clear'){strokesRef.current=[];redraw();setToast(`${message.by} cleared the board`);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),2200);}
    if(message.type==='chat')setChats(value=>[...value.slice(-99),message]);
  },onSwitch);
  useEffect(()=>()=>clearTimeout(toastTimer.current),[]);
  useEffect(()=>{const canvas=canvasRef.current;function resize(){const rect=canvas.getBoundingClientRect(),scale=devicePixelRatio||1;canvas.width=Math.round(rect.width*scale);canvas.height=Math.round(rect.height*scale);canvas.getContext('2d').setTransform(scale,0,0,scale,0,0);redraw();}const observer=new ResizeObserver(resize);observer.observe(canvas);resize();return()=>observer.disconnect();},[redraw]);
  const point=event=>{const rect=canvasRef.current.getBoundingClientRect();return{x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};};
  function start(event){canvasRef.current.setPointerCapture(event.pointerId);drawing.current=true;previous.current=point(event);send({type:'activity',drawing:true,tool});}
  function move(event){const next=point(event);send({type:'cursor',point:next});if(!drawing.current)return;const stroke={type:'stroke',userId:self?.id,from:previous.current,to:next,size,tool,color:self?.color||'#222'};strokesRef.current.push(stroke);drawStroke(stroke);send(stroke);previous.current=next;}
  function stop(){if(!drawing.current)return;drawing.current=false;send({type:'activity',drawing:false,tool});}
  function submit(event){event.preventDefault();const input=event.currentTarget.elements.message,text=input.value.trim();if(text){send({type:'chat',text});input.value='';}}
  return <div className="board-page"><SharedHeader game="board" roomCount={users.length} resetLabel="CLEAR BOARD" resetDisabled={!online} onReset={()=>{if(confirm('Clear the board for everyone?'))send({type:'clear'});}}/><main><section className="workspace">
    <aside className="tools"><button className={`tool ${tool==='pen'?'active':''}`} onClick={()=>setTool('pen')}><span>✎</span><small>Pen</small></button><button className={`tool ${tool==='eraser'?'active':''}`} onClick={()=>setTool('eraser')}><span>◇</span><small>Eraser</small></button><label className="size-control"><small>Size</small><input type="range" min="1" max="24" value={size} onChange={e=>setSize(Number(e.target.value))}/></label></aside>
    <div className="board-wrap"><canvas ref={canvasRef} id="board" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}/><div className="cursors">{Object.entries(cursors).map(([id,p])=>{const user=users.find(item=>item.id===id);return user&&<div key={id} className="remote-cursor" style={{left:`${p.x*100}%`,top:`${p.y*100}%`,'--cursor':user.color}}><span>{user.name}</span></div>;})}</div></div>
    <div className="side-column"><aside className="people-panel"><div className="people-heading"><span>In the room</span><span className="count">{users.length}</span></div><div className="people">{users.map(user=><div key={user.id} className={`person ${user.id===self?.id?'me':''}`}><span className="avatar" style={{background:user.color}}>{user.name.replace('User ','')}</span><span><strong>{user.name}{user.id===self?.id?' (you)':''}</strong><small className={user.drawing?'drawing':''}>{user.drawing?`Drawing with ${user.tool}`:'Watching the canvas'}</small></span></div>)}</div></aside>
    <section className="chat-panel"><div className="chat-heading"><span>Room chat</span><span>LIVE</span></div><div className="chat-messages">{chats.map(chat=><article key={chat.id} className={`chat-message ${chat.userId===self?.id?'mine':''}`} style={{'--chat-color':chat.color}}><strong>{chat.name}</strong><p>{chat.text}</p></article>)}</div><form className="chat-form" onSubmit={submit}><input name="message" maxLength="240" autoComplete="off" placeholder="Message everyone…"/><button>↑</button></form></section></div>
  </section></main>{toast&&<div className="toast show">{toast}</div>}</div>;
}

function Penalty({onSwitch}){
  useStylesheet('/penalty.css');
  const[state,setState]=useState(),[selected,setSelected]=useState();
  const{online,send}=useRoom('penalty',message=>{if(message.type==='penaltyState'){setState(message);const index=message.players.findIndex(player=>player.id===message.selfId);if(message.game.phase!=='choosing'||!message.game.choices[index])setSelected();}},onSwitch);
  const game=state?.game,players=state?.players||[],selfIndex=players.findIndex(p=>p.id===state?.selfId),isKicker=selfIndex===game?.kicker,player=state?.role==='player';
  const canAim=player&&game?.phase==='choosing'&&!selected,role=isKicker?'kicker':'keeper',winner=game?.winner,score=i=>(game?.kicks[i]||[]).filter(Boolean).length;
  const heading=!game||game.phase==='waiting'?'WAITING FOR PLAYER 2':game.phase==='finished'?`${players[winner]?.name||'TEAM'} WINS THE SHOOT-OUT ${Math.max(score(0),score(1))}–${Math.min(score(0),score(1))}`:game.phase==='result'?game.message:selected?'LOCKED IN — WAITING FOR THE OTHER PLAYER':isKicker?'PICK YOUR CORNER':'PICK A SIDE TO DIVE';
  return <div className="penalty-page"><SharedHeader game="penalty" resetLabel="RESET MATCH" resetDisabled={!online||!player} onReset={()=>{if(confirm('Reset the penalty shootout score for everyone?'))send({type:'penaltyReset'});}}/>
    <main><div className="stage"><PenaltyScene game={game} selected={selected} canAim={canAim} role={role} onAim={zone=>{setSelected(zone);send({type:'penaltyChoose',zone});}}/><Scorebug players={players} game={game}/></div>
      <section className="control-panel" aria-live="polite"><p>{state?.role==='spectator'?'SPECTATING':`YOU ARE ${players[selfIndex]?.name||'A PLAYER'} · ${isKicker?'TAKING THE PENALTY':'IN GOAL'}`}</p><h2>{heading}</h2><p>{state?.role==='spectator'?'The first two players own this match. You are watching live.':game?.phase==='finished'?'Press RESET MATCH for another shoot-out.':'Click a zone of the goal (or press Enter on it). The kick is taken when both players have chosen. In the shoot-out tracker, O is a goal and X is a save.'}</p></section></main></div>}


function Tank({onSwitch}){
  useStylesheet('/tank.css');
  const canvas=useRef(),minimap=useRef(),stateRef=useRef({players:[],bullets:[],obstacles:[]}),selfRef=useRef(),keys=useRef(new Set()),aim=useRef({x:0,y:0}),[scores,setScores]=useState([]),[alive,setAlive]=useState(true);
  const{online,send}=useRoom('tanks',message=>{if(message.type==='tankWelcome')selfRef.current=message.selfId;if(message.type==='tankState'){stateRef.current=message;setScores(message.players);const me=message.players.find(p=>p.id===selfRef.current);setAlive(me?.alive!==false);}},onSwitch);
  useEffect(()=>mountTankRenderer({canvas:canvas.current,minimap:minimap.current,stateRef,selfRef,keys,aim,send}),[send]);
  const me=scores.find(player=>player.id===selfRef.current);
  return <div className="tank-page"><canvas ref={canvas} id="game"/><SharedHeader game="tank" resetLabel="RESET MATCH" resetDisabled={!online||!me} onReset={()=>{if(confirm('Reset all Tank scores and redeploy everyone?'))send({type:'tankReset'});}}/><section className="scoreboard"><div className="score-head"><span>PILOT</span><span>KILLS</span></div>{scores.map(p=><div key={p.id} className={`score-row ${p.id===selfRef.current?'me':''}`}><span><i className="dot" style={{'--tank-color':p.color}}/>{p.name}</span><span>{p.score}</span></div>)}</section><aside className="map-panel"><div className="map-head"><span>TACTICAL MAP</span><b>240 × 240</b></div><canvas ref={minimap} id="minimap" width="240" height="240"/><div className="map-key"><span><i className="key-you"/>YOU</span><span><i className="key-tank"/>TANK</span><span><i className="key-cover"/>COVER</span></div></aside><div className="reticle"><i/></div><div className="controls"><span><kbd>MOUSE BOX</kbd> DRIVE</span><span><kbd>WASD</kbd> BACKUP</span><span><kbd>CLICK</kbd> FIRE</span></div>{!alive&&<div className="respawn show"><strong>DESTROYED</strong></div>}</div>;
}

function App(){useStylesheet('/platform.css');const[path,setPath]=useState(location.pathname);useEffect(()=>{const pop=()=>setPath(location.pathname);addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop);},[]);const navigate=useCallback(next=>{const normalized=next==='/index.html'?'/':next;if(normalized==='/slushy'||normalized==='/typohunt'||normalized==='/twinspot'||normalized==='/flight'||normalized==='/cube'||normalized==='/fighter'||normalized==='/snake'||normalized==='/bigtwo'||normalized==='/typing'||normalized==='/wordle'||normalized==='/poll'){if(location.pathname!==normalized)location.assign(normalized);return;}if(location.pathname!==normalized){history.pushState({},'',normalized);setPath(normalized);}},[]);const route=ROUTES[path]||'board';useEffect(()=>{document.title=route==='board'?'Board':route==='tank'?'Tank':'Penalty Shootout';},[route]);return route==='tank'?<Tank onSwitch={navigate}/>:route==='penalty'?<Penalty onSwitch={navigate}/>:<Board onSwitch={navigate}/>;}
createRoot(document.getElementById('root')).render(<App/>);

