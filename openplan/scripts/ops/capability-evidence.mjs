import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { joinLetterSpacing, normalizePdfText, pdfTextHasPhrase } from "../lib/pdf-text-match.mjs";
import { MAP_RENDER_DPI, MIN_RED_PIXELS, analyzePpm, popplerPagePpm } from "../lib/poppler-pixels.mjs";
import { assertPopplerTool, popplerPdfPages } from "../lib/poppler-text.mjs";

/**
 * The one origin whose pages count as proof of a hosted job. A local,
 * preview or fork origin can be a good rehearsal, but it is not the hosted
 * installation the direction review asks about.
 */
export const PROOF_ORIGIN = "https://openplan-zeta.vercel.app";

const SCHEMA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas");
const RECORD_SCHEMA_ID = "openplan.proven_job_record.v1";
const RECORD_SCHEMA = JSON.parse(readFileSync(resolve(SCHEMA_DIR, "proven_job_record.v1.schema.json"), "utf8"));
const JOB_DEFINITIONS = JSON.parse(readFileSync(resolve(SCHEMA_DIR, "proven_job_definitions.v1.json"), "utf8"));
const PROVEN_JOB_ENTRY_FIELDS = new Set(["jobId", "places", "commit", "reviewedAt", "evidence"]);

/**
 * The statuses that show the app refused a signed-in second account another
 * workspace's record. The report download and the application export answer
 * 404 for a record they cannot find and 403 for "Workspace access denied".
 * The report page calls notFound() after its loading screen has streamed, so
 * it answers 200 with the not-found screen (checkCrossWorkspace). A 401 means the second
 * account was not signed in, a 5xx means the handler failed before it decided,
 * and a 400 or 422 either never reached the workspace check or came after it
 * passed, so none of them is evidence of isolation.
 */
const CROSS_WORKSPACE_REFUSAL_STATUSES = new Set([403, 404]);

/** For an anonymous participant: not signed in (401), access denied (403) or not found (404). */
const PARTICIPANT_REFUSAL_STATUSES = new Set([401, 403, 404]);

/**
 * Validate the dated, exact-byte records behind proven coverage cells and
 * proven jobs. Cells are checked for custody and review dates only; a proven
 * job entry also has its record read and checked by validateProvenJobRecord.
 * A reviewer must still judge whether the records prove the planning outcome.
 * @param {{reviewedAt: string, dimensions: Record<string, Array<{id: string, status: string, reviewedAt?: string, evidence?: Array<{path: string, sha256: string}>}>>, provenJobs?: Array<Record<string, unknown>>}} registry
 * @param {string} repoRoot
 * @param {string} today
 * @param {{readPdfPages?: (absolutePath: string) => string[], renderPdfPage?: (absolutePath: string, page: number) => Uint8Array, readWorkbook?: (absolutePath: string) => Record<string, unknown[][]>, censusNames?: boolean}} [options]
 */
export function validateCapabilityEvidence(registry, repoRoot, today, options = {}) {
  const root = realpathSync(repoRoot);
  for (const [dimension, cells] of Object.entries(registry.dimensions)) {
    for (const cell of cells) {
      if (cell.status !== "proven") continue;
      const label = `proven cell ${dimension}/${cell.id}`;
      checkReviewDate(cell.reviewedAt, registry.reviewedAt, today, label);
      readEvidenceList(cell.evidence, root, label);
    }
  }

  const jobs = registry.provenJobs ?? [];
  if (!Array.isArray(jobs)) throw new Error("registry provenJobs must be a list");
  const jobIds = new Set();
  for (const entry of jobs) {
    const label = `proven job ${entry?.jobId ?? "without an id"}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} is not an object`);
    for (const key of Object.keys(entry)) {
      if (!PROVEN_JOB_ENTRY_FIELDS.has(key)) throw new Error(`${label} has unknown field ${key}`);
    }
    if (typeof entry.jobId !== "string" || !entry.jobId) throw new Error(`${label} needs a job id`);
    if (jobIds.has(entry.jobId)) throw new Error(`${label} is listed twice`);
    jobIds.add(entry.jobId);
    checkReviewDate(entry.reviewedAt, registry.reviewedAt, today, label);
    const files = readEvidenceList(entry.evidence, root, label);
    const records = files.filter(({ path, bytes }) => path.endsWith(".json") && parsedSchema(bytes) === RECORD_SCHEMA_ID);
    if (records.length !== 1) {
      throw new Error(`${label} needs exactly one ${RECORD_SCHEMA_ID} record among its evidence, found ${records.length}`);
    }
    const record = JSON.parse(records[0].bytes.toString("utf8"));
    validateProvenJobRecord(record, {
      repoRoot: root,
      readPdfPages: options.readPdfPages,
      renderPdfPage: options.renderPdfPage,
      readWorkbook: options.readWorkbook,
      censusNames: options.censusNames === true,
    });
    if (record.jobId !== entry.jobId) throw new Error(`${label} names a record for ${record.jobId}`);
    if (record.commit !== entry.commit) throw new Error(`${label} commit does not match its record`);
    const recordPlaces = record.journeys.map(({ place }) => ({ kind: place.kind, geoid: place.geoid, stateFips: place.stateFips }));
    if (JSON.stringify(entry.places) !== JSON.stringify(recordPlaces)) {
      throw new Error(`${label} places do not match its record's journeys (kind, geoid, stateFips, in journey order)`);
    }
  }
}

/**
 * Refuse a proven job record unless it satisfies the record schema (the
 * common fields plus its job's sub-schema, chosen by jobId) and its job's
 * rules in schemas/proven_job_definitions.v1.json, its PDFs and workbooks are
 * the committed bytes it names, and neither the record nor any PDF page or
 * workbook cell carries a secret or an email address. Throws on the first
 * refusal; returns nothing.
 *
 * Rules that hold for every job live in this file: the hosted origin, one
 * commit read back at the start and end of each journey, the place rules,
 * agent executors (the definitions' executors block), a record date that
 * fits its journeys (recordedOn block), artifact custody, no DRAFT stamp
 * (unless the job's definition requires one, as the application job's does),
 * accessibility rows at the stated widths and modes, the cross-workspace
 * rule, required limits and the string scans. What one job needs because of what that job is (a saved
 * benefit-cost analysis, a crash source, a campaign's count agreement, what
 * an application PDF must state) is data in that job's definition entry,
 * read by the generic rules below (checkJourneyFields, the sourceCheck
 * block, checkCampaign, checkApplication).
 *
 * Blind category: this proves required parts are present, agree with each
 * other and are bound to one commit. It cannot tell whether the PDFs are
 * useful to a planner, whether the red marks on a map page are the right
 * place's ranked segments, or whether a label names the place whose Census
 * id it carries.
 * @param {unknown} record
 * @param {{repoRoot: string, readPdfPages?: (absolutePath: string) => string[], renderPdfPage?: (absolutePath: string, page: number) => Uint8Array, readWorkbook?: (absolutePath: string) => Record<string, unknown[][]>, censusNames?: boolean}} options
 *   readPdfPages and renderPdfPage default to Poppler's pdftotext and pdftoppm; tests may pass stand-ins.
 */
export function validateProvenJobRecord(record, { repoRoot, readPdfPages = pdftotextPages, renderPdfPage = pdftoppmPagePpm, readWorkbook = xlsxSheets, censusNames = false }) {
  const root = realpathSync(repoRoot);
  checkSchema(record, RECORD_SCHEMA, "record", RECORD_SCHEMA);
  scanStrings(record, "record");

  const job = JOB_DEFINITIONS.jobs.find((candidate) => candidate.id === record.jobId);
  if (!job) refuse(`record names unknown job ${record.jobId}`);
  if (record.baseUrl !== PROOF_ORIGIN) {
    refuse(`baseUrl ${record.baseUrl} is not the hosted origin ${PROOF_ORIGIN}; a local or preview run is not proof`);
  }

  const roles = record.journeys.map((journey) => journey.role);
  for (const expected of job.journeys) {
    const count = roles.filter((role) => role === expected.role).length;
    if (count !== 1) refuse(`record needs exactly one ${expected.role} journey, found ${count}`);
  }
  if (roles.length !== job.journeys.length) refuse(`record has journeys this job does not define: ${roles.join(", ")}`);

  // Before any file is read: the record may not name the same PDF bytes twice.
  // Each hash is then recomputed from its committed file by checkPdfs.
  if (job.distinctPdfs) checkDistinctPdfs(record.journeys);

  const artifactPaths = new Set();
  for (const journey of record.journeys) {
    const rule = job.journeys.find((candidate) => candidate.role === journey.role);
    const label = `${journey.role} journey`;
    checkPlace(journey.place, rule, job, label);
    // Real records only: the direction check sets this for every record in the
    // registry. Synthetic examples use ids the Census Bureau does not list, on
    // purpose, so they name no real place.
    if (censusNames) checkPlaceName(journey.place, label);
    checkExecutors(journey, job, label);

    const points = journey.health.map((reading) => reading.point);
    for (const point of ["start", "end"]) {
      if (points.filter((candidate) => candidate === point).length !== 1) {
        refuse(`${label} needs exactly one ${point} health readback`);
      }
    }
    for (const reading of journey.health) {
      if (reading.commit.length < 12 || !record.commit.startsWith(reading.commit)) {
        refuse(`${label} ${reading.point} health readback reports commit ${reading.commit}, not ${record.commit}`);
      }
    }

    checkJourneyFields(journey, rule.fields, label);
    checkJourneyFields(journey, job.journeyFields, label);
    if (job.campaign) checkClose(journey, label);
    checkNewRecordRules(record, journey, job, label);
    if (job.health) checkHealthRule(journey, job, label);

    // A campaign job's own record is checked first; its rejected texts are
    // then searched as each file is read, before any other rule can refuse
    // the file for something else.
    const campaignRecord = job.campaign ? checkCampaignRecord(journey, job, label) : undefined;
    const search = job.campaign ? rejectedTextSearch(journey, job, label) : undefined;
    const pages = checkPdfs(journey, job, label, root, readPdfPages, renderPdfPage, artifactPaths, search?.pdf);
    const workbooks = checkWorkbooks(journey, job, label, root, readWorkbook, artifactPaths, search?.workbook);
    checkScreens(journey, job, label);
    if (job.campaign) checkCampaign(journey, job, label, workbooks, pages, campaignRecord);
    if (job.application) checkApplication(journey, job, label, pages);
  }
  if (job.campaign) checkDistinctCampaigns(record.journeys);
  checkSameAcrossJourneys(record.journeys, job);
  checkRecordedOn(record);

  const pageAnsweredOk = checkCrossWorkspace(record.crossWorkspace.checks, job.crossWorkspace, roles);
  checkCrossWorkspaceControls(record.crossWorkspace, job.crossWorkspace, roles);
  if (job.participantChecks) checkParticipantChecks(record.participantChecks, job.participantChecks, roles);

  const requiredLimits = [...job.requiredLimits];
  if (job.sourceCheck) {
    // An independent count from the source's own query tool, when the job
    // has one. The subject names it ("crash"); the limit is what the record
    // must say when the count was not confirmed.
    const { sourceCheck } = record;
    const { subject } = job.sourceCheck;
    if (sourceCheck.status === "differs") refuse(`the ${subject} source check found different counts; that is a finding, not a pass`);
    if (sourceCheck.status !== "not-run" && (!sourceCheck.url || !sourceCheck.checkedOn)) {
      refuse(`a ${subject} source check needs the query URL and the date it was run`);
    }
    if (sourceCheck.status === "matched" && job.sourceCheck.matched) checkMatchedSource(sourceCheck, job.sourceCheck, subject);
    if (sourceCheck.status !== "matched") requiredLimits.push(job.sourceCheck.unconfirmedLimit);
  }
  const limitIds = new Set(record.limits.map((limit) => limit.id));
  if (pageAnsweredOk) requiredLimits.push(job.crossWorkspace.pageAnsweredOkLimit);
  for (const id of requiredLimits) {
    if (!limitIds.has(id)) refuse(`record does not state the ${id} limit`);
  }
  checkLimitTexts(record.limits, job);
}

/**
 * A job's per-journey value rules, from its definition: each names a dotted
 * field of the journey and what it must hold (`equals` a value, be `atLeast`
 * a number, or hold `minItems` entries in a list), and the refusal to give
 * otherwise. `{found}` and `{expected}` in the refusal take the journey's
 * value (for a list, its length) and the rule's.
 */
function checkJourneyFields(journey, rules, label) {
  for (const rule of rules ?? []) {
    let found = journeyField(journey, rule.field);
    let expected;
    let holds;
    if (Object.hasOwn(rule, "equals")) {
      expected = rule.equals;
      holds = found === rule.equals;
    } else if (Object.hasOwn(rule, "atLeast")) {
      expected = rule.atLeast;
      holds = typeof found === "number" && found >= rule.atLeast;
    } else if (Object.hasOwn(rule, "minItems")) {
      expected = rule.minItems;
      holds = Array.isArray(found) && found.length >= rule.minItems;
      if (Array.isArray(found)) found = found.length;
    } else {
      throw new Error(`job definition rule for ${rule.field} needs equals, atLeast or minItems`);
    }
    if (!holds) refuse(`${label} ${rule.refusal.replaceAll("{found}", String(found)).replaceAll("{expected}", String(expected))}`);
  }
}

/** A dotted field of a journey ("application.exportedAt"), or undefined. */
function journeyField(journey, field) {
  return field.split(".").reduce((value, key) => (value == null ? undefined : value[key]), journey);
}

/**
 * Fields the definition says every journey of a record must share
 * (`sameAcrossJourneys`): one harness checkout for the application job. The
 * refusal takes {role}, {found}, {firstRole} and {expected}.
 */
function checkSameAcrossJourneys(journeys, job) {
  for (const rule of job.sameAcrossJourneys ?? []) {
    const first = journeys[0];
    const expected = journeyField(first, rule.field);
    for (const journey of journeys.slice(1)) {
      const found = journeyField(journey, rule.field);
      if (found === expected) continue;
      refuse(
        rule.refusal
          .replaceAll("{role}", journey.role)
          .replaceAll("{firstRole}", first.role)
          .replaceAll("{found}", String(found))
          .replaceAll("{expected}", String(expected)),
      );
    }
  }
}

