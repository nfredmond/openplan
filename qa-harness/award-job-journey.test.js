// Unit tests for the award to reimbursement journey helpers (the fourth
// proven job). No browser, no server. Run: node --test award-job-journey.test.js
//
// Blind category: these tests read the helpers, the job's definition, the
// synthetic example record and three product source files. They cannot show
// that a screen still prints a figure where the readers look, that a control
// still answers as recorded, or that the hosted site's database refuses a
// direct write; a rehearsal journey on a local build shows those.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./award-job-journey-lib');
const { repoRoot, appRoot } = require('./harness-env');

const job = lib.loadJobDefinition();
const fixture = () => JSON.parse(fs.readFileSync(lib.REHEARSAL_INPUTS_PATH, 'utf8'));
const example = () => JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas', 'examples', 'proven_job_record.v1.award.synthetic.json'), 'utf8'));
const COUNTY_RUN = { role: 'county', placeKind: 'county', placeQuery: 'Plumas County, CA' };
const PROOF_ORIGIN = 'https://openplan-zeta.vercel.app';
const LOCAL_ORIGIN = 'http://localhost:3590';
const TODAY = '2026-11-17';

/** The fixture with its rehearsal label taken out: inputs a proof would not refuse for being rehearsal text. */
const unlabel = (inputs) => {
  delete inputs.rehearsal;
  delete inputs.label;
  inputs.note = 'Inputs for a test.';
  inputs.projectSummary = 'A demonstration project typed by an automated OpenPlan proof run. It describes no real project and speaks for no agency.';
  return inputs;
};
/** The fixture with one change, checked in a mode. */
const validate = (change, mode = 'rehearsal', options = {}) => {
  const inputs = fixture();
  if (mode === 'proof') unlabel(inputs);
  change(inputs);
  return lib.validateAwardInputs(inputs, mode, { job, today: TODAY, run: COUNTY_RUN, ...options });
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const BASE_ARGS = ['--base-url', LOCAL_ORIGIN, '--mode', 'rehearsal', '--place-query', 'Plumas County, CA', '--place-kind', 'county', '--role', 'county', '--email', 'a@openplan.test', '--member-email', 'm@openplan.test', '--second-email', 'b@openplan.test', '--out', 'runs/x'];
const withArg = (key, value) => {
  const args = [...BASE_ARGS];
  const at = args.indexOf(key);
  if (at >= 0) args[at + 1] = value;
  else args.push(key, value);
  return args;
};

test('the arguments name three different accounts, a role the definition has and its place kind', () => {
  const parsed = lib.parseAwardArgs(BASE_ARGS, job);
  assert.strictEqual(parsed.role, 'county');
  assert.strictEqual(parsed.memberEmail, 'm@openplan.test');
  assert.throws(() => lib.parseAwardArgs(withArg('--member-email', 'A@openplan.test'), job), /three different addresses/);
  assert.throws(() => lib.parseAwardArgs(withArg('--second-email', 'm@openplan.test'), job), /three different addresses/);
  assert.throws(() => lib.parseAwardArgs(withArg('--role', 'metro'), job), /--role must be one of county, city, tribal-area/);
  assert.throws(() => lib.parseAwardArgs(withArg('--place-kind', 'city'), job), /needs --place-kind county/);
  assert.throws(() => lib.parseAwardArgs(BASE_ARGS.filter((arg, index) => index < 12 || index > 13), job), /Missing required arguments: --member-email/);
  assert.throws(() => lib.parseAwardArgs([...BASE_ARGS, '--confirm-link', 'http://x'], job), /never taken as an argument/);
  assert.throws(() => lib.parseAwardArgs([...BASE_ARGS, '--invitation-link', 'http://x'], job), /never taken as an argument/);
});

test('a proof names its inputs, commit, all three link files and its executor', () => {
  const proof = withArg('--mode', 'proof');
  assert.throws(() => lib.parseAwardArgs(proof, job), /A proof run needs --inputs, --expected-commit, --confirm-link-file, --member-confirm-link-file, --second-confirm-link-file, --executor-agent, --executor-model/);
  const complete = [...proof, '--inputs', 'i.json', '--expected-commit', 'a'.repeat(40), '--confirm-link-file', '1', '--member-confirm-link-file', '2', '--second-confirm-link-file', '3', '--executor-agent', 'Claude Code', '--executor-model', 'claude-opus-5-5'];
  assert.strictEqual(lib.parseAwardArgs(complete, job).mode, 'proof');
  assert.throws(() => lib.parseAwardArgs(withArg('--expected-commit', 'abc'), job), /40-character commit/);
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

test('the rehearsal fixture is valid and a proof refuses it for its label', () => {
  assert.doesNotThrow(() => validate(() => {}));
  assert.throws(() => lib.validateAwardInputs(fixture(), 'proof', { job, today: TODAY }), /labeled "Rehearsal inputs for the award to reimbursement journey, not an award\."/);
  assert.doesNotThrow(() => validate(() => {}, 'proof'));
  const flagged = fixture();
  unlabel(flagged);
  flagged.rehearsal = true;
  assert.throws(() => lib.validateAwardInputs(flagged, 'proof', { job, today: TODAY }), /A proof needs its own inputs/);
});

test('the fixed amounts are refused if they differ from the definition by a cent or a word', () => {
  assert.throws(() => validate((inputs) => { inputs.award.ceiling = '200000.01'; }), /award\.ceiling is "200000\.01"; this job's fixed demonstration figure is "200000\.00"/);
  assert.throws(() => validate((inputs) => { inputs.award.ceiling = '200000'; }), /award\.ceiling is "200000"/);
  assert.throws(() => validate((inputs) => { inputs.award.match = '0.00'; }), /award\.match is "0\.00"/);
  assert.throws(() => validate((inputs) => { inputs.award.matchPosture = 'complete'; }), /award\.matchPosture is "complete"/);
  assert.throws(() => validate((inputs) => { inputs.requests[0].gross = '60000.10'; }), /requests\[0\]\.gross is "60000\.10"; this job's fixed first request has "60000\.00"/);
  assert.throws(() => validate((inputs) => { inputs.requests[1].retention = '4500.00'; }), /requests\[1\]\.retention is "4500\.00"/);
  assert.throws(() => validate((inputs) => { inputs.requests[2].number = 'INV-3'; }), /requests\[2\]\.number is "INV-3"/);
  assert.throws(() => validate((inputs) => { inputs.requests.reverse(); }), /requests\[0\]\.key is "resubmission"/);
  assert.throws(() => validate((inputs) => { inputs.requests.pop(); }), /requests lists 2/);
});

test('the dates are held to the definition\'s date rules before anything is typed', () => {
  assert.throws(() => validate((inputs) => { inputs.award.obligatedOn = '2026-04-02'; }), /requests\.first period starts 2026-04-01, before the award was obligated on 2026-04-02/);
  assert.throws(() => validate((inputs) => { inputs.award.obligatedOn = '2026-02-30'; }), /not a calendar date/);
  assert.throws(() => validate((inputs) => { inputs.requests[0].periodEnd = '2026-03-31'; }), /period ends before it starts/);
  assert.throws(() => validate((inputs) => { inputs.requests[0].invoiceDate = '2026-03-31'; }), /invoiced 2026-03-31, before its period starts/);
  assert.throws(() => validate((inputs) => { inputs.requests[1].invoiceDate = '2026-11-18'; }), /after today \(2026-11-17\)/);
  assert.throws(() => validate((inputs) => { inputs.requests[0].dueDate = '2026-07-01'; }), /due before it is invoiced/);
  assert.throws(() => validate((inputs) => { inputs.requests[0].invoiceDate = lib.PREFILLED; }), /only for the resubmission/);
  assert.throws(() => validate((inputs) => { inputs.requests[2].periodStart = '2026-07-02'; }), /must claim the period of the request it resubmits \(2026-07-01 to 2026-09-30\)/);
  assert.throws(() => validate((inputs) => { inputs.requests[2].invoiceDate = '2026-10-14'; }), /invoiced before the request it resubmits/);
  assert.doesNotThrow(() => validate((inputs) => { inputs.requests[2].invoiceDate = '2026-10-16'; }));
});

test('typed text holds no email address, placeholder, amount, refused phrase or form name', () => {
  assert.throws(() => validate((inputs) => { inputs.rejectionReason = 'Write to staff@agency.gov for the report.'; }), /rejectionReason holds an email address/);
  assert.throws(() => validate((inputs) => { inputs.closeOutNote = 'Demonstration by an automated OpenPlan proof run. Balance TBD.'; }), /closeOutNote holds a placeholder/);
  for (const amount of ['$45,000', 'claimed 45,000 in all', 'a fee of 12.50', 'sixty USD', 'ten dollars', 'fee ４５']) {
    assert.throws(() => validate((inputs) => { inputs.rejectionReason = `Missing the report; ${amount}.`; }), /rejectionReason holds an amount/, amount);
  }
  assert.throws(() => validate((inputs) => { inputs.closeOutNote = 'Demonstration by an automated OpenPlan proof run. The rest was deobligated.'; }), /closeOutNote holds "deobligated"/);
  assert.throws(() => validate((inputs) => { inputs.awardTitle = `${inputs.awardTitle} on form SF 270`; }), /awardTitle names the form "SF-270"/);
  assert.throws(() => validate((inputs) => { inputs.projectName = 'Plumas County walking improvements'; }), /projectName must say "Demonstration by an automated OpenPlan proof run"/);
  assert.throws(() => validate((inputs) => { inputs.awardTitle = 'Plumas County SS4A planning award'; }), /awardTitle must say/);
  assert.throws(() => validate((inputs) => { inputs.memberOrganization = 'Plumas County public works'; }), /memberOrganization must be a demonstration name/);
  assert.throws(() => validate((inputs) => { inputs.secondOrganization = inputs.organization; }), /three different names/);
  assert.throws(() => validate((inputs) => { inputs.timeZone = 'Pacific'; }), /not a time zone name/);
  assert.throws(() => validate((inputs) => { inputs.overCeilingProbe.gross = '150000.00'; }), /above the ceiling on its own/);
  assert.throws(() => validate((inputs) => { inputs.overCeilingProbe.number = 'INV-1'; }), /must differ from the fixed requests' numbers/);
  assert.throws(() => validate((inputs) => { inputs.placeQuery = 'Sierra County, CA'; }), /written for placeQuery "Sierra County, CA"/);
});

// ---------------------------------------------------------------------------
// The place
// ---------------------------------------------------------------------------

test('each role takes only a place of its definition\'s rule', () => {
  const county = { kind: 'county', geoid: '06063', stateFips: '06', label: 'Plumas County, CA' };
  assert.deepStrictEqual(lib.assertAwardPlaceForRole(county, 'county', job), ['06']);
  assert.throws(() => lib.assertAwardPlaceForRole({ ...county, geoid: '41035', stateFips: '41', label: 'Klamath County, OR' }, 'county', job), /does not end with ", CA"/);
  const city = { kind: 'city', geoid: '4139700', stateFips: '41', label: 'Klamath Falls, OR' };
  assert.deepStrictEqual(lib.assertAwardPlaceForRole(city, 'city', job), ['41']);
  assert.throws(() => lib.assertAwardPlaceForRole({ kind: 'city', geoid: '0664000', stateFips: '06', label: 'Sacramento, CA' }, 'city', job), /FIPS 06, which has a reimbursement profile of its own/);
  assert.throws(() => lib.assertAwardPlaceForRole({ ...city, geoid: '41397' }, 'city', job), /not the form of a city id/);
  assert.throws(() => lib.assertAwardPlaceForRole({ ...city, label: 'Altamont CDP, OR' }, 'city', job), /is a Census designated place/);
  assert.throws(() => lib.assertAwardPlaceForRole({ ...city, kind: 'cdp' }, 'city', job), /needs a place of kind city/);
  const tribal = { kind: 'aiannh', geoid: '2810R', stateFips: null, label: 'Pine Ridge Reservation, NE--SD' };
  assert.deepStrictEqual(lib.assertAwardPlaceForRole(tribal, 'tribal-area', job), ['31', '46']);
  assert.throws(() => lib.assertAwardPlaceForRole({ ...tribal, label: 'Hoopa Valley Reservation, CA' }, 'tribal-area', job), /in 1 state\(s\)/);
  assert.throws(() => lib.assertAwardPlaceForRole({ ...tribal, label: 'Some Reservation, ZZ--SD' }, 'tribal-area', job), /names a state this journey does not know/);
});

// ---------------------------------------------------------------------------
// The product's path
// ---------------------------------------------------------------------------

test('the journey\'s one-step moves are the product\'s control, read from its source', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'components', 'invoicing', 'invoice-status-advance-button.tsx'), 'utf8');
  const nextBlock = source.slice(source.indexOf('function nextStatusForInvoice'), source.indexOf('function actionLabelForInvoice'));
  const labelBlock = source.slice(source.indexOf('function actionLabelForInvoice'), source.indexOf('function canMarkInvoiceRejected'));
  const pairs = (block) => [...block.matchAll(/case "([a-z_]+)":\s*return "([^"]+)";/g)].map((match) => [match[1], match[2]]);
  const next = new Map(pairs(nextBlock));
  const labels = new Map(pairs(labelBlock));
  assert.ok(next.size >= 4, 'the control\'s source still has its four forward moves');
  for (const status of job.award.statuses.all) {
    const move = lib.offeredMove(status, job);
    if (!next.has(status)) {
      assert.strictEqual(move, null, `the product offers no forward move from ${status}`);
      continue;
    }
    assert.deepStrictEqual(move, { status: next.get(status), control: labels.get(status) }, `from ${status}`);
  }
});

test('the definition\'s fixed paths are held to the product\'s control (INV-2 and INV-2A skip internal review)', () => {
  assert.deepStrictEqual(lib.productPathTo('draft', 'submitted', job).map((move) => move.status), ['internal_review', 'submitted']);
  assert.deepStrictEqual(lib.productPathTo('submitted', 'paid', job).map((move) => move.control), ['Mark approved for payment', 'Mark paid']);
  assert.throws(() => lib.productPathTo('paid', 'submitted', job), /offers no move from paid/);
  const gaps = lib.pathGaps(job);
  assert.deepStrictEqual(gaps.map((gap) => `${gap.number} ${gap.from}->${gap.to} via ${gap.product.join(',')}`), [
    'INV-2 draft->submitted via internal_review,submitted',
    'INV-2A draft->submitted via internal_review,submitted',
  ]);
  const onePath = structuredClone(job);
  for (const request of onePath.award.fixed.requests) request.path = request.path.flatMap((status, index) => (index === 1 && status === 'submitted' ? ['internal_review', 'submitted'] : [status]));
  assert.deepStrictEqual(lib.pathGaps(onePath), [], 'a definition whose paths step one status at a time has no gap');
});

test('the SS4A catalog name the journey tracks is the catalog\'s own', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'lib', 'grants', 'programs', 'us-federal.ts'), 'utf8');
  const entry = /key: "ss4a",\s*name: "([^"]+)"/.exec(source);
  assert.ok(entry, 'the catalog still lists ss4a with a name');
  assert.strictEqual(lib.CATALOG_NAMES.ss4a, entry[1]);
  assert.strictEqual((job.journeyFields.find((rule) => rule.field === 'award.catalogKey') || {}).equals, 'ss4a');
});

