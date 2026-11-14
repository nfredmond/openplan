// Pure helpers for first-job-journey.js. No browser and no server: every
// function here is unit-tested in first-job-journey.test.js.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { assertLocalTargetUrl, assertProofTargetUrl, repoRoot } = require('./harness-env');

const MODES = ['rehearsal', 'proof'];
const PLACE_KINDS = ['county', 'city', 'cdp', 'metro', 'micro', 'aiannh', 'cousub'];
const AXE_VERSION = '4.11.1';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SCREEN_WIDTHS = [1440, 390];
const SCREEN_MODES = ['light', 'dark'];
const PDF_KINDS = ['safety-action-plan', 'ss4a-application'];
const ITEMS = ['high-injury-map', 'crash-summary', 'countermeasures', 'bca', 'engagement-summary'];

/** The evidence checker's hosted origin, read from the checker so the two cannot drift. */
async function loadProofOrigin() {
  const url = require('url').pathToFileURL(path.join(repoRoot, 'openplan', 'scripts', 'ops', 'capability-evidence.mjs'));
  const checker = await import(url.href);
  return checker.PROOF_ORIGIN;
}

/**
 * The origin rule for both modes. Rehearsal runs only on a local origin (the
 * existing local guard, which refuses Vercel and Supabase cloud hosts). Proof
 * runs only on the hosted proof origin. Anything else stops the run before a
 * browser opens.
 */
function checkJourneyOrigin(mode, baseUrl, proofOrigin) {
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}. Received ${mode}.`);
  if (mode === 'rehearsal') return assertLocalTargetUrl(baseUrl, 'Rehearsal base URL').origin;
  return assertProofTargetUrl(baseUrl, proofOrigin, 'Proof base URL').origin;
}

function parseJourneyArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  if (out['confirm-link'] || out.link || out.token) {
    throw new Error('A confirmation link is never taken as an argument. Write it to the file named by --confirm-link-file.');
  }
  const required = ['base-url', 'mode', 'place-query', 'place-kind', 'role', 'email', 'second-email', 'out'];
  const missing = required.filter((key) => typeof out[key] !== 'string' || !out[key].trim());
  if (missing.length) throw new Error(`Missing required arguments: ${missing.map((key) => `--${key}`).join(', ')}`);
  if (!PLACE_KINDS.includes(out['place-kind'])) throw new Error(`--place-kind must be one of ${PLACE_KINDS.join(', ')}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(out.role)) throw new Error('--role must be a slug, for example california-county');
  if (out.email === out['second-email']) throw new Error('--second-email must differ from --email');
  return {
    baseUrl: out['base-url'],
    mode: out.mode,
    placeQuery: out['place-query'],
    placeKind: out['place-kind'],
    role: out.role,
    email: out.email,
    secondEmail: out['second-email'],
    outDir: path.resolve(out.out),
    confirmLinkFile: typeof out['confirm-link-file'] === 'string' ? path.resolve(out['confirm-link-file']) : null,
    secondConfirmLinkFile: typeof out['second-confirm-link-file'] === 'string' ? path.resolve(out['second-confirm-link-file']) : null,
    inputsFile: typeof out.inputs === 'string' ? path.resolve(out.inputs) : null,
    budgetFile: typeof out['budget-file'] === 'string' ? path.resolve(out['budget-file']) : null,
    expectedCommit: typeof out['expected-commit'] === 'string' ? out['expected-commit'].toLowerCase() : null,
    executorAgent: typeof out['executor-agent'] === 'string' ? out['executor-agent'] : 'Claude Code',
    executorModel: typeof out['executor-model'] === 'string' ? out['executor-model'] : 'claude-opus-5-5',
    confirmTimeoutMinutes: Number(out['confirm-timeout-minutes'] || 30),
    headed: out.headed === true,
  };
}

/**
 * The SHA-256 of a confirmation link's token, and nothing else. Supabase links
 * carry `token` (the verify endpoint) or `token_hash` (an app confirm route).
 * The link itself is never returned, printed or stored.
 */
