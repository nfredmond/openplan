// Pure helpers for award-job-journey.js, the fourth proven job's journey: a
// grant award taken to a reimbursement record. No browser and no server:
// every function here is unit-tested in award-job-journey.test.js. Helpers
// the other journeys already have are reused, not copied: the origin rule,
// scrubbing, the axe summary, Poppler pages and the place choice from
// first-job-journey-lib.js; the run file and harness checkout from
// journey-campaign-lib.js; the definition's per-journey rules, the place's
// listed states, the public-page rule, the stale link file stop and the
// screens stop from atp-job-journey-lib.js.
//
// Every limit here comes from the job's entry in
// schemas/proven_job_definitions.v1.json (grant-award-to-reimbursement-record-
// in-three-places): the roles and place kinds, the fixed demonstration
// amounts, the request paths and controls, the statuses the product
// partitions money by, the refusals and custody checks the record needs, and
// the words of each limit.
const fs = require('fs');
const path = require('path');
const first = require('./first-job-journey-lib');
const campaign = require('./journey-campaign-lib');
const atp = require('./atp-job-journey-lib');
const { repoRoot } = require('./harness-env');
const { pdfTextHasPhrase } = require('../openplan/scripts/lib/pdf-text-match.mjs');

const JOB_ID = 'grant-award-to-reimbursement-record-in-three-places';
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
 * The journey's arguments. Three accounts: the owner (--email), the member the
 * owner invites (--member-email) and the second workspace's account
 * (--second-email), each confirmed by the link written to its own file. The
 * role and place kind must be one of the job's journeys as its definition
 * states them. A confirmation link is never an argument. A proof names its
 * inputs, the commit it tests, all three link files and the agent and model
 * that ran it.
 */
