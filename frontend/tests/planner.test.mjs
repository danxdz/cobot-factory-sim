import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createCobot } from '../babylon/cobot/createCobot.ts';
import { planToolpath, nextPlannedTarget } from '../babylon/cobot/planner.ts';
import { pickupAimPoint, pickupLeadTime } from '../babylon/cobot/pickupTargets.ts';
import { pointSegmentDistSq2D } from '../babylon/cobot/geometry.ts';
import { simState } from '../simState.ts';
import { tickCobot } from '../babylon/cobot/controller.ts';
import { activeCobotPath } from '../babylon/cobot/pathVisuals.ts';

function setup(t) {
  simState.reset();
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const { state } = createCobot({ id: 'path-test', type: 'cobot', position: [0, 0, 0], rotation: 0, config: {} }, new Scene(engine));
  state.obstacles = [];
  return state;
}

test('first simulation frame starts from the visible home pose without a tool jump', t => {
  const state = setup(t);
  state.gripperTip.computeWorldMatrix(true);
  const before = state.gripperTip.getAbsolutePosition().clone();
  tickCobot(state, 1 / 60, true);
  state.gripperTip.computeWorldMatrix(true);
  assert.ok(Vector3.Distance(before, state.gripperTip.getAbsolutePosition()) < 0.15);
});

test('active path excludes already visited waypoints and the future program preview', t => {
  const state = setup(t);
  state.plannedPath = [new Vector3(-2, 2, 0), new Vector3(1, 2, 0), new Vector3(2, 2, 0)];
  state.plannedPathCursor = 2;
  state.precalculatedPath = [new Vector3(100, 100, 100)];
  const path = activeCobotPath(state);
  assert.equal(path.length, 2);
  assert.deepEqual(path[1].asArray(), [2, 2, 0]);
});

test('front-to-back transport avoids the base yaw singularity, including with a payload', t => {
  const state = setup(t);
  const mount = new Vector3(0, 1, 0);
  for (const carrying of [false, true]) {
    state.phase = carrying ? 'transit_drop' : 'idle';
    state.grabbedItem = carrying ? { id: 'payload', shape: 'disc', size: 'medium', pos: new Vector3(), state: 'grabbed' } : null;
    const path = planToolpath(state, new Vector3(0, 2, -2), new Vector3(0, 2, 2), mount, false);
    for (let i = 1; i < path.length; i++) {
      const clearance = Math.sqrt(pointSegmentDistSq2D(0, 0, path[i - 1].x, path[i - 1].z, path[i].x, path[i].z));
      assert.ok(clearance >= 0.4, `tool path crosses the yaw axis: clearance=${clearance}, carrying=${carrying}`);
    }
  }
});

test('small conveyor drift does not restart completed approach waypoints', t => {
  const state = setup(t);
  state.phase = 'pick_hover';
  const mount = new Vector3(0, 1, 0);
  state.ikTarget.set(2, 2, -2);
  nextPlannedTarget(state, mount, new Vector3(2, 2, 2), false);
  state.plannedPathCursor = state.plannedPath.length - 1;
  state.ikTarget.set(2, 2, 1);
  const path = state.plannedPath;
  state.pathReplanCooldown = 0;
  const target = nextPlannedTarget(state, mount, new Vector3(2.06, 2, 2), false);
  assert.equal(state.plannedPath, path, 'retain the approach instead of rebuilding from each new position');
  assert.ok(Vector3.Distance(target, new Vector3(2.06, 2, 2)) < 1e-6);
});

test('pickup prediction applies measured belt velocity once and ignores old camera positions', t => {
  const state = setup(t);
  state.phase = 'pick_hover';
  state.simTime = 1;
  state.obstacles = [{ id: 'belt', type: 'belt', position: [0, 0, 2], rotation: 1, config: { speed: 1 } }];
  const item = { id: 'part', pos: new Vector3(0, 1.05, 2), state: 'free', shape: 'disc', size: 'medium', color: '#ef4444' };
  state.itemMotionTracker.set(item, { pos: item.pos.clone(), t: 1, vel: new Vector3(0.92, 0, 0) });
  const lead = pickupLeadTime(state, item);
  const expected = item.pos.add(new Vector3(0.92 * lead, 0, 0));
  assert.ok(Vector3.Distance(pickupAimPoint(state, item), expected) < 1e-6, 'do not add nominal belt motion to measured motion');
  state.cameras = [{ id: 'cam' }];
  simState.cameraDetections = [{ cameraId: 'cam', itemId: 'part', pos: new Vector3(-1, 1.05, 2), confidence: 1, planarOffset: 0, color: item.color, size: item.size }];
  assert.ok(Vector3.Distance(pickupAimPoint(state, item), expected) < 1e-6, 'old detections must not pull a live intercept backward');
});
