import assert from 'node:assert/strict';
import test from 'node:test';
import { documents, idle, mount, prepare } from '../../support/workflows/refinement';

test('loading an unprepared application syncs available history without publishing a request or reporting an error', async t => {
  const fixture = mount(t), setup = fixture.setup;
  await idle(setup);

  assert.equal(setup.error, '');
  assert.equal(setup.syncing, false);
  assert.equal(setup.tab, 'preparation');
  assert.equal(setup.requests.length, 0);
  assert.deepEqual(fixture.database.application_refinement_requests, []);
  assert.deepEqual(fixture.database.cv_variants, []);
});

test('loading a prepared application publishes its working sources once without leaving the restored stage', async t => {
  const fixture = mount(t); let setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await setup.selectLetterTemplate('research');
  setup.feedbackScope = 'letter'; setup.updateLetter('Prepared draft awaiting its first sync.');
  setup.tab = 'tracking'; await idle(setup);
  assert.equal(setup.requests.length, 0);
  const working = setup.baselineSignature;

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.equal(setup.tab, 'tracking');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].request_json.letter.text, 'Prepared draft awaiting its first sync.');
  assert.equal(setup.baselineSignature, working);
  const requestId = setup.requests[0].id, savedCloud = JSON.stringify(fixture.database);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.tab, 'tracking');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].id, requestId);
  assert.equal(JSON.stringify(fixture.database), savedCloud, 'reopening unchanged prepared sources must not create another round or setup revision');
});

for (const stage of ['preparation', 'tracking']) test(`loading an application applies its current proposal while preserving the ${stage} stage`, async t => {
  const fixture = mount(t); let setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = stage; await idle(setup);
  const requestId = setup.requests[0].id;
  const proposal = fixture.cloud.seedProposal(requestId, { letterText: `Proposal loaded in ${stage}.` });

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.equal(setup.tab, stage);
  assert.equal(setup.selectedProposalId, proposal.id);
  assert.equal(setup.letter!.working.body, `Proposal loaded in ${stage}.`);
  assert.equal(setup.reviewActive, false);
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].id, requestId);
  assert.equal(setup.localRequests[requestId].acceptances?.length, 1);
  const applied = documents(setup);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.tab, stage);
  assert.equal(documents(setup), applied, 'reloading an applied proposal must preserve the saved working document and its acceptance receipt');
  assert.equal(setup.requests.length, 1);
});

test('an inactive application waits until it becomes active before syncing its prepared draft', async t => {
  const fixture = mount(t); let setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await setup.selectLetterTemplate('research');
  setup.feedbackScope = 'letter'; setup.updateLetter('Draft in an inactive application.');
  Reflect.set(fixture.props, 'active', false);
  setup = fixture.reopen(); await idle(setup);
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 0);

  Reflect.set(fixture.props, 'active', true); await idle(setup);

  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].request_json.letter.text, 'Draft in an inactive application.');
  const requestId = setup.requests[0].id;
  Reflect.set(fixture.props, 'active', false); await idle(setup);
  Reflect.set(fixture.props, 'active', true); await idle(setup);
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].id, requestId);
});

test('loading a prepared application without a cloud client preserves its draft without a sync error', async t => {
  const fixture = mount(t); let setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await setup.selectLetterTemplate('research');
  setup.feedbackScope = 'letter'; setup.updateLetter('Prepared draft without a cloud connection.');
  const working = JSON.parse(documents(setup));
  working.record.detached = true; // Loading preserves the application copy independently of its source template.
  Reflect.set(fixture.props, 'client', null);

  setup = fixture.reopen(); await idle(setup);

  assert.equal(setup.error, '');
  assert.equal(setup.syncing, false);
  assert.equal(setup.requests.length, 0);
  assert.deepEqual(fixture.database.application_refinement_requests, []);
  assert.deepEqual(JSON.parse(documents(setup)), working);
});

test('sync publishes prepared working sources and applies a proposal returned for that snapshot', async t => {
  const fixture = mount(t), setup = fixture.setup;
  await idle(setup);
  await setup.selectCv('base'); await setup.selectLetterTemplate('research');
  setup.tab = 'refinement'; await idle(setup);
  setup.feedbackScope = 'letter'; setup.updateLetter('My existing working letter.');
  const working = documents(setup), rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(name, args);
    if (name === 'publish_refinement_request' && !result.error) fixture.cloud.seedProposal(undefined, { letterText: 'Fresh proposed letter.' });
    return result;
  }) as unknown as typeof fixture.cloud.client.rpc;

  await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].request_json.letter.text, 'My existing working letter.');
  assert.equal(setup.proposals.length, 1);
  assert.equal(setup.reviewActive, false);
  assert.equal(setup.previewLetterContent?.body, 'Fresh proposed letter.');
  assert.equal(setup.letter!.working.body, 'Fresh proposed letter.');
  const before = JSON.parse(working);
  assert.deepEqual(setup.record!.state, before.record.state);
  assert.equal(setup.localRequests[setup.requests[0].id].letterBaseline?.text, 'My existing working letter.');
  assert.equal(fixture.creations.length, 0);
});