// ---------------------------------------------------------------------------
// Money and the screens
// ---------------------------------------------------------------------------

test('money is read and printed in whole cents', () => {
  assert.strictEqual(lib.cents('105000.00'), 10500000);
  assert.strictEqual(lib.money(10500000), '105000.00');
  assert.strictEqual(lib.printed(10500000), '$105,000.00');
  assert.strictEqual(lib.printed(-50), '-$0.50');
  assert.throws(() => lib.cents('105000'), /not dollars and cents/);
  assert.throws(() => lib.cents(105000), /not dollars and cents/);
});

test('every synthetic screen reading equals the position the journey recomputes at its time', () => {
  for (const journey of example().journeys) {
    for (const reading of journey.screenReadings) {
      assert.deepStrictEqual(lib.screenFigureDifferences(reading, lib.positionAt(journey, reading.at, job), job), [], `${journey.role} ${reading.screen} at ${reading.at}`);
    }
    const changed = structuredClone(journey.screenReadings[0]);
    changed.figures.paidNet = '$0.00';
    assert.deepStrictEqual(lib.screenFigureDifferences(changed, lib.positionAt(journey, changed.at, job), job), [{ figure: 'paidNet', read: '$0.00', expected: '$60,000.00' }]);
  }
});

test('the readers take each figure from the words the product prints beside it', () => {
  const fundingRow = [
    'Partial', 'Active', 'No risk flag', 'Plumas County SS4A planning award (Demonstration by an automated OpenPlan proof run)',
    'Awarded $200,000.00 · Match $50,000.00 (partial) · Reimbursed $60,000.00 · Outstanding $45,000.00 · Obligation Not set · Safe Streets and Roads for All (SS4A)',
    'Obligated on 2026-03-31',
    'Claim progress: recorded award ceiling $200,000.00 · claimed $105,000.00 gross · paid $60,000.00 net · $95,000.00 not yet claimed',
    'Download worksheet (PDF)', 'Linked invoice chain', '3 linked invoice records totaling $105,000.00 net requested. $45,000.00 rejected, not counted.',
  ].join('\n');
  assert.deepStrictEqual(lib.readFundingTabFigures(fundingRow), { ceiling: '$200,000.00', match: '$50,000.00', claimedGross: '$105,000.00', paidNet: '$60,000.00', outstandingNet: '$45,000.00', rejectedGross: '$45,000.00', remaining: '$95,000.00' });
  assert.strictEqual(lib.readFundingTabFigures(fundingRow.replace(/ \$45,000\.00 rejected, not counted\./, '')).rejectedGross, null, 'a figure the row does not print is null, never zero');
  const grants = 'Plumas County safety and walking improvements\nRecorded award ceilings $200,000.00\nMatch $50,000.00\nRequested $105,000.00\nPaid $60,000.00\nOutstanding $45,000.00\nUninvoiced $95,000.00';
  assert.deepStrictEqual(lib.readGrantsAwardsFigures(grants), { ceiling: '$200,000.00', match: '$50,000.00', claimedGross: '$105,000.00', paidNet: '$60,000.00', outstandingNet: '$45,000.00' });
  const register = 'Records\n4\n1 draft, 1 in review or payment flow.\nNet requested\n$105,000.00\nClaimed from funders: in review, submitted, approved, or paid. 1 draft and 1 rejected record are excluded, holding $45,000.00 the funder refused.\nOutstanding\n$45,000.00\nSubmitted, internal-review, or approved-for-payment net amount.\nPaid\n$60,000.00\n0 overdue invoice record(s) still need attention.';
  assert.deepStrictEqual(lib.readRegisterFigures(register), { claimedGross: '$105,000.00', outstandingNet: '$45,000.00', paidNet: '$60,000.00', rejectedGross: '$45,000.00' });
  assert.deepStrictEqual(lib.readDashboardFigures('Awarded\n$200,000\n53% drawn'), { awardedWhole: '$200,000', drawnPercent: '53%' });
  assert.deepStrictEqual(lib.readDashboardFigures('Awarded\n$200,000.00\n53% drawn').awardedWhole, null, 'a whole-dollar figure with cents is not the dashboard\'s form');
  assert.strictEqual(lib.readRegisterFigures(register.replace('Net requested\n$105,000.00', 'Net requested\nNot recorded')).claimedGross, 'Not recorded');
});

