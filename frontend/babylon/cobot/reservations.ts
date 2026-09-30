import { Vector3 } from '@babylonjs/core';
import { simState } from '../../simState';
import { partRadiusForSpec } from './partGeometry';
import type { CobotState } from './stateTypes';

export function dropTargetReserved(state: CobotState, position: Vector3): boolean {
    const radius = state.grabbedItem ? partRadiusForSpec(state.grabbedItem) : 0.28;
    return Object.entries(simState.dropReservations).some(([id, reservation]) =>
        id !== state.selfItem?.id &&
        Math.hypot(position.x - reservation.position.x, position.z - reservation.position.z) < radius + reservation.radius + 0.02
    );
}

export function reserveDropTarget(state: CobotState, position: Vector3): boolean {
    const id = state.selfItem?.id;
    if (!id || !state.grabbedItem || dropTargetReserved(state, position)) return false;
    simState.dropReservations[id] = { position: position.clone(), radius: partRadiusForSpec(state.grabbedItem) };
    return true;
}

export function releaseDropReservation(state: CobotState) {
    if (state.selfItem) delete simState.dropReservations[state.selfItem.id];
}
