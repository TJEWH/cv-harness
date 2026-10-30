import assert from 'node:assert/strict';
import test from 'node:test';
import type { LetterTemplate } from '../src/documents/letter/letterTypes';
import { cloneCv } from '../src/features/applications/applicationCv';
import { refinementSignature } from '../src/features/refinement/applicationRefinement';
import { createPrivateRefinementCv } from './refinementFixture';
import { idle, seedLegacyRound, mount, prepare, type Workspace } from './refinementWorkflowHarness';

type PreparationWorkspace = Workspace & { cvSelectionLocked: boolean; letterSelectionLocked: boolean };
type Scope = 'cv' | 'letter';

function addAlternativeCv(fixture: ReturnType<typeof mount>) {
  const alternative = cloneCv(fixture.base);
  alternative.about.text = 'A separate reusable CV variant.';
  fixture.states.set('alternative', alternative);
  fixture.props.configurations.push({ id: 'alternative', name: 'Alternative' });
}

function assertLocks(setup: PreparationWorkspace, cv: boolean, letter: boolean) {
  assert.equal(setup.cvSelectionLocked, cv, 'CV preparation selection lock');
  assert.equal(setup.letterSelectionLocked, letter, 'letter template selection lock');
}

async function selectAlternative(setup: PreparationWorkspace, scope: Scope) {
  if (scope === 'cv') await setup.selectCv('alternative');
  else await setup.selectLetterTemplate('industry');
}

function selectedId(setup: PreparationWorkspace, scope: Scope) {
  return scope === 'cv' ? setup.selectedCvId : setup.selectedTemplateId;
}

function documentSignature(setup: PreparationWorkspace, scope: Scope) {
  return refinementSignature(scope === 'cv' ? setup.record : setup.letter);
}

test('published source requests leave both preparation selections available before any proposal', async t => {
  const fixture = mount(t, createPrivateRefinementCv());
  addAlternativeCv(fixture);
  const setup = await prepare(fixture, 'base', { scope: 'cv' }) as PreparationWorkspace;
  assert.ok(setup.requests.length);
  assert.equal(setup.proposals.length, 0);
  assertLocks(setup, false, false);

  await setup.selectCv('alternative');
  await setup.selectLetterTemplate('industry');

  assert.equal(setup.error, '');
  assert.equal(setup.selectedCvId, 'alternative');
  assert.equal(setup.selectedTemplateId, 'industry');
  assertLocks(setup, false, false);
});

for (const scope of ['cv', 'letter'] as const) {
  test(`${scope} selection refreshes remotely created proposals before replacing its source`, async t => {
    const fixture = mount(t, createPrivateRefinementCv());
    addAlternativeCv(fixture);
    const setup = await prepare(fixture, 'base', { scope }) as PreparationWorkspace;
    const beforeProposal = documentSignature(setup, scope);
    const selection = selectedId(setup, scope);
    fixture.cloud.seedProposal(setup.requests[0].id);
    assertLocks(setup, false, false);

    await selectAlternative(setup, scope);

    assert.equal(setup.error, '');
    assert.equal(selectedId(setup, scope), selection);
    assert.equal(documentSignature(setup, scope), beforeProposal);
    assertLocks(setup, scope === 'cv', scope === 'letter');
  });

  test(`${scope} proposal locks its preparation selection before acceptance while the other remains available`, async t => {
    const fixture = mount(t, createPrivateRefinementCv());
    addAlternativeCv(fixture);
    const setup = await prepare(fixture, 'base', { scope }) as PreparationWorkspace;
    const beforeProposal = documentSignature(setup, scope);
    fixture.cloud.seedProposal(setup.requests[0].id);

    await setup.checkProposals();

    assert.equal(setup.error, '');
    assert.equal(documentSignature(setup, scope), beforeProposal, 'merely finding a proposal does not accept it');
    assertLocks(setup, scope === 'cv', scope === 'letter');
    const selection = selectedId(setup, scope);
    await selectAlternative(setup, scope);
    assert.equal(selectedId(setup, scope), selection, 'direct method calls cannot replace the locked selection');
    assert.equal(documentSignature(setup, scope), beforeProposal);

    const otherScope = scope === 'cv' ? 'letter' : 'cv';
    await selectAlternative(setup, otherScope);
    assert.equal(setup.error, '');
    assert.equal(selectedId(setup, otherScope), otherScope === 'cv' ? 'alternative' : 'industry');
    assertLocks(setup, scope === 'cv', scope === 'letter');
  });
}

