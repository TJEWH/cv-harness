import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CASE_NAMES, createCase } from './cases';

export async function generateCases(check = false, target = fileURLToPath(new URL('./generated/', import.meta.url))) {
  const outputs = new Map<string, string>();
  for (const name of CASE_NAMES) {
    const fixture = createCase(name);
    outputs.set(`${name}.md`, `${fixture.task}\n`);
  }
  // Expectations stay outside the tested agent's working directory.
  outputs.set('manifest.json', JSON.stringify(CASE_NAMES.map(name => {
    const fixture = createCase(name);
    return { name, projectId: fixture.projectId, applicationId: fixture.application.id, requestId: fixture.request.requestId,
      expected: fixture.expected };
  }), null, 2) + '\n');
  if (!check) await mkdir(target, { recursive: true });
  for (const [name, content] of outputs) {
    if (check) {
      if (await readFile(resolve(target, name), 'utf8').catch(() => '') !== content) throw new Error(`Generated prompt changed: ${name}. Run npm run refinement:prompts, then review the diff.`);
    } else await writeFile(resolve(target, name), content);
  }
  for (const name of await readdir(target)) if (!outputs.has(name)) {
    if (check) throw new Error('Unexpected generated prompt file; remove obsolete cases.');
    if (name.endsWith('.protocol.md') || name === 'missing-protocol.md') await unlink(resolve(target, name));
    else throw new Error(`Unexpected generated file: ${name}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateCases(process.argv.includes('--check'));
  console.log(process.argv.includes('--check') ? 'Generated refinement tasks match production.' : 'Generated refinement self-contained task Markdown for review.');
}
