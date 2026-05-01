import { useState, useEffect, useCallback } from 'react';
import { FactoryState, ITEM_COSTS, ItemType, PlacedItem, Direction, ItemConfig, MachineRuntimeState, PartTemplate } from './types';

const STORAGE_KEY = 'cobot-factory-sim-v10';
const LEGACY_STORAGE_KEY = 'cobot-factory-sim-v9';

const loadState = () => {
    try {
        const next = localStorage.getItem(STORAGE_KEY);
        if (next) return JSON.parse(next);
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) return JSON.parse(legacy);
    } catch (e) {
        console.warn("Failed to load state from localStorage", e);
    }
    return null;
};

const generateId = () => Math.random().toString(36).substring(2, 15);

const defaultPartTemplates: PartTemplate[] = [
    { id: 'tpl_disc_hole_red', name: 'Disk Hole Red', shape: 'disc', color: '#ef4444', size: 'medium', hasCenterHole: true, hasIndexHole: true },
    { id: 'tpl_can_blue', name: 'Can Blue', shape: 'can', color: '#3b82f6', size: 'medium' },
    { id: 'tpl_box_green', name: 'Box Green', shape: 'box', color: '#10b981', size: 'medium' },
    { id: 'tpl_pyramid_yellow', name: 'Pyramid Yellow', shape: 'pyramid', color: '#f59e0b', size: 'medium' },
];
const cloneDefaultPartTemplates = () => defaultPartTemplates.map(t => ({ ...t }));

