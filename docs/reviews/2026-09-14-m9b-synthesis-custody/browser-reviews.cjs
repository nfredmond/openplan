const { chromium, expect: baseExpect } = require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const expect = baseExpect.configure({ timeout: 30000 });
const width = Number(process.env.PROBE_WIDTH || 1440), base = 'http://127.0.0.1:3262';
const directory = '/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const previousName = width === 390 ? 'synthesis-preparation-390-1789416585293' : 'synthesis-preparation-1440-1789416818345';
const previous = JSON.parse(fs.readFileSync(`${directory}/${previousName}.json`));
const sourceReceipt = previous.originalReceipt;
const account = JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const prefix = `${directory}/synthesis-reviews-${width}-${Date.now()}`;
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const observed = { width, previousSourceJourney: previousName, completed: false, console: [], pageErrors: [], runnerSha256: sha(fs.readFileSync(__filename)) };
const fits = rect => rect.left >= rect.parentLeft - 1 && rect.right <= rect.parentRight + 1 && rect.right <= rect.viewport + 1;
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
  const endpoint = `${base}/api/engagement/campaigns/${sourceReceipt.campaignId}/synthesis/reviews`;
  const sourceResponse = await page.request.get(`${base}/api/engagement/campaigns/${sourceReceipt.campaignId}/synthesis/sources?requestId=${sourceReceipt.requestId}`);
  assert.equal(sourceResponse.status(), 200); const source = await sourceResponse.json();
  assert.equal(sha(source.snapshotText), sourceReceipt.snapshotSha256); observed.sourceSha256 = source.snapshotSha256;
  let createReceipt, createIntent;
  await page.route(endpoint, async route => {
   if (route.request().method() !== 'POST') return route.continue();
   createIntent = route.request().postDataJSON(); const result = await route.fetch(); assert.equal(result.status(), 201);
   createReceipt = await result.json(); await route.abort('connectionreset');
  });
  await click(page, reviews.getByRole('button', { name: 'Create staff review', exact: true }));
  await expect(reviews.getByRole('button', { name: 'Retry retained review request', exact: true })).toBeEnabled();
  await expect(reviews.getByRole('alert').first()).toBeVisible();
  await expect(reviews.getByRole('button', { name: 'Create staff review', exact: true })).toBeDisabled();
  assert(createReceipt); observed.originalReceipt = createReceipt;
  const preserve = reviews.getByRole('button', { name: 'Preserve edit and start another correction', exact: true });
  await preserve.scrollIntoViewIfNeeded(); await preserve.focus();
  observed.recoveryBounds = await preserve.evaluate(element => {
   const bounds = () => { const rect = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect(); return { left: rect.left, right: rect.right, parentLeft: parent.left, parentRight: parent.right, viewport: innerWidth }; };
   const originalClass = element.className, originalStyle = element.getAttribute('style');
   try { const baseline = bounds(); element.classList.add('relative'); const harmless = bounds(); element.style.maxWidth = 'none'; element.style.whiteSpace = 'nowrap'; return { baseline, harmless, targeted: bounds() }; }
   finally { element.className = originalClass; if (originalStyle === null) element.removeAttribute('style'); else element.setAttribute('style', originalStyle); }
  });
  assert(fits(observed.recoveryBounds.baseline)); assert(fits(observed.recoveryBounds.harmless));
  if (width === 390) assert(!fits(observed.recoveryBounds.targeted), 'Narrow recovery control guard missed an unwrapped label');
  await page.screenshot({ path: prefix + '-pending.png' });
  await page.unroute(endpoint); await page.reload(); await openSource();
  const replayResponse = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST');
  await click(page, reviews.getByRole('button', { name: 'Retry retained review request', exact: true }));
  const replay = await replayResponse; assert.equal(replay.status(), 200); assert.deepEqual(replay.request().postDataJSON(), createIntent);
  assert.deepEqual(await replay.json(), { ...createReceipt, replayed: true });
  await expect(reviews.getByText('Review saved, revision 1.', { exact: true })).toBeVisible();
  const saved = reviews.getByRole('article', { name: 'Saved staff review' });
  await expect(saved).toBeVisible();
  async function read(revisionId) {
   const response = await page.request.get(`${endpoint}?${new URLSearchParams({ mode: 'read', reviewId: createReceipt.reviewId, ...(revisionId ? { revisionId } : {}) })}`);
   assert.equal(response.status(), 200); const record = await response.json();
   assert.equal(sha(record.preparationText), record.preparationSha256); assert.equal(sha(record.revision.contentText), record.revision.contentSha256);
   return record;
  }
  const original = await read(createReceipt.requestId), total = source.snapshot.items.length + source.snapshot.answers.length;
  assert.equal(original.content.assignedSourceCount, total); assert.equal(original.content.unassignedSourceIds.length, 0);
  assert(original.content.groups.every(group => group.sentiment === 'not_assessed'));
  observed.originalContentSha256 = original.revision.contentSha256; observed.preparationSha256 = original.preparationSha256;
  const notes = `SYNTHETIC retained staff interpretation ${width} é `.repeat(30) + 'REVIEW NOTE TAIL ' + crypto.randomUUID();
  const reason = `SYNTHETIC staff wording correction ${width}`;
  await saved.getByLabel('Staff review notes', { exact: true }).fill(notes);
  await saved.getByLabel('Reason for correction', { exact: true }).fill(reason);
  await page.reload(); await openSource();
  await expect(saved.getByLabel('Staff review notes', { exact: true })).toHaveValue(notes);
  await expect(saved.getByLabel('Reason for correction', { exact: true })).toHaveValue(reason);
  await saved.getByLabel('Staff review notes', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: prefix + '-restored-draft.png' });
  const correctionResponse = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST');
  await click(page, saved.getByRole('button', { name: 'Save reasoned correction', exact: true }));
  const correctedResponse = await correctionResponse; assert.equal(correctedResponse.status(), 201); observed.correctedReceipt = await correctedResponse.json();
  await expect(saved.getByRole('heading', { name: /revision 2$/ })).toBeVisible();
  const corrected = await read(observed.correctedReceipt.requestId);
  assert.equal(corrected.content.notes, notes); assert.equal(corrected.revision.reason, reason); assert.equal(corrected.revision.parentSha256, original.revision.contentSha256);
  assert.equal(corrected.content.assignedSourceCount, total); assert.equal(corrected.preparationText, original.preparationText);
  const long = source.snapshot.items.find(row => row.body.length > 600) ?? source.snapshot.items[0]; assert(long, 'This retained journey needs a real comment');
  const memberId = `item:${long.id}`, group = corrected.content.groups.find(row => row.sourceIds.includes(memberId)); assert(group);
  const searchText = long.body.slice(-60);
  await saved.getByRole('combobox', { name: 'Correction type', exact: true }).selectOption('group_update');
  await saved.getByRole('combobox', { name: 'Review group', exact: true }).selectOption(group.id);
  await saved.getByLabel('Find contributions for this group', { exact: true }).fill(searchText);
  const checkbox = saved.getByRole('checkbox'); await expect(checkbox).toHaveCount(1); await expect(checkbox).toBeChecked();
  await checkbox.scrollIntoViewIfNeeded(); await checkbox.focus(); await page.keyboard.press('Space');
  await saved.getByLabel('Group label', { exact: true }).fill(`SYNTHETIC reviewed group ${width}`);
  await saved.getByLabel('Staff group summary', { exact: true }).fill('SYNTHETIC complete staff-authored group summary.');
  await saved.getByRole('combobox', { name: 'Staff sentiment assessment', exact: true }).selectOption('mixed');
  await saved.getByLabel('Reason for correction', { exact: true }).fill('SYNTHETIC distinct concern needs its own review group.');
  await page.screenshot({ path: prefix + '-membership-edit.png' });
  await click(page, saved.getByRole('button', { name: 'Save reasoned correction', exact: true }));
  await expect(saved.getByRole('heading', { name: /revision 3$/ })).toBeVisible();
  const regrouped = await read(); assert.deepEqual(regrouped.content.unassignedSourceIds, [memberId]); assert.equal(regrouped.content.assignedSourceCount, total - 1);
  observed.membership = { memberId, originalGroupId: group.id, assignedAfterRemoval: regrouped.content.assignedSourceCount };
  await saved.getByRole('combobox', { name: 'Correction type', exact: true }).selectOption('group_add');
  await saved.getByLabel('Group label', { exact: true }).fill(`SYNTHETIC distinct retained concern ${width}`);
  await saved.getByLabel('Find contributions for this group', { exact: true }).fill(searchText);
  await saved.getByRole('checkbox').check();
  await saved.getByLabel('Reason for correction', { exact: true }).fill('SYNTHETIC keep the distinct concern visible without dropping its source.');
  await click(page, saved.getByRole('button', { name: 'Save reasoned correction', exact: true }));
  await expect(saved.getByRole('heading', { name: /revision 4$/ })).toBeVisible();
  const final = await read(); assert.equal(final.content.assignedSourceCount, total); assert.deepEqual(final.content.unassignedSourceIds, []);
  assert(final.content.groups.some(group => group.sourceIds.length === 1 && group.sourceIds[0] === memberId));
  await saved.getByRole('heading', { level: 4 }).scrollIntoViewIfNeeded(); await page.screenshot({ path: prefix + '-corrected.png' });
  await click(page, saved.getByRole('button', { name: 'Open revision 1', exact: true }));
  await expect(saved.getByRole('heading', { name: /revision 1$/ })).toBeVisible();
  await expect(saved.getByRole('button', { name: 'Save reasoned correction', exact: true })).toBeDisabled();
  await expect(saved.getByRole('button', { name: 'Open current review', exact: true })).toBeVisible();
  const originalAgain = await read(createReceipt.requestId);
  assert.equal(originalAgain.revision.contentText, original.revision.contentText); assert.equal(originalAgain.preparationText, original.preparationText);
  const sourceAgain = await (await page.request.get(`${base}/api/engagement/campaigns/${sourceReceipt.campaignId}/synthesis/sources?requestId=${sourceReceipt.requestId}`)).json();
  assert.equal(sourceAgain.snapshotText, source.snapshotText);
  await saved.getByRole('heading', { level: 4 }).scrollIntoViewIfNeeded(); await page.screenshot({ path: prefix + '-original-history.png' });
  const anonymous = await browser.newContext();
  for (const query of [{ mode: 'read', reviewId: createReceipt.reviewId }, { mode: 'reviews', sourceId: sourceReceipt.requestId }, { mode: 'revisions', reviewId: createReceipt.reviewId }]) {
   assert.equal((await anonymous.request.get(`${endpoint}?${new URLSearchParams(query)}`)).status(), 401);
  }
  await anonymous.close();
  assert.equal((await page.request.get(`${endpoint}?mode=read&reviewId=${createReceipt.reviewId}`, { headers: { 'x-openplan-expected-user': crypto.randomUUID() } })).status(), 403);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Review workflow overflows viewport');
  assert.equal(observed.pageErrors.length, 0); assert(observed.console.every(message => /ERR_CONNECTION_RESET/.test(message)), 'Unexpected browser console errors');
  observed.completed = true; observed.finalContentSha256 = final.revision.contentSha256; observed.totalContributions = total;
  fs.writeFileSync(prefix + '-original.json', JSON.stringify(original, null, 2)); fs.writeFileSync(prefix + '-corrected.json', JSON.stringify(final, null, 2));
 } catch (error) { observed.error = error.stack; await page.screenshot({ path: prefix + '-failure.png' }); fs.writeFileSync(prefix + '-failure.txt', await page.locator('body').ariaSnapshot()); throw error; }
 finally { fs.writeFileSync(prefix + '.json', JSON.stringify(observed, null, 2)); await browser.close(); console.log(prefix + '.json'); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
