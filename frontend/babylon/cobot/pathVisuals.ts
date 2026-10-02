import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { CobotState } from './stateTypes';

export function activeCobotPath(state: CobotState): Vector3[] {
    state.gripperTip.computeWorldMatrix(true);
    const tool = state.gripperTip.getAbsolutePosition().clone();
    const remaining = state.plannedPath.slice(state.plannedPathCursor);
    return [tool, ...(remaining.length ? remaining.map(p => p.clone()) : [state.desiredTarget.clone()])];
}

export function updateCobotPath(state: CobotState) {
    const previous = state.pathLine;
    if (!previous) return;
    previous.isVisible = !!state.selfItem?.config?.cobotShowPath;
    if (!previous.isVisible) return;
    const points = activeCobotPath(state);
    if (previous.getTotalVertices() === points.length) {
        MeshBuilder.CreateLines(previous.name, { points, instance: previous });
        return;
    }
    // Babylon can update vertex positions in place, but cannot resize a line's
    // buffers. Rebuild only when the planner changes the number of waypoints.
    const replacement = MeshBuilder.CreateLines(previous.name, {
        points, updatable: true, material: previous.material ?? undefined,
    }, previous.getScene());
    replacement.color.copyFrom(previous.color);
    replacement.alpha = previous.alpha;
    replacement.isPickable = false;
    replacement.renderingGroupId = previous.renderingGroupId;
    previous.dispose();
    state.pathLine = replacement;
}
