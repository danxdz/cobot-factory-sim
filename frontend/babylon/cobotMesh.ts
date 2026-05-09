import {
    Vector3,
    Color3,
    MeshBuilder
} from '@babylonjs/core';
import { appendCobotLog, simState, SimItem } from '../simState';
import { PartShape, PartSize, PlacedItem, ProgramStep } from '../types';
import { factoryStore } from '../store';
import {
    COBOT_BODY_D,
    COBOT_BODY_W,
    COBOT_BASE_MAX_ANGULAR_SPEED,
    COBOT_FOREARM_LENGTH,
    COBOT_GRIPPER_TIP_OFFSET,
    COBOT_HAND_LINK_LENGTH,
    COBOT_MOUNT_REACH_OFFSET,
    COBOT_NEIGHBOR_YIELD_MAX_OFFSET,
    COBOT_NEIGHBOR_YIELD_MIN_OFFSET,
    COBOT_NEIGHBOR_YIELD_TRIGGER,
    COBOT_ARM_HARD_STOP_DIST,
    COBOT_ARM_REDUCED_SPEED_DIST,
    COBOT_PEDESTAL_HEIGHT,
    COBOT_PEDESTAL_SAFEZONE_RADIUS,
    COBOT_PLATFORM_D,
    COBOT_PLATFORM_TOP_Y,
    COBOT_PLATFORM_W,
    COBOT_SELF_HARD_STOP_DIST,
    COBOT_SELF_REDUCED_SPEED_DIST,
    COBOT_TOOL_REACH,
    COBOT_UPPER_ARM_LENGTH,
    COBOT_WRIST_LINK_LENGTH,
    COBOT_YIELD_HOLD_SEC,
    CONTACT_STALL_TIMEOUT,
    DISC_H,
    DISC_RADIUS,
    DROP_CLEARANCE,
    DROP_HOVER_CLEARANCE,
    DROP_RECENTER_CLEARANCE,
    HAND_SAFETY_EXTRA_RADIUS,
    IK_BASE_CLEARANCE_RADIUS,
    MAX_RECOVERY_ATTEMPTS,
    MOVE_ENDPOINT_TOLERANCE,
    MOVE_HARD_STALL_TIMEOUT,
    MOVE_STALL_CLOSE_TOLERANCE,
    MOVE_UNREACHABLE_PROJECTION_TOLERANCE,
    OVERDRIVE_DECAY_PER_SEC,
    OVERDRIVE_HIT_PENALTY,
    OVERDRIVE_STALL_PENALTY,
    PART_CONTACT_STOP_TIMEOUT,
    PART_CONTACT_WARN_TIMEOUT,
    PEDESTAL_HAND_CLEARANCE,
    PICK_ALIGN_RADIUS,
    PICK_ANCHOR_MAX_OFFSET,
    PICK_ANCHOR_MIN_OFFSET,
    PICK_ATTACH_ALIGN_RADIUS,
    PICK_CONTACT_PAD_GAP,
    PICK_CONTACT_RADIUS,
    PICK_DESCEND_CLEARANCE,
    PICK_GRAB_RADIUS,
    PICK_HOVER_CLEARANCE,
    PICK_LEAD_TIME,
    PICK_SKIP_COOLDOWN,
    PICK_SUPPORT_CLEARANCE,
    PICK_SURFACE_CONTACT_GAP,
    PICK_TARGET_LOCK_DURATION,
    PICK_TARGET_LOCK_ENTER_RADIUS,
    PICK_TARGET_LOCK_MAX_DRIFT,
    PICK_TARGET_TIMEOUT,
    RETREAT_BACKOFF,
    RETREAT_DURATION,
    SAFETY_HARD_STOP_DIST,
    SAFETY_MIN_SPEED_FACTOR,
    SAFETY_REDUCED_SPEED_DIST,
    STACK_SLOT_COLORS,
    STALL_PROGRESS_EPSILON,
    STUCK_STALL_TIMEOUT,
} from './cobot/constants';
import {
    PartLike,
    SHAPE_ORDER,
    partHalfHeight,
    partRadiusForSpec,
    partShape,
} from './cobot/partGeometry';
import { clamp, projectTargetToReachEnvelope } from './cobot/math';
import {
    cobotDefaultAngles,
    cobotElbowLimits,
    cobotForearmLength,
    cobotShoulderLimits,
    cobotUpperArmLength,
    cobotWristLength,
    cobotWristLimits,
} from './cobot/cobotConfig';
import type { CobotState, CobotLogEntry } from './cobot/stateTypes';

export { COBOT_PEDESTAL_HEIGHT, COBOT_PEDESTAL_SAFEZONE_RADIUS } from './cobot/constants';
export type { CobotState } from './cobot/stateTypes';
export { createCobot } from './cobot/createCobot';

const itemMotionTracker = new Map<string, { pos: Vector3; t: number; vel: Vector3 }>();
const PICK_HAND_PART_CLEARANCE = 0.032;
const PICK_HAND_CONTACT_TOLERANCE = 0.003;
const HAND_DISK_COLLIDER_RADIUS = 0.16;
const HAND_DISK_COLLIDER_HALF_HEIGHT = 0.018;
const HAND_DISK_CONTACT_SKIN = 0.016;

function collisionSafetyEnabled(state: CobotState): boolean { return state.selfItem?.config?.cobotCollisionEnabled !== false; }

type ParsedCobotDetail = {
    reason?: string;
    itemId?: string;
    mode?: string;
    durationSec?: number;
    snapDist?: number;
    planarDist?: number;
    verticalDist?: number;
};

