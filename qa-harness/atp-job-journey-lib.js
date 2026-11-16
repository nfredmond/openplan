// Pure helpers for atp-job-journey.js, the third proven job's journey: a
// California Active Transportation Program (ATP) application taken from
// sign-up to an exported application PDF. No browser and no server: every
// function here is unit-tested in atp-job-journey.test.js. Helpers the first
// job already has (origin rule, confirmation token hash, scrubbing, axe
// summary, Poppler pages, place choice, page reading for the cross-workspace
// rule, the facts check) are reused from first-job-journey-lib.js, and the
// run file and harness checkout from journey-campaign-lib.js. Not copied.
//
// Every limit here comes from the job's entry in
// schemas/proven_job_definitions.v1.json: the roles and place kinds, the ten
// section keys and their dispositions, the 26 checklist rows, the phrases the
// PDF must and may not print, and the words of each limit.
const fs = require('fs');
const path = require('path');
const first = require('./first-job-journey-lib');
const campaign = require('./journey-campaign-lib');
const { repoRoot } = require('./harness-env');
const { joinLetterSpacing, normalizePdfText, pdfTextHasPhrase } = require('../openplan/scripts/lib/pdf-text-match.mjs');

const JOB_ID = 'california-atp-application-in-three-places';
const DEFINITIONS_PATH = path.join(repoRoot, 'schemas', 'proven_job_definitions.v1.json');

