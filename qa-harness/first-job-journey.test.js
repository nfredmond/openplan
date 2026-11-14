// Unit tests for the first-job journey helpers. No browser, no server.
// Run: node --test first-job-journey.test.js (needs Poppler for the PDF tests).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./first-job-journey-lib');
const { buildMinimalPdf } = require('./fixtures/minimal-pdf');

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

const { findPdfPhrase, pdfTextHasPhrase } = require('../openplan/scripts/lib/pdf-text-match.mjs');
const poppler = require('../openplan/scripts/lib/poppler-text.mjs');

/** Poppler's own tools on PATH. xpdf's pdftotext (Git Bash on Windows) does not count. */
function hasPoppler() {
  return ['pdftotext', 'pdftoppm'].every((tool) => poppler.pdfToolVersion(tool).poppler);
}

/** A stand-in for spawnSync that answers `-v` the way a given program does. */
function versionStub(output, { missing = false } = {}) {
  return () => (missing ? { error: Object.assign(new Error('spawn pdftotext ENOENT'), { code: 'ENOENT' }) } : { status: 99, stdout: '', stderr: output });
}
const XPDF_VERSION = 'pdftotext version 4.06 [www.xpdfreader.com]\nCopyright 1996-2025 Glyph & Cog, LLC\n';
const POPPLER_VERSION = 'pdftotext version 25.07.0\nCopyright 2005-2025 The Poppler Developers - http://poppler.freedesktop.org\nCopyright 1996-2011, 2022 Glyph & Cog, LLC\n';

test('rehearsal mode runs only on a local origin', async () => {
  const proofOrigin = await lib.loadProofOrigin();
  assert.equal(lib.checkJourneyOrigin('rehearsal', 'http://localhost:3450', proofOrigin), 'http://localhost:3450');
  assert.equal(lib.checkJourneyOrigin('rehearsal', 'http://127.0.0.1:3450/', proofOrigin), 'http://127.0.0.1:3450');
  assert.throws(() => lib.checkJourneyOrigin('rehearsal', proofOrigin, proofOrigin), /refuses Vercel URLs/);
  assert.throws(() => lib.checkJourneyOrigin('rehearsal', 'https://example.com', proofOrigin), /refuses non-local URLs/);
});

