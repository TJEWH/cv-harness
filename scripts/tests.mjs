import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const mode = args[0] && !args[0].startsWith('-') ? args.shift() : 'offline';
const tiers = { offline: ['unit', 'integration', 'protocol'], unit: ['unit'], integration: ['integration'], protocol: ['protocol'], refinement: ['unit', 'integration', 'protocol'], database: ['database'] };
if (!(mode in tiers)) throw new Error('Use offline, unit, integration, protocol, refinement or database.');
let list = false, concurrency = process.env.CV_TEST_CONCURRENCY || '4';
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === '--list') list = true;
  else if (argument === '--concurrency') concurrency = args[++index];
  else if (argument.startsWith('--concurrency=')) concurrency = argument.slice(14);
  else throw new Error(`Unknown test-runner option: ${argument}. Use --list or --concurrency=N.`);
}
if (!/^[1-9][0-9]*$/.test(concurrency || '') || Number(concurrency) > 32) throw new Error('Test concurrency must be an integer from 1 to 32.');
// The shared isolated database has one destructive reset/lock boundary.
if (mode === 'database') concurrency = '1';
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith('.test.ts') ? [relative(root, path)] : [];
  });
}
const selected = tiers[mode].flatMap(tier => files(join(root, 'test', tier))).filter(path => mode !== 'refinement'
  || /refinement/i.test(path) || path.endsWith('/cloudCvPrivacy.test.ts') || path.endsWith('/useDocumentPdfPreview.test.ts')).sort();
if (!selected.length) throw new Error(`No ${mode} test files found.`);
if (list) console.log(selected.join('\n'));
else {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', `--test-concurrency=${concurrency}`, ...selected], {
    cwd: root, stdio: 'inherit', env: process.env,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
