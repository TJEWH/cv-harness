import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { file, reset, sql, sqlAsync } from '../../support/database/postgres';

before(() => reset());
import { sanitizeOpportunityFeedbackUrl } from '../../../src/features/opportunities/domain/opportunityFeedbackPrivacy';
import { compileAdaptiveFeedbackSnapshot } from '../../../src/features/meta-search/domain/adaptiveFeedbackSnapshots';

test('AF-03 deterministic owner-scoped snapshots, invalidation, pins and privacy revocation', () => {
  sql(file('supabase/tests/opportunity_feedback_snapshots.sql'));
});

test('SQL and TypeScript URL boundaries agree on public job identities and hidden personal parameters', () => {
  for (const value of ['https://EXAMPLE.invalid/Jobs?jobId=123456789',
    'https://example.invalid/Jobs?first+name=Synthetic', 'https://example.invalid/Jobs#first+name=Synthetic',
    'https://example.invalid/Jobs?email=rowan%25252540example.invalid', 'https://example.invalid/Jobs?phone%00=Synthetic',
    'https://example.invalid/Jobs#x=%0Asecret', 'https://example.invalid/Jobs%5Cprivate',
    'https://example.invalid/Jobs?jobId=123456789&location=Europe', 'https://example.invalid/#/auth?token=x',
    'https://example.invalid/Jobs?redirect=%2Flogin%3Femail%3Drowan%40example.invalid', 'mailto:rowan@example.invalid']) {
    const result = JSON.parse(sql(`select to_jsonb(private.opportunity_feedback_safe_url('${value.replaceAll("'", "''")}'));`) || 'null');
    assert.equal(result, sanitizeOpportunityFeedbackUrl(value), value);
  }
});

test('concurrent snapshots reuse one revision, exclude private fields and include current application interest', async () => {
  const owner = '70000000-0000-4000-8000-000000000001';
  const search = '70000000-0000-4000-8000-000000000002';
  const opportunity = '70000000-0000-4000-8000-000000000003';
  const application = '70000000-0000-4000-8000-000000000004';
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values('${search}','${owner}','Synthetic snapshot concurrency','{"topicsAndMethods":"Sensing"}','{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    insert into public.opportunities(id,opportunity_key,title,topics) values('${opportunity}','concurrent-feedback','Synthetic sensing researcher',array['Sensing']);
    insert into public.opportunity_reviews(user_id,opportunity_id,state) values('${owner}','${opportunity}','strong_interest');
`);
  const query = `select private.compile_opportunity_feedback_snapshot('${owner}','${search}');`;
  const builds = await Promise.allSettled([sqlAsync(query), sqlAsync(query), sqlAsync(query)]);
  for (const result of builds) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : '');
  const packets = builds.map(result => JSON.parse((result as PromiseFulfilledResult<string>).value));
  for (const packet of packets) assert.deepEqual(packet, packets[0]);
  assert.equal(sql(`select count(*) from public.opportunity_search_feedback_snapshots where user_id='${owner}' and search_id='${search}';`), '1');
  sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${owner}';
    select public.review_job_opportunity('${opportunity}',now(),null);
    select public.save_opportunity_comment('${opportunity}','Synthetic private person person@example.invalid');
    select public.create_job_application('${application}','${opportunity}');
    update public.applications set notes='Private synthetic note' where id='${application}'; commit;
    update public.opportunities set contacts='[{"name":"Synthetic Person","entity_id":"synthetic-person","email":"person@example.invalid","roles":["contact"]}]' where id='${opportunity}';`);
  const unchanged = JSON.parse(sql(query));
  assert.ok(unchanged.feedback_revision > packets[0].feedback_revision, 'preparation application updates effective interest');
  assert.equal(unchanged.examples[0].interest_origin, 'application');
  assert.equal(unchanged.examples[0].interest_score, 9);
  assert.doesNotMatch(JSON.stringify(unchanged), /person@example|Private synthetic note|Synthetic Person/);
  sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${owner}';
    update public.applications set status='submitted' where id='${application}'; commit;`);
  const submitted = JSON.parse(sql(query));
  assert.ok(submitted.feedback_revision > unchanged.feedback_revision);
  assert.equal(submitted.counts.eligible, 1, 'submission and review still contribute a single current opportunity');
});

test('current SQL and TypeScript compile the same whole-set statistics and deterministic selection', async () => {
  reset();
  const owner = '71000000-0000-4000-8000-000000000001';
  const search = '71000000-0000-4000-8000-000000000002';
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values('${search}','${owner}',
      'Synthetic current snapshot parity','{"topicsAndMethods":"Sensing; Robotics"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    begin; set local request.jwt.claim.sub='${owner}';
    insert into public.opportunities(id,opportunity_key,title,institution,topics,research_summary)
      select ('72000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'parity-'||i,'Synthetic sensing role',
        'Institute '||(i%3),array['Sensing','Robotics '||(i%4)],'Evaluate physical sensing methods using prototypes.' from generate_series(1,20) i;
    insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_rating,interest_reasons)
      select '${owner}',('72000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
        case when i%3=0 then 'strong_interest' else 'interested' end,case when i%3=0 then null else (i-1)*0.5 end,
        jsonb_build_array(jsonb_build_object('category','topic','polarity','positive','target','Sensing')) from generate_series(1,20) i;
    insert into public.applications(user_id,opportunity_id,status)
      select '${owner}',('72000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'submitted' from generate_series(4,20,4) i;
    commit;`);
  const packet = JSON.parse(sql(`select private.compile_opportunity_feedback_snapshot('${owner}','${search}');`));
  const examples = JSON.parse(sql(`select jsonb_agg(private.project_opportunity_feedback('${owner}',opportunity_id) order by opportunity_id)
    from public.opportunity_reviews where user_id='${owner}';`));
  const reference = await compileAdaptiveFeedbackSnapshot({ user_id: owner, search_id: search,
    feedback_revision: packet.feedback_revision, examples });
  assert.deepEqual(packet.counts, reference.counts);
  assert.deepEqual(packet.aggregates, reference.aggregates);
  assert.deepEqual(packet.examples.map((example: { opportunity_id: string }) => example.opportunity_id), reference.examples.map(example => example.opportunity_id));
  assert.notEqual(packet.fingerprint_encoding, reference.fingerprint_encoding, 'Each deterministic hash encoding is explicitly versioned');
});