/**
 * Each journey exported its own PDF (`distinctPdfs`): no two PDFs of a record
 * are the same bytes. This compares the hashes the record states; checkPdfs
 * then recomputes each one from its committed file, so two entries with
 * different hashes cannot point at the same bytes either.
 *
 * Blind category: one PDF with a byte appended has another hash. The place
 * line rule is what refuses that copy: its text names another journey's place.
 */
function checkDistinctPdfs(journeys) {
  const seen = new Map();
  for (const journey of journeys) {
    for (const pdf of journey.pdfs) {
      const other = seen.get(pdf.sha256);
      if (other) {
        refuse(`the ${journey.role} journey's ${pdf.kind} PDF is the same bytes as the ${other.role} journey's ${other.kind} PDF (SHA-256 ${pdf.sha256}); each journey exports its own`);
      }
      seen.set(pdf.sha256, { role: journey.role, kind: pdf.kind });
    }
  }
}

/**
 * A job's rules for records made from a date on (its `newRecordRules`): a
 * record whose recordedOn is on or after `recordedOnOrAfter` must meet the
 * block's journeyFields and, with `checkClose`, the close reading every
 * campaign job gets. A record dated earlier is checked as it was when it was
 * recorded. The fields are checked before the close, so a journey with no
 * close is refused by name rather than by a missing value.
 *
 * Blind category: recordedOn is the assembler's statement, not a signed
 * time. A new record given an earlier date escapes these rules; the
 * registry's pinned bytes and its review date are what tie a record to when
 * it was made.
 */
function checkNewRecordRules(record, journey, job, label) {
  const rules = job.newRecordRules;
  if (!rules) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rules.recordedOnOrAfter))) {
    throw new Error(`job definition ${job.id} newRecordRules needs recordedOnOrAfter as a date`);
  }
  if (record.recordedOn < rules.recordedOnOrAfter) return;
  checkJourneyFields(journey, rules.journeyFields, label);
  if (rules.checkClose) checkClose(journey, label);
}

/**
 * How a campaign journey closed its campaign, as its run file recorded it
 * (review 59, journey finding 8): the save answered 200, the status read
 * back is closed, at least one public address was read afterward as a
 * participant and each showed the ended notice and none of the campaign's
 * own text, and the public portal read afterward did not answer 200 with
 * the campaign's text.
 *
 * Blind category: every value here is the journey's reading of live
 * screens. The checker cannot read the closed portal again.
 */
function checkClose(journey, label) {
  const { close } = journey;
  if (close.attempted !== true) refuse(`${label} did not try to close its campaign`);
  if (close.saveStatus !== 200) refuse(`${label} campaign close was saved with status ${close.saveStatus}, not 200`);
  if (close.statusAfter !== "closed") refuse(`${label} campaign status read ${close.statusAfter} after the close, not closed`);
  if (close.addresses.length === 0) refuse(`${label} read no public address after closing its campaign`);
  for (const address of close.addresses) {
    if (address.endedNoticeShown !== true) refuse(`${label} public ${address.name} address does not show the ended notice after the close`);
    if (address.campaignTextFound !== false) refuse(`${label} public ${address.name} address still shows the campaign's own text after the close`);
  }
  const read = close.publicReadAfter;
  if (read.status === null) refuse(`${label} did not read the public portal data after the close`);
  if (read.status === 200 && read.campaignTextFound !== false) {
    refuse(`${label} public portal data answered 200 after the close${read.campaignTextFound ? " with the campaign's own text" : " and was not searched for the campaign's text"}`);
  }
}

/**
 * A job's health rule (its `health` block): every readback reports the
 * required status, the start readback is no later than the account's
 * creation, the account was made before the campaign's close, the end
 * readback is no earlier than that close, and the end readback reports the
 * start's version and migrations (review 59, HC3, HC4, HC6 and O5). A job
 * without a campaign names the time its work ended in `health.endAfter`,
 * a dotted journey field, and the same order is held to that time.
 *
 * Blind category: the readbacks and the times are written by the journey.
 * A run that wrote a readback it never made is not caught; nothing in the
 * record comes from the deployment itself.
 */
function checkHealthRule(journey, job, label) {
  // A time Date.parse cannot read compares false with everything, which
  // would pass every order rule below (review 62, X3).
  const at = (value) => {
    const time = Date.parse(value);
    if (Number.isNaN(time)) refuse(`${label} holds a time that cannot be read: ${JSON.stringify(value)}`);
    return time;
  };
  for (const reading of journey.health) {
    if (reading.status !== job.health.status) refuse(`${label} ${reading.point} health readback reports status ${reading.status}, not ${job.health.status}`);
  }
  const start = journey.health.find((reading) => reading.point === "start");
  const end = journey.health.find((reading) => reading.point === "end");
  if (at(start.checkedAt) > at(journey.accountCreatedAt)) {
    refuse(`${label} start health readback (${start.checkedAt}) comes after the account was created (${journey.accountCreatedAt})`);
  }
  if (journey.close && at(journey.accountCreatedAt) > at(journey.close.endedAt)) {
    refuse(`${label} account was created (${journey.accountCreatedAt}) after the campaign was closed (${journey.close.endedAt})`);
  }
  if (journey.close && at(end.checkedAt) < at(journey.close.endedAt)) {
    refuse(`${label} end health readback (${end.checkedAt}) comes before the campaign was closed (${journey.close.endedAt})`);
  }
  // A job may name the journey field holding the time its work ended (the
  // application job's export): the account comes before it and the end
  // readback no earlier than it.
  if (job.health.endAfter) {
    const ended = journeyField(journey, job.health.endAfter);
    if (at(journey.accountCreatedAt) > at(ended)) {
      refuse(`${label} account was created (${journey.accountCreatedAt}) after its ${job.health.endAfter} time (${ended})`);
    }
    if (at(end.checkedAt) < at(ended)) {
      refuse(`${label} end health readback (${end.checkedAt}) comes before its ${job.health.endAfter} time (${ended})`);
    }
  }
  // One build from start to end: the version and migration fields cannot change.
  for (const field of ["version", "migrationsExpected", "migrationsLatest"]) {
    if (end[field] !== start[field]) refuse(`${label} end health readback reports ${field} ${end[field]}, but the start one reports ${start[field]}`);
  }
}

/** Each journey ran its own campaign in its own project (review 59, O4). */
function checkDistinctCampaigns(journeys) {
  for (const field of ["campaignId", "projectId"]) {
    const seen = new Map();
    for (const journey of journeys) {
      const value = journey.campaign[field];
      if (seen.has(value)) refuse(`the ${journey.role} and ${seen.get(value)} journeys name the same ${field === "campaignId" ? "campaign" : "project"} ${value}`);
      seen.set(value, journey.role);
    }
  }
}

/**
 * A source check marked "matched" must say where the comparison can be
 * repeated and what was compared: an https address on a host the job's
 * definition lists for its source, and a note of at least the definition's
 * length (KI-2026-11-14-303, review 43 finding R3).
 *
 * Blind category: the checker cannot repeat the comparison. It cannot tell
 * whether the note is true, only that the record names a source address and
 * says something of substance about what was compared.
 */
function checkMatchedSource(sourceCheck, rule, subject) {
  const { hosts, minNoteLength } = rule.matched;
  let url;
  try {
    url = new URL(sourceCheck.url);
  } catch {
    refuse(`the ${subject} source check address is not a web address`);
  }
  if (url.protocol !== "https:" || !hosts.includes(url.hostname)) {
    refuse(`a matched ${subject} source check must name an https address on ${hosts.join(", ")}, found ${url.protocol}//${url.hostname}`);
  }
  if (sourceCheck.note.trim().length < minNoteLength) {
    refuse(`a matched ${subject} source check note must say what was compared, in at least ${minNoteLength} characters`);
  }
}

/**
 * One named executor per journey, or, for a job that defines executor roles
 * (a staff account and a public participant), exactly one named executor for
 * each role.
 */
function checkExecutors(journey, job, label) {
  if (!job.executorRoles) {
    if (!journey.executor.agent.trim() || !journey.executor.model.trim()) refuse(`${label} executor is not named`);
    checkAgentExecutor(journey.executor, `${label} executor`);
    return;
  }
  for (const role of job.executorRoles) {
    const named = journey.executors.filter((executor) => executor.role === role);
    if (named.length !== 1) refuse(`${label} needs exactly one ${role} executor, found ${named.length}`);
  }
  if (journey.executors.length !== job.executorRoles.length) refuse(`${label} names executors this job does not define`);
  for (const executor of journey.executors) checkAgentExecutor(executor, `${label} ${executor.role} executor`);
}

/**
 * An executor is an agent, as the definitions' `executors` block says: a
 * harness it lists, running a model named by a model id (review 64, case 25).
 *
 * Blind category: the names are the journey's statement. A run that names
 * a listed harness and a well-formed model id it did not run is not caught.
 */
function checkAgentExecutor(executor, label) {
  const rule = JOB_DEFINITIONS.executors;
  if (!rule.agents.includes(executor.agent)) {
    refuse(`${label} is ${JSON.stringify(executor.agent)}, not an agent harness this checker knows (${rule.agents.join(", ")}); a proven job is agent-run`);
  }
  if (!new RegExp(rule.modelPattern).test(executor.model)) {
    refuse(`${label} names model ${JSON.stringify(executor.model)}, which is not a model id`);
  }
}

/**
 * The record's date fits its journeys (review 64, case 31): no earlier than
 * the last end health readback's day in the westernmost time zone (UTC-12),
 * and no more than the definitions' maxDaysAfterLastEnd days after that
 * day in the easternmost (UTC+14). The bounds hold in every zone, so an
 * honest record dated on the day its last journey ended, wherever it was
 * written, is accepted.
 *
 * Blind category: the readback times are the journey's own. A record whose
 * times and date were moved together is not caught.
 */
function checkRecordedOn(record) {
  const rule = JOB_DEFINITIONS.recordedOn;
  const day = 24 * 60 * 60 * 1000;
  const ends = record.journeys.flatMap((journey) => journey.health.filter((reading) => reading.point === "end"));
  const times = ends.map((reading) => {
    const time = Date.parse(reading.checkedAt);
    if (Number.isNaN(time)) refuse(`an end health readback holds a time that cannot be read: ${JSON.stringify(reading.checkedAt)}`);
    return time;
  });
  const last = Math.max(...times);
  const recorded = Date.parse(`${record.recordedOn}T00:00:00Z`);
  if (Number.isNaN(recorded) || new Date(recorded).toISOString().slice(0, 10) !== record.recordedOn) {
    refuse(`recordedOn ${record.recordedOn} is not a calendar date`);
  }
  const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
  const earliest = dayOf(last - 12 * 60 * 60 * 1000);
  const latest = dayOf(last + 14 * 60 * 60 * 1000 + rule.maxDaysAfterLastEnd * day);
  if (record.recordedOn < earliest) refuse(`recordedOn ${record.recordedOn} is before the last journey ended (${new Date(last).toISOString()})`);
  if (record.recordedOn > latest) {
    refuse(`recordedOn ${record.recordedOn} is more than ${rule.maxDaysAfterLastEnd} days after the last journey ended (${new Date(last).toISOString()})`);
  }
}

/**
 * A limit the job's definition words (its limitTexts) must carry those words
 * exactly, so a limit cannot say the opposite of its id (review 59, L2). A
 * definition may list more than one wording for a limit: the first is what
 * the assembler writes, a later one is what an earlier record carries
 * (KI-2026-11-16-020). A record's own added limits have no definition text;
 * see the
 * capability-evidence README on why they are pinned by the record's hash.
 */
function checkLimitTexts(limits, job) {
  if (!job.limitTexts) return;
  for (const limit of limits) {
    if (!Object.hasOwn(job.limitTexts, limit.id)) continue;
    if (![job.limitTexts[limit.id]].flat().includes(limit.text)) refuse(`record's ${limit.id} limit does not carry its definition's words`);
  }
}

/**
 * The cross-workspace rule (KI-2026-11-14-060, the lead's decision of
 * November 14). A `data` check (an API route or a file download) counts only
 * with 403 or 404. A `page` check counts with 403 or 404, or with 200 when
 * the record carries notFoundRendered true, recordTextFound false and the
 * hashes of at least `minSearchedStrings` distinct identifying strings: the
 * report page streams, so it can answer 200 while it renders the not-found
 * screen. Each target needs its download refused as a data check, so a page
 * check alone never satisfies the rule. Returns whether a page check was
 * accepted on 200, which the record must then state as a limit.
 *
 * Blind category: the checker trusts the journey's reading of the rendered
 * page. It cannot see the page, so it cannot tell whether the strings
 * searched were the right ones, only that enough distinct ones were.
 */
function checkCrossWorkspace(checks, rule, roles) {
  let pageAnsweredOk = false;
  for (const check of checks) {
    const label = `cross-workspace ${check.kind} request ${check.request} for another workspace's ${check.target}`;
    if (check.journey !== undefined && !roles.includes(check.journey)) refuse(`${label} names the ${check.journey} journey, which the record does not hold`);
    if (check.contentReturned) refuse(`${label} returned content (status ${check.status})`);
    if (CROSS_WORKSPACE_REFUSAL_STATUSES.has(check.status)) continue;
    if (check.kind === "page" && check.status === 200) {
      const hashes = check.searchedStringSha256 ?? [];
      if (check.notFoundRendered !== true) refuse(`${label} answered 200 without the journey reading the not-found screen on it`);
      if (check.recordTextFound !== false) refuse(`${label} answered 200 and the journey found the first account's text on it, or did not look`);
      if (hashes.length !== check.searchedStringCount || new Set(hashes).size !== hashes.length) {
        refuse(`${label} must list one distinct hash per identifying string searched`);
      }
      if (hashes.length < rule.minSearchedStrings) {
        refuse(`${label} searched ${hashes.length} identifying strings; at least ${rule.minSearchedStrings} required`);
      }
      pageAnsweredOk = true;
      continue;
    }
    refuse(
      `${label} answered status ${check.status}, which is inconclusive; only 403 (workspace access denied) or 404 (not found) ` +
        "shows the app refused it, or for a page, 200 with the not-found screen and none of the first account's text",
    );
  }
  for (const target of rule.targets) {
    const forTarget = checks.filter((check) => check.target === target);
    if (forTarget.length === 0) refuse(`cross-workspace check for ${target} is missing`);
    const download = rule.requiredDataRequests[target];
    const refused = forTarget.some(
      (check) => check.kind === "data" && check.request === download && CROSS_WORKSPACE_REFUSAL_STATUSES.has(check.status),
    );
    if (!refused) refuse(`cross-workspace checks for ${target} need its ${download} refused as a data check with 403 or 404`);
    // A job may also require a page check for a target (the staff campaign
    // page). Every check above already passed its kind's rule, so presence is
    // what is left to require; the data check stays required beside it.
    const page = rule.requiredPageRequests?.[target];
    if (page && !forTarget.some((check) => check.kind === "page" && check.request === page)) {
      refuse(`cross-workspace checks for ${target} need its ${page} checked as a page check`);
    }
  }
  checkCrossWorkspacePerJourney(checks, rule, roles);
  return pageAnsweredOk;
}

