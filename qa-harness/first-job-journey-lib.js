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

/** Page texts as the evidence checker reads them: pdftotext -layout, split on form feeds. */
function pdfPages(pdfPath) {
  const output = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pages = output.split('\f');
  if (pages.length > 1 && pages[pages.length - 1].trim() === '') pages.pop();
  return pages;
}

function squash(text) {
  return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Where each required item is printed. `heading` finds the page; text after the
 * heading that opens with one of the absence phrases means the export printed
 * the heading but not the item, which counts as missing, never found.
 */
const ITEM_RULES = {
  'safety-action-plan': {
    'high-injury-map': { heading: /^\s*High-injury network map\./m, text: 'High-injury network map' },
    'crash-summary': { heading: /^\s*Crash summary\s*$/m, text: 'Crash summary' },
    countermeasures: { heading: /^\s*Countermeasures\s*$/m, text: 'Countermeasures' },
    bca: { heading: /^\s*Benefit-cost summary\s*$/m, text: 'Benefit-cost summary' },
    'engagement-summary': { heading: /^\s*Engagement summary\s*$/m, text: 'Engagement summary' },
  },
  'ss4a-application': {
    'high-injury-map': { heading: /^\s*Appendix A\. High-injury network map\s*$/m, text: 'Appendix A. High-injury network map' },
    'crash-summary': { heading: /^\s*Appendix B\. Crash summary\s*$/m, text: 'Appendix B. Crash summary' },
    countermeasures: { heading: /^\s*Appendix C\. Countermeasures\s*$/m, text: 'Appendix C. Countermeasures' },
    bca: { heading: /^\s*Appendix D\. Benefit-cost summary\s*$/m, text: 'Appendix D. Benefit-cost summary' },
    'engagement-summary': { heading: /^\s*Appendix E\. Engagement summary\s*$/m, text: 'Appendix E. Engagement summary' },
  },
};
const ABSENCE = /^(missing\b|could not be read|map not drawn|not drawn|unavailable\b|no benefit-cost|no public engagement)/;
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
 * Find the five items in one PDF. Text items are found with the page text the
 * checker reads. The map is found by its heading and confirmed by pixels: the
 * heading page or a neighbour must carry highlight red, or the map is missing.
 */
function findPdfItems(kind, pages, renderPage) {
  const rules = ITEM_RULES[kind];
  if (!rules) throw new Error(`Unknown PDF kind ${kind}`);
  const items = [];
  const missing = [];
  for (const item of ITEMS) {
    const rule = rules[item];
    const pageIndex = pages.findIndex((text) => rule.heading.test(text));
    if (pageIndex < 0) {
      missing.push({ item, reason: 'heading not found' });
      continue;
    }
    const after = pages[pageIndex].split(rule.heading)[1] || '';
    const following = squash(after + ' ' + (pages[pageIndex + 1] || '')).replace(/^[.\s]+/, '');
    if (ABSENCE.test(following)) {
      missing.push({ item, page: pageIndex + 1, reason: `printed as: ${following.slice(0, 80)}` });
      continue;
    }
    if (item === 'high-injury-map') {
      const candidates = [pageIndex, pageIndex + 1, pageIndex - 1].filter((index) => index >= 0 && index < pages.length);
      let best = null;
      for (const index of candidates) {
        const rendered = renderPage(index + 1);
        if (rendered.redPixels >= MIN_RED_PIXELS && (!best || rendered.redPixels > best.redPixels)) best = { ...rendered, page: index + 1 };
      }
      if (!best) {
        missing.push({ item, page: pageIndex + 1, reason: `no page near the heading has ${MIN_RED_PIXELS} or more highlight-red pixels` });
        continue;
      }
      items.push({ item, page: best.page, method: 'page-image', imageSha256: best.imageSha256, redPixels: best.redPixels });
      continue;
    }
    items.push({ item, page: pageIndex + 1, method: 'pdftotext', text: rule.text });
  }
  return { items, missing };
}

/** Pages carrying a DRAFT stamp, read the way the checker reads them. */
function draftPages(pages) {
  return pages.map((text, index) => (/\bDRAFT\b/.test(text) ? index + 1 : null)).filter(Boolean);
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
  fs.mkdirSync(workDir, { recursive: true });
  const { items, missing } = findPdfItems(kind, pages, (page) => renderPdfPage(pdfPath, page, path.join(workDir, `${kind}-p${page}`)));
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
    findings: { draftPages: draftPages(pages), missingItems: missing, emailLocations: locateEmails(pages), mapRedPixels: (items.find((entry) => entry.item === 'high-injury-map') || {}).redPixels ?? null },
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
