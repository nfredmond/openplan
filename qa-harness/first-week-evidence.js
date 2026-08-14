/**
 * THE EVIDENCE RULE, AS CODE.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The discovery layer (`first-week-discovery.js`) hands a fresh agent a
 * planner's job and a real browser and asks it where it got stuck. Agents are
 * good at getting stuck and bad at knowing why. The characteristic failure is
 * confident and cheap: "I could not find the funding tab" when the page had a
 * funding tab and the agent simply did not scroll, or "the save button did
 * nothing" when it never clicked it.
 *
 * So a claim from the agent is not a finding. A claim WITH evidence that its
 * own evidence does not contradict is a finding. Everything else is discarded
 * — not investigated, not triaged, not "worth a look". Discarded.
 *
 * That has to be a mechanism, because it is exactly the kind of rule a tired
 * reader waves through. This file is the mechanism. It knows nothing about
 * OpenPlan, names no route, no place and no agency; it only decides whether a
 * report is self-supporting.
 *
 * THE SIX CHECKS, and what each one is actually defending against.
 *
 *   1. SCREENSHOT IS A REAL IMAGE. The file exists inside the run directory,
 *      starts with the PNG signature, and its IHDR says it is at least
 *      MIN_SCREENSHOT_WIDTH wide. A model can write a plausible sentence far
 *      more easily than it can write a valid 1440-pixel PNG header by hand.
 *
 *   2. SNAPSHOT IS SUBSTANTIAL. At least MIN_SNAPSHOT_CHARS of page tree. A
 *      three-line "snapshot" is a summary, and a summary is the claim again.
 *
 *   3. THE SNAPSHOT PUTS THE AGENT WHERE IT SAYS IT WAS, ON THE INSTANCE THIS
 *      RUN NAMED. The URL's origin must be the base URL's origin, and the
 *      snapshot text must carry the URL the finding names. Playwright's snapshot
 *      output includes a `Page URL:` line, so the second half is free to satisfy
 *      honestly and awkward to satisfy otherwise. Defends against a finding
 *      filed against the wrong page — which reads identically to a real one in a
 *      report — and against the failure that produced this rule: when the dev
 *      server died mid-run, the agent went looking for the software, found a
 *      DIFFERENT OpenPlan checkout on another local port, signed in, and filed
 *      findings about somebody else's tree.
 *
 *   4. `presentText` MUST BE PRESENT. Whatever the agent says it saw, the page
 *      tree has to contain. Defends against remembered UI.
 *
 *   5. `absentText` MUST BE ABSENT. THIS IS THE DID-NOT-SCROLL RULE, and it is
 *      the reason the format asks for `absentText` at all. Any "I couldn't find
 *      X" finding must name X, and if X is sitting in the page tree the finding
 *      is contradicted by its own evidence and dies here. Note the asymmetry
 *      that makes this worth having: a scroll position changes what a person
 *      SEES, but Playwright's snapshot is the whole accessible page either way.
 *
 *   6. THE BROWSER MUST HAVE SEEN THE SAME TREE. The Playwright MCP server
 *      writes its own copy of every snapshot it serves, into a directory the
 *      agent is never told about and does not work in. At least
 *      MIN_CORROBORATED_LINES substantial lines of the agent's snapshot must
 *      appear verbatim in one of those dumps. Defends against a snapshot file
 *      composed rather than copied.
 *      This one rests on the two serializations matching, which is an empirical
 *      claim, not a design one. Checked on 2026-08-14 against a real run: an
 *      agent-written 36KB snapshot corroborated cleanly against the 28 dumps the
 *      MCP server wrote beside it. Element refs DO differ between two snapshots
 *      of the same page, which is why `normalizeSnapshotLine` strips them; if a
 *      future MCP version reformats the tree, this check starts discarding
 *      honest findings, and the symptom is every finding failing on this reason
 *      alone.
 *
 * WHAT THIS CANNOT DO, stated plainly so a confirmed finding is not over-read:
 *   - It is a carelessness defence, not a forgery defence. An agent that set
 *     out to deceive could copy a real dump next to a false narrative. Nothing
 *     here would notice, and nothing short of recording the session would.
 *   - "Confirmed" means SELF-SUPPORTING, not "is a real defect". The screenshot
 *     proves the page looked like that; whether that is wrong is judgement, and
 *     judgement stays with the reader.
 *   - Check 5 only fires on text the agent thought to name. An agent that
 *     reports "the page was confusing" makes no falsifiable claim and this file
 *     has nothing to grip.
 *
 * No browser and no server are needed to run any of this, which is why
 * `first-week-evidence.test.js` can test it directly.
 */