/** This job's entry in schemas/proven_job_definitions.v1.json. */
function loadJobDefinition(file = DEFINITIONS_PATH) {
  const job = JSON.parse(fs.readFileSync(file, 'utf8')).jobs.find((entry) => entry.id === JOB_ID);
  if (!job) throw new Error(`${path.basename(file)} has no job ${JOB_ID}.`);
  return job;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/**
 * The journey's arguments. The role and place kind must be one of the job's
 * journeys as its definition states them, so a run cannot record a place the
 * checker would refuse. A confirmation link is never an argument. A proof
 * names its inputs, the commit it tests, both confirmation link files and the
 * agent and model that ran it; a rehearsal may leave them out.
 */
function parseAtpArgs(argv, job = loadJobDefinition()) {
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
  if (out['place-kind'] !== rule.placeKind) throw new Error(`The ${out.role} journey needs --place-kind ${rule.placeKind}.`);
  if (out.email === out['second-email']) throw new Error('--second-email must differ from --email');
  if (!first.MODES.includes(out.mode)) throw new Error(`--mode must be one of ${first.MODES.join(', ')}. Received ${out.mode}.`);
  const expectedCommit = typeof out['expected-commit'] === 'string' ? out['expected-commit'].toLowerCase() : null;
  if (expectedCommit && !/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error('--expected-commit must be a 40-character commit.');
  if (out.mode === 'proof') {
    const needed = ['inputs', 'expected-commit', 'confirm-link-file', 'second-confirm-link-file', 'executor-agent', 'executor-model'];
    const absent = needed.filter((key) => typeof out[key] !== 'string' || !out[key].trim());
    if (absent.length) throw new Error(`A proof run needs ${absent.map((key) => `--${key}`).join(', ')}; rehearsal values and defaults never enter a proof.`);
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
    executorModel: typeof out['executor-model'] === 'string' ? out['executor-model'] : 'claude-fable-5-2',
    confirmTimeoutMinutes: Number(out['confirm-timeout-minutes'] || 30),
    analysisTimeoutMinutes: Number(out['analysis-timeout-minutes'] || 20),
    headed: out.headed === true,
  };
}

// ---------------------------------------------------------------------------
// Inputs: every string the journey types
// ---------------------------------------------------------------------------

/** The labeled inputs a rehearsal uses when --inputs is not given: one place, a California county. */
const REHEARSAL_INPUTS_PATH = path.join(__dirname, 'fixtures', 'atp-job-rehearsal-inputs.json');
/** Carried by the rehearsal fixture. A proof refuses any inputs file that holds it. */
const REHEARSAL_LABEL = 'Rehearsal inputs for the ATP application journey, not an application.';
/**
 * The question the corridor analysis is asked when the inputs give none. It
 * is stored with the run and is not printed in the application PDF.
 */
const DEFAULT_ANALYSIS_QUESTION = `${campaign.DEMONSTRATION_LABEL}: what crash history involves people walking and bicycling in this study area?`;
/**
 * What the opening of every section must say besides the demonstration
 * label: that the agency or tribe it names did not prepare the text ("Trinity
 * County did not prepare ...", "No tribal government prepared ...").
 */
const NOT_PREPARED_PATTERNS = [/\bdid not prepare\b/i, /\bno (?:[a-z]+ ){0,3}(?:government|agency|tribe|city|county|district|commission) prepared\b/i];
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
/** A [VERIFY] marker, and the ways a text says something is still to come. */
const VERIFY_PATTERN = /\[VERIFY/i;
const PLACEHOLDER_PATTERNS = [
  /\[OPERATOR:/i,
  /\[(?:insert|todo|tk|placeholder|your)\b/i,
  /\bTBD\b/,
  /\bto be (?:provided|determined|supplied|added|confirmed|completed|entered)\b/i,
  /\blorem ipsum\b/i,
  /\{\{|\}\}/,
  /_{3,}/,
  /\bX{3,}\b/,
];

/** The paragraphs of a text: runs of lines set apart by a blank line. */
function paragraphs(text) {
  return String(text).split(/\r?\n\s*\r?\n/).map((part) => part.trim()).filter(Boolean);
}

/** Lower case, with every run of spacing made one space. */
function squash(value) {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Refuse a section text that does not open as a demonstration: its first
 * paragraph must begin with the definition's demonstration label and say
 * that the named agency or tribe did not prepare it. The checker reads the
 * label at the start of every section in the PDF; the second sentence is
 * what keeps a reader from taking the text for an agency's own.
 */
function assertDemonstrationSentence(text, at, job = loadJobDefinition()) {
  const label = job.application.demonstrationLabel.text;
  const opening = paragraphs(text)[0] || '';
  if (!squash(opening).startsWith(squash(label))) {
    throw new Error(`${at} must begin with "${label}", in rehearsal and in proof.`);
  }
  if (!NOT_PREPARED_PATTERNS.some((pattern) => pattern.test(opening.replace(/\s+/g, ' ')))) {
    throw new Error(`${at} must say in its opening sentences that the named agency or tribe did not prepare it (for example "did not prepare" or "No tribal government prepared").`);
  }
}

/**
 * Refuse a string the PDF prints that the record checker would refuse, or
 * that reads as unfinished: an email address, a [VERIFY] marker, a
 * placeholder, the word DRAFT (every DRAFT line in the PDF must be the
 * stamp), the study place label or the applicant line (the product prints
 * those; typed text may not stand in for them), a phrase the definition
 * refuses anywhere in the PDF, a sentence only the tribal area's PDF prints,
 * a number after a label ending in "score" or "points", or a line that is
 * one of the PDF's own headings.
 */
function assertPrintableText(text, at, job = loadJobDefinition()) {
  const rule = job.application;
  const value = String(text);
  if (EMAIL_PATTERN.test(value)) throw new Error(`${at} holds an email address.`);
  if (VERIFY_PATTERN.test(value)) throw new Error(`${at} holds a [VERIFY] marker.`);
  const placeholder = PLACEHOLDER_PATTERNS.find((pattern) => pattern.test(value));
  if (placeholder) throw new Error(`${at} holds a placeholder (${placeholder.source}).`);
  if (/\bDRAFT\b/.test(joinLetterSpacing(value))) throw new Error(`${at} holds the word DRAFT, which the record checker reads as a stamp.`);
  if (squash(value).includes(squash(rule.placeLine.label))) throw new Error(`${at} holds "${rule.placeLine.label}", the label of the line OpenPlan prints for the recorded study place.`);
  if (pdfTextHasPhrase(value, rule.applicant.line)) throw new Error(`${at} holds "${rule.applicant.line}", the line OpenPlan prints for the applicant.`);
  for (const phrase of rule.refusedPhrases.phrases) {
    if (pdfTextHasPhrase(value, phrase)) throw new Error(`${at} holds "${phrase}", which the job refuses anywhere in the PDF.`);
  }
  for (const fact of rule.appendices.roleFacts || []) {
    if (pdfTextHasPhrase(value, fact.phrase)) throw new Error(`${at} holds ${fact.name}, which only OpenPlan prints.`);
  }
  if (scoreMatches(value, rule).length) throw new Error(`${at} holds a number after a label ending in ${rule.scores.words.join(', ')}; the PDF may print only OpenPlan's own screening scores.`);
  const headings = [...rule.sections.list.map((section) => section.title), ...Object.values(job.itemHeadings[rule.pdf]), rule.sections.end, rule.appendices.end].map(squash);
  for (const line of value.split(/\r?\n/)) {
    if (headings.includes(squash(line))) throw new Error(`${at} holds a line that is one of the PDF's own headings ("${line.trim().slice(0, 60)}").`);
  }
}

/** Every "label ending in score or points, colon, number" the text holds that is not one of the definition's two labels. */
function scoreMatches(text, rule) {
  const flat = normalizePdfText(String(text)).replace(/-\n/g, '').replace(/\s+/g, ' ');
  const words = rule.scores.words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const labels = rule.scores.labels.map((label) => normalizePdfText(label).replace(/\s+/g, ' ').trim());
  const found = [];
  for (const match of flat.matchAll(new RegExp(`\\b(?:${words})\\)?\\s*:\\s*-?\\d`, 'g'))) {
    const before = flat.slice(0, match.index + match[0].lastIndexOf(':')).trimEnd();
    if (!labels.some((label) => before.endsWith(label))) found.push(flat.slice(Math.max(0, match.index - 60), match.index + match[0].length + 8).trim());
  }
  return found;
}

/**
 * The checklist as the journey will leave it: the template's rows in order,
 * each with the disposition the inputs give it. Refuses a key the template
 * does not have, a row with no entry, a disposition other than outstanding
 * or not-applicable (an agent attaches nothing), a not-applicable row the
 * template requires of every application or with a reason shorter than the
 * definition's minimum, and a reason on a row left outstanding.
 */
function checklistPlan(inputs, job = loadJobDefinition()) {
  const rule = job.application.rows;
  const given = inputs && inputs.checklist;
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Error('The inputs file needs checklist, a disposition for every row of the 2027 template.');
  const known = new Set(rule.list.map((row) => row.key));
  const unknown = Object.keys(given).filter((key) => !known.has(key));
  if (unknown.length) throw new Error(`checklist names ${unknown.join(', ')}, which the 2027 template does not have.`);
  return rule.list.map((row) => {
    const entry = given[row.key];
    if (!entry || typeof entry !== 'object') throw new Error(`checklist has no entry for ${row.key}; every row of the 2027 template needs a disposition.`);
    const { disposition } = entry;
    if (rule.refusedDispositions.includes(disposition)) throw new Error(`checklist.${row.key} is ${disposition}; an agent-run journey attaches no stand-in document.`);
    if (disposition !== 'outstanding' && disposition !== 'not-applicable') throw new Error(`checklist.${row.key} needs the disposition outstanding or not-applicable, found ${JSON.stringify(disposition)}.`);
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    if (disposition === 'not-applicable') {
      if (!rule.notApplicableFor.includes(row.requirement)) throw new Error(`checklist.${row.key} is marked not applicable, but the template requires it of every application.`);
      if (reason.length < rule.minReasonLength) throw new Error(`checklist.${row.key} is marked not applicable without a reason of at least ${rule.minReasonLength} characters.`);
      return { key: row.key, title: row.title, requirement: row.requirement, disposition, reason };
    }
    if (reason) throw new Error(`checklist.${row.key} is left outstanding, so it takes no reason; a reason belongs to a row marked not applicable.`);
    return { key: row.key, title: row.title, requirement: row.requirement, disposition };
  });
}

/** How many rows the DRAFT stamp must count: rows not marked not applicable whose requirement the definition counts. */
function outstandingRequiredCount(rows, job = loadJobDefinition()) {
  const rule = job.application.rows;
  const requirement = new Map(rule.list.map((row) => [row.key, row.requirement]));
  return rows.filter((row) => row.disposition !== 'not-applicable' && rule.countedRequirements.includes(requirement.get(row.key))).length;
}

/**
 * Refuse inputs a journey cannot type honestly, in both modes.
 * - The project name carries the demonstration label; the two workspace
 *   names are demonstration names, differ, and hold no applicant label.
 * - `sections` has exactly the template's ten keys. Every text opens with
 *   the demonstration sentence. A section the definition gives the fixed
 *   note holds that note; no other section does, and each of those says
 *   something after its opening.
 * - Nothing the PDF prints (project name, workspace name, section text,
 *   checklist reason) holds an email address, a [VERIFY] marker, a
 *   placeholder or anything else assertPrintableText refuses.
 * - `checklist` gives every row of the template a disposition
 *   (checklistPlan), and `requiredAttachmentsOutstanding` is the count those
 *   dispositions give, at least the definition's minimum.
 * - Every fact has a statement, a source and the date it was read.
 * - `role`, `placeKind` and `placeQuery`, when the file carries them, are the
 *   ones the run was started with (`run`), so one place's text is never
 *   typed under another's name.
 * A proof also refuses the rehearsal fixture's label.
 */
function validateAtpInputs(inputs, mode, { job = loadJobDefinition(), today = first.utcNow().slice(0, 10), run = null } = {}) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error('The inputs file is not a JSON object.');
  const rule = job.application;
  if (mode === 'proof') {
    const labeled = inputs.rehearsal === true || JSON.stringify(inputs).toLowerCase().includes(REHEARSAL_LABEL.toLowerCase());
    if (labeled) throw new Error(`The inputs file is labeled "${REHEARSAL_LABEL}" A proof needs its own sourced inputs.`);
  }
  for (const key of ['projectName', 'projectSummary', 'organization', 'secondOrganization']) {
    if (typeof inputs[key] !== 'string' || !inputs[key].trim()) throw new Error(`The inputs file needs ${key}.`);
  }
  const label = rule.demonstrationLabel.text;
  if (!squash(inputs.projectName).includes(squash(label))) throw new Error(`projectName must say "${label}", in rehearsal and in proof.`);
  const names = first.workspaceNames(inputs, '');
  for (const [at, name] of [['organization', names.first], ['secondOrganization', names.second]]) {
    if (!/demonstration/i.test(name)) throw new Error(`${at} must be a demonstration name (it must hold the word "demonstration"), never a person's or an agency's.`);
    for (const word of rule.applicant.labels) {
      if (pdfTextHasPhrase(name, word)) throw new Error(`${at} holds the words "${word}", so its name could not be told from an applicant line.`);
    }
  }
  if (inputs.applicationType !== undefined && inputs.applicationType !== 'small-infrastructure') {
    throw new Error(`applicationType is ${JSON.stringify(inputs.applicationType)}; this job runs the Small Infrastructure application only (small-infrastructure).`);
  }
  if (inputs.analysisQuestion !== undefined && (typeof inputs.analysisQuestion !== 'string' || !inputs.analysisQuestion.trim())) {
    throw new Error('analysisQuestion, when given, is the question typed into the corridor analysis.');
  }
  if (run) {
    for (const [key, given] of [['role', run.role], ['placeKind', run.placeKind], ['placeQuery', run.placeQuery]]) {
      if (inputs[key] !== undefined && inputs[key] !== given) throw new Error(`The inputs file is written for ${key} ${JSON.stringify(inputs[key])}, but the run was started with ${JSON.stringify(given)}.`);
    }
  }

  const sections = inputs.sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) throw new Error('The inputs file needs sections, the text of each of the template\'s ten sections keyed by section.');
  const expected = rule.sections.list.map((section) => section.key);
  const unknown = Object.keys(sections).filter((key) => !expected.includes(key));
  if (unknown.length) throw new Error(`sections names ${unknown.join(', ')}, which the 2027 template does not have.`);
  const absent = expected.filter((key) => !Object.hasOwn(sections, key));
  if (absent.length) throw new Error(`sections is missing ${absent.join(', ')}; every section of the 2027 template needs text.`);
  for (const section of rule.sections.list) {
    const at = `sections.${section.key}`;
    const text = sections[section.key] && typeof sections[section.key].text === 'string' ? sections[section.key].text : '';
    if (!text.trim()) throw new Error(`${at} has no text.`);
    assertDemonstrationSentence(text, at, job);
    assertPrintableText(text, at, job);
    const noted = pdfTextHasPhrase(text, rule.sections.fixedNote);
    if (section.disposition === 'fixed-note' && !noted) throw new Error(`${at} must hold the fixed note "${rule.sections.fixedNote}"; the application asks no question there.`);
    if (section.disposition !== 'fixed-note') {
      if (noted) throw new Error(`${at} holds the fixed note "${rule.sections.fixedNote}", but the application asks a question there.`);
      if (paragraphs(text).length < 2) throw new Error(`${at} says nothing after its opening; a section the application asks a question in needs text of its own.`);
    }
  }
  for (const [at, text] of [['projectName', inputs.projectName], ['organization', names.first]]) assertPrintableText(text, at, job);
  if (EMAIL_PATTERN.test(inputs.projectSummary) || EMAIL_PATTERN.test(names.second) || EMAIL_PATTERN.test(String(inputs.analysisQuestion || ''))) {
    throw new Error('projectSummary, secondOrganization or analysisQuestion holds an email address.');
  }

  const rows = checklistPlan(inputs, job);
  for (const row of rows) if (row.reason) assertPrintableText(row.reason, `checklist.${row.key}.reason`, job);
  const outstanding = outstandingRequiredCount(rows, job);
  if (!Number.isInteger(inputs.requiredAttachmentsOutstanding)) throw new Error('The inputs file needs requiredAttachmentsOutstanding, the count the PDF\'s DRAFT stamp must show.');
  if (inputs.requiredAttachmentsOutstanding !== outstanding) {
    throw new Error(`requiredAttachmentsOutstanding is ${inputs.requiredAttachmentsOutstanding}, but the checklist dispositions leave ${outstanding} required attachments outstanding.`);
  }
  if (outstanding < 1) throw new Error('The checklist leaves no required attachment outstanding; an agent produces none, so the count the DRAFT stamp shows cannot be zero.');

  first.assertSourcedFacts(inputs.facts, mode, today);
  return inputs;
}

/** Read and check the inputs: --inputs, or the labeled rehearsal file in rehearsal mode. */
function loadAtpInputs(mode, inputsFile, options = {}) {
  if (!inputsFile && mode === 'proof') throw new Error('A proof run needs --inputs.');
  const file = inputsFile || REHEARSAL_INPUTS_PATH;
  const bytes = fs.readFileSync(file);
  let inputs;
  try {
    inputs = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`The inputs file ${path.basename(file)} is not JSON.`);
  }
  return { inputs: validateAtpInputs(inputs, mode, options), file, sha256: first.sha256(bytes) };
}

// ---------------------------------------------------------------------------
// The study place
// ---------------------------------------------------------------------------

const USPS_BY_FIPS = { '06': 'CA' };

/**
 * The Census states the place search answer listed for a place: the item's
 * one state code (the search gives none for a place in several states), and
 * the state letters that close its label ("Hoopa Valley Reservation, CA";
 * "Fort Mojave Reservation, AZ-CA-NV").
 */
function placeStatesListed(item) {
  const tail = String((item && item.label) || '').split(',').pop().trim();
  const labelStates = /^[A-Z]{2}(?:-+[A-Z]{2})*$/.test(tail) ? tail.split(/-+/) : [];
  return { stateFips: item && typeof item.stateFips === 'string' && item.stateFips ? [item.stateFips] : [], labelStates };
}

/**
 * Stop unless the chosen place is one this journey's role may use, by the
 * definition's own rule for the role.
 * - A role with `statesExactly` (the tribal area): the states the search
 *   answer listed are exactly those, by its state code and by the letters
 *   that close its label. OpenPlan reads a state's crash file inside a
 *   tribal area only when the Bureau lists the area in that one state.
 * - A role with `stateFips` (the county and the city): the answer's state
 *   code is that state and the Census id begins with it.
 * Returns the record's stateFips for the place.
 */
function assertPlaceForRole(item, role, job = loadJobDefinition()) {
  const rule = job.journeys.find((entry) => entry.role === role);
  if (!rule) throw new Error(`The job defines no ${role} journey.`);
  if (!item || item.kind !== rule.placeKind) throw new Error(`The ${role} journey needs a place of kind ${rule.placeKind}, found ${item ? item.kind : 'none'}.`);
  const listed = placeStatesListed(item);
  const assertLabelSuffix = () => {
    if (rule.labelSuffix && !String(item.label).endsWith(rule.labelSuffix)) {
      throw new Error(`The label ${item.label} does not end with "${rule.labelSuffix}", as the ${role} journey's place must.`);
    }
  };
  if (rule.statesExactly) {
    const wanted = [...rule.statesExactly].sort();
    const found = [...listed.stateFips].sort();
    const letters = wanted.map((fips) => USPS_BY_FIPS[fips]);
    if (found.length !== wanted.length || found.some((state, index) => state !== wanted[index])) {
      throw new Error(`The place search lists ${item.label} in ${found.length ? `the states with FIPS ${found.join(', ')}` : 'more than one state or none'}; the ${role} journey's place must lie in exactly ${wanted.join(', ')}.`);
    }
    if (listed.labelStates.length !== letters.length || listed.labelStates.some((state, index) => state !== letters[index])) {
      throw new Error(`The label ${item.label} names ${listed.labelStates.length ? listed.labelStates.join(', ') : 'no state'}; the ${role} journey's place must name exactly ${letters.join(', ')}.`);
    }
    assertLabelSuffix();
    return listed.stateFips;
  }
  if (rule.stateFips) {
    if (listed.stateFips.length !== 1 || listed.stateFips[0] !== rule.stateFips || !String(item.geoid).startsWith(rule.stateFips)) {
      throw new Error(`${item.label} (${item.geoid}) is not in the state with FIPS ${rule.stateFips}, where the ${role} journey's place must be.`);
    }
  }
  assertLabelSuffix();
  return listed.stateFips;
}

// ---------------------------------------------------------------------------
// Crashes and the corridor analysis
// ---------------------------------------------------------------------------

/** The years requested, as the export prints them (openplan/src/lib/grants/atp-packet.ts, formatYears). */
function formatYears(years) {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const contiguous = sorted.every((year, index) => index === 0 || year === sorted[index - 1] + 1);
  if (sorted.length > 1 && contiguous) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  return sorted.join(', ');
}

/** The crash retrieval as the record states it, from the retrieval's answer and the request the screen sent. */
function crashesForRecord(body, request) {
  const years = request && Array.isArray(request.years) && request.years.every(Number.isInteger) ? request.years : null;
  if (!years || years.length === 0) throw new Error('The crash retrieval request the screen sent names no years, so the record cannot state the years requested.');
  if (!Number.isInteger(body.crashCount) || !Number.isInteger(body.storedCount)) throw new Error('The crash retrieval did not report how many crashes it found and stored.');
  return { sourceId: String(body.sourceId), years: formatYears(years), reportedCount: body.crashCount, storedCount: body.storedCount };
}

/**
 * The printed name of California's crash file, from the definition's own
 * words: the "Source:" fact Appendix B must state.
 */
function californiaCrashFileName(job = loadJobDefinition()) {
  const appendix = job.application.appendices.list.find((entry) => entry.item === 'appendix-b');
  const fact = ((appendix && appendix.facts) || []).find((entry) => /^Source: /.test(entry) && !entry.includes('{'));
  if (!fact) throw new Error('The job\'s definition names no crash source for Appendix B.');
  return fact.replace(/^Source: /, '');
}

/**
 * The journey's own stop at the crash step, in both modes: the retrieval
 * names its source as California's crash file (the name Appendix B must
 * print), stored at least the definition's minimum, and stored no more than
 * it reported. The definition's rule on the source's id is applied beside
 * this one (definitionRefusals); the two are kept apart so that a wrong id
 * in either place is seen and not worked around.
 */
function assertCaliforniaCrashFile(body, crashes, job = loadJobDefinition()) {
  const wanted = californiaCrashFileName(job);
  if (body.sourceLabel !== wanted) throw new Error(`The crashes come from "${body.sourceLabel ?? 'a source with no name'}", not "${wanted}".`);
  const minimum = ((job.journeyFields || []).find((entry) => entry.field === 'crashes.storedCount') || {}).atLeast ?? 1;
  if (crashes.storedCount < minimum) throw new Error(`The retrieval stored ${crashes.storedCount} crashes; every journey of this job stores at least ${minimum}.`);
  if (crashes.storedCount > crashes.reportedCount) throw new Error(`The retrieval stored ${crashes.storedCount} crashes but reported ${crashes.reportedCount}.`);
}

/** A dotted field of a journey ("crashes.sourceId"). */
function journeyField(journey, field) {
  return field.split('.').reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), journey);
}

/**
 * The definition's per-journey rules the journey has broken so far, in the
 * definition's own words. `only` limits the check to fields with that prefix
 * (the crash rules right after the retrieval); `skip` leaves fields out (a
 * rehearsal is not held to mode proof).
 */
function definitionRefusals(journey, job = loadJobDefinition(), { only = '', skip = [] } = {}) {
  const refusals = [];
  for (const rule of job.journeyFields || []) {
    if (!rule.field.startsWith(only) || skip.includes(rule.field)) continue;
    const value = journeyField(journey, rule.field);
    let ok = true;
    let expected;
    if (Object.hasOwn(rule, 'equals')) {
      expected = rule.equals;
      ok = value === rule.equals;
    } else if (Object.hasOwn(rule, 'atLeast')) {
      expected = rule.atLeast;
      ok = typeof value === 'number' && value >= rule.atLeast;
    } else if (Object.hasOwn(rule, 'minItems')) {
      expected = rule.minItems;
      ok = Array.isArray(value) && value.length >= rule.minItems;
    } else if (Object.hasOwn(rule, 'atMostField')) {
      expected = journeyField(journey, rule.atMostField);
      ok = typeof value === 'number' && typeof expected === 'number' && value <= expected;
    } else {
      throw new Error(`The job's definition rule for ${rule.field} is of a kind this journey does not know.`);
    }
    if (!ok) refusals.push(rule.refusal.replace('{found}', Array.isArray(value) ? String(value.length) : String(value)).replace('{expected}', String(expected)));
  }
  return refusals;
}

/**
 * Whether the corridor analysis run retrieved Census tract data, from the
 * run's own metrics, in the three states Appendix E can print
 * (openplan/src/lib/grants/atp-evidence-appendices.ts, demographicSource):
 * retrieved; none-retrieved; not-recorded (the run stored no Census record,
 * or did not say whether tract data was available).
 */
function tractDataReading(metrics) {
  const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
  const run = record(metrics) || {};
  const census = record((record(run.sourceSnapshots) || {}).census);
  const available = (record(run.dataQuality) || {}).censusAvailable;
  if (!census) return { state: 'not-recorded', censusRecordStored: false, tractCount: null };
  const tractCount = typeof census.tractCount === 'number' ? census.tractCount : null;
  if (typeof available !== 'boolean') return { state: 'not-recorded', censusRecordStored: true, tractCount };
  return { state: available ? 'retrieved' : 'none-retrieved', censusRecordStored: true, tractCount };
}

// ---------------------------------------------------------------------------
// The checklist and the DRAFT stamp
// ---------------------------------------------------------------------------

const STATUS_DISPOSITIONS = { missing: 'outstanding', in_progress: 'outstanding', not_applicable: 'not-applicable', attached: 'attached' };

/**
 * The record's checklist rows, read from the application screen after the
 * journey set them: `screenRows` is [{ key, status, note, attached }] in
 * screen order. Refuses a screen that does not show the template's rows in
 * order, a row whose state is not the one the plan gave it, a not-applicable
 * row whose note is not the plan's reason, and any row with a document
 * attached.
 */
function rowsFromScreen(screenRows, plan) {
  if (screenRows.length !== plan.length) throw new Error(`The application screen lists ${screenRows.length} checklist rows; the 2027 template has ${plan.length}.`);
  return plan.map((wanted, index) => {
    const shown = screenRows[index];
    if (shown.key !== wanted.key) throw new Error(`Checklist row ${index + 1} on screen is ${shown.key}; the template's is ${wanted.key}.`);
    const disposition = STATUS_DISPOSITIONS[shown.status];
    if (!disposition) throw new Error(`Checklist row ${shown.key} shows the status ${shown.status}, which the journey cannot read.`);
    if (shown.attached || disposition === 'attached') throw new Error(`Checklist row ${shown.key} has a document attached; the journey attaches nothing.`);
    if (disposition !== wanted.disposition) throw new Error(`Checklist row ${shown.key} reads ${disposition} on screen; the inputs give it ${wanted.disposition}.`);
    if (disposition === 'not-applicable') {
      const note = String(shown.note || '').trim();
      if (note !== wanted.reason) throw new Error(`Checklist row ${shown.key} is not applicable, but its note on screen is not the reason the inputs give.`);
      return { key: shown.key, disposition, reason: note };
    }
    return { key: shown.key, disposition };
  });
}

/** The count in a "DRAFT: N required attachment(s) outstanding" stamp found in a text, or null. */
function draftStampCount(text, job = loadJobDefinition()) {
  const [before, after] = job.application.draftStamp.phrase.split('{count}');
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = joinLetterSpacing(String(text || '')).match(new RegExp(`${escape(before)}([0-9][0-9,]*)${escape(after)}`));
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

/**
 * The DRAFT count must be one number everywhere: what the inputs expect,
 * what the record's rows give, and what each surface the journey read
 * states. `sources` maps a surface's name to the count read there, null when
 * no stamp was found. Refuses a missing stamp or a different count.
 */
function assertDraftCountAgrees(expected, sources) {
  const problems = [];
  for (const [name, count] of Object.entries(sources)) {
    if (count === null || count === undefined) problems.push(`${name} shows no DRAFT stamp`);
    else if (count !== expected) problems.push(`${name} says ${count}`);
  }
  if (problems.length) throw new Error(`The DRAFT stamp must count ${expected} required attachment(s) outstanding everywhere, but ${problems.join('; ')}.`);
}

// ---------------------------------------------------------------------------
// The application PDF, read back
// ---------------------------------------------------------------------------

function bareLine(text) {
  return normalizePdfText(joinLetterSpacing(text)).replace(/[\s-]/g, '');
}

function squashPdf(text) {
  return normalizePdfText(text).replace(/\s+/g, ' ').trim();
}

/** Where a heading stands as a block of its own: on one line, or wrapped over up to `maxLines` lines that hold nothing else. */
function headingBlocks(lines, heading, maxLines = 1) {
  const target = bareLine(heading);
  const blocks = [];
  for (let start = 0; start < lines.length; start += 1) {
    let joined = '';
    for (let end = start; end < lines.length && end < start + maxLines; end += 1) {
      const bare = bareLine(lines[end]);
      if (!bare) break;
      joined += bare;
      if (!target.startsWith(joined)) break;
      if (joined === target) {
        if (pdfTextHasPhrase(lines.slice(start, end + 1).join('\n'), heading)) blocks.push({ start, end: end + 1 });
        break;
      }
    }
  }
  return blocks;
}

/**
 * The PDF as one run of lines: every page's lines in order, with the page
 * footer and the blank lines around it left out, so a title or a sentence
 * that continues on the next page reads as consecutive lines. Each line
 * keeps the number of the page it came from.
 */
function applicationLines(pages, job) {
  const footer = new RegExp(job.application.pageFooter);
  const lines = [];
  pages.forEach((page, index) => {
    const kept = page.split(/\r?\n/).filter((line) => !footer.test(line));
    while (kept.length && !kept[0].trim()) kept.shift();
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    for (const text of kept) lines.push({ text, page: index + 1 });
  });
  return lines;
}

/** How many lines a fact that is a line of its own may wrap over, as the checker allows. */
const WRAPPED_FACT_LINES = 4;

/**
 * Read the exported application PDF the way the record checker will, with
 * the shared matcher, and say what it holds. `pages` is Poppler's text, one
 * entry per page; `journey` is the journey so far (place, projectName,
 * workspaceName, role, crashes, application with outstandingRequiredCount
 * and tractData). Returns `readings`, one per thing looked for with whether
 * it was found; `problems`, the readings that refuse the PDF, in the order
 * read; `items`, the six appendix headings with their pages, as the record's
 * PDF entry lists them; and `stampCount`.
 *
 * It reads: the cover's project name and workspace name; the study place
 * line as a whole line on the cover and in Appendix A, and every other line
 * with its label; the applicant line, and no box or line that names the
 * workspace as the applicant; the ten section titles once each, in order;
 * every section final and opening with the demonstration label; the fixed
 * note where the definition puts it; the DRAFT stamp and its count; the six
 * appendix headings in order with their facts (the program, the crash
 * source, and the years and reported count as whole lines), the rows a
 * journey's role must print and no other row under the same label; the
 * sentences only the tribal area's PDF prints; the tract data sentence that
 * belongs to the run's own reading and none that belongs to another; the two
 * disclaimers; no refused phrase ("to be provided" first among them); no
 * "Attached for" line; no score under another label; and that the PDF was
 * not typeset by the fallback writer.
 *
 * Blind category: it reads words, as the checker does, and follows the
 * checker's rules as they stood when this was written. The checker is the
 * authority; a rule added there is not read here until it is added here.
 */
function readApplicationPdf({ pages, job = loadJobDefinition(), journey }) {
  const rule = job.application;
  const headings = job.itemHeadings[rule.pdf];
  const all = applicationLines(pages, job);
  const lines = all.map((line) => line.text);
  const text = (from, to) => lines.slice(from, to).join('\n');
  const everywhere = text(0, lines.length);
  const printsAnywhere = (phrase) => pdfTextHasPhrase(everywhere, phrase) || pages.some((page) => pdfTextHasPhrase(page, phrase));
  // Refused words are also looked for with each run of spaces on a line read as one.
  const singleSpaced = everywhere.replace(/[ \t]{2,}/g, ' ');
  const printsRefused = (phrase) => printsAnywhere(phrase) || pdfTextHasPhrase(singleSpaced, phrase);
  // A fact that is a whole line of its own, on one line or wrapped over lines that hold nothing else.
  const wholeLineIn = (from, to, fact) => headingBlocks(lines.slice(from, to), fact, WRAPPED_FACT_LINES).length > 0;
  const readings = [];
  const read = (id, ok, detail) => {
    readings.push({ id, ok: Boolean(ok), detail });
    return Boolean(ok);
  };
  const { place } = journey;
  const values = {
    label: place.label,
    geoid: place.geoid,
    kind: rule.placeLine.kindWords[place.kind],
    years: journey.crashes.years,
    projectName: journey.projectName,
    workspaceName: journey.workspaceName,
  };
  const fill = (template, extra = {}) => template.replace(/\{(\w+)\}/g, (whole, name) => {
    const filled = { ...values, ...extra };
    if (!Object.hasOwn(filled, name)) throw new Error(`The job's definition uses the unknown placeholder ${whole}.`);
    return String(filled[name]);
  });
  const printed = (count) => Number(count).toLocaleString('en-US');

  read('not-fallback-writer', !printsAnywhere(rule.fallbackWriter.notice), 'the PDF was printed by the browser engine, not typeset by the export\'s fallback writer');

  // Sections: each title once, as a heading, in order, before the checklist.
  const ends = headingBlocks(lines, rule.sections.end);
  const sectionsEnd = ends.length ? ends[0].start : lines.length;
  read('sections-end-heading', ends.length > 0, `the heading "${rule.sections.end}" closes the sections`);
  const titles = rule.sections.list.map((section) => {
    const found = headingBlocks(lines.slice(0, sectionsEnd), section.title, rule.sections.maxTitleLines);
    read(`section-title:${section.key}`, found.length === 1, `the section title "${section.title}" is a heading exactly once (found ${found.length})`);
    return found.length === 1 ? { ...section, ...found[0] } : null;
  });
  const allTitles = titles.every(Boolean);
  if (allTitles) read('section-titles-in-order', titles.every((title, index) => index === 0 || title.start >= titles[index - 1].end), 'the ten section titles are in the template\'s order');

  // The cover: everything before the first section title.
  const coverEnd = allTitles ? titles[0].start : 0;
  const cover = text(0, coverEnd);
  const placeLine = fill(rule.placeLine.template);
  const stamp = fill(rule.draftStamp.phrase, { count: printed(journey.application.outstandingRequiredCount) });
  read('demonstration-label-on-project-name', squashPdf(journey.projectName).includes(squashPdf(rule.demonstrationLabel.text)), `the project name carries "${rule.demonstrationLabel.text}"`);
  for (const template of rule.cover.phrases) read(`cover:${template.replace(/[{}]/g, '')}`, pdfTextHasPhrase(cover, fill(template)), `the cover prints the ${template.replace(/[{}]/g, '')}`);
  read('cover-study-place-line', wholeLineIn(0, coverEnd, placeLine), `the cover states "${placeLine}" as a line of its own`);
  read('cover-applicant-line', pdfTextHasPhrase(cover, rule.applicant.line), `the cover prints "${rule.applicant.line}"`);
  read('study-place-recorded', !printsRefused(rule.placeLine.notRecorded), `the PDF does not print "${rule.placeLine.notRecorded}"`);
  // Every line that holds the label, with the lines a long place name wraps onto, is the journey's place line and nothing more.
  const placeLabel = squashPdf(rule.placeLine.label);
  const otherPlaceLines = lines.filter((line, index) => squashPdf(line).includes(placeLabel)
    && !headingBlocks(lines.slice(index, index + WRAPPED_FACT_LINES), placeLine, WRAPPED_FACT_LINES).some((block) => block.start === 0));
  read('study-place-label-lines', otherPlaceLines.length === 0, `every line that holds "${rule.placeLine.label}" is the journey's place line and nothing more`);
  // The applicant: the workspace's name on no line with an applicant label, in no box under one, and no box that is only a label.
  const workspace = squashPdf(journey.workspaceName);
  const asApplicant = [];
  for (const word of rule.applicant.labels) {
    const sameLine = lines.some((line) => squashPdf(line).includes(workspace) && pdfTextHasPhrase(line, word));
    if (sameLine || [`${word}: ${journey.workspaceName}`, `${word} ${journey.workspaceName}`].some(printsAnywhere)) asApplicant.push(`"${word}" with the workspace's name`);
    const boxLabel = squashPdf(word);
    lines.forEach((line, index) => {
      const said = squashPdf(line).replace(/\s*:$/, '').replace(/ name$/, '');
      if (said === boxLabel) asApplicant.push(`a box labeled "${line.trim().slice(0, 60)}"`);
      if (!said.endsWith(` ${boxLabel}`)) return;
      const next = lines.slice(index + 1).find((candidate) => candidate.trim() !== '');
      if (next !== undefined && squashPdf(next).includes(workspace)) asApplicant.push(`the workspace's name under a line that ends in "${word}"`);
    });
  }
  read('workspace-is-not-the-applicant', asApplicant.length === 0, asApplicant.length ? `the PDF prints ${asApplicant[0]}` : 'the PDF names the workspace nowhere as the applicant, the lead agency or the implementing agency');

  // The DRAFT stamp: on the cover, with the journey's count, and no other DRAFT line.
  const draftLines = lines.map((line, index) => ({ line, index })).filter(({ line }) => /\bDRAFT\b/.test(joinLetterSpacing(line)));
  const stampCount = draftStampCount(everywhere, job);
  read('draft-stamp-on-cover', pdfTextHasPhrase(cover, stamp), `the cover carries "${stamp}"`);
  read('draft-stamp-count', stampCount === journey.application.outstandingRequiredCount, `the stamp counts ${journey.application.outstandingRequiredCount} (the PDF's says ${stampCount === null ? 'nothing' : stampCount})`);
  read('draft-lines-are-the-stamp', draftLines.length > 0 && draftLines.every(({ line, index }) => bareLine(line) === bareLine(stamp) || bareLine(`${line}${lines[index + 1] || ''}`) === bareLine(stamp)), 'every line that holds the word DRAFT is that stamp');

  // Each section's text.
  const demonstration = squashPdf(rule.demonstrationLabel.text);
  if (allTitles) {
    titles.forEach((title, index) => {
      const body = text(title.end, index + 1 < titles.length ? titles[index + 1].start : sectionsEnd);
      read(`section-final:${title.key}`, !pdfTextHasPhrase(body, rule.sections.notFinal), `"${title.title}" is final`);
      read(`section-opens-with-label:${title.key}`, squashPdf(body).startsWith(demonstration), `"${title.title}" begins with the demonstration label`);
      const noted = pdfTextHasPhrase(body, rule.sections.fixedNote);
      if (title.disposition === 'fixed-note') read(`section-fixed-note:${title.key}`, noted, `"${title.title}" carries the fixed note`);
      else read(`section-fixed-note:${title.key}`, !noted && squashPdf(body).length > demonstration.length + 1, `"${title.title}" holds text of its own and not the fixed note`);
    });
  }
  const attached = rule.rows.list.filter((row) => printsAnywhere(fill(rule.rows.attachedLine, { title: row.title })));
  read('no-attached-line', attached.length === 0, 'the PDF prints no "Attached for" line');

  // The appendices: each heading once, after the sections, in order, with its facts.
  const appendices = rule.appendices.list.map((appendix) => {
    const heading = headings[appendix.item];
    const found = headingBlocks(lines, heading);
    const ok = found.length === 1 && found[0].start >= sectionsEnd;
    read(`appendix-heading:${appendix.item}`, ok, `the heading "${heading}" is a line of its own exactly once, after the sections (found ${found.length})`);
    return ok ? { ...appendix, heading, ...found[0] } : null;
  });
  const items = [];
  if (appendices.every(Boolean)) {
    read('appendix-headings-in-order', appendices.every((appendix, index) => index === 0 || appendix.start >= appendices[index - 1].end), 'the six appendix headings are in order');
    const last = appendices[appendices.length - 1];
    const closing = headingBlocks(lines, rule.appendices.end).find((block) => block.start >= last.end);
    read('appendices-end-heading', Boolean(closing), `the heading "${rule.appendices.end}" closes the appendices`);
    const boundsOf = (item) => {
      const index = appendices.findIndex((appendix) => appendix.item === item);
      return [appendices[index].end, index + 1 < appendices.length ? appendices[index + 1].start : (closing ? closing.start : lines.length)];
    };
    const bodyOf = (item) => text(...boundsOf(item));
    for (const appendix of appendices) {
      items.push({ item: appendix.item, page: all[appendix.start].page, method: 'pdftotext', text: appendix.heading });
      const body = bodyOf(appendix.item);
      const [from, to] = boundsOf(appendix.item);
      if (appendix.facts) {
        const countField = rule.appendices.countField && rule.appendices.countField[appendix.item];
        const extra = countField ? { count: printed(journeyField(journey, countField)) } : {};
        // The rows this journey's role must print, beside the facts every journey's PDF prints.
        const roleRows = appendix.factsByRole || {};
        const byRole = roleRows[journey.role] || roleRows.default || [];
        const expected = [];
        for (const template of [...appendix.facts, ...byRole]) {
          const fact = fill(template, extra);
          expected.push(fact);
          // A fact that ends in a filled value, or a row held to the role, must be a whole line:
          // "Crashes reported: 1" is not stated by "Crashes reported: 1,234".
          const whole = /\}$/.test(template) || byRole.includes(template);
          read(`appendix-fact:${appendix.item}:${template}`, whole ? wholeLineIn(from, to, fact) : pdfTextHasPhrase(body, fact), `"${appendix.heading}" states "${fact}"${whole ? ' as a line of its own' : ''}`);
        }
        if (appendix.rowLabel) {
          const rowLabel = squashPdf(appendix.rowLabel);
          const strangers = [];
          for (let index = from; index < to; index += 1) {
            if (!squashPdf(lines[index]).startsWith(rowLabel)) continue;
            const window = lines.slice(index, Math.min(to, index + WRAPPED_FACT_LINES));
            const known = expected.some((fact) => squashPdf(fact).startsWith(rowLabel) && headingBlocks(window, fact, WRAPPED_FACT_LINES).some((block) => block.start === 0));
            if (!known) strangers.push(lines[index].trim().slice(0, 120));
          }
          read(`appendix-rows:${appendix.item}`, strangers.length === 0, strangers.length ? `"${appendix.heading}" prints a "${appendix.rowLabel}" row the job does not expect: "${strangers[0]}"` : `every "${appendix.rowLabel}" row of "${appendix.heading}" is one the job expects`);
        }
      } else {
        const included = pdfTextHasPhrase(body, appendix.includedFact);
        const missing = squashPdf(body).startsWith(squashPdf(rule.appendices.missing));
        read(`appendix-content:${appendix.item}`, included || missing, `"${appendix.heading}" carries ${included ? `its fact "${appendix.includedFact}"` : missing ? `"${rule.appendices.missing}"` : 'neither its fact nor the missing words'}`);
      }
    }
    for (const fact of rule.appendices.roleFacts || []) {
      if (fact.roles.includes(journey.role)) read(`role-fact:${fact.item}`, pdfTextHasPhrase(bodyOf(fact.item), fact.phrase), `"${headings[fact.item]}" carries ${fact.name}`);
      else read(`role-fact-absent:${fact.item}`, !printsRefused(fact.phrase), `the PDF does not carry ${fact.name}, which only the ${fact.roles.join(' or ')} journey's PDF prints`);
    }
    // Tract data: the appendix prints the sentence that belongs to the run's own reading, and none that belongs to another.
    const { equity } = rule.appendices;
    if (equity) {
      const stated = journeyField(journey, equity.field);
      const body = bodyOf(equity.item);
      const known = Object.hasOwn(equity.values, stated);
      read('tract-data-value-known', known, `the run's tract data reading (${JSON.stringify(stated)}) is one the definition knows`);
      read('tract-data-label', pdfTextHasPhrase(body, equity.label), `"${headings[equity.item]}" prints a "${equity.label}" line`);
      if (known) {
        for (const [value, { meaning, sentences }] of Object.entries(equity.values)) {
          const found = sentences.filter((sentence) => pdfTextHasPhrase(body, sentence));
          if (value === stated) read(`tract-data-sentence:${value}`, sentences.length === 0 || found.length > 0, `"${headings[equity.item]}" says what belongs to a run where ${meaning}`);
          else read(`tract-data-sentence-absent:${value}`, found.length === 0, `"${headings[equity.item]}" does not say what belongs to a run where ${meaning}`);
        }
      }
    }
  }

  for (const phrase of rule.requiredPhrases || []) read(`required-phrase:${phrase}`, printsAnywhere(phrase), `the PDF prints "${phrase}"`);
  for (const phrase of rule.refusedPhrases.phrases) read(`refused-phrase:${phrase}`, !printsRefused(phrase), `the PDF does not print "${phrase}"`);
  const scores = scoreMatches(everywhere, rule);
  read('scores-are-openplan-screening-scores', scores.length === 0, scores.length ? `a score is printed under another label: "${scores[0]}"` : 'every printed score is under one of OpenPlan\'s two screening score labels');
  // A plain search: the shared matcher finds no phrase that ends in a bracket with a colon after it.
  const flatEverywhere = squashPdf(everywhere);
  read('screening-score-label-printed', rule.scores.labels.some((label) => flatEverywhere.includes(squashPdf(label))), 'the PDF prints an OpenPlan screening score label');

  return { readings, problems: readings.filter((reading) => !reading.ok).map((reading) => reading.detail), items, stampCount, draftLineCount: draftLines.length };
}

/**
 * Everything the record says about the exported PDF, and what the journey
 * read in it. Refuses a download that is not a PDF. `recordPath` is the
 * path the run file names it by, relative to the run's folder.
 */
function describeApplicationPdf({ pdfPath, recordPath, job = loadJobDefinition(), journey, readPages = first.pdfPages }) {
  const bytes = fs.readFileSync(pdfPath);
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('The application download is not a PDF.');
  const pages = readPages(pdfPath);
  const reading = readApplicationPdf({ pages, job, journey });
  return {
    pdf: {
      kind: job.application.pdf,
      path: recordPath,
      sha256: first.sha256(bytes),
      bytes: bytes.length,
      pages: pages.length,
      draftStamp: reading.draftLineCount > 0,
      items: reading.items,
    },
    reading,
    emailLocations: first.locateEmails(pages),
  };
}

// ---------------------------------------------------------------------------
// No public page
// ---------------------------------------------------------------------------

/**
 * Whether a request would open or read a public page. This job opens none:
 * it makes no engagement campaign and mints no share link. The journey
 * stops if its browser sends one.
 */
function isPublicPageRequest(url, method = 'GET') {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const { pathname } = parsed;
  if (/^\/engage(\/|$)/.test(pathname) || /^\/api\/engage(\/|$)/.test(pathname)) return true;
  if (/\/share-token$/.test(pathname)) return true;
  return method !== 'GET' && /^\/api\/engagement\/campaigns(\/|$)/.test(pathname);
}

// ---------------------------------------------------------------------------
// The run file and the record
// ---------------------------------------------------------------------------

/** What each journey leaves on the site it ran on, as the run file states it. */
const LEFT_ON_SITE = ['two accounts and their workspaces', 'one project with its study place', 'one crash retrieval and its crash records', 'one corridor analysis run', 'one tracked opportunity', 'one application with ten final sections and 26 checklist rows', 'one exported application PDF'];

/** The first account's identifying strings for the project page check: its project name, workspace name and project summary. */
function identifyingStrings({ projectName, workspaceName, projectSummary }) {
  const values = [projectName, workspaceName, projectSummary].map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean);
  return [...new Set(values)];
}