// ---------------------------------------------------------------------------
// The database's custody
// ---------------------------------------------------------------------------

test('a direct write counts as refused only by the database\'s status and code together, or by no row for a listed account', () => {
  const row = (fields) => ({ account: 'owner', target: 'award-closure-columns', status: 400, code: '23514', rowsChanged: 0, ...fields });
  assert.strictEqual(lib.custodyRefused(row({}), job), true);
  assert.strictEqual(lib.custodyRefused(row({ status: 403, code: '42501' }), job), true);
  assert.strictEqual(lib.custodyRefused(row({ status: 400, code: '42501' }), job), false, 'a status paired with another refusal\'s code');
  assert.strictEqual(lib.custodyRefused(row({ status: 401, code: null }), job), false, 'a request with no session');
  assert.strictEqual(lib.custodyRefused(row({ status: 200, code: null }), job), false, 'the owner\'s 200 is a write that went through');
  assert.strictEqual(lib.custodyRefused(row({ status: 204, code: null }), job), false);
  assert.strictEqual(lib.custodyRefused(row({ account: 'member', target: 'paid-request-amount', status: 200, code: null }), job), true, 'row security hides the request from the member');
  assert.strictEqual(lib.custodyRefused(row({ account: 'member', target: 'paid-request-amount', status: 200, code: null, rowsChanged: 1 }), job), false, 'a row changed');
  assert.strictEqual(lib.custodyRefused(row({ account: 'member', target: 'award-closure-columns', status: 200, code: null }), job), false, 'the member can see the award, so 200 is a write');
  assert.strictEqual(lib.custodyRefused(row({ rowsChanged: 1 }), job), false);
});

