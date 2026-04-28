import {
    Scene, TransformNode, MeshBuilder, Vector3,
    PBRMaterial, Color3, Mesh, StandardMaterial
} from '@babylonjs/core';
import { simState, SimItem } from '../simState';
import { PartShape, PartSize, PlacedItem, ProgramStep } from '../types';
import { factoryStore } from '../store';

const DISC_H = 0.025;
const DISC_RADIUS = 0.28;
const DROP_CLEARANCE = 0.22;
const DROP_HOVER_CLEARANCE = 0.28;
const PICK_HOVER_CLEARANCE = 0.24;
const PICK_DESCEND_CLEARANCE = 0.03;
const PICK_ALIGN_RADIUS = 0.32;
const PICK_GRAB_RADIUS = 0.28;
const PICK_CONTACT_RADIUS = 0.34;
const PICK_ATTACH_ALIGN_RADIUS = 0.16;
const PICK_LEAD_TIME = 0.16;
const PICK_TARGET_TIMEOUT = 1.8;
const PICK_SKIP_COOLDOWN = 1.0;
const PICK_CONTACT_PAD_GAP = 0.115;
const PICK_SURFACE_CONTACT_GAP = 0.11;
const PICK_SUPPORT_CLEARANCE = 0.03;
const PICK_ANCHOR_MIN_OFFSET = 0.36;
const PICK_ANCHOR_MAX_OFFSET = 1.25;
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
const COBOT_PEDESTAL_HEIGHT = 0.52;
const COBOT_PEDESTAL_BOTTOM_RADIUS_MIN = 0.24;
const COBOT_PEDESTAL_BOTTOM_RADIUS_MAX = 0.32;
const COBOT_BASE_PIVOT_Y = COBOT_PEDESTAL_HEIGHT;
const COBOT_MOUNT_REACH_OFFSET = COBOT_BASE_PIVOT_Y + 0.05;
const IK_BASE_CLEARANCE_RADIUS = 0.44;
const IK_SHOULDER_MIN = -1.1;
const IK_SHOULDER_MAX = 1.4;
const IK_ELBOW_MIN = 0.22;
const IK_ELBOW_MAX = 2.45;
const IK_WRIST_MIN = -2.8;
const IK_WRIST_MAX = 2.8;
const OVERDRIVE_DECAY_PER_SEC = 0.65;
const OVERDRIVE_HIT_PENALTY = 0.75;
const OVERDRIVE_STALL_PENALTY = 0.95;
const AVOIDANCE_BIAS_DECAY = 2.3;
const AVOIDANCE_MAX_BIAS = 2.1;
const RETREAT_DURATION = 0.68;
const RETREAT_BACKOFF = 0.42;
const MAX_RECOVERY_ATTEMPTS = 3;
const STUCK_STALL_TIMEOUT = 1.35;
const PART_CONTACT_WARN_TIMEOUT = 0.24;
const PART_CONTACT_STOP_TIMEOUT = 1.05;

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
    if (phase === 'release' || phase === 'descend_drop') return 0.02;
    if (phase === 'hover_drop' || phase === 'pick_hover') return 0.06;
    return 0.05;
}

