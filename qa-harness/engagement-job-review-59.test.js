// Review 59's changed copies of the second proven job's dress rehearsal,
// against lane 61's assembler and checker. No browser, no server.
// Run: node --test engagement-job-review-59.test.js (Poppler is not needed:
// every review file in the fixture is a stand-in holding the real file's
// pdftotext pages or SheetJS cells; see the fixture README).
//
// The dress rehearsal's three run files are re-assembled with the assembler a
// hosted run will use. The honest record is refused for its local origin and
// its rehearsal mode and for nothing else: with both written in by hand as
// proof values (a forgery, in this test only) it is accepted, so every
// refusal below is one the checker could have withheld. Each changed copy
// was accepted by the checker review 59 read (PR 487) and is now refused for
// its stated reason.
//
// Blind category: one rehearsal's files, read through stand-ins. What the
// journey read on live screens (the public page, the portal data, axe,
// console errors, the keyboard path) is on the journey's word; the record
// says so in its limits.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./engagement-job-journey-lib');

const FIXTURE = path.join(__dirname, '..', 'openplan', 'src', 'test', 'fixtures', 'engagement-dress-rehearsal-2026-11-15');
const RUN_FILES = [['county', 'county'], ['city', 'city-or-town'], ['tribal', 'tribal-area']].map(([folder, role]) => path.join(folder, `engagement-journey-${role}.json`));
// The commit the dress rehearsal ran, which its health readbacks name.
const COMMIT = '65aba74fb3bdbfa965c19806f501e3180024f687';
const LOCAL = 'http://localhost:3484';
const REASON = 'Proof run review: off topic for a road safety campaign, so it is not published.';

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const STAND_IN = /^(%PDF-1\.4|PK\u0003\u0004) stand-in/;
const standInBody = (file) => fs.readFileSync(file, 'utf8').split('\n').slice(2).join('\n');
const readPdfPages = (file) => {
  if (!STAND_IN.test(fs.readFileSync(file, 'latin1').slice(0, 40))) throw new Error(`not a stand-in: ${file}`);
  return standInBody(file).split('\f');
};
const readWorkbook = (file) => JSON.parse(standInBody(file));

const loadChecker = () => import(require('url').pathToFileURL(path.join(__dirname, '..', 'openplan', 'scripts', 'ops', 'capability-evidence.mjs')).href);

/** A copy of the fixture to change, and the honest record assembled from its run files. */
async function honest() {
  const checker = await loadChecker();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openplan-review-59-'));
  fs.cpSync(FIXTURE, root, { recursive: true });
  const record = lib.assembleEngagementRecord({
    journeyFiles: RUN_FILES.map((file) => path.join(root, file)),
    commit: COMMIT,
    baseUrl: LOCAL,
    recordedOn: '2026-11-15',
    proofOrigin: checker.PROOF_ORIGIN,
    root,
  });
  const check = (value, pages = readPdfPages) => checker.validateProvenJobRecord(value, { repoRoot: root, readPdfPages: pages, readWorkbook });
  /** The honest record with the hosted origin and proof mode written in by hand. */
  const forged = () => {
    const copy = { ...clone(record), baseUrl: checker.PROOF_ORIGIN };
    for (const journey of copy.journeys) journey.mode = 'proof';
    return copy;
  };
  return { checker, root, record, check, forged };
}

const J = (record, role) => record.journeys.find((journey) => journey.role === role);

/** Rewrite one workbook stand-in under a new name and re-pin its entry, so only the rule under test can refuse it. */
function changeSheets(root, entry, change) {
  const sheets = readWorkbook(path.join(root, entry.path));
  change(sheets);
  const header = fs.readFileSync(path.join(root, entry.path), 'utf8').split('\n').slice(0, 2).join('\n');
  const text = `${header}\n${JSON.stringify(sheets)}`;
  entry.path = entry.path.replace(/\.xlsx$/, `-${sha(text).slice(0, 8)}.xlsx`);
  fs.writeFileSync(path.join(root, entry.path), text);
  entry.sha256 = sha(text);
  entry.bytes = Buffer.byteLength(text);
}
const column = (rows, name) => rows[0].indexOf(name);

test('the dress rehearsal re-assembled is refused for its local origin and rehearsal mode, and for nothing else', async () => {
  const { checker, record, check, forged } = await honest();
  assert.equal(record.baseUrl, LOCAL);
  assert.deepEqual(record.journeys.map((journey) => journey.mode), ['rehearsal', 'rehearsal', 'rehearsal']);
  assert.throws(() => check(clone(record)), /record\.baseUrl is not in the expected form/);
  assert.throws(() => check({ ...clone(record), baseUrl: checker.PROOF_ORIGIN }), /county journey ran in rehearsal mode; only a proof run is proof/);
  assert.doesNotThrow(() => check(forged()));
});

