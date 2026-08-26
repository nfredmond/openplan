/**
 * THE EVIDENCE RULE, TESTED AGAINST FABRICATIONS.
 *
 * Run with `node first-week-evidence.test.js`. No browser, no server, no
 * database, no agent — every fixture here is built on disk in a temp directory
 * and thrown away, because the thing under test is a decision about files.
 *
 * The point of this file is that the discovery layer's whole value rests on one
 * claim: a finding that reaches Nathaniel's screen is supported by its own
 * evidence. If the verifier is soft, the harness is worse than nothing — it
 * launders an agent's guesses into a work-list, and somebody spends a morning
 * chasing a funding tab that was on the page the whole time.
 *
 * So each check below builds a report that a careless agent would plausibly
 * write, and asserts it dies. The flagship is `absentText` — the did-not-scroll
 * case, which is the specific failure this harness was warned about before a
 * line of it existed.
 *
 * WHAT THIS FILE CANNOT PROVE: that the checks fire on a REAL run. A verifier
 * can be perfect and still never see a bad finding. That is what the recorded
 * discard count in every run summary is for.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { readPngSize, verifyFinding, verifyJobReport, loadBrowserDumps } = require('./first-week-evidence');

const BASE_URL = 'http://localhost:3200';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

/** A real, decodable PNG of the given size — not a stub with the right bytes. */
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A page tree shaped like the ones Playwright actually returns, long enough to
 * clear the substance floor. `extra` is where a test slips in the line that
 * decides the case.
 */
function pageSnapshot({ url = `${BASE_URL}/projects`, extra = [] } = {}) {
  return [
    '### Page state',
    `- Page URL: ${url}`,
    '- Page Title: Projects — OpenPlan',
    '- Page Snapshot:',
    '```yaml',
    '- generic [ref=e3]:',
    '  - navigation [ref=e4]:',
    '    - link "Projects" [ref=e5] [cursor=pointer]:',
    '      - /url: /projects',
    '    - link "Public engagement" [ref=e6] [cursor=pointer]:',
    '      - /url: /engagement',
    '  - main [ref=e9]:',
    '    - heading "Projects in this workspace" [level=1] [ref=e10]',
    '    - paragraph [ref=e11]: Every project your team is carrying, with its funding and its analysis.',
    '    - button "Start a new project" [ref=e12] [cursor=pointer]',
    ...extra.map((line) => `    ${line}`),
    '```',
  ].join('\n');
}

function makeRun({ snapshot, screenshot, dumpText }) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-week-evidence-'));
  const agentDir = path.join(runDir, 'agent');
  const browserDir = path.join(runDir, 'browser');
  fs.mkdirSync(path.join(agentDir, 'evidence'), { recursive: true });
  fs.mkdirSync(browserDir, { recursive: true });
  if (snapshot !== null) fs.writeFileSync(path.join(agentDir, 'evidence', 'f1.snapshot.txt'), snapshot);
  if (screenshot !== null) fs.writeFileSync(path.join(agentDir, 'evidence', 'f1.png'), screenshot);
  if (dumpText !== null) fs.writeFileSync(path.join(browserDir, 'page-2026-08-14T00-00-00-000Z.yml'), dumpText);
  return { runDir, agentDir, browserDir };
}

function baseFinding(overrides = {}) {
  return {
    id: 'f1',
    title: 'Nothing on the projects page says how to attach a corridor',
    severity: 'confusing',
    url: `${BASE_URL}/projects`,
    screenshot: 'evidence/f1.png',
    snapshot: 'evidence/f1.snapshot.txt',
    ...overrides,
  };
}

function run(finding, { snapshot = pageSnapshot(), screenshot = png(1440, 900), dumpText = snapshot } = {}) {
  const { agentDir, browserDir } = makeRun({ snapshot, screenshot, dumpText });
  return verifyFinding(finding, { runDir: agentDir, baseUrl: BASE_URL, dumps: loadBrowserDumps(browserDir) });
}

console.log('first-week evidence rule');

check('a complete, honest finding is confirmed', () => {
  const verdict = run(baseFinding({ presentText: ['Start a new project'] }));
  assert.deepStrictEqual(verdict.reasons, [], `expected no discard reasons, got: ${verdict.reasons.join(' | ')}`);
  assert.strictEqual(verdict.status, 'confirmed');
});