/** One journey, in the shape of $defs/applicationJourney in schemas/proven_job_record.v1.schema.json. */
function buildAtpJourney(state) {
  const application = state.application || {};
  return {
    role: state.role,
    place: state.place,
    executor: state.executor,
    accountCreatedAt: state.accountCreatedAt,
    confirmationMethod: state.confirmationMethod,
    health: state.health,
    projectName: state.projectName,
    workspaceName: state.workspaceName,
    crashes: state.crashes,
    application: {
      catalogKey: application.catalogKey,
      templateKey: application.templateKey,
      aiDraftingUsed: application.aiDraftingUsed,
      tractData: application.tractData,
      exportedAt: application.exportedAt,
      sections: application.sections,
      rows: application.rows,
      outstandingRequiredCount: application.outstandingRequiredCount,
    },
    pdfs: state.pdfs,
    screens: state.screens,
  };
}

/**
 * Write the run file. The job has no campaign, so no public address file is
 * written (journey-campaign-lib.js, writeRunFiles, with no portal path; it
 * still refuses a file that holds any public portal address). The file is
 * scrubbed with `scrub`, then refused if it still holds an email address, a
 * session or map token, or one of `secrets` (the passwords, the two account
 * addresses, the confirmation links and their tokens).
 */
function writeAtpRunFile({ outDir, role, result, scrub, secrets = [] }) {
  const serialized = scrub(JSON.stringify(result, null, 2));
  const held = secrets.filter((secret) => secret && secret.length >= 6 && serialized.includes(secret));
  if (held.length) throw new Error(`journey-${role}.json would hold ${held.length} of the run's secrets; it was not written.`);
  if (EMAIL_PATTERN.test(serialized)) throw new Error(`journey-${role}.json would hold an email address; it was not written.`);
  if (/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./.test(serialized) || /\b(?:pk|sk)\.eyJ/.test(serialized)) throw new Error(`journey-${role}.json would hold a token; it was not written.`);
  return campaign.writeRunFiles({ outDir, runFileName: `journey-${role}.json`, result: JSON.parse(serialized), scrub: (text) => text, origin: result.baseUrl, portalPath: null });
}

