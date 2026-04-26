import {
    Scene, MeshBuilder, StandardMaterial, Color3, Vector3,
    TransformNode, Mesh, PBRMaterial, CSG
} from '@babylonjs/core';
import { PartShape, PlacedItem } from '../types';

const ROTATION_MAP = [Math.PI, Math.PI / 2, 0, -Math.PI / 2]; // N,E,S,W

// ─── helpers ────────────────────────────────────────────────────────────────

function pbr(scene: Scene, hex: string, metallic = 0, roughness = 0.8, alpha = 1): PBRMaterial {
    const m = new PBRMaterial('', scene);
    m.albedoColor = Color3.FromHexString(hex);
    m.metallic = metallic;
    m.roughness = roughness;
    if (alpha < 1) { m.alpha = alpha; m.transparencyMode = 2; }
    return m;
}

function box(name: string, w: number, h: number, d: number, pos: Vector3, mat: PBRMaterial, scene: Scene, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    m.position = pos;
    m.material = mat;
    m.receiveShadows = true;
    m.castShadows = true;
    if (parent) m.parent = parent;
    return m;
}

function cyl(name: string, r: number, h: number, pos: Vector3, mat: PBRMaterial, scene: Scene, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateCylinder(name, { diameter: r * 2, height: h, tessellation: 20 }, scene);
    m.position = pos;
    m.material = mat;
    if (parent) m.parent = parent;
    return m;
}

function moduleSize(item: PlacedItem): [number, number] {
    return item.config?.machineSize || [2, 2];
}

function moduleHeight(item: PlacedItem, fallback = 0.538): number {
    return item.config?.machineHeight || fallback;
}

// ─── PLATE MESH (thin precision part) ───────────────────────────────────────

export function createPlateMesh(
    scene: Scene,
    color: string,
    isGhost = false,
    namePrefix = 'plate',
    opts?: { hasCenterHole?: boolean; hasIndexHole?: boolean }
): Mesh {
    const hasCenterHole = opts?.hasCenterHole !== false;
    const hasIndexHole = opts?.hasIndexHole !== false;
    const body = MeshBuilder.CreateCylinder(`${namePrefix}_body`, { diameter: 0.6, height: 0.025, tessellation: 32 }, scene);
    const centerCut = MeshBuilder.CreateCylinder(`${namePrefix}_centerCut`, { diameter: 0.10, height: 0.04, tessellation: 24 }, scene);
    const indexCut = MeshBuilder.CreateCylinder(`${namePrefix}_indexCut`, { diameter: 0.055, height: 0.04, tessellation: 18 }, scene);
    indexCut.position.z = 0.19;

    let plateCsg = CSG.FromMesh(body);
    if (hasCenterHole) plateCsg = plateCsg.subtract(CSG.FromMesh(centerCut));
    if (hasIndexHole) plateCsg = plateCsg.subtract(CSG.FromMesh(indexCut));

    const plate = plateCsg.toMesh(`${namePrefix}_mesh`, undefined, scene);
    body.dispose();
    centerCut.dispose();
    indexCut.dispose();

    const mat = pbr(scene, color, 0.2, 0.4, isGhost ? 0.4 : 1);
    plate.material = mat;
    plate.receiveShadows = true;
    plate.castShadows = true;
    return plate;
}

export function createPartMesh(
    scene: Scene,
    spec: {
        shape: PartShape;
        color: string;
        hasCenterHole?: boolean;
        hasIndexHole?: boolean;
    },
    isGhost = false,
    namePrefix = 'part'
): Mesh {
    const mat = pbr(scene, spec.color, 0.2, 0.45, isGhost ? 0.4 : 1);
    switch (spec.shape) {
        case 'disc':
            return createPlateMesh(scene, spec.color, isGhost, `${namePrefix}_disc`, {
                hasCenterHole: spec.hasCenterHole,
                hasIndexHole: spec.hasIndexHole,
            });
        case 'can': {
            const can = MeshBuilder.CreateCylinder(`${namePrefix}_can`, { diameter: 0.56, height: 0.08, tessellation: 32 }, scene);
            can.material = mat;
            can.receiveShadows = true;
            can.castShadows = true;
            return can;
        }
        case 'box': {
            const bx = MeshBuilder.CreateBox(`${namePrefix}_box`, { width: 0.56, depth: 0.56, height: 0.08 }, scene);
            bx.material = mat;
            bx.receiveShadows = true;
            bx.castShadows = true;
            return bx;
        }
        case 'pyramid': {
            const py = MeshBuilder.CreateCylinder(`${namePrefix}_pyramid`, {
                diameterBottom: 0.62,
                diameterTop: 0.04,
                height: 0.1,
                tessellation: 4
            }, scene);
            py.rotation.y = Math.PI / 4;
            py.material = mat;
            py.receiveShadows = true;
            py.castShadows = true;
            return py;
        }
        default:
            return createPlateMesh(scene, spec.color, isGhost, `${namePrefix}_fallback`, {
                hasCenterHole: spec.hasCenterHole,
                hasIndexHole: spec.hasIndexHole,
            });
    }
}

