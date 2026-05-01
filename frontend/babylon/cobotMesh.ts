import {
    Scene, TransformNode, MeshBuilder, Vector3,
    PBRMaterial, Color3, Mesh, StandardMaterial
} from '@babylonjs/core';
import { appendCobotLog, simState, SimItem } from '../simState';
import { ItemConfig, PartShape, PartSize, PlacedItem, ProgramStep } from '../types';
import { factoryStore } from '../store';

const DISC_H = 0.025;
const DISC_RADIUS = 0.28;
const DROP_CLEARANCE = 0.22;
const DROP_HOVER_CLEARANCE = 0.28;
const PICK_HOVER_CLEARANCE = 0.24;
const PICK_DESCEND_CLEARANCE = 0.03;
const PICK_ALIGN_RADIUS = 0.4;
const PICK_GRAB_RADIUS = 0.34;
const PICK_CONTACT_RADIUS = 0.42;
const PICK_ATTACH_ALIGN_RADIUS = 0.24;
const PICK_LEAD_TIME = 0.16;
const PICK_TARGET_TIMEOUT = 2.25;
const PICK_SKIP_COOLDOWN = 0.35;
const PICK_CONTACT_PAD_GAP = 0.13;
const PICK_SURFACE_CONTACT_GAP = 0.12;
const PICK_SUPPORT_CLEARANCE = 0.03;
const PICK_ANCHOR_MIN_OFFSET = 0.36;
const PICK_ANCHOR_MAX_OFFSET = 1.25;
const PICK_TARGET_LOCK_ENTER_RADIUS = 0.72;
const PICK_TARGET_LOCK_MAX_DRIFT = 0.44;
const PICK_TARGET_LOCK_DURATION = 0.55;
const DROP_RECENTER_CLEARANCE = 0.3;
const STACK_SLOT_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];
const COBOT_BODY_W = 2.15;
const COBOT_BODY_D = 2.15;
const COBOT_BODY_H = 1.34;
const COBOT_PLATFORM_W = 1.98; // ~3 x large-part diameter (3 x 0.56) with margin
const COBOT_PLATFORM_D = 1.98;
const COBOT_PLATFORM_THICKNESS = 0.03;
const COBOT_PLATFORM_TOP_Y = COBOT_BODY_H + COBOT_PLATFORM_THICKNESS;
const COBOT_PLATFORM_MARGIN = 0.16;
export const COBOT_PEDESTAL_HEIGHT = 0.3;
const COBOT_PEDESTAL_BOTTOM_RADIUS_MIN = 0.2;
const COBOT_PEDESTAL_BOTTOM_RADIUS_MAX = 0.44;
const COBOT_BASE_PIVOT_Y = COBOT_PEDESTAL_HEIGHT;
const COBOT_MOUNT_REACH_OFFSET = COBOT_BASE_PIVOT_Y + 0.05;
const COBOT_UPPER_ARM_LENGTH = 1.8;
const COBOT_FOREARM_LENGTH = 1.38;
const COBOT_WRIST_LINK_LENGTH = 0.56;
const COBOT_HAND_LINK_LENGTH = 0.05;
const COBOT_GRIPPER_TIP_OFFSET = 0.215;
const COBOT_TOOL_REACH = COBOT_WRIST_LINK_LENGTH + COBOT_HAND_LINK_LENGTH + COBOT_GRIPPER_TIP_OFFSET;
const IK_BASE_CLEARANCE_RADIUS = 0;
export const COBOT_PEDESTAL_SAFEZONE_RADIUS = 0.02;
const IK_SHOULDER_MIN_DEFAULT = -1.35;
const IK_SHOULDER_MAX_DEFAULT = 1.4;
const IK_ELBOW_MIN_DEFAULT = 0.22;
const IK_ELBOW_MAX_DEFAULT = 2.9;
const IK_WRIST_MIN_DEFAULT = -Math.PI;
const IK_WRIST_MAX_DEFAULT = Math.PI;
const OVERDRIVE_DECAY_PER_SEC = 0.65;
const OVERDRIVE_HIT_PENALTY = 0.75;
const OVERDRIVE_STALL_PENALTY = 0.95;
const AVOIDANCE_BIAS_DECAY = 2.3;
const AVOIDANCE_MAX_BIAS = 2.1;
const RETREAT_DURATION = 0.68;
const RETREAT_BACKOFF = 0.42;
const MAX_RECOVERY_ATTEMPTS = 3;
const STUCK_STALL_TIMEOUT = 1.35;
const CONTACT_STALL_TIMEOUT = 1.9;
const STALL_PROGRESS_EPSILON = 0.0025;
const PART_CONTACT_WARN_TIMEOUT = 0.24;
const PART_CONTACT_STOP_TIMEOUT = 1.05;
const SAFETY_REDUCED_SPEED_DIST = 0.62;
const SAFETY_HARD_STOP_DIST = 0.09;
const SAFETY_MIN_SPEED_FACTOR = 0.5;
const COBOT_NEIGHBOR_YIELD_TRIGGER = 1.28;
const COBOT_NEIGHBOR_YIELD_MIN_OFFSET = 0.82;
const COBOT_NEIGHBOR_YIELD_MAX_OFFSET = 1.35;
const COBOT_YIELD_HOLD_SEC = 1.7;
const HAND_SAFETY_EXTRA_RADIUS = 0.06;
const PEDESTAL_HAND_CLEARANCE = 0.04;
const COBOT_UPPER_ARM_LENGTH_MIN = 0.2;
const COBOT_UPPER_ARM_LENGTH_MAX = 3.0;
const COBOT_FOREARM_LENGTH_MIN = 0.5;
const COBOT_FOREARM_LENGTH_MAX = 3.0;
const COBOT_WRIST_LENGTH_MIN = 0.2;
const COBOT_WRIST_LENGTH_MAX = 1.5;
const COBOT_SEGMENT_DIAMETER_MIN = 0.08;
const COBOT_SEGMENT_DIAMETER_MAX = 0.7;
const COBOT_UPPER_ARM_DIAMETER_DEFAULT = 0.34;
const COBOT_FOREARM_DIAMETER_DEFAULT = 0.26;
const COBOT_WRIST_DIAMETER_DEFAULT = 0.2;

const SIZE_DIAMETER: Record<PartSize, number> = { small: 0.44, medium: 0.5, large: 0.56 };
const SHAPE_BASE_DIAMETER: Record<PartShape, number> = {
    disc: 0.6,
    can: 0.56,
    box: 0.56,
    pyramid: 0.62,
};
const SHAPE_BASE_HEIGHT: Record<PartShape, number> = {
    disc: 0.025,
    can: 0.08,
    box: 0.08,
    pyramid: 0.1,
};
const SHAPE_ORDER: PartShape[] = ['disc', 'can', 'box', 'pyramid'];
const itemMotionTracker = new Map<string, { pos: Vector3; t: number; vel: Vector3 }>();

type PartLike = {
    shape?: PartShape;
    size: PartSize;
    radiusScale?: number;
    heightScale?: number;
    scaleX?: number;
    scaleZ?: number;
};

function partShape(spec: PartLike): PartShape {
    return spec.shape ?? 'disc';
}

function partSizeScale(spec: PartLike): number {
    return (SIZE_DIAMETER[spec.size] || SIZE_DIAMETER.medium) / 0.6;
}

function partHalfHeight(spec: PartLike): number {
    const baseH = SHAPE_BASE_HEIGHT[partShape(spec)] ?? SHAPE_BASE_HEIGHT.disc;
    return (baseH * (spec.heightScale ?? 1)) / 2;
}

function partRadiusForSpec(spec: PartLike): number {
    const shape = partShape(spec);
    const xScale = partSizeScale(spec) * (spec.radiusScale ?? 1) * (spec.scaleX ?? 1);
    const zScale = partSizeScale(spec) * (spec.radiusScale ?? 1) * (spec.scaleZ ?? 1);
    if (shape === 'box') {
        const halfW = (SHAPE_BASE_DIAMETER.box / 2) * xScale;
        const halfD = (SHAPE_BASE_DIAMETER.box / 2) * zScale;
        return Math.sqrt(halfW * halfW + halfD * halfD);
    }
    const baseR = (SHAPE_BASE_DIAMETER[shape] ?? SHAPE_BASE_DIAMETER.disc) / 2;
    return baseR * Math.max(xScale, zScale);
}

