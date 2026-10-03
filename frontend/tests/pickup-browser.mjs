import assert from 'node:assert/strict';

export async function checkPickup({evaluate, delay}) {
  await evaluate(`(async () => {
    const loaded = file => performance.getEntriesByType('resource').map(e=>e.name)
      .findLast(name=>new URL(name).pathname===file) ?? file;
    window.auditStore = (await import(loaded('/store.ts'))).factoryStore;
    window.auditSim = (await import(loaded('/simState.ts'))).simState;
    auditStore.getState().setIsRunning(false);
    auditStore.setState({placedItems:[
      {id:'pickup-robot',type:'cobot',position:[0,0,0],rotation:2,config:{speed:1.5,program:[
        {action:'pick',pos:[0,1,2.5]},
        {action:'drop',pos:[2.5,1,0],sortColor:false,sortSize:false,sortShape:false}]}},
      {id:'belt',type:'belt',position:[0,0,2.5],rotation:1,config:{beltHeight:1,speed:0.5}},
      {id:'destination',type:'table',position:[2.5,0,0],rotation:0,config:{tableHeight:1}}
    ]});
  })()`);
  for(let i=0;i<120 && !(await evaluate('auditSim.cobotStates.has("pickup-robot")'));i++) await delay(100);
  for (const shape of ['disc','can','box','pyramid']) {
    await evaluate(`(() => {
      auditStore.getState().setIsRunning(true);
      const robot = auditSim.cobotStates.get('pickup-robot');
      const scene = robot.root.getScene();
      const disposable = {id:'retire-first',shape:'disc',size:'small',color:'#ef4444',
        pos:robot.ikTarget.clone().set(-5,2,0),rotY:0,state:'grabbed'};
      const part = {id:'moving-${shape}',shape:'${shape}',size:'medium',color:'#3b82f6',
        pos:robot.ikTarget.clone().set(-0.35,${shape === 'disc' ? 1.0125 : shape === 'pyramid' ? 1.08 : 1.04},2.5),rotY:1.2,state:'free'};
      auditSim.items.push(disposable,part);
      window.pickupAudit = {errors:[],frames:0,grabbed:0,compacted:false,maxHeldGap:0,phases:[],maxYawStep:0,maxTiltDegrees:0};
      let mesh, previousYaw=part.rotY;
      window.pickupObserver = scene.onAfterRenderObservable.add(() => {
        const report = pickupAudit;
        robot.handPitch.computeWorldMatrix(true);
        const normal=robot.handPitch.getDirection(robot.ikTarget.clone().set(0,1,0)).normalize();
        report.maxTiltDegrees=Math.max(report.maxTiltDegrees,Math.acos(Math.max(-1,Math.min(1,-normal.y)))*180/Math.PI);
        if (!mesh) mesh = scene.meshes.find(m=>m.name.startsWith('part_') && m.isVisible && m.position.subtract(part.pos).length()<0.001);
        if (!mesh || mesh.isDisposed() || !mesh.isVisible || mesh.position.subtract(part.pos).length()>0.001) {
          report.errors.push('part mesh disappeared, changed identity or moved away on frame '+report.frames);
        }
        report.maxYawStep = Math.max(report.maxYawStep,Math.abs(Math.atan2(Math.sin(part.rotY-previousYaw),Math.cos(part.rotY-previousYaw))));
        previousYaw=part.rotY;
        if(report.phases.at(-1)!==robot.phase) report.phases.push(robot.phase);
        if(part.state==='grabbed') {
          report.grabbed++;
          const tip=robot.gripperTip.getAbsolutePosition();
          report.maxHeldGap=Math.max(report.maxHeldGap,Math.hypot(tip.x-part.pos.x,tip.z-part.pos.z));
          // Remove an earlier slot while the later part is attached to the real gripper.
          disposable.state='dead';
        }
        if(!auditSim.items.includes(disposable)) report.compacted=true;
        report.frames++;
      });
    })()`);
    let result;
    for(let i=0;i<160;i++) {
      result=await evaluate(`(() => {const r=auditSim.cobotStates.get('pickup-robot');return {...pickupAudit,time:r.simTime,phase:r.phase,dropped:r.lastDroppedItemId,stopped:r.safetyStopped};})()`);
      if(result.dropped === `moving-${shape}` || result.errors.length) break;
      await delay(200);
    }
    assert.deepEqual(result.errors,[],JSON.stringify(result));
    assert.equal(result.dropped,`moving-${shape}`,JSON.stringify(result));
    assert.ok(result.grabbed>1 && result.compacted,JSON.stringify(result));
    assert.ok(result.maxHeldGap<1e-6 && !result.stopped,JSON.stringify(result));
    assert.ok(result.maxYawStep<0.4, 'a grab must not teleport part orientation: '+JSON.stringify(result));
    assert.ok(result.maxTiltDegrees<0.01, 'the suction pad must stay level on every cycle: '+JSON.stringify(result));
    console.log('Pickup browser:',shape,JSON.stringify(result));
    await evaluate(`(() => {
      auditSim.cobotStates.get('pickup-robot').root.getScene().onAfterRenderObservable.remove(pickupObserver);
      // Clear the delivered part, but keep the same robot running. Restarting
      // here masked the retained wrist angle that tilted subsequent pickups.
      const delivered=auditSim.items.find(p=>p.id==='moving-${shape}');
      if(delivered) delivered.state='dead';
    })()`);
    await delay(200);
  }
  await evaluate('auditStore.getState().setIsRunning(false)');
}
