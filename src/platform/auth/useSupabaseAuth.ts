import { readonly, ref, shallowRef } from 'vue';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { supabaseClient, supabaseConfiguration } from '../supabase/supabase';
import type { SupabaseConfiguration } from '../supabase/supabaseConfig';

export type AuthErrorCode = 'signInFailed' | 'signOutFailed' | 'sessionFailed';

/** UI state only. Table permissions must always be enforced by Supabase RLS. */
export function createSupabaseAuth(client: SupabaseClient | null, configuration: SupabaseConfiguration) {
  const user = shallowRef<User | null>(null);
  const ready = ref(client === null);
  const busy = ref(false);
  const error = ref<AuthErrorCode | null>(null);
  let generation = 0;
  let signedOutGeneration = 0;
  let disposed = false;
  let verificationTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelVerification() {
    generation += 1;
    clearTimeout(verificationTimer);
    verificationTimer = undefined;
    return generation;
  }

  async function verify(session: Session, expectedGeneration: number) {
    if (!client || disposed || generation !== expectedGeneration) return false;
    try {
      const result = await client.auth.getUser(session.access_token);
      if (disposed || generation !== expectedGeneration) return false;
      if (result.error || !result.data.user || result.data.user.is_anonymous
        || result.data.user.id !== session.user.id) {
        user.value = null;
        error.value = 'sessionFailed';
        return false;
      }
      user.value = result.data.user;
      error.value = null;
      return true;
    } catch {
      if (!disposed && generation === expectedGeneration) {
        user.value = null;
        error.value = 'sessionFailed';
      }
      return false;
    } finally {
      if (!disposed && generation === expectedGeneration) ready.value = true;
    }
  }

  const subscription = client?.auth.onAuthStateChange((event, session) => {
    if (disposed) return;
    if (event === 'SIGNED_OUT') signedOutGeneration += 1;
    const currentGeneration = cancelVerification();
    if (!session) {
      user.value = null;
      ready.value = true;
      return;
    }
    if (user.value?.id !== session.user.id) user.value = null;
    // Never await or call another auth method while Supabase holds its auth lock.
    verificationTimer = setTimeout(() => { void verify(session, currentGeneration); }, 0);
  }).data.subscription;

  async function signIn(email: string, password: string) {
    if (!client || busy.value || disposed) return false;
    busy.value = true;
    error.value = null;
    const expectedSignedOutGeneration = signedOutGeneration;
    try {
      const result = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (disposed || signedOutGeneration !== expectedSignedOutGeneration) return false;
      if (result.error || !result.data.session) {
        error.value = 'signInFailed';
        return false;
      }
      // The auth event may already have queued verification. Verify only its latest state.
      return await verify(result.data.session, cancelVerification());
    } catch {
      if (!disposed) error.value = 'signInFailed';
      return false;
    } finally {
      if (!disposed) busy.value = false;
    }
  }

  async function signOut() {
    if (!client || busy.value || disposed) return false;
    busy.value = true;
    error.value = null;
    cancelVerification();
    try {
      const result = await client.auth.signOut({ scope: 'local' });
      if (disposed) return false;
      if (result.error) {
        error.value = 'signOutFailed';
        return false;
      }
      cancelVerification();
      user.value = null;
      ready.value = true;
      return true;
    } catch {
      if (!disposed) error.value = 'signOutFailed';
      return false;
    } finally {
      if (!disposed) busy.value = false;
    }
  }

  return {
    client,
    configuration,
    user: readonly(user),
    ready: readonly(ready),
    busy: readonly(busy),
    error: readonly(error),
    signIn,
    signOut,
    clearError() { error.value = null; },
    dispose() { disposed = true; cancelVerification(); subscription?.unsubscribe(); },
  };
}

let sharedAuth: ReturnType<typeof createSupabaseAuth> | undefined;

export function useSupabaseAuth() {
  return sharedAuth ??= createSupabaseAuth(supabaseClient, supabaseConfiguration);
}

if (import.meta.hot) import.meta.hot.dispose(() => sharedAuth?.dispose());