test('balanced SQL and TypeScript selection agree on ordered six strong, six rejected and four borderline examples', async () => {
  reset();
  const owner = '74000000-0000-4000-8000-000000000001';
  const search = '74000000-0000-4000-8000-000000000002';
  sql(`insert into auth.users(id) values('${owner}');
    insert into public.opportunity_search_templates(id,user_id,name,criteria,schedule) values('${search}','${owner}',
      'Synthetic balanced allocation parity','{"topicsAndMethods":"Physical sensing; Robotics"}',
      '{"frequency":"daily","intervalHours":24,"weekdays":[],"time":"08:00","timezone":"UTC","runImmediately":false}');
    insert into public.opportunities(id,opportunity_key,title,institution,topics,research_summary)
      select ('75000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'balanced-parity-'||i,'Synthetic sensing researcher',
        'Institute '||(i%4),array['Sensing','Technique '||(i%5)],'Evaluate physical sensing methods using real prototypes.'
      from generate_series(1,30) i;
    insert into public.opportunity_reviews(user_id,opportunity_id,state,interest_reasons,comment)
      select '${owner}',('75000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
        case when i<=12 then case when i%2=0 then 'very_high_interest' else 'strong_interest' end
          when i<=24 then 'not_interested' else 'interested' end,
        case when i<=12 then '[{"category":"topic","polarity":"positive","target":"Sensing"}]'::jsonb
          when i<=24 then '[{"category":"method","polarity":"negative","target":"Benchmarking"}]'::jsonb
          else '[]'::jsonb end,
        case when i%3=0 then null when i<=12 then 'Prefer direct physical sensing experiments and prototypes.'
          when i<=24 then 'The work benchmarks models without building sensing systems.'
          else 'Interesting adjacent research with an uncertain physical sensing component.' end
      from generate_series(1,30) i;`);
  const packet = JSON.parse(sql(`select private.compile_opportunity_feedback_snapshot('${owner}','${search}');`));
  const examples = JSON.parse(sql(`select jsonb_agg(private.project_opportunity_feedback('${owner}',opportunity_id) order by opportunity_id)
    from public.opportunity_reviews where user_id='${owner}';`));
  const reference = await compileAdaptiveFeedbackSnapshot({ user_id: owner, search_id: search,
    feedback_revision: packet.feedback_revision, examples });
  const ids = (values: { opportunity_id: string }[]) => values.map(example => example.opportunity_id);
  assert.equal(packet.selection_policy_version, 'opportunity-feedback-selection-v3');
  assert.equal(reference.selection_policy_version, packet.selection_policy_version);
  assert.equal(packet.examples.length, 16);
  assert.equal(new Set(ids(packet.examples)).size, 16);
  assert.ok(packet.examples.slice(0, 6).every((example: { interest_score: number }) => example.interest_score >= 8));
  assert.ok(packet.examples.slice(6, 12).every((example: { interest_score: number }) => example.interest_score === 2));
  assert.ok(packet.examples.slice(12).every((example: { interest_score: number }) => example.interest_score === 6));
  assert.deepEqual(ids(packet.examples), ids(reference.examples), 'Detailed signals, timestamp recency and diversity use the same ordering');
  assert.deepEqual(packet.counts, reference.counts);
  assert.deepEqual(packet.aggregates, reference.aggregates);
  assert.equal(packet.counts.eligible, 30);
  assert.equal(packet.counts.baseline_available, 0);
  assert.equal(packet.counts.omitted_bytes, 0);
});
