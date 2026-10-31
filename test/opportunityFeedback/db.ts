import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// No URL/env override: this destructive fixture runner can only use its labelled,
// network-disabled disposable container. It never connects to Supabase.
export const container = 'cv-adaptive-feedback-test';
export const database = 'adaptive_feedback_test';
const inspect = spawnSync('docker', ['inspect', container], { encoding: 'utf8' });
if (inspect.status !== 0) throw new Error('Start the isolated AF-01 Docker fixture described in docs/opportunity-feedback-signals.md.');
const configuration = JSON.parse(inspect.stdout)[0];
if (configuration?.Config?.Labels?.['cv-builder.test-suite'] !== 'adaptive-feedback'
  || configuration?.HostConfig?.NetworkMode !== 'none'
  || configuration?.Mounts?.some((mount: { Type: string }) => mount.Type === 'bind')
  || configuration?.HostConfig?.PortBindings && Object.keys(configuration.HostConfig.PortBindings).length) {
  throw new Error('Refusing to reset an unlabelled, networked, bind-mounted or port-published database.');
}
const lock = '/tmp/cv-adaptive-feedback-test.lock';
try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  const previous = Number(readFileSync(lock, 'utf8'));
  let alive = false;
  try { process.kill(previous, 0); alive = true; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') alive = true; }
  if (alive) throw new Error(`AF-01 suite already running (PID ${previous}).`);
  unlinkSync(lock);
  writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
}
process.once('exit', () => { try { unlinkSync(lock); } catch { /* already cleaned */ } });
const args = ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'];
export function sql(statement: string): string {
  const result = spawnSync('docker', args, { input: statement, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Isolated AF-01 SQL failed.');
  return result.stdout.trim();
}
export function sqlAsync(statement: string, onOutput?: (chunk: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args); let output = ''; let error = '';
    child.stdout.on('data', value => { output += value; onOutput?.(String(value)); });
    child.stderr.on('data', value => { error += value; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    child.stdin.end(statement);
  });
}
export function file(path: string): string { return readFileSync(new URL(path, import.meta.url), 'utf8'); }
export function reset(options: { searchProtocol?: boolean } = {}) {
  if (sql('select current_database();') !== database) throw new Error('Unexpected fixture database.');
  sql(`drop schema if exists private cascade; drop schema if exists auth cascade; drop schema public cascade;
    create schema public; create schema auth;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$;
    create table auth.users(id uuid primary key, aud text, role text, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,
        jsonb_build_object('is_anonymous', coalesce(nullif(current_setting('request.jwt.claim.is_anonymous',true),'')::boolean,false))) $$;
    grant usage on schema auth,public to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;`);
  sql(file('../../supabase/schema.sql'));
  if (options.searchProtocol) {
    const bootstrap = file('./fixtures/legacy-search-bootstrap.sql');
    const provenance = JSON.parse(file('./fixtures/legacy-search-bootstrap.json'));
    if (createHash('sha256').update(bootstrap).digest('hex') !== provenance.sha256) throw new Error('The pinned legacy bootstrap fixture changed.');
    sql(bootstrap);
    sql(file('../../supabase/opportunity_merge_v4.sql'));
    sql(file('../../supabase/opportunity_canonical_v5.sql'));
    sql(file('../../supabase/opportunity_meta_search_autosave.sql'));
  } else sql(file('./fixtures/prerequisites.sql'));
}

/** Explicit latest-contract fixture upgrade; prefix suites keep their historical setup. */
export function upgradeCurrentFeedbackContract(beforeDefaults?: () => void) {
  for (const name of ['opportunity_description.sql', 'application_removal_review.sql', 'opportunity_evaluation.sql', 'opportunity_feedback_defaults.sql', 'opportunity_search_adaptive_payload_contract.sql']) {
    if (name === 'opportunity_feedback_defaults.sql') beforeDefaults?.();
    sql(file(`../../supabase/${name}`));
  }
}