check('a PNG header is read, and a text file renamed .png is not an image', () => {
  assert.deepStrictEqual(readPngSize(png(1440, 900)), { width: 1440, height: 900 });
  assert.strictEqual(readPngSize(Buffer.from('this is not a screenshot, it is a sentence')), null);
});

check('no screenshot at all — discarded', () => {
  const verdict = run(baseFinding(), { screenshot: null });
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(verdict.reasons.some((r) => /does not exist/.test(r)), verdict.reasons.join(' | '));
});

check('a text file with a .png name — discarded', () => {
  const verdict = run(baseFinding(), { screenshot: Buffer.from('screenshot of the projects page') });
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(verdict.reasons.some((r) => /not a PNG/.test(r)), verdict.reasons.join(' | '));
});

check('a phone-sized crop is not a page screenshot — discarded', () => {
  const verdict = run(baseFinding(), { screenshot: png(320, 200) });
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(verdict.reasons.some((r) => /320px wide/.test(r)), verdict.reasons.join(' | '));
});

check('a summary in place of the page tree — discarded', () => {
  const short = `### Page state\n- Page URL: ${BASE_URL}/projects\nThe page had a list of projects and a button.`;
  const verdict = run(baseFinding(), { snapshot: short, dumpText: short });
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(verdict.reasons.some((r) => /characters; a page tree/.test(r)), verdict.reasons.join(' | '));
});

check('a finding filed against a page the snapshot is not of — discarded', () => {
  const verdict = run(baseFinding({ url: `${BASE_URL}/grants/opportunities` }));
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(
    verdict.reasons.some((r) => /never mentions \/grants\/opportunities/.test(r)),
    verdict.reasons.join(' | '),
  );
});

/**
 * THE WANDERING-AGENT CASE, and it is not hypothetical. On the first real run
 * the dev server died mid-job; the agent went looking for the software, found a
 * different OpenPlan checkout on another local port, signed in, did the whole
 * job there and filed two findings. Every one of them was a true sentence about
 * a tree nobody was testing.
 */
check('a finding about a different local instance — discarded', () => {
  const other = 'http://localhost:3000/engagement/abc?tab=setup';
  const snapshot = pageSnapshot({ url: other });
  const verdict = run(baseFinding({ url: other }), { snapshot, dumpText: snapshot });
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(
    verdict.reasons.some((r) => /different instance/.test(r)),
    verdict.reasons.join(' | '),
  );
});

check('a finding filed against a browser error page — discarded', () => {
  const verdict = run(baseFinding({ url: 'chrome-error://chromewebdata/' }));
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(
    verdict.reasons.some((r) => /the browser talking, not the product/.test(r)),
    verdict.reasons.join(' | '),
  );
});

check('text the agent says it saw, that is not on the page — discarded', () => {
  const verdict = run(baseFinding({ presentText: ['Attach a corridor to this project'] }));
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(verdict.reasons.some((r) => /Claimed to see/.test(r)), verdict.reasons.join(' | '));
});

/**
 * THE DID-NOT-SCROLL CASE. This is the whole reason `absentText` is in the
 * report format. The agent reports the funding link is missing; the page tree it
 * attached has the funding link in it.
 */
check('"I could not find X" when X is in the page tree — discarded as contradicted', () => {
  const snapshot = pageSnapshot({
    extra: ['- link "Funding" [ref=e40] [cursor=pointer]:', '  - /url: /projects/funding'],
  });
  const verdict = run(baseFinding({ absentText: ['Funding'] }), { snapshot, dumpText: snapshot });
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(verdict.reasons.some((r) => /did-not-scroll/.test(r)), verdict.reasons.join(' | '));
});

check('a paraphrased missing field is discarded when its terms appear together in the evidence', () => {
  const snapshot = pageSnapshot({
    extra: [
      '- paragraph: Planning-level estimated project cost: USD 4,200,000. Price year 2026. Source: projects.csv.',
    ],
  });
  const verdict = run(baseFinding({ absentText: ['Cost source'] }), { snapshot, dumpText: snapshot });
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(verdict.reasons.some((r) => /terms appear together/.test(r)), verdict.reasons.join(' | '));
});