const defaultItems: PlacedItem[] = [
    { id: 's1', type: 'sender', position: [-7.5, 0, 0], rotation: 1, config: { speed: 3, spawnColor: 'any', spawnSize: 'any', spawnTemplateId: 'any', machineSize: [2.5, 2.5], machineHeight: 1 } },
    { id: 'b1', type: 'belt', position: [-5, 0, 0], rotation: 1, config: { speed: 2, beltSize: [2.5, 2.5], beltHeight: 1, beltBorders: [true, true] } },
    { id: 'b2', type: 'belt', position: [-2.5, 0, 0], rotation: 1, config: { speed: 1, beltSize: [2.5, 2.5], beltHeight: 1, beltBorders: [true, true] } },
    { id: 'b3', type: 'belt', position: [0, 0, 0], rotation: 1, config: { speed: 2, beltSize: [2.5, 2.5], beltHeight: 1, beltBorders: [true, true] } },
    { id: 'b4', type: 'belt', position: [2.5, 0, 0], rotation: 1, config: { speed: 1, beltSize: [2.5, 2.5], beltHeight: 1, beltBorders: [true, true] } },
    { id: 'b5', type: 'belt', position: [5.0, 0, 0], rotation: 1, config: { speed: 2, beltSize: [2.5, 2.5], beltHeight: 1, beltBorders: [true, true] } },
    { id: 'r2', type: 'receiver', position: [7.5, 0, 0], rotation: 3, config: { acceptColor: 'any', machineSize: [2.5, 2.5], machineHeight: 1 } },

    {
        id: 'c1',
        type: 'cobot',
        position: [-2.5, 0, 2.5],
        rotation: 0,
        config: {
            speed: 1.5,
            stackMatrix: [3, 3],
            mountSlot: [2, 2],
            defaultDropSortColor: true,
            defaultDropSortSize: true,
            defaultDropSortShape: true,
            pickColors: [],
            pickSizes: [],
            linkedCameraIds: [],
            showTeachZones: true,
            showTeachPoints: true,
            showArmRange: true,
            cobotCollisionEnabled: true,
            cobotUpperArmLength: 1.8,
            cobotForearmLength: 1.38,
            cobotWristLength: 0.56,
            cobotUpperArmDiameter: 0.34,
            cobotForearmDiameter: 0.26,
            cobotWristDiameter: 0.2,
            cobotShoulderMinDeg: -77,
            cobotShoulderDefDeg: 0,
            cobotShoulderMaxDeg: 80,
            cobotElbowMinDeg: 13,
            cobotElbowDefDeg: 90,
            cobotElbowMaxDeg: 166,
            cobotWristMinDeg: -180,
            cobotWristDefDeg: -90,
            cobotWristMaxDeg: 180,
            cobotShoulderVisualOffsetX: 0,
            cobotShoulderVisualOffsetY: 0,
            cobotShoulderVisualOffsetZ: 0,
            cobotElbowVisualOffsetX: 0.18,
            cobotElbowVisualOffsetY: 0,
            cobotElbowVisualOffsetZ: 0,
            cobotWristVisualOffsetX: 0,
            cobotWristVisualOffsetY: 0,
            cobotWristVisualOffsetZ: 0,
            cobotShoulderJointDiameter: 0.44,
            cobotElbowJointDiameter: 0.44,
            cobotWristJointDiameter: 0.3,
            cobotToolJointDiameter: 0.26,
            cobotShoulderJointLength: 0.44,
            cobotElbowJointLength: 0.44,
            cobotWristJointLength: 0.3,
            cobotToolJointLength: 0.26,
            cobotShoulderJointOffsetX: 0,
            cobotShoulderJointOffsetY: 0,
            cobotShoulderJointOffsetZ: 0,
            cobotElbowJointOffsetX: 0,
            cobotElbowJointOffsetY: 0,
            cobotElbowJointOffsetZ: 0,
            cobotWristJointOffsetX: 0,
            cobotWristJointOffsetY: 0,
            cobotWristJointOffsetZ: 0,
            cobotPedestalHeight: 0.3,
            cobotPedestalRadiusScale: 1,
            cobotBaseRingRadiusScale: 1,
            cobotTuningSelectedElement: 'shoulder',
            cobotTuningMode: false,
            program: [
                { action: 'pick', pos: [-2.5, 1.25, 0] },
                { action: 'drop', pos: [-2.5, 1.25, 5] }
            ]
        }
    },
    { id: 't1', type: 'table', position: [-2.5, 0, 5], rotation: 0, config: { tableSize: [2.5, 2.5], tableHeight: 1, tableGrid: [3, 3], showTableGrid: true } },

    {
        id: 'c2',
        type: 'cobot',
        position: [2.5, 0, 2.5],
        rotation: 0,
        config: {
            speed: 1.5,
            stackMatrix: [3, 3],
            mountSlot: [2, 2],
            defaultDropSortColor: true,
            defaultDropSortSize: true,
            defaultDropSortShape: true,
            pickColors: [],
            pickSizes: [],
            linkedCameraIds: [],
            showTeachZones: true,
            showTeachPoints: true,
            showArmRange: true,
            cobotCollisionEnabled: true,
            cobotUpperArmLength: 1.8,
            cobotForearmLength: 1.38,
            cobotWristLength: 0.56,
            cobotUpperArmDiameter: 0.34,
            cobotForearmDiameter: 0.26,
            cobotWristDiameter: 0.2,
            cobotShoulderMinDeg: -77,
            cobotShoulderDefDeg: 0,
            cobotShoulderMaxDeg: 80,
            cobotElbowMinDeg: 13,
            cobotElbowDefDeg: 90,
            cobotElbowMaxDeg: 166,
            cobotWristMinDeg: -180,
            cobotWristDefDeg: -90,
            cobotWristMaxDeg: 180,
            cobotShoulderVisualOffsetX: 0,
            cobotShoulderVisualOffsetY: 0,
            cobotShoulderVisualOffsetZ: 0,
            cobotElbowVisualOffsetX: 0.18,
            cobotElbowVisualOffsetY: 0,
            cobotElbowVisualOffsetZ: 0,
            cobotWristVisualOffsetX: 0,
            cobotWristVisualOffsetY: 0,
            cobotWristVisualOffsetZ: 0,
            cobotShoulderJointDiameter: 0.44,
            cobotElbowJointDiameter: 0.44,
            cobotWristJointDiameter: 0.3,
            cobotToolJointDiameter: 0.26,
            cobotShoulderJointLength: 0.44,
            cobotElbowJointLength: 0.44,
            cobotWristJointLength: 0.3,
            cobotToolJointLength: 0.26,
            cobotShoulderJointOffsetX: 0,
            cobotShoulderJointOffsetY: 0,
            cobotShoulderJointOffsetZ: 0,
            cobotElbowJointOffsetX: 0,
            cobotElbowJointOffsetY: 0,
            cobotElbowJointOffsetZ: 0,
            cobotWristJointOffsetX: 0,
            cobotWristJointOffsetY: 0,
            cobotWristJointOffsetZ: 0,
            cobotPedestalHeight: 0.3,
            cobotPedestalRadiusScale: 1,
            cobotBaseRingRadiusScale: 1,
            cobotTuningSelectedElement: 'shoulder',
            cobotTuningMode: false,
            program: [
                { action: 'pick', pos: [2.5, 1.25, 0] },
                { action: 'drop', pos: [2.5, 1.25, 5] }
            ]
        }
    },
    { id: 'r1', type: 'receiver', position: [2.5, 0, 5], rotation: 0, config: { acceptColor: 'any', machineSize: [2.5, 2.5], machineHeight: 1 } },
    { id: 'cam1', type: 'camera', position: [2.5, 0, 0], rotation: 0, config: { showBeam: true } }
];

