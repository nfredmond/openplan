/**
 * California Active Transportation Program (ATP) evidence appendices for the
 * packaged application, built only from records the workspace already saved
 * for the linked project:
 *
 *  A. The ATP screening packet (`buildAtpPacketView`): the program facts the
 *     registry holds, each cycle-dependent one with its `[VERIFY]` marker and
 *     the CTC page, the linked project's study place and the applicant line,
 *     and the OpenPlan screening scores from the project's latest corridor
 *     analysis run. A score the run did not record reads "Not recorded",
 *     never a number.
 *  B. The crash summary of the project's latest finished crash acquisition:
 *     source, years, severity coverage and the counts the Safety module reads.
 *  C. The planning-level cost estimate recorded on the project.
 *  D. The engagement summary and F. the benefit-cost summary, shared with SS4A.
 *  E. The disadvantaged-community and equity inputs the run recorded, then
 *     the six disadvantaged community criteria of the CTC's 2027 ATP
 *     Guidelines, section 12.A, by the Guidelines' names and in their order,
 *     each with what OpenPlan holds. OpenPlan holds a fact for one of them
 *     only: whether the study place is a Census tribal area. No row is a
 *     determination, and OpenPlan does not decide ATP eligibility.
 *
 * Every fact prints as one line, "Label: value" (`evidence-appendices.ts`), so
 * the screening scores are facts here, not a two-column table.
 *
 * Pure: no I/O. `atp-evidence-loader.ts` reads the records.
 */

