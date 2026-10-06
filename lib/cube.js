const Cube = require('cubejs');
const faces = 'URFDLB';
const solved = [...faces].map(f => f.repeat(9)).join('');
const parity = a => a.reduce((p, v, i) => p + a.slice(i + 1).filter(w => w < v).length, 0) % 2;
function validate(stickers) {
  if (typeof stickers !== 'string' || stickers.length !== 54 || [...faces].some((f, i) => [...stickers].filter(c => c === f).length !== 9 || stickers[i * 9 + 4] !== f)) return false;
  const cube = Cube.fromString(stickers);
  return cube.asString() === stickers && new Set(cube.cp).size === 8 && new Set(cube.ep).size === 12 && cube.co.reduce((a,b)=>a+b,0)%3 === 0 && cube.eo.reduce((a,b)=>a+b,0)%2 === 0 && parity(cube.cp) === parity(cube.ep);
}
function cleanAction(a) {
  if (!a || typeof a !== 'object') return null;
  if (['start','reset','scramble','pause','next','back'].includes(a.type)) return {type:a.type};
  if (a.type === 'paint' && Number.isInteger(a.index) && a.index >= 0 && a.index < 54 && a.index % 9 !== 4 && Number.isInteger(a.revision)) return {type:'paint',index:a.index,revision:a.revision};
  return null;
}
module.exports = {Cube, faces, solved, validate, cleanAction};
