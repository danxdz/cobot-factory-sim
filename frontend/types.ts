export type ItemType = 'cobot' | 'belt' | 'sender' | 'receiver' | 'table' | 'camera' | 'pile' | 'indexed_receiver';
export type PartSize = 'small' | 'medium' | 'large';
export type PartShape = 'disc' | 'can' | 'box' | 'pyramid';
export type ProgramAction = 'move' | 'pick' | 'drop' | 'wait';

// 0: North (-Z), 1: East (+X), 2: South (+Z), 3: West (-X)
export type Direction = 0 | 1 | 2 | 3;

export interface ProgramStep {
    action: ProgramAction;
    pos?: [number, number, number];
    duration?: number;
    sortColor?: boolean;
    sortSize?: boolean;
    sortShape?: boolean;
}

export interface PartTemplate {
    id: string;
    name: string;
    shape: PartShape;
    color: string;
    size: PartSize;
    // Multi-spawn options (any of the listed will spawn randomly)
    spawnColors?: string[];   // if set, overrides color (random from list)
    spawnSizes?: PartSize[];  // if set, overrides size (random from list)
    // Disc fine-tune
    hasCenterHole?: boolean;
    hasIndexHole?: boolean;
    numHoles?: number;        // extra holes around ring (0–8)
    holeDiameter?: number;    // 0.05–0.4 relative
    // Scale fine-tune per shape (override built-in size scale)
    radiusScale?: number;     // 0.5–1.5 multiplier for disc/can radius
    heightScale?: number;     // 0.5–2.0 multiplier for can/box/pyramid height
    scaleX?: number;          // box width override
    scaleZ?: number;          // box depth override
}

