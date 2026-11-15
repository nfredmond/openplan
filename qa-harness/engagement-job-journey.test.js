// Unit tests for the engagement journey helpers. No browser, no server.
// Run: node --test engagement-job-journey.test.js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./engagement-job-journey-lib');

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const job = lib.loadJobDefinition();
const fixture = () => JSON.parse(fs.readFileSync(lib.REHEARSAL_INPUTS_PATH, 'utf8'));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BASE_ARGS = ['--base-url', 'http://localhost:3482', '--mode', 'rehearsal', '--place-query', 'Coos County, OR', '--place-kind', 'county', '--role', 'county', '--email', 'a@openplan.test', '--second-email', 'b@openplan.test', '--out', 'runs/x'];
const withArg = (key, value) => {
  const args = [...BASE_ARGS];
  const at = args.indexOf(key);
  if (at >= 0) args[at + 1] = value;
  else args.push(key, value);
  return args;
};

test('arguments: the role and place kind must be a journey this job defines', () => {
  assert.equal(lib.parseEngagementArgs(BASE_ARGS, job).role, 'county');
  assert.equal(lib.parseEngagementArgs(withArg('--role', 'city-or-town').map((v) => (v === 'county' ? 'cousub' : v)), job).placeKind, 'cousub');
  assert.throws(() => lib.parseEngagementArgs(withArg('--role', 'nevada-county'), job), /--role must be one of county, city-or-town, tribal-area/);
  assert.throws(() => lib.parseEngagementArgs(withArg('--role', 'tribal-area'), job), /tribal-area journey needs --place-kind aiannh/);
  assert.throws(() => lib.parseEngagementArgs(withArg('--place-kind', 'city'), job), /county journey needs --place-kind county/);
});

test('arguments: a confirmation link is never an argument, and a proof needs inputs and a commit', () => {
  assert.throws(() => lib.parseEngagementArgs([...BASE_ARGS, '--confirm-link', 'http://localhost/verify?token=x'], job), /never taken as an argument/);
  assert.throws(() => lib.parseEngagementArgs(withArg('--mode', 'proof'), job), /proof run needs --inputs and --expected-commit/);
  assert.throws(() => lib.parseEngagementArgs([...withArg('--mode', 'proof'), '--inputs', 'x.json'], job), /proof run needs --inputs and --expected-commit/);
  assert.throws(() => lib.parseEngagementArgs([...BASE_ARGS, '--expected-commit', 'abc123'], job), /40-character commit/);
  assert.throws(() => lib.parseEngagementArgs(withArg('--second-email', 'a@openplan.test'), job), /must differ/);
  assert.throws(() => lib.parseEngagementArgs(withArg('--mode', 'demo'), job), /--mode must be one of/);
  const missing = BASE_ARGS.slice(0, -2);
  assert.throws(() => lib.parseEngagementArgs(missing, job), /Missing required arguments: --out/);
});

