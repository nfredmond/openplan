/**
 * California Active Transportation Program (ATP) evidence appendices for the
 * packaged application, built only from records the workspace already saved
 * for the linked project:
 *
 *  A. The ATP screening packet (`buildAtpPacketView`): the program facts the
 *     registry holds, each cycle-dependent one with its `[VERIFY]` marker and
 *     the CTC page, and the OpenPlan screening scores from the project's latest
 *     corridor analysis run. A score the run did not record reads
 *     "Not recorded", never a number.
 *  B. The crash summary of the project's latest finished crash acquisition:
 *     source, years, severity coverage and the counts the Safety module reads.
 *  C. The planning-level cost estimate recorded on the project.
 *  D. The engagement summary and F. the benefit-cost summary, shared with SS4A.
 *  E. The disadvantaged-community and equity inputs the run recorded. OpenPlan
 *     holds no SB 535, AB 1550 or tribal-area source, so those stay
 *     "Not recorded", and OpenPlan does not decide ATP eligibility.
 *
 * Pure: no I/O. `atp-evidence-loader.ts` reads the records.
 */

import { scoreWithheldReason, type HeadlineScoreKey } from "@/lib/analysis/score-presentation";
import {
  ATP_CATALOG_KEY,
  buildAtpPacketView,
  type AtpPacketProject,
  type AtpPacketRun,
} from "@/lib/grants/atp-packet";
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
import { separatesSeriousInjuries, type SafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { crashAreaBasisLabel, crashBoundaryCountLabel } from "@/lib/safety/crash-study-area";

export type AtpAppendix = EvidenceAppendix<AtpAppendixKey>;

/** How the ATP appendices open: what they are, and what to verify with the CTC. */
export const ATP_APPENDIX_FRAME: EvidenceAppendixFrame = {
  intro:
    "Each appendix restates a saved OpenPlan record for the linked project, with its source record and date. Missing records are listed as missing. Scores are OpenPlan screening scores, not CTC scores. These appendices do not establish ATP eligibility or that this package meets the current call for projects.",
  verify: `${ATP_VERIFY_GUIDELINES} Confirm the required attachments and scoring criteria against the current ATP guidelines.`,
};

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

function scoringPacketAppendix(index: number, records: AtpEvidenceRecords): AtpAppendix {
  const shell = appendixShell("scoring_packet" as const, index, ATP_APPENDIX_TITLES);
  if (records.project.status !== "ready") return notReady(shell, records.project, "The linked project could not be found in this workspace.");
  // A failed run read is not "no run": it would turn every score into "not recorded".
  if (records.run.status === "unreadable") return absentEvidenceAppendix(shell, "unreadable", records.run.reason);
  const run = records.run.status === "ready" ? records.run.run : null;
  const metrics = run?.metrics ?? null;
  const view = buildAtpPacketView({ project: records.project.project, run, generatedAt: records.generatedAt, timeZone: records.timeZone });
  const app = view.packet.applications[0];

  return {
    ...shell,
    status: "included",
    statusNote: run ? null : "No corridor analysis run is saved for the linked project, so every screening score reads Not recorded.",
    source: run ? runSource(run) : projectSource(records.project.project, null, "Saved"),
    facts: [
      ...programFacts(),
      { label: "Project", value: app.name },
      { label: "Project description", value: app.description },
      { label: "Lead agency", value: app.agency },
      { label: "Location", value: app.location_note },
      { label: "Safety score source", value: app.safety_source_note ?? "Not recorded in the analysis run." },
      { label: "Project readiness", value: app.readiness_note },
    ],
    table: {
      headers: ["Dimension", "OpenPlan screening score (not a CTC score)"],
      rows: [
        ["Safety", scoreCell(app.safety_score, metrics, "safetyScore")],
        ["Equity", scoreCell(app.equity_score, metrics, "equityScore")],
        ["Climate", scoreCell(app.climate_score, metrics, null)],
        ["Feasibility", scoreCell(app.feasibility_score, metrics, null)],
        ["Total (OpenPlan weights 30/25/25/20, not CTC points)", scoreCell(app.total_score, metrics, null)],
      ],
    },
    figureSvg: null,
    notes: [
      "These are OpenPlan screening scores from the project's corridor analysis. The CTC scores ATP applications under its current guidelines.",
      "OpenPlan does not decide ATP eligibility.",
      "Climate, feasibility and the weighted total have no source in OpenPlan yet.",
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
  const fatalOnly = evidence.severityCompleteness === "fatal_only";
  const notInSource = "Not in source (fatal crashes only)";
  const splitsSerious = separatesSeriousInjuries(evidence.severityCompleteness);
  return [
    { label: "Fatal crashes", value: count(counts.fatal) },
    {
      label: "Serious-injury crashes",
      value: fatalOnly ? notInSource : splitsSerious ? count(counts.severe_injury) : "Not separated in source (injury crashes not split by severity)",
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
      { label: "Years requested", value: evidence.years.length > 0 ? evidence.years.join(", ") : "Not recorded" },
      { label: "Severity coverage", value: describeSeverityCoverage(evidence.severityCompleteness) },
      { label: "Recorded severity coverage", value: evidence.severityCompleteness || "Not recorded" },
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
      ...evidence.caveats,
      "The safety screening score in the ATP screening packet comes from the corridor analysis run's own crash read, which can differ from this acquisition.",
      evidence.citationText,
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

/** The run's Census source line, as the run recorded it. */
function demographicSource(metrics: Record<string, unknown> | null): string {
  const census = record(record(metrics?.sourceSnapshots)?.census);
  if (!census) return "Not recorded in the analysis run";
  const dataset = typeof census.dataset === "string" ? census.dataset : "Census dataset not recorded";
  const vintage = typeof census.vintage === "number" || typeof census.vintage === "string" ? ` ${census.vintage}` : "";
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

function recordedFlag(recorded: boolean, value: boolean): string {
  return recorded ? (value ? "Yes" : "No") : "Not recorded";
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
      { label: "SB 535 disadvantaged community", value: recordedFlag(app.equity_recorded, app.dac_sb535) },
      { label: "AB 1550 low-income community", value: recordedFlag(app.equity_recorded, app.low_income_ab1550) },
      { label: "Tribal area", value: recordedFlag(app.equity_recorded, app.tribal_area) },
      {
        label: "ATP disadvantaged-community criteria",
        value: `Not assessed. OpenPlan does not decide ATP eligibility; the CTC's guidelines set the criteria. ${ATP_VERIFY_GUIDELINES}`,
      },
    ],
    table: null,
    figureSvg: null,
    notes: [
      "The ACS proxy is a screening measure. It is not the SB 535 designation or the ATP's disadvantaged-community test.",
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