export interface ItemConfig {
    speed?: number; 
    program?: ProgramStep[]; // For Cobot programmability
    spawnColor?: string; // For Senders
    spawnSize?: PartSize | 'any'; // For Senders
    spawnTemplateId?: string | 'any'; // For Senders
    acceptColor?: string; // For Receivers, Tables, Piles
    acceptSize?: PartSize | 'any'; // For Receivers, Tables, Piles
    autoOrganize?: boolean; // For Cobots: auto-sort items when idle
    pileCount?: number; // For Piles (number of pre-loaded parts)
    showWalls?: boolean; // For Piles (whether to render the outer walls)
    pickColors?: string[]; // For Cobots: empty means any color
    pickSizes?: PartSize[]; // For Cobots: empty means any size
    linkedCameraIds?: string[]; // For Cobots: cameras allowed to provide detections
    defaultDropSortColor?: boolean; // For Cobots: default sort-by-color for new drop steps
    defaultDropSortSize?: boolean; // For Cobots: default sort-by-size for new drop steps
    defaultDropSortShape?: boolean; // For Cobots: default sort-by-shape for new drop steps
    stackMax?: number; // For Cobots: max items per stack
    stackMatrix?: [number, number]; // For Cobots: [cols, rows] grid size
    mountSlot?: [number, number]; // For Cobots: arm mount slot [col, row] within stack grid
    showTeachZones?: boolean; // For Cobots: show pick/drop teaching zones while selected
    showTeachPoints?: boolean; // For Cobots: show taught pick/drop point balls while selected
    showArmRange?: boolean; // For Cobots: show reachable arm workspace while selected
    cobotShowPath?: boolean; // For Cobots: show real-time toolpath trajectory while simulation is running
    uiActiveProgramStepIndex?: number; // For Cobots UI: currently edited program step index
    enableRepulsion?: boolean; // For Cobots: enable/disable soft avoidance force
    cobotCollisionEnabled?: boolean; // For Cobots: enable/disable collision safety system
    collisionStopped?: boolean; // For Cobots: local safety pause after collision
    isStopped?: boolean; // For Cobots: manual pause toggle
    triggerUnlock?: number; // For Cobots: force runtime unlock pulse
    cobotHomeTarget?: [number, number, number]; // For Cobots: saved gripper home/idle target
    cobotManualTarget?: [number, number, number]; // For Cobots: temporary manual gripper target
    cobotManualControl?: boolean; // For Cobots: pause automation and jog arm to manual target
    cobotUpperArmLength?: number; // For Cobots: shoulder->elbow segment length
    cobotForearmLength?: number; // For Cobots: elbow->wrist segment length
    cobotWristLength?: number; // For Cobots: wrist tube length (before tool)
    cobotUpperArmDiameter?: number; // For Cobots: upper arm visual diameter
    cobotForearmDiameter?: number; // For Cobots: forearm visual diameter
    cobotWristDiameter?: number; // For Cobots: wrist tube visual diameter
    cobotShoulderMinDeg?: number; // For Cobots: shoulder lower angle limit in degrees
    cobotShoulderDefDeg?: number; // For Cobots: shoulder default tuning angle in degrees
    cobotShoulderMaxDeg?: number; // For Cobots: shoulder upper angle limit in degrees
    cobotElbowMinDeg?: number; // For Cobots: elbow lower angle limit in degrees
    cobotElbowDefDeg?: number; // For Cobots: elbow default tuning angle in degrees
    cobotElbowMaxDeg?: number; // For Cobots: elbow upper angle limit in degrees
    cobotWristMinDeg?: number; // For Cobots: wrist lower angle limit in degrees
    cobotWristDefDeg?: number; // For Cobots: wrist default tuning angle in degrees
    cobotWristMaxDeg?: number; // For Cobots: wrist upper angle limit in degrees
    cobotShoulderVisualOffsetX?: number; // For Cobots: shoulder segment visual offset X
    cobotShoulderVisualOffsetY?: number; // For Cobots: shoulder segment visual offset Y
    cobotShoulderVisualOffsetZ?: number; // For Cobots: shoulder segment visual offset Z
    cobotElbowVisualOffsetX?: number; // For Cobots: elbow segment visual offset X
    cobotElbowVisualOffsetY?: number; // For Cobots: elbow segment visual offset Y
    cobotElbowVisualOffsetZ?: number; // For Cobots: elbow segment visual offset Z
    cobotWristVisualOffsetX?: number; // For Cobots: wrist segment visual offset X
    cobotWristVisualOffsetY?: number; // For Cobots: wrist segment visual offset Y
    cobotWristVisualOffsetZ?: number; // For Cobots: wrist segment visual offset Z
    cobotShoulderJointDiameter?: number; // For Cobots: shoulder joint visual diameter override
    cobotElbowJointDiameter?: number; // For Cobots: elbow joint visual diameter override
    cobotWristJointDiameter?: number; // For Cobots: wrist joint visual diameter override
    cobotToolJointDiameter?: number; // For Cobots: tool joint visual diameter override
    cobotShoulderJointLength?: number; // For Cobots: shoulder joint visual length override
    cobotElbowJointLength?: number; // For Cobots: elbow joint visual length override
    cobotWristJointLength?: number; // For Cobots: wrist joint visual length override
    cobotToolJointLength?: number; // For Cobots: tool joint visual length override
    cobotShoulderJointOffsetX?: number; // For Cobots: shoulder joint visual offset X
    cobotShoulderJointOffsetY?: number; // For Cobots: shoulder joint visual offset Y
    cobotShoulderJointOffsetZ?: number; // For Cobots: shoulder joint visual offset Z
    cobotElbowJointOffsetX?: number; // For Cobots: elbow joint visual offset X
    cobotElbowJointOffsetY?: number; // For Cobots: elbow joint visual offset Y
    cobotElbowJointOffsetZ?: number; // For Cobots: elbow joint visual offset Z
    cobotWristJointOffsetX?: number; // For Cobots: wrist joint visual offset X
    cobotWristJointOffsetY?: number; // For Cobots: wrist joint visual offset Y
    cobotWristJointOffsetZ?: number; // For Cobots: wrist joint visual offset Z
    cobotPedestalHeight?: number; // For Cobots: pedestal cylinder height
    cobotPedestalRadiusScale?: number; // For Cobots: pedestal radius multiplier
    cobotBaseRingRadiusScale?: number; // For Cobots: base ring radius multiplier
    cobotTuningSelectedElement?: 'shoulder' | 'elbow' | 'wrist' | 'shoulder_joint' | 'elbow_joint' | 'wrist_joint' | 'pedestal' | 'base'; // For Cobots: active tuning target highlight
    cobotTuningMode?: boolean; // For Cobots: live geometry/angle tuning pose mode (safety collisions disabled)
    showBeam?: boolean; // For Cameras: show/hide the vision cone
    beltSize?: [number, number]; // For Belts: [width, depth]
    beltHeight?: number; // For Belts: surface height
    beltBorders?: [boolean, boolean]; // For Belts: [left rail, right rail]
    machineSize?: [number, number]; // For sender/receiver/pile modules: [width, depth]
    machineHeight?: number; // For sender/receiver/pile modules: top surface height
    tableSize?: [number, number]; // For Tables: [width, depth]
    tableHeight?: number; // For Tables: top surface height
    tableGrid?: [number, number]; // For Tables: [cols, rows] marker grid
    showTableGrid?: boolean; // For Tables: show/hide surface grid markers
    [key: string]: any;
}