// ─── BELT ────────────────────────────────────────────────────────────────────

export function createBelt(item: PlacedItem, scene: Scene, isGhost = false): TransformNode {
    const root = new TransformNode(`belt_${item.id}`, scene);
    root.position = new Vector3(...item.position);
    root.rotation.y = ROTATION_MAP[item.rotation];

    const beltWidth = item.config?.beltSize?.[0] || 2;
    const beltDepth = item.config?.beltSize?.[1] || 2;
    const beltHeight = item.config?.beltHeight || 0.538;
    const baseHeight = Math.max(0.2, beltHeight - 0.025);
    const frameMat  = pbr(scene, '#374151', 0, 0.8, isGhost ? 0.4 : 1);
    const beltMat   = pbr(scene, '#1c2028', 0, 0.95, isGhost ? 0.4 : 1);
    const railMat   = pbr(scene, '#6b7280', 0.7, 0.3, isGhost ? 0.4 : 1);
    const rollerMat = pbr(scene, '#9ca3af', 0.8, 0.2, isGhost ? 0.4 : 1);
    const chevMat   = pbr(scene, '#3b82f6', 0.05, 0.7, isGhost ? 0.25 : 0.55); // inlaid belt direction marks
    const outMat    = pbr(scene, '#22c55e', 0.1, 0.3, isGhost ? 0.4 : 1); // green = output end
    if (!isGhost) (outMat as any).emissiveColor = new Color3(0.13, 0.77, 0.37);

    // Frame base
    box('frame', beltWidth, baseHeight, beltDepth, new Vector3(0, baseHeight / 2, 0), frameMat, scene, root);
    // Rubber belt surface
    box('surface', beltWidth * 0.8, 0.025, beltDepth, new Vector3(0, beltHeight - 0.0125, 0), beltMat, scene, root);
    // Side rails
    const railX = beltWidth * 0.415;
    const [showLeftRail, showRightRail] = item.config?.beltBorders || [true, true];
    if (showLeftRail) box('railL', 0.06, 0.12, beltDepth, new Vector3(-railX, beltHeight + 0.045, 0), railMat, scene, root);
    if (showRightRail) box('railR', 0.06, 0.12, beltDepth, new Vector3(railX, beltHeight + 0.045, 0), railMat, scene, root);
    // Small roller caps on rail ends only (no full-width bars)
    [
        { x: -railX, show: showLeftRail },
        { x: railX, show: showRightRail },
    ].forEach(({ x: rx, show }, ri) => {
        if (!show) return;
        const rc = MeshBuilder.CreateCylinder(`rolCap${ri}`, { diameter: 0.12, height: 0.06, tessellation: 12 }, scene);
        rc.rotation.z = Math.PI / 2;
        rc.position = new Vector3(rx, beltHeight - 0.038, -beltDepth / 2 + 0.07);
        rc.material = rollerMat; rc.parent = root;
        const rc2 = MeshBuilder.CreateCylinder(`rolCap${ri}b`, { diameter: 0.12, height: 0.06, tessellation: 12 }, scene);
        rc2.rotation.z = Math.PI / 2;
        rc2.position = new Vector3(rx, beltHeight - 0.038, beltDepth / 2 - 0.07);
        rc2.material = rollerMat; rc2.parent = root;
    });

    // OUTPUT END indicator: green caps on output rail tips (output = +Z local for all rotations)
    if (showLeftRail) box('outL', 0.06, 0.12, 0.08, new Vector3(-railX, beltHeight + 0.045,  beltDepth / 2 - 0.04), outMat, scene, root);
    if (showRightRail) box('outR', 0.06, 0.12, 0.08, new Vector3( railX, beltHeight + 0.045,  beltDepth / 2 - 0.04), outMat, scene, root);

    // Direction chevrons (V shapes pointing in +Z = direction of item flow)
    // Two angled boxes converge at tip in +Z, open at -Z (input)
    const chevY = beltHeight + 0.001;
    const chevLen = Math.min(0.42, beltWidth * 0.22), chevW = 0.045, chevH = 0.004, ang = Math.PI / 5;
    [-beltDepth * 0.16, beltDepth * 0.16].forEach((zOff, ci) => {
        const cL = box(`chL${ci}`, chevLen, chevH, chevW, new Vector3(-0.22, chevY, zOff), chevMat, scene, root);
        cL.rotation.y = -ang;  // tip converges at +Z
        const cR = box(`chR${ci}`, chevLen, chevH, chevW, new Vector3( 0.22, chevY, zOff), chevMat, scene, root);
        cR.rotation.y =  ang;
    });

    return root;
}