/**
 * The controls beside the second account's refusals, for a job whose
 * definition has them (the lead's rule 10 for the application job).
 * `ownerControl`: in the same run each journey's owner received the listed
 * status for each listed request, so a refusal is not a route that refuses
 * everyone. `secondAccount`: each journey's second account was confirmed and
 * received the listed status for a read of its own record, so a refusal is
 * not an account that was never signed in.
 *
 * Blind category: both are the journey's statements. A run that wrote an
 * owner's 200 it never received is not caught.
 */
function checkCrossWorkspaceControls(crossWorkspace, rule, roles) {
  if (rule.ownerControl) {
    const checks = crossWorkspace.ownerChecks ?? [];
    const { requests, status } = rule.ownerControl;
    for (const role of roles) {
      for (const request of requests) {
        const own = checks.filter((check) => check.journey === role && check.request === request);
        if (own.length !== 1) {
          refuse(`the ${role} journey needs exactly one owner ${request} check, found ${own.length}; a second account's refusal counts only beside the owner's own answer in the same run`);
        }
        if (own[0].status !== status) {
          refuse(`the ${role} journey's owner received status ${own[0].status} for ${request}, not ${status}; a route that refuses its owner shows nothing about a second account`);
        }
      }
    }
    for (const check of checks) {
      if (!roles.includes(check.journey)) refuse(`owner check ${check.request} names the ${check.journey} journey, which the record does not hold`);
      if (!requests.includes(check.request)) refuse(`owner check ${check.request} of the ${check.journey} journey is not a request this job's control defines`);
    }
  }
  if (rule.secondAccount) {
    const accounts = crossWorkspace.secondAccounts ?? [];
    const { ownRequest, status } = rule.secondAccount;
    for (const role of roles) {
      const own = accounts.filter((account) => account.journey === role);
      if (own.length !== 1) refuse(`the ${role} journey needs exactly one second account entry, found ${own.length}`);
      const [account] = own;
      if (account.confirmed !== true) refuse(`the ${role} journey's second account was not confirmed; an unconfirmed account is refused everything`);
      if (account.ownRequest !== ownRequest || account.ownStatus !== status) {
        refuse(`the ${role} journey's second account received status ${account.ownStatus} for its own ${account.ownRequest}, not ${status} for ${ownRequest}; an account that is not signed in is refused everything`);
      }
    }
    for (const account of accounts) {
      if (!roles.includes(account.journey)) refuse(`a second account entry names the ${account.journey} journey, which the record does not hold`);
    }
  }
}

/**
 * Every journey must have its own cross-workspace checks, not one journey's
 * set standing for all three (KI-2026-11-14-303, review 43 finding R1).
 * Every check reaching here was already accepted for its kind.
 *
 * `perJourney: "role"`: each check names the journey that made it, and each
 * journey has each required request (data and page) exactly once.
 * `perJourney: "count"`: for a record whose checks carry no journey (the
 * first proven job's), each required request is checked exactly as many
 * times as the record has journeys.
 *
 * Blind category of "count": the checker cannot tell whether the checks came
 * from different journeys. One journey's checks repeated once per journey
 * would pass; only the role form can see that.
 */
function checkCrossWorkspacePerJourney(checks, rule, roles) {
  if (!rule.perJourney) return;
  if (rule.perJourney === "role") {
    const unnamed = checks.find((check) => check.journey === undefined);
    if (unnamed) refuse(`cross-workspace ${unnamed.kind} request ${unnamed.request} for another workspace's ${unnamed.target} does not name the journey that made it`);
  } else if (rule.perJourney !== "count") {
    throw new Error(`job definition crossWorkspace.perJourney must be role or count, found ${rule.perJourney}`);
  }
  for (const target of rule.targets) {
    const required = [["data", rule.requiredDataRequests[target]]];
    if (rule.requiredPageRequests?.[target]) required.push(["page", rule.requiredPageRequests[target]]);
    for (const [kind, request] of required) {
      const matching = checks.filter((check) => check.target === target && check.kind === kind && check.request === request);
      if (rule.perJourney === "count") {
        if (matching.length !== roles.length) {
          refuse(`cross-workspace checks hold ${matching.length} ${request} ${kind} checks for ${target}; this job needs one from each of its ${roles.length} journeys`);
        }
        continue;
      }
      for (const role of roles) {
        const own = matching.filter((check) => check.journey === role).length;
        if (own !== 1) refuse(`the ${role} journey needs exactly one ${request} ${kind} check for ${target}, found ${own}`);
      }
    }
  }
}

/**
 * What an anonymous public participant, with no session, was refused. Each
 * named request for staff-only records counts only with 401, 403 or 404 and
 * no content: for someone who is not signed in, 401 is the refusal. The
 * public portal read answers 200, and the journey must have searched it for
 * every staff-only field name the job lists and found none.
 *
 * With `perJourney: "role"`, each refusal names the journey whose
 * participant made it, and each journey has each required request exactly
 * once (review 59, A3), the rule the second-account checks follow.
 *
 * Blind category: the checker trusts the journey's reading of each response.
 * It cannot tell whether a staff-only value was returned under another name.
 */
function checkParticipantChecks(participant, rule, roles) {
  for (const check of participant.refusals) {
    if (check.journey !== undefined && !roles.includes(check.journey)) {
      refuse(`public participant request ${check.request} names the ${check.journey} journey, which the record does not hold`);
    }
    // The refusal names the journey whose participant made it (lane 63).
    const label = `${check.journey === undefined ? "" : `${check.journey} journey `}public participant request ${check.request}`;
    if (check.contentReturned) refuse(`${label} returned content (status ${check.status})`);
    if (!PARTICIPANT_REFUSAL_STATUSES.has(check.status)) {
      refuse(`${label} answered status ${check.status}, which is inconclusive; only 401, 403 or 404 shows the app refused it`);
    }
  }
  for (const request of rule.requiredRequests) {
    if (!participant.refusals.some((check) => check.request === request)) refuse(`public participant check ${request} is missing`);
  }
  if (rule.perJourney === "role") {
    const unnamed = participant.refusals.find((check) => check.journey === undefined);
    if (unnamed) refuse(`public participant request ${unnamed.request} does not name the journey that made it`);
    for (const role of roles) {
      for (const request of rule.requiredRequests) {
        const own = participant.refusals.filter((check) => check.journey === role && check.request === request).length;
        if (own !== 1) refuse(`the ${role} journey needs exactly one public participant ${request} check, found ${own}`);
      }
    }
  } else if (rule.perJourney !== undefined) {
    throw new Error(`job definition participantChecks.perJourney must be role, found ${rule.perJourney}`);
  }
  const { publicRead } = participant;
  const label = `public participant ${publicRead.request}`;
  if (publicRead.request !== rule.publicRead.request) refuse(`public participant read must be ${rule.publicRead.request}, found ${publicRead.request}`);
  if (publicRead.status !== 200) refuse(`${label} answered status ${publicRead.status}; the public read must answer 200 to be searched`);
  for (const field of rule.publicRead.staffOnlyFields) {
    if (!publicRead.staffFieldsSearched.includes(field)) refuse(`${label} was not searched for the staff-only field ${field}`);
  }
  if (publicRead.staffFieldsFound !== false) refuse(`${label} carried a staff-only field`);
}

function checkPlace(place, rule, job, label) {
  const kinds = rule.placeKinds ?? [rule.placeKind];
  if (!kinds.includes(place.kind)) refuse(`${label} must be a place of kind ${kinds.join(" or ")}, found ${place.kind}`);
  const pattern = job.geoidPatterns?.[place.kind] ?? JOB_DEFINITIONS.geoidPatterns[place.kind];
  if (!pattern || !new RegExp(pattern).test(place.geoid)) refuse(`${label} geoid ${place.geoid} is not a ${place.kind} Census id`);
  if (rule.stateFips) {
    if (place.stateFips.length !== 1 || place.stateFips[0] !== rule.stateFips || !place.geoid.startsWith(rule.stateFips)) {
      refuse(`${label} must be in the state with FIPS ${rule.stateFips}`);
    }
  }
  // A journey whose place must lie in exactly the listed states (the
  // application job's tribal area, whose Census list must be California alone).
  if (rule.statesExactly) {
    const found = [...place.stateFips].sort();
    const expected = [...rule.statesExactly].sort();
    if (found.length !== expected.length || found.some((state, index) => state !== expected[index])) {
      refuse(`${label} states the Census states with FIPS ${place.stateFips.join(", ")} for its place; this journey's place must lie in exactly ${rule.statesExactly.join(", ")}`);
    }
  }
  // A county, place or county subdivision id begins with its state's code (review 59, P6).
  if (job.placeStateFromGeoid?.kinds.includes(place.kind)) {
    const state = place.geoid.slice(0, 2);
    if (place.stateFips.length !== 1 || place.stateFips[0] !== state) {
      refuse(`${label} geoid ${place.geoid} is in the state with FIPS ${state}, but the record says ${place.stateFips.join(", ") || "none"}`);
    }
  }
}

const censusTables = new Map();

/** One kind's Census ids and names, read once from the Gazetteer table the definitions name. */
function censusTable(kind) {
  const names = JOB_DEFINITIONS.censusNames;
  const file = names?.files?.[kind];
  if (!file) return null;
  if (!censusTables.has(kind)) {
    const rows = new Map();
    const lines = readFileSync(resolve(SCHEMA_DIR, names.folder, file), "utf8").split(/\r?\n/);
    const header = lines[0].split("\t");
    const [idColumn, stateColumn, nameColumn] = ["GEOID", "USPS", "NAME"].map((name) => header.indexOf(name));
    for (const line of lines.slice(1)) {
      if (!line) continue;
      const cells = line.split("\t");
      rows.set(cells[idColumn], { usps: stateColumn === -1 ? null : cells[stateColumn], name: cells[nameColumn] });
    }
    censusTables.set(kind, rows);
  }
  return censusTables.get(kind);
}

/**
 * The place's label is the name the Census Bureau gives its id (reviews 59
 * and 64: an id changed with its label kept was accepted). A county, place
 * or county subdivision label is the Gazetteer name, with or without its
 * closing descriptor words, then a comma and the state's postal code. A
 * tribal area's Gazetteer row covers its reservation and its trust land, so
 * a reservation label opens the Gazetteer name and a trust land label says
 * "Trust Land" and opens with the same word.
 *
 * Blind category: the Gazetteer says what an id is called, not that the
 * journey worked in that place. A label the product words another way (a
 * nickname, another language) is refused; the label must be the Bureau's.
 */
function checkPlaceName(place, label) {
  const table = censusTable(place.kind);
  if (!table || typeof place.label !== "string") return;
  const year = JOB_DEFINITIONS.censusNames.year;
  const tribal = place.kind === "aiannh";
  const row = table.get(tribal ? place.geoid.slice(0, 4) : place.geoid);
  if (!row) refuse(`${label} geoid ${place.geoid} is not a ${place.kind} id in the Census Bureau's ${year} Gazetteer`);
  const comma = place.label.lastIndexOf(", ");
  const name = (comma === -1 ? place.label : place.label.slice(0, comma)).trim();
  const state = comma === -1 ? "" : place.label.slice(comma + 2).trim();
  const wrong = () => refuse(`${label} label "${place.label}" is not the Census Bureau's name for ${place.kind} ${place.geoid}, which the ${year} Gazetteer calls "${row.name}"${row.usps ? ` in ${row.usps}` : ""}`);
  if (!name) wrong();
  if (row.usps && state !== row.usps) wrong();
  const opens = row.name.toLowerCase().startsWith(name.toLowerCase());
  const rest = opens ? row.name.slice(name.length) : "";
  if (tribal) {
    const trustLand = place.geoid.endsWith("T");
    const sameFirstWord = name.split(/\s+/)[0].toLowerCase() === row.name.split(/\s+/)[0].toLowerCase();
    if (trustLand ? !(sameFirstWord && /trust land/i.test(name)) : !(opens && /^(\s|$)/.test(rest) && !/off-reservation trust land/i.test(name))) wrong();
    return;
  }
  // What may follow the label's name in the Gazetteer name: descriptor words only.
  if (!opens || !/^(\s+([a-z]+|CDP|\(balance\)))*$/.test(rest)) wrong();
}

/**
 * Check each PDF the job defines and return its pages by kind. `search`, when
 * given, is called with each PDF's pages after the custody, page count, DRAFT
 * and secret checks and before its items are checked. A PDF kind listed in
 * the definition's `pdfItems` carries those items instead of the job's. A
 * DRAFT stamp refuses a PDF, unless the job's definition requires one
 * (`application.draftStamp.required`): then the record must say the PDF is
 * stamped, and checkApplication reads the stamp and its count.
 */
