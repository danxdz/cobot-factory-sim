import { Vector3 } from '@babylonjs/core';
import { SimItem,simState } from '../../simState';
import { PlacedItem } from '../../types';
import { PICK_CONTACT_RADIUS,PICK_GRAB_RADIUS,PICK_HOVER_CLEARANCE,PICK_LEAD_TIME,PICK_SUPPORT_CLEARANCE,PICK_SURFACE_CONTACT_GAP,PICK_TARGET_TIMEOUT } from './constants';
import { HAND_DISK_COLLIDER_RADIUS,PICK_HAND_CONTACT_TOLERANCE,PICK_HAND_PART_CLEARANCE } from './contactConstants';
import { driveTileAt,driveVector,supportTopAt } from './geometry';
import { clamp } from './math';
import { partHalfHeight,partRadiusForSpec } from './partGeometry';
import type { CobotState } from './stateTypes';


export function predictedPickupPos(item: SimItem, obstacles: PlacedItem[], leadTime = PICK_LEAD_TIME): Vector3 {
    const predicted = item.pos.clone();
    const driveTile = driveTileAt(item.pos.x, item.pos.z, obstacles);
    if (!driveTile) return predicted;
    const speed = (driveTile.config?.speed || 2) * 0.55;
    return predicted.addInPlace(driveVector(driveTile.rotation).scale(speed * leadTime));
}

export function estimateItemVelocity(state: CobotState, item: SimItem): Vector3 {
    const itemMotionTracker = state.itemMotionTracker;
    const now = state.simTime;
    const tracked = itemMotionTracker.get(item);
    if (!tracked) {
        itemMotionTracker.set(item, { pos: item.pos.clone(), t: now, vel: Vector3.Zero() });
        return Vector3.Zero();
    }
    const dt = now - tracked.t;
    if (dt > 0.0001) {
        const rawVel = item.pos.subtract(tracked.pos).scale(1 / dt);
        const nextVel = Vector3.Lerp(tracked.vel, rawVel, 0.42);
        tracked.vel.copyFrom(nextVel);
        tracked.pos.copyFrom(item.pos);
        tracked.t = now;
    }
    return tracked.vel.clone();
}

export function pickupLeadTime(state: CobotState, item: SimItem, baseLead = PICK_LEAD_TIME): number {
    const driveTile = driveTileAt(item.pos.x, item.pos.z, state.obstacles);
    const beltSpeed = driveTile ? (driveTile.config?.speed || 2) * 0.55 : 0;
    state.gripperTip.computeWorldMatrix(true);
    const tip = state.gripperTip.getAbsolutePosition();
    const planarDist = Math.sqrt((tip.x - item.pos.x) ** 2 + (tip.z - item.pos.z) ** 2);
    const ikPlanarSpeed = Math.sqrt(state.ikVelocity.x * state.ikVelocity.x + state.ikVelocity.z * state.ikVelocity.z);
    const distLead = clamp(planarDist * 0.1, 0, 0.38);
    const speedLead = clamp(beltSpeed * 0.1, 0, 0.32);
    const catchLagLead = driveTile
        ? clamp(planarDist * 0.065 - ikPlanarSpeed * 0.035, 0, 0.22)
        : 0;
    const phaseLead = state.phase === 'pick_hover'
        ? 0.08
        : (state.phase === 'pick_descend' || state.phase === 'pick_attach')
            ? 0.14
            : 0;
    return clamp(baseLead + distLead + speedLead + catchLagLead + phaseLead, 0.08, 0.84);
}

