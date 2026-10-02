import { Vector3 } from '@babylonjs/core';
import { cobotElbowLimits,cobotShoulderLimits,cobotWristLimits } from './cobotConfig';
import { COBOT_BASE_MAX_ANGULAR_SPEED,COBOT_PEDESTAL_SAFEZONE_RADIUS,IK_BASE_CLEARANCE_RADIUS } from './constants';
import { normalizeAngle } from './geometry';
import { clamp } from './math';
import type { CobotState } from './stateTypes';
import { responseBlend } from './motionProfile';

export function solvePose(state: CobotState, delta: number, mountPos: Vector3, L1: number, L2: number, L3: number) {
    const shoulderLimits = cobotShoulderLimits(state.selfItem?.config);
    const elbowLimits = cobotElbowLimits(state.selfItem?.config);
    const wristLimits = cobotWristLimits(state.selfItem?.config);
    const precisePhase = state.phase === 'pick_descend' || state.phase === 'pick_attach' || state.phase === 'descend_drop';
    const cx = state.ikTarget.x - mountPos.x;
    const cz = state.ikTarget.z - mountPos.z;
    const cDist = Math.sqrt(cx * cx + cz * cz);
    const baseClearanceRadius = Math.max(IK_BASE_CLEARANCE_RADIUS, COBOT_PEDESTAL_SAFEZONE_RADIUS);
    const minC = baseClearanceRadius;
    if (cDist < minC && cDist > 0.001) {
        const push = minC - cDist;
        state.ikTarget.x += (cx / cDist) * push;
        state.ikTarget.z += (cz / cDist) * push;
    }

    // ── 2-link IK (verified against kyn.js) ──────────────────────────────
    const tx = state.ikTarget.x - mountPos.x;
    const ty = state.ikTarget.y - mountPos.y;
    const tz = state.ikTarget.z - mountPos.z;

    const worldYaw = Math.atan2(tx, tz);
    // Solve yaw for the same Cartesian point as shoulder/elbow. Aiming the base
    // at a later waypoint swings the real tool away from the planned trajectory.
    const baseTargetYaw = normalizeAngle(worldYaw - state.baseRotY);
    const baseYawDelta = normalizeAngle(baseTargetYaw - state.basePivot.rotation.y);
    const baseMaxStep = COBOT_BASE_MAX_ANGULAR_SPEED * clamp(state.speed, 0.35, 1.1) * delta;
    state.basePivot.rotation.y = normalizeAngle(
        state.basePivot.rotation.y + clamp(baseYawDelta, -baseMaxStep, baseMaxStep)
    );

    // Wrist joint target (L3 points straight down), with self-clearance around base axis.
    let wx = tx;
    const wy = ty + L3;
    let wz = tz;

    const rawPlanarDist = Math.sqrt(wx * wx + wz * wz);
    if (rawPlanarDist > 0.0001 && rawPlanarDist < baseClearanceRadius) {
        const scale = baseClearanceRadius / rawPlanarDist;
        wx *= scale;
        wz *= scale;
    } else if (rawPlanarDist <= 0.0001) {
        wz = baseClearanceRadius;
    }

    const planarDist = Math.sqrt(wx * wx + wz * wz);
    const reach = Math.sqrt(planarDist * planarDist + wy * wy);
    const clampedR = Math.min(reach, L1 + L2 - 0.01);

    const elbowDen = Math.max(0.0001, 2 * L1 * L2);
    const cosE = clamp((clampedR * clampedR - L1 * L1 - L2 * L2) / elbowDen, -1, 1);
    const elbowAngle = Math.acos(cosE);

    const alpha2 = Math.atan2(wy, planarDist);
    const shoulderDen = Math.max(0.0001, 2 * Math.max(0.0001, clampedR) * L1);
    const beta2 = Math.acos(clamp((clampedR * clampedR + L1 * L1 - L2 * L2) / shoulderDen, -1, 1));

    const sh = clamp(Math.PI / 2 - alpha2 - beta2, shoulderLimits.min, shoulderLimits.max);
    const el = clamp(elbowAngle, elbowLimits.min, elbowLimits.max);
    const wr = Math.PI - sh - el;
    const toolNormalPhase = precisePhase || !!state.grabbedItem;
    const targetToolNormalBlend = toolNormalPhase ? 1.0 : 0.0;

    if (state.toolNormalBlend === undefined) state.toolNormalBlend = targetToolNormalBlend;
    state.toolNormalBlend += (targetToolNormalBlend - state.toolNormalBlend) * responseBlend(12 * state.speed, delta);

    const blend = state.toolNormalBlend;
    const wristPitch = clamp(wr * (0.72 + 0.28 * blend), wristLimits.min, wristLimits.max);
    const handPitchAngle = clamp(wr * (0.28 - 0.28 * blend), -wristLimits.max, wristLimits.max);

    state.shoulder.rotation.x = sh;
    state.elbow.rotation.x = el;
    state.wrist.rotation.x = wristPitch;
    state.handPitch.rotation.x = handPitchAngle;

    // Wrist roll
    let rd = state.wristRollTarget - state.currentWristRoll;
    while (rd < -Math.PI) rd += Math.PI * 2;
    while (rd > Math.PI) rd -= Math.PI * 2;
    state.currentWristRoll += rd * responseBlend(12 * state.speed, delta);
    state.wristRoll.rotation.y = state.currentWristRoll;


}