function checkPdfs(journey, job, label, root, readPdfPages, renderPdfPage, pdfPaths, search) {
  const pagesByKind = new Map();
  for (const kind of job.pdfs) {
    const count = journey.pdfs.filter((pdf) => pdf.kind === kind).length;
    if (count !== 1) refuse(`${label} needs exactly one ${kind} PDF, found ${count}`);
  }
  if (journey.pdfs.length !== job.pdfs.length) refuse(`${label} has PDFs this job does not define`);

  for (const pdf of journey.pdfs) {
    const pdfLabel = `${label} ${pdf.kind} PDF`;
    // The campaign job refuses a changed file in the checker's own form; the
    // first job keeps the plain error its record has always been checked with.
    const { source, bytes } = readEvidenceFile(pdf, root, pdfLabel, job.campaign || job.application ? refuse : undefined);
    if (pdfPaths.has(source)) refuse(`${pdfLabel} reuses another journey's file: ${pdf.path}`);
    pdfPaths.add(source);
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") refuse(`${pdfLabel} is not a PDF: ${pdf.path}`);
    if (bytes.length !== pdf.bytes) refuse(`${pdfLabel} is ${bytes.length} bytes, record says ${pdf.bytes}`);
    // A job whose definition requires the stamp reads it in checkApplication.
    const stampRequired = job.application?.draftStamp?.required === true && pdf.kind === job.application.pdf;
    if (stampRequired && pdf.draftStamp !== true) {
      refuse(`${pdfLabel} is not recorded as stamped DRAFT; this job requires the stamp with the count of required attachments outstanding`);
    }
    if (!stampRequired && pdf.draftStamp) refuse(`${pdfLabel} is stamped DRAFT`);

    const pages = readPdfPages(source);
    if (pages.length !== pdf.pages) refuse(`${pdfLabel} has ${pages.length} pages, record says ${pdf.pages}`);
    pages.forEach((text, index) => {
      // A stamp set with letter spacing can read back as "D R A F T".
      if (!stampRequired && /\bDRAFT\b/.test(joinLetterSpacing(text))) refuse(`${pdfLabel} page ${index + 1} carries a DRAFT stamp`);
      const found = secretIn(text);
      if (found) refuse(`${pdfLabel} page ${index + 1} contains ${found}`);
    });
    search?.(pdf, pages, pdfLabel);
    pagesByKind.set(pdf.kind, pages);

    const items = job.pdfItems?.[pdf.kind] ?? job.items;
    for (const [item, method] of Object.entries(items)) {
      const entries = pdf.items.filter((entry) => entry.item === item);
      if (entries.length !== 1) refuse(`${pdfLabel} must find ${item} exactly once, found ${entries.length}`);
      const entry = entries[0];
      if (entry.method !== method) refuse(`${pdfLabel} ${item} must be found by ${method}`);
      if (entry.page > pages.length) refuse(`${pdfLabel} ${item} names page ${entry.page} of ${pages.length}`);
      if (method === "pdftotext") {
        if (!entry.text || entry.imageSha256 || entry.pixelSha256) refuse(`${pdfLabel} ${item} needs the text pdftotext found, and no image hash`);
        const heading = job.itemHeadings?.[pdf.kind]?.[item];
        if (heading !== undefined && entry.text !== heading) refuse(`${pdfLabel} ${item} must name its heading "${heading}", found "${entry.text}"`);
        // The shared matcher the export test and the journey use: case,
        // wrapped lines and letter spacing aside, the text must be whole on
        // that page (scripts/lib/pdf-text-match.mjs).
        if (!pdfTextHasPhrase(pages[entry.page - 1], entry.text)) {
          refuse(`${pdfLabel} ${item} text is not on page ${entry.page}`);
        }
        if (heading !== undefined && !hasHeadingLine(pages[entry.page - 1], heading)) {
          refuse(`${pdfLabel} ${item} heading "${heading}" is not a line of its own on page ${entry.page}`);
        }
      } else {
        if (!entry.imageSha256 || entry.text) refuse(`${pdfLabel} ${item} needs the rendered page image hash, and no text`);
        checkRenderedPage(entry, `${pdfLabel} ${item}`, source, renderPdfPage);
        // The words the export prints with its map, on the same page.
        const mapText = job.mapPageText?.[pdf.kind];
        if (mapText !== undefined && !pdfTextHasPhrase(pages[entry.page - 1], mapText)) {
          refuse(`${pdfLabel} ${item} page ${entry.page} does not carry "${mapText}", which the export prints with its map`);
        }
      }
    }
    if (pdf.items.length !== Object.keys(items).length) refuse(`${pdfLabel} lists items this job does not define`);
  }
  return pagesByKind;
}

/**
 * Render a page-image item's page and count it the way the journey did
 * (scripts/lib/poppler-pixels.mjs): fewer than MIN_RED_PIXELS highlight-red
 * pixels refuses the record. When the item carries pixelSha256, the SHA-256
 * of the page's PPM bytes at MAP_RENDER_DPI, a different hash refuses it.
 * The PNG hash (imageSha256) is not recomputed: PNG bytes differ between
 * Poppler builds whose pixels are the same (KI-2026-11-14-303).
 *
 * Blind category: enough highlight red on the page is not the right map. A
 * page of red marks from another place, or a red chart, passes the count.
 */
function checkRenderedPage(entry, itemLabel, source, renderPdfPage) {
  const ppm = renderPdfPage(source, entry.page);
  const { redPixels } = analyzePpm(ppm);
  if (redPixels < MIN_RED_PIXELS) {
    refuse(`${itemLabel} page ${entry.page} has ${redPixels} highlight-red pixels at ${MAP_RENDER_DPI} dpi; a map page needs at least ${MIN_RED_PIXELS}`);
  }
  if (entry.pixelSha256 !== undefined) {
    const found = createHash("sha256").update(ppm).digest("hex");
    if (found !== entry.pixelSha256) {
      refuse(`${itemLabel} page ${entry.page} renders to pixels with SHA-256 ${found}; the record says ${entry.pixelSha256}`);
    }
  }
}

/**
 * True when one line of the page is the heading and nothing else: the shared
 * matcher finds the heading on that line, and the line's letters and digits,
 * with spaces, hyphens and case set aside, are the heading's. A heading set
 * with letter spacing still counts; the same words inside a sentence, a
 * table row or a contents line do not (KI-2026-11-14-303, review 43 findings
 * R6 and R11).
 *
 * Blind category: a heading that wraps onto a second line is not found, and
 * a line holding only the heading's words in another place (a running header)
 * counts as the heading.
 */
function hasHeadingLine(pageText, heading) {
  const bare = (text) => normalizePdfText(joinLetterSpacing(text)).replace(/[\s-]/g, "");
  const target = bare(heading);
  return pageText.split("\n").some((line) => bare(line) === target && pdfTextHasPhrase(line, heading));
}

/**
 * Check each workbook the job defines: a committed file whose SHA-256 and
 * size match the record, an XLSX (ZIP) file, no secret in any cell. `search`,
 * when given, is called with each workbook's sheets after those checks.
 * Returns each workbook's sheets by kind, as rows of cell values.
 */
function checkWorkbooks(journey, job, label, root, readWorkbook, artifactPaths, search) {
  const sheetsByKind = new Map();
  const kinds = job.workbooks ?? [];
  const workbooks = journey.workbooks ?? [];
  for (const kind of kinds) {
    const count = workbooks.filter((workbook) => workbook.kind === kind).length;
    if (count !== 1) refuse(`${label} needs exactly one ${kind} workbook, found ${count}`);
  }
  if (workbooks.length !== kinds.length) refuse(`${label} has workbooks this job does not define`);

  for (const workbook of workbooks) {
    const workbookLabel = `${label} ${workbook.kind} workbook`;
    const { source, bytes } = readEvidenceFile(workbook, root, workbookLabel, refuse);
    if (artifactPaths.has(source)) refuse(`${workbookLabel} reuses another file: ${workbook.path}`);
    artifactPaths.add(source);
    if (bytes.subarray(0, 4).toString("latin1") !== "PK\u0003\u0004") refuse(`${workbookLabel} is not an XLSX file: ${workbook.path}`);
    if (bytes.length !== workbook.bytes) refuse(`${workbookLabel} is ${bytes.length} bytes, record says ${workbook.bytes}`);
    const sheets = readWorkbook(source);
    for (const [name, rows] of Object.entries(sheets)) {
      rows.forEach((row, rowIndex) => row.forEach((value, column) => {
        const found = typeof value === "string" ? secretIn(value) : null;
        if (found) refuse(`${workbookLabel} sheet ${name} cell ${cellAddress(rowIndex, column)} contains ${found}`);
      }));
    }
    search?.(workbook, sheets, workbookLabel);
    sheetsByKind.set(workbook.kind, sheets);
  }
  return sheetsByKind;
}

/** A1-style address for a zero-based row and column. */
function cellAddress(row, column) {
  let letters = "";
  for (let index = column + 1; index > 0; index = Math.floor((index - 1) / 26)) {
    letters = String.fromCharCode(65 + ((index - 1) % 26)) + letters;
  }
  return `${letters}${row + 1}`;
}

/**
 * Read every sheet of an XLSX file as rows of cell values with SheetJS, the
 * library that writes the engagement review workbook. Loaded on first use, so
 * a job without workbooks never loads it.
 * @param {string} absolutePath
 * @returns {Record<string, unknown[][]>}
 */
export function xlsxSheets(absolutePath) {
  const XLSX = createRequire(import.meta.url)("xlsx");
  let workbook;
  try {
    workbook = XLSX.read(readFileSync(absolutePath), { type: "buffer" });
  } catch {
    throw new Error(`proven job record refused: the workbook could not be read: ${absolutePath}`);
  }
  return Object.fromEntries(
    workbook.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "" })]),
  );
}

/**
 * The campaign agreement rules, for a job whose definition has a `campaign`
 * block (the engagement job). Counts come from the journey's own moderation
 * outcomes and response, and each artifact must agree with them: the internal
 * review PDF by its count phrases and its count sentences; the internal
 * workbook by its cells (one row per contribution, its status cell; one row
 * per staff response, its sources cell) and by its Summary rows, which must
 * also agree with those cells and the PDF's sentences; the public review copy
 * (PDF and workbook) by the counts it states, the sentence saying what it
 * leaves out and approved rows only; and the public response page by what the
 * journey read on it at every width and mode. Every comment a theme or the
 * response names must exist and be approved. The rejected texts were searched
 * for as the files were read (rejectedTextSearch).
 *
 * Blind category: the checker reads the review files itself, but trusts the
 * journey's reading of the public response page and the portal, which are
 * live screens it cannot read again.
 */
function checkCampaign(journey, job, label, workbooks, pagesByKind, { outcomes, approved, responded, counts }) {
  const rule = job.campaign;
  const { campaign } = journey;
  const { response } = campaign;

  // The review PDF: its scope badge and one count phrase per count, as the record found them.
  const pdf = journey.pdfs.find((entry) => entry.kind === rule.reviewPdf);
  const pdfLabel = `${label} ${rule.reviewPdf} PDF`;
  const itemText = (item) => pdf.items.find((entry) => entry.item === item).text;
  if (itemText(rule.scopeItem.item) !== rule.scopeItem.text) refuse(`${pdfLabel} ${rule.scopeItem.item} must read "${rule.scopeItem.text}"`);
  for (const [name, { item, phrase }] of Object.entries(rule.counts)) {
    const expected = phrase.replaceAll("{count}", String(counts[name]));
    if (itemText(item) !== expected) refuse(`${pdfLabel} ${item} reads "${itemText(item)}", but the journey's ${name} count gives "${expected}"`);
  }

  // The workbook, read by cell.
  const book = rule.workbook;
  const sheets = workbooks.get(book.kind);
  const bookLabel = `${label} ${book.kind} workbook`;
  const scopeRow = requiredSheet(sheets, book.scopeCell.sheet, bookLabel).find((row) => row[0] === book.scopeCell.field);
  if (!scopeRow || scopeRow[1] !== book.scopeCell.value) refuse(`${bookLabel} ${book.scopeCell.sheet} ${book.scopeCell.field} must be ${book.scopeCell.value}`);

  const cells = campaignWorkbookCells(sheets, book, bookLabel);
  for (const [id, outcome] of outcomes) {
    const value = book.contributions.statusValues[outcome];
    if (cells.statusById.get(id) !== value) refuse(`${bookLabel} ${book.contributions.sheet} row for ${id} has status ${cells.statusById.get(id) ?? "missing"}, not ${value}`);
  }
  for (const name of ["approved", "rejected"]) {
    if (cells[name] !== counts[name]) refuse(`${bookLabel} has ${cells[name]} ${book.contributions.statusValues[name]} contributions; the journey's ${name} count is ${counts[name]}`);
  }
  if (cells.answeredIds.size !== counts.responded) refuse(`${bookLabel} answers ${cells.answeredIds.size} contributions in published responses; the journey's responded count is ${counts.responded}`);
  for (const id of responded) {
    if (!cells.answeredIds.has(id)) refuse(`${bookLabel} has no published response answering ${id}`);
  }

  // The count sentences and the Summary rows (KI-2026-11-14-371), against
  // the journey's counts: what it sent, how it moderated, what it published.
  const expected = {
    received: campaign.contributions.length,
    approved: counts.approved,
    rejected: counts.rejected,
    publishedResponses: response.status === "published" ? 1 : 0,
    answered: counts.responded,
  };
  const internalPages = pagesByKind.get(rule.reviewPdf);
  const stated = {};
  for (const name of CAMPAIGN_COUNTS) stated[name] = statedCount(internalPages, rule.countSentences[name], name, pdfLabel);
  const { summary } = book;
  const summaryRows = requiredSheet(sheets, summary.sheet, bookLabel);
  for (const name of CAMPAIGN_COUNTS) {
    const row = summary.rows[name];
    const value = summaryCount(summaryRows, row, bookLabel);
    const where = `${bookLabel} ${summary.sheet} ${row} is ${value}`;
    const cellSheet = name === "publishedResponses" || name === "answered" ? book.responses.sheet : book.contributions.sheet;
    if (value !== cells[name]) refuse(`${where}; its own ${cellSheet} cells give ${cells[name]}`);
    if (value !== stated[name]) refuse(`${where}; the ${rule.reviewPdf} PDF states ${stated[name]}`);
    if (value !== expected[name]) refuse(`${where}; the journey's moderation outcomes and response give ${expected[name]}`);
  }
  for (const name of CAMPAIGN_COUNTS) checkCountSentence(internalPages, rule.countSentences[name], name, expected[name], pdfLabel);
  checkCampaignWorkbookFacts(journey, book, sheets, bookLabel);

  checkPublicCopy(journey, rule, label, workbooks, pagesByKind, expected, approved, job.participantChecks?.publicRead.staffOnlyFields ?? []);

  // The public response page, read at every width and mode.
  const rejectedHashes = campaign.rejectedTextSha256;
  const { widths, modes } = job.screens;
  const seen = new Set();
  for (const reading of journey.publicPage.readings) {
    const readingLabel = `${label} public response page at ${reading.width} px ${reading.mode}`;
    if (!widths.includes(reading.width) || !modes.includes(reading.mode)) refuse(`${readingLabel} is not a width and mode this job reads`);
    const key = `${reading.width}|${reading.mode}`;
    if (seen.has(key)) refuse(`${readingLabel} is recorded twice`);
    seen.add(key);
    if (reading.approvedShown !== counts.approved) refuse(`${readingLabel} shows ${reading.approvedShown} approved comments; the journey's approved count is ${counts.approved}`);
    if (reading.respondedShown !== counts.responded) refuse(`${readingLabel} shows ${reading.respondedShown} answered comments; the journey's responded count is ${counts.responded}`);
    if (reading.rejectedTextSearched !== rejectedHashes.length) refuse(`${readingLabel} searched ${reading.rejectedTextSearched} rejected texts, not ${rejectedHashes.length}`);
    if (reading.rejectedTextFound !== false) refuse(`${readingLabel} shows a rejected comment's text`);
  }
  for (const width of widths) {
    for (const mode of modes) {
      if (!seen.has(`${width}|${mode}`)) refuse(`${label} public response page has no reading at ${width} px ${mode}`);
    }
  }
}

