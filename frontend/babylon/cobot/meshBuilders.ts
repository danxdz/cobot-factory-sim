import {
    Color3,
    Mesh,
    MeshBuilder,
    PBRMaterial,
    Scene,
    TransformNode,
    Vector3,
} from '@babylonjs/core';

export function pbr(scene: Scene, hex: string, metallic = 0.5, roughness = 0.4, alpha = 1): PBRMaterial {
    const m = new PBRMaterial('', scene);
    m.albedoColor = Color3.FromHexString(hex || '#94a3b8');
    m.metallic = metallic;
    m.roughness = roughness;
    if (alpha < 1) {
        m.alpha = alpha;
        m.transparencyMode = 2;
    }
    return m;
}

export function box(n: string, w: number, h: number, d: number, pos: Vector3, mat: PBRMaterial, scene: Scene, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
    m.position = pos;
    m.material = mat;
    m.receiveShadows = true;
    (m as any).castShadows = true;
    if (parent) m.parent = parent;
    return m;
}

export function cyl(n: string, r: number, h: number, pos: Vector3, mat: PBRMaterial, scene: Scene, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateCylinder(n, { diameter: r * 2, height: h, tessellation: 24 }, scene);
    m.position = pos;
    m.material = mat;
    m.receiveShadows = true;
    (m as any).castShadows = true;
    if (parent) m.parent = parent;
    return m;
}

export function sph(n: string, d: number, pos: Vector3, mat: PBRMaterial, scene: Scene, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateSphere(n, { diameter: d, segments: 14 }, scene);
    m.position = pos;
    m.material = mat;
    (m as any).castShadows = true;
    if (parent) m.parent = parent;
    return m;
}
