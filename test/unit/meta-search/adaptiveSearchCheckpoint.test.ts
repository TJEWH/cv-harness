import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AdaptiveStartupCheckpointSession, confirmAdaptiveStartupCheckpointProbe, writeAdaptiveStartupCheckpointProbe,
  type AdaptiveStartupCheckpointStore,
} from '../../../src/features/meta-search/domain/adaptiveSearchCheckpoint';
import { AdaptiveStartupTransportError, createAdaptiveStartupFailure } from '../../../src/features/meta-search/domain/adaptiveSearchTransport';
import { syntheticAdaptiveStartup } from '../../support/fixtures/adaptiveStartupSynthetic';
import { adaptiveStartupFileCheckpoint } from '../../../scripts/lib/adaptiveSearchCheckpointFile';

const clock = () => Date.parse('2026-11-01T10:00:00Z');
const response = (alias: 'startup_manifest' | 'startup_page', value: unknown) => [{ [alias]: value }];
function memoryStore() {
  let value: string | null = null;
  return { read: async () => value, compareAndSwap: async (expected: string | null, next: string) => {
    if (value !== expected) return false;
    value = next; return true;
  } };
}
async function prepare(store: AdaptiveStartupCheckpointStore, value = syntheticAdaptiveStartup()) {
  await writeAdaptiveStartupCheckpointProbe(store, value.binding, 'synthetic_persistence_probe');
  await assert.rejects(AdaptiveStartupCheckpointSession.restore(value.binding, store, clock), /checkpoint_preflight_required/u);
  await confirmAdaptiveStartupCheckpointProbe(store, value.binding, 'synthetic_persistence_probe');
  return AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
}

test('separate actions must prove a nonce readback before the first manifest can be planned', async () => {
  const value = syntheticAdaptiveStartup(2), store = memoryStore();
  await assert.rejects(AdaptiveStartupCheckpointSession.restore(value.binding, store, clock), /checkpoint_preflight_required/u);
  await writeAdaptiveStartupCheckpointProbe(store, value.binding, 'synthetic_persistence_probe');
  await assert.rejects(confirmAdaptiveStartupCheckpointProbe(store, value.binding, 'wrong_synthetic_nonce'), /checkpoint_probe_mismatch/u);
  await confirmAdaptiveStartupCheckpointProbe(store, value.binding, 'synthetic_persistence_probe');
  const session = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
  assert.deepEqual(await session.nextRequest(), { kind: 'manifest' });
  const broken: AdaptiveStartupCheckpointStore = { read: async () => null, compareAndSwap: async () => true };
  await writeAdaptiveStartupCheckpointProbe(broken, value.binding, 'synthetic_persistence_probe');
  await assert.rejects(confirmAdaptiveStartupCheckpointProbe(broken, value.binding, 'synthetic_persistence_probe'), /checkpoint_preflight_required/u);
});

test('interrupted reconstruction restores only missing context-first pages for both 27 and other page counts', async () => {
  for (const protocolPages of [undefined, 2]) {
    const value = syntheticAdaptiveStartup(protocolPages), store = memoryStore();
    assert.equal(value.pages.length, protocolPages === undefined ? 27 : protocolPages + 4);
    if (protocolPages === undefined) assert.deepEqual(value.manifest.sections.map(section => section.page_count), [3, 4, 4, 4, 12]);
    let session = await prepare(store, value);
    await session.acceptResponse(response('startup_manifest', value.manifest), 'startup_manifest');
    assert.deepEqual(await session.nextRequest(), { kind: 'page', section: 'context', index: 0 });
    await session.acceptResponse(response('startup_page', value.pages[0]), 'startup_page');
    session = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
    assert.deepEqual(await session.nextRequest(), { kind: 'page', section: protocolPages === undefined ? 'context' : 'planning', index: protocolPages === undefined ? 1 : 0 });
    await session.acceptResponse(response('startup_page', structuredClone(value.pages[0])), 'startup_page');
    for (const page of value.pages.slice(1)) {
      assert.deepEqual(await session.nextRequest(), { kind: 'page', section: page.section, index: page.index });
      await session.acceptResponse(response('startup_page', page), 'startup_page');
      session = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
    }
    assert.equal(await session.nextRequest(), null);
    assert.deepEqual(await session.assemble(), value.bundle);
  }
});

