import { Vector3 } from '@babylonjs/core';
import { SimItem,simState } from '../../simState';
import { factoryStore } from '../../store';
import { PlacedItem } from '../../types';
import { COBOT_NEIGHBOR_YIELD_TRIGGER,COBOT_PEDESTAL_HEIGHT,COBOT_PEDESTAL_SAFEZONE_RADIUS,COBOT_SELF_HARD_STOP_DIST,HAND_SAFETY_EXTRA_RADIUS,PEDESTAL_HAND_CLEARANCE,PICK_CONTACT_RADIUS,RETREAT_BACKOFF,RETREAT_DURATION } from './constants';
import { HAND_DISK_COLLIDER_HALF_HEIGHT,HAND_DISK_COLLIDER_RADIUS,HAND_DISK_CONTACT_SKIN,PICK_HAND_CONTACT_TOLERANCE,PICK_HAND_PART_CLEARANCE } from './contactConstants';
import { currentDropTarget } from './dropTargets';
import { carriedPayloadRadius,clampTargetAboveSupports,dropObstacles,itemFootprintHit,machineWallY,pointSegmentDistSq2D,pointSegmentT2D,segmentFootprintHit2D } from './geometry';
import { clamp } from './math';
import { partHalfHeight,partRadiusForSpec } from './partGeometry';
import { pickupContactState } from './pickupTargets';
import { currentPickAnchor } from './programTargets';
import type { CobotState } from './stateTypes';

export function collisionSafetyEnabled(state: CobotState): boolean { return state.selfItem?.config?.cobotCollisionEnabled !== false; }

export function appendSegmentSamples(out: Vector3[], a: Vector3, b: Vector3, steps: number) {
    const n = Math.max(1, steps);
    for (let i = 0; i <= n; i++) {
        if (out.length > 0 && i === 0) continue;
        out.push(Vector3.Lerp(a, b, i / n));
    }
}

export function collectArmSamples(state: CobotState): Vector3[] {
    state.mountBase.computeWorldMatrix(true);
    state.shoulder.computeWorldMatrix(true);
    state.elbow.computeWorldMatrix(true);
    state.wrist.computeWorldMatrix(true);
    state.wristRoll.computeWorldMatrix(true);
    state.gripperTip.computeWorldMatrix(true);

    const mount = state.mountBase.getAbsolutePosition();
    const shoulder = state.shoulder.getAbsolutePosition();
    const elbow = state.elbow.getAbsolutePosition();
    const wrist = state.wrist.getAbsolutePosition();
    const roll = state.wristRoll.getAbsolutePosition();
    const tip = state.gripperTip.getAbsolutePosition();

    const samples: Vector3[] = [];
    appendSegmentSamples(samples, mount, shoulder, 2);
    appendSegmentSamples(samples, shoulder, elbow, 4);
    appendSegmentSamples(samples, elbow, wrist, 3);
    appendSegmentSamples(samples, wrist, roll, 2);
    appendSegmentSamples(samples, roll, tip, 2);
    return samples;
}

export type ArmLinkSample = [Vector3, Vector3, number];

export const SELF_COLLISION_LINK_PAIRS: Array<[number, number, number]> = [
    [4, 0, 0.005], // tool against pedestal/shoulder column
    [4, 1, 0.005], // tool against upper arm
    [3, 0, 0.005], // wrist against pedestal/shoulder column
    [3, 1, 0.0],   // wrist against upper arm
    [2, 0, 0.0],   // forearm against pedestal/shoulder column
];

export function collectArmLinks(state: CobotState): ArmLinkSample[] {
    state.mountBase.computeWorldMatrix(true);
    state.shoulder.computeWorldMatrix(true);
    state.elbow.computeWorldMatrix(true);
    state.wrist.computeWorldMatrix(true);
    state.wristRoll.computeWorldMatrix(true);
    state.gripperTip.computeWorldMatrix(true);

    const mount = state.mountBase.getAbsolutePosition();
    const shoulder = state.shoulder.getAbsolutePosition();
    const elbow = state.elbow.getAbsolutePosition();
    const wrist = state.wrist.getAbsolutePosition();
    const roll = state.wristRoll.getAbsolutePosition();
    const tip = state.gripperTip.getAbsolutePosition();
    const carriedPad = carriedPayloadRadius(state);
    const handPad = HAND_SAFETY_EXTRA_RADIUS + carriedPad;

    return [
        [mount, shoulder, 0.18],
        [shoulder, elbow, 0.17],
        [elbow, wrist, 0.14],
        [wrist, roll, 0.12 + handPad * 0.6],
        [roll, tip, 0.11 + handPad],
    ];
}

