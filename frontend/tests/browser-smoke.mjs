// Opt-in real-browser integration check. Start Vite on port 5188 first.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'cobot-browser-'));
const browser = spawn(process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=9229', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let pages;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { pages = await (await fetch('http://127.0.0.1:9229/json')).json(); break; } catch { await delay(250); }
  }
  assert.ok(pages?.length, 'Chrome debugging endpoint must start');
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, message => { clearTimeout(timeout); message.error ? reject(message.error) : resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:5188' });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate('!!document.querySelector("canvas")')) break;
    await delay(250);
  }
  if (process.argv.includes('--return')) {
    const { checkReturn } = await import('./return-browser.mjs');
    await checkReturn({ evaluate, send, delay });
  } else if (process.argv.includes('--pickup')) {
    const { checkPickup } = await import('./pickup-browser.mjs');
    await checkPickup({ evaluate, send, delay });
  } else if (process.argv.includes('--neighbors')) {
    const { checkNeighbors } = await import('./neighbors-browser.mjs');
    await checkNeighbors({ evaluate, send, delay });
  } else if (process.argv.includes('--challenge')) {
    const { checkChallenge } = await import('./challenge-browser.mjs');
    await checkChallenge({ evaluate, send, delay });
  } else {
  await evaluate(`(async () => {
    window.auditStore = (await import('/store.ts')).factoryStore;
    window.auditSim = (await import('/simState.ts')).simState;
    const st = auditStore.getState();
    window.auditDefaultLayout = structuredClone(st.placedItems);
    st.setIsRunning(false);
    auditStore.setState({ placedItems: [
      { id:'audit-robot', type:'cobot', position:[0,0,0], rotation:2, config:{cobotShowPath:true, program:[
        {action:'pick',pos:[0,1,2.5]}, {action:'drop',pos:[2.5,1,0],sortColor:false,sortSize:false,sortShape:false}]} },
      { id:'audit-source', type:'table', position:[0,0,2.5], rotation:0, config:{tableHeight:1} },
      { id:'audit-dest', type:'table', position:[2.5,0,0], rotation:0, config:{tableHeight:1} }
    ] });
  })()`);
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate('auditSim.cobotStates.has("audit-robot")')) break;
    await delay(250);
  }
  for (let run = 0; run < 4; run++) {
    if (run >= 2) {
      await evaluate(`(() => {
        const st = auditStore.getState();
        const robot = st.placedItems.find(item => item.id === 'audit-robot');
        st.updatePlacedItem('audit-dest', {type:'${run === 2 ? 'receiver' : 'indexed_receiver'}', position:[2.2,0,0], config:{machineHeight:1}});
        st.updatePlacedItem('audit-robot', {config:{...robot.config,program:[robot.config.program[0],{action:'drop',pos:[2.2,1,0]}]}});
      })()`);
      await delay(500);
    }
    await evaluate(`(() => {
      auditStore.getState().setIsRunning(true);
      const robot = auditSim.cobotStates.get('audit-robot');
      auditSim.items.push({id:'audit-part-${run}',shape:'disc',size:'medium',color:'#ef4444',
        pos:robot.ikTarget.clone().set(0,1.0125,2.5),rotY:0,state:'free'});
    })()`);
    let result;
    for (let attempt = 0; attempt < 120; attempt++) {
      result = await evaluate(`(() => {const r=auditSim.cobotStates.get('audit-robot');return {phase:r?.phase, dropped:r?.lastDroppedItemId,time:r?.simTime,parts:auditSim.items.map(p=>({id:p.id,state:p.state,pos:p.pos.asArray()}))};})()`);
      if (result.dropped === `audit-part-${run}`) break;
      await delay(250);
    }
    assert.equal(result.dropped, `audit-part-${run}`, JSON.stringify(result));
    console.log(`Browser run ${run + 1}: pickup/drop completed at ${result.time.toFixed(2)} simulated seconds`);
    if (run >= 2) {
      for (let attempt = 0; attempt < 40 && !(await evaluate('auditStore.getState().score > 0')); attempt++) await delay(100);
      assert.ok(await evaluate('auditStore.getState().score > 0'), 'off-grid receiver must consume and score the placed part');
    }
    await evaluate('auditStore.getState().setIsRunning(false)');
    assert.equal(await evaluate('auditSim.cobotStates.has("audit-robot")'), true);
  }
  await evaluate(`(() => {
    auditStore.setState({placedItems:auditDefaultLayout});
    auditStore.getState().setIsRunning(true);
  })()`);
  let defaultResult;
  for (let attempt = 0; attempt < 160; attempt++) {
    defaultResult = await evaluate(`Array.from(auditSim.cobotStates, ([id,r]) => ({id,phase:r.phase,dropped:r.lastDroppedItemId,time:r.simTime,reason:auditStore.getState().machineStates[id],logs:(auditSim.cobotLogs[id]??[]).filter(e=>e.event!=='motion_trace').slice(-4)}))`);
    if (defaultResult.length >= 2 && defaultResult.every(robot => robot.dropped)) break;
    await delay(250);
  }
  console.log('Default layout result:', JSON.stringify(defaultResult));
  assert.ok(defaultResult.length >= 2 && defaultResult.every(robot => robot.dropped), 'both default-layout robots must complete a drop');
  }
  assert.deepEqual(errors, [], 'browser console must contain no runtime errors');
  console.log(process.argv.includes('--return') ? 'Return browser smoke passed.' : process.argv.includes('--pickup') ? 'Pickup browser smoke passed.' : process.argv.includes('--neighbors') ? 'Neighbor browser smoke passed.' : process.argv.includes('--challenge') ? 'Challenge browser smoke passed.' : 'Browser smoke passed: WebGL, physics, four start/stop cycles, path overlay, off-grid receiver scoring.');
  await send('Browser.close');
} finally {
  socket?.close();
  browser.kill();
  await delay(500);
  const withinTemp = relative(resolve(tmpdir()), resolve(profile));
  if (withinTemp && !withinTemp.startsWith('..') && !isAbsolute(withinTemp)) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}
