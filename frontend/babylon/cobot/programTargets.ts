import { Vector3 } from '@babylonjs/core';
import { ProgramStep } from '../../types';
import { COBOT_PLATFORM_TOP_Y,PICK_HOVER_CLEARANCE } from './constants';
import { carriedPayloadHeight,dropBaseCenterY,quantizeHeight,segmentClearanceY,stackAwareClearanceAt,stackCenterYAt,supportTopAt } from './geometry';
import { PartLike,partHalfHeight } from './partGeometry';
import type { CobotState } from './stateTypes';

export function currentProgramStep(state: CobotState): ProgramStep | null {
    if (state.program.length === 0) return null;
    return state.program[state.stepIndex % state.program.length] ?? null;
}

export function currentPickAnchor(state: CobotState): Vector3 | null {
    const step = currentProgramStep(state);
    if (!step || step.action !== 'pick' || !step.pos) return null;
    return new Vector3(step.pos[0], step.pos[1], step.pos[2]);
}

export function pickWaitTargetForStep(state: CobotState, step: ProgramStep | null | undefined): Vector3 | null {
    if (!step || step.action !== 'pick' || !step.pos) return null;
    const anchor = new Vector3(step.pos[0], step.pos[1], step.pos[2]);
    const supportTop = supportTopAt(anchor.x, anchor.z, state.obstacles);
    const waitY = Math.max(
        anchor.y + PICK_HOVER_CLEARANCE,
        supportTop + PICK_HOVER_CLEARANCE,
        state.position[1] + 0.92
    );
    return new Vector3(anchor.x, quantizeHeight(waitY, 0.03), anchor.z);
}

export function currentPickWaitTarget(state: CobotState): Vector3 | null {
    return pickWaitTargetForStep(state, currentProgramStep(state));
}

export function nextPickWaitTarget(state: CobotState): Vector3 | null {
    const idx = nextProgramActionIndex(state, 'pick');
    return idx === null ? null : pickWaitTargetForStep(state, state.program[idx]);
}

export function currentDropAnchor(state: CobotState): Vector3 | null {
    const step = currentProgramStep(state);
    if (step && step.action === 'drop' && step.pos) {
        return new Vector3(step.pos[0], step.pos[1], step.pos[2]);
    }
    // No explicit DROP step: recenter above own platform center.
    if (!state.program.some(s => s.action === 'drop')) {
        return autoDropAnchor(state);
    }
    return null;
}

export function autoDropAnchor(state: CobotState): Vector3 | null {
    if (!state.selfItem) return null;
    const centerX = state.selfItem.position[0];
    const centerZ = state.selfItem.position[2];
    const partSpec: PartLike = state.grabbedItem ?? { shape: 'disc', size: 'medium' };
    const partHalf = partHalfHeight(partSpec);
    const centerBase = dropBaseCenterY(state, new Vector3(centerX, 0, centerZ), partSpec);
    const centerStack = stackCenterYAt(centerX, centerZ, centerBase, partSpec, state.grabbedItem, 0.34);
    const dynamicAnchorY = Math.max(
        state.selfItem.position[1] + COBOT_PLATFORM_TOP_Y + partHalf + 0.14,
        centerStack + partHalf + 0.16,
        stackAwareClearanceAt(state, centerX, centerZ, !!state.grabbedItem) + 0.04,
        state.position[1] + 0.92
    );
    return new Vector3(
        centerX,
        quantizeHeight(dynamicAnchorY, 0.03),
        centerZ
    );
}

export function nextProgramActionIndex(state: CobotState, action: ProgramStep['action']): number | null {
    if (state.program.length === 0) return null;
    for (let offset = 1; offset <= state.program.length; offset++) {
        const idx = (state.stepIndex + offset) % state.program.length;
        if (state.program[idx]?.action === action) return idx;
    }
    return null;
}

export function carryTravelY(state: CobotState, target: Vector3 | null): number {
    const payloadHeight = carriedPayloadHeight(state);
    const baseClearance = state.position[1] + 0.92 + payloadHeight;
    const currentClearance = state.ikTarget.y;
    if (!target) return quantizeHeight(Math.max(baseClearance, currentClearance), 0.05);
    const targetClearance = segmentClearanceY(state, state.ikTarget, target, true);
    return quantizeHeight(Math.max(baseClearance, currentClearance, targetClearance), 0.05);
}