test('proof mode runs only on the hosted proof origin', async () => {
  const proofOrigin = await lib.loadProofOrigin();
  assert.match(proofOrigin, /^https:\/\//);
  assert.equal(lib.checkJourneyOrigin('proof', proofOrigin, proofOrigin), new URL(proofOrigin).origin);
  assert.equal(lib.checkJourneyOrigin('proof', `${proofOrigin}/`, proofOrigin), new URL(proofOrigin).origin);
});

test('proof mode refuses a local origin', async () => {
  const proofOrigin = await lib.loadProofOrigin();
  for (const local of ['http://localhost:3450', 'http://127.0.0.1:3450', 'https://localhost', 'http://[::1]:3000', 'http://app.localhost:3000']) {
    assert.throws(() => lib.checkJourneyOrigin('proof', local, proofOrigin), /refuses local URLs for a proof run/, local);
  }
});

test('proof mode refuses a preview, look-alike, plain-http or pathed origin', async () => {
  const proofOrigin = await lib.loadProofOrigin();
  const host = new URL(proofOrigin).hostname;
  assert.throws(() => lib.checkJourneyOrigin('proof', 'https://openplan-git-preview.vercel.app', proofOrigin), /must be the hosted origin/);
  assert.throws(() => lib.checkJourneyOrigin('proof', `https://${host}.example.com`, proofOrigin), /must be the hosted origin/);
  assert.throws(() => lib.checkJourneyOrigin('proof', `http://${host}`, proofOrigin), /must use https/);
  assert.throws(() => lib.checkJourneyOrigin('proof', `${proofOrigin}/dashboard`, proofOrigin), /bare origin/);
  assert.throws(() => lib.checkJourneyOrigin('proof', `${proofOrigin}/?x=1`, proofOrigin), /bare origin/);
  assert.throws(() => lib.checkJourneyOrigin('proof', proofOrigin, 'http://localhost:3000'), /not a hosted https origin/);
  assert.throws(() => lib.checkJourneyOrigin('demo', proofOrigin, proofOrigin), /--mode must be one of/);
});

test('arguments never carry the confirmation link', () => {
  const base = ['--base-url', 'http://localhost:3450', '--mode', 'rehearsal', '--place-query', 'Somewhere', '--place-kind', 'county', '--role', 'california-county', '--email', 'a@openplan.test', '--second-email', 'b@openplan.test', '--out', 'x'];
  assert.equal(lib.parseJourneyArgs(base).placeKind, 'county');
  assert.throws(() => lib.parseJourneyArgs([...base, '--confirm-link', 'http://localhost/x?token=1']), /never taken as an argument/);
  assert.throws(() => lib.parseJourneyArgs([...base, '--token', 'abc']), /never taken as an argument/);
  assert.throws(() => lib.parseJourneyArgs(base.slice(0, -2)), /Missing required arguments: --out/);
  assert.throws(() => lib.parseJourneyArgs(base.map((value) => (value === 'county' ? 'galaxy' : value))), /--place-kind/);
  assert.throws(() => lib.parseJourneyArgs(base.map((value) => (value === 'b@openplan.test' ? 'a@openplan.test' : value))), /must differ/);
});

test('only a SHA-256 of the confirmation token is kept', () => {
  assert.equal(lib.confirmationTokenHash('http://127.0.0.1:58421/auth/v1/verify?token=abc123&type=signup&redirect_to=x'), sha('abc123'));
  assert.equal(lib.confirmationTokenHash(' https://example.org/auth/confirm?token_hash=pkce_99&type=email \n'), sha('pkce_99'));
  assert.notEqual(lib.confirmationTokenHash('http://h/v?token=abc124'), sha('abc123'));
  assert.throws(() => lib.confirmationTokenHash('http://h/verify?type=signup'), /no token/);
  assert.throws(() => lib.confirmationTokenHash('not a link'), /does not hold a URL/);
  assert.throws(() => lib.checkConfirmLinkOrigin('https://evil.example/verify?token=1', ['http://localhost:3450']), /neither the app nor its auth host/);
});

test('captures lose map tokens, auth tokens, cookies and email addresses', () => {
  const mapToken = `pk.eyJ${'a'.repeat(20)}.${'b'.repeat(22)}`;
  const jwt = `eyJ${'x'.repeat(12)}.eyJ${'y'.repeat(12)}.${'z'.repeat(10)}`;
  const raw = [
    `GET https://api.mapbox.com/styles/v1/x?access_token=${mapToken} failed`,
    `bearer header Bearer ${'q'.repeat(30)}`,
    `jwt ${jwt}`,
    'cookie: sb-abcd-auth-token=base64-secret; other=1',
    'sb-lolck-auth-token.0=abcdef',
    'verify?token=123456&type=signup and token_hash=zz99',
    'planner journey-7@openplan.test wrote',
    'private value hunter2-secret-value',
  ].join('\n');
  const clean = lib.scrubText(raw, ['hunter2-secret-value']);
  for (const leaked of [mapToken, jwt, 'base64-secret', '123456', 'zz99', 'journey-7@openplan.test', 'hunter2-secret-value', 'q'.repeat(30), 'abcdef']) {
    assert.ok(!clean.includes(leaked), `scrub left ${leaked}`);
  }
  assert.match(clean, /\[email\]/);
  assert.match(clean, /access_token=\[redacted\]/);
});

test('the axe summary counts serious and critical nodes, and refuses a scan that did not run', () => {
  const results = {
    testEngine: { version: lib.AXE_VERSION },
    violations: [
      { id: 'color-contrast', impact: 'serious', nodes: [{}, {}] },
      { id: 'label', impact: 'critical', nodes: [{}] },
      { id: 'region', impact: 'moderate', nodes: [{}, {}, {}] },
      { id: 'list', impact: 'minor', nodes: [{}] },
    ],
  };
  const summary = lib.summarizeAxe(results);
  assert.deepEqual(summary.axe, { version: lib.AXE_VERSION, tags: lib.AXE_TAGS, serious: 2, critical: 1 });
  assert.deepEqual(summary.rules.map((rule) => rule.id), ['color-contrast', 'label']);
  assert.deepEqual(lib.summarizeAxe({ testEngine: { version: lib.AXE_VERSION }, violations: [] }).axe.serious, 0);
  assert.throws(() => lib.summarizeAxe({}), /did not run/);
  assert.throws(() => lib.summarizeAxe({ testEngine: { version: '4.10.2' }, violations: [] }), /axe 4\.10\.2 ran/);
});

const RED = [180, 35, 24];
const GREY = [82, 99, 111];

/** A four-page report fixture. `drop` removes one item's heading; `noRed` draws the map in grey. */
function reportPages(drop = null, { noRed = false } = {}) {
  const pages = [
    { lines: ['Safety action plan (working)', 'Crash summary', 'Synthetic crash source. Years requested: 2022, 2023.', 'Fatal 5, serious injury 41.'] },
    { lines: ['High-injury network map. All 3 ranked segments are drawn in red.'], rect: { x: 100, y: 200, w: 300, h: 200, rgb: RED } },
    { lines: ['Countermeasures', 'Proposed by staff for review. Not an engineering finding.', 'Enhanced Delineation for Horizontal Curves on State Hwy 49.'] },
    { lines: ['Engagement summary', 'Comments approved: 2.', 'Source: Engagement campaign 1.', 'Benefit-cost summary', 'Benefit-cost ratio 4.2.', 'Source: Saved benefit-cost analysis version 1.'] },
  ];
  const headings = { 'crash-summary': 'Crash summary', 'high-injury-map': 'High-injury network map. All 3 ranked segments are drawn in red.', countermeasures: 'Countermeasures', 'engagement-summary': 'Engagement summary', bca: 'Benefit-cost summary' };
  return pages.map((page) => {
    const lines = page.lines.filter((line) => !(drop && line === headings[drop]));
    if (!page.rect || drop === 'high-injury-map') return { lines };
    return { lines, rect: noRed ? { ...page.rect, rgb: GREY } : page.rect };
  });
}

function writePdf(dir, name, pages) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, buildMinimalPdf(pages));
  return file;
}

