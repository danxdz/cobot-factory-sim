import { Vector3 } from '@babylonjs/core';
import { SimItem,simState } from '../../simState';
import { factoryStore } from '../../store';
import { computeYieldTargetFromSensors } from './collision';
import { COBOT_YIELD_HOLD_SEC,MOVE_ENDPOINT_TOLERANCE,MOVE_HARD_STALL_TIMEOUT,MOVE_STALL_CLOSE_TOLERANCE,MOVE_UNREACHABLE_PROJECTION_TOLERANCE } from './constants';
import { computeDropTarget,getOrganizedDropTarget,getSelfPlatformDropTarget,resolveAutoDropTarget,selfSortPreferences } from './dropTargets';
import { clampTargetAboveSupports,driveTileAt,itemFootprintHit,partHint,slotCaptureRadius } from './geometry';
import { clamp,projectTargetToReachEnvelope } from './math';
import { PartLike,partRadiusForSpec } from './partGeometry';
import { tickPickup } from './pickup';
import { bestDetectionForItem,canReachPickupCandidate,isPickupCandidateCovered,nearbyPickupPenalty,partMatchesPickFilters,pickupAimPoint,pickupCandidateStepDistance } from './pickupTargets';
import { tickPlacement } from './placement';
import { currentPickWaitTarget,nextProgramActionIndex } from './programTargets';
import type { CobotState } from './stateTypes';
import { logCobotEvent,logStatusReason } from './telemetry';
import { pickupSpaceBusy } from './neighbors';

export function findPickupCandidateForStep(
    state: CobotState,
    stepPos: Vector3,
    mountPos: Vector3,
    L1: number,
    L2: number,
    L3: number,
    hasDrop: boolean
): SimItem | null {
    const candidates = simState.items
        .filter(i => {
            if (i.state !== 'free') return false;
            if (!partMatchesPickFilters(state, i)) return false;
            if (isPickupCandidateCovered(i)) return false;
            if ((state.skippedTargetIds[i.id] ?? 0) > state.simTime) return false;
            const onDrive = !!driveTileAt(i.pos.x, i.pos.z, state.obstacles);
            const isOnTable = state.obstacles.some(o => o.type === 'table' && itemFootprintHit(o, i.pos.x, i.pos.z, 0));
            const stepDist = pickupCandidateStepDistance(state, i, stepPos);
            const partR = partRadiusForSpec(i);
            let pickWindow = onDrive
                ? Math.max(0.85, partR + 0.45)
                : Math.max(0.62, partR + 0.24);
            if (isOnTable) {
                pickWindow = Math.max(1.5, pickWindow); // Cover the entire table
            }
            if (stepDist > pickWindow) return false;
            if (!canReachPickupCandidate(state, i, mountPos, L1, L2, L3)) return false;
            return hasDrop || resolveAutoDropTarget(state, partHint(i)) !== null;
        })
        .map(i => {
            const stepDist = pickupCandidateStepDistance(state, i, stepPos);
            const driveTile = driveTileAt(i.pos.x, i.pos.z, state.obstacles);
            const movingPenalty = driveTile ? ((driveTile.config?.speed || 2) * 0.08) : 0;
            const detection = bestDetectionForItem(state, i);
            const hasPickFilter = state.pickColors.length > 0 || state.pickSizes.length > 0;
            const visionPenalty = hasPickFilter && detection ? (1 - (detection?.confidence ?? 0)) * 0.4 : 0;
            const edgePenalty = detection ? detection.planarOffset * 0.08 : 0;
            return {
                item: i,
                score: stepDist + nearbyPickupPenalty(i) + movingPenalty + visionPenalty + edgePenalty - i.pos.y * 0.28,
            };
        })
        .sort((a, b) => a.score - b.score);
    return candidates[0]?.item ?? null;
}