/**
 * The campaign's own record, before any file is read: contributions by kind
 * and input, moderation outcomes with reasons, themes and the response
 * holding approved comments only, and the response's decision on the
 * campaign's project. Returns the outcomes and the counts the files must
 * agree with.
 */
function checkCampaignRecord(journey, job, label) {
  const rule = job.campaign;
  const { campaign } = journey;

  // Contributions, by kind and by how they were made.
  const contributionIds = new Set();
  for (const contribution of campaign.contributions) {
    if (contributionIds.has(contribution.commentId)) refuse(`${label} lists contribution ${contribution.commentId} twice`);
    contributionIds.add(contribution.commentId);
  }
  for (const kind of rule.contributions.requiredKinds) {
    if (!campaign.contributions.some((contribution) => contribution.kind === kind)) refuse(`${label} has no ${kind} contribution`);
  }
  const { keyboardOnlyWidth } = rule.contributions;
  if (!campaign.contributions.some((contribution) => contribution.input === "keyboard-only" && contribution.viewportWidth === keyboardOnlyWidth)) {
    refuse(`${label} has no contribution made with the keyboard only at ${keyboardOnlyWidth} px`);
  }

  // Moderation outcomes.
  const outcomes = new Map();
  for (const entry of campaign.moderation) {
    if (!contributionIds.has(entry.commentId)) refuse(`${label} moderated ${entry.commentId}, which is not a recorded contribution`);
    if (outcomes.has(entry.commentId)) refuse(`${label} moderated ${entry.commentId} twice`);
    outcomes.set(entry.commentId, entry.outcome);
    if (entry.outcome === "rejected" && entry.reasonRecorded !== true) refuse(`${label} rejected ${entry.commentId} without a reason`);
  }
  const approvedIds = [...outcomes].filter(([, outcome]) => outcome === "approved").map(([id]) => id);
  const rejectedIds = [...outcomes].filter(([, outcome]) => outcome === "rejected").map(([id]) => id);
  if (approvedIds.length < rule.moderation.minApproved) refuse(`${label} approved ${approvedIds.length} comments; at least ${rule.moderation.minApproved} required`);
  if (rejectedIds.length < rule.moderation.minRejected) refuse(`${label} rejected ${rejectedIds.length} comments; at least ${rule.moderation.minRejected} required`);
  const approved = new Set(approvedIds);

  // The staff review's themes and the published response hold approved comments only.
  const themed = new Set();
  for (const theme of campaign.staffReview.themes) {
    for (const id of theme.commentIds) {
      if (!approved.has(id)) refuse(`${label} staff review theme ${theme.groupId} lists ${id}, which is not an approved comment`);
      themed.add(id);
    }
  }
  const { response } = campaign;
  const responded = new Set(response.sourceCommentIds);
  if (responded.size !== response.sourceCommentIds.length) refuse(`${label} response lists a comment twice`);
  for (const id of responded) {
    if (!themed.has(id)) refuse(`${label} response answers ${id}, which no staff review theme holds`);
  }
  if (response.projectId !== campaign.projectId) refuse(`${label} response decision is on project ${response.projectId}, not the campaign's project ${campaign.projectId}`);

  const counts = { approved: approved.size, rejected: rejectedIds.length, responded: responded.size };
  return { outcomes, approved, responded, counts };
}

/**
 * The record against the internal review workbook's own cells (review 59):
 * - each rejected text is the rejected comment's own Contributions body
 *   (verdict item 1; F5, F6, F7);
 * - each moderation the record says was given a reason has a moderation
 *   note in its Contributions row (item 2; O9);
 * - a map-point contribution has a coordinate cell filled and a no-map-point
 *   one has none (item 4; K4, K5, F11b);
 * - the record's response is a Staff responses row (R8, O10; that the rows
 *   are published and answer the record's comments is checked with the
 *   counts); the decision link is a Decision history row
 *   naming the response, the decision and the project (R6); its exact
 *   payload names the campaign, the decision and the response (O7); and a
 *   Synthesis actions row of that link names the staff review (R9).
 *
 * Blind category: the workbook and the record both come from the run. A run
 * that wrote a false record and a matching false workbook is not caught;
 * the checker shows only that the two agree, and that the workbook is the
 * one the record's hash names.
 */
function checkCampaignWorkbookFacts(journey, book, sheets, bookLabel) {
  const { campaign } = journey;
  const { response } = campaign;
  const blank = (value) => value == null || String(value).trim() === "";
  const columnOf = (rows, name, sheetName) => {
    const index = rows[0].indexOf(name);
    if (index < 0) refuse(`${bookLabel} sheet ${sheetName} has no ${name} column`);
    return index;
  };
  const value = (cell) => fullCellValue(sheets, book.longText, cell);

  const items = book.contributions;
  const itemRows = requiredSheet(sheets, items.sheet, bookLabel);
  const idColumn = columnOf(itemRows, items.idColumn, items.sheet);
  const bodyColumn = columnOf(itemRows, items.bodyColumn, items.sheet);
  const notesColumn = columnOf(itemRows, items.notesColumn, items.sheet);
  const pointColumns = items.pointColumns.map((name) => columnOf(itemRows, name, items.sheet));
  const rowFor = (id) => {
    const matching = itemRows.slice(1).filter((row) => row[idColumn] === id);
    if (matching.length !== 1) refuse(`${bookLabel} ${items.sheet} has ${matching.length} rows for ${id}, not one`);
    return matching[0];
  };

  const rejectedIds = campaign.moderation.filter((entry) => entry.outcome === "rejected").map((entry) => entry.commentId);
  // A Windows line ending is a line ending on both sides: SheetJS reads
  // "\r\n" back as "\n" (review 62).
  const lines = (text) => String(text ?? "").replace(/\r\n?/g, "\n").trim();
  rejectedIds.forEach((id, index) => {
    const body = lines(value(rowFor(id)[bodyColumn]));
    if (body !== lines(campaign.rejectedTexts[index])) {
      refuse(`${bookLabel} ${items.sheet} ${items.bodyColumn} of rejected comment ${id} is not rejected text ${index + 1}; the record's text must be the rejected comment's own`);
    }
  });
  for (const entry of campaign.moderation) {
    if (entry.reasonRecorded && blank(value(rowFor(entry.commentId)[notesColumn]))) {
      refuse(`${bookLabel} ${items.sheet} has no ${items.notesColumn} for ${entry.outcome} comment ${entry.commentId}, but the record says its reason was recorded`);
    }
  }
  for (const contribution of campaign.contributions) {
    const row = rowFor(contribution.commentId);
    const filled = pointColumns.filter((index) => !blank(row[index])).length;
    if (contribution.kind === "map-point" && filled === 0) {
      refuse(`${bookLabel} ${items.sheet} has no coordinates for ${contribution.commentId}, which the record calls a map-point contribution`);
    }
    if (contribution.kind === "no-map-point" && filled > 0) {
      refuse(`${bookLabel} ${items.sheet} has coordinates for ${contribution.commentId}, which the record calls a no-map-point contribution`);
    }
  }

  const responses = book.responses;
  const responseRows = requiredSheet(sheets, responses.sheet, bookLabel);
  const responseIdColumn = columnOf(responseRows, responses.idColumn, responses.sheet);
  const responseRow = responseRows.slice(1).find((row) => row[responseIdColumn] === response.responseId);
  if (!responseRow) refuse(`${bookLabel} ${responses.sheet} has no row for the record's response ${response.responseId}`);

  const history = book.decisionHistory;
  const historyRows = requiredSheet(sheets, history.sheet, bookLabel);
  const linkRow = historyRows.slice(1).find((row) => row[columnOf(historyRows, history.idColumn, history.sheet)] === response.decisionLinkId);
  if (!linkRow) refuse(`${bookLabel} ${history.sheet} has no row for the record's decision link ${response.decisionLinkId}`);
  const named = { response: response.responseId, decision: response.decisionId, project: response.projectId };
  for (const [what, expected] of Object.entries(named)) {
    const found = linkRow[columnOf(historyRows, history[`${what}Column`], history.sheet)];
    if (found !== expected) refuse(`${bookLabel} ${history.sheet} decision link ${response.decisionLinkId} names ${what} ${found}, not the record's ${expected}`);
  }

  const context = book.decisionContext;
  const contextRows = requiredSheet(sheets, context.sheet, bookLabel);
  const contextRow = contextRows.slice(1).find((row) => row[columnOf(contextRows, context.actionColumn, context.sheet)] === response.decisionLinkId);
  if (!contextRow) refuse(`${bookLabel} ${context.sheet} has no row for the record's decision link ${response.decisionLinkId}`);
  let payload;
  try {
    payload = JSON.parse(value(contextRow[columnOf(contextRows, context.payloadColumn, context.sheet)]));
  } catch {
    refuse(`${bookLabel} ${context.sheet} ${context.payloadColumn} for ${response.decisionLinkId} is not JSON`);
  }
  const payloadNames = { campaignId: campaign.campaignId, decisionId: response.decisionId, responseId: response.responseId };
  for (const [key, expected] of Object.entries(payloadNames)) {
    if (payload?.[key] !== expected) refuse(`${bookLabel} ${context.sheet} payload of decision link ${response.decisionLinkId} names ${key} ${payload?.[key]}, not the record's ${expected}`);
  }

  const actions = book.synthesisActions;
  const actionRows = requiredSheet(sheets, actions.sheet, bookLabel);
  const actionColumn = columnOf(actionRows, actions.actionColumn, actions.sheet);
  const reviewColumn = columnOf(actionRows, actions.reviewColumn, actions.sheet);
  if (!actionRows.slice(1).some((row) => row[actionColumn] === response.decisionLinkId && row[reviewColumn] === campaign.staffReview.reviewId)) {
    refuse(`${bookLabel} ${actions.sheet} has no row of decision link ${response.decisionLinkId} naming the record's staff review ${campaign.staffReview.reviewId}`);
  }
}

/**
 * A cell's whole value: when the export split it into the Long text sheet,
 * the cell ends with "[Full value: Long text / <record id> / <field>]" and
 * the value is those Long text rows joined in part order.
 */
function fullCellValue(sheets, longText, cell) {
  const raw = String(cell ?? "");
  const marker = raw.match(new RegExp(`\\[Full value: ${longText.sheet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} / (.+) / ([^/\\]]+)\\]$`));
  if (!marker) return raw;
  return longTextValue(sheets, longText, raw, marker[1], marker[2]);
}

/** The shortest moderation note searched for inside a longer public value (checkPublicCopy). */
const NOTE_SEARCH_MIN_LENGTH = 20;

/** The five counts the review files state, in the order the checker compares them. */
const CAMPAIGN_COUNTS = ["received", "approved", "rejected", "publishedResponses", "answered"];

/**
 * The public review copy, PDF and workbook (KI-2026-11-14-371). The PDF reads
 * its scope badge, says what it leaves out, states each of its counts with
 * the journey's number and none of the counts it leaves out. The workbook's
 * scope is public, its Summary rows hold the same counts and none it leaves
 * out, and its Contributions sheet holds exactly the approved comments.
 *
 * No sheet's header row, and no field the Long text sheet splits, may be one
 * of the job's staff-only field names (review 59, F9).
 *
 * Blind category: a public copy that states the right counts, holds no
 * rejected text or id and names no staff-only field can still print a staff
 * value under another column name, or in the PDF, which has no header row.
 */