export function closestPointOnSegment(point: Vector3, a: Vector3, b: Vector3): Vector3 {
    const ab = b.subtract(a);
    const lenSq = ab.lengthSquared();
    if (lenSq <= 0.000001) return a.clone();
    const t = clamp(Vector3.Dot(point.subtract(a), ab) / lenSq, 0, 1);
    return a.add(ab.scale(t));
}

export function closestSampledSegmentPoints(a: Vector3, b: Vector3, c: Vector3, d: Vector3, samples = 7) {
    let bestDistSq = Infinity;
    let bestA = a.clone();
    let bestB = c.clone();
    for (let i = 0; i <= samples; i++) {
        const p = Vector3.Lerp(a, b, i / samples);
        const q = closestPointOnSegment(p, c, d);
        const distSq = Vector3.DistanceSquared(p, q);
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestA = p;
            bestB = q;
        }
    }
    for (let i = 0; i <= samples; i++) {
        const q = Vector3.Lerp(c, d, i / samples);
        const p = closestPointOnSegment(q, a, b);
        const distSq = Vector3.DistanceSquared(p, q);
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestA = p;
            bestB = q;
        }
    }
    return { distSq: bestDistSq, pointA: bestA, pointB: bestB };
}

export function selfCollisionRiskFromLinks(links: ArmLinkSample[]): { clearance: number; point: Vector3 | null } {
    let bestClearance = Infinity;
    let bestPoint: Vector3 | null = null;
    for (const [distalIndex, proximalIndex, margin] of SELF_COLLISION_LINK_PAIRS) {
        const distal = links[distalIndex];
        const proximal = links[proximalIndex];
        if (!distal || !proximal) continue;
        const closest = closestSampledSegmentPoints(distal[0], distal[1], proximal[0], proximal[1]);
        const clearance = Math.sqrt(closest.distSq) - distal[2] - proximal[2] - margin;
        if (clearance < bestClearance) {
            bestClearance = clearance;
            bestPoint = closest.pointB;
        }
    }
    return { clearance: bestClearance, point: bestPoint };
}

export function selfCollisionRisk(state: CobotState): { clearance: number; point: Vector3 | null } {
    return selfCollisionRiskFromLinks(collectArmLinks(state));
}

