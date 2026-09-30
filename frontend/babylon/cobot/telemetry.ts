import { Color3 } from '@babylonjs/core';
import { appendCobotLog } from '../../simState';
import type { CobotState } from './stateTypes';

export type ParsedCobotDetail = {
    reason?: string;
    itemId?: string;
    mode?: string;
    durationSec?: number;
    snapDist?: number;
    planarDist?: number;
    verticalDist?: number;
};

export function parseCobotDetail(detail?: string): ParsedCobotDetail {
    if (!detail) return {};
    const parsed: ParsedCobotDetail = {};
    const itemMatch = detail.match(/\bitem=([^\s]+)/);
    if (itemMatch) parsed.itemId = itemMatch[1];
    const modeMatch = detail.match(/\bmode=([^\s]+)/);
    if (modeMatch) parsed.mode = modeMatch[1];
    const tMatch = detail.match(/\bt=([0-9.]+)s\b/);
    if (tMatch) parsed.durationSec = Number(tMatch[1]);
    const snapMatch = detail.match(/\bsnap=([0-9.]+)/);
    if (snapMatch) parsed.snapDist = Number(snapMatch[1]);
    const planarMatch = detail.match(/\bplanar=([0-9.]+)/);
    if (planarMatch) parsed.planarDist = Number(planarMatch[1]);
    const verticalMatch = detail.match(/\bv=([0-9.]+)/);
    if (verticalMatch) parsed.verticalDist = Number(verticalMatch[1]);
    const firstToken = detail.trim().split(/\s+/)[0] || '';
    if (firstToken && !firstToken.includes('=')) parsed.reason = firstToken;
    return parsed;
}

export function logCobotEvent(state: CobotState, event: string, detail?: string) {
    if (!state.selfItem?.id) return;
    if (event === 'motion_trace') {
        if (state.simTime - (state.lastMotionTraceAt ?? -Infinity) < 0.2) return;
        state.lastMotionTraceAt = state.simTime;
    }
    const parsed = parseCobotDetail(detail);
    const currentStep = state.program[state.stepIndex % state.program.length];
    appendCobotLog(state.selfItem.id, {
        ts: Date.now(),
        simTime: state.simTime,
        phase: state.phase,
        event,
        detail,
        ikTarget: [state.ikTarget.x, state.ikTarget.y, state.ikTarget.z],
        desiredTarget: [state.desiredTarget.x, state.desiredTarget.y, state.desiredTarget.z],
        targetSource: state.targetSource || 'unknown',
        stepIndex: state.stepIndex,
        programLen: state.program.length,
        stepAction: currentStep?.action,
        stepPos: currentStep?.pos ? [currentStep.pos[0], currentStep.pos[1], currentStep.pos[2]] : null,
        ...parsed,
    });
}

export function flushPhaseLog(state: CobotState) {
        if (state.phase !== state.lastLoggedPhase) {
            logCobotEvent(state, 'phase_change', `${state.lastLoggedPhase} -> ${state.phase}`);
            state.lastLoggedPhase = state.phase;
        }
    }

export function logStatusReason(state: CobotState, key: string, detail: string) {
        if (state.lastStatusReasonKey === key && (state.simTime - state.lastStatusReasonAt) < 1.25) return;
        logCobotEvent(state, 'status_reason', detail);
        state.lastStatusReasonKey = key;
        state.lastStatusReasonAt = state.simTime;
    }

export function applyTuningElementHighlight(state: CobotState) {
    const tuningActive = state.tuningMode || state.selfItem?.config?.cobotTuningMode === true;
    const selected = state.selfItem?.config?.cobotTuningSelectedElement;
    const active = tuningActive ? (selected ?? 'shoulder') : '';
    
    if (state.lastTuningHighlightKey === active) return;
    state.lastTuningHighlightKey = active;
    const glow = Color3.FromHexString('#22d3ee');
    for (const [key, meshes] of Object.entries(state.tuningHighlightTargets)) {
        const on = key === active;
        for (const m of meshes) {
            m.renderOutline = on;
            m.outlineWidth = on ? 0.035 : 0;
            m.outlineColor = glow;
        }
    }
}
