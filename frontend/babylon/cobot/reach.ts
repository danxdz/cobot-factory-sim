import type { Vector3 } from '@babylonjs/core';
import { cobotForearmLength, cobotUpperArmLength, cobotWristLength } from './cobotConfig';
import { COBOT_GRIPPER_TIP_OFFSET, COBOT_HAND_LINK_LENGTH } from './constants';
import { projectTargetToReachEnvelope } from './math';
import type { CobotState } from './stateTypes';

export function projectCobotTarget(state: CobotState, target: Vector3): Vector3 {
    state.basePivot.computeWorldMatrix(true);
    const mount = state.basePivot.getAbsolutePosition().clone();
    mount.y += 0.05;
    const config = state.selfItem?.config;
    return projectTargetToReachEnvelope(target, mount, state.position[1] + 0.1,
        cobotUpperArmLength(config) + cobotForearmLength(config) - 0.02,
        cobotWristLength(config) + COBOT_HAND_LINK_LENGTH + COBOT_GRIPPER_TIP_OFFSET);
}