function find(kind, file, dir) {
  const pages = lib.pdfPages(file);
  return lib.findPdfItems(kind, pages, (page) => lib.renderPdfPage(file, page, path.join(dir, `${path.basename(file)}-p${page}`)));
}

test('the PDF item finder finds all five items, each on its page', { skip: !hasPoppler() && 'Poppler is not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-pdf-'));
  const file = writePdf(dir, 'all.pdf', reportPages());
  const { items, missing } = find('safety-action-plan', file, dir);
  assert.deepEqual(missing, []);
  assert.deepEqual(items.map((entry) => [entry.item, entry.page, entry.method]), [
    ['high-injury-map', 2, 'page-image'],
    ['crash-summary', 1, 'pdftotext'],
    ['countermeasures', 3, 'pdftotext'],
    ['bca', 4, 'pdftotext'],
    ['engagement-summary', 4, 'pdftotext'],
  ]);
  const map = items.find((entry) => entry.item === 'high-injury-map');
  assert.match(map.imageSha256, /^[0-9a-f]{64}$/);
  assert.ok(map.redPixels > 1000);
});

test('the PDF item finder reports each item missing when its heading is absent', { skip: !hasPoppler() && 'Poppler is not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-pdf-'));
  for (const item of lib.ITEMS) {
    const file = writePdf(dir, `without-${item}.pdf`, reportPages(item));
    const { items, missing } = find('safety-action-plan', file, dir);
    assert.deepEqual(missing.map((entry) => entry.item), [item], `dropping ${item}`);
    assert.ok(!items.some((entry) => entry.item === item));
    assert.equal(items.length, 4);
  }
});

test('a heading printed with "Missing" or a blank map does not count as found', { skip: !hasPoppler() && 'Poppler is not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-pdf-'));
  const pages = reportPages();
  pages[3] = { lines: ['Engagement summary', 'Comments approved: 2.', 'Source: Engagement campaign 1.', 'Benefit-cost summary', 'Missing. No benefit-cost analysis or screening is saved for the linked project.'] };
  const bcaMissing = find('safety-action-plan', writePdf(dir, 'bca-missing.pdf', pages), dir);
  assert.deepEqual(bcaMissing.missing.map((entry) => entry.item), ['bca']);
  assert.match(bcaMissing.missing[0].reason, /"Benefit-cost summary" is followed by an absence word on page 4/);

  const greyMap = reportPages(null, { noRed: true });
  assert.ok(greyMap[1].rect && greyMap[1].rect.rgb === GREY);
  const blank = find('safety-action-plan', writePdf(dir, 'blank-map.pdf', greyMap), dir);
  assert.deepEqual(blank.missing.map((entry) => entry.item), ['high-injury-map']);
  assert.match(blank.missing[0].reason, /highlight-red pixels/);
});