test('legacy combined proposals remain historical without locking preparation for either document', async t => {
  const fixture = mount(t, createPrivateRefinementCv());
  addAlternativeCv(fixture);
  let setup = await prepare(fixture, 'base', { scope: 'cv' }) as PreparationWorkspace;
  seedLegacyRound(fixture);
  await setup.checkProposals();
  assertLocks(setup, false, false);

  setup = fixture.reopen() as PreparationWorkspace;
  await idle(setup);
  assert.equal(setup.error, '');
  assertLocks(setup, false, false);
  setup.feedbackScope = 'cv';
  await setup.clearRefinementHistory();

  assert.equal(setup.error, '');
  assertLocks(setup, false, false);
  await setup.selectCv('alternative');
  assert.equal(setup.selectedCvId, 'alternative');
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assert.ok(setup.requests.some(row => row.request_json.scope === 'cv'));
  assertLocks(setup, false, false);

  setup = fixture.reopen() as PreparationWorkspace;
  await idle(setup);
  assert.equal(setup.error, '');
  assertLocks(setup, false, false);
  await setup.selectLetterTemplate('industry');
  assert.equal(setup.selectedTemplateId, 'industry', 'legacy history does not lock a new letter request');

  setup.feedbackScope = 'letter';
  await setup.clearRefinementHistory();
  assert.equal(setup.error, '');
  assertLocks(setup, false, false);
  await setup.selectLetterTemplate('industry');
  assert.equal(setup.selectedTemplateId, 'industry');
  await setup.copyIterationTask();
  assert.equal(setup.error, '');
  assertLocks(setup, false, false);
});

test('clearing a legacy letter with no template snapshot restores its captured template and unlocks selection', async t => {
  const fixture = mount(t, createPrivateRefinementCv());
  const setup = await prepare(fixture, 'base', { scope: 'letter' }) as PreparationWorkspace & { templates: LetterTemplate[] };
  const requestId = setup.requests[0].id;
  const capturedTemplate = JSON.parse(JSON.stringify(setup.localRequests[requestId].letterBaseline!.setup.template));
  fixture.cloud.seedProposal(requestId, { letterText: 'A legacy refined letter requiring a template reset.' });
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assertLocks(setup, false, true);

  const library = setup.templates;
  setup.templates = [];
  delete setup.letter!.templateSnapshot;
  await setup.clearRefinementHistory();

  assert.equal(setup.error, '');
  assert.equal(setup.letter!.working.body, '');
  assert.deepEqual(setup.letter!.templateSnapshot, capturedTemplate, 'the private source preserves the matching template when its library entry is gone');
  assertLocks(setup, false, false);
  setup.templates = library;
  await setup.selectLetterTemplate('industry');
  assert.equal(setup.error, '');
  assert.equal(setup.selectedTemplateId, 'industry');
});

for (const scope of ['cv', 'letter'] as const) {
  test(`failed ${scope} history clearing keeps selection locked until a successful retry`, async t => {
    const fixture = mount(t, createPrivateRefinementCv());
    addAlternativeCv(fixture);
    let setup = await prepare(fixture, 'base', { scope }) as PreparationWorkspace;
    fixture.cloud.seedProposal(setup.requests[0].id);
    await setup.syncRefinement();
    assert.equal(setup.error, '');
    assertLocks(setup, scope === 'cv', scope === 'letter');
    const originalSelection = selectedId(setup, scope);
    const rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
    fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => name === 'clear_refinement_history'
      ? { data: null, error: { message: 'History clearing is temporarily unavailable.' } }
      : rpc(name, args)) as unknown as typeof fixture.cloud.client.rpc;

    await setup.clearRefinementHistory();

    assert.match(setup.error, /History clearing is temporarily unavailable/);
    assertLocks(setup, scope === 'cv', scope === 'letter');
    await selectAlternative(setup, scope);
    assert.equal(selectedId(setup, scope), originalSelection);
    setup = fixture.reopen() as PreparationWorkspace;
    await idle(setup);
    assertLocks(setup, scope === 'cv', scope === 'letter');

    fixture.cloud.client.rpc = rpc;
    setup.feedbackScope = scope;
    await setup.clearRefinementHistory();

    assert.equal(setup.error, '');
    assertLocks(setup, false, false);
    await selectAlternative(setup, scope);
    assert.equal(selectedId(setup, scope), scope === 'cv' ? 'alternative' : 'industry');
    await setup.copyIterationTask();
    assert.equal(setup.error, '');
    assertLocks(setup, false, false);
  });
}