export function bestDetectionForItem(state: CobotState, item: SimItem) {
    const linkedIds = state.linkedCameraIds.length > 0 ? state.linkedCameraIds : state.cameras.map(cam => cam.id);
    return simState.cameraDetections
        .filter(det =>
            det.itemId === item.id &&
            linkedIds.includes(det.cameraId) &&
            (state.pickColors.length === 0 || state.pickColors.includes(det.color)) &&
            (state.pickSizes.length === 0 || state.pickSizes.includes(det.size))
        )
        .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

export function pickupAimPoint(state: CobotState, item: SimItem, leadTime = PICK_LEAD_TIME): Vector3 {
    const lead = pickupLeadTime(state, item, leadTime);
    const predicted = predictedPickupPos(item, state.obstacles, lead);
    const motionVel = estimateItemVelocity(state, item);
    const motionGain = driveTileAt(item.pos.x, item.pos.z, state.obstacles) ? 0.92 : 0.54;
    predicted.addInPlace(motionVel.scale(lead * motionGain));
    const detection = bestDetectionForItem(state, item);
    if (!detection) return predicted;
    const movingOnDrive = !!driveTileAt(item.pos.x, item.pos.z, state.obstacles);
    const detectionWeight = movingOnDrive ? 0.18 : 0.36;
    return Vector3.Lerp(predicted, detection.pos, detectionWeight);
}

export function pickupContactTipY(targetTop: number, supportTop: number): number {
    return Math.max(targetTop + PICK_HAND_PART_CLEARANCE, supportTop + PICK_SUPPORT_CLEARANCE);
}

export function pickupContactState(state: CobotState, item: SimItem | null) {
    state.gripperTip.computeWorldMatrix(true);
    const tip = state.gripperTip.getAbsolutePosition();
    if (!item || item.state !== 'targeted') {
        return {
            tip,
            targetPos: null as Vector3 | null,
            horizontalDist: Number.POSITIVE_INFINITY,
            targetRadius: Number.POSITIVE_INFINITY,
            targetTop: Number.POSITIVE_INFINITY,
            supportTop: Number.POSITIVE_INFINITY,
            padGap: Number.POSITIVE_INFINITY,
            touchingPart: false,
            touchingSurface: false,
        };
    }
    let targetPos = pickupAimPoint(state, item, PICK_LEAD_TIME * 0.6);
    const pickPhaseActive =
        state.phase === 'pick_hover' ||
        state.phase === 'pick_descend' ||
        state.phase === 'pick_attach';
    if (
        pickPhaseActive &&
        state.lockedPickupTarget &&
        state.lockedPickupItemId === item.id &&
        state.simTime < state.lockedPickupUntil
    ) {
        targetPos = state.lockedPickupTarget.clone();
    }
    const supportTop = supportTopAt(targetPos.x, targetPos.z, state.obstacles);
    const targetHalf = partHalfHeight(item);
    const targetRadius = partRadiusForSpec(item);
    const targetTop = targetPos.y + targetHalf;
    const dx = tip.x - targetPos.x;
    const dz = tip.z - targetPos.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const itemDx = tip.x - item.pos.x;
    const itemDz = tip.z - item.pos.z;
    const itemDist = Math.sqrt(itemDx * itemDx + itemDz * itemDz);
    const effectiveDist = Math.min(horizontalDist, itemDist);
    const padGap = tip.y - targetTop;
    const suctionFootprint = Math.min(PICK_CONTACT_RADIUS, Math.max(0.16, targetRadius * 0.56));
    const surfaceFootprint = Math.min(PICK_GRAB_RADIUS, Math.max(0.18, targetRadius * 0.66));
    const touchingPart = effectiveDist < suctionFootprint && padGap >= -PICK_HAND_CONTACT_TOLERANCE && padGap <= 0.085;
    const touchingSurface = effectiveDist < surfaceFootprint && tip.y <= supportTop + PICK_SURFACE_CONTACT_GAP + 0.018;
    return {
        tip,
        targetPos,
        horizontalDist: effectiveDist,
        targetRadius,
        targetTop,
        supportTop,
        padGap,
        touchingPart,
        touchingSurface,
    };
}

export function nearbyPickupPenalty(candidate: SimItem): number {
    let crowding = 0;
    for (const item of simState.items) {
        if (item === candidate || item.state !== 'free') continue;
        const dx = item.pos.x - candidate.pos.x;
        const dz = item.pos.z - candidate.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 0.5) crowding += (0.5 - d) * 2.4;
    }
    return crowding;
}

export function partMatchesPickFilters(state: CobotState, candidate: SimItem): boolean {
    return (state.pickColors.length === 0 || state.pickColors.includes(candidate.color)) &&
        (state.pickSizes.length === 0 || state.pickSizes.includes(candidate.size));
}

export function canReachPickupCandidate(
    state: CobotState,
    candidate: SimItem,
    mountPos: Vector3,
    L1: number,
    L2: number,
    L3: number
): boolean {
    const predicted = pickupAimPoint(state, candidate);
    const partR = partRadiusForSpec(candidate);
    const onDrive = !!driveTileAt(candidate.pos.x, candidate.pos.z, state.obstacles);
    const supportTop = supportTopAt(predicted.x, predicted.z, state.obstacles);
    const hoverClearance = Math.max(PICK_HOVER_CLEARANCE, partR * 0.46);
    const hoverY = Math.max(predicted.y + hoverClearance, supportTop + hoverClearance);
    const reachDist = Math.sqrt(
        (predicted.x - mountPos.x) * (predicted.x - mountPos.x) +
        (predicted.z - mountPos.z) * (predicted.z - mountPos.z) +
        (hoverY + L3 - mountPos.y) * (hoverY + L3 - mountPos.y)
    );
    const reachSlack = onDrive ? 0.26 : 0.14;
    if (reachDist <= (L1 + L2 + reachSlack)) return true;
    return onDrive && reachDist <= (L1 + L2 + reachSlack + 0.08);
}