test('the SS4A finder reads the five appendix headings', { skip: !hasPoppler() && 'Poppler is not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-pdf-'));
  const file = writePdf(dir, 'ss4a.pdf', [
    { lines: ['Appendix A. High-injury network map', 'Source: Safety report artifact.'] },
    { lines: ['Ranked segments, numbered by rank.'], rect: { x: 80, y: 150, w: 400, h: 300, rgb: RED } },
    { lines: ['Appendix B. Crash summary', 'California Crash Reporting System (CCRS). Years requested: 2022, 2023.'] },
    { lines: ['Appendix C. Countermeasures', 'Proposed by staff for review.', 'Appendix D. Benefit-cost summary', 'Source: Saved benefit-cost analysis version 1.'] },
    { lines: ['Appendix E. Engagement summary', 'Source: Engagement campaign 1.', 'Prepared by planner@agency.gov'] },
  ]);
  const { items, missing } = find('ss4a-application', file, dir);
  assert.deepEqual(missing, []);
  assert.deepEqual(items.map((entry) => [entry.item, entry.page]), [
    ['high-injury-map', 2],
    ['crash-summary', 3],
    ['countermeasures', 4],
    ['bca', 4],
    ['engagement-summary', 5],
  ]);
  const pages = lib.pdfPages(file);
  const emails = lib.locateEmails(pages);
  assert.deepEqual(emails.map((entry) => entry.page), [5]);
  assert.ok(!emails[0].context.includes('planner@agency.gov'));
  assert.deepEqual(lib.draftPages(pages), []);
  assert.deepEqual(lib.draftPages(['clean', 'Stamped DRAFT here', 'a draft section']), [2]);
});

test('items are found with the shared matcher, so a heading that reads back letter-spaced counts', () => {
  // Linux Chrome and Poppler read a tracked label as single letters, one
  // space apart ("C O M M E N T S A P P R OV E D", KI-2026-11-14-117). The
  // checker's matcher accepts that; the journey must find it the same way.
  const pages = reportPages().map((page) => page.lines.join('\n'));
  pages[0] = 'Safety action plan (working)\n   C R A S H S U M M A R Y\nSynthetic crash source. Years requested: 2022, 2023.';
  const { items, missing } = lib.findPdfItems('safety-action-plan', pages, () => ({ redPixels: 500, imageSha256: 'a'.repeat(64) }));
  assert.deepEqual(missing, []);
  assert.deepEqual(items.find((entry) => entry.item === 'crash-summary'), { item: 'crash-summary', page: 1, method: 'pdftotext', text: 'Crash summary' });
  assert.ok(pdfTextHasPhrase(pages[0], 'Crash summary'));
});

test('the heading words in a table column are not taken for the item', { skip: !hasPoppler() && 'Poppler is not installed' }, () => {
  // Run 9's report printed "Countermeasures" as a ranked-table column on the
  // page before the Countermeasures heading.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-pdf-'));
  const pages = reportPages();
  pages[1] = { lines: ['Rank Location Miles Countermeasures', '1 State Hwy 49 0.50 Lighting', ...pages[1].lines], rect: pages[1].rect };
  const { items } = find('safety-action-plan', writePdf(dir, 'table.pdf', pages), dir);
  assert.equal(items.find((entry) => entry.item === 'countermeasures').page, 3);
  assert.deepEqual(lib.findPdfItems('safety-action-plan', lib.pdfPages(path.join(dir, 'table.pdf')), () => ({ redPixels: 0 })).searches.find((entry) => entry.item === 'countermeasures').headingPages, [2, 3]);
});

