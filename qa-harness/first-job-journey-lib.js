// Pure helpers for first-job-journey.js. No browser and no server: every
// function here is unit-tested in first-job-journey.test.js.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { assertLocalTargetUrl, assertProofTargetUrl, repoRoot } = require('./harness-env');
const campaignLib = require('./journey-campaign-lib');

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
const { MAP_RENDER_DPI, MIN_RED_PIXELS, analyzePpm, popplerPagePpm } = require('../openplan/scripts/lib/poppler-pixels.mjs');

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
 * The BCA block can run over three pages (its source line last), so its
 * phrase is a fact label printed under the heading, not the source line.
 * The map has no `present` phrase: its red pixels are the test.
 */
const ITEM_RULES = {
  'safety-action-plan': {
    'high-injury-map': { heading: 'High-injury network map' },
    'crash-summary': { heading: 'Crash summary', present: 'Years requested' },
    countermeasures: { heading: 'Countermeasures', present: 'Proposed by staff for review' },
    bca: { heading: 'Benefit-cost summary', present: 'Benefit-cost ratio' },
    'engagement-summary': { heading: 'Engagement summary', present: 'Source: Engagement campaign' },
  },
  'ss4a-application': {
    'high-injury-map': { heading: 'Appendix A. High-injury network map' },
    'crash-summary': { heading: 'Appendix B. Crash summary', present: 'Years requested' },
    countermeasures: { heading: 'Appendix C. Countermeasures', present: 'Proposed by staff for review' },
    bca: { heading: 'Appendix D. Benefit-cost summary', present: 'Benefit-cost ratio' },
    'engagement-summary': { heading: 'Appendix E. Engagement summary', present: 'Source: Engagement campaign' },
  },
};
/** Words an export prints right after a heading whose item is absent. */
const ABSENT_AFTER_HEADING = ['Missing', 'Could not be read', 'Map not drawn', 'No countermeasure is attached'];

/**
 * Render one page with pdftoppm; returns the PNG hash, the hash of the PPM
 * pixels and the pixel counts. The PPM comes from the renderer the checker
 * uses (scripts/lib/poppler-pixels.mjs), so the checker can recompute
 * pixelSha256 and the count on any platform; the PNG is kept as the run's
 * image file, but its bytes depend on the PNG encoder.
 */
function renderPdfPage(pdfPath, page, outPrefix) {
  const ppm = popplerPagePpm(pdfPath, page);
  execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', String(MAP_RENDER_DPI), '-png', '-singlefile', pdfPath, outPrefix], { stdio: 'ignore' });
  const png = fs.readFileSync(`${outPrefix}.png`);
  return { ...analyzePpm(ppm), imageSha256: sha256(png), pixelSha256: sha256(ppm), imagePath: `${outPrefix}.png` };
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
      items.push({ item, page: best.page, method: 'page-image', imageSha256: best.imageSha256, pixelSha256: best.pixelSha256, redPixels: best.redPixels });
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

/**
 * Refuse a run file that cannot go into a record for this commit and origin
 * (review 59, finding 1, for runs made from now on). The run was made on the
 * record's origin and finished, with no step stopping it. A run assembled
 * under the proof origin ran in proof mode against the record's commit; a
 * run that named an expected commit names this one. A rehearsal folder
 * assembled by mistake as proof is refused here, before any checker reads
 * it. The record that already exists is not re-assembled, and its checker
 * rules do not change.
 */
function assertRunAssemblable(run, { file, commit, baseUrl, proofOrigin }) {
  const name = path.basename(file);
  if (typeof proofOrigin !== 'string' || !proofOrigin) throw new Error('Assembly needs the checker\'s proof origin.');
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    throw new Error(`--base-url ${baseUrl} is not a web address.`);
  }
  if (run.baseUrl !== origin) throw new Error(`${name} ran on ${run.baseUrl}, not the record's ${origin}.`);
  if (origin === proofOrigin) {
    if (run.mode !== 'proof') throw new Error(`${name} is a ${run.mode} run; a record on the proof origin takes proof runs only.`);
    if (!run.expectedCommit) throw new Error(`${name} named no expected commit; a proof run names the commit it tested.`);
  }
  if (run.expectedCommit && run.expectedCommit !== commit) throw new Error(`${name} expected commit ${run.expectedCommit}, not the record's ${commit}.`);
  if (run.stoppedAt) throw new Error(`${name} stopped at ${run.stoppedAt}; an unfinished run cannot go into a record.`);
}

