/** The same generated page can be mounted inline and in a dialog at once. */
export function scopePreviewSvgIds(svg: string, prefix: string): string {
  const ids = new Map<string, string>();
  const scoped = svg.replace(/\bid=(["'])([^"']+)\1/g, (_, quote: string, id: string) => {
    const next = `${prefix}-${id}`;
    ids.set(id, next);
    return `id=${quote}${next}${quote}`;
  });
  return scoped
    .replace(/url\(#([^\s)]+)\)/g, (reference, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : reference)
    .replace(/\b((?:xlink:)?href)=(["'])#([^"']+)\2/g, (reference, attribute: string, quote: string, id: string) =>
      ids.has(id) ? `${attribute}=${quote}#${ids.get(id)}${quote}` : reference);
}
