import type { ItemConfig } from '../../types';
import {
    COBOT_FOREARM_DIAMETER_DEFAULT,
    COBOT_FOREARM_LENGTH,
    COBOT_FOREARM_LENGTH_MAX,
    COBOT_FOREARM_LENGTH_MIN,
    COBOT_SEGMENT_DIAMETER_MAX,
    COBOT_SEGMENT_DIAMETER_MIN,
    COBOT_UPPER_ARM_DIAMETER_DEFAULT,
    COBOT_UPPER_ARM_LENGTH,
    COBOT_UPPER_ARM_LENGTH_MAX,
    COBOT_UPPER_ARM_LENGTH_MIN,
    COBOT_WRIST_DIAMETER_DEFAULT,
    COBOT_WRIST_LENGTH_MAX,
    COBOT_WRIST_LENGTH_MIN,
    COBOT_WRIST_LINK_LENGTH,
    IK_ELBOW_MAX_DEFAULT,
    IK_ELBOW_MIN_DEFAULT,
    IK_SHOULDER_MAX_DEFAULT,
    IK_SHOULDER_MIN_DEFAULT,
    IK_WRIST_MAX_DEFAULT,
    IK_WRIST_MIN_DEFAULT,
} from './constants';
import { clamp, degToRad, finiteNumber } from './math';

export function cobotUpperArmLength(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotUpperArmLength, COBOT_UPPER_ARM_LENGTH);
    return clamp(raw, COBOT_UPPER_ARM_LENGTH_MIN, COBOT_UPPER_ARM_LENGTH_MAX);
}

export function cobotForearmLength(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotForearmLength, COBOT_FOREARM_LENGTH);
    return clamp(raw, COBOT_FOREARM_LENGTH_MIN, COBOT_FOREARM_LENGTH_MAX);
}

export function cobotWristLength(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotWristLength, COBOT_WRIST_LINK_LENGTH);
    return clamp(raw, COBOT_WRIST_LENGTH_MIN, COBOT_WRIST_LENGTH_MAX);
}

export function cobotUpperArmDiameter(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotUpperArmDiameter, COBOT_UPPER_ARM_DIAMETER_DEFAULT);
    return clamp(raw, COBOT_SEGMENT_DIAMETER_MIN, COBOT_SEGMENT_DIAMETER_MAX);
}

export function cobotForearmDiameter(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotForearmDiameter, COBOT_FOREARM_DIAMETER_DEFAULT);
    return clamp(raw, COBOT_SEGMENT_DIAMETER_MIN, COBOT_SEGMENT_DIAMETER_MAX);
}

export function cobotWristDiameter(config?: ItemConfig): number {
    const raw = finiteNumber(config?.cobotWristDiameter, COBOT_WRIST_DIAMETER_DEFAULT);
    return clamp(raw, COBOT_SEGMENT_DIAMETER_MIN, COBOT_SEGMENT_DIAMETER_MAX);
}

export function cobotShoulderLimits(config?: ItemConfig): { min: number; max: number } {
    const min = degToRad(finiteNumber(config?.cobotShoulderMinDeg, -77));
    const max = degToRad(finiteNumber(config?.cobotShoulderMaxDeg, 80));
    const clampedMin = clamp(min, -Math.PI, Math.PI);
    const clampedMax = clamp(max, -Math.PI, Math.PI);
    return clampedMin < clampedMax
        ? { min: clampedMin, max: clampedMax }
        : { min: IK_SHOULDER_MIN_DEFAULT, max: IK_SHOULDER_MAX_DEFAULT };
}

export function cobotElbowLimits(config?: ItemConfig): { min: number; max: number } {
    const min = degToRad(finiteNumber(config?.cobotElbowMinDeg, 13));
    const max = degToRad(finiteNumber(config?.cobotElbowMaxDeg, 166));
    const clampedMin = clamp(min, -Math.PI, Math.PI);
    const clampedMax = clamp(max, -Math.PI, Math.PI);
    return clampedMin < clampedMax
        ? { min: clampedMin, max: clampedMax }
        : { min: IK_ELBOW_MIN_DEFAULT, max: IK_ELBOW_MAX_DEFAULT };
}

export function cobotWristLimits(config?: ItemConfig): { min: number; max: number } {
    const min = degToRad(finiteNumber(config?.cobotWristMinDeg, -180));
    const max = degToRad(finiteNumber(config?.cobotWristMaxDeg, 180));
    const clampedMin = clamp(min, -Math.PI, Math.PI);
    const clampedMax = clamp(max, -Math.PI, Math.PI);
    return clampedMin < clampedMax
        ? { min: clampedMin, max: clampedMax }
        : { min: IK_WRIST_MIN_DEFAULT, max: IK_WRIST_MAX_DEFAULT };
}

export function cobotDefaultAngles(config?: ItemConfig): { shoulder: number; elbow: number; wrist: number } {
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
