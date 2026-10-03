import type { Vector3 } from '@babylonjs/core';
import { normalizeAngle, partHint } from './geometry';
import { partHalfHeight, type PartLike } from './partGeometry';
import type { CobotState } from './stateTypes';

export function latchPickup(state: CobotState, gripPose: Vector3, hasDrop: boolean,
    getAutoSlot: (part: { color: string } & PartLike) => Vector3 | null) {
    const part = state.targetedItem;
    if (!part || part.state !== 'targeted') return;
    part.pos.set(gripPose.x, gripPose.y - partHalfHeight(part) - 0.001, gripPose.z);
    // Keep the part's angle at contact, then turn the wrist toward the existing
    // zero-yaw drop alignment. Never teleport the part's orientation on latch.
    state.graspYawOffset = normalizeAngle(part.rotY - state.currentWristRoll);
    state.wristRollTarget = -state.graspYawOffset;
    part.state = 'grabbed';
    state.grabbedItem = part;
    state.targetedItem = null;
    state.targetTimer = 0;
    state.blockedTimer = 0;
    state.lockedPickupTarget = null;
    state.lockedPickupItemId = null;
    state.lockedPickupUntil = 0;
    if (!hasDrop) state.autoDropTarget = getAutoSlot(partHint(part));
    state.phase = 'pick_recenter';
    state.waitTimer = 0;
}

export function syncCarriedPart(state: CobotState) {
    const part = state.grabbedItem;
    if (!part) return;
    state.gripperTip.computeWorldMatrix(true);
    const tip = state.gripperTip.getAbsolutePosition();
    part.pos.set(tip.x, tip.y - partHalfHeight(part) - 0.001, tip.z);
    part.rotY = state.currentWristRoll + state.graspYawOffset;
}