const fs = require('fs');
const path = require('path');

const MIN_SCREENSHOT_WIDTH = 800;
const MIN_SNAPSHOT_CHARS = 400;
const MIN_CORROBORATED_LINES = 3;
const CORROBORATION_LINE_MIN_CHARS = 25;

const SEVERITIES = ['blocker', 'confusing', 'cosmetic'];

/**
 * Reads the pixel size out of a PNG header. Returns null for anything that is
 * not a PNG, which is the point: a text file renamed to .png fails here.
 */
function readPngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Strips the parts of a Playwright page tree that legitimately differ between
 * two snapshots of the same page: element refs are renumbered on every call,
 * and indentation shifts when a wrapper appears. What is left is the words on
 * the page, which is what corroboration should be about.
 */
function normalizeSnapshotLine(line) {
  return line
    .replace(/\[ref=[^\]]*\]/g, '')
    .replace(/\[cursor=[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(normalizeSnapshotLine)
    .filter((line) => line.length > 0);
}

/**
 * Keeps a path from escaping the run directory. An agent that reports
 * `/etc/passwd` as its screenshot is not producing evidence.
 */
function resolveInside(runDir, candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return null;
  const resolved = path.resolve(runDir, candidate);
  const root = path.resolve(runDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function urlNeedle(rawUrl, baseUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }
  return { href: parsed.href, origin: parsed.origin, pathAndQuery: `${parsed.pathname}${parsed.search}` };
}

/**
 * The whole rule for one finding. `dumps` is the normalized text of every
 * snapshot the browser itself recorded during the run.
 */
function verifyFinding(finding, { runDir, baseUrl, dumps = [] }) {
  const discards = [];
  const id = (finding && finding.id) || '(unnamed finding)';

  if (!finding || typeof finding !== 'object') {
    return { id, status: 'discarded', reasons: ['The finding is not an object.'] };
  }
  if (typeof finding.title !== 'string' || finding.title.trim().length < 8) {
    discards.push('No title. A finding a person cannot read is not reportable.');
  }
  if (!SEVERITIES.includes(finding.severity)) {
    discards.push(`severity must be one of ${SEVERITIES.join(', ')}; got ${JSON.stringify(finding.severity)}.`);
  }

  // 1. screenshot
  const screenshotPath = resolveInside(runDir, finding.screenshot);
  let screenshotSize = null;
  if (!screenshotPath) {
    discards.push('No screenshot path inside the run directory.');
  } else if (!fs.existsSync(screenshotPath)) {
    discards.push(`Screenshot ${finding.screenshot} does not exist.`);
  } else {
    screenshotSize = readPngSize(fs.readFileSync(screenshotPath));
    if (!screenshotSize) {
      discards.push(`Screenshot ${finding.screenshot} is not a PNG.`);
    } else if (screenshotSize.width < MIN_SCREENSHOT_WIDTH) {
      discards.push(
        `Screenshot ${finding.screenshot} is ${screenshotSize.width}px wide; a page screenshot is at least ${MIN_SCREENSHOT_WIDTH}px.`,
      );
    }
  }

  // 2. snapshot
  const snapshotPath = resolveInside(runDir, finding.snapshot);
  let snapshotText = '';
  if (!snapshotPath) {
    discards.push('No page-snapshot path inside the run directory.');
  } else if (!fs.existsSync(snapshotPath)) {
    discards.push(`Snapshot ${finding.snapshot} does not exist.`);
  } else {
    snapshotText = fs.readFileSync(snapshotPath, 'utf8');
    if (snapshotText.length < MIN_SNAPSHOT_CHARS) {
      discards.push(
        `Snapshot ${finding.snapshot} is ${snapshotText.length} characters; a page tree is at least ${MIN_SNAPSHOT_CHARS}. A summary is the claim again, not evidence for it.`,
      );
    }
  }

  const haystack = normalizedLines(snapshotText).join('\n');

  // 3. the snapshot places the agent at the URL it names, ON THE INSTANCE THAT
  //    WAS BEING TESTED
  const needle = urlNeedle(finding.url, baseUrl);
  if (!needle) {
    discards.push(`url ${JSON.stringify(finding.url)} is not a URL.`);
  } else if (needle.origin !== new URL(baseUrl).origin) {
    // Learned on the first real run. The dev server died mid-job, and the agent
    // went looking for the software — found a DIFFERENT OpenPlan checkout on
    // another local port, signed in, and filed two findings about it. They were
    // true statements about somebody else's tree. A finding is about the
    // instance the run named or it is not a finding.
    discards.push(
      needle.origin === 'null'
        ? `This finding is filed against ${finding.url}, which is not a page on ${new URL(baseUrl).origin} — a browser error page is the browser talking, not the product.`
        : `This finding is about ${needle.origin}, but this run was driving ${new URL(baseUrl).origin}. It is a report about a different instance.`,
    );
  } else if (snapshotText && !snapshotText.includes(needle.href) && !snapshotText.includes(needle.pathAndQuery)) {
    discards.push(
      `The snapshot never mentions ${needle.pathAndQuery}, so it does not show the agent was on the page this finding is about.`,
    );
  }

  // 4. presentText
  for (const expected of Array.isArray(finding.presentText) ? finding.presentText : []) {
    if (!haystack.toLowerCase().includes(normalizeSnapshotLine(expected).toLowerCase())) {
      discards.push(`Claimed to see ${JSON.stringify(expected)}, but it is not in the page tree.`);
    }
  }

  // 5. absentText — the did-not-scroll rule
  for (const missing of Array.isArray(finding.absentText) ? finding.absentText : []) {
    if (haystack.toLowerCase().includes(normalizeSnapshotLine(missing).toLowerCase())) {
      discards.push(
        `Reported ${JSON.stringify(missing)} as missing, but it IS in the page tree. Contradicted by its own evidence — this is the did-not-scroll failure.`,
      );
    }
  }

  // 6. the browser recorded the same tree
  if (snapshotText.length >= MIN_SNAPSHOT_CHARS) {
    const candidates = normalizedLines(snapshotText).filter((l) => l.length >= CORROBORATION_LINE_MIN_CHARS);
    let corroborated = 0;
    for (const line of candidates) {
      if (dumps.some((dump) => dump.includes(line))) corroborated += 1;
      if (corroborated >= MIN_CORROBORATED_LINES) break;
    }
    if (corroborated < MIN_CORROBORATED_LINES) {
      discards.push(
        `Only ${corroborated} line(s) of this snapshot appear in what the browser itself recorded (${MIN_CORROBORATED_LINES} required). The snapshot was not copied from the page.`,
      );
    }
  }

  return {
    id,
    title: finding.title,
    severity: finding.severity,
    url: finding.url,
    status: discards.length === 0 ? 'confirmed' : 'discarded',
    reasons: discards,
    screenshot: finding.screenshot,
    snapshot: finding.snapshot,
    screenshotSize,
  };
}

/** Every snapshot the Playwright MCP server wrote for itself during a run. */
function loadBrowserDumps(browserOutputDir) {
  if (!browserOutputDir || !fs.existsSync(browserOutputDir)) return [];
  return fs
    .readdirSync(browserOutputDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml') || name.endsWith('.txt'))
    .map((name) => {
      try {
        return normalizedLines(fs.readFileSync(path.join(browserOutputDir, name), 'utf8')).join('\n');
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

/**
 * Verifies one job's whole report. `runDir` is the directory the agent worked
 * in; `browserOutputDir` is the one it was never told about.
 */
function verifyJobReport({ runDir, browserOutputDir, baseUrl, report }) {
  const dumps = loadBrowserDumps(browserOutputDir);
  const findings = Array.isArray(report && report.findings) ? report.findings : [];
  const verified = findings.map((finding) => verifyFinding(finding, { runDir, baseUrl, dumps }));
  return {
    outcomeReached: report && report.outcomeReached,
    browserDumps: dumps.length,
    confirmed: verified.filter((f) => f.status === 'confirmed'),
    discarded: verified.filter((f) => f.status === 'discarded'),
  };
}

module.exports = {
  CORROBORATION_LINE_MIN_CHARS,
  MIN_CORROBORATED_LINES,
  MIN_SCREENSHOT_WIDTH,
  MIN_SNAPSHOT_CHARS,
  SEVERITIES,
  loadBrowserDumps,
  normalizeSnapshotLine,
  normalizedLines,
  readPngSize,
  resolveInside,
  verifyFinding,
  verifyJobReport,
};