// ─── SENDER ──────────────────────────────────────────────────────────────────

export function createSender(item: PlacedItem, scene: Scene, isGhost = false): TransformNode {
    const root = new TransformNode(`sender_${item.id}`, scene);
    root.position = new Vector3(...item.position);
    root.rotation.y = ROTATION_MAP[item.rotation];

    const baseMat = pbr(scene, '#374151', 0, 0.8, isGhost ? 0.4 : 1);
    const glowMat = pbr(scene, '#10b981', 0.1, 0.3, isGhost ? 0.4 : 1);
    glowMat.emissiveColor = new Color3(0.06, 0.73, 0.51);
    const [w, d] = moduleSize(item);
    const h = moduleHeight(item, 0.538);

    box('base', w, h, d, new Vector3(0, h / 2, 0), baseMat, scene, root);
    box('glow', Math.max(0.28, w * 0.6), 0.02, Math.max(0.28, d * 0.6), new Vector3(0, h + 0.01, 0), glowMat, scene, root);

    return root;
}

// ─── RECEIVER ────────────────────────────────────────────────────────────────

export function createReceiver(item: PlacedItem, scene: Scene, isGhost = false): TransformNode {
    const root = new TransformNode(`receiver_${item.id}`, scene);
    root.position = new Vector3(...item.position);
    root.rotation.y = ROTATION_MAP[item.rotation];

    const baseMat = pbr(scene, '#1e3a8a', 0, 0.7, isGhost ? 0.4 : 1);
    const spindleMat = pbr(scene, '#94a3b8', 0.8, 0.2, isGhost ? 0.4 : 1);
    const pegMat = pbr(scene, '#eab308', 0.7, 0.2, isGhost ? 0.4 : 1);
    const [w, d] = moduleSize(item);
    const h = moduleHeight(item, 0.538);

    box('base', w, h, d, new Vector3(0, h / 2, 0), baseMat, scene, root);
    // Central spindle: short peg above surface (parts slot onto it)
    cyl('spindle', 0.05, 0.5, new Vector3(0, h + 0.22, 0), spindleMat, scene, root);
    cyl('peg', 0.025, 0.5, new Vector3(Math.min(0.18, w * 0.18), h + 0.22, 0), pegMat, scene, root);

    return root;
}

// ─── INDEXED RECEIVER ────────────────────────────────────────────────────────

export function createIndexedReceiver(item: PlacedItem, scene: Scene, isGhost = false): TransformNode {
    const root = new TransformNode(`idxrecv_${item.id}`, scene);
    root.position = new Vector3(...item.position);
    root.rotation.y = ROTATION_MAP[item.rotation];

    const baseMat = pbr(scene, '#78350f', 0, 0.7, isGhost ? 0.4 : 1);
    const glowMat = pbr(scene, '#f59e0b', 0.1, 0.3, isGhost ? 0.4 : 1);
    glowMat.emissiveColor = new Color3(0.96, 0.62, 0.04);
    const spindleMat = pbr(scene, '#d4a017', 0.9, 0.1, isGhost ? 0.4 : 1);
    const pegMat = pbr(scene, '#f59e0b', 0.8, 0.2, isGhost ? 0.4 : 1);
    const [w, d] = moduleSize(item);
    const h = moduleHeight(item, 0.538);

    box('base', w, h, d, new Vector3(0, h / 2, 0), baseMat, scene, root);
    cyl('ring', Math.min(0.34, Math.max(0.16, Math.min(w, d) * 0.18)), 0.02, new Vector3(0, h + 0.01, 0), glowMat, scene, root);
    // Short alignment spindle + offset peg
    cyl('spindle', 0.05, 0.5, new Vector3(0, h + 0.22, 0), spindleMat, scene, root);
    cyl('peg', 0.025, 0.5, new Vector3(Math.min(0.18, w * 0.18), h + 0.22, 0), pegMat, scene, root);
    // Alignment cross on surface
    box('crossX', Math.max(0.22, w * 0.45), 0.02, 0.035, new Vector3(0, h + 0.02, 0), glowMat, scene, root);
    box('crossZ', 0.035, 0.02, Math.max(0.22, d * 0.45), new Vector3(0, h + 0.02, 0), glowMat, scene, root);

    return root;
}

