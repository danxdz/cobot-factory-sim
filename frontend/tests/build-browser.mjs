import assert from 'node:assert/strict';

export async function checkBuild({evaluate,send,delay}) {
  const click=label=>evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});
    if(!button || button.disabled) throw Error('Button unavailable: '+${JSON.stringify(label)});
    button.click();
  })()`);
  await evaluate(`(async()=>{
    const loaded=file=>performance.getEntriesByType('resource').map(e=>e.name).findLast(name=>new URL(name).pathname===file)??file;
    window.auditStore=(await import(loaded('/store.ts'))).factoryStore;
    window.auditSim=(await import(loaded('/simState.ts'))).simState;
    auditStore.getState().setIsRunning(true);
  })()`);
  for(let i=0;i<100 && !(await evaluate('auditSim.items.length>0 && auditSim.cobotStates.size>=2'));i++) await delay(100);
  await click('Surfaces');
  await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(b=>b.querySelector('span')?.textContent==='TABLE');
    if(!button || button.disabled) throw Error('Table purchase disabled during Sandbox run');
    window.savedParts=[...auditSim.items];
    window.savedRobots=[...auditSim.cobotStates.values()].map(r=>({r,time:r.simTime,phase:r.phase}));
    window.savedCredits=auditStore.getState().credits;
    window.savedCount=auditStore.getState().placedItems.length;
    button.click();
  })()`);
  await delay(350);
  assert.deepEqual(await evaluate(`({running:auditStore.getState().isRunning,paused:auditStore.getState().isPaused,mode:auditStore.getState().buildMode,
    parts:savedParts.every(p=>auditSim.items.includes(p)),robots:savedRobots.every(({r,time,phase})=>r.simTime===time&&r.phase===phase)})`),
    {running:true,paused:true,mode:'table',parts:true,robots:true});
  // Project a visible, empty floor tile and place through real pointer events.
  const point=await evaluate(`(() => {
    const scene=savedRobots[0].r.root.getScene(), vec=savedRobots[0].r.ikTarget;
    const canvas=document.querySelector('canvas'),rect=canvas.getBoundingClientRect(),engine=scene.getEngine();
    for(const x of [-5,0,5,-7.5]) for(const z of [-2.5,-5,5,7.5]) {
      const world=vec.clone().set(x,0,z);
      const screen=vec.constructor.Project(world,scene.getTransformMatrix().constructor.Identity(),scene.getTransformMatrix(),scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(),engine.getRenderHeight()));
      const px=rect.left+screen.x*rect.width/engine.getRenderWidth(),py=rect.top+screen.y*rect.height/engine.getRenderHeight();
      if(document.elementFromPoint(px,py)===canvas && !auditStore.getState().placedItems.some(p=>p.position[0]===x&&p.position[2]===z)) return {x:px,y:py};
    }
    throw Error('No exposed empty tile');
  })()`);
  for(const type of ['mouseMoved','mousePressed','mouseReleased']) {
    await send('Input.dispatchMouseEvent',{type,...point,button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1});
  }
  for(let i=0;i<30 && !(await evaluate('!!auditStore.getState().draftPlacement'));i++) await delay(100);
  assert.equal(await evaluate('auditStore.getState().draftPlacement?.type'),'table');
  await click('VALIDATE');
  await delay(250);
  assert.equal(await evaluate('auditStore.getState().placedItems.length===savedCount+1 && auditStore.getState().credits===savedCredits-100'),true);
  assert.equal(await evaluate('auditStore.getState().isRunning && auditStore.getState().isPaused && savedParts.every(p=>auditSim.items.includes(p))'),true);
  await evaluate(`auditStore.getState().setSelectedItemId(auditStore.getState().placedItems.at(-1).id)`);
  await delay(150);
  await click('SELL');
  assert.equal(await evaluate('auditStore.getState().credits===savedCredits && auditStore.getState().placedItems.length===savedCount'),true);
  await evaluate('auditStore.getState().setIsPaused(false)');
  await delay(250);
  assert.equal(await evaluate('savedRobots.every(({r,time})=>r.simTime>time)'),true);
  await evaluate('auditStore.getState().setCredits(0)');
  await click('Surfaces');
  assert.equal(await evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.querySelector('span')?.textContent==='TABLE');return b?.disabled && b.textContent.includes('Requires 100 credits');})()`),true);
  console.log('Build browser passed: buy from a live run, preserve parts/controllers, grid placement, exact charge/refund, resume, insufficient-credit explanation.');
  await evaluate('auditStore.getState().setIsRunning(false)');
}
