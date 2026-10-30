/** Synthetic local browser gate. Requires the isolated test:e2e:serve config. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = '/tmp/cv-adaptive-search-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const external = [], errors = [];
    await context.route('**/*', route => {
      if (['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5177/cv-builder/test/browser/adaptive-search.html', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /^Meta research/u }).waitFor();
    await page.getByText('Daily schedule', { exact: true }).click();
    await page.evaluate(() => window.adaptiveFixture.holdRequest());
    await page.getByRole('button', { name: 'Prepare adaptive task update', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().calls.some(call => call.name === 'request_adaptive_search_migration'));
    const interests = page.getByLabel('Research interests, preferred and avoided tasks', { exact: true });
    await interests.fill('BCI; acoustic prototypes; NEW DURING SETUP');
    await page.evaluate(() => window.adaptiveFixture.releaseRequest());
    try {
      await page.waitForFunction(() => {
        const { row } = window.adaptiveFixture.snapshot();
        return row.criteria.topicsAndMethods.includes('NEW DURING SETUP') && row.meta_search.recurringPrompt.includes('private.begin_adaptive_opportunity_search');
      });
    } catch (error) {
      console.error(await page.evaluate(() => ({ errors: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
        interests: window.adaptiveFixture.snapshot().row.criteria.topicsAndMethods, calls: window.adaptiveFixture.snapshot().calls.map(call => call.name) })));
      throw error;
    }
    assert.equal(await interests.inputValue(), 'BCI; acoustic prototypes; NEW DURING SETUP');
    await page.getByRole('button', { name: 'Copy replace prompt', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().copied.includes('private.read_adaptive_search_setup'));
    const prepared = await page.evaluate(() => window.adaptiveFixture.snapshot());
    assert(prepared.copied.includes('private.ack_adaptive_search_setup'));
    assert.equal(prepared.calls.filter(call => call.name === 'request_adaptive_search_migration').length, 1);
    assert(!prepared.calls.some(call => /begin_|submit_|ack_/u.test(call.name)));
    assert.equal(prepared.state.binding.task_id, 'synthetic-existing-task');
    await page.getByRole('button', { name: 'Prepare adaptive task update', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'request_adaptive_search_migration').length === 2);
    const repeated = await page.evaluate(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'request_adaptive_search_migration'));
    assert.equal(repeated[0].args.p_setup_id, repeated[1].args.p_setup_id, 'A pending setup UUID must remain reconcilable');
    await page.getByRole('button', { name: 'Prepare adaptive task update', exact: true }).waitFor();

    await page.evaluate(() => window.adaptiveFixture.failSave());
    await interests.fill('BCI; RECOVER THIS DRAFT'); await interests.press('Enter');
    await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
    assert.equal(await interests.inputValue(), 'BCI; RECOVER THIS DRAFT');
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().row.criteria.topicsAndMethods.includes('RECOVER THIS DRAFT'));
    await page.getByRole('heading', { name: 'Adaptive feedback', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.getByRole('button', { name: 'Information: Search breadth', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Information: Exploration allocation', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Information: When changes apply', exact: true }).count(), 0);
    const automationSummary = page.locator('summary').filter({ hasText: 'Automation authorization' });
    await automationSummary.click();
    assert.equal(await page.getByRole('button', { name: 'Information: Automation authorization', exact: true }).count(), 1);
    for (const name of ['Runner authorization', 'Task setup', 'Runner readiness']) {
      assert.equal(await page.getByRole('button', { name: `Information: ${name}`, exact: true }).count(), 0);
    }
    await automationSummary.click();
    const checkboxLayout = await page.locator('.adaptive-settings .adaptive-check').evaluateAll(labels => labels.map(label => {
      const input = label.querySelector('input'), text = document.createRange(); text.selectNodeContents(label);
      return { name: label.textContent.trim(), checkboxWidth: input.getBoundingClientRect().width, height: label.getBoundingClientRect().height,
        textRight: text.getBoundingClientRect().right, viewport: innerWidth };
    }));
    for (const layout of checkboxLayout) {
      assert.equal(layout.checkboxWidth, 16, `${layout.name}: checkbox must not inherit full-width text-input styling`);
      assert(layout.height <= 48, `${layout.name}: checkbox text should occupy at most two readable lines`);
      assert(layout.textRight <= layout.viewport, `${layout.name}: label text must fit the viewport`);
    }
    await page.screenshot({ path: `${output}/controls-${width}.png`, fullPage: true });
    const baseRevision = await page.evaluate(() => window.adaptiveFixture.snapshot().row.revision);
    const breadth = page.getByRole('slider', { name: 'Search breadth', exact: true });
    assert.equal(await breadth.inputValue(), '20');
    assert.equal(await breadth.getAttribute('aria-valuetext'), '20% · Focused');
    const beforeBreadth = await page.evaluate(() => window.adaptiveFixture.snapshot());
    await breadth.evaluate(element => { element.value = '60'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await breadth.getAttribute('aria-valuetext'), '60% · Adventurous');
    assert.equal(await page.evaluate(() => window.adaptiveFixture.snapshot().calls.length), beforeBreadth.calls.length, 'Dragging only changes a local draft');
    const allocationInfo = page.getByRole('button', { name: 'Information: Search breadth', exact: true });
    await allocationInfo.focus(); await allocationInfo.press('Enter');
    const allocationTooltip = page.getByRole('tooltip');
    await allocationTooltip.waitFor({ state: 'visible' });
    assert.match(await allocationTooltip.innerText(), /At full next-run capacity: at least 6 of 10 discretionary queries for exploration\./u);
    await page.keyboard.press('Escape'); await allocationTooltip.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.adaptiveFixture.loseSettingsResponse());
    await breadth.evaluate(element => element.dispatchEvent(new Event('change', { bubbles: true })));
    await page.getByRole('button', { name: 'Retry exact request', exact: true }).waitFor();
    assert.equal(await breadth.inputValue(), '60', 'Failed settings save preserves the selected breadth');
    await page.getByRole('button', { name: 'Retry exact request', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'patch_opportunity_search_settings').length === 2);
    const breadthCalls = await page.evaluate(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'patch_opportunity_search_settings'));
    assert.deepEqual(breadthCalls[0].args, breadthCalls[1].args);
    assert.deepEqual(breadthCalls[0].args.p_patch, { search_breadth_percent: 60 });
    assert.deepEqual(breadthCalls[0].args.p_expected_revisions, { breadth_revision: 0 });
    const afterBreadth = await page.evaluate(() => window.adaptiveFixture.snapshot());
    assert.equal(afterBreadth.dashboard.settings.adaptation_enabled, beforeBreadth.dashboard.settings.adaptation_enabled);
    await page.waitForFunction(() => !document.querySelector('.adaptive-dashboard[aria-busy="true"]'));
    await breadth.focus(); await breadth.press('Home');
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().dashboard.settings.search_breadth_percent === 0);
    assert.equal(await breadth.getAttribute('aria-valuetext'), '0% · Off');
    assert.equal(await page.getByLabel('Use structured feedback for this search', { exact: true }).count(), 0);
    await page.getByLabel('Adapt query priorities', { exact: true }).check();
    await page.getByLabel('Pause adaptation', { exact: true }).uncheck();
    await page.getByLabel('Pause adaptation', { exact: true }).check();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().dashboard.settings.adaptation_paused);
    await page.locator('summary').filter({ hasText: 'Outgoing feedback preview' }).click();
    assert.equal(await page.getByRole('button', { name: 'Information: Interest metric and privacy', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Information: Exact outgoing packet', exact: true }).count(), 0);
    const packet = JSON.parse(await page.getByLabel('Exact outgoing packet', { exact: true }).inputValue());
    assert.deepEqual(packet, await page.evaluate(() => window.adaptiveFixture.snapshot().dashboard.feedback_preview));
    await page.locator('summary').filter({ hasText: 'Reusable sources' }).click();
    const source = page.locator('.adaptive-entry').filter({ has: page.locator('a') }).first();
    const cadence = source.getByLabel('Check every (hours)', { exact: true });
    await page.evaluate(() => window.adaptiveFixture.loseSourceResponse());
    await cadence.fill('72'); await cadence.press('Enter');
    await page.getByRole('button', { name: 'Retry exact request', exact: true }).waitFor();
    assert.equal(await cadence.inputValue(), '72');
    await page.getByRole('button', { name: 'Retry exact request', exact: true }).click();
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'patch_opportunity_search_source').length === 2);
    const sourceCalls = await page.evaluate(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'patch_opportunity_search_source'));
    assert.deepEqual(sourceCalls[0].args, sourceCalls[1].args);
    await source.getByLabel('Pinned', { exact: true }).focus();
    await source.getByLabel('Pinned', { exact: true }).press('Space');
    await page.waitForFunction(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'patch_opportunity_search_source').length >= 3);
    assert.equal(await page.evaluate(() => window.adaptiveFixture.snapshot().row.revision), baseRevision, 'Adaptive controls must not rewrite the base editor');
    await page.locator('summary').filter({ hasText: 'Saved queries and actual checks' }).click();
    await page.locator('summary').filter({ hasText: 'Recent runs' }).click();
    await page.getByRole('heading', { name: 'Failed run', exact: true }).waitFor();
    const body = await page.locator('.adaptive-dashboard').innerText();
    assert(!body.includes('PRIVATE_CANARY'));
    assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(body), 'Normal history labels must not expose internal IDs');
    await page.getByRole('button', { name: 'English / Deutsch', exact: true }).click();
    await page.getByRole('heading', { name: 'Adaptives Feedback', exact: true }).waitFor();
    await page.getByLabel('Suchprioritäten anpassen', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Strukturiertes Feedback für diese Suche verwenden', { exact: true }).count(), 0);
    await page.getByRole('slider', { name: 'Suchbreite', exact: true }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/setup-${width}.png`, fullPage: true });
    await context.close();
    console.log(`PASS setup, draft recovery, feedback/source controls, exact preview and English/German keyboard UI at ${width}px`);
  }
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto('http://127.0.0.1:5177/cv-builder/test/browser/adaptive-search.html?readinessFailure=1', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Copy replace prompt', exact: true }).click();
  assert.equal(await page.evaluate(() => window.adaptiveFixture.snapshot().copied), '');
  await page.evaluate(() => window.adaptiveFixture.failReadiness(false));
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.search-templates[aria-busy="true"]') && ![...document.querySelectorAll('.search-templates button')].some(button => button.textContent === 'Retry save'));
  await context.close();
  console.log('PASS unknown readiness blocks copying until successful reload');
  const legacyContext = await browser.newContext(); const legacyPage = await legacyContext.newPage();
  await legacyPage.goto('http://127.0.0.1:5177/cv-builder/test/browser/adaptive-search.html?breadthUpgradeMissing=1', { waitUntil: 'networkidle' });
  await legacyPage.getByRole('heading', { name: 'Adaptive feedback', exact: true }).waitFor();
  assert.equal(await legacyPage.getByRole('slider', { name: 'Search breadth', exact: true }).isDisabled(), true);
  const upgradeInfo = legacyPage.getByRole('button', { name: 'Information: Search breadth', exact: true });
  await upgradeInfo.focus(); await upgradeInfo.press('Enter');
  const upgradeTooltip = legacyPage.getByRole('tooltip');
  await upgradeTooltip.waitFor({ state: 'visible' });
  assert.match(await upgradeTooltip.innerText(), /Install the search-breadth database update to enable this control\./u);
  await legacyPage.keyboard.press('Escape'); await upgradeTooltip.waitFor({ state: 'hidden' });
  assert.equal(await legacyPage.getByLabel('Use structured feedback for this search', { exact: true }).count(), 0);
  assert.equal(await legacyPage.getByLabel('Adapt query priorities', { exact: true }).isDisabled(), false);
  assert.equal(await legacyPage.getByLabel('Pause adaptation', { exact: true }).isDisabled(), false);
  assert.equal(await legacyPage.evaluate(() => window.adaptiveFixture.snapshot().calls.filter(call => call.name === 'patch_opportunity_search_settings').length), 0);
  await legacyContext.close();
  console.log('PASS missing breadth upgrade preserves the old dashboard and disables the new slider');
} finally { await browser.close(); }
