/** Local notification/tooltip regression gate. Start npm run test:e2e:serve first. */
import assert from 'node:assert/strict';
import { launchBrowser, blockExternalRequests } from '../../support/browser/runtime.mjs';
import { mkdir } from 'node:fs/promises';
const output = '/tmp/cv-status-notifications';
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
try {
  for (const width of [1440, 390]) {
    const mobile = width === 390;
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: mobile, hasTouch: mobile });
    const errors = [], external = [];
    await blockExternalRequests(context, external);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const goto = name => page.goto(`http://127.0.0.1:5177/cv-harness/test/browser/pages/${name}.html`, { waitUntil: 'networkidle' });
    const fits = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
    const openHelp = async button => {
      await button.scrollIntoViewIfNeeded();
      if (mobile) await button.tap();
      else { await button.focus(); await button.press('Enter'); }
      await page.getByRole('tooltip').waitFor();
    };
    const closeHelp = () => page.keyboard.press('Escape');
    await goto('notifications');
    const help = page.getByRole('button', { name: 'Information: Local files', exact: true });
    assert.equal(await page.getByRole('tooltip').count(), 0, 'general help starts hidden');
    if (!mobile) { await help.hover(); await page.getByRole('tooltip').waitFor(); await closeHelp(); }
    await openHelp(help);
    assert.match(await page.getByRole('tooltip').innerText(), /Files stay on this device/);
    await fits();
    await page.screenshot({ path: `${output}/help-${width}.png` });
    await closeHelp();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.app-toast')?.textContent.includes('Changes saved.'));
    assert.equal(await page.locator('.app-toaster').isVisible(), !mobile, 'mobile notifications stay hidden');
    if (!mobile) {
      await page.getByRole('button', { name: 'Simulate failure', exact: true }).click();
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Retry succeeded.' }).waitFor();
      await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
      await page.getByRole('button', { name: 'Fail dialog operation', exact: true }).click();
      assert.equal(await page.locator('dialog .app-toaster [role="alert"]').count(), 1, 'retry stays inside the active modal');
      await page.getByRole('button', { name: 'Retry dialog operation', exact: true }).click();
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.getByRole('button', { name: 'Check toast transitions', exact: true }).click();
      await page.getByTestId('toast-check-result').filter({ hasText: /^PASS:/ }).waitFor({ timeout: 10000 });
    }

    await goto('preview-recovery');
    assert.equal(await page.locator('.pdf-preview [role="alert"], .pdf-preview__status, .pdf-canvas-page__status span').count(), 0, 'preview failures have no inline status text');
    assert.equal(await page.locator('.app-toaster').isVisible(), !mobile);
    await page.getByRole('button', { name: 'Vorschau erneut erstellen', exact: true }).first().click();
    await page.locator('.pdf-preview__page svg').waitFor();
    assert.equal(await page.locator('.pdf-preview__error').count(), 0, 'preview retry still recovers');
    await fits();

    await goto('cv-studio');
    await page.getByRole('heading', { name: /^Letter templates/ }).waitFor();
    const structure = page.getByRole('textbox', { name: 'Structure and sections', exact: true });
    // Wait for initial local loading/preview notifications to finish before checking typing.
    await page.waitForFunction(() => !document.querySelector('.app-toast'));
    await structure.fill('Synthetic notification regression draft.');
    assert.equal(await page.locator('.app-toast').count(), 0, 'typing alone must not notify');
    await structure.press('Enter');
    await page.waitForFunction(() => document.querySelector('.app-toast')?.textContent.includes('All changes saved locally'));
    assert.equal(await page.locator('.app-toaster').isVisible(), !mobile);
    assert.equal(await page.locator('.letter-templates [role="status"], .letter-templates [role="alert"]').count(), 0);
    await openHelp(page.getByRole('button', { name: 'Information: Structure and sections', exact: true }));
    assert.match(await page.getByRole('tooltip').innerText(), /paragraph order/);
    await fits();
    await page.screenshot({ path: `${output}/templates-${width}.png` });
    await closeHelp();
    await page.getByRole('button', { name: 'Privacy', exact: true }).click();
    await page.locator('.anonymization-panel').getByRole('tab', { name: 'Header', exact: true }).click();
    const maskingHelp = page.locator('.privacy-field--masked .info-hint__button:visible').first();
    await openHelp(maskingHelp);
    assert.match(await page.getByRole('tooltip').innerText(), /automatically|masked|replaced/i);
    await fits();
    await page.screenshot({ path: `${output}/privacy-${width}.png` });
    assert.deepEqual(errors, [], 'no browser exceptions');
    assert.deepEqual(external, [], 'synthetic fixtures must not contact external services');
    await context.close();
    console.log(`PASS ${width}px: toast visibility, tooltips, retries, preview recovery and committed-save feedback`);
  }
} finally { await browser.close(); }
