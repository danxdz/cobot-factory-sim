import fs from 'node:fs';
let p='babylon/cobot/controller.ts', s=fs.readFileSync(p,'utf8');
s="import { tickRecovery } from './recovery';\nimport { releaseDropReservation } from './reservations';\n"+s;
const a=s.indexOf('    } else if (!isRunning) {'), b=s.indexOf('    } else if (!state.autoOrganize',a);
s=s.slice(0,a)+`    } else if (isStopped) {
        state.ikVelocity.setAll(0);
        return state.safetyStopped;
    } else if (collisionsOn && state.safetyStopped) {
        return tickRecovery(state, delta, mountPos, L1, L2, L3);
`+s.slice(b);
s=s.replace('!state.autoOrganize && state.isAutoProgram)', '!state.autoOrganize && state.isAutoProgram && !state.grabbedItem)');
s=s.replace('    state.simTime += delta;', '    if (!state.grabbedItem) releaseDropReservation(state);\n    state.simTime += delta;');
fs.writeFileSync(p,s);
p='babylon/cobot/dropTargets.ts';s=fs.readFileSync(p,'utf8');
s="import { dropTargetReserved, reserveDropTarget } from './reservations';\n"+s;
s=s.replace('    if (!state.avoidDropTarget || state.simTime > state.avoidDropUntil) return false;', '    if (dropTargetReserved(state, slot)) return true;\n    if (!state.avoidDropTarget || state.simTime > state.avoidDropUntil) return false;');
const c=s.indexOf('export function currentDropTarget('), d=s.indexOf('export function isSelfPlatformDropPhase',c);
s=s.slice(0,c)+`export function currentDropTarget(state: CobotState): Vector3 | null {
    if (!state.grabbedItem || !['transit_drop', 'hover_drop', 'descend_drop', 'release'].includes(state.phase)) return null;
    const locked = state.lockedDropTarget ?? state.activeDropTarget;
    if (locked && !isTemporarilyAvoidedDropTarget(state, locked) && reserveDropTarget(state, locked)) return locked.clone();
    state.lockedDropTarget = null;
    state.activeDropTarget = null;
    if (state.autoDropTarget && isTemporarilyAvoidedDropTarget(state, state.autoDropTarget)) {
        state.autoDropTarget = resolveAutoDropTarget(state, partHint(state.grabbedItem));
    }
    const target = computeDropTarget(state);
    if (!target || !reserveDropTarget(state, target)) return null;
    state.activeDropTarget = target.clone();
    state.lockedDropTarget = target.clone();
    return target;
}

`+s.slice(d);
fs.writeFileSync(p,s);
p='babylon/cobot/placement.ts';s=fs.readFileSync(p,'utf8');
s="import { releaseDropReservation } from './reservations';\n"+s;
s=s.replaceAll('state.lockedDropTarget || currentDropTarget(state)', 'currentDropTarget(state)');
s=s.replaceAll('state.grabbedItem = null;', 'state.grabbedItem = null;\n                        releaseDropReservation(state);');
fs.writeFileSync(p,s);
p='babylon/cobot/motion.ts';s=fs.readFileSync(p,'utf8');
s=s.replace('        state.lastSafeIkTarget.copyFrom(state.ikTarget);\n    } else if (isRunning && pickupContactOverride)', '        if (!hit && !partHit && !state.safetyStopped) state.lastSafeIkTarget.copyFrom(state.ikTarget);\n    } else if (isRunning && pickupContactOverride)');
fs.writeFileSync(p,s);
// Track each part by object identity so deletion/reset releases its motion history.
p='babylon/cobot/pickupTargets.ts';s=fs.readFileSync(p,'utf8');
s=s.replace('new Map<string, { pos: Vector3; t: number; vel: Vector3 }>()', 'new WeakMap<SimItem, { pos: Vector3; t: number; vel: Vector3 }>()');
s=s.replaceAll('itemMotionTracker.get(item.id)', 'itemMotionTracker.get(item)').replaceAll('itemMotionTracker.set(item.id,', 'itemMotionTracker.set(item,');
fs.writeFileSync(p,s);
