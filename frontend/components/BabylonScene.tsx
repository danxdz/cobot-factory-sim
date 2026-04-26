import React, { useEffect, useRef } from 'react';
import {
    Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4,
    HemisphericLight, DirectionalLight, ShadowGenerator,
    MeshBuilder, PBRMaterial, TransformNode, Mesh,
    PointerEventTypes, PhysicsAggregate, PhysicsShapeType,
    HavokPlugin, AbstractMesh, StandardMaterial, GizmoManager
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { factoryStore } from '../store';
import { simState } from '../simState';
import { MachineRuntimeState, PartSize, PartTemplate, PlacedItem } from '../types';
import {
    createBelt, createSender, createReceiver, createIndexedReceiver,
    createPile, createTable, createCameraEntity, createPartMesh
} from '../babylon/entityMeshes';
import { createCobot, tickCobot, CobotState } from '../babylon/cobotMesh';

const ITEM_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];
const ITEM_SIZES: PartSize[] = ['small', 'medium', 'large'];
const SIZE_DIAMETER: Record<PartSize, number> = { small: 0.44, medium: 0.5, large: 0.56 };
const DISC_H = 0.015;
const DISC_HALF_H = DISC_H / 2;
const DISC_RADIUS = SIZE_DIAMETER.large / 2;
const TILE_CENTER_Y = 0.545;
const TABLE_CENTER_Y = 0.458;
const COBOT_PLATFORM_CENTER_Y = 1.378;
const COBOT_PLATFORM_HALF_W = 0.99;
const COBOT_PLATFORM_HALF_D = 0.99;
const COBOT_PLATFORM_MARGIN = 0.16;
const COBOT_MOUNT_RANGE_Y = 1.58;
const FALLBACK_PART_TEMPLATE: PartTemplate = {
    id: 'fallback_disc',
    name: 'Disk',
    shape: 'disc',
    color: '#94a3b8',
    size: 'medium',
    hasCenterHole: true,
    hasIndexHole: true,
};

function hexToColor3(hex: string): Color3 {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return new Color3(r, g, b);
}

function randomPartSize(): PartSize {
    return ITEM_SIZES[Math.floor(Math.random() * ITEM_SIZES.length)];
}

function partRadius(size: PartSize): number {
    return SIZE_DIAMETER[size] / 2;
}

function partMeshKeyFor(item: {
    shape?: string;
    hasCenterHole?: boolean;
    hasIndexHole?: boolean;
    radiusScale?: number;
    heightScale?: number;
    scaleX?: number;
    scaleZ?: number;
}) {
    // Include geometry in key so pool slot rebuilds when template shape changes
    const rs = (item.radiusScale ?? 1).toFixed(2);
    const hs = (item.heightScale ?? 1).toFixed(2);
    const sx = (item.scaleX ?? 1).toFixed(2);
    const sz = (item.scaleZ ?? 1).toFixed(2);
    return `${item.shape || 'disc'}_${item.hasCenterHole !== false ? 1 : 0}_${item.hasIndexHole !== false ? 1 : 0}_rs${rs}_hs${hs}_sx${sx}_sz${sz}`;
}

function cobotMountLocal(config?: PlacedItem['config']) {
    const grid = config?.stackMatrix || [3, 3];
    const cols = Math.max(1, Math.min(6, Math.round(grid[0] || 3)));
    const rows = Math.max(1, Math.min(6, Math.round(grid[1] || 3)));
    const mountSlot = config?.mountSlot || [cols - 1, rows - 1];
    const mountCol = Math.max(0, Math.min(cols - 1, Math.round(mountSlot[0] ?? (cols - 1))));
    const mountRow = Math.max(0, Math.min(rows - 1, Math.round(mountSlot[1] ?? (rows - 1))));
    const usableW = Math.max(0.2, COBOT_PLATFORM_HALF_W * 2 - COBOT_PLATFORM_MARGIN);
    const usableD = Math.max(0.2, COBOT_PLATFORM_HALF_D * 2 - COBOT_PLATFORM_MARGIN);
    const cellW = usableW / cols;
    const cellD = usableD / rows;
    return {
        x: -usableW / 2 + cellW * (mountCol + 0.5),
        z: -usableD / 2 + cellD * (mountRow + 0.5),
    };
}

