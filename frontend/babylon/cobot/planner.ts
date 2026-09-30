import { Vector3 } from '@babylonjs/core';
import { PlacedItem } from '../../types';
import { COBOT_PEDESTAL_SAFEZONE_RADIUS,DROP_CLEARANCE,DROP_HOVER_CLEARANCE,IK_BASE_CLEARANCE_RADIUS,PICK_DESCEND_CLEARANCE,PICK_HOVER_CLEARANCE } from './constants';
import { currentDropTarget } from './dropTargets';
import { carriedPayloadRadius,dropObstacles,itemFootprintHit,itemWorldFootprintSize,machineWallY,pointSegmentDistSq2D,quantizeHeight,segmentClearanceY,segmentFootprintHit2D,wallTopAt } from './geometry';
import { currentPickAnchor } from './programTargets';
import type { CobotState } from './stateTypes';

export function isActiveSupportForPath(state: CobotState, obstacle: PlacedItem): boolean {
    const pickPhase = state.phase === 'pick_hover' || state.phase === 'pick_descend' || state.phase === 'pick_attach';
    const dropPhase = state.phase === 'hover_drop' || state.phase === 'descend_drop' || state.phase === 'release' || state.phase === 'drop_recenter';
    const pickAnchor = pickPhase ? currentPickAnchor(state) : null;
    const dropTarget = dropPhase ? currentDropTarget(state) : null;
    if (pickAnchor && itemFootprintHit(obstacle, pickAnchor.x, pickAnchor.z, 0.1)) return true;
    if (dropTarget && itemFootprintHit(obstacle, dropTarget.x, dropTarget.z, 0.1)) return true;
    return false;
}

export function findBlockingPathObstacle(
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

export function pathHitsObstacle2D(points: Vector3[], obstacle: PlacedItem, pad: number): boolean {
    for (let i = 1; i < points.length; i++) {
        if (segmentFootprintHit2D(points[i - 1], points[i], obstacle, pad)) return true;
    }
    return false;
}

export function detourAroundObstacle(
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

export function pushPointOutsideBaseKeepout(point: Vector3, mountPos: Vector3, keepout: number): Vector3 {
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

export function appendPathSegment(dst: Vector3[], segment: Vector3[]) {
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

export function planToolpath(state: CobotState, start: Vector3, goal: Vector3, mountPos: Vector3, precisePhase: boolean): Vector3[] {
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
        const mid = Vector3.Lerp(navStart, navGoal, 0.5);
        // Instead of a wide horizontal sweep, just lift the end-effector high enough
        // to safely pass directly over the robot's own pedestal.
        // The base yaw will naturally handle the rotation in the shortest path.
        mid.y = Math.max(clearY, mountPos.y + 0.85);
        path.push(mid);
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

export function nextPlannedTarget(state: CobotState, mountPos: Vector3, goal: Vector3, precisePhase: boolean): Vector3 {
    const directContactPhase =
        state.phase === 'pick_descend' ||
        state.phase === 'pick_attach' ||
        state.phase === 'pick_recenter' ||
        state.phase === 'descend_drop' ||
        state.phase === 'release';
    if (directContactPhase) return goal.clone();

    const isExitPhase = state.phase === 'drop_recenter' || state.phase === 'lift' || state.phase === 'pick_recenter';
    const movingPickPhase = state.phase === 'pick_hover';
    const goalDriftThreshold = isFineAlignPhase(state.phase) ? 0.04 : 0.2;
    const goalChanged = Vector3.Distance(state.plannedPathGoal, goal) > goalDriftThreshold;
    const phaseChanged = state.plannedPathPhase !== state.phase;
    const noPath = state.plannedPath.length < 2;
    const cursorDone = state.plannedPathCursor >= state.plannedPath.length;
    
    // For exit/recenter phases, we want immediate response to goal changes (blended transit)
    const forceImmediateReplan = isExitPhase && goalChanged;
    
    const shouldReplan = noPath || phaseChanged || cursorDone || forceImmediateReplan || (goalChanged && state.pathReplanCooldown <= 0);
    
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

export function isFineAlignPhase(phase: string): boolean {
    return phase === 'pick_hover'
        || phase === 'pick_descend'
        || phase === 'pick_attach'
        || phase === 'hover_drop'
        || phase === 'descend_drop';
}

export function resolveFlowGoal(state: CobotState, rawGoal: Vector3): Vector3 {
    // The phase owns its goal; the path planner already handles replan thresholds.
    // A second goal lock can retain the previous phase's endpoint indefinitely.
    state.lockedFlowPhase = state.phase;
    state.lockedFlowGoal.copyFrom(rawGoal);
    return rawGoal.clone();
}

export function buildPrecalculatedToolpathPreview(state: CobotState, mountPos: Vector3, flowGoal: Vector3, precisePhase: boolean): Vector3[] {
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
