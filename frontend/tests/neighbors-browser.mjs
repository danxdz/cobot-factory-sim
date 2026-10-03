import assert from 'node:assert/strict';

// Exercise two adjacent arms picking different parts from the same table,
// with actual scene physics, destination scoring and visible path overlays.
export async function checkNeighbors({ evaluate, delay }) {
  await evaluate(`(async () => {
    const loaded = file => performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(name => new URL(name).pathname === file) ?? file;
    window.auditStore = (await import(loaded('/store.ts'))).factoryStore;
    window.auditSim = (await import(loaded('/simState.ts'))).simState;
    const robots = [0, 2.5].map((x, i) => ({id:'neighbor-'+i,type:'cobot',position:[x,0,0],rotation:2,
      config:{speed:1.5,cobotShowPath:true,pickColors:[i?'#3b82f6':'#ef4444'],program:[
        {action:'pick',pos:[1.25,1,2.5]},
        {action:'drop',pos:[x,1,-2],sortColor:false,sortSize:false,sortShape:false}
      ]}}));
    auditStore.getState().setIsRunning(false);
    auditStore.setState({placedItems:[...robots,
      {id:'shared-source',type:'table',position:[1.25,0,2.5],rotation:0,config:{tableHeight:1,tableSize:[4,1.8]}},
      ...robots.map((r,i)=>({id:'bin-'+i,type:'receiver',position:[r.position[0],0,-2],rotation:0,config:{machineHeight:1}}))
    ]});
  })()`);
  for (let i = 0; i < 120 && !(await evaluate('auditSim.cobotStates.has("neighbor-1")')); i++) await delay(100);
  for (let run = 0; run < 2; run++) {
    await evaluate(`(() => {
      const st = auditStore.getState();
      st.setIsRunning(true);
      st.setSelectedItemId('neighbor-0');
      const vec = auditSim.cobotStates.get('neighbor-0').ikTarget;
      auditSim.items.push(...[0,1].map(i=>({id:'neighbor-part-${run}-'+i,shape:'disc',size:'medium',color:i?'#3b82f6':'#ef4444',
        pos:vec.clone().set(1+i*0.5,1.0125,2.5),rotY:0,state:'free'})));
    })()`);
    let result;
    for (let i = 0; i < 180; i++) {
      result = await evaluate(`({score:auditStore.getState().score,robots:Array.from(auditSim.cobotStates,([id,s])=>({id,phase:s.phase,dropped:s.lastDroppedItemId,time:s.simTime,stopped:s.safetyStopped}))})`);
      if (i % 40 === 0) console.log('Neighbor progress:', JSON.stringify(result));
      if (result.score >= 2 && result.robots.every(r=>r.dropped)) break;
      await delay(250);
    }
    assert.ok(result.score >= 2 && result.robots.every(r=>r.dropped && !r.stopped), JSON.stringify(result));
    console.log('Neighbor run', run+1, JSON.stringify(result));
    await evaluate('auditStore.getState().setIsRunning(false)');
    await delay(300);
  }
}