export interface PlacedItem {
    id: string;
    type: ItemType;
    name?: string;
    position: [number, number, number];
    rotation: Direction;
    config?: ItemConfig;
}

export type MachineHealth = 'idle' | 'running' | 'warning' | 'stopped';

export interface MachineRuntimeState {
    health: MachineHealth;
    label: string;
    detail?: string;
    stepIndex?: number;
}

export interface FactoryState {
    credits: number;
    score: number;
    isRunning: boolean;
    isPaused: boolean;
    simSpeedMult: number;
    cameraPreviewFps: number;
    cameraPreviewWidth: number;
    cameraPreviewHeight: number;
    partTemplates: PartTemplate[];
    placedItems: PlacedItem[];
    draftPlacement: PlacedItem | null;
    buildMode: ItemType | null;
    buildRotation: Direction;
    buildConfig: ItemConfig;
    selectedItemId: string | null;
    moveModeItemId: string | null;
    moveModeOriginalItem: PlacedItem | null;
    teachAction: 'pick' | 'drop' | null; // Active when teaching a cobot
    machineStates: Record<string, MachineRuntimeState>;
    
    setCredits: (credits: number) => void;
    setScore: (score: number | ((prev: number) => number)) => void;
    setIsRunning: (isRunning: boolean) => void;
    setIsPaused: (isPaused: boolean) => void;
    setSimSpeedMult: (mult: number) => void;
    setCameraPreviewFps: (fps: number) => void;
    setCameraPreviewResolution: (width: number, height: number) => void;
    addPartTemplate: (template: Omit<PartTemplate, 'id'>) => string;
    updatePartTemplate: (id: string, updates: Partial<Omit<PartTemplate, 'id'>>) => void;
    removePartTemplate: (id: string) => void;
    clonePartTemplate: (id: string) => string | null;
    setDraftPlacement: (draft: PlacedItem | null) => void;
    setBuildMode: (mode: ItemType | null) => void;
    setBuildRotation: (rot: Direction) => void;
    setBuildConfig: (config: Partial<ItemConfig>) => void;
    setSelectedItemId: (id: string | null) => void;
    setMoveModeItemId: (id: string | null) => void;
    setTeachAction: (action: 'pick' | 'drop' | null) => void;
    setMachineState: (id: string, runtime: MachineRuntimeState) => void;
    clearMachineStates: () => void;
    addPlacedItem: (item: Omit<PlacedItem, 'id'>) => void;
    updatePlacedItem: (id: string, updates: Partial<PlacedItem>) => void;
    removePlacedItem: (id: string) => void;
    resetFactory: () => void;
}

export const ITEM_COSTS: Record<ItemType, number> = {
    cobot: 1000,
    belt: 50,
    sender: 500,
    receiver: 500,
    table: 100,
    camera: 200,
    pile: 300,
    indexed_receiver: 600,
};