export function clampPickupHandAboveParts(state: CobotState): boolean {
    if (!(state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach')) return false;
    if (state.grabbedItem) return false;

    state.gripperTip.computeWorldMatrix(true);
    const tip = state.gripperTip.getAbsolutePosition();
    let minTipY = Number.NEGATIVE_INFINITY;

    for (const item of simState.items) {
        if (item.state === 'dead' || item.state === 'grabbed') continue;
        const itemR = partRadiusForSpec(item);
        const dx = tip.x - item.pos.x;
        const dz = tip.z - item.pos.z;
        const planar = Math.sqrt(dx * dx + dz * dz);
        const padFootprint = Math.min(PICK_CONTACT_RADIUS, Math.max(0.16, itemR * 0.62));
        if (planar > padFootprint) continue;
        minTipY = Math.max(minTipY, item.pos.y + partHalfHeight(item) + PICK_HAND_PART_CLEARANCE);
    }

    if (!Number.isFinite(minTipY) || tip.y >= minTipY - PICK_HAND_CONTACT_TOLERANCE) return false;
    const lift = minTipY - tip.y;
    state.ikTarget.y += lift;
    state.desiredTarget.y = Math.max(state.desiredTarget.y, state.ikTarget.y);
    state.ikVelocity.y = Math.max(0, state.ikVelocity.y);
    return true;
}

export function resolveHandDiskPartContacts(state: CobotState): boolean {
    if (!collisionSafetyEnabled(state)) return false;
    if (state.grabbedItem) return false;

    const contactPhase =
        state.phase === 'pick_hover' ||
        state.phase === 'pick_descend' ||
        state.phase === 'pick_attach' ||
        state.phase === 'hover_drop' ||
        state.phase === 'descend_drop' ||
        state.phase === 'release';
    if (!contactPhase) return false;

    let adjusted = false;
    const tip = state.ikTarget;

    for (const item of simState.items) {
        if (item.state === 'dead' || item.state === 'grabbed') continue;

        const isTarget = item === state.targetedItem;
        const itemR = partRadiusForSpec(item);
        const itemHalf = partHalfHeight(item);
        const itemTop = item.pos.y + itemHalf;
        const itemBottom = item.pos.y - itemHalf;
        const dx = tip.x - item.pos.x;
        const dz = tip.z - item.pos.z;
        const planar = Math.sqrt(dx * dx + dz * dz);
        const topContactRadius = Math.min(
            HAND_DISK_COLLIDER_RADIUS + itemR * 0.65,
            itemR + HAND_DISK_COLLIDER_RADIUS
        );
        const minTipY = itemTop + HAND_DISK_COLLIDER_HALF_HEIGHT + HAND_DISK_CONTACT_SKIN;

        if (planar <= topContactRadius && tip.y < minTipY) {
            const lift = minTipY - tip.y;
            tip.y += lift;
            state.desiredTarget.y = Math.max(state.desiredTarget.y, tip.y);
            state.ikVelocity.y = Math.max(0, state.ikVelocity.y);
            adjusted = true;
        }

        // The target part must be allowed to sit under the suction footprint.
        // Side separation is only for accidental bumps into neighboring parts.
        if (isTarget) continue;

        const verticalOverlap =
            tip.y - HAND_DISK_COLLIDER_HALF_HEIGHT <= itemTop + HAND_DISK_CONTACT_SKIN &&
            tip.y + HAND_DISK_COLLIDER_HALF_HEIGHT >= itemBottom - HAND_DISK_CONTACT_SKIN;
        if (!verticalOverlap) continue;

        const sideRadius = itemR + HAND_DISK_COLLIDER_RADIUS + HAND_DISK_CONTACT_SKIN;
        if (planar >= sideRadius) continue;

        adjusted = true;
    }

    return adjusted;
}

export function resolveArmLinkStackClearance(state: CobotState): boolean {
    if (!collisionSafetyEnabled(state)) return false;
    const clearancePhase =
        state.phase === 'lift' ||
        state.phase === 'transit_drop' ||
        state.phase === 'hover_drop' ||
        state.phase === 'drop_recenter';
    if (!clearancePhase) return false;

    const links = collectArmLinks(state).slice(1);
    let lift = 0;

    for (const [a, b, linkRadius] of links) {
        for (const item of simState.items) {
            if (item === state.grabbedItem || item.state === 'dead' || item.state === 'grabbed') continue;
            const itemR = partRadiusForSpec(item);
            const sideClearance = itemR + linkRadius + 0.16;
            const dist = Math.sqrt(pointSegmentDistSq2D(item.pos.x, item.pos.z, a.x, a.z, b.x, b.z));
            if (dist > sideClearance) continue;

            const t = pointSegmentT2D(item.pos.x, item.pos.z, a.x, a.z, b.x, b.z);
            const linkY = a.y + (b.y - a.y) * t;
            const itemTop = item.pos.y + partHalfHeight(item);
            const requiredY = itemTop + linkRadius + 0.14;
            lift = Math.max(lift, requiredY - linkY);
        }

        for (const obstacle of dropObstacles(state)) {
            if (obstacle.type === 'camera') continue;
            if (state.selfItem && obstacle.id === state.selfItem.id && !state.grabbedItem) continue;
            const pad = linkRadius + (state.grabbedItem ? carriedPayloadRadius(state) * 0.32 : 0) + 0.12;
            if (!segmentFootprintHit2D(a, b, obstacle, pad)) continue;

            const obstacleTop = machineWallY(obstacle);
            const linkLowY = Math.min(a.y, b.y);
            const requiredY = obstacleTop + linkRadius + 0.14;
            lift = Math.max(lift, requiredY - linkLowY);
        }
    }

    if (lift <= 0.002) return false;
    const limitedLift = Math.min(lift + 0.06, 0.42);
    state.desiredTarget.y = Math.max(state.desiredTarget.y, state.ikTarget.y + limitedLift);
    if (lift > 0.015) {
        state.ikVelocity.x *= 0.8;
        state.ikVelocity.z *= 0.8;
    }
    state.ikVelocity.y = Math.max(state.ikVelocity.y, 0);
    state.pathReplanCooldown = 0;
    return true;
}

export function segmentHitsMachine(a: Vector3, b: Vector3, obstacle: PlacedItem, radius = 0.08): boolean {
    if (obstacle.type === 'camera') return false;
    const topY = machineWallY(obstacle) + radius;
    const samples = 12;
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const p = Vector3.Lerp(a, b, t);
        if (p.y > topY) continue;
        if (itemFootprintHit(obstacle, p.x, p.z, radius)) return true;
    }
    return false;
}

export function armHitsObstacle(state: CobotState, obstacles: PlacedItem[]): PlacedItem | null {
    if (!collisionSafetyEnabled(state)) return null;
    const carriedPad = carriedPayloadRadius(state);
    const handPad = HAND_SAFETY_EXTRA_RADIUS + carriedPad;
    const links = collectArmLinks(state);
    const isAllowedPickContact = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
    const pickContact = isAllowedPickContact ? pickupContactState(state, state.targetedItem) : null;
    const isAllowedDropContact = state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release';
    const dropTarget = isAllowedDropContact ? currentDropTarget(state) : null;

    for (const obstacle of obstacles) {
        const isActivePickSupport = !!pickContact?.targetPos && itemFootprintHit(obstacle, pickContact.targetPos.x, pickContact.targetPos.z, 0.08);
        const isActiveDropSupport = !!dropTarget && itemFootprintHit(obstacle, dropTarget.x, dropTarget.z, 0.08);
        const activeSupport = isActivePickSupport || isActiveDropSupport;
        const isCobotSupport = activeSupport && obstacle.type === 'cobot';
        const isOwnCobotSupport = !!(isCobotSupport && state.selfItem && obstacle.id === state.selfItem.id);
        const allowOtherCobotSupportTipOnly = isCobotSupport && !isOwnCobotSupport;
        // For non-cobot supports in active pick/drop, allow penetration of support volume.
        if (activeSupport && !isCobotSupport) continue;

        for (const [index, [a, b, radius]] of links.entries()) {
            // Other cobot platforms remain solid except very end effector link at active support.
            if (allowOtherCobotSupportTipOnly && index >= links.length - 1) continue;
            // Own platform support: allow wrist+tool links so drops near pedestal can settle.
            if (isOwnCobotSupport && index >= links.length - 2) continue;
            if (segmentHitsMachine(a, b, obstacle, radius)) return obstacle;
        }
    }
    // Self-collision with own pedestal base (use the real pedestal radius, not a tiny center bubble).
    if (state.selfItem) {
        state.mountBase.computeWorldMatrix(true);
        const mountCenter = state.mountBase.getAbsolutePosition();
        const pedestalLimit = Math.max(state.mountCollisionRadius, COBOT_PEDESTAL_SAFEZONE_RADIUS) + PEDESTAL_HAND_CLEARANCE + handPad;
        // Extra protection for wrist/tool near pedestal cylinder, even when own support surface is active.
        for (let i = links.length - 2; i < links.length; i++) {
            const [a, b] = links[i];
            const samples = 9;
            for (let s = 0; s <= samples; s++) {
                const p = Vector3.Lerp(a, b, s / samples);
                if (p.y > COBOT_PEDESTAL_HEIGHT + 0.16) continue;
                const dx = p.x - mountCenter.x;
                const dz = p.z - mountCenter.z;
                if (Math.sqrt(dx * dx + dz * dz) < pedestalLimit) return state.selfItem;
            }
        }
        for (const [index, [a, b, radius]] of links.entries()) {
            if (index <= 1) continue; // Shoulder links originate from base
            const samples = 8;
            for (let i = 0; i <= samples; i++) {
                const p = Vector3.Lerp(a, b, i / samples);
                if (p.y > COBOT_PEDESTAL_HEIGHT + radius) continue;
                const dx = p.x - mountCenter.x;
                const dz = p.z - mountCenter.z;
                const radialLimit = Math.max(state.mountCollisionRadius, COBOT_PEDESTAL_SAFEZONE_RADIUS) + radius * 0.08;
                if (Math.sqrt(dx * dx + dz * dz) < radialLimit) return state.selfItem;
            }
        }
    }

    const ownLinkRisk = selfCollisionRiskFromLinks(links);
    if (ownLinkRisk.clearance < -COBOT_SELF_HARD_STOP_DIST * 1.5) return state.selfItem ?? null;

    // Hard-stop if this arm intersects another cobot arm sample cloud.
    // Keep stricter tolerance during precise pick so nearby parallel motion doesn't false-trip.
    const ownArmPoints = collectArmSamples(state);
    const crossArmR = (state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach') ? 0.12 : 0.18;
    const armHitDistSq = crossArmR * crossArmR;
    for (const [otherId, armPoints] of Object.entries(simState.cobotArmSamples)) {
        if (otherId === state.selfItem?.id || !armPoints?.length) continue;
        let colliding = false;
        for (const p of ownArmPoints) {
            for (const q of armPoints) {
                if (Vector3.DistanceSquared(p, q) <= armHitDistSq) {
                    colliding = true;
                    break;
                }
            }
            if (colliding) break;
        }
        if (colliding) {
            const otherCobot = factoryStore.getState().placedItems.find(item => item.id === otherId);
            return otherCobot ?? state.selfItem ?? null;
        }
    }

    return null;
}

export function armHitsPart(state: CobotState): { item: SimItem; severe: boolean } | null {
    if (!collisionSafetyEnabled(state)) return null;
    const armPoints = collectArmSamples(state);
    const payloadPad = carriedPayloadRadius(state);
    const pickPhase = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
    const dropPhase = state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release' || state.phase === 'drop_recenter';
    const dropTarget = dropPhase ? currentDropTarget(state) : null;
    const pickAnchor = pickPhase ? currentPickAnchor(state) : null;

    for (const item of simState.items) {
        if (item.state === 'dead' || item.state === 'grabbed') continue;
        if (item === state.grabbedItem) continue;
        if (pickPhase && item === state.targetedItem) continue;
        if (state.phase === 'drop_recenter' && item.id === state.lastDroppedItemId && state.waitTimer < 1.0) continue;

        const itemR = partRadiusForSpec(item);
        const itemHalf = partHalfHeight(item);
        if (pickAnchor) {
            const pdx = item.pos.x - pickAnchor.x;
            const pdz = item.pos.z - pickAnchor.z;
            const nearPickArea = Math.sqrt(pdx * pdx + pdz * pdz) < Math.max(itemR * 1.8, 0.42);
            const pickYAligned = item.pos.y <= pickAnchor.y + itemHalf + 0.2;
            if (nearPickArea && pickYAligned) continue;
        }
        if (dropTarget) {
            const ddx = item.pos.x - dropTarget.x;
            const ddz = item.pos.z - dropTarget.z;
            const nearDrop = Math.sqrt(ddx * ddx + ddz * ddz) < Math.max(itemR * 1.5, 0.45);
            const dropYAligned = item.pos.y <= dropTarget.y + itemHalf + 0.24;
            if (nearDrop && dropYAligned) continue;
        }

        for (let i = 0; i < armPoints.length; i++) {
            const p = armPoints[i];
            const dy = Math.abs(p.y - item.pos.y);
            if (dy > itemHalf + 0.22) continue;
            const pad = (i >= armPoints.length - 3 ? 0.05 + payloadPad : 0.085);
            const hitR = itemR + pad;
            if (Vector3.DistanceSquared(p, item.pos) <= hitR * hitR) {
                const severe = i < armPoints.length - 3 || dy > itemHalf + 0.04;
                return { item, severe };
            }
        }
    }
    return null;
}

export function isSoftAvoidCollision(state: CobotState, hit: PlacedItem): boolean {
    if (hit.type === 'belt') return true;
    const inPickOrDropFlow =
        state.phase === 'pick_hover' ||
        state.phase === 'pick_descend' ||
        state.phase === 'pick_attach' ||
        state.phase === 'hover_drop' ||
        state.phase === 'descend_drop' ||
        state.phase === 'release';
    if (hit.type === 'sender' && inPickOrDropFlow) return true;
    return false;
}

export function requestPredictiveReplan(state: CobotState, hit: PlacedItem | null) {
    if (hit) {
        const heading = state.baseRotY + state.basePivot.rotation.y;
        const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
        const right = new Vector3(forward.z, 0, -forward.x);
        const away = new Vector3(state.ikTarget.x - hit.position[0], 0, state.ikTarget.z - hit.position[2]);
        if (away.lengthSquared() > 0.0001) {
            state.avoidanceSide = Vector3.Dot(away.normalize(), right) >= 0 ? 1 : -1;
        } else if (state.avoidanceSide === 0) state.avoidanceSide = 1;
    }
    state.plannedPath = [];
    state.plannedPathCursor = 0;
    state.pathReplanCooldown = 0;
    state.recoveryTimer = Math.max(state.recoveryTimer, 0.14);
}

export function startRecoveryRetreat(state: CobotState, obstacle: PlacedItem | null) {
    const heading = state.baseRotY + state.basePivot.rotation.y;
    const fallbackAway = new Vector3(-Math.sin(heading), 0, -Math.cos(heading));
    const away = obstacle
        ? new Vector3(state.ikTarget.x - obstacle.position[0], 0, state.ikTarget.z - obstacle.position[2])
        : fallbackAway.clone();
    if (away.lengthSquared() < 0.0001) away.copyFrom(fallbackAway);
    away.normalize();
    state.retreatTarget = new Vector3(
        state.ikTarget.x + away.x * RETREAT_BACKOFF,
        Math.max(state.ikTarget.y + 0.22, state.position[1] + 1.18),
        state.ikTarget.z + away.z * RETREAT_BACKOFF
    );
    state.retreatTimer = RETREAT_DURATION;
    state.recoveryAttempts += 1;
    state.blockedTimer = 0;
    state.motionStallTimer = 0;
    state.recoveryTimer = Math.max(state.recoveryTimer, 0.5);
    state.pathReplanCooldown = Math.max(state.pathReplanCooldown, 0.5);
}

export function computeYieldTargetFromSensors(state: CobotState, _mountPos: Vector3): Vector3 | null {
    const hazards = state.sensorHazards || [0, 0, 0, 0];
    const maxHazard = Math.max(hazards[0], hazards[1], hazards[2], hazards[3]);
    const selfId = state.selfItem?.id;
    const selfLoaded = !!state.grabbedItem;
    state.wristRoll.computeWorldMatrix(true);
    const ownWrist = state.wristRoll.getAbsolutePosition();
    let nearestOther: Vector3 | null = null;
    let nearestOtherLoaded = false;
    let nearestDist = Infinity;
    for (const [id, wrist] of Object.entries(simState.cobotWrists)) {
        if (!wrist || id === selfId) continue;
        const dx = ownWrist.x - wrist.x;
        const dz = ownWrist.z - wrist.z;
        const dy = Math.abs(ownWrist.y - wrist.y);
        const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearestOther = wrist;
            nearestOtherLoaded = simState.cobotLoads[id] === true;
        }
    }
    const neighborTooClose = !!nearestOther && nearestDist < COBOT_NEIGHBOR_YIELD_TRIGGER;
    if (selfLoaded && nearestOtherLoaded === false && neighborTooClose) return null;
    // Yield only on orange sensors or near-contact cobot wrist clearance.
    if (maxHazard < 0.12 && !neighborTooClose) return null;

    // Simple Rule: When yielding, immediately retract to the home (idle) target.
    // Retracting to a known safe parking spot prevents arms from wildly sweeping into other cobots or parts.
    return clampTargetAboveSupports(state, state.idleTarget.clone(), 'idle', !!state.grabbedItem);
}
