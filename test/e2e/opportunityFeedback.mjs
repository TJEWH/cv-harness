/** AF-02 synthetic browser acceptance. Start Vite, then run this file with Node.
 * Optional PLAYWRIGHT_MODULE_PATH / PLAYWRIGHT_CHROMIUM_EXECUTABLE select an
 * already installed test runtime. No package installation or real account.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch (error) {
  if (!process.env.PLAYWRIGHT_MODULE_PATH) throw new Error('Use an installed Playwright runtime through PLAYWRIGHT_MODULE_PATH.', { cause: error });
  playwright = require(process.env.PLAYWRIGHT_MODULE_PATH);
}
const url = new URL(process.env.OPPORTUNITY_FEEDBACK_FIXTURE_URL ?? 'http://localhost:5177/cv-harness/test/browser/opportunity-feedback.html');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Browser acceptance may use only a local synthetic fixture.');
assert.ok(['/cv-harness/test/browser/opportunity-feedback.html', '/test/browser/opportunity-feedback.html'].includes(url.pathname));
const screenshotDirectory = join(tmpdir(), 'cv-opportunity-feedback-browser');
await mkdir(screenshotDirectory, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const results = [];
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
    const externalRequests = [];
    await context.route('**/*', route => {
      const requestUrl = new URL(route.request().url());
      if (['localhost', '127.0.0.1'].includes(requestUrl.hostname)) return route.continue();
      externalRequests.push(requestUrl.origin);
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await page.goto(url.href, { waitUntil: 'networkidle' });
    const disclosure = page.locator('details.personal-evaluation');
    const disclosureSummary = disclosure.locator(':scope > summary');
    await disclosureSummary.waitFor();
    const events = page.getByTestId('fixture-events');
    const summary = page.getByRole('textbox', { name: 'Personal evaluation', exact: true });
    const rating = page.getByRole('slider', { name: 'Interest override (0–10)', exact: true });
    const summaryInfo = page.getByRole('button', { name: 'Information: Personal evaluation', exact: true });
    const assertSummaryInfo = async expected => {
      await summaryInfo.scrollIntoViewIfNeeded();
      await summaryInfo.click();
      const tooltip = page.locator(`[id="${await summaryInfo.getAttribute('aria-describedby')}"]`);
      await tooltip.waitFor({ state: 'visible' });
      await page.waitForFunction(value => [...document.querySelectorAll('[role="tooltip"]:not([hidden])')].some(node => node.textContent.startsWith(value)), expected);
      assert.ok((await tooltip.textContent()).startsWith(expected));
      assert.match(await tooltip.textContent(), /Your searches use.*by default/);
      await page.keyboard.press('Escape');
      await tooltip.waitFor({ state: 'hidden' });
    };
    const snapshot = () => page.evaluate(() => window.opportunityFeedbackFixture.snapshot());
    const waitForReview = (field, value) => page.waitForFunction(({ field, value }) => {
      const snapshot = window.opportunityFeedbackFixture.snapshot();
      return snapshot.review[field] === value && snapshot.evaluationStatus === 'saved';
    }, { field, value });
    assert.equal(await page.locator('.feedback-controls textarea').count(), 1, 'Evaluation and feedback must share one editor');
    assert.equal(await summary.inputValue(), 'Prefer hands-on acoustic prototypes.\n\nConsider adjacent research involving robotics.');
    assert.match(await events.innerText(), /Evaluation saves: 0; structured changes: 0/);
    assert.equal((await snapshot()).review.interest_rating, null, 'Opening must not manufacture a rating');
    assert.equal(await page.getByRole('button', { name: /Approve for search feedback|Revoke sharing/ }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /structured feedback/i }).count(), 0);
    await assertSummaryInfo('Included in search feedback');
    await disclosureSummary.click();
    assert.equal(await rating.isVisible(), false); assert.equal(await summary.isVisible(), false);
    await disclosureSummary.click();
    assert.match(await events.innerText(), /Evaluation saves: 0; structured changes: 0/);

    await summary.fill('Prefer physical sensing prototypes.');
    await summary.press('Shift+Enter');
    assert.equal(await summary.inputValue(), 'Prefer physical sensing prototypes.\n');
    await summary.dispatchEvent('compositionstart'); await summary.press('Enter');
    assert.equal((await snapshot()).evaluationSaves, 0, 'IME confirmation must not save');
    await summary.dispatchEvent('compositionend');
    await summary.fill('Prefer physical sensing prototypes.'); await summary.press('Tab');
    await waitForReview('comment', 'Prefer physical sensing prototypes.');
    assert.equal((await snapshot()).evaluationSaves, 1, 'One evaluation commit makes one persistence call');
    assert.equal('search_feedback_summary' in (await snapshot()).review, false);
    await assertSummaryInfo('Included in search feedback');
    const excluded = page.getByRole('checkbox', { name: 'Exclude this opportunity from search feedback', exact: true });
    const exclusionInfo = page.getByRole('button', { name: 'Information: Exclude from search feedback', exact: true });
    await exclusionInfo.scrollIntoViewIfNeeded();
    if (name === 'mobile') await exclusionInfo.tap(); else await exclusionInfo.click();
    const exclusionTooltip = page.locator(`[id="${await exclusionInfo.getAttribute('aria-describedby')}"]`);
    await exclusionTooltip.waitFor({ state: 'visible' });
    assert.match(await exclusionTooltip.innerText(), /Saved data and Current\/Past list placement stay unchanged/);
    await page.keyboard.press('Escape'); await exclusionTooltip.waitFor({ state: 'hidden' });
    await excluded.check(); await waitForReview('feedback_excluded', true);
    await assertSummaryInfo('Excluded from search feedback');
    await page.waitForFunction(() => document.querySelector('.feedback-score')?.textContent?.startsWith('No adaptive score'));
    await excluded.uncheck(); await waitForReview('feedback_excluded', false);
    await assertSummaryInfo('Included in search feedback');

    await summary.fill('Synthetic private contact: private@example.invalid.'); await summary.press('Enter');
    await waitForReview('comment', 'Synthetic private contact: private@example.invalid.');
    await assertSummaryInfo('Text withheld by content safeguards');
    const longEvaluation = 'Acoustic prototypes and careful technical evaluation. '.repeat(18);
    assert(longEvaluation.length > 600);
    await summary.fill(longEvaluation); await summary.press('Enter'); await waitForReview('comment', longEvaluation);
    assert.equal(await summary.inputValue(), longEvaluation, 'The full evaluation must not be truncated');
    assert.equal('search_feedback_summary' in (await snapshot()).review, false, 'The excerpt is derived only for display and packets');
    const excerpt = page.locator('.feedback-excerpt');
    await excerpt.locator('summary').click();
    assert.equal(await excerpt.locator('p').innerText(), Array.from(longEvaluation).slice(0,600).join(''));
    assert.equal(Array.from(await excerpt.locator('p').innerText()).length, 600);
    await assertSummaryInfo('Included in search feedback');
    await summary.fill(`${'Safe acoustic work. '.repeat(35)}Contact: private@example.invalid.`); await summary.press('Enter');
    await assertSummaryInfo('Text withheld by content safeguards');
    assert.equal(await page.locator('.feedback-excerpt').count(), 0, 'Unsafe details beyond the excerpt must withhold it too');

    await page.evaluate(() => window.opportunityFeedbackFixture.failNextEvaluationSave());
    await summary.fill('Retain this evaluation through a failed save.'); await summary.press('Enter');
    await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
    assert.equal(await summary.inputValue(), 'Retain this evaluation through a failed save.');
    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    await waitForReview('comment', 'Retain this evaluation through a failed save.');
    await summary.fill('Prefer acoustic sensing and adjacent robotic interfaces.'); await summary.press('Enter');
    await waitForReview('comment', 'Prefer acoustic sensing and adjacent robotic interfaces.');

    const beforeRating = (await snapshot()).structuredChanges;
    await rating.evaluate(element => { element.value = '0'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal((await snapshot()).structuredChanges, beforeRating, 'Slider dragging only changes a local draft');
    await rating.evaluate(element => element.dispatchEvent(new Event('change', { bubbles: true })));
    await waitForReview('interest_rating', 0);
    await page.waitForFunction(() => document.querySelector('.feedback-score')?.textContent?.startsWith('0/10'));
    await rating.focus(); await rating.press('End'); await waitForReview('interest_rating', 10);
    await page.getByRole('button', { name: 'Clear rating', exact: true }).click(); await waitForReview('interest_rating', null);
    const beforeReasons = (await snapshot()).structuredChanges;
    const prefer = page.getByRole('group', { name: 'Prefer', exact: true });
    const avoid = page.getByRole('group', { name: 'Avoid', exact: true });
    assert.equal(await prefer.getByRole('checkbox').count(), 7); assert.equal(await avoid.getByRole('checkbox').count(), 7);
    assert.equal(await prefer.getByRole('checkbox', { checked: true }).count(), 0);
    assert.equal(await avoid.getByRole('checkbox', { checked: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Add reasons', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /^Remove reason:/ }).count(), 0);
    assert.equal(await page.getByRole('combobox', { name: 'Preference', exact: true }).count(), 0);
    assert.equal(await page.getByRole('textbox', { name: 'Topic or method (optional)', exact: true }).count(), 0);
    if (name === 'mobile') await avoid.getByText('Funding', { exact: true }).tap(); else await avoid.getByRole('checkbox', { name: 'Funding', exact: true }).check();
    await page.waitForFunction(() => window.opportunityFeedbackFixture.snapshot().review.interest_reasons.length === 1);
    await avoid.getByRole('checkbox', { name: 'Timing', exact: true }).focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.opportunityFeedbackFixture.snapshot().review.interest_reasons.length === 2);
    if (name === 'mobile') await prefer.getByText('Topic', { exact: true }).tap(); else await prefer.getByRole('checkbox', { name: 'Topic', exact: true }).check();
    await page.waitForFunction(() => window.opportunityFeedbackFixture.snapshot().review.interest_reasons.length === 3);
    assert.equal((await snapshot()).structuredChanges, beforeReasons + 3, 'Each category change saves directly');
    assert.deepEqual((await snapshot()).review.interest_reasons, [
      { category: 'funding', polarity: 'negative' }, { category: 'timing', polarity: 'negative' },
      { category: 'topic', polarity: 'positive' },
    ]);

    const beforeDisposition = (await snapshot()).review;
    const archive = page.getByRole('checkbox', { name: 'Remove from current opportunities', exact: true });
    await archive.check(); await waitForReview('manually_archived', true);
    const issue = page.getByRole('combobox', { name: 'Technical issue (optional)', exact: true });
    const note = page.getByRole('textbox', { name: 'Technical details (optional)', exact: true });
    await issue.selectOption('requirements'); await waitForReview('technical_issue_category', 'requirements');
    const beforeNote = (await snapshot()).dispositionChanges;
    await note.fill('The required prior degree cannot be met.');
    assert.equal((await snapshot()).dispositionChanges, beforeNote, 'Technical typing remains local until commit');
    await note.press('Enter'); await waitForReview('technical_issue_note', 'The required prior degree cannot be met.');
    await issue.selectOption('closed'); await waitForReview('technical_issue_category', 'closed');
    const afterDisposition = (await snapshot()).review;
    assert.equal(afterDisposition.state, beforeDisposition.state);
    assert.equal(afterDisposition.interest_rating, beforeDisposition.interest_rating);
    assert.equal(afterDisposition.comment, beforeDisposition.comment);
    assert.deepEqual(afterDisposition.interest_reasons, beforeDisposition.interest_reasons);
    await archive.uncheck(); await waitForReview('manually_archived', false);
    assert.equal(await note.isVisible(), false);
    assert.equal((await snapshot()).review.technical_issue_note, 'The required prior degree cannot be met.', 'Undoing the personal archive must preserve the explanation');
    await archive.check(); await waitForReview('manually_archived', true);
    assert.equal(await note.inputValue(), 'The required prior degree cannot be met.');
    assert.equal(await page.locator('.feedback-controls textarea').count(), 1);
    assert.equal(await page.locator('.opportunity-disposition textarea').count(), 1);
    await page.getByRole('button', { name: 'English / Deutsch', exact: true }).click();
    await page.getByRole('slider', { name: 'Eigene Interessensbewertung (0–10)', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Persönliche Einschätzung', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'English / Deutsch', exact: true }).click();

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name} must not overflow horizontally`);
    assert.deepEqual(errors, [], `${name} browser errors`);
    assert.deepEqual(externalRequests, [], `${name} fixture must not contact external services`);
    const screenshot = join(screenshotDirectory, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    results.push({ name, width, height, result: 'passed', screenshot, events: await events.innerText() });
    await context.close();
  }
  const legacyContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await legacyContext.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const legacyPage = await legacyContext.newPage();
  const legacyUrl = new URL(url); legacyUrl.searchParams.set('oversizedLegacy', 'true');
  await legacyPage.goto(legacyUrl.href, { waitUntil: 'networkidle' });
  const preserved = legacyPage.getByRole('textbox', { name: 'Personal evaluation', exact: true });
  assert.equal(await preserved.inputValue(), `${'E'.repeat(5000)}\n\n${'F'.repeat(600)}`, 'Both maximum-length legacy texts must remain intact');
  assert.equal(await preserved.getAttribute('maxlength'), null, 'Native UTF-16 limits must not reject valid Unicode evaluations');
  assert.equal(await legacyPage.getByRole('button', { name: /Approve for search feedback|Revoke sharing/ }).count(), 0);
  const legacyExcerpt = legacyPage.locator('.feedback-excerpt'); await legacyExcerpt.locator('summary').click();
  assert.equal(await legacyExcerpt.locator('p').innerText(), 'E'.repeat(600));
  assert.match(await legacyPage.getByTestId('fixture-events').innerText(), /Evaluation saves: 0; structured changes: 0/);
  await preserved.fill('🧪'.repeat(12000)); await preserved.press('Enter');
  await legacyPage.waitForFunction(() => window.opportunityFeedbackFixture.snapshot().evaluationStatus === 'saved');
  assert.equal((await legacyPage.evaluate(() => window.opportunityFeedbackFixture.snapshot())).review.comment, '🧪'.repeat(12000));
  await preserved.fill('🧪'.repeat(12001)); await preserved.press('Enter');
  await legacyPage.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
  assert.equal(await preserved.inputValue(), '🧪'.repeat(12001), 'An oversized failed draft remains editable');
  results.push({ name: 'migrated evaluation and Unicode limit', result: 'passed', characters: 12000 });
  await legacyContext.close();
} finally { await browser.close(); }
console.log(JSON.stringify(results, null, 2));