import { scoreWithheldReason, type HeadlineScoreKey } from "@/lib/analysis/score-presentation";
import {
  ATP_APPLICANT_NOT_ENTERED,
  ATP_CATALOG_KEY,
  ATP_STUDY_PLACE_NOT_RECORDED,
  atpStudyPlaceLine,
  buildAtpPacketView,
  formatYears,
  readAtpStudyPlace,
  type AtpPacketProject,
  type AtpPacketRun,
} from "@/lib/grants/atp-packet";
import { formatEvidenceTimestamp } from "@/lib/grants/evidence-timestamp";
import { ATP_APPENDIX_KEYS, ATP_APPENDIX_TITLES, type AtpAppendixKey } from "@/lib/grants/evidence-appendix-keys";
import {
  absentEvidenceAppendix,
  appendixShell,
  bcaEvidenceAppendix,
  describeSeverityCoverage,
  engagementEvidenceAppendix,
  NO_PROJECT_REASON,
  type EvidenceAppendix,
  type EvidenceAppendixFrame,
  type EvidenceAppendixShell,
  type EvidenceAppendixSource,
  type ProjectBcaRead,
  type ProjectEngagementRead,
} from "@/lib/grants/evidence-appendices";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { ATP_VERIFY_GUIDELINES, formatPacketScore } from "@/lib/planner-pack/render";
import { formatProjectEstimate } from "@/lib/projects/estimated-cost";
import type { SafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { crashAreaBasisLabel, crashBoundaryCountLabel } from "@/lib/safety/crash-study-area";

export type AtpAppendix = EvidenceAppendix<AtpAppendixKey>;

/** How the ATP appendices open: what they are, and what to verify with the CTC. */
export const ATP_APPENDIX_FRAME: EvidenceAppendixFrame = {
  intro:
    "Each appendix restates a saved OpenPlan record for the linked project, with its source record and date. Missing records are listed as missing. Scores are OpenPlan screening scores, not CTC scores. These appendices do not establish ATP eligibility or that this package meets the current call for projects.",
  verify: `${ATP_VERIFY_GUIDELINES} Confirm the required attachments and scoring criteria against the current ATP guidelines.`,
};

/** Said beside the study place wherever it prints: it is not the project's limits. */
const ATP_STUDY_PLACE_NOTE =
  "The study place is the area recorded for the linked project in OpenPlan. It does not state the project limits.";

/** What the cover says when the project read failed: a failed read is not an absence. */
const ATP_STUDY_PLACE_UNREAD = "Study place could not be read while this package was assembled";

/**
 * The lines an ATP application's cover prints in every export, whichever
 * appendices are selected: the linked project's study place, the applicant,
 * and what the study place is not. None of it is text the planner typed.
 */
export function atpCoverLines(project: AtpEvidenceRecords["project"]): string[] {
  const studyPlace =
    project.status === "ready"
      ? atpStudyPlaceLine(project.project)
      : project.status === "unreadable"
        ? ATP_STUDY_PLACE_UNREAD
        : ATP_STUDY_PLACE_NOT_RECORDED;
  return [studyPlace, ATP_APPLICANT_NOT_ENTERED, ATP_STUDY_PLACE_NOTE];
}

/**
 * The disadvantaged community criteria of the CTC's 2027 Active Transportation
 * Program Guidelines (Resolution G-26-31, adopted March 19, 2026), section
 * 12.A "Disadvantaged Communities", by the names the Guidelines give them and
 * in the Guidelines' order. The Guidelines open the list: "To qualify as a
 * disadvantaged community, the community served by the project must meet at
 * least one of the following criteria". Read November 15, 2026 from
 * https://catc.ca.gov/-/media/ctc-media/documents/programs/atp/cycle8/2027-atp-guidelines-a11y.pdf.
 * AB 1550 is not among them. The thresholds and data years are the
 * Guidelines' to state and change by cycle; they are not repeated here.
 */
export const ATP_GUIDELINES_DAC_CRITERIA = [
  "Median Household Income",
  "CalEnviroScreen",
  "National School Lunch Program",
  "Healthy Places Index",
  "Native American Tribal Lands",
  "Other",
] as const;

const NOT_RECORDED_IN_OPENPLAN = "Not recorded in OpenPlan";

/** The project record the packet and cost estimate read, as the loader found it. */
export type AtpProjectRecord = AtpPacketProject & {
  estimated_cost_recorded_at?: string | null;
  estimated_cost_source_document_id?: string | null;
};

type Read<T> =
  | { status: "no_project" }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | ({ status: "ready" } & T);

export type AtpEvidenceRecords = {
  projectId: string | null;
  project: Read<{ project: AtpProjectRecord }>;
  /** The project's latest corridor analysis run. */
  run: Read<{ run: AtpPacketRun }>;
  /** The project's latest finished crash acquisition, its counts, and when it was retrieved. */
  crash: Read<{ evidence: SafetyCrashEvidence; retrievedAt: string | null }>;
  bca: ProjectBcaRead;
  engagement: ProjectEngagementRead;
  /** When the packet was assembled, stamped on the screening packet. */
  generatedAt: string;
  /** The workspace calendar's zone, for the crash retrieval day the packet names. */
  timeZone: string;
};

const NO_RECORD_HASH = "No content hash is stored for this record";
const NO_RUN_REASON =
  "No corridor analysis run is saved for the linked project, so no screening score or equity input is recorded.";
const NO_ACQUISITION_REASON =
  "No finished crash acquisition is saved for the linked project. That is a gap in what has been retrieved, not a finding that no crashes occurred.";

function notReady<K extends AtpAppendixKey>(
  shell: EvidenceAppendixShell<K>,
  read: { status: "no_project" } | { status: "absent" } | { status: "unreadable"; reason: string },
  absentReason: string
): AtpAppendix {
  if (read.status === "no_project") return absentEvidenceAppendix(shell, "missing", NO_PROJECT_REASON);
  if (read.status === "absent") return absentEvidenceAppendix(shell, "missing", absentReason);
  return absentEvidenceAppendix(shell, "unreadable", read.reason);
}

function runSource(run: AtpPacketRun): EvidenceAppendixSource {
  return {
    record: "Corridor analysis run",
    id: run.id,
    date: run.created_at,
    dateLabel: "Run saved",
    hash: null,
    hashLabel: NO_RECORD_HASH,
    link: null,
    details: run.title ? [`Run title: ${run.title}.`] : [],
  };
}

function projectSource(project: AtpProjectRecord, date: string | null, dateLabel: string): EvidenceAppendixSource {
  return { record: "Project record", id: project.id, date, dateLabel, hash: null, hashLabel: NO_RECORD_HASH, link: `/projects/${project.id}`, details: [] };
}

/** A score as the packet carries it, with the run's own reason when it was withheld. */
function scoreCell(value: number | null, metrics: Record<string, unknown> | null, key: HeadlineScoreKey | null): string {
  if (value !== null) return formatPacketScore(value);
  const reason = key ? scoreWithheldReason(metrics, key) : null;
  return reason ? `Not recorded. ${reason}` : "Not recorded";
}

/** The registry's program facts, each cycle-dependent one marked for verification. */
function programFacts(): Array<{ label: string; value: string }> {
  const entry = GRANT_PROGRAM_CATALOG.find((program) => program.key === ATP_CATALOG_KEY);
  if (!entry) return [{ label: "Program facts", value: "Not recorded in the program registry" }];
  return [
    { label: "Program", value: entry.name },
    { label: "Administering agency", value: entry.administeringAgency },
    { label: "Program page", value: entry.url },
    { label: "Cycle (program registry note)", value: `${entry.cycleNote} ${ATP_VERIFY_GUIDELINES}` },
    { label: "Local match (program registry note)", value: `${entry.matchRequirement} ${ATP_VERIFY_GUIDELINES}` },
    { label: "Date these program facts were checked", value: "Not recorded. The program registry stores no check date." },
  ];
}

/** The label every screening score in the packet carries. */
export const ATP_SCREENING_SCORE_LABEL = "OpenPlan screening score (not a CTC score)";
/** The weighted total's own name, which says the weights are OpenPlan's. */
const ATP_TOTAL_SCORE_LABEL = "Total (OpenPlan weights 30/25/25/20, not CTC points)";

function scoringPacketAppendix(index: number, records: AtpEvidenceRecords): AtpAppendix {
  const shell = appendixShell("scoring_packet" as const, index, ATP_APPENDIX_TITLES);
  if (records.project.status !== "ready") return notReady(shell, records.project, "The linked project could not be found in this workspace.");
  // A failed run read is not "no run": it would turn every score into "not recorded".
  if (records.run.status === "unreadable") return absentEvidenceAppendix(shell, "unreadable", records.run.reason);
  const run = records.run.status === "ready" ? records.run.run : null;
  const metrics = run?.metrics ?? null;
  const view = buildAtpPacketView({ project: records.project.project, run, generatedAt: records.generatedAt, timeZone: records.timeZone });
  const app = view.packet.applications[0];

  // Each score is a fact that carries its own "not a CTC score" label, so the
  // number and what it is read as one line.
  const score = (dimension: string, value: number | null, key: HeadlineScoreKey | null) => ({
    label: `${dimension}, ${ATP_SCREENING_SCORE_LABEL}`,
    value: scoreCell(value, metrics, key),
  });

  return {
    ...shell,
    status: "included",
    statusNote: run ? null : "No corridor analysis run is saved for the linked project, so every screening score reads Not recorded.",
    source: run ? runSource(run) : projectSource(records.project.project, null, "Saved"),
    facts: [
      ...programFacts(),
      { label: "Project", value: app.name },
      { label: "Project description", value: app.description },
      // Whole sentences, the same two the cover prints.
      { label: "", value: app.location_note },
      { label: "", value: app.agency },
      { label: "Safety score source", value: app.safety_source_note ?? "Not recorded in the analysis run." },
      { label: "Project readiness", value: app.readiness_note },
      score("Safety", app.safety_score, "safetyScore"),
      score("Equity", app.equity_score, "equityScore"),
      score("Climate", app.climate_score, null),
      score("Feasibility", app.feasibility_score, null),
      score(ATP_TOTAL_SCORE_LABEL, app.total_score, null),
    ],
    table: null,
    figureSvg: null,
    notes: [
      "These are OpenPlan screening scores from the project's corridor analysis. The CTC scores ATP applications under its current guidelines.",
      "OpenPlan does not decide ATP eligibility.",
      "Climate, feasibility and the weighted total have no source in OpenPlan yet.",
      ATP_STUDY_PLACE_NOTE,
    ],
  };
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** The stored counts by severity, read through the source's own severity coverage. */
function severityFacts(evidence: SafetyCrashEvidence): Array<{ label: string; value: string }> {
  const counts = evidence.severityCounts;
  if (!counts) {
    return [{ label: "Crashes by severity", value: "Not available. The counts could not be read or do not reconcile with the acquisition's stored records." }];
  }
  const seriousInjury = evidence.seriousInjury;
  const fatalOnly = seriousInjury.effective === "fatal_only";
  const notInSource = "Not in source (fatal crashes only)";
  const splitsSerious = seriousInjury.separable;
  return [
    { label: "Fatal crashes", value: count(counts.fatal) },
    {
      label: "Serious-injury crashes",
      value: fatalOnly ? notInSource : splitsSerious ? count(counts.severe_injury) : (seriousInjury.absenceLabel ?? "Not separated in source (injury crashes not split by severity)"),
    },
    {
      label: splitsSerious ? "Other injury crashes" : "Injury crashes",
      value: fatalOnly ? notInSource : count(counts.injury + (splitsSerious ? 0 : counts.severe_injury)),
    },
    { label: "Property-damage-only crashes", value: fatalOnly ? notInSource : count(counts.pdo) },
    { label: "Crashes with no casualty count from the source", value: count(counts.unknown) },
    { label: "Fatal and serious-injury crashes", value: evidence.ksi === null ? "Not derivable from this source" : count(evidence.ksi) },
  ];
}

/** A stored calendar day inside a sentence ("2024-12-31") printed the way the appendices' other dates are. */
function plainDays(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b(?!T)/g, (day) => formatEvidenceTimestamp(day));
}

/**
 * The years the acquisition asked for, as one range, and, when the source
 * states a publication cutoff, that date on a line of its own. A tribal-area
 * export printed three year ranges with nothing saying which was which
 * (requested 2022 to 2025, a source published through 2024, and the corridor
 * run's own years). The requested range and the citation now print the same
 * range; the cutoff is named as the source's; the run's years print in the
 * screening packet as the run's.
 */
function crashYearFacts(evidence: SafetyCrashEvidence): Array<{ label: string; value: string }> {
  const facts = [{ label: "Years requested", value: evidence.years.length > 0 ? formatYears(evidence.years) : "Not recorded" }];
  const cutoff = evidence.publishedThrough?.trim();
  if (cutoff && /^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
    const cutoffYear = Number(cutoff.slice(0, 4));
    const later = evidence.years.filter((year) => year > cutoffYear);
    facts.push({
      label: "Source published through",
      value: `${formatEvidenceTimestamp(cutoff)}, as the source states.${later.length > 0 ? ` The source holds no published crashes for ${formatYears(later)}, which the request also covered.` : ""}`,
    });
  }
  return facts;
}

function crashAppendix(index: number, records: AtpEvidenceRecords): AtpAppendix {
  const shell = appendixShell("crash_summary" as const, index, ATP_APPENDIX_TITLES);
  if (records.crash.status !== "ready") return notReady(shell, records.crash, NO_ACQUISITION_REASON);
  const evidence = records.crash.evidence;
  const studyArea = evidence.studyArea;
  const boundaryCounts = crashBoundaryCountLabel(studyArea);
  return {
    ...shell,
    status: "included",
    statusNote: null,
    source: {
      record: "Crash acquisition",
      id: evidence.ingestId,
      date: records.crash.retrievedAt,
      dateLabel: "Retrieved",
      hash: null,
      hashLabel: NO_RECORD_HASH,
      link: null,
      details: [],
    },
    facts: [
      { label: "Source", value: evidence.sourceLabel ?? "Not recorded" },
      ...crashYearFacts(evidence),
      { label: "Severity coverage", value: describeSeverityCoverage(evidence.seriousInjury) },
      { label: "Crash area", value: crashAreaBasisLabel(studyArea) },
      ...(studyArea.outsideBoundaryCount !== null
        ? [{ label: "Crashes outside the boundary, left out", value: count(studyArea.outsideBoundaryCount) }]
        : []),
      ...(boundaryCounts ? [{ label: "Boundary counts", value: boundaryCounts }] : []),
      { label: "Crashes reported", value: count(evidence.reportedTotal) },
      { label: "Crashes mapped", value: count(evidence.mappedTotal) },
      { label: "Retrieval truncated", value: evidence.truncated ? "Yes; every count is a floor" : "No" },
      ...severityFacts(evidence),
    ],
    table: null,
    figureSvg: null,
    notes: [
      ...evidence.caveats.map(plainDays),
      "The safety screening score in the ATP screening packet comes from the corridor analysis run's own crash read. Its source and crash years print there and can differ from this acquisition's.",
      plainDays(evidence.citationText),
    ],
  };
}

function costAppendix(index: number, records: AtpEvidenceRecords): AtpAppendix {
  const shell = appendixShell("cost_estimate" as const, index, ATP_APPENDIX_TITLES);
  if (records.project.status !== "ready") return notReady(shell, records.project, "The linked project could not be found in this workspace.");
  const project = records.project.project;
  const amount = project.estimated_cost_amount;
  if (amount === null || amount === undefined || amount === "" || !project.estimated_cost_currency) {
    return absentEvidenceAppendix(shell, "missing", "No planning-level estimate is recorded on the linked project.");
  }
  return {
    ...shell,
    status: "included",
    statusNote: null,
    source: projectSource(project, project.estimated_cost_recorded_at ?? null, "Estimate recorded"),
    facts: [
      { label: "Planning-level estimate", value: formatProjectEstimate(amount, project.estimated_cost_currency) },
      { label: "Price year", value: project.estimated_cost_basis_year ? String(project.estimated_cost_basis_year) : "Not recorded" },
      {
        label: "Source document",
        value: project.estimated_cost_source_document_id ? `Knowledge Base document ${project.estimated_cost_source_document_id}` : "Not recorded",
      },
    ],
    table: null,
    figureSvg: null,
    notes: [
      "Planning-level estimate recorded on the project, not an engineer's estimate.",
      "No phase split (PA&ED, PS&E, R/W, CON) is recorded in OpenPlan.",
    ],
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The run's Census source line, as the run recorded it. A run whose Census
 * inputs were unavailable stores a tract count of 0; that is no data, not zero
 * tracts, so the line says no tract data was retrieved. A run that stored no
 * data-quality record did not say either way, and the line says that instead
 * of stating that none was retrieved.
 */
function demographicSource(metrics: Record<string, unknown> | null): string {
  const census = record(record(metrics?.sourceSnapshots)?.census);
  if (!census) return "Not recorded in the analysis run";
  const dataset = typeof census.dataset === "string" ? census.dataset : "Census dataset not recorded";
  const vintage = typeof census.vintage === "number" || typeof census.vintage === "string" ? ` ${census.vintage}` : "";
  const censusAvailable = record(metrics?.dataQuality)?.censusAvailable;
  if (typeof censusAvailable !== "boolean") {
    return `${dataset}${vintage}: the run did not record whether tract data was retrieved`;
  }
  if (!censusAvailable) {
    return `${dataset}${vintage}: no tract data was retrieved for this run`;
  }
  const tracts = typeof census.tractCount === "number" ? `, ${count(census.tractCount)} tracts` : "";
  const scale = census.clipScale === "corridor" ? ", clipped to the corridor" : census.clipScale === "county" ? ", whole county set, not clipped to the corridor" : "";
  return `${dataset}${vintage}${tracts}${scale}`;
}

/** A tract count the run recorded, only when its Census inputs were available. */
function proxyTractCount(metrics: Record<string, unknown> | null, key: string): string {
  const censusAvailable = record(metrics?.dataQuality)?.censusAvailable === true;
  const value = metrics?.[key];
  return censusAvailable && typeof value === "number" && Number.isFinite(value) ? count(value) : "Not recorded";
}

/**
 * One row per criterion of the Guidelines' section 12.A, in the Guidelines'
 * order. OpenPlan holds a fact for one: when the study place is a Census
 * tribal area, the Native American Tribal Lands row states that and nothing
 * more. It does not say the project is on federally recognized Tribal Lands,
 * that the applicant is a tribal government, or that the community qualifies.
 */
function guidelinesCriteriaFacts(project: AtpProjectRecord): Array<{ label: string; value: string }> {
  const place = readAtpStudyPlace(project);
  const tribalArea = place.recorded ? place.censusTribalAreaName : null;
  return ATP_GUIDELINES_DAC_CRITERIA.map((criterion) => ({
    label: `Guidelines criterion, ${criterion}`,
    value:
      criterion === "Native American Tribal Lands" && tribalArea
        ? `The study place is a Census tribal area: ${tribalArea}`
        : NOT_RECORDED_IN_OPENPLAN,
  }));
}

function equityAppendix(index: number, records: AtpEvidenceRecords): AtpAppendix {
  const shell = appendixShell("equity" as const, index, ATP_APPENDIX_TITLES);
  if (records.project.status !== "ready") return notReady(shell, records.project, "The linked project could not be found in this workspace.");
  if (records.run.status !== "ready") return notReady(shell, records.run, NO_RUN_REASON);
  const run = records.run.run;
  const metrics = run.metrics ?? null;
  const app = buildAtpPacketView({ project: records.project.project, run, generatedAt: records.generatedAt, timeZone: records.timeZone }).packet.applications[0];
  return {
    ...shell,
    status: "included",
    statusNote: null,
    source: runSource(run),
    facts: [
      { label: "Equity screening score (OpenPlan, not a CTC score)", value: scoreCell(app.equity_score, metrics, "equityScore") },
      { label: "Demographic source", value: demographicSource(metrics) },
      { label: "Tracts the ACS income and burden proxy flags", value: proxyTractCount(metrics, "disadvantagedTracts") },
      { label: "Low-income tracts (ACS proxy)", value: proxyTractCount(metrics, "lowIncomeTracts") },
      {
        label: "ATP disadvantaged-community criteria",
        value: `Not assessed. OpenPlan does not decide ATP eligibility; the CTC's guidelines set the criteria. ${ATP_VERIFY_GUIDELINES}`,
      },
      ...guidelinesCriteriaFacts(records.project.project),
    ],
    table: null,
    figureSvg: null,
    notes: [
      "The Guidelines criteria are the six the CTC's 2027 ATP Guidelines list in section 12.A, by the Guidelines' names and in their order. A community qualifies by meeting at least one. The Guidelines state each criterion's threshold and data year.",
      "No row above is a determination that a community is disadvantaged or that the project benefits one. The applicant shows that in the application.",
      "The ACS proxy is a screening measure. It is not the Guidelines' median household income criterion or any other criterion above.",
    ],
  };
}

const BUILDERS: Record<AtpAppendixKey, (index: number, records: AtpEvidenceRecords) => AtpAppendix> = {
  scoring_packet: scoringPacketAppendix,
  crash_summary: crashAppendix,
  cost_estimate: costAppendix,
  engagement: (index, records) =>
    engagementEvidenceAppendix(
      appendixShell("engagement" as const, index, ATP_APPENDIX_TITLES),
      records.engagement,
      records.project.status === "ready" ? records.project.project.name : null
    ),
  equity: equityAppendix,
  bca: (index, records) => bcaEvidenceAppendix(appendixShell("bca" as const, index, ATP_APPENDIX_TITLES), records.bca, records.projectId),
};

/** Every ATP appendix, in a fixed order, whether included, missing, unreadable or omitted. */
export function buildAtpEvidenceAppendices(
  records: AtpEvidenceRecords,
  selected: ReadonlySet<string>
): AtpAppendix[] {
  return ATP_APPENDIX_KEYS.map((key, index) =>
    selected.has(key)
      ? BUILDERS[key](index, records)
      : absentEvidenceAppendix(appendixShell(key, index, ATP_APPENDIX_TITLES), "omitted", "Not selected for this export.")
  );
}
