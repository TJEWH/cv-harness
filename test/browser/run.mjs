import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchBrowser, blockExternalRequests } from '../support/browser/runtime.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = 'http://127.0.0.1:5177/cv-harness/';
const output = process.env.CV_BROWSER_OUTPUT || join(tmpdir(), `cv-harness-browser-${Date.now()}`);
const reuse = process.argv.includes('--reuse-server');
const htmlOnly = process.argv.includes('--html-only'), driversOnly = process.argv.includes('--drivers-only');
assert(!(htmlOnly && driversOnly), 'Choose --html-only or --drivers-only, not both.');
assert(process.argv.slice(2).every(argument => ['--reuse-server', '--html-only', '--drivers-only'].includes(argument)), 'Unknown browser-runner option.');
const drivers = ['adaptiveSearch', 'adaptiveLifecycle', 'letterInterests', 'manualOpportunityPast', 'notifications', 'opportunityFeedback'];
let server, serverLog = '', browser;
const results = [];
await mkdir(output, { recursive: true });
console.log(`Browser artifacts: ${output}`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runDriver(name) {
  const child = spawn(process.execPath, [`test/browser/specs/${name}.mjs`], { cwd: root, stdio: 'inherit', env: process.env });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `${name} browser assertions failed`);
}
async function startServer() {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'test/browser/vite.config.ts'], {
    cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const pipe of [server.stdout, server.stderr]) pipe.on('data', chunk => { serverLog += String(chunk); });
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const plainLog = serverLog.replace(/\x1b\[[0-9;]*m/gu, '');
    if (/Port 5177 is already in use|EADDRINUSE/u.test(plainLog) || server.exitCode !== null || server.signalCode !== null) throw new Error(`Synthetic Vite failed: ${serverLog}`);
    if (/Local:\s+http:\/\/127\.0\.0\.1:5177\/cv-harness\//u.test(plainLog)) {
      const response = await fetch(`${base}test/browser/pages/refinement.html`).catch(() => null);
      if (response?.ok && (await response.text()).includes('run-tests') && server.exitCode === null && server.signalCode === null) return;
    }
    await delay(100);
  }
  throw new Error('Synthetic Vite did not become ready on port 5177.');
}
async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), delay(3000)]);
  if (server.exitCode === null && server.signalCode === null) { server.kill('SIGKILL'); await once(server, 'exit'); }
}
async function htmlFixture(name, expected, width, retry = false) {
  console.log(`RUN ${name}/${width}${retry ? ' after Vite optimization' : ''}`);
  const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390 });
  const external = [], errors = []; const beforeLog = serverLog.length;
  await blockExternalRequests(context, external);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}test/browser/pages/${name}.html`, { waitUntil: 'networkidle' });
    await page.exposeFunction('reportFixtureProgress', message => console.log(`${name}/${width}: ${message}`));
    await page.evaluate(() => {
      const seen = new Set();
      new MutationObserver(() => {
        for (const item of document.querySelectorAll('#test-results li')) {
          if ((['pass', 'fail'].includes(item.dataset.result) || /^(PASS|FAIL):/.test(item.textContent || '')) && !seen.has(item.textContent)) {
            seen.add(item.textContent); window.reportFixtureProgress(item.textContent);
          }
        }
      }).observe(document.querySelector('#test-results'), { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await page.locator('#run-tests').click();
    await page.waitForFunction(() => ['running', 'passed', 'failed'].includes(document.body.dataset.result), null, { timeout: 20000 });
    await page.waitForFunction(() => ['passed', 'failed'].includes(document.body.dataset.result)
      || (!document.body.dataset.result && document.querySelector('#test-status')?.textContent === 'Ready'), null, { timeout: 540000 });
    const result = await page.evaluate(() => ({ outcome: document.body.dataset.result, status: document.querySelector('#test-status')?.textContent,
      flows: [...document.querySelectorAll('#test-results li')].map(item => ({ outcome: item.dataset.result, text: item.textContent })) }));
    // A cold Vite optimizer can reload its fixture once while finding PDF dependencies.
    // Retry only this observed infrastructure reload; assertion/runtime failures remain failures.
    if (!retry && !reuse && errors.length === 0 && external.length === 0 && !result.outcome && result.status === 'Ready' && serverLog.slice(beforeLog).includes('optimized dependencies changed')) {
      await context.close(); return htmlFixture(name, expected, width, true);
    }
    assert.equal(result.outcome, 'passed', `${name}/${width}: ${JSON.stringify(result)}`);
    assert.equal(result.flows.length, expected); assert(result.flows.every(flow => flow.outcome === 'pass'));
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ fixture: name, width, ...result });
    console.log(`PASS ${name}/${width}: ${result.flows.length}/${expected}`);
  } catch (error) {
    await page.screenshot({ path: join(output, `${name}-${width}.png`), fullPage: true }).catch(() => {});
    await writeFile(join(output, `${name}-${width}.html`), await page.content()).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
try {
  if (!reuse) await startServer();
  if (!htmlOnly) for (const driver of drivers) await runDriver(driver);
  if (!driversOnly) {
    browser = await launchBrowser();
    for (const [name, expected] of [['refinement', 13], ['attachments', 7]]) for (const width of [1440, 390]) await htmlFixture(name, expected, width);
  }
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`Browser checks passed. Artifacts: ${output}`);
} finally {
  await browser?.close(); await stopServer();
  await writeFile(join(output, 'vite.log'), serverLog);
}
