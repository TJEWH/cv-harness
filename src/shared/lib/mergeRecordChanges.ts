/** Merge fields edited since a baseline, retaining current values on conflict. */
export function mergeRecordChanges<T extends object>(
  baseline: T,
  incoming: T,
  current: T,
  ignore: readonly (keyof T)[] = [],
): { value: T; conflicts: (keyof T)[] } {
  const value = { ...current };
  const conflicts: (keyof T)[] = [];
  const ignored = new Set(ignore);
  for (const key of Object.keys({ ...baseline, ...incoming }) as (keyof T)[]) {
    if (ignored.has(key)) continue;
    const before = JSON.stringify(baseline[key]);
    const next = JSON.stringify(incoming[key]);
    const saved = JSON.stringify(current[key]);
    if (next === before) continue;
    if (saved !== before && saved !== next) { conflicts.push(key); continue; }
    value[key] = incoming[key];
  }
  return { value, conflicts };
}
