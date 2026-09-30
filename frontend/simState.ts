import { Vector3 } from '@babylonjs/core';
import type { CobotState } from './babylon/cobot/stateTypes';
import { PartShape,PartSize } from './types';

export interface SimItem {
    id: string;
    templateId?: string;
    shape: PartShape;
    pos: Vector3;
    rotY: number;
    state: 'free' | 'targeted' | 'grabbed' | 'dead';
    color: string;
    size: PartSize;
    hasCenterHole?: boolean;
    hasIndexHole?: boolean;
    // Geometry fine-tune from Part Creator template
    radiusScale?: number;
    heightScale?: number;
    scaleX?: number;     // box width override
    scaleZ?: number;     // box depth override
    meshIndex?: number; // which pool slot this occupies
}

export interface CameraDetection {
    cameraId: string;
    itemId: string;
    templateId?: string;
    templateName?: string;
    shape: PartShape;
    pos: Vector3;
    rotY: number;
    color: string;
    size: PartSize;
    confidence: number;
    planarOffset: number;
}

export interface CobotDebugLogEntry {
    ts: number;
    simTime: number;
    phase: string;
    event: string;
    detail?: string;
    reason?: string;
    itemId?: string;
    mode?: string;
    durationSec?: number;
    snapDist?: number;
    planarDist?: number;
    verticalDist?: number;
    ikTarget?: [number, number, number];
    desiredTarget?: [number, number, number];
    targetSource?: string;
    stepIndex?: number;
    programLen?: number;
    stepAction?: string;
    stepPos?: [number, number, number] | null;
}

export const simState = {
    cobotStates: new Map<string, CobotState>(),
    dropReservations: {} as Record<string, { position: Vector3; radius: number }>,
    items: [] as SimItem[],
    cameraDetections: [] as CameraDetection[],
    cameraFrames: {} as Record<string, string>,
    cobotWrists: {} as Record<string, Vector3>,
    cobotArmSamples: {} as Record<string, Vector3[]>,
    cobotLoads: {} as Record<string, boolean>,
    cobotLogs: {} as Record<string, CobotDebugLogEntry[]>,
    reset: () => {
        simState.cobotStates.clear();
        simState.dropReservations = {};
        simState.items = [];
        simState.cameraDetections = [];
        simState.cameraFrames = {};
        simState.cobotWrists = {};
        simState.cobotArmSamples = {};
        simState.cobotLoads = {};
        simState.cobotLogs = {};
    }
};

export function appendCobotLog(cobotId: string, entry: CobotDebugLogEntry) {
    const current = simState.cobotLogs[cobotId] || [];
    current.push(entry);
    // Keep recent log window only (enough for diagnosis/export without memory blowup).
    if (current.length > 600) current.splice(0, current.length - 600);
    simState.cobotLogs[cobotId] = current;
}
