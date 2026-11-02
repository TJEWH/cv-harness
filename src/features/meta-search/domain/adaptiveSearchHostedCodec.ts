/** Trusted, dependency-free JavaScript copied verbatim into hosted instructions.
 * io.put/get are supplied by the host's documented persistent storage API.
 * This source never dispatches a request, evaluates returned text or validates an action contract.
 */
export const ADAPTIVE_HOSTED_RESPONSE_CODEC_SOURCE = String.raw`function createCVResponseCodec(io) {
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
}`;
