import fs from 'node:fs';
const path='babylon/cobot/motion.ts';
let s=fs.readFileSync(path,'utf8');
const a=s.indexOf('    const cx = state.ikTarget.x');
const b=s.indexOf('    // Hard surface guard:',a);
const ik=s.slice(a,b);
s=s.slice(0,a)+'    solvePose(state, delta, mountPos, L1, L2, L3);\n\n'+s.slice(b);
s="import { solvePose } from './kinematics';\n"+s;
fs.writeFileSync(path,s);
fs.writeFileSync('babylon/cobot/kinematics.ts', `import { Vector3 } from '@babylonjs/core';
import type { CobotState } from './stateTypes';
import { cobotShoulderLimits, cobotElbowLimits, cobotWristLimits } from './cobotConfig';
import { COBOT_BASE_MAX_ANGULAR_SPEED, IK_BASE_CLEARANCE_RADIUS, COBOT_PEDESTAL_SAFEZONE_RADIUS } from './constants';
import { clamp } from './math';
import { normalizeAngle } from './geometry';

export function solvePose(state: CobotState, delta: number, mountPos: Vector3, L1: number, L2: number, L3: number) {
    const shoulderLimits = cobotShoulderLimits(state.selfItem?.config);
    const elbowLimits = cobotElbowLimits(state.selfItem?.config);
    const wristLimits = cobotWristLimits(state.selfItem?.config);
    const precisePhase = state.phase === 'pick_descend' || state.phase === 'pick_attach' || state.phase === 'descend_drop';
${ik}
}
`);