export function pickupCandidateStepDistance(state: CobotState, candidate: SimItem, stepPos: Vector3): number {
    const currentDist = Math.hypot(candidate.pos.x - stepPos.x, candidate.pos.z - stepPos.z);
    const driveTile = driveTileAt(candidate.pos.x, candidate.pos.z, state.obstacles);
    if (!driveTile) return currentDist;

    const speed = (driveTile.config?.speed || 2) * 0.55;
    const dir = driveVector(driveTile.rotation);
    let best = currentDist;
    for (let t = 0.2; t <= 1.8; t += 0.2) {
        const px = candidate.pos.x + dir.x * speed * t;
        const pz = candidate.pos.z + dir.z * speed * t;
        best = Math.min(best, Math.hypot(px - stepPos.x, pz - stepPos.z));
    }
    return best;
}

export function isPickupCandidateCovered(candidate: SimItem): boolean {
    const candidateR = partRadiusForSpec(candidate);
    const candidateHalf = partHalfHeight(candidate);
    const candidateTop = candidate.pos.y + candidateHalf;
    for (const other of simState.items) {
        if (other === candidate || other.state === 'dead' || other.state === 'grabbed') continue;
        const otherR = partRadiusForSpec(other);
        const dx = other.pos.x - candidate.pos.x;
        const dz = other.pos.z - candidate.pos.z;
        const planar = Math.sqrt(dx * dx + dz * dz);
        const stackOverlap = planar < Math.max(0.1, Math.min(candidateR, otherR) * 1.15);
        if (!stackOverlap) continue;
        const otherBottom = other.pos.y - partHalfHeight(other);
        if (otherBottom >= candidateTop - 0.025 || other.pos.y > candidate.pos.y + candidateHalf * 0.55) {
            return true;
        }
    }
    return false;
}

export function clampTargetAroundAnchorXZ(anchor: Vector3, target: Vector3, maxOffset: number): Vector3 {
    const dx = target.x - anchor.x;
    const dz = target.z - anchor.z;
    const planar = Math.sqrt(dx * dx + dz * dz);
    if (planar <= maxOffset || planar < 0.0001) return target.clone();
    const s = maxOffset / planar;
    return new Vector3(anchor.x + dx * s, target.y, anchor.z + dz * s);
}

export function movingPickupWindowRadius(partR: number): number {
    return clamp(partR * 1.75, 0.42, 0.58);
}

export function pickupLatchPlanarRadius(targetRadius: number, targetOnDrive: boolean): number {
    return targetOnDrive
        ? clamp(targetRadius * 0.42, 0.1, HAND_DISK_COLLIDER_RADIUS * 0.9)
        : clamp(targetRadius * 0.2, 0.04, 0.065);
}

export function pickupLatchVerticalRadius(targetOnDrive: boolean): number {
    return targetOnDrive ? 0.055 : 0.035;
}

export function currentPickTimeout(state: CobotState): number {
    const item = state.targetedItem;
    const onDrive = !!(item && driveTileAt(item.pos.x, item.pos.z, state.obstacles));
    if (state.phase === 'pick_hover') return PICK_TARGET_TIMEOUT + (onDrive ? 1.25 : 0.55);
    if (state.phase === 'pick_descend') return PICK_TARGET_TIMEOUT + (onDrive ? 1.0 : 0.45);
    if (state.phase === 'pick_attach') return PICK_TARGET_TIMEOUT + (onDrive ? 0.85 : 0.35);
    return PICK_TARGET_TIMEOUT;
}

export function canLatchByProximity(
    state: CobotState,
        item: SimItem | null,
        maxPlanarDist: number,
        maxVerticalDist: number
    ): {
        ok: boolean;
        snapDist: number;
        planarDist: number;
        verticalDist: number;
        gripPose: Vector3 | null;
    } {
        if (!item) {
            return {
                ok: false,
                snapDist: Infinity,
                planarDist: Infinity,
                verticalDist: Infinity,
                gripPose: null,
            };
        }
        state.gripperTip.computeWorldMatrix(true);
        const gripPose = state.gripperTip.getAbsolutePosition();
        const desiredCenter = new Vector3(
            gripPose.x,
            gripPose.y - partHalfHeight(item) - 0.001,
            gripPose.z
        );
        const dx = item.pos.x - desiredCenter.x;
        const dz = item.pos.z - desiredCenter.z;
        const dy = item.pos.y - desiredCenter.y;
        const planarDist = Math.sqrt(dx * dx + dz * dz);
        const verticalDist = Math.abs(dy);
        const snapDist = Math.sqrt(planarDist * planarDist + verticalDist * verticalDist);
        const ok = planarDist <= maxPlanarDist && verticalDist <= maxVerticalDist;
        return { ok, snapDist, planarDist, verticalDist, gripPose };
    }
