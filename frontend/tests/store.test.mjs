import test from 'node:test';
import assert from 'node:assert/strict';
import { factoryStore } from '../store.ts';

test('persists configuration changes without writing storage for runtime telemetry', t => {
  const previous = globalThis.localStorage;
  const writes = [];
  globalThis.localStorage = { getItem: () => null, setItem: (key, value) => writes.push(JSON.parse(value)) };
  t.after(() => { globalThis.localStorage = previous; });
  factoryStore.setState({ machineStates: { test: { health: 'running', label: 'Running' } } });
  factoryStore.setState({ score: 42, selectedItemId: 'test' });
  assert.equal(writes.length, 0);
  factoryStore.setState({ cameraPreviewFps: factoryStore.getState().cameraPreviewFps + 1 });
  assert.equal(writes.length, 1);
  factoryStore.setState({ placedItems: [...factoryStore.getState().placedItems] });
  assert.equal(writes.length, 2);
  assert.equal(writes[1].cameraPreviewFps, factoryStore.getState().cameraPreviewFps);
});
