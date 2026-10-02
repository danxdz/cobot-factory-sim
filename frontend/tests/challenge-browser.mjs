import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Invoked by browser-smoke.mjs --challenge against an isolated Chrome profile.
export async function checkChallenge({ evaluate, send, delay }) {
  const screenshot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const path = join(tmpdir(), `cobot-${name}.png`);
    await writeFile(path, Buffer.from(data, 'base64'));
    console.log('Screenshot:', path);
  };
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!button) throw new Error('Button not found: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  await evaluate(`(async () => {
    const loaded = file => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === file) ?? file;
    window.auditStore = (await import(loaded('/store.ts'))).factoryStore;
    window.auditSim = (await import(loaded('/simState.ts'))).simState;
    auditStore.getState().setCredits(4321);
    window.savedSandbox = localStorage.getItem('cobot-factory-sim-v10');
  })()`);
  await click('Challenges 01');
  await delay(400);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:' ',code:'Space',bubbles:true,cancelable:true}))`);
  assert.equal(await evaluate('auditStore.getState().isRunning'), false, 'briefing keyboard input must not start the underlying simulation');
  await screenshot('challenge-briefing');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(300);
  await screenshot('challenge-mobile');
  assert.ok(await evaluate('document.querySelector(".game-dialog").getBoundingClientRect().right <= innerWidth'), 'mobile dialog fits viewport');
  await send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('Open First Shift');
  await delay(700);
  assert.equal(await evaluate('auditStore.getState().challenge.status'), 'planning');
  await screenshot('challenge-planning');
  await click('Start shift');
  await delay(700);
  await click('Pause shift');
  const pausedTime = await evaluate('auditStore.getState().challenge.elapsed');
  await delay(350);
  assert.equal(await evaluate('auditStore.getState().challenge.elapsed'), pausedTime);
  await click('Resume shift');
  await evaluate('auditStore.getState().setSimSpeedMult(3)');
  let result;
  for (let attempt = 0; attempt < 480; attempt++) {
    result = await evaluate('auditStore.getState().challenge');
    if (attempt % 40 === 0) console.log('Shift:', JSON.stringify(result));
    if (['won', 'failed'].includes(result.status)) break;
    await delay(250);
  }
  console.log('Shift result:', JSON.stringify(result));
  await screenshot('challenge-results');
  if (result.status !== 'won') console.log('Robot diagnostics:', await evaluate(`JSON.stringify(Array.from(auditSim.cobotStates, ([id,r]) => ({id,phase:r.phase,reason:auditStore.getState().machineStates[id],logs:(auditSim.cobotLogs[id]??[]).filter(e=>e.event!=='motion_trace').slice(-8)})))`));
  assert.equal(result.status, 'won', 'untouched starter line must fulfill the order');
  assert.equal(await evaluate('auditStore.getState().isPaused'), true);
  assert.equal(await evaluate('localStorage.getItem("cobot-factory-sim-v10") === savedSandbox'), true);
  await click('Improve & retry');
  await delay(300);
  assert.deepEqual(await evaluate('auditStore.getState().challenge.accepted'), [0, 0]);
  await evaluate(`(() => {
    const st = auditStore.getState();
    st.setIsRunning(true);
    for (const item of st.placedItems.filter(i => i.type === 'cobot')) st.updatePlacedItem(item.id, { config: { ...item.config, isStopped: true } });
  })()`);
  for (let attempt = 0; attempt < 120 && !(await evaluate('auditStore.getState().challenge.rejected > 0')); attempt++) await delay(250);
  assert.ok(await evaluate('auditStore.getState().challenge.rejected > 0'), 'missed parts must count at the actual reject outlet');
  await evaluate('auditStore.getState().advanceChallenge(180, 2, 2)');
  await delay(300);
  assert.equal(await evaluate('auditStore.getState().challenge.status'), 'failed');
  assert.equal(await evaluate('document.querySelector("#game-dialog-title").textContent'), 'Shift ended.');
  await evaluate('document.querySelector(".game-dialog .game-secondary").click()');
  await delay(300);
  assert.equal(await evaluate('auditStore.getState().challenge'), null);
  assert.equal(await evaluate('auditStore.getState().credits'), 4321);
  assert.equal(await evaluate('localStorage.getItem("cobot-factory-sim-v10") === savedSandbox'), true);
  console.log('Challenge passed: real deliveries, pause, victory, retry, timeout, Sandbox restoration.');
}