function parseAwardArgs(argv, job = loadJobDefinition()) {
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
  if (out['confirm-link'] || out.link || out.token || out['invitation-link']) {
    throw new Error('A confirmation or invitation link is never taken as an argument. Write a confirmation link to the file named by its --*-confirm-link-file.');
  }
  const required = ['base-url', 'mode', 'place-query', 'place-kind', 'role', 'email', 'member-email', 'second-email', 'out'];
  const missing = required.filter((key) => typeof out[key] !== 'string' || !out[key].trim());
  if (missing.length) throw new Error(`Missing required arguments: ${missing.map((key) => `--${key}`).join(', ')}`);
  const rule = job.journeys.find((entry) => entry.role === out.role);
  if (!rule) throw new Error(`--role must be one of ${job.journeys.map((entry) => entry.role).join(', ')}, the journeys this job defines.`);
  if (out['place-kind'] !== rule.placeKind) throw new Error(`The ${out.role} journey needs --place-kind ${rule.placeKind}.`);
  const addresses = [out.email, out['member-email'], out['second-email']].map((value) => value.trim().toLowerCase());
  if (new Set(addresses).size !== 3) throw new Error('--email, --member-email and --second-email must be three different addresses.');
  if (!first.MODES.includes(out.mode)) throw new Error(`--mode must be one of ${first.MODES.join(', ')}. Received ${out.mode}.`);
  const expectedCommit = typeof out['expected-commit'] === 'string' ? out['expected-commit'].toLowerCase() : null;
  if (expectedCommit && !/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error('--expected-commit must be a 40-character commit.');
  if (out.mode === 'proof') {
    const needed = ['inputs', 'expected-commit', 'confirm-link-file', 'member-confirm-link-file', 'second-confirm-link-file', 'executor-agent', 'executor-model'];
    const absent = needed.filter((key) => typeof out[key] !== 'string' || !out[key].trim());
    if (absent.length) throw new Error(`A proof run needs ${absent.map((key) => `--${key}`).join(', ')}; rehearsal values and defaults never enter a proof.`);
  }
  const file = (key) => (typeof out[key] === 'string' ? path.resolve(out[key]) : null);
  return {
    baseUrl: out['base-url'],
    mode: out.mode,
    placeQuery: out['place-query'],
    placeKind: out['place-kind'],
    role: out.role,
    email: out.email,
    memberEmail: out['member-email'],
    secondEmail: out['second-email'],
    outDir: path.resolve(out.out),
    confirmLinkFile: file('confirm-link-file'),
    memberConfirmLinkFile: file('member-confirm-link-file'),
    secondConfirmLinkFile: file('second-confirm-link-file'),
    inputsFile: file('inputs'),
    expectedCommit,
    executorAgent: typeof out['executor-agent'] === 'string' ? out['executor-agent'] : 'Claude Code',
    executorModel: typeof out['executor-model'] === 'string' ? out['executor-model'] : 'claude-opus-5-5',
    confirmTimeoutMinutes: Number(out['confirm-timeout-minutes'] || 30),
    headed: out.headed === true,
  };
}

// ---------------------------------------------------------------------------
// Money and dates
// ---------------------------------------------------------------------------

/** Dollars and cents ("60000.00") in whole cents; refuses any other form. */
function cents(value, what = 'an amount') {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(String(value));
  if (!match) throw new Error(`${what} is ${JSON.stringify(value)}, not dollars and cents such as "60000.00".`);
  return (match[1] ? -1 : 1) * (Number(match[2]) * 100 + Number(match[3]));
}

/** Whole cents as the record's money string ("105000.00"). */
function money(amountCents) {
  const sign = amountCents < 0 ? '-' : '';
  const abs = Math.abs(amountCents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Whole cents as the product prints them ("$105,000.00"). */
function printed(amountCents) {
  const sign = amountCents < 0 ? '-' : '';
  const abs = Math.abs(amountCents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

/** A real calendar date in YYYY-MM-DD. */
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The calendar day of a moment in a time zone ("2026-11-17"). */
function dayIn(timeZone, moment = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(moment);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whether a time zone name is one this machine's Intl knows. */
function isTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(value) });
    return /\//.test(String(value));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Inputs: every string the journey types and every fixed figure
// ---------------------------------------------------------------------------

/** The labeled inputs a rehearsal uses when --inputs is not given: one place, a California county. */
const REHEARSAL_INPUTS_PATH = path.join(__dirname, 'fixtures', 'award-job-rehearsal-inputs.json');
/** Carried by the rehearsal fixture. A proof refuses any inputs file that holds it. */
const REHEARSAL_LABEL = 'Rehearsal inputs for the award to reimbursement journey, not an award.';
/** What the inputs give for the resubmission's invoice date: the date the product's Resubmit prefills. */
const PREFILLED = 'prefilled';

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const PLACEHOLDER_PATTERNS = [
  /\[(?:VERIFY|OPERATOR|insert|todo|tk|placeholder|your)\b/i,
  /\bTBD\b/,
  /\bto be (?:provided|determined|supplied|added|confirmed|completed|entered)\b/i,
  /\blorem ipsum\b/i,
  /\{\{|\}\}/,
  /_{3,}/,
  /\bX{3,}\b/,
];
/**
 * What reads as an amount in typed text. Wider than the checker's count on
 * purpose: a currency sign, a currency word, a number with cents, or a number
 * with a thousands comma. The checker refuses a record whose typed text holds
 * a dollar amount; the journey refuses the inputs before anything is typed.
 */
const AMOUNT_PATTERNS = [/[$＄¢€£]/, /\b(?:USD|US dollars?|dollars?|cents?)\b/i, /\d[.,]\d{2}\b/, /\d{1,3}(?:,\d{3})+/, /[０-９]/];

/** Refuse typed text that holds an email address, a placeholder or an amount. */
function assertTypedText(text, at, job = loadJobDefinition()) {
  const value = String(text);
  if (!value.trim()) throw new Error(`${at} is empty.`);
  if (EMAIL_PATTERN.test(value)) throw new Error(`${at} holds an email address.`);
  const placeholder = PLACEHOLDER_PATTERNS.find((pattern) => pattern.test(value));
  if (placeholder) throw new Error(`${at} holds a placeholder (${placeholder.source}).`);
  const amount = AMOUNT_PATTERNS.find((pattern) => pattern.test(value));
  if (amount) throw new Error(`${at} holds an amount (${amount.source}); typed text may hold none, so every amount on the worksheet is one the checker reads.`);
  for (const phrase of job.award.refusedPhrases.phrases) {
    if (pdfTextHasPhrase(value, phrase)) throw new Error(`${at} holds "${phrase}", which the job refuses on the worksheet.`);
  }
  const flat = value.replace(/[\s‐-―-]+/g, '').toLowerCase();
  for (const name of job.award.formNames.names) {
    if (flat.includes(name.replace(/[\s‐-―-]+/g, '').toLowerCase())) throw new Error(`${at} names the form "${name}", which the worksheet may not name.`);
  }
}

/**
 * The fixed demonstration figures, held to the definition: the ceiling, the
 * match and its posture, and each request's key, number, gross and retention
 * in the definition's order. Every figure must be exactly the definition's
 * string ("200000.00"); a run never types a figure of its own.
 */
function assertFixedFigures(inputs, job = loadJobDefinition()) {
  const { fixed } = job.award;
  const award = inputs.award || {};
  for (const field of ['ceiling', 'match', 'matchPosture']) {
    if (award[field] !== fixed[field]) throw new Error(`award.${field} is ${JSON.stringify(award[field])}; this job's fixed demonstration figure is ${JSON.stringify(fixed[field])}.`);
  }
  const requests = Array.isArray(inputs.requests) ? inputs.requests : [];
  if (requests.length !== fixed.requests.length) throw new Error(`requests lists ${requests.length}; this job's fixed requests are ${fixed.requests.map((entry) => entry.number).join(', ')}.`);
  fixed.requests.forEach((wanted, index) => {
    const given = requests[index] || {};
    for (const field of ['key', 'number', 'gross', 'retention']) {
      if (given[field] !== wanted[field]) throw new Error(`requests[${index}].${field} is ${JSON.stringify(given[field])}; this job's fixed ${wanted.key} request has ${JSON.stringify(wanted[field])}.`);
    }
  });
}

/**
 * The request dates, held to the definition's date rules before anything is
 * typed: every date a calendar date, the obligation on or before every
 * request's period, each period ending on or after it starts, each request
 * invoiced no earlier than its period starts and no later than `today` (it is
 * paid today, never before it is invoiced), due no earlier than invoiced, and
 * the resubmission claiming the period of the request it replaces, invoiced
 * no earlier (or on the date its Resubmit prefills, which is today).
 */
function assertRequestDates(inputs, job = loadJobDefinition(), today = first.utcNow().slice(0, 10)) {
  const obligatedOn = (inputs.award || {}).obligatedOn;
  if (!isCalendarDate(obligatedOn)) throw new Error(`award.obligatedOn is ${JSON.stringify(obligatedOn)}, not a calendar date.`);
  const byKey = new Map(inputs.requests.map((request) => [request.key, request]));
  for (const wanted of job.award.fixed.requests) {
    const request = byKey.get(wanted.key);
    const at = `requests.${wanted.key}`;
    for (const field of ['periodStart', 'periodEnd']) {
      if (!isCalendarDate(request[field])) throw new Error(`${at}.${field} is ${JSON.stringify(request[field])}, not a calendar date.`);
    }
    if (request.periodEnd < request.periodStart) throw new Error(`${at} period ends before it starts.`);
    if (obligatedOn > request.periodStart) throw new Error(`${at} period starts ${request.periodStart}, before the award was obligated on ${obligatedOn}.`);
    const prefilled = request.invoiceDate === PREFILLED;
    if (prefilled && !wanted.resubmits) throw new Error(`${at}.invoiceDate may be "${PREFILLED}" only for the resubmission, whose Resubmit prefills it.`);
    const invoiceDate = prefilled ? today : request.invoiceDate;
    if (!isCalendarDate(invoiceDate)) throw new Error(`${at}.invoiceDate is ${JSON.stringify(request.invoiceDate)}, not a calendar date.`);
    if (invoiceDate < request.periodStart) throw new Error(`${at} is invoiced ${invoiceDate}, before its period starts (${request.periodStart}).`);
    if (invoiceDate > today) throw new Error(`${at} is invoiced ${invoiceDate}, after today (${today}); it is paid today and never before it is invoiced.`);
    if (request.dueDate !== null && request.dueDate !== undefined) {
      if (!isCalendarDate(request.dueDate)) throw new Error(`${at}.dueDate is ${JSON.stringify(request.dueDate)}, not a calendar date.`);
      if (request.dueDate < invoiceDate) throw new Error(`${at} is due before it is invoiced.`);
    }
    if (wanted.resubmits) {
      const replaced = byKey.get(wanted.resubmits);
      if (request.periodStart !== replaced.periodStart || request.periodEnd !== replaced.periodEnd) throw new Error(`${at} must claim the period of the request it resubmits (${replaced.periodStart} to ${replaced.periodEnd}).`);
      if (invoiceDate < replaced.invoiceDate) throw new Error(`${at} is invoiced before the request it resubmits.`);
    }
  }
}

/**
 * Refuse inputs a journey cannot type honestly, in both modes.
 * - The fixed figures are the definition's (assertFixedFigures) and the dates
 *   follow its date rules (assertRequestDates).
 * - The project name and the award title carry the demonstration label; the
 *   three workspace names are demonstration names and differ.
 * - Every string the journey types and the worksheet or a screen prints (the
 *   workspace, project and award names, the project summary, the consultant,
 *   the rejection reason, the close-out note) holds no email address,
 *   placeholder, amount, refused phrase or form name (assertTypedText).
 * - The over-ceiling probe claims more than the ceiling by itself, so the
 *   product's ceiling check must refuse it.
 * - `timeZone` is a zone name; `role`, `placeKind` and `placeQuery`, when the
 *   file carries them, are the ones the run was started with.
 * A proof also refuses the rehearsal fixture's label.
 */
function validateAwardInputs(inputs, mode, { job = loadJobDefinition(), today = first.utcNow().slice(0, 10), run = null } = {}) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error('The inputs file is not a JSON object.');
  if (mode === 'proof') {
    const labeled = inputs.rehearsal === true || JSON.stringify(inputs).toLowerCase().includes(REHEARSAL_LABEL.toLowerCase());
    if (labeled) throw new Error(`The inputs file is labeled "${REHEARSAL_LABEL}" A proof needs its own inputs.`);
  }
  if (run) {
    for (const [key, given] of [['role', run.role], ['placeKind', run.placeKind], ['placeQuery', run.placeQuery]]) {
      if (inputs[key] !== undefined && inputs[key] !== given) throw new Error(`The inputs file is written for ${key} ${JSON.stringify(inputs[key])}, but the run was started with ${JSON.stringify(given)}.`);
    }
  }
  for (const key of ['organization', 'memberOrganization', 'secondOrganization', 'projectName', 'projectSummary', 'awardTitle', 'consultantName', 'rejectionReason', 'closeOutNote', 'timeZone']) {
    if (typeof inputs[key] !== 'string' || !inputs[key].trim()) throw new Error(`The inputs file needs ${key}.`);
  }
  assertFixedFigures(inputs, job);
  assertRequestDates(inputs, job, today);
  const label = job.award.demonstrationLabel.text;
  for (const key of ['projectName', 'awardTitle']) {
    if (!campaign.squash(inputs[key]).includes(campaign.squash(label))) throw new Error(`${key} must say "${label}", in rehearsal and in proof.`);
  }
  const names = ['organization', 'memberOrganization', 'secondOrganization'].map((key) => inputs[key].trim());
  names.forEach((name, index) => {
    if (!/demonstration/i.test(name)) throw new Error(`${['organization', 'memberOrganization', 'secondOrganization'][index]} must be a demonstration name (it must hold the word "demonstration").`);
  });
  if (new Set(names.map((name) => name.toLowerCase())).size !== 3) throw new Error('organization, memberOrganization and secondOrganization must be three different names.');
  if (names[2].toLowerCase().includes(names[0].toLowerCase())) throw new Error('secondOrganization contains the first workspace name, so the cross-workspace check could not tell the two apart.');
  for (const key of ['organization', 'memberOrganization', 'secondOrganization', 'projectName', 'projectSummary', 'awardTitle', 'consultantName', 'rejectionReason', 'closeOutNote']) {
    assertTypedText(inputs[key], key, job);
  }
  if (!isTimeZone(inputs.timeZone)) throw new Error(`timeZone ${JSON.stringify(inputs.timeZone)} is not a time zone name such as America/Los_Angeles.`);
  const probe = inputs.overCeilingProbe || {};
  if (typeof probe.number !== 'string' || !probe.number.trim()) throw new Error('The inputs file needs overCeilingProbe.number, the number of the unlinked draft the refused claim above the ceiling uses.');
  if (job.award.fixed.requests.some((request) => request.number === probe.number)) throw new Error('overCeilingProbe.number must differ from the fixed requests\' numbers.');
  if (cents(probe.gross, 'overCeilingProbe.gross') <= cents(job.award.fixed.ceiling)) throw new Error('overCeilingProbe.gross must be above the ceiling on its own, so the product\'s ceiling check refuses it.');
  return inputs;
}

/** Read and check the inputs: --inputs, or the labeled rehearsal file in rehearsal mode. */
function loadAwardInputs(mode, inputsFile, options = {}) {
  if (!inputsFile && mode === 'proof') throw new Error('A proof run needs --inputs.');
  const file = inputsFile || REHEARSAL_INPUTS_PATH;
  const bytes = fs.readFileSync(file);
  let inputs;
  try {
    inputs = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`The inputs file ${path.basename(file)} is not JSON.`);
  }
  return { inputs: validateAwardInputs(inputs, mode, options), file, sha256: first.sha256(bytes) };
}

// ---------------------------------------------------------------------------
// The place
// ---------------------------------------------------------------------------

/** Census state FIPS codes by postal code, for a tribal area's label ("NE--SD"). */
const FIPS_BY_USPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56', PR: '72',
};

/**
 * Stop unless the chosen place is one this journey's role may use, by the
 * definition's own rule for the role, and return the record's stateFips.
 * - `stateFips` (the county): the answer's state code is that state, the
 *   Census id begins with it and the label ends with the role's suffix.
 * - `stateFipsNotIn` (the city): the id has the kind's form, its first two
 *   digits name the state, and that state is not one with a profile of its own.
 * - `minStates` (the tribal area): the label closes with at least that many
 *   state letters, each a known state; the list is the journey's reading.
 */
function assertAwardPlaceForRole(item, role, job = loadJobDefinition()) {
  const rule = job.journeys.find((entry) => entry.role === role);
  if (!rule) throw new Error(`The job defines no ${role} journey.`);
  if (!item || item.kind !== rule.placeKind) throw new Error(`The ${role} journey needs a place of kind ${rule.placeKind}, found ${item ? item.kind : 'none'}.`);
  const listed = atp.placeStatesListed(item);
  const geoid = String(item.geoid || '');
  if (rule.labelSuffix && !String(item.label).endsWith(rule.labelSuffix)) throw new Error(`The label ${item.label} does not end with "${rule.labelSuffix}", as the ${role} journey's place must.`);
  if (rule.stateFips) {
    if (listed.stateFips.length !== 1 || listed.stateFips[0] !== rule.stateFips || !geoid.startsWith(rule.stateFips)) {
      throw new Error(`${item.label} (${geoid}) is not in the state with FIPS ${rule.stateFips}, where the ${role} journey's place must be.`);
    }
    return [rule.stateFips];
  }
  if (rule.stateFipsNotIn) {
    const pattern = job.geoidPatterns && job.geoidPatterns[rule.placeKind];
    if (pattern && !new RegExp(pattern).test(geoid)) throw new Error(`${item.label} has the id ${geoid}, not the form of a ${rule.placeKind} id.`);
    const state = geoid.slice(0, 2);
    if (listed.stateFips.length && listed.stateFips[0] !== state) throw new Error(`${item.label} (${geoid}) is listed in the state ${listed.stateFips[0]}, but its id begins with ${state}.`);
    if (rule.stateFipsNotIn.includes(state)) throw new Error(`${item.label} lies in the state with FIPS ${state}, which has a reimbursement profile of its own; the ${role} journey's place lies in a state with none.`);
    if (rule.censusNameRefused && new RegExp(rule.censusNameRefused.pattern).test(String(item.label).replace(/,\s*[A-Z]{2}$/, ''))) throw new Error(`${item.label} ${rule.censusNameRefused.refusal}.`);
    return [state];
  }
  if (rule.minStates) {
    const fips = listed.labelStates.map((letters) => FIPS_BY_USPS[letters]);
    if (fips.some((code) => !code)) throw new Error(`The label ${item.label} names a state this journey does not know.`);
    if (new Set(fips).size < rule.minStates) throw new Error(`The place search lists ${item.label} in ${fips.length} state(s); the ${role} journey's place is listed in at least ${rule.minStates}.`);
    return [...new Set(fips)].sort();
  }
  return listed.stateFips;
}

// ---------------------------------------------------------------------------
// The product's path for each request
// ---------------------------------------------------------------------------

/**
 * The move the product's control offers from a status, by the definition's
 * control words: the next status in the forward order and the button that
 * sends it (openplan/src/components/invoicing/invoice-status-advance-button.tsx
 * offers exactly one). Null when no forward move is offered.
 */
function offeredMove(status, job = loadJobDefinition()) {
  const { order, paid } = job.award.statuses;
  const index = order.indexOf(status);
  if (index < 0 || paid.includes(status) || index + 1 >= order.length) return null;
  const next = order[index + 1];
  return { status: next, control: job.award.controls.moves[next] };
}

/**
 * The statuses a journey moves a request through on the product's own
 * controls to reach `target` from `from`: one forward move at a time, each the
 * one the control offers. The product's control offers no move that skips a
 * status, so a path that does (draft straight to submitted) is not reachable
 * on screen; this returns the statuses the screen will pass through instead.
 */
function productPathTo(from, target, job = loadJobDefinition()) {
  const moves = [];
  let status = from;
  for (let guard = 0; guard < 10 && status !== target; guard += 1) {
    const move = offeredMove(status, job);
    if (!move) throw new Error(`The product offers no move from ${status} toward ${target}.`);
    moves.push(move);
    status = move.status;
  }
  if (status !== target) throw new Error(`The product's controls do not reach ${target} from ${from}.`);
  return moves;
}

/**
 * Where the definition's fixed path for a request differs from the path the
 * product's controls take (KI for lane 94): a list of the definition's
 * consecutive moves that skip a status the product's control stops at.
 */
function pathGaps(job = loadJobDefinition()) {
  const gaps = [];
  for (const request of job.award.fixed.requests) {
    for (let index = 1; index < request.path.length; index += 1) {
      const from = request.path[index - 1];
      const to = request.path[index];
      if (to === 'rejected') continue;
      const reached = productPathTo(from, to, job).map((move) => move.status);
      if (reached.length > 1) gaps.push({ number: request.number, from, to, product: reached });
    }
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// The award's position, recomputed (the journey's own check of each reading)
// ---------------------------------------------------------------------------

/**
 * The award's figures from the journey's own requests at a moment, with the
 * definition's status partition (the checker's awardPositionAt reads the same
 * lists). Each request counts in the last status its history holds at or
 * before `time`. Returns whole cents.
 */
function positionAt(state, time, job = loadJobDefinition()) {
  const { statuses } = job.award;
  const at = new Date(time).getTime();
  const position = { claimedGross: 0, paidNet: 0, outstandingNet: 0, outstandingCount: 0, rejectedGross: 0, drawnGross: 0, draftedNet: 0 };
  for (const request of state.requests) {
    const last = request.history.filter((entry) => new Date(entry.at).getTime() <= at).at(-1);
    if (!last) continue;
    const gross = cents(request.gross);
    const net = gross - cents(request.retention);
    const claimed = statuses.claimed.includes(last.status);
    if (claimed) position.claimedGross += gross;
    if (statuses.paid.includes(last.status)) position.paidNet += net;
    else if (claimed) {
      position.outstandingNet += net;
      position.outstandingCount += 1;
    }
    if (statuses.rejected.includes(last.status)) position.rejectedGross += gross;
    if (statuses.drawn.includes(last.status)) position.drawnGross += gross;
    if (statuses.draft.includes(last.status)) position.draftedNet += net;
  }
  const ceiling = cents(state.award.ceiling);
  position.ceiling = ceiling;
  position.match = cents(state.award.match);
  position.remaining = ceiling - position.claimedGross;
  position.awardedWhole = Math.round(ceiling / 100) * 100;
  position.drawnPercent = Math.round((position.drawnGross * 100) / ceiling);
  return position;
}

/** What a screen reading must say for each figure at the position, in the product's form. */
function expectedScreenFigure(figure, position) {
  if (figure === 'awardedWhole') return printed(position.awardedWhole).replace(/\.\d{2}$/, '');
  if (figure === 'drawnPercent') return `${position.drawnPercent}%`;
  return printed(position[figure]);
}

/** The figures a reading holds that differ from the position: [{ figure, read, expected }]. */
function screenFigureDifferences(reading, position, job = loadJobDefinition()) {
  const wanted = job.award.screenFigures.byScreen[reading.screen] || [];
  return wanted
    .map((figure) => ({ figure, read: reading.figures[figure] ?? null, expected: expectedScreenFigure(figure, position) }))
    .filter((entry) => entry.read !== entry.expected);
}

// ---------------------------------------------------------------------------
// Reading each screen's money
// ---------------------------------------------------------------------------

const AMOUNT = '(-?\\$[0-9][0-9,]*\\.[0-9]{2}|Not recorded)';
function findAmount(text, pattern) {
  const match = new RegExp(pattern.replace('{A}', AMOUNT)).exec(String(text).replace(/\s+/g, ' '));
  return match ? match[1] : null;
}

/**
 * The Funding tab's figures for one award, from the text of the award's own
 * row (project-funding-panel.tsx): the claim progress line ("recorded award
 * ceiling $X · claimed $X gross · paid $X net · $X not yet claimed"), the
 * award line ("Match $X", "Outstanding $X") and the linked chain ("$X
 * rejected, not counted"). A figure the row does not print is null, never
 * zero.
 */
function readFundingTabFigures(rowText) {
  return {
    ceiling: findAmount(rowText, 'recorded award ceiling {A}'),
    match: findAmount(rowText, '\\bMatch {A}'),
    claimedGross: findAmount(rowText, '\\bclaimed {A} gross'),
    paidNet: findAmount(rowText, '\\bpaid {A} net'),
    outstandingNet: findAmount(rowText, '\\bOutstanding {A}'),
    rejectedGross: findAmount(rowText, '{A} rejected, not counted'),
    remaining: findAmount(rowText, '{A} not yet claimed'),
  };
}

/**
 * Grants, Awards tab: the project's chips (grants-awards-reimbursement-
 * section.tsx): "Recorded award ceilings $X", "Match $X", "Requested $X",
 * "Paid $X", "Outstanding $X". `itemText` is the project's own entry.
 */
function readGrantsAwardsFigures(itemText) {
  return {
    ceiling: findAmount(itemText, 'Recorded award ceilings {A}'),
    match: findAmount(itemText, '\\bMatch {A}'),
    claimedGross: findAmount(itemText, '\\bRequested {A}'),
    paidNet: findAmount(itemText, '\\bPaid {A}'),
    outstandingNet: findAmount(itemText, '\\bOutstanding {A}'),
  };
}

/**
 * The Invoices register's summary (reimbursement-lane.tsx): "Net requested
 * $X", "Outstanding $X", "Paid $X" and "holding $X the funder refused".
 * `summaryText` is the summary block's text, each card's label on its own
 * line above its value.
 */
function readRegisterFigures(summaryText) {
  return {
    claimedGross: findAmount(summaryText, '\\bNet requested {A}'),
    outstandingNet: findAmount(summaryText, '\\bOutstanding {A}'),
    paidNet: findAmount(summaryText, '\\bPaid {A}'),
    rejectedGross: findAmount(summaryText, 'holding {A} the funder refused'),
  };
}

/** The dashboard's Awarded figure ("$200,000") and its share drawn ("53% drawn"), from the figure's own text. */
function readDashboardFigures(figureText) {
  const flat = String(figureText).replace(/\s+/g, ' ');
  const awarded = /Awarded\s*(-?\$[0-9][0-9,]*)(?![0-9.,])/.exec(flat);
  const drawn = /\b([0-9]+%) drawn\b/.exec(flat);
  return { awardedWhole: awarded ? awarded[1] : null, drawnPercent: drawn ? drawn[1] : null };
}

// ---------------------------------------------------------------------------
// The database's custody
// ---------------------------------------------------------------------------

/**
 * Whether one direct PostgREST write was refused in a way the definition
 * counts: a listed status with its code (the database refused it), or, for an
 * account and target the definition lists under noRow, a listed status with
 * no code and no row changed (row security hid the row). A 200 or 204 from an
 * account that is not listed is a write that went through, whatever changed.
 */
function custodyRefused({ account, target, status, code, rowsChanged }, job = loadJobDefinition()) {
  const { custody } = job.award;
  if (rowsChanged !== 0) return false;
  if (custody.refusals.some((pair) => pair.status === status && pair.code === code)) return true;
  const hidden = custody.noRow.find((entry) => entry.account === account && entry.target === target);
  return Boolean(hidden) && hidden.statuses.includes(status) && code === null;
}

/**
 * The record's row for one direct write: the status, the database's error
 * code (null when it gave none), how many rows the answer returned as changed
 * and whether the row read back unchanged. The status is the one the
 * database answered; it is never set by the caller's reading of it.
 */
function custodyRow({ account, target, response, before, after }) {
  let body = null;
  try {
    body = JSON.parse(response.text);
  } catch {
    body = null;
  }
  const code = body && !Array.isArray(body) && typeof body.code === 'string' ? body.code : null;
  const rowsChanged = response.status >= 200 && response.status < 300 && Array.isArray(body) ? body.length : 0;
  return { account, target, status: response.status, code, rowsChanged, unchangedOnReadBack: JSON.stringify(before) === JSON.stringify(after) };
}

// ---------------------------------------------------------------------------
// The worksheet PDFs
// ---------------------------------------------------------------------------

/**
 * Everything the record says about one worksheet download: its SHA-256,
 * size, page count, the pages its two section headings stand on, and no
 * DRAFT stamp. Refuses a download that is not a PDF or lacks a heading.
 */
function describeWorksheetPdf({ pdfPath, recordPath, kind, job = loadJobDefinition(), readPages = first.pdfPages }) {
  const bytes = fs.readFileSync(pdfPath);
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`The ${kind} download is not a PDF.`);
  const pages = readPages(pdfPath);
  const headings = job.itemHeadings[kind];
  const items = Object.entries(job.items).map(([item, method]) => {
    const heading = headings[item];
    const page = pages.findIndex((text) => pdfTextHasPhrase(text, heading));
    if (page < 0) throw new Error(`The ${kind} worksheet does not print the heading "${heading}".`);
    return { item, page: page + 1, method, text: heading };
  });
  return {
    pdf: { kind, path: recordPath, sha256: first.sha256(bytes), bytes: bytes.length, pages: pages.length, draftStamp: false, items },
    pages,
    emailLocations: first.locateEmails(pages),
    fallback: pages.some((text) => pdfTextHasPhrase(text, job.award.worksheet.fallbackNotice)),
  };
}

// ---------------------------------------------------------------------------
// The run file and the record
// ---------------------------------------------------------------------------

/** What each journey leaves on the site it ran on, as the run file states it. */
const LEFT_ON_SITE = [
  'three accounts (the owner, the member and the second account) and their three workspaces',
  'the member\'s membership in the owner\'s workspace',
  'one project with its study place and the workspace\'s place and time zone',
  'one tracked opportunity (SS4A)',
  'one award, closed out with its balance released',
  'three reimbursement requests (INV-1 paid, INV-2 rejected, INV-2A paid)',
  'one unlinked draft request from the refused claim above the ceiling',
  'two worksheet downloads (nothing is stored on the site for them)',
];

/** One journey, in the shape of $defs/awardJourney in schemas/proven_job_record.v1.schema.json (mode and harness are added at assembly). */
function buildAwardJourney(state) {
  return {
    role: state.role,
    place: state.place,
    executor: state.executor,
    accountCreatedAt: state.accountCreatedAt,
    confirmationMethod: state.confirmationMethod,
    health: state.health,
    projectName: state.projectName,
    workspaceName: state.workspaceName,
    reimbursementProfile: state.reimbursementProfile,
    award: state.award,
    requests: state.requests,
    closeOut: state.closeOut,
    downloads: state.downloads,
    costEntryCount: state.costEntryCount,
    screenReadings: state.screenReadings,
    memberAccount: state.memberAccount,
    refusals: state.refusals,
    custody: state.custody,
    pdfs: state.pdfs,
    screens: state.screens,
  };
}

/** A Supabase key or a session token in any of its forms. */
const KEY_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./,
  /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}/,
  /\b(?:pk|sk)\.eyJ/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /\/invitations\/[A-Za-z0-9_-]{16,}/,
];

/**
 * Write the run file. It is scrubbed with `scrub`, then refused if it still
 * holds one of `secrets` (the three passwords and addresses, the confirmation
 * and invitation links and their tokens, the session tokens and the public
 * key), an email address, a key or session token in any form, or an
 * invitation link. No public address file is written: the job opens no
 * public page.
 */
function writeAwardRunFile({ outDir, role, result, scrub, secrets = [] }) {
  const name = `journey-${role}.json`;
  const serialized = scrub(JSON.stringify(result, null, 2));
  const held = secrets.filter((secret) => secret && secret.length >= 6 && serialized.includes(secret));
  if (held.length) throw new Error(`${name} would hold ${held.length} of the run's secrets; it was not written.`);
  if (EMAIL_PATTERN.test(serialized)) throw new Error(`${name} would hold an email address; it was not written.`);
  const key = KEY_PATTERNS.find((pattern) => pattern.test(serialized));
  if (key) throw new Error(`${name} would hold a key, a session token or an invitation link (${key.source.slice(0, 24)}); it was not written.`);
  return campaign.writeRunFiles({ outDir, runFileName: name, result: JSON.parse(serialized), scrub: (text) => text, origin: result.baseUrl, portalPath: null });
}

/**
 * Refuse a run file that cannot go into a record for this commit and origin:
 * it is this job's, made on the record's origin and finished; it names the
 * harness checkout it ran from; and, under the proof origin, it ran in proof
 * mode against the record's commit from a clean checkout
 * (first-job-journey-lib.js, assertRunAssemblable, holds the shared rule). It
 * must hold the two worksheet PDFs.
 */
function assertAwardRunAssemblable(run, { file, commit, baseUrl, proofOrigin, job = loadJobDefinition() }) {
  const name = path.basename(file);
  if (run.jobId !== JOB_ID) throw new Error(`${name} is a run of ${run.jobId}, not ${JOB_ID}.`);
  first.assertRunAssemblable(run, { file, commit, baseUrl, proofOrigin });
  const harness = run.harness || {};
  if (!/^[0-9a-f]{40}$/.test(String(harness.commit)) || typeof harness.clean !== 'boolean') throw new Error(`${name} names no harness checkout (commit and clean).`);
  if (new URL(baseUrl).origin === proofOrigin && harness.clean !== true) throw new Error(`${name} ran from a harness checkout with uncommitted changes; a proof runs from a clean checkout.`);
  const kinds = ((run.journey && run.journey.pdfs) || []).map((entry) => entry.kind);
  if (JSON.stringify(kinds) !== JSON.stringify(job.pdfs)) throw new Error(`${name} holds the PDFs ${kinds.join(', ') || 'none'}; this job's journey holds ${job.pdfs.join(', ')}.`);
}

/**
 * Combine three journey files into one record in the shape the checker
 * reads, in the definition's journey order. Each journey carries its run's
 * mode and harness checkout. Each cross-workspace check, owner check and
 * second account entry is named for its journey; an entry named for another
 * journey refuses the assembly. The limits are exactly the definition's
 * required limits in its own words, with the page limit when a Funding tab
 * answered 200; no other limit is written (limitIdsClosed). `root`, when
 * given, is the folder the record's PDF paths are relative to.
 */
function assembleAwardRecord({ journeyFiles, commit, baseUrl, recordedOn, proofOrigin, root = null, job = loadJobDefinition() }) {
  if (typeof proofOrigin !== 'string' || !proofOrigin) throw new Error('Assembly needs the checker\'s proof origin.');
  if (!/^[0-9a-f]{40}$/.test(String(commit))) throw new Error('Assembly needs --commit, a 40-character commit.');
  const named = (entries, role, file, what) => (entries || []).map((entry) => {
    if (entry.journey !== undefined && entry.journey !== role) throw new Error(`${path.basename(file)} holds ${what} named for the ${entry.journey} journey, not its own ${role}.`);
    return { journey: role, ...entry };
  });
  const runs = journeyFiles.map((file) => {
    const run = JSON.parse(fs.readFileSync(file, 'utf8'));
    assertAwardRunAssemblable(run, { file, commit, baseUrl, proofOrigin, job });
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
  const order = job.journeys.map((entry) => entry.role);
  const missing = order.filter((role) => !roles.includes(role));
  if (missing.length) throw new Error(`No run file is the ${missing.join(' or ')} journey; a record takes one of each.`);
  runs.sort((a, b) => order.indexOf(a.journey.role) - order.indexOf(b.journey.role));
  for (const rule of job.distinctAcrossJourneys || []) {
    const seen = new Map();
    for (const run of runs) {
      const found = rule.field.split('.').reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), run.journey);
      const key = typeof found === 'string' ? campaign.squash(found) : JSON.stringify(found);
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
  FIPS_BY_USPS,
  JOB_ID,
  LEFT_ON_SITE,
  PREFILLED,
  REHEARSAL_INPUTS_PATH,
  REHEARSAL_LABEL,
  assembleAwardRecord,
  assertAwardPlaceForRole,
  assertAwardRunAssemblable,
  assertFixedFigures,
  assertRequestDates,
  assertTypedText,
  buildAwardJourney,
  cents,
  custodyRefused,
  custodyRow,
  dayIn,
  describeWorksheetPdf,
  expectedScreenFigure,
  isCalendarDate,
  isTimeZone,
  loadAwardInputs,
  loadJobDefinition,
  money,
  offeredMove,
  parseAwardArgs,
  pathGaps,
  positionAt,
  printed,
  productPathTo,
  readDashboardFigures,
  readFundingTabFigures,
  readGrantsAwardsFigures,
  readRegisterFigures,
  screenFigureDifferences,
  validateAwardInputs,
  writeAwardRunFile,
};
