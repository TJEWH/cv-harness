/** User-supplied links must have an explicit allowed scheme, never a relative URL. */
export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Accept one address, without mail headers or additional recipients. */
export function safeEmailUrl(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const email = value.trim();
  if (!/^[^\s@<>?&#%,;:]+@[^\s@<>?&#%,;:]+$/.test(email)) return null;
  return `mailto:${email.split('@').map(encodeURIComponent).join('@')}`;
}

export function safeLinkUrl(value: unknown): string | null {
  const web = safeWebUrl(value);
  if (web) return web;
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const text = value.trim();
  if (/^mailto:/i.test(text)) {
    try { return safeEmailUrl(decodeURIComponent(text.slice(7))); } catch { return null; }
  }
  if (/^tel:\+?[\d(). -]+$/i.test(text) && /\d/.test(text.slice(4))) return `tel:${text.slice(4)}`;
  return null;
}
