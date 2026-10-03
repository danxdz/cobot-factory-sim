import { ITEM_COSTS, type FactoryState, type ItemType } from '../types';
import { challengeBuildAllowed } from './challenge';

export function buildBlockedReason(state: Pick<FactoryState, 'credits' | 'challenge' | 'isRunning'>, type: ItemType): string | null {
    if (state.challenge && !challengeBuildAllowed(type)) return 'Unavailable in First Shift';
    if (state.challenge && state.isRunning) return 'Retry the shift to edit equipment';
    const cost = ITEM_COSTS[type];
    if (!Number.isFinite(state.credits) || state.credits < cost) return `Requires ${cost} credits`;
    return null;
}