test('a custody row records the status the database answered, never a reading of it', () => {
  const unchanged = [{ id: 'a', amount: 60000 }];
  const refused = lib.custodyRow({ account: 'owner', target: 'paid-request-amount', response: { status: 400, text: JSON.stringify({ code: '23514', message: 'fixed once it leaves draft' }) }, before: unchanged, after: unchanged });
  assert.deepStrictEqual(refused, { account: 'owner', target: 'paid-request-amount', status: 400, code: '23514', rowsChanged: 0, unchangedOnReadBack: true });
  const wrote = lib.custodyRow({ account: 'owner', target: 'paid-request-amount', response: { status: 200, text: JSON.stringify([{ id: 'a', amount: 1 }]) }, before: unchanged, after: [{ id: 'a', amount: 1 }] });
  assert.deepStrictEqual(wrote, { account: 'owner', target: 'paid-request-amount', status: 200, code: null, rowsChanged: 1, unchangedOnReadBack: false });
  assert.strictEqual(lib.custodyRefused(wrote, job), false, 'a 200 can never be recorded as a refusal');
  const hidden = lib.custodyRow({ account: 'member', target: 'paid-request-amount', response: { status: 200, text: '[]' }, before: unchanged, after: unchanged });
  assert.deepStrictEqual(hidden, { account: 'member', target: 'paid-request-amount', status: 200, code: null, rowsChanged: 0, unchangedOnReadBack: true });
  assert.strictEqual(lib.custodyRefused(hidden, job), true);
  const noSession = lib.custodyRow({ account: 'owner', target: 'award-closure-columns', response: { status: 401, text: '{"code":"PGRST301"}' }, before: unchanged, after: unchanged });
  assert.strictEqual(lib.custodyRefused(noSession, job), false);
});

