import { ITEM_COSTS } from '../types';
import type { PartTemplate, PlacedItem } from '../types';

export const FIRST_SHIFT = {
    title: 'First Shift', budget: 5500, duration: 180, interval: 4, batchSize: 24,
    orders: [
        { receiverId: 't1', templateId: 'order-red', label: 'Red discs', color: '#ef4444', shape: 'disc', quantity: 6 },
        { receiverId: 'r1', templateId: 'order-blue', label: 'Blue boxes', color: '#3b82f6', shape: 'box', quantity: 4 },
    ],
} as const;

export const challengeTemplates: PartTemplate[] = [
    { id: 'order-red', name: 'Red disc', shape: 'disc', color: '#ef4444', size: 'medium', hasCenterHole: true, hasIndexHole: true },
    { id: 'order-blue', name: 'Blue box', shape: 'box', color: '#3b82f6', size: 'medium' },
];

export interface ChallengeRun {
    status: 'planning' | 'running' | 'won' | 'failed';
    elapsed: number;
    spawned: number;
    accepted: [number, number];
    rejected: number;
    resolvedIds: string[];
    idleRobotSeconds: number;
    robotSeconds: number;
}

export function freshChallenge(): ChallengeRun {
    return { status: 'planning', elapsed: 0, spawned: 0, accepted: [0, 0], rejected: 0,
        resolvedIds: [], idleRobotSeconds: 0, robotSeconds: 0 };
}

export function nextChallengeTemplate(run: ChallengeRun): PartTemplate | null {
    if (run.status !== 'running' || run.spawned >= FIRST_SHIFT.batchSize) return null;
    return challengeTemplates[run.spawned % 3 === 1 ? 1 : 0];
}

export function recordDelivery(run: ChallengeRun, receiverId: string, part: {
    id: string; templateId?: string; shape: string; color: string;
}): ChallengeRun {
    if (run.status !== 'running' || run.resolvedIds.includes(part.id)) return run;
    const next = { ...run, accepted: [...run.accepted] as [number, number], resolvedIds: [...run.resolvedIds, part.id] };
    const index = FIRST_SHIFT.orders.findIndex(order => order.receiverId === receiverId &&
        order.templateId === part.templateId && order.shape === part.shape && order.color === part.color);
    if (index >= 0) next.accepted[index]++;
    else next.rejected++;
    if (FIRST_SHIFT.orders.every((order, i) => next.accepted[i] >= order.quantity)) next.status = 'won';
    else if (next.resolvedIds.length >= FIRST_SHIFT.batchSize) next.status = 'failed';
    return next;
}

export function challengeMetrics(run: ChallengeRun, credits: number) {
    const delivered = run.accepted.reduce((sum, count) => sum + count, 0);
    const accuracy = delivered + run.rejected ? delivered / (delivered + run.rejected) : 0;
    const medal = run.status !== 'won' ? null
        : run.elapsed <= 90 && accuracy >= 0.8 && credits >= 500 ? 'Gold'
        : run.elapsed <= 135 && accuracy >= 0.6 ? 'Silver' : 'Bronze';
    return { delivered, accuracy, medal, spent: FIRST_SHIFT.budget - credits,
        throughput: run.elapsed > 0 ? delivered * 60 / run.elapsed : 0,
        idle: run.robotSeconds > 0 ? run.idleRobotSeconds / run.robotSeconds : 0 };
}

export function challengeLayout(defaultItems: PlacedItem[]): PlacedItem[] {
    return structuredClone(defaultItems).map(item => {
        if (item.id === 't1') return { ...item, type: 'receiver', config: { machineSize: [2.5, 2.5], machineHeight: 1, acceptColor: 'any' } };
        if (item.id === 'c1' || item.id === 'c2') {
            const order = FIRST_SHIFT.orders[item.id === 'c1' ? 0 : 1];
            item.config = { ...item.config, speed: 2, pickColors: [order.color], cobotShowPath: true };
        }
        if (item.id === 'b2' || item.id === 'b4') item.config = { ...item.config, speed: 0.7 };
        return item;
    });
}

export const layoutCost = (items: PlacedItem[]) => items.reduce((sum, item) => sum + ITEM_COSTS[item.type], 0);
export const isChallengeFixture = (id: string) => ['s1', 't1', 'r1', 'r2'].includes(id);
export const challengeBuildAllowed = (type: string) => ['cobot', 'belt', 'table', 'camera'].includes(type);
