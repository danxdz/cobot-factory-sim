import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { createCobot, tickCobot } from '../babylon/cobotMesh.ts';
import { computeYieldTargetFromSensors, collectArmSamples } from '../babylon/cobot/collision.ts';
import { factoryStore } from '../store.ts';
import { simState } from '../simState.ts';
import { neighborApproachScale, yieldsToNeighbor } from '../babylon/cobot/neighbors.ts';

function setup(t, shared = false) {
  simState.cobotStates.clear();
  simState.reset();
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const robots = [0, 2.5].map((x, i) => ({ id: `robot-${i}`, type: 'cobot', position: [x, 0, 0], rotation: 2,
    config: { speed: 1.5, pickColors: [i ? '#3b82f6' : '#ef4444'], program: [
      { action: 'pick', pos: [shared ? 1.25 : x, 1, 2.5] }, { action: 'drop', pos: [x, 1, -2.5], sortColor: false, sortSize: false, sortShape: false },
    ] } }));
  const tables = robots.flatMap((r, i) => [2.5, -2.5].map(z => ({id:`table-${i}-${z}`,type:'table',position:[r.position[0],0,z],rotation:0,config:{tableHeight:1}})));
  if (shared) tables.push({id:'shared-source',type:'table',position:[1.25,0,2.5],rotation:0,config:{tableHeight:1,tableSize:[4,1.8]}});
  factoryStore.setState({ placedItems: [...robots, ...tables] });
  const states = robots.map(robot => {
    const { state } = createCobot(robot, scene);
    state.obstacles = [...robots, ...tables].filter(item => item.id !== robot.id);
    simState.cobotStates.set(robot.id, state);
    return state;
  });
  return states;
}

test('idle neighbors agree on a single yielding robot at equal priority', t => {
  const states = setup(t);
  for (const state of states) {
    state.wristRoll.computeWorldMatrix(true);
    const wrist = state.wristRoll.getAbsolutePosition();
    const other = states.find(s => s !== state);
    simState.cobotWrists = { [other.selfItem.id]: wrist.add(new Vector3(0.3, 0, 0)) };
    const yields = computeYieldTargetFromSensors(state, Vector3.Zero()) !== null;
    assert.equal(yields, state.selfItem.id === 'robot-1', 'equal-priority peers must not both retract');
  }
});

test('a nearby part or table sensor does not trigger neighbor parking', t => {
  const [state] = setup(t);
  state.sensorHazards = [0.8, 0.3, 0, 0];
  simState.cobotWrists = {};
  assert.equal(computeYieldTargetFromSensors(state, Vector3.Zero()), null);
});

test('neighbor clearance permits separation but stops contact approaches for either priority', () => {
  for (const yielding of [false, true]) {
    assert.equal(neighborApproachScale(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), 0.05, yielding), 1);
    assert.equal(neighborApproachScale(new Vector3(1, 0, 0), new Vector3(1, 0, 0), 0.05, yielding), 0);
    assert.equal(neighborApproachScale(Vector3.Zero(), new Vector3(1, 0, 0), 0.05, yielding), 1);
  }
  assert.equal(yieldsToNeighbor('a', false, 'b', true), true);
  assert.equal(yieldsToNeighbor('b', true, 'a', false), false);
});

for (const shared of [false, true]) for (const reversed of [false, true]) test(`adjacent robots complete transfers (shared pickup=${shared}, reverse tick order=${reversed})`, t => {
  const states = setup(t, shared);
  simState.items = states.map((state, i) => ({ id:`part-${i}`, shape:'disc', size:'medium', color:state.pickColors[0],
    pos:new Vector3(shared ? 1 + i * 0.5 : state.position[0],1.0125,2.5),rotY:0,state:'free' }));
  const order = reversed ? [...states].reverse() : states;
  for (let frame = 0; frame < 60 * 35; frame++) {
    for (const state of states) {
      state.wristRoll.computeWorldMatrix(true);
      simState.cobotWrists[state.selfItem.id] = state.wristRoll.getAbsolutePosition().clone();
      simState.cobotArmSamples[state.selfItem.id] = collectArmSamples(state);
      simState.cobotLoads[state.selfItem.id] = !!state.grabbedItem;
    }
    for (const state of order) tickCobot(state, 1 / 60, true);
    if (states.every(s => s.lastDroppedItemId)) break;
  }
  assert.ok(states.every(s => s.lastDroppedItemId), JSON.stringify(states.map(s=>({id:s.selfItem.id,phase:s.phase,time:s.simTime,source:s.targetSource,stopped:s.safetyStopped,logs:(simState.cobotLogs[s.selfItem.id]??[]).filter(e=>e.event!=='motion_trace').slice(-5)}))));
  t.diagnostic(`Both finished by ${states[0].simTime.toFixed(2)}s`);
});
