import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { joinLetterSpacing, pdfTextHasPhrase } from "../lib/pdf-text-match.mjs";

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
 * workspace's record. The report page answers 404 through notFound(); the
 * report download and the application export answer 404 for a record they
 * cannot find and 403 for "Workspace access denied". A 401 means the second
 * account was not signed in, a 5xx means the handler failed before it decided,
 * and a 400 or 422 either never reached the workspace check or came after it
 * passed, so none of them is evidence of isolation.
 */
const CROSS_WORKSPACE_REFUSAL_STATUSES = new Set([403, 404]);

/**
 * Validate the dated, exact-byte records behind proven coverage cells and
 * proven jobs. Cells are checked for custody and review dates only; a proven
 * job entry also has its record read and checked by validateProvenJobRecord.
 * A reviewer must still judge whether the records prove the planning outcome.
 * @param {{reviewedAt: string, dimensions: Record<string, Array<{id: string, status: string, reviewedAt?: string, evidence?: Array<{path: string, sha256: string}>}>>, provenJobs?: Array<Record<string, unknown>>}} registry
 * @param {string} repoRoot
 * @param {string} today
 * @param {{readPdfPages?: (absolutePath: string) => string[]}} [options]
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
    validateProvenJobRecord(record, { repoRoot: root, readPdfPages: options.readPdfPages });
    if (record.jobId !== entry.jobId) throw new Error(`${label} names a record for ${record.jobId}`);
    if (record.commit !== entry.commit) throw new Error(`${label} commit does not match its record`);
    const recordPlaces = record.journeys.map(({ place }) => ({ kind: place.kind, geoid: place.geoid, stateFips: place.stateFips }));
    if (JSON.stringify(entry.places) !== JSON.stringify(recordPlaces)) {
      throw new Error(`${label} places do not match its record's journeys (kind, geoid, stateFips, in journey order)`);
    }
  }
}

/**
 * Refuse a proven job record unless it satisfies the record schema and its
 * job's rules in schemas/proven_job_definitions.v1.json, its PDFs are the
 * committed bytes it names, and neither the record nor any PDF page carries a
 * secret or an email address. Throws on the first refusal; returns nothing.
 *
 * Blind category: this proves required parts are present and bound to one
 * commit. It cannot tell whether the PDFs are useful to a planner, whether a
 * map image shows the right network, or whether a label names the place whose
 * Census id it carries.
 * @param {unknown} record
 * @param {{repoRoot: string, readPdfPages?: (absolutePath: string) => string[]}} options
 */
export function validateProvenJobRecord(record, { repoRoot, readPdfPages = pdftotextPages }) {
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

  const pdfPaths = new Set();
  for (const journey of record.journeys) {
    const rule = job.journeys.find((candidate) => candidate.role === journey.role);
    const label = `${journey.role} journey`;
    checkPlace(journey.place, rule, label);
    if (!journey.executor.agent.trim() || !journey.executor.model.trim()) refuse(`${label} executor is not named`);

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

    if (rule.crashes) {
      if (journey.crashes.sourceId !== rule.crashes.sourceId) {
        refuse(`${label} crashes come from ${journey.crashes.sourceId}, not ${rule.crashes.sourceId}`);
      }
      if (journey.crashes.storedCount < rule.crashes.minStoredCount) {
        refuse(`${label} stored ${journey.crashes.storedCount} crashes; at least ${rule.crashes.minStoredCount} required`);
      }
    }
    if (journey.bcaSaved !== true) refuse(`${label} did not save a benefit-cost analysis`);

    checkPdfs(journey, job, label, root, readPdfPages, pdfPaths);
    checkScreens(journey, job, label);
  }

  for (const target of job.crossWorkspaceTargets) {
    const checks = record.crossWorkspace.checks.filter((check) => check.target === target);
    if (checks.length === 0) refuse(`cross-workspace check for ${target} is missing`);
    for (const check of checks) {
      if (check.contentReturned || check.status < 400) {
        refuse(`cross-workspace request for another workspace's ${target} returned content (status ${check.status})`);
      }
      if (!CROSS_WORKSPACE_REFUSAL_STATUSES.has(check.status)) {
        refuse(
          `cross-workspace request for another workspace's ${target} answered status ${check.status}, which is inconclusive; ` +
            "only 403 (workspace access denied) or 404 (not found) shows the app refused it",
        );
      }
    }
  }

  const { sourceCheck } = record;
  if (sourceCheck.status === "differs") refuse("the crash source check found different counts; that is a finding, not a pass");
  if (sourceCheck.status !== "not-run" && (!sourceCheck.url || !sourceCheck.checkedOn)) {
    refuse("a crash source check needs the query URL and the date it was run");
  }
  const limitIds = new Set(record.limits.map((limit) => limit.id));
  const requiredLimits = [...job.requiredLimits];
  if (sourceCheck.status !== "matched") requiredLimits.push(job.unconfirmedCrashCountLimit);
  for (const id of requiredLimits) {
    if (!limitIds.has(id)) refuse(`record does not state the ${id} limit`);
  }
}

