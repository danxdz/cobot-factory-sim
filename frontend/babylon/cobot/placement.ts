import { Vector3 } from '@babylonjs/core';
import { DISC_H,DROP_HOVER_CLEARANCE,DROP_RECENTER_CLEARANCE,PICK_HOVER_CLEARANCE } from './constants';
import { captureDropExitTarget,computeDropTarget,currentDropTarget,dropPlacementState,resolveAutoDropTarget } from './dropTargets';
import { carriedPayloadHeight,dropBaseCenterY,dropObstacles,itemFootprintHit,partHint,quantizeHeight,stackAwareClearanceAt,stackCenterYAt,supportTopAt } from './geometry';
import { PartLike,partHalfHeight } from './partGeometry';
import { carryTravelY,currentDropAnchor,currentPickAnchor,nextPickWaitTarget,nextProgramActionIndex } from './programTargets';
import { releaseDropReservation } from './reservations';
import { projectCobotTarget } from './reach';
import type { CobotState } from './stateTypes';
import { logCobotEvent } from './telemetry';

export function tickPlacement(context: { state: CobotState; delta: number; actualTip: Vector3; hasDrop: boolean; getAutoSlot: (part: { color: string } & PartLike) => Vector3 | null; STACK_R: number; finalReached: boolean }) {
    const { state, delta, actualTip, hasDrop, getAutoSlot, STACK_R, finalReached } = context;
    switch (state.phase) {
            case 'pick_recenter': {
                state.waitTimer += delta;
                const pickAnchor = currentPickAnchor(state);
                if (!pickAnchor) {
                    state.phase = 'lift';
                    state.waitTimer = 0;
                    break;
                }
                const supportTop = supportTopAt(pickAnchor.x, pickAnchor.z, state.obstacles);
                const hoverY = Math.max(
                    pickAnchor.y + PICK_HOVER_CLEARANCE,
                    supportTop + PICK_HOVER_CLEARANCE,
                    state.position[1] + 1.12
                );
                // Clear neighboring parts with the loaded tool before leaving
                // the pickup area. A low taught point can otherwise stop the
                // peel inside the collision envelope and trap recovery there.
                const peelY = Math.max(hoverY, supportTop + carriedPayloadHeight(state) + 0.12,
                    stackAwareClearanceAt(state, state.ikTarget.x, state.ikTarget.z, true));
                state.desiredTarget.set(state.ikTarget.x, peelY, state.ikTarget.z);
                if (actualTip.y >= peelY - 0.035) {
                    state.phase = 'lift';
                    state.waitTimer = 0;
                }
                break;
            }
            case 'lift': {
                const nextDropIndex = nextProgramActionIndex(state, 'drop');
                const nextDropTarget = nextDropIndex !== null
                    ? new Vector3(
                        state.program[nextDropIndex].pos![0],
                        state.program[nextDropIndex].pos![1],
                        state.program[nextDropIndex].pos![2]
                    )
                    : state.autoDropTarget;
                const travelY = carryTravelY(state, nextDropTarget);
                // Clear the pickup support before beginning horizontal travel.
                state.desiredTarget.set(state.ikTarget.x, travelY, state.ikTarget.z);
                state.targetSource = 'program';
                if (actualTip.y >= travelY - 0.05) {
                    if (!hasDrop) {
                        if (!state.autoDropTarget && state.grabbedItem) {
                            state.autoDropTarget = getAutoSlot(partHint(state.grabbedItem));
                        }
                        if (state.autoDropTarget) {
                            state.phase = 'transit_drop';
                        }
                        // Keep holding at clearance height until a slot is free.
                    } else if (nextDropIndex !== null) {
                        const nextIndex = (state.stepIndex + 1) % state.program.length;
                        if (state.program[nextIndex].action === 'drop') {
                            state.stepIndex = nextIndex;
                            state.phase = 'transit_drop';
                        } else {
                            // Taught move/wait steps are part of the carry route.
                            state.phase = 'next';
                        }
                    } else state.phase = 'next';
                }
                break;
            }
            case 'transit_drop': {
                const tgt = currentDropTarget(state);
                if (!tgt) {
                    state.activeDropTarget = null;
                    state.phase = state.grabbedItem ? 'transit_drop' : 'next';
                    state.desiredTarget.copyFrom(state.ikTarget);
                    state.gripperOpen = !state.grabbedItem;
                    break;
                }
                // Lock the target immediately to prevent slot-switching during transit/hover
                if (!state.lockedDropTarget) state.lockedDropTarget = tgt.clone();

                const travelY = carryTravelY(state, tgt);
                state.desiredTarget.set(tgt.x, travelY, tgt.z);
                // High travel poses lose horizontal reach. Once the reachable
                // staging pose is reached, hover can lower toward the station.
                if (Vector3.Distance(actualTip, projectCobotTarget(state, state.desiredTarget)) < 0.18) {
                    state.phase = 'hover_drop';
                    state.waitTimer = 0;
                }
                break;
            }
            case 'hover_drop': {
                const tgt = currentDropTarget(state);
                if (!tgt) {
                    state.activeDropTarget = null;
                    state.phase = state.grabbedItem ? 'transit_drop' : 'next';
                    state.desiredTarget.copyFrom(state.ikTarget);
                    state.gripperOpen = !state.grabbedItem;
                    break;
                }
                const selfDrop = !!(state.selfItem && itemFootprintHit(state.selfItem, tgt.x, tgt.z, 0.08));
                const partHalf = state.grabbedItem ? partHalfHeight(state.grabbedItem) : DISC_H / 2;
                const landingCenterY = stackCenterYAt(tgt.x, tgt.z, dropBaseCenterY(state, tgt, state.grabbedItem ?? undefined), state.grabbedItem ?? { shape: 'disc', size: 'medium' }, state.grabbedItem, STACK_R);
                const targetClearance = stackAwareClearanceAt(state, tgt.x, tgt.z, true);
                const safeHoverY = quantizeHeight(
                    Math.max(
                        landingCenterY + partHalf + (selfDrop ? 0.18 : DROP_HOVER_CLEARANCE),
                        targetClearance + (selfDrop ? 0.04 : -0.06),
                        state.position[1] + (selfDrop ? 0.98 : 0.88)
                    ),
                    0.03
                );
                state.desiredTarget.set(tgt.x, safeHoverY, tgt.z);
                if (Vector3.Distance(actualTip, state.desiredTarget) < 0.12) {
                    state.lockedDropTarget = tgt.clone();
                    state.phase = 'descend_drop';
                    state.waitTimer = 0;
                }
                break;
            }
            case 'descend_drop': {
                state.waitTimer += delta;
                const tgt = currentDropTarget(state);
                const placement = dropPlacementState(state);
                if (!tgt || !placement) {
                    state.activeDropTarget = null;
                    state.phase = state.grabbedItem ? 'transit_drop' : 'next';
                    state.desiredTarget.copyFrom(state.ikTarget);
                    state.gripperOpen = !state.grabbedItem;
                    break;
                }
                
	                const partHalf = state.grabbedItem ? partHalfHeight(state.grabbedItem) : DISC_H / 2;
	                // Place the carried part center on the landing height by commanding the gripper tip above it.
	                const safeDropY = quantizeHeight(
                            placement.landingY + partHalf + 0.006,
	                    0.01
	                );
	                state.desiredTarget.set(tgt.x, safeDropY, tgt.z);
                
                // Final stack contact speed is handled by the phase cruise speed below.

	                state.gripperTip.computeWorldMatrix(true);
	                const tipNow = state.gripperTip.getAbsolutePosition();
	                const tipPlanar = Math.sqrt((tipNow.x - placement.target.x) ** 2 + (tipNow.z - placement.target.z) ** 2);
	                const centerYError = Math.abs((tipNow.y - partHalf - 0.001) - placement.landingY);
	                const preciseDropAligned =
	                    tipPlanar <= Math.max(placement.partR * 0.5, 0.12) &&
	                    centerYError <= 0.065;
	                if (placement.touching || (preciseDropAligned && state.waitTimer > 0.08) || (finalReached && state.waitTimer > 0.18)) { 
	                    state.phase = 'release'; 
	                    state.waitTimer = 0; 
	                } else if (state.waitTimer > 2.0 && !preciseDropAligned) {
	                    logCobotEvent(
	                        state,
	                        'drop_retry',
	                        `descend_not_aligned planar=${tipPlanar.toFixed(3)} yErr=${centerYError.toFixed(3)}`
	                    );
	                    state.phase = 'hover_drop';
	                    state.waitTimer = 0;
	                    state.plannedPath = [];
	                    state.plannedPathCursor = 0;
	                }
	                break;
	            }
            case 'release':
                state.waitTimer += delta;
                const placement = dropPlacementState(state);
                if (!placement) {
                    state.activeDropTarget = null;
                    state.phase = state.grabbedItem ? 'transit_drop' : 'next';
                    state.desiredTarget.copyFrom(state.ikTarget);
                    state.gripperOpen = !state.grabbedItem;
                    break;
                }
                const part = state.grabbedItem;
                const partHalf = part ? partHalfHeight(part) : DISC_H / 2;
                // Transit clears walls; the final vertical approach reaches the
                // actual landing surface. Wall height here prevents release.
                const releaseApproachY = placement.landingY + partHalf + 0.008;
                const releaseTgt = state.lockedDropTarget || placement.target;
                state.desiredTarget.set(releaseTgt.x, releaseApproachY, releaseTgt.z);
                state.gripperTip.computeWorldMatrix(true);
                const tipNow = state.gripperTip.getAbsolutePosition();
	                const tipPlanar = Math.sqrt((tipNow.x - placement.target.x) ** 2 + (tipNow.z - placement.target.z) ** 2);
	                const tipCenterY = tipNow.y - partHalf - 0.001;
	                const centerYError = Math.abs(tipCenterY - placement.landingY);
	                const preciseReleasePlanar = Math.max(placement.partR * 0.42, 0.105);
	                const retryReleasePlanar = Math.max(placement.partR * 0.62, 0.15);
	                const precisePlaceReady = !!part
	                    && tipPlanar <= preciseReleasePlanar
	                    && centerYError <= 0.035;
	                const relaxedPlaceReady = !!part
	                    && tipPlanar <= retryReleasePlanar
	                    && centerYError <= 0.065
	                    && state.waitTimer > 0.14;
	                if ((placement.touching || precisePlaceReady || relaxedPlaceReady) && state.waitTimer > 0.06) {
	                    state.gripperOpen = true;
	                    if (state.grabbedItem) {
	                        state.lastDroppedItemId = state.grabbedItem.id;
	                        state.grabbedItem.pos.set(placement.target.x, placement.landingY, placement.target.z);
	                        state.grabbedItem.state = 'free';
                        // Snappy 20mm lift first to clear the part, then calculate full exit path
                        const safeReleaseLiftY = placement.landingY + partHalf + 0.02;
                        captureDropExitTarget(state, safeReleaseLiftY);
                        
                        logCobotEvent(
                            state,
                            'drop_success',
                            `target=(${placement.target.x.toFixed(2)},${placement.target.z.toFixed(2)}) planar=${tipPlanar.toFixed(3)} yErr=${centerYError.toFixed(3)} releaseY=${safeReleaseLiftY.toFixed(3)}`
                        );
                        state.dropReplanStreak = 0;
                        state.lastReplanTargetKey = '';
                        state.avoidDropTarget = null;
                        state.avoidDropUntil = 0;
                        state.grabbedItem = null;
                        releaseDropReservation(state);
                    }
                    state.autoDropTarget = null;
                    state.activeDropTarget = null;
                    state.phase = 'drop_recenter';
                    state.waitTimer = 0;
                    state.plannedPath = [];
                    state.plannedPathCursor = 0;
                    state.lockedFlowPhase = '';
                    state.lockedDropTarget = null;
                } else {
                    state.gripperOpen = false;
		                    if (state.waitTimer > 1.15) {
		                        if (part) {
		                            if (tipPlanar <= Math.max(placement.partR * 0.82, 0.2) && centerYError <= 0.095) {
	                                state.lastDroppedItemId = part.id;
	                                part.pos.set(placement.target.x, placement.landingY, placement.target.z);
	                                part.state = 'free';
                                captureDropExitTarget(state, Math.max(placement.landingY, part.pos.y + partHalfHeight(part)));
                                logCobotEvent(state, 'drop_success', `forced_release=1 target=(${placement.target.x.toFixed(2)},${placement.target.z.toFixed(2)})`);
                                state.dropReplanStreak = 0;
                                state.lastReplanTargetKey = '';
                                state.avoidDropTarget = null;
                                state.avoidDropUntil = 0;
	                                state.grabbedItem = null;
                        releaseDropReservation(state);
	                                state.autoDropTarget = null;
	                                state.activeDropTarget = null;
	                                state.phase = 'drop_recenter';
	                                state.waitTimer = 0;
                                    state.plannedPath = [];
                                    state.plannedPathCursor = 0;
                                    state.lockedFlowPhase = '';
                                    state.lockedDropTarget = null;
	                                break;
	                            }
                            state.avoidDropTarget = placement.target.clone();
                            state.avoidDropUntil = state.simTime + 2.6;
                            const alt = resolveAutoDropTarget(state, partHint(part));
                            if (alt && Vector3.Distance(alt, placement.target) > 0.18) {
                                const altKey = `${alt.x.toFixed(2)},${alt.z.toFixed(2)}`;
                                state.dropReplanStreak += 1;
	                                state.lastReplanTargetKey = altKey;
	                                if (state.dropReplanStreak >= 3) {
	                                    logCobotEvent(state, 'drop_retry', `replan_limit_keep_part target=(${placement.target.x.toFixed(2)},${placement.target.z.toFixed(2)})`);
	                                    state.dropReplanStreak = 0;
	                                    state.lastReplanTargetKey = '';
	                                    state.avoidDropTarget = null;
	                                    state.avoidDropUntil = 0;
	                                    state.activeDropTarget = placement.target.clone();
	                                    state.lockedDropTarget = placement.target.clone();
	                                    state.phase = 'hover_drop';
	                                    state.waitTimer = 0;
	                                    state.plannedPath = [];
	                                    state.plannedPathCursor = 0;
	                                    break;
	                                }
                                const hasDropStep = state.program.some(s => s.action === 'drop');
                                if (!hasDropStep) {
                                    state.autoDropTarget = alt.clone();
                                }
                                state.activeDropTarget = alt.clone();
                                state.lockedDropTarget = alt.clone();
                                state.waitTimer = 0;
	                                state.phase = 'hover_drop';
	                                logCobotEvent(state, 'drop_replan', `alt_target=(${alt.x.toFixed(2)},${alt.z.toFixed(2)})`);
	                            } else {
	                                logCobotEvent(
	                                    state,
	                                    'drop_retry',
	                                    `release_not_aligned planar=${tipPlanar.toFixed(3)} yErr=${centerYError.toFixed(3)}`
	                                );
	                                state.dropReplanStreak += 1;
	                                state.activeDropTarget = placement.target.clone();
	                                state.lockedDropTarget = placement.target.clone();
	                                state.phase = 'hover_drop';
	                                state.waitTimer = 0;
	                                state.plannedPath = [];
	                                state.plannedPathCursor = 0;
	                            }
                        } else {
                            state.waitTimer = 0;
                            state.activeDropTarget = computeDropTarget(state);
                            state.phase = 'hover_drop';
                            logCobotEvent(state, 'drop_retry', 'missing_part_recomputed_target');
                        }
                    }
                }
                break;
            case 'drop_recenter': {
                state.waitTimer += delta;
                const exitTarget = state.lockedDropTarget ?? state.dropExitTarget ?? currentDropAnchor(state);
                const waitTarget = nextPickWaitTarget(state) ?? state.idleTarget;
                if (!exitTarget && !waitTarget) {
                    state.phase = 'next';
                    state.waitTimer = 0;
                    break;
                }
                const releaseClearY = exitTarget
                    ? Math.max(
                        exitTarget.y,
                        supportTopAt(exitTarget.x, exitTarget.z, dropObstacles(state)) + DROP_RECENTER_CLEARANCE,
                        stackAwareClearanceAt(state, exitTarget.x, exitTarget.z, false) + 0.06
                    )
                    : state.position[1] + 0.92;
                state.desiredTarget.set(
                    waitTarget.x,
                    Math.max(waitTarget.y, releaseClearY, state.position[1] + 0.92),
                    waitTarget.z
                );
                state.targetSource = 'program';

                if ((finalReached && state.waitTimer > 0.12) || state.waitTimer > 2.4) {
                    state.dropExitTarget = null;
                    state.phase = 'next';
                    state.waitTimer = 0;
                }
                break;
            }

    }
}
