/** Fetch ordered immutable histories beyond the Data API's default row limit. */
export async function readHistoryPages<T extends { id: string }>(read: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const size = 100, result = new Map<string, T>();
  for (let from = 0; ; from += size) {
    const rows = await read(from, from + size - 1);
    const previousSize = result.size;
    for (const row of rows) if (!result.has(row.id)) result.set(row.id, row);
    if (rows.length < size) return [...result.values()];
    if (result.size === previousSize) throw new Error('History changed while loading. Refresh to retry.');
  }
}