// ─── PILE BIN ────────────────────────────────────────────────────────────────

export function createPile(item: PlacedItem, scene: Scene, isGhost = false): TransformNode {
    const root = new TransformNode(`pile_${item.id}`, scene);
    root.position = new Vector3(...item.position);
    root.rotation.y = ROTATION_MAP[item.rotation];

    const wallMat = pbr(scene, '#44403c', 0, 0.9, isGhost ? 0.4 : 1);
    const floorMat = pbr(scene, '#1c1917', 0, 1, isGhost ? 0.4 : 1);
    const [w, d] = moduleSize(item);
    const h = moduleHeight(item, 0.7);
    const wallT = Math.min(0.1, Math.max(0.045, Math.min(w, d) * 0.08));

    const showWalls = item.config?.showWalls !== false;

    box('base', w, h, d, new Vector3(0, h / 2, 0), pbr(scene, '#292524', 0, 0.9, isGhost ? 0.4 : 1), scene, root);
    box('floor', showWalls ? Math.max(0.2, w - wallT * 4) : w, 0.02, showWalls ? Math.max(0.2, d - wallT * 4) : d, new Vector3(0, h + 0.01, 0), floorMat, scene, root);
    
    if (showWalls) {
        box('wallN', w, 0.6, wallT, new Vector3(0, h + 0.3, d / 2 - wallT / 2), wallMat, scene, root);
        box('wallS', w, 0.6, wallT, new Vector3(0, h + 0.3, -d / 2 + wallT / 2), wallMat, scene, root);
        box('wallE', wallT, 0.6, Math.max(0.2, d - wallT * 2), new Vector3(w / 2 - wallT / 2, h + 0.3, 0), wallMat, scene, root);
        box('wallW', wallT, 0.6, Math.max(0.2, d - wallT * 2), new Vector3(-w / 2 + wallT / 2, h + 0.3, 0), wallMat, scene, root);
    }

    const markMat = pbr(scene, '#e2e8f0', 0, 0.6, isGhost ? 0.25 : 0.45);
    markMat.emissiveColor = Color3.FromHexString('#e2e8f0').scale(0.06);

    const [cols, rows] = item.config?.tableGrid || [3, 3];
    const topY = h + 0.022;
    const usableWidth = showWalls ? Math.max(0.2, w - wallT * 4) : w - 0.04;
    const usableDepth = showWalls ? Math.max(0.2, d - wallT * 4) : d - 0.04;
    
    for (let c = 0; c <= cols; c++) {
        const x = -usableWidth / 2 + usableWidth * (c / cols);
        box(`gridCol${c}`, 0.016, 0.008, usableDepth, new Vector3(x, topY, 0), markMat, scene, root);
    }
    for (let r = 0; r <= rows; r++) {
        const z = -usableDepth / 2 + usableDepth * (r / rows);
        box(`gridRow${r}`, usableWidth, 0.008, 0.016, new Vector3(0, topY, z), markMat, scene, root);
    }

    return root;
}

// ─── TABLE ───────────────────────────────────────────────────────────────────

