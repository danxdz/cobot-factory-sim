import { Vector3 } from '@babylonjs/core';
import { SimItem,simState } from '../../simState';
import { PartShape,PartSize,PlacedItem } from '../../types';
import { COBOT_PLATFORM_D,COBOT_PLATFORM_TOP_Y,COBOT_PLATFORM_W,DISC_RADIUS } from './constants';
import { HAND_DISK_COLLIDER_RADIUS } from './contactConstants';
import { clamp } from './math';
import { PartLike,partHalfHeight,partRadiusForSpec } from './partGeometry';
import type { CobotState } from './stateTypes';

export function topSurfaceAt(x: number, z: number, baseSurfaceY: number, ignoreItem?: SimItem | null, radius = 0.28): number {
    return simState.items.reduce((top, item) => {
        if (item === ignoreItem || item.state === 'dead' || item.state === 'grabbed') return top;
        const dx = item.pos.x - x;
        const dz = item.pos.z - z;
        if (Math.sqrt(dx * dx + dz * dz) > radius) return top;
        return Math.max(top, item.pos.y + partHalfHeight(item));
    }, baseSurfaceY);
}

export function stackCenterYAt(
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

export function quantizeHeight(y: number, step = 0.04): number {
    if (!Number.isFinite(y) || step <= 0) return y;
    return Math.round(y / step) * step;
}

export function stackAwareClearanceAt(state: CobotState, x: number, z: number, carrying: boolean): number {
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

export function platformStackClearanceY(state: CobotState, carrying: boolean): number {
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

export function stackPathClearanceY(state: CobotState, start: Vector3, goal: Vector3, carrying: boolean): number {
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

export function obstaclePathClearanceY(state: CobotState, start: Vector3, goal: Vector3, carrying: boolean): number {
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

export function segmentTouchesSelfPlatform(state: CobotState, start: Vector3, goal: Vector3, pad = 0.16): boolean {
    if (!state.selfItem) return false;
    for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = start.x + (goal.x - start.x) * t;
        const z = start.z + (goal.z - start.z) * t;
        if (itemFootprintHit(state.selfItem, x, z, pad)) return true;
    }
    return false;
}

export function segmentClearanceY(state: CobotState, start: Vector3, goal: Vector3, carrying: boolean): number {
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

export function toolSurfaceClearance(_state: CobotState, phase: string): number {
    if (phase === 'pick_descend' || phase === 'pick_attach') return 0.025;
    if (phase === 'release' || phase === 'descend_drop') return 0.05;
    if (phase === 'hover_drop' || phase === 'pick_hover') return 0.06;
    return 0.05;
}

export function isPickupContactOverride(state: CobotState): boolean {
    return !!state.targetedItem && (state.phase === 'pick_descend' || state.phase === 'pick_attach');
}

export function carriedPayloadRadius(state: CobotState): number {
    if (!state.grabbedItem) return 0;
    const radius = partRadiusForSpec(state.grabbedItem);
    const halfHeight = partHalfHeight(state.grabbedItem);
    return radius + Math.min(0.08, halfHeight * 0.45) + 0.035;
}

export function carriedPayloadHeight(state: CobotState): number {
    return state.grabbedItem ? partHalfHeight(state.grabbedItem) * 2 : 0;
}

export function clampTargetAboveSupports(state: CobotState, target: Vector3, phase: string, carrying: boolean): Vector3 {
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

export function partHint(item: SimItem): PartLike & { color: string } {
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

export function itemFootprintHit(item: PlacedItem, x: number, z: number, pad = 0.0): boolean {
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

export function machineTopY(item: PlacedItem): number {
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

export function supportTopAt(x: number, z: number, obstacles: PlacedItem[], pad = DISC_RADIUS * 0.35): number {
    let topY = 0;
    for (const obstacle of obstacles) {
        if (!itemFootprintHit(obstacle, x, z, pad)) continue;
        topY = Math.max(topY, machineTopY(obstacle));
    }
    return topY;
}

export function machineWallY(item: PlacedItem): number {
    switch (item.type) {
        case 'receiver':
        case 'indexed_receiver':
            return 1.2;
        default:
            return machineTopY(item);
    }
}

export function wallTopAt(x: number, z: number, obstacles: PlacedItem[]): number {
    let topY = 0;
    for (const obstacle of obstacles) {
        if (!itemFootprintHit(obstacle, x, z, 0.1)) continue;
        topY = Math.max(topY, machineWallY(obstacle));
    }
    return topY;
}

export function dropObstacles(state: CobotState): PlacedItem[] {
    return state.selfItem ? [...state.obstacles, state.selfItem] : state.obstacles;
}

export function driveVector(rotation: number): Vector3 {
    switch (rotation) {
        case 0: return new Vector3(0, 0, -1);
        case 1: return new Vector3(1, 0, 0);
        case 2: return new Vector3(0, 0, 1);
        case 3: return new Vector3(-1, 0, 0);
        default: return Vector3.Zero();
    }
}

export function driveTileAt(x: number, z: number, obstacles: PlacedItem[]): PlacedItem | null {
    return obstacles.find(item => {
        if (item.type !== 'belt' && item.type !== 'sender') return false;
        const [w, d] = item.type === 'belt' ? (item.config?.beltSize || [2, 2]) : (item.config?.machineSize || [2, 2]);
        return Math.abs(x - item.position[0]) <= w / 2 && Math.abs(z - item.position[2]) <= d / 2;
    }) ?? null;
}

export function slotCaptureRadius(slots: Vector3[], fallback = 0.24): number {
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

export function dropBaseCenterY(state: CobotState, target: Vector3, part?: PartLike): number {
    const supportTop = supportTopAt(target.x, target.z, dropObstacles(state));
    const stackPart = part ?? state.grabbedItem ?? { shape: 'disc' as PartShape, size: 'medium' as PartSize };
    return supportTop + partHalfHeight(stackPart);
}

export function normalizeAngle(rad: number): number {
    let a = rad;
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
}

export function pointSegmentDistSq2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
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

export function pointSegmentT2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const abx = bx - ax;
    const abz = bz - az;
    const abLenSq = abx * abx + abz * abz;
    if (abLenSq <= 0.000001) return 0;
    return clamp(((px - ax) * abx + (pz - az) * abz) / abLenSq, 0, 1);
}

export function itemFootprintSize(item: PlacedItem): [number, number] {
    if (item.type === 'table') return item.config?.tableSize || [1.8, 1.8];
    if (item.type === 'belt') return item.config?.beltSize || [2, 2];
    if (['sender', 'receiver', 'indexed_receiver', 'pile'].includes(item.type)) return item.config?.machineSize || [2, 2];
    if (item.type === 'cobot') return [COBOT_PLATFORM_W, COBOT_PLATFORM_D];
    return [2, 2];
}

export function itemWorldFootprintSize(item: PlacedItem): [number, number] {
    const [w, d] = itemFootprintSize(item);
    return (item.rotation || 0) % 2 !== 0 ? [d, w] : [w, d];
}

export function segmentFootprintHit2D(start: Vector3, goal: Vector3, item: PlacedItem, pad: number): boolean {
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
