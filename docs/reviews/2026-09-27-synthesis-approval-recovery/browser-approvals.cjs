const { chromium, expect: baseExpect } = require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const expect = baseExpect.configure({ timeout: 30000 });
const width = Number(process.env.PROBE_WIDTH || 1440), base = 'http://127.0.0.1:3262';
const directory = '/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const previousName = width === 390 ? 'synthesis-preparation-390-1789416585293' : 'synthesis-preparation-1440-1789416818345';
const sourceReceipt = JSON.parse(fs.readFileSync(`${directory}/${previousName}.json`)).originalReceipt;
const account = JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const prefix = `${directory}/synthesis-approvals-${width}-${Date.now()}`;
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const observed = { width, previousSourceJourney: previousName, completed: false, console: [], pageErrors: [], runnerSha256: sha(fs.readFileSync(__filename)) };
async function click(page, locator) { await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); await locator.scrollIntoViewIfNeeded(); await locator.focus(); await page.keyboard.press('Enter'); }
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 const context = await browser.newContext({ viewport: { width, height: 1000 } });
 const page = await context.newPage();
 await (await context.newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: false });
 page.on('console', entry => { if (entry.type() === 'error') observed.console.push(entry.text()); });
 page.on('pageerror', error => observed.pageErrors.push(error.message));
 try {
  observed.identity = await (await page.request.get(base + '/api/health')).json();
  assert.equal(observed.identity.deployment.commit, process.env.PROBE_COMMIT);
  await page.goto(base); await click(page, page.getByRole('link', { name: /Sign in/i }).first());
  await page.getByLabel('Work email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await click(page, page.getByRole('button', { name: 'Sign in', exact: true }));
  await page.waitForURL(url => !url.pathname.includes('sign-in'));
  await click(page, page.getByRole('link', { name: 'Engagement', exact: true }).first()); await page.waitForURL('**/engagement');
  await click(page, page.locator(`a[href="/engagement/${sourceReceipt.campaignId}"]`).first());
  await page.waitForURL(url => url.pathname === `/engagement/${sourceReceipt.campaignId}`);
  await click(page, page.getByTestId('page-tabs-nav').getByRole('link', { name: 'Analysis', exact: true }));
  await page.waitForURL(url => url.searchParams.get('tab') === 'analysis');
  const sources = page.getByRole('region', { name: 'Retained synthesis sources' });
  async function openSource() {
   const button = sources.getByRole('button', { name: `Open saved source ${sourceReceipt.requestId.slice(0, 8)}`, exact: true });
   while (await button.count() === 0 && await sources.getByRole('button', { name: 'Load older sources', exact: true }).count()) await click(page, sources.getByRole('button', { name: 'Load older sources', exact: true }));
   await click(page, button);
   await expect(page.getByRole('region', { name: 'Retained staff reviews' })).toBeVisible();
  }
  await openSource();
  const reviews = page.getByRole('region', { name: 'Retained staff reviews' });
  const reviewEndpoint = `${base}/api/engagement/campaigns/${sourceReceipt.campaignId}/synthesis/reviews`;
  const endpoint = `${base}/api/engagement/campaigns/${sourceReceipt.campaignId}/synthesis/approvals`;
  const response = page.waitForResponse(res => res.url() === reviewEndpoint && res.request().method() === 'POST');
  await click(page, reviews.getByRole('button', { name: 'Create staff review', exact: true }));
  const created = await response; assert.equal(created.status(), 201); const receipt = await created.json(); observed.originalReceipt = receipt;
  const saved = reviews.getByRole('article', { name: 'Saved staff review' });
  const approval = saved.getByRole('region', { name: 'Exact revision approval' });
  const reason = () => approval.getByRole('textbox', { name: 'Reason for approval or withdrawal', exact: true });
  async function read(revisionId) {
   const result = await page.request.get(`${reviewEndpoint}?${new URLSearchParams({ mode: 'read', reviewId: receipt.reviewId, ...(revisionId ? { revisionId } : {}) })}`);
   assert.equal(result.status(), 200); const value = await result.json();
   assert.equal(sha(value.revision.contentText), value.revision.contentSha256); assert.equal(sha(value.preparationText), value.preparationSha256); return value;
  }
  async function history() {
   const result = await page.request.get(`${endpoint}?reviewId=${receipt.reviewId}`); assert.equal(result.status(), 200);
   assert.match(result.headers()['cache-control'], /no-store/); const value = await result.json();
   assert.equal(value.history.eventCount, value.history.entries.length);
   for (const packet of value.history.entries) assert.equal(sha(packet.eventText), packet.eventSha256);
   return value;
  }
  await expect(approval.getByText('Revision 1 is unapproved.', { exact: true })).toBeVisible();
  const original = await read(), sourceUrl = `${base}/api/engagement/campaigns/${sourceReceipt.campaignId}/synthesis/sources?requestId=${sourceReceipt.requestId}`;
  const source = await (await page.request.get(sourceUrl)).json(); assert.equal(sha(source.snapshotText), sourceReceipt.snapshotSha256);
  // A quota refusal must preserve the latest reason through actual browser refocus and parent revalidation.
  const latestReason = `SYNTHETIC exact draft checked after quota refusal ${width} ${crypto.randomUUID()}`;
  await page.evaluate(() => {
   window.__approvalQuota = { original: Storage.prototype.setItem, failures: 0, focusEvents: 0 };
   window.addEventListener('focus', () => { window.__approvalQuota.focusEvents++; });
   Storage.prototype.setItem = function(key, value) {
    if (key.startsWith('openplan:synthesis-approval:') && window.__approvalQuota.failures === 0) { window.__approvalQuota.failures++; throw new DOMException('SYNTHETIC quota refusal', 'QuotaExceededError'); }
    return window.__approvalQuota.original.call(this, key, value);
   };
  });
  try { await reason().fill(latestReason); } finally { await page.evaluate(() => { Storage.prototype.setItem = window.__approvalQuota.original; }); }
  assert.equal(await page.evaluate(() => window.__approvalQuota.failures), 1);
  await expect(reason()).toHaveValue(latestReason); await expect(approval.getByRole('button', { name: 'Approve revision 1', exact: true })).toBeDisabled();
  const beforeFocus = await page.evaluate(() => window.__approvalQuota.focusEvents);
  const revalidation = Promise.all([page.waitForResponse(res => res.url() === sourceUrl), page.waitForResponse(res => res.url().includes('/synthesis/reviews?mode=read'))]);
  void revalidation.catch(() => undefined);
  const elsewhere = await context.newPage(); await (await context.newCDPSession(elsewhere)).send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await elsewhere.goto('about:blank'); await elsewhere.bringToFront(); await page.bringToFront();
  for (const res of await revalidation) assert.equal(res.status(), 200);
  await expect.poll(() => page.evaluate(() => window.__approvalQuota.focusEvents)).toBeGreaterThan(beforeFocus);
  await expect(reason()).toHaveValue(latestReason); await expect(reason()).toBeDisabled();
  await approval.scrollIntoViewIfNeeded(); await page.screenshot({ path: prefix + '-quota.png' }); await elsewhere.close();
  await click(page, approval.getByRole('button', { name: 'Preserve approval reason and start another', exact: true }));
  const copies = approval.getByRole('region', { name: 'Preserved approval recovery copies' });
  await click(page, copies.getByText('Preserved approval reason', { exact: true }).last());
  await expect(copies.getByText(latestReason, { exact: false })).toBeVisible();
  await click(page, copies.getByRole('button', { name: 'Restore preserved approval copy', exact: true }).last());
  await expect(reason()).toHaveValue(latestReason);
  observed.quotaRecovery = { actualFocusEvents: await page.evaluate(() => window.__approvalQuota.focusEvents), restoredReason: latestReason };
  // The actual server commits before the browser loses its acknowledgement.
  let firstIntent, firstReceipt;
  await page.route(endpoint, async route => {
   if (route.request().method() !== 'POST') return route.continue();
   firstIntent = route.request().postDataJSON(); const result = await route.fetch(); assert.equal(result.status(), 201); firstReceipt = await result.json(); await route.abort('connectionreset');
  });
  await click(page, approval.getByRole('button', { name: 'Approve revision 1', exact: true }));
  await expect(approval.getByRole('button', { name: 'Retry retained approval request', exact: true })).toBeEnabled();
  await expect(approval.getByRole('alert').first()).toBeVisible(); assert(firstReceipt); await page.unroute(endpoint);
  await expect(approval.getByRole('button', { name: 'Approve revision 1', exact: true })).toBeDisabled();
  await saved.getByRole('textbox', { name: 'Staff review notes', exact: true }).fill(`SYNTHETIC corrected after original approval ${width}`);
  await saved.getByRole('textbox', { name: 'Reason for correction', exact: true }).fill('SYNTHETIC retain a distinct corrected version.');
  await click(page, saved.getByRole('button', { name: 'Save reasoned correction', exact: true }));
  await expect(saved.getByRole('heading', { name: /revision 2$/, level: 4 })).toBeVisible();
  await expect(approval.getByText('Revision 2 is unapproved.', { exact: true })).toBeVisible();
  const corrected = await read();
  const retried = page.waitForResponse(res => res.url() === endpoint && res.request().method() === 'POST');
  await click(page, approval.getByRole('button', { name: 'Retry retained approval request', exact: true }));
  const retry = await retried; assert.equal(retry.status(), 200); assert.deepEqual(retry.request().postDataJSON(), firstIntent);
  assert.deepEqual(await retry.json(), { ...firstReceipt, replayed: true });
  await expect(approval.getByText('Recovered approval for revision 1.', { exact: true })).toBeVisible();
  await expect(approval.getByText('Revision 2 is unapproved.', { exact: true })).toBeVisible();
  assert.equal((await history()).history.eventCount, 1);
  await approval.scrollIntoViewIfNeeded(); await page.screenshot({ path: prefix + '-recovered.png' });
  await click(page, saved.getByRole('button', { name: 'Open revision 1', exact: true }));
  await expect(approval.getByText('Revision 1 is approved.', { exact: true })).toBeVisible();
  await reason().fill('SYNTHETIC withdraw the original after its correction.');
  await click(page, approval.getByRole('button', { name: 'Withdraw approval of revision 1', exact: true }));
  await expect(approval.getByText('Revision 1 is withdrawn.', { exact: true })).toBeVisible();
  await expect(approval.getByRole('button', { name: 'Approve revision 1', exact: true })).toBeDisabled();
  await click(page, saved.getByRole('button', { name: 'Open current review', exact: true }));
  await expect(approval.getByText('Revision 2 is unapproved.', { exact: true })).toBeVisible();
  await reason().fill('SYNTHETIC checked the exact corrected version.');
  await click(page, approval.getByRole('button', { name: 'Approve revision 2', exact: true }));
  await expect(approval.getByText('Revision 2 is approved.', { exact: true })).toBeVisible();
  const final = await history(); assert.equal(final.history.eventCount, 3);
  assert.deepEqual(final.history.entries.map(row => { const e = JSON.parse(row.eventText); return [e.intent.operation, e.intent.revisionNo]; }), [['approve', 1], ['withdraw', 1], ['approve', 2]]);
  assert.equal((await read(receipt.requestId)).revision.contentText, original.revision.contentText);
  assert.equal((await read()).revision.contentText, corrected.revision.contentText);
  assert.equal((await read()).preparationText, original.preparationText);
  assert.equal((await (await page.request.get(sourceUrl)).json()).snapshotText, source.snapshotText);
  const fits = row => row.left >= row.parentLeft - 1 && row.right <= row.parentRight + 1 && row.right <= row.viewport + 1;
  observed.bounds = await approval.locator('button').evaluateAll(buttons => {
   const measure = () => buttons.filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect(), p = b.parentElement.getBoundingClientRect(), s = getComputedStyle(b.parentElement); return { text: b.textContent, left: r.left, right: r.right, parentLeft: p.left + parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth), parentRight: p.right - parseFloat(s.paddingRight) - parseFloat(s.borderRightWidth), viewport: innerWidth }; });
   const first = buttons.find(b => b.getClientRects().length), style = first.getAttribute('style');
   try { const baseline = measure(); first.style.position = 'relative'; const harmless = measure(); first.style.maxWidth = 'none'; first.style.minWidth = `${first.parentElement.getBoundingClientRect().width + 40}px`; return { baseline, harmless, targeted: measure() }; }
   finally { if (style === null) first.removeAttribute('style'); else first.setAttribute('style', style); }
  });
  assert(observed.bounds.baseline.length > 0); assert(observed.bounds.baseline.every(fits)); assert(observed.bounds.harmless.every(fits)); assert(observed.bounds.targeted.some(row => !fits(row)));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await approval.scrollIntoViewIfNeeded(); await page.screenshot({ path: prefix + '-history.png' });
  const anonymous = await browser.newContext(); assert.equal((await anonymous.request.get(`${endpoint}?reviewId=${receipt.reviewId}`)).status(), 401); await anonymous.close();
  assert.equal((await page.request.get(`${endpoint}?reviewId=${receipt.reviewId}`, { headers: { 'x-openplan-expected-user': crypto.randomUUID() } })).status(), 403);
  // Route to the real server with a stale account expectation; observe private state clearing after its actual denial.
  await page.route(`${endpoint}?**`, route => route.continue({ headers: { ...route.request().headers(), 'x-openplan-expected-user': crypto.randomUUID() } }));
  await click(page, approval.getByRole('button', { name: 'Refresh approval history', exact: true }));
  await expect(approval).toHaveCount(0); await expect(page.getByText('SYNTHETIC checked the exact corrected version.', { exact: true })).toHaveCount(0);
  assert.equal(observed.pageErrors.length, 0); assert(observed.console.every(message => /ERR_CONNECTION_RESET|403 \(Forbidden\)/.test(message)), JSON.stringify(observed.console));
  observed.completed = true; observed.originalSha256 = original.revision.contentSha256; observed.correctedSha256 = corrected.revision.contentSha256;
  observed.preparationSha256 = original.preparationSha256; observed.sourceSha256 = source.snapshotSha256; observed.finalHistory = final; observed.firstIntent = firstIntent;
 } catch (error) { observed.error = error.stack; await page.screenshot({ path: prefix + '-failure.png' }); fs.writeFileSync(prefix + '-failure.txt', await page.locator('body').ariaSnapshot()); throw error; }
 finally { fs.writeFileSync(prefix + '.json', JSON.stringify(observed, null, 2)); console.log(prefix + '.json'); await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
