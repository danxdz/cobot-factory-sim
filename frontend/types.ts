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
}

export interface PartTemplate {
    id: string;
    name: string;
    shape: PartShape;
    color: string;
    size: PartSize;
    hasCenterHole?: boolean; // For disc templates
    hasIndexHole?: boolean; // For disc templates
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
    stackMax?: number; // For Cobots: max items per stack
    stackMatrix?: [number, number]; // For Cobots: [cols, rows] grid size
    mountSlot?: [number, number]; // For Cobots: arm mount slot [col, row] within stack grid
    showTeachZones?: boolean; // For Cobots: show pick/drop teaching zones while selected
    showTeachPoints?: boolean; // For Cobots: show taught pick/drop point balls while selected
    showArmRange?: boolean; // For Cobots: show reachable arm workspace while selected
    collisionStopped?: boolean; // For Cobots: local safety pause after collision
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
}

export interface FactoryState {
    credits: number;
    score: number;
    isRunning: boolean;
    isPaused: boolean;
    simSpeedMult: number;
    partTemplates: PartTemplate[];
    placedItems: PlacedItem[];
    buildMode: ItemType | null;
    buildRotation: Direction;
    buildConfig: ItemConfig;
    selectedItemId: string | null;
    teachAction: 'pick' | 'drop' | null; // Active when teaching a cobot
    machineStates: Record<string, MachineRuntimeState>;
    
    setCredits: (credits: number) => void;
    setScore: (score: number | ((prev: number) => number)) => void;
    setIsRunning: (isRunning: boolean) => void;
    setIsPaused: (isPaused: boolean) => void;
    setSimSpeedMult: (mult: number) => void;
    addPartTemplate: (template: Omit<PartTemplate, 'id'>) => string;
    updatePartTemplate: (id: string, updates: Partial<Omit<PartTemplate, 'id'>>) => void;
    removePartTemplate: (id: string) => void;
    clonePartTemplate: (id: string) => string | null;
    setBuildMode: (mode: ItemType | null) => void;
    setBuildRotation: (rot: Direction) => void;
    setBuildConfig: (config: Partial<ItemConfig>) => void;
    setSelectedItemId: (id: string | null) => void;
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
