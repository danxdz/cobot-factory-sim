import type { Mesh, PBRMaterial, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { SimItem } from '../../simState';
import type { PartSize, PlacedItem, ProgramStep } from '../../types';

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
    pathLine?: Mesh;
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
    isOutOfRange: boolean;
    stalledInternal: boolean;
    enableRepulsion: boolean;
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
    targetSource: 'program' | 'avoidance' | 'yield' | 'manual' | 'tuning' | 'unknown';
    yieldTarget: Vector3 | null;
    yieldUntil: number;
    avoidDropTarget: Vector3 | null;
    avoidDropUntil: number;
    dropExitTarget: Vector3 | null;
    dropReplanStreak: number;
    lastReplanTargetKey: string;
    lockedDropTarget: Vector3 | null;

    phase: string;
    stepIndex: number;
    targetedItem: SimItem | null;
    grabbedItem: SimItem | null;
    waitTimer: number;
    autoDropTarget: Vector3 | null;
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
    stackSlots: StackSlot[];
    mountCollisionRadius: number;
    isFull: boolean;
    sensorLights: Mesh[];
    tuningMode: boolean;
    lastPreviewUpdate?: number;
    lastDroppedItemId?: string;
    sensorHazards: [number, number, number, number];
    sensorMinDist: number;
    safetySpeedFactor: number;
    reducedSpeedActive: boolean;
    lastLoggedPhase: string;
    lastStatusReasonKey: string;
    lastStatusReasonAt: number;
    tuningHighlightTargets: Record<string, Mesh[]>;
    lastTuningHighlightKey?: string;
    
    // Torque and Overload System
    jointTorques: [number, number, number, number]; // base, shoulder, elbow, wrist
    lastJointAngles: [number, number, number, number];
}
