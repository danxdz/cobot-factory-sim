import React, { useEffect, useRef } from 'react';
import {
    Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4,
    HemisphericLight, DirectionalLight, ShadowGenerator,
    MeshBuilder, PBRMaterial, TransformNode, Mesh,
    PointerEventTypes, PhysicsAggregate, PhysicsShapeType,
    HavokPlugin, AbstractMesh
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { factoryStore } from '../store';
import { simState } from '../simState';
import { MachineRuntimeState, PartSize, PlacedItem } from '../types';
import {
    createBelt, createSender, createReceiver, createIndexedReceiver,
    createPile, createTable, createCameraEntity, createPlateMesh
} from '../babylon/entityMeshes';
import { createCobot, tickCobot, CobotState } from '../babylon/cobotMesh';

const ITEM_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];
const ITEM_SIZES: PartSize[] = ['small', 'medium', 'large'];
const SIZE_DIAMETER: Record<PartSize, number> = { small: 0.54, medium: 0.6, large: 0.66 };
const DISC_H = 0.015;
const DISC_HALF_H = DISC_H / 2;
const DISC_RADIUS = 0.3;
const TILE_CENTER_Y = 0.545;
const TABLE_CENTER_Y = 0.458;
const COBOT_PLATFORM_CENTER_Y = 1.198;

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
            const lx = MeshBuilder.CreateBox(`gx${i}`, { width: 40, height: 0.01, depth: 0.03 }, scene);
            lx.position.z = i * 2; lx.material = gridMat; lx.isPickable = false;
            const lz = MeshBuilder.CreateBox(`gz${i}`, { width: 0.03, height: 0.01, depth: 40 }, scene);
            lz.position.x = i * 2; lz.material = gridMat; lz.isPickable = false;
        }

        // ── PHYSICS (ground only, parts use manual simulation) ───────────────
        const partMeshes: Mesh[] = [];
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
                    })
                    : '';
                const sig = `${item.position.join(',')}_${item.rotation}_${visualConfigSig}`;
                if (!entityNodes.has(item.id)) {
                    const node = buildEntityMesh(item);
                    if (node) { entityNodes.set(item.id, node); entitySigs.set(item.id, sig); }
                } else if (entitySigs.get(item.id) !== sig) {
                    // Position or rotation changed — dispose and rebuild
                    disposeNode(entityNodes.get(item.id)!);
                    entityNodes.delete(item.id);
                    cobotStates.delete(item.id);
                    const node = buildEntityMesh(item);
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
                    if (!itm.config?.collisionStopped) cState.safetyStopped = false;
                    cState.program = itm.config?.program || [];
                    cState.speed = itm.config?.speed || 1.0;
                    cState.pickColors = itm.config?.pickColors || [];
                    cState.pickSizes = itm.config?.pickSizes || [];
                    cState.linkedCameraIds = itm.config?.linkedCameraIds || [];
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
                ? JSON.stringify({ id: selected.id, rotation: selected.rotation, position: selected.position, program: selected.config?.program || [], showPoints, showRange })
                : '';
            if (nextSig === teachZoneSig) return;
            teachZoneSig = nextSig;
            clearTeachZones();
            if (!selected || selected.type !== 'cobot') return;
            const isOnOtherCobot = (pos: [number, number, number]) => st.placedItems.some(item =>
                item.id !== selected.id &&
                item.type === 'cobot' &&
                Math.abs(pos[0] - item.position[0]) <= 1 &&
                Math.abs(pos[2] - item.position[2]) <= 1
            );
            if (showRange) {
                const baseRotY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][selected.rotation] ?? 0;
                const localX = -0.55;
                const localZ = 0.55;
                const mountX = selected.position[0] + localX * Math.cos(baseRotY) + localZ * Math.sin(baseRotY);
                const mountZ = selected.position[2] - localX * Math.sin(baseRotY) + localZ * Math.cos(baseRotY);
                const range = MeshBuilder.CreateTorus('arm_range_ring', {
                    diameter: 5.55,
                    thickness: 0.025,
                    tessellation: 96,
                }, scene);
                range.position.set(mountX, selected.position[1] + 1.22, mountZ);
                range.material = armRangeMat;
                range.isPickable = false;
                range.parent = teachZoneRoot;
            }
            if (showPoints) {
                (selected.config?.program || []).forEach((step, idx) => {
                    if ((step.action !== 'pick' && step.action !== 'drop') || !step.pos) return;
                    if (isOnOtherCobot(step.pos)) return;
                    const mat = step.action === 'pick' ? pickZoneMat : dropZoneMat;
                    const y = Math.max(0.06, step.pos[1] + 0.03);
                    const ball = MeshBuilder.CreateSphere(`teach_${step.action}_ball_${idx}`, {
                        diameter: 0.34,
                        segments: 24,
                    }, scene);
                    ball.position.set(step.pos[0], y + 0.28, step.pos[2]);
                    ball.material = mat;
                    ball.isPickable = false;
                    ball.parent = teachZoneRoot;
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

                const gx = Math.round(pick.pickedPoint.x / 2) * 2;
                const gz = Math.round(pick.pickedPoint.z / 2) * 2;

                if (st.buildMode) {
                    cursorMesh.isVisible = true;
                    cursorMesh.position.x = gx;
                    cursorMesh.position.z = gz;

                    const occupied = st.placedItems.some(i =>
                        Math.abs(i.position[0] - gx) < 0.1 && Math.abs(i.position[2] - gz) < 0.1
                    );
                    cursorMesh.material = occupied ? cursorMatBad : cursorMatOk;

                    if (ghostNode) { disposeNode(ghostNode); ghostNode = null; }
                    const ghostItem: PlacedItem = {
                        id: '_ghost', type: st.buildMode,
                        position: [gx, 0, gz], rotation: st.buildRotation,
                        config: st.buildConfig as any,
                    };
                    ghostNode = buildEntityMesh(ghostItem, true);
                }
            }

            if (info.type === PointerEventTypes.POINTERDOWN) {
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
                    const gx = Math.round(pick.pickedPoint.x / 2) * 2;
                    const gz = Math.round(pick.pickedPoint.z / 2) * 2;
                    // Cameras are pole-mounted — they can share a tile with other entities
                    const occupied = st2.buildMode !== 'camera' && st2.placedItems.some(i =>
                        Math.abs(i.position[0] - gx) < 0.1 && Math.abs(i.position[2] - gz) < 0.1
                    );
                    if (!occupied) {
                        st2.addPlacedItem({
                            type: st2.buildMode,
                            position: [gx, 0, gz],
                            rotation: st2.buildRotation,
                            config: st2.buildMode === 'cobot'
                                ? { ...st2.buildConfig, program: [] }
                                : st2.buildConfig,
                        });
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
            if (['sender','receiver','indexed_receiver','pile'].includes(item.type)) return (item.config?.machineHeight || TILE_CENTER_Y) + DISC_HALF_H + 0.012;
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
                return dx <= w / 2 + radius * 0.6 && dz <= d / 2 + radius * 0.6;
            }
            if (item.type === 'belt') {
                const [w, d] = item.config?.beltSize || [2, 2];
                return dx <= w / 2 + radius * 0.6 && dz <= d / 2 + radius * 0.6;
            }
            if (['sender','receiver','indexed_receiver','pile'].includes(item.type)) {
                const [w, d] = item.config?.machineSize || [2, 2];
                return dx <= w / 2 + radius * 0.6 && dz <= d / 2 + radius * 0.6;
            }
            return dx <= 1.0 + radius * 0.6 && dz <= 1.0 + radius * 0.6;
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
        let elapsed = 0;
        const lastSpawnTime: Record<string, number> = {};
        scene.registerBeforeRender(() => {
            const delta = engine.getDeltaTime() / 1000;
            elapsed += delta;
            const st = factoryStore.getState();
            const { isRunning, placedItems } = st;
            updateTeachZones(st);
            updateCameraHighlights(st);

            // Sync layout
            if (placedItems !== prevItems) {
                prevItems = placedItems;
                syncEntities(placedItems);
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

            // ── Sender spawn ─────────────────────────────────────────────
            placedItems.forEach(item => {
                if (item.type !== 'sender') return;
                const last = lastSpawnTime[item.id] ?? 0;
                const interval = item.config?.speed || 3;
                if (elapsed - last < interval) return;
                lastSpawnTime[item.id] = elapsed;
                const color = (item.config?.spawnColor && item.config.spawnColor !== 'any')
                    ? item.config.spawnColor
                    : ITEM_COLORS[Math.floor(Math.random() * ITEM_COLORS.length)];
                const size = item.config?.spawnSize && item.config.spawnSize !== 'any'
                    ? item.config.spawnSize
                    : randomPartSize();
                simState.items.push({
                    id: Math.random().toString(36).slice(2),
                    pos: new Vector3(item.position[0], itemSurfaceCenterY(item) + 0.35, item.position[2]),
                    rotY: Math.random() * Math.PI * 2,
                    state: 'free',
                    color,
                    size,
                });
            });

            updateCameraDetections(placedItems.filter(i => i.type === 'camera'), placedItems);

            // ── Tick cobots ──────────────────────────────────────────────
            for (const [id, cState] of cobotStates) {
                const collided = tickCobot(cState, delta, isRunning);
                const runtime = cobotRuntimeState(cState, isRunning);
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
                // Lazy-create pool mesh
                if (!partMeshes[index]) {
                    const disc = createPlateMesh(scene, '#94a3b8', false, `part_${index}`);
                    shadows.addShadowCaster(disc);
                    partMeshes[index] = disc;
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
                mesh.scaling.set(sizeScale, 1, sizeScale);

                if (simItem.state === 'grabbed') {
                    // Gripper controls position directly
                    mesh.position.copyFrom(simItem.pos);
                    mesh.rotation.y = simItem.rotY;
                    velY.set(index, 0);
                } else {
                    // ── Manual gravity ────────────────────────────────────
                    let vy = velY.get(index) ?? 0;

                    const gx = Math.round(simItem.pos.x / 2) * 2;
                    const gz = Math.round(simItem.pos.z / 2) * 2;
                    const tile = placedItems.find(item =>
                        Math.abs(item.position[0] - gx) < 0.1 && Math.abs(item.position[2] - gz) < 0.1
                    );

                    // Landing surface height — cobot platform is at 1.16m
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

            // ── Part collision repulsion (2D circles, belt level only) ────
            const PART_D = 0.64;
            const BELT_MAX_Y = 0.65; // only repel items near belt/floor height
            const items = simState.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].state !== 'free') continue;
                if (items[i].pos.y > BELT_MAX_Y) continue; // skip stacked items
                for (let j = i + 1; j < items.length; j++) {
                    if (items[j].state !== 'free') continue;
                    if (items[j].pos.y > BELT_MAX_Y) continue; // skip stacked items
                    const dx = items[j].pos.x - items[i].pos.x;
                    const dz = items[j].pos.z - items[i].pos.z;
                    const d = Math.sqrt(dx * dx + dz * dz);
                    if (d < PART_D && d > 0.001) {
                        const push = (PART_D - d) * 0.5;
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
                    const count = item.config?.pileCount || 12;
                    const cols = 3;
                    const [w, d] = item.config?.machineSize || [2, 2];
                    const spacing = Math.min(0.52, Math.max(0.22, Math.min(w, d) / Math.max(2, cols)));
                    const startX = item.position[0] - spacing;
                    const startZ = item.position[2] - spacing;
                    const baseY = (item.config?.machineHeight || 0.7) + DISC_HALF_H + 0.02;
                    for (let i = 0; i < count; i++) {
                        const col = i % cols;
                        const row = Math.floor(i / cols);
                        simState.items.push({
                            id: Math.random().toString(36).slice(2),
                            pos: new Vector3(
                                startX + col * spacing,
                                baseY + Math.floor(row / cols) * 0.22,
                                startZ + (row % cols) * spacing
                            ),
                            rotY: Math.random() * Math.PI * 2,
                            state: 'free',
                            color: ITEM_COLORS[i % ITEM_COLORS.length],
                            size: ITEM_SIZES[i % ITEM_SIZES.length],
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
