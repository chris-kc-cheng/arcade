import React, {useEffect, useMemo, useState} from 'react';
import {FIFA, project, pitchMarkings, stripes, goal, zoneTargets, zonePolygon, ballAt, spot, view} from './penalty-scene.mjs';

// Presentation of the penalty shootout: a broadcast-style view from behind the penalty mark with the real FIFA markings, a goal with
// a net, a goalkeeper and a kicker, and a World Cup style shoot-out tracker where O is a goal and X is a save.

export const zones = ['top-left', 'center', 'top-right', 'bottom-left', 'bottom-right'];
export const zoneLabel = zone => zone.replace('-', ' ');

// One kit per side: outfield colours for the taker and the goalkeeper's own colours when that side is in goal.
export const kits = [
  {shirt: '#d62828', shirtDark: '#9d1c1c', shorts: '#fafafa', socks: '#d62828', number: 9, keeper: '#f4c20d', keeperDark: '#c79a00', name: 'RED'},
  {shirt: '#1d5fd1', shirtDark: '#14418f', shorts: '#0b2a6b', socks: '#1d5fd1', number: 10, keeper: '#35d07f', keeperDark: '#1f9d5c', name: 'BLUE'}
];
const SKIN = '#c58b5e', HAIR = '#1c1511';

const MARKINGS = pitchMarkings(), STRIPES = stripes(), GOAL = goal();
// The taker waits to the left of the ball, runs in at an angle, plants his foot beside it, and then walks clear of the goal.
const KEEPER_Z = 0.45, KICKER_START = [-3.0, 14.4], KICKER_PLANT = [-0.6, 11.8], KICKER_EXIT = [-3.5, 13.4];
const FIGURE_KEEPER = 1.85, FIGURE_KICKER = 1.82;

// World position in metres to an SVG point.
const at = (x, y, z) => project(x, y, z);

// ---- the players -----------------------------------------------------------------------------------------------------------
// Figures are drawn in metres with the feet at (0, 0) and up as negative y, then scaled to the pixels per metre at their spot.
function Keeper({kit, diving, zone}) {
  const up = diving && (zone === 'center' || zone.startsWith('top'));
  const arm = side => up
    ? {elbow: [side * 0.2, -1.8], hand: [side * 0.18, -2.12]}
    : diving ? {elbow: [side * 0.55, -1.38], hand: [side * 0.85, -1.2]} : {elbow: [side * 0.47, -1.22], hand: [side * 0.66, -0.98]};
  const shoulder = side => [side * 0.23, -1.47];
  return <g>
    <ellipse cx="0" cy="0" rx="0.42" ry="0.08" fill="#0a2410" opacity="0.35"/>
    {[-1, 1].map(side => <g key={side}>
      <path d={`M${side * 0.1} -0.88 L${side * 0.17} -0.5 L${side * (diving ? 0.3 : 0.2)} -0.08`} stroke="#14161b" strokeWidth="0.13" strokeLinecap="round" fill="none"/>
      <ellipse cx={side * (diving ? 0.33 : 0.22)} cy="-0.05" rx="0.12" ry="0.055" fill="#0e0f12"/>
    </g>)}
    <path d="M-0.23 -1.0 H0.23 L0.26 -0.72 H-0.26 Z" fill="#14161b"/>
    <path d="M-0.24 -1.5 Q0 -1.58 0.24 -1.5 L0.21 -0.97 H-0.21 Z" fill={kit.keeper}/>
    <path d="M-0.24 -1.5 Q0 -1.58 0.24 -1.5 L0.2 -1.3 Q0 -1.24 -0.2 -1.3 Z" fill={kit.keeperDark} opacity="0.55"/>
    {[-1, 1].map(side => {
      const s = shoulder(side), {elbow, hand} = arm(side);
      return <g key={side}>
        <path d={`M${s[0]} ${s[1]} L${elbow[0]} ${elbow[1]}`} stroke={kit.keeper} strokeWidth="0.13" strokeLinecap="round"/>
        <path d={`M${elbow[0]} ${elbow[1]} L${hand[0]} ${hand[1]}`} stroke={SKIN} strokeWidth="0.085" strokeLinecap="round"/>
        <circle cx={hand[0]} cy={hand[1]} r="0.105" fill="#f6f6ef" stroke="#2a2d33" strokeWidth="0.018"/>
        <path d={`M${hand[0] - 0.05} ${hand[1]} h0.1`} stroke="#9aa0a6" strokeWidth="0.014"/>
      </g>;
    })}
    <rect x="-0.045" y="-1.6" width="0.09" height="0.09" fill={SKIN}/>
    <circle cx="0" cy="-1.69" r="0.115" fill={SKIN}/>
    <path d="M-0.12 -1.7 Q-0.1 -1.84 0 -1.82 Q0.11 -1.84 0.12 -1.7 Q0.05 -1.76 0 -1.75 Q-0.07 -1.76 -0.12 -1.7Z" fill={HAIR}/>
    <circle cx="-0.04" cy="-1.69" r="0.011" fill="#2b2118"/><circle cx="0.04" cy="-1.69" r="0.011" fill="#2b2118"/>
    <text x="0" y="-1.15" textAnchor="middle" fontSize="0.19" fontWeight="800" fill="#1b1b1b" fontFamily="Inter,sans-serif">1</text>
  </g>;
}

