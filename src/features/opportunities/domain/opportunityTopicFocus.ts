interface OpportunityTopicFocusLink { source: string; target: string }

/** Visible selections and their direct relationships; null leaves the whole view unmuted. */
export function opportunityTopicFocus(
  nodeIds: Iterable<string>,
  links: readonly OpportunityTopicFocusLink[],
  selectedIds: Iterable<string>,
): Set<string> | null {
  const visible = new Set(nodeIds);
  const selected = new Set([...selectedIds].filter(id => visible.has(id)));
  if (!selected.size) return null;

  const focused = new Set(selected);
  for (const link of links) {
    if (!visible.has(link.source) || !visible.has(link.target)) continue;
    if (selected.has(link.source)) focused.add(link.target);
    if (selected.has(link.target)) focused.add(link.source);
  }
  return focused;
}
