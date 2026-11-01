import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, test } from 'node:test';
import { reset, sql } from '../../support/database/postgres';
const owner = randomUUID();
const json = (statement: string): any => JSON.parse(sql(statement));
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

const otherOwner = randomUUID();
const opportunity = randomUUID();
const failedOpportunity = randomUUID();
const application = randomUUID();
const otherApplication = randomUUID();
const failedApplication = randomUUID();
const cv = randomUUID();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const actor = (account: string | null, body: string, anonymous = false) => `
  DO $$ BEGIN
    PERFORM set_config('request.jwt.claim.sub',${quote(account ?? '')},false);
    PERFORM set_config('request.jwt.claim.is_anonymous','${anonymous}',false);
  END $$;
  SET ROLE authenticated; ${body}; RESET ROLE;`;
const reviews = () => json('SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id,opportunity_id) FROM public.opportunity_reviews r;');
const applications = () => json('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.applications a;');
let originalReviews: unknown;

before(() => {
  reset();
  sql(`insert into auth.users(id) values('${owner}'),('${otherOwner}');
    insert into public.opportunities(id,opportunity_key,title) values('${opportunity}','synthetic-removal','Synthetic research'),('${failedOpportunity}','synthetic-failed-removal','Synthetic second research');
    insert into public.cv_variants(id,user_id,name,content_json,config_json) values('${cv}','${owner}','Synthetic preserved CV',
      '{"contact":{"name":"Synthetic researcher","location":"","role":"","email":"","phone":"","website":"","linkedin":"","github":""}}','{}');
    create function public.removal_fixture_reject_review_update() returns trigger language plpgsql as $$
      begin raise exception 'Application deletion must not touch reviews';end $$;
    create trigger removal_fixture_review_update before update on public.opportunity_reviews
      for each row execute function public.removal_fixture_reject_review_update();
    create function public.removal_fixture_reject_delete() returns trigger language plpgsql as $$
      begin if old.notes='FAIL DELETE' then raise exception 'Synthetic deletion failure';end if;return old;end $$;
    create trigger removal_fixture_delete_failure before delete on public.applications
      for each row execute function public.removal_fixture_reject_delete();`);
  for (const [account, state] of [[owner, 'not_interested'], [otherOwner, 'strong_interest']]) {
    sql(`insert into public.opportunity_reviews(user_id,opportunity_id,state,comment,interest_reasons,feedback_excluded,
      manually_archived,technical_issue_category,technical_issue_note)
      values('${account}','${opportunity}','${state}','Keep my complete private evaluation.',
        '[{"category":"topic","polarity":"negative","target":"Robotics"}]',true,true,'requirements','Keep my eligibility note.');`);
  }
  for (const [index, value] of [
    { id: application, user_id: owner, cv_variant_id: cv, notes: 'Keep unrelated rows' },
    { id: otherApplication, user_id: otherOwner, cv_variant_id: null, notes: 'Other account' },
    { id: failedApplication, user_id: owner, cv_variant_id: cv, notes: 'FAIL DELETE' },
  ].entries()) {
    const row = { ...value, opportunity_id: value.id === failedApplication ? failedOpportunity : opportunity, application_code: `APP-000000000${index}`,
      context_json: { title: 'Frozen application research' }, context_captured_at: '2000-01-01T00:00:00Z',
      completed_checklist_keys: ['requirements:degree'], status_history: [{ status: 'preparation' }],
      created_at: '2000-01-01T00:00:00Z', updated_at: '2000-01-02T00:00:00Z' };
    const columns = Object.keys(row).join(',');
    sql(`insert into public.applications(${columns}) select ${columns} from jsonb_populate_record(null::public.applications,${literal(row)});`);
  }
  originalReviews = reviews();
});

test('current delete RPC retains invoker permissions and authenticated-only execution', () => {
  assert.deepEqual(json(`select jsonb_build_object('security_definer',prosecdef,'config',proconfig,
    'anonymous',has_function_privilege('anon',oid,'execute'),
    'authenticated',has_function_privilege('authenticated',oid,'execute'))
    from pg_proc where oid='public.remove_job_application(uuid)'::regprocedure;`),
  { security_definer: false, config: ['search_path=""'], anonymous: false, authenticated: true });
});

test('confirmed deletion and its retry preserve every review field, other application and CV snapshot', () => {
  const before = applications();
  const beforeCv = sql('SELECT to_jsonb(c) FROM public.cv_variants c;');
  assert.equal(sql(actor(owner, `SELECT public.remove_job_application('${application}')`)), application);
  assert.deepEqual(applications(), before.filter((row: { id: string }) => row.id !== application));
  assert.deepEqual(reviews(), originalReviews);
  assert.equal(sql('SELECT to_jsonb(c) FROM public.cv_variants c;'), beforeCv);
  assert.equal(sql(actor(owner, `SELECT public.remove_job_application('${application}')`)), application);
  assert.deepEqual(reviews(), originalReviews);
});

test('unknown and another owner’s application IDs return the same acknowledgement without changing rows', () => {
  const before = applications();
  const missing = randomUUID();
  assert.equal(sql(actor(owner, `SELECT public.remove_job_application('${otherApplication}')`)), otherApplication);
  assert.equal(sql(actor(owner, `SELECT public.remove_job_application('${missing}')`)), missing);
  assert.deepEqual(applications(), before);
  assert.deepEqual(reviews(), originalReviews);
  // The explicit owner predicate also holds for callers with RLS bypass.
  assert.equal(sql(`DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub','${owner}',false); END $$;
    SELECT public.remove_job_application('${otherApplication}');`), otherApplication);
  assert.deepEqual(applications(), before);
});

test('signed-out and anonymous callers cannot delete an application', () => {
  const before = applications();
  assert.throws(() => sql(actor(null, `SELECT public.remove_job_application('${failedApplication}')`)), /A signed-in account is required/);
  assert.throws(() => sql(actor(owner, `SELECT public.remove_job_application('${failedApplication}')`, true)), /A signed-in account is required/);
  assert.throws(() => sql(`SET ROLE anon; SELECT public.remove_job_application('${failedApplication}');`), /permission denied for function/);
  assert.deepEqual(applications(), before);
  assert.deepEqual(reviews(), originalReviews);
});

test('database failure rolls back deletion and leaves review revisions and all cached facts intact', () => {
  const before = applications();
  assert.throws(() => sql(actor(owner, `SELECT public.remove_job_application('${failedApplication}')`)), /Synthetic deletion failure/);
  assert.deepEqual(applications(), before);
  assert.deepEqual(reviews(), originalReviews);
});