export function acquirePickupTarget(state: CobotState, item: SimItem) {
    item.state = 'targeted';
    state.targetedItem = item;
    state.targetTimer = 0;
    state.waitTimer = 0;
    state.blockedTimer = 0;
    state.lockedPickupTarget = null;
    state.lockedPickupItemId = null;
    state.lockedPickupUntil = 0;
    const initialOnDrive = !!driveTileAt(item.pos.x, item.pos.z, state.obstacles);
    if (!initialOnDrive) {
        state.lockedPickupTarget = pickupAimPoint(state, item).clone();
        state.lockedPickupItemId = item.id;
        state.lockedPickupUntil = state.simTime + 0.8;
    }
    state.phase = 'pick_hover';
    logCobotEvent(state, 'target_acquired', `item=${item.id} color=${item.color} size=${item.size}`);
}

export function nearestSelfSlotIndex(state: CobotState, x: number, z: number, maxDist = 0.34): number {
    let bestIdx = -1;
    let bestDistSq = maxDist * maxDist;
    for (let i = 0; i < state.stackSlots.length; i++) {
        const slot = state.stackSlots[i];
        const dx = slot.worldPos.x - x;
        const dz = slot.worldPos.z - z;
        const distSq = dx * dx + dz * dz;
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestIdx = i;
        }
    }
    return bestIdx;
}

export function findItemToOrganize(state: CobotState) {
    const reachRadius = 2.4; // Cobot max reach
    state.mountBase.computeWorldMatrix(true);
    const mountPos = state.mountBase.getAbsolutePosition();
    const allItems = simState.items.filter(i => i.state === 'free');
    const selfSort = selfSortPreferences(state);

    // First rule: when idle-organize is enabled, keep own platform sorted whenever possible.
    if ((selfSort.sortColor || selfSort.sortSize || selfSort.sortShape) && state.stackSlots.length > 0) {
        let bestTask: {
            item: SimItem;
            sortColor: boolean;
            sortSize: boolean;
            sortShape: boolean;
            dropPos: [number, number, number];
            score: number;
        } | null = null;
        for (const item of allItems) {
            if (Vector3.Distance(mountPos, item.pos) > reachRadius) continue;
            if (nearestSelfSlotIndex(state, item.pos.x, item.pos.z) < 0) continue;
            const dropTarget = getSelfPlatformDropTarget(
                state,
                selfSort.sortColor,
                selfSort.sortSize,
                selfSort.sortShape,
                partHint(item),
                item
            );
            if (!dropTarget) continue;
            const planar = Math.sqrt((item.pos.x - dropTarget.x) ** 2 + (item.pos.z - dropTarget.z) ** 2);
            const vertical = Math.abs(item.pos.y - dropTarget.y);
            const needMove = planar > 0.09 || vertical > 0.05;
            if (!needMove) continue;
            const score = planar * 2 + vertical + Vector3.Distance(item.pos, mountPos) * 0.05;
            if (!bestTask || score > bestTask.score) {
                bestTask = {
                    item,
                    sortColor: selfSort.sortColor,
                    sortSize: selfSort.sortSize,
                    sortShape: selfSort.sortShape,
                    dropPos: [dropTarget.x, dropTarget.y, dropTarget.z],
                    score
                };
            }
        }
        if (bestTask) {
            return {
                item: bestTask.item,
                sortColor: bestTask.sortColor,
                sortSize: bestTask.sortSize,
                sortShape: bestTask.sortShape,
                dropPos: bestTask.dropPos,
            };
        }
    }

    // Find matching destinations first
    const dests = factoryStore.getState().placedItems.filter(p =>
        ['receiver', 'table', 'pile', 'indexed_receiver'].includes(p.type) &&
        (p.config?.acceptColor !== 'any' || p.config?.acceptSize !== 'any') &&
        Vector3.Distance(mountPos, new Vector3(p.position[0], mountPos.y, p.position[2])) < reachRadius + 0.5
    );

    for (const item of allItems) {
        if (Vector3.Distance(mountPos, item.pos) > reachRadius) continue;

        // Is it already on a valid matching destination?
        let isNeat = false;
        for (const dest of dests) {
            const matchesColor = !dest.config?.acceptColor || dest.config.acceptColor === 'any' || dest.config.acceptColor === item.color;
            const matchesSize = !dest.config?.acceptSize || dest.config.acceptSize === 'any' || dest.config.acceptSize === item.size;

            if (matchesColor && matchesSize) {
                const dx = item.pos.x - dest.position[0];
                const dz = item.pos.z - dest.position[2];
                const destW = dest.config?.machineSize?.[0] || dest.config?.tableSize?.[0] || 2;
                const destD = dest.config?.machineSize?.[1] || dest.config?.tableSize?.[1] || 2;
                if (Math.abs(dx) <= destW / 2 + 0.1 && Math.abs(dz) <= destD / 2 + 0.1) {
                    isNeat = true;
                    break;
                }
            }
        }

        if (isNeat) continue; // Already neatly on some matching destination!

        // Find a valid destination for this item with an actual free/matching drop slot.
        for (const dest of dests) {
            const matchesColor = !dest.config?.acceptColor || dest.config.acceptColor === 'any' || dest.config.acceptColor === item.color;
            const matchesSize = !dest.config?.acceptSize || dest.config.acceptSize === 'any' || dest.config.acceptSize === item.size;
            if (matchesColor && matchesSize) {
                const sortColor = !!dest.config?.acceptColor && dest.config.acceptColor !== 'any';
                const sortSize = !!dest.config?.acceptSize && dest.config.acceptSize !== 'any';
                const sortShape = true;
                const dropTarget = getOrganizedDropTarget(
                    state,
                    dest,
                    sortColor,
                    sortSize,
                    sortShape,
                    partHint(item),
                    item
                );
                if (!dropTarget) continue;
                return {
                    item,
                    dest,
                    sortColor,
                    sortSize,
                    sortShape,
                    dropPos: [dropTarget.x, dropTarget.y, dropTarget.z] as [number, number, number],
                };
            }
        }
    }
    return null;
}

