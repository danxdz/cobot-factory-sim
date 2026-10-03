import assert from 'node:assert/strict';

export async function checkReturn({evaluate,delay}) {
  await evaluate(`(async () => {
    const loaded=file=>performance.getEntriesByType('resource').map(e=>e.name).findLast(name=>new URL(name).pathname===file)??file;
    window.auditStore=(await import(loaded('/store.ts'))).factoryStore;
    window.auditSim=(await import(loaded('/simState.ts'))).simState;
  })()`);
  for(let i=0;i<120 && !(await evaluate('auditSim.cobotStates.size>=2'));i++) await delay(100);
  await evaluate(`(() => {
    window.returnAudit={};
    const scene=Array.from(auditSim.cobotStates.values())[0].root.getScene();
    window.returnObserver=scene.onAfterRenderObservable.add(()=>{
      for(const [id,r] of auditSim.cobotStates) {
        const report=returnAudit[id]??={drops:[],frames:0,maxError:0,maxTilt:0};
        if(r.lastDroppedItemId && !report.drops.includes(r.lastDroppedItemId)) report.drops.push(r.lastDroppedItemId);
        if(!r.lastDroppedItemId || !['drop_recenter','next','idle'].includes(r.phase)) continue;
        r.gripperTip.computeWorldMatrix(true);
        const tip=r.gripperTip.getAbsolutePosition();
        report.maxError=Math.max(report.maxError,Math.hypot(tip.x-r.ikTarget.x,tip.z-r.ikTarget.z));
        const normal=r.handPitch.getDirection(r.ikTarget.clone().set(0,1,0)).normalize();
        report.maxTilt=Math.max(report.maxTilt,Math.acos(Math.max(-1,Math.min(1,-normal.y)))*180/Math.PI);
        report.frames++;
      }
    });
    auditStore.getState().setIsRunning(true);
  })()`);
  let result;
  for(let i=0;i<240;i++) {
    result=await evaluate('returnAudit');
    if(Object.keys(result).length>=2 && Object.values(result).every(r=>r.drops.length>=2&&r.frames>30)) break;
    await delay(250);
  }
  assert.ok(Object.keys(result).length>=2,JSON.stringify(result));
  for(const [id,r] of Object.entries(result)) {
    assert.ok(r.drops.length>=2 && r.frames>30,`${id}: ${JSON.stringify(r)}`);
    assert.ok(r.maxError<0.04,`${id} sweeps outside its return route: ${JSON.stringify(r)}`);
    assert.ok(r.maxTilt<0.01,`${id} tilts its pad: ${JSON.stringify(r)}`);
  }
  console.log('Default-layout return tracking:',JSON.stringify(result));
  await evaluate(`(() => {
    Array.from(auditSim.cobotStates.values())[0].root.getScene().onAfterRenderObservable.remove(returnObserver);
    auditStore.getState().setIsRunning(false);
  })()`);
}
