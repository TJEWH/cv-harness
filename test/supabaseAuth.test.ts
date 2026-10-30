import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { createSupabaseAuth } from '../src/platform/auth/useSupabaseAuth';
import { createTabAuthStorage } from '../src/platform/supabase/supabase';
import { parseSupabaseConfiguration } from '../src/platform/supabase/supabaseConfig';

const configuration = { status: 'ready' as const, url: 'https://example.supabase.co', publishableKey: 'sb_publishable_public_test_key' };
const member = (id: string) => ({ id, email: `${id}@example.com`, is_anonymous: false } as User);
const session = (id: string) => ({ access_token: `token-${id}`, user: member(id) } as Session);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
type UserResult = { data: { user: User | null }; error: unknown };

function harness() {
  let listener!: (event: AuthChangeEvent, value: Session | null) => void;
  let unsubscribed = false;
  let calls = 0;
  const auth = {
    onAuthStateChange(callback: typeof listener) {
      listener = callback;
      return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } };
    },
    async getUser(token: string): Promise<UserResult> {
      calls += 1;
      return { data: { user: member(token.slice(6)) }, error: null };
    },
    async signInWithPassword(_credentials: { email: string; password: string }) {
      return { data: { session: session('alice') }, error: null as unknown };
    },
    async signOut(_options: { scope: string }) { return { error: null as unknown }; },
  };
  const state = createSupabaseAuth({ auth } as unknown as SupabaseClient, configuration);
  return { auth, state, emit: (event: AuthChangeEvent, value: Session | null) => listener(event, value),
    get calls() { return calls; }, get unsubscribed() { return unsubscribed; } };
}
const verifiedUserId = (h: ReturnType<typeof harness>) => h.state.user.value?.id;

test('configuration allows only public keys and HTTPS, with local HTTP only in development', () => {
  assert.deepEqual(parseSupabaseConfiguration('', ''), { status: 'missing' });
  assert.deepEqual(parseSupabaseConfiguration(configuration.url, ''), { status: 'invalid', reason: 'incomplete' });
  assert.deepEqual(parseSupabaseConfiguration(configuration.url, configuration.publishableKey), configuration);
  const jwt = (role: string) => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(parseSupabaseConfiguration(configuration.url, jwt('anon')).status, 'ready');
  for (const key of [jwt('service_role'), jwt('authenticated'), jwt('postgres'), 'sb_secret_do_not_expose', 'not-a-key', 'a.b.c']) {
    const result = parseSupabaseConfiguration(configuration.url, key);
    assert.deepEqual(result, { status: 'invalid', reason: 'key' });
    assert.equal(JSON.stringify(result).includes(key), false, 'invalid credential must never enter the build');
  }
  for (const url of ['http://example.com', 'javascript:alert(1)', '//example.com', 'https://user:password@example.com',
    'https://example.com/path', 'https://example.com?api-key=test', 'https://example.com/#fragment', 'https://exa\nmple.com']) {
    assert.deepEqual(parseSupabaseConfiguration(url, configuration.publishableKey, true), { status: 'invalid', reason: 'url' });
  }
  for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
    assert.equal(parseSupabaseConfiguration(url, configuration.publishableKey).status, 'invalid');
    assert.equal(parseSupabaseConfiguration(url, configuration.publishableKey, true).status, 'ready');
  }
});

test('unconfigured mode is ready locally and does not require an auth client', async () => {
  const state = createSupabaseAuth(null, { status: 'missing' });
  assert.equal(state.ready.value, true);
  assert.equal(state.user.value, null);
  assert.equal(await state.signIn('a@example.com', 'password'), false);
  assert.equal(await state.signOut(), false);
  state.dispose();
});

test('restored sessions are server-verified outside the synchronous auth callback', async () => {
  const h = harness();
  h.emit('INITIAL_SESSION', session('alice'));
  assert.equal(h.state.user.value, null);
  assert.equal(h.state.ready.value, false);
  assert.equal(h.calls, 0, 'no auth method may run in the callback lock');
  await tick();
  assert.equal(h.calls, 1);
  assert.equal(verifiedUserId(h), 'alice');
  assert.equal(h.state.ready.value, true);
  h.state.dispose();
});

test('a late user verification cannot restore an account after sign-out', async () => {
  const h = harness();
  const pending = deferred<UserResult>();
  h.auth.getUser = () => pending.promise;
  h.emit('INITIAL_SESSION', session('alice'));
  await tick();
  h.emit('SIGNED_OUT', null);
  pending.resolve({ data: { user: member('alice') }, error: null });
  await tick();
  assert.equal(h.state.user.value, null);
  assert.equal(h.state.ready.value, true);
  h.state.dispose();
});

