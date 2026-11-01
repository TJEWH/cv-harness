import { createCloudCvSnapshot } from '../../../src/documents/privacy/domain/cloudCvPrivacy';
import { sqlText } from '../../../src/features/refinement/domain/refinementProtocolContract';
import { buildShortRefinementInstruction } from '../../../src/features/refinement/domain/applicationReference';
import { assertActiveRefinementScope } from '../../../src/features/refinement/applicationRefinement';
import { CREATED, type ProtocolCase } from './cases';
import { object } from './trace';
const json = (value: unknown) => `${sqlText(JSON.stringify(value))}::jsonb`;
const uuid = (value: string) => `${sqlText(value)}::uuid`;
const marker = (fixture: ProtocolCase) => `refinement-protocol-test:${fixture.ownerId}`;

/** Restrict all controller SQL to this run's randomly namespaced fixtures. No DDL or policy changes. */
export function seedSql(fixture: ProtocolCase): string {
  const snapshot = createCloudCvSnapshot(fixture.state, { id: fixture.snapshotId, now: new Date(CREATED) });
  return `BEGIN;
DO $fixture$
DECLARE request jsonb := ${json(fixture.request)}; review jsonb; item jsonb; feedback jsonb := '[]';
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
    VALUES (${uuid(fixture.ownerId)},'authenticated','authenticated',${sqlText(`${fixture.ownerId}@refinement-test.invalid`)},'{}','{}');
  INSERT INTO public.opportunities(id,opportunity_key,title,source_context)
    VALUES (${uuid(fixture.opportunityId)},${sqlText(marker(fixture))},'Synthetic PhD in measurement','Study reproducible measurement methods and Python tools.');
  PERFORM set_config('request.jwt.claims',${sqlText(JSON.stringify({ sub: fixture.ownerId, role: 'authenticated', is_anonymous: false }))},true);
  SET LOCAL ROLE authenticated;
  PERFORM public.create_job_application(${uuid(fixture.application.id)},${uuid(fixture.opportunityId)});
  PERFORM public.assign_job_application_cv(${uuid(fixture.application.id)},${uuid(fixture.snapshotId)},'Refinement protocol synthetic CV',${json(snapshot.content_json)},${json(snapshot.config_json)},${snapshot.cv_version},'{}');
  PERFORM public.save_refinement_state(${uuid(fixture.application.id)},${json(fixture.setup)},'{"cv":null,"letter":null}',0);
  FOR item IN SELECT value FROM jsonb_array_elements(request->'feedback') LOOP
    review := public.save_refinement_review(${uuid(fixture.application.id)},null,'feedback',jsonb_build_object('text',item->>'text','scope',item->>'scope'),(item->>'id')::uuid);
    feedback := feedback || jsonb_build_array(item || jsonb_build_object('createdAt',review->>'created_at'));
  END LOOP;
  request := jsonb_set(request,'{feedback}',feedback);
  ${fixture.name === 'missing-request' ? '-- The requested snapshot intentionally does not exist.' : 'PERFORM public.publish_refinement_request(request);'}
  ${fixture.name === 'stale-request' ? `UPDATE public.application_refinement_state SET current_${fixture.request.scope}_request_id=null,revision=revision+1 WHERE application_id=${uuid(fixture.application.id)};` : ''}
  RESET ROLE;
END;
$fixture$;
${inspectSql(fixture)}
COMMIT;`;
}
export function inspectSql(fixture: ProtocolCase): string {
  return `SELECT jsonb_build_object(
  'application_code',(SELECT application_code FROM public.applications WHERE id=${uuid(fixture.application.id)} AND user_id=${uuid(fixture.ownerId)}),
  'request',(SELECT request_json FROM public.application_refinement_requests WHERE id=${uuid(fixture.request.requestId)} AND user_id=${uuid(fixture.ownerId)}),
  'baseline',md5(jsonb_build_object(
    'application',(SELECT to_jsonb(a) FROM public.applications a WHERE id=${uuid(fixture.application.id)} AND user_id=${uuid(fixture.ownerId)}),
    'state',(SELECT to_jsonb(s) FROM public.application_refinement_state s WHERE application_id=${uuid(fixture.application.id)} AND user_id=${uuid(fixture.ownerId)}),
    'request',(SELECT to_jsonb(r) FROM public.application_refinement_requests r WHERE id=${uuid(fixture.request.requestId)} AND user_id=${uuid(fixture.ownerId)}),
    'cv',(SELECT to_jsonb(c) FROM public.cv_variants c WHERE id=${uuid(fixture.snapshotId)} AND user_id=${uuid(fixture.ownerId)})
  )::text),
  'proposals',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM public.application_refinement_proposals p WHERE request_id=${uuid(fixture.request.requestId)} AND user_id=${uuid(fixture.ownerId)}),'[]'::jsonb)
) AS fixture;`;
}
export function cleanupSql(fixture: ProtocolCase): string {
  return `BEGIN;
DELETE FROM auth.users WHERE id=${uuid(fixture.ownerId)} AND email=${sqlText(`${fixture.ownerId}@refinement-test.invalid`)};
DELETE FROM public.opportunities WHERE id=${uuid(fixture.opportunityId)} AND opportunity_key=${sqlText(marker(fixture))};
SELECT jsonb_build_object('cleaned',
  NOT EXISTS(SELECT 1 FROM auth.users WHERE id=${uuid(fixture.ownerId)}) AND
  NOT EXISTS(SELECT 1 FROM public.opportunities WHERE id=${uuid(fixture.opportunityId)}) AND
  NOT EXISTS(SELECT 1 FROM public.applications WHERE id=${uuid(fixture.application.id)}) AND
  NOT EXISTS(SELECT 1 FROM public.application_refinement_requests WHERE id=${uuid(fixture.request.requestId)}) AND
  NOT EXISTS(SELECT 1 FROM public.application_refinement_proposals WHERE request_id=${uuid(fixture.request.requestId)}) AND
  NOT EXISTS(SELECT 1 FROM public.application_refinement_protocols WHERE request_id=${uuid(fixture.request.requestId)})
) AS fixture;
COMMIT;`;
}
export function bindSeedReceipt(fixture: ProtocolCase, receipt: unknown): ProtocolCase {
  if (!object(receipt) || !/^APP-[A-F\d]{10}$/.test(String(receipt.application_code))) throw new Error('Invalid fixture seed receipt.');
  const missing = fixture.name === 'missing-request';
  if (missing ? receipt.request !== null : !object(receipt.request) || receipt.request.requestId !== fixture.request.requestId || receipt.request.applicationId !== fixture.application.id) throw new Error('Invalid fixture source receipt.');
  const request = missing ? fixture.request : receipt.request as unknown as ProtocolCase['request'];
  // Only authoritative feedback timestamps may differ from the generated input.
  const normalized = { ...request, feedback: request.feedback.map((item, i) => ({ ...item, createdAt: fixture.request.feedback[i]?.createdAt })) };
  if (JSON.stringify(normalized) !== JSON.stringify(fixture.request)) {
    // jsonb object-key order is not stable.
    const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : object(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
    if (JSON.stringify(normalize(normalized)) !== JSON.stringify(normalize(fixture.request))) throw new Error('Fixture request changed unexpectedly while seeding.');
  }
  const application = { ...fixture.application, application_code: String(receipt.application_code) };
  assertActiveRefinementScope(request.scope);
  return { ...fixture, request, application, task: buildShortRefinementInstruction(application, request.scope, { projectId: fixture.projectId, request }) };
}
