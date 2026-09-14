const { chromium, expect: baseExpect } = require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const expect = baseExpect.configure({ timeout: 30000 });
const base = 'http://127.0.0.1:3262', width = Number(process.env.PROBE_WIDTH || 1440);
const directory = '/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const previous = JSON.parse(fs.readFileSync(directory + '/' + (width === 390 ? 'public-privacy-390-1789393604792' : 'public-privacy-1440-1789393515387') + '.json'));
const account = JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const prefix = `${directory}/synthesis-sources-${width}-${Date.now()}`;
const observed = { width, completed: false, console: [], pageErrors: [] };
const fits = bounds => bounds.left >= bounds.parentLeft - 1 && bounds.right <= bounds.parentRight + 1 && bounds.right <= bounds.viewport;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
async function click(page, locator) { await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); await locator.scrollIntoViewIfNeeded(); await locator.focus(); await page.keyboard.press('Enter'); }
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 const context = await browser.newContext({ viewport: { width, height: 1000 } });
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
  await click(page, page.locator(`a[href="/engagement/${previous.campaignId}"]`).first());
  await page.waitForURL(url => url.pathname === `/engagement/${previous.campaignId}`);
  async function tab(name) { await click(page, page.getByTestId('page-tabs-nav').getByRole('link', { name, exact: true })); await page.waitForURL(url => url.searchParams.get('tab') === name.toLowerCase()); }
  await tab('Setup');
  const sourceCategoryLabel = `SYNTHETIC retained category ${width} ${Date.now()}`;
  await page.locator('#engagement-category-label').fill(sourceCategoryLabel);
  const categoryCreated = page.waitForResponse(response => response.url().endsWith(`/campaigns/${previous.campaignId}/categories`) && response.request().method() === 'POST');
  await click(page, page.getByRole('button', { name: 'Add category', exact: true }));
  assert.equal((await categoryCreated).status(), 201);
  await tab('Analysis');
  const panel = page.getByRole('region', { name: 'Retained synthesis sources' });
  await expect(panel).toBeVisible();
  await panel.getByRole('heading', { name: 'Retained synthesis sources', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: prefix + '-selection.png' });
  await expect(panel.getByRole('button', { name: 'Save selected sources', exact: true })).toBeEnabled();
  for (const label of ['Pending', 'Flagged', 'Rejected']) await panel.getByLabel(label, { exact: true }).check();
  const endpoint = base + `/api/engagement/campaigns/${previous.campaignId}/synthesis/sources`;
  let originalReceipt, retainedIntent;
  await page.route(endpoint, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    retainedIntent = route.request().postDataJSON();
    const response = await route.fetch(); assert.equal(response.status(), 201); originalReceipt = await response.json();
    await route.abort('connectionreset');
  });
  await click(page, panel.getByRole('button', { name: 'Save selected sources', exact: true }));
  await expect(panel.getByRole('button', { name: 'Retry retained source request' })).toBeEnabled();
  await expect(panel.getByRole('alert')).toBeVisible();
  assert(originalReceipt); observed.originalReceipt = originalReceipt;
  await panel.getByRole("button", { name: "Retry retained source request" }).scrollIntoViewIfNeeded();
  observed.retryStyle = await panel.getByRole("button", { name: "Retry retained source request" }).evaluate(element => {
    const css = getComputedStyle(element), rect = element.getBoundingClientRect();
    return { color: css.color, background: css.backgroundColor, opacity: css.opacity, display: css.display, visibility: css.visibility, width: rect.width, height: rect.height };
  });
  await panel.getByRole("button", { name: "Retry retained source request" }).screenshot({ path: prefix + "-retry-control.png" });
  await page.screenshot({ path: prefix + "-pending.png" });
  const preserve = panel.getByRole('button', { name: 'Preserve request and start another selection' });
  await preserve.scrollIntoViewIfNeeded();
  observed.recoveryControl = await preserve.evaluate(element => {
    const rect = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, parentLeft: parent.left, parentRight: parent.right, viewport: innerWidth };
  });
  await page.screenshot({ path: prefix + '-recovery-control.png' });
  assert(fits(observed.recoveryControl), 'Recovery control is clipped by its container');
  if (width === 390) {
    observed.layoutGuard = await preserve.evaluate(element => {
      const originalClass = element.className, originalStyle = element.getAttribute('style');
      const bounds = () => { const rect = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect(); return { left: rect.left, right: rect.right, parentLeft: parent.left, parentRight: parent.right, viewport: innerWidth }; };
      try {
        element.classList.add('relative'); const harmless = bounds();
        element.style.maxWidth = 'none'; element.style.whiteSpace = 'nowrap'; const targeted = bounds();
        return { harmless, targeted };
      } finally { element.className = originalClass; if (originalStyle === null) element.removeAttribute('style'); else element.setAttribute('style', originalStyle); }
    });
    assert(fits(observed.layoutGuard.harmless), 'Harmless control failed');
    assert(!fits(observed.layoutGuard.targeted), 'Layout guard missed the unwrapped recovery label');
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Pending request layout overflows viewport");
  await page.unroute(endpoint);
  await page.reload();
  const replayResponse = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST');
  await click(page, panel.getByRole('button', { name: 'Retry retained source request' }));
  const replay = await replayResponse; assert.equal(replay.status(), 200);
  assert.deepEqual(replay.request().postDataJSON(), retainedIntent);
  assert.deepEqual(await replay.json(), { ...originalReceipt, replayed: true });
  await expect(panel.getByText(/^Source saved:/)).toBeVisible();
  await expect(panel.getByRole('article', { name: 'Saved source inspection' })).toBeVisible();
  async function read(requestId) { const response = await page.request.get(`${endpoint}?requestId=${requestId}`); assert.equal(response.status(), 200); const result = await response.json(); assert.equal(sha(result.snapshotText), result.snapshotSha256); return result; }
  const original = await read(originalReceipt.requestId);
  observed.counts = original.snapshot.counts; assert(original.snapshot.items.length + original.snapshot.answers.length > 0);
  await panel.getByRole('article', { name: 'Saved source inspection' }).getByRole('heading', { level: 3 }).evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: prefix + '-original.png' });
  observed.originalSha256 = original.snapshotSha256;
  // Correct a current category through its real editor; the previous source must retain its original definition.
  await tab('Setup');
  const editSummary = page.getByText(`Edit ${sourceCategoryLabel}`, { exact: true });
  await click(page, editSummary);
  const editor = editSummary.locator('..');
  const label = editor.getByLabel('Category label', { exact: true });
  const beforeLabel = await label.inputValue(), afterLabel = `SYNTHETIC source history ${width} ${Date.now()}`;
  await label.fill(afterLabel);
  const correction = page.waitForResponse(response => response.url().endsWith(`/campaigns/${previous.campaignId}/categories`) && response.request().method() === 'PATCH');
  await click(page, editor.getByRole('button', { name: 'Save category', exact: true }));
  assert.equal((await correction).status(), 200);
  await tab('Analysis');
  for (const label of ['Pending', 'Flagged', 'Rejected']) await panel.getByLabel(label, { exact: true }).check();
  const secondResponse = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST');
  await click(page, panel.getByRole('button', { name: 'Save selected sources', exact: true }));
  const second = await secondResponse; assert.equal(second.status(), 201);
  observed.correctedReceipt = await second.json();
  const corrected = await read(observed.correctedReceipt.requestId), originalAgain = await read(originalReceipt.requestId);
  assert.equal(originalAgain.snapshotText, original.snapshotText); assert.equal(originalAgain.snapshotSha256, original.snapshotSha256);
  assert.notEqual(corrected.snapshotSha256, original.snapshotSha256);
  assert(corrected.snapshot.definitions.some(entry => entry.definitionText.includes(afterLabel)));
  assert(!original.snapshotText.includes(afterLabel));
  observed.correction = { beforeLabel, afterLabel, originalPreserved: true, correctedSha256: corrected.snapshotSha256 };
  await expect(panel.getByRole('article', { name: 'Saved source inspection' })).toBeVisible();
  await panel.getByRole('article', { name: 'Saved source inspection' }).getByRole('heading', { level: 3 }).evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: prefix + '-corrected.png' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const anonymous = await browser.newContext();
  for (const path of [endpoint, `${endpoint}?requestId=${originalReceipt.requestId}`]) assert.equal((await anonymous.request.get(path)).status(), 401);
  await anonymous.close();
  const stale = await page.request.get(endpoint, { headers: { 'x-openplan-expected-user': crypto.randomUUID() } }); assert.equal(stale.status(), 403);
  observed.privacy = { anonymousList: 401, anonymousRead: 401, staleAccount: 403 };
  assert.deepEqual(observed.pageErrors, []);
  assert(observed.console.every(entry => entry.includes('ERR_CONNECTION_RESET') || entry.includes('ERR_FAILED')));
  observed.completed = true; console.log(prefix);
 } catch (error) {
  observed.error = error.stack; await page.screenshot({ path: prefix + '-failure.png' }); fs.writeFileSync(prefix + '-failure.txt', await page.locator('body').ariaSnapshot()); throw error;
 } finally { fs.writeFileSync(prefix + '.json', JSON.stringify(observed, null, 2)); await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