/**
 * The first job's rule for runs made from November 16, 2026 (lane 65), on top
 * of assertRunAssemblable: the run took its campaign offline at the end and
 * names the harness checkout it ran from; a run assembled under the proof
 * origin ran from a checkout with no uncommitted change to a tracked file.
 * The record that exists was assembled before this rule and is not
 * re-assembled.
 */
function assertFirstJobRunAssemblable(run, { file, commit, baseUrl, proofOrigin }) {
  assertRunAssemblable(run, { file, commit, baseUrl, proofOrigin });
  const name = path.basename(file);
  const close = run.close || {};
  if (!close.attempted || !close.closed) throw new Error(`${name} did not take its campaign offline at the end, so it cannot go into a record.`);
  const harness = run.harness || {};
  if (!/^[0-9a-f]{40}$/.test(String(harness.commit)) || typeof harness.clean !== 'boolean') {
    throw new Error(`${name} names no harness checkout (commit and clean); it was made before the journey recorded one.`);
  }
  if (new URL(baseUrl).origin === proofOrigin && harness.clean !== true) {
    throw new Error(`${name} ran from a harness checkout with uncommitted changes; a proof runs from a clean checkout.`);
  }
}

/**
 * Combine three journey files into one proven job record for the checker.
 * Each run must pass assertFirstJobRunAssemblable. Each journey carries its
 * run's mode, the close its run file records (journey-campaign-lib.js,
 * closeForRecord) and the harness checkout it ran from.
 */
function assembleRecord({ journeyFiles, jobId, commit, baseUrl, recordedOn, sourceCheck, limits, proofOrigin }) {
  const runs = journeyFiles.map((file) => {
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertFirstJobRunAssemblable(run, { file, commit, baseUrl, proofOrigin });
    const { role, ...rest } = run.journey;
    run.journey = { role, mode: run.mode, ...rest, close: campaignLib.closeForRecord(run), harness: { commit: run.harness.commit, clean: run.harness.clean } };
    return run;
  });
  const checks = runs.flatMap((run) => run.crossWorkspace.checks);
  const stated = [...limits];
  // A page that answered 200 with the not-found screen is a fact of the build
  // the record must state (KI-2026-11-14-060).
  if (checks.some((check) => check.kind === 'page' && check.status === 200) && !stated.some((limit) => limit.id === PAGE_ANSWERED_OK_LIMIT.id)) {
    stated.push(PAGE_ANSWERED_OK_LIMIT);
  }
  return {
    schema: 'openplan.proven_job_record.v1',
    jobId,
    commit,
    baseUrl,
    recordedOn,
    journeys: runs.map((run) => run.journey),
    crossWorkspace: { checks },
    sourceCheck,
    limits: stated,
  };
}

// ---------------------------------------------------------------------------
// Inputs: section text typed on screen, and the facts behind it
// ---------------------------------------------------------------------------

/** The labeled synthetic inputs a rehearsal uses when --inputs is not given. */
const REHEARSAL_INPUTS_PATH = path.join(__dirname, 'fixtures', 'first-job-rehearsal-inputs.json');
/** The first line of every rehearsal section text. A proof refuses any inputs file that carries it. */
const REHEARSAL_LABEL = 'Rehearsal text, not an application.';
/** The markers the SS4A export counts (openplan/src/lib/grants/application-draft-stamps.ts). */
const VERIFY_MARKER = /\[VERIFY(?:\]|:[^\]\n]*\])/g;
const PLACEHOLDER_MARKER = /\[OPERATOR:[^\]\n]*\]/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const INPUT_FIELDS = ['projectSummary', 'planType', 'countermeasures', 'treatedSegments', 'bca', 'campaign', 'comments', 'reviewReason', 'staffReview', 'budgetTitle', 'facts', 'sections'];

/** `[VERIFY]` markers and `[OPERATOR: ...]` placeholders in a text, counted as the export counts them. */
function countMarkers(text) {
  const value = String(text || '');
  return { verify: (value.match(VERIFY_MARKER) || []).length, placeholders: (value.match(PLACEHOLDER_MARKER) || []).length };
}