// The taker seen from behind: back of the shirt with a number, short hair, shorts, long socks and boots.
function Kicker({kit}) {
  return <g>
    <ellipse cx="0" cy="0" rx="0.45" ry="0.08" fill="#0a2410" opacity="0.35"/>
    <g className="plant-leg">
      <path d="M-0.12 -0.85 L-0.13 -0.46 L-0.14 -0.08" stroke={kit.socks} strokeWidth="0.125" strokeLinecap="round" fill="none"/>
      <path d="M-0.12 -0.85 L-0.125 -0.58" stroke={SKIN} strokeWidth="0.13" strokeLinecap="round"/>
      <ellipse cx="-0.14" cy="-0.045" rx="0.115" ry="0.055" fill="#101114"/>
    </g>
    <g className="kick-leg">
      <path d="M0.12 -0.85 L0.13 -0.46 L0.14 -0.08" stroke={kit.socks} strokeWidth="0.125" strokeLinecap="round" fill="none"/>
      <path d="M0.12 -0.85 L0.125 -0.58" stroke={SKIN} strokeWidth="0.13" strokeLinecap="round"/>
      <ellipse cx="0.14" cy="-0.045" rx="0.115" ry="0.055" fill="#101114"/>
    </g>
    <path d="M-0.22 -1.0 H0.22 L0.25 -0.7 H-0.25 Z" fill={kit.shorts} stroke="#00000022" strokeWidth="0.01"/>
    <path d="M-0.26 -1.46 Q0 -1.54 0.26 -1.46 L0.22 -0.95 H-0.22 Z" fill={kit.shirt}/>
    <path d="M-0.26 -1.46 Q0 -1.54 0.26 -1.46 L0.235 -1.34 Q0 -1.28 -0.235 -1.34 Z" fill={kit.shirtDark} opacity="0.5"/>
    <text x="0" y="-1.1" textAnchor="middle" fontSize="0.3" fontWeight="900" fill="#fff" fontFamily="Inter,sans-serif">{kit.number}</text>
    <text x="0" y="-1.28" textAnchor="middle" fontSize="0.07" fontWeight="800" fill="#ffffffcc" fontFamily="Inter,sans-serif" letterSpacing="0.02">{kit.name}</text>
    {[-1, 1].map(side => <g key={side} className={side < 0 ? 'arm-left' : 'arm-right'}>
      <path d={`M${side * 0.27} -1.44 L${side * 0.36} -1.18`} stroke={kit.shirt} strokeWidth="0.115" strokeLinecap="round"/>
      <path d={`M${side * 0.36} -1.18 L${side * 0.4} -0.93`} stroke={SKIN} strokeWidth="0.08" strokeLinecap="round"/>
      <circle cx={side * 0.4} cy="-0.9" r="0.05" fill={SKIN}/>
    </g>)}
    <rect x="-0.045" y="-1.57" width="0.09" height="0.1" fill={SKIN}/>
    <circle cx="0" cy="-1.67" r="0.115" fill={SKIN}/>
    <path d="M-0.12 -1.66 Q-0.13 -1.83 0 -1.82 Q0.13 -1.83 0.12 -1.66 Q0.1 -1.57 0 -1.56 Q-0.1 -1.57 -0.12 -1.66Z" fill={HAIR}/>
  </g>;
}

