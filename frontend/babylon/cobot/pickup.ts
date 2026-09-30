import { Vector3 } from '@babylonjs/core';
import { PICK_ALIGN_RADIUS,PICK_ANCHOR_MAX_OFFSET,PICK_ANCHOR_MIN_OFFSET,PICK_GRAB_RADIUS,PICK_HOVER_CLEARANCE,PICK_LEAD_TIME,PICK_SKIP_COOLDOWN,PICK_TARGET_LOCK_DURATION,PICK_TARGET_LOCK_ENTER_RADIUS } from './constants';
import { PICK_HAND_CONTACT_TOLERANCE } from './contactConstants';
import { driveTileAt,partHint,supportTopAt } from './geometry';
import { clamp } from './math';
import { PartLike,partHalfHeight,partRadiusForSpec } from './partGeometry';
import { canLatchByProximity,clampTargetAroundAnchorXZ,currentPickTimeout,movingPickupWindowRadius,pickupAimPoint,pickupContactState,pickupContactTipY,pickupLatchPlanarRadius,pickupLatchVerticalRadius } from './pickupTargets';
import { currentPickAnchor } from './programTargets';
import type { CobotState } from './stateTypes';
import { logCobotEvent } from './telemetry';

export function tickPickup(context: { state: CobotState; delta: number; stepPos: Vector3; mountPos: Vector3; L1: number; L2: number; L3: number; hasDrop: boolean; getAutoSlot: (part: { color: string } & PartLike) => Vector3 | null }) {
    const { state, delta, stepPos, mountPos, L1, L2, L3, hasDrop, getAutoSlot } = context;
    switch (state.phase) {
            case 'pick_hover': {
                if (state.targetedItem?.state === 'targeted') {
                    state.targetTimer += delta;
                    const pickTimeout = currentPickTimeout(state);
                    const pickAnchor = currentPickAnchor(state) ?? stepPos;
                    const rawTarget = pickupAimPoint(state, state.targetedItem);
                    const partR = partRadiusForSpec(state.targetedItem);
                    const targetOnDriveNow = !!driveTileAt(state.targetedItem.pos.x, state.targetedItem.pos.z, state.obstacles);
	                    const catchRadius = targetOnDriveNow
	                        ? movingPickupWindowRadius(partR)
	                        : clamp(partR * 2.2, PICK_ANCHOR_MIN_OFFSET, PICK_ANCHOR_MAX_OFFSET);
	                    const driftFromAnchor = Vector3.Distance(rawTarget, pickAnchor);
	                    const targetLost = driftFromAnchor > catchRadius + (targetOnDriveNow ? 0.78 : 0.32);
                    const stallRecoveryInProgress = state.blockedTimer > 0.12 || state.motionStallTimer > 0.12 || state.partContactTimer > 0.18;
                    if (targetLost && !targetOnDriveNow && !stallRecoveryInProgress) {
                        state.targetTimer += delta * 1.4;
                    }
		                    const target = targetOnDriveNow
                        ? clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius)
                        : rawTarget.clone();
                    const supportTop = supportTopAt(target.x, target.z, state.obstacles);
                    const hoverClearance = Math.max(PICK_HOVER_CLEARANCE, partR * 0.46);
                    const hoverY = Math.max(target.y + hoverClearance, supportTop + hoverClearance);
                    state.desiredTarget.set(target.x, hoverY, target.z);
                    const reachDist = Math.sqrt(
                        (target.x - mountPos.x) * (target.x - mountPos.x) +
                        (target.z - mountPos.z) * (target.z - mountPos.z) +
                        (hoverY + L3 - mountPos.y) * (hoverY + L3 - mountPos.y)
                    );
                    const reachSlack = targetOnDriveNow ? 0.26 : 0.14;
                    const isUnreachable = reachDist > (L1 + L2 + reachSlack);

                    state.gripperTip.computeWorldMatrix(true);
                    const tip = state.gripperTip.getAbsolutePosition();
                    const dx = tip.x - target.x;
                    const dz = tip.z - target.z;
                    const planar = Math.sqrt(dx * dx + dz * dz);
                    const itemDx = tip.x - state.targetedItem.pos.x;
                    const itemDz = tip.z - state.targetedItem.pos.z;
                    const itemPlanar = Math.sqrt(itemDx * itemDx + itemDz * itemDz);
                    if (!targetOnDriveNow && planar < PICK_TARGET_LOCK_ENTER_RADIUS) {
                        state.lockedPickupTarget = target.clone();
                        state.lockedPickupItemId = state.targetedItem.id;
                        state.lockedPickupUntil = state.simTime + Math.max(PICK_TARGET_LOCK_DURATION, 1.1);
                    } else if (targetOnDriveNow) {
                        state.lockedPickupTarget = null;
                        state.lockedPickupItemId = null;
                    }
                    const alignmentBuffer = targetOnDriveNow ? 0.12 : 0.06;
                    const alignTolerance = targetOnDriveNow ? 0.46 : 0.4;
                    const movingYTolerance = targetOnDriveNow ? 0.62 : 0.28;
                    const itemAlignTolerance = targetOnDriveNow ? Math.max(0.62, partR * 2.1) : Math.max(0.52, partR * 1.85);
                    const movingDescendPlanar = clamp(partR * 0.72, 0.16, 0.24);
                    const movingDescendItemPlanar = clamp(partR * 0.95, 0.2, 0.34);
                    const readyPlanar = targetOnDriveNow
                        ? movingDescendPlanar
                        : Math.max(alignTolerance, Math.max(PICK_ALIGN_RADIUS, partR * 1.2) + alignmentBuffer);
                    const readyItemPlanar = targetOnDriveNow ? movingDescendItemPlanar : itemAlignTolerance;
                    const readyYTolerance = targetOnDriveNow ? 0.22 : movingYTolerance;
                    const fastTrackDescend =
                        targetOnDriveNow &&
                        state.targetTimer > 0.42 &&
                        planar < movingDescendPlanar * 0.9 &&
                        itemPlanar < movingDescendItemPlanar &&
                        Math.abs(tip.y - hoverY) < readyYTolerance;
                    const abortForReach = isUnreachable && (!targetOnDriveNow || state.targetTimer > 0.85);
                    if (
                        (
                            planar < readyPlanar &&
                            Math.abs(tip.y - hoverY) < readyYTolerance &&
                            itemPlanar < readyItemPlanar
                        ) ||
                        fastTrackDescend
                    ) {
                        if (!targetOnDriveNow) {
                            state.lockedPickupTarget = target.clone();
                            state.lockedPickupItemId = state.targetedItem.id;
                            state.lockedPickupUntil = state.simTime + 2.5;
                        } else {
                            state.lockedPickupTarget = null;
                            state.lockedPickupItemId = null;
                        }
                        if (fastTrackDescend) {
                            logCobotEvent(state, 'pick_hover_fasttrack', `item=${state.targetedItem.id} planar=${planar.toFixed(2)} t=${state.targetTimer.toFixed(2)}s`);
                        }
                        state.phase = 'pick_descend';
                        state.waitTimer = 0;
                        state.targetTimer = 0;
                        state.blockedTimer = 0;
	                    } else if ((targetOnDriveNow ? state.targetTimer > pickTimeout : state.targetTimer > 2.5) || abortForReach || (!targetOnDriveNow && targetLost && !stallRecoveryInProgress && state.targetTimer > 0.85)) {
                        const timeoutCommitRadius = targetOnDriveNow
                            ? Math.max(0.85, partR * 2.8) // More generous for moving items
                            : Math.max(0.52, partR * 1.35);
                        
                        // If we are aligned to the reach-limited target, but the item is just slightly out of reach
                        // We should commit to a descent anyway if we've waited too long
                        if (!abortForReach && (planar < 0.12 || (state.targetTimer > 3.5 && planar < timeoutCommitRadius))) {
                            if (!targetOnDriveNow) {
                                state.lockedPickupTarget = target.clone();
                                state.lockedPickupItemId = state.targetedItem.id;
                                state.lockedPickupUntil = state.simTime + 1.8;
                            } else {
                                state.lockedPickupTarget = null;
                                state.lockedPickupItemId = null;
                            }
                            state.phase = 'pick_descend';
                            state.waitTimer = 0;
                            state.targetTimer = 0;
                            state.blockedTimer = 0;
                            logCobotEvent(state, 'pick_hover_stall_recovery', `item=${state.targetedItem.id} planar=${planar.toFixed(2)} itemPlanar=${itemPlanar.toFixed(2)}`);
                            break;
                        }
                        const skipCooldown = targetOnDriveNow ? 0.08 : PICK_SKIP_COOLDOWN;
                        const failReason = abortForReach ? 'reach_abort' : 'timeout_hover';
                        logCobotEvent(state, 'pick_fail', `${failReason} item=${state.targetedItem.id} t=${state.targetTimer.toFixed(2)}s`);
                        state.skippedTargetIds[state.targetedItem.id] = state.simTime + skipCooldown;
                        state.targetedItem.state = 'free';
                        state.targetedItem = null;
                        state.targetTimer = 0;
                        state.lockedPickupTarget = null;
                        state.lockedPickupItemId = null;
                        state.lockedPickupUntil = 0;
                        state.phase = 'idle';
                    }
                } else {
                    state.lockedPickupTarget = null;
                    state.lockedPickupItemId = null;
                    state.lockedPickupUntil = 0;
                    state.phase = 'idle';
                }
                break;
            }
            case 'pick_descend': {
                state.waitTimer += delta;
                state.targetTimer += delta;
                const pickTimeout = currentPickTimeout(state);
                let isUnreachable = false;
                let targetOnDriveNow = false;
                let targetLost = false;
                const stallRecoveryInProgress = state.blockedTimer > 0.12 || state.motionStallTimer > 0.12 || state.partContactTimer > 0.18;
                if (state.targetedItem?.state === 'targeted') {
                    const pickAnchor = currentPickAnchor(state) ?? stepPos;
                    const partR = partRadiusForSpec(state.targetedItem);
                    targetOnDriveNow = !!driveTileAt(state.targetedItem.pos.x, state.targetedItem.pos.z, state.obstacles);

                    let target: Vector3;
                    if (targetOnDriveNow) {
	                        const rawTarget = pickupAimPoint(state, state.targetedItem, 0.08);
	                        const catchRadius = movingPickupWindowRadius(partR);
	                        const driftFromAnchor = Vector3.Distance(rawTarget, pickAnchor);
	                        targetLost = driftFromAnchor > catchRadius + 0.78;
	                        if (targetLost && !stallRecoveryInProgress) {
	                            state.targetTimer += delta * 1.4;
	                        }
	                        target = clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius);
                        state.lockedPickupTarget = null;
                        state.lockedPickupItemId = null;
                    } else if (state.lockedPickupTarget && state.lockedPickupItemId === state.targetedItem.id) {
                        target = state.lockedPickupTarget.clone();
                    } else {
                        const rawTarget = pickupAimPoint(state, state.targetedItem, PICK_LEAD_TIME);
                        const catchRadius = clamp(partR * 2.35, PICK_ANCHOR_MIN_OFFSET, PICK_ANCHOR_MAX_OFFSET);
                        const driftFromAnchor = Vector3.Distance(rawTarget, pickAnchor);
                        targetLost = driftFromAnchor > catchRadius + 0.32;
                        if (targetLost && !stallRecoveryInProgress) {
                            state.targetTimer += delta * 1.4;
                        }
                        target = rawTarget.clone();
                        state.lockedPickupTarget = target.clone();
                        state.lockedPickupItemId = state.targetedItem.id;
                    }

	                    const supportTop = supportTopAt(target.x, target.z, state.obstacles);
	                    const targetTop = target.y + partHalfHeight(state.targetedItem);
	                    const pickY = pickupContactTipY(targetTop, supportTop);
	                    const hoverClearance = Math.max(PICK_HOVER_CLEARANCE, partR * 0.46);
	                    const hoverY = Math.max(target.y + hoverClearance, supportTop + hoverClearance);
	                    state.gripperTip.computeWorldMatrix(true);
	                    const tip = state.gripperTip.getAbsolutePosition();
	                    const approachPlanar = Math.hypot(tip.x - target.x, tip.z - target.z);
	                    const descendAlignRadius = targetOnDriveNow
	                        ? clamp(partR * 0.28, 0.065, 0.09)
	                        : clamp(partR * 0.22, 0.05, 0.075);
	                    const descendBlend = clamp(
	                        (descendAlignRadius * 1.65 - approachPlanar) / Math.max(0.001, descendAlignRadius * 0.9),
	                        0,
	                        1
	                    );
	                    const guardedPickY = Math.min(state.ikTarget.y, pickY + (hoverY - pickY) * (1 - descendBlend));
	                    state.desiredTarget.set(target.x, guardedPickY, target.z);

                    // Final approach speed is handled by the phase cruise speed below.

	                    const reachDist = Math.sqrt(
	                        (target.x - mountPos.x) * (target.x - mountPos.x) +
	                        (target.z - mountPos.z) * (target.z - mountPos.z) +
	                        (guardedPickY + L3 - mountPos.y) * (guardedPickY + L3 - mountPos.y)
	                    );
                    const reachSlack = targetOnDriveNow ? 0.24 : 0.12;
                    isUnreachable = reachDist > (L1 + L2 + reachSlack);
                }
		                const contact = pickupContactState(state, state.targetedItem);
			                const contactLatchVertical = pickupLatchVerticalRadius(targetOnDriveNow);
			                const contactLatchPlanar = pickupLatchPlanarRadius(contact.targetRadius, targetOnDriveNow);
	                const latchAligned =
	                    contact.horizontalDist <= contactLatchPlanar &&
	                    contact.padGap >= -PICK_HAND_CONTACT_TOLERANCE &&
	                    contact.padGap <= contactLatchVertical;
		                const abortForReach = isUnreachable && (!targetOnDriveNow || state.waitTimer > 0.5);
		                const closeLatchPlanar = contactLatchPlanar;
		                const closeLatchVertical = contactLatchVertical;
		                const descendLatch = latchAligned && state.targetedItem?.state === 'targeted'
		                    ? canLatchByProximity(state, 
		                        state.targetedItem,
		                        closeLatchPlanar,
		                        closeLatchVertical
		                    )
		                    : null;
		                if (descendLatch?.ok && descendLatch.gripPose && state.targetedItem?.state === 'targeted') {
	                        logCobotEvent(
	                            state,
	                            'pick_grabbed',
	                            `item=${state.targetedItem.id} mode=descend_contact snap=${descendLatch.snapDist.toFixed(3)} planar=${descendLatch.planarDist.toFixed(3)} v=${descendLatch.verticalDist.toFixed(3)}`
	                        );
	                        state.targetedItem.pos.set(descendLatch.gripPose.x, descendLatch.gripPose.y - partHalfHeight(state.targetedItem) - 0.001, descendLatch.gripPose.z);
	                        state.targetedItem.rotY = state.currentWristRoll;
	                        state.targetedItem.state = 'grabbed';
	                        state.grabbedItem = state.targetedItem;
                        state.targetedItem = null;
                        state.targetTimer = 0;
                        state.blockedTimer = 0;
                        state.lockedPickupTarget = null;
                        state.lockedPickupItemId = null;
                        state.lockedPickupUntil = 0;
                        if (!hasDrop) {
                            state.autoDropTarget = getAutoSlot(partHint(state.grabbedItem));
	                        }
	                        state.phase = 'pick_recenter';
	                        state.waitTimer = 0;
	                    } else if (
	                        descendLatch &&
	                        state.targetedItem &&
	                        descendLatch.planarDist > (targetOnDriveNow ? 0.68 : 0.34)
	                    ) {
	                        logCobotEvent(
	                            state,
	                            'pick_latch_reject',
	                            `mode=descend_contact snap=${descendLatch.snapDist.toFixed(3)} planar=${descendLatch.planarDist.toFixed(3)} v=${descendLatch.verticalDist.toFixed(3)}`
	                        );
	                        if (descendLatch.planarDist > 1.2) {
	                            const skipCooldown = targetOnDriveNow ? 0.08 : PICK_SKIP_COOLDOWN;
	                            state.skippedTargetIds[state.targetedItem.id] = state.simTime + skipCooldown;
	                            state.targetedItem.state = 'free';
                            state.targetedItem = null;
                            state.targetTimer = 0;
                            state.phase = 'idle';
                            state.waitTimer = 0;
	                            state.lockedPickupTarget = null;
	                            state.lockedPickupItemId = null;
	                            state.lockedPickupUntil = 0;
	                        } else {
	                            state.phase = 'pick_hover';
	                            state.waitTimer = 0;
	                            state.lockedPickupTarget = null;
                            state.lockedPickupItemId = null;
                            state.lockedPickupUntil = 0;
                        }
		                } else if (
	                    state.waitTimer > 0.08 &&
	                    state.targetedItem?.state === 'targeted' &&
	                    contact.horizontalDist < Math.max(0.14, contact.targetRadius * 0.52) &&
		                    contact.padGap > -PICK_HAND_CONTACT_TOLERANCE &&
	                    contact.padGap < Math.max(0.11, closeLatchVertical + 0.02)
	                ) {
		                    const latch = canLatchByProximity(state, 
		                        state.targetedItem,
		                        closeLatchPlanar,
		                        closeLatchVertical
		                    );
		                    if (latch.ok && latch.gripPose) {
                        logCobotEvent(
	                            state,
	                            'pick_grabbed',
	                            `item=${state.targetedItem.id} mode=descend_close snap=${latch.snapDist.toFixed(3)} planar=${latch.planarDist.toFixed(3)} v=${latch.verticalDist.toFixed(3)}`
                        );
                        state.targetedItem.pos.set(latch.gripPose.x, latch.gripPose.y - partHalfHeight(state.targetedItem) - 0.001, latch.gripPose.z);
                        state.targetedItem.rotY = state.currentWristRoll;
                        state.targetedItem.state = 'grabbed';
                        state.grabbedItem = state.targetedItem;
                        state.targetedItem = null;
                        state.targetTimer = 0;
                        state.blockedTimer = 0;
                        state.lockedPickupTarget = null;
                        state.lockedPickupItemId = null;
                        state.lockedPickupUntil = 0;
                        if (!hasDrop) {
                            state.autoDropTarget = getAutoSlot(partHint(state.grabbedItem));
	                        }
	                        state.phase = 'pick_recenter';
	                        state.waitTimer = 0;
	                    } else if (
	                        state.targetedItem &&
	                        latch.planarDist > (targetOnDriveNow ? 0.55 : 0.38)
	                    ) {
	                        logCobotEvent(
		                            state,
		                            'pick_latch_reject',
		                            `mode=descend_close snap=${latch.snapDist.toFixed(3)} planar=${latch.planarDist.toFixed(3)} v=${latch.verticalDist.toFixed(3)}`
	                        );
                        if (latch.planarDist > 1.2) {
                            const skipCooldown = targetOnDriveNow ? 0.08 : PICK_SKIP_COOLDOWN;
                            state.skippedTargetIds[state.targetedItem.id] = state.simTime + skipCooldown;
                            state.targetedItem.state = 'free';
                            state.targetedItem = null;
                            state.targetTimer = 0;
                            state.phase = 'idle';
                            state.waitTimer = 0;
	                            state.lockedPickupTarget = null;
	                            state.lockedPickupItemId = null;
	                            state.lockedPickupUntil = 0;
	                        } else {
	                            state.phase = 'pick_hover';
	                            state.waitTimer = 0;
	                            state.lockedPickupTarget = null;
                            state.lockedPickupItemId = null;
                            state.lockedPickupUntil = 0;
                        }
                    }
	                }
                    // A failed near-contact latch must not bypass the deadline.
	                if (state.phase === 'pick_descend' && (state.waitTimer > 2.1 || state.targetTimer > pickTimeout || abortForReach || (targetLost && !stallRecoveryInProgress && state.targetTimer > 0.9))) {
	                    const closeEnoughToTryAttach =
	                        !abortForReach &&
	                        state.targetedItem?.state === 'targeted' &&
	                        contact.horizontalDist < Math.max(0.22, contact.targetRadius * 0.82) &&
		                        contact.padGap > -PICK_HAND_CONTACT_TOLERANCE &&
	                        contact.padGap < 0.2;
	                    if (closeEnoughToTryAttach) {
	                        logCobotEvent(
	                            state,
	                            'pick_close_retry',
	                            `item=${state.targetedItem!.id} planar=${contact.horizontalDist.toFixed(3)} gap=${contact.padGap.toFixed(3)}`
	                        );
	                        state.phase = 'pick_attach';
	                        state.waitTimer = 0;
	                        state.targetTimer = 0;
	                        state.lockedPickupTarget = null;
	                        state.lockedPickupItemId = null;
	                        state.lockedPickupUntil = 0;
	                        break;
	                    }
                    const failReason = abortForReach ? 'reach_abort' : (state.waitTimer > 2.1 ? 'descend_wait_timeout' : 'descend_target_timeout');
                    if (state.targetedItem) logCobotEvent(state, 'pick_fail', `${failReason} item=${state.targetedItem.id} t=${state.targetTimer.toFixed(2)}s`);
                    if (state.targetedItem) state.targetedItem.state = 'free';
                    if (state.targetedItem) {
                        const skipCooldown = targetOnDriveNow ? 0.08 : PICK_SKIP_COOLDOWN;
                        state.skippedTargetIds[state.targetedItem.id] = state.simTime + skipCooldown;
                    }
                    state.targetedItem = null; state.phase = 'idle';
                    state.targetTimer = 0;
                    state.lockedPickupTarget = null;
                    state.lockedPickupItemId = null;
                    state.lockedPickupUntil = 0;
                }
                break;
            }
            case 'pick_attach': {
                state.waitTimer += delta;
                state.targetTimer += delta;
                const pickTimeout = currentPickTimeout(state);
                state.gripperOpen = false;
                let isUnreachable = false;
                let targetOnDriveNow = false;
                if (state.targetedItem?.state === 'targeted') {
                    const pickAnchor = currentPickAnchor(state) ?? stepPos;
                    const rawTarget = pickupAimPoint(state, state.targetedItem, PICK_LEAD_TIME * 0.45);
                    const partR = partRadiusForSpec(state.targetedItem);
                    targetOnDriveNow = !!driveTileAt(state.targetedItem.pos.x, state.targetedItem.pos.z, state.obstacles);
	                    const catchRadius = targetOnDriveNow
	                        ? movingPickupWindowRadius(partR)
	                        : clamp(partR * 2.2, PICK_ANCHOR_MIN_OFFSET, PICK_ANCHOR_MAX_OFFSET);
	                    let target = targetOnDriveNow
	                        ? clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius)
	                        : rawTarget.clone();
                    if (
                        targetOnDriveNow &&
                        state.lockedPickupTarget &&
                        state.lockedPickupItemId === state.targetedItem.id &&
                        state.simTime < state.lockedPickupUntil
                    ) {
                        target = state.lockedPickupTarget.clone();
                    }
	                    const supportTop = supportTopAt(target.x, target.z, state.obstacles);
	                    const targetTop = target.y + partHalfHeight(state.targetedItem);
	                    const pickY = pickupContactTipY(targetTop, supportTop);
	                    const hoverClearance = Math.max(PICK_HOVER_CLEARANCE, partR * 0.46);
	                    const hoverY = Math.max(target.y + hoverClearance, supportTop + hoverClearance);
	                    state.gripperTip.computeWorldMatrix(true);
	                    const tip = state.gripperTip.getAbsolutePosition();
	                    const approachPlanar = Math.hypot(tip.x - target.x, tip.z - target.z);
	                    const descendAlignRadius = targetOnDriveNow
	                        ? clamp(partR * 0.28, 0.065, 0.09)
	                        : clamp(partR * 0.22, 0.05, 0.075);
	                    const descendBlend = clamp(
	                        (descendAlignRadius * 1.65 - approachPlanar) / Math.max(0.001, descendAlignRadius * 0.9),
	                        0,
	                        1
	                    );
	                    const guardedPickY = Math.min(state.ikTarget.y, pickY + (hoverY - pickY) * (1 - descendBlend));
	                    state.desiredTarget.set(target.x, guardedPickY, target.z);
                    if (targetOnDriveNow) {
                        state.lockedPickupTarget = target.clone();
                        state.lockedPickupItemId = state.targetedItem.id;
                        state.lockedPickupUntil = state.simTime + 1.05;
                    }
                    const reachDist = Math.sqrt(
                        (target.x - mountPos.x) * (target.x - mountPos.x) +
                        (target.z - mountPos.z) * (target.z - mountPos.z) +
	                        (guardedPickY + L3 - mountPos.y) * (guardedPickY + L3 - mountPos.y)
	                    );
                    const reachSlack = targetOnDriveNow ? 0.24 : 0.12;
                    isUnreachable = reachDist > (L1 + L2 + reachSlack);
                }
	                const attachContact = pickupContactState(state, state.targetedItem);
	                const abortForReach = isUnreachable && !targetOnDriveNow;
			                const attachLatchPlanar = pickupLatchPlanarRadius(attachContact.targetRadius, targetOnDriveNow);
			                const attachLatchVertical = pickupLatchVerticalRadius(targetOnDriveNow);
	                const alignReady =
	                    attachContact.horizontalDist < attachLatchPlanar &&
		                    attachContact.padGap >= -PICK_HAND_CONTACT_TOLERANCE &&
	                    attachContact.padGap <= attachLatchVertical;
	                if (state.waitTimer > 0.04 && state.targetedItem?.state === 'targeted' && alignReady) {
	                    const latch = canLatchByProximity(state, 
	                        state.targetedItem,
	                        attachLatchPlanar,
	                        attachLatchVertical
	                    );
                    if (latch.ok && latch.gripPose) {
                        logCobotEvent(
                            state,
                            'pick_grabbed',
                            `item=${state.targetedItem.id} mode=attach_align snap=${latch.snapDist.toFixed(3)} planar=${latch.planarDist.toFixed(3)} v=${latch.verticalDist.toFixed(3)}`
                        );
                        state.targetedItem.pos.set(latch.gripPose.x, latch.gripPose.y - partHalfHeight(state.targetedItem) - 0.001, latch.gripPose.z);
                        state.targetedItem.rotY = state.currentWristRoll;
                        state.targetedItem.state = 'grabbed';
                        state.grabbedItem = state.targetedItem;
                        state.targetedItem = null;
                        state.targetTimer = 0;
                        state.blockedTimer = 0;
                        state.lockedPickupTarget = null;
                        state.lockedPickupItemId = null;
                        state.lockedPickupUntil = 0;
                        if (!hasDrop) {
                            state.autoDropTarget = getAutoSlot(partHint(state.grabbedItem));
                        }
                        state.phase = 'pick_recenter';
                        state.waitTimer = 0;
                    } else if (state.targetedItem) {
                        logCobotEvent(
                            state,
                            'pick_latch_reject',
                            `mode=attach_align snap=${latch.snapDist.toFixed(3)} planar=${latch.planarDist.toFixed(3)} v=${latch.verticalDist.toFixed(3)}`
                        );
                    }
                }
                if (state.phase === 'pick_attach' && (state.waitTimer > 1.1 || state.targetTimer > pickTimeout || (state.waitTimer > 0.34 && attachContact.horizontalDist > Math.max(PICK_GRAB_RADIUS + 0.2, attachContact.targetRadius * 1.36)) || abortForReach)) {
                    const failReason = abortForReach ? 'reach_abort' : (state.targetTimer > pickTimeout ? 'attach_target_timeout' : 'attach_alignment_timeout');
                    if (state.targetedItem) logCobotEvent(state, 'pick_fail', `${failReason} item=${state.targetedItem.id} t=${state.targetTimer.toFixed(2)}s`);
                    if (state.targetedItem) state.targetedItem.state = 'free';
                    if (state.targetedItem) {
                        const skipCooldown = targetOnDriveNow ? 0.08 : PICK_SKIP_COOLDOWN;
                        state.skippedTargetIds[state.targetedItem.id] = state.simTime + skipCooldown;
                    }
                    state.targetedItem = null; state.phase = 'idle';
                    state.targetTimer = 0;
                    state.lockedPickupTarget = null;
                    state.lockedPickupItemId = null;
                    state.lockedPickupUntil = 0;
                }
                break;
            }

    }
}
