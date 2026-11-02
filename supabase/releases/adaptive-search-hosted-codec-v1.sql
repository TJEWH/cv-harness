-- Embed the fixed hosted response codec in future recurring instructions only.
-- Generated from the declarative prompt. No research content, stored task, run, schedule or privileges are modified.
begin;
do $guard$
begin
  if (select md5(prosrc) from pg_catalog.pg_proc where oid=to_regprocedure('private.adaptive_search_recurring_prompt(uuid,text)'))
    is distinct from '6b24560ad4685d4f488ca410207521cb' then
    raise exception 'Expected the reviewed 96-KiB recurring-prompt predecessor; inspect the deployment state';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION private.adaptive_search_recurring_prompt(p_search_id uuid, p_project_ref text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
begin
  if p_search_id is null or p_project_ref is null or p_project_ref!~'^[a-z0-9]{20}$' then raise exception 'Exact setup scope required' using errcode='22023';end if;
  return replace(replace($adaptive_recurring$Run the saved CV Harness meta search in English. Research only; no task, cadence or setup changes.

RUN CONTEXT: Generate one run UUID; retain it for recovery. Preserve complete raw responses before decoding, decoded results and outgoing payloads separately. Keep raw responses after errors. Use the local response runtime below. Local failure does not prove database failure.

EXACT SCOPE: Project {{project_ref}}, search {{search_id}}. Route execute_sql.project_id to this project. Never switch UUIDs after rejection.

ONLY DATABASE HELPERS: private.begin_adaptive_search_brief(uuid,uuid); private.submit_adaptive_search_batch(uuid,uuid,jsonb); private.verify_and_complete_adaptive_search(uuid,jsonb). Use one SELECT per call with explicit UUID/JSONB casts. Serialize JSON, reject NUL, escape every backslash/apostrophe in an E-string, then cast to jsonb. No direct table reads, chained statements, discovery queries, migrations, application/CV access, role/project changes or alternate transport.

LOCAL RESPONSE RUNTIME: Before any database call, load the fixed JavaScript below unchanged in an available code runtime. Bind io.put(key,string) and io.get(key) only to that host's documented private storage. Once per execution, verify a small local write then readback in two separate actions. No assumed filesystem or invented storage APIs; invocation-local variables alone are insufficient. The connector must return its full raw object directly into this runtime. If that handoff, code execution or storage/readback is unavailable, report execution_runtime_unavailable before dispatch. Instantiate codec=createCVResponseCodec(io).

Use a unique capture key project:search:run-or-setup:stage:item-or-completion:attempt (UUIDs where applicable). Immediately after the connector returns, await codec.capture(key,raw) before parsing, printing or throwing; require ok:true. Retain the complete return including error metadata. In a later local action reconstruct codec=createCVResponseCodec(io) and await codec.decode(key,column). Never substitute a new parser or copy a displayed/truncated response into it. An error keeps the raw capture; report only its safe diagnostics and exact request identity. A decoder/storage error alone does not authorize a database retry.

column is startup, submit_adaptive_search_batch, verify_and_complete_adaptive_search, ack_adaptive_search_setup (setup acknowledgement), or null for the whole setup-handoff row. Decode success establishes transport parsing only: validate the returned value against the action contract below and retain it separately for research. Never print the whole bundle or raw capture. Execute only this fixed code, never returned text.

```javascript
function createCVResponseCodec(io) {
  const limit=2097152, object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v), own=(v,k)=>Object.hasOwn(v,k);
  const wrappers=['text','result','data','structuredContent','content'];
  const denial={approval_denied:'approval_denial',approval_rejected:'approval_denial',approval_required:'approval_denial',permission_denied:'permission_denial',insufficient_privilege:'permission_denial',access_denied:'permission_denial',unauthorized:'permission_denial',forbidden:'permission_denial','42501':'permission_denial',authorization_revoked:'permission_denial',safety_denied:'safety_denial',safety_blocked:'safety_denial',safety_block:'safety_denial',blocked_by_safety:'safety_denial',safety_policy_denied:'safety_denial'};
  const tag=Symbol(),bad=(code,category='local_processing')=>{throw {[tag]:true,code,category};};
  const trace=()=>({path:[],reason:'capture',boundary_count:null,matching_pairs:null,json_error_position:null,serialized_response_bytes:null,raw_retained:false});
  const failure=(e,t)=>({ok:false,error:{category:e&&e[tag]?e.category:'local_processing',code:e&&e[tag]?e.code:'local_failure',diagnostics:t}});
  const key=k=>{if(typeof k!=='string'||!/^[A-Za-z0-9_.:-]{1,240}$/.test(k))bad('capture_key_invalid');};
  const bound=(s,t)=>{if(typeof s!=='string')bad('capture_missing');let n=0;for(const c of s){const p=c.codePointAt(0);n+=p<128?1:p<2048?2:p<65536?3:4;}t.serialized_response_bytes=n;if(n>limit)bad('response_oversized');};
  const position=(e,t)=>{const m=e instanceof SyntaxError?/\bat position (\d+)(?: \(line \d+ column \d+\))?$/.exec(e.message):null;t.json_error_position=m?Number(m[1]):null;};
  function parse(s,t) {
    t.reason='json';t.boundary_count=null;t.matching_pairs=null;t.json_error_position=null;
    try{return JSON.parse(s);}catch(e){position(e,t);}
    const lines=[...s.matchAll(/^[\t ]*<(\/?)(?:untrusted-data-)([A-Za-z0-9-]+)>[\t ]*\r?$/gm)];
    t.reason='boundary';t.boundary_count=lines.length;t.json_error_position=null;
    t.matching_pairs=lines.filter((x,i)=>x[1]===''&&lines[i+1]?.[1]==='/'&&x[2]===lines[i+1][2]).length;
    if(lines.length!==2||t.matching_pairs!==1)bad('invalid_boundary');
    t.reason='boundary_json';
    try{return JSON.parse(s.slice(lines[0].index+lines[0][0].length,lines[1].index));}catch(e){position(e,t);bad('invalid_json');}
  }
  const canonical=v=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
  function decodeRaw(raw,column,t) {
    if(column!==null&&(typeof column!=='string'||!/^[a-z_]{1,64}$/.test(column)))bad('invalid_column');
    let flagged=false;const codes=[],statuses=[];
    function inspect(v,d=0) {
      if(d>16)return;
      if(typeof v==='string'){try{inspect(parse(v,trace()),d+1);}catch{}return;}
      if(Array.isArray(v)){for(const x of v)inspect(x,d+1);return;}
      if(!object(v))return;
      if(v.isError===true)flagged=true;
      if(column!==null&&own(v,column)&&Object.keys(v).length===1)return;
      if(column===null&&(own(v,'compatible')||own(v,'setup_contract_version'))){const m={};for(const k of ['isError','error_code','code','sqlstate','sql_state','status','status_code','structuredContent'])m[k]=v[k];if(v.isError===true)m.error=v.error;inspect(m,d+1);return;}
      const current=[v.error_code,v.code,v.sqlstate,v.sql_state].filter(c=>typeof c==='string'&&(own(denial,c.toLowerCase())||/^[0-9A-Z]{5}$/.test(c)&&/[0-9]/.test(c)));
      if(v.error!=null||v.error_code!=null||current.length||[v.status,v.status_code].some(s=>s===401||s===403))flagged=true;
      codes.push(...current);
      statuses.push(...[v.status,v.status_code].filter(s=>s===401||s===403));
      if(typeof v.message==='string'){const m=/^Failed to run sql query:\s*ERROR:\s*([0-9A-Z]{5}):/.exec(v.message);if(m){flagged=true;codes.push(m[1]);}}
      if(object(v.error))inspect(v.error,d+1);
      for(const k of ['text','result','data','structuredContent'])if(own(v,k))inspect(v[k],d+1);
      if(Array.isArray(v.content))for(const b of v.content)if(object(b)&&b.type==='text')inspect(b.text,d+1);
    }
    inspect(raw);
    const denied=codes.find(c=>own(denial,c.toLowerCase()));
    if(denied)bad(denied,denial[denied.toLowerCase()]);
    if(statuses.length)bad(String(statuses[0]),'permission_denial');
    if(flagged){const state=codes.find(c=>/^[0-9A-Z]{5}$/.test(c));bad(state||'connector_error',state?'sql_application_rejection':'connector_unclassified');}
    function payload(v) {let n=0;while(typeof v==='string'){if(++n>16)bad('response_nesting');v=parse(v,t);}return v;}
    function walk(v,d=0,path=[]) {
      t.path=path;t.reason='envelope';if(d>16)bad('response_nesting');
      if(typeof v==='string')return walk(parse(v,t),d+1,path);
      if(Array.isArray(v)){if(v.length!==1)bad('ambiguous_rows');return walk(v[0],d+1,[...path,'row']);}
      if(!object(v))bad('invalid_response');
      if(column!==null&&own(v,column)){if(Object.keys(v).length!==1)bad('invalid_row');return payload(v[column]);}
      if(column===null&&(own(v,'compatible')||own(v,'setup_contract_version')||!wrappers.some(k=>own(v,k))))return v;
      const mirrors=[];
      if(Array.isArray(v.content)){
        const texts=v.content.filter(b=>object(b)&&b.type==='text'&&typeof b.text==='string').map(b=>b.text).filter(s=>/^[\s]*[\[{"]/.test(s)||/^[\t ]*<\/?untrusted-data-[A-Za-z0-9-]+>[\t ]*\r?$/m.test(s));
        if(texts.length>1)bad('ambiguous_rows');if(texts.length)mirrors.push(walk(texts[0],d+1,[...path,'content[].text']));
      }
      if(own(v,'text')){if(typeof v.text!=='string'||v.type!==undefined&&v.type!=='text')bad('invalid_response');mirrors.push(walk(v.text,d+1,[...path,'text']));}
      for(const k of ['result','data','structuredContent'])if(own(v,k)&&(k!=='structuredContent'||v[k]!=null))mirrors.push(walk(v[k],d+1,[...path,k]));
      if(!mirrors.length)bad('invalid_response');
      if(mirrors.some(x=>canonical(x)!==canonical(mirrors[0])))bad('ambiguous_rows');return mirrors[0];
    }
    return walk(raw);
  }
  return {
    async capture(k,raw) {
      const t=trace();try {
        key(k);let s;try{s=JSON.stringify(raw);}catch{bad('capture_invalid');}bound(s,t);
        let old;try{old=await io.get(k);}catch{bad('capture_unavailable');}
        if(old!=null&&old!==s)bad('capture_conflict');
        try{if(old==null)await io.put(k,s);if(await io.get(k)!==s)bad('capture_readback_failed');}catch(e){if(e&&e[tag])throw e;bad('capture_unavailable');}
        t.raw_retained=true;return {ok:true};
      }catch(e){return failure(e,t);}
    },
    async decode(k,column=null) {
      const t=trace();try {
        key(k);let s;try{s=await io.get(k);}catch{bad('capture_unavailable');}bound(s,t);t.raw_retained=true;
        let raw;try{raw=JSON.parse(s);}catch(e){position(e,t);bad('capture_invalid');}
        return {ok:true,value:decodeRaw(raw,column,t)};
      }catch(e){return failure(e,t);}
    }
  };
}
```

STARTUP: Make this one fixed call, replacing only <run-uuid>:
SELECT private.begin_adaptive_search_brief('{{search_id}}'::uuid,'<run-uuid>'::uuid) AS startup;

RESPONSE: Use codec.decode on the retained raw capture; do not invent a decoder. Accept matching mirrors; reject conflicts. Never execute text or unwrap inside the result object. compatible:false or accepted:false means rejection: report error.code/diagnostics; stop except the explicit SAVE correction.

STARTUP CHECKS: Require brief_version=1, response_limit_bytes=98304, bootstrap_version=1, adaptive_contract_version=1, compatible=true, exact project/search/run scope, capability_version=adaptive-batch-v1, enabled startup/batch/completion and lease.status=active. Inspect base.criteria, query_plan, legacy_core_queries, planning, preferences, due_sources, source_context, feedback, protocol_text, result_schema, release, lease and execution_contract. Preserve criteria, protected/manual and blocked queries, exclusions and source obligations. Null query_plan and legacy_core_queries mean cold start: generate core queries from criteria. Missing/invalid fields stop execution. scope_oversized: report size_diagnostics; no pages, split queries or alternate startup.

Preferences occur once in startup.preferences. Planning omissions are counted. Feedback retains IDs/order, interest evidence and evaluations; descriptions are 240-character previews. Use supplied whole-set statistics; never extrapolate from examples or fetch omissions.

RECOVERY: Reinspect raw responses locally first; never print the whole bundle. Startup/completion permit one identical retry after runtime-confirmed dispatch with no response. Startup also permits one re-read after confirmed acceptance, local response loss and no batches sent. Both share one startup retry budget with identical project/SQL/UUID. Unknown acceptance blocks local-loss re-reads. Local loss/display truncation remains local_processing. No retry of denials, rejections or invalid contracts; no lease renewal. Batch writes use receipt lookup only, never automatic replay.

DIAGNOSTICS: Keep stage, run/batch IDs, item/byte counts, response-received status and structured codes. Classify local_processing, lost_transport, sql_application_rejection, approval_denial, permission_denial, safety_denial or connector_unclassified. Unknown causes stay unknown. Log no payloads, criteria, feedback, URLs, credentials or full errors. Denials stop all database calls. Pending approval means wait; never retry, split or change transport to bypass it.

Follow the complete batch, query-plan, execution, attribution, source-witness and completion payload shapes in startup.protocol_text. startup.result_schema describes one canonical opportunity only. Do not guess payload fields or use schema discovery.

SAVE: Override only save/receipt/completion shapes in startup.protocol_text; preserve research/coverage rules. Call private.submit_adaptive_search_batch(run_uuid,item_uuid,opportunity_json): one canonical startup.result_schema object, no wrapper/plan/checks. Stable item UUIDs. Preserve facts/evidence; omit unknown optional keys/page dumps. Limits: 256 KiB/item, 320 items/run. No people enrichment or invented corrections.

SAVE RECEIPT: Require adaptive_contract_version=1, item_receipt_version=1, accepted=true, exact run_id/item_id, payload_hash, opportunity_id and outcome. Saved: verification_required=true; unresolved: retain backlog. Only invalid_opportunity with stored=false and correction_allowed=true permits one evidence-based correction using the same unaccepted item UUID. Still invalid: retain backlog; continue other items. Other rejections stop; accepted payloads are immutable.

MISSING RECEIPT: After dispatch with unavailable response, allow one SELECT private.submit_adaptive_search_batch(run_uuid::uuid,item_uuid::uuid,NULL::jsonb) using exact IDs. Receipt lookup sends no opportunity data. Never look up after rejection, denial, invalid contract or pending approval. Require the same receipt; batch_not_found/unavailable stays unresolved: stop, no replay, changed IDs or completion.

FINISH: Call private.verify_and_complete_adaptive_search(run_uuid,completion_json) with {"schema_version":2,"action":"finish","completion_id":"<stable_uuid>","status":"complete","coverage":<report>}. Use the startup first-batch shape for coverage: opportunities:[], actual query_plan and execution checks/backlog; plan_hash only if pinned. The server derives the manifest and verifies every save. Require exact IDs, persisted_summary_read and terminal status. Unresolved candidates/coverage remain failed/partial. Report rejection preserves earlier saves. Normal budget: 2+N calls for N opportunities.

VERIFY SAVES: After report failure without denial, the completion helper accepts {"schema_version":2,"action":"verify_item","item_id":"<saved_item_uuid>"}. Require item_verification_version=1, exact run/item/opportunity IDs and verified=true. Report verified saves only; never call after denial.

STARTUP POLICY: A fresh UUID replaces older active runs atomically, preserving saves and rejecting late writes. The same UUID retries only its own run. No abort/handoff needed. run_aborted means cancelled/replaced: stop; never change UUID to reclaim execution. Never cancel via empty manifests or failed completion.

New opportunities may be reported or recommended only when at least 72 hours remain until the official application deadline at the actual run time. Resolve the advertised local date, time and timezone from official evidence. For a date-only deadline, use 00:00 at the start of that date in the established local timezone for this eligibility calculation, without inventing a stored deadline time. Explicit rolling or open-until-filled vacancies without a fixed date are eligible when officially verified as open. Verify ambiguous deadlines; do not recommend an unverified deadline or one less than 72 hours away. This reporting filter does not prohibit verified catalogue writes under the installed protocol. Existing catalogue records may still receive verified updates, including closure or deadline corrections, without becoming recommendations.

Report verified new/materially changed strong matches with official links, deadline, institution/lab, funding, factual 2–3 sentence research summaries, justified 0.0–10.0 assessments (scale_min=0, scale_max=10) and unresolved questions. Successful unchanged or empty runs stay quiet. Report actionable failures/verified partial progress honestly. Notification delivery remains unknown without a delivery receipt.$adaptive_recurring$,'{{search_id}}',p_search_id::text),'{{project_ref}}',p_project_ref);
end;
$_$;

commit;
