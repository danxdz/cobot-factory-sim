import type { PartShape, PartSize } from '../../types';

export const SIZE_DIAMETER: Record<PartSize, number> = { small: 0.44, medium: 0.5, large: 0.56 };
export const SHAPE_BASE_DIAMETER: Record<PartShape, number> = {
    disc: 0.6,
    can: 0.56,
    box: 0.56,
    pyramid: 0.62,
};
export const SHAPE_BASE_HEIGHT: Record<PartShape, number> = {
    disc: 0.025,
    can: 0.08,
    box: 0.08,
    pyramid: 0.1,
};
export const SHAPE_ORDER: PartShape[] = ['disc', 'can', 'box', 'pyramid'];

export type PartLike = {
    shape?: PartShape;
    size: PartSize;
    radiusScale?: number;
    heightScale?: number;
    scaleX?: number;
    scaleZ?: number;
};

export function partShape(spec: PartLike): PartShape {
    return spec.shape ?? 'disc';
}

export function partSizeScale(spec: PartLike): number {
    return (SIZE_DIAMETER[spec.size] || SIZE_DIAMETER.medium) / 0.6;
}

export function partHalfHeight(spec: PartLike): number {
    const baseH = SHAPE_BASE_HEIGHT[partShape(spec)] ?? SHAPE_BASE_HEIGHT.disc;
    return (baseH * (spec.heightScale ?? 1)) / 2;
}

export function partRadiusForSpec(spec: PartLike): number {
    const shape = partShape(spec);
    const xScale = partSizeScale(spec) * (spec.radiusScale ?? 1) * (spec.scaleX ?? 1);
    const zScale = partSizeScale(spec) * (spec.radiusScale ?? 1) * (spec.scaleZ ?? 1);
    if (shape === 'box') {
        const halfW = (SHAPE_BASE_DIAMETER.box / 2) * xScale;
        const halfD = (SHAPE_BASE_DIAMETER.box / 2) * zScale;
        return Math.sqrt(halfW * halfW + halfD * halfD);
    }
    const baseR = (SHAPE_BASE_DIAMETER[shape] ?? SHAPE_BASE_DIAMETER.disc) / 2;
    return baseR * Math.max(xScale, zScale);
}

export function partRadiusForSize(size: PartSize): number {
    return partRadiusForSpec({ shape: 'disc', size });
}
