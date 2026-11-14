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

test('the journey keeps exactly the record fields lane 10 defines', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'proven_job_record.v1.schema.json'), 'utf8'));
  const journey = lib.buildJourney({ role: 'x', extra: 'dropped' });
  assert.deepEqual(Object.keys(journey).sort(), [...schema.$defs.journey.required].sort());
});