/**
 * Refuse a run file that cannot go into a record for this commit and origin:
 * it is this job's, made on the record's origin and finished; it names the
 * harness checkout it ran from; and, under the proof origin, it ran in proof
 * mode against the record's commit from a checkout with no uncommitted
 * change (first-job-journey-lib.js, assertRunAssemblable, holds the rule the
 * three assemblers share).
 */
function assertAtpRunAssemblable(run, { file, commit, baseUrl, proofOrigin }) {
  const name = path.basename(file);
  if (run.jobId !== JOB_ID) throw new Error(`${name} is a run of ${run.jobId}, not ${JOB_ID}.`);
  first.assertRunAssemblable(run, { file, commit, baseUrl, proofOrigin });
  const harness = run.harness || {};
  if (!/^[0-9a-f]{40}$/.test(String(harness.commit)) || typeof harness.clean !== 'boolean') throw new Error(`${name} names no harness checkout (commit and clean).`);
  if (new URL(baseUrl).origin === proofOrigin && harness.clean !== true) {
    throw new Error(`${name} ran from a harness checkout with uncommitted changes; a proof runs from a clean checkout.`);
  }
  if (!run.journey || !Array.isArray(run.journey.pdfs) || run.journey.pdfs.length !== 1) throw new Error(`${name} holds no exported application PDF.`);
}

