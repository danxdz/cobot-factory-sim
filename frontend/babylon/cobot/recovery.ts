import { Vector3 } from '@babylonjs/core';
import { armHitsObstacle,armHitsPart } from './collision';
import { solvePose } from './kinematics';
import { releasePickup,resetExecution } from './lifecycle';
import { partHalfHeight } from './partGeometry';
import type { CobotState } from './stateTypes';
import { flushPhaseLog } from './telemetry';

/** Retrace toward the last collision-free target at a bounded recovery speed. */
export function tickRecovery(state: CobotState, delta: number, mountPos: Vector3, L1: number, L2: number, L3: number): boolean {
    if (state.phase !== 'recovery') {
        releasePickup(state);
        state.recoveryElapsed = 0;
        state.ikVelocity.setAll(0);
        state.phase = 'recovery';
    }
    state.recoveryElapsed += delta;
    state.desiredTarget.copyFrom(state.lastSafeIkTarget);
    state.plannedPath = [state.ikTarget.clone(), state.lastSafeIkTarget.clone()];
    state.plannedPathCursor = 1;
    const distance = Vector3.Distance(state.ikTarget, state.lastSafeIkTarget);
    if (state.recoveryElapsed <= 4 && distance > 0.001) {
        const travel = Math.min(distance, delta * 0.3);
        state.ikTarget = Vector3.Lerp(state.ikTarget, state.lastSafeIkTarget, travel / distance);
        solvePose(state, delta, mountPos, L1, L2, L3);
    }
    if (state.grabbedItem) {
        state.gripperTip.computeWorldMatrix(true);
        const tip = state.gripperTip.getAbsolutePosition();
        state.grabbedItem.pos.set(tip.x, tip.y - partHalfHeight(state.grabbedItem) - 0.001, tip.z);
    }
    if (state.recoveryElapsed > 0.3 && !armHitsObstacle(state, state.obstacles) && !armHitsPart(state)) {
        state.safetyStopped = false;
        resetExecution(state);
    }
    flushPhaseLog(state);
    return state.safetyStopped;
}
