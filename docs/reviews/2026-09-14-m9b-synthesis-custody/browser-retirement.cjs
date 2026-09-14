const { chromium, expect: baseExpect } = require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const expect = baseExpect.configure({ timeout: 30000 });
const width = Number(process.env.PROBE_WIDTH || 1440), base = 'http://127.0.0.1:3262';
const directory = '/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context';
const previousName = width === 390 ? 'synthesis-preparation-390-1789416585293' : 'synthesis-preparation-1440-1789416818345';
const previous = JSON.parse(fs.readFileSync(`${directory}/browser/${previousName}.json`));
const receipt = previous.originalReceipt;
const account = JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const prefix = `${directory}/browser/synthesis-retirement-${width}-${Date.now()}`;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const observed = { width, completed: false, console: [], pageErrors: [], runnerSha256: sha(fs.readFileSync(__filename)) };
async function click(page, locator) { await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); await locator.scrollIntoViewIfNeeded(); await locator.focus(); await page.keyboard.press('Enter'); }
function historicalHash() {
 assert.match(receipt.campaignId, /^[0-9a-f-]{36}$/);
 const value = execFileSync('docker', ['exec', 'supabase_db_openplan-restore-target-2026091050', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
  `select jsonb_build_object('summary', ai_synthesis_json, 'recordedAt', ai_synthesized_at)::text from public.engagement_campaigns where id = '${receipt.campaignId}' and title like 'SYNTHETIC%';`], { encoding: 'utf8' }).trim();
 assert(value, 'No matching owned synthetic consultation');
 return { sha256: sha(value), hasEarlierSummary: JSON.parse(value).summary !== null };
}
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
  await click(page, page.locator(`a[href="/engagement/${receipt.campaignId}"]`).first());
  await page.waitForURL(url => url.pathname === `/engagement/${receipt.campaignId}`);
  await click(page, page.getByTestId('page-tabs-nav').getByRole('link', { name: 'Analysis', exact: true }));
  await page.waitForURL(url => url.searchParams.get('tab') === 'analysis');
  const sources = page.getByRole('region', { name: 'Retained synthesis sources' });
  await expect(sources.getByRole('button', { name: 'Save selected sources', exact: true })).toBeEnabled();
  await sources.scrollIntoViewIfNeeded();
  const oldButtons = page.getByRole('button', { name: /^(Re)?[Gg]enerate$/ });
  await expect(oldButtons).toHaveCount(0);
  await sources.evaluate(element => element.append(document.createComment('harmless layout control')));
  await expect(oldButtons).toHaveCount(0);
  await sources.evaluate(element => { const button = document.createElement('button'); button.dataset.retirementMutation = ''; button.textContent = 'Generate'; element.prepend(button); });
  await expect(oldButtons).toHaveCount(1);
  await page.locator('[data-retirement-mutation]').evaluate(element => element.remove());
  await expect(oldButtons).toHaveCount(0); observed.controls = { baseline: 0, harmless: 0, targeted: 1 };
  await page.screenshot({ path: prefix + '-entry.png' });
  const snapshot = historicalHash(); observed.before = snapshot;
  const words = 'SYNTHETIC submitted text must not be returned';
  const endpoint = `${base}/api/engagement/campaigns/${receipt.campaignId}/synthesis`;
  const response = await page.request.post(endpoint, { data: { text: words } });
  assert.equal(response.status(), 410); assert.equal(response.headers()['cache-control'], 'private, no-store');
  const body = await response.json(); assert.equal(body.kind, 'retired'); assert.match(body.error, /retained synthesis sources and staff reviews/); assert(!JSON.stringify(body).includes(words));
  const anonymous = await browser.newContext();
  try {
   const refusal = await anonymous.request.post(endpoint, { data: 'malformed' });
   assert.equal(refusal.status(), 410); assert.deepEqual(await refusal.json(), body);
   const malformed = await anonymous.request.post(`${base}/api/engagement/campaigns/invalid/synthesis`, { data: words, headers: { 'x-openplan-assistant-execution-source': '', origin: 'https://unrelated.invalid' } });
   assert.equal(malformed.status(), 410); assert.deepEqual(await malformed.json(), body);
  } finally { await anonymous.close(); }
  observed.after = historicalHash(); assert.deepEqual(observed.after, snapshot);
  observed.refusals = { authenticated: 410, anonymous: 410, malformedAgent: 410 };
  const open = sources.getByRole('button', { name: `Open saved source ${receipt.requestId.slice(0, 8)}`, exact: true });
  while (await open.count() === 0 && await sources.getByRole('button', { name: 'Load older sources', exact: true }).count()) await click(page, sources.getByRole('button', { name: 'Load older sources', exact: true }));
  await click(page, open);
  await expect(page.getByRole('region', { name: 'Retained staff reviews' })).toBeVisible();
  await page.getByRole('region', { name: 'Retained staff reviews' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: prefix + '-reviews.png' });
  assert.equal(await page.getByRole('article', { name: 'Earlier synthesis record' }).count(), snapshot.hasEarlierSummary ? 1 : 0);
  // There are no historical summaries in the isolated DB. This separate static component fixture
  // checks compatibility/layout with the real component and build CSS, not a persisted user journey.
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.map(link => link.outerHTML).join(''));
  const fixture = fs.readFileSync(`${directory}/legacy-panel-fixture.html`, 'utf8');
  const layout = await context.newPage();
  const layoutErrors = []; layout.on('pageerror', error => layoutErrors.push(error.message));
  layout.on('console', entry => { if (entry.type() === 'error') layoutErrors.push(entry.text()); });
  await layout.route(base + '/__synthetic_legacy_layout', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><head><base href="${base}/">${styles}</head><body><main style="max-width:1100px;margin:auto;padding:16px"><p>Explicit synthetic historical-format layout fixture</p><article class="module-section-surface">${fixture}</article></main></body></html>` }));
  await layout.goto(base + '/__synthetic_legacy_layout');
  await expect(layout.getByText('SYNTHETIC stored narrative.')).toBeVisible();
  await expect(layout.getByText(/Stored counts: 299 analyzed of 300 supplied comments/)).toBeVisible();
  await expect(layout.getByText(/neutral labels were not a sentiment assessment/)).toBeVisible();
  await expect(layout.getByRole('button')).toHaveCount(0);
  assert.equal(await layout.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await layout.screenshot({ path: prefix + '-synthetic-legacy-layout.png', fullPage: true });
  assert.deepEqual(layoutErrors, []); observed.legacyLayout = { synthetic: true, persisted: false, fixtureSha256: sha(fixture), errors: layoutErrors };
  await layout.close(); assert.deepEqual(observed.console, []); assert.deepEqual(observed.pageErrors, []);
  observed.completed = true;
 } catch (error) { observed.error = String(error.stack || error); await page.screenshot({ path: prefix + '-failure.png' }).catch(() => {}); process.exitCode = 1; }
 finally { fs.writeFileSync(prefix + '.json', JSON.stringify(observed, null, 2)); console.log(prefix + '.json'); await browser.close(); }
})();