test('fresh Node processes read the same private atomic checkpoint and retain completed pages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cv-startup-checkpoint-'));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const value = syntheticAdaptiveStartup();
  try {
    const fixturePath = join(directory, 'synthetic-fixture.json');
    await writeFile(fixturePath, JSON.stringify(value), { mode: 0o600 });
    const common = `import {readFileSync} from 'node:fs';
      import {AdaptiveStartupCheckpointSession,writeAdaptiveStartupCheckpointProbe,confirmAdaptiveStartupCheckpointProbe} from './src/features/meta-search/domain/adaptiveSearchCheckpoint.ts';
      import {createAdaptiveStartupFailure} from './src/features/meta-search/domain/adaptiveSearchTransport.ts';
      import {adaptiveStartupFileCheckpoint} from './scripts/lib/adaptiveSearchCheckpointFile.ts';
      const f=JSON.parse(readFileSync(process.argv[1],'utf8'));const store=adaptiveStartupFileCheckpoint(process.argv[2],f.binding);
      const clock=()=>Date.parse('2026-11-01T10:00:00Z');`;
    const run = (code: string) => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', common + code, fixturePath, join(directory, 'private')], {
        cwd: root, encoding: 'utf8', timeout: 30_000,
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    assert.deepEqual(run(`await writeAdaptiveStartupCheckpointProbe(store,f.binding,'synthetic_separate_actions');process.stdout.write(JSON.stringify({written:true}));`), { written: true });
    assert.deepEqual(run(`await confirmAdaptiveStartupCheckpointProbe(store,f.binding,'synthetic_separate_actions');
      const session=await AdaptiveStartupCheckpointSession.restore(f.binding,store,clock);
      await session.acceptResponse([{startup_manifest:f.manifest}],'startup_manifest');
      await session.acceptResponse([{startup_page:f.pages[0]}],'startup_page');
      const next=await session.nextRequest();await session.recordDispatch(next,'a'.repeat(64));process.stdout.write(JSON.stringify(next));`),
    { kind: 'page', section: 'context', index: 1 });
    assert.deepEqual(run(`const session=await AdaptiveStartupCheckpointSession.restore(f.binding,store,clock);
      let blocked=false;try{await session.nextRequest()}catch(error){blocked=error.code==='checkpoint_response_unreconciled'}
      if(!blocked)throw new Error('Unreconciled dispatch must block another request');
      await session.recordFailure(createAdaptiveStartupFailure({kind:'no_response',request_dispatched:true,response_received:false}));
      await session.recordDispatch(await session.nextRequest(),'a'.repeat(64));
      for(const p of f.pages.slice(1))await session.acceptResponse([{startup_page:p}],'startup_page');
      const bundle=await session.assemble();process.stdout.write(JSON.stringify({remaining:await session.nextRequest(),criteria:bundle.base.criteria,query_plan:bundle.query_plan,legacy_core_queries:bundle.legacy_core_queries}));`),
    { remaining: null, criteria: (value.bundle.base as { criteria: unknown }).criteria, query_plan: null, legacy_core_queries: null });
    for (const name of await readdir(join(directory, 'private'))) {
      assert.match(name, /^[a-f0-9]{64}\.json$/u);
      assert.equal((await stat(join(directory, 'private', name))).mode & 0o777, 0o600);
    }
    assert.equal((await stat(join(directory, 'private'))).mode & 0o777, 0o700);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the local file adapter refuses a public directory or symlink without changing either', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cv-startup-private-store-')), value = syntheticAdaptiveStartup(2);
  try {
    const publicDirectory = join(directory, 'public'), privateDirectory = join(directory, 'private'), linked = join(directory, 'linked');
    await mkdir(publicDirectory, { mode: 0o755 });
    await mkdir(privateDirectory, { mode: 0o700 });
    await symlink(privateDirectory, linked);
    await assert.rejects(adaptiveStartupFileCheckpoint(publicDirectory, value.binding).read(), /private/u);
    await assert.rejects(adaptiveStartupFileCheckpoint(linked, value.binding).compareAndSwap(null, 'synthetic'), /private/u);
    assert.equal((await stat(publicDirectory)).mode & 0o777, 0o755);
    assert.deepEqual(await readdir(privateDirectory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an incomplete assembly remains resumable, while conflicting or changed pages leave only a payload-free tombstone', async () => {
  for (const mutation of ['conflict', 'hash', 'order'] as const) {
    const value = syntheticAdaptiveStartup(2), store = memoryStore();
    const session = await prepare(store, value);
    await session.acceptResponse(response('startup_manifest', value.manifest), 'startup_manifest');
    await assert.rejects(session.assemble(), /incomplete_transport/u);
    if (mutation !== 'order') await session.acceptResponse(response('startup_page', value.pages[0]), 'startup_page');
    const altered = structuredClone(mutation === 'order' ? value.pages[1]! : value.pages[0]!);
    if (mutation === 'hash') altered.bundle_hash = '0'.repeat(64);
    if (mutation === 'conflict') {
      const bytes = Buffer.from(altered.data_base64, 'base64'); bytes[0] = bytes[0]! ^ 1; altered.data_base64 = bytes.toString('base64');
    }
    await assert.rejects(session.acceptResponse(response('startup_page', altered), 'startup_page'));
    const tombstone = JSON.parse((await store.read())!);
    assert.equal(tombstone.status, 'blocked'); assert.equal(tombstone.manifest, null); assert.deepEqual(tombstone.pages, []);
    assert.doesNotMatch(JSON.stringify(tombstone), /Synthetic sensing|data_base64|source_context/u);
    await assert.rejects(AdaptiveStartupCheckpointSession.restore(value.binding, store, clock), /checkpoint_blocked/u);
    await assert.rejects(writeAdaptiveStartupCheckpointProbe(store, value.binding, 'new_nonce_cannot_bypass'), /checkpoint_already_exists/u);
  }
});

test('known lease expiry is a local guard and prevents offline resumption without closing a run', async () => {
  const value = syntheticAdaptiveStartup(2), store = memoryStore();
  const session = await prepare(store, value);
  await session.acceptResponse(response('startup_manifest', value.manifest), 'startup_manifest');
  await session.acceptResponse(response('startup_page', value.pages[0]), 'startup_page');
  await assert.rejects(AdaptiveStartupCheckpointSession.restore(value.binding, store, () => Date.parse('2035-01-01T12:00:01Z')),
    (error: unknown) => error instanceof AdaptiveStartupTransportError && error.code === 'checkpoint_lease_expired' && error.source === 'transport');
  assert.equal(JSON.parse((await store.read())!).fault.category, 'local_processing');
});

test('owner/profile and run scope cannot be replaced when restoring a checkpoint', async () => {
  const value = syntheticAdaptiveStartup(2), store = memoryStore();
  await prepare(store, value);
  await assert.rejects(AdaptiveStartupCheckpointSession.restore({ ...value.binding, profile_id: '8a000000-0000-4000-8000-000000000099' }, store, clock), /checkpoint_invalid/u);
  await assert.rejects(AdaptiveStartupCheckpointSession.restore({ ...value.binding, scope: { ...value.scope, run_id: '8a000000-0000-4000-8000-000000000098' } }, store, clock), /checkpoint_invalid/u);
  const session = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
  await assert.rejects(session.acceptResponse(response('startup_manifest', { ...value.manifest, scope: { ...value.serverScope, user_id: '8a000000-0000-4000-8000-000000000099' } }), 'startup_manifest'), /checkpoint_profile_mismatch/u);
});

test('checkpoint readback failures prevent a usable accepted response', async () => {
  const value = syntheticAdaptiveStartup(2), working = memoryStore();
  await prepare(working, value);
  let writes = 0;
  const failing: AdaptiveStartupCheckpointStore = { read: working.read, compareAndSwap: async (expected, serialized) => {
    if (++writes > 1) throw new Error('Synthetic disk error with private canary');
    return working.compareAndSwap(expected, serialized);
  } };
  const session = await AdaptiveStartupCheckpointSession.restore(value.binding, failing, clock);
  await session.acceptResponse(response('startup_manifest', value.manifest), 'startup_manifest');
  await assert.rejects(session.acceptResponse(response('startup_page', value.pages[0]), 'startup_page'), /checkpoint_storage_failed/u);
  await assert.rejects(session.nextRequest(), /checkpoint_blocked/u);
});

test('explicit denials block durable recovery and never store arbitrary provider codes or returned text', async () => {
  for (const kind of ['approval_denial', 'permission_denial', 'safety_denial'] as const) {
    const value = syntheticAdaptiveStartup(2), store = memoryStore();
    const session = await prepare(store, value);
    await session.acceptResponse(response('startup_manifest', value.manifest), 'startup_manifest');
    await session.acceptResponse(response('startup_page', value.pages[0]), 'startup_page');
    await session.recordFailure(createAdaptiveStartupFailure({ kind, code: 'private_evaluation_canary' }));
    const saved = (await store.read())!;
    assert.doesNotMatch(saved, /private_evaluation_canary|Synthetic sensing|data_base64|source_context/u);
    assert.equal(JSON.parse(saved).fault.category, kind);
    await assert.rejects(AdaptiveStartupCheckpointSession.restore(value.binding, store, clock), /checkpoint_blocked/u);
  }
});

test('known local decoding failures retain their exact cause in the durable checkpoint', async () => {
  for (const code of ['invalid_section_utf8', 'invalid_section_json', 'invalid_section_shape']) {
    const value = syntheticAdaptiveStartup(2), store = memoryStore();
    const session = await prepare(store, value);
    await session.recordFailure(new AdaptiveStartupTransportError(code));
    const saved = JSON.parse((await store.read())!);
    assert.deepEqual(saved.fault, { code, category: 'local_processing' });
    assert.equal(saved.status, 'blocked');
    await assert.rejects(AdaptiveStartupCheckpointSession.restore(value.binding, store, clock), /checkpoint_blocked/u);
  }
});

test('a separately observed dispatched request with no response preserves validated pages without dispatching a retry', async () => {
  const value = syntheticAdaptiveStartup(2), store = memoryStore();
  const session = await prepare(store, value);
  await session.acceptResponse(response('startup_manifest', value.manifest), 'startup_manifest');
  await session.acceptResponse(response('startup_page', value.pages[0]), 'startup_page');
  await session.recordDispatch({ kind: 'page', section: 'planning', index: 0 }, 'a'.repeat(64));
  const before = await store.read();
  await session.recordFailure(createAdaptiveStartupFailure({ kind: 'no_response', request_dispatched: true, response_received: false }));
  const beforePages = JSON.parse(before!).pages;
  assert.deepEqual(JSON.parse((await store.read())!).pages, beforePages);
  const restored = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
  assert.deepEqual(await restored.nextRequest(), { kind: 'page', section: 'planning', index: 0 });
});

test('durable dispatch identity survives interruption and permits only one identical lost-response retry', async () => {
  const value = syntheticAdaptiveStartup(2), store = memoryStore();
  let session = await prepare(store, value);
  const request = { kind: 'manifest' } as const, fingerprint = 'a'.repeat(64);
  await session.recordDispatch(request, fingerprint);
  session = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
  await assert.rejects(session.nextRequest(), /checkpoint_response_unreconciled/u);
  await session.recordFailure(createAdaptiveStartupFailure({ kind: 'no_response', request_dispatched: true, response_received: false }));
  session = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
  assert.deepEqual(await session.nextRequest(), request);
  await session.recordDispatch(request, fingerprint);
  assert.equal(JSON.parse((await store.read())!).request_ledger.attempts, 2);
  session = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
  await session.recordFailure(createAdaptiveStartupFailure({ kind: 'no_response', request_dispatched: true, response_received: false }));
  await assert.rejects(AdaptiveStartupCheckpointSession.restore(value.binding, store, clock), /checkpoint_blocked/u);
});

test('a recovered retry cannot change its request or query fingerprint', async () => {
  for (const change of ['request', 'query'] as const) {
    const value = syntheticAdaptiveStartup(2), store = memoryStore();
    let session = await prepare(store, value);
    await session.acceptResponse(response('startup_manifest', value.manifest), 'startup_manifest');
    const request = { kind: 'page', section: 'context', index: 0 } as const;
    await session.recordDispatch(request, 'a'.repeat(64));
    await session.recordFailure(createAdaptiveStartupFailure({ kind: 'no_response', request_dispatched: true, response_received: false }));
    session = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
    await assert.rejects(session.recordDispatch(change === 'request' ? { ...request, index: 1 } : request,
      change === 'query' ? 'b'.repeat(64) : 'a'.repeat(64)), /checkpoint_request_changed/u);
    await assert.rejects(AdaptiveStartupCheckpointSession.restore(value.binding, store, clock), /checkpoint_blocked/u);
  }
});

test('a local display truncation preserves verified data and requires the retained response to be handled locally', async () => {
  const value = syntheticAdaptiveStartup(2), store = memoryStore();
  let session = await prepare(store, value);
  await session.acceptResponse(response('startup_manifest', value.manifest), 'startup_manifest');
  await session.acceptResponse(response('startup_page', value.pages[0]), 'startup_page');
  await session.recordDispatch({ kind: 'page', section: 'planning', index: 0 }, 'a'.repeat(64));
  const before = JSON.parse((await store.read())!);
  const failure = createAdaptiveStartupFailure({ kind: 'display_truncation', response_received: true });
  assert.equal(failure.category, 'local_processing'); assert.equal(failure.retryable, false);
  await session.recordFailure(failure);
  assert.deepEqual(JSON.parse((await store.read())!).pages, before.pages);
  session = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
  await assert.rejects(session.nextRequest(), /checkpoint_local_readback_required/u);
  await session.acceptResponse(response('startup_page', value.pages[1]), 'startup_page');
  assert.deepEqual(await session.nextRequest(), { kind: 'page', section: 'protocol_text', index: 0 });
});

test('received response identity must match the durable dispatch, and a denial remains the first tombstone cause', async () => {
  const value = syntheticAdaptiveStartup(2), store = memoryStore();
  const session = await prepare(store, value);
  await session.recordDispatch({ kind: 'manifest' }, 'a'.repeat(64));
  await assert.rejects(session.acceptResponse(response('startup_page', value.pages[0]), 'startup_page'), /checkpoint_response_mismatch/u);
  assert.equal(JSON.parse((await store.read())!).fault.code, 'checkpoint_response_mismatch');
  const second = memoryStore(), denied = await prepare(second, value);
  await denied.recordFailure(createAdaptiveStartupFailure({ kind: 'safety_denial', code: 'safety_denied' }));
  await assert.rejects(denied.nextRequest(), /checkpoint_blocked/u);
  assert.equal(JSON.parse((await second.read())!).fault.category, 'safety_denial');
});

test('a stale session cannot overwrite a durable denial or compete for the same dispatch', async () => {
  for (const newer of ['denial', 'dispatch'] as const) {
    const value = syntheticAdaptiveStartup(2), store = memoryStore();
    const first = await prepare(store, value), stale = await AdaptiveStartupCheckpointSession.restore(value.binding, store, clock);
    if (newer === 'denial') await first.recordFailure(createAdaptiveStartupFailure({ kind: 'safety_denial', code: 'safety_denied' }));
    else await first.recordDispatch({ kind: 'manifest' }, 'a'.repeat(64));
    const latest = await store.read();
    await assert.rejects(stale.acceptResponse(response('startup_manifest', value.manifest), 'startup_manifest'), /checkpoint_stale/u);
    assert.equal(await store.read(), latest);
    await assert.rejects(stale.nextRequest(), /checkpoint_stale/u);
    assert.equal(await store.read(), latest);
    if (newer === 'denial') await assert.rejects(AdaptiveStartupCheckpointSession.restore(value.binding, store, clock), /checkpoint_blocked/u);
    else assert.equal(JSON.parse(latest!).request_ledger.attempts, 1);
  }
});

test('atomic conditional storage rejects a race after freshness checks without overwriting the winner', async () => {
  const value = syntheticAdaptiveStartup(2), backing = memoryStore();
  await prepare(backing, value);
  const expected = await backing.read();
  let injectRace = true;
  const racing: AdaptiveStartupCheckpointStore = { read: backing.read, compareAndSwap: async (before, replacement) => {
    if (injectRace) {
      injectRace = false;
      const denied = JSON.parse(before!);
      Object.assign(denied, { status: 'blocked', manifest: null, pages: [], fault: { category: 'safety_denial', code: 'safety_denied' } });
      assert.equal(await backing.compareAndSwap(before, JSON.stringify(denied)), true);
    }
    return backing.compareAndSwap(before, replacement);
  } };
  const session = await AdaptiveStartupCheckpointSession.restore(value.binding, racing, clock);
  await assert.rejects(session.recordDispatch({ kind: 'manifest' }, 'a'.repeat(64)), /checkpoint_stale/u);
  const latest = JSON.parse((await backing.read())!);
  assert.equal(latest.status, 'blocked'); assert.equal(latest.fault.category, 'safety_denial');
  assert.notEqual(await backing.read(), expected);
});

test('separate processes cannot both replace one checkpoint, and an interrupted lock is retained', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cv-startup-cas-')), root = fileURLToPath(new URL('../../../', import.meta.url));
  const value = syntheticAdaptiveStartup(2), privateDirectory = join(directory, 'private');
  const source = `import {adaptiveStartupFileCheckpoint} from './scripts/lib/adaptiveSearchCheckpointFile.ts';
    const store=adaptiveStartupFileCheckpoint(process.argv[1],JSON.parse(process.argv[2]));
    try{process.stdout.write(JSON.stringify(await store.compareAndSwap(null,process.argv[3])))}
    catch(error){if(error.code!=='EEXIST')throw error;process.stdout.write(JSON.stringify('busy'))}`;
  const replace = (replacement: string) => new Promise<unknown>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, privateDirectory, JSON.stringify(value.binding), replacement], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { error += String(chunk); });
    child.on('error', reject); child.on('close', code => { if (code === 0) resolve(JSON.parse(output)); else reject(new Error(error)); });
  });
  try {
    const outcomes = await Promise.all([replace('synthetic-first'), replace('synthetic-second')]);
    assert.equal(outcomes.filter(outcome => outcome === true).length, 1);
    assert.ok(outcomes.every(outcome => outcome === true || outcome === false || outcome === 'busy'));
    const store = adaptiveStartupFileCheckpoint(privateDirectory, value.binding), current = await store.read();
    assert.ok(current === 'synthetic-first' || current === 'synthetic-second');
    const name = (await readdir(privateDirectory))[0]!;
    const lockName = name.replace(/\.json$/u, '.lock');
    await writeFile(join(privateDirectory, lockName), 'synthetic-interrupted-holder', { mode: 0o600 });
    await assert.rejects(store.compareAndSwap(current, 'must-not-be-written'), (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST');
    await assert.rejects(store.read(), (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST');
    assert.equal(await readFile(join(privateDirectory, name), 'utf8'), current);
    assert.ok((await readdir(privateDirectory)).includes(lockName));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