test('each recorded item names the phrase searched, and the checker finds it on the recorded page', { skip: !hasPoppler() && 'Poppler is not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-pdf-'));
  const file = writePdf(dir, 'all.pdf', reportPages());
  const pages = lib.pdfPages(file);
  const { items } = find('safety-action-plan', file, dir);
  for (const entry of items.filter((candidate) => candidate.method === 'pdftotext')) {
    assert.equal(entry.text, lib.ITEM_RULES['safety-action-plan'][entry.item].heading);
    assert.ok(pdfTextHasPhrase(pages[entry.page - 1], entry.text), `${entry.item} on page ${entry.page}`);
    assert.equal(findPdfPhrase(pages, entry.text)[0] <= entry.page, true);
  }
});

test('the PDF readers refuse a pdftotext that is not Poppler, and say how to fix PATH', () => {
  const never = () => { throw new Error('read a page with the wrong program'); };
  assert.throws(() => lib.pdfPages('x.pdf', { spawn: versionStub(XPDF_VERSION), execFile: never }), /not Poppler's: it reports "pdftotext version 4\.06 \[www\.xpdfreader\.com\]".*ahead of every other folder on PATH/);
  assert.throws(() => lib.pdfPages('x.pdf', { spawn: versionStub('', { missing: true }), execFile: never }), /pdftotext is not on PATH.*poppler-utils/);
  assert.throws(() => poppler.assertPopplerTool('pdftoppm', { spawn: versionStub(XPDF_VERSION.replace('pdftotext', 'pdftoppm')) }), /pdftoppm on PATH is not Poppler's/);
});

test('the PDF readers accept Poppler and split its output into pages', () => {
  let args = null;
  const execFile = (tool, argv) => { args = [tool, ...argv]; return 'page one\fpage two\f'; };
  assert.deepEqual(lib.pdfPages('x.pdf', { spawn: versionStub(POPPLER_VERSION), execFile }), ['page one', 'page two']);
  assert.deepEqual(args, ['pdftotext', '-layout', '-enc', 'UTF-8', 'x.pdf', '-']);
  assert.equal(poppler.assertPopplerTool('pdftoppm', { spawn: versionStub(POPPLER_VERSION.replace('pdftotext', 'pdftoppm')) }), 'pdftoppm version 25.07.0');
});

test('the cross-workspace page reading finds the not-found screen and any of the first account\'s strings, keeping only hashes', () => {
  const strings = lib.identifyingStrings({ reportTitle: 'Sierra County local roads safety action plan', projectName: 'Sierra County local roads', workspaceName: "O'Brien & Sons Planning", campaignTitle: 'Road safety comments' });
  assert.equal(strings.length, 4);
  const notFound = `<main><h2>${lib.NOT_FOUND_TITLE}</h2></main>`;
  const clean = lib.readPageForRecord({ text: `${lib.NOT_FOUND_TITLE}\nThe web address may have a small mistake in it.`, html: notFound, strings });
  assert.equal(clean.notFoundRendered, true);
  assert.equal(clean.recordTextFound, false);
  assert.deepEqual(clean.searchedStringSha256, strings.map((value) => sha(value)));
  // In the visible text, in another case, across a line break.
  assert.equal(lib.readPageForRecord({ text: `${lib.NOT_FOUND_TITLE}\nSIERRA COUNTY\nlocal roads`, html: notFound, strings }).recordTextFound, true);
  // Only in the HTML: a streamed payload the screen does not show, raw or escaped.
  assert.equal(lib.readPageForRecord({ text: lib.NOT_FOUND_TITLE, html: `${notFound}<script>self.__next_f.push([1,"Road safety comments"])</script>`, strings }).recordTextFound, true);
  assert.equal(lib.readPageForRecord({ text: lib.NOT_FOUND_TITLE, html: `${notFound}<title>O&#x27;Brien &amp; Sons Planning</title>`, strings }).recordTextFound, true);
  // The report page itself is not the not-found screen.
  assert.equal(lib.readPageForRecord({ text: 'Generate PDF packet', html: '<main></main>', strings }).notFoundRendered, false);
});

test('the not-found title the journey looks for is the one the app prints', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openplan', 'src', 'app', 'not-found.tsx'), 'utf8');
  assert.ok(source.includes(`title="${lib.NOT_FOUND_TITLE}"`));
});

test('a page check carries only fields the record schema defines', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'proven_job_record.v1.schema.json'), 'utf8'));
  const allowed = Object.keys(schema.properties.crossWorkspace.properties.checks.items.properties).sort();
  assert.deepEqual(allowed, ['contentReturned', 'kind', 'notFoundRendered', 'recordTextFound', 'request', 'searchedStringCount', 'searchedStringSha256', 'status', 'target']);
  const source = fs.readFileSync(path.join(__dirname, 'first-job-journey.js'), 'utf8');
  for (const key of ['notFoundRendered', 'recordTextFound', 'searchedStringSha256', 'searchedStringCount']) assert.ok(source.includes(`${key}:`), key);
});

