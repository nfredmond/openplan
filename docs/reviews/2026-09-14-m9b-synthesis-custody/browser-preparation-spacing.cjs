const { chromium, expect: baseExpect } = require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const expect = baseExpect.configure({ timeout: 30000 });
const base = 'http://127.0.0.1:3262';
const directory = '/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const previous = JSON.parse(fs.readFileSync(directory + '/synthesis-preparation-390-1789416585293.json'));
const account = JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const prefix = `${directory}/synthesis-preparation-spacing-390-${Date.now()}`;
const observed = { completed: false, width: 390, console: [], pageErrors: [], previousFullJourney: 'synthesis-preparation-390-1789416585293', runnerSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex') };
async function click(page, locator) { await expect(locator).toBeVisible(); await locator.scrollIntoViewIfNeeded(); await locator.focus(); await page.keyboard.press('Enter'); }
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 const context = await browser.newContext({ viewport: { width: 390, height: 1000 } });
 const page = await context.newPage();
 page.on('console', entry => { if (entry.type() === 'error') observed.console.push(entry.text()); });
 page.on('pageerror', error => observed.pageErrors.push(error.message));
 try {
  observed.identity = await (await page.request.get(base + '/api/health')).json();
  assert.equal(observed.identity.deployment.commit, process.env.PROBE_COMMIT);
  await page.goto(base);
  await page.getByRole('link', { name: /Sign in/i }).first().click();
  await page.getByLabel('Work email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await click(page, page.getByRole('button', { name: 'Sign in', exact: true }));
  await page.waitForURL(url => !url.pathname.includes('sign-in'));
  await click(page, page.getByRole('link', { name: 'Engagement', exact: true }).first());
  await page.waitForURL('**/engagement');
  const receipt = previous.originalReceipt;
  await click(page, page.locator(`a[href="/engagement/${receipt.campaignId}"]`).first());
  await page.waitForURL(url => url.pathname === `/engagement/${receipt.campaignId}`);
  await click(page, page.getByTestId('page-tabs-nav').getByRole('link', { name: 'Analysis', exact: true }));
  await page.waitForURL(url => url.searchParams.get('tab') === 'analysis');
  const panel = page.getByRole('region', { name: 'Retained synthesis sources' });
  await click(page, panel.getByRole('button', { name: `Open saved source ${receipt.requestId.slice(0, 8)}`, exact: true }));
  await expect(panel.getByText(`Source SHA256: ${previous.originalSha256}`, { exact: true })).toBeVisible();
  const prep = panel.getByRole('region', { name: 'Complete source preparation' });
  await prep.getByRole('combobox', { name: 'Inspect a prepared group', exact: true }).selectOption({ label: previous.preparation.questionGroup });
  await click(page, prep.getByText('Complete group membership', { exact: true }));
  const membership = prep.locator('pre');
  await expect(membership).toHaveText(previous.preparation.memberId);
  observed.membershipSpacing = await membership.evaluate(element => {
    const summary = element.previousElementSibling, css = getComputedStyle(summary);
    const ring = parseFloat(css.outlineWidth) + Math.max(0, parseFloat(css.outlineOffset));
    const oldClass = element.className, oldStyle = element.getAttribute('style');
    const measure = () => ({ gap: element.getBoundingClientRect().top - summary.getBoundingClientRect().bottom, ring });
    try { const baseline = measure(); element.classList.add('relative'); const harmless = measure(); element.style.marginTop = '0px'; return { baseline, harmless, targeted: measure() }; }
    finally { element.className = oldClass; if (oldStyle === null) element.removeAttribute('style'); else element.setAttribute('style', oldStyle); }
  });
  const clears = bounds => bounds.gap >= Math.max(6, bounds.ring);
  assert(clears(observed.membershipSpacing.baseline)); assert(clears(observed.membershipSpacing.harmless)); assert(!clears(observed.membershipSpacing.targeted));
  await membership.scrollIntoViewIfNeeded();
  await page.screenshot({ path: prefix + '-membership.png' });
  const source = await page.request.get(`${base}/api/engagement/campaigns/${receipt.campaignId}/synthesis/sources?requestId=${receipt.requestId}`);
  assert.equal(source.status(), 200); const saved = await source.json();
  assert.equal(crypto.createHash('sha256').update(saved.snapshotText).digest('hex'), previous.originalSha256);
  observed.sourceSha256 = saved.snapshotSha256; observed.originalMemberId = previous.preparation.memberId;
  assert.deepEqual(observed.console, []); assert.deepEqual(observed.pageErrors, []);
  observed.completed = true; console.log(prefix);
 } catch (error) { observed.error = error.stack; await page.screenshot({ path: prefix + '-failure.png' }); throw error; }
 finally { fs.writeFileSync(prefix + '.json', JSON.stringify(observed, null, 2)); await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
