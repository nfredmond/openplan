// Pure helpers for engagement-job-journey.js, the second proven job's journey.
// No browser and no server: every function here is unit-tested in
// engagement-job-journey.test.js. Helpers the first job already has (origin
// rule, confirmation token hash, scrubbing, axe summary, Poppler pages, place
// choice, page reading for the cross-workspace rule) are reused from
// first-job-journey-lib.js, not copied.
const fs = require('fs');
const path = require('path');
const first = require('./first-job-journey-lib');
const campaign = require('./journey-campaign-lib');
const { repoRoot } = require('./harness-env');
const { findPdfPhrase, normalizePdfText, pdfTextHasPhrase } = require('../openplan/scripts/lib/pdf-text-match.mjs');

// The demonstration label, the public-text reading, the close and their
// helpers live in journey-campaign-lib.js, shared with the first job's
// journey; they are re-exported below under the same names.
const { CAMPAIGN_TEMPLATE, COMMENT_STATEMENTS, DEMONSTRATION_LABEL, assertReadsAsDemonstration, closeForRecord, closeVerdict, readDemonstrationText, runJourney, squash, textHolds } = campaign;

const JOB_ID = 'engagement-campaign-review-and-response-in-three-places';
const DEFINITIONS_PATH = path.join(repoRoot, 'schemas', 'proven_job_definitions.v1.json');

