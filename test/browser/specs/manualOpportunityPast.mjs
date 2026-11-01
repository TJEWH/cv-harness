/** Real CloudWorkspace regression using an isolated, memory-only fixture. */
import assert from 'node:assert/strict';
import { launchBrowser, blockExternalRequests, fixtureUrl } from '../../support/browser/runtime.mjs';
const base = fixtureUrl(process.env.MANUAL_PAST_FIXTURE_URL || 'http://127.0.0.1:5177/cv-harness/test/browser/pages/job-workspace.html?flow=manual-past', ['/cv-harness/test/browser/pages/job-workspace.html', '/test/browser/pages/job-workspace.html']);
assert.equal(base.searchParams.get('flow'), 'manual-past');
const browser = await launchBrowser();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390 });
    const external = [], errors = [];
    await blockExternalRequests(context, external);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const snapshot = () => page.evaluate(() => window.manualOpportunityPastFixture.snapshot());
    const waitForReview = (field, value) => page.waitForFunction(({ field, value }) => window.manualOpportunityPastFixture.snapshot().review[field] === value, { field, value });
    const navigate = async name => {
      const selector = width > 760 ? '.fixture-toolbar' : '.fixture-mobile-nav';
      await page.locator(selector).getByRole('button', { name, exact: true }).click();
      await page.locator('.jobs-table-scroll:visible').waitFor();
    };
    const filters = async () => {
      const toggle = page.getByRole('button', { name: 'Filters', exact: true });
      if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    };
    const closeFilters = async () => {
      const toggle = page.getByRole('button', { name: 'Filters', exact: true });
      if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    };
    const row = () => page.locator('.jobs-result-row:visible').filter({ hasText: 'PhD in Human-Centred Robotics' });
    await page.goto(base.href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.manualOpportunityPastFixture && !document.querySelector('.jobs-loading'));
    const before = await snapshot();
    assert.equal(before.review.manually_archived, false);
    assert.equal(before.application.status, 'preparation');
    await filters();
    await page.getByRole('checkbox', { name: 'Show opportunities with applications', exact: true }).check();
    const opportunityFilter = page.getByRole('combobox', { name: 'Opportunities', exact: true });
    assert.equal(await opportunityFilter.inputValue(), 'current');
    await closeFilters();
    await row().locator('.jobs-row-toggle').click();
    const opportunityDetail = page.locator('.opportunity-detail:visible');
    await opportunityDetail.waitFor();
    const archive = opportunityDetail.getByRole('checkbox', { name: 'Remove from current opportunities', exact: true });
    await archive.check(); await waitForReview('manually_archived', true);
    assert.equal(await opportunityDetail.isVisible(), true, 'Changing list disposition must keep the detail open');
    await opportunityDetail.getByRole('combobox', { name: 'Technical issue (optional)', exact: true }).selectOption('requirements');
    await waitForReview('technical_issue_category', 'requirements');
    const note = opportunityDetail.getByRole('textbox', { name: 'Technical details (optional)', exact: true });
    const writesBeforeTyping = (await snapshot()).writes.length;
    await note.fill('The required degree is not yet fulfilled. Technical note: private@example.invalid.');
    assert.equal((await snapshot()).writes.length, writesBeforeTyping, 'Typing technical details must stay local');
    await note.press('Enter');
    await waitForReview('technical_issue_note', 'The required degree is not yet fulfilled. Technical note: private@example.invalid.');
    await page.getByRole('button', { name: 'All opportunities', exact: true }).click();
    await page.locator('.jobs-table-scroll:visible').waitFor();
    await filters();
    assert.equal(await opportunityFilter.inputValue(), 'past', 'Back must open the confirmed Past list');
    await closeFilters();
    assert.equal(await row().count(), 1);
    const archived = await snapshot();
    assert.deepEqual(archived.opportunity, before.opportunity, 'Personal status must not rewrite catalogue evidence');
    assert.equal(archived.review.state, before.review.state);
    assert.equal(archived.review.interest_rating, before.review.interest_rating);
    assert.equal(archived.review.feedback_excluded, false, 'Archiving must not imply feedback exclusion');
    assert.equal(archived.review.comment, before.review.comment);
    assert.equal('search_feedback_summary' in archived.review, false, 'The current review keeps one full evaluation');
    assert.deepEqual(archived.application.context_json, before.application.context_json);
    assert.deepEqual(archived.application.status_history, before.application.status_history);

    await navigate('applications'); await filters();
    const applicationFilter = page.getByRole('combobox', { name: 'Applications', exact: true });
    assert.equal(await applicationFilter.inputValue(), 'current');
    assert.equal(await row().count(), 0, 'The linked application must leave Current without changing its status');
    await applicationFilter.selectOption('past'); await closeFilters();
    assert.equal(await row().count(), 1);
    await row().locator('.jobs-row-toggle').click();
    const applicationDetail = page.locator('.application-workspace:visible'); await applicationDetail.waitFor();
    const applicationArchive = applicationDetail.getByRole('checkbox', { name: 'Remove from current opportunities', exact: true });
    assert.equal(await applicationArchive.isChecked(), true);
    assert.equal(await applicationDetail.getByRole('textbox', { name: 'Technical details (optional)', exact: true }).inputValue(), archived.review.technical_issue_note);
    await applicationArchive.uncheck(); await waitForReview('manually_archived', false);
    assert.equal(await applicationDetail.isVisible(), true);
    await page.getByRole('button', { name: 'All applications', exact: true }).first().click();
    await page.locator('.jobs-table-scroll:visible').waitFor(); await filters();
    assert.equal(await applicationFilter.inputValue(), 'current', 'Undoing manual Past restores a future-deadline application to Current');
    await closeFilters(); assert.equal(await row().count(), 1);
    await navigate('opportunities'); await filters();
    assert.equal(await opportunityFilter.inputValue(), 'past', 'Independent workspace filter choices remain preserved');
    assert.equal(await row().count(), 0);
    await opportunityFilter.selectOption('current'); await closeFilters(); assert.equal(await row().count(), 1);
    const after = await snapshot();
    assert.equal(after.review.manually_archived, false);
    assert.equal(after.review.interest_rating, before.review.interest_rating); assert.equal(after.review.state, before.review.state);
    assert.equal(after.review.technical_issue_category, 'requirements');
    assert.equal(after.review.technical_issue_note, archived.review.technical_issue_note);
    assert.deepEqual(after.opportunity, before.opportunity);
    assert.deepEqual(after.application.context_json, before.application.context_json);
    assert.equal(after.application.status, before.application.status);
    assert.deepEqual(after.application.status_history, before.application.status_history);
    for (const write of after.writes) {
      assert.equal(write.name, 'save_opportunity_feedback');
      assert.equal(Object.keys(write.parameters.p_patch).some(key => ['state', 'interest_rating', 'feedback_excluded', 'search_feedback_summary'].includes(key)), false);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(JSON.stringify({ width, result: 'passed', mutations: after.writes.length,
      verified: ['manual Past and restore', 'linked application classification', 'unchanged interest/deadline/history/frozen context', 'technical note separated from evaluation'] }));
    await context.close();
  }
} finally { await browser.close(); }
