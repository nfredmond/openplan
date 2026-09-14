const { chromium, expect: baseExpect } = require('/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test');
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const expect = baseExpect.configure({ timeout: 30000 });
const base = 'http://127.0.0.1:3262';
const directory = '/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser';
const prior = JSON.parse(fs.readFileSync(process.env.PROBE_REVIEW));
assert(prior.completed, 'Run the complete navigation and correction journey first');
const account = JSON.parse(fs.readFileSync('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json'));
const receipt = prior.originalReceipt;
const endpoint = `${base}/api/engagement/campaigns/${receipt.campaignId}/synthesis/reviews`;
const prefix = `${directory}/synthesis-review-concurrency-${Date.now()}`;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const evidence = { completed: false, runnerSha256: sha(fs.readFileSync(__filename)), cases: [], priorJourney: process.env.PROBE_REVIEW };
async function click(page, locator) { await expect(locator).toBeVisible(); await locator.focus(); await page.keyboard.press('Enter'); }
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  const first = await browser.newContext(); const page = await first.newPage();
  evidence.identity = await (await first.request.get(base + '/api/health')).json();
  assert.equal(evidence.identity.deployment.commit, process.env.PROBE_COMMIT);
  await page.goto(base); await click(page, page.getByRole('link', { name: /Sign in/i }).first());
  await page.getByLabel('Work email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await click(page, page.getByRole('button', { name: 'Sign in', exact: true }));
  await page.waitForURL(url => !url.pathname.includes('sign-in'));
  await click(page, page.getByRole('link', { name: 'Engagement', exact: true }).first()); await page.waitForURL('**/engagement');
  await click(page, page.locator(`a[href="/engagement/${receipt.campaignId}"]`).first());
  await page.waitForURL(url => url.pathname === `/engagement/${receipt.campaignId}`);
  // Independent browser storage, same authorized synthetic account. No credentials are written to evidence.
  const second = await browser.newContext({ storageState: await first.storageState() });
  const peer = await second.newPage(); await peer.goto(page.url());
  async function read(query = {}) {
   const result = await first.request.get(`${endpoint}?${new URLSearchParams({ mode: 'read', reviewId: receipt.reviewId, ...query })}`);
   assert.equal(result.status(), 200); const value = await result.json();
   assert.equal(sha(value.revision.contentText), value.revision.contentSha256); return value;
  }
  async function post(tab, intent) {
   return tab.evaluate(async ({ endpoint, intent }) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-openplan-expected-user': intent.actorId, 'x-openplan-expected-workspace': intent.workspaceId }, body: JSON.stringify(intent) });
    return { status: response.status, body: await response.json() };
   }, { endpoint, intent });
  }
  const original = await read({ revisionId: receipt.requestId });
  function correction(parent, suffix) {
   return { operation: 'correct', requestId: crypto.randomUUID(), actorId: parent.revision.actorId, workspaceId: receipt.workspaceId, reviewId: receipt.reviewId,
    expectedRevisionId: parent.revision.requestId, expectedRevisionSha256: parent.revision.contentSha256,
    reason: `SYNTHETIC independent browser race ${suffix}`, change: { kind: 'notes', title: parent.content.title, notes: `${parent.content.notes}\nSYNTHETIC concurrent correction ${suffix} ${crypto.randomUUID()}` } };
  }
  const parent = await read(), equal = correction(parent, 'exact command');
  const duplicate = await Promise.all([post(page, equal), post(peer, equal)]);
  assert.deepEqual(duplicate.map(result => result.status).sort(), [200, 201]);
  assert.deepEqual({ ...duplicate[0].body, replayed: false }, { ...duplicate[1].body, replayed: false });
  const afterEqual = await read(); assert.equal(afterEqual.revision.revisionNo, parent.revision.revisionNo + 1); assert.equal(afterEqual.revision.requestId, equal.requestId);
  evidence.cases.push({ name: 'concurrent exact retry retains one revision', statuses: duplicate.map(result => result.status), requestId: equal.requestId });
  const a = correction(afterEqual, 'A'), b = correction(afterEqual, 'B');
  const conflict = await Promise.all([post(page, a), post(peer, b)]);
  assert.deepEqual(conflict.map(result => result.status).sort(), [201, 409]);
  const winnerIndex = conflict.findIndex(result => result.status === 201), winner = [a, b][winnerIndex], loser = [a, b][1 - winnerIndex];
  const afterConflict = await read(); assert.equal(afterConflict.revision.requestId, winner.requestId); assert.equal(afterConflict.content.notes, winner.change.notes);
  assert.equal(afterConflict.revision.revisionNo, afterEqual.revision.revisionNo + 1);
  assert.equal((await first.request.get(`${endpoint}?mode=read&reviewId=${receipt.reviewId}&revisionId=${loser.requestId}`)).status(), 404);
  assert.equal((await post(peer, loser)).status, 409);
  const winnerRetry = await post(peer, winner); assert.equal(winnerRetry.status, 200); assert.equal(winnerRetry.body.replayed, true);
  assert.equal((await post(page, { ...winner, reason: 'SYNTHETIC changed retry must conflict' })).status, 409);
  evidence.cases.push({ name: 'competing parents retain one correction and refuse stale or changed retries', statuses: conflict.map(result => result.status), winner: winner.requestId, refused: loser.requestId });
  const originalAgain = await read({ revisionId: receipt.requestId });
  assert.equal(originalAgain.revision.contentText, original.revision.contentText); assert.equal(originalAgain.preparationText, original.preparationText);
  const history = await first.request.get(`${endpoint}?mode=revisions&reviewId=${receipt.reviewId}`); assert.equal(history.status(), 200);
  const revisions = await history.json(); assert.equal(revisions.entries.filter(row => row.requestId === winner.requestId).length, 1);
  assert.equal(revisions.entries.filter(row => row.requestId === equal.requestId).length, 1); assert(!revisions.entries.some(row => row.requestId === loser.requestId));
  evidence.originalSha256 = original.revision.contentSha256; evidence.finalSha256 = afterConflict.revision.contentSha256; evidence.completed = true;
 } catch (error) { evidence.error = error.stack; throw error; }
 finally { fs.writeFileSync(prefix + '.json', JSON.stringify(evidence, null, 2)); console.log(prefix + '.json'); await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
