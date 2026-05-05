import React, { useEffect, useRef } from 'react';
import {
    Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4,
    HemisphericLight, DirectionalLight, ShadowGenerator,
    MeshBuilder, PBRMaterial, TransformNode, Mesh, LinesMesh, FreeCamera, RenderTargetTexture,
    PointerEventTypes, PhysicsAggregate, PhysicsShapeType,
    HavokPlugin, AbstractMesh, StandardMaterial, GizmoManager
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { factoryStore } from '../store';
import { simState } from '../simState';
import { MachineRuntimeState, PartShape, PartSize, PartTemplate, PlacedItem } from '../types';
import {
    createBelt, createSender, createReceiver, createIndexedReceiver,
    createPile, createTable, createCameraEntity, createPartMesh
} from '../babylon/entityMeshes';
import { createCobot, tickCobot, CobotState, COBOT_PEDESTAL_SAFEZONE_RADIUS, COBOT_PEDESTAL_HEIGHT } from '../babylon/cobotMesh';

const ITEM_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];
const ITEM_SIZES: PartSize[] = ['small', 'medium', 'large'];
const SIZE_DIAMETER: Record<PartSize, number> = { small: 0.44, medium: 0.5, large: 0.56 };
const DISC_RADIUS = SIZE_DIAMETER.large / 2;
const TILE_CENTER_Y = 0.545;
const TABLE_CENTER_Y = 0.458;
const COBOT_PLATFORM_CENTER_Y = 1.378;
const COBOT_PLATFORM_TOP_Y = 1.37;
const COBOT_PLATFORM_W = 1.98;
const COBOT_PLATFORM_D = 1.98;
const COBOT_PLATFORM_MARGIN = 0.16;
const COBOT_MOUNT_RANGE_Y = 1.58;
const COBOT_PEDESTAL_VISIBLE_RADIUS = COBOT_PEDESTAL_SAFEZONE_RADIUS;
const COBOT_PEDESTAL_BUBBLE_RADIUS = Math.max(0.035, COBOT_PEDESTAL_SAFEZONE_RADIUS * 1.2);
const SHAPE_BASE_DIAMETER: Record<PartShape, number> = { disc: 0.6, can: 0.56, box: 0.56, pyramid: 0.62 };
const SHAPE_BASE_HEIGHT: Record<PartShape, number> = { disc: 0.025, can: 0.08, box: 0.08, pyramid: 0.1 };
const DEFAULT_PART_HALF = SHAPE_BASE_HEIGHT.disc / 2;
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

function partShape(spec: { shape?: PartShape }): PartShape {
    return spec.shape ?? 'disc';
}

function partScaleXZ(spec: { size: PartSize; radiusScale?: number }): number {
    return (SIZE_DIAMETER[spec.size] / 0.6) * (spec.radiusScale ?? 1);
}

function partHalfHeight(spec: { shape?: PartShape; heightScale?: number }): number {
    return (SHAPE_BASE_HEIGHT[partShape(spec)] ?? SHAPE_BASE_HEIGHT.disc) * (spec.heightScale ?? 1) / 2;
}