function partRadiusForSize(size: PartSize): number {
    return partRadiusForSpec({ shape: 'disc', size });
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function finiteNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}
function cobotUpperArmLength(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotUpperArmLength, COBOT_UPPER_ARM_LENGTH);
    return clamp(raw, COBOT_UPPER_ARM_LENGTH_MIN, COBOT_UPPER_ARM_LENGTH_MAX);
}
function cobotForearmLength(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotForearmLength, COBOT_FOREARM_LENGTH);
    return clamp(raw, COBOT_FOREARM_LENGTH_MIN, COBOT_FOREARM_LENGTH_MAX);
}
function cobotWristLength(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotWristLength, COBOT_WRIST_LINK_LENGTH);
    return clamp(raw, COBOT_WRIST_LENGTH_MIN, COBOT_WRIST_LENGTH_MAX);
}
function cobotUpperArmDiameter(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotUpperArmDiameter, COBOT_UPPER_ARM_DIAMETER_DEFAULT);
    return clamp(raw, COBOT_SEGMENT_DIAMETER_MIN, COBOT_SEGMENT_DIAMETER_MAX);
}
function cobotForearmDiameter(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotForearmDiameter, COBOT_FOREARM_DIAMETER_DEFAULT);
    return clamp(raw, COBOT_SEGMENT_DIAMETER_MIN, COBOT_SEGMENT_DIAMETER_MAX);
}
function cobotWristDiameter(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotWristDiameter, COBOT_WRIST_DIAMETER_DEFAULT);
    return clamp(raw, COBOT_SEGMENT_DIAMETER_MIN, COBOT_SEGMENT_DIAMETER_MAX);
}
function degToRad(deg: number): number {
    return finiteNumber(deg, 0) * (Math.PI / 180);
}
function cobotShoulderLimits(config?: ItemConfig): { min: number; max: number } {
    const min = degToRad(finiteNumber(config?.cobotShoulderMinDeg, -77));
    const max = degToRad(finiteNumber(config?.cobotShoulderMaxDeg, 80));
    const clampedMin = clamp(min, -Math.PI, Math.PI);
    const clampedMax = clamp(max, -Math.PI, Math.PI);
    return clampedMin < clampedMax
        ? { min: clampedMin, max: clampedMax }
        : { min: IK_SHOULDER_MIN_DEFAULT, max: IK_SHOULDER_MAX_DEFAULT };
}
function cobotElbowLimits(config?: ItemConfig): { min: number; max: number } {
    const min = degToRad(finiteNumber(config?.cobotElbowMinDeg, 13));
    const max = degToRad(finiteNumber(config?.cobotElbowMaxDeg, 166));
    const clampedMin = clamp(min, -Math.PI, Math.PI);
    const clampedMax = clamp(max, -Math.PI, Math.PI);
    return clampedMin < clampedMax
        ? { min: clampedMin, max: clampedMax }
        : { min: IK_ELBOW_MIN_DEFAULT, max: IK_ELBOW_MAX_DEFAULT };
}
function cobotWristLimits(config?: ItemConfig): { min: number; max: number } {
    const min = degToRad(finiteNumber(config?.cobotWristMinDeg, -180));
    const max = degToRad(finiteNumber(config?.cobotWristMaxDeg, 180));
    const clampedMin = clamp(min, -Math.PI, Math.PI);
    const clampedMax = clamp(max, -Math.PI, Math.PI);
    return clampedMin < clampedMax
        ? { min: clampedMin, max: clampedMax }
        : { min: IK_WRIST_MIN_DEFAULT, max: IK_WRIST_MAX_DEFAULT };
}
function cobotDefaultAngles(config?: ItemConfig): { shoulder: number; elbow: number; wrist: number } {
    const shoulderLimits = cobotShoulderLimits(config);
    const elbowLimits = cobotElbowLimits(config);
    const wristLimits = cobotWristLimits(config);
    const shoulderMinDeg = finiteNumber(config?.cobotShoulderMinDeg, -77);
    const shoulderMaxDeg = finiteNumber(config?.cobotShoulderMaxDeg, 80);
    const elbowMinDeg = finiteNumber(config?.cobotElbowMinDeg, 13);
    const elbowMaxDeg = finiteNumber(config?.cobotElbowMaxDeg, 166);
    const wristMinDeg = finiteNumber(config?.cobotWristMinDeg, -180);
    const wristMaxDeg = finiteNumber(config?.cobotWristMaxDeg, 180);
    const shoulderDefDeg = finiteNumber(config?.cobotShoulderDefDeg, (shoulderMinDeg + shoulderMaxDeg) * 0.5);
    const elbowDefDeg = finiteNumber(config?.cobotElbowDefDeg, (elbowMinDeg + elbowMaxDeg) * 0.5);
    const wristDefDeg = finiteNumber(config?.cobotWristDefDeg, (wristMinDeg + wristMaxDeg) * 0.5);
    return {
        shoulder: clamp(degToRad(shoulderDefDeg), shoulderLimits.min, shoulderLimits.max),
        elbow: clamp(degToRad(elbowDefDeg), elbowLimits.min, elbowLimits.max),
        wrist: clamp(degToRad(wristDefDeg), wristLimits.min, wristLimits.max),
    };
}
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
    appendCobotLog(state.selfItem.id, {
        ts: Date.now(),
        simTime: state.simTime,
        phase: state.phase,
        event,
        detail,
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
    const wallClear = wallTopAt(x, z, obstacles) + (carrying ? 0.44 : 0.52);
    const partSpec: PartLike = state.grabbedItem ?? { shape: 'disc', size: 'medium' };
    const stackBase = dropBaseCenterY(state, new Vector3(x, 0, z), partSpec);
    const stackCenter = stackCenterYAt(x, z, stackBase, partSpec, state.grabbedItem, 0.34);
    const stackTop = stackCenter + partHalfHeight(partSpec);
    const supportTop = supportTopAt(x, z, obstacles);
    const stackRise = Math.max(0, stackTop - supportTop);
    const riseBoost = clamp(stackRise * 0.45, 0, 0.62);
    const stackClear = stackTop + (carrying ? 0.34 : 0.4) + riseBoost;
    return Math.max(wallClear, stackClear);
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
    return maxClear;
}

function toolSurfaceClearance(state: CobotState, phase: string): number {
    if (phase === 'pick_descend' || phase === 'pick_attach') return 0.025;
    if (phase === 'release' || phase === 'descend_drop') return 0.05;
    if (phase === 'hover_drop' || phase === 'pick_hover') return 0.06;
    return 0.05;
}

function clampTargetAboveSupports(state: CobotState, target: Vector3, phase: string, carrying: boolean): Vector3 {
    const obstacles = carrying ? dropObstacles(state) : (state.selfItem ? [...state.obstacles, state.selfItem] : state.obstacles);
    const edgePad =
        phase === 'pick_descend' || phase === 'pick_attach' || phase === 'descend_drop' || phase === 'release'
            ? 0.17
            : DISC_RADIUS * 0.35;
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
    const touchingPart = effectiveDist < Math.max(PICK_CONTACT_RADIUS, targetRadius * 0.92) && padGap >= -0.02 && padGap <= PICK_CONTACT_PAD_GAP + 0.03;
    const touchingSurface = effectiveDist < Math.max(PICK_GRAB_RADIUS, targetRadius * 0.82) && tip.y <= supportTop + PICK_SURFACE_CONTACT_GAP + 0.018;
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
    const pickBest = (predicate: (idx: number) => boolean) => {
        let best = -1;
        let bestCount = Number.POSITIVE_INFINITY;
        let bestRank = Number.POSITIVE_INFINITY;
        for (const idx of preferredIndices) {
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

    // Stack-first behavior on cobot platform:
    // keep stacking same sorted slot until maxStack, then move to empties/others.
    const pickBestDense = (predicate: (idx: number) => boolean) => {
        let best = -1;
        let bestCount = -1;
        let bestRank = Number.POSITIVE_INFINITY;
        for (const idx of preferredIndices) {
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
    const centerBase = dropBaseCenterY(state, new Vector3(centerX, 0, centerZ), partSpec);
    const centerStack = stackCenterYAt(centerX, centerZ, centerBase, partSpec, state.grabbedItem, 0.34);
    const dynamicAnchorY = Math.max(
        state.selfItem.position[1] + COBOT_PLATFORM_TOP_Y + DROP_HOVER_CLEARANCE + 0.12,
        centerStack + DROP_HOVER_CLEARANCE + 0.14,
        stackAwareClearanceAt(state, centerX, centerZ, !!state.grabbedItem) + 0.1,
        state.position[1] + 1.2
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
    const baseClearance = state.position[1] + 2.05;
    const currentClearance = state.ikTarget.y + 0.18;
    if (!target) return quantizeHeight(Math.max(baseClearance, currentClearance), 0.05);
    const targetClearance = segmentClearanceY(state, state.ikTarget, target, true);
    return quantizeHeight(Math.max(baseClearance, currentClearance, targetClearance), 0.05);
}

function computeYieldTargetFromSensors(state: CobotState, mountPos: Vector3): Vector3 | null {
    const hazards = state.sensorHazards || [0, 0, 0, 0];
    const maxHazard = Math.max(hazards[0], hazards[1], hazards[2], hazards[3]);
    const selfId = state.selfItem?.id;
    let nearestOther: Vector3 | null = null;
    let nearestDist = Infinity;
    for (const [id, wrist] of Object.entries(simState.cobotWrists)) {
        if (!wrist || id === selfId) continue;
        const dx = mountPos.x - wrist.x;
        const dz = mountPos.z - wrist.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearestOther = wrist;
        }
    }
    const neighborTooClose = !!nearestOther && nearestDist < COBOT_NEIGHBOR_YIELD_TRIGGER;
    // Yield when sensors go orange or when another cobot wrist is simply too close.
    if (maxHazard < 0.24 && !neighborTooClose) return null;

    const heading = state.baseRotY + state.basePivot.rotation.y;
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    const right = new Vector3(forward.z, 0, -forward.x);
    const away = forward.scale(hazards[2] - hazards[0]).add(right.scale(hazards[3] - hazards[1]));

    if (neighborTooClose && nearestOther) {
        const neighborAway = new Vector3(mountPos.x - nearestOther.x, 0, mountPos.z - nearestOther.z);
        if (neighborAway.lengthSquared() < 0.0001) {
            neighborAway.copyFrom(right);
        } else {
            neighborAway.normalize();
        }
        if (away.lengthSquared() < 0.0001) {
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
        touching: planar <= Math.max(partR * 0.72, 0.16) && state.grabbedItem.pos.y <= landingY + 0.014,
    };
}

function computeDropExitTarget(state: CobotState, x: number, z: number, minSurfaceY = 0): Vector3 {
    const supportTop = supportTopAt(x, z, dropObstacles(state));
    const stackClear = stackAwareClearanceAt(state, x, z, false);
    const hoverY = quantizeHeight(Math.max(
        minSurfaceY + DROP_RECENTER_CLEARANCE + 0.18,
        supportTop + DROP_RECENTER_CLEARANCE + 0.12,
        stackClear + 0.22,
        state.position[1] + 1.18
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
    const carriedRadius = state.grabbedItem ? partRadiusForSpec(state.grabbedItem) : 0;
    const carriedPad = Math.min(0.22, carriedRadius * 0.55);
    const handPad = HAND_SAFETY_EXTRA_RADIUS + carriedPad;
    const links: Array<[Vector3, Vector3, number]> = [
        [mount, shoulder, 0.18],
        [shoulder, elbow, 0.17],
        [elbow, wrist, 0.14],
        [wrist, roll, 0.12 + handPad * 0.6],
        [roll, tip, 0.11 + handPad],
    ];
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
    const pickPhase = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
    const dropPhase = state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release';
    const dropTarget = dropPhase ? currentDropTarget(state) : null;
    const pickAnchor = pickPhase ? currentPickAnchor(state) : null;

    for (const item of simState.items) {
        if (item.state === 'dead' || item.state === 'grabbed') continue;
        if (item === state.grabbedItem) continue;
        if (pickPhase && item === state.targetedItem) continue;

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
            const pad = i >= armPoints.length - 3 ? 0.05 : 0.085;
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

function applySoftAvoidance(state: CobotState, hit: PlacedItem) {
    const away = new Vector3(state.ikTarget.x - hit.position[0], 0, state.ikTarget.z - hit.position[2]);
    if (away.lengthSquared() < 0.0001) {
        const heading = state.baseRotY + state.basePivot.rotation.y;
        away.set(Math.sin(heading), 0, Math.cos(heading));
    } else {
        away.normalize();
    }
    const hoverY = machineTopY(hit) + 0.36;
    const heading = state.baseRotY + state.basePivot.rotation.y;
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    const right = new Vector3(forward.z, 0, -forward.x);
    const sideSign = state.avoidanceSide !== 0
        ? state.avoidanceSide
        : (Vector3.Dot(away, right) >= 0 ? 1 : -1);
    state.avoidanceSide = sideSign > 0 ? 1 : -1;
    const lateral = right.scale(state.avoidanceSide);

    state.desiredTarget.x += away.x * 0.16;
    state.desiredTarget.z += away.z * 0.16;
    state.desiredTarget.x += lateral.x * 0.13;
    state.desiredTarget.z += lateral.z * 0.13;
    state.desiredTarget.y = Math.max(state.desiredTarget.y + 0.16, hoverY, state.position[1] + 0.3);
    state.avoidanceBias.addInPlace(away.scale(0.92)).addInPlace(lateral.scale(0.64));
    state.avoidanceBias.x = clamp(state.avoidanceBias.x, -AVOIDANCE_MAX_BIAS, AVOIDANCE_MAX_BIAS);
    state.avoidanceBias.z = clamp(state.avoidanceBias.z, -AVOIDANCE_MAX_BIAS, AVOIDANCE_MAX_BIAS);
    state.avoidanceBias.y = Math.max(state.avoidanceBias.y, 0.28);
    state.recoveryTimer = Math.max(state.recoveryTimer, 0.28);
    state.blockedTimer = Math.max(0, state.blockedTimer - 0.08);
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
    const path: Vector3[] = [start.clone()];
    const isManipulation = precisePhase || !!state.grabbedItem;
    // Use the same tiny pedestal keepout everywhere so behavior is predictable.
    const pathKeepout = Math.max(IK_BASE_CLEARANCE_RADIUS, COBOT_PEDESTAL_SAFEZONE_RADIUS);
    const sampledClearance = segmentClearanceY(state, start, goal, isManipulation);
    const clearY = quantizeHeight(Math.max(
        start.y,
        goal.y,
        sampledClearance,
        state.position[1] + 0.22
    ), 0.04);

    if (Math.abs(start.y - clearY) > 0.08) {
        path.push(new Vector3(start.x, clearY, start.z));
    }
    const navStartRaw = path[path.length - 1];
    const navGoalRaw = new Vector3(goal.x, Math.max(goal.y, isManipulation ? goal.y : clearY * 0.82), goal.z);
    const navStart = pushPointOutsideBaseKeepout(navStartRaw, mountPos, pathKeepout);
    const navGoal = pushPointOutsideBaseKeepout(navGoalRaw, mountPos, pathKeepout);
    if (Vector3.Distance(navStart, navStartRaw) > 0.01) path.push(navStart.clone());
    const dSegBaseSq = pointSegmentDistSq2D(mountPos.x, mountPos.z, navStart.x, navStart.z, navGoal.x, navGoal.z);
    const crossesBase = dSegBaseSq < pathKeepout * pathKeepout;

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
    } else if (Math.sqrt((navGoal.x - navStart.x) ** 2 + (navGoal.z - navStart.z) ** 2) > 1.1) {
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
    const goalChanged = Vector3.Distance(state.plannedPathGoal, goal) > (precisePhase ? 0.08 : 0.2);
    const phaseChanged = state.plannedPathPhase !== state.phase;
    const noPath = state.plannedPath.length < 2;
    const cursorDone = state.plannedPathCursor >= state.plannedPath.length;
    const allowGoalDrivenReplan = !isFineAlignPhase(state.phase);
    const shouldReplan = noPath || phaseChanged || cursorDone || (allowGoalDrivenReplan && goalChanged && state.pathReplanCooldown <= 0);
    if (shouldReplan) {
        state.plannedPath = planToolpath(state, state.ikTarget, goal, mountPos, precisePhase);
        state.plannedPathCursor = Math.min(1, state.plannedPath.length - 1);
        state.plannedPathGoal.copyFrom(goal);
        state.plannedPathPhase = state.phase;
        state.pathReplanCooldown = precisePhase ? 0.24 : 0.34;
    }

    const reachWp = precisePhase ? 0.08 : 0.16;
    while (
        state.plannedPathCursor < state.plannedPath.length - 1 &&
        Vector3.Distance(state.ikTarget, state.plannedPath[state.plannedPathCursor]) < reachWp
    ) {
        state.plannedPathCursor += 1;
    }
    return state.plannedPath[state.plannedPathCursor] ?? goal;
}

function isFineAlignPhase(phase: string): boolean {
    return phase === 'pick_hover'
        || phase === 'pick_descend'
        || phase === 'pick_attach'
        || phase === 'pick_recenter'
        || phase === 'hover_drop'
        || phase === 'descend_drop'
        || phase === 'release'
        || phase === 'drop_recenter';
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
    if (state.lockedFlowPhase !== state.phase) {
        state.lockedFlowPhase = state.phase;
        state.lockedFlowGoal.copyFrom(rawGoal);
        return state.lockedFlowGoal.clone();
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
    if (state.program.length === 0) {
        const preview: Vector3[] = [state.ikTarget.clone()];
        appendPathSegment(preview, planToolpath(state, state.ikTarget, flowGoal, mountPos, precisePhase));
        return preview;
    }

    const firstStep = state.program.find(step =>
        !!step.pos && (step.action === 'move' || step.action === 'pick' || step.action === 'drop')
    );
    const firstPos = firstStep?.pos
        ? new Vector3(firstStep.pos[0], firstStep.pos[1], firstStep.pos[2])
        : state.idleTarget.clone();
    const firstY = Math.max(
        firstPos.y + 0.22,
        wallTopAt(firstPos.x, firstPos.z, dropObstacles(state)) + 0.18,
        state.position[1] + 1.18
    );
    const preview: Vector3[] = [new Vector3(firstPos.x, firstY, firstPos.z)];
    let cursor = preview[0].clone();
    let totalPreviewDistance = 0;
    const maxPreviewDistance = 80.0;
    const pushSegment = (segment: Vector3[]) => {
        if (segment.length < 2) return;
        let segDist = 0;
        for (let i = 1; i < segment.length; i++) segDist += Vector3.Distance(segment[i - 1], segment[i]);
        if (totalPreviewDistance + segDist > maxPreviewDistance) return;
        appendPathSegment(preview, segment);
        totalPreviewDistance += segDist;
        cursor = segment[segment.length - 1].clone();
    };
    for (const step of state.program) {
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
    return preview;
}

function pbr(scene: Scene, hex: string, metallic = 0.5, roughness = 0.4, alpha = 1): PBRMaterial {
    const m = new PBRMaterial('', scene);
    m.albedoColor = Color3.FromHexString(hex || '#94a3b8');
    m.metallic = metallic; m.roughness = roughness;
    if (alpha < 1) { m.alpha = alpha; m.transparencyMode = 2; }
    return m;
}
function box(n: string, w: number, h: number, d: number, pos: Vector3, mat: PBRMaterial, scene: Scene, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
    m.position = pos; m.material = mat;
    m.receiveShadows = true; m.castShadows = true;
    if (parent) m.parent = parent;
    return m;
}
function cyl(n: string, r: number, h: number, pos: Vector3, mat: PBRMaterial, scene: Scene, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateCylinder(n, { diameter: r * 2, height: h, tessellation: 24 }, scene);
    m.position = pos; m.material = mat;
    m.receiveShadows = true; m.castShadows = true;
    if (parent) m.parent = parent;
    return m;
}
function sph(n: string, d: number, pos: Vector3, mat: PBRMaterial, scene: Scene, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateSphere(n, { diameter: d, segments: 14 }, scene);
    m.position = pos; m.material = mat;
    m.castShadows = true;
    if (parent) m.parent = parent;
    return m;
}

export interface StackSlot {
    worldPos: Vector3;
    maxStack: number;
    color: string;
    col: number;
    row: number;
}

export interface CobotState {
    root: TransformNode;
    mountBase: TransformNode;
    basePivot: TransformNode;
    shoulder: TransformNode;
    elbow: TransformNode;
    wrist: TransformNode;
    wristRoll: TransformNode;
    handPitch: TransformNode;
    leftFinger: Mesh;
    rightFinger: Mesh;
    gripperTip: TransformNode;
    statusDisplay: Mesh;
    statusDisplayMat: PBRMaterial;
    proximityMats: StandardMaterial[];
    collisionSphere: Mesh;
    proximityMult: number;

    ikTarget: Vector3;
    lastSafeIkTarget: Vector3;
    ikVelocity: Vector3;
    desiredTarget: Vector3;
    wristRollTarget: number;
    currentWristRoll: number;
    gripperOpen: boolean;
    currentGripperPos: number;
    blockedTimer: number;
    motionStallTimer: number;
    partContactTimer: number;
    lastProbePos: Vector3;
    simTime: number;
    targetTimer: number;
    skippedTargetIds: Record<string, number>;
    safetyStopped: boolean;
    recoveryTimer: number;
    overdriveScore: number;
    avoidanceSide: -1 | 0 | 1;
    avoidanceBias: Vector3;
    retreatTarget: Vector3 | null;
    retreatTimer: number;
    recoveryAttempts: number;
    plannedPath: Vector3[];
    plannedPathCursor: number;
    plannedPathGoal: Vector3;
    plannedPathPhase: string;
    pathReplanCooldown: number;
    precalculatedPath: Vector3[];
    lockedFlowGoal: Vector3;
    lockedFlowPhase: string;
    lockedPickupTarget: Vector3 | null;
    lockedPickupItemId: string | null;
    lockedPickupUntil: number;
    yieldTarget: Vector3 | null;
    yieldUntil: number;
    avoidDropTarget: Vector3 | null;
    avoidDropUntil: number;
    dropExitTarget: Vector3 | null;
    dropReplanStreak: number;
    lastReplanTargetKey: string;

    phase: string;
    stepIndex: number;
    targetedItem: SimItem | null;
    grabbedItem: SimItem | null;
    waitTimer: number;
    autoDropTarget: Vector3 | null;  // set during auto-stack
    activeDropTarget: Vector3 | null;
    isAutoProgram?: boolean;
    toolNormalBlend?: number;

    position: [number, number, number];
    baseRotY: number;
    program: ProgramStep[];
    speed: number;
    selfItem: PlacedItem | null;
    cameras: PlacedItem[];
    obstacles: PlacedItem[];
    pickColors: string[];
    pickSizes: PartSize[];
    linkedCameraIds: string[];
    autoOrganize: boolean;
    idleTarget: Vector3;
    manualControl: boolean;
    manualTarget: Vector3 | null;
    stackSlots: StackSlot[];         // top-platform grid positions
    mountCollisionRadius: number;    // radial keep-out around pedestal center
    isFull: boolean;
    sensorLights: import("@babylonjs/core").Mesh[];
    tuningMode: boolean;
    lastDroppedItemId?: string;      // skip re-targeting this after auto-drop
    sensorHazards: [number, number, number, number];
    sensorMinDist: number;
    safetySpeedFactor: number;
    reducedSpeedActive: boolean;
    lastLoggedPhase: string;
    lastStatusReasonKey: string;
    lastStatusReasonAt: number;
    tuningHighlightTargets: Record<string, Mesh[]>;
    lastTuningHighlightKey?: string;
}

function applyTuningElementHighlight(state: CobotState) {
    const selected = state.selfItem?.config?.cobotTuningSelectedElement;
    const active = selected ?? '';
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

function defaultCobotIdleTarget(item: PlacedItem): Vector3 {
    return new Vector3(
        item.position[0],
        item.position[1] + 2.2,
        item.position[2]
    );
}

function configTargetToVector(target?: [number, number, number] | null): Vector3 | null {
    if (!target) return null;
    return new Vector3(target[0], target[1], target[2]);
}

export function createCobot(item: PlacedItem, scene: Scene, isGhost = false): { node: TransformNode; state?: CobotState } {
    const alpha = isGhost ? 0.35 : 1;
    const baseRotY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][item.rotation] ?? 0;

    // ── Materials ──────────────────────────────────────────────────────────
    const amrBody = pbr(scene, '#1e2433', 0.1, 0.8, alpha);   // dark chassis
    const amrPanel = pbr(scene, '#f1f3f5', 0.05, 0.5, alpha);  // white panel
    const amrAccentG = pbr(scene, '#22c55e', 0.1, 0.3, alpha);   // green LED strip
    const amrEdge = pbr(scene, '#374151', 0.3, 0.6, alpha);   // edge trim
    const linkMat = pbr(scene, '#cdd3d8', 0.65, 0.25, alpha);
    const jointMat = pbr(scene, '#7b8794', 0.75, 0.2, alpha);
    const gripMat = pbr(scene, '#2d3748', 0.4, 0.5, alpha);
    const wheelMat = pbr(scene, '#0d0d14', 0.1, 0.9, alpha);

    if (!isGhost) {
        amrAccentG.emissiveColor = new Color3(0.13, 0.77, 0.37);
    }

    // ── Root ───────────────────────────────────────────────────────────────
    const root = new TransformNode(`cobot_root_${item.id}`, scene);
    root.position = new Vector3(...item.position);
    root.rotation.y = baseRotY;

    // ── AMR BODY (fills 2x2 tile, taller & wider) ──────────────────────────
    const BW = COBOT_BODY_W, BD = COBOT_BODY_D, BH = COBOT_BODY_H;
    box('chassis', BW, BH, BD, new Vector3(0, BH / 2, 0), amrBody, scene, root);
    box('fPanel', BW - 0.1, BH - 0.18, 0.026, new Vector3(0, BH / 2, BD / 2 - 0.012), amrPanel, scene, root);
    box('bPanel', BW - 0.1, BH - 0.18, 0.026, new Vector3(0, BH / 2, -BD / 2 + 0.012), amrPanel, scene, root);
    box('sPanel1', 0.026, BH - 0.18, BD - 0.1, new Vector3(BW / 2 - 0.012, BH / 2, 0), amrPanel, scene, root);
    box('sPanel2', 0.026, BH - 0.18, BD - 0.1, new Vector3(-BW / 2 + 0.012, BH / 2, 0), amrPanel, scene, root);
    // Logo/display on front panel
    const statusDisplayMat = pbr(scene, '#334155', 0, 0.9, alpha);
    if (!isGhost) statusDisplayMat.emissiveColor = new Color3(0.02, 0.03, 0.04);
    const statusDisplay = box('display', 0.56, 0.3, 0.016, new Vector3(0, BH * 0.56, BD / 2 + 0.01), statusDisplayMat, scene, root);
    box('display2', 0.56, 0.3, 0.016, new Vector3(0, BH * 0.56, -BD / 2 - 0.01), statusDisplayMat, scene, root);
    box('display3', 0.016, 0.3, 0.56, new Vector3(BW / 2 + 0.01, BH * 0.56, 0), statusDisplayMat, scene, root);
    box('display4', 0.016, 0.3, 0.56, new Vector3(-BW / 2 - 0.01, BH * 0.56, 0), statusDisplayMat, scene, root);
    // Green accent strips on all vertical edges
    const es = 0.035, eh = BH;
    box('eFL', es, eh, es, new Vector3(-BW / 2 + 0.02, BH / 2, BD / 2 - 0.02), amrAccentG, scene, root);
    box('eFR', es, eh, es, new Vector3(BW / 2 - 0.02, BH / 2, BD / 2 - 0.02), amrAccentG, scene, root);
    box('eBL', es, eh, es, new Vector3(-BW / 2 + 0.02, BH / 2, -BD / 2 + 0.02), amrAccentG, scene, root);
    box('eBR', es, eh, es, new Vector3(BW / 2 - 0.02, BH / 2, -BD / 2 + 0.02), amrAccentG, scene, root);
    // Edge trim on top perimeter
    box('trimF', BW, 0.04, 0.04, new Vector3(0, BH, BD / 2 - 0.02), amrEdge, scene, root);
    box('trimB', BW, 0.04, 0.04, new Vector3(0, BH, -BD / 2 + 0.02), amrEdge, scene, root);
    box('trimL', 0.04, 0.04, BD, new Vector3(-BW / 2 + 0.02, BH, 0), amrEdge, scene, root);
    box('trimR', 0.04, 0.04, BD, new Vector3(BW / 2 - 0.02, BH, 0), amrEdge, scene, root);

    // Wheels (4x side-mounted cylinders)
    const wheelY = 0.22;
    const wheelZ = Math.max(0.46, BD * 0.28);
    [[-BW / 2 - 0.04, wheelY, wheelZ], [BW / 2 + 0.04, wheelY, wheelZ],
    [-BW / 2 - 0.04, wheelY, -wheelZ], [BW / 2 + 0.04, wheelY, -wheelZ]].forEach((p, i) => {
        const wm = MeshBuilder.CreateCylinder(`wh${i}`, { diameter: 0.32, height: 0.1, tessellation: 20 }, scene);
        wm.rotation.z = Math.PI / 2; wm.position = new Vector3(p[0], p[1], p[2]);
        wm.material = wheelMat; wm.parent = root;
    });

    // ── BACK PLATFORM (clean stacking area) ───────────────────────────────
    const matrix = item.config?.stackMatrix || [3, 3];
    const cols = Math.max(1, Math.min(6, Math.round(matrix[0] || 3)));
    const rows = Math.max(1, Math.min(6, Math.round(matrix[1] || 3)));
    const usableW = Math.max(0.2, COBOT_PLATFORM_W - COBOT_PLATFORM_MARGIN);
    const usableD = Math.max(0.2, COBOT_PLATFORM_D - COBOT_PLATFORM_MARGIN);
    const platMat = pbr(scene, '#0d1117', 0.05, 0.95, alpha);
    const gridMat = pbr(scene, '#e2e8f0', 0, 0.65, isGhost ? 0.22 : 0.42);
    if (!isGhost) gridMat.emissiveColor = Color3.FromHexString('#e2e8f0').scale(0.08);
    box('topPlat', COBOT_PLATFORM_W, COBOT_PLATFORM_THICKNESS, COBOT_PLATFORM_D, new Vector3(0, BH + COBOT_PLATFORM_THICKNESS / 2, 0), platMat, scene, root);
    const gridY = COBOT_PLATFORM_TOP_Y + 0.003;
    for (let c = 0; c <= cols; c++) {
        const x = -usableW / 2 + usableW * (c / cols);
        box(`stackGridCol${c}`, 0.016, 0.008, usableD, new Vector3(x, gridY, 0), gridMat, scene, root);
    }
    for (let r = 0; r <= rows; r++) {
        const z = -usableD / 2 + usableD * (r / rows);
        box(`stackGridRow${r}`, usableW, 0.008, 0.016, new Vector3(0, gridY, z), gridMat, scene, root);
    }
    const slotCenterY = COBOT_PLATFORM_TOP_Y + DISC_H / 2;
    const cellW = usableW / cols;
    const cellD = usableD / rows;
    const mountSlot = item.config?.mountSlot || [cols - 1, rows - 1];
    const mountCol = Math.max(0, Math.min(cols - 1, Math.round(mountSlot[0] ?? (cols - 1))));
    const mountRow = Math.max(0, Math.min(rows - 1, Math.round(mountSlot[1] ?? (rows - 1))));
    const mountLocalX = -usableW / 2 + cellW * (mountCol + 0.5);
    const mountLocalZ = -usableD / 2 + cellD * (mountRow + 0.5);
    const markerRadius = Math.max(0.06, Math.min(0.2, Math.min(cellW, cellD) * 0.16));
    const stackLocalPos: Array<{ col: number; row: number; pos: Vector3 }> = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = -usableW / 2 + cellW * (col + 0.5);
            const z = -usableD / 2 + cellD * (row + 0.5);
            stackLocalPos.push({ col, row, pos: new Vector3(x, slotCenterY, z) });
        }
    }
    stackLocalPos.forEach((slot, index) => {
        if (slot.col === mountCol && slot.row === mountRow) return;
        const slotColor = STACK_SLOT_COLORS[index % STACK_SLOT_COLORS.length];
        const markMat = pbr(scene, slotColor, 0.1, 0.45, isGhost ? 0.25 : 0.65);
        if (!isGhost) markMat.emissiveColor = Color3.FromHexString(slotColor).scale(0.16);
        cyl(`stMark${index}`, markerRadius, 0.012, new Vector3(slot.pos.x, COBOT_PLATFORM_TOP_Y + 0.007, slot.pos.z), markMat, scene, root);
    });
    const upperArmLen = cobotUpperArmLength(item.config);
    const forearmLen = cobotForearmLength(item.config);
    const wristLen = cobotWristLength(item.config);
    const upperArmRadius = cobotUpperArmDiameter(item.config) / 2;
    const forearmRadius = cobotForearmDiameter(item.config) / 2;
    const wristRadius = cobotWristDiameter(item.config) / 2;
    const mountCell = Math.min(cellW, cellD);
    const maxSegmentDiameter = Math.max(upperArmRadius * 2, forearmRadius * 2, wristRadius * 2);
    const thicknessScale = clamp(maxSegmentDiameter / COBOT_UPPER_ARM_DIAMETER_DEFAULT, 0.72, 1.7);
    const pedestalScale = clamp(1 + (thicknessScale - 1) * 0.35, 0.82, 1.28);
    const pedestalRadiusScale = clamp(item.config?.cobotPedestalRadiusScale ?? 1, 0.6, 1.8);
    const baseRingRadiusScale = clamp(item.config?.cobotBaseRingRadiusScale ?? 1, 0.6, 1.8);
    const pedestalHeight = clamp(item.config?.cobotPedestalHeight ?? COBOT_PEDESTAL_HEIGHT, 0.18, 0.8);
    const pedestalRadiusBase = Math.max(0.17, Math.min(0.26, mountCell * 0.32));
    const baseRingRadiusBase = Math.max(0.21, Math.min(0.34, mountCell * 0.38));
    const pedestalRadius = clamp(pedestalRadiusBase * pedestalScale * pedestalRadiusScale, 0.14, 0.52);
    const baseRingRadius = clamp(baseRingRadiusBase * pedestalScale * baseRingRadiusScale, 0.16, 0.58);
    const pedestalBottomRadius = clamp(
        Math.max(baseRingRadius + 0.035, pedestalRadius + 0.075),
        COBOT_PEDESTAL_BOTTOM_RADIUS_MIN,
        COBOT_PEDESTAL_BOTTOM_RADIUS_MAX
    );
    const mountCollisionRadius = Math.max(baseRingRadius, pedestalBottomRadius);
    const shoulderJointRadius = clamp((item.config?.cobotShoulderJointDiameter ?? ((upperArmRadius + 0.05) * 2)) * 0.5, 0.07, 0.45);
    const elbowJointRadius = clamp((item.config?.cobotElbowJointDiameter ?? ((Math.max(upperArmRadius, forearmRadius) + 0.04) * 2)) * 0.5, 0.07, 0.45);
    const wristJointRadius = clamp((item.config?.cobotWristJointDiameter ?? ((Math.max(forearmRadius, wristRadius) + 0.03) * 2)) * 0.5, 0.06, 0.36);
    const toolJointRadius = clamp((item.config?.cobotToolJointDiameter ?? ((wristRadius + 0.02) * 2)) * 0.5, 0.05, 0.3);
    const shoulderJointLen = clamp(item.config?.cobotShoulderJointLength ?? 0.44, 0.12, 1.2);
    const elbowJointLen = clamp(item.config?.cobotElbowJointLength ?? 0.44, 0.12, 1.2);
    const wristJointLen = clamp(item.config?.cobotWristJointLength ?? 0.3, 0.1, 0.9);
    const toolJointLen = clamp(item.config?.cobotToolJointLength ?? 0.26, 0.08, 0.7);

    // ── ARM MOUNT — configurable slot within platform grid ──
    const mountBase = new TransformNode('mountBase', scene);
    mountBase.parent = root;
    mountBase.position = new Vector3(mountLocalX, COBOT_PLATFORM_TOP_Y, mountLocalZ);

    // Pedestal / turret base sized to one grid cell (1/9 of platform) and tapered
    const pedestal = MeshBuilder.CreateCylinder('pedestal', {
        diameterBottom: pedestalBottomRadius * 2,
        diameterTop: pedestalRadius * 2,
        height: pedestalHeight,
        tessellation: 32
    }, scene);
    pedestal.position = new Vector3(0, pedestalHeight / 2, 0);
    pedestal.material = amrEdge;
    pedestal.parent = mountBase;

    const basePivot = new TransformNode('basePivot', scene);
    basePivot.parent = mountBase;
    basePivot.position.y = pedestalHeight;
    const baseRing = cyl('baseRing', baseRingRadius, 0.075, new Vector3(0, 0.01, 0), jointMat, scene, basePivot);

    // ── LINK 1 — upper arm (offset laterally to allow folding) ────────────
    const shoulder = new TransformNode('shoulder', scene);
    shoulder.parent = basePivot;
    shoulder.position.y = 0.04;
    const shoulderVisualOffset = new Vector3(
        clamp(item.config?.cobotShoulderVisualOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotShoulderVisualOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotShoulderVisualOffsetZ ?? 0, -0.6, 0.6)
    );
    const elbowVisualOffset = new Vector3(
        clamp(item.config?.cobotElbowVisualOffsetX ?? 0.18, -0.6, 0.6),
        clamp(item.config?.cobotElbowVisualOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotElbowVisualOffsetZ ?? 0, -0.6, 0.6)
    );
    const wristVisualOffset = new Vector3(
        clamp(item.config?.cobotWristVisualOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotWristVisualOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotWristVisualOffsetZ ?? 0, -0.6, 0.6)
    );
    const shoulderJointOffset = new Vector3(
        clamp(item.config?.cobotShoulderJointOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotShoulderJointOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotShoulderJointOffsetZ ?? 0, -0.6, 0.6)
    );
    const elbowJointOffset = new Vector3(
        clamp(item.config?.cobotElbowJointOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotElbowJointOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotElbowJointOffsetZ ?? 0, -0.6, 0.6)
    );
    const wristJointOffset = new Vector3(
        clamp(item.config?.cobotWristJointOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotWristJointOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotWristJointOffsetZ ?? 0, -0.6, 0.6)
    );
    const j0 = cyl('j0', shoulderJointRadius, shoulderJointLen, shoulderJointOffset, jointMat, scene, shoulder);
    j0.rotation.z = Math.PI / 2;
    const link1VisualLen = Math.max(0.2, upperArmLen - 0.04);
    const link1 = cyl('link1', upperArmRadius, link1VisualLen, new Vector3(shoulderVisualOffset.x, link1VisualLen / 2 + shoulderVisualOffset.y, shoulderVisualOffset.z), linkMat, scene, shoulder);

    // ── LINK 2 — forearm (centered, bypassing link1) ──────────────────────
    const elbow = new TransformNode('elbow', scene);
    elbow.parent = shoulder;
    elbow.position.y = upperArmLen;
    // Keep elbow joint axis tunable per-segment; this is visual-only.
    const j1 = cyl('j1', elbowJointRadius, elbowJointLen, elbowJointOffset, jointMat, scene, elbow);
    j1.rotation.z = Math.PI / 2;
    const link2VisualLen = Math.max(0.2, forearmLen - 0.05);
    // Middle link runs off-axis for clearance and wider apparent articulation.
    const link2 = cyl('link2', forearmRadius, link2VisualLen, new Vector3(elbowVisualOffset.x, link2VisualLen / 2 + elbowVisualOffset.y, elbowVisualOffset.z), linkMat, scene, elbow);

    // ── LINK 3 — wrist tube ───────────────────────────────────────────────
    const wrist = new TransformNode('wrist', scene);
    wrist.parent = elbow;
    wrist.position.set(0, forearmLen, 0);
    // Wrist + hand can be fine-tuned visually per segment.
    const j2 = cyl('j2', wristJointRadius, wristJointLen, wristJointOffset, jointMat, scene, wrist);
    j2.rotation.z = Math.PI / 2;
    const link3 = cyl('link3', wristRadius, wristLen, new Vector3(wristVisualOffset.x, wristLen / 2 + wristVisualOffset.y, wristVisualOffset.z), linkMat, scene, wrist);

    // ── WRIST ROLL ────────────────────────────────────────────────────────
    const wristRoll = new TransformNode('wristRoll', scene);
    wristRoll.parent = wrist;
    wristRoll.position.y = wristLen;
    cyl('j3', toolJointRadius, toolJointLen, Vector3.Zero(), jointMat, scene, wristRoll);

    // ── HAND PITCH (Extra joint) ──────────────────────────────────────────
    cyl('handLink', 0.08, COBOT_HAND_LINK_LENGTH, new Vector3(0, COBOT_HAND_LINK_LENGTH / 2, 0), linkMat, scene, wristRoll);

    const handPitch = new TransformNode('handPitch', scene);
    handPitch.parent = wristRoll;
    handPitch.position.y = COBOT_HAND_LINK_LENGTH;
    const j4 = cyl('j4', Math.max(0.075, toolJointRadius - 0.015), 0.22, Vector3.Zero(), jointMat, scene, handPitch);
    j4.rotation.z = Math.PI / 2;

    // Suction nozzle
    cyl('nozzle', 0.045, 0.2, new Vector3(0, 0.1, 0), gripMat, scene, handPitch);
    const padMat = pbr(scene, '#0d0d14', 0.1, 0.95, alpha);
    const suctionPad = MeshBuilder.CreateCylinder('suctionPad', { diameter: 0.32, height: 0.026, tessellation: 32 }, scene) as Mesh;
    suctionPad.position = new Vector3(0, 0.21, 0);
    suctionPad.material = padMat; suctionPad.parent = handPitch;

    const vacMat = pbr(scene, '#10b981', 0.1, 0.3, alpha);
    if (!isGhost) vacMat.emissiveColor = new Color3(0.06, 0.73, 0.51);
    const vacRing = MeshBuilder.CreateTorus('vacRing', { diameter: 0.27, thickness: 0.016, tessellation: 32 }, scene) as Mesh;
    vacRing.position = new Vector3(0, 0.224, 0);
    vacRing.material = vacMat; vacRing.parent = handPitch;

    const leftFinger = suctionPad;
    const rightFinger = suctionPad;

    const gripperTip = new TransformNode('gripperTip', scene);
    gripperTip.parent = handPitch;
    gripperTip.position.y = COBOT_GRIPPER_TIP_OFFSET;

    if (isGhost) return { node: root };

    const proximityMats: StandardMaterial[] = [];
    const mat = new StandardMaterial(`proxMat_${item.id}`, scene);
    mat.alpha = 0; // invisible logic sphere

    const collisionSphere = MeshBuilder.CreateSphere(`collision_${item.id}`, { diameter: 1.0, segments: 16 }, scene);
    collisionSphere.parent = wrist;
    collisionSphere.position.set(0, wristLen + 0.1, 0); // centered near wrist/tool section
    collisionSphere.material = mat;
    collisionSphere.isPickable = false;

    // Visual proximity sensors (4-way around wrist: front/right/back/left)
    const sensorLights: Mesh[] = [];
    const sensorOffsets: Array<[number, number, number]> = [
        [0, 0.1, 0.13],   // front
        // Side indicators follow hazard order directly (front/right/back/left).
        [0.13, 0.1, 0],   // right
        [0, 0.1, -0.13],  // back
        [-0.13, 0.1, 0],  // left
    ];
    for (let i = 0; i < sensorOffsets.length; i++) {
        const camMat = new StandardMaterial(`camMat_${item.id}_${i}`, scene);
        camMat.emissiveColor = Color3.FromHexString('#22c55e');
        camMat.disableLighting = true;
        proximityMats.push(camMat);

        const camMesh = MeshBuilder.CreateSphere(`camMesh_${item.id}_${i}`, { diameter: 0.04, segments: 8 }, scene);
        camMesh.material = camMat;
        camMesh.parent = wrist;

        camMesh.position.set(sensorOffsets[i][0], sensorOffsets[i][1] + wristLen, sensorOffsets[i][2]);
        sensorLights.push(camMesh);
    }

    // Idle: saved home pose if present, otherwise hover directly over its own platform.
    const idleTarget = configTargetToVector(item.config?.cobotHomeTarget) ?? defaultCobotIdleTarget(item);

    // Compute world positions of the stack slots (apply root rotation)
    const maxStack = item.config?.stackMax || 10;

    const stackSlots: StackSlot[] = stackLocalPos
        .filter(slot => !(slot.col === mountCol && slot.row === mountRow))
        .map((slot, index) => {
            const lp = slot.pos;
            const wx = item.position[0] + lp.x * Math.cos(baseRotY) + lp.z * Math.sin(baseRotY);
            const wy = item.position[1] + lp.y;
            const wz = item.position[2] - lp.x * Math.sin(baseRotY) + lp.z * Math.cos(baseRotY);
            return {
                worldPos: new Vector3(wx, wy, wz),
                maxStack,
                color: STACK_SLOT_COLORS[index % STACK_SLOT_COLORS.length],
                col: slot.col,
                row: slot.row,
            };
        });

    const state: CobotState = {
        root, mountBase, basePivot, shoulder, elbow, wrist, wristRoll, handPitch,
        leftFinger, rightFinger, gripperTip, statusDisplay, statusDisplayMat,
        proximityMats, collisionSphere, proximityMult: 1.0, sensorLights,
        ikTarget: idleTarget.clone(),
        lastSafeIkTarget: idleTarget.clone(),
        ikVelocity: Vector3.Zero(),
        desiredTarget: idleTarget.clone(),
        wristRollTarget: 0, currentWristRoll: 0,
        gripperOpen: true, currentGripperPos: 0,
        blockedTimer: 0,
        motionStallTimer: 0,
        partContactTimer: 0,
        lastProbePos: idleTarget.clone(),
        simTime: 0,
        targetTimer: 0,
        skippedTargetIds: {},
        safetyStopped: false,
        recoveryTimer: 0,
        overdriveScore: 0,
        avoidanceSide: 0,
        avoidanceBias: Vector3.Zero(),
        retreatTarget: null,
        retreatTimer: 0,
        recoveryAttempts: 0,
        plannedPath: [idleTarget.clone()],
        plannedPathCursor: 0,
        plannedPathGoal: idleTarget.clone(),
        plannedPathPhase: 'idle',
        pathReplanCooldown: 0,
        precalculatedPath: [idleTarget.clone()],
        lockedFlowGoal: idleTarget.clone(),
        lockedFlowPhase: 'idle',
        lockedPickupTarget: null,
        lockedPickupItemId: null,
        lockedPickupUntil: 0,
        yieldTarget: null,
        yieldUntil: 0,
        avoidDropTarget: null,
        avoidDropUntil: 0,
        dropExitTarget: null,
        dropReplanStreak: 0,
        lastReplanTargetKey: '',
        phase: 'idle', stepIndex: 0,
        targetedItem: null, grabbedItem: null, waitTimer: 0,
        autoDropTarget: null,
        activeDropTarget: null,
        position: item.position, baseRotY,
        program: item.config?.program || [],
        speed: item.config?.speed || 1.0,
        selfItem: item,
        cameras: [], obstacles: [],
        pickColors: item.config?.pickColors || [],
        pickSizes: item.config?.pickSizes || [],
        linkedCameraIds: item.config?.linkedCameraIds || [],
        autoOrganize: item.config?.autoOrganize === true,
        idleTarget,
        manualControl: item.config?.cobotManualControl === true,
        manualTarget: configTargetToVector(item.config?.cobotManualTarget),
        stackSlots, mountCollisionRadius, isFull: false,
        sensorLights,
        tuningMode: false,
        sensorHazards: [0, 0, 0, 0],
        sensorMinDist: 2,
        safetySpeedFactor: 1,
        reducedSpeedActive: false,
        lastLoggedPhase: 'idle',
        lastStatusReasonKey: '',
        lastStatusReasonAt: -9999,
        tuningHighlightTargets: {
            shoulder: [link1],
            elbow: [link2],
            wrist: [link3],
            shoulder_joint: [j0],
            elbow_joint: [j1],
            wrist_joint: [j2],
            pedestal: [pedestal],
            base: [baseRing],
        },
        lastTuningHighlightKey: undefined,
    };
    return { node: root, state };
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

    state.avoidanceBias.scaleInPlace(Math.max(0, 1 - delta * AVOIDANCE_BIAS_DECAY));
    if (state.avoidanceBias.lengthSquared() < 0.0001) {
        state.avoidanceBias.setAll(0);
    }

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
        state.desiredTarget.copyFrom(state.manualTarget!);
        state.plannedPath = [state.ikTarget.clone(), state.manualTarget!.clone()];
        state.plannedPathCursor = 1;
        state.safetySpeedFactor = 1;
    } else if (tuningMode) {
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
        const pickPhaseActive =
            state.phase === 'pick_hover' ||
            state.phase === 'pick_descend' ||
            state.phase === 'pick_attach';
        const step = state.program[state.stepIndex % state.program.length];
        const stepPos = step.pos ? new Vector3(step.pos[0], step.pos[1], step.pos[2]) : state.idleTarget;
        
        const isMoveAction = step.action === 'move';
        const precisePhase = state.phase === 'pick_descend' || state.phase === 'descend_drop' || (isMoveAction && state.phase === 'idle');
        
        let reachRadius = 0.18;
        if (state.phase === 'pick_descend' || state.phase === 'descend_drop') reachRadius = 0.08;
        else if (state.phase === 'lift' || state.phase === 'transit_drop') reachRadius = 0.45;
        else if (state.phase === 'hover_drop' || state.phase === 'idle') reachRadius = 0.12;
        if (isMoveAction && state.phase === 'idle') reachRadius = 0.015; // 1.5cm precision for user points

        const distanceToTarget = Vector3.Distance(state.ikTarget, state.desiredTarget);
        const toTarget = state.desiredTarget.subtract(state.ikTarget);
        
        // Stuck/Stalled Detection: if we're trying to reach a target but ikTarget hasn't moved 
        // significantly towards desiredTarget for a while, we consider it 'reached' so the program can proceed.
        const isStalled = distanceToTarget > reachRadius && state.ikVelocity.length() < 0.005 && isRunning;
        if (isStalled) {
            state.targetTimer += delta;
        } else {
            state.targetTimer = Math.max(0, state.targetTimer - delta * 2.5);
        }

        const forceReached = state.targetTimer > 5.0; // Give it 5s to reach or fail
        const idleReached = distanceToTarget < reachRadius || forceReached;
        const reached = idleReached; // Alias for other phases

        if (forceReached) {
            state.targetTimer = 0;
            console.warn(`Cobot ${state.selfItem?.id} stalled on unreachable target, skipping...`);
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
                if (step.action === 'move') {
                    state.desiredTarget.copyFrom(stepPos);
                } else {
                    state.desiredTarget.set(stepPos.x, state.position[1] + 2.15, stepPos.z);
                }
                if (state.yieldTarget && state.simTime < state.yieldUntil) {
                    state.desiredTarget.copyFrom(state.yieldTarget);
                    break;
                }
                state.gripperOpen = true;
                if (!state.grabbedItem) {
                    const cooperativeYield = computeYieldTargetFromSensors(state, mountPos);
                    if (cooperativeYield) {
                        state.yieldTarget = cooperativeYield;
                        state.yieldUntil = state.simTime + Math.max(0.9, COBOT_YIELD_HOLD_SEC * 0.7);
                        state.desiredTarget.copyFrom(cooperativeYield);
                        break;
                    }
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
                if (idleReached) {
                    if (step.action === 'move') {
                        state.phase = 'next';
                        state.waitTimer = 0;
                    } else if (step.action === 'wait') {
                        state.phase = 'wait_step';
                        state.waitTimer = 0;
                    } else if (step.action === 'pick') {
                        if (!hasDrop && allFull) break;
                        const partFilterOk = (candidate: typeof simState.items[0]) =>
                            (state.pickColors.length === 0 || state.pickColors.includes(candidate.color)) &&
                            (state.pickSizes.length === 0 || state.pickSizes.includes(candidate.size));
                        const canReachPickup = (candidate: typeof simState.items[0]) => {
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
                        };
                        let candidates = simState.items
                            .filter(i =>
                                i.state === 'free' &&
                                Vector3.Distance(i.pos, stepPos) < 1.85 &&
                                partFilterOk(i) &&
                                canReachPickup(i) &&
                                (hasDrop || getAutoSlot(partHint(i)) !== null) &&
                                (state.skippedTargetIds[i.id] ?? 0) <= state.simTime
                            )
                            .map(i => {
                                const predicted = pickupAimPoint(state, i);
                                const stepDist = Vector3.Distance(predicted, stepPos);
                                const crowdPenalty = nearbyPickupPenalty(i);
                                const driveTile = driveTileAt(i.pos.x, i.pos.z, state.obstacles);
                                const movingPenalty = driveTile ? ((driveTile.config?.speed || 2) * 0.08) : 0;
                                const detection = bestDetectionForItem(state, i);
                                const visionPenalty = hasPickFilter && detection ? (1 - (detection?.confidence ?? 0)) * 0.4 : 0;
                                const edgePenalty = detection ? detection.planarOffset * 0.08 : 0;
                                return { item: i, score: stepDist + crowdPenalty + movingPenalty + visionPenalty + edgePenalty };
                            })
                            .sort((a, b) => a.score - b.score);
                        const it = candidates[0]?.item;
                        if (it) {
                            it.state = 'targeted';
                            state.targetedItem = it;
                            state.targetTimer = 0;
                            state.blockedTimer = 0;
                            state.lockedPickupTarget = null;
                            state.lockedPickupItemId = null;
                            state.lockedPickupUntil = 0;
                            const initialOnDrive = !!driveTileAt(it.pos.x, it.pos.z, state.obstacles);
                            if (initialOnDrive) {
                                state.lockedPickupTarget = pickupAimPoint(state, it).clone();
                                state.lockedPickupItemId = it.id;
                                state.lockedPickupUntil = state.simTime + 1.15;
                            }
                            state.phase = 'pick_hover';
                            logCobotEvent(state, 'target_acquired', `item=${it.id} color=${it.color} size=${it.size}`);
                        } else {
                            let foundValidPick = false;
                            for (let offset = 1; offset < state.program.length; offset++) {
                                const nextIdx = (state.stepIndex + offset) % state.program.length;
                                const nextStep = state.program[nextIdx];
                                if (nextStep.action === 'pick' && nextStep.pos) {
                                    const nPos = new Vector3(nextStep.pos[0], nextStep.pos[1], nextStep.pos[2]);
                                    const hasPart = simState.items.some(i =>
                                        i.state === 'free' &&
                                        Vector3.Distance(i.pos, nPos) < 1.85 &&
                                        partFilterOk(i) &&
                                        canReachPickup(i) &&
                                        (hasDrop || getAutoSlot(partHint(i)) !== null) &&
                                        (state.skippedTargetIds[i.id] ?? 0) <= state.simTime
                                    );
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
                            const hasOtherStepTypes = state.program.some((s, i) => i !== state.stepIndex && s.action !== 'pick');
                            if (hasOtherStepTypes) {
                                state.phase = 'next';
                                state.waitTimer = 0;
                                state.targetTimer = 0;
                                break;
                            }
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
                    const catchRadius = clamp(partR * (targetOnDriveNow ? 2.9 : 2.2), PICK_ANCHOR_MIN_OFFSET, PICK_ANCHOR_MAX_OFFSET);
                    let target = targetOnDriveNow
                        ? rawTarget.clone()
                        : clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius);
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
                    if (targetOnDriveNow && planar < PICK_TARGET_LOCK_ENTER_RADIUS) {
                        state.lockedPickupTarget = target.clone();
                        state.lockedPickupItemId = state.targetedItem.id;
                        state.lockedPickupUntil = state.simTime + Math.max(PICK_TARGET_LOCK_DURATION, 1.1);
                    }
                    const alignmentBuffer = targetOnDriveNow ? 0.12 : 0.06;
                    const alignTolerance = targetOnDriveNow ? 0.46 : 0.4;
                    const movingYTolerance = targetOnDriveNow ? 0.62 : 0.28;
                    const itemAlignTolerance = targetOnDriveNow ? Math.max(0.62, partR * 2.1) : Math.max(0.52, partR * 1.85);
                    const fastTrackDescend =
                        targetOnDriveNow &&
                        state.targetTimer > 0.34 &&
                        planar < Math.max(0.46, partR * 1.12) &&
                        itemPlanar < itemAlignTolerance;
                    const abortForReach = isUnreachable && (!targetOnDriveNow || state.targetTimer > 0.85);
                    if (
                        (
                            planar < Math.max(alignTolerance, Math.max(PICK_ALIGN_RADIUS, partR * 1.2) + alignmentBuffer) &&
                            Math.abs(tip.y - hoverY) < movingYTolerance &&
                            itemPlanar < itemAlignTolerance
                        ) ||
                        fastTrackDescend
                    ) {
                        state.lockedPickupTarget = target.clone();
                        state.lockedPickupItemId = state.targetedItem.id;
                        state.lockedPickupUntil = state.simTime + 2.5;
                        if (fastTrackDescend) {
                            logCobotEvent(state, 'pick_hover_fasttrack', `item=${state.targetedItem.id} planar=${planar.toFixed(2)} t=${state.targetTimer.toFixed(2)}s`);
                        }
                        state.phase = 'pick_descend';
                        state.waitTimer = 0;
                        state.targetTimer = 0;
                        state.blockedTimer = 0;
                    } else if (state.targetTimer > pickTimeout || abortForReach) {
                        const timeoutCommitRadius = targetOnDriveNow
                            ? Math.max(0.66, partR * 1.65)
                            : Math.max(0.52, partR * 1.35);
                        if (!abortForReach && planar < timeoutCommitRadius) {
                            const hoverTime = state.targetTimer;
                            state.lockedPickupTarget = target.clone();
                            state.lockedPickupItemId = state.targetedItem.id;
                            state.lockedPickupUntil = state.simTime + 1.35;
                            state.phase = 'pick_descend';
                            state.waitTimer = 0;
                            state.targetTimer = 0;
                            state.blockedTimer = 0;
                            logCobotEvent(state, 'pick_hover_timeout_commit', `item=${state.targetedItem.id} planar=${planar.toFixed(2)} t=${hoverTime.toFixed(2)}s`);
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
                if (state.targetedItem?.state === 'targeted') {
                    const pickAnchor = currentPickAnchor(state) ?? stepPos;
                    const partR = partRadiusForSpec(state.targetedItem);
                    targetOnDriveNow = !!driveTileAt(state.targetedItem.pos.x, state.targetedItem.pos.z, state.obstacles);

                    let target: Vector3;
                    if (state.lockedPickupTarget && state.lockedPickupItemId === state.targetedItem.id) {
                        target = state.lockedPickupTarget.clone();
                    } else {
                        const rawTarget = pickupAimPoint(state, state.targetedItem, PICK_LEAD_TIME);
                        const catchRadius = clamp(partR * (targetOnDriveNow ? 3.1 : 2.35), PICK_ANCHOR_MIN_OFFSET, PICK_ANCHOR_MAX_OFFSET);
                        target = clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius);
                        state.lockedPickupTarget = target.clone();
                        state.lockedPickupItemId = state.targetedItem.id;
                    }

                    const supportTop = supportTopAt(target.x, target.z, state.obstacles);
                    const targetTop = target.y + partHalfHeight(state.targetedItem);
                    const pickY = Math.max(targetTop + PICK_CONTACT_PAD_GAP, supportTop + PICK_SURFACE_CONTACT_GAP);
                    state.desiredTarget.set(target.x, pickY, target.z);

                    const reachDist = Math.sqrt(
                        (target.x - mountPos.x) * (target.x - mountPos.x) +
                        (target.z - mountPos.z) * (target.z - mountPos.z) +
                        (pickY + L3 - mountPos.y) * (pickY + L3 - mountPos.y)
                    );
                    const reachSlack = targetOnDriveNow ? 0.24 : 0.12;
                    isUnreachable = reachDist > (L1 + L2 + reachSlack);
                }
                const contact = pickupContactState(state, state.targetedItem);
                const abortForReach = isUnreachable && (!targetOnDriveNow || state.waitTimer > 0.5);
                if ((contact.touchingPart || contact.touchingSurface) && state.targetedItem?.state === 'targeted') {
                    const latch = canLatchByProximity(
                        state.targetedItem,
                        targetOnDriveNow ? 0.34 : 0.18,
                        targetOnDriveNow ? 0.28 : 0.14
                    );
                    if (latch.ok && latch.gripPose) {
                        logCobotEvent(
                            state,
                            'pick_grabbed',
                            `item=${state.targetedItem.id} mode=descend_contact snap=${latch.snapDist.toFixed(3)} planar=${latch.planarDist.toFixed(3)} v=${latch.verticalDist.toFixed(3)}`
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
                            `mode=descend_contact snap=${latch.snapDist.toFixed(3)} planar=${latch.planarDist.toFixed(3)} v=${latch.verticalDist.toFixed(3)}`
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
                        } else if (latch.planarDist > (targetOnDriveNow ? 0.52 : 0.34)) {
                            state.phase = 'pick_hover';
                            state.waitTimer = 0;
                            state.lockedPickupTarget = null;
                            state.lockedPickupItemId = null;
                            state.lockedPickupUntil = 0;
                        }
                    }
                } else if (
                    state.waitTimer > 0.08 &&
                    state.targetedItem?.state === 'targeted' &&
                    contact.horizontalDist < Math.max(PICK_GRAB_RADIUS * 1.55, contact.targetRadius * 1.12) &&
                    contact.padGap > -0.03 &&
                    contact.padGap < 0.24
                ) {
                    const latch = canLatchByProximity(
                        state.targetedItem,
                        targetOnDriveNow ? 0.46 : 0.24,
                        targetOnDriveNow ? 0.3 : 0.18
                    );
                    if (latch.ok && latch.gripPose) {
                        logCobotEvent(
                            state,
                            'pick_grabbed',
                            `item=${state.targetedItem.id} mode=descend_fallback snap=${latch.snapDist.toFixed(3)} planar=${latch.planarDist.toFixed(3)} v=${latch.verticalDist.toFixed(3)}`
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
                            `mode=descend_fallback snap=${latch.snapDist.toFixed(3)} planar=${latch.planarDist.toFixed(3)} v=${latch.verticalDist.toFixed(3)}`
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
                        } else if (latch.planarDist > (targetOnDriveNow ? 0.55 : 0.38)) {
                            state.phase = 'pick_hover';
                            state.waitTimer = 0;
                            state.lockedPickupTarget = null;
                            state.lockedPickupItemId = null;
                            state.lockedPickupUntil = 0;
                        }
                    }
                } else if (state.waitTimer > 2.1 || state.targetTimer > pickTimeout || abortForReach) {
                    const finalLatch = canLatchByProximity(
                        state.targetedItem,
                        targetOnDriveNow ? 0.58 : 0.34,
                        targetOnDriveNow ? 0.34 : 0.24
                    );
                    if (!abortForReach && finalLatch.ok && finalLatch.gripPose && state.targetedItem?.state === 'targeted') {
                        logCobotEvent(
                            state,
                            'pick_grabbed',
                            `item=${state.targetedItem.id} mode=descend_final snap=${finalLatch.snapDist.toFixed(3)} planar=${finalLatch.planarDist.toFixed(3)} v=${finalLatch.verticalDist.toFixed(3)}`
                        );
                        state.targetedItem.pos.set(finalLatch.gripPose.x, finalLatch.gripPose.y - partHalfHeight(state.targetedItem) - 0.001, finalLatch.gripPose.z);
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
                    const catchRadius = clamp(partR * (targetOnDriveNow ? 2.8 : 2.2), PICK_ANCHOR_MIN_OFFSET, PICK_ANCHOR_MAX_OFFSET);
                    let target = targetOnDriveNow
                        ? rawTarget.clone()
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
                    const pickY = Math.max(targetTop + PICK_CONTACT_PAD_GAP * 0.8, supportTop + PICK_SURFACE_CONTACT_GAP * 0.9);
                    state.desiredTarget.set(target.x, pickY, target.z);
                    if (targetOnDriveNow) {
                        state.lockedPickupTarget = target.clone();
                        state.lockedPickupItemId = state.targetedItem.id;
                        state.lockedPickupUntil = state.simTime + 1.05;
                    }
                    const reachDist = Math.sqrt(
                        (target.x - mountPos.x) * (target.x - mountPos.x) +
                        (target.z - mountPos.z) * (target.z - mountPos.z) +
                        (pickY + L3 - mountPos.y) * (pickY + L3 - mountPos.y)
                    );
                    const reachSlack = targetOnDriveNow ? 0.24 : 0.12;
                    isUnreachable = reachDist > (L1 + L2 + reachSlack);
                }
                const attachContact = pickupContactState(state, state.targetedItem);
                const abortForReach = isUnreachable && !targetOnDriveNow;
                const alignReady =
                    attachContact.horizontalDist < Math.max(PICK_ATTACH_ALIGN_RADIUS, attachContact.targetRadius * 0.72) &&
                    attachContact.padGap >= -0.012 &&
                    attachContact.padGap <= PICK_CONTACT_PAD_GAP + 0.08;
                if (state.waitTimer > 0.04 && state.targetedItem?.state === 'targeted' && alignReady) {
                    const latch = canLatchByProximity(
                        state.targetedItem,
                        targetOnDriveNow ? 0.36 : 0.18,
                        targetOnDriveNow ? 0.27 : 0.14
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
                state.desiredTarget.set(pickAnchor.x, hoverY, pickAnchor.z);
                if (reached || state.waitTimer > 0.8) {
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
                state.desiredTarget.set(state.ikTarget.x, travelY, state.ikTarget.z);
                if (reached) {
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
                const tgt = currentDropTarget(state);
                if (!tgt) {
                    state.activeDropTarget = null;
                    state.phase = state.grabbedItem ? 'idle' : 'next';
                    break;
                }
                const travelY = carryTravelY(state, tgt);
                state.desiredTarget.set(tgt.x, travelY, tgt.z);
                if (reached) {
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
                const dropTop = stackCenterYAt(tgt.x, tgt.z, dropBaseCenterY(state, tgt, state.grabbedItem), state.grabbedItem, state.grabbedItem, STACK_R);
                const targetClearance = stackAwareClearanceAt(state, tgt.x, tgt.z, true);
                const safeHoverY = quantizeHeight(
                    Math.max(
                        dropTop + DROP_HOVER_CLEARANCE + (selfDrop ? 0.16 : 0),
                        targetClearance + (selfDrop ? 0.2 : -0.1),
                        state.position[1] + (selfDrop ? 1.32 : 1.16)
                    ),
                    0.03
                );
                state.desiredTarget.set(tgt.x, safeHoverY, tgt.z);
                if (reached) {
                    state.phase = 'descend_drop';
                    state.waitTimer = 0;
                }
                break;
            }
            case 'descend_drop': {
                state.waitTimer += delta;
                const tgt = currentDropTarget(state);
                if (!tgt) {
                    state.activeDropTarget = null;
                    state.phase = state.grabbedItem ? 'idle' : 'next';
                    break;
                }
                const dropTop = stackCenterYAt(tgt.x, tgt.z, dropBaseCenterY(state, tgt, state.grabbedItem), state.grabbedItem, state.grabbedItem, STACK_R);
                const supportTop = supportTopAt(tgt.x, tgt.z, dropObstacles(state));
                const stackRise = Math.max(0, dropTop - supportTop);
                const adaptivePad = 0.08 + clamp(stackRise * 0.14, 0, 0.12);
                const safeDropY = quantizeHeight(Math.max(dropTop + adaptivePad, wallTopAt(tgt.x, tgt.z, dropObstacles(state)) + 0.04), 0.02);
                state.desiredTarget.set(tgt.x, safeDropY, tgt.z);
                if (reached || state.waitTimer > 1.05) { state.phase = 'release'; state.waitTimer = 0; }
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
                state.desiredTarget.set(placement.target.x, releaseApproachY, placement.target.z);
                state.gripperTip.computeWorldMatrix(true);
                const tipNow = state.gripperTip.getAbsolutePosition();
                const tipPlanar = Math.sqrt((tipNow.x - placement.target.x) ** 2 + (tipNow.z - placement.target.z) ** 2);
                const tipCenterY = tipNow.y - partHalf - 0.001;
                const centerYError = Math.abs(tipCenterY - placement.landingY);
                const precisePlaceReady = !!part
                    && tipPlanar <= Math.max(placement.partR * 0.42, 0.075)
                    && centerYError <= 0.022;
                const relaxedPlaceReady = !!part
                    && tipPlanar <= Math.max(placement.partR * 0.7, 0.15)
                    && centerYError <= 0.05
                    && state.waitTimer > 0.14;
                if ((placement.touching || precisePlaceReady || relaxedPlaceReady) && state.waitTimer > 0.09) {
                    state.gripperOpen = true;
                    if (state.grabbedItem) {
                        if (state.isAutoProgram) state.lastDroppedItemId = state.grabbedItem.id;
                        state.grabbedItem.pos.y = Math.max(state.grabbedItem.pos.y, placement.landingY - 0.002);
                        state.grabbedItem.state = 'free';
                        captureDropExitTarget(state, placement.landingY + partHalf);
                        logCobotEvent(
                            state,
                            'drop_success',
                            `target=(${placement.target.x.toFixed(2)},${placement.target.z.toFixed(2)}) planar=${tipPlanar.toFixed(3)} yErr=${centerYError.toFixed(3)}`
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
                } else {
                    state.gripperOpen = false;
                    if (state.waitTimer > 2.4) {
                        if (part) {
                            if (tipPlanar <= Math.max(placement.partR * 0.92, 0.21) && centerYError <= 0.09) {
                                if (state.isAutoProgram) state.lastDroppedItemId = part.id;
                                part.pos.y = Math.max(part.pos.y, placement.landingY - 0.002);
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
                                    state.gripperTip.computeWorldMatrix(true);
                                    const tip = state.gripperTip.getAbsolutePosition();
                                    if (state.isAutoProgram) state.lastDroppedItemId = part.id;
                                    part.pos.set(
                                        tip.x,
                                        Math.max(placement.landingY, tip.y - partHalfHeight(part) - 0.01),
                                        tip.z
                                    );
                                    part.state = 'free';
                                    captureDropExitTarget(state, Math.max(placement.landingY, part.pos.y + partHalfHeight(part)));
                                    logCobotEvent(state, 'drop_fail_release_tip', `replan_limit=1 target=(${placement.target.x.toFixed(2)},${placement.target.z.toFixed(2)})`);
                                    state.dropReplanStreak = 0;
                                    state.lastReplanTargetKey = '';
                                    state.grabbedItem = null;
                                    state.autoDropTarget = null;
                                    state.activeDropTarget = null;
                                    state.phase = 'drop_recenter';
                                    state.waitTimer = 0;
                                    break;
                                }
                                const hasDropStep = state.program.some(s => s.action === 'drop');
                                if (!hasDropStep) {
                                    state.autoDropTarget = alt.clone();
                                }
                                state.activeDropTarget = alt.clone();
                                state.waitTimer = 0;
                                state.phase = 'hover_drop';
                                logCobotEvent(state, 'drop_replan', `alt_target=(${alt.x.toFixed(2)},${alt.z.toFixed(2)})`);
                            } else {
                                state.gripperTip.computeWorldMatrix(true);
                                const tip = state.gripperTip.getAbsolutePosition();
                                if (state.isAutoProgram) state.lastDroppedItemId = part.id;
                                part.pos.set(
                                    tip.x,
                                    Math.max(placement.landingY, tip.y - partHalfHeight(part) - 0.01),
                                    tip.z
                                );
                                part.state = 'free';
                                captureDropExitTarget(state, Math.max(placement.landingY, part.pos.y + partHalfHeight(part)));
                                logCobotEvent(state, 'drop_fail_release_tip', `target=(${placement.target.x.toFixed(2)},${placement.target.z.toFixed(2)})`);
                                state.dropReplanStreak = 0;
                                state.lastReplanTargetKey = '';
                                state.grabbedItem = null;
                                state.autoDropTarget = null;
                                state.activeDropTarget = null;
                                state.phase = 'drop_recenter';
                                state.waitTimer = 0;
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
                const exitTarget = state.dropExitTarget ?? currentDropAnchor(state);
                if (!exitTarget) {
                    state.phase = 'next';
                    state.waitTimer = 0;
                    break;
                }
                const selfAnchor = !!(state.selfItem && itemFootprintHit(state.selfItem, exitTarget.x, exitTarget.z, 0.08));
                const supportTop = supportTopAt(exitTarget.x, exitTarget.z, dropObstacles(state));
                const stackClear = stackAwareClearanceAt(state, exitTarget.x, exitTarget.z, !!state.grabbedItem);
                const hoverY = Math.max(
                    exitTarget.y,
                    supportTop + DROP_RECENTER_CLEARANCE + (selfAnchor ? 0.12 : 0),
                    stackClear + (selfAnchor ? 0.24 : 0.14),
                    state.position[1] + (selfAnchor ? 1.3 : 1.12)
                );
                state.desiredTarget.set(exitTarget.x, hoverY, exitTarget.z);
                if (reached || state.waitTimer > 0.9) {
                    state.dropExitTarget = null;
                    state.mountBase.computeWorldMatrix(true);
                    const mountNow = state.mountBase.getAbsolutePosition();
                    const yieldTarget = computeYieldTargetFromSensors(state, mountNow);
                    if (yieldTarget) {
                        state.yieldTarget = yieldTarget;
                        state.yieldUntil = state.simTime + COBOT_YIELD_HOLD_SEC;
                        logCobotEvent(state, 'yield_move', `target=(${yieldTarget.x.toFixed(2)},${yieldTarget.z.toFixed(2)})`);
                    } else {
                        state.yieldTarget = null;
                        state.yieldUntil = 0;
                    }
                    state.phase = 'next';
                    state.waitTimer = 0;
                }
                break;
            }
            case 'next':
                state.activeDropTarget = null;
                state.stepIndex++;
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
                if (!state.grabbedItem) {
                    const yieldTarget = computeYieldTargetFromSensors(state, mountPos);
                    if (yieldTarget) {
                        state.yieldTarget = yieldTarget;
                        state.yieldUntil = Math.max(state.yieldUntil, state.simTime + COBOT_YIELD_HOLD_SEC);
                    }
                }
                state.phase = 'idle';
                break;
        }
    } else {
        if (isRunning) logStatusReason('no_program', 'program_len=0');
        state.targetTimer += delta;
        if (state.autoOrganize && state.phase === 'idle' && state.targetTimer > 0.45) {
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

    const precisePhase = isFineAlignPhase(state.phase);
    state.desiredTarget.y = Math.max(state.desiredTarget.y, state.position[1] + 0.1);
    const maxReach = L1 + L2 + L3 - 0.08;
    const desiredDx = state.desiredTarget.x - mountPos.x;
    const desiredDz = state.desiredTarget.z - mountPos.z;
    const desiredPlanar = Math.sqrt(desiredDx * desiredDx + desiredDz * desiredDz);
    if (desiredPlanar > maxReach && desiredPlanar > 0.0001) {
        const inward = (maxReach - 0.035) / desiredPlanar;
        state.desiredTarget.x = mountPos.x + desiredDx * inward;
        state.desiredTarget.z = mountPos.z + desiredDz * inward;
    } else if (desiredPlanar < maxReach) {
        const maxVertical = Math.sqrt(Math.max(0.01, maxReach * maxReach - desiredPlanar * desiredPlanar));
        state.desiredTarget.y = Math.min(state.desiredTarget.y, mountPos.y + maxVertical - 0.04);
    }
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
    state.precalculatedPath = buildPrecalculatedToolpathPreview(state, mountPos, flowGoal, precisePhase);
    let commandedTarget = pathTarget.clone();
    if (precisePhase) {
        let blendRadius = 0.42;
        let blendStrength = 0.8;
        if (state.phase === 'pick_hover') { blendRadius = 1.3; blendStrength = 1.0; }
        else if (state.phase === 'pick_descend') { blendRadius = 0.95; blendStrength = 1.0; }
        else if (state.phase === 'pick_attach') { blendRadius = 0.62; blendStrength = 1.0; }
        else if (state.phase === 'hover_drop') {
            blendRadius = dropOnSelfSupportFlow ? 0.38 : 0.55;
            blendStrength = dropOnSelfSupportFlow ? 0.56 : 0.9;
        }
        else if (state.phase === 'descend_drop') {
            blendRadius = dropOnSelfSupportFlow ? 0.3 : 0.45;
            blendStrength = dropOnSelfSupportFlow ? 0.52 : 0.9;
        }
        else if (state.phase === 'release') {
            blendRadius = dropOnSelfSupportFlow ? 0.24 : 0.34;
            blendStrength = dropOnSelfSupportFlow ? 0.5 : 0.72;
        }
        const remaining = Vector3.Distance(pathTarget, flowGoal);
        if (remaining < blendRadius) {
            const microBlend = clamp(1 - (remaining / blendRadius), 0, 1);
            commandedTarget = Vector3.Lerp(pathTarget, rawGoal, microBlend * blendStrength);
        }
    }
    clampTargetAboveSupports(state, commandedTarget, state.phase, !!state.grabbedItem);
    state.desiredTarget.copyFrom(commandedTarget);
    const toTarget = state.desiredTarget.subtract(state.ikTarget);
    const distanceToTarget = toTarget.length();
    const planarTargetDelta = Math.hypot(toTarget.x, toTarget.z);
    const verticalTargetDelta = Math.abs(toTarget.y);
    const pureVerticalContactMotion =
        (state.phase === 'pick_descend' || state.phase === 'pick_attach' || state.phase === 'descend_drop' || state.phase === 'release') &&
        verticalTargetDelta > 0.015 &&
        planarTargetDelta < 0.14 &&
        verticalTargetDelta > planarTargetDelta * 1.2;
    const pickCommitPhase = state.phase === 'pick_descend' || state.phase === 'pick_attach';
    const pickCommitContact = pickCommitPhase ? pickupContactState(state, state.targetedItem) : null;
    const committedPickTouch = !!pickCommitContact && (pickCommitContact.touchingPart || pickCommitContact.touchingSurface);
    const relaxedContactMotion = committedPickTouch || pureVerticalContactMotion;

    state.wristRoll.computeWorldMatrix(true);
    const wristPos = state.wristRoll.getAbsolutePosition();
    if (state.selfItem) {
        simState.cobotWrists[state.selfItem.id] = wristPos.clone();
        simState.cobotArmSamples[state.selfItem.id] = collectArmSamples(state);
    }

    let grabbedRadius = 0.08;
    if (state.grabbedItem) grabbedRadius = partRadiusForSpec(state.grabbedItem);
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
    const sensorRange = 0.52;
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
        else if (item.type === 'cobot') { w = COBOT_BODY_W; d = COBOT_BODY_D; pad = 0.24 + handSafetyPad; h = COBOT_PLATFORM_TOP_Y; }

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
    for (const staleId of Object.keys(simState.cobotArmSamples)) {
        if (!currentItems.some(i => i.id === staleId)) {
            delete simState.cobotArmSamples[staleId];
            delete simState.cobotWrists[staleId];
        }
    }
    for (const [id, armPoints] of Object.entries(simState.cobotArmSamples)) {
        if (id === state.selfItem?.id || !armPoints?.length) continue;
        for (const p of armPoints) {
            const crossArmPad = nearOwnPedestal ? handSafetyPad : grabbedRadius;
            const distNow = Vector3.Distance(wristPos, p) - (0.2 + crossArmPad);
            const distSoon = Vector3.Distance(predictedWrist, p) - (0.24 + crossArmPad);
            const dist = Math.min(distNow, distSoon);
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
        state.avoidanceBias.setAll(0);
    }

    const colorForHazard = (hazard: number) => {
        if (hazard > 0.58) return Color3.FromHexString('#ef4444');
        if (hazard > 0.24) return Color3.FromHexString('#f59e0b');
        return Color3.FromHexString('#22c55e');
    };
    const sensorHazards = [hazardForward, hazardRight, hazardBackward, hazardLeft];
    for (let i = 0; i < state.proximityMats.length; i++) {
        const hz = sensorHazards[Math.min(i, sensorHazards.length - 1)] ?? 0;
        state.proximityMats[i].emissiveColor = colorForHazard(hz);
    }
    state.proximityMult = 1.0;

    const dropOnSelfSupport = isSelfPlatformDropPhase(state, activeDropTargetForFlow);
    const suppressCloseRepulsion = dropOnSelfSupport && (state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release');
    const descendRepulsionSuppressed =
        state.phase === 'pick_descend' &&
        !!pickCommitContact &&
        pickCommitContact.horizontalDist < Math.max(0.5, pickCommitContact.targetRadius * 1.35) &&
        pickCommitContact.padGap < 0.3;
    if (!relaxedContactMotion && !suppressCloseRepulsion && !descendRepulsionSuppressed && closestPoint && minDist < 0.22 && minDist > 0.001) {
        const avoidanceGain = precisePhase ? 0.45 : 1.0;
        const repulsion = wristPos.subtract(closestPoint);
        repulsion.y *= 2.0; // Favor pushing UP over pushing sideways
        repulsion.normalize();
        const strength = (0.22 - minDist) * 1.05 * avoidanceGain;
        state.desiredTarget.addInPlace(repulsion.scale(strength));
        state.avoidanceBias.addInPlace(repulsion.scale(strength * 1.25));
        state.avoidanceBias.x = clamp(state.avoidanceBias.x, -AVOIDANCE_MAX_BIAS, AVOIDANCE_MAX_BIAS);
        state.avoidanceBias.z = clamp(state.avoidanceBias.z, -AVOIDANCE_MAX_BIAS, AVOIDANCE_MAX_BIAS);
        state.desiredTarget.y = Math.max(state.desiredTarget.y, state.position[1] + 0.1);
    }
    if (state.recoveryTimer > 0) {
        state.recoveryTimer = Math.max(0, state.recoveryTimer - delta);
    }

    const cruiseSpeed = (state.recoveryTimer > 0 ? 0.8 : (precisePhase ? 2.8 : 5.8)) * state.speed;
    const settleRadius = precisePhase ? 0.2 : 0.5;
    const accel = (precisePhase ? 8.0 : 5.5) * state.speed;
    const damping = Math.min(1, (precisePhase ? 6.6 : 4.8) * delta);

    let desiredVelocity = Vector3.Zero();
    if (distanceToTarget > 0.0001) {
        const dir = toTarget.scale(1 / distanceToTarget);
        const ramp = distanceToTarget < settleRadius
            ? Math.max(0.12, distanceToTarget / settleRadius)
            : 1;
        desiredVelocity = dir.scale(cruiseSpeed * ramp);
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
        } else {
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
            const maxHazard = Math.max(hazardForward, hazardRight, hazardBackward, hazardLeft);
            const nearRisk = minDist < 0.34 ? clamp((0.34 - Math.max(0, minDist)) / 0.34, 0, 1) : 0;
            const lateralPreference = clamp(hazardLeft - hazardRight, -1, 1);
            if (!dropOnSelfSupport && Math.abs(lateralPreference) > 0.02) {
                const side = lateralPreference > 0 ? 1 : -1;
                state.avoidanceSide = side as -1 | 1;
                const strafe = sensorRight.scale(side * cruiseSpeed * (0.18 + 0.82 * Math.max(maxHazard, nearRisk)));
                desiredVelocity.addInPlace(strafe);
            } else if (!dropOnSelfSupport && state.avoidanceSide !== 0 && maxHazard > 0.08) {
                desiredVelocity.addInPlace(sensorRight.scale(state.avoidanceSide * cruiseSpeed * 0.2));
            }

            if (!dropOnSelfSupport && hazardForward > 0.62 && minDist < 0.26) {
                desiredVelocity.addInPlace(sensorForward.scale(-cruiseSpeed * hazardForward * 0.7));
            }

            if (state.avoidanceBias.lengthSquared() > 0.0001) {
                const biasGain = (precisePhase ? 0.55 : 1.05) * state.speed;
                desiredVelocity.addInPlace(state.avoidanceBias.scale(biasGain));
            }

            const reducedDistFactor = minDist < SAFETY_REDUCED_SPEED_DIST
                ? clamp(
                    (Math.max(minDist, SAFETY_HARD_STOP_DIST) - SAFETY_HARD_STOP_DIST) /
                    (SAFETY_REDUCED_SPEED_DIST - SAFETY_HARD_STOP_DIST),
                    SAFETY_MIN_SPEED_FACTOR,
                    1
                )
                : 1;
            const reducedHazardFactor = clamp(1 - maxHazard * (dropOnSelfSupport ? 0.42 : 0.58), SAFETY_MIN_SPEED_FACTOR, 1);
            const safetySlowdown = Math.min(reducedDistFactor, reducedHazardFactor);
            const avoidanceSlowdown = clamp(
                1 - Math.max(maxHazard * 0.72, nearRisk * 0.85),
                precisePhase ? 0.42 : 0.24,
                1
            );
            const slowdown = Math.min(avoidanceSlowdown, safetySlowdown);
            desiredVelocity.scaleInPlace(slowdown);
            state.safetySpeedFactor += (slowdown - state.safetySpeedFactor) * clamp(delta * 8.5, 0, 1);
            state.reducedSpeedActive = state.safetySpeedFactor < 0.97 && !state.safetyStopped;

            if (maxHazard < 0.08 && nearRisk < 0.08) state.avoidanceSide = 0;
        } else {
            state.safetySpeedFactor += (1 - state.safetySpeedFactor) * clamp(delta * 8.5, 0, 1);
            state.reducedSpeedActive = false;
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
    state.basePivot.rotation.y = worldYaw - state.baseRotY;

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
    if (tipGuard.y < guardMinY) {
        const lift = guardMinY - tipGuard.y;
        state.ikTarget.y += lift;
        state.desiredTarget.y = Math.max(state.desiredTarget.y, state.ikTarget.y);
        state.ikVelocity.y = Math.max(0, state.ikVelocity.y);
    }

    if (isRunning && collisionsOn) {
        const hit = armHitsObstacle(state, state.obstacles);
        if (hit) {
            applySoftAvoidance(state, hit);
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
                applySoftAvoidance(state, fakeObstacle);
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

    if (isRunning && collisionsOn) {
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
                        applySoftAvoidance(state, obstacle);
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
    } else if (isRunning) {
        state.blockedTimer = Math.max(0, state.blockedTimer - delta * 4);
        state.motionStallTimer = Math.max(0, state.motionStallTimer - delta * 4);
    }

    flushPhaseLog();
    return false;
}