// ---------------------------------------------------------------------------
// The run file
// ---------------------------------------------------------------------------

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'award-journey-'));
}

const SESSION_JWT = `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(30)}.${'c'.repeat(30)}`;

test('the run file never holds an address, a token, a key, an invitation link or a password', () => {
  const dir = tempDir();
  const write = (result, secrets = []) => lib.writeAwardRunFile({ outDir: dir, role: 'county', result: { baseUrl: LOCAL_ORIGIN, ...result }, scrub: (text) => text, secrets });
  const written = write({ note: 'clean' });
  assert.strictEqual(JSON.parse(fs.readFileSync(written.runFile, 'utf8')).note, 'clean');
  assert.throws(() => write({ note: 'owner a@openplan.test' }), /would hold an email address/);
  assert.throws(() => write({ note: `token ${SESSION_JWT}` }), /would hold a key, a session token or an invitation link/);
  assert.throws(() => write({ note: 'key sb_publishable_ABCDEFGHijklmnop' }), /would hold a key/);
  assert.throws(() => write({ note: 'key sb_secret_ABCDEFGHijklmnop' }), /would hold a key/);
  assert.throws(() => write({ note: 'header Bearer abcdefghijklmnopqrstu' }), /would hold a key/);
  assert.throws(() => write({ note: 'link http://localhost:3590/invitations/AbCdEfGhIjKlMnOpQrSt' }), /invitation link/);
  assert.throws(() => write({ note: 'password Jr-secret-value-1' }, ['Jr-secret-value-1']), /would hold 1 of the run's secrets/);
  assert.ok(!fs.existsSync(path.join(dir, 'public-address.txt')), 'the job opens no public page, so no address file is written');
});

test('the run file\'s journey has the record\'s fields and no other', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas', 'proven_job_record.v1.schema.json'), 'utf8'));
  const required = schema.$defs.awardJourney.required.filter((field) => !['mode', 'harness'].includes(field));
  const synthetic = example().journeys[0];
  const built = lib.buildAwardJourney({ ...synthetic, extra: 'never written' });
  assert.deepStrictEqual(Object.keys(built).sort(), [...required].sort());
  for (const field of required) assert.deepStrictEqual(built[field], synthetic[field], field);
});

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** One run file per synthetic journey, written as a finished proof run would be. */
function syntheticRuns(dir, change = () => {}) {
  const record = example();
  return record.journeys.map((journey) => {
    const { mode, harness, ...rest } = journey;
    const own = (entries) => entries.filter((entry) => entry.journey === journey.role).map(({ journey: role, ...entry }) => entry);
    const run = {
      schema: 'openplan.award_job_journey_run.v1',
      jobId: lib.JOB_ID,
      mode,
      baseUrl: PROOF_ORIGIN,
      expectedCommit: record.commit,
      harness,
      stoppedAt: null,
      journey: rest,
      crossWorkspace: { checks: own(record.crossWorkspace.checks), ownerChecks: own(record.crossWorkspace.ownerChecks), secondAccounts: own(record.crossWorkspace.secondAccounts) },
    };
    change(run);
    const file = path.join(dir, `journey-${journey.role}.json`);
    fs.writeFileSync(file, JSON.stringify(run));
    return file;
  });
}