function clampTargetAboveSupports(state: CobotState, target: Vector3, phase: string, carrying: boolean): Vector3 {
    const obstacles = carrying ? dropObstacles(state) : (state.selfItem ? [...state.obstacles, state.selfItem] : state.obstacles);
    const supportTop = supportTopAt(target.x, target.z, obstacles);
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

function supportTopAt(x: number, z: number, obstacles: PlacedItem[]): number {
    let topY = 0;
    for (const obstacle of obstacles) {
        if (!itemFootprintHit(obstacle, x, z, DISC_RADIUS * 0.35)) continue;
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
    const distLead = clamp(planarDist * 0.1, 0, 0.38);
    const speedLead = clamp(beltSpeed * 0.1, 0, 0.32);
    const phaseLead = state.phase === 'pick_hover'
        ? 0.08
        : (state.phase === 'pick_descend' || state.phase === 'pick_attach')
            ? 0.14
            : 0;
    return clamp(baseLead + distLead + speedLead + phaseLead, 0.08, 0.72);
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
    const targetPos = pickupAimPoint(state, item, PICK_LEAD_TIME * 0.6);
    const supportTop = supportTopAt(targetPos.x, targetPos.z, state.obstacles);
    const targetHalf = partHalfHeight(item);
    const targetRadius = partRadiusForSpec(item);
    const targetTop = targetPos.y + targetHalf;
    const dx = tip.x - targetPos.x;
    const dz = tip.z - targetPos.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const padGap = tip.y - targetTop;
    const touchingPart = horizontalDist < Math.max(PICK_CONTACT_RADIUS, targetRadius * 0.92) && padGap >= -0.01 && padGap <= PICK_CONTACT_PAD_GAP + 0.02;
    const touchingSurface = horizontalDist < Math.max(PICK_GRAB_RADIUS, targetRadius * 0.78) && tip.y <= supportTop + PICK_SURFACE_CONTACT_GAP + 0.015;
    return {
        tip,
        targetPos,
        horizontalDist,
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
    const slotItems = slots.map(sl => itemsNearSlot(sl, stackRadius, ignored));
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

    // Fill empties first, then stack if all empty slots are exhausted.
    let bestIdx = pickBest(i => slotCounts[i] === 0 && slotMatchesSort(i));
    if (bestIdx < 0) bestIdx = pickBest(i => slotCounts[i] === 0);
    if (bestIdx < 0) bestIdx = pickBest(i => slotMatchesSort(i));
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
    const slotBlockedByPedestal = (idx: number) => {
        const slotPos = state.stackSlots[idx].worldPos;
        const dx = slotPos.x - mountPos.x;
        const dz = slotPos.z - mountPos.z;
        const keepOut = state.mountCollisionRadius + partRadiusForSpec(grabbedOrHint) * 0.72 + 0.02;
        return Math.sqrt(dx * dx + dz * dz) < keepOut;
    };

    const slotItems = state.stackSlots.map(slot => itemsNearSlot(slot.worldPos, stackRadius, ignored));
    const slotCounts = slotItems.map(items => items.length);

    const hasRoom = (idx: number) => slotCounts[idx] < state.stackSlots[idx].maxStack && !slotBlockedByPedestal(idx);
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
            return da - db;
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

    // Fill all available cells before building tall stacks.
    let bestIdx = pickBest(i => hasRoom(i) && slotCounts[i] === 0 && matchesSort(i));
    if (bestIdx < 0) bestIdx = pickBest(i => hasRoom(i) && slotCounts[i] === 0);
    if (bestIdx < 0) bestIdx = pickBest(i => hasRoom(i) && matchesSort(i));
    if (bestIdx < 0) bestIdx = pickBest(i => hasRoom(i));
    if (bestIdx < 0) return null;

    const slot = state.stackSlots[bestIdx];
    const stackTop = stackCenterYAt(slot.worldPos.x, slot.worldPos.z, dropBaseCenterY(state, slot.worldPos, grabbedOrHint), grabbedOrHint, ignored, stackRadius);
    return new Vector3(slot.worldPos.x, stackTop, slot.worldPos.z);
}

function computeDropTarget(state: CobotState): Vector3 | null {
    if (!state.grabbedItem) return null;
    if (state.autoDropTarget) return state.autoDropTarget.clone();
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

    if (state.selfItem && itemFootprintHit(state.selfItem, step.pos[0], step.pos[2], 0.02)) {
        return getSelfPlatformDropTarget(state, selfSort.sortColor, selfSort.sortSize, selfSort.sortShape);
    }

    if (container) {
        const orgTarget = getOrganizedDropTarget(state, container, sortColor, sortSize, sortShape);
        if (orgTarget) return orgTarget;
        // Cannot place into destination grid. Fallback to own platform slots.
        return getSelfPlatformDropTarget(state, selfSort.sortColor, selfSort.sortSize, selfSort.sortShape);
    }
    return new Vector3(step.pos[0], step.pos[1], step.pos[2]);
}

function currentDropTarget(state: CobotState): Vector3 | null {
    if (!state.grabbedItem) return null;
    if (!['transit_drop', 'hover_drop', 'descend_drop', 'release'].includes(state.phase)) return null;
    if (state.activeDropTarget) return state.activeDropTarget.clone();
    const computed = computeDropTarget(state);
    if (computed) state.activeDropTarget = computed.clone();
    return computed;
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
    return new Vector3(
        state.selfItem.position[0],
        state.selfItem.position[1] + COBOT_PLATFORM_TOP_Y,
        state.selfItem.position[2]
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
    const links: Array<[Vector3, Vector3, number]> = [
        [mount, shoulder, 0.18],
        [shoulder, elbow, 0.17],
        [elbow, wrist, 0.14],
        [wrist, roll, 0.12],
        [roll, tip, 0.11],
    ];
    const isAllowedPickContact = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
    const pickContact = isAllowedPickContact ? pickupContactState(state, state.targetedItem) : null;
    const isAllowedDropContact = state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release';
    const dropTarget = isAllowedDropContact ? currentDropTarget(state) : null;

    for (const obstacle of obstacles) {
        const isActivePickSupport = !!pickContact?.targetPos && itemFootprintHit(obstacle, pickContact.targetPos.x, pickContact.targetPos.z, 0.08);
        const isActiveDropSupport = !!dropTarget && itemFootprintHit(obstacle, dropTarget.x, dropTarget.z, 0.08);
        
        // If the arm is actively picking/dropping from this machine, allow all links to safely enter its bounds
        if (isActivePickSupport || isActiveDropSupport) continue;

        for (const [index, [a, b, radius]] of links.entries()) {
            if (segmentHitsMachine(a, b, obstacle, radius)) return obstacle;
        }
    }
    // Self-collision with own pedestal base
    if (state.selfItem) {
        state.mountBase.computeWorldMatrix(true);
        const mountCenter = state.mountBase.getAbsolutePosition();
        for (const [index, [a, b, radius]] of links.entries()) {
            if (index <= 1) continue; // Shoulder links originate from base
            const samples = 8;
            for (let i = 0; i <= samples; i++) {
                const p = Vector3.Lerp(a, b, i / samples);
                if (p.y > COBOT_PEDESTAL_HEIGHT + radius) continue;
                const dx = p.x - mountCenter.x;
                const dz = p.z - mountCenter.z;
                if (Math.sqrt(dx * dx + dz * dz) < state.mountCollisionRadius + radius) return state.selfItem;
            }
        }
    }

    // Hard-stop if this arm intersects another cobot arm sample cloud.
    const ownArmPoints = collectArmSamples(state);
    const armHitDistSq = 0.18 * 0.18;
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
    const baseKeepout = Math.max(IK_BASE_CLEARANCE_RADIUS + 0.14, state.mountCollisionRadius + 0.14);
    const isManipulation = precisePhase || !!state.grabbedItem;
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
    const navStart = pushPointOutsideBaseKeepout(navStartRaw, mountPos, baseKeepout + 0.04);
    const navGoal = pushPointOutsideBaseKeepout(navGoalRaw, mountPos, baseKeepout + 0.04);
    if (Vector3.Distance(navStart, navStartRaw) > 0.01) path.push(navStart.clone());
    const dSegBaseSq = pointSegmentDistSq2D(mountPos.x, mountPos.z, navStart.x, navStart.z, navGoal.x, navGoal.z);
    const crossesBase = dSegBaseSq < baseKeepout * baseKeepout;

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

        const bypassR = baseKeepout + (isManipulation ? 0.24 : 0.3);
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

function resolveFlowGoal(state: CobotState, rawGoal: Vector3): Vector3 {
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
    const preview: Vector3[] = [state.ikTarget.clone()];
    appendPathSegment(preview, planToolpath(state, state.ikTarget, flowGoal, mountPos, precisePhase));

    if (state.program.length === 0) return preview;

    let cursor = preview[preview.length - 1].clone();
    const stepsToPlan = Math.min(state.program.length, 16);
    for (let offset = 0; offset < stepsToPlan; offset++) {
        const idx = (state.stepIndex + offset) % state.program.length;
        const step = state.program[idx];
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
        appendPathSegment(preview, planToolpath(state, cursor, hoverTarget, mountPos, false));
        cursor = hoverTarget;

        if (manipulation) {
            const touchY = step.action === 'pick'
                ? pos.y + PICK_DESCEND_CLEARANCE
                : pos.y + DROP_CLEARANCE;
            const contactTarget = new Vector3(pos.x, touchY, pos.z);
            appendPathSegment(preview, planToolpath(state, cursor, contactTarget, mountPos, true));
            cursor = contactTarget;
            appendPathSegment(preview, planToolpath(state, cursor, hoverTarget, mountPos, true));
            cursor = hoverTarget;
        }
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
    stackSlots: StackSlot[];         // top-platform grid positions
    mountCollisionRadius: number;    // radial keep-out around pedestal center
    isFull: boolean;
    sensorLights: import("@babylonjs/core").Mesh[];
    lastDroppedItemId?: string;      // skip re-targeting this after auto-drop
    sensorHazards: [number, number, number, number];
    sensorMinDist: number;
}

export function createCobot(item: PlacedItem, scene: Scene, isGhost = false): { node: TransformNode; state?: CobotState } {
    const alpha = isGhost ? 0.35 : 1;
    const baseRotY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][item.rotation] ?? 0;

    // ── Materials ──────────────────────────────────────────────────────────
    const amrBody    = pbr(scene, '#1e2433', 0.1, 0.8, alpha);   // dark chassis
    const amrPanel   = pbr(scene, '#f1f3f5', 0.05, 0.5, alpha);  // white panel
    const amrAccentG = pbr(scene, '#22c55e', 0.1, 0.3, alpha);   // green LED strip
    const amrEdge    = pbr(scene, '#374151', 0.3, 0.6, alpha);   // edge trim
    const linkMat    = pbr(scene, '#cdd3d8', 0.65, 0.25, alpha);
    const jointMat   = pbr(scene, '#7b8794', 0.75, 0.2, alpha);
    const gripMat    = pbr(scene, '#2d3748', 0.4, 0.5, alpha);
    const wheelMat   = pbr(scene, '#0d0d14', 0.1, 0.9, alpha);

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
    const platMat  = pbr(scene, '#0d1117', 0.05, 0.95, alpha);
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
    const mountCell = Math.min(cellW, cellD);
    const pedestalRadius = Math.max(0.17, Math.min(0.26, mountCell * 0.32));
    const baseRingRadius = Math.max(0.21, Math.min(0.34, mountCell * 0.38));
    const pedestalBottomRadius = clamp(
        Math.max(baseRingRadius + 0.035, pedestalRadius + 0.075),
        COBOT_PEDESTAL_BOTTOM_RADIUS_MIN,
        COBOT_PEDESTAL_BOTTOM_RADIUS_MAX
    );
    const mountCollisionRadius = Math.max(baseRingRadius + 0.03, pedestalBottomRadius + 0.015);

    // ── ARM MOUNT — configurable slot within platform grid ──
    const mountBase = new TransformNode('mountBase', scene);
    mountBase.parent = root;
    mountBase.position = new Vector3(mountLocalX, COBOT_PLATFORM_TOP_Y, mountLocalZ);

    // Pedestal / turret base sized to one grid cell (1/9 of platform) and tapered
    const pedestal = MeshBuilder.CreateCylinder('pedestal', { 
        diameterBottom: pedestalBottomRadius * 2, 
        diameterTop: pedestalRadius * 2, 
        height: COBOT_PEDESTAL_HEIGHT, 
        tessellation: 32 
    }, scene);
    pedestal.position = new Vector3(0, COBOT_PEDESTAL_HEIGHT / 2, 0);
    pedestal.material = amrEdge;
    pedestal.parent = mountBase;

    const basePivot = new TransformNode('basePivot', scene);
    basePivot.parent = mountBase;
    basePivot.position.y = COBOT_BASE_PIVOT_Y;
    cyl('baseRing', baseRingRadius, 0.075, new Vector3(0, 0.01, 0), jointMat, scene, basePivot);

    // ── LINK 1 — upper arm (offset laterally to allow folding) ────────────
    const shoulder = new TransformNode('shoulder', scene);
    shoulder.parent = basePivot;
    shoulder.position.y = 0.04;
    const j0 = cyl('j0', 0.22, 0.44, new Vector3(0.18, 0, 0), jointMat, scene, shoulder);
    j0.rotation.z = Math.PI / 2;
    cyl('link1', 0.175, 1.76, new Vector3(0.32, 0.88, 0), linkMat, scene, shoulder);

    // ── LINK 2 — forearm (centered, bypassing link1) ──────────────────────
    const elbow = new TransformNode('elbow', scene);
    elbow.parent = shoulder;
    elbow.position.y = 1.80;
    const j1 = cyl('j1', 0.17, 0.44, new Vector3(0.16, 0, 0), jointMat, scene, elbow);
    j1.rotation.z = Math.PI / 2;
    cyl('link2', 0.13, 1.25, new Vector3(0, 0.625, 0), linkMat, scene, elbow);

    // ── LINK 3 — wrist tube ───────────────────────────────────────────────
    const wrist = new TransformNode('wrist', scene);
    wrist.parent = elbow;
    wrist.position.y = 1.30;
    const j2 = cyl('j2', 0.13, 0.30, Vector3.Zero(), jointMat, scene, wrist);
    j2.rotation.z = Math.PI / 2;
    cyl('link3', 0.1, 0.45, new Vector3(0, 0.225, 0), linkMat, scene, wrist);

    // ── WRIST ROLL ────────────────────────────────────────────────────────
    const wristRoll = new TransformNode('wristRoll', scene);
    wristRoll.parent = wrist;
    wristRoll.position.y = 0.45;
    cyl('j3', 0.11, 0.26, Vector3.Zero(), jointMat, scene, wristRoll);

    // ── HAND PITCH (Extra joint) ──────────────────────────────────────────
    cyl('handLink', 0.08, 0.05, new Vector3(0, 0.025, 0), linkMat, scene, wristRoll);

    const handPitch = new TransformNode('handPitch', scene);
    handPitch.parent = wristRoll;
    handPitch.position.y = 0.05;
    const j4 = cyl('j4', 0.09, 0.22, Vector3.Zero(), jointMat, scene, handPitch);
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

    const leftFinger  = suctionPad;
    const rightFinger = suctionPad;

    const gripperTip = new TransformNode('gripperTip', scene);
    gripperTip.parent = handPitch;
    gripperTip.position.y = 0.215;

    if (isGhost) return { node: root };

    const proximityMats: StandardMaterial[] = [];
    const mat = new StandardMaterial(`proxMat_${item.id}`, scene);
    mat.alpha = 0; // invisible logic sphere
    
    const collisionSphere = MeshBuilder.CreateSphere(`collision_${item.id}`, { diameter: 1.0, segments: 16 }, scene);
    collisionSphere.parent = wrist;
    collisionSphere.position.set(0, 0.55, 0); // centered higher on wrist since wrist is higher than wristRoll
    collisionSphere.material = mat;
    collisionSphere.isPickable = false;

    // Visual proximity sensors (4-way around wrist: front/right/back/left)
    const sensorLights: Mesh[] = [];
    const sensorOffsets: Array<[number, number, number]> = [
        [0, 0.1, 0.13],   // front
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
        
        // wristRoll is at y=0.45 relative to wrist. Add 0.45 so they stay at the same visual height as before.
        camMesh.position.set(sensorOffsets[i][0], sensorOffsets[i][1] + 0.45, sensorOffsets[i][2]);
        sensorLights.push(camMesh);
    }

    // Idle: hover directly over its own platform (tucked in)
    const idleTarget = new Vector3(
        item.position[0],
        item.position[1] + 2.2,
        item.position[2]
    );

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
        idleTarget, stackSlots, mountCollisionRadius, isFull: false,
        sensorHazards: [0, 0, 0, 0],
        sensorMinDist: 2
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
                if (Math.abs(dx) <= destW/2 + 0.1 && Math.abs(dz) <= destD/2 + 0.1) {
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
    const L1 = 1.80;
    const L2 = 1.30;
    const L3 = 0.715; // Exact distance from wrist to gripperTip (0.45 + 0.05 + 0.215)
    state.simTime += delta;
    state.overdriveScore = Math.max(0, state.overdriveScore - OVERDRIVE_DECAY_PER_SEC * delta);
    state.pathReplanCooldown = Math.max(0, state.pathReplanCooldown - delta);
    state.avoidanceBias.scaleInPlace(Math.max(0, 1 - delta * AVOIDANCE_BIAS_DECAY));
    if (state.avoidanceBias.lengthSquared() < 0.0001) {
        state.avoidanceBias.setAll(0);
    }

    state.mountBase.computeWorldMatrix(true);
    const mountPos = state.mountBase.getAbsolutePosition().clone();
    mountPos.y += COBOT_MOUNT_REACH_OFFSET; // top of pedestal + basePivot offset

    const isStopped = state.selfItem?.config?.isStopped;
    
    if (!isRunning) {
        if (state.selfItem?.id) {
            delete simState.cobotWrists[state.selfItem.id];
            delete simState.cobotArmSamples[state.selfItem.id];
        }
        itemMotionTracker.clear();
        state.desiredTarget.copyFrom(state.idleTarget);
        state.ikVelocity.setAll(0);
        state.wristRollTarget = 0;
        state.gripperOpen = true;
        state.blockedTimer = 0;
        state.partContactTimer = 0;
        state.lastProbePos.copyFrom(state.idleTarget);
        state.targetTimer = 0;
        if (state.grabbedItem) { state.grabbedItem.state = 'free'; state.grabbedItem = null; }
        if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
        state.targetedItem = null;
        state.phase = 'idle'; state.stepIndex = 0;
        state.safetyStopped = false;
        state.recoveryTimer = 0;
        state.overdriveScore = 0;
        state.retreatTarget = null;
        state.retreatTimer = 0;
        state.recoveryAttempts = 0;
        state.activeDropTarget = null;
        state.plannedPath = [state.idleTarget.clone()];
        state.plannedPathCursor = 0;
        state.plannedPathGoal.copyFrom(state.idleTarget);
        state.plannedPathPhase = 'idle';
        state.precalculatedPath = [state.idleTarget.clone()];
        state.lockedFlowGoal.copyFrom(state.idleTarget);
        state.lockedFlowPhase = 'idle';
        return false;
    } else if (state.safetyStopped || isStopped) {
        state.ikVelocity.setAll(0);
        if (state.targetedItem?.state === 'targeted') state.targetedItem.state = 'free';
        state.targetedItem = null;
        state.desiredTarget.copyFrom(state.ikTarget);
        state.partContactTimer = 0;
        state.precalculatedPath = [state.ikTarget.clone()];
        state.activeDropTarget = null;
        state.retreatTarget = null;
        state.retreatTimer = 0;
        state.lockedFlowGoal.copyFrom(state.ikTarget);
        state.lockedFlowPhase = state.phase;
        
        // Recover perfectly when the user moves the obstacle out of the way
        if (state.safetyStopped && !isStopped && !armHitsObstacle(state, state.obstacles) && !armHitsPart(state)) {
            state.safetyStopped = false;
            state.blockedTimer = 0;
            state.partContactTimer = 0;
            state.phase = 'idle';
            state.desiredTarget.copyFrom(state.idleTarget);
            state.overdriveScore = 0;
            state.plannedPath = [state.ikTarget.clone(), state.idleTarget.clone()];
            state.plannedPathCursor = 1;
            state.plannedPathGoal.copyFrom(state.idleTarget);
            state.plannedPathPhase = 'idle';
            state.precalculatedPath = state.plannedPath.map(p => p.clone());
            state.activeDropTarget = null;
            state.recoveryAttempts = 0;
            state.lockedFlowGoal.copyFrom(state.idleTarget);
            state.lockedFlowPhase = 'idle';
        }
        return !!state.safetyStopped;
    } else if (!state.autoOrganize && state.isAutoProgram) {
        // Idle organize was turned off by user: abort generated work immediately.
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
        return false;
    } else if (state.program.length > 0) {
        const distToTarget = Vector3.Distance(state.ikTarget, state.desiredTarget);
        let reachRadius = 0.05;
        if (state.phase === 'lift' || state.phase === 'transit_drop') reachRadius = 0.4;
        else if (state.phase === 'hover_drop' || state.phase === 'idle') reachRadius = 0.15;
        const reached = distToTarget < reachRadius;
        const step = state.program[state.stepIndex % state.program.length];
        const stepPos = step.pos ? new Vector3(step.pos[0], step.pos[1], step.pos[2]) : state.ikTarget.clone();

        // Count items on each stack slot (live scan)
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
        const needsVision = state.pickColors.length > 0 || state.pickSizes.length > 0;

        const getAutoSlot = (part: { color: string } & PartLike): Vector3 | null => {
            return resolveAutoDropTarget(state, part);
        };
        switch (state.phase) {
            case 'idle':
                state.desiredTarget.set(stepPos.x, state.position[1] + 2.15, stepPos.z);
                state.gripperOpen = true;
                if (reached) {
                    if (step.action === 'move') {
                        state.stepIndex++;
                    } else if (step.action === 'wait') {
                        state.phase = 'wait_step';
                        state.waitTimer = 0;
                    } else if (step.action === 'pick') {
                        if (!hasDrop && allFull) break;
                        // Camera vision gate: item must be within 1.6m of a camera (if any placed)
                        const linkedCameras = state.linkedCameraIds.length > 0
                            ? state.cameras.filter(cam => state.linkedCameraIds.includes(cam.id))
                            : state.cameras;
                        const camOk = (candidate: typeof simState.items[0]) =>
                            !needsVision ? true :
                            linkedCameras.length === 0 ? false :
                            !!bestDetectionForItem(state, candidate);
                        const candidates = simState.items
                            .filter(i =>
                                i.state === 'free' &&
                                Vector3.Distance(i.pos, stepPos) < 1.85 &&
                                camOk(i) &&
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
                                const visionPenalty = needsVision ? (1 - (detection?.confidence ?? 0)) * 0.7 : 0;
                                const edgePenalty = detection ? detection.planarOffset * 0.08 : 0;
                                return { item: i, score: stepDist + crowdPenalty + movingPenalty + visionPenalty + edgePenalty };
                            })
                            .sort((a, b) => a.score - b.score);
                        const it = candidates[0]?.item;
                        if (it) {
                            it.state = 'targeted';
                            state.targetedItem = it;
                            state.targetTimer = 0;
                            state.phase = 'pick_hover';
                        } else {
                            // Smart polling lookahead: check if ANY other pick step has candidates
                            let foundValidPick = false;
                            for (let offset = 1; offset < state.program.length; offset++) {
                                const nextIdx = (state.stepIndex + offset) % state.program.length;
                                const nextStep = state.program[nextIdx];
                                if (nextStep.action === 'pick' && nextStep.pos) {
                                    const nPos = new Vector3(nextStep.pos[0], nextStep.pos[1], nextStep.pos[2]);
                                    const hasPart = simState.items.some(i => 
                                        i.state === 'free' && 
                                        Vector3.Distance(i.pos, nPos) < 1.85 &&
                                        camOk(i) &&
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
                                break; // Will evaluate the new step on next frame
                            } else {
                                break; // Wait at current station
                            }
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
                const tx = state.targetedItem?.pos.x ?? 0;
                const tz = state.targetedItem?.pos.z ?? 0;
                const ty = state.targetedItem?.pos.y ?? 0;
                const rdx = tx - mountPos.x;
                const rdz = tz - mountPos.z;
                const rdy = ty + 0.28 + L3 - mountPos.y; // approximate hover wrist height
                const isUnreachable = state.targetedItem && Math.sqrt(rdx*rdx + rdz*rdz + rdy*rdy) > (L1 + L2 - 0.02);
                if (state.targetedItem?.state === 'targeted') {
                    state.targetTimer += delta;
                    const pickTimeout = currentPickTimeout(state);
                    const targetOnDrive = !!driveTileAt(state.targetedItem.pos.x, state.targetedItem.pos.z, state.obstacles);
                    const pickAnchor = currentPickAnchor(state) ?? stepPos;
                    const rawTarget = pickupAimPoint(state, state.targetedItem);
                    const partR = partRadiusForSpec(state.targetedItem);
                    const targetOnDriveNow = !!driveTileAt(state.targetedItem.pos.x, state.targetedItem.pos.z, state.obstacles);
                    const catchRadius = clamp(partR * (targetOnDriveNow ? 2.9 : 2.2), PICK_ANCHOR_MIN_OFFSET, PICK_ANCHOR_MAX_OFFSET);
                    let target = clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius);
                    // Keep taught station influence without over-constraining moving belt pickup.
                    target = Vector3.Lerp(target, pickAnchor, targetOnDriveNow ? 0.12 : 0.2);
                    const supportTop = supportTopAt(target.x, target.z, state.obstacles);
                    const hoverClearance = Math.max(PICK_HOVER_CLEARANCE, partR * 0.46);
                    const hoverY = Math.max(target.y + hoverClearance, supportTop + hoverClearance);
                    state.desiredTarget.set(target.x, hoverY, target.z);

                    state.gripperTip.computeWorldMatrix(true);
                    const tip = state.gripperTip.getAbsolutePosition();
                    const dx = tip.x - target.x;
                    const dz = tip.z - target.z;
                    const planar = Math.sqrt(dx * dx + dz * dz);
                    if (planar < Math.max(PICK_ALIGN_RADIUS, partR * 1.1) && Math.abs(tip.y - hoverY) < 0.18) {
                        state.phase = 'pick_descend';
                        state.waitTimer = 0;
                    } else if (state.targetTimer > pickTimeout || (state.blockedTimer > 0.55 && planar > (targetOnDrive ? 0.74 : 0.52)) || isUnreachable) {
                        state.skippedTargetIds[state.targetedItem.id] = state.simTime + PICK_SKIP_COOLDOWN;
                        state.targetedItem.state = 'free';
                        state.targetedItem = null;
                        state.targetTimer = 0;
                        state.phase = 'idle';
                    }
                } else state.phase = 'idle';
                break;
            }
            case 'pick_descend': {
                const tx = state.targetedItem?.pos.x ?? 0;
                const tz = state.targetedItem?.pos.z ?? 0;
                const ty = state.targetedItem?.pos.y ?? 0;
                const rdx = tx - mountPos.x;
                const rdz = tz - mountPos.z;
                const rdy = ty + L3 - mountPos.y; // approximate contact wrist height
                const isUnreachable = state.targetedItem && Math.sqrt(rdx*rdx + rdz*rdz + rdy*rdy) > (L1 + L2 - 0.02);
                state.waitTimer += delta;
                state.targetTimer += delta;
                const pickTimeout = currentPickTimeout(state);
                if (state.targetedItem?.state === 'targeted') {
                    const pickAnchor = currentPickAnchor(state) ?? stepPos;
                    const rawTarget = pickupAimPoint(state, state.targetedItem, PICK_LEAD_TIME * 0.6);
                    const partR = partRadiusForSpec(state.targetedItem);
                    const targetOnDriveNow = !!driveTileAt(state.targetedItem.pos.x, state.targetedItem.pos.z, state.obstacles);
                    const catchRadius = clamp(partR * (targetOnDriveNow ? 2.7 : 2.1), PICK_ANCHOR_MIN_OFFSET, PICK_ANCHOR_MAX_OFFSET);
                    const target = clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius);
                    const supportTop = supportTopAt(target.x, target.z, state.obstacles);
                    const targetTop = target.y + partHalfHeight(state.targetedItem);
                    const pickY = Math.max(targetTop + PICK_CONTACT_PAD_GAP, supportTop + PICK_SURFACE_CONTACT_GAP);
                    state.desiredTarget.set(target.x, pickY, target.z);
                }
                const contact = pickupContactState(state, state.targetedItem);
                if (state.waitTimer > 0.05 && contact.touchingPart && state.targetedItem?.state === 'targeted') {
                    state.phase = 'pick_attach';
                    state.waitTimer = 0;
                } else if (state.waitTimer > 1.8 || state.targetTimer > pickTimeout || (state.blockedTimer > 0.55 && contact.horizontalDist > Math.max(0.48, contact.targetRadius * 1.15)) || isUnreachable) {
                    if (state.targetedItem) state.targetedItem.state = 'free';
                    if (state.targetedItem) state.skippedTargetIds[state.targetedItem.id] = state.simTime + PICK_SKIP_COOLDOWN;
                    state.targetedItem = null; state.phase = 'idle';
                    state.targetTimer = 0;
                }
                break;
            }
            case 'pick_attach': {
                const tx = state.targetedItem?.pos.x ?? 0;
                const tz = state.targetedItem?.pos.z ?? 0;
                const ty = state.targetedItem?.pos.y ?? 0;
                const rdx = tx - mountPos.x;
                const rdz = tz - mountPos.z;
                const rdy = ty + L3 - mountPos.y; 
                const isUnreachable = state.targetedItem && Math.sqrt(rdx*rdx + rdz*rdz + rdy*rdy) > (L1 + L2 - 0.02);
                state.waitTimer += delta;
                state.targetTimer += delta;
                const pickTimeout = currentPickTimeout(state);
                state.gripperOpen = false;
                if (state.targetedItem?.state === 'targeted') {
                    const pickAnchor = currentPickAnchor(state) ?? stepPos;
                    const rawTarget = pickupAimPoint(state, state.targetedItem, PICK_LEAD_TIME * 0.45);
                    const partR = partRadiusForSpec(state.targetedItem);
                    const targetOnDriveNow = !!driveTileAt(state.targetedItem.pos.x, state.targetedItem.pos.z, state.obstacles);
                    const catchRadius = clamp(partR * (targetOnDriveNow ? 2.4 : 1.95), PICK_ANCHOR_MIN_OFFSET, PICK_ANCHOR_MAX_OFFSET);
                    const target = clampTargetAroundAnchorXZ(pickAnchor, rawTarget, catchRadius);
                    const supportTop = supportTopAt(target.x, target.z, state.obstacles);
                    const targetTop = target.y + partHalfHeight(state.targetedItem);
                    const pickY = Math.max(targetTop + PICK_CONTACT_PAD_GAP * 0.8, supportTop + PICK_SURFACE_CONTACT_GAP * 0.9);
                    state.desiredTarget.set(target.x, pickY, target.z);
                }
                const attachContact = pickupContactState(state, state.targetedItem);
                const alignReady =
                    attachContact.horizontalDist < Math.max(PICK_ATTACH_ALIGN_RADIUS, attachContact.targetRadius * 0.6) &&
                    attachContact.padGap >= -0.012 &&
                    attachContact.padGap <= PICK_CONTACT_PAD_GAP + 0.055;
                if (state.waitTimer > 0.04 && state.targetedItem?.state === 'targeted' && alignReady) {
                    state.gripperTip.computeWorldMatrix(true);
                    const gripPose = state.gripperTip.getAbsolutePosition();
                    state.targetedItem.pos.set(gripPose.x, gripPose.y - partHalfHeight(state.targetedItem) - 0.001, gripPose.z);
                    state.targetedItem.rotY = state.currentWristRoll;
                    state.targetedItem.state = 'grabbed';
                    state.grabbedItem = state.targetedItem;
                    state.targetedItem = null;
                    state.targetTimer = 0;
                    if (!hasDrop) {
                        state.autoDropTarget = getAutoSlot(partHint(state.grabbedItem));
                    }
                    state.phase = 'pick_recenter';
                    state.waitTimer = 0;
                } else if (state.waitTimer > 0.86 || state.targetTimer > pickTimeout || (state.waitTimer > 0.28 && attachContact.horizontalDist > Math.max(PICK_GRAB_RADIUS + 0.14, attachContact.targetRadius * 1.24)) || isUnreachable) {
                    if (state.targetedItem) state.targetedItem.state = 'free';
                    if (state.targetedItem) state.skippedTargetIds[state.targetedItem.id] = state.simTime + PICK_SKIP_COOLDOWN;
                    state.targetedItem = null; state.phase = 'idle';
                    state.targetTimer = 0;
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
                const dropTop = stackCenterYAt(tgt.x, tgt.z, dropBaseCenterY(state, tgt, state.grabbedItem), state.grabbedItem, state.grabbedItem, STACK_R);
                const targetClearance = stackAwareClearanceAt(state, tgt.x, tgt.z, true);
                const safeHoverY = quantizeHeight(Math.max(dropTop + DROP_HOVER_CLEARANCE, targetClearance - 0.1), 0.03);
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
                const releaseApproachY = Math.max(
                    placement.landingY + 0.018,
                    wallTopAt(placement.target.x, placement.target.z, dropObstacles(state)) + 0.018
                );
                state.desiredTarget.set(placement.target.x, releaseApproachY, placement.target.z);
                state.gripperTip.computeWorldMatrix(true);
                const tipNow = state.gripperTip.getAbsolutePosition();
                const tipPlanar = Math.sqrt((tipNow.x - placement.target.x) ** 2 + (tipNow.z - placement.target.z) ** 2);
                const part = state.grabbedItem;
                const relaxedPlaceReady = !!part
                    && placement.planar <= Math.max(placement.partR * 0.9, 0.22)
                    && part.pos.y <= placement.landingY + 0.055;
                if ((placement.touching || relaxedPlaceReady) && state.waitTimer > 0.07) {
                    state.gripperOpen = true;
                    if (state.grabbedItem) {
                        if (state.isAutoProgram) state.lastDroppedItemId = state.grabbedItem.id;
                        state.grabbedItem.pos.set(
                            placement.target.x + (state.grabbedItem.pos.x - placement.target.x) * 0.2,
                            Math.min(state.grabbedItem.pos.y, placement.landingY + 0.02),
                            placement.target.z + (state.grabbedItem.pos.z - placement.target.z) * 0.2
                        );
                        state.grabbedItem.state = 'free';
                        state.grabbedItem = null;
                    }
                    state.autoDropTarget = null;
                    state.activeDropTarget = null;
                    state.phase = 'drop_recenter';
                    state.waitTimer = 0;
                } else {
                    state.gripperOpen = false;
                    if (state.waitTimer > 0.95) {
                        if (part) {
                            // Hard failsafe: release physically at gripper pose (no teleport to target).
                            state.gripperTip.computeWorldMatrix(true);
                            const tip = state.gripperTip.getAbsolutePosition();
                            if (state.isAutoProgram) state.lastDroppedItemId = part.id;
                            part.pos.set(
                                tip.x,
                                Math.max(placement.landingY, tip.y - partHalfHeight(part) - 0.01),
                                tip.z
                            );
                            part.state = 'free';
                            state.grabbedItem = null;
                            state.autoDropTarget = null;
                            state.activeDropTarget = null;
                            state.phase = 'drop_recenter';
                            state.waitTimer = 0;
                        } else {
                            state.waitTimer = 0;
                            state.activeDropTarget = computeDropTarget(state);
                            state.phase = 'hover_drop';
                        }
                    }
                }
                break;
            case 'drop_recenter': {
                state.waitTimer += delta;
                const anchor = currentDropAnchor(state);
                if (!anchor) {
                    state.phase = 'next';
                    state.waitTimer = 0;
                    break;
                }
                const supportTop = supportTopAt(anchor.x, anchor.z, dropObstacles(state));
                const hoverY = Math.max(
                    anchor.y + DROP_RECENTER_CLEARANCE,
                    supportTop + DROP_RECENTER_CLEARANCE,
                    state.position[1] + 1.12
                );
                state.desiredTarget.set(anchor.x, hoverY, anchor.z);
                if (reached || state.waitTimer > 0.9) {
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
                    // After auto-program finishes, force a cooldown before re-scanning so the
                    // just-dropped item settles and isn't immediately re-targeted.
                    state.targetTimer = -2.5; // need to accumulate back to 1.0 before next scan
                    if (state.lastDroppedItemId) {
                        state.skippedTargetIds[state.lastDroppedItemId] = state.simTime + 3.0;
                        state.lastDroppedItemId = undefined;
                    }
                }
                state.phase = 'idle'; 
                break;
        }
    } else {
        state.targetTimer += delta;
        // No program — check for idle auto-organize
        if (state.autoOrganize && state.phase === 'idle' && state.targetTimer > 1.5) {
            const org = findItemToOrganize(state);
            if (org) {
                state.lastDroppedItemId = undefined; // clear before starting new task
                state.program = [
                    { action: 'pick', pos: [org.item.pos.x, org.item.pos.y, org.item.pos.z] },
                    { action: 'drop', pos: org.dropPos, sortColor: org.sortColor, sortSize: org.sortSize, sortShape: org.sortShape }
                ];
                state.isAutoProgram = true;
                state.stepIndex = 0;
                state.targetTimer = 0;
            } else {
                state.desiredTarget.copyFrom(state.idleTarget);
                state.targetTimer = -1.0; // 2.5s total between polls when no work found
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
    if (desiredPlanar < maxReach) {
        const maxVertical = Math.sqrt(Math.max(0.01, maxReach * maxReach - desiredPlanar * desiredPlanar));
        state.desiredTarget.y = Math.min(state.desiredTarget.y, mountPos.y + maxVertical - 0.04);
    }
    const rawGoal = state.desiredTarget.clone();
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
        else if (state.phase === 'hover_drop') { blendRadius = 0.55; blendStrength = 0.9; }
        else if (state.phase === 'descend_drop') { blendRadius = 0.45; blendStrength = 0.9; }
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

    state.wristRoll.computeWorldMatrix(true);
    const wristPos = state.wristRoll.getAbsolutePosition();
    if (state.selfItem) {
        simState.cobotWrists[state.selfItem.id] = wristPos.clone();
        simState.cobotArmSamples[state.selfItem.id] = collectArmSamples(state);
    }
    
    let grabbedRadius = 0.08;
    if (state.grabbedItem) grabbedRadius = partRadiusForSpec(state.grabbedItem);
    
    // Scale the visual collision boundary
    const visualRadius = 0.2 + grabbedRadius;
    state.collisionSphere.scaling.setAll(visualRadius * 2);

    const sensorHeading = state.baseRotY + state.basePivot.rotation.y;
    const sensorForward = new Vector3(Math.sin(sensorHeading), 0, Math.cos(sensorHeading));
    const sensorRight = new Vector3(sensorForward.z, 0, -sensorForward.x);
    let hazardForward = 0;
    let hazardRight = 0;
    let hazardBackward = 0;
    let hazardLeft = 0;
    const sensorRange = 0.62;
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
    
    // Check placed objects (rough bounding boxes) for sensor awareness.
    for (const item of factoryStore.getState().placedItems) {
        if (item.id === state.selfItem?.id || item.type === 'camera') continue;
        let pad = grabbedRadius, w = 2, d = 2, h = item.config?.machineHeight || 0.538;
        if (item.type === 'table') { [w, d] = item.config?.tableSize || [1.8, 1.8]; h = item.config?.tableHeight || 0.45; }
        else if (item.type === 'belt') { [w, d] = item.config?.beltSize || [2, 2]; h = item.config?.beltHeight || 0.538; }
        else if (['sender', 'receiver', 'indexed_receiver', 'pile'].includes(item.type)) { [w, d] = item.config?.machineSize || [2, 2]; }
        else if (item.type === 'cobot') { w = COBOT_BODY_W; d = COBOT_BODY_D; pad = 0.2 + grabbedRadius; h = COBOT_PLATFORM_TOP_Y; }
        
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
    
    // Check other cobot arms (full sampled arm chain) with short look-ahead.
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
            const distNow = Vector3.Distance(wristPos, p) - (0.2 + grabbedRadius);
            const distSoon = Vector3.Distance(predictedWrist, p) - (0.24 + grabbedRadius);
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
    
    // Check loose items for sensor awareness.
    for (const item of simState.items) {
            if (item === state.grabbedItem) continue;
            if (item === state.targetedItem && distanceToTarget < 0.6) continue;
            const otherRad = partRadiusForSpec(item);
            const otherHalf = partHalfHeight(item);
            
            const dy = clamp(wristPos.y, item.pos.y - otherHalf, item.pos.y + otherHalf);
            const dx = wristPos.x - item.pos.x;
            const dz = wristPos.z - item.pos.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            
            let cx = item.pos.x, cz = item.pos.z;
            if (len > 0) {
                const rad = Math.min(len, otherRad + grabbedRadius);
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

    if (closestPoint && minDist < 0.35 && minDist > 0.001) {
        const avoidanceGain = precisePhase ? 0.45 : 1.0;
        const repulsion = wristPos.subtract(closestPoint);
        repulsion.y *= 2.0; // Favor pushing UP over pushing sideways
        repulsion.normalize();
        const strength = (0.35 - minDist) * 1.5 * avoidanceGain;
        state.desiredTarget.addInPlace(repulsion.scale(strength));
        state.avoidanceBias.addInPlace(repulsion.scale(strength * 1.25));
        state.avoidanceBias.x = clamp(state.avoidanceBias.x, -AVOIDANCE_MAX_BIAS, AVOIDANCE_MAX_BIAS);
        state.avoidanceBias.z = clamp(state.avoidanceBias.z, -AVOIDANCE_MAX_BIAS, AVOIDANCE_MAX_BIAS);
        // Strict clamp to prevent pushing through floor
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
    {
        const maxHazard = Math.max(hazardForward, hazardRight, hazardBackward, hazardLeft);
        const nearRisk = minDist < 0.5 ? clamp((0.5 - Math.max(0, minDist)) / 0.5, 0, 1) : 0;
        const lateralPreference = clamp(hazardLeft - hazardRight, -1, 1);
        if (Math.abs(lateralPreference) > 0.02) {
            const side = lateralPreference > 0 ? 1 : -1;
            state.avoidanceSide = side as -1 | 1;
            const strafe = sensorRight.scale(side * cruiseSpeed * (0.18 + 0.82 * Math.max(maxHazard, nearRisk)));
            desiredVelocity.addInPlace(strafe);
        } else if (state.avoidanceSide !== 0 && maxHazard > 0.08) {
            desiredVelocity.addInPlace(sensorRight.scale(state.avoidanceSide * cruiseSpeed * 0.2));
        }

        if (hazardForward > 0.55 && minDist < 0.42) {
            desiredVelocity.addInPlace(sensorForward.scale(-cruiseSpeed * hazardForward * 0.7));
        }

        if (state.avoidanceBias.lengthSquared() > 0.0001) {
            const biasGain = (precisePhase ? 0.55 : 1.05) * state.speed;
            desiredVelocity.addInPlace(state.avoidanceBias.scale(biasGain));
        }

        const slowdown = clamp(
            1 - Math.max(maxHazard * 0.8, nearRisk * 0.92),
            precisePhase ? 0.2 : 0.12,
            1
        );
        desiredVelocity.scaleInPlace(slowdown);
        if (maxHazard < 0.08 && nearRisk < 0.08) state.avoidanceSide = 0;
    }

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

    // --- Singularity Avoidance: Prevent IK target from passing exactly through the base column ---
    // This creates a smooth 180-degree sweep around the base rather than a chaotic self-intersecting snap!
    const cx = state.ikTarget.x - mountPos.x;
    const cz = state.ikTarget.z - mountPos.z;
    const cDist = Math.sqrt(cx * cx + cz * cz);
    const baseClearanceRadius = Math.max(IK_BASE_CLEARANCE_RADIUS, state.mountCollisionRadius + 0.08);
    const minC = baseClearanceRadius + 0.04;
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
    const reach    = Math.sqrt(planarDist * planarDist + wy * wy);
    const clampedR = Math.min(reach, L1 + L2 - 0.01);

    const cosE = clamp((clampedR * clampedR - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
    const elbowAngle = Math.acos(cosE);

    const alpha2 = Math.atan2(wy, planarDist);
    const beta2  = Math.acos(clamp((clampedR * clampedR + L1 * L1 - L2 * L2) / (2 * clampedR * L1), -1, 1));

    const sh = clamp(Math.PI / 2 - alpha2 - beta2, IK_SHOULDER_MIN, IK_SHOULDER_MAX);
    const el = clamp(elbowAngle, IK_ELBOW_MIN, IK_ELBOW_MAX);
    const wr = Math.PI - sh - el;
    const toolNormalPhase = precisePhase || !!state.grabbedItem;
    const targetToolNormalBlend = toolNormalPhase ? 1.0 : 0.0;
    
    if (state.toolNormalBlend === undefined) state.toolNormalBlend = targetToolNormalBlend;
    state.toolNormalBlend += (targetToolNormalBlend - state.toolNormalBlend) * Math.min(1, delta * 12 * state.speed);

    const blend = state.toolNormalBlend;
    const wristPitch = clamp(wr * (0.72 + 0.28 * blend), IK_WRIST_MIN, IK_WRIST_MAX);
    const handPitchAngle = clamp(wr * (0.28 - 0.28 * blend), -IK_WRIST_MAX, IK_WRIST_MAX);

    state.shoulder.rotation.x = sh;
    state.elbow.rotation.x    = el;
    state.wrist.rotation.x    = wristPitch;
    state.handPitch.rotation.x = handPitchAngle;

    // Wrist roll
    let rd = state.wristRollTarget - state.currentWristRoll;
    while (rd < -Math.PI) rd += Math.PI * 2;
    while (rd >  Math.PI) rd -= Math.PI * 2;
    state.currentWristRoll += rd * 12 * state.speed * delta;
    state.wristRoll.rotation.y = state.currentWristRoll;

    if (isRunning) {
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
            const contactGain = fineContactPhase ? (partHit.severe ? 0.35 : 0.22) : (partHit.severe ? 1.45 : 1.0);
            state.partContactTimer += delta * contactGain;
            state.blockedTimer += delta * 0.35;
            state.overdriveScore = Math.max(0, state.overdriveScore - OVERDRIVE_STALL_PENALTY * 0.35);
            if (state.partContactTimer > PART_CONTACT_WARN_TIMEOUT) {
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
    }

    // Carry grabbed item
    if (state.grabbedItem) {
        state.gripperTip.computeWorldMatrix(true);
        const wp = state.gripperTip.getAbsolutePosition();
        state.grabbedItem.pos.set(wp.x, wp.y - partHalfHeight(state.grabbedItem) - 0.001, wp.z);
        state.grabbedItem.rotY = state.currentWristRoll;
    }

    // Keep release deterministic through state machine; avoid hidden auto-place teleports here.

    if (isRunning) {
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
        const pickContact = isAllowedPickContact ? pickupContactState(state, state.targetedItem) : null;
        let blocked = false;

        for (const obstacle of dropObstacles(state)) {
            if (obstacle.type === 'camera') continue;
            if (isAllowedPickContact && pickContact?.targetPos) {
                const targetSupportHere = itemFootprintHit(obstacle, pickContact.targetPos.x, pickContact.targetPos.z, 0.06);
                if (targetSupportHere && pickContact.horizontalDist < PICK_GRAB_RADIUS && probeBottom > machineTopY(obstacle) + 0.035) {
                    continue;
                }
            }
            if (isAllowedDropContact && dropTarget) {
                const dx = probe.x - dropTarget.x;
                const dz = probe.z - dropTarget.z;
                if (Math.sqrt(dx * dx + dz * dz) < Math.max(DISC_RADIUS, probeRadius) && itemFootprintHit(obstacle, dropTarget.x, dropTarget.z, 0.05)) {
                    continue;
                }
            }
            if (!itemFootprintHit(obstacle, probe.x, probe.z, state.grabbedItem ? probeRadius : 0.04)) continue;
            if (probeBottom <= machineTopY(obstacle) + 0.02) {
                blocked = true;
                if (wantsToMove && probeMotion < 0.003) {
                    state.blockedTimer += delta;
                    if (state.blockedTimer > 0.24 && state.retreatTimer <= 0) {
                        applySoftAvoidance(state, obstacle);
                    }
                    if (state.blockedTimer > STUCK_STALL_TIMEOUT) {
                        startRecoveryRetreat(state, obstacle);
                        state.blockedTimer = 0;
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
        state.lastProbePos.copyFrom(probe);
    }

    return false;
}
