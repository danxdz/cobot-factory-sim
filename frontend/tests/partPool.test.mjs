import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPartPool, remapPartChannel } from '../babylon/partPool.ts';

test('consuming earlier parts preserves a held part mesh, visibility and physics in the same frame', () => {
  const items = [{state:'dead'}, {state:'grabbed'}, {state:'dead'}, {state:'free'}];
  const retired = {isVisible:false}, held = {isVisible:true}, consumed = {isVisible:true};
  const free = {isVisible:true}, spare = {isVisible:false};
  const meshes = [retired, held, consumed, free, spare];
  const kinds = ['red-disc', 'blue-box', 'yellow-can', 'green-pyramid', 'red-can'];
  const velocity = {x:0.7, z:0};
  const planar = new Map([[0,{x:99,z:0}], [1,{x:0,z:0}], [3,velocity]]);
  const vertical = new Map([[1,0], [3,-0.5]]);
  const spin = new Map([[3,1.2]]);
  const compacted = compactPartPool(items, meshes, kinds);
  for (const channel of [planar, vertical, spin]) remapPartChannel(channel, compacted.survivorIndices);
  assert.deepEqual(compacted.items, [items[1],items[3]]);
  assert.equal(meshes[0], held);
  assert.equal(meshes[0].isVisible, true);
  assert.equal(meshes[1], free);
  assert.deepEqual(kinds, ['blue-box','green-pyramid','red-disc','yellow-can','red-can']);
  assert.deepEqual(meshes.slice(2), [retired,consumed,spare]);
  assert.equal(planar.get(1), velocity);
  assert.deepEqual([...vertical], [[0,0],[1,-0.5]]);
  assert.deepEqual([...spin], [[1,1.2]]);
});

test('an empty live pool retains reusable meshes without stale velocities', () => {
  const meshes = [{isVisible:false}];
  const kinds = ['disc'];
  const velocity = new Map([[0,3]]);
  const compacted = compactPartPool([{state:'dead'}], meshes, kinds);
  remapPartChannel(velocity, compacted.survivorIndices);
  assert.deepEqual(compacted.items, []);
  assert.equal(meshes.length, 1);
  assert.deepEqual(kinds, ['disc']);
  assert.equal(velocity.size, 0);
  const next = {state:'free'};
  assert.deepEqual(compactPartPool([next], meshes, kinds).items, [next]);
  assert.equal(meshes.length, 1);
});