export function tickProgram(state: CobotState, delta: number, isRunning: boolean, mountPos: Vector3, L1: number, L2: number, L3: number) {
    if (state.program.length > 0) {
        if (state.phase === 'manual') {
            state.phase = 'idle';
            state.waitTimer = 0;
            state.targetTimer = 0;
            state.blockedTimer = 0;
            state.motionStallTimer = 0;
            state.desiredTarget.copyFrom(state.ikTarget);
            state.plannedPath = [state.ikTarget.clone()];
            state.plannedPathCursor = 0;
            state.precalculatedPath = [state.ikTarget.clone()];
            state.lockedFlowGoal.copyFrom(state.ikTarget);
            state.lockedFlowPhase = 'idle';
            if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
            state.targetedItem = null;
        }
        const step = state.program[state.stepIndex % state.program.length];
        const stepPos = step.pos ? new Vector3(step.pos[0], step.pos[1], step.pos[2]) : state.idleTarget;
        const isMoveAction = step.action === 'move';

        // Only override the target globally if we are in the initial 'idle' approach phase.
        // Once we enter specific phases (lift, pick_hover, etc.), they manage their own desiredTarget.
            if (state.phase === 'idle') {
                if (isMoveAction) {
                    state.desiredTarget.copyFrom(stepPos);
                    state.targetSource = 'program';
                } else if (step.action === 'pick') {
                    state.desiredTarget.copyFrom(currentPickWaitTarget(state) ?? state.idleTarget);
                    state.targetSource = 'program';
            } else if (step.action === 'drop') {
                const hoverY = Math.max(stepPos.y + 0.24, state.position[1] + 0.92);
                state.desiredTarget.set(stepPos.x, hoverY, stepPos.z);
                state.targetSource = 'program';
            } else if (step.action === 'wait') {
                state.desiredTarget.copyFrom(step.pos ? stepPos : state.ikTarget);
            }
        }

        const pickPhaseActive =
            state.phase === 'pick_hover' ||
            state.phase === 'pick_descend' ||
            state.phase === 'pick_attach';
        const precisePhase = state.phase === 'pick_descend' || state.phase === 'descend_drop';

        let reachRadius = 0.18;
        if (state.phase === 'pick_descend' || state.phase === 'descend_drop') reachRadius = 0.08;
        else if (state.phase === 'lift' || state.phase === 'transit_drop') reachRadius = 0.35;
        else if (state.phase === 'hover_drop' || state.phase === 'idle' || state.phase === 'drop_recenter') reachRadius = 0.12;
        if (isMoveAction && state.phase === 'idle') reachRadius = 0.08;

        const reachMax = L1 + L2 - 0.02;
        const reachGoal = projectTargetToReachEnvelope(state.desiredTarget, mountPos, state.position[1] + 0.1, reachMax, L3);

        const dx = reachGoal.x - state.ikTarget.x;
        const dy = reachGoal.y - state.ikTarget.y;
        const dz = reachGoal.z - state.ikTarget.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);
        const distY = Math.abs(dy);
        const dist3D = Vector3.Distance(state.ikTarget, reachGoal);
        const movePrecisionGoal = isMoveAction
            ? clampTargetAboveSupports(state, reachGoal.clone(), state.phase, !!state.grabbedItem)
            : reachGoal;
        state.gripperTip.computeWorldMatrix(true);
        const actualTip = state.gripperTip.getAbsolutePosition();
        const moveTipDist = isMoveAction ? Vector3.Distance(actualTip, movePrecisionGoal) : Number.POSITIVE_INFINITY;
        const reachRadiusXZ = 0.035;
        const reachRadiusY = 0.045;
        const isReachedMovePrecise = isMoveAction && state.phase === 'idle' && moveTipDist <= MOVE_ENDPOINT_TOLERANCE;
        const isReachedNormal = isMoveAction ? isReachedMovePrecise : (dist3D < reachRadius);
        const isReachedPrecise = distXZ < reachRadiusXZ && distY < reachRadiusY;

        const isReached = precisePhase ? isReachedPrecise : isReachedNormal;

        // Stuck/Stalled Detection
        const ikMoving = state.ikVelocity.length() > 0.008;
        const isStalled = !isReached && !ikMoving && isRunning;

        // SIMPLIFICATION: If we are stalled but very close to goal, consider it "reached"
        // to prevent the robot from fighting its own safety fields forever.
        const closeEnoughStallRadius = isMoveAction ? MOVE_STALL_CLOSE_TOLERANCE : 0.42;
        const isCloseEnoughStall = isStalled && dist3D < closeEnoughStallRadius;

        // Pickup deadlines measure elapsed acquisition time, not motion stalls.
        // The pickup phases increment this timer themselves.
        if (!pickPhaseActive) {
            if (isStalled && !isCloseEnoughStall) state.targetTimer += delta;
            else state.targetTimer = Math.max(0, state.targetTimer - delta * 1.5);
        }
        state.stalledInternal = isStalled && state.targetTimer > 1.2;

        const stallTimeout = isMoveAction
            ? clamp(1.2 + dist3D * 0.9, 1.2, 3.8)
            : 3.5;
        const moveProjectionError = isMoveAction ? Vector3.Distance(stepPos, reachGoal) : 0;
        const moveLikelyUnreachable = isMoveAction && moveProjectionError > MOVE_UNREACHABLE_PROJECTION_TOLERANCE;
        const moveTimeoutForce = isMoveAction && (
            (moveLikelyUnreachable && state.targetTimer > 0.25) ||
            state.targetTimer > Math.max(MOVE_HARD_STALL_TIMEOUT, stallTimeout)
        );
        // For move points, avoid coarse "close enough" auto-complete. Non-move phases keep safety fallback.
        const forceReached = isMoveAction ? moveTimeoutForce : isCloseEnoughStall;
        const finalReached = isReached || forceReached;

        if (forceReached && !isCloseEnoughStall) {
            state.targetTimer = 0;
            logCobotEvent(state, 'reach_stall', `forced_next dist=${dist3D.toFixed(2)}`);
        }

        if (!pickPhaseActive || !state.targetedItem || state.lockedPickupItemId !== state.targetedItem.id) {
            state.lockedPickupTarget = null;
            state.lockedPickupItemId = null;
            state.lockedPickupUntil = 0;
        }

        const STACK_R = slotCaptureRadius(state.stackSlots.map(sl => sl.worldPos), 0.24);
        const slotItems = state.stackSlots.map(sl =>
            simState.items.filter(i =>
                i.state !== 'dead' && i.state !== 'grabbed' &&
                Math.sqrt((i.pos.x - sl.worldPos.x) ** 2 + (i.pos.z - sl.worldPos.z) ** 2) < STACK_R
            )
        );
        const slotCounts = slotItems.map(items => items.length);
        const allFull = slotCounts.every((c, i) => c >= state.stackSlots[i].maxStack);
        state.isFull = allFull;
        const hasDrop = state.program.some(s => s.action === 'drop');

        const getAutoSlot = (part: { color: string } & PartLike): Vector3 | null => {
            return resolveAutoDropTarget(state, part);
        };
        switch (state.phase) {
            case 'idle':
                state.targetSource = 'program';
                if (step.action === 'wait') {
                    // If wait has no pos, stay at current ikTarget
                    if (step.pos) state.desiredTarget.copyFrom(stepPos);
                    else state.desiredTarget.copyFrom(state.ikTarget);
                }
                // Move/Pick hover targets are already set at top of tick
                if (state.yieldTarget && state.simTime < state.yieldUntil) {
                    state.targetSource = 'yield';
                    state.desiredTarget.copyFrom(state.yieldTarget);
                    break;
                }
                state.gripperOpen = !state.grabbedItem;
                const cooperativeYield = computeYieldTargetFromSensors(state, mountPos);
	                if (cooperativeYield) {
	                    state.yieldTarget = cooperativeYield;
	                    state.yieldUntil = state.simTime + COBOT_YIELD_HOLD_SEC;
	                    state.desiredTarget.copyFrom(cooperativeYield);
	                    break;
	                }
	                if (step.action === 'pick' && !state.grabbedItem && !allFull) {
	                    const incoming = findPickupCandidateForStep(state, stepPos, mountPos, L1, L2, L3, hasDrop);
		                    if (incoming) {
		                        if (pickupSpaceBusy(state, incoming.pos)) {
                                    state.targetSource = 'yield';
                                    state.desiredTarget.copyFrom(state.idleTarget);
                                    logStatusReason(state, 'neighbor_pickup_busy', 'Waiting for neighboring pickup to clear');
                                    break;
                                }
		                        acquirePickupTarget(state, incoming);
		                        break;
		                    }
		                    state.desiredTarget.copyFrom(currentPickWaitTarget(state) ?? state.idleTarget);
		                }
	                if (state.grabbedItem && step.action === 'pick') {
                    const nextDropIndex = nextProgramActionIndex(state, 'drop');
                    if (!hasDrop && !state.autoDropTarget) {
                        state.autoDropTarget = getAutoSlot(partHint(state.grabbedItem));
                    }
                    if (hasDrop && nextDropIndex !== null) {
                        state.phase = 'next';
                        logCobotEvent(state, 'drop_resume', 'redirect_from_idle_with_grabbed_item');
                        break;
                    }
                    if (!hasDrop && state.autoDropTarget) {
                        state.phase = 'transit_drop';
                        logCobotEvent(state, 'drop_resume', 'auto_drop_from_idle_with_grabbed_item');
                        break;
                    }
                }
                if (step.action === 'move' && moveLikelyUnreachable) {
                    // Unreachable taught move point: skip quickly instead of stalling for seconds.
                    state.phase = 'next';
                    state.waitTimer = 0;
                    state.targetTimer = 0;
                    logCobotEvent(
                        state,
                        'reach_stall',
                        `forced_next_unreachable proj_err=${moveProjectionError.toFixed(3)}`
                    );
                    break;
                }
                if (finalReached) {
                    if (step.action === 'move') {
                        state.phase = 'next';
                        state.waitTimer = 0;
                    } else if (step.action === 'wait') {
                        state.phase = 'wait_step';
                        state.waitTimer = 0;
	                    } else if (step.action === 'pick') {
		                        if (state.waitTimer > 0) {
		                            state.waitTimer = Math.max(0, state.waitTimer - delta);
		                            state.desiredTarget.copyFrom(currentPickWaitTarget(state) ?? state.idleTarget);
		                            state.targetTimer = 0;
		                            break;
		                        }
                        if (!hasDrop && allFull) break;
	                        const it = findPickupCandidateForStep(state, stepPos, mountPos, L1, L2, L3, hasDrop);
	                        if (it) {
	                            acquirePickupTarget(state, it);
                        } else {
                            let foundValidPick = false;
                            for (let offset = 1; offset < state.program.length; offset++) {
                                const nextIdx = (state.stepIndex + offset) % state.program.length;
                                const nextStep = state.program[nextIdx];
                                if (nextStep.action === 'pick' && nextStep.pos) {
                                    const nPos = new Vector3(nextStep.pos[0], nextStep.pos[1], nextStep.pos[2]);
	                                    const hasPart = findPickupCandidateForStep(state, nPos, mountPos, L1, L2, L3, hasDrop) !== null;
                                    if (hasPart) {
                                        state.stepIndex = nextIdx;
                                        foundValidPick = true;
                                        break;
                                    }
                                }
                            }
                            if (foundValidPick) {
                                break;
                            }
		                            // No candidate right now: hold at the taught pick wait pose and retry shortly.
		                            state.desiredTarget.copyFrom(currentPickWaitTarget(state) ?? state.idleTarget);
	                            state.targetTimer = 0;
                            state.waitTimer = Math.min(0.25, state.waitTimer + delta);
                            break;
                        }
                    } else if (step.action === 'drop') {
                        if (!state.grabbedItem) {
                            state.activeDropTarget = null;
                            state.stepIndex++;
                            break;
                        }
                        state.activeDropTarget = computeDropTarget(state);
                        state.phase = 'hover_drop';
                        state.waitTimer = 0;
                    }
                }
                break;
            case 'wait_step':
                state.waitTimer += delta;
                if (state.waitTimer >= (step.duration ?? 0.4)) {
                    state.waitTimer = 0;
                    state.phase = 'next';
                }
                break;
            case 'pick_hover':
            case 'pick_descend':
            case 'pick_attach':
                tickPickup({ state, delta, stepPos, mountPos, L1, L2, L3, hasDrop, getAutoSlot });
                break;
            case 'pick_recenter':
            case 'lift':
            case 'transit_drop':
            case 'hover_drop':
            case 'descend_drop':
            case 'release':
            case 'drop_recenter':
                tickPlacement({ state, delta, actualTip, hasDrop, getAutoSlot, STACK_R, finalReached });
                break;
            case 'next':
                state.activeDropTarget = null;
                state.stepIndex++;
                if (state.program.length > 0 && !state.isAutoProgram) {
                    state.stepIndex = state.stepIndex % state.program.length;
                }
                state.targetTimer = 0; // CRITICAL: Reset safety timeout for the NEW step
                state.blockedTimer = 0;
                state.stalledInternal = false;
                if (state.isAutoProgram && state.stepIndex >= state.program.length) {
                    state.program = [];
                    state.isAutoProgram = false;
                    state.stepIndex = 0;
                    state.blockedTimer = 0;
                    state.targetTimer = -0.6;
                    if (state.lastDroppedItemId) {
                        state.skippedTargetIds[state.lastDroppedItemId] = state.simTime + 1.4;
                        state.lastDroppedItemId = undefined;
                    }
                }
                state.phase = 'idle';
                state.retreatTimer = 0;
                state.retreatTarget = null;
                state.yieldUntil = 0;
                state.yieldTarget = null;
                state.targetSource = 'program';
                break;
        }
    } else {
        if (isRunning) logStatusReason(state, 'no_program', 'program_len=0');
        state.targetTimer = 0; // Reset timer when no program is active
        if (state.autoOrganize && state.phase === 'idle' && state.simTime % 1.0 < 0.05) {
            const org = findItemToOrganize(state);
            if (org) {
                state.lastDroppedItemId = undefined;
                state.program = [
                    { action: 'pick', pos: [org.item.pos.x, org.item.pos.y, org.item.pos.z] },
                    { action: 'drop', pos: org.dropPos, sortColor: org.sortColor, sortSize: org.sortSize, sortShape: org.sortShape }
                ];
                state.isAutoProgram = true;
                state.stepIndex = 0;
                state.targetTimer = 0;
            } else {
                state.desiredTarget.copyFrom(state.idleTarget);
                state.targetTimer = -0.2;
                state.blockedTimer += delta;
            }
        } else {
            state.desiredTarget.copyFrom(state.idleTarget);
            if (state.phase === 'idle') state.blockedTimer += delta;
        }
    }


}
