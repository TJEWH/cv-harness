import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('canonical opportunity types stay generated from the reviewed schema', () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, [fileURLToPath(new URL('../../../scripts/generateOpportunityTypes.mjs', import.meta.url)), '--check'], { stdio: 'pipe' }));
});