test('inputs: the rehearsal fixture loads in rehearsal and is refused in proof', () => {
  assert.ok(lib.loadEngagementInputs('rehearsal').inputs.campaign.title);
  assert.throws(() => lib.loadEngagementInputs('proof', lib.REHEARSAL_INPUTS_PATH), /labeled "Rehearsal inputs for the engagement journey/);
  assert.throws(() => lib.loadEngagementInputs('proof', null), /proof run needs --inputs/);
  const relabeled = { ...fixture(), rehearsal: false };
  assert.throws(() => lib.validateEngagementInputs(relabeled, 'proof'), /labeled/, 'the label text alone refuses it');
  const clean = { ...fixture(), rehearsal: false, label: 'Proof inputs' };
  assert.doesNotThrow(() => lib.validateEngagementInputs(clean, 'proof'));
});

test('inputs: the campaign title and invitation carry the demonstration label in both modes', () => {
  for (const mode of ['rehearsal', 'proof']) {
    for (const field of ['title', 'invitation']) {
      const inputs = { ...fixture(), rehearsal: false, label: 'x' };
      inputs.campaign = { ...inputs.campaign, [field]: 'Road safety comments for the county' };
      assert.throws(() => lib.validateEngagementInputs(inputs, mode), new RegExp(`campaign.${field} must say "Demonstration by an automated OpenPlan proof run"`), `${mode} ${field}`);
    }
  }
});

test('inputs: every comment says who entered it and that it represents no one', () => {
  for (const key of ['mapPoint', 'noMapPoint', 'keyboard', 'rejected']) {
    const inputs = fixture();
    inputs.comments = { ...inputs.comments, [key]: 'There is no crosswalk here. Entered by an automated proof run.' };
    assert.throws(() => lib.validateEngagementInputs(inputs, 'rehearsal'), new RegExp(`comments.${key} must say .*represents no one`), key);
  }
});

test('inputs: no email address, DRAFT or marker in anything typed', () => {
  const email = fixture();
  email.response.weDid = 'Write to planner@example.org for more.';
  assert.throws(() => lib.validateEngagementInputs(email, 'rehearsal'), /response.weDid holds an email address/);
  const draft = fixture();
  draft.staffReview.groupSummary = 'DRAFT summary.';
  assert.throws(() => lib.validateEngagementInputs(draft, 'rehearsal'), /staffReview.groupSummary holds the word DRAFT/);
  const marker = fixture();
  marker.decision.impact = 'Cost [VERIFY]';
  assert.throws(() => lib.validateEngagementInputs(marker, 'rehearsal'), /decision.impact holds a \[VERIFY\] marker/);
  const missing = fixture();
  delete missing.links;
  assert.throws(() => lib.validateEngagementInputs(missing, 'rehearsal'), /needs links/);
});

test('inputs: the comment to reject is distinct from everything else typed', () => {
  const inputs = fixture();
  inputs.response.weDid = `We heard: ${inputs.comments.rejected}`;
  assert.throws(() => lib.validateEngagementInputs(inputs, 'rehearsal'), /comments.rejected and response.weDid contain one another/);
});

test('journey counts come from moderation outcomes and the published response', () => {
  const counts = lib.journeyCounts({
    contributions: [{ commentId: id(1) }, { commentId: id(2) }, { commentId: id(3) }, { commentId: id(4) }],
    moderation: [{ commentId: id(1), outcome: 'approved' }, { commentId: id(2), outcome: 'approved' }, { commentId: id(3), outcome: 'approved' }, { commentId: id(4), outcome: 'rejected' }],
    responses: [{ status: 'published', sourceCommentIds: [id(1), id(2)] }, { status: 'draft', sourceCommentIds: [id(3)] }],
  });
  assert.deepEqual(counts, { received: 4, approved: 3, rejected: 1, publishedResponses: 1, answered: 2 });
});

const INTERNAL_PAGE_1 = [
  'INTERNAL REVIEW COPY',
  'Road safety comments. Demonstration by an automated OpenPlan proof run',
  'Selected records',
  '4 contributions, 0 survey sessions, 0 recorded answers and 1 reviewed staff response entries.',
  'Review counts',
  '  • Received 4 contributions.',
  '  • Approved 3 contributions.',
  '  • Withheld 1 contribution.',
  '  • Pending 0 contributions.',
  '  • Flagged for review 0 contributions.',
  '  • Published 1 staff response.',
  '  • Answered 2 contributions with a published staff response. A contribution that two',
  '    responses answer counts once.',
].join('\n');

test('the review PDF counts are read from its sentences, wrapped lines included', () => {
  const read = lib.readReviewPdfCounts([INTERNAL_PAGE_1, 'Contribution register']);
  assert.deepEqual(read.counts, { received: 4, approved: 3, rejected: 1, pending: 0, flagged: 0, publishedResponses: 1, answered: 2 });
  assert.equal(read.pages.answered, 1);
  const wrapped = lib.readReviewPdfCounts(['Answered 2 contributions with a\npublished staff response.']);
  assert.equal(wrapped.counts.answered, 2);
  const publicCopy = lib.readReviewPdfCounts(['PUBLIC REVIEW COPY\nThis public copy holds approved contributions only. Withheld, pending and flagged contributions are left out, so it does not count them.\nApproved 3 contributions.\nPublished 1 staff response.\nAnswered 2 contributions with a published staff response.']);
  assert.equal(publicCopy.counts.rejected, undefined, 'a public copy states no withheld count');
  assert.equal(publicCopy.counts.approved, 3);
  const contradictory = lib.readReviewPdfCounts(['Approved 3 contributions.', 'Approved 4 contributions.']);
  assert.equal(contradictory.counts.approved, null);
});

test('the record finds each count phrase with the shared matcher, using the journey count', () => {
  const counts = { approved: 3, rejected: 1, answered: 2 };
  const { items, missing } = lib.reviewPdfItems([INTERNAL_PAGE_1], counts, job.campaign);
  assert.deepEqual(missing, []);
  assert.deepEqual(items.map((item) => [item.item, item.text, item.page]), [
    ['scope-badge', 'Internal review copy', 1],
    ['approved-count', 'Approved 3', 1],
    ['rejected-count', 'Withheld 1', 1],
    ['responded-count', 'Answered 2', 1],
  ]);
  const off = lib.reviewPdfItems([INTERNAL_PAGE_1], { ...counts, approved: 2 }, job.campaign);
  assert.deepEqual(off.missing.map((entry) => entry.item), ['approved-count']);
  const thirty = lib.reviewPdfItems([INTERNAL_PAGE_1.replace('Approved 3 ', 'Approved 30 ')], counts, job.campaign);
  assert.deepEqual(thirty.missing.map((entry) => entry.item), ['approved-count'], '"Approved 3" is not found inside "Approved 30"');
});

function sheets({ summaryApproved = 3, answeredSources = JSON.stringify([id(1), id(2)]) } = {}) {
  return {
    'Read me': [['Field', 'Value'], ['Scope', 'internal']],
    Summary: [['Record set', 'Count'], ['Contributions', 4], ['Staff responses', 1], ['Received', 4], ['Approved', summaryApproved], ['Withheld', 1], ['Pending', 0], ['Flagged for review', 0], ['Published staff responses', 1], ['Answered by a published staff response', 2]],
    Contributions: [['id', 'status', 'body', 'Review state'], [id(1), 'approved', 'a', 'Approved'], [id(2), 'approved', 'b', 'Approved'], [id(3), 'approved', 'c', 'Approved'], [id(4), 'rejected', 'd', 'Withheld']],
    'Staff responses': [['id', 'source_item_ids', 'published_at'], [id(9), answeredSources, '2026-11-14T10:00:00Z'], [id(10), JSON.stringify([id(3)]), '']],
    'Long text': [['Record type', 'Record ID', 'Field', 'Part', 'Text'], ['response', id(9), 'source_item_ids', 2, `${id(2)}"]`], ['response', id(9), 'source_item_ids', 1, `["${id(1)}","`]],
  };
}

test('the workbook counts are read from the Summary rows and from the cells the checker counts', () => {
  const read = lib.readReviewWorkbookCounts(sheets());
  assert.deepEqual(read.summary, { received: 4, approved: 3, rejected: 1, pending: 0, flagged: 0, publishedResponses: 1, answered: 2 });
  assert.deepEqual(read.cells, { received: 4, approved: 3, rejected: 1, publishedResponses: 1, answered: 2 }, 'the unpublished response does not count');
  const split = lib.readReviewWorkbookCounts(sheets({ answeredSources: 'part [Full value: Long text / 00000000-0000-4000-8000-000000000009 / source_item_ids]' }));
  assert.equal(split.cells.answered, 2, 'a Long text value is joined in part order');
  const publicSummary = lib.readReviewWorkbookCounts({ Summary: [['Record set', 'Count'], ['Approved', 3], ['Withheld, pending and flagged', 'Not in the public copy']] });
  assert.deepEqual(publicSummary.summary, { approved: 3 });
});

test('the public page counts: the Comments tab, the responses tab, and distinct answered comments', () => {
  assert.equal(lib.tabCount('Comments (3)'), 3);
  assert.equal(lib.tabCount('Comentarios (1.234)'), 1234);
  assert.equal(lib.tabCount('Comments'), null);
  const counts = lib.readPublicPageCounts({
    commentsTab: 'Comments (3)',
    responsesTab: 'You said / We did (1)',
    answerHrefs: [`/engage/t?item=${id(1)}`, `/engage/t?item=${id(2)}&lang=es`, `/engage/t?item=${id(1)}`],
  });
  assert.deepEqual(counts, { approved: 3, publishedResponses: 1, answered: 2 });
});

const EXPECTED = { received: 4, approved: 3, rejected: 1, publishedResponses: 1, answered: 2 };
const AGREEING = [
  { surface: 'internal review PDF', counts: { ...EXPECTED }, required: lib.COUNT_NAMES },
  { surface: 'internal workbook cells', counts: { ...EXPECTED }, required: lib.COUNT_NAMES },
  { surface: 'public response page 390 px dark', counts: { approved: 3, publishedResponses: 1, answered: 2 }, required: ['approved', 'publishedResponses', 'answered'] },
];

test('count agreement: surfaces that agree pass', () => {
  assert.equal(lib.assertCountsAgree(EXPECTED, AGREEING), true);
  assert.deepEqual(lib.countDisagreements(EXPECTED, AGREEING), []);
});

test('count agreement: one surface off by one refuses the run and names it', () => {
  const off = AGREEING.map((surface) => (surface.surface === 'public response page 390 px dark' ? { ...surface, counts: { ...surface.counts, approved: 4 } } : surface));
  assert.throws(() => lib.assertCountsAgree(EXPECTED, off), /The counts disagree: public response page 390 px dark states approved 4; the journey's count is 3/);
});

test('count agreement: a required count that is missing or unreadable refuses the run', () => {
  const missing = [{ surface: 'internal review PDF', counts: { approved: 3, rejected: 1, publishedResponses: 1, answered: 2 }, required: lib.COUNT_NAMES }];
  assert.throws(() => lib.assertCountsAgree(EXPECTED, missing), /internal review PDF states no received count/);
  const unreadable = [{ surface: 'internal workbook cells', counts: { ...EXPECTED, answered: null }, required: lib.COUNT_NAMES }];
  assert.throws(() => lib.assertCountsAgree(EXPECTED, unreadable), /internal workbook cells answered count could not be read/);
  const publicWithheld = [{ surface: 'public review PDF', counts: { approved: 3, publishedResponses: 1, answered: 2, rejected: 0 }, required: ['approved'] }];
  assert.throws(() => lib.assertCountsAgree(EXPECTED, publicWithheld), /public review PDF states rejected 0/, 'a stated count is compared even where not required');
});

const REJECTED = 'Please lower my water bill, the meter reads wrong every month. Entered by an automated proof run; it represents no one.';
const CONTROLS = [
  { name: 'internal review PDF', pages: ['Contribution register', `Withheld\n${REJECTED.slice(0, 60)}\n${REJECTED.slice(60)}`] },
  { name: 'internal review workbook (every cell)', text: `Contributions\n${id(4)}\trejected\t${REJECTED}` },
];
const CLEAN_PUBLIC = [
  { name: 'public review PDF', pages: ['PUBLIC REVIEW COPY\nApproved 3 contributions.'] },
  { name: 'portal page (HTML)', text: '<html><body><p>Cars come around this corner fast</p></body></html>' },
  { name: 'GET 200 /api/engage/<token>', text: '{"items":[{"id":"00000000-0000-4000-8000-000000000001"}]}' },
];

test('rejected text: absent from public surfaces and found in the internal controls passes, with the hash', () => {
  const result = lib.assertRejectedTextAbsent({ texts: [REJECTED], ids: [id(4)], publicSurfaces: CLEAN_PUBLIC, controlSurfaces: CONTROLS });
  assert.deepEqual(result.searchedSha256, [sha(REJECTED)]);
  assert.deepEqual(result.hits, []);
  assert.equal(result.searched.length, 3);
});

test('rejected text: found on any public surface, in any form, refuses the run', () => {
  const html = REJECTED.replace(/'/g, '&#x27;');
  const leaks = [
    { name: 'public review PDF', pages: [`Approved 3 contributions.\n${REJECTED.slice(0, 50)}\n${REJECTED.slice(50)}`] },
    { name: 'portal page (HTML)', text: `<p>${html.replace(/ /g, '\n  ')}</p>` },
    { name: 'GET 200 /api/engage/<token>', text: JSON.stringify({ body: REJECTED }) },
    { name: 'public review workbook (every cell)', text: REJECTED.toUpperCase() },
    { name: 'GET 200 /api/engage/<token>/items', text: `{"id":"${id(4)}"}` },
  ];
  for (const leak of leaks) {
    assert.throws(() => lib.assertRejectedTextAbsent({ texts: [REJECTED], ids: [id(4)], publicSurfaces: [...CLEAN_PUBLIC, leak], controlSurfaces: CONTROLS }), new RegExp(`A rejected comment is on a public surface: ${leak.name.replace(/[.*+?^${}()|[\]\\/<>]/g, '\\$&')}`), leak.name);
  }
});

test('rejected text: a text that HTML and JSON escape is still found in its escaped forms', () => {
  const quoted = 'Don\'t "fix" the road & <raise> my bill. Entered by an automated proof run; it represents no one.';
  const controls = [{ name: 'internal review workbook (every cell)', text: quoted }];
  const leaks = [
    { name: 'portal page (HTML)', text: '<p>Don&#x27;t &quot;fix&quot; the road &amp; &lt;raise&gt; my bill. Entered by an automated proof run; it represents no one.</p>' },
    { name: 'portal page (HTML, decimal apostrophe)', text: '<p>Don&#39;t &quot;fix&quot; the road &amp; &lt;raise&gt; my bill. Entered by an automated proof run; it represents no one.</p>' },
    { name: 'GET 200 /api/engage/<token>', text: JSON.stringify({ items: [{ body: quoted }] }) },
  ];
  for (const leak of leaks) {
    assert.throws(() => lib.assertRejectedTextAbsent({ texts: [quoted], ids: [], publicSurfaces: [leak], controlSurfaces: controls }), /A rejected comment is on a public surface/, leak.name);
  }
});

test('rejected text: a search that cannot find the text in the internal files refuses the run', () => {
  const blind = [{ name: 'internal review PDF', pages: ['Contribution register'] }, CONTROLS[1]];
  assert.throws(() => lib.assertRejectedTextAbsent({ texts: [REJECTED], ids: [id(4)], publicSurfaces: CLEAN_PUBLIC, controlSurfaces: blind }), /found 0 of 1 rejected texts in internal review PDF/);
});

test('staff-only fields are found as keys at any depth', () => {
  const fields = job.participantChecks.publicRead.staffOnlyFields;
  assert.deepEqual(lib.staffFieldsIn({ campaign: { title: 'x' }, items: [{ id: 1, body: 'review_reason in a sentence' }] }, fields), []);
  assert.deepEqual(lib.staffFieldsIn({ items: [{ id: 1, nested: { moderation_notes: null } }] }, fields), ['moderation_notes']);
});

const OPEN = { name: 'portal', endedNoticeShown: true, campaignTextFound: false };
const GONE = { status: 404, campaignTextFound: false };

test('close: closed only when the save answered 200, the status reads closed and every public address shows only the notice', () => {
  assert.deepEqual(lib.closeVerdict({ saveStatus: 200, statusAfter: 'closed', addresses: [OPEN, { ...OPEN, name: 'about' }], publicRead: GONE }), { closed: true, problems: [] });
  assert.equal(lib.closeVerdict({ saveStatus: 400, statusAfter: 'closed', addresses: [OPEN], publicRead: GONE }).closed, false);
  assert.equal(lib.closeVerdict({ saveStatus: 200, statusAfter: 'active', addresses: [OPEN], publicRead: GONE }).closed, false);
  assert.match(lib.closeVerdict({ saveStatus: 200, statusAfter: 'closed', addresses: [{ ...OPEN, endedNoticeShown: false }], publicRead: GONE }).problems.join(), /portal does not show the ended notice/);
  assert.match(lib.closeVerdict({ saveStatus: 200, statusAfter: 'closed', addresses: [{ ...OPEN, campaignTextFound: true }], publicRead: GONE }).problems.join(), /still shows the campaign's own text/);
  assert.match(lib.closeVerdict({ saveStatus: 200, statusAfter: 'closed', addresses: [], publicRead: GONE }).problems.join(), /no public address was read/);
});

test('close: the public portal data read after the close may not answer 200 with the campaign\'s text (review 59, finding 8)', () => {
  const closed = (publicRead) => lib.closeVerdict({ saveStatus: 200, statusAfter: 'closed', addresses: [OPEN], publicRead });
  assert.equal(closed({ status: 200, campaignTextFound: false }).closed, true, 'a 200 without the campaign\'s text is an ended notice');
  assert.match(closed({ status: 200, campaignTextFound: true }).problems.join(), /public portal data still answers 200 with the campaign's own text/);
  assert.match(closed({ status: 200 }).problems.join(), /still answers 200/, 'a 200 that was not searched does not pass');
  assert.match(closed(null).problems.join(), /public portal data was not read after the close/);
  assert.equal(lib.closeVerdict({ saveStatus: 200, statusAfter: 'closed', neverPublic: true }).closed, true, 'a campaign that was never public has nothing to read');
});

test('the rejected-text search finds a text split across a PDF page break, as the checker does (review 59, F15)', () => {
  const text = 'Off-topic demonstration entry about a water meter reading. Entered by an automated proof run; it represents no one.';
  const at = text.indexOf('Entered');
  const split = { name: 'public review PDF', pages: [`Approved 3 contributions.\n${text.slice(0, at)}`, `${text.slice(at)}\nPage 2`] };
  assert.deepEqual(lib.searchRejected({ texts: [text], surfaces: [split] }).hits, [{ surface: 'public review PDF', by: 'text' }]);
  const footer = { name: 'public review PDF', pages: [`${text.slice(0, at)}\n\nPage 1 of 2`, text.slice(at)] };
  assert.deepEqual(lib.searchRejected({ texts: [text], surfaces: [footer] }).hits, [], 'a footer printed between the parts is the stated blind category');
});

test('close at the end: a journey that stops early still closes the campaign it opened', async () => {
  const calls = [];
  let campaign = null;
  const result = await lib.runJourney({
    steps: [async () => calls.push('one'), async () => { campaign = 'c-1'; calls.push('create'); }, async () => { throw Object.assign(new Error('stopped'), { journeyStep: 'three' }); }, async () => calls.push('never')],
    campaignId: () => campaign,
    close: async () => { calls.push('close'); return { closed: true, problems: [] }; },
    after: [async () => calls.push('health-end')],
  });
  assert.deepEqual(calls, ['one', 'create', 'close']);
  assert.equal(result.failure.journeyStep, 'three', 'the step that stopped the run stays the failure');
  assert.deepEqual(result.close, { attempted: true, closed: true, problems: [], error: null });
});

test('close at the end: a finished journey closes, then runs the end steps; nothing to close is said so', async () => {
  const calls = [];
  const done = await lib.runJourney({ steps: [async () => calls.push('step')], campaignId: () => 'c-1', close: async () => { calls.push('close'); return { closed: true }; }, after: [async () => calls.push('health-end')] });
  assert.deepEqual(calls, ['step', 'close', 'health-end']);
  assert.equal(done.failure, null);
  const none = await lib.runJourney({ steps: [async () => { throw new Error('before any campaign'); }], campaignId: () => null, close: async () => { throw new Error('must not run'); } });
  assert.deepEqual(none.close, { attempted: false, closed: false, problems: [], error: null });
});

test('close at the end: a close that fails or does not verify fails a finished journey', async () => {
  const unverified = await lib.runJourney({ steps: [], campaignId: () => 'c-1', close: async () => ({ closed: false, problems: ['portal does not show the ended notice'] }), after: [async () => assert.fail('end steps must not run')] });
  assert.equal(unverified.failure.journeyStep, 'close-campaign');
  assert.match(unverified.failure.message, /not taken offline: portal does not show the ended notice/);
  const thrown = await lib.runJourney({ steps: [], campaignId: () => 'c-1', close: async () => { throw new Error('select missing'); } });
  assert.equal(thrown.close.error, 'select missing');
  assert.equal(thrown.failure.journeyStep, 'close-campaign');
});

test('the public review PDF records its scope badge only, found with the shared matcher', () => {
  const rule = job.campaign.publicCopy;
  assert.deepEqual(lib.publicReviewPdfItems(['Cover', 'PUBLIC REVIEW\nCOPY\nApproved 3 contributions.'], rule), {
    items: [{ item: 'scope-badge', page: 2, method: 'pdftotext', text: 'Public review copy' }],
    missing: [],
  });
  assert.deepEqual(lib.publicReviewPdfItems(['INTERNAL REVIEW COPY'], rule).missing, [{ item: 'scope-badge', reason: '"Public review copy" not found' }]);
});

// ---------------------------------------------------------------------------
// Assembly, against the checker itself
// ---------------------------------------------------------------------------

const EXAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'examples', 'proven_job_record.v1.engagement.synthetic.json'), 'utf8'));
/** The checker's PROOF_ORIGIN, written out because the checker is an ES module; a test below compares the two. */
const PROOF_ORIGIN_FOR_TESTS = 'https://openplan-zeta.vercel.app';

/**
 * Three run files split from the synthetic example, with stand-in files the
 * fake readers read. Each run file carries what the assembler reads: the
 * job, mode, origin and expected commit, no stopping step, the close and
 * the step that closed it.
 */
function exampleRuns({ baseUrl = PROOF_ORIGIN_FOR_TESTS, mode = 'proof' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openplan-engagement-journey-'));
  const files = [];
  EXAMPLE.journeys.forEach((journey, index) => {
    const base = 100 * (index + 1);
    const rejected = journey.campaign.rejectedTexts[0];
    const leftOut = job.campaign.publicCopy.leftOutSentence;
    const counts = 'Approved 3 contributions.\nPublished 1 staff response.\nAnswered 2 contributions with a published staff response.';
    const note = 'Synthetic review: off topic.';
    const payload = JSON.stringify({ campaignId: id(base + 1), decisionId: id(base + 10), responseId: id(base + 8) });
    const sheets = (scope, rows, summary) => `PK\u0003\u0004 stand-in\n${JSON.stringify({
      'Read me': [['Field', 'Value'], ['Scope', scope]],
      Contributions: [['id', 'status', 'body', 'latitude', 'longitude', 'geometry', ...(scope === 'internal' ? ['moderation_notes'] : [])], ...rows.map((row) => (scope === 'internal' ? [...row, note] : row))],
      'Staff responses': [['id', 'source_item_ids', 'published_at'], [id(base + 8), JSON.stringify([id(base + 3), id(base + 4)]), '2026-11-20T10:30:00Z']],
      ...(scope === 'internal' ? {
        'Decision history': [['id', 'response_id', 'decision_id', 'project_id'], [id(base + 9), id(base + 8), id(base + 10), id(base + 2)]],
        'Decision exact context': [['Action ID', 'Exact payload text'], [id(base + 9), payload]],
        'Synthesis actions': [['decision_action_id', 'review_id'], [id(base + 9), id(base + 7)]],
      } : {}),
      'Long text': [['Record type', 'Record ID', 'Field', 'Part', 'Text']],
      Summary: summary,
    })}`;
    const approvedRows = [[id(base + 3), 'approved', 'a', 43.1, -124.2, ''], [id(base + 4), 'approved', 'b', '', '', ''], [id(base + 5), 'approved', 'c', '', '', '']];
    const texts = {
      'campaign-review.pdf': `%PDF-1.4 stand-in\nINTERNAL REVIEW COPY\nReceived 4 contributions.\nWithheld 1 contribution.\n${counts}\fRegister\n${id(base + 6)}\n${rejected}`,
      'campaign-review-public.pdf': `%PDF-1.4 stand-in\nPUBLIC REVIEW COPY\n${leftOut}\n${counts}`,
      'campaign-review.xlsx': sheets('internal', [...approvedRows, [id(base + 6), 'rejected', rejected, '', '', '']], [['Received', 4], ['Approved', 3], ['Withheld', 1], ['Published staff responses', 1], ['Answered by a published staff response', 2]]),
      'campaign-review-public.xlsx': sheets('public', approvedRows, [['Approved', 3], ['Published staff responses', 1], ['Answered by a published staff response', 2]]),
    };
    const copy = JSON.parse(JSON.stringify(journey));
    for (const entry of [...copy.pdfs, ...copy.workbooks]) {
      const text = texts[`${entry.kind}${path.extname(entry.path)}`];
      fs.mkdirSync(path.join(root, path.dirname(entry.path)), { recursive: true });
      fs.writeFileSync(path.join(root, entry.path), text);
      entry.sha256 = sha(text);
      entry.bytes = Buffer.byteLength(text);
    }
    copy.pdfs[0].pages = 2;
    copy.pdfs[0].items = copy.pdfs[0].items.map((item) => ({ ...item, page: 1 }));
    const { mode: recordMode, close, ...plain } = copy;
    const run = {
      jobId: lib.JOB_ID,
      mode,
      baseUrl,
      expectedCommit: EXAMPLE.commit,
      stoppedAt: null,
      steps: [{ step: 'close-campaign', status: 'passed', endedAt: close.endedAt }],
      journey: plain,
      crossWorkspace: { checks: EXAMPLE.crossWorkspace.checks.filter((check) => check.journey === journey.role) },
      // Run files made before lane 61 name no journey on a refusal; the assembler names it from the run.
      participantChecks: { refusals: EXAMPLE.participantChecks.refusals.filter((check) => check.journey === journey.role).map(({ journey: _role, ...check }) => check), publicRead: EXAMPLE.participantChecks.publicRead },
      close: {
        attempted: close.attempted,
        closed: close.closed,
        problems: [],
        error: null,
        reading: { saveStatus: close.saveStatus, statusAfter: close.statusAfter, addresses: close.addresses, publicReadStatusAfter: close.publicReadAfter.status },
      },
    };
    assert.equal(recordMode, 'proof');
    const file = path.join(root, `engagement-journey-${journey.role}.json`);
    fs.writeFileSync(file, JSON.stringify(run));
    files.push(file);
  });
  return { root, files };
}

const fakePdfPages = (file) => fs.readFileSync(file, 'utf8').replace(/^[^\n]*\n/, '').split('\f');
const fakeWorkbook = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^[^\n]*\n/, ''));

const loadChecker = () => import(require('url').pathToFileURL(path.join(__dirname, '..', 'openplan', 'scripts', 'ops', 'capability-evidence.mjs')).href);
const assemble = (files, overrides = {}) => lib.assembleEngagementRecord({ journeyFiles: files, commit: EXAMPLE.commit, baseUrl: PROOF_ORIGIN_FOR_TESTS, recordedOn: '2026-11-20', proofOrigin: PROOF_ORIGIN_FOR_TESTS, ...overrides });
/** Change one run file in place. */
const editRun = (file, change) => {
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(run);
  fs.writeFileSync(file, JSON.stringify(run));
};

test('the tests\' proof origin is the checker\'s', async () => {
  assert.equal(PROOF_ORIGIN_FOR_TESTS, (await loadChecker()).PROOF_ORIGIN);
});

test('assembly: three journey files make a record the checker accepts on the proof origin', async () => {
  const checker = await loadChecker();
  const { root, files } = exampleRuns();
  const record = assemble(files);
  assert.deepEqual(record.limits.map((limit) => limit.id), [...job.requiredLimits, job.crossWorkspace.pageAnsweredOkLimit]);
  assert.equal(record.participantChecks.refusals.length, 15, 'every journey\'s refusals are kept');
  assert.deepEqual([...new Set(record.participantChecks.refusals.map((check) => check.journey))], ['county', 'city-or-town', 'tribal-area'], 'each refusal names the journey whose run made it');
  assert.equal(record.participantChecks.publicRead.staffFieldsFound, false);
  assert.deepEqual(record.journeys.map((journey) => journey.mode), ['proof', 'proof', 'proof']);
  assert.deepEqual(record.journeys[0].close, EXAMPLE.journeys[0].close, 'the close comes from the run file');
  assert.doesNotThrow(() => checker.validateProvenJobRecord(record, { repoRoot: root, readPdfPages: fakePdfPages, readWorkbook: fakeWorkbook }));
  const local = { ...record, baseUrl: 'http://localhost:3482' };
  assert.throws(() => checker.validateProvenJobRecord(local, { repoRoot: root, readPdfPages: fakePdfPages, readWorkbook: fakeWorkbook }), /record.baseUrl is not in the expected form/);
});

test('assembly: one journey whose public read carried a staff field marks the record', () => {
  const { files } = exampleRuns({ baseUrl: 'https://example.invalid', mode: 'rehearsal' });
  editRun(files[1], (run) => { run.participantChecks.publicRead = { ...run.participantChecks.publicRead, staffFieldsFound: true, staffFieldsSearched: ['moderation_notes'] }; });
  const record = assemble(files, { baseUrl: 'https://example.invalid' });
  assert.equal(record.participantChecks.publicRead.staffFieldsFound, true);
  assert.deepEqual(record.participantChecks.publicRead.staffFieldsSearched, ['moderation_notes'], 'only the fields every journey searched');
});

// Review 59, finding 1: a rehearsal folder assembled by mistake as proof is
// refused before any checker reads it; so is an unfinished or open run.
test('assembly refuses a run that cannot go into a record for this commit and origin', () => {
  const cases = [
    ['a rehearsal run under the proof origin', (run) => { run.mode = 'rehearsal'; }, {}, /engagement-journey-county\.json is a rehearsal run; a record on the proof origin takes proof runs only/],
    ['a run made on another origin', (run) => { run.baseUrl = 'http://localhost:3484'; }, {}, /engagement-journey-county\.json ran on http:\/\/localhost:3484, not the record's https:\/\/openplan-zeta\.vercel\.app/],
    ['a proof run with no expected commit', (run) => { run.expectedCommit = null; }, {}, /named no expected commit; a proof run names the commit it tested/],
    ['a run made against another commit', (run) => { run.expectedCommit = '1'.repeat(40); }, {}, /expected commit 1{40}, not the record's/],
    ['a run that stopped', (run) => { run.stoppedAt = 'moderate'; }, {}, /engagement-journey-county\.json stopped at moderate; an unfinished run cannot go into a record/],
    ['a run that left its campaign open', (run) => { run.close.closed = false; }, {}, /did not take its campaign offline at the end, so it cannot go into a record/],
    ['a run of another job', (run) => { run.jobId = 'safety-action-plan-and-ss4a-in-three-places'; }, {}, /is a run of safety-action-plan-and-ss4a-in-three-places, not engagement-campaign-review-and-response-in-three-places/],
    ['a participant refusal named for another journey', (run) => { run.participantChecks.refusals[0].journey = 'tribal-area'; }, {}, /holds a participant refusal named for the tribal-area journey, not its own county/],
  ];
  for (const [name, change, overrides, reason] of cases) {
    const { files } = exampleRuns();
    editRun(files[0], change);
    assert.throws(() => assemble(files, overrides), reason, name);
  }
  assert.throws(() => assemble(exampleRuns().files, { proofOrigin: undefined }), /Assembly needs the checker's proof origin/);
});

test('assembly takes a rehearsal under its own local origin, and keeps its mode for the checker to refuse', async () => {
  const checker = await loadChecker();
  const { root, files } = exampleRuns({ baseUrl: 'http://localhost:3484', mode: 'rehearsal' });
  for (const file of files) editRun(file, (run) => { run.expectedCommit = null; });
  const record = assemble(files, { baseUrl: 'http://localhost:3484' });
  assert.deepEqual(record.journeys.map((journey) => journey.mode), ['rehearsal', 'rehearsal', 'rehearsal']);
  const hosted = { ...record, baseUrl: checker.PROOF_ORIGIN };
  assert.throws(() => checker.validateProvenJobRecord(hosted, { repoRoot: root, readPdfPages: fakePdfPages, readWorkbook: fakeWorkbook }), /county journey ran in rehearsal mode; only a proof run is proof/);
});

// ---------------------------------------------------------------------------
// The demonstration reads as a demonstration (KI-2026-11-15-010)
// ---------------------------------------------------------------------------

const DEMO_TITLE = 'Demonstration by an automated OpenPlan proof run. Road safety comments, tribal-area run';
const DEMO_INVITATION = 'Demonstration by an automated OpenPlan proof run. This page is not a real consultation, no agency or tribe asked for it, and no one will act on what is entered here. It will be closed when the run ends.';
const TEMPLATE_TEXT = 'We are studying traffic safety in this area and want to hear from the people who travel here. Your comments are reviewed by the project team and inform which improvements are studied.';
const readDemo = (surface, invitation = DEMO_INVITATION, title = DEMO_TITLE) => lib.readDemonstrationText({ surface, invitation, title });

test('demonstration text: a portal that shows the invitation and not the template reads as a demonstration', () => {
  const reading = readDemo({ name: 'portal at 1440 px', text: `${DEMO_TITLE}\n${DEMO_INVITATION}\nOpen for comments`, html: `<h1>${DEMO_TITLE}</h1><p>${DEMO_INVITATION.replace(/'/g, '&#x27;')}</p>` });
  assert.equal(reading.readsAsDemonstration, true, reading.problems.join('; '));
  assert.equal(reading.invitationOwnSentence, 'This page is not a real consultation, no agency or tribe asked for it, and no one will act on what is entered here.');
  assert.doesNotThrow(() => lib.assertReadsAsDemonstration([reading]));
});

test('demonstration text: the template sentence beside the title refuses, even though the title holds the first sentence', () => {
  const reading = readDemo({ name: 'portal at 390 px', text: `${DEMO_TITLE}\n${TEMPLATE_TEXT}`, html: '' });
  assert.equal(reading.invitationFirstSentenceFound, true, 'the title alone carries the first sentence');
  assert.equal(reading.invitationOwnSentenceFound, false);
  assert.equal(reading.templateSentenceFound, true);
  assert.equal(reading.readsAsDemonstration, false);
  assert.throws(() => lib.assertReadsAsDemonstration([reading]), /portal at 390 px shows the template's text "We are studying traffic safety in this area"/);
  assert.throws(() => lib.assertReadsAsDemonstration([reading]), /does not show the invitation's sentence "This page is not a real consultation/);
});

test('demonstration text: the template sentence beside the invitation still refuses, in the page text or only in its HTML', () => {
  const inText = readDemo({ name: 'portal', text: `${DEMO_TITLE}\n${DEMO_INVITATION}\n${TEMPLATE_TEXT.toUpperCase()}`, html: '' });
  assert.equal(inText.readsAsDemonstration, false);
  const inHtml = readDemo({ name: 'portal', text: `${DEMO_TITLE}\n${DEMO_INVITATION}`, html: `<meta name="description" content="${TEMPLATE_TEXT}">` });
  assert.equal(inHtml.templateSentenceFound, true);
  assert.throws(() => lib.assertReadsAsDemonstration([inHtml]), /shows the template's text/);
});

test('demonstration text: the invitation only in hidden HTML does not count as shown', () => {
  const reading = readDemo({ name: 'portal at 390 px', text: DEMO_TITLE, html: `<div hidden>${DEMO_INVITATION}</div>` });
  assert.equal(reading.invitationOwnSentenceFound, false);
  assert.throws(() => lib.assertReadsAsDemonstration([reading]), /does not show the invitation's sentence/);
});

test('demonstration text: an invitation with no sentence the title lacks refuses, because the check would prove nothing', () => {
  const reading = readDemo({ name: 'portal', text: DEMO_TITLE, html: '' }, 'Demonstration by an automated OpenPlan proof run.');
  assert.equal(reading.invitationOwnSentence, null);
  assert.throws(() => lib.assertReadsAsDemonstration([reading]), /has no sentence the campaign title lacks/);
});

test('demonstration text: a review PDF page 1 is read with the PDF matcher, across line breaks', () => {
  const wrapped = (text) => text.replace(/(\S+ \S+ \S+ \S+ \S+ \S+) /g, '$1\n');
  const good = readDemo({ name: 'public review PDF page 1', pages: [`PUBLIC REVIEW COPY\n\n${wrapped(DEMO_TITLE)}\n${wrapped(DEMO_INVITATION)}\n\nCampaign context\n\n${wrapped(DEMO_INVITATION)}`] });
  assert.equal(good.readsAsDemonstration, true, good.problems.join('; '));
  const bad = readDemo({ name: 'internal review PDF page 1', pages: [`INTERNAL REVIEW COPY\n\n${wrapped(DEMO_TITLE)}\n${wrapped(DEMO_INVITATION)}\n\nCampaign context\n\n${wrapped(TEMPLATE_TEXT)}`] });
  assert.equal(bad.invitationOwnSentenceFound, true, 'the summary under the title carries the invitation');
  assert.throws(() => lib.assertReadsAsDemonstration([good, bad]), /internal review PDF page 1 shows the template's text/);
});

test('demonstration text: no reading at all refuses', () => {
  assert.throws(() => lib.assertReadsAsDemonstration([]), /No surface was read/);
});

test('demonstration text: the template the journey selects still opens its public text with the sentence the check refuses', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openplan', 'src', 'lib', 'engagement', 'campaign-templates.ts'), 'utf8');
  const at = source.indexOf(`id: "${lib.CAMPAIGN_TEMPLATE.id}"`);
  assert.ok(at >= 0, `campaign-templates.ts has no template ${lib.CAMPAIGN_TEMPLATE.id}`);
  const next = source.indexOf('suggestedPublicDescription:', at);
  const text = source.slice(next, next + 400).replace(/\s+/g, ' ');
  assert.match(text, new RegExp(`^suggestedPublicDescription: "${lib.CAMPAIGN_TEMPLATE.publicSentence}`));
});

// Review 60: the check named one template's opening words and read page 1 only.

test('demonstration text: a later sentence of the text the campaign was created with is refused, whatever template made it', () => {
  const OTHER_TEMPLATE = 'Tell us how you get around downtown. Your comments are reviewed by the project team and inform which improvements are studied.';
  const page = { name: 'portal at 1440 px', text: `${DEMO_TITLE}\n${DEMO_INVITATION}\nYour comments are reviewed by the project team and inform which improvements are studied.`, html: '' };
  const withoutIt = lib.readDemonstrationText({ surface: page, invitation: DEMO_INVITATION, title: DEMO_TITLE });
  assert.equal(withoutIt.readsAsDemonstration, true, 'the fixed opening words alone do not catch this text');
  const reading = lib.readDemonstrationText({ surface: page, invitation: DEMO_INVITATION, title: DEMO_TITLE, createdWith: OTHER_TEMPLATE });
  assert.equal(reading.readsAsDemonstration, false);
  assert.equal(reading.createdWithSentencesLookedFor, 2);
  assert.deepEqual(reading.createdWithSentencesFound, ['Your comments are reviewed by the project team and inform which improvements are studied.']);
  assert.throws(() => lib.assertReadsAsDemonstration([reading]), /shows text the campaign was created with: "Your comments are reviewed by the project team/);
});

test('demonstration text: a campaign created with the invitation itself is not refused for showing it', () => {
  const page = { name: 'portal at 1440 px', text: `${DEMO_TITLE}\n${DEMO_INVITATION}`, html: '' };
  const reading = lib.readDemonstrationText({ surface: page, invitation: DEMO_INVITATION, title: DEMO_TITLE, createdWith: DEMO_INVITATION });
  assert.equal(reading.createdWithSentencesLookedFor, 0);
  assert.equal(reading.readsAsDemonstration, true, reading.problems.join('; '));
});

test('demonstration text: the created-with text on a later page of a review PDF is refused, and later pages need not repeat the invitation', () => {
  const pageOne = `PUBLIC REVIEW COPY\n${DEMO_TITLE}\n${DEMO_INVITATION}\nCampaign context\n${DEMO_INVITATION}`;
  const clean = lib.readDemonstrationText({ surface: { name: 'public review PDF, all 2 pages', pages: [pageOne, 'Contributions\n1. Untitled contribution'] }, invitation: DEMO_INVITATION, title: DEMO_TITLE, createdWith: TEMPLATE_TEXT, requireInvitation: false });
  assert.equal(clean.readsAsDemonstration, true, clean.problems.join('; '));
  const laterPage = lib.readDemonstrationText({ surface: { name: 'public review PDF, all 2 pages', pages: [pageOne, `Historical definitions\nCampaign settings 1\n${TEMPLATE_TEXT}`] }, invitation: DEMO_INVITATION, title: DEMO_TITLE, createdWith: TEMPLATE_TEXT, requireInvitation: false });
  assert.equal(laterPage.readsAsDemonstration, false);
  assert.throws(() => lib.assertReadsAsDemonstration([laterPage]), /all 2 pages shows the template's text/);
  // Without the invitation requirement lifted, a page-1-only reading of the same file would pass: that was the gap.
  const pageOneOnly = lib.readDemonstrationText({ surface: { name: 'public review PDF page 1', pages: [pageOne] }, invitation: DEMO_INVITATION, title: DEMO_TITLE, createdWith: TEMPLATE_TEXT });
  assert.equal(pageOneOnly.readsAsDemonstration, true);
  const noInvitation = lib.readDemonstrationText({ surface: { name: 'a later page', pages: ['Contributions'] }, invitation: DEMO_INVITATION, title: DEMO_TITLE, requireInvitation: false });
  assert.equal(noInvitation.readsAsDemonstration, true, 'a reading that does not require the invitation passes a page without it');
  assert.equal(lib.readDemonstrationText({ surface: { name: 'a later page', pages: ['Contributions'] }, invitation: DEMO_INVITATION, title: DEMO_TITLE }).readsAsDemonstration, false);
});

test('close verdict: a campaign closed before it had a public link is closed and never public', () => {
  assert.deepEqual(lib.closeVerdict({ saveStatus: 200, statusAfter: 'closed', addresses: [], neverPublic: true }), { closed: true, problems: [], neverPublic: true });
  assert.equal(lib.closeVerdict({ saveStatus: 200, statusAfter: 'active', addresses: [], neverPublic: true }).closed, false);
  assert.equal(lib.closeVerdict({ saveStatus: 200, statusAfter: 'closed', addresses: [] }).closed, false, 'with a public link, reading no address is still a problem');
});
