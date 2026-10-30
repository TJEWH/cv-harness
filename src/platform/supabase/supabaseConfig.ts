export type SupabaseConfiguration =
  | { status: 'missing' }
  | { status: 'invalid'; reason: 'incomplete' | 'url' | 'key' }
  | { status: 'ready'; url: string; publishableKey: string };

/** Only public credentials may be serialized into the frontend build. */
export function parseSupabaseConfiguration(
  urlValue: unknown,
  keyValue: unknown,
  allowLocalHttp = false,
): SupabaseConfiguration {
  const rawUrl = typeof urlValue === 'string' ? urlValue.trim() : '';
  const key = typeof keyValue === 'string' ? keyValue.trim() : '';
  if (!rawUrl && !key) return { status: 'missing' };
  if (!rawUrl || !key) return { status: 'invalid', reason: 'incomplete' };

  let url: URL;
  try {
    url = new URL(rawUrl);
    const localHttp = allowLocalHttp && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!localHttp && url.protocol !== 'https:') || url.username || url.password
      || url.search || url.hash || url.pathname !== '/' || /[\u0000-\u0020\\]/.test(rawUrl)) {
      return { status: 'invalid', reason: 'url' };
    }
  } catch {
    return { status: 'invalid', reason: 'url' };
  }

  let publicKey = /^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key);
  if (!publicKey && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    try {
      // Legacy anon keys are supported; JWT decoding is only a key-type guard.
      // Supabase verifies the key and the user JWT on every API request.
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      publicKey = payload?.role === 'anon';
    } catch { /* Malformed and privileged keys are rejected. */ }
  }
  if (!publicKey) return { status: 'invalid', reason: 'key' };
  return { status: 'ready', url: url.origin, publishableKey: key };
}
