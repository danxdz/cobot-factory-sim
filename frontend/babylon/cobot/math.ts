import { Vector3 } from '@babylonjs/core';

export function clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v));
}

export function projectTargetToReachEnvelope(target: Vector3, mountPos: Vector3, baseMinY: number, maxReach: number): Vector3 {
    const projected = target.clone();
    projected.y = Math.max(projected.y, baseMinY);
    const dx = projected.x - mountPos.x;
    const dz = projected.z - mountPos.z;
    const planar = Math.sqrt(dx * dx + dz * dz);
    if (planar > maxReach && planar > 0.0001) {
        const inward = Math.max(0.01, maxReach - 0.035) / planar;
        projected.x = mountPos.x + dx * inward;
        projected.z = mountPos.z + dz * inward;
    } else if (planar < 0.02 && planar > 0.0001) {
        // Enforce the COBOT_PEDESTAL_SAFEZONE_RADIUS (0.02)
        const push = 0.02 / planar;
        projected.x = mountPos.x + dx * push;
        projected.z = mountPos.z + dz * push;
    } else if (planar <= 0.0001) {
        projected.z = mountPos.z + 0.02;
    }

    if (planar < maxReach) {
        const p2 = Math.max(0.02, planar);
        const maxVertical = Math.sqrt(Math.max(0.01, maxReach * maxReach - p2 * p2));
        projected.y = Math.min(projected.y, mountPos.y + maxVertical - 0.04);
    }
    return projected;
}

export function finiteNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

export function degToRad(deg: number): number {
    return finiteNumber(deg, 0) * (Math.PI / 180);
}