function checkPublicCopy(journey, rule, label, workbooks, pagesByKind, expected, approved, staffOnlyFields) {
  const copy = rule.publicCopy;
  const pages = pagesByKind.get(copy.pdf);
  const pdfLabel = `${label} ${copy.pdf} PDF`;
  const pdf = journey.pdfs.find((entry) => entry.kind === copy.pdf);
  const scopeText = pdf.items.find((entry) => entry.item === copy.scopeItem.item).text;
  if (scopeText !== copy.scopeItem.text) refuse(`${pdfLabel} ${copy.scopeItem.item} must read "${copy.scopeItem.text}"`);
  if (!pages.some((page) => pdfTextHasPhrase(page, copy.leftOutSentence))) refuse(`${pdfLabel} does not say what it leaves out ("${copy.leftOutSentence}")`);
  for (const name of copy.leftOut) {
    if (statedCounts(pages, rule.countSentences[name]).length > 0) refuse(`${pdfLabel} states a ${name} count, which a public copy leaves out`);
  }
  for (const name of copy.counts) checkCountSentence(pages, rule.countSentences[name], name, expected[name], pdfLabel);

  const book = { ...rule.workbook, kind: copy.workbook, scopeCell: copy.scopeCell };
  const sheets = workbooks.get(copy.workbook);
  const bookLabel = `${label} ${copy.workbook} workbook`;
  const scopeRow = requiredSheet(sheets, copy.scopeCell.sheet, bookLabel).find((row) => row[0] === copy.scopeCell.field);
  if (!scopeRow || scopeRow[1] !== copy.scopeCell.value) refuse(`${bookLabel} ${copy.scopeCell.sheet} ${copy.scopeCell.field} must be ${copy.scopeCell.value}`);
  // A field is named in a header row, in the first column of a sheet of
  // field and value rows (Read me, Summary), or in the Long text sheet's field
  // column. Names are compared in lower case with spaces, hyphens and
  // underscores alike, so "Moderation Notes" is "moderation_notes".
  const fieldName = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "_");
  const staffOnly = new Set(staffOnlyFields.map(fieldName));
  for (const [name, rows] of Object.entries(sheets)) {
    const headers = (rows[0] ?? []).map((value, column) => [value, `sheet ${name} cell ${cellAddress(0, column)}`]);
    const firstColumn = rows.slice(1).map((row, index) => [row[0], `sheet ${name} cell ${cellAddress(index + 1, 0)}`]);
    const split = name === book.longText.sheet ? rows.slice(1).map((row, index) => [row[2], `sheet ${name} cell ${cellAddress(index + 1, 2)}`]) : [];
    for (const [field, where] of [...headers, ...firstColumn, ...split]) {
      if (staffOnly.has(fieldName(field))) refuse(`${bookLabel} names the staff-only field ${fieldName(field)} at ${where}`);
    }
  }
  // A staff-only value under any name (review 62, N10b to N10d): no public
  // cell, or value split into Long text, may hold one of the internal
  // workbook's moderation notes. A note of at least NOTE_SEARCH_MIN_LENGTH
  // characters is found inside a longer value; a shorter one only as the
  // whole value, so a two-word note cannot match ordinary words.
  const internal = rule.workbook;
  const internalRows = requiredSheet(workbooks.get(internal.kind), internal.contributions.sheet, `${label} ${internal.kind} workbook`);
  const notesColumn = internalRows[0].indexOf(internal.contributions.notesColumn);
  const notes = new Set(
    internalRows.slice(1)
      .map((row) => squashText(fullCellValue(workbooks.get(internal.kind), internal.longText, row[notesColumn])))
      .filter(Boolean),
  );
  for (const { text, where } of workbookSearchValues(sheets, book.longText.sheet)) {
    for (const note of notes) {
      if (text === note || (note.length >= NOTE_SEARCH_MIN_LENGTH && text.includes(note))) {
        refuse(`${bookLabel} holds a staff-only moderation note at ${where}`);
      }
    }
  }
  const { summary } = book;
  const summaryRows = requiredSheet(sheets, summary.sheet, bookLabel);
  for (const name of copy.leftOut) {
    if (summaryRows.some((row) => row[0] === summary.rows[name])) refuse(`${bookLabel} ${summary.sheet} has a ${summary.rows[name]} row, which a public copy leaves out`);
  }
  for (const name of copy.counts) {
    const value = summaryCount(summaryRows, summary.rows[name], bookLabel);
    if (value !== expected[name]) refuse(`${bookLabel} ${summary.sheet} ${summary.rows[name]} is ${value}; the journey's ${name} count is ${expected[name]}`);
  }
  const cells = campaignWorkbookCells(sheets, book, bookLabel);
  const approvedValue = book.contributions.statusValues.approved;
  for (const [id, status] of cells.statusById) {
    if (id === "" || id == null) continue;
    if (status !== approvedValue) refuse(`${bookLabel} ${book.contributions.sheet} row for ${id} has status ${status}; a public copy holds approved rows only`);
    if (!approved.has(id)) refuse(`${bookLabel} ${book.contributions.sheet} row for ${id} is not a comment the journey approved`);
  }
  for (const id of approved) {
    if (!cells.statusById.has(id)) refuse(`${bookLabel} has no ${book.contributions.sheet} row for approved comment ${id}`);
  }
}

/** A sheet that must exist and hold at least a header row. */
function requiredSheet(sheets, name, bookLabel) {
  const rows = sheets[name];
  if (!rows || rows.length === 0) refuse(`${bookLabel} has no ${name} sheet`);
  return rows;
}

/**
 * The counts a campaign review workbook's own cells give: contributions with
 * an id (received), each status, published staff responses and the distinct
 * comments they answer (joining Long text parts when the export split a
 * sources cell), with each contribution's status by id.
 */
function campaignWorkbookCells(sheets, book, bookLabel) {
  const column = (rows, name, sheetName) => {
    const index = rows[0].indexOf(name);
    if (index < 0) refuse(`${bookLabel} sheet ${sheetName} has no ${name} column`);
    return index;
  };
  const itemRows = requiredSheet(sheets, book.contributions.sheet, bookLabel);
  const idColumn = column(itemRows, book.contributions.idColumn, book.contributions.sheet);
  const statusColumn = column(itemRows, book.contributions.statusColumn, book.contributions.sheet);
  const statusById = new Map(itemRows.slice(1).map((row) => [row[idColumn], row[statusColumn]]));
  const statuses = [...statusById.values()];

  const responseRows = requiredSheet(sheets, book.responses.sheet, bookLabel);
  const sourcesColumn = column(responseRows, book.responses.sourcesColumn, book.responses.sheet);
  const publishedColumn = column(responseRows, book.responses.publishedColumn, book.responses.sheet);
  const responseIdColumn = column(responseRows, book.responses.idColumn, book.responses.sheet);
  const answeredIds = new Set();
  let publishedResponses = 0;
  for (const row of responseRows.slice(1)) {
    if (row[publishedColumn] === "" || row[publishedColumn] == null) continue;
    publishedResponses += 1;
    const raw = longTextValue(sheets, book.longText, row[sourcesColumn], row[responseIdColumn], book.responses.sourcesColumn);
    let ids;
    try {
      ids = JSON.parse(raw);
    } catch {
      refuse(`${bookLabel} ${book.responses.sheet} ${book.responses.sourcesColumn} for ${row[responseIdColumn]} is not a list`);
    }
    if (!Array.isArray(ids)) refuse(`${bookLabel} ${book.responses.sheet} ${book.responses.sourcesColumn} for ${row[responseIdColumn]} is not a list`);
    for (const id of ids) answeredIds.add(id);
  }
  return {
    statusById,
    received: itemRows.slice(1).filter((row) => row[idColumn] !== "" && row[idColumn] != null).length,
    approved: statuses.filter((status) => status === book.contributions.statusValues.approved).length,
    rejected: statuses.filter((status) => status === book.contributions.statusValues.rejected).length,
    publishedResponses,
    answered: answeredIds.size,
    answeredIds,
  };
}

/** The one Summary row with this label, as a number. */
function summaryCount(rows, label, bookLabel) {
  const matching = rows.filter((row) => row[0] === label);
  if (matching.length !== 1) refuse(`${bookLabel} Summary has ${matching.length} ${label} rows, not one`);
  const value = matching[0][1];
  if (typeof value !== "number") refuse(`${bookLabel} Summary ${label} is not a number`);
  return value;
}

/** A count sentence with its number, its nouns in the singular for a count of one. */
function countSentence(template, count) {
  return template
    .replaceAll("{count}", String(count))
    .replaceAll("{contributions}", count === 1 ? "contribution" : "contributions")
    .replaceAll("{responses}", count === 1 ? "response" : "responses");
}

/**
 * Every number a PDF states in one count sentence, on any page. Each page is
 * read as one run of words (line ends, column gaps and hyphenated line breaks
 * joined), so a sentence that wraps, or one set across a column gap, is still
 * read and its number compared.
 */
function statedCounts(pages, template) {
  const escaped = normalizePdfText(template).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = escaped
    .replace("\\{count\\}", "(\\d[\\d,]*)")
    .replace("\\{contributions\\}", "contributions?")
    .replace("\\{responses\\}", "responses?");
  const pattern = new RegExp(`\\b${source}`, "g");
  const values = [];
  for (const page of pages) {
    const flat = normalizePdfText(page).replace(/-\n/g, "").replace(/\s+/g, " ");
    for (const match of flat.matchAll(pattern)) values.push(Number(match[1].replace(/,/g, "")));
  }
  return values;
}

/** The one number a PDF states in a count sentence. A sentence missing, or stated with two numbers, refuses. */
function statedCount(pages, template, name, pdfLabel) {
  const values = [...new Set(statedCounts(pages, template))];
  if (values.length === 0) refuse(`${pdfLabel} states no ${name} count ("${countSentence(template, "N")}")`);
  if (values.length !== 1) refuse(`${pdfLabel} states the ${name} count as ${values.join(" and ")}`);
  return values[0];
}

/**
 * A count sentence the PDF must state with the journey's number and no other,
 * whole on one page under the shared matcher's rule (no column gap inside it).
 */
function checkCountSentence(pages, template, name, count, pdfLabel) {
  const value = statedCount(pages, template, name, pdfLabel);
  const sentence = countSentence(template, count);
  if (value !== count) refuse(`${pdfLabel} states "${countSentence(template, value)}", but the journey's ${name} count gives "${sentence}"`);
  if (!pages.some((page) => pdfTextHasPhrase(page, sentence))) refuse(`${pdfLabel} sentence "${sentence}" is not whole on any page`);
}

/**
 * The rejected-text search for a campaign job (KI-2026-11-14-371). The record
 * holds each rejected comment's text beside its hash; the text is a test
 * entry the journey typed and represents no one. Returns the two searches
 * checkPdfs and checkWorkbooks call as each file is read: no public review
 * file may hold a rejected text or a rejected comment's id, and the internal
 * review files, which print both, must hold every one. A search that cannot
 * find the text where it is would pass a leak too.
 *
 * A PDF is searched page by page with the shared matcher, then with its
 * pages joined at each page break; an id is looked for in all pages joined
 * with spacing removed, since a narrow column can break an id across lines.
 * A workbook is searched cell by cell, and each value the export split into
 * Long text rows is joined and searched as one. That each text is the
 * rejected comment's own is checked against the internal workbook's cells
 * (checkCampaignWorkbookFacts).
 *
 * Blind category: a rejected text reworded, shortened, split across two
 * cells, or split across a page break with a running header or footer
 * printed between its parts is not found.
 */
function rejectedTextSearch(journey, job, label) {
  const rule = job.campaign;
  const { campaign } = journey;
  const rejectedIds = campaign.moderation.filter((entry) => entry.outcome === "rejected").map((entry) => entry.commentId);
  const hashes = campaign.rejectedTextSha256;
  if (hashes.length !== rejectedIds.length || new Set(hashes).size !== hashes.length) {
    refuse(`${label} must list one distinct hash per rejected comment's text`);
  }
  const texts = campaign.rejectedTexts;
  if (texts.length !== hashes.length) refuse(`${label} must hold each rejected comment's text beside its hash`);
  texts.forEach((text, index) => {
    if (createHash("sha256").update(text, "utf8").digest("hex") !== hashes[index]) refuse(`${label} rejected text ${index + 1} does not match its hash`);
  });
  const internal = new Set([rule.reviewPdf, rule.workbook.kind]);
  const publicCopy = new Set([rule.publicCopy.pdf, rule.publicCopy.workbook]);

  // A public file holding a text or id refuses; so does an internal file missing one.
  const verdict = (kind, fileLabel, what, where) => {
    if (publicCopy.has(kind) && where) refuse(`${fileLabel} holds ${what} at ${where}`);
    if (internal.has(kind) && !where) {
      refuse(`${fileLabel} does not hold ${what}, which it prints; a search that cannot find it there could not find it in a public file`);
    }
  };
  return {
    pdf(pdf, pages, pdfLabel) {
      if (!internal.has(pdf.kind) && !publicCopy.has(pdf.kind)) return;
      // Each page, then every page joined at its page breaks, so a text split
      // across a break with nothing printed between is found (review 59, F15).
      const across = pages.map((pageText) => pageText.trim()).join("\n");
      texts.forEach((text, index) => {
        const page = pages.findIndex((pageText) => pdfTextHasPhrase(pageText, text));
        const where = page >= 0 ? `page ${page + 1}` : pdfTextHasPhrase(across, text) ? "a page break" : null;
        verdict(pdf.kind, pdfLabel, `rejected text ${index + 1}`, where);
      });
      const joined = pages.join("").replace(/\s+/g, "").toLowerCase();
      for (const id of rejectedIds) verdict(pdf.kind, pdfLabel, `the id of rejected comment ${id}`, joined.includes(id.toLowerCase()) ? "its text" : null);
    },
    workbook(workbook, sheets, workbookLabel) {
      if (!internal.has(workbook.kind) && !publicCopy.has(workbook.kind)) return;
      const values = workbookSearchValues(sheets, rule.workbook.longText.sheet);
      const find = (needle) => values.find(({ text }) => text.includes(needle))?.where ?? null;
      texts.forEach((text, index) => verdict(workbook.kind, workbookLabel, `rejected text ${index + 1}`, find(squashText(text))));
      for (const id of rejectedIds) verdict(workbook.kind, workbookLabel, `the id of rejected comment ${id}`, find(id.toLowerCase()));
    },
  };
}