/**
 * The mirror case, and note what the fixture had to change to get here. The
 * first draft of this test used "Funding" as the absent thing and was
 * CONTRADICTED — the page's own prose says "with its funding and its analysis".
 * The matching is case-insensitive substring on purpose, so a finding must name
 * the control it looked for, not a topic. "Attach a corridor" is a control.
 */
check('"I could not find X" when X really is absent — confirmed', () => {
  const verdict = run(baseFinding({ absentText: ['Attach a corridor'] }));
  assert.deepStrictEqual(verdict.reasons, [], verdict.reasons.join(' | '));
  assert.strictEqual(verdict.status, 'confirmed');
});

check('a snapshot the browser never served — discarded', () => {
  const invented = pageSnapshot({
    extra: [
      '- heading "Attach your corridor" [level=2] [ref=e30]',
      '- button "Choose a shapefile" [ref=e31] [cursor=pointer]',
      '- paragraph [ref=e32]: Drop the files your predecessor left you here to get started.',
      '- paragraph [ref=e33]: Supported formats are listed in the help centre article on data.',
    ],
  });
  // The browser recorded the page WITHOUT those lines.
  const verdict = run(baseFinding(), { snapshot: invented, dumpText: pageSnapshot() });
  assert.strictEqual(verdict.status, 'confirmed', 'a mostly-real snapshot still corroborates');

  const wholesale = [
    '### Page state',
    `- Page URL: ${BASE_URL}/projects`,
    '- Page Snapshot:',
    '- heading "Set up your corridor project" [level=1]',
    '- paragraph: Start by telling us which corridor this project is about.',
    '- button "Upload the alignment"',
    '- paragraph: We could not find any of the files you mentioned in the handover folder.',
    '- paragraph: Choose a different folder or ask your predecessor where they went.',
    '- button "Skip this for now and come back later"',
    '- paragraph: You can always add the alignment once the project has been created.',
  ].join('\n');
  const invented2 = run(baseFinding(), { snapshot: wholesale, dumpText: pageSnapshot() });
  assert.strictEqual(invented2.status, 'discarded');
  assert.ok(
    invented2.reasons.some((r) => /not copied from the page/.test(r)),
    invented2.reasons.join(' | '),
  );
});

check('evidence outside the run directory — discarded', () => {
  const verdict = run(baseFinding({ screenshot: '../../../../etc/hostname' }));
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(
    verdict.reasons.some((r) => /inside the run directory/.test(r)),
    verdict.reasons.join(' | '),
  );
});

check('a severity nobody can act on — discarded', () => {
  const verdict = run(baseFinding({ severity: 'medium' }));
  assert.strictEqual(verdict.status, 'discarded');
  assert.ok(verdict.reasons.some((r) => /severity must be one of/.test(r)), verdict.reasons.join(' | '));
});

check('a whole report separates confirmed from discarded and counts both', () => {
  const snapshot = pageSnapshot();
  const { agentDir, browserDir } = makeRun({ snapshot, screenshot: png(1440, 900), dumpText: snapshot });
  const report = {
    job: '02-project-end-to-end',
    outcomeReached: 'partly',
    findings: [
      baseFinding(),
      baseFinding({ id: 'f2', title: 'The funding link is nowhere on this page', absentText: ['Public engagement'] }),
    ],
  };
  const verdict = verifyJobReport({ runDir: agentDir, browserOutputDir: browserDir, baseUrl: BASE_URL, report });
  assert.strictEqual(verdict.confirmed.length, 1);
  assert.strictEqual(verdict.discarded.length, 1);
  assert.strictEqual(verdict.discarded[0].id, 'f2');
  assert.strictEqual(verdict.browserDumps, 1);
});

check('element refs differing between two snapshots of one page do not break corroboration', () => {
  const served = pageSnapshot().replace(/ref=e(\d+)/g, (_, n) => `ref=e${Number(n) + 40}`);
  const verdict = run(baseFinding(), { snapshot: pageSnapshot(), dumpText: served });
  assert.strictEqual(verdict.status, 'confirmed', verdict.reasons.join(' | '));
});

console.log(failures === 0 ? '\nEvery evidence rule holds.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
