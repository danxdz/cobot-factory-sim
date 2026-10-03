import test from 'node:test';
import assert from 'node:assert/strict';
import { factoryStore } from '../store.ts';
import { buildBlockedReason } from '../game/buildRules.ts';

function sandbox(t) {
  const previous=factoryStore.getState();
  t.after(()=>factoryStore.setState(previous));
  factoryStore.setState({challenge:null,isRunning:false,isPaused:false,credits:5000,score:17,buildMode:null,draftPlacement:null});
  return factoryStore.getState();
}

test('buying during a Sandbox run pauses without stopping or resetting progress', t => {
  const st=sandbox(t);
  st.setIsRunning(true);
  st.setScore(17);
  const layout=factoryStore.getState().placedItems;
  st.setBuildMode('table');
  assert.equal(factoryStore.getState().isRunning,true);
  assert.equal(factoryStore.getState().isPaused,true);
  assert.equal(factoryStore.getState().score,17);
  assert.equal(factoryStore.getState().placedItems,layout);
  st.setBuildMode(null);
  assert.equal(factoryStore.getState().isRunning,true);
  assert.equal(factoryStore.getState().isPaused,true);
  assert.equal(factoryStore.getState().credits,5000);
});

test('purchase succeeds only with available credit and a paused or stopped simulation', t => {
  const st=sandbox(t), item={type:'table',position:[20,0,0],rotation:0};
  const count=st.placedItems.length;
  st.setIsRunning(true);
  assert.equal(st.addPlacedItem(item),false);
  st.setIsPaused(true);
  assert.equal(st.addPlacedItem(item),true);
  assert.equal(factoryStore.getState().credits,4900);
  assert.equal(factoryStore.getState().placedItems.length,count+1);
  st.setCredits(99);
  assert.equal(st.addPlacedItem(item),false);
  assert.equal(factoryStore.getState().credits,99);
  assert.equal(factoryStore.getState().placedItems.length,count+1);
  assert.equal(buildBlockedReason(factoryStore.getState(),'table'),'Requires 100 credits');
});

test('selling equipment refunds exactly once in Sandbox', t => {
  const st=sandbox(t);
  st.addPlacedItem({type:'camera',position:[20,0,0],rotation:0});
  const id=factoryStore.getState().placedItems.at(-1).id;
  st.removePlacedItem(id);
  st.removePlacedItem(id);
  assert.equal(factoryStore.getState().credits,5000);
});

test('start, resume and reset clear unbought previews without charging for them', t => {
  const st=sandbox(t), draft={id:'draft_item',type:'table',position:[20,0,0],rotation:0};
  st.setBuildMode('table');st.setDraftPlacement(draft);st.setIsRunning(true);
  assert.equal(factoryStore.getState().draftPlacement,null);
  st.setBuildMode('table');st.setDraftPlacement(draft);st.setIsPaused(false);
  assert.equal(factoryStore.getState().buildMode,null);
  assert.equal(factoryStore.getState().draftPlacement,null);
  assert.equal(factoryStore.getState().credits,5000);
  st.setBuildMode('table');st.setDraftPlacement(draft);st.resetFactory();
  assert.equal(factoryStore.getState().draftPlacement,null);
  assert.equal(factoryStore.getState().moveModeOriginalItem,null);
});

test('shop explains First Shift restrictions and keeps its run locked during pause', t => {
  const st=sandbox(t);
  st.enterChallenge();
  t.after(()=>st.exitChallenge());
  assert.equal(buildBlockedReason(factoryStore.getState(),'sender'),'Unavailable in First Shift');
  st.setIsRunning(true);st.setIsPaused(true);
  assert.equal(buildBlockedReason(factoryStore.getState(),'belt'),'Retry the shift to edit equipment');
  const before=factoryStore.getState();
  st.setBuildMode('belt');
  assert.equal(st.addPlacedItem({type:'belt',position:[20,0,0],rotation:0}),false);
  assert.equal(factoryStore.getState().credits,before.credits);
  assert.equal(factoryStore.getState().buildMode,null);
});

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
