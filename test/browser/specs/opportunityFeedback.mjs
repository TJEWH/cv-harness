/** AF-02 synthetic browser acceptance. Start Vite, then run this file with Node.
 * Optional PLAYWRIGHT_MODULE_PATH / PLAYWRIGHT_CHROMIUM_EXECUTABLE select an
 * already installed test runtime. No package installation or real account.
 */
import assert from 'node:assert/strict';
import { launchBrowser, blockExternalRequests, fixtureUrl } from '../../support/browser/runtime.mjs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const url = fixtureUrl(process.env.OPPORTUNITY_FEEDBACK_FIXTURE_URL ?? 'http://localhost:5177/cv-harness/test/browser/pages/opportunity-feedback.html', ['/cv-harness/test/browser/pages/opportunity-feedback.html', '/test/browser/pages/opportunity-feedback.html']);
const screenshotDirectory = join(tmpdir(), 'cv-opportunity-feedback-browser');
await mkdir(screenshotDirectory, { recursive: true });
const browser = await launchBrowser();
const results = [];
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
    const externalRequests = [];
    await blockExternalRequests(context, externalRequests);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await page.goto(url.href, { waitUntil: 'networkidle' });
    const disclosure = page.locator('details.personal-evaluation');
    const disclosureSummary = disclosure.locator(':scope > summary');
    await disclosureSummary.waitFor();
    const events = page.getByTestId('fixture-events');
    const summary = page.getByRole('textbox', { name: 'Qualitative evaluation', exact: true });
    const summaryInfo = page.getByRole('button', { name: 'Information: Qualitative evaluation', exact: true });
    const assertSummaryInfo = async expected => {
      await summaryInfo.scrollIntoViewIfNeeded();
      if (name === 'mobile') await summaryInfo.tap();
      else { await summaryInfo.focus(); await summaryInfo.press('Enter'); }
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
    assert.equal(await summary.isVisible(), false);
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

    assert.equal(await page.getByRole('slider').count(), 0, 'Interest uses the workspace category selector');
    const beforeReasons = (await snapshot()).structuredChanges;
    const prefer = page.getByRole('group', { name: 'Prefer', exact: true });
    const avoid = page.getByRole('group', { name: 'Avoid', exact: true });
    assert.equal(await prefer.getByRole('checkbox').count(), 9); assert.equal(await avoid.getByRole('checkbox').count(), 11);
    assert.equal(await prefer.getByRole('checkbox', { checked: true }).count(), 0);
    assert.equal(await avoid.getByRole('checkbox', { checked: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Add reasons', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /^Remove reason:/ }).count(), 0);
    assert.equal(await page.getByRole('combobox', { name: 'Preference', exact: true }).count(), 0);
    assert.equal(await page.getByRole('textbox', { name: 'Topic or method (optional)', exact: true }).count(), 0);
    if (name === 'mobile') await avoid.getByText('Salary', { exact: true }).tap(); else await avoid.getByRole('checkbox', { name: 'Salary', exact: true }).check();
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
    assert.equal(await page.getByRole('textbox', { name: 'Qualitative Einschätzung', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'English / Deutsch', exact: true }).click();

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name} must not overflow horizontally`);
    assert.deepEqual(errors, [], `${name} browser errors`);
    assert.deepEqual(externalRequests, [], `${name} fixture must not contact external services`);
    const screenshot = join(screenshotDirectory, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    results.push({ name, width, height, result: 'passed', screenshot, events: await events.innerText() });
    const interestPage = await context.newPage();
    interestPage.on('pageerror', error => { errors.push(error.message); });
    const interestUrl = new URL('job-workspace.html?flow=interest', url);
    await interestPage.goto(interestUrl.href, { waitUntil: 'networkidle' });
    await interestPage.locator('.jobs-result-row:visible .jobs-row-toggle').first().click();
    const interest = interestPage.getByRole('combobox', { name: 'Your review', exact: true });
    await interest.waitFor();
    const interestSnapshot = () => interestPage.evaluate(() => window.opportunityInterestFixture.snapshot());
    assert.equal((await interestSnapshot()).writes.length, 0, 'Opening the workspace must not save an interest');
    assert.equal((await interestSnapshot()).outcome.interest_score, null);
    await interest.selectOption({ label: 'High' });
    await interestPage.waitForFunction(() => window.opportunityInterestFixture.snapshot().review.state === 'strong_interest');
    assert.equal((await interestSnapshot()).outcome.interest_score, 8, 'High uses the current categorical metric');
    await interest.selectOption({ label: 'Very high' });
    await interestPage.waitForFunction(() => window.opportunityInterestFixture.snapshot().review.state === 'very_high_interest');
    assert.equal((await interestSnapshot()).outcome.interest_score, 9);
    assert.equal((await interestSnapshot()).review.interest_rating, null, 'Category selection must not manufacture a numeric override');
    const interestExcluded = interestPage.getByRole('checkbox', { name: 'Exclude this opportunity from search feedback', exact: true });
    await interestExcluded.check();
    await interestPage.waitForFunction(() => window.opportunityInterestFixture.snapshot().review.feedback_excluded === true);
    assert.equal((await interestSnapshot()).outcome.interest_score, null);
    assert.equal((await interestSnapshot()).outcome.interest_origin, 'excluded');
    assert.equal(await interest.inputValue(), 'very_high_interest', 'Exclusion preserves the saved interest category');
    await interestExcluded.uncheck();
    await interestPage.waitForFunction(() => window.opportunityInterestFixture.snapshot().review.feedback_excluded === false);
    assert.equal((await interestSnapshot()).outcome.interest_score, 9);
    assert.deepEqual((await interestSnapshot()).writes.map(write => write.name), [
      'review_job_opportunity', 'review_job_opportunity', 'save_opportunity_feedback', 'save_opportunity_feedback',
    ]);
    assert.equal(await interestPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, [], `${name} workspace browser errors`);
    assert.deepEqual(externalRequests, [], `${name} workspace must not contact external services`);
    results.push({ name: `${name} categorical Interest`, result: 'passed', scores: [8, 9], exclusionPreservesCategory: true });
    await context.close();
  }
  const largeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const largeExternal = [], largeErrors = [];
  await blockExternalRequests(largeContext, largeExternal);
  const largePage = await largeContext.newPage();
  largePage.on('pageerror', error => largeErrors.push(error.message));
  const largeUrl = new URL(url); largeUrl.searchParams.set('largeEvaluation', 'true');
  await largePage.goto(largeUrl.href, { waitUntil: 'networkidle' });
  const preserved = largePage.getByRole('textbox', { name: 'Qualitative evaluation', exact: true });
  assert.equal(await preserved.inputValue(), `${'E'.repeat(5000)}\n\n${'F'.repeat(600)}`, 'The saved full evaluation must remain intact');
  assert.equal(await preserved.getAttribute('maxlength'), null, 'Native UTF-16 limits must not reject valid Unicode evaluations');
  assert.equal(await largePage.getByRole('button', { name: /Approve for search feedback|Revoke sharing/ }).count(), 0);
  const largeExcerpt = largePage.locator('.feedback-excerpt'); await largeExcerpt.locator('summary').click();
  assert.equal(await largeExcerpt.locator('p').innerText(), 'E'.repeat(600));
  assert.match(await largePage.getByTestId('fixture-events').innerText(), /Evaluation saves: 0; structured changes: 0/);
  await preserved.fill('🧪'.repeat(12000)); await preserved.press('Enter');
  await largePage.waitForFunction(() => window.opportunityFeedbackFixture.snapshot().evaluationStatus === 'saved');
  assert.equal((await largePage.evaluate(() => window.opportunityFeedbackFixture.snapshot())).review.comment, '🧪'.repeat(12000));
  await preserved.fill('🧪'.repeat(12001)); await preserved.press('Enter');
  await largePage.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
  assert.equal(await preserved.inputValue(), '🧪'.repeat(12001), 'An oversized failed draft remains editable');
  results.push({ name: 'full evaluation and Unicode limit', result: 'passed', characters: 12000 });
  assert.deepEqual(largeErrors, []); assert.deepEqual(largeExternal, []);
  await largeContext.close();
} finally { await browser.close(); }
console.log(JSON.stringify(results, null, 2));