function parseCobotDetail(detail?: string): ParsedCobotDetail {
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

function logCobotEvent(state: CobotState, event: string, detail?: string) {
    if (!state.selfItem?.id) return;
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

function appendSegmentSamples(out: Vector3[], a: Vector3, b: Vector3, steps: number) {
    const n = Math.max(1, steps);
    for (let i = 0; i <= n; i++) {
        if (out.length > 0 && i === 0) continue;
        out.push(Vector3.Lerp(a, b, i / n));
    }
}

function collectArmSamples(state: CobotState): Vector3[] {
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

type ArmLinkSample = [Vector3, Vector3, number];

const SELF_COLLISION_LINK_PAIRS: Array<[number, number, number]> = [
    [4, 0, 0.005], // tool against pedestal/shoulder column
    [4, 1, 0.005], // tool against upper arm
    [3, 0, 0.005], // wrist against pedestal/shoulder column
    [3, 1, 0.0],   // wrist against upper arm
    [2, 0, 0.0],   // forearm against pedestal/shoulder column
];

function collectArmLinks(state: CobotState): ArmLinkSample[] {
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

function closestPointOnSegment(point: Vector3, a: Vector3, b: Vector3): Vector3 {
    const ab = b.subtract(a);
    const lenSq = ab.lengthSquared();
    if (lenSq <= 0.000001) return a.clone();
    const t = clamp(Vector3.Dot(point.subtract(a), ab) / lenSq, 0, 1);
    return a.add(ab.scale(t));
}

function closestSampledSegmentPoints(a: Vector3, b: Vector3, c: Vector3, d: Vector3, samples = 7) {
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

function selfCollisionRiskFromLinks(links: ArmLinkSample[]): { clearance: number; point: Vector3 | null } {
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

function selfCollisionRisk(state: CobotState): { clearance: number; point: Vector3 | null } {
    return selfCollisionRiskFromLinks(collectArmLinks(state));
}

function topSurfaceAt(x: number, z: number, baseSurfaceY: number, ignoreItem?: SimItem | null, radius = 0.28): number {
    return simState.items.reduce((top, item) => {
        if (item === ignoreItem || item.state === 'dead' || item.state === 'grabbed') return top;
        const dx = item.pos.x - x;
        const dz = item.pos.z - z;
        if (Math.sqrt(dx * dx + dz * dz) > radius) return top;
        return Math.max(top, item.pos.y + partHalfHeight(item));
    }, baseSurfaceY);
}

function stackCenterYAt(
    x: number,
    z: number,
    baseCenterY: number,
    part: PartLike,
    ignoreItem?: SimItem | null,
    radius = 0.28
): number {
    const half = partHalfHeight(part);
    const baseSurfaceY = baseCenterY - half;
    const topSurface = topSurfaceAt(x, z, baseSurfaceY, ignoreItem, radius);
    return topSurface + half;
}

function quantizeHeight(y: number, step = 0.04): number {
    if (!Number.isFinite(y) || step <= 0) return y;
    return Math.round(y / step) * step;
}

function stackAwareClearanceAt(state: CobotState, x: number, z: number, carrying: boolean): number {
    const obstacles = dropObstacles(state);
    const payloadHeight = carrying ? carriedPayloadHeight(state) : 0;
    const wallClear = wallTopAt(x, z, obstacles) + (carrying ? 0.24 + payloadHeight : 0.36);
    const partSpec: PartLike = state.grabbedItem ?? { shape: 'disc', size: 'medium' };
    const stackBase = dropBaseCenterY(state, new Vector3(x, 0, z), partSpec);
    const stackCenter = stackCenterYAt(x, z, stackBase, partSpec, state.grabbedItem, 0.34);
    const stackTop = stackCenter + partHalfHeight(partSpec);
    const supportTop = supportTopAt(x, z, obstacles);
    const stackRise = Math.max(0, stackTop - supportTop);
    const riseBoost = clamp(stackRise * 0.28, 0, 0.24);
    const stackClear = stackTop + (carrying ? 0.24 + payloadHeight : 0.3) + riseBoost;
    return Math.max(wallClear, stackClear);
}

function platformStackClearanceY(state: CobotState, carrying: boolean): number {
    if (!state.selfItem || state.stackSlots.length === 0) return Number.NEGATIVE_INFINITY;
    const slotRadius = slotCaptureRadius(state.stackSlots.map(slot => slot.worldPos), 0.24);
    const payloadHeight = carrying ? carriedPayloadHeight(state) : 0;
    let top = state.selfItem.position[1] + COBOT_PLATFORM_TOP_Y;
    for (const slot of state.stackSlots) {
        const platformTop = state.selfItem.position[1] + COBOT_PLATFORM_TOP_Y;
        top = Math.max(top, topSurfaceAt(slot.worldPos.x, slot.worldPos.z, platformTop, state.grabbedItem, Math.max(slotRadius * 1.2, 0.34)));
    }
    return top + (carrying ? 0.26 + payloadHeight : 0.28);
}

function stackPathClearanceY(state: CobotState, start: Vector3, goal: Vector3, carrying: boolean): number {
    const payloadHeight = carrying ? carriedPayloadHeight(state) : 0;
    const sweptRadius = carrying
        ? Math.max(carriedPayloadRadius(state), HAND_DISK_COLLIDER_RADIUS) + 0.18
        : HAND_DISK_COLLIDER_RADIUS + 0.12;
    let maxClear = Number.NEGATIVE_INFINITY;

    for (const item of simState.items) {
        if (item === state.grabbedItem || item.state === 'dead' || item.state === 'grabbed') continue;
        const itemR = partRadiusForSpec(item);
        const sideClearance = itemR + sweptRadius;
        const dist = Math.sqrt(pointSegmentDistSq2D(item.pos.x, item.pos.z, start.x, start.z, goal.x, goal.z));
        if (dist > sideClearance) continue;

        const itemTop = item.pos.y + partHalfHeight(item);
        const supportTop = supportTopAt(item.pos.x, item.pos.z, dropObstacles(state), Math.max(itemR * 0.45, 0.1));
        const stackRise = Math.max(0, itemTop - supportTop);
        const verticalPad = carrying ? 0.28 + payloadHeight : 0.32;
        maxClear = Math.max(maxClear, itemTop + verticalPad + clamp(stackRise * 0.24, 0, 0.22));
    }

    return maxClear;
}

function obstaclePathClearanceY(state: CobotState, start: Vector3, goal: Vector3, carrying: boolean): number {
    const payloadHeight = carrying ? carriedPayloadHeight(state) : 0;
    const pad = carrying ? Math.max(carriedPayloadRadius(state) + 0.06, 0.24) : 0.24;
    let maxClear = Number.NEGATIVE_INFINITY;
    for (const obstacle of dropObstacles(state)) {
        if (obstacle.type === 'camera') continue;
        if (!segmentFootprintHit2D(start, goal, obstacle, pad)) continue;
        maxClear = Math.max(maxClear, machineWallY(obstacle) + (carrying ? 0.24 + payloadHeight : 0.36));
    }
    return maxClear;
}

function segmentTouchesSelfPlatform(state: CobotState, start: Vector3, goal: Vector3, pad = 0.16): boolean {
    if (!state.selfItem) return false;
    for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = start.x + (goal.x - start.x) * t;
        const z = start.z + (goal.z - start.z) * t;
        if (itemFootprintHit(state.selfItem, x, z, pad)) return true;
    }
    return false;
}

function segmentClearanceY(state: CobotState, start: Vector3, goal: Vector3, carrying: boolean): number {
    const samples = 5;
    let maxClear = Math.max(
        stackAwareClearanceAt(state, start.x, start.z, carrying),
        stackAwareClearanceAt(state, goal.x, goal.z, carrying)
    );
    for (let i = 1; i < samples; i++) {
        const t = i / samples;
        const x = start.x + (goal.x - start.x) * t;
        const z = start.z + (goal.z - start.z) * t;
        maxClear = Math.max(maxClear, stackAwareClearanceAt(state, x, z, carrying));
    }
    maxClear = Math.max(maxClear, stackPathClearanceY(state, start, goal, carrying));
    maxClear = Math.max(maxClear, obstaclePathClearanceY(state, start, goal, carrying));
    return segmentTouchesSelfPlatform(state, start, goal)
        ? Math.max(maxClear, platformStackClearanceY(state, carrying))
        : maxClear;
}

function toolSurfaceClearance(state: CobotState, phase: string): number {
    if (phase === 'pick_descend' || phase === 'pick_attach') return 0.025;
    if (phase === 'release' || phase === 'descend_drop') return 0.05;
    if (phase === 'hover_drop' || phase === 'pick_hover') return 0.06;
    return 0.05;
}

function isPickupContactOverride(state: CobotState): boolean {
    return !!state.targetedItem && (state.phase === 'pick_descend' || state.phase === 'pick_attach');
}

function carriedPayloadRadius(state: CobotState): number {
    if (!state.grabbedItem) return 0;
    const radius = partRadiusForSpec(state.grabbedItem);
    const halfHeight = partHalfHeight(state.grabbedItem);
    return radius + Math.min(0.08, halfHeight * 0.45) + 0.035;
}

function carriedPayloadHeight(state: CobotState): number {
    return state.grabbedItem ? partHalfHeight(state.grabbedItem) * 2 : 0;
}

function basePathKeepoutRadius(state: CobotState): number {
    const base = Math.max(IK_BASE_CLEARANCE_RADIUS, COBOT_PEDESTAL_SAFEZONE_RADIUS);
    if (!state.grabbedItem) return base;
    return Math.max(base, state.mountCollisionRadius + carriedPayloadRadius(state) + 0.16);
}

function clampTargetAboveSupports(state: CobotState, target: Vector3, phase: string, carrying: boolean): Vector3 {
    if (isPickupContactOverride(state)) return target;
    const obstacles = carrying ? dropObstacles(state) : (state.selfItem ? [...state.obstacles, state.selfItem] : state.obstacles);
    const edgePad =
        phase === 'pick_descend' || phase === 'pick_attach' || phase === 'descend_drop' || phase === 'release'
            ? 0.12
            : DISC_RADIUS * 0.22;
    const supportTop = supportTopAt(target.x, target.z, obstacles, edgePad);
    const minY = supportTop + toolSurfaceClearance(state, phase);
    if (target.y < minY) target.y = minY;
    return target;
}

function partHint(item: SimItem): PartLike & { color: string } {
    return {
        color: item.color,
        size: item.size,
        shape: item.shape,
        radiusScale: item.radiusScale,
        heightScale: item.heightScale,
        scaleX: item.scaleX,
        scaleZ: item.scaleZ,
    };
}

function itemFootprintHit(item: PlacedItem, x: number, z: number, pad = 0.0): boolean {
    if (item.type === 'camera') return false;
    const dx = Math.abs(x - item.position[0]);
    const dz = Math.abs(z - item.position[2]);
    const isRotated = (item.rotation || 0) % 2 !== 0;
    const lx = isRotated ? dz : dx;
    const lz = isRotated ? dx : dz;

    let w = 2, d = 2;
    if (item.type === 'table') [w, d] = item.config?.tableSize || [1.8, 1.8];
    else if (item.type === 'belt') [w, d] = item.config?.beltSize || [2, 2];
    else if (['sender', 'receiver', 'indexed_receiver', 'pile'].includes(item.type)) [w, d] = item.config?.machineSize || [2, 2];
    else if (item.type === 'cobot') { w = COBOT_PLATFORM_W; d = COBOT_PLATFORM_D; }

    return lx <= w / 2 + pad && lz <= d / 2 + pad;
}

function machineTopY(item: PlacedItem): number {
    switch (item.type) {
        case 'table': return item.config?.tableHeight || 0.45;
        case 'belt': return item.config?.beltHeight || 0.538;
        case 'cobot': return COBOT_PLATFORM_TOP_Y;
        case 'sender':
        case 'receiver':
        case 'indexed_receiver':
        case 'pile':
            return item.config?.machineHeight || 0.538;
        default:
            return 0.02;
    }
}

function supportTopAt(x: number, z: number, obstacles: PlacedItem[], pad = DISC_RADIUS * 0.35): number {
    let topY = 0;
    for (const obstacle of obstacles) {
        if (!itemFootprintHit(obstacle, x, z, pad)) continue;
        topY = Math.max(topY, machineTopY(obstacle));
    }
    return topY;
}

function machineWallY(item: PlacedItem): number {
    switch (item.type) {
        case 'receiver':
        case 'indexed_receiver':
            return 1.2;
        default:
            return machineTopY(item);
    }
}

function wallTopAt(x: number, z: number, obstacles: PlacedItem[]): number {
    let topY = 0;
    for (const obstacle of obstacles) {
        if (!itemFootprintHit(obstacle, x, z, 0.1)) continue;
        topY = Math.max(topY, machineWallY(obstacle));
    }
    return topY;
}

function dropObstacles(state: CobotState): PlacedItem[] {
    return state.selfItem ? [...state.obstacles, state.selfItem] : state.obstacles;
}

function driveVector(rotation: number): Vector3 {
    switch (rotation) {
        case 0: return new Vector3(0, 0, -1);
        case 1: return new Vector3(1, 0, 0);
        case 2: return new Vector3(0, 0, 1);
        case 3: return new Vector3(-1, 0, 0);
        default: return Vector3.Zero();
    }
}

function driveTileAt(x: number, z: number, obstacles: PlacedItem[]): PlacedItem | null {
    return obstacles.find(item => {
        if (item.type !== 'belt' && item.type !== 'sender') return false;
        const [w, d] = item.type === 'belt' ? (item.config?.beltSize || [2, 2]) : (item.config?.machineSize || [2, 2]);
        return Math.abs(x - item.position[0]) <= w / 2 && Math.abs(z - item.position[2]) <= d / 2;
    }) ?? null;
}

function predictedPickupPos(item: SimItem, obstacles: PlacedItem[], leadTime = PICK_LEAD_TIME): Vector3 {
    const predicted = item.pos.clone();
    const driveTile = driveTileAt(item.pos.x, item.pos.z, obstacles);
    if (!driveTile) return predicted;
    const speed = (driveTile.config?.speed || 2) * 0.55;
    return predicted.addInPlace(driveVector(driveTile.rotation).scale(speed * leadTime));
}

function estimateItemVelocity(state: CobotState, item: SimItem): Vector3 {
    const now = state.simTime;
    const tracked = itemMotionTracker.get(item.id);
    if (!tracked) {
        itemMotionTracker.set(item.id, { pos: item.pos.clone(), t: now, vel: Vector3.Zero() });
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

function pickupLeadTime(state: CobotState, item: SimItem, baseLead = PICK_LEAD_TIME): number {
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

function bestDetectionForItem(state: CobotState, item: SimItem) {
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

function pickupAimPoint(state: CobotState, item: SimItem, leadTime = PICK_LEAD_TIME): Vector3 {
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

function pickupContactTipY(targetTop: number, supportTop: number): number {
    return Math.max(targetTop + PICK_HAND_PART_CLEARANCE, supportTop + PICK_SUPPORT_CLEARANCE);
}

function pickupContactState(state: CobotState, item: SimItem | null) {
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

function clampPickupHandAboveParts(state: CobotState): boolean {
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

function resolveHandDiskPartContacts(state: CobotState): boolean {
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

        let nx = dx;
        let nz = dz;
        let nLen = planar;
        if (nLen < 0.0001) {
            nx = state.ikVelocity.x;
            nz = state.ikVelocity.z;
            nLen = Math.sqrt(nx * nx + nz * nz);
            if (nLen < 0.0001) {
                nx = 1;
                nz = 0;
                nLen = 1;
            }
        }
        nx /= nLen;
        nz /= nLen;

        const push = sideRadius - planar;
        tip.x += nx * push;
        tip.z += nz * push;

        const inward = state.ikVelocity.x * nx + state.ikVelocity.z * nz;
        if (inward < 0) {
            state.ikVelocity.x -= inward * nx;
            state.ikVelocity.z -= inward * nz;
        }

        const desiredDx = state.desiredTarget.x - item.pos.x;
        const desiredDz = state.desiredTarget.z - item.pos.z;
        const desiredPlanar = Math.sqrt(desiredDx * desiredDx + desiredDz * desiredDz);
        if (desiredPlanar < sideRadius) {
            if (desiredPlanar > 0.0001) {
                const scale = sideRadius / desiredPlanar;
                state.desiredTarget.x = item.pos.x + desiredDx * scale;
                state.desiredTarget.z = item.pos.z + desiredDz * scale;
            } else {
                state.desiredTarget.x = tip.x;
                state.desiredTarget.z = tip.z;
            }
        }

        adjusted = true;
    }

    return adjusted;
}

function resolveArmLinkStackClearance(state: CobotState): boolean {
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
        state.desiredTarget.x = state.ikTarget.x;
        state.desiredTarget.z = state.ikTarget.z;
        state.ikVelocity.x *= 0.2;
        state.ikVelocity.z *= 0.2;
    }
    state.ikVelocity.y = Math.max(state.ikVelocity.y, 0);
    state.pathReplanCooldown = 0;
    return true;
}

function nearbyPickupPenalty(candidate: SimItem): number {
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

function partMatchesPickFilters(state: CobotState, candidate: SimItem): boolean {
    return (state.pickColors.length === 0 || state.pickColors.includes(candidate.color)) &&
        (state.pickSizes.length === 0 || state.pickSizes.includes(candidate.size));
}

function canReachPickupCandidate(
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

function pickupCandidateStepDistance(state: CobotState, candidate: SimItem, stepPos: Vector3): number {
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

function isPickupCandidateCovered(candidate: SimItem): boolean {
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

function findPickupCandidateForStep(
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
            const stepDist = pickupCandidateStepDistance(state, i, stepPos);
            const partR = partRadiusForSpec(i);
            const pickWindow = onDrive
                ? Math.max(0.85, partR + 0.45)
                : Math.max(0.62, partR + 0.24);
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

function acquirePickupTarget(state: CobotState, item: SimItem) {
    item.state = 'targeted';
    state.targetedItem = item;
    state.targetTimer = 0;
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

function itemsNearSlot(slot: Vector3, radius: number, ignoreItem?: SimItem | null): SimItem[] {
    return simState.items.filter(item => {
        if (item === ignoreItem || item.state === 'dead' || item.state === 'grabbed') return false;
        const dx = item.pos.x - slot.x;
        const dz = item.pos.z - slot.z;
        return Math.sqrt(dx * dx + dz * dz) < radius;
    });
}

function assignItemsToSlots(slots: Vector3[], ignoreItem?: SimItem | null, maxAssignDist = 0.42): SimItem[][] {
    const assigned = slots.map((): SimItem[] => []);
    for (const item of simState.items) {
        if (item === ignoreItem || item.state === 'dead' || item.state === 'grabbed') continue;
        let best = -1;
        let bestDistSq = Number.POSITIVE_INFINITY;
        for (let i = 0; i < slots.length; i++) {
            const dx = item.pos.x - slots[i].x;
            const dz = item.pos.z - slots[i].z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDistSq) {
                bestDistSq = d2;
                best = i;
            }
        }
        if (best < 0) continue;
        if (Math.sqrt(bestDistSq) > maxAssignDist) continue;
        assigned[best].push(item);
    }
    return assigned;
}

function isTemporarilyAvoidedDropTarget(state: CobotState, slot: Vector3): boolean {
    if (!state.avoidDropTarget || state.simTime > state.avoidDropUntil) return false;
    const dx = slot.x - state.avoidDropTarget.x;
    const dz = slot.z - state.avoidDropTarget.z;
    return Math.sqrt(dx * dx + dz * dz) < 0.24;
}

function slotCaptureRadius(slots: Vector3[], fallback = 0.24): number {
    if (slots.length < 2) return fallback;
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
            const d = Vector3.Distance(slots[i], slots[j]);
            if (d < minDist) minDist = d;
        }
    }
    if (!isFinite(minDist) || minDist <= 0.0001) return fallback;
    return clamp(minDist * 0.45, 0.18, 0.32);
}

function getOrganizedDropTarget(
    state: CobotState,
    container: PlacedItem,
    sortColor: boolean,
    sortSize: boolean,
    sortShape: boolean,
    itemHint?: ({ color: string } & PartLike),
    ignoreItem?: SimItem | null
): Vector3 | null {
    const grabbedOrHint = itemHint ?? (state.grabbedItem ? partHint(state.grabbedItem) : null);
    if (!grabbedOrHint) return null;
    const gridW = Math.max(1, Math.min(6, Math.round(container.config?.tableGrid?.[0] || 3)));
    const gridD = Math.max(1, Math.min(6, Math.round(container.config?.tableGrid?.[1] || 3)));
    const sizeW = container.config?.machineSize?.[0] || container.config?.tableSize?.[0] || (container.type === 'table' ? 1.8 : 2);
    const sizeD = container.config?.machineSize?.[1] || container.config?.tableSize?.[1] || (container.type === 'table' ? 1.8 : 2);

    const rotY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][container.rotation] ?? 0;
    const slots: Vector3[] = [];
    const slotCoords: Array<{ x: number; z: number }> = [];
    const cellW = sizeW / gridW;
    const cellD = sizeD / gridD;

    for (let x = 0; x < gridW; x++) {
        for (let z = 0; z < gridD; z++) {
            const lx = -sizeW / 2 + cellW / 2 + x * cellW;
            const lz = -sizeD / 2 + cellD / 2 + z * cellD;
            const wx = container.position[0] + lx * Math.cos(rotY) + lz * Math.sin(rotY);
            const wz = container.position[2] - lx * Math.sin(rotY) + lz * Math.cos(rotY);
            slots.push(new Vector3(wx, container.position[1], wz));
            slotCoords.push({ x, z });
        }
    }

    const stackRadius = slotCaptureRadius(slots, Math.max(0.16, Math.min(cellW, cellD) * 0.36));
    const ignored = ignoreItem ?? state.grabbedItem;
    const slotItems = assignItemsToSlots(slots, ignored, Math.max(stackRadius * 1.05, 0.32));
    const slotCounts = slotItems.map(items => items.length);
    const itemColor = grabbedOrHint.color;
    const itemSize = grabbedOrHint.size;
    const itemShape = partShape(grabbedOrHint);

    const slotMatchesSort = (idx: number) => slotItems[idx].every(existing =>
        (!sortColor || existing.color === itemColor) &&
        (!sortSize || existing.size === itemSize) &&
        (!sortShape || partShape(existing) === itemShape)
    );

    const colorOrder = STACK_SLOT_COLORS;
    const sizeOrder: PartSize[] = ['small', 'medium', 'large'];
    const colorIndex = Math.max(0, colorOrder.indexOf(itemColor));
    const sizeIndex = Math.max(0, sizeOrder.indexOf(itemSize));
    const shapeIndex = Math.max(0, SHAPE_ORDER.indexOf(itemShape));
    const preferredCol = gridW > 1 ? (colorIndex % gridW) : 0;
    const preferredRow = gridD > 1 ? (sizeIndex % gridD) : 0;
    const preferredShapeCol = gridW > 1 ? (shapeIndex % gridW) : 0;
    const preferredShapeRow = gridD > 1 ? (Math.floor(shapeIndex / gridW) % gridD) : 0;

    const preferredIndices: number[] = [];
    const pushUnique = (idx: number) => {
        if (idx >= 0 && idx < slots.length && !preferredIndices.includes(idx)) preferredIndices.push(idx);
    };

    if (sortColor && sortSize) {
        slotCoords.forEach((coord, idx) => {
            if (coord.x === preferredCol && coord.z === preferredRow) pushUnique(idx);
        });
        slotCoords.forEach((coord, idx) => {
            if (coord.x === preferredCol) pushUnique(idx);
        });
        slotCoords.forEach((coord, idx) => {
            if (coord.z === preferredRow) pushUnique(idx);
        });
    } else if (sortColor) {
        slotCoords.forEach((coord, idx) => {
            if (coord.x === preferredCol) pushUnique(idx);
        });
    } else if (sortSize) {
        slotCoords.forEach((coord, idx) => {
            if (coord.z === preferredRow) pushUnique(idx);
        });
    }
    if (sortShape) {
        slotCoords.forEach((coord, idx) => {
            if (coord.x === preferredShapeCol && coord.z === preferredShapeRow) pushUnique(idx);
        });
        slotCoords.forEach((coord, idx) => {
            if (coord.x === preferredShapeCol) pushUnique(idx);
        });
        slotCoords.forEach((coord, idx) => {
            if (coord.z === preferredShapeRow) pushUnique(idx);
        });
    }
    for (let i = 0; i < slots.length; i++) pushUnique(i);

    const rank = new Map<number, number>();
    preferredIndices.forEach((idx, order) => rank.set(idx, order));
    const pickBest = (predicate: (idx: number) => boolean) => {
        let best = -1;
        let bestCount = Number.POSITIVE_INFINITY;
        let bestRank = Number.POSITIVE_INFINITY;
        for (const idx of preferredIndices) {
            if (isTemporarilyAvoidedDropTarget(state, slots[idx])) continue;
            if (!predicate(idx)) continue;
            const count = slotCounts[idx];
            const order = rank.get(idx) ?? Number.POSITIVE_INFINITY;
            if (count < bestCount || (count === bestCount && order < bestRank)) {
                best = idx;
                bestCount = count;
                bestRank = order;
            }
        }
        return best;
    };

    // Stack-first behavior: if we already have a matching stack, keep piling there.
    const pickBestDense = (predicate: (idx: number) => boolean) => {
        let best = -1;
        let bestCount = -1;
        let bestRank = Number.POSITIVE_INFINITY;
        for (const idx of preferredIndices) {
            if (isTemporarilyAvoidedDropTarget(state, slots[idx])) continue;
            if (!predicate(idx)) continue;
            const count = slotCounts[idx];
            const order = rank.get(idx) ?? Number.POSITIVE_INFINITY;
            if (count > bestCount || (count === bestCount && order < bestRank)) {
                best = idx;
                bestCount = count;
                bestRank = order;
            }
        }
        return best;
    };
    let bestIdx = pickBestDense(i => slotCounts[i] > 0 && slotMatchesSort(i));
    if (bestIdx < 0) bestIdx = pickBest(i => slotCounts[i] === 0 && slotMatchesSort(i));
    if (bestIdx < 0) bestIdx = pickBest(i => slotCounts[i] > 0 && slotMatchesSort(i));
    if (bestIdx < 0) bestIdx = pickBest(i => slotCounts[i] === 0);
    if (bestIdx < 0) bestIdx = pickBest(() => true);
    if (bestIdx < 0) return null;

    const target = slots[bestIdx];
    const dropY = stackCenterYAt(target.x, target.z, dropBaseCenterY(state, target, grabbedOrHint), grabbedOrHint, ignored, stackRadius);
    return new Vector3(target.x, dropY, target.z);
}

function getSelfPlatformDropTarget(
    state: CobotState,
    sortColor: boolean,
    sortSize: boolean,
    sortShape: boolean,
    itemHint?: ({ color: string } & PartLike),
    ignoreItem?: SimItem | null
): Vector3 | null {
    const grabbedOrHint = itemHint ?? (state.grabbedItem ? partHint(state.grabbedItem) : null);
    if (!grabbedOrHint || state.stackSlots.length === 0) return null;
    const stackRadius = slotCaptureRadius(state.stackSlots.map(s => s.worldPos), 0.24);
    const itemColor = grabbedOrHint.color;
    const itemSize = grabbedOrHint.size;
    const itemShape = partShape(grabbedOrHint);
    const ignored = ignoreItem ?? state.grabbedItem;
    state.mountBase.computeWorldMatrix(true);
    const mountPos = state.mountBase.getAbsolutePosition();

    const slotItems = assignItemsToSlots(
        state.stackSlots.map(slot => slot.worldPos),
        ignored,
        Math.max(stackRadius * 1.05, 0.32)
    );
    const slotCounts = slotItems.map(items => items.length);

    const hasRoom = (idx: number) =>
        slotCounts[idx] < state.stackSlots[idx].maxStack &&
        !isTemporarilyAvoidedDropTarget(state, state.stackSlots[idx].worldPos);
    const matchesSort = (idx: number) => slotItems[idx].every(existing =>
        (!sortColor || existing.color === itemColor) &&
        (!sortSize || existing.size === itemSize) &&
        (!sortShape || partShape(existing) === itemShape)
    );

    const maxCol = Math.max(...state.stackSlots.map(slot => slot.col));
    const maxRow = Math.max(...state.stackSlots.map(slot => slot.row));
    const gridW = maxCol + 1;
    const gridD = maxRow + 1;
    const colorOrder = STACK_SLOT_COLORS;
    const sizeOrder: PartSize[] = ['small', 'medium', 'large'];
    const colorIndex = Math.max(0, colorOrder.indexOf(itemColor));
    const sizeIndex = Math.max(0, sizeOrder.indexOf(itemSize));
    const shapeIndex = Math.max(0, SHAPE_ORDER.indexOf(itemShape));
    const preferredCol = gridW > 1 ? (colorIndex % gridW) : 0;
    const preferredRow = gridD > 1 ? (sizeIndex % gridD) : 0;
    const preferredShapeCol = gridW > 1 ? (shapeIndex % gridW) : 0;
    const preferredShapeRow = gridD > 1 ? (Math.floor(shapeIndex / gridW) % gridD) : 0;

    const preferredIndices: number[] = [];
    const pushUnique = (idx: number) => {
        if (idx >= 0 && idx < state.stackSlots.length && !preferredIndices.includes(idx)) preferredIndices.push(idx);
    };

    if (sortColor && sortSize) {
        state.stackSlots.forEach((slot, idx) => {
            if (slot.col === preferredCol && slot.row === preferredRow) pushUnique(idx);
        });
        state.stackSlots.forEach((slot, idx) => {
            if (slot.col === preferredCol) pushUnique(idx);
        });
        state.stackSlots.forEach((slot, idx) => {
            if (slot.row === preferredRow) pushUnique(idx);
        });
    } else if (sortColor) {
        state.stackSlots.forEach((slot, idx) => {
            if (slot.col === preferredCol) pushUnique(idx);
        });
    } else if (sortSize) {
        state.stackSlots.forEach((slot, idx) => {
            if (slot.row === preferredRow) pushUnique(idx);
        });
    }
    if (sortShape) {
        state.stackSlots.forEach((slot, idx) => {
            if (slot.col === preferredShapeCol && slot.row === preferredShapeRow) pushUnique(idx);
        });
        state.stackSlots.forEach((slot, idx) => {
            if (slot.col === preferredShapeCol) pushUnique(idx);
        });
        state.stackSlots.forEach((slot, idx) => {
            if (slot.row === preferredShapeRow) pushUnique(idx);
        });
    }
    for (let i = 0; i < state.stackSlots.length; i++) pushUnique(i);
    if (!sortColor && !sortSize && !sortShape) {
        preferredIndices.sort((a, b) => {
            const da = Vector3.DistanceSquared(state.stackSlots[a].worldPos, mountPos);
            const db = Vector3.DistanceSquared(state.stackSlots[b].worldPos, mountPos);
            return db - da;
        });
    }

    const rank = new Map<number, number>();
    preferredIndices.forEach((idx, order) => rank.set(idx, order));
    const mountDistSq = (idx: number) => Vector3.DistanceSquared(state.stackSlots[idx].worldPos, mountPos);
    const pickBest = (predicate: (idx: number) => boolean) => {
        let best = -1;
        let bestCount = Number.POSITIVE_INFINITY;
        let bestRank = Number.POSITIVE_INFINITY;
        let bestDistSq = -1;
        for (const idx of preferredIndices) {
            if (!predicate(idx)) continue;
            const count = slotCounts[idx];
            const order = rank.get(idx) ?? Number.POSITIVE_INFINITY;
            const distSq = mountDistSq(idx);
            if (
                count < bestCount ||
                (count === bestCount && distSq > bestDistSq + 0.0001) ||
                (count === bestCount && Math.abs(distSq - bestDistSq) <= 0.0001 && order < bestRank)
            ) {
                best = idx;
                bestCount = count;
                bestRank = order;
                bestDistSq = distSq;
            }
        }
        return best;
    };

    // Stack-first behavior on cobot platform:
    // keep stacking same sorted slot until maxStack, then move to empties/others.
    const pickBestDense = (predicate: (idx: number) => boolean) => {
        let best = -1;
        let bestCount = -1;
        let bestRank = Number.POSITIVE_INFINITY;
        let bestDistSq = -1;
        for (const idx of preferredIndices) {
            if (!predicate(idx)) continue;
            const count = slotCounts[idx];
            const order = rank.get(idx) ?? Number.POSITIVE_INFINITY;
            const distSq = mountDistSq(idx);
            if (
                count > bestCount ||
                (count === bestCount && distSq > bestDistSq + 0.0001) ||
                (count === bestCount && Math.abs(distSq - bestDistSq) <= 0.0001 && order < bestRank)
            ) {
                best = idx;
                bestCount = count;
                bestRank = order;
                bestDistSq = distSq;
            }
        }
        return best;
    };
    let bestIdx = pickBestDense(i => hasRoom(i) && slotCounts[i] > 0 && matchesSort(i));
    if (bestIdx < 0) bestIdx = pickBest(i => hasRoom(i) && slotCounts[i] === 0 && matchesSort(i));
    if (bestIdx < 0) bestIdx = pickBest(i => hasRoom(i) && slotCounts[i] > 0 && matchesSort(i));
    if (bestIdx < 0) bestIdx = pickBest(i => hasRoom(i) && slotCounts[i] === 0);
    if (bestIdx < 0) bestIdx = pickBest(i => hasRoom(i));
    if (bestIdx < 0) return null;

    const slot = state.stackSlots[bestIdx];
    const stackTop = stackCenterYAt(slot.worldPos.x, slot.worldPos.z, dropBaseCenterY(state, slot.worldPos, grabbedOrHint), grabbedOrHint, ignored, stackRadius);
    return new Vector3(slot.worldPos.x, stackTop, slot.worldPos.z);
}

function enforceDropReachability(state: CobotState, target: Vector3): Vector3 {
    state.mountBase.computeWorldMatrix(true);
    const mountPos = state.mountBase.getAbsolutePosition();
    // Tiny center offset only to avoid singularity at exact mount center.
    const minPlanar = clamp(Math.max(IK_BASE_CLEARANCE_RADIUS, COBOT_PEDESTAL_SAFEZONE_RADIUS), COBOT_PEDESTAL_SAFEZONE_RADIUS, 0.08);
    const dx = target.x - mountPos.x;
    const dz = target.z - mountPos.z;
    const planar = Math.sqrt(dx * dx + dz * dz);
    if (planar >= minPlanar || planar < 0.0001) {
        if (planar < 0.0001) {
            const heading = state.baseRotY + state.basePivot.rotation.y;
            target.x = mountPos.x + Math.sin(heading) * minPlanar;
            target.z = mountPos.z + Math.cos(heading) * minPlanar;
        }
        return target;
    }
    const s = minPlanar / planar;
    target.x = mountPos.x + dx * s;
    target.z = mountPos.z + dz * s;
    return target;
}

function computeDropTarget(state: CobotState): Vector3 | null {
    if (!state.grabbedItem) return null;
    if (state.autoDropTarget) return enforceDropReachability(state, state.autoDropTarget.clone());
    if (state.program.length === 0) return null;
    const step = state.program[state.stepIndex % state.program.length];
    if (step?.action !== 'drop' || !step.pos) return null;

    const container = state.obstacles.find(o =>
        ['pile', 'table', 'receiver', 'indexed_receiver'].includes(o.type) &&
        Math.abs(o.position[0] - step.pos![0]) < (o.config?.machineSize?.[0] || o.config?.tableSize?.[0] || (o.type === 'table' ? 1.8 : 2)) / 2 &&
        Math.abs(o.position[2] - step.pos![2]) < (o.config?.machineSize?.[1] || o.config?.tableSize?.[1] || (o.type === 'table' ? 1.8 : 2)) / 2
    );

    const sortColor = step.sortColor !== false;
    const sortSize = step.sortSize !== false;
    const sortShape = step.sortShape !== false;
    const selfSort = selfSortPreferences(state);
    const exactDropRequested = !sortColor && !sortSize && !sortShape;

    if (state.selfItem && itemFootprintHit(state.selfItem, step.pos[0], step.pos[2], 0.02)) {
        if (exactDropRequested) {
            return enforceDropReachability(state, new Vector3(step.pos[0], step.pos[1], step.pos[2]));
        }
        const selfTarget = getSelfPlatformDropTarget(state, selfSort.sortColor, selfSort.sortSize, selfSort.sortShape);
        return selfTarget ? enforceDropReachability(state, selfTarget) : null;
    }

    if (container) {
        if (exactDropRequested) {
            return enforceDropReachability(state, new Vector3(step.pos[0], step.pos[1], step.pos[2]));
        }
        const orgTarget = getOrganizedDropTarget(state, container, sortColor, sortSize, sortShape);
        if (orgTarget) return enforceDropReachability(state, orgTarget);
        const relaxedTarget = getOrganizedDropTarget(state, container, false, false, false);
        if (relaxedTarget) return enforceDropReachability(state, relaxedTarget);
        // Cannot place into destination grid. Fallback to own platform slots.
        const selfTarget = getSelfPlatformDropTarget(state, selfSort.sortColor, selfSort.sortSize, selfSort.sortShape);
        return selfTarget ? enforceDropReachability(state, selfTarget) : null;
    }
    return enforceDropReachability(state, new Vector3(step.pos[0], step.pos[1], step.pos[2]));
}

function currentDropTarget(state: CobotState): Vector3 | null {
    if (!state.grabbedItem) return null;
    if (!['transit_drop', 'hover_drop', 'descend_drop', 'release'].includes(state.phase)) return null;
    const lockedDropPhase = state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release';
    if (
        lockedDropPhase &&
        state.activeDropTarget &&
        !isTemporarilyAvoidedDropTarget(state, state.activeDropTarget)
    ) {
        return state.activeDropTarget.clone();
    }
    if (
        state.autoDropTarget &&
        state.grabbedItem &&
        isTemporarilyAvoidedDropTarget(state, state.autoDropTarget)
    ) {
        const replanned = resolveAutoDropTarget(state, partHint(state.grabbedItem));
        if (replanned) state.autoDropTarget = replanned.clone();
    }
    const dynamicPhase = state.phase === 'transit_drop' || state.phase === 'hover_drop' || state.phase === 'descend_drop';
    const computed = computeDropTarget(state);
    if (dynamicPhase && computed) {
        if (!state.activeDropTarget || state.phase === 'transit_drop') {
            state.activeDropTarget = computed.clone();
        }
        return state.activeDropTarget.clone();
    }
    if (state.activeDropTarget) return state.activeDropTarget.clone();
    if (computed) state.activeDropTarget = computed.clone();
    return computed;
}

function isSelfPlatformDropPhase(state: CobotState, target?: Vector3 | null): boolean {
    if (!state.selfItem) return false;
    if (!['hover_drop', 'descend_drop', 'release', 'drop_recenter'].includes(state.phase)) return false;
    const t = target ?? (state.phase === 'drop_recenter' ? state.dropExitTarget : currentDropTarget(state));
    if (!t) return false;
    return itemFootprintHit(state.selfItem, t.x, t.z, 0.08);
}

function currentProgramStep(state: CobotState): ProgramStep | null {
    if (state.program.length === 0) return null;
    return state.program[state.stepIndex % state.program.length] ?? null;
}

function currentPickAnchor(state: CobotState): Vector3 | null {
    const step = currentProgramStep(state);
    if (!step || step.action !== 'pick' || !step.pos) return null;
    return new Vector3(step.pos[0], step.pos[1], step.pos[2]);
}

function pickWaitTargetForStep(state: CobotState, step: ProgramStep | null | undefined): Vector3 | null {
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

function currentPickWaitTarget(state: CobotState): Vector3 | null {
    return pickWaitTargetForStep(state, currentProgramStep(state));
}

function nextPickWaitTarget(state: CobotState): Vector3 | null {
    const idx = nextProgramActionIndex(state, 'pick');
    return idx === null ? null : pickWaitTargetForStep(state, state.program[idx]);
}

function currentDropAnchor(state: CobotState): Vector3 | null {
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

function autoDropAnchor(state: CobotState): Vector3 | null {
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

function clampTargetAroundAnchorXZ(anchor: Vector3, target: Vector3, maxOffset: number): Vector3 {
    const dx = target.x - anchor.x;
    const dz = target.z - anchor.z;
    const planar = Math.sqrt(dx * dx + dz * dz);
    if (planar <= maxOffset || planar < 0.0001) return target.clone();
    const s = maxOffset / planar;
    return new Vector3(anchor.x + dx * s, target.y, anchor.z + dz * s);
}

function movingPickupWindowRadius(partR: number): number {
    return clamp(partR * 1.75, 0.42, 0.58);
}

function pickupLatchPlanarRadius(targetRadius: number, targetOnDrive: boolean): number {
    return targetOnDrive
        ? clamp(targetRadius * 0.42, 0.1, HAND_DISK_COLLIDER_RADIUS * 0.9)
        : clamp(targetRadius * 0.2, 0.04, 0.065);
}

function pickupLatchVerticalRadius(targetOnDrive: boolean): number {
    return targetOnDrive ? 0.055 : 0.035;
}

function resolveAutoDropTarget(state: CobotState, hint: ({ color: string } & PartLike)): Vector3 | null {
    const selfSort = selfSortPreferences(state);
    let target = getSelfPlatformDropTarget(
        state,
        selfSort.sortColor,
        selfSort.sortSize,
        selfSort.sortShape,
        hint
    );
    if (target) return target;

    target = getSelfPlatformDropTarget(state, false, false, false, hint);
    return target;
}

function nextProgramActionIndex(state: CobotState, action: ProgramStep['action']): number | null {
    if (state.program.length === 0) return null;
    for (let offset = 1; offset <= state.program.length; offset++) {
        const idx = (state.stepIndex + offset) % state.program.length;
        if (state.program[idx]?.action === action) return idx;
    }
    return null;
}

function carryTravelY(state: CobotState, target: Vector3 | null): number {
    const payloadHeight = carriedPayloadHeight(state);
    const baseClearance = state.position[1] + 0.92 + payloadHeight;
    const currentClearance = state.ikTarget.y + 0.08;
    if (!target) return quantizeHeight(Math.max(baseClearance, currentClearance), 0.05);
    const targetClearance = segmentClearanceY(state, state.ikTarget, target, true);
    return quantizeHeight(Math.max(baseClearance, currentClearance, targetClearance), 0.05);
}

function computeYieldTargetFromSensors(state: CobotState, mountPos: Vector3): Vector3 | null {
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

    const heading = state.baseRotY + state.basePivot.rotation.y;
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    const right = new Vector3(forward.z, 0, -forward.x);
    const away = forward.scale(hazards[2] - hazards[0]).add(right.scale(hazards[3] - hazards[1]));

    if (neighborTooClose && nearestOther) {
        const neighborAway = new Vector3(ownWrist.x - nearestOther.x, 0, ownWrist.z - nearestOther.z);
        const equalPriority = selfLoaded === nearestOtherLoaded;
        if (neighborAway.lengthSquared() < 0.0001) {
            neighborAway.copyFrom(right);
        } else {
            neighborAway.normalize();
        }
        if (equalPriority) {
            away.copyFrom(right);
        } else if (!selfLoaded && nearestOtherLoaded) {
            neighborAway.scaleInPlace(0.45).addInPlace(right.scale(0.55)).normalize();
            away.copyFrom(neighborAway);
        } else if (away.lengthSquared() < 0.0001) {
            away.copyFrom(neighborAway);
        } else {
            away.scaleInPlace(0.42).addInPlace(neighborAway.scale(0.58));
        }
    }
    if (away.lengthSquared() < 0.0001) return null;
    away.normalize();

    const hazardOffset = 0.56 + maxHazard * 0.5;
    const neighborOffset = neighborTooClose
        ? clamp(
            (COBOT_NEIGHBOR_YIELD_TRIGGER - nearestDist) * 1.1 + COBOT_NEIGHBOR_YIELD_MIN_OFFSET,
            COBOT_NEIGHBOR_YIELD_MIN_OFFSET,
            COBOT_NEIGHBOR_YIELD_MAX_OFFSET
        )
        : 0;
    const offset = Math.max(hazardOffset, neighborOffset);
    const x = mountPos.x + away.x * offset;
    const z = mountPos.z + away.z * offset;
    const y = state.position[1] + 1.38;
    return clampTargetAboveSupports(state, new Vector3(x, y, z), 'idle', !!state.grabbedItem);
}

function dropBaseCenterY(state: CobotState, target: Vector3, part?: PartLike): number {
    const supportTop = supportTopAt(target.x, target.z, dropObstacles(state));
    const stackPart = part ?? state.grabbedItem ?? { shape: 'disc' as PartShape, size: 'medium' as PartSize };
    return supportTop + partHalfHeight(stackPart);
}

function dropPlacementState(state: CobotState) {
    if (!state.grabbedItem) return null;
    const target = currentDropTarget(state);
    if (!target) return null;
    const stackBaseY = dropBaseCenterY(state, target, state.grabbedItem);
    const landingY = stackCenterYAt(target.x, target.z, stackBaseY, state.grabbedItem, state.grabbedItem, 0.3);
    const dx = state.grabbedItem.pos.x - target.x;
    const dz = state.grabbedItem.pos.z - target.z;
    const planar = Math.sqrt(dx * dx + dz * dz);
    const partR = Math.max(DISC_RADIUS, partRadiusForSpec(state.grabbedItem));
	    return {
	        target,
	        landingY,
	        planar,
	        partR,
	        touching: planar <= Math.max(partR * 0.28, 0.06) && state.grabbedItem.pos.y <= landingY + 0.01,
	    };
}

function computeDropExitTarget(state: CobotState, x: number, z: number, minSurfaceY = 0): Vector3 {
    const supportTop = supportTopAt(x, z, dropObstacles(state));
    const stackClear = stackAwareClearanceAt(state, x, z, false);
    const hoverY = quantizeHeight(Math.max(
        minSurfaceY + DROP_RECENTER_CLEARANCE + 0.18,
        supportTop + DROP_RECENTER_CLEARANCE + 0.12,
        stackClear + 0.08,
        state.position[1] + 0.92
    ), 0.03);
    return new Vector3(x, hoverY, z);
}

function captureDropExitTarget(state: CobotState, minSurfaceY = 0) {
    state.gripperTip.computeWorldMatrix(true);
    const tip = state.gripperTip.getAbsolutePosition();
    state.dropExitTarget = computeDropExitTarget(state, tip.x, tip.z, minSurfaceY);
}

function segmentHitsMachine(a: Vector3, b: Vector3, obstacle: PlacedItem, radius = 0.08): boolean {
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

function armHitsObstacle(state: CobotState, obstacles: PlacedItem[]): PlacedItem | null {
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

function armHitsPart(state: CobotState): { item: SimItem; severe: boolean } | null {
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

function isSoftAvoidCollision(state: CobotState, hit: PlacedItem): boolean {
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

function requestPredictiveReplan(state: CobotState, hit: PlacedItem | null) {
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

function startRecoveryRetreat(state: CobotState, obstacle: PlacedItem | null) {
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

function normalizeAngle(rad: number): number {
    let a = rad;
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
}

function pointSegmentDistSq2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const abx = bx - ax;
    const abz = bz - az;
    const apx = px - ax;
    const apz = pz - az;
    const abLenSq = abx * abx + abz * abz;
    if (abLenSq <= 0.000001) {
        return apx * apx + apz * apz;
    }
    const t = clamp((apx * abx + apz * abz) / abLenSq, 0, 1);
    const cx = ax + abx * t;
    const cz = az + abz * t;
    const dx = px - cx;
    const dz = pz - cz;
    return dx * dx + dz * dz;
}

function pointSegmentT2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const abx = bx - ax;
    const abz = bz - az;
    const abLenSq = abx * abx + abz * abz;
    if (abLenSq <= 0.000001) return 0;
    return clamp(((px - ax) * abx + (pz - az) * abz) / abLenSq, 0, 1);
}

function itemFootprintSize(item: PlacedItem): [number, number] {
    if (item.type === 'table') return item.config?.tableSize || [1.8, 1.8];
    if (item.type === 'belt') return item.config?.beltSize || [2, 2];
    if (['sender', 'receiver', 'indexed_receiver', 'pile'].includes(item.type)) return item.config?.machineSize || [2, 2];
    if (item.type === 'cobot') return [COBOT_PLATFORM_W, COBOT_PLATFORM_D];
    return [2, 2];
}

function itemWorldFootprintSize(item: PlacedItem): [number, number] {
    const [w, d] = itemFootprintSize(item);
    return (item.rotation || 0) % 2 !== 0 ? [d, w] : [w, d];
}

function segmentFootprintHit2D(start: Vector3, goal: Vector3, item: PlacedItem, pad: number): boolean {
    const planarLen = Math.hypot(goal.x - start.x, goal.z - start.z);
    const samples = clamp(Math.ceil(planarLen / 0.14), 4, 24);
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const x = start.x + (goal.x - start.x) * t;
        const z = start.z + (goal.z - start.z) * t;
        if (itemFootprintHit(item, x, z, pad)) return true;
    }
    return false;
}

function isActiveSupportForPath(state: CobotState, obstacle: PlacedItem): boolean {
    const pickPhase = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
    const dropPhase = state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release' || state.phase === 'drop_recenter';
    const pickAnchor = pickPhase ? currentPickAnchor(state) : null;
    const dropTarget = dropPhase ? currentDropTarget(state) : null;
    if (pickAnchor && itemFootprintHit(obstacle, pickAnchor.x, pickAnchor.z, 0.1)) return true;
    if (dropTarget && itemFootprintHit(obstacle, dropTarget.x, dropTarget.z, 0.1)) return true;
    return false;
}

function findBlockingPathObstacle(
    state: CobotState,
    start: Vector3,
    goal: Vector3,
    clearY: number,
    isManipulation: boolean
): PlacedItem | null {
    const payloadPad = carriedPayloadRadius(state);
    const pad = isManipulation ? 0.18 + payloadPad : 0.28;
    const obstacles = state.grabbedItem ? dropObstacles(state) : state.obstacles;
    for (const obstacle of obstacles) {
        if (obstacle.type === 'camera') continue;
        if (state.selfItem && obstacle.id === state.selfItem.id) continue;
        if (isActiveSupportForPath(state, obstacle)) continue;
        const canPassOver = clearY > machineWallY(obstacle) + (isManipulation ? 0.26 : 0.38);
        if (canPassOver && obstacle.type !== 'cobot') continue;
        if (segmentFootprintHit2D(start, goal, obstacle, pad)) return obstacle;
    }
    return null;
}

function pathHitsObstacle2D(points: Vector3[], obstacle: PlacedItem, pad: number): boolean {
    for (let i = 1; i < points.length; i++) {
        if (segmentFootprintHit2D(points[i - 1], points[i], obstacle, pad)) return true;
    }
    return false;
}

function detourAroundObstacle(
    state: CobotState,
    start: Vector3,
    goal: Vector3,
    obstacle: PlacedItem,
    clearY: number,
    mountPos: Vector3,
    isManipulation: boolean
): Vector3[] {
    const viaY = quantizeHeight(Math.max(clearY, machineWallY(obstacle) + 0.34, start.y, goal.y), 0.04);
    const pathKeepout = Math.max(IK_BASE_CLEARANCE_RADIUS, COBOT_PEDESTAL_SAFEZONE_RADIUS);
    const [w, d] = itemWorldFootprintSize(obstacle);
    const payloadPad = carriedPayloadRadius(state);
    const margin = obstacle.type === 'cobot'
        ? (isManipulation ? 0.3 + payloadPad : 0.42)
        : (isManipulation ? 0.16 + payloadPad : 0.24);
    const cx = obstacle.position[0];
    const cz = obstacle.position[2];
    const xMin = cx - w * 0.5 - margin;
    const xMax = cx + w * 0.5 + margin;
    const zMin = cz - d * 0.5 - margin;
    const zMax = cz + d * 0.5 + margin;
    const corner = (x: number, z: number) => pushPointOutsideBaseKeepout(new Vector3(x, viaY, z), mountPos, pathKeepout);
    const nw = corner(xMin, zMin);
    const ne = corner(xMax, zMin);
    const sw = corner(xMin, zMax);
    const se = corner(xMax, zMax);
    const candidates: Array<{ points: Vector3[]; score: number }> = [
        [nw], [ne], [sw], [se],
        [nw, ne], [sw, se], [nw, sw], [ne, se],
        [ne, nw], [se, sw], [sw, nw], [se, ne],
    ].map(points => {
        const full = [start, ...points, goal];
        let distance = 0;
        for (let i = 1; i < full.length; i++) distance += Vector3.Distance(full[i - 1], full[i]);
        const collisionPenalty = pathHitsObstacle2D(full, obstacle, margin * 0.72) ? 10 : 0;
        const bendPenalty = points.length * 0.035;
        return { points, score: distance + collisionPenalty + bendPenalty };
    });
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0].points;
    if (best.length > 0) {
        const first = best[0];
        const cross = (goal.x - start.x) * (first.z - start.z) - (goal.z - start.z) * (first.x - start.x);
        state.avoidanceSide = cross >= 0 ? 1 : -1;
    }
    return best.map(p => p.clone());
}

function pushPointOutsideBaseKeepout(point: Vector3, mountPos: Vector3, keepout: number): Vector3 {
    const dx = point.x - mountPos.x;
    const dz = point.z - mountPos.z;
    const distSq = dx * dx + dz * dz;
    const keepoutSq = keepout * keepout;
    if (distSq >= keepoutSq) return point.clone();
    if (distSq < 0.000001) {
        return new Vector3(mountPos.x + keepout, point.y, mountPos.z);
    }
    const dist = Math.sqrt(Math.max(0.000001, distSq));
    const nx = dx / dist;
    const nz = dz / dist;
    return new Vector3(
        mountPos.x + nx * keepout,
        point.y,
        mountPos.z + nz * keepout
    );
}

function appendPathSegment(dst: Vector3[], segment: Vector3[]) {
    if (segment.length === 0) return;
    if (dst.length === 0) {
        segment.forEach(p => dst.push(p.clone()));
        return;
    }
    const startAt = Vector3.Distance(dst[dst.length - 1], segment[0]) < 0.02 ? 1 : 0;
    for (let i = startAt; i < segment.length; i++) {
        const p = segment[i];
        const prev = dst[dst.length - 1];
        if (!prev || Vector3.Distance(prev, p) > 0.02) {
            dst.push(p.clone());
        }
    }
}

function planToolpath(state: CobotState, start: Vector3, goal: Vector3, mountPos: Vector3, precisePhase: boolean): Vector3[] {
    if (state.phase === 'drop_recenter') {
        const clearY = quantizeHeight(Math.max(
            start.y,
            goal.y,
            segmentClearanceY(state, start, goal, false),
            state.position[1] + 0.92
        ), 0.03);
        const staged: Vector3[] = [start.clone()];
        if (start.y < clearY - 0.08) {
            staged.push(new Vector3(start.x, clearY, start.z));
        }
        staged.push(new Vector3(goal.x, clearY, goal.z));
        if (Math.abs(goal.y - clearY) > 0.05) {
            staged.push(goal.clone());
        }
        return staged.filter((p, index, arr) => index === 0 || Vector3.Distance(p, arr[index - 1]) > 0.035);
    }

    const path: Vector3[] = [start.clone()];
    const isManipulation = precisePhase || !!state.grabbedItem;
    const pathKeepout = Math.max(IK_BASE_CLEARANCE_RADIUS, COBOT_PEDESTAL_SAFEZONE_RADIUS);
    const sampledClearance = segmentClearanceY(state, start, goal, isManipulation);
    const clearY = quantizeHeight(Math.max(
        start.y,
        goal.y,
        sampledClearance,
        state.position[1] + 0.22
    ), 0.04);

    // Only add a vertical lift waypoint if we are significantly below the clearance height.
    // This prevents "hesitation" where the robot tries to re-lift every time a path is planned.
    if (start.y < clearY - 0.12) {
        path.push(new Vector3(start.x, clearY, start.z));
    }
    const navStartRaw = path[path.length - 1];
    const navGoalRaw = new Vector3(goal.x, Math.max(goal.y, isManipulation ? goal.y : clearY * 0.82), goal.z);
    const navStart = pushPointOutsideBaseKeepout(navStartRaw, mountPos, pathKeepout);
    const navGoal = pushPointOutsideBaseKeepout(navGoalRaw, mountPos, pathKeepout);
    if (Vector3.Distance(navStart, navStartRaw) > 0.01) path.push(navStart.clone());
    const dSegBaseSq = pointSegmentDistSq2D(mountPos.x, mountPos.z, navStart.x, navStart.z, navGoal.x, navGoal.z);
    // Manipulation phases (pick/drop) should skip the base keepout check to allow reaching the backdeck or low belt items directly.
    const crossesBase = !isManipulation && dSegBaseSq < pathKeepout * pathKeepout;

    if (crossesBase) {
        const a0 = Math.atan2(navStart.z - mountPos.z, navStart.x - mountPos.x);
        const a1 = Math.atan2(navGoal.z - mountPos.z, navGoal.x - mountPos.x);
        const cross = (navStart.x - mountPos.x) * (navGoal.z - mountPos.z) - (navStart.z - mountPos.z) * (navGoal.x - mountPos.x);
        const side = state.avoidanceSide !== 0 ? state.avoidanceSide : (cross >= 0 ? 1 : -1);
        state.avoidanceSide = side > 0 ? 1 : -1;

        let delta = normalizeAngle(a1 - a0);
        if (side > 0 && delta < 0) delta += Math.PI * 2;
        if (side < 0 && delta > 0) delta -= Math.PI * 2;
        if (Math.abs(delta) < 0.42) {
            delta = 0.42 * side;
        }

        const bypassR = pathKeepout + (isManipulation ? 0.06 : 0.16);
        const midA = a0 + delta * 0.5;
        const exitA = a1 - side * 0.2;
        path.push(new Vector3(
            mountPos.x + Math.cos(midA) * bypassR,
            clearY + (isManipulation ? 0.06 : 0.14),
            mountPos.z + Math.sin(midA) * bypassR
        ));
        path.push(new Vector3(
            mountPos.x + Math.cos(exitA) * bypassR,
            clearY + (isManipulation ? 0.02 : 0.08),
            mountPos.z + Math.sin(exitA) * bypassR
        ));
    }

    const obstacleSegmentStart = path[path.length - 1] ?? navStart;
    const blockingObstacle = findBlockingPathObstacle(state, obstacleSegmentStart, navGoal, clearY, isManipulation);
    if (blockingObstacle) {
        const detour = detourAroundObstacle(state, obstacleSegmentStart, navGoal, blockingObstacle, clearY, mountPos, isManipulation);
        detour.forEach(p => path.push(p));
    } else if (!crossesBase && Math.sqrt((navGoal.x - navStart.x) ** 2 + (navGoal.z - navStart.z) ** 2) > 1.1) {
        const mid = Vector3.Lerp(navStart, navGoal, 0.5);
        mid.y = clearY + (isManipulation ? 0.02 : 0.08);
        path.push(mid);
    }

    if (Vector3.Distance(navGoal, navGoalRaw) > 0.01) {
        path.push(navGoal.clone());
    }
    if (goal.y + 0.16 < clearY && isManipulation) {
        path.push(new Vector3(goal.x, clearY, goal.z));
    }
    path.push(goal.clone());

    const compact: Vector3[] = [];
    for (const p of path) {
        const prev = compact[compact.length - 1];
        if (!prev || Vector3.Distance(prev, p) > 0.035) {
            compact.push(p);
        }
    }
    return compact;
}

function nextPlannedTarget(state: CobotState, mountPos: Vector3, goal: Vector3, precisePhase: boolean): Vector3 {
    const directContactPhase =
        state.phase === 'pick_descend' ||
        state.phase === 'pick_attach' ||
        state.phase === 'pick_recenter' ||
        state.phase === 'descend_drop' ||
        state.phase === 'release';
    if (directContactPhase) return goal.clone();

    const isExitPhase = state.phase === 'drop_recenter' || state.phase === 'lift' || state.phase === 'pick_recenter';
    const movingPickPhase = state.phase === 'pick_hover';
    const goalDriftThreshold = movingPickPhase ? 0.08 : (precisePhase ? 0.08 : 0.2);
    const goalChanged = Vector3.Distance(state.plannedPathGoal, goal) > goalDriftThreshold;
    const phaseChanged = state.plannedPathPhase !== state.phase;
    const noPath = state.plannedPath.length < 2;
    const cursorDone = state.plannedPathCursor >= state.plannedPath.length;
    const allowGoalDrivenReplan = movingPickPhase || !isFineAlignPhase(state.phase);
    
    // For exit/recenter phases, we want immediate response to goal changes (blended transit)
    const forceImmediateReplan = isExitPhase && goalChanged;
    
    const shouldReplan = noPath || phaseChanged || cursorDone || forceImmediateReplan || (allowGoalDrivenReplan && goalChanged && state.pathReplanCooldown <= 0);
    
    if (shouldReplan) {
        state.plannedPath = planToolpath(state, state.ikTarget, goal, mountPos, precisePhase);
        state.plannedPathCursor = Math.min(1, state.plannedPath.length - 1);
        state.plannedPathGoal.copyFrom(goal);
        state.plannedPathPhase = state.phase;
        // Don't set a heavy cooldown if we just did a forced replan for an exit phase
        state.pathReplanCooldown = forceImmediateReplan ? 0.05 : (movingPickPhase ? 0.05 : (precisePhase ? 0.24 : 0.34));
    }

    const reachWp = precisePhase ? 0.08 : 0.16;
    while (
        state.plannedPathCursor < state.plannedPath.length - 1 &&
        Vector3.Distance(state.ikTarget, state.plannedPath[state.plannedPathCursor]) < reachWp
    ) {
        state.plannedPathCursor += 1;
    }
    
    const wp = state.plannedPath[state.plannedPathCursor] ?? goal;
    return wp;
}

function isFineAlignPhase(phase: string): boolean {
    return phase === 'pick_hover'
        || phase === 'pick_descend'
        || phase === 'pick_attach'
        || phase === 'hover_drop'
        || phase === 'descend_drop';
}

function transformWorldToLocal(state: CobotState, worldPos: Vector3, mountPos: Vector3): Vector3 {
    // We want the target relative to the robot's fixed base orientation (baseRotY),
    // NOT relative to the moving base pivot joint (basePivot.rotation.y).
    // This allows calculating the absolute base joint angle needed to reach the target.
    const rel = worldPos.subtract(mountPos);
    const angle = state.baseRotY; // Robot's fixed world-space orientation
    const lx = rel.x * Math.cos(angle) + rel.z * Math.sin(angle);
    const lz = -rel.x * Math.sin(angle) + rel.z * Math.cos(angle);
    return new Vector3(lx, rel.y, lz);
}

function resolveFlowGoal(state: CobotState, rawGoal: Vector3): Vector3 {
    // For moving-pick phases, never lock to stale goals: track live target every frame.
    if (state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach') {
        state.lockedFlowPhase = state.phase;
        state.lockedFlowGoal.copyFrom(rawGoal);
        return rawGoal.clone();
    }
    const phaseChanged = state.lockedFlowPhase !== state.phase;
    // Refresh the lock whenever the raw goal drifts significantly from the
    // cached position.  This prevents stalls when the desiredTarget changes
    // mid-phase (e.g. dynamic drop-target recomputation, or idle waiting for
    // a new pickup candidate that shifts the hover position).
    const goalDrift = Vector3.Distance(state.lockedFlowGoal, rawGoal);
    const driftThreshold = isFineAlignPhase(state.phase) ? 0.08 : 0.18;
    if (phaseChanged || goalDrift > driftThreshold) {
        state.lockedFlowPhase = state.phase;
        state.lockedFlowGoal.copyFrom(rawGoal);
    }
    return state.lockedFlowGoal.clone();
}

function currentPickTimeout(state: CobotState): number {
    const item = state.targetedItem;
    const onDrive = !!(item && driveTileAt(item.pos.x, item.pos.z, state.obstacles));
    if (state.phase === 'pick_hover') return PICK_TARGET_TIMEOUT + (onDrive ? 1.25 : 0.55);
    if (state.phase === 'pick_descend') return PICK_TARGET_TIMEOUT + (onDrive ? 1.0 : 0.45);
    if (state.phase === 'pick_attach') return PICK_TARGET_TIMEOUT + (onDrive ? 0.85 : 0.35);
    return PICK_TARGET_TIMEOUT;
}

function buildPrecalculatedToolpathPreview(state: CobotState, mountPos: Vector3, flowGoal: Vector3, precisePhase: boolean): Vector3[] {
    const preview: Vector3[] = [state.ikTarget.clone()];
    let cursor = state.ikTarget.clone();
    let totalPreviewDistance = 0;
    const maxPreviewDistance = 50.0;
    
    const pushSegment = (segment: Vector3[]) => {
        if (segment.length < 2) return;
        let segDist = 0;
        for (let i = 1; i < segment.length; i++) segDist += Vector3.Distance(segment[i - 1], segment[i]);
        if (totalPreviewDistance + segDist > maxPreviewDistance) return;
        appendPathSegment(preview, segment);
        totalPreviewDistance += segDist;
        cursor = segment[segment.length - 1].clone();
    };

    // First segment: from current position to the immediate goal
    pushSegment(planToolpath(state, cursor, flowGoal, mountPos, precisePhase));

    // Future segments: loop through the program starting from the NEXT step
    if (state.program.length > 0) {
        for (let i = 0; i < state.program.length; i++) {
            const stepIdx = (state.stepIndex + 1 + i) % state.program.length;
            const step = state.program[stepIdx];
            if (!step.pos) continue;
            if (step.action !== 'move' && step.action !== 'pick' && step.action !== 'drop') continue;

            const pos = new Vector3(step.pos[0], step.pos[1], step.pos[2]);
            const manipulation = step.action === 'pick' || step.action === 'drop';
            const hoverOffset = step.action === 'pick'
                ? PICK_HOVER_CLEARANCE
                : step.action === 'drop'
                    ? DROP_HOVER_CLEARANCE
                    : 0.22;
            const safeHoverY = Math.max(
                pos.y + hoverOffset,
                wallTopAt(pos.x, pos.z, dropObstacles(state)) + (manipulation ? 0.12 : 0.2),
                state.position[1] + (manipulation ? 1.22 : 1.35)
            );
            const hoverTarget = new Vector3(pos.x, safeHoverY, pos.z);
            pushSegment(planToolpath(state, cursor, hoverTarget, mountPos, false));

            if (manipulation) {
                const touchY = step.action === 'pick'
                    ? pos.y + PICK_DESCEND_CLEARANCE
                    : pos.y + DROP_CLEARANCE;
                const contactTarget = new Vector3(pos.x, touchY, pos.z);
                pushSegment(planToolpath(state, cursor, contactTarget, mountPos, true));
                pushSegment(planToolpath(state, cursor, hoverTarget, mountPos, true));
            }
            if (totalPreviewDistance >= maxPreviewDistance) break;
        }
    }
    return preview;
}

function applyTuningElementHighlight(state: CobotState) {
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

function selfSortPreferences(state: CobotState) {
    return {
        sortColor: state.selfItem?.config?.defaultDropSortColor !== false,
        sortSize: state.selfItem?.config?.defaultDropSortSize !== false,
        sortShape: state.selfItem?.config?.defaultDropSortShape !== false,
    };
}

function nearestSelfSlotIndex(state: CobotState, x: number, z: number, maxDist = 0.34): number {
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

function findItemToOrganize(state: CobotState) {
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

export function tickCobot(state: CobotState, delta: number, isRunning: boolean): boolean {
    let L1 = cobotUpperArmLength(state.selfItem?.config);
    let L2 = cobotForearmLength(state.selfItem?.config);
    let L3 = cobotWristLength(state.selfItem?.config) + COBOT_HAND_LINK_LENGTH + COBOT_GRIPPER_TIP_OFFSET; // Keep IK reach matched to the visible wrist/tool mesh.
    if (!Number.isFinite(L1) || L1 <= 0) L1 = COBOT_UPPER_ARM_LENGTH;
    if (!Number.isFinite(L2) || L2 <= 0) L2 = COBOT_FOREARM_LENGTH;
    if (!Number.isFinite(L3) || L3 <= 0) L3 = COBOT_WRIST_LINK_LENGTH + COBOT_HAND_LINK_LENGTH + COBOT_GRIPPER_TIP_OFFSET;
    const shoulderLimits = cobotShoulderLimits(state.selfItem?.config);
    const elbowLimits = cobotElbowLimits(state.selfItem?.config);
    const wristLimits = cobotWristLimits(state.selfItem?.config);
    const canLatchByProximity = (
        item: SimItem | null,
        maxPlanarDist: number,
        maxVerticalDist: number
    ): {
        ok: boolean;
        snapDist: number;
        planarDist: number;
        verticalDist: number;
        gripPose: Vector3 | null;
    } => {
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
    };
    const flushPhaseLog = () => {
        if (state.phase !== state.lastLoggedPhase) {
            logCobotEvent(state, 'phase_change', `${state.lastLoggedPhase} -> ${state.phase}`);
            state.lastLoggedPhase = state.phase;
        }
    };
    const logStatusReason = (key: string, detail: string) => {
        if (state.lastStatusReasonKey === key && (state.simTime - state.lastStatusReasonAt) < 1.25) return;
        logCobotEvent(state, 'status_reason', detail);
        state.lastStatusReasonKey = key;
        state.lastStatusReasonAt = state.simTime;
    };
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
        logStatusReason('tuning_mode', 'tuning_mode=1');
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
        flushPhaseLog();
        return false;
    } else if (!isRunning) {
        // Simulation is stopped and no manual override is active — freeze in place.
        state.ikVelocity.setAll(0);
        state.desiredTarget.copyFrom(state.ikTarget);
        state.plannedPath = [state.ikTarget.clone(), state.ikTarget.clone()];
        state.plannedPathCursor = 1;
        state.phase = 'idle';
        return false;
    } else if ((collisionsOn && state.safetyStopped) || isStopped) {
        // Handle stall recovery and safety stops when the simulation is running.
        if (state.safetyStopped && !isStopped) {
            state.recoveryTimer += delta;
            state.phase = 'recovery';

            // Attempt to move back to the last known safe position.
            state.desiredTarget.copyFrom(state.lastSafeIkTarget);
            state.plannedPath = [state.ikTarget.clone(), state.lastSafeIkTarget.clone()];
            state.plannedPathCursor = 1;

            if (state.recoveryTimer > 2.5) {
                // After 2.5s, force clear the safety stop if the blockage is gone.
                if (!armHitsObstacle(state, state.obstacles) && !armHitsPart(state)) {
                    state.safetyStopped = false;
                    state.recoveryTimer = 0;
                    state.blockedTimer = 0;
                    return false;
                }
            }
        } else {
            state.ikVelocity.setAll(0);
            state.desiredTarget.copyFrom(state.ikTarget);
        }
        return !!state.safetyStopped;
    } else if (!state.autoOrganize && state.isAutoProgram) {
        logStatusReason('auto_organize_disabled', 'autoOrganize=0 while autoProgram=1');
        if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
        if (state.grabbedItem) state.grabbedItem.state = 'free';
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
        flushPhaseLog();
        return false;
    } else if (state.program.length > 0) {
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
        const reachGoal = projectTargetToReachEnvelope(state.desiredTarget, mountPos, state.position[1] + 0.1, reachMax);

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
        const tipNow = state.gripperTip.getAbsolutePosition();
        const moveTipDist = isMoveAction ? Vector3.Distance(tipNow, movePrecisionGoal) : Number.POSITIVE_INFINITY;
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

        if (isStalled && !isCloseEnoughStall) {
            state.targetTimer += delta;
        } else {
            state.targetTimer = Math.max(0, state.targetTimer - delta * 1.5);
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
        const hasPickFilter = state.pickColors.length > 0 || state.pickSizes.length > 0;

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
                state.gripperOpen = true;
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
                        state.stepIndex = nextDropIndex;
                        state.phase = 'transit_drop';
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
		                    let target = clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius);
                    if (!targetOnDriveNow) target = Vector3.Lerp(target, pickAnchor, 0.08);
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
                            const hoverTime = state.targetTimer;
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
                        target = clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius);
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
		                    ? canLatchByProximity(
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
		                    const latch = canLatchByProximity(
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
	                } else if (state.waitTimer > 2.1 || state.targetTimer > pickTimeout || abortForReach || (targetLost && !stallRecoveryInProgress && state.targetTimer > 0.9)) {
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
	                        : clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius);
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
	                    const latch = canLatchByProximity(
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
                } else if (state.waitTimer > 1.1 || state.targetTimer > pickTimeout || (state.waitTimer > 0.34 && attachContact.horizontalDist > Math.max(PICK_GRAB_RADIUS + 0.2, attachContact.targetRadius * 1.36)) || abortForReach) {
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
                const grabbedTop = state.grabbedItem
                    ? state.grabbedItem.pos.y + partHalfHeight(state.grabbedItem)
                    : state.ikTarget.y;
                const peelY = Math.min(
                    hoverY,
                    Math.max(
                        state.ikTarget.y + 0.16,
                        grabbedTop + 0.22,
                        supportTop + PICK_SUPPORT_CLEARANCE + 0.12
                    )
                );
                state.desiredTarget.set(state.ikTarget.x, peelY, state.ikTarget.z);
                if (finalReached || state.waitTimer > 0.32 || state.ikTarget.y >= peelY - 0.035) {
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
                // BLENDED MOTION: Once we clear the immediate pick zone (0.85m above base), 
                // start moving towards the destination XZ to eliminate "hesitation" at the top.
                if (state.ikTarget.y > state.position[1] + 0.52 && nextDropTarget) {
                    state.desiredTarget.set(nextDropTarget.x, travelY, nextDropTarget.z);
                    state.targetSource = 'program';
                } else {
                    state.desiredTarget.set(state.ikTarget.x, travelY, state.ikTarget.z);
                    state.targetSource = 'program';
                }
                if (finalReached || state.targetTimer > 4.5) {
                    if (!hasDrop) {
                        if (!state.autoDropTarget && state.grabbedItem) {
                            state.autoDropTarget = getAutoSlot(partHint(state.grabbedItem));
                        }
                        if (state.autoDropTarget) {
                            state.phase = 'transit_drop';
                        }
                        else {
                            if (state.grabbedItem) { state.grabbedItem.state = 'free'; state.grabbedItem = null; }
                            state.phase = 'idle';
                        }
                    } else if (nextDropIndex !== null) {
                        state.stepIndex = nextDropIndex;
                        state.phase = 'transit_drop';
                    } else state.phase = 'next';
                }
                break;
            }
            case 'transit_drop': {
                const tgt = state.lockedDropTarget || currentDropTarget(state);
                if (!tgt) {
                    state.activeDropTarget = null;
                    state.phase = state.grabbedItem ? 'idle' : 'next';
                    break;
                }
                // Lock the target immediately to prevent slot-switching during transit/hover
                if (!state.lockedDropTarget) state.lockedDropTarget = tgt.clone();

                const travelY = carryTravelY(state, tgt);
                state.desiredTarget.set(tgt.x, travelY, tgt.z);
                if (finalReached || state.targetTimer > 4.5) {
                    state.phase = 'hover_drop';
                    state.waitTimer = 0;
                }
                break;
            }
            case 'hover_drop': {
                const tgt = currentDropTarget(state);
                if (!tgt) {
                    state.activeDropTarget = null;
                    state.phase = state.grabbedItem ? 'idle' : 'next';
                    break;
                }
                const selfDrop = !!(state.selfItem && itemFootprintHit(state.selfItem, tgt.x, tgt.z, 0.08));
                const partHalf = state.grabbedItem ? partHalfHeight(state.grabbedItem) : DISC_H / 2;
                const landingCenterY = stackCenterYAt(tgt.x, tgt.z, dropBaseCenterY(state, tgt, state.grabbedItem), state.grabbedItem, state.grabbedItem, STACK_R);
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
                if (finalReached || state.targetTimer > 3.5) {
                    state.lockedDropTarget = tgt.clone();
                    state.phase = 'descend_drop';
                    state.waitTimer = 0;
                }
                break;
            }
            case 'descend_drop': {
                state.waitTimer += delta;
                const tgt = state.lockedDropTarget || currentDropTarget(state);
                const placement = dropPlacementState(state);
                if (!tgt || !placement) {
                    state.activeDropTarget = null;
                    state.phase = state.grabbedItem ? 'idle' : 'next';
                    break;
                }
                
	                const partHalf = state.grabbedItem ? partHalfHeight(state.grabbedItem) : DISC_H / 2;
	                // Place the carried part center on the landing height by commanding the gripper tip above it.
	                const safeDropY = quantizeHeight(
	                    Math.max(
	                        placement.landingY + partHalf + 0.006,
	                        wallTopAt(tgt.x, tgt.z, dropObstacles(state)) + partHalf + 0.006
	                    ),
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
                    state.phase = state.grabbedItem ? 'idle' : 'next';
                    break;
                }
                const part = state.grabbedItem;
                const partHalf = part ? partHalfHeight(part) : DISC_H / 2;
                const releaseApproachY = Math.max(
                    placement.landingY + partHalf + 0.008,
                    wallTopAt(placement.target.x, placement.target.z, dropObstacles(state)) + partHalf + 0.008
                );
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
	                        if (state.isAutoProgram) state.lastDroppedItemId = state.grabbedItem.id;
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
	                                if (state.isAutoProgram) state.lastDroppedItemId = part.id;
	                                part.pos.set(placement.target.x, placement.landingY, placement.target.z);
	                                part.state = 'free';
                                captureDropExitTarget(state, Math.max(placement.landingY, part.pos.y + partHalfHeight(part)));
                                logCobotEvent(state, 'drop_success', `forced_release=1 target=(${placement.target.x.toFixed(2)},${placement.target.z.toFixed(2)})`);
                                state.dropReplanStreak = 0;
                                state.lastReplanTargetKey = '';
                                state.avoidDropTarget = null;
                                state.avoidDropUntil = 0;
	                                state.grabbedItem = null;
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
        if (isRunning) logStatusReason('no_program', 'program_len=0');
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

    const precisePhase = state.phase === 'pick_descend' || state.phase === 'descend_drop';
    const maxReach = L1 + L2 - 0.02;
    const desiredEnvelopeTarget = projectTargetToReachEnvelope(state.desiredTarget, mountPos, state.position[1] + 0.1, maxReach);
    const desiredDx = desiredEnvelopeTarget.x - mountPos.x;
    const desiredDz = desiredEnvelopeTarget.z - mountPos.z;
    const desiredPlanar = Math.sqrt(desiredDx * desiredDx + desiredDz * desiredDz);
    if (desiredPlanar > maxReach && desiredPlanar > 0.0001) {
        state.isOutOfRange = true;
    }
    state.desiredTarget.copyFrom(clampTargetAboveSupports(state, desiredEnvelopeTarget.clone(), state.phase, !!state.grabbedItem));
    const rawGoal = state.desiredTarget.clone();
    const activeDropTargetForFlow = ['hover_drop', 'descend_drop', 'release', 'drop_recenter'].includes(state.phase)
        ? currentDropTarget(state)
        : null;
    const dropOnSelfSupportFlow = !!(
        activeDropTargetForFlow &&
        state.selfItem &&
        itemFootprintHit(state.selfItem, activeDropTargetForFlow.x, activeDropTargetForFlow.z, 0.08)
    );
    const dropOnSelfSupportPhase = dropOnSelfSupportFlow &&
        (state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release' || state.phase === 'drop_recenter');
    const flowGoal = resolveFlowGoal(state, rawGoal);
    const pathTarget = nextPlannedTarget(state, mountPos, flowGoal, precisePhase);
    if (!state.lastPreviewUpdate || state.simTime - state.lastPreviewUpdate > 0.5) {
        state.precalculatedPath = buildPrecalculatedToolpathPreview(state, mountPos, flowGoal, precisePhase);
        state.lastPreviewUpdate = state.simTime;
    }
    let commandedTarget = pathTarget.clone();
    clampTargetAboveSupports(state, commandedTarget, state.phase, !!state.grabbedItem);
    state.desiredTarget.copyFrom(commandedTarget);
    const toTarget = state.desiredTarget.subtract(state.ikTarget);
    const distanceToTarget = toTarget.length();
    const planarTargetDelta = Math.hypot(toTarget.x, toTarget.z);
    const verticalTargetDelta = Math.abs(toTarget.y);
    const pureVerticalContactMotion =
        (state.phase === 'pick_descend' || state.phase === 'pick_attach' || state.phase === 'descend_drop' || state.phase === 'release' || state.phase === 'lift') &&
        verticalTargetDelta > 0.015 &&
        planarTargetDelta < 0.52 &&
        verticalTargetDelta > planarTargetDelta * 0.6;
    const pickCommitPhase = state.phase === 'pick_descend' || state.phase === 'pick_attach';
    const pickCommitContact = pickCommitPhase ? pickupContactState(state, state.targetedItem) : null;
    const committedPickTouch = !!pickCommitContact && (pickCommitContact.touchingPart || pickCommitContact.touchingSurface);
    const pickupContactOverride = isPickupContactOverride(state);
    const relaxedContactMotion = pickupContactOverride || committedPickTouch || pureVerticalContactMotion;

    state.wristRoll.computeWorldMatrix(true);
    const wristPos = state.wristRoll.getAbsolutePosition();
    if (state.selfItem) {
        simState.cobotWrists[state.selfItem.id] = wristPos.clone();
        simState.cobotArmSamples[state.selfItem.id] = collectArmSamples(state);
        simState.cobotLoads[state.selfItem.id] = !!state.grabbedItem;
    }

    const grabbedRadius = state.grabbedItem ? carriedPayloadRadius(state) : 0.08;
    const mountPlanarDx = wristPos.x - mountPos.x;
    const mountPlanarDz = wristPos.z - mountPos.z;
    const mountPlanarDist = Math.sqrt(mountPlanarDx * mountPlanarDx + mountPlanarDz * mountPlanarDz);
    const nearOwnPedestal = mountPlanarDist < (state.mountCollisionRadius + 0.42) && wristPos.y < (state.position[1] + COBOT_PEDESTAL_HEIGHT + 0.34);
    const handSafetyPad = grabbedRadius + (nearOwnPedestal || !!state.grabbedItem ? HAND_SAFETY_EXTRA_RADIUS : 0.015);

    const visualRadius = 0.2 + grabbedRadius + (nearOwnPedestal ? HAND_SAFETY_EXTRA_RADIUS : 0.015);
    state.collisionSphere.scaling.setAll(visualRadius * 2);

    const sensorHeading = state.baseRotY + state.basePivot.rotation.y;
    const sensorForward = new Vector3(Math.sin(sensorHeading), 0, Math.cos(sensorHeading));
    const sensorRight = new Vector3(sensorForward.z, 0, -sensorForward.x);
    let hazardForward = 0;
    let hazardRight = 0;
    let hazardBackward = 0;
    let hazardLeft = 0;
    const sensorRange = 0.46;
    const addDirectionalHazard = (point: Vector3, dist: number) => {
        if (dist >= sensorRange) return;
        const planar = point.subtract(wristPos);
        planar.y = 0;
        const planarDist = planar.length();
        if (planarDist < 0.0001) return;
        const dir = planar.scale(1 / planarDist);
        const strength = clamp((sensorRange - Math.max(0, dist)) / sensorRange, 0, 1);
        const fDot = Vector3.Dot(dir, sensorForward);
        const rDot = Vector3.Dot(dir, sensorRight);
        if (fDot >= 0) hazardForward = Math.max(hazardForward, strength * fDot);
        else hazardBackward = Math.max(hazardBackward, strength * -fDot);
        if (rDot >= 0) hazardRight = Math.max(hazardRight, strength * rDot);
        else hazardLeft = Math.max(hazardLeft, strength * -rDot);
    };

    let closestPoint: Vector3 | null = null;
    let minDist = Infinity;

    for (const item of factoryStore.getState().placedItems) {
        if (item.id === state.selfItem?.id || item.type === 'camera') continue;
        let pad = handSafetyPad, w = 2, d = 2, h = item.config?.machineHeight || 0.538;
        if (item.type === 'table') { [w, d] = item.config?.tableSize || [1.8, 1.8]; h = item.config?.tableHeight || 0.45; }
        else if (item.type === 'belt') { [w, d] = item.config?.beltSize || [2, 2]; h = item.config?.beltHeight || 0.538; }
        else if (['sender', 'receiver', 'indexed_receiver', 'pile'].includes(item.type)) { [w, d] = item.config?.machineSize || [2, 2]; }
        else if (item.type === 'cobot') { w = COBOT_BODY_W; d = COBOT_BODY_D; pad = 0.05 + handSafetyPad; h = COBOT_PLATFORM_TOP_Y; }

        const cx = clamp(wristPos.x, item.position[0] - w / 2 - pad, item.position[0] + w / 2 + pad);
        const cz = clamp(wristPos.z, item.position[2] - d / 2 - pad, item.position[2] + d / 2 + pad);
        const cy = clamp(wristPos.y, 0, h + 0.05);
        const closest = new Vector3(cx, cy, cz);
        const dist = Vector3.Distance(wristPos, closest);
        addDirectionalHazard(closest, dist);
        if (dist < minDist) {
            minDist = dist;
            closestPoint = closest;
        }
    }

    const currentItems = factoryStore.getState().placedItems;
    const lookAheadTime = precisePhase ? 0.08 : 0.22;
    const predictedWrist = wristPos.add(state.ikVelocity.scale(lookAheadTime));
    let nearestCobotClearance = Infinity;
    let nearestCobotPoint: Vector3 | null = null;
    let nearestCobotId: string | null = null;
    for (const staleId of Object.keys(simState.cobotArmSamples)) {
        if (!currentItems.some(i => i.id === staleId)) {
            delete simState.cobotArmSamples[staleId];
            delete simState.cobotWrists[staleId];
            delete simState.cobotLoads[staleId];
        }
    }
    for (const [id, armPoints] of Object.entries(simState.cobotArmSamples)) {
        if (id === state.selfItem?.id || !armPoints?.length) continue;
        for (const p of armPoints) {
            const crossArmPad = nearOwnPedestal ? handSafetyPad : grabbedRadius;
            const distNow = Vector3.Distance(wristPos, p) - (0.2 + crossArmPad);
            const distSoon = Vector3.Distance(predictedWrist, p) - (0.24 + crossArmPad);
            const dist = Math.min(distNow, distSoon);
            if (dist < nearestCobotClearance) {
                nearestCobotClearance = dist;
                nearestCobotPoint = p.clone();
                nearestCobotId = id;
            }
            if (dist < minDist) {
                minDist = Math.max(0, dist);
                const dir = p.subtract(wristPos);
                if (dir.lengthSquared() > 0.000001) {
                    dir.normalize();
                    closestPoint = wristPos.add(dir.scale(minDist));
                } else {
                    closestPoint = p.clone();
                }
            }
            addDirectionalHazard(p, dist);
        }
    }

    const ownLinkRisk = selfCollisionRisk(state);
    if (ownLinkRisk.point && ownLinkRisk.clearance < COBOT_SELF_REDUCED_SPEED_DIST) {
        const selfDist = Math.max(0, ownLinkRisk.clearance);
        addDirectionalHazard(ownLinkRisk.point, selfDist);
        if (selfDist < minDist) {
            minDist = selfDist;
            closestPoint = ownLinkRisk.point.clone();
        }
    }

    for (const item of simState.items) {
        if (item === state.grabbedItem) continue;
        const pickPhaseActive = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
        if (item === state.targetedItem && pickPhaseActive) continue;
        if (state.phase === 'pick_descend' && state.targetedItem) {
            const distToTargetPart = Vector3.Distance(item.pos, state.targetedItem.pos);
            if (distToTargetPart < 0.4) continue;
        }
        if (item === state.targetedItem && distanceToTarget < 0.6) continue;
        if (item.state === 'dead' || item.state === 'grabbed') continue;
        if (dropOnSelfSupportPhase && activeDropTargetForFlow) {
            const ddx = item.pos.x - activeDropTargetForFlow.x;
            const ddz = item.pos.z - activeDropTargetForFlow.z;
            const itemR = partRadiusForSpec(item);
            const nearSelfDrop = Math.sqrt(ddx * ddx + ddz * ddz) < Math.max(0.3, itemR * 1.4);
            const belowApproachBand = item.pos.y <= activeDropTargetForFlow.y + partHalfHeight(item) + 0.28;
            if (nearSelfDrop && belowApproachBand) continue;
        }
        if (pickPhaseActive && state.targetedItem) {
            const tdx = item.pos.x - state.targetedItem.pos.x;
            const tdz = item.pos.z - state.targetedItem.pos.z;
            const nearTarget = Math.sqrt(tdx * tdx + tdz * tdz) < Math.max(0.34, partRadiusForSpec(state.targetedItem) * 1.25);
            if (nearTarget && item.pos.y <= state.targetedItem.pos.y + partHalfHeight(state.targetedItem) + 0.12) continue;
            if (state.phase === 'pick_descend') {
                const descentBuffer = Math.sqrt(tdx * tdx + tdz * tdz) < Math.max(0.52, partRadiusForSpec(state.targetedItem) * 1.8);
                const inDescentBand = item.pos.y <= state.targetedItem.pos.y + partHalfHeight(state.targetedItem) + 0.2;
                if (descentBuffer && inDescentBand) continue;
            }
        }
        const otherRad = partRadiusForSpec(item);
        const otherHalf = partHalfHeight(item);

        const dy = clamp(wristPos.y, item.pos.y - otherHalf, item.pos.y + otherHalf);
        const dx = wristPos.x - item.pos.x;
        const dz = wristPos.z - item.pos.z;
        const len = Math.sqrt(dx * dx + dz * dz);

        let cx = item.pos.x, cz = item.pos.z;
        if (len > 0) {
            const looseItemPad = nearOwnPedestal ? handSafetyPad : grabbedRadius;
            const rad = Math.min(len, otherRad + looseItemPad);
            cx += (dx / len) * rad;
            cz += (dz / len) * rad;
        }

        const closest = new Vector3(cx, dy, cz);
        const dist = Vector3.Distance(wristPos, closest);
        addDirectionalHazard(closest, dist);
        if (dist < minDist) {
            minDist = dist;
            closestPoint = closest;
        }
    }

    const hzAlpha = clamp(delta * 8.5, 0, 1);
    state.sensorHazards[0] += (hazardForward - state.sensorHazards[0]) * hzAlpha;
    state.sensorHazards[1] += (hazardRight - state.sensorHazards[1]) * hzAlpha;
    state.sensorHazards[2] += (hazardBackward - state.sensorHazards[2]) * hzAlpha;
    state.sensorHazards[3] += (hazardLeft - state.sensorHazards[3]) * hzAlpha;
    const distSample = isFinite(minDist) ? minDist : 2;
    state.sensorMinDist += (distSample - state.sensorMinDist) * clamp(delta * 7.5, 0, 1);

    hazardForward = state.sensorHazards[0];
    hazardRight = state.sensorHazards[1];
    hazardBackward = state.sensorHazards[2];
    hazardLeft = state.sensorHazards[3];
    minDist = state.sensorMinDist;
    if (!collisionsOn) {
        hazardForward = 0;
        hazardRight = 0;
        hazardBackward = 0;
        hazardLeft = 0;
        minDist = 2;
        state.sensorHazards = [0, 0, 0, 0];
        state.sensorMinDist = 2;
        state.avoidanceSide = 0;
    }
    if (pickupContactOverride) {
        hazardForward = 0;
        hazardRight = 0;
        hazardBackward = 0;
        hazardLeft = 0;
        minDist = 2;
        state.sensorHazards = [0, 0, 0, 0];
        state.sensorMinDist = 2;
        state.avoidanceSide = 0;
        state.recoveryTimer = 0;
    }

    const colorForHazard = (hazard: number) => {
        if (hazard > 0.58) return Color3.FromHexString('#ef4444');
        if (hazard > 0.01) return Color3.FromHexString('#f59e0b');
        return Color3.FromHexString('#22c55e');
    };
    const sensorHazards = [hazardForward, hazardRight, hazardBackward, hazardLeft];
    for (let i = 0; i < state.proximityMats.length; i++) {
        const hz = sensorHazards[Math.min(i, sensorHazards.length - 1)] ?? 0;
        state.proximityMats[i].emissiveColor = colorForHazard(hz);
    }
    state.proximityMult = 1.0;

    const dropOnSelfSupport = isSelfPlatformDropPhase(state, activeDropTargetForFlow);
    const activeStep = state.program.length > 0 ? state.program[state.stepIndex % state.program.length] : null;
    const precisionMoveApproach = !!(
        activeStep?.action === 'move' &&
        activeStep.pos &&
        state.phase === 'idle' &&
        Vector3.Distance(state.ikTarget, new Vector3(activeStep.pos[0], activeStep.pos[1], activeStep.pos[2])) < 0.08
    );
    const maxHazard = Math.max(hazardForward, hazardRight, hazardBackward, hazardLeft);
    const nearRisk = minDist < COBOT_NEIGHBOR_YIELD_TRIGGER
        ? clamp((COBOT_NEIGHBOR_YIELD_TRIGGER - Math.max(0, minDist)) / COBOT_NEIGHBOR_YIELD_TRIGGER, 0, 1)
        : 0;
    const slowdownZone = minDist < SAFETY_REDUCED_SPEED_DIST;
    if (!relaxedContactMotion && !precisionMoveApproach && closestPoint && (maxHazard > 0.45 || nearRisk > 0.5)) {
        // No repulsion force here. Sensors only mark risk, slow down, and ask the path planner
        // for a fresh waypoint sequence if the current trajectory is becoming unsafe.
        state.targetSource = 'avoidance';
        state.pathReplanCooldown = 0;
    }
    if (state.recoveryTimer > 0) {
        state.recoveryTimer = Math.max(0, state.recoveryTimer - delta);
    }

    const isSlowPhase = precisePhase || state.phase === 'release' || state.phase === 'pick_descend' || state.phase === 'descend_drop';
    const cruiseSpeed = (state.recoveryTimer > 0 ? 0.8 : (isSlowPhase ? 1.4 : 5.8)) * state.speed;
    const settleRadius = precisePhase ? 0.2 : 0.5;
    const accel = (precisePhase ? 8.0 : 5.5) * state.speed;
    const damping = Math.min(1, (precisePhase ? 14.5 : 8.5) * delta);

    let desiredVelocity = Vector3.Zero();
    if (distanceToTarget > 0.0001) {
        const dir = toTarget.scale(1 / distanceToTarget);
        const ramp = distanceToTarget < settleRadius
            ? Math.max(0.12, distanceToTarget / settleRadius)
            : 1;
        desiredVelocity = dir.scale(cruiseSpeed * ramp);
    }
    const baseAlignedTravelPhase =
        state.phase === 'lift' ||
        state.phase === 'transit_drop' ||
        state.phase === 'hover_drop' ||
        state.phase === 'drop_recenter';
    let baseTravelYawTarget: number | null = null;
    if (!relaxedContactMotion && baseAlignedTravelPhase && Math.hypot(desiredVelocity.x, desiredVelocity.z) > 0.001) {
        const targetYaw = Math.atan2(state.desiredTarget.x - mountPos.x, state.desiredTarget.z - mountPos.z);
        baseTravelYawTarget = normalizeAngle(targetYaw - state.baseRotY);
        const yawError = Math.abs(normalizeAngle(baseTravelYawTarget - state.basePivot.rotation.y));
        const planarScale = clamp((0.75 - yawError) / 0.55, 0.08, 1);
        desiredVelocity.x *= planarScale;
        desiredVelocity.z *= planarScale;
        if (planarScale < 0.35 && state.desiredTarget.y > state.ikTarget.y + 0.02) {
            desiredVelocity.y = Math.max(desiredVelocity.y, cruiseSpeed * 0.45);
        }
        if (planarScale < 0.98) {
            state.reducedSpeedActive = true;
            state.safetySpeedFactor = Math.min(state.safetySpeedFactor, Math.max(0.12, planarScale));
        }
    }
    {
        if (relaxedContactMotion) {
            const velocityBlend = Math.min(1, accel * delta);
            state.ikVelocity = Vector3.Lerp(state.ikVelocity, desiredVelocity, velocityBlend);
            state.ikVelocity.scaleInPlace(1 - damping * 0.2);
            const step = state.ikVelocity.scale(delta);
            if (step.length() >= distanceToTarget) {
                state.ikTarget.copyFrom(state.desiredTarget);
                state.ikVelocity.setAll(0);
            } else {
                state.ikTarget.addInPlace(step);
            }
            clampTargetAboveSupports(state, state.ikTarget, state.phase, !!state.grabbedItem);
        } else if (!precisionMoveApproach) {
            const avoidanceGain = precisePhase ? 0.45 : 1.0;
            const planar = new Vector3(desiredVelocity.x, 0, desiredVelocity.z);
            const forwardComp = Vector3.Dot(planar, sensorForward);
            const rightComp = Vector3.Dot(planar, sensorRight);
            const forwardHazard = (forwardComp >= 0 ? hazardForward : hazardBackward) * avoidanceGain;
            const rightHazard = (rightComp >= 0 ? hazardRight : hazardLeft) * avoidanceGain;
            const forwardScale = 1 - forwardHazard;
            const rightScale = 1 - rightHazard;
            const safePlanar = sensorForward
                .scale(forwardComp * clamp(forwardScale, 0, 1))
                .add(sensorRight.scale(rightComp * clamp(rightScale, 0, 1)));
            desiredVelocity.x = safePlanar.x;
            desiredVelocity.z = safePlanar.z;
        }
    }
	    {
	        if (!relaxedContactMotion) {
	            if (precisionMoveApproach) {
                const velocityBlend = Math.min(1, accel * delta);
                state.ikVelocity = Vector3.Lerp(state.ikVelocity, desiredVelocity, velocityBlend);
                state.ikVelocity.scaleInPlace(1 - damping * 0.25);
                state.safetySpeedFactor += (1 - state.safetySpeedFactor) * clamp(delta * 8.5, 0, 1);
                state.reducedSpeedActive = false;
                state.avoidanceSide = 0;
            } else {
                const reducedDistFactor = minDist < SAFETY_REDUCED_SPEED_DIST
                    ? clamp(
                        (Math.max(minDist, SAFETY_HARD_STOP_DIST) - SAFETY_HARD_STOP_DIST) /
                        (SAFETY_REDUCED_SPEED_DIST - SAFETY_HARD_STOP_DIST),
                        SAFETY_MIN_SPEED_FACTOR,
                        1
                    )
                    : 1;
                const reducedHazardFactor = slowdownZone
                    ? clamp(1 - maxHazard * (dropOnSelfSupport ? 0.42 : 0.58), SAFETY_MIN_SPEED_FACTOR, 1)
                    : 1;
                const safetySlowdown = Math.min(reducedDistFactor, reducedHazardFactor);
                const avoidanceSlowdown = slowdownZone
                    ? clamp(
                        1 - Math.max(maxHazard * 0.72, nearRisk * 0.85),
                        precisePhase ? 0.42 : 0.24,
                        1
                    )
                    : 1;
                const slowdown = Math.min(avoidanceSlowdown, safetySlowdown);
                desiredVelocity.scaleInPlace(slowdown);
                state.safetySpeedFactor += (slowdown - state.safetySpeedFactor) * clamp(delta * 8.5, 0, 1);
                state.reducedSpeedActive = state.safetySpeedFactor < 0.97 && !state.safetyStopped;

                if (maxHazard < 0.08 && nearRisk < 0.08) state.avoidanceSide = 0;
            }
        } else {
            state.safetySpeedFactor += (1 - state.safetySpeedFactor) * clamp(delta * 8.5, 0, 1);
            state.reducedSpeedActive = false;
	        }
	    }

    if (!relaxedContactMotion && nearestCobotPoint && nearestCobotClearance < COBOT_ARM_REDUCED_SPEED_DIST) {
        const selfId = state.selfItem?.id ?? '';
        const otherLoaded = nearestCobotId ? simState.cobotLoads[nearestCobotId] === true : false;
        const selfLoaded = !!state.grabbedItem;
        const equalPriority = selfLoaded === otherLoaded;
        const shouldYield =
            (!selfLoaded && otherLoaded) ||
            (equalPriority && !!nearestCobotId && selfId > nearestCobotId);

        const toOther = nearestCobotPoint.subtract(wristPos);
        if (toOther.lengthSquared() > 0.000001) {
            toOther.normalize();
            const towardOther = Vector3.Dot(desiredVelocity, toOther);
            if (towardOther > 0) {
                desiredVelocity.addInPlace(toOther.scale(-towardOther * (shouldYield ? 1.0 : 0.72)));
            }

            const clearance = Math.max(0, nearestCobotClearance);
            const floorSpeed = shouldYield ? 0 : 0.22;
            const clearanceScale = clamp(
                (clearance - COBOT_ARM_HARD_STOP_DIST) /
                Math.max(0.001, COBOT_ARM_REDUCED_SPEED_DIST - COBOT_ARM_HARD_STOP_DIST),
                floorSpeed,
                1
            );
            desiredVelocity.scaleInPlace(clearanceScale);

            if (shouldYield) {
                const away = toOther.scale(-1);
                away.y = 0;
                if (away.lengthSquared() > 0.000001) {
                    away.normalize();
                    desiredVelocity.addInPlace(away.scale(cruiseSpeed * (1 - clearanceScale) * 0.32));
                }
                state.targetSource = 'yield';
                state.reducedSpeedActive = true;
                state.safetySpeedFactor = Math.min(state.safetySpeedFactor, Math.max(0.05, clearanceScale));
            }
        }
    }

	    if (!relaxedContactMotion) {
	        const velocityBlend = Math.min(1, accel * delta);
        state.ikVelocity = Vector3.Lerp(state.ikVelocity, desiredVelocity, velocityBlend);
        state.ikVelocity.scaleInPlace(1 - damping * 0.35);

        const step = state.ikVelocity.scale(delta);
        if (step.length() >= distanceToTarget) {
            state.ikTarget.copyFrom(state.desiredTarget);
            state.ikVelocity.setAll(0);
        } else {
            state.ikTarget.addInPlace(step);
        }
        clampTargetAboveSupports(state, state.ikTarget, state.phase, !!state.grabbedItem);
    }

    if (
        !Number.isFinite(state.ikTarget.x) ||
        !Number.isFinite(state.ikTarget.y) ||
        !Number.isFinite(state.ikTarget.z)
    ) {
        state.ikTarget.copyFrom(state.desiredTarget);
        if (
            !Number.isFinite(state.ikTarget.x) ||
            !Number.isFinite(state.ikTarget.y) ||
            !Number.isFinite(state.ikTarget.z)
        ) {
            state.ikTarget.copyFrom(state.idleTarget);
        }
        state.ikVelocity.setAll(0);
    }

    const cx = state.ikTarget.x - mountPos.x;
    const cz = state.ikTarget.z - mountPos.z;
    const cDist = Math.sqrt(cx * cx + cz * cz);
    const baseClearanceRadius = Math.max(IK_BASE_CLEARANCE_RADIUS, COBOT_PEDESTAL_SAFEZONE_RADIUS);
    const minC = baseClearanceRadius;
    if (cDist < minC && cDist > 0.001) {
        const push = minC - cDist;
        state.ikTarget.x += (cx / cDist) * push;
        state.ikTarget.z += (cz / cDist) * push;
    }

    // ── 2-link IK (verified against kyn.js) ──────────────────────────────
    const tx = state.ikTarget.x - mountPos.x;
    const ty = state.ikTarget.y - mountPos.y;
    const tz = state.ikTarget.z - mountPos.z;

    const worldYaw = Math.atan2(tx, tz);
    const baseTargetYaw = baseTravelYawTarget ?? normalizeAngle(worldYaw - state.baseRotY);
    const baseYawDelta = normalizeAngle(baseTargetYaw - state.basePivot.rotation.y);
    const baseMaxStep = COBOT_BASE_MAX_ANGULAR_SPEED * clamp(state.speed, 0.35, 1.1) * delta;
    state.basePivot.rotation.y = normalizeAngle(
        state.basePivot.rotation.y + clamp(baseYawDelta, -baseMaxStep, baseMaxStep)
    );

    // Wrist joint target (L3 points straight down), with self-clearance around base axis.
    let wx = tx;
    const wy = ty + L3;
    let wz = tz;

    const rawPlanarDist = Math.sqrt(wx * wx + wz * wz);
    if (rawPlanarDist > 0.0001 && rawPlanarDist < baseClearanceRadius) {
        const scale = baseClearanceRadius / rawPlanarDist;
        wx *= scale;
        wz *= scale;
    } else if (rawPlanarDist <= 0.0001) {
        wz = baseClearanceRadius;
    }

    const planarDist = Math.sqrt(wx * wx + wz * wz);
    const reach = Math.sqrt(planarDist * planarDist + wy * wy);
    const clampedR = Math.min(reach, L1 + L2 - 0.01);

    const elbowDen = Math.max(0.0001, 2 * L1 * L2);
    const cosE = clamp((clampedR * clampedR - L1 * L1 - L2 * L2) / elbowDen, -1, 1);
    const elbowAngle = Math.acos(cosE);

    const alpha2 = Math.atan2(wy, planarDist);
    const shoulderDen = Math.max(0.0001, 2 * Math.max(0.0001, clampedR) * L1);
    const beta2 = Math.acos(clamp((clampedR * clampedR + L1 * L1 - L2 * L2) / shoulderDen, -1, 1));

    const sh = clamp(Math.PI / 2 - alpha2 - beta2, shoulderLimits.min, shoulderLimits.max);
    const el = clamp(elbowAngle, elbowLimits.min, elbowLimits.max);
    const wr = Math.PI - sh - el;
    const toolNormalPhase = precisePhase || !!state.grabbedItem;
    const targetToolNormalBlend = toolNormalPhase ? 1.0 : 0.0;

    if (state.toolNormalBlend === undefined) state.toolNormalBlend = targetToolNormalBlend;
    state.toolNormalBlend += (targetToolNormalBlend - state.toolNormalBlend) * Math.min(1, delta * 12 * state.speed);

    const blend = state.toolNormalBlend;
    const wristPitch = clamp(wr * (0.72 + 0.28 * blend), wristLimits.min, wristLimits.max);
    const handPitchAngle = clamp(wr * (0.28 - 0.28 * blend), -wristLimits.max, wristLimits.max);

    state.shoulder.rotation.x = sh;
    state.elbow.rotation.x = el;
    state.wrist.rotation.x = wristPitch;
    state.handPitch.rotation.x = handPitchAngle;

    // Wrist roll
    let rd = state.wristRollTarget - state.currentWristRoll;
    while (rd < -Math.PI) rd += Math.PI * 2;
    while (rd > Math.PI) rd -= Math.PI * 2;
    state.currentWristRoll += rd * 12 * state.speed * delta;
    state.wristRoll.rotation.y = state.currentWristRoll;

    // Hard surface guard: never allow end-effector to sink into machine/support tops.
    state.gripperTip.computeWorldMatrix(true);
    const tipGuard = state.gripperTip.getAbsolutePosition();
    const guardObstacles = state.grabbedItem ? dropObstacles(state) : (state.selfItem ? [...state.obstacles, state.selfItem] : state.obstacles);
    const guardClearance = toolSurfaceClearance(state, state.phase);
    const guardTop = supportTopAt(tipGuard.x, tipGuard.z, guardObstacles, 0.15);
    const guardMinY = guardTop + guardClearance;
    if (!pickupContactOverride && tipGuard.y < guardMinY) {
        const lift = guardMinY - tipGuard.y;
        state.ikTarget.y += lift;
        state.desiredTarget.y = Math.max(state.desiredTarget.y, state.ikTarget.y);
        state.ikVelocity.y = Math.max(0, state.ikVelocity.y);
    }
    clampPickupHandAboveParts(state);
    resolveHandDiskPartContacts(state);
    resolveArmLinkStackClearance(state);

    if (isRunning && collisionsOn && !pickupContactOverride) {
        const hit = armHitsObstacle(state, state.obstacles);
        if (hit) {
            requestPredictiveReplan(state, hit);
            const penalty = hit.type === 'cobot' ? OVERDRIVE_HIT_PENALTY + 0.3 : OVERDRIVE_HIT_PENALTY;
            state.overdriveScore = Math.max(0, state.overdriveScore - penalty * 0.5);
            if (!isSoftAvoidCollision(state, hit)) {
                state.recoveryTimer = Math.max(state.recoveryTimer, 0.12);
            }
        }
        const partHit = armHitsPart(state);
        if (partHit) {
            const fineContactPhase =
                state.phase === 'pick_hover' ||
                state.phase === 'pick_descend' ||
                state.phase === 'pick_attach' ||
                state.phase === 'hover_drop' ||
                state.phase === 'descend_drop' ||
                state.phase === 'release';
            const pickCommitPhase = state.phase === 'pick_descend' || state.phase === 'pick_attach';
            const contactGain = fineContactPhase ? (partHit.severe ? 0.35 : 0.22) : (partHit.severe ? 1.45 : 1.0);
            state.partContactTimer += delta * contactGain;
            if (!pickCommitPhase || partHit.severe) {
                state.blockedTimer += delta * 0.35;
            }
            state.overdriveScore = Math.max(0, state.overdriveScore - OVERDRIVE_STALL_PENALTY * 0.35);
            if (state.partContactTimer > PART_CONTACT_WARN_TIMEOUT && (!pickCommitPhase || partHit.severe)) {
                state.recoveryTimer = Math.max(state.recoveryTimer, 0.16);
                const fakeObstacle: PlacedItem = {
                    id: `part_contact_${partHit.item.id}`,
                    type: 'pile',
                    position: [partHit.item.pos.x, Math.max(0, partHit.item.pos.y - partHalfHeight(partHit.item)), partHit.item.pos.z],
                    rotation: 0,
                    config: { machineSize: [0.5, 0.5], machineHeight: 0.45 }
                };
                requestPredictiveReplan(state, fakeObstacle);
            }
            if (!fineContactPhase && state.partContactTimer > PART_CONTACT_STOP_TIMEOUT) {
                state.safetyStopped = true;
                state.desiredTarget.copyFrom(state.ikTarget);
                if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
                state.targetedItem = null;
                state.activeDropTarget = null;
            }
        } else {
            state.partContactTimer = Math.max(0, state.partContactTimer - delta * 2.2);
        }
        state.lastSafeIkTarget.copyFrom(state.ikTarget);
    } else if (isRunning && pickupContactOverride) {
        state.partContactTimer = 0;
        state.blockedTimer = 0;
        state.motionStallTimer = 0;
        state.lastSafeIkTarget.copyFrom(state.ikTarget);
    } else if (isRunning) {
        state.partContactTimer = 0;
        state.blockedTimer = Math.max(0, state.blockedTimer - delta * 4);
        state.lastSafeIkTarget.copyFrom(state.ikTarget);
    }

    // Carry grabbed item
    if (state.grabbedItem) {
        state.gripperTip.computeWorldMatrix(true);
        const wp = state.gripperTip.getAbsolutePosition();
        state.grabbedItem.pos.set(wp.x, wp.y - partHalfHeight(state.grabbedItem) - 0.001, wp.z);
        state.grabbedItem.rotY = state.currentWristRoll;
    }

    // Keep release deterministic through state machine; avoid hidden auto-place teleports here.

    if (isRunning && collisionsOn && !pickupContactOverride) {
        state.gripperTip.computeWorldMatrix(true);
        const tip = state.gripperTip.getAbsolutePosition();
        const probe = state.grabbedItem?.pos ?? tip;
        const probeBottom = state.grabbedItem ? probe.y - partHalfHeight(state.grabbedItem) : tip.y - 0.03;
        const probeRadius = state.grabbedItem ? partRadiusForSpec(state.grabbedItem) : DISC_RADIUS * 0.5;
        const probeMotion = Vector3.Distance(probe, state.lastProbePos);
        const wantsToMove = Vector3.Distance(state.ikTarget, state.desiredTarget) > 0.12;

        const isAllowedPickContact = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
        const isAllowedDropContact = state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release';
        const dropTarget = currentDropTarget(state);
        const dropOnSelfSupport = !!(
            isAllowedDropContact &&
            dropTarget &&
            state.selfItem &&
            itemFootprintHit(state.selfItem, dropTarget.x, dropTarget.z, 0.08)
        );
        const dropContactRadius = Math.max(DISC_RADIUS, probeRadius) + (dropOnSelfSupport ? 0.18 : 0);
        const pickContact = isAllowedPickContact ? pickupContactState(state, state.targetedItem) : null;
        let blocked = false;

        for (const obstacle of dropObstacles(state)) {
            if (obstacle.type === 'camera') continue;
            // Never treat own cobot body/platform as a hard blocking obstacle for stall-stop logic.
            if (state.selfItem && obstacle.id === state.selfItem.id) continue;
            if (isAllowedPickContact && pickContact?.targetPos) {
                const targetSupportHere = itemFootprintHit(obstacle, pickContact.targetPos.x, pickContact.targetPos.z, 0.06);
                if (
                    targetSupportHere &&
                    pickContact.horizontalDist < Math.max(PICK_GRAB_RADIUS * 1.45, pickContact.targetRadius * 1.18)
                ) {
                    // During precise pickup, allow contact against the target support surface
                    // (belt/table) so we don't bounce away right before attach.
                    continue;
                }
            }
            if (isAllowedDropContact && dropTarget) {
                const dx = probe.x - dropTarget.x;
                const dz = probe.z - dropTarget.z;
                const nearActiveDrop = Math.sqrt(dx * dx + dz * dz) < dropContactRadius;
                if (nearActiveDrop && itemFootprintHit(obstacle, dropTarget.x, dropTarget.z, 0.08)) {
                    continue;
                }
                if (dropOnSelfSupport && state.selfItem && obstacle.id === state.selfItem.id && nearActiveDrop) {
                    continue;
                }
            }
            if (!itemFootprintHit(obstacle, probe.x, probe.z, state.grabbedItem ? probeRadius : 0.04)) continue;
            if (probeBottom <= machineTopY(obstacle) + 0.02) {
                blocked = true;
                if (wantsToMove && probeMotion < 0.003) {
                    state.blockedTimer += delta;
                    const avoidanceKickIn = dropOnSelfSupport ? 0.42 : 0.24;
                    const stallTimeout = dropOnSelfSupport ? 2.1 : STUCK_STALL_TIMEOUT;
                    if (state.blockedTimer > avoidanceKickIn && state.retreatTimer <= 0) {
                        requestPredictiveReplan(state, obstacle);
                    }
                    if (state.blockedTimer > stallTimeout) {
                        startRecoveryRetreat(state, obstacle);
                        state.blockedTimer = 0;
                        state.motionStallTimer = 0;
                        if (state.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
                            state.safetyStopped = true;
                            state.retreatTarget = null;
                            state.retreatTimer = 0;
                            state.desiredTarget.copyFrom(state.ikTarget);
                            if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
                            state.targetedItem = null;
                            state.activeDropTarget = null;
                            state.phase = 'idle';
                            state.waitTimer = 0;
                            logCobotEvent(state, 'safety_stop', 'stuck_on_drop_obstacle');
                            flushPhaseLog();
                            return true;
                        }
                    }
                }
                break;
            }
        }
        if (!blocked || !wantsToMove || probeMotion >= 0.003) {
            state.blockedTimer = 0;
        }
        const obstacleHitNow = armHitsObstacle(state, state.obstacles);
        const partHitNow = armHitsPart(state);
        const fineContactPhase =
            state.phase === 'pick_hover' ||
            state.phase === 'pick_descend' ||
            state.phase === 'pick_attach' ||
            state.phase === 'hover_drop' ||
            state.phase === 'descend_drop' ||
            state.phase === 'release';
        const isSelfObstacleHit = !!(obstacleHitNow && state.selfItem && obstacleHitNow.id === state.selfItem.id);
        const obstacleStallRisk = !!obstacleHitNow && !isSelfObstacleHit && (!pureVerticalContactMotion || obstacleHitNow.type === 'cobot');
        const partStallRisk = !!partHitNow && (!fineContactPhase || partHitNow.severe);
        const hazardStall = blocked || obstacleStallRisk || partStallRisk;
        const movementDemand = wantsToMove || (pureVerticalContactMotion && verticalTargetDelta > 0.04);
        const noProgress = probeMotion < STALL_PROGRESS_EPSILON;
        if (movementDemand && hazardStall && noProgress) {
            state.motionStallTimer += delta;
            const stallTimeout = (fineContactPhase || pureVerticalContactMotion) ? CONTACT_STALL_TIMEOUT : STUCK_STALL_TIMEOUT;
            if (state.motionStallTimer > stallTimeout) {
                state.safetyStopped = true;
                state.blockedTimer = 0;
                state.motionStallTimer = 0;
                state.retreatTarget = null;
                state.retreatTimer = 0;
                state.ikVelocity.setAll(0);
                state.desiredTarget.copyFrom(state.ikTarget);
                if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
                state.targetedItem = null;
                state.activeDropTarget = null;
                state.phase = 'idle';
                state.waitTimer = 0;
                logCobotEvent(state, 'safety_stop', 'overload_stall_emergency');
                flushPhaseLog();
                return true;
            }
        } else {
            state.motionStallTimer = Math.max(0, state.motionStallTimer - delta * 3.5);
        }
        state.lastProbePos.copyFrom(probe);
    } else if (isRunning && pickupContactOverride) {
        state.gripperTip.computeWorldMatrix(true);
        const tip = state.gripperTip.getAbsolutePosition();
        state.lastProbePos.copyFrom(tip);
        state.blockedTimer = 0;
        state.motionStallTimer = 0;
    } else if (isRunning) {
        state.blockedTimer = Math.max(0, state.blockedTimer - delta * 4);
        state.motionStallTimer = Math.max(0, state.motionStallTimer - delta * 4);
    }

    flushPhaseLog();

    // ── TORQUE AND OVERLOAD MONITORING ──────────────────────────────────────
    const currentAngles: [number, number, number, number] = [
        state.basePivot.rotation.y,
        state.shoulder.rotation.x,
        state.elbow.rotation.x,
        state.wrist.rotation.x
    ];

    const angularDelta = (current: number, previous: number) => {
        let diff = current - previous;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        return Math.abs(diff);
    };
    
    const wantsToMoveFast = state.ikVelocity.length() > 0.2;
    const isActuallyMoving = Vector3.Distance(state.ikTarget, state.lastProbePos) > 0.002;
    
    for (let i = 0; i < 4; i++) {
        const angleDiff = angularDelta(currentAngles[i], state.lastJointAngles[i]);
        // If we want to move but the joint is static, torque increases
        const load = (wantsToMoveFast && angleDiff < 0.001) ? 0.85 : (angleDiff * 2.5);
        state.jointTorques[i] = state.jointTorques[i] * 0.85 + load * 0.15;
        state.lastJointAngles[i] = currentAngles[i];
    }


    // High-resolution Motion Trace (log every point for debugging)
    const speed = state.ikVelocity.length();
    if (speed > 0.05 || state.phase !== 'idle') {
        logCobotEvent(state, 'motion_trace', `v=${speed.toFixed(3)} targetSource=${state.targetSource || 'unknown'}`);
    }

    // ── Path Visualization Update ──────────────────────────────────────────
    if (state.pathLine) {
        state.gripperTip.computeWorldMatrix(true);
        const toolPosNow = state.gripperTip.getAbsolutePosition();
        
        // Use the precalculated preview path for the long-range visualization
        // and prepend the current gripper position for a smooth connection.
        const previewPoints = state.precalculatedPath.length > 0 
            ? [toolPosNow.clone(), ...state.precalculatedPath]
            : [toolPosNow.clone(), state.desiredTarget.clone()];

        MeshBuilder.CreateLines(state.pathLine.name, { points: previewPoints, instance: state.pathLine });
        state.pathLine.isVisible = !!state.selfItem?.config?.cobotShowPath; 
    }

    return false;
}
