import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { CASE_NAMES, createCase, suiteFingerprint, type CaseName, type ProtocolCase } from './cases';
import { bindSeedReceipt, cleanupSql, inspectSql, seedSql } from './fixtures';
import { decodeResult, isSqlTool, object, readTrace, verifyTrace } from './trace';
import { generateCases } from './generate';
import { parseRefinementProposal } from '../../../src/features/refinement/applicationRefinement';

export function codexArguments(directory: string): string[] {
  return ['exec', '--sandbox', 'read-only', '-c', 'approval_policy="on-request"', '-c', 'approvals_reviewer="auto_review"', '--ephemeral', '--skip-git-repo-check', '--json', '-C', directory,
    '-c', 'project_doc_max_bytes=0', '-c', 'developer_instructions=""', '-c', 'web_search="disabled"',
    '--disable', 'shell_tool', '--disable', 'plugins', '--disable', 'multi_agent', '--disable', 'memories',
    '--disable', 'browser_use', '--disable', 'computer_use', '--disable', 'code_mode',
    '--enable', 'skip_host_skill_discovery', '-c', 'suppress_unstable_features_warning=true', '-'];
}
async function runAgent(prompt: string, destination: string, timeoutMs: number) {
  const directory = await mkdtemp(join(tmpdir(), 'refinement-agent-'));
  // Only the production-generated task is placed in the agent's working directory.
  await writeFile(join(directory, 'task.md'), prompt);
  await writeFile(`${destination}.jsonl`, '');
  await writeFile(`${destination}.stderr.log`, '');
  let stdout = '', stderr = '';
  try {
    const status = await new Promise<number>((accept, reject) => {
      const child = spawn(process.env.CODEX_CLI_PATH || 'codex', codexArguments(directory), { stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, timeoutMs);
      child.stdout.on('data', chunk => { stdout += String(chunk); appendFileSync(`${destination}.jsonl`, chunk); });
      child.stderr.on('data', chunk => { stderr += String(chunk); appendFileSync(`${destination}.stderr.log`, chunk); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); accept(code ?? 124); });
      child.stdin.end(prompt);
    });
    await writeFile(`${destination}.jsonl`, stdout);
    await writeFile(`${destination}.stderr.log`, stderr);
    const trace = readTrace(stdout);
    if (status !== 0) trace.errors.push(`Codex exited ${status}; inspect stderr and startup/authentication configuration.`);
    return trace;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
function unwrap(value: unknown) {
  const decoded = decodeResult(value);
  if (!Array.isArray(decoded) || decoded.length !== 1 || !object(decoded[0]) || !object(decoded[0].fixture)) throw new Error('Invalid controller SQL receipt.');
  return decoded[0].fixture;
}
async function controller(fixture: ProtocolCase, query: string, destination: string, timeout: number) {
  const prompt = `Run exactly the SQL below using Supabase execute_sql in project ${fixture.projectId}. This is an authorized refinement regression test with disposable, invented records. The fixture owner is ${fixture.ownerId}. Do not explore the database, modify this SQL, or execute additional SQL. If blocked, stop and report the exact error. The runner captures the complete tool result automatically; keep your final reply brief and do not repeat successful JSON.\n\n${query}`;
  const trace = await runAgent(prompt, destination, timeout);
  const calls = trace.calls.filter(call => isSqlTool(call));
  if (trace.errors.length || !trace.completed || calls.length !== 1 || trace.calls.some(call => !isSqlTool(call))
    || calls[0].arguments.project_id !== fixture.projectId || calls[0].arguments.query !== query || calls[0].error) {
    throw new Error(`Controller did not execute exactly the supplied SQL. See ${destination}.jsonl.`);
  }
  const decoded = decodeResult(calls[0].result);
  if (object(decoded) && decoded.error) throw new Error(`Controller SQL failed: ${JSON.stringify(decoded.error)}. See ${destination}.jsonl.`);
  return { receipt: unwrap(calls[0].result), server: calls[0].server };
}
export async function main(args: string[]) {
  const { values } = parseArgs({ args, options: {
    project: { type: 'string' }, case: { type: 'string' }, repeats: { type: 'string', default: '3' },
    out: { type: 'string', default: '.refinement-runs' }, timeout: { type: 'string', default: '600' },
    'allow-synthetic-writes': { type: 'boolean', default: false }, cleanup: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('npm run refinement:live -- --project <project-ref> --allow-synthetic-writes [--case cv] [--repeats 3]\nRecover interrupted fixture cleanup: npm run refinement:live -- --cleanup <run-directory>/fixture.json --allow-synthetic-writes\nUses existing ChatGPT/Codex login and Supabase connector, with automatic approval review. No API key or new service.'); return;
  }
  if (!values['allow-synthetic-writes']) throw new Error('Live runs create and delete synthetic fixtures. Supply --allow-synthetic-writes and an explicit project.');
  const timeout = Number(values.timeout) * 1000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 1800000) throw new Error('Timeout must be 1–1800 seconds.');
  if (values.cleanup) {
    const fixture = JSON.parse(await readFile(values.cleanup, 'utf8')) as ProtocolCase;
    // Re-derive all cleanup IDs; never execute SQL read from a report file.
    const expected = createCase(fixture.name, fixture.projectId, fixture.namespace);
    if (!CASE_NAMES.includes(fixture.name) || !/^[a-z]{20}$/.test(fixture.projectId) || (values.project && values.project !== fixture.projectId) || !/^[a-f\d-]{36}$/.test(fixture.namespace)
      || [fixture.ownerId, fixture.opportunityId, fixture.application.id].join() !== [expected.ownerId, expected.opportunityId, expected.application.id].join()) throw new Error('Unrecognized synthetic fixture manifest.');
    const result = await controller(expected, cleanupSql(expected), values.cleanup + '.cleanup', timeout);
    if (result.receipt.cleaned !== true) throw new Error('Cleanup did not confirm removal.');
    console.log('Synthetic fixture cleanup verified.'); return;
  }
  if (!values.project || !/^[a-z]{20}$/.test(values.project)) throw new Error('Provide the explicit Supabase project reference (20 lowercase letters).');
  const repeats = Number(values.repeats);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('Repeats must be 1–10.');
  const names = values.case ? values.case.split(',') as CaseName[] : [...CASE_NAMES];
  if (names.some(name => !CASE_NAMES.includes(name))) throw new Error('Unknown test case.');
  await generateCases(true);
  const fingerprint = suiteFingerprint();
  const root = resolve(values.out, new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(root, { recursive: true });
  const reports: { case: string; repetition: number; passed: boolean; issues: string[]; cleanup: boolean }[] = [];
  let abort = false;
  for (const name of names) for (let repetition = 1; repetition <= repeats && !abort; repetition++) {
    let fixture = createCase(name, values.project, randomUUID());
    const directory = join(root, `${name}-${repetition}`); await mkdir(directory);
    await writeFile(join(directory, 'fixture.json'), JSON.stringify(fixture, null, 2));
    await writeFile(join(directory, 'cleanup.sql'), cleanupSql(fixture));
    const report = { case: name, repetition, passed: false, issues: [] as string[], cleanup: false };
    reports.push(report);
    try {
      console.log(`[${name} ${repetition}/${repeats}] preparing synthetic fixture`);
      const seed = await controller(fixture, seedSql(fixture), join(directory, 'seed'), timeout);
      fixture = bindSeedReceipt(fixture, seed.receipt);
      await writeFile(join(directory, 'fixture.json'), JSON.stringify(fixture, null, 2));
      await writeFile(join(directory, 'task.md'), fixture.task + '\n');
      console.log(`[${name} ${repetition}/${repeats}] running the copied task in a fresh session`);
      const trace = await runAgent(fixture.task, join(directory, 'agent'), timeout);
      const verdict = verifyTrace(fixture, trace, seed.server);
      report.issues.push(...verdict.issues);
      const after = await controller(fixture, inspectSql(fixture), join(directory, 'verify'), timeout);
      if (seed.receipt.baseline !== after.receipt.baseline) report.issues.push('Application, source snapshot, state or CV changed.');
      if (!Array.isArray(after.receipt.proposals) || after.receipt.proposals.length !== (fixture.expected === 'saved' ? 1 : 0)) report.issues.push('Unexpected number of persisted proposals.');
      if (Array.isArray(after.receipt.proposals)) for (const proposal of after.receipt.proposals) {
        if (!object(proposal)) throw new Error('Invalid persisted proposal row.');
        parseRefinementProposal(proposal.proposal_json, fixture.request);
        const saves = trace.calls.filter(call => isSqlTool(call) && String(call.arguments.query).includes('private.save_refinement_proposal'));
        if (!saves.some(call => JSON.stringify(decodeResult(call.result)).includes(String(proposal.id)))) report.issues.push('Persisted proposal has no matching agent receipt.');
      }
      report.passed = report.issues.length === 0;
    } catch (error) { report.issues.push(error instanceof Error ? error.message : String(error)); }
    finally {
      console.log(`[${name} ${repetition}/${repeats}] cleaning up synthetic fixture`);
      try {
        const result = await controller(fixture, cleanupSql(fixture), join(directory, 'cleanup'), timeout);
        if (result.receipt.cleaned !== true) throw new Error('Cleanup did not confirm removal.');
        report.cleanup = true;
      } catch (error) {
        report.passed = false; abort = true;
        report.issues.push(`CLEANUP REQUIRED: ${error instanceof Error ? error.message : String(error)}; manifest: ${join(directory, 'fixture.json')}`);
      }
      await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
      await writeFile(join(root, 'report.json'), JSON.stringify({ runtime: 'Codex with existing Supabase MCP; not a ChatGPT security certification', suiteFingerprint: fingerprint, reports }, null, 2));
      console.log(`[${name} ${repetition}/${repeats}] ${report.passed ? 'PASS' : 'FAIL'}; cleanup ${report.cleanup ? 'verified' : 'FAILED'}`);
    }
  }
  console.log(`Reports: ${root}`);
  if (reports.some(report => !report.passed)) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
