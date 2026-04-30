import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, Pause, Trash2, Settings2, X, RotateCw, Cpu, Plus, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Camera, SlidersHorizontal, Download, Upload, Move, HelpCircle, Link2, Target, List, Home } from 'lucide-react';
import { useFactoryStore } from '../store';
import { ITEM_COSTS, ItemType, Direction, PartShape, PartSize, ProgramAction, ProgramStep, PlacedItem } from '../types';
import { simState, SimItem } from '../simState';
import { PartPreview3D } from './PartPreview3D';

const PICK_COLORS = [
    { label: 'Red', value: '#ef4444' },
    { label: 'Blue', value: '#3b82f6' },
    { label: 'Green', value: '#10b981' },
    { label: 'Yellow', value: '#f59e0b' },
];
const PICK_SIZES: PartSize[] = ['small', 'medium', 'large'];
const PART_SHAPES: PartShape[] = ['disc', 'can', 'box', 'pyramid'];
const PART_COLORS = [
    { label: 'Red', value: '#ef4444' },
    { label: 'Blue', value: '#3b82f6' },
    { label: 'Green', value: '#10b981' },
    { label: 'Yellow', value: '#f59e0b' },
    { label: 'Slate', value: '#94a3b8' },
    { label: 'Purple', value: '#a855f7' },
];
const PROGRAM_ACTIONS: ProgramAction[] = ['move', 'pick', 'drop', 'wait'];
const CAMERA_PREVIEW_RESOLUTIONS = [
    { label: '320x200', width: 320, height: 200 },
    { label: '640x400', width: 640, height: 400 },
    { label: '800x500', width: 800, height: 500 },
] as const;
const COBOT_PLATFORM_W = 1.98;
const COBOT_PLATFORM_D = 1.98;
const COBOT_PLATFORM_MARGIN = 0.16;
const COBOT_PLATFORM_TOP_Y = 1.34 + 0.03;
const COBOT_SLOT_RADIUS = 0.28;
const PART_THICKNESS = 0.025;
const TILE_CENTER_Y = 0.545;
const TABLE_CENTER_Y = 0.458;

type CobotSlot = {
    col: number;
    row: number;
    x: number;
    y: number;
    z: number;
};

function cobotSlotsWorld(item: PlacedItem, cols: number, rows: number): CobotSlot[] {
    const usableW = Math.max(0.2, COBOT_PLATFORM_W - COBOT_PLATFORM_MARGIN);
    const usableD = Math.max(0.2, COBOT_PLATFORM_D - COBOT_PLATFORM_MARGIN);
    const cellW = usableW / cols;
    const cellD = usableD / rows;
    const rotY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][item.rotation] ?? 0;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const slots: CobotSlot[] = [];

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const lx = -usableW / 2 + cellW * (col + 0.5);
            const lz = -usableD / 2 + cellD * (row + 0.5);
            const x = item.position[0] + lx * cosY + lz * sinY;
            const z = item.position[2] - lx * sinY + lz * cosY;
            const y = item.position[1] + COBOT_PLATFORM_TOP_Y + PART_THICKNESS / 2;
            slots.push({ col, row, x, y, z });
        }
    }
    return slots;
}

function itemSurfaceTopForDashboard(item: PlacedItem): number {
    if (item.type === 'belt') return item.position[1] + (item.config?.beltHeight || TILE_CENTER_Y);
    if (item.type === 'table') return item.position[1] + (item.config?.tableHeight || TABLE_CENTER_Y);
    if (['sender', 'receiver', 'indexed_receiver', 'pile'].includes(item.type)) return item.position[1] + (item.config?.machineHeight || TILE_CENTER_Y);
    if (item.type === 'cobot') return item.position[1] + COBOT_PLATFORM_TOP_Y;
    return 0;
}

function itemFootprintContains(item: PlacedItem, x: number, z: number, pad = 0): boolean {
    if (item.type === 'camera') return false;
    const dx = Math.abs(x - item.position[0]);
    const dz = Math.abs(z - item.position[2]);
    const isRotated = (item.rotation || 0) % 2 !== 0;
    const lx = isRotated ? dz : dx;
    const lz = isRotated ? dx : dz;

    let w = 2.5;
    let d = 2.5;
    if (item.type === 'table') [w, d] = item.config?.tableSize || [2.5, 2.5];
    else if (item.type === 'belt') [w, d] = item.config?.beltSize || [2.5, 2.5];
    else if (['sender', 'receiver', 'indexed_receiver', 'pile'].includes(item.type)) [w, d] = item.config?.machineSize || [2.5, 2.5];
    else if (item.type === 'cobot') { w = COBOT_PLATFORM_W; d = COBOT_PLATFORM_D; }
    return lx <= w / 2 + pad && lz <= d / 2 + pad;
}

function supportTypeForPart(part: SimItem, placedItems: PlacedItem[]): ItemType | 'none' {
    let bestType: ItemType | 'none' = 'none';
    let bestTop = Number.NEGATIVE_INFINITY;
    for (const item of placedItems) {
        if (!itemFootprintContains(item, part.pos.x, part.pos.z)) continue;
        const top = itemSurfaceTopForDashboard(item);
        if (top > bestTop) {
            bestTop = top;
            bestType = item.type;
        }
    }
    return bestType;
}
const RangeSlider = ({ label, value, min, max, step, onChange, isWidth }: { label: string, value: number, min: number, max: number, step: number, onChange: (val: number) => void, isWidth?: boolean }) => {
    const handleWheel = (e: React.WheelEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const delta = e.deltaY > 0 ? -step : step;
        let nextVal = value + delta;
        nextVal = Math.max(min, Math.min(max, nextVal));
        onChange(nextVal);
    };

    return (
        <label className={`flex flex-col gap-1 ${isWidth ? 'col-span-full' : ''}`}>
            <div className="flex justify-between items-center text-[10px] font-bold text-gray-500">
                <span>{label}</span>
                <span className="text-[#38bdf8] font-mono">{Number(value).toFixed(2)}</span>
            </div>
            <input 
                type="range" 
                min={min} max={max} step={step} 
                value={value} 
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)} 
                onWheel={handleWheel}
                className="w-full cursor-ew-resize"
            />
        </label>
    );
};

