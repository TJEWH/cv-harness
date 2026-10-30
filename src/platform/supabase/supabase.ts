import { createClient } from '@supabase/supabase-js';
import type { SupabaseConfiguration } from './supabaseConfig';

declare const __SUPABASE_CONFIGURATION__: SupabaseConfiguration;

export const supabaseConfiguration: SupabaseConfiguration = typeof __SUPABASE_CONFIGURATION__ === 'undefined'
  ? { status: 'missing' }
  : __SUPABASE_CONFIGURATION__;

/** Browser storage may be disabled. Fall back to memory without blocking local CV work. */
export function createTabAuthStorage(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const memory = new Map<string, string>();
  let persistent = storage;
  return {
    getItem(key: string) {
      try { return persistent ? persistent.getItem(key) : memory.get(key) ?? null; }
      catch { persistent = undefined; return memory.get(key) ?? null; }
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
      try { persistent?.setItem(key, value); } catch { persistent = undefined; }
    },
    removeItem(key: string) {
      memory.delete(key);
      try { persistent?.removeItem(key); } catch { persistent = undefined; }
    },
  };
}

function browserSessionStorage() {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; }
  catch { return undefined; }
}

function createOptionalClient() {
  if (supabaseConfiguration.status !== 'ready') return null;
  const storage = createTabAuthStorage(browserSessionStorage());
  const tabKey = 'cv-builder.supabase.tab';
  let tabId = storage.getItem(tabKey);
  if (!tabId || !/^[a-f0-9-]{36}$/.test(tabId)) {
    tabId = crypto.randomUUID();
    storage.setItem(tabKey, tabId);
  }
  return createClient(supabaseConfiguration.url, supabaseConfiguration.publishableKey, {
    auth: {
      storage,
      // Unique per tab: Supabase also uses this key for BroadcastChannel events.
      storageKey: `cv-builder.supabase:${new URL(supabaseConfiguration.url).host}:${tabId}`,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

export const supabaseClient = createOptionalClient();