/**
 * Refuse inputs a journey cannot enter honestly. Every section text must be
 * free of markers, placeholders, email addresses and the word DRAFT; every
 * fact needs a statement, a source and the date it was read. The campaign's
 * title and invitation say "Demonstration by an automated OpenPlan proof
 * run" in both modes, and every comment says it was entered by an automated
 * proof run and represents no one (journey-campaign-lib.js, the second job's
 * rule); the campaign, comments and review text hold no email address, marker
 * or the word DRAFT, since the exports print them. A proof refuses any inputs
 * file labeled as rehearsal text, and any fact sourced as synthetic, so
 * rehearsal text never enters a proof.
 */
function validateJourneyInputs(inputs, mode, today = utcNow().slice(0, 10)) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error('The inputs file is not a JSON object.');
  const missing = INPUT_FIELDS.filter((key) => !Object.hasOwn(inputs, key));
  if (missing.length) throw new Error(`The inputs file is missing ${missing.join(', ')}.`);
  if (mode === 'proof') {
    const labeled = inputs.rehearsal === true || JSON.stringify(inputs).toLowerCase().includes(REHEARSAL_LABEL.toLowerCase());
    if (labeled) throw new Error(`The inputs file is labeled "${REHEARSAL_LABEL}" A proof needs sourced section text and facts.`);
  }
  if (inputs.campaignTitle !== undefined && inputs.campaignTitle !== null) {
    throw new Error('campaignTitle is no longer read. Put the title in campaign.title, with campaign.invitation beside it.');
  }
  campaignLib.assertDemonstrationCampaign(inputs.campaign);
  if (!Array.isArray(inputs.comments) || inputs.comments.length === 0 || inputs.comments.some((text) => typeof text !== 'string' || !text.trim())) {
    throw new Error('The inputs file needs comments, a list of at least one comment text.');
  }
  inputs.comments.forEach((text, index) => campaignLib.assertCommentStatements(text, `comments[${index}]`));
  const printed = [
    ['campaign.title', inputs.campaign.title],
    ['campaign.invitation', inputs.campaign.invitation],
    ...inputs.comments.map((text, index) => [`comments[${index}]`, text]),
    ['reviewReason', inputs.reviewReason],
    ...Object.entries(inputs.staffReview || {}).map(([key, text]) => [`staffReview.${key}`, text]),
  ];
  for (const [at, text] of printed) {
    if (typeof text !== 'string') continue;
    if (EMAIL_PATTERN.test(text)) throw new Error(`${at} holds an email address.`);
    if (/\bDRAFT\b/.test(text)) throw new Error(`${at} holds the word DRAFT, which the record checker reads as a stamp.`);
    const markers = countMarkers(text);
    if (markers.verify + markers.placeholders > 0) throw new Error(`${at} holds a [VERIFY] marker or an [OPERATOR] placeholder.`);
  }
  if (!Array.isArray(inputs.facts) || inputs.facts.length === 0) throw new Error('The inputs file needs at least one fact with its source and the date it was read.');
  for (const [index, fact] of inputs.facts.entries()) {
    const label = `Fact ${fact && fact.id ? fact.id : index + 1}`;
    for (const key of ['id', 'statement', 'source', 'readOn']) {
      if (!fact || typeof fact[key] !== 'string' || !fact[key].trim()) throw new Error(`${label} needs ${key}.`);
    }
    const read = new Date(`${fact.readOn}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fact.readOn) || Number.isNaN(read.valueOf()) || read.toISOString().slice(0, 10) !== fact.readOn || fact.readOn > today) {
      throw new Error(`${label} needs readOn as the calendar date it was read, not after ${today}.`);
    }
    if (mode === 'proof' && /synthetic|rehearsal/i.test(fact.source)) throw new Error(`${label} is sourced as synthetic or rehearsal; a proof needs a real source.`);
  }
  const sections = inputs.sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections) || Object.keys(sections).length === 0) throw new Error('The inputs file needs section texts keyed by section.');
  for (const [key, entry] of Object.entries(sections)) {
    const text = entry && typeof entry.text === 'string' ? entry.text : '';
    if (!text.trim()) throw new Error(`Section ${key} has no text.`);
    const markers = countMarkers(text);
    if (markers.verify + markers.placeholders > 0) throw new Error(`Section ${key} text holds ${markers.verify} [VERIFY] marker(s) and ${markers.placeholders} [OPERATOR] placeholder(s).`);
    if (EMAIL_PATTERN.test(text)) throw new Error(`Section ${key} text holds an email address.`);
    if (/\bDRAFT\b/.test(text)) throw new Error(`Section ${key} text holds the word DRAFT, which the record checker reads as a stamp.`);
  }
  return inputs;
}

/**
 * The workspace name each account types at sign-up. The second account's name
 * must differ from the first's and must not contain it: the cross-workspace
 * check searches what the second account sees for the first workspace's name,
 * and the second account's own header shows its own workspace name. With
 * `organization` set and no `secondOrganization`, both accounts would type the
 * same name and that check would fail on an honest run.
 */
function workspaceNames(inputs, placeQuery) {
  const first = String((inputs && inputs.organization) || `${placeQuery} journey`).trim();
  const given = inputs && inputs.secondOrganization;
  if (inputs && inputs.organization && !given) {
    throw new Error('The inputs file sets organization, so it must also set secondOrganization, a different workspace name for the second account.');
  }
  const second = String(given || `${placeQuery} second account`).trim();
  if (!first || !second) throw new Error('A workspace name is empty.');
  if (second.toLowerCase().includes(first.toLowerCase())) {
    throw new Error('secondOrganization contains the first workspace name, so the cross-workspace check could not tell the two workspaces apart.');
  }
  return { first, second };
}

/** Read and check the inputs: --inputs, or the labeled rehearsal file in rehearsal mode. */
function loadJourneyInputs(mode, inputsFile) {
  if (!inputsFile && mode === 'proof') throw new Error('A proof run needs --inputs with sourced section text and facts.');
  const file = inputsFile || REHEARSAL_INPUTS_PATH;
  const bytes = fs.readFileSync(file);
  let inputs;
  try {
    inputs = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`The inputs file ${path.basename(file)} is not JSON.`);
  }
  return { inputs: validateJourneyInputs(inputs, mode), file, sha256: sha256(bytes) };
}

/** The counts a section's warning badge shows ("3 unverified items, 1 unfilled placeholder"); none shown is zero. */
function parseUnverifiedBadge(text) {
  const value = String(text || '');
  const verify = Number((value.match(/(\d+) unverified items?/) || [])[1] || 0);
  const placeholders = Number((value.match(/(\d+) unfilled placeholders?/) || [])[1] || 0);
  return { verify, placeholders };
}

/**
 * The SS4A export's provenance table: the pages from the "Provenance
 * appendix" heading to the end, how many "Finalized by" cells name a
 * workspace role, and every email address on those pages (by the email
 * guard's pattern; the address is not returned).
 */
function finalizerCells(pages) {
  const start = findPdfPhrase(pages, 'Provenance appendix')[0];
  if (!start) return { provenancePages: [], roleCells: 0, emailLines: [] };
  const provenancePages = pages.map((_, index) => index + 1).filter((page) => page >= start);
  let roleCells = 0;
  for (const page of provenancePages) {
    const lines = pages[page - 1].split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/\bWorkspace\b/g)) {
        // The role follows on the same line, or wraps to the next line in the
        // same column (pdftotext -layout keeps column offsets).
        const after = line.slice(match.index + match[0].length);
        const below = (lines[index + 1] || '').slice(Math.max(0, match.index - 1), match.index + 12);
        if (/^\s+(?:owner|admin|member)\b/.test(after) || /^\s?(?:owner|admin|member)\b/.test(below)) roleCells += 1;
      }
    });
  }
  const emailLines = locateEmails(pages).filter((entry) => entry.page >= start).map(({ page, line }) => ({ page, line }));
  return { provenancePages, roleCells, emailLines };
}

// ---------------------------------------------------------------------------
// Cross-workspace page check (KI-2026-11-14-060)
// ---------------------------------------------------------------------------

const PAGE_ANSWERED_OK_LIMIT = {
  id: 'report-page-answers-200-with-not-found-screen',
  text: 'Another workspace\'s report page answers HTTP 200 with the not-found screen, because the page streams. The journey read the rendered page: the not-found screen was on it and none of the first account\'s identifying strings was in its text or HTML. The report and application downloads answered 403 or 404.',
};

/** The title of the app's not-found screen (openplan/src/app/not-found.tsx). */
const NOT_FOUND_TITLE = 'We could not find that page.';

/**
 * The first account's identifying strings for the page check: report title,
 * project name, workspace name and campaign title. Blank and repeated values
 * are dropped, so the count the record states is the count searched.
 */
function identifyingStrings({ reportTitle, projectName, workspaceName, campaignTitle }) {
  const values = [reportTitle, projectName, workspaceName, campaignTitle].map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean);
  return [...new Set(values)];
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/**
 * Read a page another workspace's account received: is the not-found screen
 * on it, and does any identifying string appear anywhere in its text or HTML
 * (raw or HTML-escaped, ignoring case and runs of whitespace)? Returns the
 * strings' SHA-256 hashes, never the strings.
 */
function readPageForRecord({ text, html, strings }) {
  const squash = (value) => String(value).replace(/\s+/g, ' ').toLowerCase();
  const pageText = squash(text);
  const pageHtml = squash(html);
  const recordTextFound = strings.some((value) => {
    const wanted = squash(value);
    return pageText.includes(wanted) || pageHtml.includes(wanted) || pageHtml.includes(squash(escapeHtml(value)));
  });
  return {
    notFoundRendered: pageText.includes(squash(NOT_FOUND_TITLE)),
    recordTextFound,
    searchedStringSha256: strings.map((value) => sha256(Buffer.from(value, 'utf8'))),
    textForTools: String(text),
  };
}

/**
 * The index of the place search result whose label is exactly the place the
 * run was told to choose, or -1. Case and spacing aside, nothing looser counts:
 * a run passes the full label the search shows ("Pyramid Lake Paiute
 * Reservation, NV"), so the record proves that name finds the place. A partial
 * name that happens to return one result ("Pyramid Lake") does not pass.
 */
function choosePlaceResult(query, labels) {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = normalize(query);
  if (!wanted) return -1;
  const matches = labels.map((label, index) => (normalize(label) === wanted ? index : -1)).filter((index) => index >= 0);
  return matches.length === 1 ? matches[0] : -1;
}

// ---------------------------------------------------------------------------
// The campaign's public text (lane 65)
// ---------------------------------------------------------------------------

/** The public pages a participant reads for the demonstration's text: the portal and its about page. */
const PORTAL_PAGES = ['portal', 'about'];

/**
 * Read each public page an anonymous participant loaded for the
 * demonstration's own text (journey-campaign-lib.js, readDemonstrationText).
 * `pages` is [{ name, width, text, html, sheetOpened }]. Returns one reading
 * per page; it refuses nothing, so the run file keeps every reading even when
 * the journey then stops.
 */
function portalDemonstrationReadings({ pages, invitation, title, createdWith }) {
  return pages.map((page) => ({
    ...campaignLib.readDemonstrationText({ surface: { name: `${page.name} at ${page.width} px`, text: page.text, html: page.html }, invitation, title, createdWith }),
    page: page.name,
    width: page.width,
    sheetOpened: Boolean(page.sheetOpened),
  }));
}

/**
 * The refusal the journey applies before any comment is sent: the portal and
 * its about page were each read at every screen width (1440 and 390 px), and
 * every reading shows the invitation and none shows the template's text or
 * the text the campaign was created with.
 */
function assertPortalReadsAsDemonstration(readings) {
  const missing = [];
  for (const width of SCREEN_WIDTHS) {
    for (const page of PORTAL_PAGES) {
      if (!(readings || []).some((reading) => reading.page === page && reading.width === width)) missing.push(`${page} at ${width} px`);
    }
  }
  if (missing.length) throw new Error(`The public pages were not all read as a participant: ${missing.join(', ')} was not read.`);
  campaignLib.assertReadsAsDemonstration(readings);
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
  NOT_FOUND_TITLE,
  PDF_KINDS,
  PORTAL_PAGES,
  REHEARSAL_INPUTS_PATH,
  REHEARSAL_LABEL,
  SCREEN_MODES,
  SCREEN_WIDTHS,
  analyzePpm,
  assembleRecord,
  assertFirstJobRunAssemblable,
  assertPortalReadsAsDemonstration,
  assertRunAssemblable,
  buildJourney,
  checkConfirmLinkOrigin,
  checkJourneyOrigin,
  choosePlaceResult,
  confirmationTokenHash,
  countMarkers,
  describePdf,
  draftPages,
  finalizerCells,
  findPdfItems,
  identifyingStrings,
  loadJourneyInputs,
  loadProofOrigin,
  locateEmails,
  parseJourneyArgs,
  parseUnverifiedBadge,
  pdfPages,
  portalDemonstrationReadings,
  readPageForRecord,
  renderPdfPage,
  scrubText,
  sha256,
  summarizeAxe,
  utcNow,
  validateJourneyInputs,
  workspaceNames,
};
