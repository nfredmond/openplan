const { chromium, expect: baseExpect } = require('/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13/qa-harness/node_modules/playwright/test');
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const expect = baseExpect.configure({ timeout: 30000 });
const width = Number(process.env.PROBE_WIDTH || 1440), base = 'http://localhost:3193';
const directory = '/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const previousName = width === 390 ? 'synthesis-preparation-390-1789416585293' : 'synthesis-preparation-1440-1789416818345';
const sourceReceipt = JSON.parse(fs.readFileSync(`${directory}/${previousName}.json`)).originalReceipt;
const account = JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const prefix = `/home/nathaniel/.local/state/openplan/approval-resume-2026-09-27/response-links-browser-${width}-${Date.now()}`;
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const observed = { width, previousSourceJourney: previousName, completed: false, console: [], requestFailures: [], pageErrors: [], runnerSha256: sha(fs.readFileSync(__filename)) };
async function click(page, locator) { await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); await locator.scrollIntoViewIfNeeded(); await locator.focus(); await page.keyboard.press('Enter'); }
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 const context = await browser.newContext({ viewport: { width, height: 1000 } });
 const page = await context.newPage();
 await (await context.newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: false });
 page.on('console', entry => { if (entry.type() === 'error') observed.console.push(entry.text()); });
 page.on('requestfailed', request => observed.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
 page.on('pageerror', error => observed.pageErrors.push(error.message));
 try {
  observed.identity = await (await page.request.get(base + '/api/health')).json();
  assert.equal(observed.identity.deployment.commit, "unknown"); observed.identifiedCheckout = "/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13";
  await page.goto(base); await click(page, page.getByRole('link', { name: /Sign in/i }).first());
  await page.getByLabel('Work email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await click(page, page.getByRole('button', { name: 'Sign in', exact: true }));
  await page.waitForURL(url => !url.pathname.includes('sign-in'));
  await click(page, page.getByRole('link', { name: 'Engagement', exact: true }).first()); await page.waitForURL('**/engagement');
  await click(page, page.locator(`a[href="/engagement/${sourceReceipt.campaignId}"]`).first());
  await page.waitForURL(url => url.pathname === `/engagement/${sourceReceipt.campaignId}`);
  await click(page, page.getByTestId('page-tabs-nav').getByRole('link', { name: 'Setup', exact: true }));
  const theme = `SYNTHETIC response link browser ${width} ${crypto.randomUUID()}`;
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add entry', exact: true }) });
  await form.getByLabel('Theme', { exact: true }).fill(theme);
  await form.getByLabel('You said', { exact: true }).fill('SYNTHETIC retained community concern');
  await form.getByLabel('We did', { exact: true }).fill('SYNTHETIC original staff response');
  const added = page.waitForResponse(res => res.url().endsWith('/closeloop') && res.request().method() === 'POST');
  await click(page, form.getByRole('button', { name: 'Add entry', exact: true }));
  const addition = await added; assert.equal(addition.status(), 201); observed.responseReceipt = await addition.json();
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
  const createdResponse = page.waitForResponse(res => res.url() === reviewEndpoint && res.request().method() === 'POST');
  await click(page, reviews.getByRole('button', { name: 'Create staff review', exact: true }));
  const created = await createdResponse; assert.equal(created.status(), 201); const review = await created.json(); observed.reviewReceipt = review;
  const saved = reviews.getByRole('article', { name: 'Saved staff review' });
  const approval = saved.getByRole('region', { name: 'Exact revision approval' });
  await approval.getByRole('textbox', { name: 'Reason for approval or withdrawal', exact: true }).fill('SYNTHETIC checked exact source wording for linkage');
  await click(page, approval.getByRole('button', { name: 'Approve revision 1', exact: true }));
  await expect(approval.getByText('Revision 1 is approved.', { exact: true })).toBeVisible();
  const links = saved.getByRole('region', { name: 'Response links for this staff review' });
  await links.getByRole('combobox', { name: 'Response to link', exact: true }).selectOption({ label: theme });
  await links.getByRole('combobox', { name: 'Reviewed group', exact: true }).selectOption({ index: 1 });
  await click(page, links.getByRole('button', { name: 'Inspect response link', exact: true }));
  const reason = links.getByRole('textbox', { name: 'Reason for this response link', exact: true });
  await expect(links.getByText('SYNTHETIC original staff response', { exact: false })).toBeVisible();
  const quotaReason = `SYNTHETIC preserve quota-failed linkage ${width}`;
  await page.evaluate(() => {
   window.__responseQuota = { original: Storage.prototype.setItem, failures: 0, focuses: 0 };
   window.addEventListener('focus', () => window.__responseQuota.focuses++);
   Storage.prototype.setItem = function(key, value) {
    if (key.startsWith('openplan:synthesis-response-link:') && window.__responseQuota.failures === 0) { window.__responseQuota.failures++; throw new DOMException('SYNTHETIC quota refusal', 'QuotaExceededError'); }
    return window.__responseQuota.original.call(this, key, value);
   };
  });
  try { await reason.fill(quotaReason); } finally { await page.evaluate(() => { Storage.prototype.setItem = window.__responseQuota.original; }); }
  assert.equal(await page.evaluate(() => window.__responseQuota.failures), 1);
  await expect(reason).toHaveValue(quotaReason); await expect(reason).toBeDisabled();
  const beforeFocus = await page.evaluate(() => window.__responseQuota.focuses);
  const elsewhere = await context.newPage(); await (await context.newCDPSession(elsewhere)).send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await elsewhere.goto('about:blank'); await elsewhere.bringToFront(); await page.bringToFront();
  await expect.poll(() => page.evaluate(() => window.__responseQuota.focuses)).toBeGreaterThan(beforeFocus);
  // Source revalidation can close the editor; its recovery notice must lead back to the held text.
  await expect(sources.getByText('Response-link recovery in this browser needs attention', { exact: true }).first()).toBeVisible();
  if (await reason.count() === 0) { await openSource(); await click(page, reviews.getByRole('button', { name: `Open staff review ${review.reviewId.slice(0,8)}`, exact: true })); }
  await expect(reason).toHaveValue(quotaReason); await expect(reason).toBeDisabled();
  await click(page, links.getByRole('button', { name: 'Preserve response-link copy and start another', exact: true }));
  await click(page, links.getByText('Preserved response-link command or reason', { exact: true }).last());
  await click(page, links.getByRole('button', { name: 'Restore preserved response-link copy', exact: true }).last());
  await expect(reason).toHaveValue(quotaReason); await expect(reason).toBeEnabled();
  observed.quotaRecovery = { failures: 1, actualFocusEvents: await page.evaluate(() => window.__responseQuota.focuses) };
  await elsewhere.close();
  await reason.fill('SYNTHETIC original reviewed response link');
  const linkEndpoint = `${base}/api/engagement/campaigns/${sourceReceipt.campaignId}/synthesis/response-links`;
  let firstIntent, firstReceipt;
  await page.route(linkEndpoint, async route => {
   if (route.request().method() !== 'POST') return route.continue();
   firstIntent = route.request().postDataJSON(); const res = await route.fetch(); assert.equal(res.status(), 201); firstReceipt = await res.json(); await route.abort('connectionreset');
  });
  await click(page, links.getByRole('button', { name: 'Save response link', exact: true }));
  await expect(links.getByRole('button', { name: 'Retry exact response-link request', exact: true })).toBeEnabled();
  assert(firstReceipt); await page.unroute(linkEndpoint); observed.firstIntent = firstIntent; observed.firstReceipt = firstReceipt;
  const retried = page.waitForResponse(res => res.url() === linkEndpoint && res.request().method() === 'POST');
  await click(page, links.getByRole('button', { name: 'Retry exact response-link request', exact: true }));
  const retry = await retried; assert.equal(retry.status(), 200); assert.deepEqual(retry.request().postDataJSON(), firstIntent); assert.deepEqual(await retry.json(), { ...firstReceipt, replayed: true });
  await expect(links.getByText('Event 1: link', { exact: false })).toBeVisible();
  await links.scrollIntoViewIfNeeded(); await page.screenshot({ path: prefix + '-original.png' });
  await saved.getByRole('textbox', { name: 'Staff review notes', exact: true }).fill(`SYNTHETIC correction with retained original ${width}`);
  await saved.getByRole('textbox', { name: 'Reason for correction', exact: true }).fill('SYNTHETIC revise the interpretation while retaining original evidence');
  await click(page, saved.getByRole('button', { name: 'Save reasoned correction', exact: true }));
  await expect(approval.getByText('Revision 2 is unapproved.', { exact: true })).toBeVisible();
  await approval.getByRole('textbox', { name: 'Reason for approval or withdrawal', exact: true }).fill('SYNTHETIC checked corrected review');
  await click(page, approval.getByRole('button', { name: 'Approve revision 2', exact: true }));
  await expect(approval.getByText('Revision 2 is approved.', { exact: true })).toBeVisible();
  await click(page, links.getByRole('button', { name: /^Open link:/ }).first());
  await reason.fill('SYNTHETIC refresh with corrected approved review');
  await click(page, links.getByRole('button', { name: 'Save updated response link', exact: true }));
  await expect(links.getByText('Event 2: refresh', { exact: false })).toBeVisible();
  await reason.fill('SYNTHETIC withdraw corrected link while retaining both originals');
  await click(page, links.getByRole('button', { name: 'Withdraw response link', exact: true }));
  await expect(links.getByText('Event 3: withdraw', { exact: false })).toBeVisible();
  const scope = { mode: 'history', reviewId: firstIntent.reviewId, responseId: firstIntent.responseId, groupId: firstIntent.groupId };
  const result = await page.request.get(linkEndpoint + '?' + new URLSearchParams(scope)); assert.equal(result.status(), 200); assert.match(result.headers()['cache-control'], /no-store/);
  const history = (await result.json()).history; observed.finalHistory = history;
  assert.equal(history.eventCount, 3); assert.deepEqual(history.entries[0], firstReceipt.event);
  const events = history.entries.map(row => { assert.equal(sha(row.eventText), row.eventSha256); const e = JSON.parse(row.eventText); assert.equal(sha(e.context.contextText), e.context.contextSha256); return e; });
  assert.deepEqual(events.map(e => e.intent.operation), ['link','refresh','withdraw']); assert.deepEqual(events[1].context, events[2].context); assert.notEqual(events[0].context.contextSha256, events[1].context.contextSha256);
  await click(page, links.getByText('Event 1: link', { exact: false }));
  await links.scrollIntoViewIfNeeded(); await page.screenshot({ path: prefix + '-history.png' });
  const fits = r => r.left >= r.parentLeft - 1 && r.right <= r.parentRight + 1 && r.right <= r.viewport + 1;
  observed.bounds = await links.locator('button').evaluateAll(buttons => {
   const measure = () => buttons.filter(b => b.getClientRects().length).map(b => { const r=b.getBoundingClientRect(), p=b.parentElement.getBoundingClientRect(); return { text:b.textContent,left:r.left,right:r.right,parentLeft:p.left,parentRight:p.right,viewport:innerWidth }; });
   const b=buttons.find(b=>b.getClientRects().length), style=b.getAttribute('style');
   try { const baseline=measure(); b.style.position='relative';const harmless=measure();b.style.maxWidth='none';b.style.minWidth=`${b.parentElement.getBoundingClientRect().width+40}px`;return {baseline,harmless,targeted:measure()}; }
   finally {if(style===null)b.removeAttribute('style');else b.setAttribute('style',style);}
  });
  assert(observed.bounds.baseline.length>0);assert(observed.bounds.baseline.every(fits));assert(observed.bounds.harmless.every(fits));assert(observed.bounds.targeted.some(r=>!fits(r)));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const anon=await browser.newContext();assert.equal((await anon.request.get(linkEndpoint+'?'+new URLSearchParams(scope))).status(),401);await anon.close();
  assert.equal((await page.request.get(linkEndpoint+'?'+new URLSearchParams(scope),{headers:{'x-openplan-expected-user':crypto.randomUUID()}})).status(),403);
  assert.equal(observed.pageErrors.length,0);assert(observed.console.every(m=>/ERR_CONNECTION_RESET|403 \(Forbidden\)|409 \(Conflict\)/.test(m)),JSON.stringify(observed.console));
  await page.route(`${linkEndpoint}?**`, route => route.continue({ headers: { ...route.request().headers(), 'x-openplan-expected-user': crypto.randomUUID() } }));
  await click(page, links.getByRole('button', { name: 'Refresh response choices and links', exact: true }));
  await expect(links).toHaveCount(0); await expect(page.getByText('SYNTHETIC original reviewed response link', { exact: true })).toHaveCount(0);
  observed.privateAccessCleared=true;
  observed.completed=true;
 }catch(error){observed.error=error.stack;await page.screenshot({path:prefix+'-failure.png'});fs.writeFileSync(prefix+'-failure.txt',await page.locator('body').ariaSnapshot());throw error;}
 finally{fs.writeFileSync(prefix+'.json',JSON.stringify(observed,null,2));console.log(prefix+'.json');await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