export const BabylonScene: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // ── ENGINE & SCENE ──────────────────────────────────────────────────
        const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
        const scene = new Scene(engine);
        scene.clearColor = new Color4(0.06, 0.09, 0.16, 1);

        // ── CAMERA ──────────────────────────────────────────────────────────
        const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.5, 22, Vector3.Zero(), scene);
        camera.lowerRadiusLimit = 5;
        camera.upperRadiusLimit = 60;
        camera.upperBetaLimit = Math.PI / 2.1;
        camera.inertia = 0.82;
        camera.angularSensibilityX = 2200;
        camera.angularSensibilityY = 2200;
        camera.wheelDeltaPercentage = 0.015;
        camera.pinchDeltaPercentage = 0.01;
        camera.panningSensibility = 240;
        camera.attachControl(canvas, true);
        if (camera.inputs.attached.pointers) {
            camera.inputs.attached.pointers.buttons = [0, 2];
        }

        // ── LIGHTS ──────────────────────────────────────────────────────────
        const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
        hemi.intensity = 0.5;
        hemi.diffuse = new Color3(0.6, 0.7, 1.0);

        const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene);
        sun.position = new Vector3(10, 20, 10);
        sun.intensity = 1.6;

        const shadows = new ShadowGenerator(1024, sun);
        shadows.usePoissonSampling = true;

        // ── GIZMOS ──────────────────────────────────────────────────────────
        const gizmoManager = new GizmoManager(scene);
        gizmoManager.positionGizmoEnabled = false;
        gizmoManager.rotationGizmoEnabled = false;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.boundingBoxGizmoEnabled = false;
        gizmoManager.clearGizmoOnEmptyPointerEvent = false;

        if (gizmoManager.gizmos.positionGizmo) {
            // Keep X and Z dragging, disable Y
            gizmoManager.gizmos.positionGizmo.yGizmo.isEnabled = false;
            
            // Smaller, modern gizmo look
            gizmoManager.gizmos.positionGizmo.scaleRatio = 1.0;

            const createModernArrow = (hexColor: string) => {
                const mat = new StandardMaterial("modernGizmoMat", scene);
                mat.emissiveColor = Color3.FromHexString(hexColor);
                mat.disableLighting = true;
                mat.alpha = 0.9;
                
                // Cone only, centered but offset outward
                const cone = MeshBuilder.CreateCylinder("cone", { diameterTop: 0, diameterBottom: 0.4, height: 0.8, tessellation: 32 }, scene);
                cone.material = mat;
                cone.position.y = 0.5; // Offset slightly from center
                return cone;
            };

            gizmoManager.gizmos.positionGizmo.xGizmo.setCustomMesh(createModernArrow('#ef4444')); // Red for X
            gizmoManager.gizmos.positionGizmo.zGizmo.setCustomMesh(createModernArrow('#3b82f6')); // Blue for Z

            // Update React state when drag ends
            gizmoManager.gizmos.positionGizmo.onDragEndObservable.add(() => {
                const st = factoryStore.getState();
                if (st.moveModeItemId && gizmoManager.attachedNode) {
                    const pos = gizmoManager.attachedNode.position;
                    const itemToMove = st.placedItems.find(i => i.id === st.moveModeItemId);
                    if (itemToMove) {
                        const snapStep = itemToMove.type === 'camera' ? 0.5 : 2.5;
                        const gx = Math.round(pos.x / snapStep) * snapStep;
                        const gz = Math.round(pos.z / snapStep) * snapStep;
                        
                        let gy = itemToMove.position[1];
                        if (itemToMove.type === 'camera') {
                            const topY = getSupportSurfaceY(gx, gz, st.placedItems);
                            gy = topY === DISC_HALF_H ? 0 : topY;
                        }

                        const occupied = itemToMove.type !== 'camera' && st.placedItems.some(i =>
                            i.id !== itemToMove.id && Math.abs(i.position[0] - gx) < 0.1 && Math.abs(i.position[2] - gz) < 0.1
                        );

                        if (!occupied) {
                            st.updatePlacedItem(st.moveModeItemId, {
                                position: [gx, gy, gz]
                            });
                        } else {
                            // If snapped position is occupied, snap back to original valid position
                            gizmoManager.attachedNode.position.set(itemToMove.position[0], itemToMove.position[1], itemToMove.position[2]);
                        }
                    }
                }
            });
        }

        // ── GROUND ──────────────────────────────────────────────────────────
        const floorMat = new PBRMaterial('floor', scene);
        floorMat.albedoColor = new Color3(0.05, 0.07, 0.12);
        floorMat.metallic = 0;
        floorMat.roughness = 1;

        const floor = MeshBuilder.CreateGround('floorVisual', { width: 40, height: 40 }, scene);
        floor.material = floorMat;
        floor.receiveShadows = true;
        floor.isPickable = true; // needed for cursor

        // Grid lines
        const gridMat = new PBRMaterial('grid', scene);
        gridMat.albedoColor = new Color3(0.12, 0.18, 0.24);
        gridMat.metallic = 0;
        gridMat.roughness = 1;
        for (let i = -10; i <= 10; i++) {
            const lx = MeshBuilder.CreateBox(`gx${i}`, { width: 50, height: 0.01, depth: 0.03 }, scene);
            lx.position.z = i * 2.5; lx.material = gridMat; lx.isPickable = false;
            const lz = MeshBuilder.CreateBox(`gz${i}`, { width: 0.03, height: 0.01, depth: 50 }, scene);
            lz.position.x = i * 2.5; lz.material = gridMat; lz.isPickable = false;
        }

        // ── PHYSICS (ground only, parts use manual simulation) ───────────────
        const partMeshes: Mesh[] = [];
        const partMeshKinds: string[] = [];
        const velY = new Map<number, number>(); // pool index → vertical velocity

        HavokPhysics().then((havok) => {
            try {
                const plugin = new HavokPlugin(true, havok);
                scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
                const groundCol = MeshBuilder.CreateGround('groundCol', { width: 100, height: 100 }, scene);
                groundCol.isVisible = false;
                new PhysicsAggregate(groundCol, PhysicsShapeType.BOX, { mass: 0 }, scene);
            } catch (e) { console.warn('Physics init:', e); }
        });

        // ── ENTITY REGISTRY ─────────────────────────────────────────────────
        const entityNodes = new Map<string, TransformNode>();
        const cobotStates = new Map<string, CobotState>();

        function cobotRuntimeState(cState: CobotState, isRunning: boolean): MachineRuntimeState {
            if (!isRunning) return { health: 'idle', label: 'Idle', detail: 'Simulation stopped' };
            if (cState.safetyStopped) return { health: 'warning', label: 'Collision', detail: 'This cobot is paused after a local collision' };
            if (cState.blockedTimer > 0.18) return { health: 'warning', label: 'Struggling', detail: 'Obstacle contact while trying to move' };
            if (cState.isFull) return { health: 'stopped', label: 'Full', detail: 'Container stack is at capacity' };
            if (cState.phase === 'release') return { health: 'running', label: 'Dropping', detail: 'Releasing part onto target' };
            if (['pick_hover', 'pick_descend', 'pick_attach'].includes(cState.phase)) {
                return { health: 'running', label: 'Picking', detail: 'Aligning with pickup target' };
            }
            if (['hover_drop', 'descend_drop'].includes(cState.phase)) {
                return { health: 'running', label: 'Placing', detail: 'Approaching drop position' };
            }
            if (['lift', 'transit_drop', 'next', 'wait_step'].includes(cState.phase)) {
                return { health: 'running', label: 'Moving', detail: 'Transferring part between stations' };
            }
            if (cState.targetedItem || cState.grabbedItem) {
                return { health: 'running', label: 'Tracking', detail: 'Following active job' };
            }
            if ((cState.program?.length || 0) > 0) {
                return { health: 'running', label: 'Ready', detail: 'Waiting for next valid pickup' };
            }
            return { health: 'idle', label: 'Idle', detail: 'No programmed work' };
        }

        function applyCobotStatusVisual(cState: CobotState, runtime: MachineRuntimeState) {
            let hex = '#334155';
            let emissive = new Color3(0.02, 0.03, 0.04);
            if (runtime.health === 'running') {
                hex = '#22c55e';
                emissive = Color3.FromHexString('#22c55e').scale(0.45);
            } else if (runtime.health === 'warning') {
                hex = '#f59e0b';
                emissive = Color3.FromHexString('#f59e0b').scale(0.5);
            } else if (runtime.health === 'stopped') {
                hex = '#ef4444';
                emissive = Color3.FromHexString('#ef4444').scale(0.45);
            }
            cState.statusDisplayMat.albedoColor = Color3.FromHexString(hex);
            cState.statusDisplayMat.emissiveColor = emissive;
        }

        function disposeNode(node: TransformNode) {
            node.getChildMeshes().forEach(m => m.dispose());
            node.getChildTransformNodes().forEach(t => t.dispose());
            node.dispose();
        }

        function buildEntityMesh(item: PlacedItem, isGhost = false): TransformNode | null {
            switch (item.type) {
                case 'belt':            return createBelt(item, scene, isGhost);
                case 'sender':          return createSender(item, scene, isGhost);
                case 'receiver':        return createReceiver(item, scene, isGhost);
                case 'indexed_receiver':return createIndexedReceiver(item, scene, isGhost);
                case 'pile':            return createPile(item, scene, isGhost);
                case 'table':           return createTable(item, scene, isGhost);
                case 'camera':          return createCameraEntity(item, scene, isGhost);
                case 'cobot': {
                    const { node, state } = createCobot(item, scene, isGhost);
                    if (state && !isGhost) {
                        cobotStates.set(item.id, state);
                        node.getChildMeshes().forEach(m => shadows.addShadowCaster(m));
                    }
                    return node;
                }
                default: return null;
            }
        }

        // Tracks position+rotation signature per entity to detect changes
        const entitySigs = new Map<string, string>();

        function syncEntities(placedItems: PlacedItem[]) {
            // Remove deleted
            for (const [id, node] of entityNodes) {
                if (!placedItems.find(i => i.id === id)) {
                    disposeNode(node);
                    entityNodes.delete(id);
                    cobotStates.delete(id);
                    entitySigs.delete(id);
                }
            }
            // Add new or rebuild on position/rotation change
            for (const item of placedItems) {
                const visualConfigSig = ['cobot', 'belt', 'sender', 'receiver', 'indexed_receiver', 'pile', 'table', 'camera'].includes(item.type)
                    ? JSON.stringify({
                        stackMatrix: item.config?.stackMatrix,
                        mountSlot: item.config?.mountSlot,
                        stackMax: item.config?.stackMax,
                        beltSize: item.config?.beltSize,
                        beltHeight: item.config?.beltHeight,
                        beltBorders: item.config?.beltBorders,
                        machineSize: item.config?.machineSize,
                        machineHeight: item.config?.machineHeight,
                        showBeam: item.config?.showBeam,
                        tableSize: item.config?.tableSize,
                        tableHeight: item.config?.tableHeight,
                        tableGrid: item.config?.tableGrid,
                        showTableGrid: item.config?.showTableGrid,
                        showWalls: item.config?.showWalls,
                    })
                    : '';
                const sig = `${item.position.join(',')}_${item.rotation}_${visualConfigSig}`;
                if (!entityNodes.has(item.id)) {
                    const node = buildEntityMesh(item, item.id === 'draft_item');
                    if (node) { entityNodes.set(item.id, node); entitySigs.set(item.id, sig); }
                } else if (entitySigs.get(item.id) !== sig) {
                    // Position or rotation changed — dispose and rebuild
                    disposeNode(entityNodes.get(item.id)!);
                    entityNodes.delete(item.id);
                    cobotStates.delete(item.id);
                    const node = buildEntityMesh(item, item.id === 'draft_item');
                    if (node) { entityNodes.set(item.id, node); entitySigs.set(item.id, sig); }
                }
            }
            // Sync cobot state (program/speed/cameras) without rebuilding mesh
            const cameras = placedItems.filter(i => i.type === 'camera');
            const obstacles = placedItems.filter(i => i.type !== 'camera');
            for (const [id, cState] of cobotStates) {
                cState.cameras = cameras;
                cState.obstacles = obstacles.filter(i => i.id !== id);
                const itm = placedItems.find(i => i.id === id);
                if (itm) {
                    cState.selfItem = itm;
                    if (itm.config?.triggerUnlock && (cState as any).lastUnlockTime !== itm.config.triggerUnlock) {
                        (cState as any).lastUnlockTime = itm.config.triggerUnlock;
                        cState.safetyStopped = false;
                        cState.phase = 'idle';
                        if (cState.grabbedItem) {
                            cState.grabbedItem.state = 'free';
                            cState.grabbedItem = null;
                        }
                        cState.targetedItem = null;
                        cState.blockedTimer = 0;
                        cState.targetTimer = 0;
                        cState.desiredTarget.copyFrom(cState.idleTarget);
                    }
                    if (!itm.config?.collisionStopped) cState.safetyStopped = false;
                    cState.program = itm.config?.program || [];
                    cState.speed = itm.config?.speed || 1.0;
                    cState.pickColors = itm.config?.pickColors || [];
                    cState.pickSizes = itm.config?.pickSizes || [];
                    cState.linkedCameraIds = itm.config?.linkedCameraIds || [];
                    cState.autoOrganize = itm.config?.autoOrganize === true;
                }
            }
            const activeCobotIds = new Set(cobotStates.keys());
            const storeState = factoryStore.getState();
            for (const id of Object.keys(storeState.machineStates)) {
                if (!activeCobotIds.has(id)) {
                    const next = { ...storeState.machineStates };
                    delete next[id];
                    factoryStore.setState({ machineStates: next });
                }
            }
        }

        // ── BUILD CURSOR ────────────────────────────────────────────────────
        const cursorMatOk = new PBRMaterial('curOk', scene);
        cursorMatOk.albedoColor = new Color3(0.06, 0.73, 0.51);
        cursorMatOk.alpha = 0.35;
        cursorMatOk.transparencyMode = 2;

        const cursorMatBad = new PBRMaterial('curBad', scene);
        cursorMatBad.albedoColor = new Color3(0.94, 0.27, 0.27);
        cursorMatBad.alpha = 0.35;
        cursorMatBad.transparencyMode = 2;

        const cursorMesh = MeshBuilder.CreateGround('cursor', { width: 2, height: 2 }, scene);
        cursorMesh.material = cursorMatOk;
        cursorMesh.isVisible = false;
        cursorMesh.isPickable = false;
        cursorMesh.position.y = 0.02;

        let ghostNode: TransformNode | null = null;

        const teachZoneRoot = new TransformNode('teachZones', scene);
        const pickZoneMat = new PBRMaterial('pickZoneMat', scene);
        pickZoneMat.albedoColor = Color3.FromHexString('#22c55e');
        pickZoneMat.emissiveColor = Color3.FromHexString('#22c55e').scale(0.8);
        pickZoneMat.alpha = 0.86;
        pickZoneMat.transparencyMode = 2;

        const dropZoneMat = new PBRMaterial('dropZoneMat', scene);
        dropZoneMat.albedoColor = Color3.FromHexString('#ef4444');
        dropZoneMat.emissiveColor = Color3.FromHexString('#ef4444').scale(0.8);
        dropZoneMat.alpha = 0.86;
        dropZoneMat.transparencyMode = 2;

        const pickCoreMat = new StandardMaterial('pickCoreMat', scene);
        pickCoreMat.emissiveColor = Color3.FromHexString('#4ade80');
        pickCoreMat.disableLighting = true;
        pickCoreMat.disableDepthWrite = true;

        const dropCoreMat = new StandardMaterial('dropCoreMat', scene);
        dropCoreMat.emissiveColor = Color3.FromHexString('#f87171');
        dropCoreMat.disableLighting = true;
        dropCoreMat.disableDepthWrite = true;

        const armRangeMat = new PBRMaterial('armRangeMat', scene);
        armRangeMat.albedoColor = Color3.FromHexString('#f8fafc');
        armRangeMat.emissiveColor = Color3.FromHexString('#f8fafc').scale(0.22);
        armRangeMat.alpha = 0.5;
        armRangeMat.transparencyMode = 2;

        const cameraLinkRoot = new TransformNode('cameraLinkHighlights', scene);
        const linkedCameraMat = new PBRMaterial('linkedCameraMat', scene);
        linkedCameraMat.albedoColor = Color3.FromHexString('#67e8f9');
        linkedCameraMat.emissiveColor = Color3.FromHexString('#67e8f9').scale(0.85);
        linkedCameraMat.alpha = 0.82;
        linkedCameraMat.transparencyMode = 2;

        function clearTeachZones() {
            teachZoneRoot.getChildMeshes().forEach(m => m.dispose());
        }

        function clearCameraHighlights() {
            cameraLinkRoot.getChildMeshes().forEach(m => m.dispose());
        }

        let teachZoneSig = '';
        function updateTeachZones(st: ReturnType<typeof factoryStore.getState>) {
            const selected = st.placedItems.find(i => i.id === st.selectedItemId);
            const showPoints = selected?.config?.showTeachPoints ?? selected?.config?.showTeachZones ?? true;
            const showRange = selected?.config?.showArmRange ?? selected?.config?.showTeachZones ?? true;
            const nextSig = selected && selected.type === 'cobot' && (showPoints || showRange)
                ? JSON.stringify({
                    id: selected.id,
                    rotation: selected.rotation,
                    position: selected.position,
                    mountSlot: selected.config?.mountSlot,
                    stackMatrix: selected.config?.stackMatrix,
                    program: selected.config?.program || [],
                    showPoints,
                    showRange,
                })
                : '';
            if (nextSig === teachZoneSig) return;
            teachZoneSig = nextSig;
            clearTeachZones();
            if (!selected || selected.type !== 'cobot') return;
            const isOnOtherCobot = (pos: [number, number, number]) => st.placedItems.some(item =>
                item.id !== selected.id &&
                item.type === 'cobot' &&
                Math.abs(pos[0] - item.position[0]) <= COBOT_PLATFORM_HALF_W &&
                Math.abs(pos[2] - item.position[2]) <= COBOT_PLATFORM_HALF_D
            );
            if (showRange) {
                const baseRotY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][selected.rotation] ?? 0;
                const mountLocal = cobotMountLocal(selected.config);
                const localX = mountLocal.x;
                const localZ = mountLocal.z;
                const mountX = selected.position[0] + localX * Math.cos(baseRotY) + localZ * Math.sin(baseRotY);
                const mountZ = selected.position[2] - localX * Math.sin(baseRotY) + localZ * Math.cos(baseRotY);
                const range = MeshBuilder.CreateTorus('arm_range_ring', {
                    diameter: 5.55,
                    thickness: 0.025,
                    tessellation: 96,
                }, scene);
                range.position.set(mountX, selected.position[1] + COBOT_MOUNT_RANGE_Y, mountZ);
                range.material = armRangeMat;
                range.isPickable = false;
                range.parent = teachZoneRoot;
            }
            if (showPoints) {
                (selected.config?.program || []).forEach((step, idx) => {
                    if ((step.action !== 'pick' && step.action !== 'drop') || !step.pos) return;
                    const mat = step.action === 'pick' ? pickZoneMat : dropZoneMat;
                    const cMat = step.action === 'pick' ? dropCoreMat : pickCoreMat;
                    const y = Math.max(0.06, step.pos[1] + 0.03);
                    
                    const ball = MeshBuilder.CreateSphere(`teach_${step.action}_ball_${idx}`, {
                        diameter: 0.34,
                        segments: 24,
                    }, scene);
                    ball.position.set(step.pos[0], y + 0.28, step.pos[2]);
                    ball.material = mat;
                    ball.isPickable = false;
                    ball.parent = teachZoneRoot;

                    const surfaceY = getSupportSurfaceY(step.pos[0], step.pos[2], st.placedItems);
                    const isClipping = step.pos[1] < surfaceY - 0.04;

                    if (isClipping) {
                        const core = MeshBuilder.CreateSphere(`teach_${step.action}_core_${idx}`, {
                            diameter: 0.18, // slightly larger so it's obvious
                            segments: 16,
                        }, scene);
                        core.position.copyFrom(ball.position);
                        core.material = dropCoreMat; // Always red for warning
                        core.isPickable = false;
                        core.parent = teachZoneRoot;
                        core.renderingGroupId = 2;
                    }
                });
            }
        }

        let cameraHighlightSig = '';
        function updateCameraHighlights(st: ReturnType<typeof factoryStore.getState>) {
            const selected = st.placedItems.find(i => i.id === st.selectedItemId);
            const linkedIds = selected?.type === 'cobot' ? selected.config?.linkedCameraIds || [] : [];
            const linkedCams = st.placedItems.filter(i => i.type === 'camera' && linkedIds.includes(i.id));
            const nextSig = selected?.type === 'cobot'
                ? JSON.stringify({ cobot: selected.id, cams: linkedCams.map(cam => [cam.id, cam.position, cam.name]) })
                : '';
            if (nextSig === cameraHighlightSig) return;
            cameraHighlightSig = nextSig;
            clearCameraHighlights();
            linkedCams.forEach((cam, idx) => {
                const ring = MeshBuilder.CreateTorus(`linked_cam_ring_${idx}`, {
                    diameter: 0.72,
                    thickness: 0.035,
                    tessellation: 48,
                }, scene);
                ring.position.set(cam.position[0], cam.position[1] + 3.8, cam.position[2]);
                ring.material = linkedCameraMat;
                ring.isPickable = false;
                ring.parent = cameraLinkRoot;

                const marker = MeshBuilder.CreateBox(`linked_cam_marker_${idx}`, {
                    width: 0.16,
                    height: 0.16,
                    depth: 0.16,
                }, scene);
                marker.position.set(cam.position[0], cam.position[1] + 3.8, cam.position[2]);
                marker.material = linkedCameraMat;
                marker.isPickable = false;
                marker.parent = cameraLinkRoot;
            });
        }

        // ── POINTER EVENTS ──────────────────────────────────────────────────
        scene.onPointerObservable.add((info) => {
            const st = factoryStore.getState();

            if (info.type === PointerEventTypes.POINTERMOVE) {
                if (!st.buildMode && !st.teachAction) {
                    cursorMesh.isVisible = false;
                    if (ghostNode) { disposeNode(ghostNode); ghostNode = null; }
                    return;
                }
                const pick = scene.pick(scene.pointerX, scene.pointerY,
                    m => m.name === 'floorVisual');
                if (!pick?.hit || !pick.pickedPoint) { cursorMesh.isVisible = false; return; }

                const snapStep = (st.buildMode === 'camera' || (st.moveModeItemId && st.placedItems.find(i => i.id === st.moveModeItemId)?.type === 'camera')) ? 0.5 : 2.5;
                const gx = Math.round(pick.pickedPoint.x / snapStep) * snapStep;
                const gz = Math.round(pick.pickedPoint.z / snapStep) * snapStep;

                if (st.buildMode) {
                    let gy = 0;
                    if (st.buildMode === 'camera') {
                        const topY = getSupportSurfaceY(gx, gz, st.placedItems);
                        gy = topY === DISC_HALF_H ? 0 : topY;
                    }

                    cursorMesh.isVisible = true;
                    cursorMesh.position.x = gx;
                    cursorMesh.position.y = gy + 0.01;
                    cursorMesh.position.z = gz;

                    const occupied = st.buildMode !== 'camera' && st.placedItems.some(i =>
                        Math.abs(i.position[0] - gx) < 0.1 && Math.abs(i.position[2] - gz) < 0.1
                    );
                    cursorMesh.material = occupied ? cursorMatBad : cursorMatOk;

                    if (ghostNode) { disposeNode(ghostNode); ghostNode = null; }
                    const ghostItem: PlacedItem = {
                        id: '_ghost', type: st.buildMode,
                        position: [gx, gy, gz], rotation: st.buildRotation,
                        config: st.buildConfig as any,
                    };
                    ghostNode = buildEntityMesh(ghostItem, true);
                }
            }

            if (info.type === PointerEventTypes.POINTERTAP) {
                const st2 = factoryStore.getState();
                const pointerEvent = info.event as PointerEvent;
                if (pointerEvent.button === 2) return;

                if (st2.teachAction) {
                    const selItem = st2.placedItems.find(i => i.id === st2.selectedItemId);
                    if (!selItem || selItem.type !== 'cobot') return;

                    // Try clicking directly on an entity mesh first
                    const entityPick = scene.pick(scene.pointerX, scene.pointerY,
                        m => m.isPickable && m.name !== 'floorVisual' && !m.name.startsWith('g'));

                    let snapPos: [number, number, number] | null = null;
                    const yMap: Record<string, number> = {
                        sender: 0.55, receiver: 0.56, pile: 0.55,
                        indexed_receiver: 0.56, table: 0.45
                    };

                    if (entityPick?.hit && entityPick.pickedMesh) {
                        // Find which placed item was clicked
                        for (const [id, node] of entityNodes) {
                            const meshes = [node as AbstractMesh, ...node.getChildMeshes()];
                            if (meshes.some(m => m === entityPick.pickedMesh)) {
                                const it = st2.placedItems.find(i => i.id === id);
                                if (it && it.type !== 'cobot') {
                                    // External entity: snap to entity center
                                    snapPos = [it.position[0], it.type === 'table' ? (it.config?.tableHeight || 0.45) : (yMap[it.type] ?? 0.56), it.position[2]];
                                } else if (it && it.type === 'cobot') {
                                    // Clicked on cobot itself (own slots) — use exact picked point on surface
                                    if (entityPick.pickedPoint) {
                                        snapPos = [
                                            Math.round(entityPick.pickedPoint.x * 100) / 100,
                                            Math.round(entityPick.pickedPoint.y * 100) / 100 + 0.02,
                                            Math.round(entityPick.pickedPoint.z * 100) / 100
                                        ];
                                    }
                                }
                                break;
                            }
                        }
                    }

                    // Fallback: floor click → snap to nearest entity
                    if (!snapPos) {
                        const floorPick = scene.pick(scene.pointerX, scene.pointerY, m => m.name === 'floorVisual');
                        if (floorPick?.hit && floorPick.pickedPoint) {
                            const fx = floorPick.pickedPoint.x, fz = floorPick.pickedPoint.z;
                            let minD = 1.5;
                            for (const it of st2.placedItems) {
                                if (it.type === 'cobot' || it.type === 'belt' || it.type === 'camera') continue;
                                const d = Math.sqrt((it.position[0]-fx)**2 + (it.position[2]-fz)**2);
                                if (d < minD) { minD = d; snapPos = [it.position[0], it.type === 'table' ? (it.config?.tableHeight || 0.45) : (yMap[it.type]??0.56), it.position[2]]; }
                            }
                            if (!snapPos) snapPos = [Math.round(fx/2)*2, 0.56, Math.round(fz/2)*2];
                        }
                    }

                    if (snapPos) {
                        const prog = [...(selItem.config?.program || []), { action: st2.teachAction, pos: snapPos }];
                        st2.updatePlacedItem(selItem.id, { config: { ...selItem.config, program: prog } });
                        const cs = cobotStates.get(selItem.id);
                        if (cs) cs.program = prog;
                        st2.setTeachAction(null);
                    }
                    return;
                }

                if (st2.buildMode) {
                    const pick = scene.pick(scene.pointerX, scene.pointerY,
                        m => m.name === 'floorVisual');
                    if (!pick?.hit || !pick.pickedPoint) return;
                    const snapStep = st2.buildMode === 'camera' ? 0.5 : 2.5;
                    const gx = Math.round(pick.pickedPoint.x / snapStep) * snapStep;
                    const gz = Math.round(pick.pickedPoint.z / snapStep) * snapStep;
                    
                    let gy = 0;
                    if (st2.buildMode === 'camera') {
                        const topY = getSupportSurfaceY(gx, gz, st2.placedItems);
                        gy = topY === DISC_HALF_H ? 0 : topY;
                    }
                    
                    // Cameras are pole-mounted — they can share a tile with other entities
                    const occupied = st2.buildMode !== 'camera' && st2.placedItems.some(i =>
                        Math.abs(i.position[0] - gx) < 0.1 && Math.abs(i.position[2] - gz) < 0.1
                    );
                    if (!occupied) {
                        if (!st2.draftPlacement) {
                            st2.setDraftPlacement({
                                id: 'draft_item',
                                type: st2.buildMode,
                                position: [gx, gy, gz],
                                rotation: st2.buildRotation,
                                config: st2.buildMode === 'cobot'
                                    ? { ...st2.buildConfig, program: [] }
                                    : st2.buildConfig,
                            });
                        }
                    }
                    return;
                }

                if (st2.moveModeItemId) {
                    const pick = scene.pick(scene.pointerX, scene.pointerY, m => m.name === 'floorVisual');
                    if (pick?.hit && pick.pickedPoint) {
                        const itemToMove = st2.placedItems.find(i => i.id === st2.moveModeItemId);
                        if (itemToMove) {
                            const snapStep = itemToMove.type === 'camera' ? 0.5 : 2.5;
                            const gx = Math.round(pick.pickedPoint.x / snapStep) * snapStep;
                            const gz = Math.round(pick.pickedPoint.z / snapStep) * snapStep;
                            
                            let gy = itemToMove.position[1];
                            if (itemToMove.type === 'camera') {
                                const topY = getSupportSurfaceY(gx, gz, st2.placedItems);
                                gy = topY === DISC_HALF_H ? 0 : topY;
                            }

                            const occupied = itemToMove.type !== 'camera' && st2.placedItems.some(i =>
                                i.id !== itemToMove.id && Math.abs(i.position[0] - gx) < 0.1 && Math.abs(i.position[2] - gz) < 0.1
                            );
                            if (!occupied) {
                                st2.updatePlacedItem(itemToMove.id, { position: [gx, gy, gz] });
                            }
                        }
                    }
                    return;
                }

                // Click entity to select
                const pick = scene.pick(scene.pointerX, scene.pointerY,
                    m => m.isPickable && m.name !== 'floorVisual' && !m.name.startsWith('g'));
                if (!pick?.hit) { st2.setSelectedItemId(null); return; }
                const pickedMesh = pick.pickedMesh;
                if (!pickedMesh) return;

                for (const [id, node] of entityNodes) {
                    const children = [node as AbstractMesh, ...node.getChildMeshes(), ...node.getChildTransformNodes()];
                    if (children.some(c => c === pickedMesh || c === pickedMesh.parent)) {
                        st2.setSelectedItemId(id);
                        return;
                    }
                }
            }
        });

        window.addEventListener('keydown', handleKey);
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'r' || e.key === 'R') {
                const st = factoryStore.getState();
                if (st.buildMode) st.setBuildRotation(((st.buildRotation + 1) % 4) as any);
            }
        }

        // ── GRID MAP ────────────────────────────────────────────────────────
        function getGridMap() {
            const map = new Map<string, PlacedItem>();
            factoryStore.getState().placedItems.forEach(item => {
                const key = `${Math.round(item.position[0])},${Math.round(item.position[2])}`;
                map.set(key, item);
            });
            return map;
        }

        function itemSurfaceCenterY(item: PlacedItem): number {
            if (item.type === 'belt') return (item.config?.beltHeight || TILE_CENTER_Y) + DISC_HALF_H + 0.018;
            if (['sender','receiver','indexed_receiver'].includes(item.type)) return (item.config?.machineHeight || TILE_CENTER_Y) + DISC_HALF_H + 0.012;
            if (item.type === 'pile') return (item.config?.machineHeight || 0.7) + DISC_HALF_H + 0.012;
            if (item.type === 'table') return (item.config?.tableHeight || TABLE_CENTER_Y) + DISC_HALF_H + 0.014;
            if (item.type === 'cobot') return COBOT_PLATFORM_CENTER_Y;
            return DISC_HALF_H;
        }

        function itemSupportsPart(item: PlacedItem, x: number, z: number, radius = DISC_RADIUS): boolean {
            if (item.type === 'camera') return false;
            const dx = Math.abs(x - item.position[0]);
            const dz = Math.abs(z - item.position[2]);
            if (item.type === 'table') {
                const [w, d] = item.config?.tableSize || [1.8, 1.8];
                return dx <= w / 2 && dz <= d / 2;
            }
            if (item.type === 'belt') {
                const [w, d] = item.config?.beltSize || [2, 2];
                return dx <= w / 2 && dz <= d / 2;
            }
            if (['sender','receiver','indexed_receiver','pile'].includes(item.type)) {
                const [w, d] = item.config?.machineSize || [2, 2];
                return dx <= w / 2 && dz <= d / 2;
            }
            if (item.type === 'cobot') {
                return dx <= COBOT_PLATFORM_HALF_W && dz <= COBOT_PLATFORM_HALF_D;
            }
            return dx <= 1.0 && dz <= 1.0;
        }

        function getSupportSurfaceY(x: number, z: number, placedItems: PlacedItem[]): number {
            let surfaceY = DISC_HALF_H;
            for (const item of placedItems) {
                if (!itemSupportsPart(item, x, z)) continue;
                surfaceY = Math.max(surfaceY, itemSurfaceCenterY(item));
            }
            return surfaceY;
        }

        function getDriveTile(x: number, z: number, placedItems: PlacedItem[]): PlacedItem | undefined {
            return placedItems.find(item => {
                if (item.type !== 'belt' && item.type !== 'sender') return false;
                const [w, d] = item.type === 'belt' ? (item.config?.beltSize || [2, 2]) : (item.config?.machineSize || [2, 2]);
                return Math.abs(x - item.position[0]) <= w / 2 && Math.abs(z - item.position[2]) <= d / 2;
            });
        }

        function nearbyVisionCrowding(itemId: string, x: number, z: number): number {
            let crowding = 0;
            for (const other of simState.items) {
                if (other.id === itemId || other.state !== 'free') continue;
                const dx = other.pos.x - x;
                const dz = other.pos.z - z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < 0.62) crowding += (0.62 - dist) / 0.62;
            }
            return crowding;
        }

        function updateCameraDetections(cameras: PlacedItem[], placedItems: PlacedItem[]) {
            simState.cameraDetections = [];
            for (const cam of cameras) {
                for (const item of simState.items) {
                    if (item.state !== 'free') continue;
                    const dx = item.pos.x - cam.position[0];
                    const dz = item.pos.z - cam.position[2];
                    const planarDist = Math.sqrt(dx * dx + dz * dz);
                    if (planarDist > 1.65) continue;
                    const centered = Math.max(0, 1 - planarDist / 1.65);
                    const crowdPenalty = Math.min(0.45, nearbyVisionCrowding(item.id, item.pos.x, item.pos.z) * 0.18);
                    const supportPenalty = Math.abs(getSupportSurfaceY(item.pos.x, item.pos.z, placedItems) - item.pos.y) > 0.05 ? 0.2 : 0;
                    const confidence = Math.max(0.05, centered - crowdPenalty - supportPenalty);
                    if (confidence < 0.16) continue;
                    simState.cameraDetections.push({
                        cameraId: cam.id,
                        itemId: item.id,
                        pos: item.pos.clone(),
                        rotY: item.rotY,
                        color: item.color,
                        size: item.size,
                        confidence,
                        planarOffset: planarDist,
                    });
                }
            }
        }

        // ── MAIN LOOP ────────────────────────────────────────────────────────
        let prevItems: PlacedItem[] = [];
        let prevDraft: PlacedItem | null = null;
        let prevMoveModeItemId: string | null = null;
        let elapsed = 0;
        const lastSpawnTime: Record<string, number> = {};
        scene.registerBeforeRender(() => {
            const st = factoryStore.getState();
            const { isRunning, isPaused, placedItems, draftPlacement, moveModeItemId } = st;
            const delta = (isRunning && !isPaused) ? ((engine.getDeltaTime() / 1000) * st.simSpeedMult) : 0;
            elapsed += delta;
            updateTeachZones(st);
            updateCameraHighlights(st);

            // Sync layout
            if (placedItems !== prevItems || draftPlacement !== prevDraft) {
                prevItems = placedItems;
                prevDraft = draftPlacement;
                syncEntities(draftPlacement ? [...placedItems, draftPlacement] : placedItems);
            }

            // Sync gizmo state
            if (moveModeItemId !== prevMoveModeItemId) {
                prevMoveModeItemId = moveModeItemId;
                if (moveModeItemId) {
                    gizmoManager.positionGizmoEnabled = true;
                    const node = entityNodes.get(moveModeItemId);
                    if (node) {
                        const targetItem = placedItems.find(i => i.id === moveModeItemId);
                        if (gizmoManager.gizmos.positionGizmo && targetItem) {
                            gizmoManager.gizmos.positionGizmo.snapDistance = targetItem.type === 'camera' ? 0.5 : 2.5;
                        }
                        gizmoManager.attachToMesh(node as AbstractMesh);
                    }
                } else {
                    gizmoManager.positionGizmoEnabled = false;
                    gizmoManager.attachToMesh(null);
                }
            } else if (moveModeItemId) {
                // If the user changed the position via UI sliders, ensure the Gizmo visually stays synced without triggering an onDrag
                const targetItem = placedItems.find(i => i.id === moveModeItemId);
                if (targetItem && gizmoManager.attachedNode) {
                    // Update only if distance is significant to avoid fighting with onDrag
                    const nPos = gizmoManager.attachedNode.position;
                    if (Math.abs(nPos.x - targetItem.position[0]) > 0.01 || Math.abs(nPos.z - targetItem.position[2]) > 0.01) {
                        gizmoManager.attachedNode.position.set(targetItem.position[0], nPos.y, targetItem.position[2]);
                    }
                }
            }

            if (!st.buildMode && ghostNode) {
                disposeNode(ghostNode); ghostNode = null;
                cursorMesh.isVisible = false;
            }

            if (!isRunning) {
                placedItems.filter(item => item.type === 'cobot').forEach(item => {
                    if (st.machineStates[item.id]?.health === 'stopped') return;
                    const runtime = { health: 'idle', label: 'Idle', detail: 'Simulation stopped' } as MachineRuntimeState;
                    st.setMachineState(item.id, runtime);
                    const cState = cobotStates.get(item.id);
                    if (cState) applyCobotStatusVisual(cState, runtime);
                });
                partMeshes.forEach(m => { if (m) m.isVisible = false; });
                velY.clear();
                return;
            }
            if (isPaused) {
                placedItems.filter(item => item.type === 'cobot').forEach(item => {
                    const runtime = { health: 'idle', label: 'Paused', detail: 'Simulation paused' } as MachineRuntimeState;
                    st.setMachineState(item.id, runtime);
                    const cState = cobotStates.get(item.id);
                    if (cState) applyCobotStatusVisual(cState, runtime);
                });
                return;
            }

            // ── Sender spawn ─────────────────────────────────────────────
            placedItems.forEach(item => {
                if (item.type !== 'sender') return;
                const last = lastSpawnTime[item.id] ?? 0;
                const interval = item.config?.speed || 3;
                if (elapsed - last < interval) return;
                lastSpawnTime[item.id] = elapsed;
                const templates = st.partTemplates?.length ? st.partTemplates : [FALLBACK_PART_TEMPLATE];
                const senderTemplateId = item.config?.spawnTemplateId || 'any';
                const templatePool = senderTemplateId === 'any'
                    ? templates
                    : templates.filter(t => t.id === senderTemplateId);
                const template = templatePool.length > 0
                    ? templatePool[Math.floor(Math.random() * templatePool.length)]
                    : templates[Math.floor(Math.random() * templates.length)] || FALLBACK_PART_TEMPLATE;

                // Color: use template's spawnColors pool if present, else its default color
                const colorPool = template?.spawnColors?.length ? template.spawnColors : null;
                const color = colorPool
                    ? colorPool[Math.floor(Math.random() * colorPool.length)]
                    : (template?.color || ITEM_COLORS[Math.floor(Math.random() * ITEM_COLORS.length)]);

                // Size: use template's spawnSizes pool if present, else its default size
                const sizePool = template?.spawnSizes?.length ? template.spawnSizes : null;
                const size: PartSize = sizePool
                    ? sizePool[Math.floor(Math.random() * sizePool.length)]
                    : (template?.size || randomPartSize());

                simState.items.push({
                    id: Math.random().toString(36).slice(2),
                    templateId: template?.id,
                    shape: template?.shape || 'disc',
                    pos: new Vector3(item.position[0], itemSurfaceCenterY(item) + 0.35, item.position[2]),
                    rotY: Math.random() * Math.PI * 2,
                    state: 'free',
                    color,
                    size,
                    hasCenterHole: template?.hasCenterHole !== false,
                    hasIndexHole: template?.hasIndexHole !== false,
                    // Bake template geometry fine-tune so in-game matches Part Creator
                    radiusScale: template?.radiusScale ?? 1,
                    heightScale: template?.heightScale ?? 1,
                    scaleX: template?.scaleX ?? 1,
                    scaleZ: template?.scaleZ ?? 1,
                });
            });

            updateCameraDetections(placedItems.filter(i => i.type === 'camera'), placedItems);

            // ── Tick cobots ──────────────────────────────────────────────
            for (const [id, cState] of cobotStates) {
                const collided = tickCobot(cState, delta, true);
                const runtime = cobotRuntimeState(cState, true);
                st.setMachineState(id, runtime);
                applyCobotStatusVisual(cState, runtime);
                if (collided) {
                    const owner = placedItems.find(item => item.id === id);
                    if (owner) st.updatePlacedItem(id, { config: { ...owner.config, collisionStopped: true } });
                    const warning = { health: 'warning', label: 'Collision', detail: 'This cobot paused; other machines keep running' } as MachineRuntimeState;
                    st.setMachineState(id, warning);
                    applyCobotStatusVisual(cState, warning);
                } else if (!cState.safetyStopped) {
                    const owner = placedItems.find(item => item.id === id);
                    if (owner?.config?.collisionStopped) {
                        st.updatePlacedItem(id, { config: { ...owner.config, collisionStopped: false } });
                    }
                }
            }

            // ── Manual physics sync ───────────────────────────────────────
            const GRAVITY = 9.81;

            simState.items.forEach((simItem, index) => {
                const meshKey = partMeshKeyFor(simItem);
                if (!partMeshes[index] || partMeshKinds[index] !== meshKey) {
                    partMeshes[index]?.dispose();
                    const partMesh = createPartMesh(scene, {
                        shape: simItem.shape || 'disc',
                        color: simItem.color || '#94a3b8',
                        hasCenterHole: simItem.hasCenterHole,
                        hasIndexHole: simItem.hasIndexHole,
                    }, false, `part_${index}`);
                    shadows.addShadowCaster(partMesh);
                    partMeshes[index] = partMesh;
                    partMeshKinds[index] = meshKey;
                }

                const mesh = partMeshes[index];

                if (simItem.state === 'dead') {
                    mesh.isVisible = false;
                    mesh.position.set(0, -100, 0);
                    velY.delete(index);
                    return;
                }

                mesh.isVisible = true;
                (mesh.material as PBRMaterial).albedoColor = hexToColor3(simItem.color);
                const sizeScale = SIZE_DIAMETER[simItem.size] / 0.6;
                const rs = simItem.radiusScale ?? 1;
                const hs = simItem.heightScale ?? 1;
                const sx = simItem.scaleX ?? 1;
                const sz = simItem.scaleZ ?? 1;
                mesh.scaling.set(sizeScale * rs * sx, hs, sizeScale * rs * sz);

                if (simItem.state === 'grabbed') {
                    // Gripper controls position directly
                    mesh.position.copyFrom(simItem.pos);
                    mesh.rotation.y = simItem.rotY;
                    velY.set(index, 0);
                } else {
                    // ── Manual gravity ────────────────────────────────────
                    let vy = velY.get(index) ?? 0;

                    const gx = Math.round(simItem.pos.x / 2.5) * 2.5;
                    const gz = Math.round(simItem.pos.z / 2.5) * 2.5;
                    const tile = placedItems.find(item =>
                        Math.abs(item.position[0] - gx) < 0.1 && Math.abs(item.position[2] - gz) < 0.1
                    );

                    // Landing surface height (includes cobot top platform level)
                    let surfY = getSupportSurfaceY(simItem.pos.x, simItem.pos.z, placedItems);

                    // ── Stacking: settle on top of highest part below ─────
                    const STACK_R = 0.22; // horizontal snap radius for stacking
                    simState.items.forEach((other, oi) => {
                        if (oi === index) return;
                        if (other.state === 'grabbed' || other.state === 'dead') return;
                        const dx = other.pos.x - simItem.pos.x;
                        const dz = other.pos.z - simItem.pos.z;
                        if (Math.sqrt(dx * dx + dz * dz) < STACK_R) {
                            // Other part is below this one — its top is a surface
                            const otherTop = other.pos.y + DISC_H;
                            if (otherTop > surfY && other.pos.y < simItem.pos.y + DISC_H) {
                                surfY = otherTop;
                            }
                        }
                    });

                    if (simItem.pos.y > surfY + 0.01) {
                        vy -= GRAVITY * delta;
                    } else {
                        vy = 0;
                        simItem.pos.y = surfY;
                    }
                    simItem.pos.y += vy * delta;
                    if (simItem.pos.y < surfY) {
                        simItem.pos.y = surfY;
                        vy = 0;
                    }
                    velY.set(index, vy);

                    // ── Belt / sender push ────────────────────────────────
                    const driveTile = getDriveTile(simItem.pos.x, simItem.pos.z, placedItems);
                    if (driveTile && Math.abs(simItem.pos.y - itemSurfaceCenterY(driveTile)) < 0.05) {
                        const spd = driveTile.config?.speed || 2;
                        const r = driveTile.rotation;
                        simItem.pos.x += (r === 1 ? spd : r === 3 ? -spd : 0) * delta;
                        simItem.pos.z += (r === 2 ? spd : r === 0 ? -spd : 0) * delta;
                        const drivenSurfY = getSupportSurfaceY(simItem.pos.x, simItem.pos.z, placedItems);
                        if (drivenSurfY >= itemSurfaceCenterY(driveTile) - 0.01 && simItem.pos.y < drivenSurfY) {
                            simItem.pos.y = drivenSurfY;
                            velY.set(index, 0);
                        }
                    }

                    // ── Scoring ───────────────────────────────────────────
                    if (tile?.type === 'receiver') {
                        const dist = Math.sqrt((simItem.pos.x - gx) ** 2 + (simItem.pos.z - gz) ** 2);
                        const targetY = (tile.config?.machineHeight || TILE_CENTER_Y) + DISC_HALF_H;
                        const colorOk = !tile.config?.acceptColor || tile.config.acceptColor === 'any'
                            || tile.config.acceptColor === simItem.color;
                        if (dist < 0.35 && Math.abs(simItem.pos.y - targetY) < 0.1 && colorOk) {
                            simItem.state = 'dead';
                            st.setScore(s => s + 1);
                        }
                    }
                    if (tile?.type === 'indexed_receiver') {
                        const dist = Math.sqrt((simItem.pos.x - gx) ** 2 + (simItem.pos.z - gz) ** 2);
                        const targetY = (tile.config?.machineHeight || TILE_CENTER_Y) + DISC_HALF_H;
                        if (dist < 0.3 && Math.abs(simItem.pos.y - targetY) < 0.1) {
                            const norm = ((simItem.rotY % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
                            simItem.state = 'dead';
                            st.setScore(s => s + (norm < 0.3 || norm > Math.PI*2 - 0.3 ? 2 : 1));
                        }
                    }
                    if (simItem.pos.y < -3 || Math.abs(simItem.pos.x) > 60 || Math.abs(simItem.pos.z) > 60) simItem.state = 'dead';

                    mesh.position.copyFrom(simItem.pos);
                    mesh.rotation.y = simItem.rotY;
                }
            });

            simState.items = simState.items.filter(i => i.state !== 'dead');

            // ── Part collision repulsion (belt/floor level only) ────
            const partSpacing = (a: PartSize, b: PartSize) => partRadius(a) + partRadius(b);
            const items = simState.items;
            
            const isRepellable = (item: typeof items[0]) => {
                if (item.state !== 'free') return false;
                if (item.pos.y > 0.65) return false;
                const gx = Math.round(item.pos.x / 2.5) * 2.5;
                const gz = Math.round(item.pos.z / 2.5) * 2.5;
                const tile = placedItems.find(p => Math.abs(p.position[0] - gx) < 0.1 && Math.abs(p.position[2] - gz) < 0.1);
                return !tile || tile.type === 'belt' || tile.type === 'sender';
            };

            for (let i = 0; i < items.length; i++) {
                if (!isRepellable(items[i])) continue;
                for (let j = i + 1; j < items.length; j++) {
                    if (!isRepellable(items[j])) continue;
                    const dx = items[j].pos.x - items[i].pos.x;
                    const dz = items[j].pos.z - items[i].pos.z;
                    const d = Math.sqrt(dx * dx + dz * dz);
                    const minDist = partSpacing(items[i].size, items[j].size);
                    if (d < minDist && d > 0.001) {
                        const push = (minDist - d) * 0.5;
                        const nx = dx / d, nz = dz / d;
                        items[i].pos.x -= nx * push;
                        items[i].pos.z -= nz * push;
                        items[j].pos.x += nx * push;
                        items[j].pos.z += nz * push;
                    }
                }
            }

            // Hide unused pool slots
            for (let i = simState.items.length; i < partMeshes.length; i++) {
                if (partMeshes[i]) partMeshes[i].isVisible = false;
            }
        });

        // ── STORE SUBSCRIPTION ───────────────────────────────────────────────
        const unsub = factoryStore.subscribe(() => {
            const st = factoryStore.getState();
            // When starting sim, pre-spawn pile items
            if (st.isRunning && simState.items.length === 0) {
                st.placedItems.forEach(item => {
                    if (item.type !== 'pile') return;
                    const count = item.config?.pileCount ?? 0;
                    const cols = Math.max(1, Math.min(6, Math.round(item.config?.tableGrid?.[0] || 3)));
                    const rows = Math.max(1, Math.min(6, Math.round(item.config?.tableGrid?.[1] || 3)));
                    const slotsPerLayer = cols * rows;
                    const [w, d] = item.config?.machineSize || [2, 2];
                    const spacingX = Math.min(0.52, Math.max(0.22, w / Math.max(2, cols)));
                    const spacingZ = Math.min(0.52, Math.max(0.22, d / Math.max(2, rows)));
                    const startX = item.position[0] - ((cols - 1) * spacingX) / 2;
                    const startZ = item.position[2] - ((rows - 1) * spacingZ) / 2;
                    const baseY = (item.config?.machineHeight || 0.7) + DISC_HALF_H + 0.02;
                    for (let i = 0; i < count; i++) {
                        const layer = Math.floor(i / slotsPerLayer);
                        const slotIndex = i % slotsPerLayer;
                        const col = slotIndex % cols;
                        const row = Math.floor(slotIndex / cols);
                        simState.items.push({
                            id: Math.random().toString(36).slice(2),
                            templateId: FALLBACK_PART_TEMPLATE.id,
                            shape: 'disc',
                            pos: new Vector3(
                                startX + col * spacingX,
                                baseY + layer * 0.22,
                                startZ + row * spacingZ
                            ),
                            rotY: Math.random() * Math.PI * 2,
                            state: 'free',
                            color: ITEM_COLORS[i % ITEM_COLORS.length],
                            size: ITEM_SIZES[i % ITEM_SIZES.length],
                            hasCenterHole: true,
                            hasIndexHole: true,
                        });
                    }
                });
            }
            if (!st.isRunning) {
                simState.reset();
                Object.keys(lastSpawnTime).forEach(k => delete lastSpawnTime[k]);
            }
        });

        // ── RENDER LOOP ──────────────────────────────────────────────────────
        engine.runRenderLoop(() => scene.render());
        const onResize = () => engine.resize();
        window.addEventListener('resize', onResize);

        // Initial entity sync
        syncEntities(factoryStore.getState().placedItems);

        return () => {
            unsub();
            window.removeEventListener('resize', onResize);
            window.removeEventListener('keydown', handleKey);
            engine.dispose();
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', outline: 'none' }}
        />
    );
};
