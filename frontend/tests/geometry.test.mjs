import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createTable, createPile, createReceiver } from '../babylon/entityMeshes.ts';
import { machineTopY, machineWallY, itemFootprintHit } from '../babylon/cobot/geometry.ts';

for (const [type, create, surfaceName] of [['table', createTable, 'top'], ['pile', createPile, 'floor'], ['receiver', createReceiver, 'base']]) {
  test(`${type} support height agrees with its elevated mesh`, t => {
    const engine = new NullEngine();
    t.after(() => engine.dispose());
    const scene = new Scene(engine);
    const item = { id: 'test', type, position: [3, 0.4, 2], rotation: 1, config: {} };
    const node = create(item, scene);
    const surface = node.getChildMeshes().find(mesh => mesh.name === surfaceName);
    surface.computeWorldMatrix(true);
    assert.ok(Math.abs(surface.getBoundingInfo().boundingBox.maximumWorld.y - machineTopY(item)) < 0.00001);
    if (type === 'pile') {
      const wall = node.getChildMeshes().find(mesh => mesh.name === 'wallN');
      wall.computeWorldMatrix(true);
      assert.ok(Math.abs(wall.getBoundingInfo().boundingBox.maximumWorld.y - machineWallY(item)) < 0.00001);
    }
  });
}

test('rotated rectangular table mesh agrees with its support footprint', t => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const item = { id: 'test', type: 'table', position: [0, 0, 0], rotation: 1, config: { tableSize: [3, 1] } };
  const node = createTable(item, new Scene(engine));
  const top = node.getChildMeshes().find(mesh => mesh.name === 'top');
  top.computeWorldMatrix(true);
  const bounds = top.getBoundingInfo().boundingBox;
  assert.ok(Math.abs(bounds.maximumWorld.x - 0.5) < 0.00001);
  assert.ok(Math.abs(bounds.maximumWorld.z - 1.5) < 0.00001);
  assert.equal(itemFootprintHit(item, 0, 1.4, 0), true);
  assert.equal(itemFootprintHit(item, 1.4, 0, 0), false);
});