export function createTable(item: PlacedItem, scene: Scene, isGhost = false): TransformNode {
    const root = new TransformNode(`table_${item.id}`, scene);
    root.position = new Vector3(...item.position);

    const tableWidth = item.config?.tableSize?.[0] || 1.8;
    const tableDepth = item.config?.tableSize?.[1] || 1.8;
    const tableHeight = item.config?.tableHeight || 0.45;
    const topThickness = 0.1;
    const legHeight = Math.max(0.18, tableHeight - topThickness / 2);
    const topMat = pbr(scene, '#475569', 0, 0.7, isGhost ? 0.4 : 1);
    const legMat = pbr(scene, '#334155', 0, 0.8, isGhost ? 0.4 : 1);
    const markMat = pbr(scene, '#e2e8f0', 0, 0.6, isGhost ? 0.25 : 0.45);
    markMat.emissiveColor = Color3.FromHexString('#e2e8f0').scale(0.12);

    box('top', tableWidth, topThickness, tableDepth, new Vector3(0, tableHeight - topThickness / 2, 0), topMat, scene, root);
    const legX = Math.max(0.08, tableWidth / 2 - 0.12);
    const legZ = Math.max(0.08, tableDepth / 2 - 0.12);
    [[-legX, legZ], [legX, legZ], [-legX, -legZ], [legX, -legZ]].forEach(([x, z], i) => {
        box(`leg${i}`, 0.1, legHeight, 0.1, new Vector3(x, legHeight / 2, z), legMat, scene, root);
    });
    if (item.config?.showTableGrid !== false) {
        const [cols, rows] = item.config?.tableGrid || [3, 3];
        const safeCols = Math.max(1, Math.min(6, cols || 2));
        const safeRows = Math.max(1, Math.min(6, rows || 2));
        const topY = tableHeight + 0.006;
        const usableWidth = tableWidth - 0.18;
        const usableDepth = tableDepth - 0.18;
        for (let c = 0; c <= safeCols; c++) {
            const x = -usableWidth / 2 + usableWidth * (c / safeCols);
            box(`gridCol${c}`, 0.02, 0.012, usableDepth, new Vector3(x, topY, 0), markMat, scene, root);
        }
        for (let r = 0; r <= safeRows; r++) {
            const z = -usableDepth / 2 + usableDepth * (r / safeRows);
            box(`gridRow${r}`, usableWidth, 0.012, 0.02, new Vector3(0, topY, z), markMat, scene, root);
        }
        for (let c = 0; c < safeCols; c++) {
            const x = -usableWidth / 2 + usableWidth * ((c + 0.5) / safeCols);
            for (let r = 0; r < safeRows; r++) {
                const z = -usableDepth / 2 + usableDepth * ((r + 0.5) / safeRows);
                cyl(`gridDot${c}_${r}`, Math.min(0.065, Math.max(0.035, Math.min(usableWidth / safeCols, usableDepth / safeRows) * 0.13)), 0.01, new Vector3(x, topY + 0.006, z), markMat, scene, root);
            }
        }
    }

    return root;
}

// ─── CAMERA SENSOR ───────────────────────────────────────────────────────────

export function createCameraEntity(item: PlacedItem, scene: Scene, isGhost = false): TransformNode {
    const root = new TransformNode(`cam_${item.id}`, scene);
    root.position = new Vector3(...item.position);
    root.rotation.y = ROTATION_MAP[item.rotation];

    const poleMat = pbr(scene, '#1e293b', 0, 0.9, isGhost ? 0.4 : 1);
    const bodyMat = pbr(scene, '#cbd5e1', 0, 0.5, isGhost ? 0.4 : 1);
    const lensMat = pbr(scene, '#0f172a', 0, 1, isGhost ? 0.4 : 1);

    cyl('pole', 0.05, 3.2, new Vector3(-0.9, 1.6, 0.9), poleMat, scene, root);

    const camRoot = new TransformNode('camRoot', scene);
    camRoot.parent = root;
    camRoot.position = new Vector3(-0.9, 3.2, 0.9);
    // Aim from corner mount toward the tile center.
    const toCenter = new Vector3(-camRoot.position.x, 0, -camRoot.position.z);
    camRoot.rotation.y = Math.atan2(-toCenter.z, toCenter.x);
    camRoot.rotation.z = 0.38; // Tilt down toward work surface

    box('camBody', 0.3, 0.4, 0.3, new Vector3(0, 0, 0), bodyMat, scene, camRoot);
    cyl('lens', 0.1, 0.15, new Vector3(0, -0.275, 0), lensMat, scene, camRoot);

    // Vision cone - parented to camRoot so it points correctly
    if (!isGhost && item.config?.showBeam !== false) {
        const coneMat = pbr(scene, '#10b981', 0, 1);
        coneMat.alpha = 0.12;
        coneMat.transparencyMode = 2;
        coneMat.backFaceCulling = false;
        const cone = MeshBuilder.CreateCylinder(`cone_${item.id}`, {
            diameterTop: 0.02, diameterBottom: 2.6, height: 3.32, tessellation: 32
        }, scene);
        cone.position = new Vector3(0, -1.66, 0); // half of height
        cone.material = coneMat;
        cone.isPickable = false;
        cone.parent = camRoot;
    }

    return root;
}