const initialState = loadState() || {
    credits: 5000,
    score: 0,
    placedItems: defaultItems,
    partTemplates: cloneDefaultPartTemplates(),
    cameraPreviewFps: 8,
    cameraPreviewWidth: 320,
    cameraPreviewHeight: 200,
};

class Store {
    state: FactoryState;
    listeners = new Set<() => void>();

    constructor() {
        this.state = {
            credits: initialState.credits,
            score: initialState.score,
            placedItems: initialState.placedItems,
            partTemplates: Array.isArray(initialState.partTemplates) && initialState.partTemplates.length > 0
                ? initialState.partTemplates
                : cloneDefaultPartTemplates(),
            isRunning: false,
            isPaused: false,
            simSpeedMult: 1,
            cameraPreviewFps: Math.max(1, Math.min(30, Math.round(initialState.cameraPreviewFps ?? 8))),
            cameraPreviewWidth: Math.max(160, Math.min(1024, Math.round(initialState.cameraPreviewWidth ?? 320))),
            cameraPreviewHeight: Math.max(100, Math.min(768, Math.round(initialState.cameraPreviewHeight ?? 200))),
            buildMode: null,
            draftPlacement: null,
            buildRotation: 0,
            buildConfig: { speed: 1 },
            selectedItemId: null,
            moveModeItemId: null,
            moveModeOriginalItem: null,
            teachAction: null,
            machineStates: {},

            setDraftPlacement: (draft) => this.setState({ draftPlacement: draft }),
            setCredits: (credits: number) => this.setState({ credits }),
            setScore: (score) => {
                const newScore = typeof score === 'function' ? score(this.state.score) : score;
                this.setState({ score: newScore });
            },
            setIsRunning: (isRunning: boolean) => {
                if (isRunning && !this.state.isRunning) {
                    this.setState({
                        isRunning,
                        isPaused: false,
                        score: 0,
                        selectedItemId: null,
                        moveModeItemId: null,
                        moveModeOriginalItem: null,
                        teachAction: null,
                        buildMode: null,
                        placedItems: this.state.placedItems.map(item => item.type === 'cobot'
                            ? {
                                ...item,
                                config: {
                                    ...item.config,
                                    collisionStopped: false,
                                    cobotManualControl: false,
                                    cobotTuningMode: false,
                                    isStopped: false,
                                }
                            }
                            : item
                        )
                    });
                } else {
                    this.setState({ isRunning, isPaused: false, buildMode: null, draftPlacement: null, teachAction: null, selectedItemId: null, moveModeItemId: null });
                }
            },
            setIsPaused: (isPaused: boolean) => this.setState({ isPaused }),
            setSimSpeedMult: (mult: number) => this.setState({ simSpeedMult: Math.max(0.2, Math.min(10, mult)) }),
            setCameraPreviewFps: (fps: number) => this.setState({ cameraPreviewFps: Math.max(1, Math.min(30, Math.round(fps))) }),
            setCameraPreviewResolution: (width: number, height: number) => this.setState({
                cameraPreviewWidth: Math.max(160, Math.min(1024, Math.round(width))),
                cameraPreviewHeight: Math.max(100, Math.min(768, Math.round(height))),
            }),
            setBuildMode: (buildMode: ItemType | null) => {
                let defaultConfig: ItemConfig = { speed: 1 };
                if (buildMode === 'sender') { defaultConfig.speed = 3; defaultConfig.spawnColor = 'any'; defaultConfig.spawnSize = 'any'; defaultConfig.spawnTemplateId = 'any'; defaultConfig.machineSize = [2.5, 2.5]; defaultConfig.machineHeight = 1; }
                if (buildMode === 'receiver') { defaultConfig.acceptColor = 'any'; defaultConfig.machineSize = [2.5, 2.5]; defaultConfig.machineHeight = 1; }
                if (buildMode === 'belt') { defaultConfig.speed = 2; defaultConfig.beltSize = [2.5, 2.5]; defaultConfig.beltHeight = 1; defaultConfig.beltBorders = [true, true]; }
                if (buildMode === 'cobot') { defaultConfig.program = []; defaultConfig.stackMatrix = [3, 3]; defaultConfig.mountSlot = [2, 2]; defaultConfig.defaultDropSortColor = true; defaultConfig.defaultDropSortSize = true; defaultConfig.defaultDropSortShape = true; defaultConfig.pickColors = []; defaultConfig.pickSizes = []; defaultConfig.linkedCameraIds = []; defaultConfig.showTeachZones = true; defaultConfig.showTeachPoints = true; defaultConfig.showArmRange = true; defaultConfig.cobotCollisionEnabled = true; defaultConfig.cobotUpperArmLength = 1.8; defaultConfig.cobotForearmLength = 1.38; defaultConfig.cobotWristLength = 0.56; defaultConfig.cobotUpperArmDiameter = 0.34; defaultConfig.cobotForearmDiameter = 0.26; defaultConfig.cobotWristDiameter = 0.2; defaultConfig.cobotShoulderMinDeg = -77; defaultConfig.cobotShoulderDefDeg = 0; defaultConfig.cobotShoulderMaxDeg = 80; defaultConfig.cobotElbowMinDeg = 13; defaultConfig.cobotElbowDefDeg = 90; defaultConfig.cobotElbowMaxDeg = 166; defaultConfig.cobotWristMinDeg = -180; defaultConfig.cobotWristDefDeg = -90; defaultConfig.cobotWristMaxDeg = 180; defaultConfig.cobotShoulderVisualOffsetX = 0; defaultConfig.cobotShoulderVisualOffsetY = 0; defaultConfig.cobotShoulderVisualOffsetZ = 0; defaultConfig.cobotElbowVisualOffsetX = 0.18; defaultConfig.cobotElbowVisualOffsetY = 0; defaultConfig.cobotElbowVisualOffsetZ = 0; defaultConfig.cobotWristVisualOffsetX = 0; defaultConfig.cobotWristVisualOffsetY = 0; defaultConfig.cobotWristVisualOffsetZ = 0; defaultConfig.cobotShoulderJointDiameter = 0.44; defaultConfig.cobotElbowJointDiameter = 0.44; defaultConfig.cobotWristJointDiameter = 0.3; defaultConfig.cobotToolJointDiameter = 0.26; defaultConfig.cobotShoulderJointLength = 0.44; defaultConfig.cobotElbowJointLength = 0.44; defaultConfig.cobotWristJointLength = 0.3; defaultConfig.cobotToolJointLength = 0.26; defaultConfig.cobotShoulderJointOffsetX = 0; defaultConfig.cobotShoulderJointOffsetY = 0; defaultConfig.cobotShoulderJointOffsetZ = 0; defaultConfig.cobotElbowJointOffsetX = 0; defaultConfig.cobotElbowJointOffsetY = 0; defaultConfig.cobotElbowJointOffsetZ = 0; defaultConfig.cobotWristJointOffsetX = 0; defaultConfig.cobotWristJointOffsetY = 0; defaultConfig.cobotWristJointOffsetZ = 0; defaultConfig.cobotPedestalHeight = 0.3; defaultConfig.cobotPedestalRadiusScale = 1; defaultConfig.cobotBaseRingRadiusScale = 1; defaultConfig.cobotTuningMode = false; }
                if (buildMode === 'camera') { defaultConfig.showBeam = true; }
                if (buildMode === 'table') { defaultConfig.tableSize = [2.5, 2.5]; defaultConfig.tableHeight = 1; defaultConfig.tableGrid = [3, 3]; defaultConfig.showTableGrid = true; }
                if (buildMode === 'pile') { defaultConfig.pileCount = 0; defaultConfig.machineSize = [2.5, 2.5]; defaultConfig.machineHeight = 1; defaultConfig.tableGrid = [3, 3]; }
                if (buildMode === 'indexed_receiver') { defaultConfig.acceptColor = 'any'; defaultConfig.machineSize = [2.5, 2.5]; defaultConfig.machineHeight = 1; }

                this.setState({ buildMode, draftPlacement: null, moveModeItemId: null, isRunning: false, isPaused: false, selectedItemId: null, teachAction: null, buildConfig: defaultConfig });
            },
            setBuildRotation: (buildRotation: Direction) => this.setState({ buildRotation }),
            setBuildConfig: (config: Partial<ItemConfig>) => this.setState({ buildConfig: { ...this.state.buildConfig, ...config } }),
            setSelectedItemId: (id: string | null) => this.setState({ selectedItemId: id, buildMode: null, draftPlacement: null, teachAction: null, moveModeItemId: null, moveModeOriginalItem: null }),
            setMoveModeItemId: (id: string | null) => {
                const item = id ? this.state.placedItems.find(i => i.id === id) : null;
                this.setState({ moveModeItemId: id, moveModeOriginalItem: item ? JSON.parse(JSON.stringify(item)) : null });
            },
            setTeachAction: (action) => this.setState({ teachAction: action }),
            addPartTemplate: (template) => {
                const id = `tpl_${generateId()}`;
                const nextTemplate: PartTemplate = { ...template, id };
                this.setState({ partTemplates: [...this.state.partTemplates, nextTemplate] });
                return id;
            },
            updatePartTemplate: (id, updates) => {
                this.setState({
                    partTemplates: this.state.partTemplates.map(t => t.id === id ? { ...t, ...updates } : t)
                });
            },
            removePartTemplate: (id) => {
                if (this.state.partTemplates.length <= 1) return;
                this.setState({
                    partTemplates: this.state.partTemplates.filter(t => t.id !== id),
                    placedItems: this.state.placedItems.map(item => {
                        if (item.type !== 'sender') return item;
                        if (item.config?.spawnTemplateId !== id) return item;
                        return {
                            ...item,
                            config: { ...item.config, spawnTemplateId: 'any' }
                        };
                    }),
                });
            },
            clonePartTemplate: (id) => {
                const src = this.state.partTemplates.find(t => t.id === id);
                if (!src) return null;
                const nextId = `tpl_${generateId()}`;
                this.setState({
                    partTemplates: [
                        ...this.state.partTemplates,
                        { ...src, id: nextId, name: `${src.name} Copy` }
                    ]
                });
                return nextId;
            },
            setMachineState: (id: string, runtime: MachineRuntimeState) => {
                const prev = this.state.machineStates[id];
                if (prev?.health === runtime.health && prev?.label === runtime.label && prev?.detail === runtime.detail) return;
                this.setState({ machineStates: { ...this.state.machineStates, [id]: runtime } });
            },
            clearMachineStates: () => this.setState({ machineStates: {} }),

            addPlacedItem: (item: Omit<PlacedItem, 'id'>) => {
                const cost = ITEM_COSTS[item.type];
                if (this.state.credits >= cost) {
                    this.setState({
                        credits: this.state.credits - cost,
                        placedItems: [...this.state.placedItems, { ...item, id: generateId() }],
                    });
                }
            },
            updatePlacedItem: (id: string, updates: Partial<PlacedItem>) => {
                this.setState({
                    placedItems: this.state.placedItems.map(item => {
                        if (item.id === id) {
                            return {
                                ...item,
                                ...updates,
                                config: { ...item.config, ...updates.config }
                            };
                        }
                        return item;
                    })
                });
            },
            removePlacedItem: (id: string) => {
                this.setState({
                    placedItems: this.state.placedItems.filter((i: PlacedItem) => i.id !== id),
                    machineStates: Object.fromEntries(Object.entries(this.state.machineStates).filter(([key]) => key !== id)),
                    selectedItemId: this.state.selectedItemId === id ? null : this.state.selectedItemId,
                    moveModeItemId: this.state.moveModeItemId === id ? null : this.state.moveModeItemId,
                    teachAction: this.state.selectedItemId === id ? null : this.state.teachAction
                });
            },
            resetFactory: () => {
                this.setState({
                    credits: 5000,
                    score: 0,
                    isRunning: false,
                    isPaused: false,
                    placedItems: defaultItems,
                    partTemplates: cloneDefaultPartTemplates(),
                    buildMode: null,
                    selectedItemId: null,
                    teachAction: null,
                    machineStates: {}
                });
            }
        };
    }

    getState = () => this.state;

    setState = (updates: Partial<FactoryState>) => {
        this.state = { ...this.state, ...updates };
        this.listeners.forEach(l => l());

        try {
            const { credits, placedItems, partTemplates, cameraPreviewFps, cameraPreviewWidth, cameraPreviewHeight } = this.state;
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                credits,
                placedItems,
                partTemplates,
                cameraPreviewFps,
                cameraPreviewWidth,
                cameraPreviewHeight
            }));
        } catch (e) {
            console.warn("Failed to save state to localStorage", e);
        }
    };

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };
}

export const factoryStore = new Store();

export function useFactoryStore<T = FactoryState>(selector?: (state: FactoryState) => T): T {
    const getSelection = useCallback(() => {
        const state = factoryStore.getState();
        return selector ? selector(state) : (state as unknown as T);
    }, [selector]);

    const [selection, setSelection] = useState(() => getSelection());

    useEffect(() => {
        const listener = () => setSelection(() => getSelection());
        const unsubscribe = factoryStore.subscribe(listener);
        return unsubscribe;
    }, [getSelection]);

    return selection;
}
