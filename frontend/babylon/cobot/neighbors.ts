import { Vector3 } from '@babylonjs/core';
import { COBOT_ARM_HARD_STOP_DIST, COBOT_ARM_REDUCED_SPEED_DIST } from './constants';
import { clamp } from './math';
import { simState } from '../../simState';
import type { CobotState } from './stateTypes';

/** Use the same right-of-way rule in parking and motion control. */
export function yieldsToNeighbor(selfId: string, selfLoaded: boolean, otherId: string, otherLoaded: boolean): boolean {
    return selfLoaded !== otherLoaded ? !selfLoaded : selfId > otherId;
}

/** Brake an approach without inventing sideways or retreat motion. An arm
 * already moving away must be allowed to clear the shared space. */
export function neighborApproachScale(velocity: Vector3, towardNeighbor: Vector3, clearance: number, yielding: boolean): number {
    if (Vector3.Dot(velocity, towardNeighbor) <= 0.000001) return 1;
    if (clearance <= COBOT_ARM_HARD_STOP_DIST) return 0;
    const scale = clamp((clearance - COBOT_ARM_HARD_STOP_DIST) /
        (COBOT_ARM_REDUCED_SPEED_DIST - COBOT_ARM_HARD_STOP_DIST), 0, 1);
    return yielding ? scale : Math.sqrt(scale);
}

/** A pickup claims a small work area, not just the individual part. Keep the
 * next arm parked until the first tool/payload has cleared that area. */
export function pickupSpaceBusy(state: CobotState, point: Vector3): boolean {
    for (const other of simState.cobotStates.values()) {
        if (other === state || other.selfItem?.id === state.selfItem?.id) continue;
        const work = other.targetedItem ?? other.grabbedItem;
        if (work && work.state !== 'dead' && Math.hypot(work.pos.x - point.x, work.pos.z - point.z) < 1.0) return true;
        other.gripperTip.computeWorldMatrix(true);
        const tip = other.gripperTip.getAbsolutePosition();
        if (Math.hypot(tip.x - point.x, tip.z - point.z) < 0.8 && Math.abs(tip.y - point.y) < 1.2) return true;
    }
    return false;
}
