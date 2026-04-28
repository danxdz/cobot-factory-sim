import { Vector3 } from '@babylonjs/core';
import { PartShape, PartSize } from './types';

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
}

export const simState = {
    items: [] as SimItem[],
    cameraDetections: [] as CameraDetection[],
    cameraFrames: {} as Record<string, string>,
    cobotWrists: {} as Record<string, Vector3>,
    cobotArmSamples: {} as Record<string, Vector3[]>,
    cobotLogs: {} as Record<string, CobotDebugLogEntry[]>,
    reset: () => {
        simState.items = [];
        simState.cameraDetections = [];
        simState.cameraFrames = {};
        simState.cobotWrists = {};
        simState.cobotArmSamples = {};
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