function partRadius(spec: { size: PartSize; shape?: PartShape; radiusScale?: number; scaleX?: number; scaleZ?: number }): number {
    const shape = partShape(spec);
    const xScale = partScaleXZ(spec) * (spec.scaleX ?? 1);
    const zScale = partScaleXZ(spec) * (spec.scaleZ ?? 1);
    if (shape === 'box') {
        const halfW = (SHAPE_BASE_DIAMETER.box / 2) * xScale;
        const halfD = (SHAPE_BASE_DIAMETER.box / 2) * zScale;
        return Math.sqrt(halfW * halfW + halfD * halfD);
    }
    const baseR = (SHAPE_BASE_DIAMETER[shape] ?? SHAPE_BASE_DIAMETER.disc) / 2;
    return baseR * Math.max(xScale, zScale);
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
    const usableW = Math.max(0.2, COBOT_PLATFORM_W - COBOT_PLATFORM_MARGIN);
    const usableD = Math.max(0.2, COBOT_PLATFORM_D - COBOT_PLATFORM_MARGIN);
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
        const engine = new Engine(canvas, true, { adaptToDeviceRatio: false });
        const dpr = window.devicePixelRatio || 1;
        if (dpr > 1.25) {
            // Render slightly below native DPI on dense screens to reduce frame-time spikes.
            engine.setHardwareScalingLevel(Math.min(2, dpr / 1.25));
        }
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
                            gy = topY <= DEFAULT_PART_HALF + 0.0001 ? 0 : topY;
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
        const lastStateByItemId = new Map<string, 'free' | 'targeted' | 'grabbed' | 'dead'>();
        const justReleasedUntil = new Map<string, number>();
        const velY = new Map<number, number>(); // pool index → vertical velocity
        const velXZ = new Map<number, Vector3>(); // pool index → planar velocity
        const spinY = new Map<number, number>(); // pool index → angular yaw speed

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
        const previewCams = new Map<string, FreeCamera>();
        const previewRTTs = new Map<string, RenderTargetTexture>();
        const previewCaptureAt = new Map<string, number>();
        const previewPending = new Set<string>();

        function cobotRuntimeState(cState: CobotState, isRunning: boolean): MachineRuntimeState {
            if (!isRunning) return { health: 'idle', label: 'Idle', detail: 'Simulation stopped' };
            if (cState.manualControl && cState.manualTarget) return { health: 'idle', label: 'Arm Jog', detail: 'Manual arm target active' };
            if (cState.safetyStopped) return { health: 'warning', label: 'Safety Stop', detail: 'Paused due to obstruction or rule violation' };
            if (cState.reducedSpeedActive) {
                const speedPct = Math.round((cState.safetySpeedFactor || 1) * 100);
                return { health: 'warning', label: 'Reduced Speed', detail: `Safety zone active (${speedPct}% speed)` };
            }
            if (cState.blockedTimer > 0.18) return { health: 'warning', label: 'Obstructed', detail: 'Obstacle repulsion active while moving' };
            if (cState.isFull) return { health: 'stopped', label: 'Full', detail: 'Container stack is at capacity' };
            if (cState.phase === 'release') return { health: 'running', label: 'Dropping', detail: 'Releasing part onto target' };
            if (['pick_hover', 'pick_descend', 'pick_attach', 'pick_recenter'].includes(cState.phase)) {
                return { health: 'running', label: 'Picking', detail: 'Aligning with pickup target' };
            }
            if (['hover_drop', 'descend_drop', 'drop_recenter'].includes(cState.phase)) {
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

        function buildEntityMesh(item: PlacedItem, isGhost = false, oldState?: CobotState): TransformNode | null {
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
                        // Transfer runtime state from old instance if provided
                        if (oldState) {
                            // Basic kinematic state
                            state.ikTarget.copyFrom(oldState.ikTarget);
                            state.lastSafeIkTarget.copyFrom(oldState.lastSafeIkTarget);
                            state.ikVelocity.copyFrom(oldState.ikVelocity);
                            state.desiredTarget.copyFrom(oldState.desiredTarget);
                            state.currentWristRoll = oldState.currentWristRoll;
                            state.currentGripperPos = oldState.currentGripperPos;
                            state.gripperOpen = oldState.gripperOpen;
                            
                            // Execution state
                            state.phase = oldState.phase;
                            state.stepIndex = oldState.stepIndex;
                            state.targetedItem = oldState.targetedItem;
                            state.grabbedItem = oldState.grabbedItem;
                            state.waitTimer = oldState.waitTimer;
                            state.targetTimer = oldState.targetTimer;
                            state.skippedTargetIds = { ...oldState.skippedTargetIds };
                            state.isAutoProgram = oldState.isAutoProgram;
                            
                            // Logic & Safety
                            state.safetyStopped = oldState.safetyStopped;
                            state.blockedTimer = oldState.blockedTimer;
                            state.motionStallTimer = oldState.motionStallTimer;
                            state.partContactTimer = oldState.partContactTimer;
                            state.overdriveScore = oldState.overdriveScore;
                            state.avoidanceSide = oldState.avoidanceSide;
                            state.avoidanceBias.copyFrom(oldState.avoidanceBias);
                            state.safetySpeedFactor = oldState.safetySpeedFactor;
                            state.reducedSpeedActive = oldState.reducedSpeedActive;
                            state.lockedDropTarget = oldState.lockedDropTarget?.clone() ?? null;
                            state.dropExitTarget = oldState.dropExitTarget?.clone() ?? null;
                            state.activeDropTarget = oldState.activeDropTarget?.clone() ?? null;
                            state.autoDropTarget = oldState.autoDropTarget?.clone() ?? null;
                            state.toolNormalBlend = oldState.toolNormalBlend;
                            state.lastProbePos.copyFrom(oldState.lastProbePos);
                        }
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
                        // Only include cobot geometry/visual keys that require a mesh rebuild.
                        // Exclude volatile runtime keys that change during jog/tuning.
                        ...(item.type === 'cobot' ? Object.fromEntries(
                            Object.entries(item.config || {}).filter(([k]) => {
                                if (!k.startsWith('cobot')) return false;
                                const skip = ['cobotManualControl','cobotManualTarget','cobotTuningMode','cobotCollisionEnabled','cobotTuningSelectedElement','cobotHomeTarget'];
                                return !skip.includes(k);
                            })
                        ) : {})
                    })
                    : '';
                const sig = `${item.position.join(',')}_${item.rotation}_${visualConfigSig}`;
                if (!entityNodes.has(item.id)) {
                    const node = buildEntityMesh(item, item.id === 'draft_item');
                    if (node) { entityNodes.set(item.id, node); entitySigs.set(item.id, sig); }
                } else if (entitySigs.get(item.id) !== sig) {
                    // Position or rotation changed — dispose and rebuild
                    const oldState = cobotStates.get(item.id);
                    disposeNode(entityNodes.get(item.id)!);
                    entityNodes.delete(item.id);
                    // Preservation of runtime state is handled inside buildEntityMesh if we pass oldState
                    const node = buildEntityMesh(item, item.id === 'draft_item', oldState);
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
                        cState.recoveryTimer = 2.0;
                        cState.safetySpeedFactor = 1;
                        cState.reducedSpeedActive = false;
                        cState.desiredTarget.copyFrom(cState.idleTarget);
                    }
                    if (itm.config?.cobotCollisionEnabled === false) {
                        cState.safetyStopped = false;
                        cState.blockedTimer = 0;
                        cState.partContactTimer = 0;
                        cState.safetySpeedFactor = 1;
                        cState.reducedSpeedActive = false;
                        if (itm.config?.collisionStopped) {
                            st.updatePlacedItem(id, { config: { ...itm.config, collisionStopped: false } });
                        }
                    }
                    if (!itm.config?.collisionStopped) cState.safetyStopped = false;
                    const configuredHome = itm.config?.cobotHomeTarget;
                    const nextHome = configuredHome
                        ? new Vector3(configuredHome[0], configuredHome[1], configuredHome[2])
                        : new Vector3(itm.position[0], itm.position[1] + 2.2, itm.position[2]);
                    if (Vector3.Distance(cState.idleTarget, nextHome) > 0.001) {
                        cState.idleTarget.copyFrom(nextHome);
                    }
                    cState.manualControl = itm.config?.cobotManualControl === true;
                    cState.manualTarget = itm.config?.cobotManualTarget
                        ? new Vector3(itm.config.cobotManualTarget[0], itm.config.cobotManualTarget[1], itm.config.cobotManualTarget[2])
                        : null;
                    if (cState.manualControl && cState.manualTarget) {
                        cState.safetyStopped = false;
                        cState.phase = 'idle';
                        cState.targetedItem = null;
                        cState.yieldTarget = null;
                        cState.desiredTarget.copyFrom(cState.manualTarget);
                    }
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

        const moveZoneMat = new PBRMaterial('moveZoneMat', scene);
        moveZoneMat.albedoColor = Color3.FromHexString('#10b981');
        moveZoneMat.emissiveColor = Color3.FromHexString('#10b981').scale(0.62);
        moveZoneMat.alpha = 0.88;
        moveZoneMat.transparencyMode = 2;

        const activePointMat = new StandardMaterial('activePointMat', scene);
        activePointMat.emissiveColor = Color3.FromHexString('#facc15');
        activePointMat.disableLighting = true;
        activePointMat.disableDepthWrite = true;

        const dropCoreMat = new StandardMaterial('dropCoreMat', scene);
        dropCoreMat.emissiveColor = Color3.FromHexString('#f87171');
        dropCoreMat.disableLighting = true;
        dropCoreMat.disableDepthWrite = true;
        const pedestalBubbleMat = new StandardMaterial('pedestalBubbleMat', scene);
        pedestalBubbleMat.emissiveColor = Color3.FromHexString('#22d3ee');
        pedestalBubbleMat.alpha = 0.72;
        pedestalBubbleMat.disableLighting = true;
        pedestalBubbleMat.disableDepthWrite = true;

        const armRangeMat = new PBRMaterial('armRangeMat', scene);
        armRangeMat.albedoColor = Color3.FromHexString('#f8fafc');
        armRangeMat.emissiveColor = Color3.FromHexString('#f8fafc').scale(0.22);
        armRangeMat.alpha = 0.5;
        armRangeMat.transparencyMode = 2;

        const cameraLinkRoot = new TransformNode('cameraLinkHighlights', scene);
        const linkedCameraMat = new PBRMaterial('linkedCameraMat', scene);
        linkedCameraMat.albedoColor = Color3.FromHexString('#22c55e');
        linkedCameraMat.emissiveColor = Color3.FromHexString('#22c55e').scale(0.5);
        linkedCameraMat.metallic = 0.1;
        linkedCameraMat.roughness = 0.4;
        const toolpathRoot = new TransformNode('cobotToolpaths', scene);
        const toolpathLines = new Map<string, LinesMesh>();

        function clearTeachZones() {
            teachZoneRoot.getChildMeshes().forEach(m => m.dispose());
        }

        function clearCameraHighlights() {
            cameraLinkRoot.getChildMeshes().forEach(m => m.dispose());
        }

        function clearToolpaths() {
            for (const line of toolpathLines.values()) line.dispose();
            toolpathLines.clear();
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
                    activeStep: selected.config?.uiActiveProgramStepIndex ?? null,
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
                const pedestalKeepout = MeshBuilder.CreateTorus('arm_pedestal_safezone', {
                    diameter: Math.max(0.04, COBOT_PEDESTAL_VISIBLE_RADIUS * 2),
                    thickness: 0.016,
                    tessellation: 48,
                }, scene);
                pedestalKeepout.position.set(mountX, selected.position[1] + COBOT_PLATFORM_TOP_Y + 0.02, mountZ);
                pedestalKeepout.material = dropZoneMat;
                pedestalKeepout.isPickable = false;
                pedestalKeepout.parent = teachZoneRoot;
            }
            if (showRange || showPoints) {
                const baseRotY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][selected.rotation] ?? 0;
                const mountLocal = cobotMountLocal(selected.config);
                const localX = mountLocal.x;
                const localZ = mountLocal.z;
                const mountX = selected.position[0] + localX * Math.cos(baseRotY) + localZ * Math.sin(baseRotY);
                const mountZ = selected.position[2] - localX * Math.sin(baseRotY) + localZ * Math.cos(baseRotY);
                const pedestalBubble = MeshBuilder.CreateSphere('arm_pedestal_safe_bubble', {
                    diameter: COBOT_PEDESTAL_BUBBLE_RADIUS * 2,
                    segments: 18,
                }, scene);
                pedestalBubble.position.set(
                    mountX,
                    selected.position[1] + COBOT_PLATFORM_TOP_Y + COBOT_PEDESTAL_HEIGHT + COBOT_PEDESTAL_BUBBLE_RADIUS + 0.01,
                    mountZ
                );
                pedestalBubble.material = pedestalBubbleMat;
                pedestalBubble.isPickable = false;
                pedestalBubble.renderingGroupId = 2;
                pedestalBubble.parent = teachZoneRoot;
            }
            if (showPoints) {
                const program = selected.config?.program || [];
                const activeStepIndex = selected.config?.uiActiveProgramStepIndex ?? -1;
                const teachSteps: Array<{ action: 'move' | 'pick' | 'drop'; pos: [number, number, number]; key: string; synthetic?: boolean; active?: boolean }> = [];
                program.forEach((step, idx) => {
                    if ((step.action !== 'move' && step.action !== 'pick' && step.action !== 'drop') || !step.pos) return;
                    teachSteps.push({ action: step.action, pos: step.pos as [number, number, number], key: String(idx), active: idx === activeStepIndex });
                });
                if (!program.some(step => step.action === 'drop')) {
                    const centerX = selected.position[0];
                    const centerZ = selected.position[2];
                    const platformTopY = selected.position[1] + COBOT_PLATFORM_TOP_Y;
                    let stackTopY = platformTopY;
                    for (const simItem of simState.items) {
                        if (simItem.state === 'dead') continue;
                        const dx = Math.abs(simItem.pos.x - centerX);
                        const dz = Math.abs(simItem.pos.z - centerZ);
                        if (dx > COBOT_PLATFORM_W / 2 || dz > COBOT_PLATFORM_D / 2) continue;
                        stackTopY = Math.max(stackTopY, simItem.pos.y + partHalfHeight(simItem));
                    }
                    const autoDropY = Math.max(platformTopY + 0.18, stackTopY + 0.26);
                    const autoDropPos: [number, number, number] = [
                        centerX,
                        autoDropY,
                        centerZ,
                    ];
                    teachSteps.push({ action: 'drop', pos: autoDropPos, key: 'auto_drop_center', synthetic: true });
                }
                teachSteps.forEach((step, idx) => {
                    const surfaceY = getSupportSurfaceY(step.pos[0], step.pos[2], st.placedItems);
                    const anchorY = Math.max(0.06, Math.max(step.pos[1], surfaceY + 0.02));
                    const markerY = anchorY + (step.action === 'move' ? 0.23 : 0.28);
                    const mat = step.active
                        ? activePointMat
                        : step.action === 'move'
                            ? moveZoneMat
                            : step.action === 'pick'
                                ? pickZoneMat
                                : dropZoneMat;
                    const ball = MeshBuilder.CreateSphere(`teach_${step.action}_ball_${step.key}_${idx}`, {
                        diameter: step.action === 'move' ? 0.28 : 0.34,
                        segments: 24,
                    }, scene);
                    ball.position.set(step.pos[0], markerY, step.pos[2]);
                    ball.material = mat;
                    ball.isPickable = false;
                    ball.parent = teachZoneRoot;
                    if (step.active) ball.renderingGroupId = 2;

                    const isClipping = step.pos[1] < surfaceY - 0.04;

                    if (isClipping || step.synthetic) {
                        const core = MeshBuilder.CreateSphere(`teach_${step.action}_core_${step.key}_${idx}`, {
                            diameter: 0.18, // slightly larger so it's obvious
                            segments: 16,
                        }, scene);
                        core.position.copyFrom(ball.position);
                        core.material = dropCoreMat; // Always red for warning / fallback drop point
                        core.isPickable = false;
                        core.parent = teachZoneRoot;
                        core.renderingGroupId = 2;
                    }
                });
            }
        }

        let cameraHighlightSig = '';
        let lastToolpathUpdateAt = 0;
        function updateCameraHighlights(st: ReturnType<typeof factoryStore.getState>) {
            const selected = st.placedItems.find(i => i.id === st.selectedItemId);
            const linkedIds = selected?.type === 'cobot' ? selected.config?.linkedCameraIds || [] : [];
            const linkedCams = st.placedItems.filter(i => i.type === 'camera' && linkedIds.includes(i.id));
            const nextSig = selected?.type === 'cobot'
                ? JSON.stringify({ cobot: selected.id, cams: linkedCams.map(cam => cam.id) })
                : '';
            if (nextSig === cameraHighlightSig) return;
            cameraHighlightSig = nextSig;
            clearCameraHighlights();

            st.placedItems.filter(i => i.type === 'camera').forEach(cam => {
                const node = entityNodes.get(cam.id);
                if (!node) return;
                const bodyMesh = node.getChildMeshes().find(m => m.name === 'camBody');
                if (bodyMesh) {
                    if (!(bodyMesh as any).__originalMat) {
                        (bodyMesh as any).__originalMat = bodyMesh.material;
                    }
                    const isLinked = linkedCams.some(c => c.id === cam.id);
                    bodyMesh.material = isLinked ? linkedCameraMat : (bodyMesh as any).__originalMat;
                }
            });
        }

        function updateCobotToolpaths(st: ReturnType<typeof factoryStore.getState>) {
            const selectedId = st.selectedItemId;
            const selected = selectedId ? st.placedItems.find(i => i.id === selectedId) : null;
            if (!selected || selected.type !== 'cobot') {
                clearToolpaths();
                return;
            }
            const visibleIds = new Set<string>();
            for (const [id, cState] of cobotStates) {
                if (id !== selected.id) continue;
                const previewPath = cState.precalculatedPath?.length
                    ? cState.precalculatedPath
                    : [cState.ikTarget.clone(), ...cState.plannedPath.slice(cState.plannedPathCursor)];
                const points = previewPath.map(p => p.clone());
                if (points.length < 2) continue;
                const elevated = points.map((p, idx) => new Vector3(p.x, p.y + 0.03 + idx * 0.0015, p.z));
                const existing = toolpathLines.get(id);
                const line = existing
                    ? MeshBuilder.CreateLines(`toolpath_${id}`, { points: elevated, instance: existing })
                    : MeshBuilder.CreateLines(`toolpath_${id}`, { points: elevated, updatable: true }, scene);
                line.parent = toolpathRoot;
                line.color = Color3.FromHexString('#38bdf8');
                line.alpha = 0.9;
                line.isPickable = false;
                toolpathLines.set(id, line);
                visibleIds.add(id);
            }
            for (const [id, line] of toolpathLines) {
                if (!visibleIds.has(id)) {
                    line.dispose();
                    toolpathLines.delete(id);
                }
            }
        }

        function disposeCameraPreview(id: string) {
            const rtt = previewRTTs.get(id);
            if (rtt) {
                const idx = scene.customRenderTargets.indexOf(rtt);
                if (idx >= 0) scene.customRenderTargets.splice(idx, 1);
                rtt.dispose();
                previewRTTs.delete(id);
            }
            const cam = previewCams.get(id);
            if (cam) {
                cam.dispose();
                previewCams.delete(id);
            }
            previewCaptureAt.delete(id);
            previewPending.delete(id);
            delete simState.cameraFrames[id];
        }

        function captureCameraPreviews(st: ReturnType<typeof factoryStore.getState>) {
            if (document.hidden) return;
            const cameraItems = st.placedItems.filter(i => i.type === 'camera');
            const liveIds = new Set(cameraItems.map(cam => cam.id));
            for (const id of [...previewCams.keys()]) {
                if (!liveIds.has(id)) disposeCameraPreview(id);
            }
            if (cameraItems.length === 0) return;

            const previewFps = Math.max(1, Math.min(30, Math.round(st.cameraPreviewFps || 8)));
            const frameIntervalMs = Math.max(33, Math.round(1000 / previewFps));
            const previewWidth = Math.max(160, Math.min(1024, Math.round(st.cameraPreviewWidth || 320)));
            const previewHeight = Math.max(100, Math.min(768, Math.round(st.cameraPreviewHeight || 200)));

            for (const camItem of cameraItems) {
                let feedCam = previewCams.get(camItem.id);
                if (!feedCam) {
                    feedCam = new FreeCamera(`preview_cam_${camItem.id}`, new Vector3(camItem.position[0], camItem.position[1] + 2, camItem.position[2]), scene);
                    feedCam.fov = 0.9;
                    feedCam.minZ = 0.02;
                    feedCam.maxZ = 25;
                    previewCams.set(camItem.id, feedCam);
                }

                let rtt = previewRTTs.get(camItem.id);
                if (rtt) {
                    const sz = rtt.getSize();
                    if (sz.width !== previewWidth || sz.height !== previewHeight) {
                        const idx = scene.customRenderTargets.indexOf(rtt);
                        if (idx >= 0) scene.customRenderTargets.splice(idx, 1);
                        rtt.dispose();
                        previewRTTs.delete(camItem.id);
                        rtt = undefined;
                    }
                }
                if (!rtt) {
                    rtt = new RenderTargetTexture(`preview_rtt_${camItem.id}`, { width: previewWidth, height: previewHeight }, scene, false, false);
                    rtt.activeCamera = feedCam;
                    rtt.samples = 1;
                    scene.customRenderTargets.push(rtt);
                    previewRTTs.set(camItem.id, rtt);
                }

                const camNode = entityNodes.get(camItem.id);
                const camRoot = camNode?.getChildTransformNodes().find(n => n.name === 'camRoot');
                const lensMesh = camNode?.getChildMeshes().find(m => m.name === 'lens');
                if (camRoot) {
                    const worldDir = camRoot.getDirection(new Vector3(0, -1, 0)).normalize();
                    const lensPos = lensMesh?.getAbsolutePosition() ?? camRoot.getAbsolutePosition();
                    const eyePos = lensPos.add(worldDir.scale(0.1));
                    feedCam.position.copyFrom(eyePos);
                    feedCam.setTarget(eyePos.add(worldDir.scale(4)));
                } else {
                    feedCam.position.set(camItem.position[0], camItem.position[1] + 2.2, camItem.position[2]);
                    feedCam.setTarget(new Vector3(camItem.position[0], camItem.position[1], camItem.position[2]));
                }
                feedCam.minZ = 0.03;
                feedCam.maxZ = 25;

                const now = performance.now();
                const lastAt = previewCaptureAt.get(camItem.id) ?? 0;
                if (now - lastAt < frameIntervalMs) continue;
                if (previewPending.has(camItem.id)) continue;
                previewCaptureAt.set(camItem.id, now);
                previewPending.add(camItem.id);
                const hidden = camNode ? new Set(camNode.getChildMeshes()) : null;
                rtt.renderList = scene.meshes.filter(mesh => {
                    if (hidden?.has(mesh)) return false;
                    if (mesh === lensMesh) return false;
                    if (!mesh.isEnabled()) return false;
                    return mesh.isVisible;
                });
                rtt.render(true);
                Promise.resolve(rtt.readPixels(0, 0)).then((pixels) => {
                    previewPending.delete(camItem.id);
                    if (!pixels) return;
                    const w = rtt!.getSize().width;
                    const h = rtt!.getSize().height;
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return;
                    const img = ctx.createImageData(w, h);
                    const row = w * 4;
                    for (let y = 0; y < h; y++) {
                        const src = (h - 1 - y) * row;
                        const dst = y * row;
                        for (let i = 0; i < row; i += 4) {
                            img.data[dst + i] = pixels[src + i];
                            img.data[dst + i + 1] = pixels[src + i + 1];
                            img.data[dst + i + 2] = pixels[src + i + 2];
                            img.data[dst + i + 3] = 255;
                        }
                    }
                    ctx.putImageData(img, 0, 0);
                    simState.cameraFrames[camItem.id] = canvas.toDataURL('image/jpeg', 0.72);
                }).catch(() => {
                    previewPending.delete(camItem.id);
                });
            }
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
                        gy = topY <= DEFAULT_PART_HALF + 0.0001 ? 0 : topY;
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
                        gy = topY <= DEFAULT_PART_HALF + 0.0001 ? 0 : topY;
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
                                gy = topY <= DEFAULT_PART_HALF + 0.0001 ? 0 : topY;
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
            const target = e.target as HTMLElement | null;
            const typing = !!target && (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT' ||
                target.isContentEditable
            );
            if (typing) return;
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                const st = factoryStore.getState();
                if (!st.isRunning) {
                    st.setIsRunning(true);
                    st.setIsPaused(false);
                } else {
                    st.setIsPaused(!st.isPaused);
                }
                return;
            }
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

        function itemSupportTopY(item: PlacedItem): number {
            if (item.type === 'belt') return item.config?.beltHeight || TILE_CENTER_Y;
            if (['sender', 'receiver', 'indexed_receiver'].includes(item.type)) return item.config?.machineHeight || TILE_CENTER_Y;
            if (item.type === 'pile') return item.config?.machineHeight || 0.7;
            if (item.type === 'table') return item.config?.tableHeight || TABLE_CENTER_Y;
            if (item.type === 'cobot') return COBOT_PLATFORM_TOP_Y;
            return 0;
        }

        function itemSurfaceCenterY(
            item: PlacedItem,
            part?: { shape?: PartShape; size?: PartSize; radiusScale?: number; heightScale?: number; scaleX?: number; scaleZ?: number }
        ): number {
            const half = partHalfHeight({ shape: part?.shape, heightScale: part?.heightScale });
            return itemSupportTopY(item) + half;
        }

        function itemSupportsPart(item: PlacedItem, x: number, z: number, radius = DISC_RADIUS): boolean {
            if (item.type === 'camera') return false;
            const dx = Math.abs(x - item.position[0]);
            const dz = Math.abs(z - item.position[2]);
            const isRotated = (item.rotation || 0) % 2 !== 0;
            const lx = isRotated ? dz : dx;
            const lz = isRotated ? dx : dz;

            let w = 2, d = 2;
            if (item.type === 'table') [w, d] = item.config?.tableSize || [1.8, 1.8];
            else if (item.type === 'belt') [w, d] = item.config?.beltSize || [2, 2];
            else if (['sender','receiver','indexed_receiver','pile'].includes(item.type)) [w, d] = item.config?.machineSize || [2, 2];
            else if (item.type === 'cobot') { w = COBOT_PLATFORM_W; d = COBOT_PLATFORM_D; }

            return lx <= w / 2 && lz <= d / 2;
        }

        function getSupportSurfaceY(
            x: number,
            z: number,
            placedItems: PlacedItem[],
            part?: { shape?: PartShape; size?: PartSize; radiusScale?: number; heightScale?: number; scaleX?: number; scaleZ?: number }
        ): number {
            const half = partHalfHeight({ shape: part?.shape, heightScale: part?.heightScale });
            let surfaceY = half;
            for (const item of placedItems) {
                if (!itemSupportsPart(item, x, z)) continue;
                surfaceY = Math.max(surfaceY, itemSurfaceCenterY(item, part));
            }
            return surfaceY;
        }

        function itemYaw(item: PlacedItem): number {
            return [Math.PI, Math.PI / 2, 0, -Math.PI / 2][item.rotation] ?? 0;
        }

        function gridSpecForSupport(item: PlacedItem): { cols: number; rows: number; width: number; depth: number } | null {
            if (item.type === 'cobot') {
                const stackMatrix = item.config?.stackMatrix || [3, 3];
                const cols = Math.max(1, Math.min(6, Math.round(stackMatrix[0] || 3)));
                const rows = Math.max(1, Math.min(6, Math.round(stackMatrix[1] || 3)));
                return {
                    cols,
                    rows,
                    width: Math.max(0.2, COBOT_PLATFORM_W - COBOT_PLATFORM_MARGIN),
                    depth: Math.max(0.2, COBOT_PLATFORM_D - COBOT_PLATFORM_MARGIN),
                };
            }
            if (item.type === 'table') {
                const tableGrid = item.config?.tableGrid || [3, 3];
                const cols = Math.max(1, Math.min(6, Math.round(tableGrid[0] || 3)));
                const rows = Math.max(1, Math.min(6, Math.round(tableGrid[1] || 3)));
                const [width, depth] = item.config?.tableSize || [1.8, 1.8];
                return { cols, rows, width, depth };
            }
            if (item.type === 'pile') {
                const tableGrid = item.config?.tableGrid || [3, 3];
                const cols = Math.max(1, Math.min(6, Math.round(tableGrid[0] || 3)));
                const rows = Math.max(1, Math.min(6, Math.round(tableGrid[1] || 3)));
                const [width, depth] = item.config?.machineSize || [2, 2];
                return { cols, rows, width, depth };
            }
            return null;
        }

        function nearestGridSlotForSupport(item: PlacedItem, x: number, z: number): { x: number; z: number; captureRadius: number } | null {
            const grid = gridSpecForSupport(item);
            if (!grid) return null;

            const rotY = itemYaw(item);
            const dx = x - item.position[0];
            const dz = z - item.position[2];
            const lx = dx * Math.cos(rotY) - dz * Math.sin(rotY);
            const lz = dx * Math.sin(rotY) + dz * Math.cos(rotY);

            const cellW = grid.width / grid.cols;
            const cellD = grid.depth / grid.rows;
            const col = Math.max(0, Math.min(grid.cols - 1, Math.round((lx + grid.width / 2 - cellW / 2) / cellW)));
            const row = Math.max(0, Math.min(grid.rows - 1, Math.round((lz + grid.depth / 2 - cellD / 2) / cellD)));

            const slotLx = -grid.width / 2 + cellW * (col + 0.5);
            const slotLz = -grid.depth / 2 + cellD * (row + 0.5);
            const slotX = item.position[0] + slotLx * Math.cos(rotY) + slotLz * Math.sin(rotY);
            const slotZ = item.position[2] - slotLx * Math.sin(rotY) + slotLz * Math.cos(rotY);
            const captureRadius = Math.max(0.12, Math.min(0.34, Math.min(cellW, cellD) * 0.46));
            return { x: slotX, z: slotZ, captureRadius };
        }

        function getTopSupportItem(
            x: number,
            z: number,
            placedItems: PlacedItem[],
            part?: { shape?: PartShape; size?: PartSize; radiusScale?: number; heightScale?: number; scaleX?: number; scaleZ?: number }
        ): PlacedItem | null {
            let topItem: PlacedItem | null = null;
            let topY = partHalfHeight({ shape: part?.shape, heightScale: part?.heightScale });
            for (const item of placedItems) {
                if (!itemSupportsPart(item, x, z)) continue;
                const centerY = itemSurfaceCenterY(item, part);
                if (centerY > topY) {
                    topY = centerY;
                    topItem = item;
                }
            }
            return topItem;
        }

        function getDriveTile(x: number, z: number, placedItems: PlacedItem[]): PlacedItem | undefined {
            return placedItems.find(item => {
                if (item.type !== 'belt' && item.type !== 'sender') return false;
                const [w, d] = item.type === 'belt' ? (item.config?.beltSize || [2, 2]) : (item.config?.machineSize || [2, 2]);
                const dx = Math.abs(x - item.position[0]);
                const dz = Math.abs(z - item.position[2]);
                const isRotated = (item.rotation || 0) % 2 !== 0;
                const lx = isRotated ? dz : dx;
                const lz = isRotated ? dx : dz;
                return lx <= w / 2 && lz <= d / 2;
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
            const templatesById = new Map(factoryStore.getState().partTemplates.map(t => [t.id, t]));
            for (const cam of cameras) {
                for (const item of simState.items) {
                    if (item.state !== 'free') continue;
                    const dx = item.pos.x - cam.position[0];
                    const dz = item.pos.z - cam.position[2];
                    const planarDist = Math.sqrt(dx * dx + dz * dz);
                    if (planarDist > 1.65) continue;
                    const centered = Math.max(0, 1 - planarDist / 1.65);
                    const crowdPenalty = Math.min(0.45, nearbyVisionCrowding(item.id, item.pos.x, item.pos.z) * 0.18);
                    const supportPenalty = Math.abs(getSupportSurfaceY(item.pos.x, item.pos.z, placedItems, item) - item.pos.y) > 0.05 ? 0.2 : 0;
                    const confidence = Math.max(0.05, centered - crowdPenalty - supportPenalty);
                    if (confidence < 0.16) continue;
                    const template = item.templateId ? templatesById.get(item.templateId) : null;
                    simState.cameraDetections.push({
                        cameraId: cam.id,
                        itemId: item.id,
                        templateId: item.templateId,
                        templateName: template?.name,
                        shape: item.shape,
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
            const frameNow = performance.now();
            if (frameNow - lastToolpathUpdateAt >= 80) {
                updateCobotToolpaths(st);
                lastToolpathUpdateAt = frameNow;
            }

            // Sync layout
            if (placedItems !== prevItems || draftPlacement !== prevDraft) {
                prevItems = placedItems;
                prevDraft = draftPlacement;
                syncEntities(draftPlacement ? [...placedItems, draftPlacement] : placedItems);
            }
            captureCameraPreviews(st);

        function syncCobotStateFromStore(st: any, items: PlacedItem[]) {
            for (const itm of items) {
                if (itm.type !== 'cobot') continue;
                const cState = cobotStates.get(itm.id);
                if (!cState) continue;
                cState.selfItem = itm;
                cState.speed = itm.config?.speed || 1.0;
                cState.manualControl = itm.config?.cobotManualControl === true;
                cState.manualTarget = itm.config?.cobotManualTarget ? new Vector3(...itm.config.cobotManualTarget) : null;
                cState.program = itm.config?.program || [];
                // tuningMode is driven by the UI config flag, NOT by move-mode gizmo.
                cState.tuningMode = itm.config?.cobotTuningMode === true;
                cState.enableRepulsion = itm.config?.enableRepulsion !== false;
                if (!itm.config?.collisionStopped) cState.safetyStopped = false;
            }
        }

        function cobotRuntimeState(state: CobotState, simActive: boolean): MachineRuntimeState {
            if (!simActive && !state.manualControl && state.selfItem?.config?.cobotTuningMode !== true) {
                return { health: 'idle', label: 'Idle', detail: 'Simulation stopped', stepIndex: state.stepIndex };
            }
            if (state.safetyStopped) return { health: 'warning', label: 'Safety Stop', detail: 'Collision detected or limit reached', stepIndex: state.stepIndex };
            if (state.isOutOfRange) return { health: 'warning', label: 'Out of Range', detail: 'Point too far for arm configuration', stepIndex: state.stepIndex };
            if (state.yieldTarget && state.simTime < state.yieldUntil) return { health: 'warning', label: 'Yielding', detail: 'Giving way to neighbor...', stepIndex: state.stepIndex };
            if (state.phase === 'manual') return { health: 'running', label: 'Manual Control', detail: state.manualControl ? 'Jogging...' : 'Tuning...', stepIndex: state.stepIndex };
            if (state.phase === 'recovery') return { health: 'warning', label: 'Recovering', detail: 'Returning to safe position...', stepIndex: state.stepIndex };
            if (['pick_hover', 'pick_descend', 'pick_attach', 'pick_recenter'].includes(state.phase)) {
                return { health: 'running', label: 'Picking', detail: 'Acquiring part...', stepIndex: state.stepIndex };
            }
            if (['hover_drop', 'descend_drop', 'release', 'drop_recenter'].includes(state.phase)) {
                return { health: 'running', label: 'Placing', detail: 'Releasing part...', stepIndex: state.stepIndex };
            }
            if (['lift', 'transit_drop', 'next'].includes(state.phase)) {
                return { health: 'running', label: 'Moving', detail: 'In transit...', stepIndex: state.stepIndex };
            }
            if (state.phase === 'wait_step') return { health: 'running', label: 'Waiting', detail: 'Dwell step...', stepIndex: state.stepIndex };
            if (state.phase === 'idle' && (state.program?.length || 0) > 0) {
                return { health: 'running', label: 'Ready', detail: 'Waiting for next valid pickup', stepIndex: state.stepIndex };
            }
            return { health: 'idle', label: 'Idle', detail: 'No programmed work', stepIndex: state.stepIndex };
        }

        function applyCobotStatusVisual(state: CobotState, runtime: MachineRuntimeState) {
            if (!state.statusDisplayMat) return;
            let hex = '#334155';
            let emissive = new Color3(0.02, 0.03, 0.04);
            if (runtime.health === 'running') {
                hex = '#22c55e';
                emissive = Color3.FromHexString('#22c55e').scale(0.45);
            } else if (runtime.health === 'warning') {
                hex = '#f59e0b';
                emissive = Color3.FromHexString('#f59e0b').scale(0.5);
            } else if (runtime.health === 'stopped' || runtime.health === 'error') {
                hex = '#ef4444';
                emissive = Color3.FromHexString('#ef4444').scale(0.45);
            }
            state.statusDisplayMat.albedoColor = Color3.FromHexString(hex);
            state.statusDisplayMat.emissiveColor = emissive;
        }
            // Keep cobot runtime state in sync with latest store config every frame.
            syncCobotStateFromStore(st, placedItems);

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

            // Always tick cobots to allow manual interaction (Jog/Tuning) even if the sim is stopped or paused.
            // But only update parts/physics/spawning if running and not paused.
            const simActive = isRunning && !isPaused;
            const cobotDelta = simActive ? delta : Math.max(0.0001, engine.getDeltaTime() / 1000);

            for (const [id, cState] of cobotStates) {
                try {
                    const collided = tickCobot(cState, cobotDelta, simActive);
                    const runtime = cobotRuntimeState(cState, simActive);
                    st.setMachineState(id, runtime);
                    applyCobotStatusVisual(cState, runtime);

                    if (collided) {
                        const owner = placedItems.find(item => item.id === id);
                        if (owner && !owner.config?.collisionStopped) {
                            st.updatePlacedItem(id, { config: { ...owner.config, collisionStopped: true } });
                        }
                    } else if (!cState.safetyStopped) {
                        const owner = placedItems.find(item => item.id === id);
                        if (owner?.config?.collisionStopped) {
                            st.updatePlacedItem(id, { config: { ...owner.config, collisionStopped: false } });
                        }
                    }
                } catch (err) {
                    console.error(`[BabylonScene] tickCobot crashed for ${id}`, err);
                }
            }

            if (!isRunning) {
                clearToolpaths();
                partMeshes.forEach(m => { if (m) m.isVisible = true; }); // Keep parts visible even when stopped
                velY.clear();
                velXZ.clear();
                spinY.clear();
                return;
            }
            if (isPaused) {
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


            // ── Manual physics sync ───────────────────────────────────────
            const GRAVITY = 9.81;
            const SLOT_SNAP_LOCK_DIST = 0.02;
            const SLOT_SNAP_LOCK_SPEED = 0.055;

            simState.items.forEach((simItem, index) => {
                const nowSec = performance.now() * 0.001;
                const prevState = lastStateByItemId.get(simItem.id);
                const justReleased = prevState === 'grabbed' && simItem.state === 'free';
                if (justReleased) {
                    justReleasedUntil.set(simItem.id, nowSec + 0.32);
                    const planar = velXZ.get(index) ?? Vector3.Zero();
                    planar.set(0, 0, 0);
                    velXZ.set(index, planar);
                    velY.set(index, 0);
                    spinY.set(index, 0);
                }
                const inReleaseSettleWindow = (justReleasedUntil.get(simItem.id) ?? 0) > nowSec;
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
                    velXZ.delete(index);
                    spinY.delete(index);
                    lastStateByItemId.delete(simItem.id);
                    justReleasedUntil.delete(simItem.id);
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
                    const planar = velXZ.get(index) ?? Vector3.Zero();
                    planar.set(0, 0, 0);
                    velXZ.set(index, planar);
                    spinY.set(index, 0);
                } else {
                    // ── Manual gravity ────────────────────────────────────
                    let vy = velY.get(index) ?? 0;
                    const planarVel = velXZ.get(index) ?? Vector3.Zero();

                    const gx = Math.round(simItem.pos.x / 2.5) * 2.5;
                    const gz = Math.round(simItem.pos.z / 2.5) * 2.5;
                    const tile = placedItems.find(item =>
                        Math.abs(item.position[0] - gx) < 0.1 && Math.abs(item.position[2] - gz) < 0.1
                    );
                    const simHalf = partHalfHeight(simItem);
                    const simRad = partRadius(simItem);

                    // Landing surface height (includes cobot top platform level)
                    let surfY = getSupportSurfaceY(simItem.pos.x, simItem.pos.z, placedItems, simItem);

                    // Stacking: settle on top of highest part below.
                    const stackCaptureRadius = Math.min(0.34, Math.max(0.2, simRad * 0.82));
                    const stackedSurfaceYAt = (x: number, z: number) => {
                        let y = getSupportSurfaceY(x, z, placedItems, simItem);
                        simState.items.forEach((other, oi) => {
                            if (oi === index) return;
                            if (other.state === 'grabbed' || other.state === 'dead') return;
                            const dx = other.pos.x - x;
                            const dz = other.pos.z - z;
                            if (Math.sqrt(dx * dx + dz * dz) < stackCaptureRadius) {
                                const otherHalf = partHalfHeight(other);
                                const stackedCenter = other.pos.y + otherHalf + simHalf;
                                if (stackedCenter > y && other.pos.y <= simItem.pos.y + simHalf + 0.002) {
                                    y = stackedCenter;
                                }
                            }
                        });
                        return y;
                    };
                    surfY = stackedSurfaceYAt(simItem.pos.x, simItem.pos.z);

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
                    if (driveTile && Math.abs(simItem.pos.y - itemSurfaceCenterY(driveTile, simItem)) < 0.06) {
                        const spd = (driveTile.config?.speed || 2) * 0.92;
                        const r = driveTile.rotation;
                        const targetVx = (r === 1 ? spd : r === 3 ? -spd : 0);
                        const targetVz = (r === 2 ? spd : r === 0 ? -spd : 0);
                        planarVel.x += (targetVx - planarVel.x) * Math.min(1, delta * 6.5);
                        planarVel.z += (targetVz - planarVel.z) * Math.min(1, delta * 6.5);
                        const drivenSurfY = getSupportSurfaceY(simItem.pos.x, simItem.pos.z, placedItems, simItem);
                        if (drivenSurfY >= itemSurfaceCenterY(driveTile, simItem) - 0.01 && simItem.pos.y < drivenSurfY) {
                            simItem.pos.y = drivenSurfY;
                            velY.set(index, 0);
                        }
                    } else {
                        const settleExtra = inReleaseSettleWindow ? 5.4 : 0;
                        const friction = Math.max(0, 1 - delta * (Math.abs(vy) < 0.08 ? (4.2 + settleExtra) : (2.6 + settleExtra * 0.7)));
                        planarVel.x *= friction;
                        planarVel.z *= friction;
                    }
                    const planarSpeed = Math.sqrt(planarVel.x * planarVel.x + planarVel.z * planarVel.z);
                    const maxPlanarSpeed = driveTile ? 3.2 : 1.35;
                    if (planarSpeed > maxPlanarSpeed && planarSpeed > 0.0001) {
                        const s = maxPlanarSpeed / planarSpeed;
                        planarVel.x *= s;
                        planarVel.z *= s;
                    }
                    simItem.pos.x += planarVel.x * delta;
                    simItem.pos.z += planarVel.z * delta;
                    velXZ.set(index, planarVel);

                    let yawVel = spinY.get(index) ?? 0;
                    yawVel += (planarVel.length() * 0.22 - yawVel) * Math.min(1, delta * 4.5);
                    if (!driveTile && Math.abs(planarVel.x) + Math.abs(planarVel.z) < 0.02) {
                        yawVel *= Math.max(0, 1 - delta * 4.8);
                    }
                    spinY.set(index, yawVel);
                    simItem.rotY += yawVel * delta;

                    // ── Scoring ───────────────────────────────────────────
                    // Snap settled parts to nearest slot center so stacks stay aligned.
                    if (!driveTile && Math.abs(vy) < 0.16) {
                        const supportItem = getTopSupportItem(simItem.pos.x, simItem.pos.z, placedItems, simItem);
                        const restingOnStaticSupport = !!supportItem && !['belt', 'sender'].includes(supportItem.type) && Math.abs(simItem.pos.y - surfY) < 0.05;
                        const planarSpeed = Math.sqrt(planarVel.x * planarVel.x + planarVel.z * planarVel.z);
                        const isOwnPlatform = supportItem?.type === 'cobot';
                        if (restingOnStaticSupport) {
                            const settleDamping = (isOwnPlatform ? 26 : 20) + (inReleaseSettleWindow ? 8 : 0);
                            planarVel.x *= Math.max(0, 1 - delta * settleDamping);
                            planarVel.z *= Math.max(0, 1 - delta * settleDamping);
                            if (Math.abs(planarVel.x) + Math.abs(planarVel.z) < 0.015) {
                                planarVel.x = 0;
                                planarVel.z = 0;
                            }
                            velXZ.set(index, planarVel);
                        }
                        if (!inReleaseSettleWindow && supportItem && Math.abs(simItem.pos.y - surfY) < 0.035) {
                            const snapped = nearestGridSlotForSupport(supportItem, simItem.pos.x, simItem.pos.z);
                            if (snapped) {
                                const dx = snapped.x - simItem.pos.x;
                                const dz = snapped.z - simItem.pos.z;
                                const planarDist = Math.sqrt(dx * dx + dz * dz);
                                const maxSnapDist = Math.min(snapped.captureRadius, isOwnPlatform ? 0.2 : 0.14);
                                if (planarDist <= maxSnapDist && planarSpeed < (isOwnPlatform ? 0.14 : 0.1)) {
                                    const snapGain = isOwnPlatform ? 8.5 : 6.2;
                                    const desiredVx = dx * snapGain;
                                    const desiredVz = dz * snapGain;
                                    const accel = isOwnPlatform ? 15.5 : 12.5;
                                    planarVel.x += (desiredVx - planarVel.x) * Math.min(1, delta * accel);
                                    planarVel.z += (desiredVz - planarVel.z) * Math.min(1, delta * accel);
                                    const snapMaxSpeed = isOwnPlatform ? 0.78 : 0.58;
                                    const vLen = Math.sqrt(planarVel.x * planarVel.x + planarVel.z * planarVel.z);
                                    if (vLen > snapMaxSpeed && vLen > 0.0001) {
                                        const s = snapMaxSpeed / vLen;
                                        planarVel.x *= s;
                                        planarVel.z *= s;
                                    }
                                    simItem.pos.x += planarVel.x * delta;
                                    simItem.pos.z += planarVel.z * delta;
                                    const snappedY = stackedSurfaceYAt(simItem.pos.x, simItem.pos.z);
                                    if (simItem.pos.y <= snappedY + 0.05) {
                                        simItem.pos.y = snappedY;
                                        vy = 0;
                                        velY.set(index, 0);
                                        surfY = snappedY;
                                    }
                                    const postDx = snapped.x - simItem.pos.x;
                                    const postDz = snapped.z - simItem.pos.z;
                                    const postDist = Math.sqrt(postDx * postDx + postDz * postDz);
                                    const postSpeed = Math.sqrt(planarVel.x * planarVel.x + planarVel.z * planarVel.z);
                                    if (postDist <= SLOT_SNAP_LOCK_DIST && postSpeed <= SLOT_SNAP_LOCK_SPEED) {
                                        simItem.pos.x = snapped.x;
                                        simItem.pos.z = snapped.z;
                                        planarVel.x = 0;
                                        planarVel.z = 0;
                                        velXZ.set(index, planarVel);
                                        spinY.set(index, 0);
                                    } else {
                                        velXZ.set(index, planarVel);
                                    }
                                }
                            }
                        }
                    }

                    if (tile?.type === 'receiver') {
                        const dist = Math.sqrt((simItem.pos.x - gx) ** 2 + (simItem.pos.z - gz) ** 2);
                        const targetY = itemSurfaceCenterY(tile, simItem);
                        const colorOk = !tile.config?.acceptColor || tile.config.acceptColor === 'any'
                            || tile.config.acceptColor === simItem.color;
                        if (dist < 0.35 && Math.abs(simItem.pos.y - targetY) < 0.1 && colorOk) {
                            simItem.state = 'dead';
                            st.setScore(s => s + 1);
                        }
                    }
                    if (tile?.type === 'indexed_receiver') {
                        const dist = Math.sqrt((simItem.pos.x - gx) ** 2 + (simItem.pos.z - gz) ** 2);
                        const targetY = itemSurfaceCenterY(tile, simItem);
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

            if (simState.items.some(i => i.state === 'dead')) {
                const kept: typeof simState.items = [];
                const nextVelY = new Map<number, number>();
                const nextVelXZ = new Map<number, Vector3>();
                const nextSpinY = new Map<number, number>();
                simState.items.forEach((item, oldIdx) => {
                    if (item.state === 'dead') return;
                    const newIdx = kept.length;
                    kept.push(item);
                    if (velY.has(oldIdx)) nextVelY.set(newIdx, velY.get(oldIdx)!);
                    if (velXZ.has(oldIdx)) nextVelXZ.set(newIdx, velXZ.get(oldIdx)!.clone());
                    if (spinY.has(oldIdx)) nextSpinY.set(newIdx, spinY.get(oldIdx)!);
                });
                simState.items = kept;
                velY.clear(); nextVelY.forEach((v, k) => velY.set(k, v));
                velXZ.clear(); nextVelXZ.forEach((v, k) => velXZ.set(k, v));
                spinY.clear(); nextSpinY.forEach((v, k) => spinY.set(k, v));
            }

            // ── Part collision repulsion (belt/floor level only) ────
            const partSpacing = (a: typeof simState.items[0], b: typeof simState.items[0]) => partRadius(a) + partRadius(b);
            const items = simState.items;
            
            const isRepellable = (item: typeof items[0]) => {
                if (item.state !== 'free') return false;
                if (item.pos.y > 0.95) return false;
                if (item.pos.y < 0.1) return true; // Always repel items on the floor!
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
                    const minDist = partSpacing(items[i], items[j]);
                    if (d < minDist && d > 0.001) {
                        const push = (minDist - d) * 0.5;
                        const nx = dx / d, nz = dz / d;
                        items[i].pos.x -= nx * push;
                        items[i].pos.z -= nz * push;
                        items[j].pos.x += nx * push;
                        items[j].pos.z += nz * push;
                        const vi = velXZ.get(i) ?? Vector3.Zero();
                        const vj = velXZ.get(j) ?? Vector3.Zero();
                        vi.x -= nx * push * 2.8;
                        vi.z -= nz * push * 2.8;
                        vj.x += nx * push * 2.8;
                        vj.z += nz * push * 2.8;
                        velXZ.set(i, vi);
                        velXZ.set(j, vj);
                    }
                }
                
                // Item-to-Machine repulsion
                for (const machine of placedItems) {
                    if (['belt', 'camera', 'pile', 'table', 'sender', 'receiver', 'indexed_receiver'].includes(machine.type)) continue;
                    const w = machine.type === 'cobot' ? 2.15 : (machine.config?.machineSize?.[0] || 2);
                    const d = machine.type === 'cobot' ? 2.15 : (machine.config?.machineSize?.[1] || 2);
                    const radius = partRadius(items[i]) + 0.06;
                    
                    const isRotated = machine.rotation % 2 !== 0;
                    const effW = isRotated ? d : w;
                    const effD = isRotated ? w : d;
                    
                    const localX = items[i].pos.x - machine.position[0];
                    const localZ = items[i].pos.z - machine.position[2];
                    
                    const halfW = effW / 2;
                    const halfD = effD / 2;
                    
                    const cx = Math.max(-halfW, Math.min(halfW, localX));
                    const cz = Math.max(-halfD, Math.min(halfD, localZ));
                    
                    const dx = localX - cx;
                    const dz = localZ - cz;
                    const distSq = dx * dx + dz * dz;
                    
                    if (distSq < radius * radius && distSq > 0.00001) {
                        const dist = Math.sqrt(distSq);
                        const push = radius - dist;
                        items[i].pos.x += (dx / dist) * push;
                        items[i].pos.z += (dz / dist) * push;
                        const vi = velXZ.get(i) ?? Vector3.Zero();
                        vi.x += (dx / dist) * push * 2.2;
                        vi.z += (dz / dist) * push * 2.2;
                        velXZ.set(i, vi);
                    } else if (distSq <= 0.00001) {
                        items[i].pos.x += radius;
                    }
                }
            }

            // Update mesh transforms after repulsion/settling so visuals stay in sync this frame.
            simState.items.forEach((simItem, index) => {
                const mesh = partMeshes[index];
                if (!mesh || simItem.state === 'dead') return;
                mesh.position.copyFrom(simItem.pos);
                mesh.rotation.y = simItem.rotY;
                lastStateByItemId.set(simItem.id, simItem.state);
            });

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
                    const baseY = (item.config?.machineHeight || 0.7) + DEFAULT_PART_HALF + 0.02;
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
            clearToolpaths();
            for (const id of [...previewCams.keys()]) disposeCameraPreview(id);
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