test('repeated sync reuses the current snapshot while retrieving newly returned proposals', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const requestId = setup.requests[0].id, savedCloud = JSON.stringify(fixture.database);

  await setup.syncRefinement(); await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(JSON.stringify(fixture.database), savedCloud, 'unchanged sources must not write another request or setup revision');
  const proposal = fixture.cloud.seedProposal(requestId, { letterText: 'Returned after the previous sync.' });
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 1);
  assert.equal(setup.requests[0].id, requestId);
  assert.equal(setup.selectedProposalId, proposal.id);
  assert.equal(setup.previewLetterContent?.body, 'Returned after the previous sync.');
  assert.equal(setup.letter!.working.body, 'Returned after the previous sync.');
  assert.equal(setup.localRequests[requestId].acceptances?.length, 1);
});

test('sync does not apply stale proposals over working corrections made during comparison', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Candidate currently under review.' });
  await setup.checkProposals();
  setup.updateLetter('A working correction made after publication.');
  const working = documents(setup);
  fixture.cloud.seedProposal(setup.requests[0].id, { letterText: 'Another candidate available for review.' });
  const previousRequestId = setup.requests[0].id;

  await setup.syncRefinement();

  assert.equal(setup.proposals.length, 2);
  assert.equal(setup.error, '');
  assert.notEqual(setup.requests[0].id, previousRequestId, 'sync publishes the corrected working source as a fresh round');
  assert.equal(setup.requests[0].request_json.letter.text, 'A working correction made after publication.');
  assert.equal(setup.localRequests[previousRequestId].acceptances?.length || 0, 0, 'stale candidates must remain unapplied');
  assert.equal(documents(setup), working);
  assert.equal(fixture.creations.length, 0);
});

test('sync publishes changed working sources before retrieving their proposals', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.tab = 'refinement'; await idle(setup);
  const firstId = setup.requests[0].id;
  setup.updateLetter('Corrected working source for the next round.');
  const originalCv = JSON.stringify(setup.record!.state), rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(name, args);
    if (name === 'publish_refinement_request' && !result.error) fixture.cloud.seedProposal(undefined, { letterText: 'Proposal based on corrected sources.' });
    return result;
  }) as unknown as typeof fixture.cloud.client.rpc;

  await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(setup.requests.length, 2);
  assert.notEqual(setup.requests[0].id, firstId);
  assert.equal(setup.requests[0].request_json.letter.text, 'Corrected working source for the next round.');
  assert.equal(setup.proposals[0].request_id, setup.requests[0].id);
  assert.equal(setup.previewLetterContent?.body, 'Proposal based on corrected sources.');
  assert.equal(setup.letter!.working.body, 'Proposal based on corrected sources.');
  assert.equal(JSON.stringify(setup.record!.state), originalCv);
});

test('sync loads proposals for an approved scope without reopening or republishing it', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  await setup.approve('letter');
  setup.tab = 'refinement'; await idle(setup);
  setup.feedbackScope = 'letter';
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id);
  const working = documents(setup), savedCloud = JSON.stringify(fixture.database);

  await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(setup.proposals[0].id, proposal.id);
  assert.equal(JSON.stringify(fixture.database), savedCloud);
  assert.equal(documents(setup), working);
  assert.ok(setup.letter!.finalRevisionId);
});

test('sync can retrieve proposal history when the local source documents are unavailable', async t => {
  const fixture = mount(t), setup = await prepare(fixture);
  const proposal = fixture.cloud.seedProposal(setup.requests[0].id);
  setup.record = null; setup.letter = null;
  const savedCloud = JSON.stringify(fixture.database);

  await setup.syncRefinement();

  assert.equal(setup.error, '');
  assert.equal(setup.proposals[0].id, proposal.id);
  assert.equal(JSON.stringify(fixture.database), savedCloud);
  assert.equal(setup.record, null); assert.equal(setup.letter, null);
});

test('a failed sync publication preserves working sources and retries the same pending request', async t => {
  const fixture = mount(t), setup = await prepare(fixture, 'base', { scope: 'letter' });
  setup.updateLetter('Corrected source awaiting sync.');
  const working = documents(setup), rpc = fixture.cloud.client.rpc.bind(fixture.cloud.client);
  const attempts: string[] = [];
  fixture.cloud.client.rpc = (async (name: string, args: Record<string, unknown>) => {
    if (name === 'publish_refinement_request') {
      attempts.push((args.p_request as { requestId: string }).requestId);
      if (attempts.length === 1) return { data: null, error: new Error('Snapshot temporarily unavailable') };
    }
    return rpc(name, args);
  }) as unknown as typeof fixture.cloud.client.rpc;

  await setup.syncRefinement();
  assert.match(setup.error, /Snapshot temporarily unavailable/);
  assert.equal(setup.requests.length, 1);
  assert.equal(documents(setup), working);
  await setup.syncRefinement();
  assert.equal(setup.error, '');
  assert.equal(attempts.length, 2); assert.equal(attempts[0], attempts[1]);
  assert.equal(setup.requests.length, 2);
  assert.equal(setup.requests[0].request_json.letter.text, 'Corrected source awaiting sync.');
  assert.equal(documents(setup), working);
});
