import { Vector3 } from '@babylonjs/core';
import { simState } from '../../simState';
import { cobotDefaultAngles,cobotForearmLength,cobotUpperArmLength,cobotWristLength } from './cobotConfig';
import { collectArmSamples,collisionSafetyEnabled } from './collision';
import { COBOT_FOREARM_LENGTH,COBOT_GRIPPER_TIP_OFFSET,COBOT_HAND_LINK_LENGTH,COBOT_MOUNT_REACH_OFFSET,COBOT_UPPER_ARM_LENGTH,COBOT_WRIST_LINK_LENGTH,OVERDRIVE_DECAY_PER_SEC } from './constants';
import { advanceMotion } from './motion';
import { partHalfHeight } from './partGeometry';
import { tickProgram } from './program';
import { tickRecovery } from './recovery';
import { releaseDropReservation } from './reservations';
import type { CobotState } from './stateTypes';
import { applyTuningElementHighlight,flushPhaseLog,logStatusReason } from './telemetry';

export function tickCobot(state: CobotState, delta: number, isRunning: boolean): boolean {
    if (!isRunning && !(state.manualControl && state.manualTarget) &&
        !state.tuningMode && state.selfItem?.config?.cobotTuningMode !== true) {
        // Pausing must preserve the phase, reservation, and simulation deadlines.
        state.ikVelocity.setAll(0);
        return state.safetyStopped;
    }
    let L1 = cobotUpperArmLength(state.selfItem?.config);
    let L2 = cobotForearmLength(state.selfItem?.config);
    let L3 = cobotWristLength(state.selfItem?.config) + COBOT_HAND_LINK_LENGTH + COBOT_GRIPPER_TIP_OFFSET; // Keep IK reach matched to the visible wrist/tool mesh.
    if (!Number.isFinite(L1) || L1 <= 0) L1 = COBOT_UPPER_ARM_LENGTH;
    if (!Number.isFinite(L2) || L2 <= 0) L2 = COBOT_FOREARM_LENGTH;
    if (!Number.isFinite(L3) || L3 <= 0) L3 = COBOT_WRIST_LINK_LENGTH + COBOT_HAND_LINK_LENGTH + COBOT_GRIPPER_TIP_OFFSET;
    if (!state.grabbedItem) releaseDropReservation(state);
    state.simTime += delta;
    state.isOutOfRange = false;
    if (state.yieldUntil > 0 && state.simTime >= state.yieldUntil) {
        state.yieldUntil = 0;
        state.yieldTarget = null;
    }
    if (state.avoidDropUntil > 0 && state.simTime >= state.avoidDropUntil) {
        state.avoidDropUntil = 0;
        state.avoidDropTarget = null;
    }
    state.overdriveScore = Math.max(0, state.overdriveScore - OVERDRIVE_DECAY_PER_SEC * delta);
    state.pathReplanCooldown = Math.max(0, state.pathReplanCooldown - delta);

    // Force world matrices before any absolute-position reads used by IK.
    state.root.computeWorldMatrix(true);
    state.mountBase.computeWorldMatrix(true);
    state.basePivot.computeWorldMatrix(true);
    const basePivotPos = state.basePivot.getAbsolutePosition().clone();
    const mountBasePos = state.mountBase.getAbsolutePosition().clone();
    const finiteVec = (v: Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    const mountPos = finiteVec(basePivotPos)
        ? basePivotPos
        : (finiteVec(mountBasePos)
            ? mountBasePos
            : new Vector3(state.position[0], state.position[1] + COBOT_MOUNT_REACH_OFFSET, state.position[2]));
    mountPos.y += 0.05; // shoulder mount lift above base pivot

    const manualModeActive = state.manualControl && !!state.manualTarget;
    const tuningMode = state.tuningMode || state.selfItem?.config?.cobotTuningMode === true;
    const isStopped = state.selfItem?.config?.isStopped;
    const collisionsOn = !tuningMode && collisionSafetyEnabled(state);
    applyTuningElementHighlight(state);

    if (manualModeActive) {
        state.phase = 'manual';
        state.targetSource = 'manual';
        state.desiredTarget.copyFrom(state.manualTarget!);
        state.plannedPath = [state.ikTarget.clone(), state.manualTarget!.clone()];
        state.plannedPathCursor = 1;
        state.safetySpeedFactor = 1;
    } else if (tuningMode) {
        state.targetSource = 'tuning';
        logStatusReason(state, 'tuning_mode', 'tuning_mode=1');
        const defAngles = cobotDefaultAngles(state.selfItem?.config);
        state.phase = 'manual';
        state.gripperOpen = true;
        state.basePivot.rotation.y = 0;
        state.shoulder.rotation.x = defAngles.shoulder;
        state.elbow.rotation.x = defAngles.elbow;
        state.wrist.rotation.x = defAngles.wrist;
        state.handPitch.rotation.x = 0;
        state.wristRoll.rotation.y = state.currentWristRoll;
        state.ikVelocity.setAll(0);
        state.blockedTimer = 0;
        state.motionStallTimer = 0;
        state.partContactTimer = 0;
        if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
        state.targetedItem = null;
        state.activeDropTarget = null;
        state.retreatTarget = null;
        state.retreatTimer = 0;
        state.safetyStopped = false;
        state.reducedSpeedActive = false;
        state.safetySpeedFactor = 1;
        state.wristRoll.computeWorldMatrix(true);
        const wristPos = state.wristRoll.getAbsolutePosition();
        if (state.selfItem?.id) {
            simState.cobotWrists[state.selfItem.id] = wristPos.clone();
            simState.cobotArmSamples[state.selfItem.id] = collectArmSamples(state);
            simState.cobotLoads[state.selfItem.id] = !!state.grabbedItem;
        }
        state.gripperTip.computeWorldMatrix(true);
        const tip = state.gripperTip.getAbsolutePosition();
        state.ikTarget.copyFrom(tip);
        state.desiredTarget.copyFrom(tip);
        state.lastProbePos.copyFrom(tip);
        state.targetTimer = 0; // Reset stall timer during tuning
        if (state.grabbedItem) {
            state.grabbedItem.pos.set(tip.x, tip.y - partHalfHeight(state.grabbedItem) - 0.001, tip.z);
            state.grabbedItem.rotY = state.currentWristRoll;
        }
        flushPhaseLog(state);
        return false;
    } else if (isStopped) {
        state.ikVelocity.setAll(0);
        return state.safetyStopped;
    } else if (collisionsOn && state.safetyStopped) {
        return tickRecovery(state, delta, mountPos, L1, L2, L3);
    } else if (!state.autoOrganize && state.isAutoProgram && !state.grabbedItem) {
        logStatusReason(state, 'auto_organize_disabled', 'autoOrganize=0 while autoProgram=1');
        if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
        state.targetedItem = null;
        state.grabbedItem = null;
        state.autoDropTarget = null;
        state.activeDropTarget = null;
        state.retreatTarget = null;
        state.retreatTimer = 0;
        state.recoveryAttempts = 0;
        state.program = [];
        state.isAutoProgram = false;
        state.stepIndex = 0;
        state.phase = 'idle';
        state.desiredTarget.copyFrom(state.idleTarget);
        state.ikVelocity.setAll(0);
        state.plannedPath = [state.ikTarget.clone(), state.idleTarget.clone()];
        state.plannedPathCursor = 1;
        state.plannedPathGoal.copyFrom(state.idleTarget);
        state.plannedPathPhase = 'idle';
        state.precalculatedPath = state.plannedPath.map(p => p.clone());
        state.lockedFlowGoal.copyFrom(state.idleTarget);
        state.lockedFlowPhase = 'idle';
        state.lockedPickupTarget = null;
        state.lockedPickupItemId = null;
        state.lockedPickupUntil = 0;
        state.yieldTarget = null;
        state.yieldUntil = 0;
        state.avoidDropTarget = null;
        state.avoidDropUntil = 0;
        state.dropExitTarget = null;
        flushPhaseLog(state);
        return false;
    } else {
        tickProgram(state, delta, isRunning, mountPos, L1, L2, L3);
    }

    if (state.retreatTimer > 0 && state.retreatTarget) {
        state.retreatTimer = Math.max(0, state.retreatTimer - delta);
        state.desiredTarget = Vector3.Lerp(state.desiredTarget, state.retreatTarget, 0.9);
        if (state.targetedItem) state.targetTimer = Math.max(0, state.targetTimer - delta * 0.4);
        if (state.retreatTimer <= 0) {
            state.retreatTarget = null;
            state.pathReplanCooldown = Math.max(state.pathReplanCooldown, 0.28);
        }
    } else if (state.recoveryAttempts > 0 && state.blockedTimer < 0.01) {
        state.recoveryAttempts = Math.max(0, state.recoveryAttempts - delta * 0.25);
    }

    if (state.grabbedItem) state.gripperOpen = false;
    return advanceMotion(state, delta, isRunning, mountPos, L1, L2, L3, collisionsOn);
}
