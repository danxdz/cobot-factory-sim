import { Vector3 } from '@babylonjs/core';
import { SimItem,simState } from '../../simState';
import { PartSize,PlacedItem } from '../../types';
import { COBOT_PEDESTAL_SAFEZONE_RADIUS,DISC_RADIUS,DROP_RECENTER_CLEARANCE,IK_BASE_CLEARANCE_RADIUS,STACK_SLOT_COLORS } from './constants';
import { dropBaseCenterY,dropObstacles,itemFootprintHit,partHint,quantizeHeight,slotCaptureRadius,stackAwareClearanceAt,stackCenterYAt,supportTopAt } from './geometry';
import { clamp } from './math';
import { PartLike,SHAPE_ORDER,partRadiusForSpec,partShape } from './partGeometry';
import { dropTargetReserved,reserveDropTarget } from './reservations';
import type { CobotState } from './stateTypes';

export function assignItemsToSlots(slots: Vector3[], ignoreItem?: SimItem | null, maxAssignDist = 0.42): SimItem[][] {
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

export function isTemporarilyAvoidedDropTarget(state: CobotState, slot: Vector3): boolean {
    if (dropTargetReserved(state, slot)) return true;
    if (!state.avoidDropTarget || state.simTime > state.avoidDropUntil) return false;
    const dx = slot.x - state.avoidDropTarget.x;
    const dz = slot.z - state.avoidDropTarget.z;
    return Math.sqrt(dx * dx + dz * dz) < 0.24;
}

export function getOrganizedDropTarget(
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

export function getSelfPlatformDropTarget(
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

export function enforceDropReachability(state: CobotState, target: Vector3): Vector3 {
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

export function computeDropTarget(state: CobotState): Vector3 | null {
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

export function currentDropTarget(state: CobotState): Vector3 | null {
    if (!state.grabbedItem || !['transit_drop', 'hover_drop', 'descend_drop', 'release'].includes(state.phase)) return null;
    const locked = state.lockedDropTarget ?? state.activeDropTarget;
    if (locked && !isTemporarilyAvoidedDropTarget(state, locked) && reserveDropTarget(state, locked)) return locked.clone();
    state.lockedDropTarget = null;
    state.activeDropTarget = null;
    if (state.autoDropTarget && isTemporarilyAvoidedDropTarget(state, state.autoDropTarget)) {
        state.autoDropTarget = resolveAutoDropTarget(state, partHint(state.grabbedItem));
    }
    const target = computeDropTarget(state);
    if (!target || !reserveDropTarget(state, target)) return null;
    state.activeDropTarget = target.clone();
    state.lockedDropTarget = target.clone();
    return target;
}

export function isSelfPlatformDropPhase(state: CobotState, target?: Vector3 | null): boolean {
    if (!state.selfItem) return false;
    if (!['hover_drop', 'descend_drop', 'release', 'drop_recenter'].includes(state.phase)) return false;
    const t = target ?? (state.phase === 'drop_recenter' ? state.dropExitTarget : currentDropTarget(state));
    if (!t) return false;
    return itemFootprintHit(state.selfItem, t.x, t.z, 0.08);
}

export function resolveAutoDropTarget(state: CobotState, hint: ({ color: string } & PartLike)): Vector3 | null {
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

export function selfSortPreferences(state: CobotState) {
    return {
        sortColor: state.selfItem?.config?.defaultDropSortColor !== false,
        sortSize: state.selfItem?.config?.defaultDropSortSize !== false,
        sortShape: state.selfItem?.config?.defaultDropSortShape !== false,
    };
}

export function dropPlacementState(state: CobotState) {
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

export function computeDropExitTarget(state: CobotState, x: number, z: number, minSurfaceY = 0): Vector3 {
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

export function captureDropExitTarget(state: CobotState, minSurfaceY = 0) {
    state.gripperTip.computeWorldMatrix(true);
    const tip = state.gripperTip.getAbsolutePosition();
    state.dropExitTarget = computeDropExitTarget(state, tip.x, tip.z, minSurfaceY);
}
