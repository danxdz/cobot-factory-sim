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
    pos: Vector3;
    rotY: number;
    color: string;
    size: PartSize;
    confidence: number;
    planarOffset: number;
}

export const simState = {
    items: [] as SimItem[],
    cameraDetections: [] as CameraDetection[],
    cobotWrists: {} as Record<string, Vector3>,
    cobotArmSamples: {} as Record<string, Vector3[]>,
    reset: () => {
        simState.items = [];
        simState.cameraDetections = [];
        simState.cobotWrists = {};
        simState.cobotArmSamples = {};
    }
};