test('identifying strings drop blanks and repeats, so the stated count is the count searched', () => {
  assert.deepEqual(lib.identifyingStrings({ reportTitle: null, projectName: ' A ', workspaceName: 'A', campaignTitle: 'B' }), ['A', 'B']);
});

test('an assembled record states the page limit only when a page answered 200', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-assemble-'));
  const write = (name, checks) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify({ journey: { role: name }, crossWorkspace: { checks } }));
    return file;
  };
  const data = { target: 'safety-action-plan', request: 'report-pdf-download', kind: 'data', status: 404, contentReturned: false };
  const base = { jobId: 'job', commit: '0'.repeat(40), baseUrl: 'http://localhost:3450', recordedOn: '2026-11-14', sourceCheck: {}, limits: [{ id: 'no-pdf-ua-check', text: 'x' }] };
  const withPage = lib.assembleRecord({ ...base, journeyFiles: [write('a', [{ target: 'safety-action-plan', request: 'report-page', kind: 'page', status: 200, contentReturned: false }, data])] });
  assert.deepEqual(withPage.limits.map((limit) => limit.id), ['no-pdf-ua-check', 'report-page-answers-200-with-not-found-screen']);
  const without = lib.assembleRecord({ ...base, journeyFiles: [write('b', [{ target: 'safety-action-plan', request: 'report-page', kind: 'page', status: 404, contentReturned: false }, data])] });
  assert.deepEqual(without.limits.map((limit) => limit.id), ['no-pdf-ua-check']);
});

const rehearsalInputs = () => JSON.parse(fs.readFileSync(lib.REHEARSAL_INPUTS_PATH, 'utf8'));

test('the rehearsal inputs say in every section\'s first line that they are rehearsal text, and a proof refuses them', () => {
  const inputs = rehearsalInputs();
  const keys = Object.keys(inputs.sections).sort();
  assert.deepEqual(keys, ['budget-narrative', 'engagement-and-collaboration', 'equity-and-underserved-communities', 'implementation-and-capacity', 'project-overview', 'safety-problem-and-impact']);
  for (const key of keys) assert.equal(inputs.sections[key].text.split('\n')[0], lib.REHEARSAL_LABEL, key);
  assert.equal(lib.loadJourneyInputs('rehearsal', null).file, lib.REHEARSAL_INPUTS_PATH);
  assert.throws(() => lib.loadJourneyInputs('proof', lib.REHEARSAL_INPUTS_PATH), /labeled "Rehearsal text, not an application\." A proof needs sourced/);
  assert.throws(() => lib.loadJourneyInputs('proof', null), /A proof run needs --inputs/);
  // The label anywhere in the file is enough, even with the flag removed.
  const relabeled = rehearsalInputs();
  delete relabeled.rehearsal;
  relabeled.label = 'Sourced inputs.';
  assert.throws(() => lib.validateJourneyInputs(relabeled, 'proof'), /labeled/);
});