/** This job's entry in schemas/proven_job_definitions.v1.json. The roles, place kinds, count phrases and limits come from it. */
function loadJobDefinition(file = DEFINITIONS_PATH) {
  const definitions = JSON.parse(fs.readFileSync(file, 'utf8'));
  const job = definitions.jobs.find((entry) => entry.id === JOB_ID);
  if (!job) throw new Error(`${path.basename(file)} has no job ${JOB_ID}.`);
  return job;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/**
 * The journey's arguments. The role and place kind must be one of the job's
 * journeys as its definition states them, so a run cannot record a place the
 * checker would refuse. A confirmation link is never an argument.
 */
function parseEngagementArgs(argv, job = loadJobDefinition()) {
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
  const rule = job.journeys.find((entry) => entry.role === out.role);
  if (!rule) throw new Error(`--role must be one of ${job.journeys.map((entry) => entry.role).join(', ')}, the journeys this job defines.`);
  const kinds = rule.placeKinds || [rule.placeKind];
  if (!kinds.includes(out['place-kind'])) throw new Error(`The ${out.role} journey needs --place-kind ${kinds.join(' or ')}.`);
  if (out.email === out['second-email']) throw new Error('--second-email must differ from --email');
  if (!first.MODES.includes(out.mode)) throw new Error(`--mode must be one of ${first.MODES.join(', ')}. Received ${out.mode}.`);
  const expectedCommit = typeof out['expected-commit'] === 'string' ? out['expected-commit'].toLowerCase() : null;
  if (expectedCommit && !/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error('--expected-commit must be a 40-character commit.');
  if (out.mode === 'proof' && (typeof out.inputs !== 'string' || !expectedCommit)) {
    throw new Error('A proof run needs --inputs and --expected-commit; rehearsal values never enter a proof.');
  }
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
    expectedCommit,
    executorAgent: typeof out['executor-agent'] === 'string' ? out['executor-agent'] : 'Claude Code',
    executorModel: typeof out['executor-model'] === 'string' ? out['executor-model'] : 'claude-opus-5-5',
    confirmTimeoutMinutes: Number(out['confirm-timeout-minutes'] || 30),
    exportTimeoutMinutes: Number(out['export-timeout-minutes'] || 15),
    headed: out.headed === true,
  };
}

// ---------------------------------------------------------------------------
// Inputs: every string the journey types
// ---------------------------------------------------------------------------

/** The labeled synthetic inputs a rehearsal uses when --inputs is not given. */
const REHEARSAL_INPUTS_PATH = path.join(__dirname, 'fixtures', 'engagement-job-rehearsal-inputs.json');
/** Carried by the rehearsal fixture. A proof refuses any inputs file that holds it. */
const REHEARSAL_LABEL = 'Rehearsal inputs for the engagement journey, not a consultation.';
const COMMENT_KEYS = ['mapPoint', 'noMapPoint', 'keyboard', 'rejected'];
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

const INPUT_SHAPE = {
  projectSummary: 'string',
  planType: 'string',
  decision: ['title', 'rationale', 'impact'],
  campaign: ['title', 'invitation'],
  comments: COMMENT_KEYS,
  reviewReasons: ['approve', 'reject'],
  staffReview: ['groupLabel', 'groupSummary', 'correctionReason', 'approvalReason'],
  response: ['theme', 'youSaid', 'weDid', 'publishReason'],
  links: ['decisionReason', 'themeReason', 'refreshReason'],
};

/** Every string in a value, with its dotted path. */
function stringsIn(value, at = '') {
  if (typeof value === 'string') return [[at, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringsIn(item, `${at}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => stringsIn(item, at ? `${at}.${key}` : key));
  return [];
}

/**
 * Refuse inputs a journey cannot type honestly. Every field is present and
 * not blank; the campaign title and invitation carry the demonstration label;
 * every comment says it was entered by an automated proof run and represents
 * no one; no string holds an email address, a [VERIFY] marker or the word
 * DRAFT (the record checker reads DRAFT in the review PDF as a stamp, and the
 * PDF prints the comments); the comment to be rejected is distinct from every
 * other string, so finding it on a public page means it leaked. A proof
 * refuses the rehearsal fixture.
 */
function validateEngagementInputs(inputs, mode) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error('The inputs file is not a JSON object.');
  for (const [key, shape] of Object.entries(INPUT_SHAPE)) {
    const value = inputs[key];
    if (shape === 'string') {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`The inputs file needs ${key}.`);
      continue;
    }
    if (!value || typeof value !== 'object') throw new Error(`The inputs file needs ${key} with ${shape.join(', ')}.`);
    for (const field of shape) {
      if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`The inputs file needs ${key}.${field}.`);
    }
  }
  if (mode === 'proof') {
    const labeled = inputs.rehearsal === true || JSON.stringify(inputs).toLowerCase().includes(REHEARSAL_LABEL.toLowerCase());
    if (labeled) throw new Error(`The inputs file is labeled "${REHEARSAL_LABEL}" A proof needs its own inputs.`);
  }
  for (const field of ['title', 'invitation']) {
    if (!inputs.campaign[field].toLowerCase().includes(DEMONSTRATION_LABEL.toLowerCase())) {
      throw new Error(`campaign.${field} must say "${DEMONSTRATION_LABEL}", in rehearsal and in proof.`);
    }
  }
  for (const key of COMMENT_KEYS) {
    const text = inputs.comments[key].toLowerCase();
    const missing = COMMENT_STATEMENTS.filter((statement) => !text.includes(statement));
    if (missing.length) throw new Error(`comments.${key} must say it was entered by an automated proof run and represents no one (missing "${missing.join('", "')}").`);
  }
  for (const [at, text] of stringsIn(inputs)) {
    if (at === 'label') continue;
    if (EMAIL_PATTERN.test(text)) throw new Error(`${at} holds an email address.`);
    if (/\bDRAFT\b/.test(text)) throw new Error(`${at} holds the word DRAFT, which the record checker reads as a stamp in the review PDF.`);
    if (/\[VERIFY|\[OPERATOR:/.test(text)) throw new Error(`${at} holds a [VERIFY] marker or an [OPERATOR] placeholder.`);
  }
  const rejected = squash(inputs.comments.rejected);
  for (const [at, text] of stringsIn(inputs)) {
    if (at === 'comments.rejected' || at === 'label') continue;
    const other = squash(text);
    if (other.includes(rejected) || rejected.includes(other)) {
      throw new Error(`comments.rejected and ${at} contain one another, so finding the rejected text on a public page would prove nothing.`);
    }
  }
  return inputs;
}

/** Read and check the inputs: --inputs, or the labeled rehearsal file in rehearsal mode. */
function loadEngagementInputs(mode, inputsFile) {
  if (!inputsFile && mode === 'proof') throw new Error('A proof run needs --inputs.');
  const file = inputsFile || REHEARSAL_INPUTS_PATH;
  const bytes = fs.readFileSync(file);
  let inputs;
  try {
    inputs = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`The inputs file ${path.basename(file)} is not JSON.`);
  }
  return { inputs: validateEngagementInputs(inputs, mode), file, sha256: first.sha256(bytes) };
}

// ---------------------------------------------------------------------------
// Counts: what the journey did, and what each surface states
// ---------------------------------------------------------------------------

const COUNT_NAMES = ['received', 'approved', 'rejected', 'publishedResponses', 'answered'];

/** The counts the journey's own actions give: contributions sent, moderation outcomes and the published response. */
function journeyCounts({ contributions, moderation, responses }) {
  const outcomes = new Map(moderation.map((entry) => [entry.commentId, entry.outcome]));
  const published = responses.filter((response) => response.status === 'published');
  const answered = new Set(published.flatMap((response) => response.sourceCommentIds));
  return {
    received: contributions.length,
    approved: [...outcomes.values()].filter((outcome) => outcome === 'approved').length,
    rejected: [...outcomes.values()].filter((outcome) => outcome === 'rejected').length,
    publishedResponses: published.length,
    answered: answered.size,
  };
}

/**
 * The review PDF's count sentences (review-export.ts, reviewCountSentences):
 * "Received 4 contributions.", "Approved 3 contributions.", "Withheld 1
 * contribution.", "Published 1 staff response.", "Answered 2 contributions
 * with a published staff response." Lines are read as one run of words per
 * page, so a sentence that wraps is still read.
 */
const PDF_COUNT_PATTERNS = {
  received: /\breceived (\d[\d,]*) contributions?\./g,
  approved: /\bapproved (\d[\d,]*) contributions?\./g,
  rejected: /\bwithheld (\d[\d,]*) contributions?\./g,
  pending: /\bpending (\d[\d,]*) contributions?\./g,
  flagged: /\bflagged for review (\d[\d,]*) contributions?\./g,
  publishedResponses: /\bpublished (\d[\d,]*) staff responses?\./g,
  answered: /\banswered (\d[\d,]*) contributions? with a published staff response\b/g,
};

/**
 * Each count a review PDF states, with the page it is on. A count stated
 * twice with different numbers reads as null (a disagreement inside the file);
 * a count the file does not state is left out.
 */
function readReviewPdfCounts(pages) {
  const found = {};
  pages.forEach((text, index) => {
    const flat = normalizePdfText(text).replace(/-\n/g, '').replace(/\s+/g, ' ');
    for (const [name, pattern] of Object.entries(PDF_COUNT_PATTERNS)) {
      for (const match of flat.matchAll(pattern)) {
        const value = Number(match[1].replace(/,/g, ''));
        if (!found[name]) found[name] = { value, page: index + 1 };
        else if (found[name].value !== value) found[name] = { value: null, page: found[name].page };
      }
    }
  });
  const counts = {};
  const countPages = {};
  for (const [name, entry] of Object.entries(found)) {
    counts[name] = entry.value;
    countPages[name] = entry.page;
  }
  return { counts, pages: countPages };
}

/** The definition's count names (campaign.counts) and the journey's. "Responded" is the definition's word for answered. */
const DEFINITION_COUNT_NAMES = { approved: 'approved', rejected: 'rejected', responded: 'answered' };

/**
 * The record's PDF items for this job: the scope badge and one phrase per
 * count, each found with the shared matcher (findPdfPhrase) the checker
 * re-reads with. The phrase is the definition's ("Approved {count}") with the
 * journey's own count; an item whose phrase is not found is listed as missing.
 */
function reviewPdfItems(pages, counts, campaignRule) {
  const items = [];
  const missing = [];
  const scope = campaignRule.scopeItem;
  const scopePages = findPdfPhrase(pages, scope.text);
  if (scopePages.length) items.push({ item: scope.item, page: scopePages[0], method: 'pdftotext', text: scope.text });
  else missing.push({ item: scope.item, reason: `"${scope.text}" not found` });
  for (const [name, { item, phrase }] of Object.entries(campaignRule.counts)) {
    const count = counts[DEFINITION_COUNT_NAMES[name]];
    if (!Number.isInteger(count)) throw new Error(`The definition's ${name} count has no journey count to fill its phrase.`);
    const text = phrase.replaceAll('{count}', String(count));
    const found = findPdfPhrase(pages, text);
    if (found.length) items.push({ item, page: found[0], method: 'pdftotext', text });
    else missing.push({ item, reason: `"${text}" not found` });
  }
  return { items, missing };
}

/**
 * The record's items for the public review copy: its scope badge only, found
 * with the shared matcher. The checker reads the copy's counts and the
 * sentence saying what it leaves out from the file itself.
 */
function publicReviewPdfItems(pages, publicCopyRule) {
  const scope = publicCopyRule.scopeItem;
  const found = findPdfPhrase(pages, scope.text);
  if (found.length) return { items: [{ item: scope.item, page: found[0], method: 'pdftotext', text: scope.text }], missing: [] };
  return { items: [], missing: [{ item: scope.item, reason: `"${scope.text}" not found` }] };
}

/** The Summary sheet's count rows (review-export.ts, buildCampaignReviewWorkbook) by their labels. */
const SUMMARY_LABELS = {
  Received: 'received',
  Approved: 'approved',
  Withheld: 'rejected',
  Pending: 'pending',
  'Flagged for review': 'flagged',
  'Published staff responses': 'publishedResponses',
  'Answered by a published staff response': 'answered',
};

/** A value the review export split into the Long text sheet, joined back (the checker's rule). */
function longTextValue(sheets, cell, recordId, field) {
  const value = String(cell ?? '');
  if (!value.endsWith(`[Full value: Long text / ${recordId} / ${field}]`)) return value;
  const rows = sheets['Long text'] || [];
  return rows.slice(1).filter((row) => row[1] === recordId && row[2] === field).sort((a, b) => a[3] - b[3]).map((row) => String(row[4])).join('');
}

/**
 * The workbook's counts, read two ways: the Summary sheet's labeled rows, and
 * the cells the checker counts (one Contributions row per contribution with
 * its status; one Staff responses row per response with its published time
 * and its sources). `sheets` is { name: rows of cell values }, as SheetJS's
 * sheet_to_json with header: 1 gives them.
 */
function readReviewWorkbookCounts(sheets) {
  const summary = {};
  for (const row of sheets.Summary || []) {
    const name = SUMMARY_LABELS[row[0]];
    if (!name) continue;
    summary[name] = typeof row[1] === 'number' ? row[1] : null;
  }
  const cells = {};
  const items = sheets.Contributions || [];
  if (items.length) {
    const id = items[0].indexOf('id');
    const status = items[0].indexOf('status');
    if (id >= 0 && status >= 0) {
      const rows = items.slice(1).filter((row) => row[id] !== '' && row[id] != null);
      cells.received = rows.length;
      cells.approved = rows.filter((row) => row[status] === 'approved').length;
      cells.rejected = rows.filter((row) => row[status] === 'rejected').length;
    }
  }
  const responses = sheets['Staff responses'] || [];
  if (responses.length) {
    const id = responses[0].indexOf('id');
    const sources = responses[0].indexOf('source_item_ids');
    const published = responses[0].indexOf('published_at');
    if (id >= 0 && sources >= 0 && published >= 0) {
      const rows = responses.slice(1).filter((row) => row[published] !== '' && row[published] != null);
      const answered = new Set();
      let unreadable = false;
      for (const row of rows) {
        try {
          const list = JSON.parse(longTextValue(sheets, row[sources], row[id], 'source_item_ids'));
          if (!Array.isArray(list)) throw new Error('not a list');
          list.forEach((entry) => answered.add(entry));
        } catch {
          unreadable = true;
        }
      }
      cells.publishedResponses = rows.length;
      cells.answered = unreadable ? null : answered.size;
    }
  }
  return { summary, cells };
}

/** "Comments (3)" to 3. Grouping marks of any locale are dropped; no count in parentheses is null. */
function tabCount(label) {
  const match = String(label || '').match(/\(([\d.,\s  ]+)\)\s*$/);
  if (!match) return null;
  const digits = match[1].replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

/**
 * The public response page's counts as a reader sees them: the Comments tab's
 * count (approved contributions, replies included), the "You said / We did"
 * tab's count (published responses), and the distinct comments the "Answers
 * these comments" lists link to (answered).
 */
function readPublicPageCounts({ commentsTab, responsesTab, answerHrefs }) {
  const ids = new Set();
  for (const href of answerHrefs || []) {
    try {
      const item = new URL(href, 'http://local.invalid').searchParams.get('item');
      if (item) ids.add(item);
    } catch {
      // A link that is not a URL names no comment.
    }
  }
  return { approved: tabCount(commentsTab), publishedResponses: tabCount(responsesTab), answered: ids.size };
}

/**
 * Compare what each surface states with the journey's own counts. A surface
 * lists the counts it must state (`required`); a required count it does not
 * state, or states as null (unreadable or contradictory), is a disagreement,
 * and so is any stated number that differs. Returns the disagreements.
 */
function countDisagreements(expected, surfaces) {
  const problems = [];
  for (const { surface, counts, required = [] } of surfaces) {
    for (const name of required) {
      if (counts[name] === undefined) problems.push(`${surface} states no ${name} count`);
    }
    for (const name of COUNT_NAMES) {
      if (counts[name] === undefined) continue;
      if (counts[name] === null) problems.push(`${surface} ${name} count could not be read`);
      else if (counts[name] !== expected[name]) problems.push(`${surface} states ${name} ${counts[name]}; the journey's count is ${expected[name]}`);
    }
  }
  return problems;
}

/** The refusal: a run whose surfaces disagree with each other or with the journey does not pass. */
function assertCountsAgree(expected, surfaces) {
  const problems = countDisagreements(expected, surfaces);
  if (problems.length) throw new Error(`The counts disagree: ${problems.join('; ')}.`);
  return true;
}

// ---------------------------------------------------------------------------
// The rejected comment on public surfaces
// ---------------------------------------------------------------------------

/**
 * Search surfaces for each rejected comment's text and its id. A surface is
 * { name, pages } for a PDF (the shared matcher, page by page, then with the
 * pages joined at each page break, the checker's rule) or { name, text } for
 * anything else (page text, HTML, JSON, workbook cells). Returns the SHA-256
 * of each text searched and every surface that held one.
 */
function searchRejected({ texts, ids = [], surfaces }) {
  const hits = [];
  for (const surface of surfaces) {
    const across = surface.pages ? surface.pages.map((page) => page.trim()).join('\n') : null;
    for (const text of texts) {
      const held = surface.pages
        ? surface.pages.some((page) => pdfTextHasPhrase(page, text)) || pdfTextHasPhrase(across, text)
        : textHolds(surface.text, text);
      if (held) hits.push({ surface: surface.name, by: 'text' });
    }
    for (const id of ids) {
      const flat = surface.pages ? surface.pages.join('\n').replace(/\s+/g, '') : String(surface.text);
      if (flat.toLowerCase().includes(id.toLowerCase())) hits.push({ surface: surface.name, by: 'id' });
    }
  }
  return { searchedSha256: texts.map((text) => first.sha256(Buffer.from(text, 'utf8'))), searched: surfaces.map((surface) => surface.name), hits };
}

/**
 * The rejected-text rule. No public surface may hold a rejected comment's text
 * or id, and every control surface (the internal review files, which do print
 * it) must hold every text: a search that cannot find the text where it is
 * would pass a leak too.
 */
function assertRejectedTextAbsent({ texts, ids, publicSurfaces, controlSurfaces }) {
  const control = searchRejected({ texts, surfaces: controlSurfaces });
  for (const surface of controlSurfaces) {
    const found = control.hits.filter((hit) => hit.surface === surface.name).length;
    if (found < texts.length) throw new Error(`The search found ${found} of ${texts.length} rejected texts in ${surface.name}, which prints them; it could not have found a leak.`);
  }
  const result = searchRejected({ texts, ids, surfaces: publicSurfaces });
  if (result.hits.length) {
    throw new Error(`A rejected comment is on a public surface: ${result.hits.map((hit) => `${hit.surface} (by ${hit.by})`).join('; ')}.`);
  }
  return { ...result, controls: controlSurfaces.map((surface) => surface.name) };
}

/** Staff-only field names anywhere in a JSON value: as a key at any depth. */
function staffFieldsIn(value, fields) {
  const found = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (fields.includes(key)) found.add(key);
        walk(child);
      }
    }
  };
  walk(value);
  return [...found];
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** One journey, in the shape of $defs/engagementJourney in schemas/proven_job_record.v1.schema.json. */
function buildEngagementJourney(state) {
  return {
    role: state.role,
    place: state.place,
    executors: state.executors,
    accountCreatedAt: state.accountCreatedAt,
    confirmationMethod: state.confirmationMethod,
    health: state.health,
    campaign: state.campaign,
    pdfs: state.pdfs,
    workbooks: state.workbooks,
    publicPage: state.publicPage,
    screens: state.screens,
  };
}

/** The limits this job's record must state (the definition's requiredLimits), in words. */
const LIMIT_TEXTS = {
  'no-pdf-ua-check': 'No PDF/UA check was run on the review PDF.',
  'no-keyboard-or-screen-reader-pass-beyond-one-contribution': 'One contribution per journey was made with the keyboard only at 390 px. No other keyboard-only or screen-reader pass was made.',
  'no-human-usefulness-review': 'No planner reviewed whether the review files or the response are useful. Agent-run checks are the acceptance evidence.',
  'test-comments-represent-no-one': 'The comments were entered by an automated proof run and represent no one. A few test comments are not public opinion.',
  'response-speaks-for-no-agency': 'The published response was written by an automated proof run under a demonstration label and speaks for no agency.',
  'no-translation-or-ai-synthesis': 'No AI feature ran: translation, AI moderation, AI synthesis and AI drafting are out of scope.',
  // What stays on the journey's word (review 59): the checker reads the
  // review files itself, but nothing below comes from a file it can read.
  'live-screens-read-by-the-journey': 'The journey read these on live screens and the checker cannot read them again: the public response page\'s counts and its search for the rejected comment, the public portal data searched for staff-only fields, the statuses an anonymous participant and a second account received, the accessibility results, console errors and sideways scroll of each screen, and the closed campaign\'s public addresses.',
  'build-named-by-the-journey': 'Which build ran comes from the health readbacks the journey wrote at its start and end. The record\'s origin and each journey\'s mode are also the journey\'s own statements, carried from its run files. Nothing in the record comes from the deployment itself.',
  'contribution-input-stated-by-the-journey': 'Which contribution was made with the keyboard only, and at which width, is the journey\'s statement. The record holds no keyboard trail, and the page counted no pointer events. Whether each contribution has a map point is checked against the internal review workbook.',
  'ai-and-approval-flags-set-by-the-journey': 'The AI flags, the staff review\'s approval and its revision number are set by the journey after the app accepted each step. The journey presses no AI control; the checker cannot see that.',
};

const PAGE_ANSWERED_OK_TEXT = 'Another workspace\'s campaign page answers HTTP 200 with the not-found screen, because the page streams. The journey read the rendered page: the not-found screen was on it and none of the first account\'s identifying strings was in its text or HTML. The campaign read, the campaign export, the rejected comment\'s history and both review downloads were refused.';

/**
 * Refuse a run file that cannot go into a record for this commit and origin
 * (review 59, finding 1). The run must be this job's, made on the record's
 * origin, finished (no step stopped it) and its campaign closed. A run
 * assembled under the proof origin must have run in proof mode against the
 * record's commit; a run that named an expected commit must name this one.
 * The first job's assembler applies the same rule (first-job-journey-lib.js,
 * assertRunAssemblable), less the close.
 */
function assertEngagementRunAssemblable(run, { file, commit, baseUrl, proofOrigin }) {
  const name = path.basename(file);
  if (run.jobId !== JOB_ID) throw new Error(`${name} is a run of ${run.jobId}, not ${JOB_ID}.`);
  first.assertRunAssemblable(run, { file, commit, baseUrl, proofOrigin });
  const close = run.close || {};
  if (!close.attempted || !close.closed) throw new Error(`${name} did not take its campaign offline at the end, so it cannot go into a record.`);
}

/**
 * Combine three journey files into one record. Each journey carries its run's
 * mode and close. Cross-workspace checks keep the journey that made them; the
 * participant refusals of all three journeys are kept, each naming its
 * journey; the public read is one entry that answered 200 only if every
 * journey's did, searched only the fields every journey searched, and found a
 * staff field if any journey did. `root`, when given, is the folder the
 * record's file paths are relative to. A run that cannot go into a record for
 * this commit and origin refuses the assembly (assertEngagementRunAssemblable).
 */
function assembleEngagementRecord({ journeyFiles, commit, baseUrl, recordedOn, proofOrigin, root = null, job = loadJobDefinition(), extraLimits = [] }) {
  if (typeof proofOrigin !== 'string' || !proofOrigin) throw new Error('Assembly needs the checker\'s proof origin.');
  const runs = journeyFiles.map((file) => {
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertEngagementRunAssemblable(run, { file, commit, baseUrl, proofOrigin });
    const role = run.journey.role;
    for (const check of run.participantChecks.refusals) {
      if (check.journey !== undefined && check.journey !== role) throw new Error(`${path.basename(file)} holds a participant refusal named for the ${check.journey} journey, not its own ${role}.`);
    }
    run.participantChecks = { ...run.participantChecks, refusals: run.participantChecks.refusals.map((check) => ({ ...check, journey: role })) };
    run.journey = { role, mode: run.mode, ...run.journey, close: closeForRecord(run) };
    // Each journey names its files relative to its own folder. With `root`,
    // they are named relative to it instead, as the checker reads them.
    if (root) {
      const rebase = (entry) => ({ ...entry, path: path.relative(root, path.resolve(path.dirname(file), entry.path)).split(path.sep).join('/') });
      run.journey = { ...run.journey, pdfs: run.journey.pdfs.map(rebase), workbooks: run.journey.workbooks.map(rebase) };
    }
    return run;
  });
  const checks = runs.flatMap((run) => run.crossWorkspace.checks);
  const reads = runs.map((run) => run.participantChecks.publicRead);
  const searched = reads.reduce((common, read) => common.filter((field) => read.staffFieldsSearched.includes(field)), reads[0] ? [...reads[0].staffFieldsSearched] : []);
  const publicRead = {
    request: job.participantChecks.publicRead.request,
    status: reads.find((read) => read.status !== 200)?.status ?? 200,
    staffFieldsSearched: searched,
    staffFieldsFound: reads.some((read) => read.staffFieldsFound !== false),
  };
  const limits = job.requiredLimits.map((id) => ({ id, text: LIMIT_TEXTS[id] || id }));
  if (checks.some((check) => check.kind === 'page' && check.status === 200)) {
    limits.push({ id: job.crossWorkspace.pageAnsweredOkLimit, text: PAGE_ANSWERED_OK_TEXT });
  }
  limits.push(...extraLimits);
  return {
    schema: 'openplan.proven_job_record.v1',
    jobId: JOB_ID,
    commit,
    // The origin the runs were compared with, not the argument as typed: a
    // trailing slash assembled and then failed the checker (review 62, A12).
    baseUrl: new URL(baseUrl).origin,
    recordedOn,
    journeys: runs.map((run) => run.journey),
    crossWorkspace: { checks },
    participantChecks: { refusals: runs.flatMap((run) => run.participantChecks.refusals), publicRead },
    limits,
  };
}

module.exports = {
  CAMPAIGN_TEMPLATE,
  COUNT_NAMES,
  DEMONSTRATION_LABEL,
  JOB_ID,
  LIMIT_TEXTS,
  REHEARSAL_INPUTS_PATH,
  REHEARSAL_LABEL,
  assembleEngagementRecord,
  assertCountsAgree,
  assertReadsAsDemonstration,
  assertEngagementRunAssemblable,
  assertRejectedTextAbsent,
  buildEngagementJourney,
  closeForRecord,
  closeVerdict,
  countDisagreements,
  journeyCounts,
  loadEngagementInputs,
  loadJobDefinition,
  parseEngagementArgs,
  publicReviewPdfItems,
  readDemonstrationText,
  readPublicPageCounts,
  readReviewPdfCounts,
  readReviewWorkbookCounts,
  reviewPdfItems,
  runJourney,
  searchRejected,
  staffFieldsIn,
  tabCount,
  validateEngagementInputs,
};
