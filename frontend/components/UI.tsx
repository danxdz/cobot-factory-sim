import React, { useEffect, useState } from 'react';
import { Play, Square, Pause, Trash2, Settings2, X, RotateCw, Cpu, MapPin, Plus, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Camera, Menu, Download, Upload } from 'lucide-react';
import { useFactoryStore } from '../store';
import { ITEM_COSTS, ItemType, Direction, PartSize, ProgramAction, ProgramStep } from '../types';
import { simState } from '../simState';

const PICK_COLORS = [
    { label: 'Red', value: '#ef4444' },
    { label: 'Blue', value: '#3b82f6' },
    { label: 'Green', value: '#10b981' },
    { label: 'Yellow', value: '#f59e0b' },
];
const PICK_SIZES: PartSize[] = ['small', 'medium', 'large'];
const PROGRAM_ACTIONS: ProgramAction[] = ['move', 'pick', 'drop', 'wait'];
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

export const UI: React.FC = () => {
    const [showVisionConfig, setShowVisionConfig] = useState(false);
    const [showController, setShowController] = useState(false);
    const [showMainOptions, setShowMainOptions] = useState(true);
    const [snapInputs, setSnapInputs] = useState(true);
    const [editingName, setEditingName] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [activeGroup, setActiveGroup] = useState<string | null>(null);
    const [playClicks, setPlayClicks] = useState({ count: 0, time: 0 });
    const { 
        credits, 
        score,
        isRunning,
        setIsRunning,
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
        setSimSpeedMult
    } = useFactoryStore();

    const selectedItem = placedItems.find(i => i.id === selectedItemId);
    const layoutConfigTypes: ItemType[] = ['belt', 'table', 'cobot', 'sender', 'receiver', 'indexed_receiver', 'pile'];
    const moduleConfigTypes: ItemType[] = ['sender', 'receiver', 'indexed_receiver', 'pile'];
    const cameras = placedItems.filter(i => i.type === 'camera');
    const selectedMachineState = selectedItem ? machineStates[selectedItem.id] : undefined;
    const selectedLabel = selectedItem?.name || selectedItem?.id || '';
    const teachMinimized = !!teachAction && selectedItem?.type === 'cobot';

    useEffect(() => {
        setEditingName(false);
        setDraftName(selectedItem?.name || selectedItem?.id || '');
        if (teachAction && selectedItem?.type === 'cobot') {
            setShowVisionConfig(false);
            setShowController(false);
        }
    }, [selectedItemId, selectedItem?.name, selectedItem?.id, selectedItem?.type, teachAction]);
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
        setIsRunning(!isRunning);
        const now = Date.now();
        if (now - playClicks.time < 500) {
            const newCount = playClicks.count + 1;
            if (newCount >= 4) { // 5th click (0-4)
                useFactoryStore.getState().setCredits(credits + 10000);
                setPlayClicks({ count: 0, time: 0 });
            } else {
                setPlayClicks({ count: newCount, time: now });
            }
        } else {
            setPlayClicks({ count: 1, time: now });
        }
    };

    const handleStopClick = () => {
        setIsRunning(false);
        simState.reset();
        useFactoryStore.getState().placedItems.forEach(item => {
            if (item.type === 'cobot') {
                updatePlacedItem(item.id, { config: { ...item.config, isStopped: false } });
            }
        });
    };

    const handleBuildClick = (type: ItemType) => {
        setBuildMode(buildMode === type ? null : type);
    };

    const handleSellSelected = () => {
        if (selectedItem) {
            removePlacedItem(selectedItem.id);
            setCredits(credits + ITEM_COSTS[selectedItem.type]); 
        }
    };

    const handleRotateSelected = () => {
        if (selectedItem) {
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
            updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, program: [] } });
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
            : { action, pos: [...lastPos] as [number, number, number] };
        updateProgram([...current, nextStep]);
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

    const setCobotOverlay = (patch: { showTeachPoints?: boolean; showArmRange?: boolean }) => {
        if (!selectedItem) return;
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, ...patch } });
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

    const unlockSelectedCobot = () => {
        if (!selectedItem || selectedItem.type !== 'cobot') return;
        updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, collisionStopped: false } });
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


    const renderModuleLayoutControls = () => {
        if (!selectedItem || !moduleConfigTypes.includes(selectedItem.type)) return null;
        return (
            <div className="flex flex-col gap-3 w-full">
                <div className="grid grid-cols-3 gap-3">
                    <RangeSlider label="POS X" min={-10} max={10} step={snapStep} value={selectedItem.position[0]} onChange={(v) => patchSelectedPosition(0, v)} />
                    <RangeSlider label="POS Y" min={0} max={5} step={heightStep} value={selectedItem.position[1]} onChange={(v) => patchSelectedPosition(1, v)} />
                    <RangeSlider label="POS Z" min={-10} max={10} step={snapStep} value={selectedItem.position[2]} onChange={(v) => patchSelectedPosition(2, v)} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                    <RangeSlider label="WIDTH" min={0.5} max={4} step={snapStep} value={selectedItem.config?.machineSize?.[0] || 2} onChange={(v) => patchMachineSize(0, v)} />
                    <RangeSlider label="DEPTH" min={0.5} max={4} step={snapStep} value={selectedItem.config?.machineSize?.[1] || 2} onChange={(v) => patchMachineSize(1, v)} />
                    <RangeSlider label="HEIGHT" min={0.1} max={1.5} step={heightStep} value={selectedItem.config?.machineHeight || (selectedItem.type === 'pile' ? 0.7 : 0.538)} onChange={(v) => patchMachineHeight(v)} />
                </div>
                {selectedItem.type === 'pile' && (
                    <div className="flex flex-col gap-3 mt-1">
                        <div className="grid grid-cols-2 gap-3">
                            <RangeSlider label="GRID W" min={1} max={6} step={1} value={selectedItem.config?.tableGrid?.[0] || 2} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, tableGrid: [v, selectedItem.config?.tableGrid?.[1] || 2] } })} />
                            <RangeSlider label="GRID D" min={1} max={6} step={1} value={selectedItem.config?.tableGrid?.[1] || 2} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, tableGrid: [selectedItem.config?.tableGrid?.[0] || 2, v] } })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3 items-end">
                            <RangeSlider label="STARTING ITEMS" min={0} max={24} step={1} value={selectedItem.config?.pileCount ?? 0} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, pileCount: v } })} />
                            <label className="flex items-center justify-between rounded border border-gray-700 bg-gray-900/40 px-3 py-1.5 h-[34px]">
                                <span className="text-[10px] font-bold text-gray-500">SHOW WALLS</span>
                                <input
                                    type="checkbox"
                                    checked={selectedItem.config?.showWalls !== false}
                                    onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, showWalls: e.target.checked } })}
                                    className="accent-[#38bdf8]"
                                />
                            </label>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
            {/* Top Bar */}
            <div className="flex justify-between items-start">
                <div className="flex flex-col gap-4 pointer-events-auto">
                    <div>
                        <h1 className="text-4xl font-display font-black text-blue-400 tracking-tight drop-shadow-md">
                            COBOT FACTORY
                        </h1>
                        <p className="text-gray-400 font-mono text-sm mt-1">Simulation Sandbox</p>
                    </div>
                </div>

                <div className="flex flex-col gap-2 pointer-events-auto items-end">
                    <label className="bg-gray-900/90 backdrop-blur-md rounded-xl px-4 py-2 shadow-xl border border-gray-700 flex items-center justify-between gap-3 cursor-pointer hover:bg-gray-800 transition-colors">
                        <span className="text-[10px] font-bold text-gray-400">SNAP 0.5 GRID</span>
                        <input
                            type="checkbox"
                            checked={snapInputs}
                            onChange={(e) => setSnapInputs(e.target.checked)}
                            className="rounded border-gray-600 bg-gray-800"
                        />
                    </label>
                    <div className="flex gap-2">
                        <div className="bg-gray-900/90 backdrop-blur-md rounded-xl px-6 py-3 shadow-xl border border-gray-700 flex items-center gap-4">
                        <div className="bg-emerald-500/20 text-emerald-400 rounded-md w-8 h-8 flex items-center justify-center font-bold text-lg">
                            ★
                        </div>
                        <div>
                            <div className="text-[10px] font-bold text-gray-500 tracking-widest uppercase">Score</div>
                            <div className="text-2xl font-black text-white leading-none">{score}</div>
                        </div>
                    </div>
                    <div className="bg-gray-900/90 backdrop-blur-md rounded-xl px-6 py-3 shadow-xl border border-gray-700 flex items-center gap-4">
                        <div className="bg-blue-500/20 text-blue-400 rounded-md w-8 h-8 flex items-center justify-center font-bold text-lg">
                            $
                        </div>
                        <div>
                            <div className="text-[10px] font-bold text-gray-500 tracking-widest uppercase">Credits</div>
                            <div className="text-2xl font-black text-white leading-none">{credits}</div>
                        </div>
                    </div>
                </div>
            </div>
            </div>

            {/* Bottom Area */}
            <div className="flex flex-col items-center gap-4 pointer-events-auto">
                
                {selectedItem ? (
                    /* SELECTION PANEL */
                    <div className={`bg-gray-900/95 backdrop-blur-md rounded-xl shadow-2xl border p-2 flex flex-col gap-1.5 w-[min(540px,calc(100vw-48px))] max-h-[85vh] overflow-y-auto animate-fade-in ${statusTone.panel}`}>
                        <div className="flex justify-between items-center border-b border-gray-700 pb-1.5">
                            <div className="flex min-w-0 items-center gap-2 text-yellow-400 font-black tracking-wider">
                                <Settings2 size={18} className="shrink-0" />
                                <span className="text-sm shrink-0">{selectedItem.type.toUpperCase()}</span>
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
                                    <button 
                                        onClick={() => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, isStopped: !selectedItem.config?.isStopped } })}
                                        className={`rounded-md p-1 transition-colors ${selectedItem.config?.isStopped ? 'text-red-400 hover:bg-red-500/20' : 'text-emerald-400 hover:bg-emerald-500/20'}`}
                                        title={selectedItem.config?.isStopped ? "Resume Cobot" : "Stop Cobot"}
                                    >
                                        {selectedItem.config?.isStopped ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                                    </button>
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

                        <div className="flex items-start justify-between gap-6">
                            {/* Specific Configs */}
                            <div className="flex flex-col gap-1.5 flex-1">
                                <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden flex flex-col gap-1.5 px-2 pb-2">
                                    <div className="pt-2 flex flex-col gap-1.5 w-full">
                                        {!teachMinimized && renderModuleLayoutControls()}
                                {selectedItem.type === 'sender' && !teachMinimized && (
                                    <div className="flex flex-col gap-2 w-full">
                                        <div className="flex justify-between">
                                            <span className="text-xs font-bold text-gray-500">SPAWN INTERVAL</span>
                                            <span className="text-xs font-bold text-blue-400">{selectedItem.config?.speed || 3}s</span>
                                        </div>
                                        <input 
                                            type="range" min="0.5" max="5" step="0.5" 
                                            value={selectedItem.config?.speed || 3} 
                                            onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, speed: parseFloat(e.target.value) } })} 
                                        />
                                        <div className="flex justify-between mt-2">
                                            <span className="text-xs font-bold text-gray-500">ITEM COLOR</span>
                                        </div>
                                        <select 
                                            className="bg-gray-800 text-white text-sm rounded p-1 border border-gray-600 outline-none"
                                            value={selectedItem.config?.spawnColor || 'any'}
                                            onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, spawnColor: e.target.value } })}
                                        >
                                            <option value="any">Any Color (Random)</option>
                                            <option value="#ef4444">Red</option>
                                            <option value="#3b82f6">Blue</option>
                                            <option value="#10b981">Green</option>
                                            <option value="#f59e0b">Yellow</option>
                                        </select>
                                        <div className="flex justify-between mt-2">
                                            <span className="text-xs font-bold text-gray-500">ITEM SIZE</span>
                                        </div>
                                        <select
                                            className="bg-gray-800 text-white text-sm rounded p-1 border border-gray-600 outline-none"
                                            value={selectedItem.config?.spawnSize || 'any'}
                                            onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, spawnSize: e.target.value as PartSize | 'any' } })}
                                        >
                                            <option value="any">Any Size (Random)</option>
                                            <option value="small">Small</option>
                                            <option value="medium">Medium</option>
                                            <option value="large">Large</option>
                                        </select>
                                    </div>
                                )}
                                {selectedItem.type === 'belt' && !teachMinimized && (
                                    <div className="flex flex-col gap-3 w-full">
                                        <RangeSlider label="BELT SPEED" min={0.5} max={5} step={0.5} value={selectedItem.config?.speed || 2} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, speed: v } })} />
                                        <div className="grid grid-cols-3 gap-3">
                                            <RangeSlider label="POS X" min={-10} max={10} step={snapStep} value={selectedItem.position[0]} onChange={(v) => patchSelectedPosition(0, v)} />
                                            <RangeSlider label="POS Y" min={0} max={5} step={heightStep} value={selectedItem.position[1]} onChange={(v) => patchSelectedPosition(1, v)} />
                                            <RangeSlider label="POS Z" min={-10} max={10} step={snapStep} value={selectedItem.position[2]} onChange={(v) => patchSelectedPosition(2, v)} />
                                        </div>
                                        <div className="grid grid-cols-3 gap-3">
                                            <RangeSlider label="WIDTH" min={0.5} max={4} step={snapStep} value={selectedItem.config?.beltSize?.[0] || 2} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, beltSize: [Math.max(0.5, snapValue(v, snapStep)), selectedItem.config?.beltSize?.[1] || 2] } })} />
                                            <RangeSlider label="DEPTH" min={0.5} max={4} step={snapStep} value={selectedItem.config?.beltSize?.[1] || 2} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, beltSize: [selectedItem.config?.beltSize?.[0] || 2, Math.max(0.5, snapValue(v, snapStep))] } })} />
                                            <RangeSlider label="HEIGHT" min={0.25} max={1.5} step={heightStep} value={selectedItem.config?.beltHeight || 0.538} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, beltHeight: snapValue(v, heightStep) } })} />
                                        </div>
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
                                        <div className="grid grid-cols-3 gap-3">
                                            <RangeSlider label="POS X" min={-10} max={10} step={snapStep} value={selectedItem.position[0]} onChange={(v) => patchSelectedPosition(0, v)} />
                                            <RangeSlider label="POS Y" min={0} max={5} step={heightStep} value={selectedItem.position[1]} onChange={(v) => patchSelectedPosition(1, v)} />
                                            <RangeSlider label="POS Z" min={-10} max={10} step={snapStep} value={selectedItem.position[2]} onChange={(v) => patchSelectedPosition(2, v)} />
                                        </div>
                                        <div className="grid grid-cols-3 gap-3 mt-2">
                                            <RangeSlider label="WIDTH" min={0.5} max={3.5} step={snapStep} value={selectedItem.config?.tableSize?.[0] || 1.8} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, tableSize: [Math.max(0.5, snapValue(v, snapStep)), selectedItem.config?.tableSize?.[1] || 1.8] } })} />
                                            <RangeSlider label="DEPTH" min={0.5} max={3.5} step={snapStep} value={selectedItem.config?.tableSize?.[1] || 1.8} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, tableSize: [selectedItem.config?.tableSize?.[0] || 1.8, Math.max(0.5, snapValue(v, snapStep))] } })} />
                                            <RangeSlider label="HEIGHT" min={0.25} max={1.2} step={heightStep} value={selectedItem.config?.tableHeight || 0.45} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, tableHeight: snapValue(v, heightStep) } })} />
                                        </div>
                                        <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end mt-2">
                                            <RangeSlider label="GRID W" min={1} max={6} step={1} value={selectedItem.config?.tableGrid?.[0] || 2} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, tableGrid: [v, selectedItem.config?.tableGrid?.[1] || 2] } })} />
                                            <RangeSlider label="GRID D" min={1} max={6} step={1} value={selectedItem.config?.tableGrid?.[1] || 2} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, tableGrid: [selectedItem.config?.tableGrid?.[0] || 2, v] } })} />
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
                                                                <span className="text-red-400 text-[10px] font-bold block mb-1">⚠️ SAFETY STOP ENGAGED</span>
                                                                <button 
                                                                    onClick={unlockSelectedCobot}
                                                                    className="w-full bg-red-600 hover:bg-red-500 text-white rounded py-1 text-[10px] font-bold"
                                                                >
                                                                    UNLOCK COBOT
                                                                </button>
                                                            </div>
                                                        )}
                                                        <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden mb-2 mt-1">
                                                            <button
                                                                onClick={() => setShowTransforms(v => !v)}
                                                                className="w-full flex items-center justify-between px-2 py-1.5 text-left"
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <Menu size={14} className="text-pink-400" />
                                                                    <span className="text-[10px] text-gray-300 font-bold">TRANSFORM & KINEMATICS</span>
                                                                </div>
                                                                {showTransforms ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                                                            </button>
                                                            {showTransforms && (
                                                                <div className="px-2 pb-2 border-t border-gray-700 flex flex-col gap-1.5 pt-2">
                                                                    <div className="grid grid-cols-3 gap-3">
                                                                        <RangeSlider label="POS X" min={-10} max={10} step={snapStep} value={selectedItem.position[0]} onChange={(v) => patchSelectedPosition(0, v)} />
                                                                        <RangeSlider label="POS Y" min={0} max={5} step={heightStep} value={selectedItem.position[1]} onChange={(v) => patchSelectedPosition(1, v)} />
                                                                        <RangeSlider label="POS Z" min={-10} max={10} step={snapStep} value={selectedItem.position[2]} onChange={(v) => patchSelectedPosition(2, v)} />
                                                                    </div>
                                                                    <RangeSlider label="ARM SPEED" min={0.5} max={3} step={0.1} value={selectedItem.config?.speed || 1} onChange={(v) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, speed: v } })} />

                                                                    <div className="flex gap-2 w-full mt-1">
                                                                        <div className="flex flex-col gap-0.5 w-1/2">
                                                                            <span className="text-[9px] font-bold text-gray-500">STACK GRID (WxD)</span>
                                                                            <div className="flex items-center gap-1">
                                                                                <input type="number" min="1" max="4" value={selectedItem.config?.stackMatrix?.[0] || 2} onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, stackMatrix: [parseInt(e.target.value) || 1, selectedItem.config?.stackMatrix?.[1] || 2] } })} className="bg-gray-800 text-white text-[10px] rounded px-1.5 py-0.5 border border-gray-600 outline-none w-full" />
                                                                                <span className="text-gray-500 text-[10px]">x</span>
                                                                                <input type="number" min="1" max="4" value={selectedItem.config?.stackMatrix?.[1] || 2} onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, stackMatrix: [selectedItem.config?.stackMatrix?.[0] || 2, parseInt(e.target.value) || 1] } })} className="bg-gray-800 text-white text-[10px] rounded px-1.5 py-0.5 border border-gray-600 outline-none w-full" />
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
                                        <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
                                            <button
                                                onClick={() => setShowVisionConfig(v => !v)}
                                                className="w-full flex items-center justify-between px-2 py-1.5 text-left"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Camera size={14} className="text-cyan-300" />
                                                    <span className="text-[10px] text-gray-300 font-bold">VISION & CAMERA LINKS</span>
                                                </div>
                                                {showVisionConfig ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                                            </button>
                                            {showVisionConfig && (
                                                <div className="px-2 pb-2 flex flex-col gap-2 border-t border-gray-700">
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
                                        <div className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
                                            <button
                                                onClick={() => setShowController(v => !v)}
                                                className="w-full flex items-center justify-between px-2 py-1.5 text-left"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Cpu size={14} className="text-emerald-400" />
                                                    <span className="text-[10px] text-gray-300 font-bold">ROBOT CONTROLLER</span>
                                                </div>
                                                {showController ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                                            </button>
                                            {showController && (
                                                <div className="px-2 pb-2 border-t border-gray-700 flex flex-col gap-1.5">
                                                    <div className="pt-2 flex items-center justify-between">
                                                        <div className="flex flex-wrap gap-1">
                                                            {PROGRAM_ACTIONS.map(action => (
                                                                <button
                                                                    key={action}
                                                                    onClick={() => addProgramStep(action)}
                                                                    className="px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-[9px] font-bold uppercase text-gray-200"
                                                                >
                                                                    + {action}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <button onClick={handleClearProgram} className="text-[10px] text-red-400 hover:text-red-300">Clear</button>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-1 mb-1">
                                                        <label className="col-span-2 flex items-center justify-between rounded border border-gray-700 bg-gray-900/40 px-2 py-1">
                                                            <div className="flex flex-col">
                                                                <span className="text-[9px] font-bold text-gray-500">IDLE AUTO-ORGANIZE</span>
                                                                <span className="text-[8px] text-gray-600">Sort nearby items into matching slots when idle</span>
                                                            </div>
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedItem.config?.autoOrganize === true}
                                                                onChange={(e) => updatePlacedItem(selectedItem.id, { config: { ...selectedItem.config, autoOrganize: e.target.checked } })}
                                                            />
                                                        </label>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-1">
                                                        <label className="flex items-center justify-between rounded border border-gray-700 bg-gray-900/40 px-2 py-1">
                                                            <span className="text-[9px] font-bold text-gray-500">POINT BALLS</span>
                                                            <input
                                                                type="checkbox"
                                                                checked={(selectedItem.config?.showTeachPoints ?? selectedItem.config?.showTeachZones ?? true) !== false}
                                                                onChange={(e) => setCobotOverlay({ showTeachPoints: e.target.checked })}
                                                            />
                                                        </label>
                                                        <label className="flex items-center justify-between rounded border border-gray-700 bg-gray-900/40 px-2 py-1">
                                                            <span className="text-[9px] font-bold text-gray-500">ARM RANGE</span>
                                                            <input
                                                                type="checkbox"
                                                                checked={(selectedItem.config?.showArmRange ?? selectedItem.config?.showTeachZones ?? true) !== false}
                                                                onChange={(e) => setCobotOverlay({ showArmRange: e.target.checked })}
                                                            />
                                                        </label>
                                                    </div>

                                                    <div className="flex flex-col gap-1 mb-1 max-h-[220px] overflow-y-auto pr-1">
                                                        {selectedItem.config?.program?.map((step, idx) => (
                                                            <div key={idx} className="rounded border border-gray-700 bg-gray-900/50 p-1 flex flex-col gap-1">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-[9px] font-mono text-gray-500 w-4">{idx + 1}</span>
                                                                    <select
                                                                        className="bg-gray-800 text-white text-[10px] rounded px-1 py-0.5 border border-gray-600 outline-none"
                                                                        value={step.action}
                                                                        onChange={(e) => patchProgramStep(idx, e.target.value === 'wait'
                                                                            ? { action: e.target.value as ProgramAction, pos: undefined, duration: step.duration ?? 0.4 }
                                                                            : { action: e.target.value as ProgramAction, pos: step.pos ?? [selectedItem.position[0], 0.56, selectedItem.position[2]], duration: undefined })}
                                                                    >
                                                                        {PROGRAM_ACTIONS.map(action => <option key={action} value={action}>{action.toUpperCase()}</option>)}
                                                                    </select>
                                                                    <button onClick={() => moveProgramStep(idx, -1)} className="p-0.5 rounded bg-gray-800 text-gray-300 hover:text-white"><ArrowUp size={12} /></button>
                                                                    <button onClick={() => moveProgramStep(idx, 1)} className="p-0.5 rounded bg-gray-800 text-gray-300 hover:text-white"><ArrowDown size={12} /></button>
                                                                    <button onClick={() => removeProgramStep(idx)} className="ml-auto p-0.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash2 size={12} /></button>
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
                                                                        {step.action === 'drop' && (
                                                                            <div className="flex items-center gap-4 px-1 pb-1">
                                                                                <span className="text-[9px] font-bold text-gray-500">ORGANIZE BY:</span>
                                                                                <label className="flex items-center gap-1 cursor-pointer">
                                                                                    <input type="checkbox" className="w-3 h-3 accent-[#38bdf8]" checked={step.sortColor !== false} onChange={(e) => patchProgramStep(idx, { sortColor: e.target.checked })} />
                                                                                    <span className="text-[9px] font-bold text-gray-400">COLOR</span>
                                                                                </label>
                                                                                <label className="flex items-center gap-1 cursor-pointer">
                                                                                    <input type="checkbox" className="w-3 h-3 accent-[#38bdf8]" checked={step.sortSize !== false} onChange={(e) => patchProgramStep(idx, { sortSize: e.target.checked })} />
                                                                                    <span className="text-[9px] font-bold text-gray-400">SIZE</span>
                                                                                </label>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                        {(!selectedItem.config?.program || selectedItem.config.program.length === 0) && (
                                                            <span className="text-xs text-gray-500 italic">No controller steps yet. Add move, pick, drop, or wait actions.</span>
                                                        )}
                                                    </div>

                                                    <div className="flex gap-2">
                                                        <button 
                                                            onClick={() => setTeachAction(teachAction === 'pick' ? null : 'pick')}
                                                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-bold transition-colors
                                                                ${teachAction === 'pick' ? 'bg-emerald-500 text-white animate-pulse' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                                                        >
                                                            <Plus size={14} /> TEACH PICK
                                                        </button>
                                                        <button 
                                                            onClick={() => setTeachAction(teachAction === 'drop' ? null : 'drop')}
                                                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-bold transition-colors
                                                                ${teachAction === 'drop' ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                                                        >
                                                            <Plus size={14} /> TEACH DROP
                                                        </button>
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
                                        <div className="h-24 rounded bg-gray-950/70 border border-gray-800 p-2 flex items-end gap-2">
                                            {simState.cameraDetections.filter(det => det.cameraId === selectedItem.id).slice(0, 8).map(det => (
                                                <span
                                                    key={det.itemId}
                                                    className="w-6 rounded-sm border border-black/20"
                                                    style={{
                                                        height: det.size === 'large' ? '2.1rem' : det.size === 'medium' ? '1.6rem' : '1.25rem',
                                                        backgroundColor: det.color
                                                    }}
                                                />
                                            ))}
                                            {simState.cameraDetections.filter(det => det.cameraId === selectedItem.id).length === 0 && (
                                                <span className="text-[10px] text-gray-600">No parts currently in view</span>
                                            )}
                                        </div>
                                        <div className="text-[10px] text-gray-500">
                                            Linked cobots can use this camera’s live detections for filtered picking.
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
                            <div className="flex flex-col gap-2 min-w-[120px]">
                                <button 
                                    onClick={handleRotateSelected}
                                    className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-bold transition-colors"
                                >
                                    <RotateCw size={16} /> ROTATE
                                </button>
                                <button 
                                    onClick={handleSellSelected}
                                    className="flex items-center justify-center gap-2 px-4 py-3 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg text-sm font-bold transition-colors"
                                >
                                    <Trash2 size={16} /> SELL
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* BUILD MENU */
                    <>
                        {/* Hints */}
                        {buildMode ? (
                            <div className="bg-blue-500 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2 animate-bounce">
                                <span>Click grid to place</span>
                                <span className="bg-blue-600 px-2 py-0.5 rounded text-xs">Press 'R' to rotate</span>
                            </div>
                        ) : null}

                        <div className="bg-gray-900/90 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-700 p-2 flex gap-3 overflow-visible items-center">
                            
                            <div className="flex items-center gap-2 mr-2">
                                <button 
                                    onClick={handlePlayClick}
                                    className={`flex items-center justify-center p-3 rounded-xl transition-all ${isRunning ? 'bg-orange-500/20 text-orange-400 shadow-inner' : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'}`}
                                    title={isRunning ? "Pause" : "Play (Click 5 times for +10k credits)"}
                                >
                                    {isRunning ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                                </button>
                                <button 
                                    onClick={handleStopClick}
                                    className={`flex items-center justify-center p-3 rounded-xl transition-all bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white`}
                                    title="Stop & Reset Items"
                                >
                                    <Square size={20} fill="currentColor" />
                                </button>

                                <div className="flex flex-col gap-1 ml-1">
                                    <input 
                                        type="range" min="1" max="10" step="1" 
                                        value={simSpeedMult} onChange={e => setSimSpeedMult(parseInt(e.target.value))}
                                        className="w-20 accent-emerald-500 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                        title={`Speed: ${simSpeedMult}x`}
                                    />
                                    <div className="flex gap-1">
                                        <button onClick={resetFactory} className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" title="Clear Factory"><Trash2 size={12} /></button>
                                        <button onClick={() => { const inp = document.createElement('input'); inp.type='file'; inp.accept='.json'; inp.onchange = e => { const f = (e.target as HTMLInputElement).files?.[0]; if(!f)return; const r = new FileReader(); r.onload = ev => { localStorage.setItem('cobot-factory-sim-v8', ev.target?.result as string); location.reload(); }; r.readAsText(f); }; inp.click(); }} className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700" title="Import Factory"><Upload size={12} /></button>
                                        <button onClick={() => { const s = localStorage.getItem('cobot-factory-sim-v8'); if(!s)return; const b = new Blob([s],{type:'application/json'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href=u; a.download=`factory.json`; a.click(); }} className="p-1 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700" title="Export Factory"><Download size={12} /></button>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="w-px h-8 bg-gray-700"></div>

                            {/* BUILD GROUPS */}
                            <div className="flex gap-2 relative">
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
                                                <span className="text-xs">{group.label}</span>
                                                <ChevronDown size={14} className={`transition-transform ${isGroupActive ? 'rotate-180' : ''}`} />
                                            </button>
                                            
                                            {isGroupActive && (
                                                <div className="absolute bottom-full left-0 mb-2 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2 flex flex-col gap-1 w-48 animate-fade-in origin-bottom">
                                                    {group.items.map(type => (
                                                        <BuildButton 
                                                            key={type}
                                                            title={type.replace('_', ' ').toUpperCase()} 
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