/** Lower case, with every run of spacing made one space: a search that ignores case and line breaks. */
function squashText(value) {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Every workbook value to search, with where it is: each cell, and each value
 * the export split into Long text rows (record id, field, part, text), joined
 * in part order.
 */
function workbookSearchValues(sheets, longTextSheet) {
  const values = [];
  for (const [name, rows] of Object.entries(sheets)) {
    rows.forEach((row, rowIndex) => row.forEach((value, column) => {
      if (value !== "" && value != null) values.push({ text: squashText(value), where: `sheet ${name} cell ${cellAddress(rowIndex, column)}` });
    }));
  }
  const parts = new Map();
  for (const row of (sheets[longTextSheet] ?? []).slice(1)) {
    const key = `${row[1]} / ${row[2]}`;
    if (!parts.has(key)) parts.set(key, []);
    parts.get(key).push(row);
  }
  for (const [key, rows] of parts) {
    const text = rows.sort((a, b) => a[3] - b[3]).map((row) => String(row[4])).join("");
    values.push({ text: squashText(text), where: `sheet ${longTextSheet} value ${key}` });
  }
  return values;
}

/**
 * A workbook value the review export split into the Long text sheet: the cell
 * then ends with "[Full value: Long text / <record id> / <field>]" and the
 * value is the Long text rows for that record and field, joined in part order.
 */
function longTextValue(sheets, longText, cell, recordId, field) {
  const value = String(cell ?? "");
  if (!value.endsWith(`[Full value: ${longText.sheet} / ${recordId} / ${field}]`)) return value;
  const rows = sheets[longText.sheet] ?? [];
  const parts = rows.slice(1).filter((row) => row[1] === recordId && row[2] === field).sort((a, b) => a[3] - b[3]);
  return parts.map((row) => String(row[4])).join("");
}

/** Lower case and normalized, with every run of spacing made one space. */
function squashPdfText(text) {
  return normalizePdfText(text).replace(/\s+/g, " ").trim();
}

/** A line's letters, digits and marks with spacing and hyphens set aside, as hasHeadingLine compares them. */
function bareLine(text) {
  return normalizePdfText(joinLetterSpacing(text)).replace(/[\s-]/g, "");
}

/**
 * Where a heading stands as a block of its own in a run of lines: on one
 * line, or wrapped over up to `maxLines` lines that hold nothing else. Each
 * result is the block's first line and the line after its last. The shared
 * matcher must also find the heading in the block, so words run together
 * are not a heading.
 *
 * Blind category: a line holding only the heading's words in another place
 * (typed text set as its own line) is a heading block too. The rules that
 * call this count the blocks, so a second one refuses the record.
 */
function headingBlocks(lines, heading, maxLines = 1) {
  const target = bareLine(heading);
  const blocks = [];
  for (let start = 0; start < lines.length; start += 1) {
    let joined = "";
    for (let end = start; end < lines.length && end < start + maxLines; end += 1) {
      const bare = bareLine(lines[end]);
      if (!bare) break;
      joined += bare;
      if (!target.startsWith(joined)) break;
      if (joined === target) {
        if (pdfTextHasPhrase(lines.slice(start, end + 1).join("\n"), heading)) blocks.push({ start, end: end + 1 });
        break;
      }
    }
  }
  return blocks;
}

/** A count as the export prints it: thousands separators, no decimals. */
function printedCount(value) {
  return Number(value).toLocaleString("en-US");
}

/**
 * The application job's record, before its PDF is read: the project name
 * carries the demonstration label, the workspace name holds no applicant
 * label, the sections and checklist rows are the template's in order, each
 * section has the disposition the definition gives it, and each row has a
 * disposition the definition allows. Returns the count of required rows left
 * outstanding, which the DRAFT stamp must state.
 *
 * Blind category: the dispositions are the journey's reading of the
 * application screen. The PDF's checklist table cannot be read row by row
 * (review 76), so the checker ties them to the PDF only through the stamp's
 * count and the absence of any "Attached for" line.
 */
function checkApplicationRecord(journey, job, label) {
  const rule = job.application;
  const { application } = journey;
  const demonstration = squashPdfText(rule.demonstrationLabel.text);
  if (!squashPdfText(journey.projectName).includes(demonstration)) {
    refuse(`${label} project name does not carry the demonstration label "${rule.demonstrationLabel.text}"`);
  }
  for (const word of rule.applicant.labels) {
    if (pdfTextHasPhrase(journey.workspaceName, word)) {
      refuse(`${label} workspace name holds the words "${word}", so its name could not be told from an applicant line`);
    }
  }

  const sections = rule.sections.list;
  if (application.sections.length !== sections.length) {
    refuse(`${label} lists ${application.sections.length} sections; the template this job names has ${sections.length}`);
  }
  application.sections.forEach((section, index) => {
    const expected = sections[index];
    if (section.key !== expected.key) refuse(`${label} section ${index + 1} is ${section.key}; the template's is ${expected.key}`);
    if (section.disposition !== expected.disposition) {
      refuse(`${label} section ${section.key} has the disposition ${section.disposition}; this job's definition gives it ${expected.disposition}`);
    }
  });

  const rows = rule.rows.list;
  if (application.rows.length !== rows.length) {
    refuse(`${label} lists ${application.rows.length} checklist rows; the template this job names has ${rows.length}`);
  }
  let outstanding = 0;
  application.rows.forEach((row, index) => {
    const expected = rows[index];
    if (row.key !== expected.key) refuse(`${label} checklist row ${index + 1} is ${row.key}; the template's is ${expected.key}`);
    if (rule.rows.refusedDispositions.includes(row.disposition)) {
      refuse(`${label} checklist row ${row.key} is ${row.disposition}; an agent-run proof attaches no stand-in document`);
    }
    if (row.disposition === "not-applicable") {
      if (!rule.rows.notApplicableFor.includes(expected.requirement)) {
        refuse(`${label} checklist row ${row.key} is marked not applicable, but the template requires it of every application`);
      }
      if ((row.reason ?? "").trim().length < rule.rows.minReasonLength) {
        refuse(`${label} checklist row ${row.key} is marked not applicable without a reason of at least ${rule.rows.minReasonLength} characters`);
      }
    } else if (rule.rows.countedRequirements.includes(expected.requirement)) {
      outstanding += 1;
    }
  });
  if (application.outstandingRequiredCount !== outstanding) {
    refuse(`${label} says ${application.outstandingRequiredCount} required attachments are outstanding; its checklist rows give ${outstanding}`);
  }
  if (outstanding < rule.draftStamp.minOutstanding) {
    refuse(`${label} leaves ${outstanding} required attachments outstanding; this job's record leaves at least ${rule.draftStamp.minOutstanding}, because an agent produces none`);
  }
  return outstanding;
}

/**
 * The application rules, for a job whose definition has an `application`
 * block (the California ATP application). The checker reads the exported
 * PDF itself, with Poppler's text and the shared matcher, and refuses the
 * record unless the PDF states what the definition lists:
 * - on the cover: the project name, the workspace name, the study place line
 *   for the record's place, the applicant line and the DRAFT stamp with the
 *   count of required rows the record leaves outstanding;
 * - every line that holds the place label holds the record's place, and
 *   every line that holds the word DRAFT is that stamp;
 * - the template's section titles, each once, as headings, in order; no
 *   section not final; every section's text opening with the demonstration
 *   label; the fixed note in the sections the definition names and in no
 *   other;
 * - each appendix heading once, in order, with its facts under it, or, for
 *   an appendix the job does not require, its included fact or the missing
 *   words; the facts only one journey's PDF prints, there and nowhere else;
 * - the required disclaimers, no refused phrase, no score under another
 *   label, no "Attached for" line, and the workspace's name on no line with
 *   an applicant label.
 * A PDF the export's fallback writer typeset (its notice is in the text) is
 * refused before anything else is read.
 *
 * The PDF is read as one run of lines with the page footers left out, so a
 * passage that crosses a page is read whole.
 *
 * Blind category: the checker reads words. It cannot tell whether a section
 * says anything true, whether a score is the run's stored score, or whether
 * the place the PDF names is where the journey worked. A phrase list cannot
 * catch every wording of a determination. A record and a PDF that were both
 * falsified to agree are not caught, only a record that disagrees with its
 * PDF.
 */
function checkApplication(journey, job, label, pagesByKind) {
  const rule = job.application;
  const outstanding = checkApplicationRecord(journey, job, label);
  const pdfLabel = `${label} ${rule.pdf} PDF`;
  const pages = pagesByKind.get(rule.pdf);
  const { place } = journey;
  const headings = job.itemHeadings[rule.pdf];

  const values = {
    label: place.label,
    geoid: place.geoid,
    kind: rule.placeLine.kindWords[place.kind],
    years: journey.crashes.years,
    projectName: journey.projectName,
    workspaceName: journey.workspaceName,
  };
  if (values.kind === undefined) throw new Error(`job definition ${job.id} has no placeLine.kindWords for ${place.kind}`);
  const fill = (template, extra = {}) =>
    template.replace(/\{(\w+)\}/g, (whole, name) => {
      const all = { ...values, ...extra };
      if (!Object.hasOwn(all, name)) throw new Error(`job definition ${job.id} uses the unknown placeholder ${whole}`);
      return String(all[name]);
    });

  const footer = new RegExp(rule.pageFooter);
  const lines = pages.flatMap((page) => page.split(/\r?\n/).filter((line) => !footer.test(line)));
  const text = (from, to) => lines.slice(from, to).join("\n");
  const everywhere = text(0, lines.length);
  const printsAnywhere = (phrase) => pdfTextHasPhrase(everywhere, phrase) || pages.some((page) => pdfTextHasPhrase(page, phrase));

  // The export's fallback writer says so in the PDF. That file is not the one a planner gets.
  if (rule.fallbackWriter && printsAnywhere(rule.fallbackWriter.notice)) {
    refuse(`${pdfLabel} was typeset by OpenPlan's built-in writer, not the browser engine ("${rule.fallbackWriter.notice}"); the export fell back, and a proof needs the PDF a planner gets`);
  }

  // The sections: each title once, as a heading, in order, before the checklist.
  const ends = headingBlocks(lines, rule.sections.end);
  if (ends.length === 0) refuse(`${pdfLabel} has no "${rule.sections.end}" heading, where its sections end`);
  const sectionsEnd = ends[0].start;
  const titles = rule.sections.list.map((section) => {
    const found = headingBlocks(lines.slice(0, sectionsEnd), section.title, rule.sections.maxTitleLines);
    if (found.length !== 1) {
      refuse(`${pdfLabel} must print the section title "${section.title}" exactly once as a heading before "${rule.sections.end}", found ${found.length}`);
    }
    return { ...section, ...found[0] };
  });
  titles.forEach((title, index) => {
    if (index > 0 && title.start < titles[index - 1].end) {
      refuse(`${pdfLabel} prints the section "${title.title}" before "${titles[index - 1].title}"; the template's sections are out of order`);
    }
  });

  // The cover: everything before the first section title.
  const cover = text(0, titles[0].start);
  for (const template of rule.cover.phrases) {
    const phrase = fill(template);
    if (!pdfTextHasPhrase(cover, phrase)) refuse(`${pdfLabel} cover does not print ${template.replace(/[{}]/g, "")} "${phrase}"`);
  }

  // The study place line, outside planner-typed text: on the cover, and every printing of its label.
  const placeLine = fill(rule.placeLine.template);
  if (!pdfTextHasPhrase(cover, placeLine)) refuse(`${pdfLabel} cover does not state "${placeLine}", the study place line for the record's place`);
  if (printsAnywhere(rule.placeLine.notRecorded)) refuse(`${pdfLabel} prints "${rule.placeLine.notRecorded}"`);
  const placeLabel = squashPdfText(rule.placeLine.label);
  const wantedPlace = squashPdfText(placeLine);
  lines.forEach((line, index) => {
    const squashed = squashPdfText(line);
    for (let at = squashed.indexOf(placeLabel); at !== -1; at = squashed.indexOf(placeLabel, at + 1)) {
      // The line from its label on, with the lines a long place name wraps onto.
      const passage = squashPdfText(lines.slice(index, index + 4).join(" "));
      if (!passage.slice(at).startsWith(wantedPlace)) {
        refuse(`${pdfLabel} prints "${rule.placeLine.label}" with another place than the record's ("${placeLine}"): "${line.trim().slice(0, 160)}"`);
      }
    }
  });

  // The applicant: the fixed line, and the workspace's name on no line with an applicant label.
  if (!pdfTextHasPhrase(cover, rule.applicant.line)) refuse(`${pdfLabel} cover does not print "${rule.applicant.line}"`);
  const workspace = squashPdfText(journey.workspaceName);
  for (const word of rule.applicant.labels) {
    const sameLine = lines.some((line) => squashPdfText(line).includes(workspace) && pdfTextHasPhrase(line, word));
    const asValue = [`${word}: ${journey.workspaceName}`, `${word} ${journey.workspaceName}`].some(printsAnywhere);
    if (sameLine || asValue) refuse(`${pdfLabel} prints the workspace's name with "${word}"; the workspace is not the applicant`);
  }

  // The DRAFT stamp: required, on the cover, with the record's count, and no other DRAFT line.
  const stamp = fill(rule.draftStamp.phrase, { count: printedCount(outstanding) });
  const draftLines = lines.map((line, index) => ({ line, index })).filter(({ line }) => /\bDRAFT\b/.test(joinLetterSpacing(line)));
  if (draftLines.length === 0) {
    refuse(`${pdfLabel} carries no DRAFT stamp, but the record leaves ${outstanding} required attachments outstanding; the stamp is required`);
  }
  for (const { line, index } of draftLines) {
    const whole = bareLine(stamp);
    if (bareLine(line) !== whole && bareLine(`${line}${lines[index + 1] ?? ""}`) !== whole) {
      refuse(`${pdfLabel} carries a DRAFT line that is not the stamp the record's rows give ("${stamp}"): "${line.trim().slice(0, 160)}"`);
    }
  }
  if (!pdfTextHasPhrase(cover, stamp)) refuse(`${pdfLabel} cover does not carry the stamp "${stamp}"`);

  // Each section's text: final, opening with the demonstration label, the fixed note only where the definition puts it.
  const demonstration = squashPdfText(rule.demonstrationLabel.text);
  titles.forEach((title, index) => {
    const body = text(title.end, index + 1 < titles.length ? titles[index + 1].start : sectionsEnd);
    const sectionLabel = `${pdfLabel} section "${title.title}"`;
    if (pdfTextHasPhrase(body, rule.sections.notFinal)) refuse(`${sectionLabel} is not final`);
    if (!squashPdfText(body).startsWith(demonstration)) {
      refuse(`${sectionLabel} text does not begin with the demonstration label "${rule.demonstrationLabel.text}"`);
    }
    const noted = pdfTextHasPhrase(body, rule.sections.fixedNote);
    if (title.disposition === "fixed-note" && !noted) refuse(`${sectionLabel} does not carry the fixed note "${rule.sections.fixedNote}"`);
    if (title.disposition !== "fixed-note" && noted) refuse(`${sectionLabel} carries the fixed note "${rule.sections.fixedNote}", but the application asks a question there`);
    if (title.disposition !== "fixed-note" && squashPdfText(body).length <= demonstration.length + 1) {
      refuse(`${sectionLabel} holds no text after the demonstration label`);
    }
  });

  // No attachment: the PDF prints an "Attached for" line only for a row with a document.
  for (const row of rule.rows.list) {
    const attached = fill(rule.rows.attachedLine, { title: row.title });
    if (printsAnywhere(attached)) refuse(`${pdfLabel} prints "${attached}", but the record attaches nothing`);
  }

  // The appendices: each heading once in the whole PDF, after the sections, in order.
  const appendices = rule.appendices.list.map((appendix) => {
    const heading = headings[appendix.item];
    const found = headingBlocks(lines, heading);
    if (found.length !== 1) refuse(`${pdfLabel} must print the heading "${heading}" exactly once as a line of its own, found ${found.length}`);
    if (found[0].start < sectionsEnd) refuse(`${pdfLabel} prints the heading "${heading}" among its sections, not after "${rule.sections.end}"`);
    return { ...appendix, heading, ...found[0] };
  });
  appendices.forEach((appendix, index) => {
    if (index > 0 && appendix.start < appendices[index - 1].end) {
      refuse(`${pdfLabel} prints "${appendix.heading}" before "${appendices[index - 1].heading}"; the appendices are out of order`);
    }
  });
  const last = appendices[appendices.length - 1];
  const closing = headingBlocks(lines, rule.appendices.end).find((block) => block.start >= last.end);
  if (!closing) refuse(`${pdfLabel} has no "${rule.appendices.end}" heading after "${last.heading}", where its appendices end`);
  const bodyOf = (item) => {
    const index = appendices.findIndex((appendix) => appendix.item === item);
    if (index === -1) throw new Error(`job definition ${job.id} names the unknown appendix ${item}`);
    return text(appendices[index].end, index + 1 < appendices.length ? appendices[index + 1].start : closing.start);
  };
  for (const appendix of appendices) {
    const body = bodyOf(appendix.item);
    if (appendix.facts) {
      const countField = rule.appendices.countField?.[appendix.item];
      const extra = countField ? { count: printedCount(journeyField(journey, countField)) } : {};
      for (const template of appendix.facts) {
        const fact = fill(template, extra);
        if (!pdfTextHasPhrase(body, fact)) refuse(`${pdfLabel} "${appendix.heading}" does not state "${fact}"`);
      }
    } else if (!pdfTextHasPhrase(body, appendix.includedFact) && !squashPdfText(body).startsWith(squashPdfText(rule.appendices.missing))) {
      refuse(`${pdfLabel} "${appendix.heading}" carries neither its fact "${appendix.includedFact}" nor "${rule.appendices.missing}" under its heading`);
    }
  }

  // Facts only one journey's PDF prints: there, in their appendix, and nowhere in another journey's.
  for (const fact of rule.appendices.roleFacts ?? []) {
    const heading = headings[fact.item];
    if (fact.roles.includes(journey.role)) {
      if (!pdfTextHasPhrase(bodyOf(fact.item), fact.phrase)) refuse(`${pdfLabel} "${heading}" does not carry ${fact.name}, which the ${journey.role} journey's PDF must`);
    } else if (printsAnywhere(fact.phrase)) {
      refuse(`${pdfLabel} carries ${fact.name}, which only the ${fact.roles.join(" or ")} journey's PDF prints`);
    }
  }

  // Tract data: the appendix agrees with what the journey says its run retrieved.
  const { equity } = rule.appendices;
  if (equity) {
    const retrieved = journeyField(journey, equity.field);
    const saysNone = pdfTextHasPhrase(bodyOf(equity.item), equity.noTractData);
    if (retrieved === false && !saysNone) refuse(`${pdfLabel} "${headings[equity.item]}" does not say "${equity.noTractData}", but the record says its run retrieved no tract data`);
    if (retrieved !== false && saysNone) refuse(`${pdfLabel} "${headings[equity.item]}" says "${equity.noTractData}", but the record says its run retrieved tract data`);
  }

  for (const phrase of rule.requiredPhrases ?? []) {
    if (!printsAnywhere(phrase)) refuse(`${pdfLabel} does not print "${phrase}"`);
  }
  for (const phrase of rule.refusedPhrases.phrases) {
    if (printsAnywhere(phrase)) refuse(`${pdfLabel} prints "${phrase}", which this job refuses anywhere in the PDF`);
  }

  // Scores: a label ending in score or points, a colon and a number must end one of the definition's labels.
  const flat = normalizePdfText(everywhere).replace(/-\n/g, "").replace(/\s+/g, " ");
  const words = rule.scores.words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const labels = rule.scores.labels.map(squashPdfText);
  for (const match of flat.matchAll(new RegExp(`\\b(?:${words})\\)?\\s*:\\s*-?\\d`, "g"))) {
    const before = flat.slice(0, match.index + match[0].lastIndexOf(":")).trimEnd();
    if (!labels.some((scoreLabel) => before.endsWith(scoreLabel))) {
      refuse(`${pdfLabel} prints a score that is not labeled an OpenPlan screening score: "${flat.slice(Math.max(0, match.index - 60), match.index + match[0].length + 8).trim()}"`);
    }
  }
}

function checkScreens(journey, job, label) {
  const { widths, modes } = job.screens;
  const seen = new Set();
  for (const row of journey.screens) {
    const rowLabel = `${label} screen ${row.screen} at ${row.width} px ${row.mode}`;
    if (!widths.includes(row.width)) refuse(`${rowLabel}: width must be one of ${widths.join(", ")}`);
    if (!modes.includes(row.mode)) refuse(`${rowLabel}: mode must be one of ${modes.join(", ")}`);
    const key = `${row.screen}|${row.width}|${row.mode}`;
    if (seen.has(key)) refuse(`${rowLabel} is recorded twice`);
    seen.add(key);
    if (row.axe.serious !== 0 || row.axe.critical !== 0) {
      refuse(`${rowLabel} has ${row.axe.serious} serious and ${row.axe.critical} critical accessibility violations`);
    }
    // The engine and rule tags the job's definition names (review 59, S7):
    // a clean result from another version or a narrower tag set is not the same check.
    const axe = job.screens.axe;
    if (axe && (row.axe.version !== axe.version || JSON.stringify(row.axe.tags) !== JSON.stringify(axe.tags))) {
      refuse(`${rowLabel} ran accessibility engine ${row.axe.version} with tags ${row.axe.tags.join(", ")}; this job's definition names ${axe.version} with ${axe.tags.join(", ")}`);
    }
    // Only when the job's definition says so (review 59, S6; the lead's decision of November 15).
    if (job.screens.consoleErrorsRefused && job.screens.required?.includes(row.screen) && row.consoleErrors > 0) {
      refuse(`${rowLabel} logged ${row.consoleErrors} console errors`);
    }
    // A required screen that scrolls sideways at phone width (review 59, S5).
    if (row.horizontalScroll && job.screens.noSidewaysScrollWidths?.includes(row.width) && job.screens.required?.includes(row.screen)) {
      refuse(`${rowLabel} scrolls sideways`);
    }
  }
  for (const screen of new Set(journey.screens.map((row) => row.screen))) {
    for (const width of widths) {
      for (const mode of modes) {
        if (!seen.has(`${screen}|${width}|${mode}`)) refuse(`${label} screen ${screen} has no check at ${width} px ${mode}`);
      }
    }
  }
  for (const screen of job.screens.required ?? []) {
    if (!seen.has(`${screen}|${widths[0]}|${modes[0]}`)) refuse(`${label} has no check of the ${screen} screen`);
  }
}

/**
 * Read every page's text with Poppler's pdftotext, the reader the journey
 * script uses (scripts/lib/poppler-text.mjs). A pdftotext that is not
 * Poppler's refuses the record before any page is read.
 * @param {string} absolutePath
 * @param {{spawn?: Function, execFile?: Function}} [options] stand-ins for tests
 */
export function pdftotextPages(absolutePath, options = {}) {
  try {
    assertPopplerTool("pdftotext", options);
  } catch (error) {
    throw new Error(`proven job record refused: ${error.message}`);
  }
  try {
    return popplerPdfPages(absolutePath, options);
  } catch {
    throw new Error(`proven job record refused: pdftotext could not read it: ${absolutePath}`);
  }
}

/**
 * Render one page to binary PPM with Poppler's pdftoppm, the renderer the
 * journey script uses (scripts/lib/poppler-pixels.mjs). A pdftoppm that is
 * not Poppler's refuses the record before any page is rendered.
 * @param {string} absolutePath
 * @param {number} page
 * @param {{spawn?: Function, execFile?: Function}} [options] stand-ins for tests
 */
export function pdftoppmPagePpm(absolutePath, page, options = {}) {
  try {
    assertPopplerTool("pdftoppm", options);
  } catch (error) {
    throw new Error(`proven job record refused: ${error.message}`);
  }
  try {
    return popplerPagePpm(absolutePath, page, options);
  } catch {
    throw new Error(`proven job record refused: pdftoppm could not render page ${page} of ${absolutePath}`);
  }
}

const SECRET_PATTERNS = [
  ["a plus-address", /[A-Za-z0-9._%-]+\+[A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ["an email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ["a JWT", /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/],
  // Every prefix the error-report sanitizer (src/lib/observability/error-report.ts)
  // scrubs is refused here too; capability-evidence.test.ts reads that file and
  // fails if one is missing. A bare `sk-` covers `sk-ant-` and `sk-proj-` keys.
  ["a token", /\b(?:sk-|sk_live_|sk_test_|rk_live_|rk_test_|sb_secret_|sb_publishable_|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abpr]-|[pst]k\.eyJ)[A-Za-z0-9_.-]{8,}/],
  ["a token", /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{8,}/],
  ["a token", /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/],
  ["a token or sign-in link", /(?:access_token|refresh_token|provider_token|token_hash|api_?key)\s*[=:]/i],
  ["a token or sign-in link", /\/auth\/v1\/(?:verify|callback|token)/i],
  ["a password", /\b(?:password|passwd|pwd)\s*[:=]\s*\S/i],
  ["a cookie", /\bsb-[a-z0-9]+-auth-token\b|\b(?:set-)?cookie\s*:/i],
];

/** The kind of secret a text holds, never the matched value, or null. */
function secretIn(text) {
  for (const [kind, pattern] of SECRET_PATTERNS) if (pattern.test(text)) return kind;
  return null;
}

function scanStrings(value, path) {
  if (typeof value === "string") {
    const found = secretIn(value);
    if (found) refuse(`${path} contains ${found}`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => scanStrings(item, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) scanStrings(item, `${path}.${key}`);
  }
}

const SCHEMA_ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "$defs", "$comment"]);
const SCHEMA_KEYWORDS = new Set([
  ...SCHEMA_ANNOTATIONS,
  "type", "properties", "required", "additionalProperties", "items", "minItems",
  "enum", "const", "pattern", "minimum", "minLength", "$ref", "allOf", "if", "then",
]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

/**
 * The subset of JSON Schema the record schema uses. An unsupported keyword is
 * an error, so the schema cannot quietly promise a rule nothing enforces.
 * `minLength` counts non-space characters: a blank name is not a name.
 */
function checkSchema(value, schema, path, root) {
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_KEYWORDS.has(key)) throw new Error(`record schema keyword ${key} at ${path} is not supported by the checker`);
  }
  if (schema.$ref !== undefined) {
    const name = String(schema.$ref).replace(/^#\/\$defs\//, "");
    if (Object.keys(schema).length !== 1 || !Object.hasOwn(root.$defs ?? {}, name)) {
      throw new Error(`record schema reference ${schema.$ref} at ${path} cannot be resolved`);
    }
    checkSchema(value, root.$defs[name], path, root);
    return;
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    throw new Error(`record schema at ${path} may only close objects`);
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) refuse(`${path} must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) refuse(`${path} must be one of ${schema.enum.join(", ")}`);
  if (schema.type) {
    const types = [].concat(schema.type);
    const actual = typeOf(value);
    if (!types.some((type) => type === actual || (type === "number" && actual === "integer"))) {
      refuse(`${path} must be ${types.join(" or ")}`);
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) refuse(`${path} is blank`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) refuse(`${path} is not in the expected form`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    refuse(`${path} must be at least ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) refuse(`${path} needs at least ${schema.minItems} entries`);
    if (schema.items) value.forEach((item, index) => checkSchema(item, schema.items, `${path}[${index}]`, root));
  }
  if (typeOf(value) === "object") {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) refuse(`${path} is missing ${key}`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) refuse(`${path} has unknown field ${key}`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) checkSchema(value[key], child, `${path}.${key}`, root);
    }
  }
  // Per-job sub-schemas: each allOf entry is `if` (the record names a job)
  // `then` (that job's fields). A `then` applies only when its `if` holds.
  if (schema.allOf !== undefined) {
    if (!Array.isArray(schema.allOf)) throw new Error(`record schema allOf at ${path} must be a list`);
    for (const part of schema.allOf) checkSchema(value, part, path, root);
  }
  if ((schema.if === undefined) !== (schema.then === undefined)) throw new Error(`record schema at ${path} needs both if and then`);
  if (schema.if !== undefined && schemaAccepts(value, schema.if, path, root)) checkSchema(value, schema.then, path, root);
}