function confirmationTokenHash(link) {
  let parsed;
  try {
    parsed = new URL(String(link).trim());
  } catch {
    throw new Error('The confirmation link file does not hold a URL.');
  }
  const token = parsed.searchParams.get('token') || parsed.searchParams.get('token_hash') || parsed.searchParams.get('code');
  if (!token) throw new Error('The confirmation link has no token, token_hash or code parameter.');
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** A confirmation link may only send the browser to the app or its auth host. */
function checkConfirmLinkOrigin(link, allowedOrigins) {
  const parsed = new URL(String(link).trim());
  if (!allowedOrigins.includes(parsed.origin)) {
    throw new Error(`The confirmation link points at ${parsed.origin}, which is neither the app nor its auth host.`);
  }
  return parsed;
}

const SCRUB_PATTERNS = [
  [/\b(?:pk|sk|tk)\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[map token]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[jwt]'],
  [/\b(access_token|refresh_token|provider_token|token_hash|token|code|apikey|api_key|key)=([^&\s"']+)/gi, '$1=[redacted]'],
  [/\bsb-[a-z0-9]+-auth-token(?:\.\d+)?=?[^;\s"']*/gi, '[auth cookie]'],
  [/\b(set-cookie|cookie)\s*:\s*[^\n]*/gi, '$1: [redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+/g, 'Bearer [redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]'],
];

/** Remove map tokens, auth tokens, cookies and email addresses from captured text. */
function scrubText(text, extraSecrets = []) {
  let out = String(text);
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join('[redacted]');
  }
  for (const [pattern, replacement] of SCRUB_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Count serious and critical axe violations by affected node, so two failing
 * labels on one screen count as two. Rules are kept for the run log.
 */
function summarizeAxe(results, { version = AXE_VERSION, tags = AXE_TAGS } = {}) {
  if (!results || !Array.isArray(results.violations)) throw new Error('axe returned no violations list; the scan did not run.');
  if (results.testEngine && results.testEngine.version && results.testEngine.version !== version) {
    throw new Error(`axe ${results.testEngine.version} ran, not ${version}.`);
  }
  let serious = 0;
  let critical = 0;
  const rules = [];
  for (const violation of results.violations) {
    const nodes = Array.isArray(violation.nodes) ? violation.nodes.length : 0;
    if (violation.impact === 'serious') serious += nodes;
    if (violation.impact === 'critical') critical += nodes;
    if (violation.impact === 'serious' || violation.impact === 'critical') {
      rules.push({ id: violation.id, impact: violation.impact, nodes });
    }
  }
  return { axe: { version, tags: [...tags], serious, critical }, rules };
}

// ---------------------------------------------------------------------------
// PDFs
// ---------------------------------------------------------------------------

/**
 * The shared PDF readers. The evidence checker reads pages and finds phrases
 * with these same two modules, so the journey records the question the
 * checker asks again (KI-2026-11-14-190 for the Poppler check).
 */
const { findPdfPhrase, joinLetterSpacing, pdfTextHasPhrase } = require('../openplan/scripts/lib/pdf-text-match.mjs');
const { assertPopplerTool, popplerPdfPages } = require('../openplan/scripts/lib/poppler-text.mjs');

/** Page texts as the evidence checker reads them; refuses a pdftotext that is not Poppler's. */
function pdfPages(pdfPath, options) {
  return popplerPdfPages(pdfPath, options);
}

/**
 * The phrases that find each item, searched with the shared matcher.
 * `heading` is the item's heading; it is the text the record keeps and the
 * checker re-reads on the recorded page. `present` is printed only when the
 * item is there (a source line or a note), on the heading page or the next
 * one, which tells the item's heading from the same words in a table column.
 * The map has no `present` phrase: its red pixels are the test.
 */
const ITEM_RULES = {
  'safety-action-plan': {
    'high-injury-map': { heading: 'High-injury network map' },
    'crash-summary': { heading: 'Crash summary', present: 'Years requested' },
    countermeasures: { heading: 'Countermeasures', present: 'Proposed by staff for review' },
    bca: { heading: 'Benefit-cost summary', present: 'Source: Saved benefit-cost' },
    'engagement-summary': { heading: 'Engagement summary', present: 'Source: Engagement campaign' },
  },
  'ss4a-application': {
    'high-injury-map': { heading: 'Appendix A. High-injury network map' },
    'crash-summary': { heading: 'Appendix B. Crash summary', present: 'Years requested' },
    countermeasures: { heading: 'Appendix C. Countermeasures', present: 'Proposed by staff for review' },
    bca: { heading: 'Appendix D. Benefit-cost summary', present: 'Source: Saved benefit-cost' },
    'engagement-summary': { heading: 'Appendix E. Engagement summary', present: 'Source: Engagement campaign' },
  },
};
/** Words an export prints right after a heading whose item is absent. */
const ABSENT_AFTER_HEADING = ['Missing', 'Could not be read', 'Map not drawn', 'No countermeasure is attached'];
const MIN_RED_PIXELS = 40;

/** Read a binary PPM (P6) and count highlight-red and non-background pixels. */
function analyzePpm(buffer) {
  let offset = 0;
  const tokens = [];
  while (tokens.length < 4) {
    while (offset < buffer.length && /\s/.test(String.fromCharCode(buffer[offset]))) offset += 1;
    if (buffer[offset] === 0x23) {
      while (offset < buffer.length && buffer[offset] !== 0x0a) offset += 1;
      continue;
    }
    let token = '';
    while (offset < buffer.length && !/\s/.test(String.fromCharCode(buffer[offset]))) {
      token += String.fromCharCode(buffer[offset]);
      offset += 1;
    }
    tokens.push(token);
  }
  offset += 1;
  const [magic, w, h, max] = tokens;
  if (magic !== 'P6' || Number(max) !== 255) throw new Error('Only 8-bit binary PPM (P6) is read.');
  const width = Number(w);
  const height = Number(h);
  let red = 0;
  let ink = 0;
  for (let i = offset; i + 2 < buffer.length; i += 3) {
    const r = buffer[i];
    const g = buffer[i + 1];
    const b = buffer[i + 2];
    if (r >= 140 && r <= 230 && g <= 90 && b <= 90 && r - g >= 90) red += 1;
    if (r < 235 || g < 235 || b < 235) ink += 1;
  }
  return { width, height, redPixels: red, inkFraction: width && height ? ink / (width * height) : 0 };
}

/** Render one page with pdftoppm; returns the PNG hash and the PPM pixel counts. */
function renderPdfPage(pdfPath, page, outPrefix) {
  execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', '72', '-singlefile', pdfPath, outPrefix], { stdio: 'ignore' });
  execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', '72', '-png', '-singlefile', pdfPath, outPrefix], { stdio: 'ignore' });
  const ppm = fs.readFileSync(`${outPrefix}.ppm`);
  const png = fs.readFileSync(`${outPrefix}.png`);
  fs.unlinkSync(`${outPrefix}.ppm`);
  return { ...analyzePpm(ppm), imageSha256: sha256(png), imagePath: `${outPrefix}.png` };
}

/**
 * Find the five items in one PDF with the shared matcher (findPdfPhrase), the
 * function the checker re-reads with. An item is on the first page that holds
 * its heading, where the heading is not followed by an absence word
 * ("Missing", "Could not be read", ...) and its `present` phrase is on that
 * page, or else on the next one. The map is confirmed by pixels: the heading
 * page or a neighbour must carry highlight red. Each item keeps the heading
 * as its text, so the record names the exact phrase searched; `searches`
 * lists every phrase and the pages that held it, for the run log.
 */
function findPdfItems(kind, pages, renderPage) {
  const rules = ITEM_RULES[kind];
  if (!rules) throw new Error(`Unknown PDF kind ${kind}`);
  const items = [];
  const missing = [];
  const searches = [];
  for (const item of ITEMS) {
    const rule = rules[item];
    const headingPages = findPdfPhrase(pages, rule.heading);
    const presentPages = rule.present ? findPdfPhrase(pages, rule.present) : null;
    const absentPages = headingPages.filter((page) => ABSENT_AFTER_HEADING.some((word) => pdfTextHasPhrase(pages[page - 1], `${rule.heading} ${word}`)));
    searches.push({ item, heading: rule.heading, headingPages, present: rule.present || null, presentPages, absentPages });
    if (headingPages.length === 0) {
      missing.push({ item, reason: `heading "${rule.heading}" not found` });
      continue;
    }
    const candidates = headingPages.filter((page) => !absentPages.includes(page));
    const page = !presentPages
      ? candidates[0]
      : candidates.find((entry) => presentPages.includes(entry)) || candidates.find((entry) => presentPages.includes(entry + 1));
    if (!page) {
      const reason = candidates.length === 0
        ? `heading "${rule.heading}" is followed by an absence word on page ${absentPages.join(', ')}`
        : `heading "${rule.heading}" on page ${candidates.join(', ')}, but "${rule.present}" is not on that page or the next`;
      missing.push({ item, page: headingPages[0], reason });
      continue;
    }
    if (item === 'high-injury-map') {
      const near = [page, page + 1, page - 1].filter((entry) => entry >= 1 && entry <= pages.length);
      let best = null;
      for (const entry of near) {
        const rendered = renderPage(entry);
        if (rendered.redPixels >= MIN_RED_PIXELS && (!best || rendered.redPixels > best.redPixels)) best = { ...rendered, page: entry };
      }
      if (!best) {
        missing.push({ item, page, reason: `no page near the heading has ${MIN_RED_PIXELS} or more highlight-red pixels` });
        continue;
      }
      items.push({ item, page: best.page, method: 'page-image', imageSha256: best.imageSha256, redPixels: best.redPixels });
      continue;
    }
    items.push({ item, page, method: 'pdftotext', text: rule.heading });
  }
  return { items, missing, searches };
}

/** Pages carrying a DRAFT stamp, read the way the checker reads them (letter spacing joined). */
function draftPages(pages) {
  return pages.map((text, index) => (/\bDRAFT\b/.test(joinLetterSpacing(text)) ? index + 1 : null)).filter(Boolean);
}

/** Page and line of every email-like string. The address itself is not returned. */
function locateEmails(pages) {
  const found = [];
  const pattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
  pages.forEach((text, pageIndex) => {
    text.split(/\r?\n/).forEach((line, lineIndex) => {
      if (pattern.test(line)) found.push({ page: pageIndex + 1, line: lineIndex + 1, context: scrubText(line).replace(/\s+/g, ' ').trim().slice(0, 120) });
    });
  });
  return found;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** Everything the record says about one exported PDF. */
function describePdf(kind, pdfPath, recordPath, workDir) {
  const bytes = fs.readFileSync(pdfPath);
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${kind} download is not a PDF.`);
  const pages = pdfPages(pdfPath);
  assertPopplerTool('pdftoppm');
  fs.mkdirSync(workDir, { recursive: true });
  const { items, missing, searches } = findPdfItems(kind, pages, (page) => renderPdfPage(pdfPath, page, path.join(workDir, `${kind}-p${page}`)));
  return {
    pdf: {
      kind,
      path: recordPath,
      sha256: sha256(bytes),
      bytes: bytes.length,
      pages: pages.length,
      draftStamp: draftPages(pages).length > 0,
      items: items.map(({ redPixels, ...rest }) => rest),
    },
    findings: { draftPages: draftPages(pages), missingItems: missing, itemSearches: searches, emailLocations: locateEmails(pages), mapRedPixels: (items.find((entry) => entry.item === 'high-injury-map') || {}).redPixels ?? null },
  };
}

/** One journey, in the shape of $defs/journey in schemas/proven_job_record.v1.schema.json. */
function buildJourney(state) {
  return {
    role: state.role,
    place: state.place,
    executor: state.executor,
    accountCreatedAt: state.accountCreatedAt,
    confirmationMethod: state.confirmationMethod,
    health: state.health,
    crashes: state.crashes,
    highInjuryNetwork: state.highInjuryNetwork,
    countermeasureCount: state.countermeasureCount,
    bcaSaved: state.bcaSaved,
    engagement: state.engagement,
    pdfs: state.pdfs,
    screens: state.screens,
  };
}

/** Combine three journey files into one proven job record for the checker. */
function assembleRecord({ journeyFiles, jobId, commit, baseUrl, recordedOn, sourceCheck, limits }) {
  const runs = journeyFiles.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  return {
    schema: 'openplan.proven_job_record.v1',
    jobId,
    commit,
    baseUrl,
    recordedOn,
    journeys: runs.map((run) => run.journey),
    crossWorkspace: { checks: runs.flatMap((run) => run.crossWorkspace.checks) },
    sourceCheck,
    limits,
  };
}

/** UTC timestamp in the record's dateTime shape, without milliseconds. */
function utcNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

module.exports = {
  AXE_TAGS,
  AXE_VERSION,
  ITEMS,
  ITEM_RULES,
  MODES,
  PDF_KINDS,
  SCREEN_MODES,
  SCREEN_WIDTHS,
  analyzePpm,
  assembleRecord,
  buildJourney,
  checkConfirmLinkOrigin,
  checkJourneyOrigin,
  confirmationTokenHash,
  describePdf,
  draftPages,
  findPdfItems,
  loadProofOrigin,
  locateEmails,
  parseJourneyArgs,
  pdfPages,
  renderPdfPage,
  scrubText,
  sha256,
  summarizeAxe,
  utcNow,
};