const TransformPanel = ({ item, updateItem, isDraft, snapStep, heightStep, onCancel, onValidate }: { item: PlacedItem, updateItem: (updates: Partial<PlacedItem>) => void, isDraft?: boolean, snapStep: number, heightStep: number, onCancel?: () => void, onValidate?: () => void }) => {
    const snapValue = (val: number, step: number) => Math.round(val / step) * step;
    
    const patchPosition = (axis: 0 | 1 | 2, value: number) => {
        const next = [...item.position] as [number, number, number];
        next[axis] = snapValue(value, axis === 1 ? heightStep : snapStep);
        updateItem({ position: next });
    };
    const patchSize = (axis: 0 | 1, value: number) => {
        const currentSize = item.config?.machineSize || item.config?.beltSize || item.config?.tableSize || [2.5, 2.5];
        const next = [...currentSize] as [number, number];
        next[axis] = Math.max(0.5, snapValue(value, snapStep));
        if (item.type === 'belt') updateItem({ config: { ...item.config, beltSize: next } });
        else if (item.type === 'table') updateItem({ config: { ...item.config, tableSize: next } });
        else updateItem({ config: { ...item.config, machineSize: next } });
    };
    const patchHeight = (value: number) => {
        const v = Math.max(0.1, snapValue(value, heightStep));
        if (item.type === 'belt') updateItem({ config: { ...item.config, beltHeight: v } });
        else if (item.type === 'table') updateItem({ config: { ...item.config, tableHeight: v } });
        else updateItem({ config: { ...item.config, machineHeight: v } });
    };

    const hasSize = ['sender', 'receiver', 'indexed_receiver', 'pile', 'belt', 'table'].includes(item.type);

    return (
        <div className="flex flex-col gap-3 w-full">
            <div className="flex justify-between items-center text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                <span>Transform & Resize</span>
                {isDraft && <span className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded text-[9px] animate-pulse">Click grid to teleport</span>}
            </div>
            <div className="grid grid-cols-3 gap-3">
                <RangeSlider label="POS X" min={-10} max={10} step={snapStep} value={item.position[0]} onChange={(v) => patchPosition(0, v)} />
                <RangeSlider label="POS Y" min={0} max={5} step={heightStep} value={item.position[1]} onChange={(v) => patchPosition(1, v)} />
                <RangeSlider label="POS Z" min={-10} max={10} step={snapStep} value={item.position[2]} onChange={(v) => patchPosition(2, v)} />
            </div>
            <button onClick={() => updateItem({ rotation: ((item.rotation + 1) % 4) as Direction })} className="bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white rounded p-1.5 flex items-center justify-center gap-2 font-bold text-[10px] transition-colors">
                <RotateCw size={12} /> ROTATE 90Â°
            </button>
            {hasSize && (
                <div className="grid grid-cols-3 gap-3">
                    <RangeSlider label="WIDTH" min={0.5} max={4} step={snapStep} value={item.config?.machineSize?.[0] || item.config?.beltSize?.[0] || item.config?.tableSize?.[0] || 2.5} onChange={(v) => patchSize(0, v)} />
                    <RangeSlider label="DEPTH" min={0.5} max={4} step={snapStep} value={item.config?.machineSize?.[1] || item.config?.beltSize?.[1] || item.config?.tableSize?.[1] || 2.5} onChange={(v) => patchSize(1, v)} />
                    <RangeSlider label="HEIGHT" min={0.1} max={1.5} step={heightStep} value={item.config?.machineHeight || item.config?.beltHeight || item.config?.tableHeight || (item.type === 'pile' ? 0.7 : 0.538)} onChange={(v) => patchHeight(v)} />
                </div>
            )}
            {item.type === 'pile' && (
                <div className="flex flex-col gap-3 mt-1">
                    <div className="grid grid-cols-2 gap-3">
                        <RangeSlider label="GRID W" min={1} max={6} step={1} value={item.config?.tableGrid?.[0] || 3} onChange={(v) => updateItem({ config: { ...item.config, tableGrid: [v, item.config?.tableGrid?.[1] || 3] } })} />
                        <RangeSlider label="GRID D" min={1} max={6} step={1} value={item.config?.tableGrid?.[1] || 3} onChange={(v) => updateItem({ config: { ...item.config, tableGrid: [item.config?.tableGrid?.[0] || 3, v] } })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 items-end">
                        <RangeSlider label="STARTING ITEMS" min={0} max={24} step={1} value={item.config?.pileCount ?? 0} onChange={(v) => updateItem({ config: { ...item.config, pileCount: v } })} />
                        <label className="flex items-center justify-between rounded border border-gray-700 bg-gray-900/40 px-3 py-1.5 h-[34px]">
                            <span className="text-[10px] font-bold text-gray-500">SHOW WALLS</span>
                            <input
                                type="checkbox"
                                checked={item.config?.showWalls !== false}
                                onChange={(e) => updateItem({ config: { ...item.config, showWalls: e.target.checked } })}
                                className="accent-[#38bdf8]"
                            />
                        </label>
                    </div>
                </div>
            )}
            {(onCancel || onValidate) && (
                <div className="flex gap-2 mt-1">
                    {onCancel && <button onClick={onCancel} className="flex-1 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded py-2 font-bold text-[10px] transition-colors border border-red-500/30">CANCEL</button>}
                    {onValidate && <button onClick={onValidate} className="flex-1 rounded py-2 font-bold text-[10px] transition-colors bg-emerald-500 text-white hover:bg-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]">CONFIRM</button>}
                </div>
            )}
        </div>
    );
};

export const UI: React.FC = () => {
    const [openCobotSection, setOpenCobotSection] = useState<'transform' | 'vision' | 'controller' | null>('transform');
    const [snapInputs, setSnapInputs] = useState(true);
    const [editingName, setEditingName] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [activeGroup, setActiveGroup] = useState<string | null>(null);
    const [playClicks, setPlayClicks] = useState({ count: 0, time: 0 });
    const [showPartCreator, setShowPartCreator] = useState(false);
    const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
    const [showStopConfirm, setShowStopConfirm] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [keepBuilding, setKeepBuilding] = useState(false);
    const [cameraPreviewMode, setCameraPreviewMode] = useState<'graph' | 'video'>('video');
    const [showMasterPanel, setShowMasterPanel] = useState(true);
    const [masterCameraId, setMasterCameraId] = useState<string | null>(null);
    const [masterCameraIds, setMasterCameraIds] = useState<string[]>([]);
    const masterCameraListTouched = useRef(false);
    const [masterPanelPos, setMasterPanelPos] = useState({ x: 0, y: 0 });
    const [selectionPanelPos, setSelectionPanelPos] = useState({ x: 0, y: 0 });
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
    const [canDragPanels, setCanDragPanels] = useState(() => window.innerWidth >= 768);
    const dragRef = useRef<{
        key: 'master' | 'selection' | null;
        pointerId: number | null;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    }>({
        key: null,
        pointerId: null,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
    });
    const [, setCameraFrameTick] = useState(0);
    const { 
        credits, 
        score,
        isRunning,
        isPaused,
        setIsRunning,
        setIsPaused,
        buildMode,
        setBuildMode,
        selectedItemId,
        machineStates,
        setSelectedItemId,
        teachAction,
        setTeachAction,
        placedItems,
        updatePlacedItem,
        removePlacedItem,
        setCredits,
        resetFactory,
        simSpeedMult,
        setSimSpeedMult,
        cameraPreviewFps,
        cameraPreviewWidth,
        cameraPreviewHeight,
        setCameraPreviewFps,
        setCameraPreviewResolution,
        partTemplates,
        addPartTemplate,
        updatePartTemplate,
        removePartTemplate,
        clonePartTemplate,
        draftPlacement,
        setDraftPlacement,
        addPlacedItem,
        moveModeItemId,
        setMoveModeItemId,
        moveModeOriginalItem
    } = useFactoryStore();

    const selectedItem = placedItems.find(i => i.id === selectedItemId);
    const moduleConfigTypes: ItemType[] = ['sender', 'receiver', 'indexed_receiver', 'pile'];
    const cameras = placedItems.filter(i => i.type === 'camera');
    const cobots = placedItems.filter(i => i.type === 'cobot');
    const selectedMachineState = selectedItem ? machineStates[selectedItem.id] : undefined;
    const selectedLabel = selectedItem?.name || selectedItem?.id || '';
    const teachMinimized = !!teachAction && selectedItem?.type === 'cobot';
    const showTransforms = openCobotSection === 'transform';
    const showVisionConfig = openCobotSection === 'vision';
    const showController = openCobotSection === 'controller';
    const activeTemplate = partTemplates.find(t => t.id === activeTemplateId) || null;
    const selectedCameraDetections = selectedItem?.type === 'camera'
        ? simState.cameraDetections
            .filter(det => det.cameraId === selectedItem.id)
            .slice()
            .sort((a, b) => b.confidence - a.confidence)
        : [];
    const cameraResolutionKey = `${cameraPreviewWidth}x${cameraPreviewHeight}`;
    const cameraIds = cameras.map(cam => cam.id);
    const cameraIdsSig = cameraIds.join('|');
    const cameraDetectionsFor = (cameraId: string) =>
        simState.cameraDetections
            .filter(det => det.cameraId === cameraId)
            .slice()
            .sort((a, b) => b.confidence - a.confidence);
    const displayedMasterCameras = masterCameraIds
        .map(id => cameras.find(cam => cam.id === id))
        .filter((cam): cam is PlacedItem => !!cam);
    const displayedMasterCameraIdsSig = displayedMasterCameras.map(cam => cam.id).join('|');
    const hiddenMasterCameras = cameras.filter(cam => !masterCameraIds.includes(cam.id));
    const scoreValue = Number.isFinite(score) ? score : 0;
    const creditsValue = Number.isFinite(credits) ? credits : 0;
    const simSpeedValue = Number.isFinite(simSpeedMult) ? simSpeedMult : 1;

    const liveParts = simState.items.filter(item => item.state !== 'dead');
    let transitParts = 0;
    let stockedParts = 0;
    let looseParts = 0;
    liveParts.forEach(item => {
        const supportType = supportTypeForPart(item, placedItems);
        if (supportType === 'belt' || supportType === 'sender') transitParts += 1;
        else if (supportType === 'table' || supportType === 'pile' || supportType === 'cobot' || supportType === 'receiver' || supportType === 'indexed_receiver') stockedParts += 1;
        else looseParts += 1;
    });
    const producedEstimate = liveParts.length + scoreValue;
    const droppedEstimate = Math.max(scoreValue, stockedParts);

    let cobotRunning = 0;
    let cobotWarning = 0;
    let cobotStopped = 0;
    let cobotIdle = 0;
    cobots.forEach(cobot => {
        const runtime = machineStates[cobot.id];
        if (cobot.config?.collisionStopped || cobot.config?.isStopped || runtime?.health === 'stopped') cobotStopped += 1;
        else if (runtime?.health === 'warning') cobotWarning += 1;
        else if (runtime?.health === 'running') cobotRunning += 1;
        else cobotIdle += 1;
    });
    const camerasWithFeed = displayedMasterCameras.filter(cam => !!simState.cameraFrames[cam.id]).length;

    useEffect(() => {
        setEditingName(false);
        setDraftName(selectedItem?.name || selectedItem?.id || '');
        if (teachAction && selectedItem?.type === 'cobot') {
            setOpenCobotSection('controller');
        }
    }, [selectedItemId, selectedItem?.name, selectedItem?.id, selectedItem?.type, teachAction]);
    useEffect(() => {
        if (selectedItem?.type === 'cobot') {
            setOpenCobotSection('transform');
        }
    }, [selectedItemId]);

    useEffect(() => {
        if (partTemplates.length === 0) {
            setActiveTemplateId(null);
            return;
        }
        if (!activeTemplateId || !partTemplates.some(t => t.id === activeTemplateId)) {
            setActiveTemplateId(partTemplates[0].id);
        }
    }, [partTemplates, activeTemplateId]);
    useEffect(() => {
        if (cameraPreviewMode !== 'video' || cameras.length === 0) return;
        const fps = Math.max(1, Math.min(30, Math.round(cameraPreviewFps || 8)));
        const intervalMs = Math.max(33, Math.round(1000 / fps));
        const timer = window.setInterval(() => {
            setCameraFrameTick(v => v + 1);
        }, intervalMs);
        return () => window.clearInterval(timer);
    }, [cameras.length, cameraPreviewMode, cameraPreviewFps]);
    useEffect(() => {
        setMasterCameraIds(prev => {
            const kept = prev.filter(id => cameraIds.includes(id));
            if (!masterCameraListTouched.current) {
                return prev.join('|') === cameraIdsSig ? prev : cameraIds;
            }
            if (kept.join('|') === prev.join('|')) return prev;
            return kept;
        });
    }, [cameraIdsSig]);
    useEffect(() => {
        if (displayedMasterCameras.length === 0) {
            if (masterCameraId !== null) setMasterCameraId(null);
            return;
        }
        if (!masterCameraId || !displayedMasterCameras.some(cam => cam.id === masterCameraId)) {
            setMasterCameraId(displayedMasterCameras[0].id);
        }
    }, [displayedMasterCameraIdsSig, masterCameraId]);
    useEffect(() => {
        const onResize = () => {
            setIsMobile(window.innerWidth < 768);
            const desktop = window.innerWidth >= 768;
            setCanDragPanels(desktop);
            if (!desktop) {
                setMasterPanelPos({ x: 0, y: 0 });
                setSelectionPanelPos({ x: 0, y: 0 });
            }
        };
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const panelFrameClass = 'bg-slate-900/92 border border-slate-700 shadow-2xl backdrop-blur-md';
    const chromeCardClass = 'bg-slate-900/92 backdrop-blur-md rounded-xl border border-slate-700 shadow-xl';
    const rootOverlayClass = `absolute inset-0 pointer-events-none flex flex-col justify-between relative min-h-[100dvh] p-2 sm:p-6 ${isMobile ? 'pb-[calc(env(safe-area-inset-bottom)+10px)] overflow-hidden' : ''}`;
    const masterPanelBodyClass = isMobile
        ? 'p-2 sm:p-3 flex flex-col gap-2 max-h-[min(56dvh,460px)] overflow-y-auto overscroll-contain'
        : 'p-2 sm:p-3 flex flex-col gap-2 max-h-[68vh] overflow-y-auto';
    const selectionPanelMaxHClass = isMobile
        ? 'max-h-[calc(100dvh-180px)]'
        : 'max-h-[72vh]';

    const clampMasterPanelOffset = (x: number, y: number) => {
        const maxLeft = -(window.innerWidth - 180);
        const maxRight = 36;
        const maxUp = -80;
        const maxDown = Math.max(80, Math.min(420, window.innerHeight - 220));
        return {
            x: Math.max(maxLeft, Math.min(maxRight, x)),
            y: Math.max(maxUp, Math.min(maxDown, y)),
        };
    };

    const startPanelDrag = (key: 'master' | 'selection', e: React.PointerEvent<HTMLDivElement>) => {
        if (!canDragPanels || e.button !== 0) return;
        const targetEl = e.target as HTMLElement;
        const dragHandle = targetEl.closest('[data-drag-handle="true"]');
        if (!dragHandle && targetEl.closest('button, input, select, textarea, a, [data-no-drag="true"]')) return;
        const pos = key === 'master' ? masterPanelPos : selectionPanelPos;
        dragRef.current = {
            key,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originX: pos.x,
            originY: pos.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const movePanelDrag = (key: 'master' | 'selection', e: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current.key !== key || dragRef.current.pointerId !== e.pointerId) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        if (key === 'master') {
            const clamped = clampMasterPanelOffset(dragRef.current.originX + dx, dragRef.current.originY + dy);
            setMasterPanelPos(clamped);
            return;
        }
        const nextX = Math.max(-520, Math.min(520, dragRef.current.originX + dx));
        const nextY = Math.max(-340, Math.min(340, dragRef.current.originY + dy));
        setSelectionPanelPos({ x: nextX, y: nextY });
    };

    const endPanelDrag = (key: 'master' | 'selection', e: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current.key !== key || dragRef.current.pointerId !== e.pointerId) return;
        dragRef.current.key = null;
        dragRef.current.pointerId = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    const statusTone = selectedMachineState?.health === 'stopped'
        ? {
            panel: 'border-red-500/60',
            badge: 'bg-red-500/15 text-red-300 border-red-500/40',
            dot: 'bg-red-400',
        }
        : selectedMachineState?.health === 'warning'
            ? {
                panel: 'border-amber-500/60',
                badge: 'bg-amber-500/15 text-amber-200 border-amber-500/40',
                dot: 'bg-amber-400',
            }
            : selectedMachineState?.health === 'running'
                ? {
                    panel: 'border-emerald-500/55',
                    badge: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
                    dot: 'bg-emerald-400',
                }
                : {
                    panel: 'border-yellow-500/50',
                    badge: 'bg-gray-800 text-gray-300 border-gray-700',
                    dot: 'bg-gray-500',
                };

    const handlePlayClick = () => {
        if (!isRunning) {
            setIsRunning(true);
            setIsPaused(false);
        } else {
            setIsPaused(!isPaused);
        }
        const now = Date.now();
        if (now - playClicks.time < 500) {
            const newCount = playClicks.count + 1;
            if (newCount >= 4) { // 5th rapid click total (0,1,2,3,4 â†’ trigger)
                setCredits(creditsValue + 10000);
                setPlayClicks({ count: 0, time: 0 });
            } else {
                setPlayClicks({ count: newCount, time: now });
            }
        } else {
            setPlayClicks({ count: 0, time: now }); // reset to 0 on first click
        }
    };

    const handleStopClick = () => {
        // Always show confirm popup â€” never do a silent reset
        setShowStopConfirm(true);
    };

    const handleValidateDraft = () => {
        if (!draftPlacement) return;
        const cost = ITEM_COSTS[draftPlacement.type];
        if (credits >= cost) {
            const { id, ...rest } = draftPlacement;
            addPlacedItem(rest);
            setDraftPlacement(null);
            if (!keepBuilding) {
                setBuildMode(null);
            }
        }
    };

    const handleAddMasterCamera = () => {
        const next = hiddenMasterCameras[0];
        if (!next) return;
        masterCameraListTouched.current = true;
        setMasterCameraIds(prev => [...prev, next.id]);
        setMasterCameraId(next.id);
    };

    const hideMasterCameraFeed = (cameraId: string) => {
        masterCameraListTouched.current = true;
        setMasterCameraIds(prev => prev.filter(id => id !== cameraId));
        if (masterCameraId === cameraId) setMasterCameraId(null);
    };

    const doStop = () => {
        setShowStopConfirm(false);
        setIsRunning(false);
        setIsPaused(false);
        simState.reset();
        placedItems.forEach(item => {
            if (item.type === 'cobot') {
                updatePlacedItem(item.id, {
                    config: {
                        ...item.config,
                        isStopped: false,
                        collisionStopped: false,
                        triggerUnlock: Date.now(),
                    }
                });
            }
        });
    };

    const exportFactory = () => {
        const s = localStorage.getItem('cobot-factory-sim-v10') || localStorage.getItem('cobot-factory-sim-v9') || localStorage.getItem('cobot-factory-sim-v8');
        if (!s) return;
        const b = new Blob([s], { type: 'application/json' });
        const u = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = u;
        a.download = `factory_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
    };

    const importFactory = () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json';
        inp.onchange = e => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = ev => {
                localStorage.setItem('cobot-factory-sim-v10', ev.target?.result as string);
                location.reload();
            };
            r.readAsText(f);
        };
        inp.click();
    };

    const handleResetClick = () => {
        setShowResetConfirm(true);
    };

    const doReset = (saveFirst = false) => {
        if (saveFirst) exportFactory();
        resetFactory();
        setShowResetConfirm(false);
    };

    const handleBuildClick = (type: ItemType) => {
        setBuildMode(buildMode === type ? null : type);
    };

    const handleSellSelected = () => {
        if (selectedItem) {
            removePlacedItem(selectedItem.id);
            setCredits(creditsValue + ITEM_COSTS[selectedItem.type]); 
        }
    };

    const handleRotateSelected = () => {
        if (selectedItem) {
            if (selectedItem.type === 'cobot') {
                const grid = selectedItem.config?.stackMatrix || [3, 3];
                const cols = Math.max(1, Math.min(6, Math.round(grid[0] || 3)));
                const rows = Math.max(1, Math.min(6, Math.round(grid[1] || 3)));
                const total = cols * rows;
                if (total <= 1) return;
                const [curColRaw, curRowRaw] = selectedItem.config?.mountSlot || [cols - 1, rows - 1];
                const curCol = Math.max(0, Math.min(cols - 1, Math.round(curColRaw)));
                const curRow = Math.max(0, Math.min(rows - 1, Math.round(curRowRaw)));
                const currentIndex = curRow * cols + curCol;
                const maxStack = Math.max(1, Math.min(20, Math.round(selectedItem.config?.stackMax || 10)));
                const slots = cobotSlotsWorld(selectedItem, cols, rows);
                const activeParts = simState.items.filter(part => part.state !== 'dead' && part.state !== 'grabbed');

                const itemsAtSlot = (slotIndex: number) => {
                    const slot = slots[slotIndex];
                    const r2 = COBOT_SLOT_RADIUS * COBOT_SLOT_RADIUS;
                    return activeParts.filter(part => {
                        const dx = part.pos.x - slot.x;
                        const dz = part.pos.z - slot.z;
                        return (dx * dx + dz * dz) <= r2;
                    });
                };

                const clearMountSlot = (targetIndex: number) => {
                    const occupancy = slots.map((_, idx) => itemsAtSlot(idx));
                    const allOccupants = occupancy[targetIndex];
                    if (allOccupants.length === 0) return true;
                    if (allOccupants.some(part => part.state !== 'free')) return false;

                    let freeCapacity = 0;
                    for (let idx = 0; idx < occupancy.length; idx++) {
                        if (idx === targetIndex) continue;
                        freeCapacity += Math.max(0, maxStack - occupancy[idx].length);
                    }
                    if (freeCapacity < allOccupants.length) return false;

                    const blockers = [...allOccupants].sort((a, b) => b.pos.y - a.pos.y);
                    for (const blocker of blockers) {
                        let destination = -1;
                        for (let offset = 1; offset < total; offset++) {
                            const idx = (targetIndex + offset) % total;
                            if (idx === targetIndex) continue;
                            if (occupancy[idx].length < maxStack) {
                                destination = idx;
                                break;
                            }
                        }
                        if (destination < 0) return false;

                        const slot = slots[destination];
                        const stackTop = occupancy[destination].reduce(
                            (top, existing) => Math.max(top, existing.pos.y + PART_THICKNESS),
                            slot.y
                        );
                        blocker.pos.set(slot.x, stackTop, slot.z);
                        blocker.rotY = 0;
                        occupancy[targetIndex] = occupancy[targetIndex].filter(part => part !== blocker);
                        occupancy[destination].push(blocker);
                    }
                    return true;
                };

                let nextIndex = -1;
                for (let step = 1; step < total; step++) {
                    const candidate = (currentIndex + step) % total;
                    if (clearMountSlot(candidate)) {
                        nextIndex = candidate;
                        break;
                    }
                }
                if (nextIndex < 0) return;

                const nextCol = nextIndex % cols;
                const nextRow = Math.floor(nextIndex / cols);
                updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, mountSlot: [nextCol, nextRow] } });
                return;
            }
            const newRot = ((selectedItem.rotation + 1) % 4) as Direction;
            updatePlacedItem(selectedItem.id, { rotation: newRot });
        }
    };

    const saveSelectedName = () => {
        if (!selectedItem) return;
        const clean = draftName.trim();
        updatePlacedItem(selectedItem.id, { name: clean || undefined });
        setEditingName(false);
    };

    const handleClearProgram = () => {
        if (selectedItem) {
            updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, program: [], uiActiveProgramStepIndex: undefined } });
        }
    };

    const togglePickColor = (color: string) => {
        if (!selectedItem) return;
        const current = selectedItem.config?.pickColors || [];
        const next = current.includes(color) ? current.filter(c => c !== color) : [...current, color];
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, pickColors: next } });
    };

    const togglePickSize = (size: PartSize) => {
        if (!selectedItem) return;
        const current = selectedItem.config?.pickSizes || [];
        const next = current.includes(size) ? current.filter(s => s !== size) : [...current, size];
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, pickSizes: next } });
    };

    const toggleLinkedCamera = (cameraId: string) => {
        if (!selectedItem) return;
        const current = selectedItem.config?.linkedCameraIds || [];
        const next = current.includes(cameraId)
            ? current.filter(id => id !== cameraId)
            : [...current, cameraId];
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, linkedCameraIds: next } });
    };

    const updateProgram = (nextProgram: ProgramStep[]) => {
        if (!selectedItem) return;
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, program: nextProgram } });
    };

    const addProgramStep = (action: ProgramAction) => {
        if (!selectedItem) return;
        const current = selectedItem.config?.program || [];
        const lastPos = current.slice().reverse().find(step => step.pos)?.pos ?? [selectedItem.position[0], 0.56, selectedItem.position[2]];
        const nextStep: ProgramStep = action === 'wait'
            ? { action, duration: 0.4 }
            : action === 'drop'
                ? {
                    action,
                    pos: [...lastPos] as [number, number, number],
                    sortColor: selectedItem.config?.defaultDropSortColor !== false,
                    sortSize: selectedItem.config?.defaultDropSortSize !== false,
                    sortShape: selectedItem.config?.defaultDropSortShape !== false,
                }
                : { action, pos: [...lastPos] as [number, number, number] };
        const nextProgram = [...current, nextStep];
        updatePlacedItem(selectedItem.id, {
            config: {
                ...selectedItem.config,
                program: nextProgram,
                uiActiveProgramStepIndex: nextProgram.length - 1,
            }
        });
    };

    const patchProgramStep = (index: number, patch: Partial<ProgramStep>) => {
        if (!selectedItem) return;
        const current = [...(selectedItem.config?.program || [])];
        current[index] = { ...current[index], ...patch };
        updateProgram(current);
    };

    const moveProgramStep = (index: number, dir: -1 | 1) => {
        if (!selectedItem) return;
        const current = [...(selectedItem.config?.program || [])];
        const nextIndex = index + dir;
        if (nextIndex < 0 || nextIndex >= current.length) return;
        [current[index], current[nextIndex]] = [current[nextIndex], current[index]];
        updateProgram(current);
    };

    const removeProgramStep = (index: number) => {
        if (!selectedItem) return;
        updateProgram((selectedItem.config?.program || []).filter((_, idx) => idx !== index));
    };
    const setActiveProgramStepIndex = (index: number | null) => {
        if (!selectedItem || selectedItem.type !== 'cobot') return;
        updatePlacedItem(selectedItem.id, {
            config: {
                uiActiveProgramStepIndex: index === null ? undefined : Math.max(0, index),
            }
        });
    };

    const setCobotOverlay = (patch: { showTeachPoints?: boolean; showArmRange?: boolean; showPathPreview?: boolean }) => {
        if (!selectedItem) return;
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, ...patch } });
    };

    const setDropSortPreference = (field: 'sortColor' | 'sortSize' | 'sortShape', checked: boolean) => {
        if (!selectedItem) return;
        const key = field === 'sortColor'
            ? 'defaultDropSortColor'
            : field === 'sortSize'
                ? 'defaultDropSortSize'
                : 'defaultDropSortShape';
        const nextProgram = (selectedItem.config?.program || []).map(step =>
            step.action === 'drop' ? { ...step, [field]: checked } : step
        );
        updatePlacedItem(selectedItem.id, {
            config: {
                ...selectedItem.config,
                [key]: checked,
                program: nextProgram,
            }
        });
    };

    const patchSelectedPosition = (axis: 0 | 1 | 2, value: number) => {
        if (!selectedItem) return;
        const next = [...selectedItem.position] as [number, number, number];
        next[axis] = snapValue(value);
        updatePlacedItem(selectedItem.id, { position: next });
    };

    const snapStep = snapInputs ? 0.5 : 0.1;
    const heightStep = snapInputs ? 0.5 : 0.05;
    const snapValue = (value: number, step = snapStep) => snapInputs ? Math.round(value / step) * step : value;
    const controllerSortColor = selectedItem?.config?.defaultDropSortColor !== false;
    const controllerSortSize = selectedItem?.config?.defaultDropSortSize !== false;
    const controllerSortShape = selectedItem?.config?.defaultDropSortShape !== false;
    const showTeachPointsOverlay = (selectedItem?.config?.showTeachPoints ?? selectedItem?.config?.showTeachZones ?? true) !== false;
    const showArmRangeOverlay = (selectedItem?.config?.showArmRange ?? selectedItem?.config?.showTeachZones ?? true) !== false;
    const showPathOverlay = (selectedItem?.config?.showPathPreview ?? true) !== false;
    const cobotCollisionEnabled = (selectedItem?.config?.cobotCollisionEnabled ?? true) !== false;
    const cobotAutoIdle = selectedItem?.config?.autoOrganize === true;
    const activeProgramStepIndex = selectedItem?.config?.uiActiveProgramStepIndex;
    const toggleCobotSection = (section: 'transform' | 'vision' | 'controller') => {
        setOpenCobotSection(prev => (prev === section ? null : section));
    };

    const defaultCobotArmTarget = (item: PlacedItem): [number, number, number] => [
        item.position[0],
        item.position[1] + 2.2,
        item.position[2],
    ];

    const cobotArmTarget = selectedItem?.type === 'cobot'
        ? (selectedItem.config?.cobotManualTarget || selectedItem.config?.cobotHomeTarget || defaultCobotArmTarget(selectedItem))
        : null;

    const setCobotManualTarget = (target: [number, number, number], manualControl = true) => {
        if (!selectedItem || selectedItem.type !== 'cobot') return;
        updatePlacedItem(selectedItem.id, {
            config: {
                ...selectedItem.config,
                cobotManualTarget: target,
                cobotManualControl: manualControl,
                isStopped: false,
            }
        });
    };

    const nudgeCobotArmTarget = (axis: 0 | 1 | 2, delta: number) => {
        if (!selectedItem || selectedItem.type !== 'cobot' || !cobotArmTarget) return;
        const next = [...cobotArmTarget] as [number, number, number];
        next[axis] = axis === 1
            ? Math.max(0.08, Math.min(3.6, next[axis] + delta))
            : Math.max(selectedItem.position[axis === 0 ? 0 : 2] - 3.2, Math.min(selectedItem.position[axis === 0 ? 0 : 2] + 3.2, next[axis] + delta));
        setCobotManualTarget(next);
    };

    const saveCobotHomeTarget = () => {
        if (!selectedItem || selectedItem.type !== 'cobot' || !cobotArmTarget) return;
        updatePlacedItem(selectedItem.id, {
            config: {
                ...selectedItem.config,
                cobotHomeTarget: cobotArmTarget,
                cobotManualTarget: cobotArmTarget,
                cobotManualControl: true,
                isStopped: false,
            }
        });
    };

    const goCobotHomeTarget = () => {
        if (!selectedItem || selectedItem.type !== 'cobot') return;
        setCobotManualTarget(selectedItem.config?.cobotHomeTarget || defaultCobotArmTarget(selectedItem));
    };

    const unlockSelectedCobot = () => {
        if (!selectedItem || selectedItem.type !== 'cobot') return;
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, collisionStopped: false, triggerUnlock: Date.now() } });
    };

    const exportSelectedCobotLog = () => {
        if (!selectedItem || selectedItem.type !== 'cobot') return;
        const log = simState.cobotLogs[selectedItem.id] || [];
        const payload = {
            cobotId: selectedItem.id,
            cobotName: selectedItem.name || selectedItem.id,
            exportedAt: new Date().toISOString(),
            entries: log,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cobot_log_${selectedItem.id}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const patchMachineSize = (axis: 0 | 1, value: number) => {
        if (!selectedItem) return;
        const current = selectedItem.config?.machineSize || [2, 2];
        const next = [...current] as [number, number];
        next[axis] = Math.max(0.5, snapValue(value || 0.5));
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, machineSize: next } });
    };

    const patchMachineHeight = (value: number) => {
        if (!selectedItem) return;
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, machineHeight: Math.max(0.1, snapValue(value || 0.1, heightStep)) } });
    };

    const openPartCreator = () => {
        setShowPartCreator(true);
        if (!activeTemplateId && partTemplates[0]) setActiveTemplateId(partTemplates[0].id);
    };

    const createTemplate = () => {
        const id = addPartTemplate({
            name: `Custom ${partTemplates.length + 1}`,
            shape: 'disc',
            color: '#94a3b8',
            size: 'medium',
            hasCenterHole: true,
            hasIndexHole: true,
        });
        setActiveTemplateId(id);
    };

    const cloneActiveTemplate = () => {
        if (!activeTemplate) return;
        const id = clonePartTemplate(activeTemplate.id);
        if (id) setActiveTemplateId(id);
    };

    const removeActiveTemplate = () => {
        if (!activeTemplate || partTemplates.length <= 1) return;
        const currentIndex = partTemplates.findIndex(t => t.id === activeTemplate.id);
        const remaining = partTemplates.filter(t => t.id !== activeTemplate.id);
        removePartTemplate(activeTemplate.id);
        const fallback = remaining[Math.max(0, currentIndex - 1)] || remaining[0] || null;
        setActiveTemplateId(fallback?.id || null);
    };

    const patchActiveTemplate = (updates: Parameters<typeof updatePartTemplate>[1]) => {
        if (!activeTemplate) return;
        updatePartTemplate(activeTemplate.id, updates);
    };

    return (
        <div className={rootOverlayClass}>
            {/* Top Bar */}
            <div className="flex justify-between items-start gap-2">
                <div className="flex flex-col gap-4 pointer-events-auto">
                    <div>
                        <h1 className="text-2xl sm:text-4xl font-display font-black text-blue-400 tracking-tight drop-shadow-md">
                            COBOT FACTORY
                        </h1>
                        <p className="hidden sm:block text-gray-400 font-mono text-sm mt-1">Simulation Sandbox</p>
                    </div>
                </div>

                <div className="relative flex flex-col gap-2 pointer-events-auto items-end">
                    <label className={`${chromeCardClass} px-3 py-1.5 sm:px-4 sm:py-2 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-800 transition-colors`}>
                        <span className="text-[10px] font-bold text-gray-400 hidden sm:inline">SNAP 0.5 GRID</span>
                        <span className="text-[10px] font-bold text-gray-400 sm:hidden">SNAP</span>
                        <input
                            type="checkbox"
                            checked={snapInputs}
                            onChange={(e) => setSnapInputs(e.target.checked)}
                            className="rounded border-gray-600 bg-gray-800"
                        />
                    </label>
                    <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2 max-w-[calc(100vw-16px)]">
                        <button onClick={() => setShowHelpModal(true)} className={`${chromeCardClass} w-10 sm:w-12 flex items-center justify-center hover:bg-slate-800 transition-colors text-blue-400`} title="Help / Instructions">
                            <HelpCircle size={20} className="sm:w-6 sm:h-6" />
                        </button>
                        <div className={`${chromeCardClass} px-3 sm:px-6 py-1.5 sm:py-3 flex items-center gap-2 sm:gap-4`}>
                        <div className="bg-emerald-500/20 text-emerald-400 rounded-md w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center font-bold text-sm sm:text-lg">
                            â˜…
                        </div>
                        <div>
                            <div className="text-[8px] sm:text-[10px] font-bold text-gray-500 tracking-widest uppercase">Score</div>
                            <div className="text-lg sm:text-2xl font-black text-white leading-none">{scoreValue}</div>
                        </div>
                    </div>
                    <div className={`${chromeCardClass} px-3 sm:px-6 py-1.5 sm:py-3 flex items-center gap-2 sm:gap-4`}>
                        <div className="bg-blue-500/20 text-blue-400 rounded-md w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center font-bold text-sm sm:text-lg">
                            $
                        </div>
                        <div>
                            <div className="text-[8px] sm:text-[10px] font-bold text-gray-500 tracking-widest uppercase">Credits</div>
                            <div className="text-lg sm:text-2xl font-black text-white leading-none">{creditsValue}</div>
                        </div>
                    </div>
                </div>
                    <div
                        className={`absolute right-0 top-[calc(100%+8px)] sm:top-[calc(100%+10px)] z-30 w-[min(360px,calc(100vw-16px))] sm:w-[380px] rounded-xl border border-cyan-500/35 overflow-hidden ${panelFrameClass}`}
                        style={canDragPanels ? { transform: `translate(${masterPanelPos.x}px, ${masterPanelPos.y}px)` } : undefined}
                    >
                        <button
                            onClick={() => setShowMasterPanel(v => !v)}
                            onPointerDown={(e) => startPanelDrag('master', e)}
                            onPointerMove={(e) => movePanelDrag('master', e)}
                            onPointerUp={(e) => endPanelDrag('master', e)}
                            onPointerCancel={(e) => endPanelDrag('master', e)}
                            className={`w-full flex items-center justify-between px-3 py-2 bg-cyan-900/25 hover:bg-cyan-800/30 transition-colors ${canDragPanels ? 'cursor-grab active:cursor-grabbing' : ''}`}
                        >
                            <div className="flex items-center gap-2 text-cyan-100">
                                {canDragPanels && (
                                    <span
                                        data-drag-handle="true"
                                        className="text-cyan-300/90 font-mono text-xs px-1 cursor-grab active:cursor-grabbing select-none"
                                        title="Drag panel"
                                    >
                                        :::
                                    </span>
                                )}
                                <Cpu size={15} />
                                <span className="text-[11px] font-black tracking-wider">MASTER CONTROL</span>
                            </div>
                            {showMasterPanel ? <ChevronDown size={14} className="text-cyan-200" /> : <ChevronRight size={14} className="text-cyan-200" />}
                        </button>
                        {showMasterPanel && (
                            <div className={masterPanelBodyClass}>
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                    <div className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1.5">
                                        <div className="text-gray-500 font-bold">RUN STATE</div>
                                        <div className={`font-black ${!isRunning ? 'text-gray-300' : isPaused ? 'text-amber-300' : 'text-emerald-300'}`}>
                                            {!isRunning ? 'STOPPED' : isPaused ? 'PAUSED' : 'RUNNING'}
                                        </div>
                                    </div>
                                    <div className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1.5">
                                        <div className="text-gray-500 font-bold">SIM SPEED</div>
                                        <div className="font-black text-cyan-200">{simSpeedValue.toFixed(2)}x</div>
                                    </div>
                                    <div className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1.5">
                                        <div className="text-gray-500 font-bold">PARTS SENT (EST)</div>
                                        <div className="font-black text-white">{producedEstimate}</div>
                                    </div>
                                    <div className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1.5">
                                        <div className="text-gray-500 font-bold">SORTED / DROPPED</div>
                                        <div className="font-black text-emerald-300">{droppedEstimate}</div>
                                    </div>
                                    <div className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1.5">
                                        <div className="text-gray-500 font-bold">STOCKED</div>
                                        <div className="font-black text-blue-200">{stockedParts}</div>
                                    </div>
                                    <div className="rounded border border-gray-700 bg-gray-900/50 px-2 py-1.5">
                                        <div className="text-gray-500 font-bold">IN TRANSIT</div>
                                        <div className="font-black text-amber-200">{transitParts}</div>
                                    </div>
                                </div>

                                <div className="rounded border border-gray-700 bg-gray-900/50 px-2 py-2">
                                    <div className="text-[10px] font-bold text-gray-500 mb-1">COBOT STATUS</div>
                                    <div className="grid grid-cols-4 gap-1 text-[10px]">
                                        <span className="rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 px-1.5 py-1 text-center font-bold">RUN {cobotRunning}</span>
                                        <span className="rounded bg-amber-500/15 border border-amber-500/40 text-amber-200 px-1.5 py-1 text-center font-bold">WARN {cobotWarning}</span>
                                        <span className="rounded bg-red-500/15 border border-red-500/40 text-red-200 px-1.5 py-1 text-center font-bold">STOP {cobotStopped}</span>
                                        <span className="rounded bg-gray-800 border border-gray-700 text-gray-200 px-1.5 py-1 text-center font-bold">IDLE {cobotIdle}</span>
                                    </div>
                                </div>

                                <div className="rounded border border-cyan-700/40 bg-cyan-950/20 px-2 py-2 flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-cyan-100">CAMERAS ({displayedMasterCameras.length}/{cameras.length})</span>
                                            <span className="text-[10px] text-cyan-300">{camerasWithFeed} live</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleAddMasterCamera}
                                            disabled={hiddenMasterCameras.length === 0}
                                            className="h-6 w-6 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                                            title="Add camera feed"
                                            data-no-drag="true"
                                        >
                                            <Plus size={13} />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="flex flex-col gap-1 rounded border border-gray-700 bg-gray-900/40 px-2 py-1.5">
                                            <span className="text-[9px] font-bold text-gray-500">FPS (GLOBAL)</span>
                                            <input
                                                type="range"
                                                min={2}
                                                max={24}
                                                step={1}
                                                value={cameraPreviewFps}
                                                onChange={(e) => setCameraPreviewFps(parseInt(e.target.value, 10) || 8)}
                                                className="w-full"
                                            />
                                            <span className="text-[10px] text-cyan-200 font-mono">{cameraPreviewFps} fps</span>
                                        </label>
                                        <label className="flex flex-col gap-1 rounded border border-gray-700 bg-gray-900/40 px-2 py-1.5">
                                            <span className="text-[9px] font-bold text-gray-500">RES (GLOBAL)</span>
                                            <select
                                                value={cameraResolutionKey}
                                                onChange={(e) => {
                                                    const picked = CAMERA_PREVIEW_RESOLUTIONS.find(r => r.label === e.target.value);
                                                    if (picked) setCameraPreviewResolution(picked.width, picked.height);
                                                }}
                                                className="bg-gray-800 text-white text-[10px] rounded p-1 border border-gray-600 outline-none"
                                            >
                                                {CAMERA_PREVIEW_RESOLUTIONS.map(opt => (
                                                    <option key={opt.label} value={opt.label}>{opt.label}</option>
                                                ))}
                                            </select>
                                            <span className="text-[10px] text-gray-400">All cameras</span>
                                        </label>
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 rounded border border-gray-700 bg-gray-900/50 p-1">
                                        <button
                                            onClick={() => setCameraPreviewMode('video')}
                                            className={`rounded py-1 text-[10px] font-bold transition-colors ${cameraPreviewMode === 'video' ? 'bg-cyan-500/25 text-cyan-100 border border-cyan-400/40' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}
                                        >
                                            VIDEO
                                        </button>
                                        <button
                                            onClick={() => setCameraPreviewMode('graph')}
                                            className={`rounded py-1 text-[10px] font-bold transition-colors ${cameraPreviewMode === 'graph' ? 'bg-cyan-500/25 text-cyan-100 border border-cyan-400/40' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}
                                        >
                                            GRAPH
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-0.5">
                                        {displayedMasterCameras.map(cam => {
                                            const detections = cameraDetectionsFor(cam.id);
                                            const frame = simState.cameraFrames[cam.id];
                                            const active = masterCameraId === cam.id || selectedItemId === cam.id;
                                            return (
                                                <div
                                                    key={cam.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => {
                                                        setMasterCameraId(cam.id);
                                                        setSelectedItemId(cam.id);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            setMasterCameraId(cam.id);
                                                            setSelectedItemId(cam.id);
                                                        }
                                                    }}
                                                    className={`group relative rounded border p-1 text-left bg-gray-950/70 hover:border-cyan-400/70 transition-colors ${active ? 'border-cyan-400/80 ring-1 ring-cyan-400/40' : 'border-gray-800'}`}
                                                    data-no-drag="true"
                                                >
                                                    <div className="flex items-center justify-between gap-2 px-1 pb-1">
                                                        <span className="truncate text-[10px] font-bold text-cyan-100">{cam.name || cam.id}</span>
                                                        <span className={`h-1.5 w-1.5 rounded-full ${frame ? 'bg-emerald-300' : 'bg-gray-600'}`} />
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            hideMasterCameraFeed(cam.id);
                                                        }}
                                                        className="absolute right-1.5 top-6 z-10 h-6 w-6 rounded bg-red-500/80 text-white opacity-80 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-red-500 flex items-center justify-center transition-opacity"
                                                        title="Hide camera feed"
                                                        data-no-drag="true"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                    {cameraPreviewMode === 'video' ? (
                                                        <div className="h-24 rounded bg-gray-950 border border-gray-800 overflow-hidden relative">
                                                            {frame ? (
                                                                <img
                                                                    src={frame}
                                                                    alt={`${cam.name || cam.id} feed`}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            ) : (
                                                                <div className="absolute inset-0 flex items-center justify-center text-[9px] text-gray-600">
                                                                    Waiting for video...
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="h-24 rounded bg-gray-950 border border-gray-800 p-2 flex items-end gap-1.5 overflow-hidden">
                                                            {detections.slice(0, 8).map(det => (
                                                                <span
                                                                    key={`master_${cam.id}_${det.itemId}`}
                                                                    className="w-4 rounded-sm border border-black/20"
                                                                    style={{
                                                                        height: det.size === 'large' ? '2rem' : det.size === 'medium' ? '1.55rem' : '1.15rem',
                                                                        backgroundColor: det.color
                                                                    }}
                                                                />
                                                            ))}
                                                            {detections.length === 0 && (
                                                                <span className="text-[9px] text-gray-600">No detections</span>
                                                            )}
                                                        </div>
                                                    )}
                                                    <div className="mt-1 rounded bg-gray-900/80 px-1.5 py-1 text-[9px] text-gray-400 flex justify-between gap-2">
                                                        <span className="truncate">
                                                            {detections[0]?.templateName || detections[0]?.templateId || detections[0]?.itemId || 'No parts'}
                                                        </span>
                                                        <span>{detections[0] ? `${Math.round((Number.isFinite(detections[0].confidence) ? detections[0].confidence : 0) * 100)}%` : '--'}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {displayedMasterCameras.length === 0 && (
                                            <button
                                                type="button"
                                                onClick={handleAddMasterCamera}
                                                disabled={hiddenMasterCameras.length === 0}
                                                className="h-24 rounded border border-dashed border-cyan-600/50 bg-cyan-950/20 text-cyan-200 text-[10px] font-bold flex items-center justify-center gap-2 disabled:opacity-40"
                                                data-no-drag="true"
                                            >
                                                <Plus size={14} />
                                                {hiddenMasterCameras.length > 0 ? 'ADD CAMERA FEED' : 'NO CAMERA FEEDS'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {looseParts > 0 && (
                                    <div className="rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200">
                                        {looseParts} loose part(s) detected outside supports.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
            </div>
            </div>

            {/* Bottom Area */}
            <div className={`flex flex-col items-center gap-2 sm:gap-4 pointer-events-auto w-full max-w-full ${isMobile ? 'pb-[calc(env(safe-area-inset-bottom)+4px)]' : ''}`}>
                
                {draftPlacement ? (
                    <div className={`${panelFrameClass} rounded-xl p-4 flex flex-col gap-3 w-[min(340px,calc(100vw-16px))] animate-fade-in pointer-events-auto`}>
                        <div className="text-sm font-black text-yellow-400 tracking-wider flex justify-between items-center border-b border-gray-700 pb-2">
                            <span className="flex items-center gap-2"><Settings2 size={16} /> PLACE {draftPlacement.type === 'sender' ? 'PART SPAWNER' : draftPlacement.type.toUpperCase()}</span>
                            <span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-xs border border-gray-600">{ITEM_COSTS[draftPlacement.type]} CR</span>
                        </div>
                        <div className="border-t border-gray-700/50 pt-3 mt-1">
                            <TransformPanel item={draftPlacement} updateItem={(updates) => setDraftPlacement({ ...draftPlacement, ...updates })} isDraft={true} snapStep={snapStep} heightStep={heightStep} />
                        </div>
                        <label className="flex items-center gap-2 text-xs font-bold text-gray-400 mt-1 cursor-pointer">
                            <input type="checkbox" checked={keepBuilding} onChange={e => setKeepBuilding(e.target.checked)} className="accent-[#38bdf8] w-4 h-4 cursor-pointer" />
                            Keep placing after validation
                        </label>
                        <div className="flex gap-2 mt-1">
                            <button onClick={() => { setDraftPlacement(null); if (!keepBuilding) setBuildMode(null); }} className="flex-1 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded py-2.5 font-bold text-xs transition-colors border border-red-500/30">CANCEL</button>
                            <button onClick={handleValidateDraft} disabled={credits < ITEM_COSTS[draftPlacement.type]} className={`flex-1 rounded py-2.5 font-bold text-xs transition-colors ${credits >= ITEM_COSTS[draftPlacement.type] ? 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-gray-600 text-gray-400 cursor-not-allowed'}`}>VALIDATE</button>
                        </div>
                    </div>
                ) : moveModeItemId && selectedItem && moveModeItemId === selectedItem.id ? (
                    <div className={`${panelFrameClass} rounded-xl border-blue-500 p-4 flex flex-col gap-3 w-[min(340px,calc(100vw-16px))] animate-fade-in pointer-events-auto`}>
                        <div className="text-sm font-black text-blue-400 tracking-wider flex justify-between items-center border-b border-gray-700 pb-2">
                            <span className="flex items-center gap-2"><Move size={16} /> MOVING {selectedItem.type.toUpperCase()}</span>
                        </div>
                        <TransformPanel item={selectedItem} updateItem={(updates) => updatePlacedItem(selectedItem.id, updates)} isDraft={true} snapStep={snapStep} heightStep={heightStep} onCancel={() => { if (moveModeOriginalItem) { updatePlacedItem(selectedItem.id, moveModeOriginalItem); } setMoveModeItemId(null); }} onValidate={() => setMoveModeItemId(null)} />
                    </div>
                ) : selectedItem ? (
                    /* SELECTION PANEL */
                    <div
                        className={`${panelFrameClass} rounded-xl border ${selectedItem.type === 'cobot' ? 'p-1.5' : 'p-2'} flex flex-col gap-1.5 ${selectedItem.type === 'cobot' ? 'w-[min(520px,calc(100vw-10px))]' : 'w-[min(560px,calc(100vw-12px))]'} ${selectionPanelMaxHClass} overflow-y-auto overscroll-contain animate-fade-in ${statusTone.panel}`}
                        style={{ transform: `translate(${selectionPanelPos.x}px, ${selectionPanelPos.y}px)` }}
                    >
                        <div
                            className={`flex justify-between items-center border-b border-gray-700 pb-1.5 ${canDragPanels ? 'cursor-grab active:cursor-grabbing' : ''}`}
                            onPointerDown={(e) => startPanelDrag('selection', e)}
                            onPointerMove={(e) => movePanelDrag('selection', e)}
                            onPointerUp={(e) => endPanelDrag('selection', e)}
                            onPointerCancel={(e) => endPanelDrag('selection', e)}
                            title={canDragPanels ? 'Drag panel (desktop)' : undefined}
                        >
                            <div className="flex min-w-0 items-center gap-2 text-yellow-400 font-black tracking-wider">
                                {canDragPanels && (
                                    <span
                                        data-drag-handle="true"
                                        className="text-yellow-300/80 font-mono text-xs px-1 cursor-grab active:cursor-grabbing select-none"
                                        title="Drag panel"
                                    >
                                        :::
                                    </span>
                                )}
                                <Settings2 size={18} className="shrink-0" />
                                <span className="text-sm shrink-0">{selectedItem.type === 'sender' ? 'PART SPAWNER' : selectedItem.type.toUpperCase()}</span>
                                {editingName ? (
                                    <input
                                        autoFocus
                                        value={draftName}
                                        onChange={(e) => setDraftName(e.target.value)}
                                        onBlur={saveSelectedName}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveSelectedName();
                                            if (e.key === 'Escape') {
                                                setDraftName(selectedItem.name || selectedItem.id);
                                                setEditingName(false);
                                            }
                                        }}
                                        className="min-w-0 flex-1 rounded border border-yellow-500/50 bg-gray-950 px-2 py-1 text-sm text-white outline-none"
                                    />
                                ) : (
                                    <button
                                        onDoubleClick={() => {
                                            setDraftName(selectedItem.name || selectedItem.id);
                                            setEditingName(true);
                                        }}
                                        title="Double-click to rename"
                                        className="min-w-0 truncate rounded px-1 py-0.5 text-left text-sm text-white/95 hover:bg-gray-800"
                                    >
                                        {selectedLabel}
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {selectedItem.type === 'cobot' && (
                                    <>
                                        <button
                                            onClick={() => updatePlacedItem(selectedItem.id, {
                                                config: {
                                                    ...selectedItem.config,
                                                    cobotCollisionEnabled: !cobotCollisionEnabled,
                                                    collisionStopped: !cobotCollisionEnabled ? selectedItem.config?.collisionStopped : false
                                                }
                                            })}
                                            className={`inline-flex items-center justify-center rounded-md w-7 h-6 border transition-colors ${cobotCollisionEnabled ? 'border-cyan-400/45 bg-cyan-500/15 text-cyan-100' : 'border-gray-700 bg-gray-900/55 text-gray-400 hover:text-gray-200'}`}
                                            title={cobotCollisionEnabled ? 'Disable collision safety' : 'Enable collision safety'}
                                        >
                                            <Target size={11} />
                                        </button>
                                        <button
                                            onClick={() => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, autoOrganize: !cobotAutoIdle } })}
                                            className={`inline-flex items-center justify-center rounded-md w-7 h-6 border transition-colors ${cobotAutoIdle ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-100' : 'border-gray-700 bg-gray-900/55 text-gray-400 hover:text-gray-200'}`}
                                            title={cobotAutoIdle ? 'Disable auto idle organize' : 'Enable auto idle organize'}
                                        >
                                            <Cpu size={11} />
                                        </button>
                                        <button 
                                            onClick={() => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, isStopped: !selectedItem.config?.isStopped } })}
                                            className={`rounded-md p-1 transition-colors ${selectedItem.config?.isStopped ? 'text-emerald-400 hover:bg-emerald-500/20' : 'text-red-400 hover:bg-red-500/20'}`}
                                            title={selectedItem.config?.isStopped ? "Resume Cobot" : "Stop Cobot"}
                                        >
                                            {selectedItem.config?.isStopped ? <Play size={16} fill="currentColor" /> : <Square size={16} fill="currentColor" />}
                                        </button>
                                    </>
                                )}
                                <button onClick={() => setSelectedItemId(null)} className="text-gray-400 hover:text-white">
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {selectedItem.type === 'cobot' && (
                            <div className={`flex items-center justify-between rounded-lg border px-2 py-1 ${statusTone.badge}`}>
                                <div className="flex items-center gap-2">
                                    <span className={`h-2 w-2 rounded-full ${statusTone.dot}`} />
                                    <span className="text-[10px] font-bold uppercase tracking-wide">
                                        {selectedMachineState?.label || 'Idle'}
                                    </span>
                                </div>
                                <span className="text-[9px] opacity-80">
                                    {selectedMachineState?.detail || 'No runtime state yet'}
                                </span>
                            </div>
                        )}

                        {teachMinimized && (
                            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200">
                                <span>Teaching {teachAction?.toUpperCase()} point: click a station, part area, or grid position.</span>
                                <button
                                    onClick={() => setTeachAction(null)}
                                    className="rounded border border-emerald-400/40 px-2 py-1 text-[10px] text-emerald-100 hover:bg-emerald-500/20"
                                >
                                    CANCEL
                                </button>
                            </div>
                        )}

                        <div className="flex items-start justify-between gap-3">
                            {/* Specific Configs */}
                            <div className="flex flex-col gap-1.5 flex-1">
                                <div className={`rounded-lg overflow-hidden flex flex-col gap-1.5 ${selectedItem.type === 'cobot' ? 'bg-transparent px-0 pb-0' : 'bg-gray-800/50 border border-gray-700 px-2 pb-2'}`}>
                                    <div className={`flex flex-col gap-1.5 w-full ${selectedItem.type === 'cobot' ? '' : 'pt-2'}`}>
                                {selectedItem.type === 'sender' && !teachMinimized && (
                                    <div className="flex flex-col gap-2 w-full">
                                        <RangeSlider label="SPAWN INTERVAL" min={0.5} max={10} step={0.5} value={selectedItem.config?.speed || 3} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, speed: v } })} />
                                        <div className="flex items-center justify-between mt-1 gap-2">
                                            <span className="text-xs font-bold text-gray-500">PART TEMPLATE CLASS</span>
                                            <button
                                                onClick={openPartCreator}
                                                className="px-2 py-1 rounded border border-cyan-600/50 bg-cyan-500/10 text-cyan-200 text-[10px] font-bold hover:bg-cyan-500/20"
                                            >
                                                âœ¦ PART CREATOR
                                            </button>
                                        </div>
                                        <select
                                            className="bg-gray-800 text-white text-sm rounded p-1 border border-gray-600 outline-none"
                                            value={selectedItem.config?.spawnTemplateId || 'any'}
                                            onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, spawnTemplateId: e.target.value } })}
                                        >
                                            <option value="any">All Templates (Random)</option>
                                            {partTemplates.map(tpl => (
                                                <option key={tpl.id} value={tpl.id}>
                                                    {tpl.name} â€” {tpl.shape}
                                                </option>
                                            ))}
                                        </select>
                                        {/* Show the selected template's color/size pools */}
                                        {(() => {
                                            const tid = selectedItem.config?.spawnTemplateId;
                                            const tpl = tid && tid !== 'any' ? partTemplates.find(t => t.id === tid) : null;
                                            if (!tpl) return (
                                                <p className="text-[10px] text-gray-500 italic">Spawning randomly from all templates. Configure pools in Part Creator.</p>
                                            );
                                            const colors = tpl.spawnColors?.length ? tpl.spawnColors : [tpl.color];
                                            const sizes = tpl.spawnSizes?.length ? tpl.spawnSizes : [tpl.size];
                                            return (
                                                <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-2 flex flex-col gap-1.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] font-bold text-gray-500 uppercase">Color pool</span>
                                                        <div className="flex gap-1">
                                                            {colors.map(c => <span key={c} className="w-4 h-4 rounded-full border border-white/20" style={{backgroundColor: c}} />)}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] font-bold text-gray-500 uppercase">Size pool</span>
                                                        <div className="flex gap-1">
                                                            {sizes.map(s => <span key={s} className="text-[10px] bg-gray-700 rounded px-1.5 py-0.5 text-gray-200 font-bold uppercase">{s}</span>)}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}
                                {selectedItem.type === 'belt' && !teachMinimized && (
                                    <div className="flex flex-col gap-3 w-full">
                                        <RangeSlider label="BELT SPEED" min={0.5} max={5} step={0.5} value={selectedItem.config?.speed || 2} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, speed: v } })} />
                                        <div className="grid grid-cols-2 gap-2">
                                            <label className="flex items-center justify-between rounded border border-gray-700 bg-gray-900/40 px-3 py-1.5">
                                                <span className="text-[10px] font-bold text-gray-500">LEFT RAIL</span>
                                                <input
                                                    type="checkbox"
                                                    checked={(selectedItem.config?.beltBorders || [true, true])[0]}
                                                    onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, beltBorders: [e.target.checked, (selectedItem.config?.beltBorders || [true, true])[1]] } })}
                                                />
                                            </label>
                                            <label className="flex items-center justify-between rounded border border-gray-700 bg-gray-900/40 px-3 py-1.5">
                                                <span className="text-[10px] font-bold text-gray-500">RIGHT RAIL</span>
                                                <input
                                                    type="checkbox"
                                                    checked={(selectedItem.config?.beltBorders || [true, true])[1]}
                                                    onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, beltBorders: [(selectedItem.config?.beltBorders || [true, true])[0], e.target.checked] } })}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                )}
                                {selectedItem.type === 'table' && !teachMinimized && (
                                    <div className="flex flex-col gap-3 w-full">
                                        <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
                                            <RangeSlider label="GRID W" min={1} max={6} step={1} value={selectedItem.config?.tableGrid?.[0] || 3} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, tableGrid: [v, selectedItem.config?.tableGrid?.[1] || 3] } })} />
                                            <RangeSlider label="GRID D" min={1} max={6} step={1} value={selectedItem.config?.tableGrid?.[1] || 3} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, tableGrid: [selectedItem.config?.tableGrid?.[0] || 3, v] } })} />
                                            <label className="flex items-center gap-2 rounded border border-gray-700 bg-gray-900/40 px-3 py-1.5 h-7">
                                                <span className="text-[10px] font-bold text-gray-500">SHOW</span>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedItem.config?.showTableGrid !== false}
                                                    onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, showTableGrid: e.target.checked } })}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                )}
                                                {selectedItem.type === 'cobot' && !teachMinimized && (
                                                    <>
                                                        {selectedItem.config?.collisionStopped && (
                                                            <div className="bg-red-900/30 border border-red-500 rounded p-2 mb-3">
                                                                <span className="text-red-400 text-[10px] font-bold block mb-1">âš ï¸ SAFETY STOP ENGAGED</span>
                                                                <button 
                                                                    onClick={unlockSelectedCobot}
                                                                    className="w-full bg-red-600 hover:bg-red-500 text-white rounded py-1 text-[10px] font-bold"
                                                                >
                                                                    UNLOCK COBOT
                                                                </button>
                                                            </div>
                                                        )}
                                                        <div className="rounded-md overflow-hidden mb-1 mt-1 border border-fuchsia-500/35 bg-gray-900/55">
                                                            <button
                                                                onClick={() => toggleCobotSection('transform')}
                                                                className={`w-full flex items-center justify-between px-1.5 py-1 text-left hover:bg-fuchsia-900/20 transition-colors ${showTransforms ? 'bg-fuchsia-900/20' : ''}`}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <SlidersHorizontal size={12} className="text-fuchsia-300" />
                                                                    <span className="text-[10px] text-fuchsia-100 font-bold">TRANSFORM & KINEMATICS</span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span
                                                                        onClick={(e) => {
                                                                            e.preventDefault();
                                                                            e.stopPropagation();
                                                                            setCobotOverlay({ showArmRange: !showArmRangeOverlay });
                                                                        }}
                                                                        className={`inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[8px] font-bold cursor-pointer ${showArmRangeOverlay ? 'border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100' : 'border-gray-700 bg-gray-900/55 text-gray-400'}`}
                                                                        title={showArmRangeOverlay ? 'Hide range overlay' : 'Show range overlay'}
                                                                    >
                                                                        <Target size={9} />
                                                                        RANGE
                                                                    </span>
                                                                    {showTransforms ? <ChevronDown size={12} className="text-fuchsia-200" /> : <ChevronRight size={12} className="text-fuchsia-200" />}
                                                                </div>
                                                            </button>
                                                            {showTransforms && (
                                                                <div className="px-1.5 pb-1.5 pt-1.5 flex flex-col gap-1.5">
                                                                    <RangeSlider label="ARM SPEED" min={0.5} max={3} step={0.1} value={selectedItem.config?.speed || 1} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, speed: v } })} />

                                                                    {cobotArmTarget && (
                                                                        <div className="rounded-md border border-sky-500/25 bg-sky-950/20 p-1.5 flex flex-col gap-1.5">
                                                                            <div className="flex items-center justify-between gap-2">
                                                                                <div className="flex items-center gap-1.5">
                                                                                    <Move size={11} className="text-sky-200" />
                                                                                    <span className="text-[9px] font-bold text-sky-100">ARM POSE</span>
                                                                                </div>
                                                                                <div className="flex items-center gap-1">
                                                                                    <button
                                                                                        onClick={() => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, cobotManualControl: !selectedItem.config?.cobotManualControl, cobotManualTarget: cobotArmTarget, isStopped: false } })}
                                                                                        className={`h-5 px-1.5 rounded border text-[8px] font-bold ${selectedItem.config?.cobotManualControl ? 'border-sky-300/60 bg-sky-500/20 text-sky-100' : 'border-gray-700 bg-gray-900/60 text-gray-400'}`}
                                                                                        title="Enable manual arm jog target"
                                                                                    >
                                                                                        JOG
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={goCobotHomeTarget}
                                                                                        className="h-5 px-1.5 rounded border border-gray-700 bg-gray-900/60 text-gray-200 hover:text-white inline-flex items-center gap-1 text-[8px] font-bold"
                                                                                        title="Move arm to saved home pose"
                                                                                    >
                                                                                        <Home size={9} /> HOME
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                            <div className="grid grid-cols-3 gap-1">
                                                                                {(['X', 'Y', 'Z'] as const).map((axis, axisIdx) => (
                                                                                    <div key={axis} className="rounded bg-gray-950/45 border border-gray-800 px-1 py-1">
                                                                                        <div className="flex items-center justify-between mb-1">
                                                                                            <span className="text-[8px] font-bold text-gray-500">{axis}</span>
                                                                                            <span className="text-[9px] font-mono font-bold text-sky-200">{cobotArmTarget[axisIdx].toFixed(2)}</span>
                                                                                        </div>
                                                                                        <div className="grid grid-cols-2 gap-1">
                                                                                            <button
                                                                                                onClick={() => nudgeCobotArmTarget(axisIdx as 0 | 1 | 2, axisIdx === 1 ? -0.05 : -0.1)}
                                                                                                className="h-5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 text-[10px] font-bold"
                                                                                            >
                                                                                                -
                                                                                            </button>
                                                                                            <button
                                                                                                onClick={() => nudgeCobotArmTarget(axisIdx as 0 | 1 | 2, axisIdx === 1 ? 0.05 : 0.1)}
                                                                                                className="h-5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 text-[10px] font-bold"
                                                                                            >
                                                                                                +
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                            <div className="grid grid-cols-2 gap-1">
                                                                                <button
                                                                                    onClick={() => setCobotManualTarget(defaultCobotArmTarget(selectedItem))}
                                                                                    className="h-6 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 text-[9px] font-bold"
                                                                                >
                                                                                    CENTER ARM
                                                                                </button>
                                                                                <button
                                                                                    onClick={saveCobotHomeTarget}
                                                                                    className="h-6 rounded bg-sky-700/60 hover:bg-sky-600 text-sky-50 text-[9px] font-bold"
                                                                                >
                                                                                    SAVE AS HOME
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    <div className="flex gap-2 w-full mt-1">
                                                                        <div className="flex flex-col gap-0.5 w-1/2">
                                                                            <span className="text-[9px] font-bold text-gray-500">STACK GRID <span className="font-normal text-gray-600">({((selectedItem.config?.stackMatrix?.[0] || 3) * (selectedItem.config?.stackMatrix?.[1] || 3)) - 1} slots)</span></span>
                                                                            <div className="flex items-center gap-1">
                                                                                <input type="number" min="1" max="4" value={selectedItem.config?.stackMatrix?.[0] || 3} onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, stackMatrix: [parseInt(e.target.value) || 1, selectedItem.config?.stackMatrix?.[1] || 3] } })} className="bg-gray-800 text-white text-[10px] rounded px-1.5 py-0.5 border border-gray-600 outline-none w-full" />
                                                                                <span className="text-gray-500 text-[10px]">x</span>
                                                                                <input type="number" min="1" max="4" value={selectedItem.config?.stackMatrix?.[1] || 3} onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, stackMatrix: [selectedItem.config?.stackMatrix?.[0] || 3, parseInt(e.target.value) || 1] } })} className="bg-gray-800 text-white text-[10px] rounded px-1.5 py-0.5 border border-gray-600 outline-none w-full" />
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex flex-col gap-0.5 w-1/2">
                                                                            <span className="text-[9px] font-bold text-gray-500">MAX STACK H.</span>
                                                                            <input type="number" min="1" max="20" value={selectedItem.config?.stackMax || 10} onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, stackMax: parseInt(e.target.value) || 10 } })} className="bg-gray-800 text-white text-[10px] rounded px-1.5 py-0.5 border border-gray-600 outline-none w-full" />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                </div>

                                {selectedItem.type === 'cobot' && (
                                    <>
                                        <div className="bg-cyan-950/25 rounded-md border border-cyan-500/35 overflow-hidden">
                                            <button
                                                onClick={() => toggleCobotSection('vision')}
                                                className="w-full flex items-center justify-between px-1.5 py-1 text-left bg-cyan-900/20 hover:bg-cyan-800/30 transition-colors"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Camera size={12} className="text-cyan-200" />
                                                    <span className="text-[10px] text-cyan-100 font-bold">VISION & CAMERA LINKS</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setCobotOverlay({ showPathPreview: !showPathOverlay });
                                                        }}
                                                        className={`inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[8px] font-bold cursor-pointer ${showPathOverlay ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100' : 'border-gray-700 bg-gray-900/55 text-gray-400'}`}
                                                        title={showPathOverlay ? 'Hide path overlay' : 'Show path overlay'}
                                                    >
                                                        <Link2 size={9} />
                                                        PATH
                                                    </span>
                                                    {showVisionConfig ? <ChevronDown size={12} className="text-cyan-200" /> : <ChevronRight size={12} className="text-cyan-200" />}
                                                </div>
                                            </button>
                                            {showVisionConfig && (
                                                <div className="px-1.5 pb-1.5 flex flex-col gap-1.5 border-t border-cyan-500/30">
                                                    <div className="pt-2 flex flex-col gap-1">
                                                        <span className="text-[9px] font-bold text-gray-500">LINKED CAMERAS</span>
                                                        <div className="grid grid-cols-2 gap-1">
                                                            {cameras.map(cam => {
                                                                const linked = selectedItem.config?.linkedCameraIds?.includes(cam.id);
                                                                const detections = simState.cameraDetections.filter(det => det.cameraId === cam.id).slice(0, 4);
                                                                return (
                                                                    <button
                                                                        key={cam.id}
                                                                        onClick={() => toggleLinkedCamera(cam.id)}
                                                                        className={`rounded border p-1.5 text-left ${linked ? 'border-cyan-400 bg-cyan-500/10' : 'border-gray-700 bg-gray-900/40'}`}
                                                                    >
                                                                        <div className="flex items-center justify-between">
                                                                            <span className="truncate text-[10px] font-bold text-white">{cam.name || cam.id}</span>
                                                                            <span className={`h-1.5 w-1.5 rounded-full ${linked ? 'bg-cyan-300' : 'bg-gray-600'}`} />
                                                                        </div>
                                                                        <div className="mt-1.5 h-8 rounded bg-gray-950/70 border border-gray-800 p-0.5 flex items-end gap-0.5">
                                                                            {detections.length === 0 ? (
                                                                                <span className="text-[10px] text-gray-600">No parts</span>
                                                                            ) : detections.map(det => (
                                                                                <span
                                                                                    key={det.itemId}
                                                                                    className="w-5 rounded-sm border border-black/20"
                                                                                    title={`${det.templateName || det.templateId || det.itemId} â€¢ ${det.shape} â€¢ ${det.size}`}
                                                                                    style={{
                                                                                        height: det.size === 'large' ? '1.6rem' : det.size === 'medium' ? '1.2rem' : '0.95rem',
                                                                                        backgroundColor: det.color
                                                                                    }}
                                                                                />
                                                                            ))}
                                                                        </div>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[9px] font-bold text-gray-500">COLORS</span>
                                                        <div className="grid grid-cols-4 gap-1">
                                                            {PICK_COLORS.map(color => {
                                                                const active = selectedItem.config?.pickColors?.includes(color.value);
                                                                return (
                                                                    <button
                                                                        key={color.value}
                                                                        onClick={() => togglePickColor(color.value)}
                                                                        className={`h-6 rounded border text-[9px] font-bold ${active ? 'border-white text-white' : 'border-gray-700 text-gray-400'}`}
                                                                        style={{ backgroundColor: active ? color.value : 'rgba(31,41,55,0.8)' }}
                                                                    >
                                                                        {color.label}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[9px] font-bold text-gray-500">SIZES</span>
                                                        <div className="grid grid-cols-3 gap-1">
                                                            {PICK_SIZES.map(size => {
                                                                const active = selectedItem.config?.pickSizes?.includes(size);
                                                                return (
                                                                    <button
                                                                        key={size}
                                                                        onClick={() => togglePickSize(size)}
                                                                        className={`h-6 rounded border text-[9px] font-bold uppercase ${active ? 'bg-blue-500/30 border-blue-400 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}
                                                                    >
                                                                        {size}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                    <div className="text-[10px] text-gray-500">
                                                        Link one or more cameras, then filter by color/size. If no camera is linked, filtered picking will not run.
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* Programmability UI */}
                                        <div className="bg-emerald-950/25 rounded-md border border-emerald-500/35 overflow-hidden">
                                            <button
                                                onClick={() => toggleCobotSection('controller')}
                                                className="w-full flex items-center justify-between px-1.5 py-1 text-left bg-emerald-900/20 hover:bg-emerald-800/30 transition-colors"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Cpu size={12} className="text-emerald-200" />
                                                    <span className="text-[10px] text-emerald-100 font-bold">ROBOT CONTROLLER</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setCobotOverlay({ showTeachPoints: !showTeachPointsOverlay });
                                                        }}
                                                        className={`inline-flex items-center gap-1 rounded border px-1 py-0.5 text-[8px] font-bold cursor-pointer ${showTeachPointsOverlay ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100' : 'border-gray-700 bg-gray-900/55 text-gray-400'}`}
                                                        title={showTeachPointsOverlay ? 'Hide taught points overlay' : 'Show taught points overlay'}
                                                    >
                                                        <List size={9} />
                                                        POINTS
                                                    </span>
                                                    {showController ? <ChevronDown size={12} className="text-emerald-200" /> : <ChevronRight size={12} className="text-emerald-200" />}
                                                </div>
                                            </button>
                                            {showController && (
                                                <div className="px-1.5 pb-1.5 border-t border-emerald-500/30 flex flex-col gap-1.5">
                                                    <div className="pt-2 flex items-center justify-between gap-2">
                                                        <div className="flex flex-wrap items-center gap-1">
                                                            <button
                                                                onClick={() => addProgramStep('move')}
                                                                className="w-6 h-5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 inline-flex items-center justify-center"
                                                                title="Add move step"
                                                            >
                                                                <Move size={10} />
                                                            </button>
                                                            <button
                                                                onClick={() => setTeachAction(teachAction === 'pick' ? null : 'pick')}
                                                                className={`w-6 h-5 rounded inline-flex items-center justify-center transition-colors ${
                                                                    teachAction === 'pick'
                                                                        ? 'bg-cyan-500 text-white animate-pulse'
                                                                        : 'bg-cyan-700/45 hover:bg-cyan-600/60 text-cyan-100'
                                                                }`}
                                                                title={teachAction === 'pick' ? 'Cancel teach pick' : 'Teach pick point'}
                                                            >
                                                                <Target size={10} />
                                                            </button>
                                                            <button
                                                                onClick={() => setTeachAction(teachAction === 'drop' ? null : 'drop')}
                                                                className={`w-6 h-5 rounded inline-flex items-center justify-center transition-colors ${
                                                                    teachAction === 'drop'
                                                                        ? 'bg-red-500 text-white animate-pulse'
                                                                        : 'bg-red-700/45 hover:bg-red-600/60 text-red-100'
                                                                }`}
                                                                title={teachAction === 'drop' ? 'Cancel teach drop' : 'Teach drop point'}
                                                            >
                                                                <Target size={10} />
                                                            </button>
                                                            <button
                                                                onClick={() => addProgramStep('pick')}
                                                                className="w-6 h-5 rounded bg-cyan-700/50 hover:bg-cyan-600/60 text-cyan-100 inline-flex items-center justify-center"
                                                                title="Add pick step"
                                                            >
                                                                <Download size={10} />
                                                            </button>
                                                            <button
                                                                onClick={() => addProgramStep('drop')}
                                                                className="w-6 h-5 rounded bg-emerald-700/50 hover:bg-emerald-600/60 text-emerald-100 inline-flex items-center justify-center"
                                                                title="Add drop step"
                                                            >
                                                                <Upload size={10} />
                                                            </button>
                                                            <button
                                                                onClick={() => addProgramStep('wait')}
                                                                className="w-6 h-5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 inline-flex items-center justify-center"
                                                                title="Add wait step"
                                                            >
                                                                <Pause size={10} />
                                                            </button>
                                                            <div className="ml-1 pl-2 border-l border-emerald-600/40 flex items-center gap-2">
                                                                <span className="text-[9px] font-bold text-emerald-200">SORT</span>
                                                                <label className="flex items-center gap-1 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="w-3 h-3 accent-[#38bdf8]"
                                                                        checked={controllerSortColor}
                                                                        onChange={(e) => setDropSortPreference('sortColor', e.target.checked)}
                                                                    />
                                                                    <span className="text-[9px] font-bold text-gray-300">COLOR</span>
                                                                </label>
                                                                <label className="flex items-center gap-1 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="w-3 h-3 accent-[#38bdf8]"
                                                                        checked={controllerSortSize}
                                                                        onChange={(e) => setDropSortPreference('sortSize', e.target.checked)}
                                                                    />
                                                                    <span className="text-[9px] font-bold text-gray-300">SIZE</span>
                                                                </label>
                                                                <label className="flex items-center gap-1 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="w-3 h-3 accent-[#38bdf8]"
                                                                        checked={controllerSortShape}
                                                                        onChange={(e) => setDropSortPreference('sortShape', e.target.checked)}
                                                                    />
                                                                    <span className="text-[9px] font-bold text-gray-300">SHAPE</span>
                                                                </label>
                                                            </div>
                                                        </div>
                                                        <button onClick={handleClearProgram} className="text-[10px] text-red-400 hover:text-red-300">Clear</button>
                                                    </div>

                                                    <div className="flex flex-col gap-1 mb-1 max-h-[220px] overflow-y-auto pr-1">
                                                        {selectedItem.config?.program?.map((step, idx) => (
                                                            <div
                                                                key={idx}
                                                                onClick={(e) => {
                                                                    const target = e.target as HTMLElement;
                                                                    if (target.closest('button, input, select, textarea, a')) return;
                                                                    setActiveProgramStepIndex(idx);
                                                                }}
                                                                className={`rounded border p-1 flex flex-col gap-1 cursor-pointer ${activeProgramStepIndex === idx ? 'border-emerald-400/70 bg-emerald-500/10' : 'border-gray-700 bg-gray-900/50'}`}
                                                            >
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-[9px] font-mono text-gray-500 w-4">{idx + 1}</span>
                                                                    <select
                                                                        className="bg-gray-800 text-white text-[10px] rounded px-1 py-0.5 border border-gray-600 outline-none"
                                                                        value={step.action}
                                                                        onChange={(e) => patchProgramStep(
                                                                            idx,
                                                                            e.target.value === 'wait'
                                                                                ? { action: e.target.value as ProgramAction, pos: undefined, duration: step.duration ?? 0.4 }
                                                                                : e.target.value === 'drop'
                                                                                    ? {
                                                                                        action: 'drop',
                                                                                        pos: step.pos ?? [selectedItem.position[0], 0.56, selectedItem.position[2]],
                                                                                        duration: undefined,
                                                                                        sortColor: controllerSortColor,
                                                                                        sortSize: controllerSortSize,
                                                                                        sortShape: controllerSortShape,
                                                                                    }
                                                                                    : { action: e.target.value as ProgramAction, pos: step.pos ?? [selectedItem.position[0], 0.56, selectedItem.position[2]], duration: undefined }
                                                                        )}
                                                                    >
                                                                        {PROGRAM_ACTIONS.map(action => <option key={action} value={action}>{action.toUpperCase()}</option>)}
                                                                    </select>
                                                                    <button onClick={(e) => { e.stopPropagation(); setActiveProgramStepIndex(idx); moveProgramStep(idx, -1); }} className="p-0.5 rounded bg-gray-800 text-gray-300 hover:text-white"><ArrowUp size={12} /></button>
                                                                    <button onClick={(e) => { e.stopPropagation(); setActiveProgramStepIndex(idx); moveProgramStep(idx, 1); }} className="p-0.5 rounded bg-gray-800 text-gray-300 hover:text-white"><ArrowDown size={12} /></button>
                                                                    <button onClick={(e) => { e.stopPropagation(); setActiveProgramStepIndex(null); removeProgramStep(idx); }} className="ml-auto p-0.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash2 size={12} /></button>
                                                                </div>
                                                                {step.action === 'wait' ? (
                                                                    <div className="px-1 mt-1">
                                                                        <RangeSlider label="WAIT TIME (s)" min={0.1} max={5} step={0.1} value={step.duration ?? 0.4} onChange={(v) => patchProgramStep(idx, { duration: v })} />
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex flex-col gap-2">
                                                                        <div className="grid grid-cols-3 gap-2 px-1 mt-1">
                                                                            {(['X', 'Y', 'Z'] as const).map((axis, axisIdx) => (
                                                                                <RangeSlider
                                                                                    key={axis}
                                                                                    label={axis}
                                                                                    min={axis === 'Y' ? 0.05 : selectedItem.position[axisIdx === 0 ? 0 : 2] - 2.8}
                                                                                    max={axis === 'Y' ? 3.5 : selectedItem.position[axisIdx === 0 ? 0 : 2] + 2.8}
                                                                                    step={0.1}
                                                                                    value={step.pos?.[axisIdx] ?? (axis === 'Y' ? 0.56 : selectedItem.position[axisIdx === 0 ? 0 : 2])}
                                                                                    onChange={(v) => {
                                                                                        const currentPos = step.pos ?? [selectedItem.position[0], 0.56, selectedItem.position[2]];
                                                                                        const nextPos = [...currentPos] as [number, number, number];
                                                                                        nextPos[axisIdx] = v;
                                                                                        patchProgramStep(idx, { pos: nextPos });
                                                                                    }}
                                                                                />
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                        {(!selectedItem.config?.program || selectedItem.config.program.length === 0) && (
                                                            <span className="text-xs text-gray-500 italic">No controller steps yet. Add move, pick, drop, or wait actions.</span>
                                                        )}
                                                    </div>

                                                    {teachAction && (
                                                        <div className="text-[10px] text-yellow-400 text-center mt-1">
                                                            Click on the grid or a station to append a taught {teachAction.toUpperCase()} step.
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                                {selectedItem.type === 'camera' && (
                                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 flex flex-col gap-3">
                                        <div className="flex items-center gap-2">
                                            <Camera size={16} className="text-cyan-300" />
                                            <span className="text-xs text-gray-300 font-bold">CAMERA PREVIEW</span>
                                        </div>
                                        <label className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-900/40 px-3 py-2">
                                            <span className="text-[10px] font-bold text-gray-500">VISION BEAM</span>
                                            <input
                                                type="checkbox"
                                                checked={selectedItem.config?.showBeam !== false}
                                                onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, showBeam: e.target.checked } })}
                                            />
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <label className="flex flex-col gap-1 rounded-lg border border-gray-700 bg-gray-900/40 px-2 py-2">
                                                <span className="text-[9px] font-bold text-gray-500">FPS (GLOBAL)</span>
                                                <input
                                                    type="range"
                                                    min={2}
                                                    max={24}
                                                    step={1}
                                                    value={cameraPreviewFps}
                                                    onChange={(e) => setCameraPreviewFps(parseInt(e.target.value, 10) || 8)}
                                                    className="w-full"
                                                />
                                                <span className="text-[10px] text-cyan-200 font-mono">{cameraPreviewFps} fps</span>
                                            </label>
                                            <label className="flex flex-col gap-1 rounded-lg border border-gray-700 bg-gray-900/40 px-2 py-2">
                                                <span className="text-[9px] font-bold text-gray-500">RES (GLOBAL)</span>
                                                <select
                                                    value={cameraResolutionKey}
                                                    onChange={(e) => {
                                                        const picked = CAMERA_PREVIEW_RESOLUTIONS.find(r => r.label === e.target.value);
                                                        if (picked) setCameraPreviewResolution(picked.width, picked.height);
                                                    }}
                                                    className="bg-gray-800 text-white text-[10px] rounded p-1 border border-gray-600 outline-none"
                                                >
                                                    {CAMERA_PREVIEW_RESOLUTIONS.map(opt => (
                                                        <option key={opt.label} value={opt.label}>{opt.label}</option>
                                                    ))}
                                                </select>
                                                <span className="text-[10px] text-gray-400">Applied to all cameras</span>
                                            </label>
                                        </div>
                                        <div className="grid grid-cols-2 gap-1 rounded border border-gray-700 bg-gray-900/50 p-1">
                                            <button
                                                onClick={() => setCameraPreviewMode('video')}
                                                className={`rounded py-1 text-[10px] font-bold transition-colors ${cameraPreviewMode === 'video' ? 'bg-cyan-500/25 text-cyan-100 border border-cyan-400/40' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}
                                            >
                                                VIDEO
                                            </button>
                                            <button
                                                onClick={() => setCameraPreviewMode('graph')}
                                                className={`rounded py-1 text-[10px] font-bold transition-colors ${cameraPreviewMode === 'graph' ? 'bg-cyan-500/25 text-cyan-100 border border-cyan-400/40' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}
                                            >
                                                GRAPH
                                            </button>
                                        </div>
                                        {cameraPreviewMode === 'video' ? (
                                            <div className="h-36 rounded bg-gray-950/80 border border-gray-800 p-1 relative overflow-hidden">
                                                {simState.cameraFrames[selectedItem.id] ? (
                                                    <img
                                                        src={simState.cameraFrames[selectedItem.id]}
                                                        alt="Camera feed"
                                                        className="w-full h-full object-cover rounded"
                                                    />
                                                ) : (
                                                    <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-600">
                                                        Waiting for camera video...
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="h-28 rounded bg-gray-950/70 border border-gray-800 p-2 flex items-end gap-1.5">
                                                {selectedCameraDetections.slice(0, 10).map(det => (
                                                    <span
                                                        key={det.itemId}
                                                        className="w-6 rounded-sm border border-black/20"
                                                        title={`${det.templateName || det.templateId || det.itemId} • ${det.shape} • ${det.size}`}
                                                        style={{
                                                            height: det.size === 'large' ? '2.3rem' : det.size === 'medium' ? '1.8rem' : '1.35rem',
                                                            backgroundColor: det.color
                                                        }}
                                                    />
                                                ))}
                                                {selectedCameraDetections.length === 0 && (
                                                    <span className="text-[10px] text-gray-600">No parts currently in view</span>
                                                )}
                                            </div>
                                        )}
                                        <div className="rounded border border-gray-800 bg-gray-950/50 max-h-36 overflow-auto">
                                            <div className="grid grid-cols-[1.35fr_0.8fr_0.8fr_0.85fr_0.7fr] px-2 py-1 text-[9px] font-bold text-gray-500 border-b border-gray-800">
                                                <span>PART</span><span>COLOR</span><span>SIZE</span><span>SHAPE</span><span>CONF</span>
                                            </div>
                                            {selectedCameraDetections.slice(0, 16).map(det => (
                                                <div key={`row_${det.itemId}`} className="grid grid-cols-[1.35fr_0.8fr_0.8fr_0.85fr_0.7fr] px-2 py-1 text-[10px] text-gray-300 border-b border-gray-900/80 last:border-b-0">
                                                    <span className="truncate">{det.templateName || det.templateId || det.itemId}</span>
                                                    <span className="truncate">{det.color}</span>
                                                    <span className="uppercase">{det.size}</span>
                                                    <span className="uppercase">{det.shape}</span>
                                                    <span>{Math.round((Number.isFinite(det.confidence) ? det.confidence : 0) * 100)}%</span>
                                                </div>
                                            ))}
                                            {selectedCameraDetections.length === 0 && (
                                                <div className="px-2 py-2 text-[10px] text-gray-600">Detection list is empty.</div>
                                            )}
                                        </div>
                                        <div className="text-[10px] text-gray-500">
                                            Linked cobots can use this camera's live detections for filtered picking.
                                        </div>
                                    </div>
                                )}
                                {['receiver', 'table', 'pile', 'indexed_receiver'].includes(selectedItem.type) && (
                                    <div className="flex flex-col gap-2 w-full mt-2 border-t border-gray-700 pt-2">
                                        <span className="text-[10px] text-gray-400 font-bold">ACCEPTANCE FILTERS</span>
                                        <div className="grid grid-cols-2 gap-2">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-[9px] font-bold text-gray-500">ACCEPTED COLOR</span>
                                                <select 
                                                    className="bg-gray-800 text-white text-[10px] rounded p-1 border border-gray-600 outline-none"
                                                    value={selectedItem.config?.acceptColor || 'any'}
                                                    onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, acceptColor: e.target.value } })}
                                                >
                                                    <option value="any">Any Color (All)</option>
                                                    <option value="#ef4444">Red</option>
                                                    <option value="#3b82f6">Blue</option>
                                                    <option value="#10b981">Green</option>
                                                    <option value="#f59e0b">Yellow</option>
                                                </select>
                                            </label>
                                            <label className="flex flex-col gap-1">
                                                <span className="text-[9px] font-bold text-gray-500">ACCEPTED SIZE</span>
                                                <select 
                                                    className="bg-gray-800 text-white text-[10px] rounded p-1 border border-gray-600 outline-none"
                                                    value={selectedItem.config?.acceptSize || 'any'}
                                                    onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, acceptSize: e.target.value as any } })}
                                                >
                                                    <option value="any">Any Size (All)</option>
                                                    <option value="small">Small</option>
                                                    <option value="medium">Medium</option>
                                                    <option value="large">Large</option>
                                                </select>
                                            </label>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Global Actions */}
                            <div className="flex flex-col gap-1.5 min-w-[106px]">
                                <div className="grid grid-cols-3 gap-1.5">
                                    <button 
                                        onClick={() => setMoveModeItemId(moveModeItemId === selectedItem.id ? null : selectedItem.id)}
                                        className={`flex items-center justify-center gap-1 px-2 h-8 rounded-md text-[9px] font-bold transition-colors ${moveModeItemId === selectedItem.id ? 'bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)]' : 'bg-blue-500/20 hover:bg-blue-500/40 text-blue-400'}`}
                                    >
                                        <Move size={13} /> {moveModeItemId === selectedItem.id ? 'MOVING...' : 'MOVE'}
                                    </button>
                                    <button 
                                        onClick={handleRotateSelected}
                                        className="flex items-center justify-center gap-1 px-2 h-8 bg-gray-800 hover:bg-gray-700 text-white rounded-md text-[9px] font-bold transition-colors"
                                    >
                                        <RotateCw size={13} /> ROT
                                    </button>
                                    <button 
                                        onClick={handleSellSelected}
                                        className="flex items-center justify-center gap-1 px-2 h-8 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-md text-[9px] font-bold transition-colors"
                                    >
                                        <Trash2 size={13} /> SELL
                                    </button>
                                </div>
                                {selectedItem.type === 'cobot' && (
                                    <div className="rounded-lg border border-gray-700 bg-gray-900/50 px-2 py-1.5 flex flex-col gap-1">
                                        <button
                                            onClick={exportSelectedCobotLog}
                                            className="mb-1 flex items-center justify-center gap-1 rounded bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/35 py-1 text-[9px] font-bold transition-colors"
                                            title="Export this cobot debug log"
                                        >
                                            <Download size={11} /> EXPORT LOG
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* BUILD MENU */
                    <>
                        {/* Hints */}
                        {buildMode && !draftPlacement ? (
                            <div className="bg-blue-500 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2 animate-bounce">
                                <span>Click grid to place</span>
                                <span className="bg-blue-600 px-2 py-0.5 rounded text-xs">Press 'R' to rotate</span>
                            </div>
                        ) : null}

                        <div className={`${panelFrameClass} rounded-2xl p-2 flex flex-wrap justify-center gap-2 sm:gap-3 items-center max-w-[calc(100vw-12px)]`}>
                            
                            <div className="flex items-center gap-2 mr-2">
                                <button 
                                    onClick={handlePlayClick}
                                    className={`flex items-center justify-center p-3 rounded-xl transition-all ${isRunning && !isPaused ? 'bg-orange-500/20 text-orange-400 shadow-inner' : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'}`}
                                    title={!isRunning ? "Play (Click 5Ã— for +10k credits)" : isPaused ? "Resume" : "Pause"}
                                >
                                    {isRunning && !isPaused ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                                </button>

                                {/* Stop button */}
                                <div className="relative">
                                    <button 
                                        onClick={handleStopClick}
                                        className={`flex items-center justify-center p-3 rounded-xl transition-all ${showStopConfirm ? 'bg-red-500 text-white' : 'bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white'}`}
                                        title="Stop & Reset Items"
                                        id="stop-btn"
                                    >
                                        <Square size={20} fill="currentColor" />
                                    </button>
                                    {showStopConfirm && (
                                        <div className="absolute bg-gray-950 border border-red-500/60 rounded-xl shadow-2xl p-3 flex flex-col gap-2 w-52 animate-fade-in" style={{zIndex:9999, bottom:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)'}}>
                                            <p className="text-xs text-red-200 font-bold text-center">âš  Reset simulation & clear all parts?</p>
                                            <div className="flex gap-2">
                                                <button onClick={doStop} className="flex-1 bg-red-500 hover:bg-red-400 text-white text-xs font-bold rounded-lg py-1.5 transition-colors">RESET</button>
                                                <button onClick={() => setShowStopConfirm(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg py-1.5 transition-colors">CANCEL</button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-col gap-1 ml-1">
                                    <input 
                                        type="range" min="0.2" max="10" step="0.1"
                                        value={simSpeedValue}
                                        onChange={e => {
                                            const next = parseFloat(e.target.value);
                                            setSimSpeedMult(Number.isFinite(next) ? next : 1);
                                        }}
                                        className="w-20 accent-emerald-500 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                        title={`Speed: ${simSpeedValue.toFixed(1)}x`}
                                    />
                                    <div className="flex gap-1 relative">
                                        <button onClick={handleResetClick} className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="Clear Factory"><Trash2 size={12} /></button>
                                        <button onClick={importFactory} className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700" title="Import Factory"><Upload size={12} /></button>
                                        <button onClick={exportFactory} className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700" title="Export Factory"><Download size={12} /></button>
                                        
                                        {showResetConfirm && (
                                            <div className="absolute bg-gray-950 border border-amber-500/60 rounded-xl shadow-2xl p-3 flex flex-col gap-2 w-64 animate-fade-in" style={{zIndex:9999, bottom:'calc(100% + 12px)', left:'0'}}>
                                                <p className="text-xs text-amber-200 font-bold">Reset factory to default scene?</p>
                                                <p className="text-[10px] text-gray-400 leading-tight">All placed machines and credits will be reset to defaults.</p>
                                                <div className="flex flex-col gap-1.5 mt-1">
                                                    <button onClick={() => doReset(true)} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded-lg py-2 transition-colors flex items-center justify-center gap-2">
                                                        <Download size={12} /> EXPORT & RESET
                                                    </button>
                                                    <button onClick={() => doReset(false)} className="w-full bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded-lg py-2 transition-colors">RESET ONLY</button>
                                                    <button onClick={() => setShowResetConfirm(false)} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-[10px] font-bold rounded-lg py-2 transition-colors">CANCEL</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="w-px h-8 bg-gray-700"></div>

                            {/* BUILD GROUPS */}
                            <div className="flex gap-2 flex-wrap justify-center">
                                {[
                                    { id: 'surfaces', icon: <Square size={18} />, label: 'Surfaces', items: ['belt', 'table', 'pile'] as ItemType[] },
                                    { id: 'machines', icon: <Cpu size={18} />, label: 'Machines', items: ['sender', 'receiver', 'indexed_receiver'] as ItemType[] },
                                    { id: 'tech', icon: <Camera size={18} />, label: 'Tech', items: ['cobot', 'camera'] as ItemType[] }
                                ].map(group => {
                                    const isGroupActive = activeGroup === group.id;
                                    const hasActiveItem = group.items.includes(buildMode as ItemType);
                                    
                                    return (
                                        <div key={group.id} className="relative">
                                            <button
                                                onClick={() => setActiveGroup(isGroupActive ? null : group.id)}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-lg font-bold transition-all ${isGroupActive || hasActiveItem ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                                            >
                                                {group.icon}
                                                <span className="text-xs hidden sm:inline">{group.label}</span>
                                                <ChevronDown size={14} className={`transition-transform ${isGroupActive ? 'rotate-180' : ''}`} />
                                            </button>
                                            
                                            {isGroupActive && (
                                                <div className="absolute bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2 flex flex-col gap-1 w-52 animate-fade-in" style={{zIndex:9999, bottom:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)'}}>
                                                    {group.items.map(type => (
                                                        <BuildButton 
                                                            key={type}
                                                            title={type === 'sender' ? 'PART SPAWNER' : type.replace('_', ' ').toUpperCase()} 
                                                            cost={ITEM_COSTS[type]} 
                                                            isActive={buildMode === type}
                                                            onClick={() => {
                                                                handleBuildClick(type);
                                                                setActiveGroup(null);
                                                            }}
                                                            disabled={credits < ITEM_COSTS[type] || isRunning}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                        </div>
                    </>
                )}

                {showHelpModal && (
                    <div className="fixed inset-0 z-[68] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="w-[min(560px,94vw)] rounded-xl border border-gray-700 bg-gray-900 text-gray-100 shadow-2xl overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                                <div className="text-sm font-black tracking-wide text-blue-200">CONTROLS</div>
                                <button onClick={() => setShowHelpModal(false)} className="p-1 rounded hover:bg-gray-800 text-gray-300">
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="px-4 py-3 text-xs sm:text-sm text-gray-300 flex flex-col gap-3">
                                <div>
                                    <div className="font-bold text-white mb-1">Camera</div>
                                    <ul className="list-disc pl-5 space-y-1">
                                        <li>Rotate: left-click drag (desktop) or one-finger drag (mobile).</li>
                                        <li>Pan: right-click drag (desktop) or two-finger drag (mobile).</li>
                                        <li>Zoom: mouse wheel (desktop) or pinch (mobile).</li>
                                    </ul>
                                </div>
                                <div>
                                    <div className="font-bold text-white mb-1">Build</div>
                                    <ul className="list-disc pl-5 space-y-1">
                                        <li>Select an item group in the bottom toolbar, then click a grid tile to place.</li>
                                        <li>Use Rotate on selected items to change direction or cycle cobot mount slots.</li>
                                        <li>Stop pauses with reset confirmation; Play resumes simulation.</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {showPartCreator && (
                    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="w-[min(980px,96vw)] max-h-[90vh] rounded-xl border border-cyan-700/40 bg-slate-950 text-slate-100 shadow-2xl flex flex-col overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-black tracking-wide text-cyan-200">PART CREATOR</div>
                                    <div className="text-[11px] text-slate-400">Templates for sender spawn. Full CRUD + clone.</div>
                                </div>
                                <button onClick={() => setShowPartCreator(false)} className="p-1 rounded hover:bg-slate-800 text-slate-300">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] min-h-0 flex-1 overflow-hidden">
                                <div className="border-r border-slate-800 p-3 flex flex-col gap-2 min-h-0">
                                    <div className="grid grid-cols-3 gap-1">
                                        <button onClick={createTemplate} className="rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 text-[11px] font-bold py-1 hover:bg-emerald-500/25">NEW</button>
                                        <button onClick={cloneActiveTemplate} disabled={!activeTemplate} className="rounded border border-blue-500/40 bg-blue-500/15 text-blue-200 text-[11px] font-bold py-1 hover:bg-blue-500/25 disabled:opacity-40">CLONE</button>
                                        <button onClick={removeActiveTemplate} disabled={!activeTemplate || partTemplates.length <= 1} className="rounded border border-red-500/40 bg-red-500/15 text-red-200 text-[11px] font-bold py-1 hover:bg-red-500/25 disabled:opacity-40">DELETE</button>
                                    </div>
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-1">Templates</div>
                                    <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
                                        {partTemplates.map(tpl => {
                                            const active = tpl.id === activeTemplateId;
                                            return (
                                                <button
                                                    key={tpl.id}
                                                    onClick={() => setActiveTemplateId(tpl.id)}
                                                    className={`text-left rounded border px-2 py-1.5 transition-colors flex items-center gap-2 ${active ? 'border-cyan-500 bg-cyan-500/15' : 'border-slate-800 bg-slate-900 hover:bg-slate-800'}`}
                                                >
                                                    <span className="w-3 h-3 rounded-full shrink-0 border border-white/20" style={{ backgroundColor: tpl.color }} />
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-bold truncate">{tpl.name}</div>
                                                        <div className="text-[10px] text-slate-400 uppercase">{tpl.shape} Â· {tpl.size}</div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="p-4 overflow-y-auto flex flex-col gap-4">
                                    {activeTemplate ? (
                                        <>
                                            {/* â”€â”€â”€ Row: 3-D preview + name/shape â”€â”€â”€ */}
                                            <div className="flex gap-4 items-start">
                                                <div className="shrink-0 rounded-xl overflow-hidden border border-slate-700 bg-[#0d1017]">
                                                    <PartPreview3D template={activeTemplate} width={160} height={130} />
                                                </div>
                                                <div className="flex flex-col gap-3 flex-1 min-w-0">
                                                    <label className="flex flex-col gap-1">
                                                        <span className="text-[11px] font-bold text-slate-400 uppercase">Name</span>
                                                        <input
                                                            value={activeTemplate.name}
                                                            onChange={(e) => patchActiveTemplate({ name: e.target.value })}
                                                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm outline-none focus:border-cyan-500"
                                                        />
                                                    </label>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[11px] font-bold text-slate-400 uppercase">Shape</span>
                                                        <div className="grid grid-cols-2 gap-1.5">
                                                            {PART_SHAPES.map(shape => (
                                                                <button
                                                                    key={shape}
                                                                    onClick={() => patchActiveTemplate({ shape })}
                                                                    className={`rounded border px-2 py-1 text-[11px] font-bold uppercase ${activeTemplate.shape === shape ? 'border-cyan-500 bg-cyan-500/15 text-cyan-100' : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
                                                                >
                                                                    {shape}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* â”€â”€â”€ Default / spawn colors â”€â”€â”€ */}
                                            <div className="flex flex-col gap-1.5">
                                                <span className="text-[11px] font-bold text-slate-400 uppercase">Spawn Colors <span className="text-slate-600 normal-case font-normal">(check multiple for random)</span></span>
                                                <div className="grid grid-cols-6 gap-1.5">
                                                    {PART_COLORS.map(c => {
                                                        const inMulti = (activeTemplate.spawnColors ?? []).includes(c.value);
                                                        const isDefault = activeTemplate.color === c.value;
                                                        return (
                                                            <button
                                                                key={c.value}
                                                                title={c.label}
                                                                onClick={() => {
                                                                    if (activeTemplate.color !== c.value) {
                                                                        patchActiveTemplate({ color: c.value });
                                                                    } else {
                                                                        const cur = activeTemplate.spawnColors ?? [];
                                                                        const next = inMulti ? cur.filter(x => x !== c.value) : [...cur, c.value];
                                                                        patchActiveTemplate({ spawnColors: next });
                                                                    }
                                                                }}
                                                                onContextMenu={(e) => {
                                                                    e.preventDefault();
                                                                    const cur = activeTemplate.spawnColors ?? [];
                                                                    const next = inMulti ? cur.filter(x => x !== c.value) : [...cur, c.value];
                                                                    patchActiveTemplate({ spawnColors: next });
                                                                }}
                                                                className={`h-9 rounded-lg border-2 relative transition-all ${isDefault ? 'border-white scale-110' : inMulti ? 'border-cyan-400' : 'border-slate-700 hover:border-slate-400'}`}
                                                                style={{ backgroundColor: c.value }}
                                                            >
                                                                {inMulti && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-cyan-400 border border-slate-900" />}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <input type="color" value={activeTemplate.color} onChange={(e) => patchActiveTemplate({ color: e.target.value })} className="h-7 w-9 rounded border border-slate-700 bg-slate-900 p-0.5 cursor-pointer" />
                                                    <input value={activeTemplate.color} onChange={(e) => patchActiveTemplate({ color: e.target.value })} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono w-24 outline-none focus:border-cyan-500" />
                                                    <span className="text-[10px] text-slate-500">Click=default Â· Click again=add to random pool</span>
                                                </div>
                                            </div>

                                            {/* â”€â”€â”€ Spawn sizes (multi) â”€â”€â”€ */}
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[11px] font-bold text-slate-400 uppercase">Spawn Sizes <span className="text-slate-600 normal-case font-normal">(check multiple for random)</span></span>
                                                <div className="flex gap-2">
                                                    {PICK_SIZES.map(size => {
                                                        const isDefault = activeTemplate.size === size;
                                                        const inMulti = (activeTemplate.spawnSizes ?? []).includes(size);
                                                        return (
                                                            <button
                                                                key={size}
                                                                onClick={() => {
                                                                    if (activeTemplate.size !== size) {
                                                                        patchActiveTemplate({ size });
                                                                    } else {
                                                                        const cur = activeTemplate.spawnSizes ?? [];
                                                                        patchActiveTemplate({ spawnSizes: inMulti ? cur.filter(x => x !== size) : [...cur, size] });
                                                                    }
                                                                }}
                                                                onContextMenu={(e) => {
                                                                    e.preventDefault();
                                                                    const cur = activeTemplate.spawnSizes ?? [];
                                                                    patchActiveTemplate({ spawnSizes: inMulti ? cur.filter(x => x !== size) : [...cur, size] });
                                                                }}
                                                                className={`flex-1 rounded border px-2 py-1.5 text-[11px] font-bold uppercase relative ${isDefault ? 'border-cyan-500 bg-cyan-500/15 text-cyan-100' : inMulti ? 'border-cyan-700 bg-cyan-900/20 text-cyan-300' : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
                                                            >
                                                                {size}
                                                                {inMulti && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                <p className="text-[10px] text-slate-500">Click=default Â· Click again=add to random pool</p>
                                            </div>

                                            {/* â”€â”€â”€ Fine-tune sliders â”€â”€â”€ */}
                                            <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fine-Tune Geometry</span>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <label className="flex flex-col gap-1">
                                                        <div className="flex justify-between text-[10px] font-bold text-slate-500">
                                                            <span>RADIUS SCALE</span>
                                                            <span className="text-cyan-400 font-mono">{(activeTemplate.radiusScale ?? 1).toFixed(2)}Ã—</span>
                                                        </div>
                                                        <input type="range" min="0.2" max="10" step="0.05" value={activeTemplate.radiusScale ?? 1} onChange={e => patchActiveTemplate({ radiusScale: parseFloat(e.target.value) })} className="w-full cursor-pointer accent-cyan-500" />
                                                    </label>
                                                    <label className="flex flex-col gap-1">
                                                        <div className="flex justify-between text-[10px] font-bold text-slate-500">
                                                            <span>HEIGHT SCALE</span>
                                                            <span className="text-cyan-400 font-mono">{(activeTemplate.heightScale ?? 1).toFixed(2)}Ã—</span>
                                                        </div>
                                                        <input type="range" min="0.1" max="10" step="0.05" value={activeTemplate.heightScale ?? 1} onChange={e => patchActiveTemplate({ heightScale: parseFloat(e.target.value) })} className="w-full cursor-pointer accent-cyan-500" />
                                                    </label>
                                                </div>

                                                {activeTemplate.shape === 'disc' && (
                                                    <>
                                                        <div className="grid grid-cols-2 gap-3 mt-1">
                                                            <label className="flex flex-col gap-1">
                                                                <div className="flex justify-between text-[10px] font-bold text-slate-500">
                                                                    <span>RING HOLES</span>
                                                                    <span className="text-cyan-400 font-mono">{activeTemplate.numHoles ?? 0}</span>
                                                                </div>
                                                                <input type="range" min="0" max="8" step="1" value={activeTemplate.numHoles ?? 0} onChange={e => patchActiveTemplate({ numHoles: parseInt(e.target.value) })} className="w-full cursor-pointer accent-cyan-500" />
                                                            </label>
                                                            <label className="flex flex-col gap-1">
                                                                <div className="flex justify-between text-[10px] font-bold text-slate-500">
                                                                    <span>HOLE SIZE</span>
                                                                    <span className="text-cyan-400 font-mono">{(activeTemplate.holeDiameter ?? 0.1).toFixed(2)}</span>
                                                                </div>
                                                                <input type="range" min="0.04" max="0.35" step="0.01" value={activeTemplate.holeDiameter ?? 0.1} onChange={e => patchActiveTemplate({ holeDiameter: parseFloat(e.target.value) })} className="w-full cursor-pointer accent-cyan-500" />
                                                            </label>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 mt-1">
                                                            <label className="flex items-center justify-between rounded border border-slate-700 bg-slate-950 px-3 py-1.5">
                                                                <span className="text-[11px] font-bold text-slate-300 uppercase">Center Hole</span>
                                                                <input type="checkbox" checked={activeTemplate.hasCenterHole !== false} onChange={(e) => patchActiveTemplate({ hasCenterHole: e.target.checked })} className="accent-cyan-500" />
                                                            </label>
                                                            <label className="flex items-center justify-between rounded border border-slate-700 bg-slate-950 px-3 py-1.5">
                                                                <span className="text-[11px] font-bold text-slate-300 uppercase">Index Hole</span>
                                                                <input type="checkbox" checked={activeTemplate.hasIndexHole !== false} onChange={(e) => patchActiveTemplate({ hasIndexHole: e.target.checked })} className="accent-cyan-500" />
                                                            </label>
                                                        </div>
                                                    </>
                                                )}

                                                {activeTemplate.shape === 'box' && (
                                                    <div className="grid grid-cols-2 gap-3 mt-1">
                                                        <label className="flex flex-col gap-1">
                                                            <div className="flex justify-between text-[10px] font-bold text-slate-500">
                                                                <span>BOX WIDTH</span>
                                                                <span className="text-cyan-400 font-mono">{(activeTemplate.scaleX ?? 1).toFixed(2)}Ã—</span>
                                                            </div>
                                                            <input type="range" min="0.3" max="2.5" step="0.05" value={activeTemplate.scaleX ?? 1} onChange={e => patchActiveTemplate({ scaleX: parseFloat(e.target.value) })} className="w-full cursor-pointer accent-cyan-500" />
                                                        </label>
                                                        <label className="flex flex-col gap-1">
                                                            <div className="flex justify-between text-[10px] font-bold text-slate-500">
                                                                <span>BOX DEPTH</span>
                                                                <span className="text-cyan-400 font-mono">{(activeTemplate.scaleZ ?? 1).toFixed(2)}Ã—</span>
                                                            </div>
                                                            <input type="range" min="0.3" max="2.5" step="0.05" value={activeTemplate.scaleZ ?? 1} onChange={e => patchActiveTemplate({ scaleZ: parseFloat(e.target.value) })} className="w-full cursor-pointer accent-cyan-500" />
                                                        </label>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-sm text-slate-400">No template selected.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const BuildButton: React.FC<{title: string, cost: number, isActive: boolean, onClick: () => void, disabled: boolean, color?: string}> = ({title, cost, isActive, onClick, disabled, color}) => (
    <button 
        onClick={onClick}
        disabled={disabled}
        className={`px-6 py-3 rounded-xl flex flex-col items-center justify-center transition-all min-w-[120px]
            ${isActive 
                ? color === 'amber' ? 'bg-amber-500/20 border-2 border-amber-500 shadow-inner' : 'bg-blue-500/20 border-2 border-blue-500 shadow-inner'
                : 'bg-transparent border-2 border-transparent hover:bg-gray-800'}
            ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        `}
    >
        <span className={`font-black text-sm ${isActive ? (color === 'amber' ? 'text-amber-400' : 'text-blue-400') : 'text-gray-200'}`}>{title}</span>
        <span className="text-xs font-mono text-gray-500 mt-1">{cost} CR</span>
    </button>
);


