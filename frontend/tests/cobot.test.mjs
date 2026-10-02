import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createCobot, tickCobot } from '../babylon/cobotMesh.ts';
import { partHalfHeight } from '../babylon/cobot/partGeometry.ts';
import { simState } from '../simState.ts';
import { factoryStore } from '../store.ts';
import { syncCobotConfig, disposeCobotState, resetCobotRun } from '../babylon/cobot/lifecycle.ts';
import { currentDropTarget } from '../babylon/cobot/dropTargets.ts';
import { reserveDropTarget, releaseDropReservation } from '../babylon/cobot/reservations.ts';
import { updateCobotPath } from '../babylon/cobot/pathVisuals.ts';
const defaultLayout = structuredClone(factoryStore.getState().placedItems);

function setup(t, { offset = 0, shape = 'disc', collisions = true, belt = false } = {}) {
  for (const state of simState.cobotStates.values()) disposeCobotState(state);
  simState.reset();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  t.after(() => engine.dispose());
  const source = { id: 'source', type: belt ? 'belt' : 'table', position: [0, 0, 2.5], rotation: 1,
    config: { tableHeight: 1, beltHeight: 1, speed: 0.5 } };
  const dest = { id: 'dest', type: 'table', position: [2.5, 0, 0], rotation: 0, config: { tableHeight: 1 } };
  const self = { id: 'test', type: 'cobot', position: [0, 0, 0], rotation: 2,
    config: { cobotCollisionEnabled: collisions, program: [
      { action: 'pick', pos: [0, 1, 2.5] },
      { action: 'drop', pos: [2.5, 1, 0], sortColor: false, sortSize: false, sortShape: false },
    ] } };
  factoryStore.setState({ placedItems: [self, source, dest] });
  const { state } = createCobot(self, scene);
  simState.cobotStates.set(self.id, state);
  state.obstacles = [source, dest];
  const part = { id: 'part', shape, size: 'medium', color: '#ef4444', pos: new Vector3(offset, 0, 2.5), rotY: 0, state: 'free' };
  part.pos.y = 1 + partHalfHeight(part);
  simState.items = [part];
  return { state, part };
}

function runUntil(state, predicate, beforeTick = () => {}, seconds = 45) {
  for (let i = 0; i < seconds * 60; i++) {
    beforeTick();
    tickCobot(state, 1 / 60, true);
    if (predicate()) return;
  }
  assert.fail(`Timed out in ${state.phase}: ${JSON.stringify({ik:state.ikTarget.asArray(), tip:state.gripperTip.getAbsolutePosition().asArray(), desired:state.desiredTarget.asArray(), drop:state.lockedDropTarget?.asArray(),mount:state.basePivot.getAbsolutePosition().asArray(), flow:state.lockedFlowGoal.asArray(), path:state.plannedPath.map(p=>p.asArray()),cursor:state.plannedPathCursor})}`);
}

for (const [id, shape] of ['c1', 'c2'].flatMap(id => ['disc', 'can', 'box', 'pyramid'].map(shape => [id, shape]))) {
  test(`${id} transfers a ${shape} from the front belt to the rear station in the default layout`, t => {
    for (const existing of simState.cobotStates.values()) disposeCobotState(existing);
    simState.reset();
    const engine = new NullEngine();
    t.after(() => engine.dispose());
    const scene = new Scene(engine);
    const layout = structuredClone(defaultLayout);
    factoryStore.setState({placedItems:layout});
    const self = layout.find(item => item.id === id);
    const {state} = createCobot(self,scene);
    state.obstacles = layout.filter(item => item.id !== id && item.type !== 'camera');
    state.cameras = [];
    simState.cobotStates.set(id,state);
    const pick = self.config.program[0].pos;
    const part = {id:'default-part',shape,size:'medium',color:'#ef4444',pos:new Vector3(pick[0],1.0125,pick[2]),rotY:0,state:'free'};
    simState.items.push(part);
    // Reproduce the browser's state immediately after a successful belt pickup.
    state.grabbedItem = part;
    part.state = 'grabbed';
    state.phase = 'pick_recenter';
    state.ikTarget.set(pick[0] + 0.4, 1.14, pick[2]);
    state.desiredTarget.copyFrom(state.ikTarget);
    runUntil(state,()=>state.lastDroppedItemId===part.id);
    assert.equal(part.state,'free');
    assert.ok(part.pos.z > 3.7,'part must reach the rear station');
  });
}

