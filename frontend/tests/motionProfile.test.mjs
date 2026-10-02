import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '@babylonjs/core';
import { integrateToolVelocity, responseBlend } from '../babylon/cobot/motionProfile.ts';

test('velocity and distance agree across frame rates for the same motion command', () => {
  const simulate = fps => {
    const velocity = Vector3.Zero();
    const position = Vector3.Zero();
    for (let frame = 0; frame < fps; frame++) {
      position.addInPlace(integrateToolVelocity(velocity, new Vector3(3, 1, -2), 1 / fps, 5.5, 2.975));
    }
    return { velocity, position };
  };
  const baseline = simulate(60);
  for (const fps of [8, 15, 30, 144]) {
    const actual = simulate(fps);
    assert.ok(Vector3.Distance(actual.position, baseline.position) < 1e-10, `distance at ${fps} Hz`);
    assert.ok(Vector3.Distance(actual.velocity, baseline.velocity) < 1e-10, `velocity at ${fps} Hz`);
  }
});

test('direction reversal changes velocity continuously instead of snapping', () => {
  const velocity = new Vector3(2, 0, 0);
  integrateToolVelocity(velocity, new Vector3(-2, 0, 0), 1 / 60, 5.5, 2.975);
  assert.ok(velocity.x > 0 && velocity.x < 2);
  for (let i = 0; i < 60; i++) integrateToolVelocity(velocity, new Vector3(-2, 0, 0), 1 / 60, 5.5, 2.975);
  assert.ok(velocity.x < 0 && velocity.x > -2);
});

test('slow-frame wrist response approaches the target without overshoot', () => {
  let angle = 0;
  for (const delta of [1 / 60, 0.125, 0.5, 1]) {
    const previous = angle;
    angle += (Math.PI - angle) * responseBlend(18, delta);
    assert.ok(angle >= previous && angle <= Math.PI);
  }
});