test('the dress rehearsal cannot be assembled as a proof (review 59, H1 and finding 1)', async () => {
  const { checker, root } = await honest();
  assert.throws(() => lib.assembleEngagementRecord({
    journeyFiles: RUN_FILES.map((file) => path.join(root, file)), commit: COMMIT, baseUrl: checker.PROOF_ORIGIN, recordedOn: '2026-11-15', proofOrigin: checker.PROOF_ORIGIN, root,
  }), /engagement-journey-county\.json ran on http:\/\/localhost:3484, not the record's https:\/\/openplan-zeta\.vercel\.app/);
});

// Each case: review 59's id, its change, and the refusal it now gets. The
// change returns the PDF reader to use when it simulates page text.
const CASES = [
  ['H2', 'the hosted origin written in, the rehearsal mode kept', (r) => { for (const journey of r.journeys) journey.mode = 'rehearsal'; }, /county journey ran in rehearsal mode/],
  ['P6', 'a city geoid in Wyoming whose stateFips says Oregon', (r) => { J(r, 'city-or-town').place.stateFips = ['41']; }, /city-or-town journey geoid 56\d+ is in the state with FIPS 56, but the record says 41/],
  ['HC3', 'an end health readback reporting degraded', (r) => { J(r, 'county').health[1].status = 'degraded'; }, /county journey end health readback reports status degraded, not ok/],
  ['HC4', 'an end health readback dated before the start one', (r) => { J(r, 'county').health[1].checkedAt = '2026-11-14T00:00:00Z'; }, /county journey end health readback \(2026-11-14T00:00:00Z\) comes before the campaign was closed/],
  ['HC6', 'an end readback reporting another migration count', (r) => { J(r, 'county').health[1].migrationsExpected = 454; }, /county journey end health readback reports migrationsExpected 454, but the start one reports 455/],
  ['O5', 'an account created after the end health readback', (r) => { J(r, 'county').accountCreatedAt = '2026-11-16T00:00:00Z'; }, /county journey account was created \(2026-11-16T00:00:00Z\) after the campaign was closed/],
  ['K4', 'map-point and no-map-point kinds swapped', (r) => { const c = J(r, 'county').campaign.contributions; c[0].kind = 'no-map-point'; c[1].kind = 'map-point'; }, /campaign-review workbook Contributions has coordinates for 8017a499-b681-4ad5-b857-f78ccead4985, which the record calls a no-map-point contribution/],
  ['K5', 'map points claimed only for comments with no coordinates', (r) => { const c = J(r, 'county').campaign.contributions; c[0].kind = 'no-map-point'; c[1].kind = 'map-point'; c[2].kind = 'no-map-point'; c[3].kind = 'map-point'; }, /has coordinates for 8017a499-b681-4ad5-b857-f78ccead4985, which the record calls a no-map-point contribution/],
  ['F11b', 'the map point\'s coordinates blanked in the internal workbook', (r, root) => {
    changeSheets(root, J(r, 'county').workbooks[0], (s) => { for (const name of ['latitude', 'longitude', 'geometry']) for (const row of s.Contributions.slice(1)) row[column(s.Contributions, name)] = ''; });
  }, /Contributions has no coordinates for 8017a499-b681-4ad5-b857-f78ccead4985, which the record calls a map-point contribution/],
  ['R6', 'a decision id and link id in no file', (r) => { Object.assign(J(r, 'county').campaign.response, { decisionId: '11111111-1111-4111-8111-111111111111', decisionLinkId: '22222222-2222-4222-8222-222222222222' }); }, /Decision history has no row for the record's decision link 22222222-2222-4222-8222-222222222222/],
  ['R8', 'a response id in no file', (r) => { J(r, 'county').campaign.response.responseId = '33333333-3333-4333-8333-333333333333'; }, /Staff responses has no row for the record's response 33333333-3333-4333-8333-333333333333/],
  ['R9', 'a staff review id in no file', (r) => { J(r, 'county').campaign.staffReview.reviewId = '55555555-5555-4555-8555-555555555555'; }, /Synthesis actions has no row of decision link [0-9a-f-]{36} naming the record's staff review 55555555-5555-4555-8555-555555555555/],
  ['O7', 'a campaign id the files do not name', (r) => { J(r, 'county').campaign.campaignId = '44444444-4444-4444-8444-444444444444'; }, /payload of decision link [0-9a-f-]{36} names campaignId fef9825b-bffa-47ed-b672-4d6b76e9d1b4, not the record's 44444444-4444-4444-8444-444444444444/],
  ['O4', 'the same campaign id in two journeys', (r) => { J(r, 'city-or-town').campaign.campaignId = J(r, 'county').campaign.campaignId; }, /city-or-town journey campaign-review workbook Decision exact context payload of decision link [0-9a-f-]{36} names campaignId/],
  ['O10', 'the response\'s Staff responses id changed in the internal workbook', (r, root) => {
    changeSheets(root, J(r, 'county').workbooks[0], (s) => { s['Staff responses'][1][0] = '66666666-6666-4666-8666-666666666666'; });
  }, /Staff responses has no row for the record's response 1725bd54-215d-4f9a-8843-56b4a04a0a6a/],
  ['S3', 'the public response screen dropped', (r) => { const j = J(r, 'county'); j.screens = j.screens.filter((s) => s.screen !== 'public-response'); }, /county journey has no check of the public-response screen/],
  ['S4', 'only the portal and staff campaign screens kept', (r) => { for (const j of r.journeys) j.screens = j.screens.filter((s) => ['portal', 'staff-campaign'].includes(s.screen)); }, /county journey has no check of the public-response screen/],
  ['S5', 'a required screen that scrolls sideways at 390 px', (r) => { J(r, 'county').screens.find((s) => s.width === 390).horizontalScroll = true; }, /county journey screen portal at 390 px light scrolls sideways/],
  ['A3', 'participant refusals kept for one journey only', (r) => { r.participantChecks.refusals = r.participantChecks.refusals.slice(0, 5); }, /the city-or-town journey needs exactly one public participant campaign-read check, found 0/],
  ['F5', 'the rejected text replaced by the rejection reason', (r) => { const c = J(r, 'county').campaign; c.rejectedTexts[0] = REASON; c.rejectedTextSha256[0] = sha(REASON); }, /Contributions body of rejected comment 9db57e47-1409-4ddd-a0e4-ddaad1771133 is not rejected text 1; the record's text must be the rejected comment's own/],
  ['F6', 'F5, with the real rejected text leaked into the public workbook', (r, root) => {
    const j = J(r, 'county');
    const real = j.campaign.rejectedTexts[0];
    j.campaign.rejectedTexts[0] = REASON;
    j.campaign.rejectedTextSha256[0] = sha(REASON);
    changeSheets(root, j.workbooks[1], (s) => { s['Staff responses'][1][2] = `${s['Staff responses'][1][2]} ${real}`; });
  }, /body of rejected comment 9db57e47-1409-4ddd-a0e4-ddaad1771133 is not rejected text 1/],
  ['F7', 'the rejected text replaced by its first sentence', (r) => { const c = J(r, 'county').campaign; c.rejectedTexts[0] = 'Off-topic demonstration entry about a water meter reading.'; c.rejectedTextSha256[0] = sha(c.rejectedTexts[0]); }, /body of rejected comment 9db57e47-1409-4ddd-a0e4-ddaad1771133 is not rejected text 1/],
  ['O9', 'the rejected row\'s moderation note blanked', (r, root) => {
    changeSheets(root, J(r, 'county').workbooks[0], (s) => { for (const row of s.Contributions.slice(1)) if (row[column(s.Contributions, 'status')] === 'rejected') row[column(s.Contributions, 'moderation_notes')] = ''; });
  }, /Contributions has no moderation_notes for rejected comment 9db57e47-1409-4ddd-a0e4-ddaad1771133, but the record says its reason was recorded/],
  ['F9', 'a moderation_notes column on the public workbook\'s approved rows', (r, root) => {
    const internal = readWorkbook(path.join(root, J(r, 'county').workbooks[0].path)).Contributions;
    changeSheets(root, J(r, 'county').workbooks[1], (s) => {
      s.Contributions[0].push('moderation_notes');
      for (const row of s.Contributions.slice(1)) row.push(internal.find((entry) => entry[0] === row[0])[column(internal, 'moderation_notes')]);
    });
  }, /campaign-review-public workbook names the staff-only field moderation_notes at sheet Contributions cell Q1/],
  ['F8', 'a public workbook changed with its hash left stale', (r, root) => {
    // A copy under a new name, so the shared file stays as recorded for the other cases.
    const entry = J(r, 'county').workbooks[1];
    const stale = entry.path.replace(/\.xlsx$/, '-stale.xlsx');
    fs.copyFileSync(path.join(root, entry.path), path.join(root, stale));
    fs.appendFileSync(path.join(root, stale), '\u0000');
    entry.path = stale;
  }, /Error: proven job record refused: county journey campaign-review-public workbook evidence hash changed/],
  ['F15', 'the rejected text split across two public PDF pages', (r) => {
    const j = J(r, 'county');
    const text = j.campaign.rejectedTexts[0];
    const at = text.indexOf('Entered');
    const target = j.pdfs[1].path.replaceAll('/', path.sep);
    return (file) => {
      const pages = readPdfPages(file);
      if (!file.endsWith(target)) return pages;
      pages[2] += `\n${text.slice(0, at)}`;
      pages[3] = `${text.slice(at)}\n${pages[3]}`;
      return pages;
    };
  }, /county journey campaign-review-public PDF holds rejected text 1 at a page break/],
  ['O2', 'confirmation by an admin link in every journey', (r) => { for (const j of r.journeys) j.confirmationMethod = 'admin_generate_link'; }, /county journey confirmed its account by admin_generate_link/],
  ['O3', 'the portal address recorded as a printable slug', (r) => { J(r, 'county').campaign.portalAddressKind = 'printable-slug'; }, /county journey formed its portal address by printable-slug/],
];

test('each changed copy review 59 found accepted, and this lane closes, is refused for its stated reason', async () => {
  const { root, check, forged } = await honest();
  for (const [id, change, mutate, reason] of CASES) {
    const record = forged();
    const pages = mutate(record, root);
    assert.throws(() => check(record, typeof pages === 'function' ? pages : undefined), reason, `${id}: ${change}`);
  }
});
