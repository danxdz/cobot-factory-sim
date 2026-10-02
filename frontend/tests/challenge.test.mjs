import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_SHIFT, freshChallenge, nextChallengeTemplate, recordDelivery, challengeMetrics, layoutCost } from '../game/challenge.ts';
import { factoryStore } from '../store.ts';

const red = id => ({ id, templateId: 'order-red', shape: 'disc', color: '#ef4444' });
const blue = id => ({ id, templateId: 'order-blue', shape: 'box', color: '#3b82f6' });
const running = () => ({ ...freshChallenge(), status: 'running' });

test('orders validate destination, template, shape and color; one part cannot score twice', () => {
  let run = recordDelivery(running(), 't1', red('good'));
  assert.deepEqual(run.accepted, [1, 0]);
  assert.equal(recordDelivery(run, 't1', red('good')), run);
  for (const [destination, part] of [
    ['r1', red('wrong-destination')], ['t1', { ...red('wrong-shape'), shape: 'box' }],
    ['t1', { ...red('wrong-color'), color: '#ffffff' }],
    ['t1', { ...red('wrong-template'), templateId: 'fake' }], ['lost', blue('lost')],
  ]) run = recordDelivery(run, destination, part);
  assert.equal(run.rejected, 5);
  assert.deepEqual(run.accepted, [1, 0]);
});

test('both quotas are required, completion freezes scoring, medal thresholds use actual performance', () => {
  let run = running();
  for (let i = 0; i < 6; i++) run = recordDelivery(run, 't1', red(`r${i}`));
  assert.equal(run.status, 'running');
  for (let i = 0; i < 4; i++) run = recordDelivery(run, 'r1', blue(`b${i}`));
  assert.equal(run.status, 'won');
  assert.equal(recordDelivery(run, 'r2', red('late')), run);
  assert.equal(challengeMetrics({ ...run, elapsed: 90 }, 500).medal, 'Gold');
  assert.equal(challengeMetrics({ ...run, elapsed: 90 }, 499).medal, 'Silver');
  assert.equal(challengeMetrics({ ...run, elapsed: 136 }, 500).medal, 'Bronze');
  assert.equal(challengeMetrics({ ...run, rejected: 7 }, 500).medal, 'Bronze');
});

test('feed repeats predictably and exhausted batch fails without waiting for the deadline', () => {
  assert.equal(nextChallengeTemplate(freshChallenge()), null);
  assert.deepEqual([0, 1, 2, 3].map(spawned => nextChallengeTemplate({ ...running(), spawned }).id),
    ['order-red', 'order-blue', 'order-red', 'order-red']);
  assert.equal(nextChallengeTemplate({ ...running(), spawned: 24 }), null);
  let run = running();
  for (let i = 0; i < 24; i++) run = recordDelivery(run, 'r2', red(`reject${i}`));
  assert.equal(run.status, 'failed');
});

test('challenge budget and fixtures are enforced; Sandbox data survives mode switches', t => {
  const previousStorage = globalThis.localStorage;
  const writes = [];
  globalThis.localStorage = { getItem: () => null, setItem: (key, value) => writes.push(JSON.parse(value)) };
  t.after(() => { factoryStore.getState().exitChallenge(); globalThis.localStorage = previousStorage; });
  const st = factoryStore.getState();
  const sandbox = structuredClone({ placedItems: st.placedItems, partTemplates: st.partTemplates, credits: st.credits });
  st.enterChallenge();
  const initial = factoryStore.getState();
  assert.equal(initial.credits + layoutCost(initial.placedItems), FIRST_SHIFT.budget);
  initial.setCredits(1e9);
  initial.removePlacedItem('s1');
  initial.updatePlacedItem('t1', { position: [100, 0, 100] });
  initial.addPlacedItem({ type: 'sender', position: [0, 0, 0], rotation: 0 });
  assert.equal(factoryStore.getState().placedItems, initial.placedItems);
  assert.equal(factoryStore.getState().credits, initial.credits);
  initial.addPlacedItem({ type: 'belt', position: [10, 0, 0], rotation: 0 });
  const added = factoryStore.getState().placedItems.at(-1);
  assert.ok(factoryStore.getState().credits < initial.credits);
  initial.removePlacedItem(added.id);
  initial.removePlacedItem(added.id);
  assert.equal(factoryStore.getState().credits, initial.credits, 'refund happens once');
  assert.equal(writes.length, 0, 'challenge mutations must never persist over Sandbox');
  initial.exitChallenge();
  const restored = factoryStore.getState();
  assert.deepEqual({ placedItems: restored.placedItems, partTemplates: restored.partTemplates, credits: restored.credits }, sandbox);
  assert.equal(restored.challenge, null);
});

test('clock honors pause, deadline and retry; run completion locks controls', t => {
  const st = factoryStore.getState();
  st.enterChallenge();
  t.after(() => st.exitChallenge());
  st.advanceChallenge(20, 2, 2);
  assert.equal(factoryStore.getState().challenge.elapsed, 0);
  st.setIsRunning(true);
  st.advanceChallenge(10, 1, 2);
  st.setIsPaused(true);
  st.advanceChallenge(10, 1, 2);
  assert.equal(factoryStore.getState().challenge.elapsed, 10);
  assert.equal(st.spawnChallengePart(), null);
  st.setIsPaused(false);
  st.advanceChallenge(NaN, 1, 2);
  st.advanceChallenge(-1, 1, 2);
  assert.equal(factoryStore.getState().challenge.elapsed, 10);
  for (let i = 0; i < 24; i++) assert.ok(st.spawnChallengePart());
  assert.equal(st.spawnChallengePart(), null);
  st.advanceChallenge(170, 1, 2);
  assert.equal(factoryStore.getState().challenge.status, 'failed');
  st.setIsPaused(false);
  st.setIsRunning(true);
  assert.equal(factoryStore.getState().isPaused, true);
  st.retryChallenge();
  assert.deepEqual(factoryStore.getState().challenge, freshChallenge());
  st.setIsRunning(true);
  assert.equal(st.spawnChallengePart().id, 'order-red');
});