const assemble = (files, extra = {}) => lib.assembleAwardRecord({ journeyFiles: files, commit: example().commit, baseUrl: PROOF_ORIGIN, recordedOn: '2026-11-20', proofOrigin: PROOF_ORIGIN, job, ...extra });

test('three finished proof runs assemble into the record the checker reads, limits in the definition\'s words', () => {
  const record = example();
  const assembled = assemble(syntheticRuns(tempDir()));
  assert.deepStrictEqual(assembled.journeys, record.journeys);
  assert.deepStrictEqual(assembled.crossWorkspace, record.crossWorkspace);
  assert.deepStrictEqual(assembled.limits, record.limits);
  assert.deepStrictEqual(assembled.limits.map((entry) => entry.id), job.requiredLimits, 'exactly the required limits, in order; no other id (limitIdsClosed)');
  assert.ok(assembled.limits.some((entry) => entry.id === 'who-acted-is-the-journeys-word' && entry.text === job.limitTexts['who-acted-is-the-journeys-word']));
  const reordered = syntheticRuns(tempDir()).reverse();
  assert.deepStrictEqual(assemble(reordered).journeys.map((journey) => journey.role), ['county', 'city', 'tribal-area'], 'journeys go in the definition\'s order');
  const pageOk = assemble(syntheticRuns(tempDir(), (run) => {
    const page = run.crossWorkspace.checks.find((check) => check.kind === 'page');
    Object.assign(page, { status: 200, notFoundRendered: true, recordTextFound: false });
  }));
  assert.deepStrictEqual(pageOk.limits.at(-1), { id: job.crossWorkspace.pageAnsweredOkLimit, text: job.limitTexts[job.crossWorkspace.pageAnsweredOkLimit] });
});

