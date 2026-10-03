// Every index-owned resource must follow the same part when dead items are removed.
// Retired meshes stay at the end of the pool for reuse by future spawns.
export function compactPartPool<T extends { state: string }, M>(items: T[], meshes: M[], meshKinds: string[]) {
    const survivorIndices: number[] = [];
    const kept: T[] = [];
    items.forEach((item, index) => {
        if (item.state === 'dead') return;
        survivorIndices.push(index);
        kept.push(item);
    });
    const survivors = new Set(survivorIndices);
    const order = [...survivorIndices];
    for (let index = 0; index < meshes.length; index++) {
        if (!survivors.has(index)) order.push(index);
    }
    const nextMeshes = order.map(index => meshes[index]);
    const nextKinds = order.map(index => meshKinds[index]);
    meshes.splice(0, meshes.length, ...nextMeshes);
    meshKinds.splice(0, meshKinds.length, ...nextKinds);
    return { items: kept, survivorIndices };
}

export function remapPartChannel<T>(channel: Map<number, T>, survivorIndices: number[]) {
    const next = new Map<number, T>();
    survivorIndices.forEach((oldIndex, newIndex) => {
        if (channel.has(oldIndex)) next.set(newIndex, channel.get(oldIndex)!);
    });
    channel.clear();
    next.forEach((value, index) => channel.set(index, value));
}
