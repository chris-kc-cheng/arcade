const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPoint, cleanFighterInput } = require('../lib/protocol');

test('cleanPoint accepts and clamps normalized coordinates', () => {
  assert.deepEqual(cleanPoint({ x: -2, y: 3 }), { x: 0, y: 1 });
  assert.deepEqual(cleanPoint({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 });
});

test('cleanFighterInput normalizes controls to booleans', () => {
  assert.deepEqual(cleanFighterInput({ left: 1, right: 0, punch: 'yes' }), {
    left: true, right: false, down: false, jump: false, punch: true, kick: false
  });
});

test('cleanPoint rejects malformed coordinates', () => {
  assert.equal(cleanPoint(null), null);
  assert.equal(cleanPoint({ x: '0.5', y: 0.5 }), null);
});

const { cleanBigTwoAction } = require('../lib/protocol');
const { classify, beats } = require('../lib/bigtwo');
test('Big Two messages accept only unique valid cards',()=>{
 assert.deepEqual(cleanBigTwoAction({type:'play',cards:['3D','3S']}),{type:'play',cards:['3D','3S']});
 assert.equal(cleanBigTwoAction({type:'play',cards:['2S','2S']}),null);
 assert.equal(cleanBigTwoAction({type:'play',cards:['XX']}),null);
 assert.equal(cleanBigTwoAction({type:'cheat'}),null);
});
test('Big Two combinations rank 2 high and five-card categories',()=>{
 assert.equal(classify(['4D','4S']).kind,'pair');
 assert.equal(classify(['3D','4D','5D','6D','7D']).kind,'straight flush');
 assert.equal(beats(['2D'],{cards:['AS']}),true);
 assert.equal(beats(['3D','3C','3H','4D','4C'],{cards:['3S','5S','7S','9S','JS']}),true);
});
