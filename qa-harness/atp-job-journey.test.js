// Unit tests for the ATP application journey helpers. No browser, no server.
// Run: node --test atp-job-journey.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const lib = require('./atp-job-journey-lib');
const first = require('./first-job-journey-lib');
const { repoRoot } = require('./harness-env');
// The synthetic application pages the checker's own tests read (a text stand-in for a PDF).
const synthetic = require('../openplan/src/test/fixtures/proven-job-atp-application.mjs');

const job = lib.loadJobDefinition();
const rule = job.application;
const fixture = () => JSON.parse(fs.readFileSync(lib.REHEARSAL_INPUTS_PATH, 'utf8'));
const example = () => JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas', 'examples', 'proven_job_record.v1.atp-application.synthetic.json'), 'utf8'));
const COUNTY_RUN = { role: 'county', placeKind: 'county', placeQuery: 'Trinity County, CA' };
const PROOF_ORIGIN = 'https://openplan-zeta.vercel.app';
const LOCAL_ORIGIN = 'http://localhost:3530';

const BASE_ARGS = ['--base-url', LOCAL_ORIGIN, '--mode', 'rehearsal', '--place-query', 'Trinity County, CA', '--place-kind', 'county', '--role', 'county', '--email', 'a@openplan.test', '--second-email', 'b@openplan.test', '--out', 'runs/x'];
const withArg = (key, value) => {
  const args = [...BASE_ARGS];
  const at = args.indexOf(key);
  if (at >= 0) args[at + 1] = value;
  else args.push(key, value);
  return args;
};
/** The fixture with its rehearsal label and synthetic source taken out: inputs a proof would not refuse for being rehearsal text. */
const unlabel = (inputs) => {
  inputs.rehearsal = false;
  const strip = (value) => value.split(lib.REHEARSAL_LABEL).join('').replace(/ {2,}/g, ' ');
  inputs.label = strip(inputs.label);
  for (const section of Object.values(inputs.sections)) section.text = strip(section.text);
  inputs.facts[0].source = 'California Transportation Commission, 2027 ATP Guidelines, read as published';
};
/** The fixture with one change, checked in a mode. In proof mode the change is made to the unlabeled fixture, unless `raw`. */
const validate = (change, mode = 'rehearsal', { raw = false, ...options } = {}) => {
  const inputs = fixture();
  if (mode === 'proof' && !raw) unlabel(inputs);
  change(inputs);
  return lib.validateAtpInputs(inputs, mode, { job, today: '2026-11-16', ...options });
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

test('arguments: the role and place kind must be a journey this job defines', () => {
  assert.equal(lib.parseAtpArgs(BASE_ARGS, job).role, 'county');
  assert.equal(lib.parseAtpArgs(withArg('--role', 'tribal-area').map((value) => (value === 'county' ? 'aiannh' : value)), job).placeKind, 'aiannh');
  assert.throws(() => lib.parseAtpArgs(withArg('--role', 'nevada-county'), job), /--role must be one of county, city, tribal-area/);
  assert.throws(() => lib.parseAtpArgs(withArg('--role', 'city'), job), /city journey needs --place-kind city/);
  assert.throws(() => lib.parseAtpArgs(withArg('--place-kind', 'cdp'), job), /county journey needs --place-kind county/);
});

test('arguments: a confirmation link is never an argument, and a proof names everything it ran with', () => {
  assert.throws(() => lib.parseAtpArgs([...BASE_ARGS, '--confirm-link', 'http://localhost/verify?token=x'], job), /never taken as an argument/);
  assert.throws(() => lib.parseAtpArgs(withArg('--mode', 'proof'), job), /proof run needs --inputs, --expected-commit, --confirm-link-file, --second-confirm-link-file, --executor-agent, --executor-model/);
  const proof = [...withArg('--mode', 'proof'), '--inputs', 'x.json', '--expected-commit', 'a'.repeat(40), '--confirm-link-file', 'one.link', '--second-confirm-link-file', 'two.link', '--executor-agent', 'Claude Code'];
  assert.throws(() => lib.parseAtpArgs(proof, job), /proof run needs --executor-model/);
  assert.equal(lib.parseAtpArgs([...proof, '--executor-model', 'claude-fable-5-2'], job).expectedCommit, 'a'.repeat(40));
  assert.throws(() => lib.parseAtpArgs([...BASE_ARGS, '--expected-commit', 'abc123'], job), /40-character commit/);
  assert.throws(() => lib.parseAtpArgs(withArg('--second-email', 'a@openplan.test'), job), /must differ/);
  assert.throws(() => lib.parseAtpArgs(withArg('--mode', 'demo'), job), /--mode must be one of/);
  assert.throws(() => lib.parseAtpArgs(BASE_ARGS.slice(0, -2), job), /Missing required arguments: --out/);
});

test('the origin rule is the other journeys\': rehearsal only on a local origin, proof only on the hosted proof origin', () => {
  assert.equal(first.checkJourneyOrigin('rehearsal', LOCAL_ORIGIN, PROOF_ORIGIN), LOCAL_ORIGIN);
  assert.throws(() => first.checkJourneyOrigin('rehearsal', PROOF_ORIGIN, PROOF_ORIGIN));
  assert.throws(() => first.checkJourneyOrigin('proof', LOCAL_ORIGIN, PROOF_ORIGIN));
  assert.equal(first.checkJourneyOrigin('proof', PROOF_ORIGIN, PROOF_ORIGIN), PROOF_ORIGIN);
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

test('inputs: the rehearsal fixture loads in rehearsal and is refused in proof', () => {
  const loaded = lib.loadAtpInputs('rehearsal', null, { job, run: COUNTY_RUN });
  assert.equal(Object.keys(loaded.inputs.sections).length, 10);
  assert.match(loaded.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => lib.loadAtpInputs('proof', lib.REHEARSAL_INPUTS_PATH, { job }), /labeled "Rehearsal inputs for the ATP application journey/);
  assert.throws(() => lib.loadAtpInputs('proof', null, { job }), /proof run needs --inputs/);
  assert.throws(() => validate((inputs) => { inputs.rehearsal = false; }, 'proof', { raw: true }), /labeled/, 'the label text alone refuses it');
  assert.throws(() => validate((inputs) => { inputs.rehearsal = true; }, 'proof'), /labeled/, 'the flag alone refuses it');
  // With the label gone from every string, the same file is still refused for its synthetic fact.
  assert.throws(() => validate((inputs) => { inputs.facts[0].source = 'Synthetic rehearsal fact'; }, 'proof'), /sourced as synthetic or rehearsal/);
  assert.doesNotThrow(() => validate(() => {}, 'proof'));
});

test('inputs: sections are exactly the template\'s ten, in both modes', () => {
  for (const mode of ['rehearsal', 'proof']) {
    assert.throws(() => validate((inputs) => { inputs.sections['project-narrative'] = { text: 'x' }; }, mode), /sections names project-narrative, which the 2027 template does not have/, mode);
    assert.throws(() => validate((inputs) => { delete inputs.sections['atp-2027-b6-conservation-corps']; }, mode), /sections is missing atp-2027-b6-conservation-corps/, mode);
  }
  assert.throws(() => validate((inputs) => { inputs.sections['atp-2027-part-a5-project-funding'].text = '  '; }), /sections.atp-2027-part-a5-project-funding has no text/);
  assert.throws(() => validate((inputs) => { delete inputs.sections; }), /needs sections/);
});

test('inputs: every section opens with the demonstration sentence, in both modes', () => {
  const key = 'atp-2027-b2-walking-biking-rolling';
  for (const mode of ['rehearsal', 'proof']) {
    // No label at all.
    assert.throws(() => validate((inputs) => { inputs.sections[key].text = 'Trinity County did not prepare this text.\n\nMore people would walk.'; }, mode), new RegExp(`sections.${key} must begin with "Demonstration by an automated OpenPlan proof run"`), mode);
    // The label later in the text, not at its start.
    assert.throws(() => validate((inputs) => { inputs.sections[key].text = `More people would walk.\n\n${inputs.sections[key].text}`; }, mode), /must begin with "Demonstration by an automated OpenPlan proof run"/, mode);
    // The label, but no sentence that the agency did not prepare it.
    assert.throws(() => validate((inputs) => { inputs.sections[key].text = 'Demonstration by an automated OpenPlan proof run. Written for a test.\n\nMore people would walk.'; }, mode), /must say in its opening sentences that the named agency or tribe did not prepare it/, mode);
  }
  // Both wordings the proof inputs use are accepted.
  for (const opening of ['The City of Yreka did not prepare, review, adopt or submit this text.', 'No tribal government prepared, reviewed, adopted or submitted this text.']) {
    assert.doesNotThrow(() => lib.assertDemonstrationSentence(`Demonstration by an automated OpenPlan proof run. ${opening}\n\nBody.`, 'x', job));
  }
  // The sentence must be in the opening, not further down.
  assert.throws(() => lib.assertDemonstrationSentence('Demonstration by an automated OpenPlan proof run.\n\nThe County did not prepare this.', 'x', job), /did not prepare it/);
});

test('inputs: the fixed note is in the two sections the definition names and in no other', () => {
  const fixedKeys = rule.sections.list.filter((section) => section.disposition === 'fixed-note').map((section) => section.key);
  assert.deepEqual(fixedKeys, ['atp-2027-b5-scope-plan-layout-consistency', 'atp-2027-b7-past-performance']);
  assert.throws(() => validate((inputs) => { inputs.sections[fixedKeys[0]].text = inputs.sections[fixedKeys[0]].text.replace(rule.sections.fixedNote, 'Nothing to add.'); }), /must hold the fixed note "The application asks no question here\."/);
  assert.throws(() => validate((inputs) => { inputs.sections['atp-2027-b6-conservation-corps'].text += ` ${rule.sections.fixedNote}`; }), /holds the fixed note .* but the application asks a question there/);
  assert.throws(() => validate((inputs) => { inputs.sections['atp-2027-b6-conservation-corps'].text = inputs.sections['atp-2027-b6-conservation-corps'].text.split('\n\n')[0]; }), /says nothing after its opening/);
});

test('inputs: no text the PDF prints holds an email address, a [VERIFY] marker, a placeholder or words the checker refuses', () => {
  const key = 'atp-2027-b3-fatalities-and-injuries';
  const cases = [
    ['Write to planner@example.org for the data.', /holds an email address/],
    ['The count is 12 [VERIFY].', /holds a \[VERIFY\] marker/],
    ['The count is [VERIFY: source].', /holds a \[VERIFY\] marker/],
    ['[OPERATOR: enter the corridor limits]', /holds a placeholder/],
    ['Project limits TBD.', /holds a placeholder/],
    ['The cost estimate is to be provided by the engineer.', /holds a placeholder/],
    ['[Insert project location]', /holds a placeholder/],
    ['This is a DRAFT answer.', /holds the word DRAFT/],
    ['Study place: Another County, CA (county, GEOID 06089)', /holds "Study place:"/],
    ['Applicant not entered in OpenPlan', /holds "Applicant not entered in OpenPlan"/],
    ['The project is eligible for ATP funding.', /holds "is eligible for", which the job refuses/],
    ['The community qualifies as a disadvantaged community.', /which the job refuses anywhere in the PDF/],
    ['A Census tribal area is not a finding that the project is located within federally recognized Tribal Lands.', /which only OpenPlan prints/],
    ['CTC score: 85', /holds a number after a label ending in score, scores, points/],
    ['Total points: 92', /holds a number after a label ending in/],
    ['Applicant', /leaves "Applicant" alone on a line/],
    ['Lead agency:', /leaves "Lead agency:" alone on a line/],
    ['Implementing agency name:', /leaves "Implementing agency name:" alone on a line/],
    ['Attachment checklist', /one of the PDF's own headings/],
    ['Appendix B. Crash summary', /one of the PDF's own headings/],
  ];
  for (const [added, reason] of cases) {
    for (const mode of ['rehearsal', 'proof']) {
      assert.throws(() => validate((inputs) => { inputs.sections[key].text += `\n\n${added}`; }, mode), reason, `${mode}: ${added}`);
    }
  }
  assert.throws(() => validate((inputs) => { inputs.checklist['partnering-agency-letter-of-intent'].reason = 'Ask planner@example.org about the partner.'; }), /checklist.partnering-agency-letter-of-intent.reason holds an email address/);
  assert.throws(() => validate((inputs) => { inputs.projectName += ' [VERIFY]'; }), /projectName holds a \[VERIFY\] marker/);
  assert.throws(() => validate((inputs) => { inputs.projectSummary += ' Contact planner@example.org.'; }), /holds an email address/);
  // The same words inside a sentence are a planner's own text, not a box.
  assert.doesNotThrow(() => validate((inputs) => { inputs.sections[key].text += '\n\nAn applicant would name its lead agency and any implementing agency here.'; }));
  // The product's own disclaimers are worded to stay outside the refused list, and so is honest demonstration text.
  assert.doesNotThrow(() => validate((inputs) => { inputs.sections[key].text += '\n\nThis demonstration makes no statement that a project meets any screening criterion, and OpenPlan does not decide ATP eligibility.'; }));
});

test('inputs: names carry the demonstration label and no applicant label', () => {
  assert.throws(() => validate((inputs) => { inputs.projectName = 'Trinity County walking and biking connections'; }), /projectName must say "Demonstration by an automated OpenPlan proof run"/);
  assert.throws(() => validate((inputs) => { inputs.organization = 'Trinity County Department of Transportation'; }), /organization must be a demonstration name/);
  assert.throws(() => validate((inputs) => { inputs.organization = 'Lead agency demonstration workspace'; }), /organization holds the words "Lead agency"/);
  // Review 79: the word draft in a name is refused in any letter case.
  for (const word of ['Draft', 'draft', 'DRAFT']) {
    assert.throws(() => validate((inputs) => { inputs.projectName += ` (${word} two)`; }), /projectName holds the word "draft"/, word);
    assert.throws(() => validate((inputs) => { inputs.organization += ` ${word}`; }), /organization holds the word "draft"/, word);
  }
  assert.doesNotThrow(() => validate((inputs) => { inputs.projectName += ' on Drafthorse Road'; }));
  assert.throws(() => validate((inputs) => { delete inputs.secondOrganization; }), /needs secondOrganization/);
  assert.throws(() => validate((inputs) => { inputs.secondOrganization = `${inputs.organization} two`; }), /contains the first workspace name/);
  assert.throws(() => validate((inputs) => { inputs.applicationType = 'large'; }), /Small Infrastructure application only/);
});

test('inputs: written for one place, never typed under another\'s name', () => {
  assert.doesNotThrow(() => validate(() => {}, 'rehearsal', { run: COUNTY_RUN }));
  assert.throws(() => validate(() => {}, 'rehearsal', { run: { role: 'city', placeKind: 'city', placeQuery: 'Yreka, CA' } }), /written for role "county", but the run was started with "city"/);
  assert.throws(() => validate(() => {}, 'rehearsal', { run: { ...COUNTY_RUN, placeQuery: 'Shasta County, CA' } }), /written for placeQuery "Trinity County, CA", but the run was started with "Shasta County, CA"/);
});

test('inputs: every checklist row of the template has a disposition, and nothing is attached', () => {
  assert.equal(lib.checklistPlan(fixture(), job).length, 26);
  assert.throws(() => validate((inputs) => { inputs.checklist['location-vicinity-map'] = { disposition: 'outstanding' }; }), /checklist names location-vicinity-map, which the 2027 template does not have/);
  assert.throws(() => validate((inputs) => { delete inputs.checklist['signature-page']; }), /checklist has no entry for signature-page/);
  assert.throws(() => validate((inputs) => { inputs.checklist['signature-page'] = { disposition: 'attached' }; }), /checklist.signature-page is attached; an agent-run journey attaches no stand-in document/);
  assert.throws(() => validate((inputs) => { inputs.checklist['signature-page'] = { disposition: 'done' }; }), /needs the disposition outstanding or not-applicable/);
  assert.throws(() => validate((inputs) => { inputs.checklist['signature-page'] = { disposition: 'not-applicable', reason: 'The demonstration has no signatory at all.' }; }), /marked not applicable, but the template requires it of every application/);
  for (const reason of [undefined, '', '   ', 'Too short.']) {
    assert.throws(() => validate((inputs) => { inputs.checklist['railroad-and-agency-letters'] = { disposition: 'not-applicable', reason }; }), /marked not applicable without a reason of at least 20 characters/, String(reason));
  }
  assert.throws(() => validate((inputs) => { inputs.checklist['signature-page'].reason = 'No signatory was asked to sign anything.'; }), /left outstanding, so it takes no reason/);
});

test('inputs: the count the DRAFT stamp must show is the count the dispositions give', () => {
  assert.equal(lib.outstandingRequiredCount(lib.checklistPlan(fixture(), job), job), 17);
  assert.throws(() => validate((inputs) => { inputs.requiredAttachmentsOutstanding = 16; }), /requiredAttachmentsOutstanding is 16, but the checklist dispositions leave 17/);
  assert.throws(() => validate((inputs) => { delete inputs.requiredAttachmentsOutstanding; }), /needs requiredAttachmentsOutstanding/);
  // One more row marked not applicable changes the count the inputs must state.
  const oneMore = (inputs) => { inputs.checklist['railroad-and-agency-letters'] = { disposition: 'not-applicable', reason: 'The demonstration crosses no railroad.' }; };
  assert.throws(() => validate(oneMore), /requiredAttachmentsOutstanding is 17, but the checklist dispositions leave 16/);
  assert.doesNotThrow(() => validate((inputs) => { oneMore(inputs); inputs.requiredAttachmentsOutstanding = 16; }));
  // The optional row is never counted.
  const rows = lib.checklistPlan(fixture(), job);
  assert.equal(rows.find((row) => row.key === 'additional-attachments').requirement, 'optional');
  assert.equal(lib.outstandingRequiredCount(rows.filter((row) => row.key === 'additional-attachments'), job), 0);
});

test('inputs: every fact has a statement, a source and the date it was read', () => {
  assert.throws(() => validate((inputs) => { inputs.facts = []; }), /needs at least one fact/);
  assert.throws(() => validate((inputs) => { delete inputs.facts[0].source; }), /Fact rehearsal-crash-source needs source/);
  assert.throws(() => validate((inputs) => { inputs.facts[0].readOn = '2026-11-17'; }), /readOn as the calendar date it was read, not after 2026-11-16/);
});

// ---------------------------------------------------------------------------
// The study place
// ---------------------------------------------------------------------------

const HOOPA = { kind: 'aiannh', geoid: '1490R', label: 'Hoopa Valley Reservation, CA', stateFips: '06' };

test('study place: the tribal area\'s Census states must be exactly California, by its state code and by its label', () => {
  assert.deepEqual(lib.placeStatesListed(HOOPA), { stateFips: ['06'], labelStates: ['CA'] });
  assert.deepEqual(lib.assertPlaceForRole(HOOPA, 'tribal-area', job), ['06']);
  // The search gives no state code for a tribal area in several states.
  const mojave = { kind: 'aiannh', geoid: '1235R', label: 'Fort Mojave Reservation, AZ-CA-NV', stateFips: null };
  assert.deepEqual(lib.placeStatesListed(mojave), { stateFips: [], labelStates: ['AZ', 'CA', 'NV'] });
  assert.throws(() => lib.assertPlaceForRole(mojave, 'tribal-area', job), /lists Fort Mojave Reservation, AZ-CA-NV in more than one state or none; the tribal-area journey's place must lie in exactly 06/);
  // One state, but not California.
  assert.throws(() => lib.assertPlaceForRole({ kind: 'aiannh', geoid: '2400R', label: 'Pyramid Lake Paiute Reservation, NV', stateFips: '32' }, 'tribal-area', job), /in the states with FIPS 32; the tribal-area journey's place must lie in exactly 06/);
  // The state code says California and the label names more states, or another one (review 78, P21 and P22).
  assert.throws(() => lib.assertPlaceForRole({ ...mojave, stateFips: '06' }, 'tribal-area', job), /names AZ, CA, NV; the tribal-area journey's place must name exactly CA/);
  assert.throws(() => lib.assertPlaceForRole({ ...HOOPA, label: 'Hoopa Valley Reservation, OR' }, 'tribal-area', job), /names OR; .* must name exactly CA/);
  assert.throws(() => lib.assertPlaceForRole({ ...HOOPA, label: 'Hoopa Valley Reservation' }, 'tribal-area', job), /names no state/);
  assert.throws(() => lib.assertPlaceForRole({ ...HOOPA, kind: 'county' }, 'tribal-area', job), /needs a place of kind aiannh, found county/);
});

test('study place: the county and the city are in California, by state code and Census id', () => {
  assert.deepEqual(lib.assertPlaceForRole({ kind: 'county', geoid: '06105', label: 'Trinity County, CA', stateFips: '06' }, 'county', job), ['06']);
  assert.deepEqual(lib.assertPlaceForRole({ kind: 'city', geoid: '0686944', label: 'Yreka, CA', stateFips: '06' }, 'city', job), ['06']);
  assert.throws(() => lib.assertPlaceForRole({ kind: 'county', geoid: '32031', label: 'Washoe County, NV', stateFips: '32' }, 'county', job), /is not in the state with FIPS 06/);
  assert.throws(() => lib.assertPlaceForRole({ kind: 'county', geoid: '48455', label: 'Trinity County, TX', stateFips: '06' }, 'county', job), /is not in the state with FIPS 06/);
  assert.throws(() => lib.assertPlaceForRole({ kind: 'cdp', geoid: '0600156', label: 'Acampo, CA', stateFips: '06' }, 'city', job), /needs a place of kind city, found cdp/);
  // The definition's own closing words for the label: a city's saved label once lacked its state (KI-2026-11-16-102).
  assert.equal(job.journeys.find((entry) => entry.role === 'city').labelSuffix, ', CA');
  assert.throws(() => lib.assertPlaceForRole({ kind: 'city', geoid: '0686944', label: 'Yreka', stateFips: '06' }, 'city', job), /The label Yreka does not end with ", CA"/);
});

// ---------------------------------------------------------------------------
// Crashes and the corridor analysis
// ---------------------------------------------------------------------------

test('crashes: the record states the years as the export prints them, and the definition\'s rules stop the journey', () => {
  assert.equal(lib.formatYears([2022, 2023, 2024, 2025]), '2022–2025');
  assert.equal(lib.formatYears([2025, 2022, 2023]), '2022, 2023, 2025');
  assert.equal(lib.formatYears([2024]), '2024');
  const crashes = lib.crashesForRecord({ sourceId: 'ccrs', crashCount: 995, storedCount: 979 }, { years: [2022, 2023, 2024, 2025] });
  assert.deepEqual(crashes, { sourceId: 'ccrs', years: '2022–2025', reportedCount: 995, storedCount: 979 });
  assert.match(crashes.years, /^\d{4}((–|, )\d{4})*$/, 'the schema\'s pattern for the years');
  assert.deepEqual(lib.definitionRefusals({ crashes }, job, { only: 'crashes.' }), []);
  assert.deepEqual(lib.definitionRefusals({ crashes: { ...crashes, sourceId: 'fars-national' } }, job, { only: 'crashes.' }), ['crashes come from fars-national, not ccrs, California\'s crash file']);
  assert.deepEqual(lib.definitionRefusals({ crashes: { ...crashes, storedCount: 0 } }, job, { only: 'crashes.' }), ['stored 0 crashes; every journey of this job stores at least 1']);
  assert.throws(() => lib.crashesForRecord({ sourceId: 'ccrs', crashCount: 995, storedCount: 979 }, null), /names no years/);
  assert.throws(() => lib.crashesForRecord({ sourceId: 'ccrs', storedCount: 979 }, { years: [2024] }), /did not report how many crashes/);
  // The rules review 78 added: at least one crash reported, and no more stored than reported.
  assert.deepEqual(lib.definitionRefusals({ crashes: { ...crashes, reportedCount: 0, storedCount: 0 } }, job, { only: 'crashes.' }), [
    'stored 0 crashes; every journey of this job stores at least 1',
    'reports 0 crashes; every journey of this job reports at least 1, and the crash appendix prints that count',
  ]);
  assert.deepEqual(lib.definitionRefusals({ crashes: { ...crashes, storedCount: 5000 } }, job, { only: 'crashes.' }), ['stored 5000 crashes, more than the 995 the source reported']);
});

test('crashes: the journey\'s own stop reads the name of California\'s crash file from the definition', () => {
  const crashes = { sourceId: 'ccrs-ca', years: '2022–2025', reportedCount: 995, storedCount: 979 };
  const CCRS = 'California Crash Reporting System (CCRS)';
  assert.equal(lib.californiaCrashFileName(job), CCRS);
  assert.doesNotThrow(() => lib.assertCaliforniaCrashFile({ sourceLabel: CCRS }, crashes, job));
  assert.throws(() => lib.assertCaliforniaCrashFile({ sourceLabel: 'Fatality Analysis Reporting System (FARS)' }, crashes, job), /come from "Fatality Analysis Reporting System \(FARS\)", not "California Crash Reporting System \(CCRS\)"/);
  assert.throws(() => lib.assertCaliforniaCrashFile({ sourceLabel: null }, crashes, job), /come from "a source with no name"/);
  assert.throws(() => lib.assertCaliforniaCrashFile({ sourceLabel: CCRS }, { ...crashes, storedCount: 0 }, job), /stored 0 crashes/);
  assert.throws(() => lib.assertCaliforniaCrashFile({ sourceLabel: CCRS }, { ...crashes, storedCount: 996 }, job), /stored 996 crashes but reported 995/);
  // The product's id for that file is not the one the definition asks for (KI-2026-11-16-100). The journey writes what the product says.
  assert.deepEqual(lib.definitionRefusals({ crashes }, job, { only: 'crashes.sourceId' }), ['crashes come from ccrs-ca, not ccrs, California\'s crash file']);
});

test('a rehearsal journey is told what the checker would refuse: its mode, and nothing it could have met', () => {
  const journey = { ...example().journeys[0], mode: 'rehearsal' };
  assert.deepEqual(lib.definitionRefusals(journey, job), ['ran in rehearsal mode; only a proof run is proof']);
  assert.deepEqual(lib.definitionRefusals({ ...journey, mode: 'proof' }, job), []);
  assert.deepEqual(lib.definitionRefusals({ ...journey, mode: 'proof', confirmationMethod: 'not_required' }, job, { only: 'confirmationMethod' }), ['confirmed its account by not_required; this job\'s journey confirms only by the emailed link (email_link)']);
});

test('tract data: the run\'s own record gives one of three readings', () => {
  const census = { dataset: 'ACS 5-Year', vintage: 2023, tractCount: 4 };
  assert.equal(lib.tractDataReading({ sourceSnapshots: { census }, dataQuality: { censusAvailable: true } }).state, 'retrieved');
  assert.equal(lib.tractDataReading({ sourceSnapshots: { census: { ...census, tractCount: 0 } }, dataQuality: { censusAvailable: false } }).state, 'none-retrieved');
  assert.deepEqual(lib.tractDataReading({ sourceSnapshots: {}, dataQuality: { censusAvailable: true } }), { state: 'not-recorded', censusRecordStored: false, tractCount: null });
  assert.equal(lib.tractDataReading({ sourceSnapshots: { census } }).state, 'not-recorded');
  assert.equal(lib.tractDataReading(null).state, 'not-recorded');
});

// ---------------------------------------------------------------------------
// The checklist and the DRAFT stamp
// ---------------------------------------------------------------------------

const screenRows = (plan) => plan.map((row) => ({ key: row.key, status: row.disposition === 'not-applicable' ? 'not_applicable' : 'missing', note: row.reason || '', attached: false }));

test('checklist: the record states what the application screen shows, row by row', () => {
  const plan = lib.checklistPlan(fixture(), job);
  const rows = lib.rowsFromScreen(screenRows(plan), plan);
  assert.equal(rows.length, 26);
  assert.deepEqual(rows[0], { key: 'partnering-agency-letter-of-intent', disposition: 'not-applicable', reason: 'The rehearsal names no partnering agency.' });
  assert.deepEqual(rows[4], { key: 'project-programming-request', disposition: 'outstanding' });
  assert.equal(lib.outstandingRequiredCount(rows, job), 17);
  const changed = (index, change) => screenRows(plan).map((row, at) => (at === index ? { ...row, ...change } : row));
  assert.throws(() => lib.rowsFromScreen(screenRows(plan).slice(1), plan), /lists 25 checklist rows; the 2027 template has 26/);
  assert.throws(() => lib.rowsFromScreen(changed(4, { key: 'signature-page' }), plan), /row 5 on screen is signature-page; the template's is project-programming-request/);
  assert.throws(() => lib.rowsFromScreen(changed(4, { status: 'not_applicable' }), plan), /project-programming-request reads not-applicable on screen; the inputs give it outstanding/);
  assert.throws(() => lib.rowsFromScreen(changed(0, { status: 'missing' }), plan), /reads outstanding on screen; the inputs give it not-applicable/);
  assert.throws(() => lib.rowsFromScreen(changed(0, { note: 'Another reason entirely.' }), plan), /its note on screen is not the reason the inputs give/);
  assert.throws(() => lib.rowsFromScreen(changed(16, { status: 'attached' }), plan), /signature-page has a document attached; the journey attaches nothing/);
  assert.throws(() => lib.rowsFromScreen(changed(16, { attached: true }), plan), /has a document attached/);
  assert.throws(() => lib.rowsFromScreen(changed(16, { status: 'waived' }), plan), /shows the status waived/);
});

test('DRAFT stamp: the count is read from each surface and must be one number everywhere', () => {
  assert.equal(lib.draftStampCount('Will be stamped DRAFT: 17 required attachment(s) outstanding', job), 17);
  assert.equal(lib.draftStampCount('Stamped DRAFT: 1,234 required attachment(s) outstanding', job), 1234);
  assert.equal(lib.draftStampCount('DRAFT: 2 unverified item(s) in final sections', job), null);
  assert.equal(lib.draftStampCount('', job), null);
  const agreeing = { 'the inputs file': 17, 'the checklist rows on screen': 17, 'the export panel': 17, 'the export\'s answer': 17, 'the PDF': 17 };
  assert.doesNotThrow(() => lib.assertDraftCountAgrees(17, agreeing));
  for (const surface of Object.keys(agreeing)) {
    assert.throws(() => lib.assertDraftCountAgrees(17, { ...agreeing, [surface]: 16 }), new RegExp(`must count 17 required attachment\\(s\\) outstanding everywhere, but ${surface.replace(/'/g, '\'')} says 16`), surface);
    assert.throws(() => lib.assertDraftCountAgrees(17, { ...agreeing, [surface]: null }), new RegExp(`${surface} shows no DRAFT stamp`), surface);
  }
});

// ---------------------------------------------------------------------------
// The application PDF, read back
// ---------------------------------------------------------------------------

/** One journey of the synthetic example, as the journey's own state holds it when it reads its PDF. */
const journeyState = (role) => example().journeys.find((entry) => entry.role === role);
const pagesOf = (journey) => synthetic.syntheticApplicationPages(journey, job);
const problemsOf = (pages, journey) => lib.readApplicationPdf({ pages, job, journey }).problems;
const replaceIn = (pages, from, to) => {
  assert.ok(pages.some((page) => page.includes(from)), `the synthetic pages hold "${from}"`);
  return pages.map((page) => page.split(from).join(to));
};

test('PDF read-back: the three synthetic applications read as the job requires, with the appendix pages the record lists', () => {
  for (const role of ['county', 'city', 'tribal-area']) {
    const journey = journeyState(role);
    const reading = lib.readApplicationPdf({ pages: pagesOf(journey), job, journey });
    assert.deepEqual(reading.problems, [], role);
    assert.equal(reading.stampCount, journey.application.outstandingRequiredCount, role);
    assert.deepEqual(reading.items, example().journeys.find((entry) => entry.role === role).pdfs[0].items, role);
    assert.ok(reading.readings.length > 60, `${role}: ${reading.readings.length} readings`);
  }
});

test('PDF read-back: what the brief lists is each refused when the PDF does not say it', () => {
  const county = journeyState('county');
  const pages = pagesOf(county);
  const cases = [
    ['the study place line names another place', replaceIn(pages, 'Study place: Synthetic County, CA', 'Study place: Another County, CA'), /the cover states "Study place: Synthetic County, CA \(county, GEOID 06998\)"/],
    ['the applicant line is gone', replaceIn(pages, rule.applicant.line, 'Applicant: Synthetic County'), /the cover prints "Applicant not entered in OpenPlan"/],
    ['the program is another', replaceIn(pages, 'Program: Active Transportation Program (ATP)', 'Program: Safe Streets and Roads for All'), /states "Program: Active Transportation Program \(ATP\)"/],
    ['a section title is gone', replaceIn(pages, 'Part A5: Project funding', 'Funding'), /the section title "Part A5: Project funding" is a heading exactly once \(found 0\)/],
    ['an appendix heading is gone', replaceIn(pages, 'Appendix C. Cost estimate', 'Cost estimate'), /the heading "Appendix C. Cost estimate" is a line of its own exactly once/],
    ['a placeholder is printed', replaceIn(pages, 'Planning-level estimate: USD 1,850,000.00', 'Planning-level estimate: to be provided'), /the PDF does not print "to be provided"/],
    ['the crash source is another file', replaceIn(pages, 'Source: California Crash Reporting System (CCRS)', 'Source: Fatality Analysis Reporting System (FARS)'), /states "Source: California Crash Reporting System \(CCRS\)"/],
    ['the crash count is another', replaceIn(pages, 'Crashes reported: 1,234', 'Crashes reported: 1,233'), /states "Crashes reported: 1,234"/],
    ['a score is printed under another label', replaceIn(pages, 'Safety, OpenPlan screening score (not a CTC score): 80.0', 'Safety score: 80.0'), /a score is printed under another label/],
    ['a section is not final', replaceIn(pages, 'An agency would write its own answer here.', `${rule.sections.notFinal} drafting.`), /is final/],
    ['a section does not open with the label', replaceIn(pages, `${rule.demonstrationLabel.text}. This synthetic text`, 'This synthetic text'), /begins with the demonstration label/],
    ['the fallback writer typeset it', replaceIn(pages, 'OPENPLAN GRANTS: APPLICATION PACKET', `OPENPLAN GRANTS: APPLICATION PACKET\n${rule.fallbackWriter.notice}`), /printed by the browser engine/],
    ['a document is attached', replaceIn(pages, 'Evidence appendices', 'Attached for Signature Page: demonstration.pdf\n\nEvidence appendices'), /prints no "Attached for" line/],
    ['a tribal sentence is in the county PDF', replaceIn(pages, 'Crashes mapped: 1,230', `Crashes mapped: 1,230\n\n${rule.appendices.roleFacts[0].phrase}`), /does not carry the missing-reports sentence, which only the tribal-area journey's PDF prints/],
  ];
  for (const [name, changed, reason] of cases) {
    const problems = problemsOf(changed, county);
    assert.ok(problems.length > 0 && problems.some((problem) => reason.test(problem)), `${name}: ${JSON.stringify(problems)}`);
  }
  // The tribal area's PDF must carry both sentences.
  const tribal = journeyState('tribal-area');
  for (const fact of rule.appendices.roleFacts) {
    assert.ok(problemsOf(replaceIn(pagesOf(tribal), fact.phrase, 'Nothing more is noted here.'), tribal).some((problem) => problem.includes(`carries ${fact.name}`)), fact.name);
  }
});

test('PDF read-back: the DRAFT stamp must be on the cover with the journey\'s count, and no other DRAFT line', () => {
  const county = journeyState('county');
  const pages = pagesOf(county);
  const other = replaceIn(pages, 'DRAFT: 15 required attachment(s) outstanding', 'DRAFT: 14 required attachment(s) outstanding');
  const reading = lib.readApplicationPdf({ pages: other, job, journey: county });
  assert.equal(reading.stampCount, 14);
  assert.ok(reading.problems.some((problem) => /the stamp counts 15 \(the PDF's says 14\)/.test(problem)), JSON.stringify(reading.problems));
  assert.throws(() => lib.assertDraftCountAgrees(15, { 'the PDF': reading.stampCount }), /the PDF says 14/);
  const none = lib.readApplicationPdf({ pages: replaceIn(pages, 'DRAFT: 15 required attachment(s) outstanding', ''), job, journey: county });
  assert.equal(none.stampCount, null);
  assert.ok(none.problems.some((problem) => /every line that holds the word DRAFT is that stamp/.test(problem)));
  const second = problemsOf(replaceIn(pages, 'Planning-level estimate: USD 1,850,000.00', 'DRAFT: 2 unverified item(s) in final sections'), county);
  assert.ok(second.some((problem) => /every line that holds the word DRAFT is that stamp/.test(problem)), JSON.stringify(second));
});

test('PDF read-back: a count is a whole value, and a title that crosses a page is still one heading', () => {
  const county = journeyState('county');
  // Review 78, K24: the record says 1 crash reported and the PDF says 1,234.
  const one = { ...county, crashes: { ...county.crashes, reportedCount: 1 } };
  assert.ok(problemsOf(pagesOf(county), one).some((problem) => /states "Crashes reported: 1"/.test(problem)));
  // K20: the PDF's years go on after the record's.
  const longer = replaceIn(pagesOf(county), 'Years requested: 2022–2025', 'Years requested: 2022–2025, 2027');
  assert.ok(problemsOf(longer, county).some((problem) => /states "Years requested: 2022–2025"/.test(problem)));
  // A wrapped title split by a page break, as review 78 printed it with the product's own export.
  const pages = pagesOf(county);
  const title = rule.sections.list[5].title;
  const firstWords = title.split(' ').slice(0, 4).join(' ');
  const at = pages.findIndex((page) => page.includes(firstWords));
  assert.ok(at >= 0);
  const lines = pages[at].split('\n');
  const line = lines.findIndex((entry) => entry.includes(firstWords));
  const footer = (page) => `${' '.repeat(60)}Active Transportation Program (ATP) · Page ${page} of ${pages.length + 1}`;
  const split = [
    ...pages.slice(0, at),
    [...lines.slice(0, line + 1), '', footer(at + 1)].join('\n'),
    [...lines.slice(line + 1, -1), footer(at + 2)].join('\n'),
    ...pages.slice(at + 1),
  ];
  const reading = lib.readApplicationPdf({ pages: split, job, journey: county });
  assert.deepEqual(reading.problems.filter((problem) => /section title/.test(problem)), []);
});

test('PDF read-back: each tract data reading has its own sentence, and a PDF that prints another reading\'s is refused', () => {
  const county = journeyState('county');
  const states = Object.keys(rule.appendices.equity.values);
  assert.deepEqual(states, ['retrieved', 'none-retrieved', 'not-recorded']);
  const withState = (state) => ({ ...county, application: { ...county.application, tractData: state } });
  for (const printed of states) {
    const pages = pagesOf(withState(printed));
    for (const stated of states) {
      const problems = problemsOf(pages, withState(stated));
      if (stated === printed) assert.deepEqual(problems, [], `${printed} read as itself`);
      else assert.ok(problems.some((problem) => /Appendix E\. .* (says|does not say) what belongs to a run where/.test(problem)), `a ${printed} PDF read as ${stated}: ${JSON.stringify(problems)}`);
    }
  }
  assert.ok(problemsOf(pagesOf(county), withState('some')).some((problem) => /is one the definition knows/.test(problem)));
});

test('PDF read-back: the rules review 78 added are read here too', () => {
  const county = journeyState('county');
  const pages = pagesOf(county);
  const tribalRow = 'Guidelines criterion, Native American Tribal Lands: Not recorded in OpenPlan';
  const cases = [
    ['the county PDF prints the tribal area\'s row', replaceIn(pages, tribalRow, 'Guidelines criterion, Native American Tribal Lands: The study place is a Census\ntribal area: Synthetic Reservation, CA'), /states "Guidelines criterion, Native American Tribal Lands: Not recorded in OpenPlan" as a line of its own/],
    ['a second criterion row with a value', replaceIn(pages, tribalRow, `${tribalRow}\n\nGuidelines criterion, CalEnviroScreen: Yes`), /prints a "Guidelines criterion," row the job does not expect: "Guidelines criterion, CalEnviroScreen: Yes"/],
    ['more words after the place line', replaceIn(pages, 'Study place: Synthetic County, CA (county, GEOID 06998)', 'Study place: Synthetic County, CA (county, GEOID 06998) and Another County'), /is the journey's place line and nothing more/],
    ['the workspace box relabeled', replaceIn(pages, '  WORKSPACE\n', '  LEAD AGENCY\n'), /prints a box labeled "LEAD AGENCY"/],
    ['a refused phrase with two spaces inside it', replaceIn(pages, 'An agency would write its own answer here.', 'The project is  eligible for funding.'), /does not print "is eligible for"/],
  ];
  for (const [name, changed, reason] of cases) {
    const problems = problemsOf(changed, county);
    assert.ok(problems.some((problem) => reason.test(problem)), `${name}: ${JSON.stringify(problems)}`);
  }
});

// ---------------------------------------------------------------------------
// The run file
// ---------------------------------------------------------------------------

test('run file: the journey is in the shape the record schema gives an application journey', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas', 'proven_job_record.v1.schema.json'), 'utf8')).$defs.applicationJourney;
  const source = journeyState('county');
  const journey = lib.buildAtpJourney(source);
  // The assembler adds the run's mode and harness; everything else the schema requires is here, and nothing it does not define.
  const required = schema.required.filter((key) => !['mode', 'harness'].includes(key));
  assert.deepEqual(Object.keys(journey).sort(), [...required].sort());
  for (const key of Object.keys(journey)) assert.ok(Object.hasOwn(schema.properties, key), key);
  assert.deepEqual(Object.keys(journey.application).sort(), [...schema.properties.application.required].sort());
  assert.equal(journey.application.tractData, 'none-retrieved');
  assert.deepEqual(schema.properties.application.properties.tractData.enum, ['retrieved', 'none-retrieved', 'not-recorded'], 'the three readings tractDataReading gives');
});

test('project page check: the strings searched are the record\'s own names, byte for byte', () => {
  const names = { projectName: 'Yreka ATP rehearsal. Demonstration by an automated OpenPlan proof run', workspaceName: 'OpenPlan rehearsal, Yreka ATP demonstration', projectSummary: 'A summary.' };
  const strings = lib.identifyingStrings(names);
  assert.deepEqual(strings, [names.projectName, names.workspaceName, names.projectSummary]);
  assert.ok(strings.length >= job.crossWorkspace.minSearchedStrings);
  const reading = first.readPageForRecord({ text: 'We could not find that page.', html: '<h1>We could not find that page.</h1>', strings });
  for (const field of job.crossWorkspace.searchedStringFields) {
    assert.ok(reading.searchedStringSha256.includes(first.sha256(Buffer.from(names[field], 'utf8'))), field);
  }
  assert.equal(reading.notFoundRendered, true);
  assert.equal(reading.recordTextFound, false);
  // A page that shows the first account's project name, in another letter case, is found.
  assert.equal(first.readPageForRecord({ text: names.projectName.toUpperCase(), html: '', strings }).recordTextFound, true);
  assert.deepEqual(lib.identifyingStrings({ projectName: 'A', workspaceName: 'A', projectSummary: '  ' }), ['A']);
});

const SECRETS = ['Jr-0123456789abcdefghijklmn', 'Jr-zyxwvutsrqponmlkjihgfed', 'owner@openplan.test', 'second@openplan.test', 'http://127.0.0.1:58531/auth/v1/verify?token=pkce_0123456789abcdef&type=signup'];
const runResult = (extra = {}) => ({ schema: 'openplan.atp_job_journey_run.v1', jobId: lib.JOB_ID, mode: 'rehearsal', baseUrl: LOCAL_ORIGIN, steps: [], ...extra });

test('run file: the public address rule does not apply, because the job has no campaign', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atp-run-'));
  const written = lib.writeAtpRunFile({ outDir: dir, role: 'county', result: runResult(), scrub: (text) => first.scrubText(text, SECRETS), secrets: SECRETS });
  assert.equal(written.addressFile, null, 'no public address file is written');
  assert.deepEqual(fs.readdirSync(dir), ['journey-county.json']);
  assert.equal(JSON.parse(fs.readFileSync(written.runFile, 'utf8')).jobId, lib.JOB_ID);
  // The job opens no public page: these are the requests the journey stops on.
  for (const [url, method] of [[`${LOCAL_ORIGIN}/engage/abcdefghijklmnop`, 'GET'], [`${LOCAL_ORIGIN}/api/engage/abcdefghijklmnop/submit`, 'POST'], [`${LOCAL_ORIGIN}/api/engagement/campaigns/1/share-token`, 'POST'], [`${LOCAL_ORIGIN}/api/engagement/campaigns`, 'POST']]) {
    assert.equal(lib.isPublicPageRequest(url, method), true, `${method} ${url}`);
  }
  for (const [url, method] of [[`${LOCAL_ORIGIN}/api/engagement/campaigns`, 'GET'], [`${LOCAL_ORIGIN}/grants?tab=opportunities`, 'GET'], [`${LOCAL_ORIGIN}/api/funding-opportunities/1/application/export`, 'POST'], ['not a url', 'GET']]) {
    assert.equal(lib.isPublicPageRequest(url, method), false, `${method} ${url}`);
  }
  // A run file that somehow held a public portal address is still refused by the shared writer.
  assert.throws(() => lib.writeAtpRunFile({ outDir: dir, role: 'city', result: runResult({ findings: [{ text: 'see /engage/abcdefghijklmnopqrstuvwxyz12' }] }), scrub: (text) => text }), /would hold a campaign's public address/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('run file: it never holds an address, a token or a password', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atp-run-'));
  const leaky = runResult({
    steps: [{ step: 'sign-up', error: `Sign-up refused for ${SECRETS[2]} with password ${SECRETS[0]}` }],
    findings: [{ text: `The link ${SECRETS[4]} was opened; the second account is ${SECRETS[3]}.` }],
    note: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl',
  });
  // Scrubbed by the journey's own scrubber, the file is written and holds none of them.
  const written = lib.writeAtpRunFile({ outDir: dir, role: 'county', result: leaky, scrub: (text) => first.scrubText(text, SECRETS), secrets: SECRETS });
  const text = fs.readFileSync(written.runFile, 'utf8');
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, 'a secret is in the run file');
  assert.equal(/@openplan\.test|pkce_|eyJhbGci|Jr-/.test(text), false);
  // With no scrubbing, each kind refuses the file, and nothing is written.
  const raw = (result, secrets = []) => () => lib.writeAtpRunFile({ outDir: dir, role: 'city', result, scrub: (value) => value, secrets });
  assert.throws(raw(runResult({ note: SECRETS[0] }), SECRETS), /would hold 1 of the run's secrets/);
  assert.throws(raw(runResult({ note: 'ask someone@example.org' })), /would hold an email address/);
  assert.throws(raw(runResult({ note: leaky.note })), /would hold a token/);
  assert.equal(fs.existsSync(path.join(dir, 'journey-city.json')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The assembler
// ---------------------------------------------------------------------------

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** The synthetic example taken apart into three run files, as three finished proof runs would have written them. */
function exampleRunFiles(dir, change = () => {}) {
  const record = example();
  return record.journeys.map((journey) => {
    const { mode, harness, ...rest } = journey;
    const forRole = (entries) => entries.filter((entry) => entry.journey === journey.role).map((entry) => {
      const { journey: named, ...own } = entry;
      assert.equal(named, journey.role);
      return own;
    });
    const run = {
      schema: 'openplan.atp_job_journey_run.v1',
      jobId: lib.JOB_ID,
      mode,
      baseUrl: record.baseUrl,
      expectedCommit: record.commit,
      harness: { ...harness },
      stoppedAt: null,
      journey: rest,
      crossWorkspace: { checks: forRole(record.crossWorkspace.checks), ownerChecks: forRole(record.crossWorkspace.ownerChecks), secondAccounts: forRole(record.crossWorkspace.secondAccounts) },
    };
    change(run);
    const file = path.join(dir, `journey-${journey.role}.json`);
    fs.writeFileSync(file, JSON.stringify(run));
    return file;
  });
}
const assemble = (journeyFiles, options = {}) => lib.assembleAtpRecord({ journeyFiles, commit: COMMIT, baseUrl: PROOF_ORIGIN, recordedOn: '2026-11-20', proofOrigin: PROOF_ORIGIN, job, ...options });

test('assembler: three finished proof runs make the record the checker accepts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atp-assemble-'));
  const record = assemble(exampleRunFiles(dir));
  const wanted = example();
  // The example adds one limit of its own that says it is synthetic; everything else is the same record.
  assert.deepEqual(record, { ...wanted, limits: wanted.limits.filter((limit) => limit.id !== 'synthetic-example') });
  assert.deepEqual(record.limits.map((limit) => limit.id), [...job.requiredLimits, job.crossWorkspace.pageAnsweredOkLimit]);
  for (const limit of record.limits) assert.equal(limit.text, job.limitTexts[limit.id], limit.id);

  // The record checker, on the synthetic files the record names.
  const checker = await import(pathToFileURL(path.join(repoRoot, 'openplan', 'scripts', 'ops', 'capability-evidence.mjs')).href);
  for (const journey of wanted.journeys) {
    const file = path.join(dir, journey.pdfs[0].path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, synthetic.syntheticApplicationPdfText(journey, job));
  }
  const readPdfPages = (absolutePath) => synthetic.syntheticPdfPages(fs.readFileSync(absolutePath, 'utf8'));
  assert.doesNotThrow(() => checker.validateProvenJobRecord(record, { repoRoot: dir, readPdfPages }));
  // The checker could have refused: the same record with one run's mode changed is refused for it.
  const rehearsed = { ...record, journeys: record.journeys.map((journey, index) => (index === 1 ? { ...journey, mode: 'rehearsal' } : journey)) };
  assert.throws(() => checker.validateProvenJobRecord(rehearsed, { repoRoot: dir, readPdfPages }), /city journey ran in rehearsal mode; only a proof run is proof/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('assembler: a run that is not a finished proof run on the record\'s origin and commit is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atp-assemble-'));
  const onlyCity = (change) => (run) => { if (run.journey.role === 'city') change(run); };
  const cases = [
    ['a rehearsal run', onlyCity((run) => { run.mode = 'rehearsal'; }), /journey-city.json is a rehearsal run; a record on the proof origin takes proof runs only/],
    ['a run on another origin', onlyCity((run) => { run.baseUrl = LOCAL_ORIGIN; }), /journey-city.json ran on http:\/\/localhost:3530, not the record's https:\/\/openplan-zeta.vercel.app/],
    ['a run that stopped', onlyCity((run) => { run.stoppedAt = 'export-application-pdf'; }), /journey-city.json stopped at export-application-pdf; an unfinished run cannot go into a record/],
    ['a run that named another commit', onlyCity((run) => { run.expectedCommit = 'f'.repeat(40); }), /journey-city.json expected commit f{40}, not the record's/],
    ['a run that named no commit', onlyCity((run) => { run.expectedCommit = null; }), /named no expected commit/],
    ['a run of another job', onlyCity((run) => { run.jobId = 'engagement-campaign-review-and-response-in-three-places'; }), /journey-city.json is a run of engagement-campaign-review-and-response-in-three-places, not california-atp-application-in-three-places/],
    ['a run from a checkout with changes', onlyCity((run) => { run.harness.clean = false; }), /ran from a harness checkout with uncommitted changes/],
    ['a run that names no harness checkout', onlyCity((run) => { delete run.harness; }), /names no harness checkout/],
    ['a run with no exported PDF', onlyCity((run) => { run.journey.pdfs = []; }), /holds no exported application PDF/],
    ['a check named for another journey', onlyCity((run) => { run.crossWorkspace.checks[0].journey = 'county'; }), /holds a cross-workspace check named for the county journey, not its own city/],
    ['an owner check named for another journey', onlyCity((run) => { run.crossWorkspace.ownerChecks[0].journey = 'county'; }), /holds an owner check named for the county journey/],
    ['a second account named for another journey', onlyCity((run) => { run.crossWorkspace.secondAccounts[0].journey = 'tribal-area'; }), /holds a second account entry named for the tribal-area journey/],
    ['one role twice', onlyCity((run) => { run.journey.role = 'county'; }), /Two run files are the county journey/],
    ['one project name in two journeys', (run) => { if (run.journey.role !== 'tribal-area') run.journey.projectName = 'One project (Demonstration by an automated OpenPlan proof run)'; }, /the city and county journeys name the same project/],
    ['one workspace name in two journeys', (run) => { if (run.journey.role !== 'county') run.journey.workspaceName = 'One demonstration workspace'; }, /the tribal-area and city journeys name the same workspace/],
  ];
  for (const [name, change, reason] of cases) assert.throws(() => assemble(exampleRunFiles(dir, change)), reason, name);
  assert.throws(() => assemble(exampleRunFiles(dir), { proofOrigin: '' }), /needs the checker's proof origin/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('assembler: three rehearsal runs assemble under their own local origin, carrying their mode, and names files from a root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atp-assemble-'));
  const files = exampleRunFiles(dir, (run) => {
    run.mode = 'rehearsal';
    run.baseUrl = LOCAL_ORIGIN;
    run.expectedCommit = null;
    run.harness.clean = false;
    run.journey.pdfs[0].path = `downloads/${run.journey.role}-atp-application.pdf`;
  });
  const record = assemble(files, { baseUrl: `${LOCAL_ORIGIN}/`, root: path.dirname(dir) });
  assert.equal(record.baseUrl, LOCAL_ORIGIN, 'the origin, not the argument as typed');
  assert.deepEqual(record.journeys.map((journey) => journey.mode), ['rehearsal', 'rehearsal', 'rehearsal']);
  assert.deepEqual(record.journeys.map((journey) => journey.harness.clean), [false, false, false]);
  assert.equal(record.journeys[0].pdfs[0].path, `${path.basename(dir)}/downloads/county-atp-application.pdf`);
  assert.deepEqual(record.crossWorkspace.ownerChecks.map((check) => check.journey), ['county', 'county', 'city', 'city', 'tribal-area', 'tribal-area']);
  fs.rmSync(dir, { recursive: true, force: true });
});