// A size-5 ball: white with the black panels of a World Cup ball. `r` is its radius in pixels.
function Ball({x, y, r, spin = 0}) {
  const pentagon = Array.from({length: 5}, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; return `${(Math.cos(a) * r * 0.42).toFixed(2)},${(Math.sin(a) * r * 0.42).toFixed(2)}`; }).join(' ');
  const spokes = Array.from({length: 5}, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; return <path key={i} d={`M${(Math.cos(a) * r * 0.42).toFixed(2)} ${(Math.sin(a) * r * 0.42).toFixed(2)} L${(Math.cos(a) * r * 0.98).toFixed(2)} ${(Math.sin(a) * r * 0.98).toFixed(2)}`} stroke="#1b1f27" strokeWidth={Math.max(0.5, r * 0.07)} fill="none"/>; });
  return <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${spin.toFixed(0)})`}>
    <circle r={r} fill="url(#ballShade)" stroke="#2b3038" strokeWidth={Math.max(0.5, r * 0.06)}/>
    <polygon points={pentagon} fill="#171b22"/>{spokes}
    <circle r={r} fill="url(#ballGloss)"/>
  </g>;
}

// ---- timing of one kick ----------------------------------------------------------------------------------------------------
const RUN_UP = 450, FLIGHT = 420, SETTLE = 1700;
// Milliseconds since this result arrived, driven by animation frames. Reduced motion jumps straight to the end of the kick.
function useKickClock(round) {
  const [ms, setMs] = useState(null);
  useEffect(() => {
    if (round == null) { setMs(null); return undefined; }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setMs(SETTLE); return undefined; }
    const start = performance.now();
    let frame;
    const tick = now => { const elapsed = Math.min(SETTLE, now - start); setMs(elapsed); if (elapsed < SETTLE) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [round]);
  return ms;
}
const ease = t => 1 - (1 - t) * (1 - t);

// Where the ball is, in world metres, for a kick: along the ground from the mark, then into the net (a goal) or off the keeper (a save).
function ballPosition(result, ms) {
  const start = {x: 0, y: FIFA.ballDiameter / 2, z: FIFA.penaltyMark};
  if (!result || ms == null || ms < RUN_UP) return start;
  const [tx, ty] = zoneTargets[result.target];
  if (ms < RUN_UP + FLIGHT) return ballAt(result.target, ease((ms - RUN_UP) / FLIGHT));
  const u = Math.min(1, (ms - RUN_UP - FLIGHT) / 520), side = tx === 0 ? 1 : Math.sign(tx);
  if (result.goal) return {x: tx * (1 + 0.04 * u), y: Math.max(FIFA.ballDiameter / 2, ty * (1 - u * u)), z: -1.3 * ease(u)};
  // Saved: the keeper turns it away, and it bounces back out towards the edge of the area.
  return {x: tx + side * 2.2 * u, y: FIFA.ballDiameter / 2 + Math.abs(Math.sin(u * Math.PI * 1.6)) * 0.9 * (1 - u) + (1 - u) * (ty - FIFA.ballDiameter / 2) * 0.6, z: 3.2 * ease(u)};
}

// ---- the scene -------------------------------------------------------------------------------------------------------------
export function PenaltyScene({game, selected, canAim, role, onAim}) {
  const result = game?.result, round = result ? game.kicks[0].length + game.kicks[1].length : null;
  const ms = useKickClock(round);
  const kicker = result ? result.kicker : game?.kicker ?? 0, keeperSide = 1 - kicker;
  const kitK = kits[kicker], kitG = kits[keeperSide];
  const diving = Boolean(result) && ms != null && ms >= RUN_UP;
  const stage = !result ? 0 : ms == null ? 0 : ms;

  // Positions.
  const keeperFeet = at(0, 0, KEEPER_Z), keeperScale = keeperFeet.scale;
  const centerOfKeeper = at(0, 0.95, KEEPER_Z);
  const dive = result && diving ? (() => { const [tx, ty] = zoneTargets[result.dive], to = at(tx * 0.92, ty, KEEPER_Z); const lateral = Math.sign(tx);
    const angle = tx === 0 ? 0 : lateral * (ty > 1 ? 52 : 78);
    return {dx: to.x - centerOfKeeper.x, dy: to.y - centerOfKeeper.y + (tx === 0 ? 0 : 0), angle}; })() : {dx: 0, dy: 0, angle: 0};
  const runT = !result ? 0 : Math.min(1, stage / RUN_UP), swing = result && stage >= RUN_UP - 80 ? Math.min(1, (stage - (RUN_UP - 80)) / 320) : 0;
  const leave = result ? ease(Math.min(1, Math.max(0, (stage - RUN_UP - 280) / 700))) : 0;
  const lerp = (from, to, t) => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  const kickerWorld = lerp(lerp(KICKER_START, KICKER_PLANT, ease(runT)), KICKER_EXIT, leave);
  const kickerFeet = at(kickerWorld[0], 0, kickerWorld[1]);
  const ball = ballPosition(result, stage), ballPoint = at(ball.x, ball.y, ball.z), ballRadius = Math.max(2.5, FIFA.ballDiameter / 2 * ballPoint.scale);
  const ballShadow = at(ball.x, 0, ball.z);
  const outcomeShown = Boolean(result) && stage >= RUN_UP + FLIGHT;

  // Players can be seen aiming through these transparent zones laid over the goal mouth.
  const aimZones = zones.map(zone => <polygon key={zone} className={`zone ${selected === zone ? 'chosen' : ''} ${canAim ? 'live' : ''}`} points={zonePolygon(zone)} role="button" tabIndex={canAim ? 0 : -1} aria-disabled={!canAim}
    aria-label={`${role === 'keeper' ? 'Dive' : 'Aim'} ${zoneLabel(zone)}`} onClick={() => canAim && onAim(zone)} onKeyDown={event => { if (canAim && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onAim(zone); } }}/>);
  const zoneLabels = canAim ? zones.map(zone => { const [tx, ty] = zoneTargets[zone], p = at(tx, ty, 0); return <text key={zone} className="zone-label" x={p.x} y={p.y} textAnchor="middle">{zoneLabel(zone).toUpperCase()}</text>; }) : null;

  return <svg className="scene" viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Penalty area seen from behind the penalty mark, with the goalkeeper on the goal line">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#050a1d"/><stop offset="1" stopColor="#14214a"/></linearGradient>
      <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1f6a2a"/><stop offset="1" stopColor="#2f8a36"/></linearGradient>
      <radialGradient id="ballShade" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stopColor="#ffffff"/><stop offset="0.6" stopColor="#e9ebe6"/><stop offset="1" stopColor="#a9afaa"/></radialGradient>
      <radialGradient id="ballGloss" cx="0.32" cy="0.25" r="0.5"><stop offset="0" stopColor="#ffffff" stopOpacity="0.7"/><stop offset="1" stopColor="#ffffff" stopOpacity="0"/></radialGradient>
      <pattern id="crowd" width="14" height="10" patternUnits="userSpaceOnUse"><rect width="14" height="10" fill="#0d1634"/><circle cx="3" cy="3" r="2" fill="#c5472f"/><circle cx="10" cy="4" r="2" fill="#e5c24a"/><circle cx="6" cy="8" r="2" fill="#3a6fd0"/><circle cx="12" cy="9" r="1.4" fill="#d8dce8"/></pattern>
      <linearGradient id="crowdFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#050a1d" stopOpacity="0.85"/><stop offset="1" stopColor="#050a1d" stopOpacity="0.2"/></linearGradient>
      <radialGradient id="floodlight" cx="0.5" cy="0" r="0.8"><stop offset="0" stopColor="#ffffff" stopOpacity="0.16"/><stop offset="1" stopColor="#ffffff" stopOpacity="0"/></radialGradient>
    </defs>
    <rect width={view.width} height={view.height} fill="url(#sky)"/>
    {/* The stand and the advertising boards behind the goal. */}
    <rect x="0" y="0" width={view.width} height="128" fill="url(#crowd)"/><rect x="0" y="0" width={view.width} height="128" fill="url(#crowdFade)"/>
    <polygon points={`${at(-45, 0, -6).x},${at(-45, 0, -6).y} ${at(45, 0, -6).x},${at(45, 0, -6).y} ${at(45, 1.05, -6).x},${at(45, 1.05, -6).y} ${at(-45, 1.05, -6).x},${at(-45, 1.05, -6).y}`} fill="#0b1b3f"/>
    {[-24, -16, -8, 0, 8, 16, 24].map(x => { const a = at(x - 3.6, 0.15, -6), b = at(x + 3.6, 0.92, -6); return <g key={x}><rect x={a.x} y={b.y} width={b.x - a.x} height={a.y - b.y} fill="#f2f4ff"/><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 3} textAnchor="middle" fontSize={(a.y - b.y) * 0.4} fontWeight="900" fill="#0b1b3f" fontFamily="Inter,sans-serif" letterSpacing="1">ARCADE CUP</text></g>; })}
    {/* Grass: a darker apron behind the goal line, then mown bands in front of it. */}
    <polygon points={`${at(-45, 0, -6).x},${at(-45, 0, -6).y} ${at(45, 0, -6).x},${at(45, 0, -6).y} ${at(45, 0, 0).x},${at(45, 0, 0).y} ${at(-45, 0, 0).x},${at(-45, 0, 0).y}`} fill="#1a5a25"/>
    <rect x="0" y={at(0, 0, 0).y} width={view.width} height={view.height} fill="#2a7d32"/>
    {STRIPES.map((band, i) => <polygon key={i} points={band.points} fill={band.dark ? '#2a7d32' : '#33903b'}/>)}
    {/* The markings, to the Laws of the Game. */}
    <g fill="#f7f8f4" opacity="0.96">
      {Object.entries(MARKINGS.polygons).map(([name, points]) => <polygon key={name} className={`marking ${name}`} points={points}/>)}
    </g>
    <rect x="0" y="0" width={view.width} height={view.height} fill="url(#floodlight)"/>
    {/* The net behind the keeper, then the keeper, then the posts. */}
    <g className="net" stroke="#f1f5ee" fill="none" strokeLinecap="round">
      <g opacity="0.2" strokeWidth="0.8">{GOAL.net.roof.map((l, i) => <polyline key={i} points={l.join(' ')}/>)}{GOAL.net.sides.map((l, i) => <polyline key={`s${i}`} points={l.join(' ')}/>)}</g>
      <g opacity="0.42" strokeWidth="0.9">{GOAL.net.back.map((l, i) => <polyline key={i} points={l.join(' ')}/>)}</g>
    </g>
    <g transform={`translate(${keeperFeet.x} ${keeperFeet.y})`}>
      <g className={`keeper ${diving ? 'diving' : 'ready'}`} style={{transform: `translate(${dive.dx}px, ${dive.dy}px) rotate(${dive.angle}deg)`, transformOrigin: `0px ${-0.95 * keeperScale}px`}}>
        <g transform={`scale(${keeperScale})`}><Keeper kit={kitG} diving={diving} zone={result?.dive || 'center'}/></g>
      </g>
    </g>
    <g className="frame" fill="#fbfcf7" stroke="#bfc6bd" strokeWidth="0.6">{GOAL.frame.map((points, i) => <polygon key={i} points={points}/>)}</g>
    {/* The shadow and ball. */}
    <ellipse cx={ballShadow.x} cy={ballShadow.y} rx={ballRadius * 1.1} ry={ballRadius * 0.4} fill="#0a2410" opacity="0.35"/>
    <g transform={`translate(${kickerFeet.x} ${kickerFeet.y})`}>
      <g className={`kicker ${result ? 'kicking' : ''}`} style={{'--swing': swing}}>
        <g transform={`scale(${kickerFeet.scale})`}><Kicker kit={kitK}/></g>
      </g>
    </g>
    <Ball x={ballPoint.x} y={ballPoint.y} r={ballRadius} spin={result ? stage * 0.9 : 0}/>
    {outcomeShown && <g className="outcome" aria-hidden="true">
      <rect x="270" y="296" width="460" height="80" rx="14" fill={result.goal ? '#12803a' : '#c8281e'} opacity="0.94"/>
      <text x="500" y="357" textAnchor="middle" fontSize="56" fontWeight="900" fill="#fff" fontFamily="Inter,sans-serif" letterSpacing="3">{result.goal ? 'GOAL!' : 'SAVED!'}</text>
    </g>}
    <g className="zones">{aimZones}</g>
    {zoneLabels}
  </svg>;
}

// ---- the shoot-out tracker -------------------------------------------------------------------------------------------------
// A kick is `true` for a goal (O) and `false` for a save (X). Five kicks each, then sudden death adds one slot at a time.
export function Scorebug({players, game}) {
  const kicks = game?.kicks || [[], []], taken = kicks.map(list => list.length), scores = kicks.map(list => list.filter(Boolean).length);
  const slots = Math.max(5, ...taken.map(count => count + (count === Math.max(...taken) && game?.phase === 'choosing' ? 1 : 0)));
  const suddenDeath = taken[0] >= 5 && taken[1] >= 5 && scores[0] === scores[1];
  const rows = [0, 1].map(side => {
    const list = kicks[side], current = game?.phase === 'choosing' && game.kicker === side ? list.length : -1;
    return <li key={side} className={`row team-${side} ${game?.kicker === side && game?.phase !== 'finished' ? 'kicking' : ''} ${game?.winner === side ? 'winner' : ''}`}>
      <i className="tab" style={{background: kits[side].shirt}}/>
      <b className="name">{players[side]?.name || `PLAYER ${side + 1}`}</b>
      <ol className="marks" aria-label={`${players[side]?.name || `Player ${side + 1}`} penalties`}>
        {Array.from({length: slots}, (_, i) => {
          const value = list[i], label = value === true ? 'goal' : value === false ? 'saved' : i === current ? 'to take' : 'not taken';
          return <li key={i} className={`mark ${value === true ? 'goal' : value === false ? 'save' : ''} ${i === current ? 'now' : ''} ${i >= 5 ? 'extra' : ''}`} aria-label={`Kick ${i + 1}: ${label}`}>{value === true ? 'O' : value === false ? 'X' : ''}</li>;
        })}
      </ol>
      <strong className="goals">{scores[side]}</strong>
    </li>;
  });
  return <aside className="scorebug" aria-label="Penalty shoot-out score">
    <header><span>PENALTY SHOOT-OUT</span><em>{game?.phase === 'finished' ? 'FULL TIME' : suddenDeath ? 'SUDDEN DEATH' : 'BEST OF 5'}</em></header>
    <ul>{rows}</ul>
  </aside>;
}