test('switching accounts invalidates outstanding verification and clears the prior user immediately', async () => {
  const h = harness();
  h.emit('INITIAL_SESSION', session('alice'));
  await tick();
  const stale = deferred<UserResult>();
  h.auth.getUser = (token) => token === 'token-alice' ? stale.promise
    : Promise.resolve({ data: { user: member('bob') }, error: null });
  h.emit('TOKEN_REFRESHED', session('alice'));
  await tick();
  h.emit('SIGNED_IN', session('bob'));
  assert.equal(h.state.user.value, null);
  await tick();
  stale.resolve({ data: { user: member('alice') }, error: null });
  await tick();
  assert.equal(verifiedUserId(h), 'bob');
  h.state.dispose();
});

test('unverified, mismatched, or anonymous sessions never unlock cloud views', async () => {
  for (const result of [
    { data: { user: null }, error: new Error('invalid token') },
    { data: { user: member('another-user') }, error: null },
    { data: { user: { ...member('alice'), is_anonymous: true } }, error: null },
  ]) {
    const h = harness();
    h.auth.getUser = async () => result;
    h.emit('INITIAL_SESSION', session('alice'));
    await tick();
    assert.equal(h.state.user.value, null);
    assert.equal(h.state.ready.value, true);
    assert.equal(h.state.error.value, 'sessionFailed');
    h.state.dispose();
  }
});

test('sign-in reports generic failures, and successful sign-in is verified', async () => {
  const h = harness();
  const passwords: string[] = [];
  h.auth.signInWithPassword = async ({ email, password }) => {
    assert.equal(email, 'alice@example.com');
    passwords.push(password);
    return { data: { session: session('alice') }, error: passwords.length === 1 ? new Error('account details') : null };
  };
  assert.equal(await h.state.signIn(' alice@example.com ', 'bad'), false);
  assert.equal(h.state.error.value, 'signInFailed');
  assert.equal(h.state.user.value, null);
  assert.equal(await h.state.signIn('alice@example.com', 'correct'), true);
  assert.equal(h.state.error.value, null);
  assert.equal(verifiedUserId(h), 'alice');
  assert.equal(h.state.busy.value, false);
  h.state.dispose();
});

test('logout is scoped to this session and preserves retry capability after a network failure', async () => {
  const h = harness();
  h.emit('INITIAL_SESSION', session('alice'));
  await tick();
  h.auth.signOut = async (options) => {
    assert.deepEqual(options, { scope: 'local' });
    return { error: new Error('offline') };
  };
  assert.equal(await h.state.signOut(), false);
  assert.equal(h.state.error.value, 'signOutFailed');
  assert.equal(verifiedUserId(h), 'alice');
  assert.equal(h.state.busy.value, false);
  h.auth.signOut = async () => ({ error: null });
  assert.equal(await h.state.signOut(), true);
  assert.equal(h.state.user.value, null);
  assert.equal(h.state.error.value, null);
  h.state.dispose();
});

test('disposing auth unsubscribes and cancels queued verification', async () => {
  const h = harness();
  h.emit('INITIAL_SESSION', session('alice'));
  h.state.dispose();
  await tick();
  assert.equal(h.unsubscribed, true);
  assert.equal(h.calls, 0);
  assert.equal(h.state.user.value, null);
});

test('a sign-out event invalidates a sign-in response still in flight', async () => {
  const h = harness();
  const pending = deferred<{ data: { session: Session }; error: unknown }>();
  h.auth.signInWithPassword = () => pending.promise;
  const signingIn = h.state.signIn('alice@example.com', 'password');
  h.emit('SIGNED_OUT', null);
  pending.resolve({ data: { session: session('alice') }, error: null });
  assert.equal(await signingIn, false);
  assert.equal(h.state.user.value, null);
  assert.equal(h.state.busy.value, false);
  assert.equal(h.calls, 0);
  h.state.dispose();
});

test('blocked sessionStorage falls back to memory and removes only auth keys', () => {
  const storage = createTabAuthStorage({
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  });
  assert.equal(storage.getItem('auth'), null);
  storage.setItem('auth', 'session');
  storage.setItem('unrelated', 'keep');
  assert.equal(storage.getItem('auth'), 'session');
  storage.removeItem('auth');
  assert.equal(storage.getItem('auth'), null);
  assert.equal(storage.getItem('unrelated'), 'keep');
});