/**
 * Combine three journey files into one record in the shape the checker
 * reads. Each journey carries its run's mode and harness checkout. Each
 * cross-workspace check, owner check and second account entry is named for
 * its journey, and an entry named for another journey refuses the assembly.
 * The limits are the definition's required limits in its own words, with the
 * page limit when a project page answered 200. `root`, when given, is the
 * folder the record's PDF paths are relative to.
 */
function assembleAtpRecord({ journeyFiles, commit, baseUrl, recordedOn, proofOrigin, root = null, job = loadJobDefinition() }) {
  if (typeof proofOrigin !== 'string' || !proofOrigin) throw new Error('Assembly needs the checker\'s proof origin.');
  const named = (entries, role, file, what) => (entries || []).map((entry) => {
    if (entry.journey !== undefined && entry.journey !== role) throw new Error(`${path.basename(file)} holds ${what} named for the ${entry.journey} journey, not its own ${role}.`);
    return { journey: role, ...entry };
  });
  const runs = journeyFiles.map((file) => {
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertAtpRunAssemblable(run, { file, commit, baseUrl, proofOrigin });
    const { role, ...rest } = run.journey;
    let pdfs = rest.pdfs;
    if (root) pdfs = pdfs.map((entry) => ({ ...entry, path: path.relative(root, path.resolve(path.dirname(file), entry.path)).split(path.sep).join('/') }));
    return {
      journey: { role, mode: run.mode, harness: { commit: run.harness.commit, clean: run.harness.clean }, ...rest, pdfs },
      checks: named(run.crossWorkspace.checks, role, file, 'a cross-workspace check'),
      ownerChecks: named(run.crossWorkspace.ownerChecks, role, file, 'an owner check'),
      secondAccounts: named(run.crossWorkspace.secondAccounts, role, file, 'a second account entry'),
    };
  });
  const roles = runs.map((run) => run.journey.role);
  const doubled = roles.find((role, index) => roles.indexOf(role) !== index);
  if (doubled) throw new Error(`Two run files are the ${doubled} journey; a record takes one of each.`);
  // Fields the definition says no two journeys may share, in its own words.
  for (const rule of job.distinctAcrossJourneys || []) {
    const seen = new Map();
    for (const run of runs) {
      const found = journeyField(run.journey, rule.field);
      const key = typeof found === 'string' ? squashPdf(found) : JSON.stringify(found);
      if (seen.has(key)) throw new Error(`${rule.refusal.split('{role}').join(run.journey.role).split('{otherRole}').join(seen.get(key)).split('{found}').join(String(found))}.`);
      seen.set(key, run.journey.role);
    }
  }
  const checks = runs.flatMap((run) => run.checks);
  const texts = job.limitTexts || {};
  const limit = (id) => {
    if (typeof texts[id] !== 'string' || !texts[id]) throw new Error(`The job's definition holds no words for the ${id} limit.`);
    return { id, text: texts[id] };
  };
  const limits = job.requiredLimits.map(limit);
  if (checks.some((check) => check.kind === 'page' && check.status === 200)) limits.push(limit(job.crossWorkspace.pageAnsweredOkLimit));
  return {
    schema: 'openplan.proven_job_record.v1',
    jobId: JOB_ID,
    commit,
    baseUrl: new URL(baseUrl).origin,
    recordedOn,
    journeys: runs.map((run) => run.journey),
    crossWorkspace: { checks, ownerChecks: runs.flatMap((run) => run.ownerChecks), secondAccounts: runs.flatMap((run) => run.secondAccounts) },
    limits,
  };
}

module.exports = {
  DEFAULT_ANALYSIS_QUESTION,
  JOB_ID,
  LEFT_ON_SITE,
  REHEARSAL_INPUTS_PATH,
  REHEARSAL_LABEL,
  applicationLines,
  assembleAtpRecord,
  assertAtpRunAssemblable,
  assertCaliforniaCrashFile,
  assertDemonstrationSentence,
  assertDraftCountAgrees,
  assertPlaceForRole,
  assertPrintableText,
  buildAtpJourney,
  californiaCrashFileName,
  checklistPlan,
  crashesForRecord,
  definitionRefusals,
  describeApplicationPdf,
  draftStampCount,
  formatYears,
  identifyingStrings,
  isPublicPageRequest,
  loadAtpInputs,
  loadJobDefinition,
  outstandingRequiredCount,
  parseAtpArgs,
  placeStatesListed,
  readApplicationPdf,
  rowsFromScreen,
  tractDataReading,
  validateAtpInputs,
  writeAtpRunFile,
};
