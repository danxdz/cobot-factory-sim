import {
    Color3,
    Mesh,
    MeshBuilder,
    Scene,
    StandardMaterial,
    TransformNode,
    Vector3,
} from '@babylonjs/core';
import type { PlacedItem } from '../../types';
import {
    COBOT_BODY_D,
    COBOT_BODY_H,
    COBOT_BODY_W,
    COBOT_FOREARM_LENGTH,
    COBOT_GRIPPER_TIP_OFFSET,
    COBOT_HAND_LINK_LENGTH,
    COBOT_PEDESTAL_BOTTOM_RADIUS_MAX,
    COBOT_PEDESTAL_BOTTOM_RADIUS_MIN,
    COBOT_PEDESTAL_HEIGHT,
    COBOT_PLATFORM_D,
    COBOT_PLATFORM_MARGIN,
    COBOT_PLATFORM_THICKNESS,
    COBOT_PLATFORM_TOP_Y,
    COBOT_PLATFORM_W,
    COBOT_UPPER_ARM_DIAMETER_DEFAULT,
    COBOT_UPPER_ARM_LENGTH,
    COBOT_WRIST_LINK_LENGTH,
    DISC_H,
    STACK_SLOT_COLORS,
} from './constants';
import {
    cobotDefaultAngles,
    cobotForearmDiameter,
    cobotForearmLength,
    cobotUpperArmDiameter,
    cobotUpperArmLength,
    cobotWristDiameter,
    cobotWristLength,
} from './cobotConfig';
import { box, cyl, pbr } from './meshBuilders';
import { clamp } from './math';
import type { CobotState, StackSlot } from './stateTypes';

function defaultCobotIdleTarget(item: PlacedItem): Vector3 {
    return new Vector3(
        item.position[0],
        item.position[1] + 2.2,
        item.position[2]
    );
}

function configTargetToVector(target?: [number, number, number] | null): Vector3 | null {
    if (!target) return null;
    return new Vector3(target[0], target[1], target[2]);
}