/** Whether a value meets a schema, for `if`. A defect in the schema itself still throws. */
function schemaAccepts(value, schema, path, root) {
  try {
    checkSchema(value, schema, path, root);
    return true;
  } catch (error) {
    if (String(error?.message).startsWith("proven job record refused: ")) return false;
    throw error;
  }
}

function refuse(reason) {
  throw new Error(`proven job record refused: ${reason}`);
}

function parsedSchema(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"))?.schema;
  } catch {
    return undefined;
  }
}

function checkReviewDate(reviewedAt, registryReviewedAt, today, label) {
  const date = new Date(`${reviewedAt}T00:00:00Z`);
  if (
    typeof reviewedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt) ||
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== reviewedAt ||
    reviewedAt < registryReviewedAt ||
    reviewedAt > today
  ) {
    throw new Error(`${label} needs a valid review date within the current registry review period`);
  }
}

function readEvidenceList(evidence, root, label) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error(`${label} has no evidence records`);
  }
  const seen = new Set();
  return evidence.map((item) => {
    const file = readEvidenceFile(item, root, label);
    if (seen.has(file.source)) throw new Error(`${label} repeats evidence: ${item.path}`);
    seen.add(file.source);
    return file;
  });
}

/**
 * A repository file whose bytes match the recorded SHA-256, read once.
 * `fail` throws the refusal: a plain error by default, as the first proven
 * job's record and every coverage cell have always been refused, or the
 * checker's `proven job record refused:` form for a job that asks for it
 * (review 59, F8).
 */
function readEvidenceFile(evidence, root, label, fail = plainFailure) {
  if (!evidence || typeof evidence.path !== "string" || !evidence.path.trim() || isAbsolute(evidence.path)) {
    fail(`${label} needs a repository-relative evidence path`);
  }
  let source;
  try {
    source = realpathSync(resolve(root, evidence.path));
    if (!statSync(source).isFile()) throw new Error("not a file");
  } catch {
    fail(`${label} evidence file is missing: ${evidence.path}`);
  }
  const local = relative(root, source);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    fail(`${label} evidence must stay inside the repository: ${evidence.path}`);
  }
  if (!/^[0-9a-f]{64}$/.test(evidence.sha256 ?? "")) {
    fail(`${label} evidence needs a lowercase SHA-256: ${evidence.path}`);
  }
  const bytes = readFileSync(source);
  if (bytes.length === 0) fail(`${label} evidence file is empty: ${evidence.path}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== evidence.sha256) {
    fail(`${label} evidence hash changed: ${evidence.path}`);
  }
  return { path: evidence.path, source, bytes };
}

function plainFailure(message) {
  throw new Error(message);
}