test('path overlay resizes for new routes and is disposed with the robot', t => {
  const { state } = setup(t);
  state.selfItem.config.cobotShowPath = true;
  const old = state.pathLine;
  state.plannedPath = [new Vector3(0, 2, 0), new Vector3(1, 2, 1), new Vector3(2, 2, 0)];
  state.plannedPathCursor = 0;
  updateCobotPath(state);
  assert.equal(state.pathLine.getTotalVertices(), 4);
  assert.equal(old.isDisposed(), true);
  const sameSize = state.pathLine;
  updateCobotPath(state);
  assert.equal(state.pathLine, sameSize);
  state.plannedPath = [];
  updateCobotPath(state);
  assert.equal(state.pathLine.getTotalVertices(), 2);
  const finalLine = state.pathLine;
  disposeCobotState(state);
  assert.equal(finalLine.isDisposed(), true);
});

for (const shape of ['disc', 'can', 'box', 'pyramid']) {
  test(`picks and places an offset ${shape} with collision checks`, t => {
    const { state, part } = setup(t, { offset: 0.8, shape });
    const phases = {};
    runUntil(state, () => state.phase === 'drop_recenter', () => {
      phases[state.phase] = (phases[state.phase] ?? 0) + 1;
      if (state.phase === 'descend_drop') {
        const tip = state.gripperTip.getAbsolutePosition();
        assert.ok(Math.hypot(tip.x - 2.5, tip.z) < 0.2, 'descent must start over the destination');
      }
    });
    assert.equal(part.state, 'free');
    assert.ok(Vector3.Distance(part.pos, new Vector3(2.5, 1 + partHalfHeight(part), 0)) < 0.001);
    assert.equal(state.lastDroppedItemId, part.id);
    assert.ok(state.simTime < 8, 'an unobstructed cycle must not crawl through repeated collision replans');
    t.diagnostic(`cycle time: ${state.simTime.toFixed(2)} simulated seconds`);
    t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(phases).map(([phase, frames]) => [phase, +(frames / 60).toFixed(2)]))));
  });
}

for (const type of ['receiver', 'indexed_receiver']) {
  test(`places a part on ${type} without retrying above the landing surface`, t => {
    const { state, part } = setup(t);
    const destination = state.obstacles.find(item => item.id === 'dest');
    destination.type = type;
    destination.config = { machineHeight: 0.538 };
    state.program[1] = { action: 'drop', pos: [2.5, 0.538, 0] };
    runUntil(state, () => state.lastDroppedItemId === part.id);
    assert.equal(part.state, 'free');
    assert.ok(Math.abs(part.pos.y - 0.538 - partHalfHeight(part)) < 0.001);
    assert.ok(Math.hypot(part.pos.x - 2.5, part.pos.z) < 0.001);
  });
}

test('picks and sorts onto its own platform', t => {
  const { state, part } = setup(t);
  state.program[1] = { action: 'drop', pos: [0, 0.6, 0] };
  runUntil(state, () => state.lastDroppedItemId === part.id);
  assert.equal(part.state, 'free');
  assert.ok(Math.abs(part.pos.x) < 1.1 && Math.abs(part.pos.z) < 1.1);
  t.diagnostic(`own platform cycle: ${state.simTime.toFixed(2)} simulated seconds`);
});

test('waits with its payload when another robot owns the destination, then resumes', t => {
  const { state, part } = setup(t);
  runUntil(state, () => state.phase === 'transit_drop');
  simState.dropReservations.other = { position: new Vector3(2.5, 1, 0), radius: 0.4 };
  for (let frame = 0; frame < 120; frame++) tickCobot(state, 1 / 60, true);
  assert.equal(state.grabbedItem, part);
  assert.equal(part.state, 'grabbed');
  assert.equal(state.phase, 'transit_drop');
  assert.equal(state.gripperOpen, false);
  delete simState.dropReservations.other;
  runUntil(state, () => state.lastDroppedItemId === part.id);
  assert.ok(Math.hypot(part.pos.x - 2.5, part.pos.z) < 0.001);
});

test('stopping and restarting retains registered controllers and completes a new cycle', t => {
  const { state, part } = setup(t);
  runUntil(state, () => state.grabbedItem === part);
  resetCobotRun(state);
  simState.reset();
  assert.equal(simState.cobotStates.get('test'), state);
  assert.equal(state.grabbedItem, null);
  assert.equal(state.targetedItem, null);
  assert.equal(state.phase, 'idle');
  assert.equal(simState.items.length, 0);
  const nextPart = { ...part, id: 'next-run', pos: new Vector3(0, 1 + partHalfHeight(part), 2.5), state: 'free' };
  simState.items.push(nextPart);
  for (let frame = 0; frame < 45 * 60 && state.lastDroppedItemId !== nextPart.id; frame++) {
    for (const registered of simState.cobotStates.values()) tickCobot(registered, 1 / 60, true);
  }
  assert.equal(state.lastDroppedItemId, nextPart.id);
});

