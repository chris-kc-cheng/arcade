'use strict';
const SIZES = [{name:'S', volume:1, points:100}, {name:'M',volume:1.4,points:140}, {name:'L',volume:1.8,points:180}, {name:'XL',volume:2.2,points:220}];
function cleanSlushyAction(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'start' || value.type === 'reset') return {type:value.type};
  if (value.type === 'pour' && Number.isInteger(value.lane) && value.lane >= 0 && value.lane < 4 && typeof value.down === 'boolean') return {type:'pour',lane:value.lane,down:value.down};
  return null;
}
function newShift() { return {phase:'ready', remaining:60000, score:0, served:0, spills:0, cleaning:0, cups:[null,null,null,null], held:[0,0,0,0], next:0, message:'Ready for the rush?'}; }
function slots(game) { return game.served < 3 ? 1 : game.served < 7 ? 2 : game.served < 12 ? 3 : 4; }
function restock(game) {
  const count=slots(game);
  while(game.cups.filter(Boolean).length < count) {
    const lane=game.next++ % 4;
    if (!game.cups[lane]) game.cups[lane]={...SIZES[Math.floor(Math.random()*4)],fill:0};
  }
}
function start(game) { Object.assign(game,newShift(),{phase:'playing',message:'Hold a lever. Release at the rim to serve.'});restock(game); }
function action(game, input, now) {
  if(input.type === 'start' || input.type === 'reset') {start(game);return;}
  if(game.phase !== 'playing' || !game.cups[input.lane]) return;
  game.held[input.lane]=input.down ? now : 0;
  const cup=game.cups[input.lane];
  if(!input.down && cup.fill >= 1) {
    const bonus=Math.round(Math.max(0,cup.fill-1)*500);
    game.score+=cup.points+bonus;game.served++;
    game.message=`Served ${cup.name}! +${cup.points+bonus}${bonus ? ' · dome bonus!' : ''}`;
    game.cups[input.lane]=null;restock(game);
  }
}
function tick(game, ms, now) {
  if(game.phase === 'cleaning') {
    game.cleaning=Math.max(0,game.cleaning-ms);
    if(!game.cleaning) {game.phase='playing';game.message='Sparkling clean. Back to the rush!';restock(game);}
    return;
  }
  if(game.phase !== 'playing') return;
  const dt=Math.min(ms,game.remaining);game.remaining-=dt;
  for(let lane=0;lane<4;lane++) {
    const cup=game.cups[lane];
    if(cup && game.held[lane] && now-game.held[lane]<600) {
      cup.fill+=dt/1200/cup.volume;
      if(cup.fill>1.24) {
        game.phase='cleaning';game.cleaning=1800;game.spills++;game.spillLane=lane;
        game.cups[lane]=null;game.held.fill(0);game.message='Oops! Clock paused while we wipe up.';break;
      }
    }
  }
  if(!game.remaining) {game.phase='finished';game.held.fill(0);game.message='Shift complete. One more for the road?';}
}
module.exports={cleanSlushyAction,newShift,slots,restock,start,action,tick};
