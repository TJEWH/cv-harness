/** AF-11 local-only letter-interest browser regression gate.
 * Start npm run test:e2e:serve. Use an installed Playwright/Chrome runtime via
 * PLAYWRIGHT_MODULE_PATH and PLAYWRIGHT_CHROMIUM_EXECUTABLE when necessary.
 */
import assert from 'node:assert/strict';
import { launchBrowser, blockExternalRequests, fixtureUrl } from '../../support/browser/runtime.mjs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const base = fixtureUrl(process.env.LETTER_INTEREST_FIXTURE_URL || 'http://127.0.0.1:5177/cv-harness/test/browser/pages/refinement.html', ['/cv-harness/test/browser/pages/refinement.html', '/test/browser/pages/refinement.html']);
const flows = (process.env.LETTER_INTEREST_FLOWS || 'shared-letter-interests,template-questions').split(',');
assert(flows.length > 0 && flows.every(flow => ['shared-letter-interests','template-questions'].includes(flow)));
const output = join(tmpdir(),'cv-letter-interest-browser'); await mkdir(output,{ recursive: true });
const browser = await launchBrowser();
const results = [];
try {
  for (const width of [1440,390]) for (const flow of flows) {
    const context = await browser.newContext({ viewport: { width,height: 1000 },isMobile: width===390,hasTouch: width===390 });
    const external = [],errors = [];
    await blockExternalRequests(context, external);
    const page = await context.newPage(); page.on('pageerror',error => errors.push(error.message));
    const url = new URL(base); url.searchParams.set('flow',flow); url.searchParams.set('sidebar','1');
    let failure = '';
    try {
      await page.goto(url.href,{ waitUntil: 'networkidle' });
      await page.locator('#run-tests').click();
      await page.waitForFunction(() => ['passed','failed'].includes(document.body.dataset.result),{},{ timeout: 120000 });
      const status = await page.locator('#test-status').innerText();
      const details = await page.locator('#test-results').innerText();
      assert.equal(await page.locator('body').getAttribute('data-result'),'passed',`${status}: ${details}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'horizontal overflow');
      assert.deepEqual(external,[],'synthetic flow must never contact an external service');
      assert.deepEqual(errors,[],'browser exceptions');
    } catch (cause) { failure = cause instanceof Error ? cause.message : String(cause); }
    const screenshot = join(output,`${flow}-${width}.png`); await page.screenshot({ path: screenshot,fullPage: true });
    results.push({ flow,width,result: failure ? 'failed' : 'passed',failure,errors,external,screenshot });
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify(results,null,2));
if (results.some(result => result.result==='failed')) process.exitCode=1;