test('pause preserves an acquired part and resumes the same pickup', t => {
  const { state, part } = setup(t);
  runUntil(state, () => state.phase === 'pick_descend');
  const simTime = state.simTime;
  for (let i = 0; i < 120; i++) tickCobot(state, 1 / 60, false);
  assert.equal(state.phase, 'pick_descend');
  assert.equal(state.simTime, simTime);
  assert.equal(state.targetedItem, part);
  runUntil(state, () => state.phase === 'drop_recenter');
});

test('executes taught move and wait steps between pickup and drop', t => {
  const { state, part } = setup(t);
  const waypoint = [1.3, 2, 1.3];
  state.program = [state.program[0], { action: 'move', pos: waypoint },
    { action: 'wait', duration: 0.6 }, state.program[1]];
  let visitedMove = false;
  let waitFrames = 0;
  runUntil(state, () => state.lastDroppedItemId === part.id, () => {
    if (state.stepIndex === 1 && state.phase === 'next') {
      visitedMove = true;
      assert.ok(Vector3.Distance(state.gripperTip.getAbsolutePosition(), new Vector3(...waypoint)) < 0.12);
    }
    if (state.stepIndex === 2 && state.phase === 'wait_step') {
      waitFrames++;
      assert.equal(state.grabbedItem, part);
      assert.equal(state.gripperOpen, false);
    }
  });
  assert.equal(visitedMove, true, 'pickup must not skip taught waypoints');
  assert.ok(waitFrames >= 36, 'the programmed wait must run with the payload held');
});

for (const fps of [8, 15, 30]) {
  test(`completes pickup/drop with ${fps} Hz controller updates`, t => {
    const { state, part } = setup(t, { offset: 0.8 });
    for (let frame = 0; frame < 20 * fps && state.lastDroppedItemId !== part.id; frame++) tickCobot(state, 1 / fps, true);
    assert.equal(state.lastDroppedItemId, part.id);
    assert.ok(Vector3.Distance(part.pos, new Vector3(2.5, 1 + partHalfHeight(part), 0)) < 0.001);
  });
}

for (const showWalls of [false, true]) {
  test(`places into an elevated pile with walls ${showWalls ? 'enabled' : 'disabled'}`, t => {
    const { state, part } = setup(t);
    const destination = state.obstacles.find(item => item.id === 'dest');
    destination.type = 'pile';
    destination.position[1] = 0.2;
    destination.config = { showWalls };
    runUntil(state, () => state.lastDroppedItemId === part.id);
    assert.ok(Math.abs(part.pos.y - (0.2 + 0.72 + partHalfHeight(part))) < 0.001);
    assert.ok(Math.hypot(part.pos.x - 2.5, part.pos.z) < 0.001);
  });
}

test('generated auto-organize work survives scene configuration synchronization', t => {
  const { state, part } = setup(t);
  const items = factoryStore.getState().placedItems;
  items[1].config.acceptColor = 'any';
  items[1].config.acceptSize = 'any';
  items[2].config.acceptColor = part.color;
  items[2].config.acceptSize = 'any';
  state.selfItem.config.program = [];
  state.selfItem.config.autoOrganize = true;
  syncCobotConfig(state, state.selfItem);
  runUntil(state, () => state.isAutoProgram === true, () => syncCobotConfig(state, state.selfItem));
  const generated = state.program;
  syncCobotConfig(state, state.selfItem);
  assert.equal(state.program, generated);
  runUntil(state, () => state.phase === 'drop_recenter', () => syncCobotConfig(state, state.selfItem));
  assert.equal(part.state, 'free');
});

test('deleting a robot releases targeted and carried parts and its drop claim', t => {
  const { state, part } = setup(t);
  const held = { ...part, id: 'held', pos: part.pos.clone(), state: 'grabbed' };
  simState.items.push(held);
  state.targetedItem = part;
  part.state = 'targeted';
  state.grabbedItem = held;
  reserveDropTarget(state, new Vector3(2.5, 1, 0));
  disposeCobotState(state);
  assert.equal(part.state, 'free');
  assert.equal(held.state, 'free');
  assert.equal(simState.cobotStates.has('test'), false);
  assert.equal(simState.dropReservations.test, undefined);
});