test('inputs are refused when their text could not finalize honestly or a fact has no source and date', () => {
  const cases = [
    ['a [VERIFY] marker', (inputs) => { inputs.sections['project-overview'].text += ' Crashes fell [VERIFY].'; }, /project-overview text holds 1 \[VERIFY\] marker/],
    ['a [VERIFY: ...] marker', (inputs) => { inputs.sections['budget-narrative'].text += ' [VERIFY: local match]'; }, /budget-narrative text holds 1 \[VERIFY\]/],
    ['an unfilled placeholder', (inputs) => { inputs.sections['implementation-and-capacity'].text += ' [OPERATOR: name the adopting body]'; }, /1 \[OPERATOR\] placeholder/],
    ['an email address', (inputs) => { inputs.sections['engagement-and-collaboration'].text += ' Contact planner@example.org.'; }, /holds an email address/],
    ['the word DRAFT', (inputs) => { inputs.sections['project-overview'].text += ' DRAFT plan.'; }, /holds the word DRAFT/],
    ['an empty section', (inputs) => { inputs.sections['project-overview'].text = '  '; }, /project-overview has no text/],
    ['a fact without a source', (inputs) => { inputs.facts[0].source = ''; }, /needs source/],
    ['a fact read in the future', (inputs) => { inputs.facts[0].readOn = '2026-12-01'; }, /not after 2026-11-14/],
    ['a fact read on no real date', (inputs) => { inputs.facts[0].readOn = '2026-02-30'; }, /calendar date it was read/],
    ['no facts', (inputs) => { inputs.facts = []; }, /at least one fact/],
    ['a missing field', (inputs) => { delete inputs.comments; }, /missing comments/],
  ];
  for (const [name, mutate, reason] of cases) {
    const inputs = rehearsalInputs();
    mutate(inputs);
    assert.throws(() => lib.validateJourneyInputs(inputs, 'rehearsal', '2026-11-14'), reason, name);
  }
  assert.doesNotThrow(() => lib.validateJourneyInputs(rehearsalInputs(), 'rehearsal', '2026-11-14'));
  // A proof also refuses a fact sourced as synthetic, label or not.
  const proof = rehearsalInputs();
  delete proof.rehearsal;
  proof.label = 'Sourced inputs.';
  for (const key of Object.keys(proof.sections)) proof.sections[key].text = 'Sourced text.';
  assert.throws(() => lib.validateJourneyInputs(proof, 'proof', '2026-11-14'), /sourced as synthetic or rehearsal/);
  proof.facts[0].source = 'U.S. Census Bureau, 2020 Decennial Census, table P1';
  assert.doesNotThrow(() => lib.validateJourneyInputs(proof, 'proof', '2026-11-14'));
});

test('the journey counts markers with the export\'s own patterns', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openplan', 'src', 'lib', 'grants', 'application-draft-stamps.ts'), 'utf8');
  assert.ok(source.includes('const VERIFY_MARKER = /\\[VERIFY(?:\\]|:[^\\]\\n]*\\])/g;'));
  assert.ok(source.includes('const PLACEHOLDER_MARKER = /\\[OPERATOR:[^\\]\\n]*\\]/g;'));
  assert.deepEqual(lib.countMarkers('a [VERIFY] b [VERIFY: x] c [OPERATOR: y] [verify] [VERIFIED]'), { verify: 2, placeholders: 1 });
});

test('the section badge is read as the screen shows it, and no badge is zero', () => {
  assert.deepEqual(lib.parseUnverifiedBadge('Project overview Final 26 unverified items, 1 unfilled placeholder'), { verify: 26, placeholders: 1 });
  assert.deepEqual(lib.parseUnverifiedBadge('Budget narrative Final 1 unverified item'), { verify: 1, placeholders: 0 });
  assert.deepEqual(lib.parseUnverifiedBadge('Budget narrative Final 2 unfilled placeholders'), { verify: 0, placeholders: 2 });
  assert.deepEqual(lib.parseUnverifiedBadge('Budget narrative Final Never AI-drafted'), { verify: 0, placeholders: 0 });
});

test('the provenance table must name a workspace role in each Finalized by cell and print no email address', () => {
  const rows = ['Project overview  Final  Typed  None  Not checked  Workspace owner  Nov 14, 2026', 'Budget narrative  Final  Typed  None  Not checked  Workspace', '                                                      owner'];
  const pages = ['Cover page', `Provenance appendix\n${rows.join('\n')}`, 'Workspace admin  Nov 14, 2026'];
  assert.deepEqual(lib.finalizerCells(pages), { provenancePages: [2, 3], roleCells: 3, emailLines: [] });
  const leaked = [...pages.slice(0, 2), 'Finalized by planner@example.org'];
  assert.deepEqual(lib.finalizerCells(leaked).emailLines, [{ page: 3, line: 1 }]);
  assert.deepEqual(lib.finalizerCells(['no table here']), { provenancePages: [], roleCells: 0, emailLines: [] });
});

test('the journey keeps exactly the record fields lane 10 defines', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'proven_job_record.v1.schema.json'), 'utf8'));
  const journey = lib.buildJourney({ role: 'x', extra: 'dropped' });
  assert.deepEqual(Object.keys(journey).sort(), [...schema.$defs.journey.required].sort());
});
