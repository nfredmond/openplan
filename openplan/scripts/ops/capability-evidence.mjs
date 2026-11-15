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
 * @param {{readPdfPages?: (absolutePath: string) => string[], renderPdfPage?: (absolutePath: string, page: number) => Uint8Array, readWorkbook?: (absolutePath: string) => Record<string, unknown[][]>}} [options]
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
 * named executors, artifact custody, no DRAFT stamp, accessibility rows at
 * the stated widths and modes, the cross-workspace rule, required limits and
 * the string scans. What one job needs because of what that job is (a saved
 * benefit-cost analysis, a crash source, a campaign's count agreement) is
 * data in that job's definition entry, read by the generic rules below
 * (checkJourneyFields, the sourceCheck block, checkCampaign).
 *
 * Blind category: this proves required parts are present, agree with each
 * other and are bound to one commit. It cannot tell whether the PDFs are
 * useful to a planner, whether the red marks on a map page are the right
 * place's ranked segments, or whether a label names the place whose Census
 * id it carries.
 * @param {unknown} record
 * @param {{repoRoot: string, readPdfPages?: (absolutePath: string) => string[], renderPdfPage?: (absolutePath: string, page: number) => Uint8Array, readWorkbook?: (absolutePath: string) => Record<string, unknown[][]>}} options
 *   readPdfPages and renderPdfPage default to Poppler's pdftotext and pdftoppm; tests may pass stand-ins.
 */
export function validateProvenJobRecord(record, { repoRoot, readPdfPages = pdftotextPages, renderPdfPage = pdftoppmPagePpm, readWorkbook = xlsxSheets }) {
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

  const artifactPaths = new Set();
  for (const journey of record.journeys) {
    const rule = job.journeys.find((candidate) => candidate.role === journey.role);
    const label = `${journey.role} journey`;
    checkPlace(journey.place, rule, job, label);
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

    // A campaign job's own record is checked first; its rejected texts are
    // then searched as each file is read, before any other rule can refuse
    // the file for something else.
    const campaignRecord = job.campaign ? checkCampaignRecord(journey, job, label) : undefined;
    const search = job.campaign ? rejectedTextSearch(journey, job, label) : undefined;
    const pages = checkPdfs(journey, job, label, root, readPdfPages, renderPdfPage, artifactPaths, search?.pdf);
    const workbooks = checkWorkbooks(journey, job, label, root, readWorkbook, artifactPaths, search?.workbook);
    checkScreens(journey, job, label);
    if (job.campaign) checkCampaign(journey, job, label, workbooks, pages, campaignRecord);
  }

  const pageAnsweredOk = checkCrossWorkspace(record.crossWorkspace.checks, job.crossWorkspace, roles);
  if (job.participantChecks) checkParticipantChecks(record.participantChecks, job.participantChecks);

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
    let found = rule.field.split(".").reduce((value, key) => (value == null ? undefined : value[key]), journey);
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
    return;
  }
  for (const role of job.executorRoles) {
    const named = journey.executors.filter((executor) => executor.role === role);
    if (named.length !== 1) refuse(`${label} needs exactly one ${role} executor, found ${named.length}`);
  }
  if (journey.executors.length !== job.executorRoles.length) refuse(`${label} names executors this job does not define`);
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
 * Blind category: the checker trusts the journey's reading of each response.
 * It cannot tell whether a staff-only value was returned under another name.
 */
function checkParticipantChecks(participant, rule) {
  for (const check of participant.refusals) {
    const label = `public participant request ${check.request}`;
    if (check.contentReturned) refuse(`${label} returned content (status ${check.status})`);
    if (!PARTICIPANT_REFUSAL_STATUSES.has(check.status)) {
      refuse(`${label} answered status ${check.status}, which is inconclusive; only 401, 403 or 404 shows the app refused it`);
    }
  }
  for (const request of rule.requiredRequests) {
    if (!participant.refusals.some((check) => check.request === request)) refuse(`public participant check ${request} is missing`);
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
}

/**
 * Check each PDF the job defines and return its pages by kind. `search`, when
 * given, is called with each PDF's pages after the custody, page count, DRAFT
 * and secret checks and before its items are checked. A PDF kind listed in
 * the definition's `pdfItems` carries those items instead of the job's.
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
    const { source, bytes } = readEvidenceFile(pdf, root, pdfLabel);
    if (pdfPaths.has(source)) refuse(`${pdfLabel} reuses another journey's file: ${pdf.path}`);
    pdfPaths.add(source);
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") refuse(`${pdfLabel} is not a PDF: ${pdf.path}`);
    if (bytes.length !== pdf.bytes) refuse(`${pdfLabel} is ${bytes.length} bytes, record says ${pdf.bytes}`);
    if (pdf.draftStamp) refuse(`${pdfLabel} is stamped DRAFT`);

    const pages = readPdfPages(source);
    if (pages.length !== pdf.pages) refuse(`${pdfLabel} has ${pages.length} pages, record says ${pdf.pages}`);
    pages.forEach((text, index) => {
      // A stamp set with letter spacing can read back as "D R A F T".
      if (/\bDRAFT\b/.test(joinLetterSpacing(text))) refuse(`${pdfLabel} page ${index + 1} carries a DRAFT stamp`);
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
    const { source, bytes } = readEvidenceFile(workbook, root, workbookLabel);
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

  checkPublicCopy(journey, rule, label, workbooks, pagesByKind, expected, approved);

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

/** The five counts the review files state, in the order the checker compares them. */
const CAMPAIGN_COUNTS = ["received", "approved", "rejected", "publishedResponses", "answered"];

/**
 * The public review copy, PDF and workbook (KI-2026-11-14-371). The PDF reads
 * its scope badge, says what it leaves out, states each of its counts with
 * the journey's number and none of the counts it leaves out. The workbook's
 * scope is public, its Summary rows hold the same counts and none it leaves
 * out, and its Contributions sheet holds exactly the approved comments.
 *
 * Blind category: a public copy that states the right counts and holds no
 * rejected text or id can still print something else a public copy should
 * not, such as a moderation note on an approved comment.
 */
function checkPublicCopy(journey, rule, label, workbooks, pagesByKind, expected, approved) {
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
 * A PDF is searched page by page with the shared matcher; an id is looked for
 * in all pages joined with spacing removed, since a narrow column can break
 * an id across lines. A workbook is searched cell by cell, and each value the
 * export split into Long text rows is joined and searched as one.
 *
 * Blind category: a rejected text reworded, shortened or split across two
 * cells is not found. The checker cannot tell whether the text is the one
 * the participant typed, only that it matches its hash.
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
      texts.forEach((text, index) => {
        const page = pages.findIndex((pageText) => pdfTextHasPhrase(pageText, text));
        verdict(pdf.kind, pdfLabel, `rejected text ${index + 1}`, page >= 0 ? `page ${page + 1}` : null);
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

/** A repository file whose bytes match the recorded SHA-256, read once. */
function readEvidenceFile(evidence, root, label) {
  if (!evidence || typeof evidence.path !== "string" || !evidence.path.trim() || isAbsolute(evidence.path)) {
    throw new Error(`${label} needs a repository-relative evidence path`);
  }
  let source;
  try {
    source = realpathSync(resolve(root, evidence.path));
    if (!statSync(source).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`${label} evidence file is missing: ${evidence.path}`);
  }
  const local = relative(root, source);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`${label} evidence must stay inside the repository: ${evidence.path}`);
  }
  if (!/^[0-9a-f]{64}$/.test(evidence.sha256 ?? "")) {
    throw new Error(`${label} evidence needs a lowercase SHA-256: ${evidence.path}`);
  }
  const bytes = readFileSync(source);
  if (bytes.length === 0) throw new Error(`${label} evidence file is empty: ${evidence.path}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== evidence.sha256) {
    throw new Error(`${label} evidence hash changed: ${evidence.path}`);
  }
  return { path: evidence.path, source, bytes };
}
