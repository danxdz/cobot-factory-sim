import { Vector3 } from '@babylonjs/core';
import { simState } from '../../simState';
import type { PlacedItem } from '../../types';
import type { CobotState } from './stateTypes';

export function releasePickup(state: CobotState) {
    if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
    state.targetedItem = null;
    state.lockedPickupTarget = null;
    state.lockedPickupItemId = null;
    state.lockedPickupUntil = 0;
}

export function resetExecution(state: CobotState) {
    releasePickup(state);
    if (state.selfItem) delete simState.dropReservations[state.selfItem.id];
    state.phase = 'idle';
    state.stepIndex = 0;
    state.waitTimer = 0;
    state.targetTimer = 0;
    state.blockedTimer = 0;
    state.motionStallTimer = 0;
    state.partContactTimer = 0;
    state.recoveryTimer = 0;
    state.recoveryAttempts = 0;
    state.retreatTimer = 0;
    state.retreatTarget = null;
    state.yieldTarget = null;
    state.yieldUntil = 0;
    state.activeDropTarget = null;
    state.autoDropTarget = null;
    state.lockedDropTarget = null;
    state.dropExitTarget = null;
    state.plannedPath = [];
    state.plannedPathCursor = 0;
    state.ikVelocity.setAll(0);
    state.desiredTarget.copyFrom(state.ikTarget);
}

/** Synchronize configuration without overwriting generated work or live safety state. */
export function syncCobotConfig(state: CobotState, item: PlacedItem) {
    const config = item.config ?? {};
    const signature = JSON.stringify(config.program ?? []);
    if (signature !== state.configuredProgramSignature) {
        resetExecution(state);
        state.program = config.program ?? [];
        state.isAutoProgram = false;
        state.configuredProgramSignature = signature;
    }
    state.selfItem = item;
    state.speed = config.speed ?? 1;
    state.pickColors = config.pickColors ?? [];
    state.pickSizes = config.pickSizes ?? [];
    state.linkedCameraIds = config.linkedCameraIds ?? [];
    state.autoOrganize = config.autoOrganize === true;
    state.idleTarget.copyFrom(config.cobotHomeTarget
        ? new Vector3(...config.cobotHomeTarget)
        : new Vector3(item.position[0], item.position[1] + 2.2, item.position[2]));
    const manual = config.cobotManualControl === true;
    const tuning = config.cobotTuningMode === true;
    if ((manual && !state.manualControl) || (tuning && !state.tuningMode)) {
        resetExecution(state);
        state.safetyStopped = false;
    }
    state.manualControl = manual;
    state.tuningMode = tuning;
    state.manualTarget = config.cobotManualTarget ? new Vector3(...config.cobotManualTarget) : null;
    if (config.triggerUnlock && state.lastUnlockTime !== config.triggerUnlock) {
        state.lastUnlockTime = config.triggerUnlock;
        resetExecution(state);
        state.safetyStopped = false;
    }
    if (config.cobotCollisionEnabled === false) {
        state.safetyStopped = false;
        state.blockedTimer = 0;
        state.partContactTimer = 0;
        state.safetySpeedFactor = 1;
        state.reducedSpeedActive = false;
        if (state.phase === 'recovery') resetExecution(state);
    }
}

/** Release ownership before disposing meshes; physics can settle a held part. */
export function disposeCobotState(state: CobotState) {
    releasePickup(state);
    if (state.grabbedItem?.state === 'grabbed') state.grabbedItem.state = 'free';
    state.grabbedItem = null;
    const id = state.selfItem?.id;
    if (!id) return;
    simState.cobotStates.delete(id);
    delete simState.dropReservations[id];
    delete simState.cobotWrists[id];
    delete simState.cobotArmSamples[id];
    delete simState.cobotLoads[id];
    delete simState.cobotLogs[id];
}