function checkPlace(place, rule, label) {
  if (place.kind !== rule.placeKind) refuse(`${label} must be a place of kind ${rule.placeKind}, found ${place.kind}`);
  const pattern = JOB_DEFINITIONS.geoidPatterns[place.kind];
  if (!pattern || !new RegExp(pattern).test(place.geoid)) refuse(`${label} geoid ${place.geoid} is not a ${place.kind} Census id`);
  if (rule.stateFips) {
    if (place.stateFips.length !== 1 || place.stateFips[0] !== rule.stateFips || !place.geoid.startsWith(rule.stateFips)) {
      refuse(`${label} must be in the state with FIPS ${rule.stateFips}`);
    }
  }
}

function checkPdfs(journey, job, label, root, readPdfPages, pdfPaths) {
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

    for (const [item, method] of Object.entries(job.items)) {
      const entries = pdf.items.filter((entry) => entry.item === item);
      if (entries.length !== 1) refuse(`${pdfLabel} must find ${item} exactly once, found ${entries.length}`);
      const entry = entries[0];
      if (entry.method !== method) refuse(`${pdfLabel} ${item} must be found by ${method}`);
      if (entry.page > pages.length) refuse(`${pdfLabel} ${item} names page ${entry.page} of ${pages.length}`);
      if (method === "pdftotext") {
        if (!entry.text || entry.imageSha256) refuse(`${pdfLabel} ${item} needs the text pdftotext found, and no image hash`);
        // The shared matcher the export test and the journey use: case,
        // wrapped lines and letter spacing aside, the text must be whole on
        // that page (scripts/lib/pdf-text-match.mjs).
        if (!pdfTextHasPhrase(pages[entry.page - 1], entry.text)) {
          refuse(`${pdfLabel} ${item} text is not on page ${entry.page}`);
        }
      } else if (!entry.imageSha256 || entry.text) {
        refuse(`${pdfLabel} ${item} needs the rendered page image hash, and no text`);
      }
    }
    if (pdf.items.length !== Object.keys(job.items).length) refuse(`${pdfLabel} lists items this job does not define`);
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
  }
  for (const screen of new Set(journey.screens.map((row) => row.screen))) {
    for (const width of widths) {
      for (const mode of modes) {
        if (!seen.has(`${screen}|${width}|${mode}`)) refuse(`${label} screen ${screen} has no check at ${width} px ${mode}`);
      }
    }
  }
}

/** Read every page's text with Poppler's pdftotext; pages are split on form feeds. */
export function pdftotextPages(absolutePath) {
  let output;
  try {
    output = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", absolutePath, "-"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const reason = error?.code === "ENOENT" ? "pdftotext (Poppler) is not installed" : "pdftotext could not read it";
    throw new Error(`proven job record refused: ${reason}: ${absolutePath}`);
  }
  const pages = output.split("\f");
  if (pages.length > 1 && pages[pages.length - 1].trim() === "") pages.pop();
  return pages;
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
  "enum", "const", "pattern", "minimum", "minLength", "$ref",
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
