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
const prefix = `${directory}/synthesis-approval-concurrency-${Date.now()}`;
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
  const approvalEndpoint = endpoint.replace(/reviews$/, 'approvals');
  async function approvalState() {
   const response = await first.request.get(`${approvalEndpoint}?reviewId=${receipt.reviewId}`); assert.equal(response.status(), 200);
   const state = await response.json();
   assert.equal(state.history.entries.length, state.history.eventCount);
   for (const event of state.history.entries) assert.equal(sha(event.eventText), event.eventSha256);
   return state;
  }
  async function read(query = {}) {
   const result = await first.request.get(`${endpoint}?${new URLSearchParams({ mode: 'read', reviewId: receipt.reviewId, ...query })}`);
   assert.equal(result.status(), 200); const value = await result.json();
   assert.equal(sha(value.revision.contentText), value.revision.contentSha256); return value;
  }
  async function post(tab, intent, target = approvalEndpoint) {
   return tab.evaluate(async ({ endpoint, intent }) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-openplan-expected-user': intent.actorId, 'x-openplan-expected-workspace': intent.workspaceId }, body: JSON.stringify(intent) });
    return { status: response.status, body: await response.json() };
   }, { endpoint: target, intent });
  }
  const original = await read({ revisionId: receipt.requestId });
  function correction(parent, suffix) {
   return { operation: 'correct', requestId: crypto.randomUUID(), actorId: parent.revision.actorId, workspaceId: receipt.workspaceId, reviewId: receipt.reviewId,
    expectedRevisionId: parent.revision.requestId, expectedRevisionSha256: parent.revision.contentSha256,
    reason: `SYNTHETIC approval/correction ordering ${suffix}`, change: { kind: 'notes', title: parent.content.title, notes: `${parent.content.notes}\nSYNTHETIC correction ${suffix} ${crypto.randomUUID()}` } };
  }
  function approval(state, operation = 'approve') {
   const head = state.history.entries.at(-1), last = head ? JSON.parse(head.eventText) : null;
   const context = operation === 'withdraw' ? last.intent : state.current;
   return { campaignId: context.campaignId, workspaceId: context.workspaceId, reviewId: context.reviewId, sourceId: context.sourceId,
    sourceSha256: context.sourceSha256, preparationSha256: context.preparationSha256, revisionId: context.revisionId,
    revisionNo: context.revisionNo, revisionSha256: context.revisionSha256, actorId: original.revision.actorId,
    operation, requestId: crypto.randomUUID(), reason: `SYNTHETIC concurrent ${operation} ${crypto.randomUUID()}`,
    predecessorId: state.history.headId, predecessorSha256: state.history.headSha256 };
  }
  const initial = await approvalState(), equal = approval(initial, 'withdraw');
  const duplicates = await Promise.all([post(page, equal), post(peer, equal)]);
  assert.deepEqual(duplicates.map(row => row.status).sort(), [200, 201]);
  assert.deepEqual({ ...duplicates[0].body, replayed: false }, { ...duplicates[1].body, replayed: false });
  let state = await approvalState(); assert.equal(state.history.eventCount, initial.history.eventCount + 1);
  evidence.cases.push({ name: 'identical committed approval requests retain one event', statuses: duplicates.map(row => row.status), requestId: equal.requestId });
  const a = approval(state), b = approval(state), competing = await Promise.all([post(page, a), post(peer, b)]);
  assert.deepEqual(competing.map(row => row.status).sort(), [201, 409]);
  const winner = [a, b][competing.findIndex(row => row.status === 201)], loser = [a, b][competing.findIndex(row => row.status === 409)];
  state = await approvalState(); assert.equal(state.history.eventCount, initial.history.eventCount + 2); assert.equal(state.history.headId, winner.requestId);
  assert(!state.history.entries.some(row => JSON.parse(row.eventText).intent.requestId === loser.requestId));
  assert.equal((await post(peer, loser)).status, 409); assert.equal((await post(peer, winner)).status, 200);
  assert.equal((await post(page, { ...winner, reason: 'SYNTHETIC changed retry' })).status, 409);
  evidence.cases.push({ name: 'competing committed approvals retain one winner and reject changed retries', statuses: competing.map(row => row.status), winner: winner.requestId, refused: loser.requestId });
  // Both actual commit orders are explicit controls, separate from the simultaneous races above and below.
  const approvedVersion = await read(), next = correction(approvedVersion, 'approval before correction');
  assert.equal((await post(page, next, endpoint)).status, 201);
  state = await approvalState(); assert.equal(state.current.revisionId, next.requestId);
  assert(!state.history.entries.some(row => JSON.parse(row.eventText).intent.revisionId === next.requestId));
  assert.equal(JSON.parse(state.history.entries.at(-1).eventText).intent.revisionId, approvedVersion.revision.requestId);
  evidence.cases.push({ name: 'approval commits before correction and stays on its original version', approved: approvedVersion.revision.requestId, corrected: next.requestId });
  const stale = approval(state), newer = correction(await read(), 'correction before approval');
  assert.equal((await post(peer, newer, endpoint)).status, 201); assert.equal((await post(page, stale)).status, 409);
  state = await approvalState(); assert.equal(state.current.revisionId, newer.requestId);
  assert(!state.history.entries.some(row => JSON.parse(row.eventText).intent.requestId === stale.requestId));
  evidence.cases.push({ name: 'correction commits before stale approval and refuses it', refused: stale.requestId, corrected: newer.requestId });
  const concurrentApproval = approval(state), concurrentCorrection = correction(await read(), 'simultaneous approval and correction');
  const raced = await Promise.all([post(page, concurrentApproval), post(peer, concurrentCorrection, endpoint)]);
  // Writers may report temporary lock contention; preserve and retry that exact request, never regenerate it.
  for (const [i, intent] of [concurrentApproval, concurrentCorrection].entries()) {
   if (raced[i].status === 503) raced[i] = await post(i === 0 ? page : peer, intent, i === 0 ? approvalEndpoint : endpoint);
  }
  assert.equal(raced[1].status, 201); assert([201, 409].includes(raced[0].status));
  state = await approvalState(); assert.equal(state.current.revisionId, concurrentCorrection.requestId);
  const racedEvents = state.history.entries.map(row => JSON.parse(row.eventText).intent);
  assert(!racedEvents.some(row => row.revisionId === concurrentCorrection.requestId));
  assert.equal(racedEvents.filter(row => row.requestId === concurrentApproval.requestId).length, raced[0].status === 201 ? 1 : 0);
  evidence.cases.push({ name: 'simultaneous actual approval and correction preserve exact version boundary', statuses: raced.map(row => row.status), approval: concurrentApproval.requestId, correction: concurrentCorrection.requestId });
  const originalAgain = await read({ revisionId: receipt.requestId });
  assert.equal(originalAgain.revision.contentText, original.revision.contentText); assert.equal(originalAgain.preparationText, original.preparationText);
  evidence.originalSha256 = original.revision.contentSha256; evidence.finalHistory = state; evidence.completed = true;
 } catch (error) { evidence.error = error.stack; throw error; }
 finally { fs.writeFileSync(prefix + '.json', JSON.stringify(evidence, null, 2)); console.log(prefix + '.json'); await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