test('the assembler refuses a run that is not a finished proof run on the record\'s origin and commit', () => {
  const refuses = (change, pattern) => assert.throws(() => assemble(syntheticRuns(tempDir(), change)), pattern);
  refuses((run) => { run.mode = 'rehearsal'; }, /is a rehearsal run; a record on the proof origin takes proof runs only/);
  refuses((run) => { run.stoppedAt = 'close-out'; }, /stopped at close-out; an unfinished run cannot go into a record/);
  refuses((run) => { run.baseUrl = LOCAL_ORIGIN; }, /ran on http:\/\/localhost:3590, not the record's/);
  refuses((run) => { run.expectedCommit = 'b'.repeat(40); }, /expected commit b+, not the record's/);
  refuses((run) => { run.expectedCommit = null; }, /named no expected commit/);
  refuses((run) => { run.jobId = 'california-atp-application-in-three-places'; }, /is a run of california-atp-application-in-three-places/);
  refuses((run) => { delete run.harness; }, /names no harness checkout/);
  refuses((run) => { run.harness.clean = false; }, /uncommitted changes; a proof runs from a clean checkout/);
  refuses((run) => { run.journey.pdfs = run.journey.pdfs.slice(0, 1); }, /holds the PDFs worksheet-open; this job's journey holds worksheet-open, worksheet-closed/);
  refuses((run) => { run.crossWorkspace.checks[0].journey = run.journey.role === 'county' ? 'city' : 'county'; }, /named for the (city|county) journey, not its own/);
  refuses((run) => { run.journey.projectName = 'One project name for all (Demonstration by an automated OpenPlan proof run)'; }, /name the same project/);
  const dir = tempDir();
  const files = syntheticRuns(dir);
  assert.throws(() => assemble([files[0], files[0], files[1]]), /Two run files are the county journey/);
  assert.throws(() => assemble(files.slice(0, 2)), /No run file is the tribal-area journey/);
  assert.throws(() => assemble(files, { commit: 'abc' }), /40-character commit/);
  assert.throws(() => assemble(files, { proofOrigin: '' }), /proof origin/);
});