test('editing a program releases its pickup reservation without discarding a payload', t => {
  const { state, part } = setup(t);
  tickCobot(state, 1 / 60, true);
  const replacement = { ...state.selfItem, config: { ...state.selfItem.config, program: [{ action: 'wait', duration: 1 }] } };
  syncCobotConfig(state, replacement);
  assert.equal(part.state, 'free');
  assert.equal(state.phase, 'idle');
  assert.equal(state.stepIndex, 0);
  part.state = 'grabbed'; state.grabbedItem = part;
  syncCobotConfig(state, { ...replacement, config: { ...replacement.config, triggerUnlock: 123 } });
  assert.equal(state.grabbedItem, part);
  assert.equal(part.state, 'grabbed');
});

test('two robots cannot claim the same destination until the first releases it', t => {
  const { state, part } = setup(t);
  state.phase = 'transit_drop'; state.stepIndex = 1;
  state.grabbedItem = part; part.state = 'grabbed';
  const self2 = { ...state.selfItem, id: 'second', position: [5, 0, 0] };
  const second = createCobot(self2, state.root.getScene()).state;
  second.obstacles = state.obstacles;
  second.grabbedItem = { ...part, id: 'second-part', pos: new Vector3(5, 2, 0) };
  second.phase = 'transit_drop'; second.stepIndex = 1;
  simState.items.push(second.grabbedItem);
  simState.cobotStates.set(self2.id, second);
  assert.ok(currentDropTarget(state));
  assert.equal(currentDropTarget(second), null);
  assert.equal(second.grabbedItem.state, 'grabbed');
  releaseDropReservation(state);
  assert.ok(currentDropTarget(second));
});

test('safety recovery actually moves and retains its payload', t => {
  const { state, part } = setup(t, { collisions: true });
  state.obstacles = [];
  state.ikTarget.set(0.2, 2.2, 2);
  state.lastSafeIkTarget.set(0.2, 2.4, 2);
  state.grabbedItem = part; part.state = 'grabbed';
  state.safetyStopped = true;
  const previous = state.ikTarget.clone();
  tickCobot(state, 1 / 60, true);
  assert.ok(Vector3.Distance(previous, state.ikTarget) > 0);
  assert.equal(state.phase, 'recovery');
  assert.equal(state.grabbedItem, part);
  assert.equal(state.safetyStopped, true);
  runUntil(state, () => !state.safetyStopped);
  assert.equal(state.phase, 'idle');
});

test('completes a second pick/drop cycle and stacks the next part', t => {
  const { state, part } = setup(t);
  runUntil(state, () => state.phase === 'drop_recenter');
  const firstHeight = part.pos.y;
  const next = { ...part, id: 'next', pos: new Vector3(0, 1 + partHalfHeight(part), 2.5), state: 'free' };
  simState.items.push(next);
  runUntil(state, () => state.phase === 'pick_hover');
  runUntil(state, () => state.phase === 'drop_recenter');
  assert.equal(next.state, 'free');
  assert.ok(Math.abs(next.pos.y - firstHeight - partHalfHeight(next) * 2) < 0.001);
  assert.equal(part.pos.y, firstHeight);
});

test('hover advances its deadline even when commanded motion continues', t => {
  const { state } = setup(t, { collisions: false });
  tickCobot(state, 1 / 60, true);
  state.targetTimer = 0.5;
  state.ikVelocity.set(0.1, 0, 0);
  tickCobot(state, 1 / 60, true);
  assert.ok(state.targetTimer > 0.5);
});

for (const phase of ['pick_descend', 'pick_attach']) {
  test(`${phase} cannot loop forever on a stale contact pose`, t => {
    const { state, part } = setup(t, { collisions: false });
    runUntil(state, () => state.phase === 'pick_descend');
    state.phase = phase;
    state.waitTimer = 10;
    state.targetTimer = 10;
    // Contact prediction says aligned, but the actual part is too far to latch.
    const tip = state.gripperTip.getAbsolutePosition().clone();
    state.lockedPickupTarget = tip.subtract(new Vector3(0, partHalfHeight(part) + 0.05, 0));
    state.lockedPickupItemId = part.id;
    state.lockedPickupUntil = state.simTime + 100;
    part.pos.x = tip.x + 0.2;
    part.pos.y = state.lockedPickupTarget.y;
    part.pos.z = tip.z;
    tickCobot(state, 1 / 60, true);
    assert.notEqual(state.phase, phase, 'failed latches must still honor the timeout');
  });
}

test('follows a slowly moving conveyor part through pickup and release', t => {
  const { state, part } = setup(t, { offset: -0.35, belt: true });
  runUntil(state, () => state.phase === 'drop_recenter', () => {
    if (part.state === 'free' || part.state === 'targeted') part.pos.x += 0.5 * 0.55 / 60;
  });
  assert.equal(part.state, 'free');
});