export function createCobot(item: PlacedItem, scene: Scene, isGhost = false): { node: TransformNode; state?: CobotState } {
    const alpha = isGhost ? 0.35 : 1;
    const baseRotY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][item.rotation] ?? 0;

    // ── Materials ──────────────────────────────────────────────────────────
    const amrBody = pbr(scene, '#1e2433', 0.1, 0.8, alpha);   // dark chassis
    const amrPanel = pbr(scene, '#f1f3f5', 0.05, 0.5, alpha);  // white panel
    const amrAccentG = pbr(scene, '#22c55e', 0.1, 0.3, alpha);   // green LED strip
    const amrEdge = pbr(scene, '#374151', 0.3, 0.6, alpha);   // edge trim
    const linkMat = pbr(scene, '#cdd3d8', 0.65, 0.25, alpha);
    const jointMat = pbr(scene, '#7b8794', 0.75, 0.2, alpha);
    const gripMat = pbr(scene, '#2d3748', 0.4, 0.5, alpha);
    const wheelMat = pbr(scene, '#0d0d14', 0.1, 0.9, alpha);

    if (!isGhost) {
        amrAccentG.emissiveColor = new Color3(0.13, 0.77, 0.37);
    }

    // ── Root ───────────────────────────────────────────────────────────────
    const root = new TransformNode(`cobot_root_${item.id}`, scene);
    root.position = new Vector3(...item.position);
    root.rotation.y = baseRotY;

    // ── AMR BODY (fills 2x2 tile, taller & wider) ──────────────────────────
    const BW = COBOT_BODY_W, BD = COBOT_BODY_D, BH = COBOT_BODY_H;
    box('chassis', BW, BH, BD, new Vector3(0, BH / 2, 0), amrBody, scene, root);
    box('fPanel', BW - 0.1, BH - 0.18, 0.026, new Vector3(0, BH / 2, BD / 2 - 0.012), amrPanel, scene, root);
    box('bPanel', BW - 0.1, BH - 0.18, 0.026, new Vector3(0, BH / 2, -BD / 2 + 0.012), amrPanel, scene, root);
    box('sPanel1', 0.026, BH - 0.18, BD - 0.1, new Vector3(BW / 2 - 0.012, BH / 2, 0), amrPanel, scene, root);
    box('sPanel2', 0.026, BH - 0.18, BD - 0.1, new Vector3(-BW / 2 + 0.012, BH / 2, 0), amrPanel, scene, root);
    // Logo/display on front panel
    const statusDisplayMat = pbr(scene, '#334155', 0, 0.9, alpha);
    if (!isGhost) statusDisplayMat.emissiveColor = new Color3(0.02, 0.03, 0.04);
    const statusDisplay = box('display', 0.56, 0.3, 0.016, new Vector3(0, BH * 0.56, BD / 2 + 0.01), statusDisplayMat, scene, root);
    box('display2', 0.56, 0.3, 0.016, new Vector3(0, BH * 0.56, -BD / 2 - 0.01), statusDisplayMat, scene, root);
    box('display3', 0.016, 0.3, 0.56, new Vector3(BW / 2 + 0.01, BH * 0.56, 0), statusDisplayMat, scene, root);
    box('display4', 0.016, 0.3, 0.56, new Vector3(-BW / 2 - 0.01, BH * 0.56, 0), statusDisplayMat, scene, root);
    // Green accent strips on all vertical edges
    const es = 0.035, eh = BH;
    box('eFL', es, eh, es, new Vector3(-BW / 2 + 0.02, BH / 2, BD / 2 - 0.02), amrAccentG, scene, root);
    box('eFR', es, eh, es, new Vector3(BW / 2 - 0.02, BH / 2, BD / 2 - 0.02), amrAccentG, scene, root);
    box('eBL', es, eh, es, new Vector3(-BW / 2 + 0.02, BH / 2, -BD / 2 + 0.02), amrAccentG, scene, root);
    box('eBR', es, eh, es, new Vector3(BW / 2 - 0.02, BH / 2, -BD / 2 + 0.02), amrAccentG, scene, root);
    // Edge trim on top perimeter
    box('trimF', BW, 0.04, 0.04, new Vector3(0, BH, BD / 2 - 0.02), amrEdge, scene, root);
    box('trimB', BW, 0.04, 0.04, new Vector3(0, BH, -BD / 2 + 0.02), amrEdge, scene, root);
    box('trimL', 0.04, 0.04, BD, new Vector3(-BW / 2 + 0.02, BH, 0), amrEdge, scene, root);
    box('trimR', 0.04, 0.04, BD, new Vector3(BW / 2 - 0.02, BH, 0), amrEdge, scene, root);

    // Wheels (4x side-mounted cylinders)
    const wheelY = 0.22;
    const wheelZ = Math.max(0.46, BD * 0.28);
    [[-BW / 2 - 0.04, wheelY, wheelZ], [BW / 2 + 0.04, wheelY, wheelZ],
    [-BW / 2 - 0.04, wheelY, -wheelZ], [BW / 2 + 0.04, wheelY, -wheelZ]].forEach((p, i) => {
        const wm = MeshBuilder.CreateCylinder(`wh${i}`, { diameter: 0.32, height: 0.1, tessellation: 20 }, scene);
        wm.rotation.z = Math.PI / 2; wm.position = new Vector3(p[0], p[1], p[2]);
        wm.material = wheelMat; wm.parent = root;
    });

    // ── BACK PLATFORM (clean stacking area) ───────────────────────────────
    const matrix = item.config?.stackMatrix || [3, 3];
    const cols = Math.max(1, Math.min(6, Math.round(matrix[0] || 3)));
    const rows = Math.max(1, Math.min(6, Math.round(matrix[1] || 3)));
    const usableW = Math.max(0.2, COBOT_PLATFORM_W - COBOT_PLATFORM_MARGIN);
    const usableD = Math.max(0.2, COBOT_PLATFORM_D - COBOT_PLATFORM_MARGIN);
    const platMat = pbr(scene, '#0d1117', 0.05, 0.95, alpha);
    const gridMat = pbr(scene, '#e2e8f0', 0, 0.65, isGhost ? 0.22 : 0.42);
    if (!isGhost) gridMat.emissiveColor = Color3.FromHexString('#e2e8f0').scale(0.08);
    box('topPlat', COBOT_PLATFORM_W, COBOT_PLATFORM_THICKNESS, COBOT_PLATFORM_D, new Vector3(0, BH + COBOT_PLATFORM_THICKNESS / 2, 0), platMat, scene, root);
    const gridY = COBOT_PLATFORM_TOP_Y + 0.003;
    for (let c = 0; c <= cols; c++) {
        const x = -usableW / 2 + usableW * (c / cols);
        box(`stackGridCol${c}`, 0.016, 0.008, usableD, new Vector3(x, gridY, 0), gridMat, scene, root);
    }
    for (let r = 0; r <= rows; r++) {
        const z = -usableD / 2 + usableD * (r / rows);
        box(`stackGridRow${r}`, usableW, 0.008, 0.016, new Vector3(0, gridY, z), gridMat, scene, root);
    }
    const slotCenterY = COBOT_PLATFORM_TOP_Y + DISC_H / 2;
    const cellW = usableW / cols;
    const cellD = usableD / rows;
    const mountSlot = item.config?.mountSlot || [cols - 1, rows - 1];
    const mountCol = Math.max(0, Math.min(cols - 1, Math.round(mountSlot[0] ?? (cols - 1))));
    const mountRow = Math.max(0, Math.min(rows - 1, Math.round(mountSlot[1] ?? (rows - 1))));
    const mountLocalX = -usableW / 2 + cellW * (mountCol + 0.5);
    const mountLocalZ = -usableD / 2 + cellD * (mountRow + 0.5);
    const markerRadius = Math.max(0.06, Math.min(0.2, Math.min(cellW, cellD) * 0.16));
    const stackLocalPos: Array<{ col: number; row: number; pos: Vector3 }> = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const x = -usableW / 2 + cellW * (col + 0.5);
            const z = -usableD / 2 + cellD * (row + 0.5);
            stackLocalPos.push({ col, row, pos: new Vector3(x, slotCenterY, z) });
        }
    }
    stackLocalPos.forEach((slot, index) => {
        if (slot.col === mountCol && slot.row === mountRow) return;
        const slotColor = STACK_SLOT_COLORS[index % STACK_SLOT_COLORS.length];
        const markMat = pbr(scene, slotColor, 0.1, 0.45, isGhost ? 0.25 : 0.65);
        if (!isGhost) markMat.emissiveColor = Color3.FromHexString(slotColor).scale(0.16);
        cyl(`stMark${index}`, markerRadius, 0.012, new Vector3(slot.pos.x, COBOT_PLATFORM_TOP_Y + 0.007, slot.pos.z), markMat, scene, root);
    });
    const upperArmLen = cobotUpperArmLength(item.config);
    const forearmLen = cobotForearmLength(item.config);
    const wristLen = cobotWristLength(item.config);
    const upperArmRadius = cobotUpperArmDiameter(item.config) / 2;
    const forearmRadius = cobotForearmDiameter(item.config) / 2;
    const wristRadius = cobotWristDiameter(item.config) / 2;
    const mountCell = Math.min(cellW, cellD);
    const maxSegmentDiameter = Math.max(upperArmRadius * 2, forearmRadius * 2, wristRadius * 2);
    const thicknessScale = clamp(maxSegmentDiameter / COBOT_UPPER_ARM_DIAMETER_DEFAULT, 0.72, 1.7);
    const pedestalScale = clamp(1 + (thicknessScale - 1) * 0.35, 0.82, 1.28);
    const pedestalRadiusScale = clamp(item.config?.cobotPedestalRadiusScale ?? 1, 0.6, 1.8);
    const baseRingRadiusScale = clamp(item.config?.cobotBaseRingRadiusScale ?? 1, 0.6, 1.8);
    const pedestalHeight = clamp(item.config?.cobotPedestalHeight ?? COBOT_PEDESTAL_HEIGHT, 0.18, 0.8);
    const pedestalRadiusBase = Math.max(0.17, Math.min(0.26, mountCell * 0.32));
    const baseRingRadiusBase = Math.max(0.21, Math.min(0.34, mountCell * 0.38));
    const pedestalRadius = clamp(pedestalRadiusBase * pedestalScale * pedestalRadiusScale, 0.14, 0.52);
    const baseRingRadius = clamp(baseRingRadiusBase * pedestalScale * baseRingRadiusScale, 0.16, 0.58);
    const pedestalBottomRadius = clamp(
        Math.max(baseRingRadius + 0.035, pedestalRadius + 0.075),
        COBOT_PEDESTAL_BOTTOM_RADIUS_MIN,
        COBOT_PEDESTAL_BOTTOM_RADIUS_MAX
    );
    // Reduced collision radius to allow closer operation to own pedestal
    const mountCollisionRadius = Math.max(baseRingRadius, pedestalBottomRadius) * 0.82;
    const shoulderJointRadius = clamp((item.config?.cobotShoulderJointDiameter ?? ((upperArmRadius + 0.05) * 2)) * 0.5, 0.07, 0.45);
    const elbowJointRadius = clamp((item.config?.cobotElbowJointDiameter ?? ((Math.max(upperArmRadius, forearmRadius) + 0.04) * 2)) * 0.5, 0.07, 0.45);
    const wristJointRadius = clamp((item.config?.cobotWristJointDiameter ?? ((Math.max(forearmRadius, wristRadius) + 0.03) * 2)) * 0.5, 0.06, 0.36);
    const toolJointRadius = clamp((item.config?.cobotToolJointDiameter ?? ((wristRadius + 0.02) * 2)) * 0.5, 0.05, 0.3);
    const shoulderJointLen = clamp(item.config?.cobotShoulderJointLength ?? 0.44, 0.12, 1.2);
    const elbowJointLen = clamp(item.config?.cobotElbowJointLength ?? 0.44, 0.12, 1.2);
    const wristJointLen = clamp(item.config?.cobotWristJointLength ?? 0.3, 0.1, 0.9);
    const toolJointLen = clamp(item.config?.cobotToolJointLength ?? 0.26, 0.08, 0.7);

    // ── ARM MOUNT — configurable slot within platform grid ──
    const mountBase = new TransformNode('mountBase', scene);
    mountBase.parent = root;
    mountBase.position = new Vector3(mountLocalX, COBOT_PLATFORM_TOP_Y, mountLocalZ);

    // Pedestal / turret base sized to one grid cell (1/9 of platform) and tapered
    const pedestal = MeshBuilder.CreateCylinder('pedestal', {
        diameterBottom: pedestalBottomRadius * 2,
        diameterTop: pedestalRadius * 2,
        height: pedestalHeight,
        tessellation: 32
    }, scene);
    pedestal.position = new Vector3(0, pedestalHeight / 2, 0);
    pedestal.material = amrEdge;
    pedestal.parent = mountBase;

    const basePivot = new TransformNode('basePivot', scene);
    basePivot.parent = mountBase;
    basePivot.position.y = pedestalHeight;
    const baseRing = cyl('baseRing', baseRingRadius, 0.075, new Vector3(0, 0.01, 0), jointMat, scene, basePivot);

    // ── LINK 1 — upper arm (offset laterally to allow folding) ────────────
    const shoulder = new TransformNode('shoulder', scene);
    shoulder.parent = basePivot;
    shoulder.position.y = 0.04;
    const shoulderVisualOffset = new Vector3(
        clamp(item.config?.cobotShoulderVisualOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotShoulderVisualOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotShoulderVisualOffsetZ ?? 0, -0.6, 0.6)
    );
    const elbowVisualOffset = new Vector3(
        clamp(item.config?.cobotElbowVisualOffsetX ?? 0.18, -0.6, 0.6),
        clamp(item.config?.cobotElbowVisualOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotElbowVisualOffsetZ ?? 0, -0.6, 0.6)
    );
    const wristVisualOffset = new Vector3(
        clamp(item.config?.cobotWristVisualOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotWristVisualOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotWristVisualOffsetZ ?? 0, -0.6, 0.6)
    );
    const shoulderJointOffset = new Vector3(
        clamp(item.config?.cobotShoulderJointOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotShoulderJointOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotShoulderJointOffsetZ ?? 0, -0.6, 0.6)
    );
    const elbowJointOffset = new Vector3(
        clamp(item.config?.cobotElbowJointOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotElbowJointOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotElbowJointOffsetZ ?? 0, -0.6, 0.6)
    );
    const wristJointOffset = new Vector3(
        clamp(item.config?.cobotWristJointOffsetX ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotWristJointOffsetY ?? 0, -0.6, 0.6),
        clamp(item.config?.cobotWristJointOffsetZ ?? 0, -0.6, 0.6)
    );
    const j0 = cyl('j0', shoulderJointRadius, shoulderJointLen, shoulderJointOffset, jointMat, scene, shoulder);
    j0.rotation.z = Math.PI / 2;
    const link1VisualLen = Math.max(0.2, upperArmLen - 0.04);
    const link1 = cyl('link1', upperArmRadius, link1VisualLen, new Vector3(shoulderVisualOffset.x, link1VisualLen / 2 + shoulderVisualOffset.y, shoulderVisualOffset.z), linkMat, scene, shoulder);

    // ── LINK 2 — forearm (centered, bypassing link1) ──────────────────────
    const elbow = new TransformNode('elbow', scene);
    elbow.parent = shoulder;
    elbow.position.y = upperArmLen;
    // Keep elbow joint axis tunable per-segment; this is visual-only.
    const j1 = cyl('j1', elbowJointRadius, elbowJointLen, elbowJointOffset, jointMat, scene, elbow);
    j1.rotation.z = Math.PI / 2;
    const link2VisualLen = Math.max(0.2, forearmLen - 0.05);
    // Middle link runs off-axis for clearance and wider apparent articulation.
    const link2 = cyl('link2', forearmRadius, link2VisualLen, new Vector3(elbowVisualOffset.x, link2VisualLen / 2 + elbowVisualOffset.y, elbowVisualOffset.z), linkMat, scene, elbow);

    // ── LINK 3 — wrist tube ───────────────────────────────────────────────
    const wrist = new TransformNode('wrist', scene);
    wrist.parent = elbow;
    wrist.position.set(0, forearmLen, 0);
    // Wrist + hand can be fine-tuned visually per segment.
    const j2 = cyl('j2', wristJointRadius, wristJointLen, wristJointOffset, jointMat, scene, wrist);
    j2.rotation.z = Math.PI / 2;
    const link3 = cyl('link3', wristRadius, wristLen, new Vector3(wristVisualOffset.x, wristLen / 2 + wristVisualOffset.y, wristVisualOffset.z), linkMat, scene, wrist);

    // ── WRIST ROLL ────────────────────────────────────────────────────────
    const wristRoll = new TransformNode('wristRoll', scene);
    wristRoll.parent = wrist;
    wristRoll.position.y = wristLen;
    cyl('j3', toolJointRadius, toolJointLen, Vector3.Zero(), jointMat, scene, wristRoll);

    // ── HAND PITCH (Extra joint) ──────────────────────────────────────────
    cyl('handLink', 0.08, COBOT_HAND_LINK_LENGTH, new Vector3(0, COBOT_HAND_LINK_LENGTH / 2, 0), linkMat, scene, wristRoll);

    const handPitch = new TransformNode('handPitch', scene);
    handPitch.parent = wristRoll;
    handPitch.position.y = COBOT_HAND_LINK_LENGTH;
    const j4 = cyl('j4', Math.max(0.075, toolJointRadius - 0.015), 0.22, Vector3.Zero(), jointMat, scene, handPitch);
    j4.rotation.z = Math.PI / 2;

    // Suction nozzle
    cyl('nozzle', 0.045, 0.2, new Vector3(0, 0.1, 0), gripMat, scene, handPitch);
    const padMat = pbr(scene, '#0d0d14', 0.1, 0.95, alpha);
    const suctionPad = MeshBuilder.CreateCylinder('suctionPad', { diameter: 0.32, height: 0.026, tessellation: 32 }, scene) as Mesh;
    suctionPad.position = new Vector3(0, 0.21, 0);
    suctionPad.material = padMat; suctionPad.parent = handPitch;

    const vacMat = pbr(scene, '#10b981', 0.1, 0.3, alpha);
    if (!isGhost) vacMat.emissiveColor = new Color3(0.06, 0.73, 0.51);
    const vacRing = MeshBuilder.CreateTorus('vacRing', { diameter: 0.27, thickness: 0.016, tessellation: 32 }, scene) as Mesh;
    vacRing.position = new Vector3(0, 0.224, 0);
    vacRing.material = vacMat; vacRing.parent = handPitch;

    const leftFinger = suctionPad;
    const rightFinger = suctionPad;

    const gripperTip = new TransformNode('gripperTip', scene);
    gripperTip.parent = handPitch;
    gripperTip.position.y = COBOT_GRIPPER_TIP_OFFSET;

    if (isGhost) return { node: root };

    const proximityMats: StandardMaterial[] = [];
    const mat = new StandardMaterial(`proxMat_${item.id}`, scene);
    mat.alpha = 0; // invisible logic sphere

    const collisionSphere = MeshBuilder.CreateSphere(`collision_${item.id}`, { diameter: 1.0, segments: 16 }, scene);
    collisionSphere.parent = wrist;
    collisionSphere.position.set(0, wristLen + 0.1, 0); // centered near wrist/tool section
    collisionSphere.material = mat;
    collisionSphere.isPickable = false;

    // Visual proximity sensors (4-way around wrist: front/right/back/left)
    const sensorLights: Mesh[] = [];
    const sensorOffsets: Array<[number, number, number]> = [
        [0, 0.1, 0.13],   // front
        // Side indicators follow hazard order directly (front/right/back/left).
        [0.13, 0.1, 0],   // right
        [0, 0.1, -0.13],  // back
        [-0.13, 0.1, 0],  // left
    ];
    for (let i = 0; i < sensorOffsets.length; i++) {
        const camMat = new StandardMaterial(`camMat_${item.id}_${i}`, scene);
        camMat.emissiveColor = Color3.FromHexString('#22c55e');
        camMat.disableLighting = true;
        proximityMats.push(camMat);

        const camMesh = MeshBuilder.CreateSphere(`camMesh_${item.id}_${i}`, { diameter: 0.04, segments: 8 }, scene);
        camMesh.material = camMat;
        camMesh.parent = wrist;

        camMesh.position.set(sensorOffsets[i][0], sensorOffsets[i][1] + wristLen, sensorOffsets[i][2]);
        sensorLights.push(camMesh);
    }

    // Path Visualization Line
    const pathLine = MeshBuilder.CreateLines(`pathLine_${item.id}`, {
        points: [Vector3.Zero(), Vector3.Up()],
        updatable: true
    }, scene);
    pathLine.isPickable = false;
    pathLine.color = Color3.FromHexString('#22d3ee'); // Cyan path
    pathLine.alpha = 0.65;
    pathLine.renderingGroupId = 2; // Render over floor but under some UI
    if (!isGhost) {
        const pathMat = new StandardMaterial(`pathMat_${item.id}`, scene);
        pathMat.emissiveColor = Color3.FromHexString('#22d3ee');
        pathMat.alpha = 0.65;
        pathLine.material = pathMat;
    }

    // Idle: saved home pose if present, otherwise hover directly over its own platform.
    const idleTarget = configTargetToVector(item.config?.cobotHomeTarget) ?? defaultCobotIdleTarget(item);

    // Compute world positions of the stack slots (apply root rotation)
    const maxStack = item.config?.stackMax || 10;

    const stackSlots: StackSlot[] = stackLocalPos
        .filter(slot => !(slot.col === mountCol && slot.row === mountRow))
        .map((slot, index) => {
            const lp = slot.pos;
            const wx = item.position[0] + lp.x * Math.cos(baseRotY) + lp.z * Math.sin(baseRotY);
            const wy = item.position[1] + lp.y;
            const wz = item.position[2] - lp.x * Math.sin(baseRotY) + lp.z * Math.cos(baseRotY);
            return {
                worldPos: new Vector3(wx, wy, wz),
                maxStack,
                color: STACK_SLOT_COLORS[index % STACK_SLOT_COLORS.length],
                col: slot.col,
                row: slot.row,
            };
        });

    const state: CobotState = {
        root, mountBase, basePivot, shoulder, elbow, wrist, wristRoll, handPitch,
        leftFinger, rightFinger, gripperTip, statusDisplay, statusDisplayMat,
        proximityMats, collisionSphere, proximityMult: 1.0, sensorLights,
        pathLine,
        ikTarget: idleTarget.clone(),
        lastSafeIkTarget: idleTarget.clone(),
        ikVelocity: Vector3.Zero(),
        desiredTarget: idleTarget.clone(),
        wristRollTarget: 0, currentWristRoll: 0,
        gripperOpen: true, currentGripperPos: 0,
        blockedTimer: 0,
        motionStallTimer: 0,
        partContactTimer: 0,
        lastProbePos: idleTarget.clone(),
        simTime: 0,
        targetTimer: 0,
        skippedTargetIds: {},
        safetyStopped: false,
        isOutOfRange: false,
        stalledInternal: false,
        enableRepulsion: true,
        recoveryTimer: 0,
        overdriveScore: 0,
        avoidanceSide: 0,
        avoidanceBias: Vector3.Zero(),
        retreatTarget: null,
        retreatTimer: 0,
        recoveryAttempts: 0,
        plannedPath: [idleTarget.clone()],
        plannedPathCursor: 0,
        plannedPathGoal: idleTarget.clone(),
        plannedPathPhase: 'idle',
        pathReplanCooldown: 0,
        precalculatedPath: [idleTarget.clone()],
        lockedFlowGoal: idleTarget.clone(),
        lockedFlowPhase: 'idle',
        lockedPickupTarget: null,
        lockedPickupItemId: null,
        lockedPickupUntil: 0,
        targetSource: 'unknown',
        yieldTarget: null,
        yieldUntil: 0,
        avoidDropTarget: null,
        avoidDropUntil: 0,
        dropExitTarget: null,
        dropReplanStreak: 0,
        lastReplanTargetKey: '',
        phase: 'idle', stepIndex: 0,
        targetedItem: null, grabbedItem: null, waitTimer: 0,
        autoDropTarget: null,
        activeDropTarget: null,
        position: item.position, baseRotY,
        program: item.config?.program || [],
        speed: item.config?.speed || 1.0,
        selfItem: item,
        cameras: [], obstacles: [],
        pickColors: item.config?.pickColors || [],
        pickSizes: item.config?.pickSizes || [],
        linkedCameraIds: item.config?.linkedCameraIds || [],
        autoOrganize: item.config?.autoOrganize === true,
        idleTarget,
        manualControl: item.config?.cobotManualControl === true,
        manualTarget: configTargetToVector(item.config?.cobotManualTarget),
        stackSlots, mountCollisionRadius, isFull: false,
        sensorLights,
        tuningMode: false,
        sensorHazards: [0, 0, 0, 0],
        sensorMinDist: 2,
        safetySpeedFactor: 1,
        reducedSpeedActive: false,
        lastLoggedPhase: 'idle',
        lastStatusReasonKey: '',
        lastStatusReasonAt: -9999,
        tuningHighlightTargets: {
            shoulder: [link1],
            elbow: [link2],
            wrist: [link3],
            shoulder_joint: [j0],
            elbow_joint: [j1],
            wrist_joint: [j2],
            pedestal: [pedestal],
            base: [baseRing],
        },
        lastTuningHighlightKey: undefined,
        jointTorques: [0, 0, 0, 0],
        lastJointAngles: [0, 0, 0, 0],
    };
    return { node: root, state };
}
