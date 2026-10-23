import type { GuidedComparisonResult } from "@/lib/models/guided-comparison-results";
import type { ReportScenarioSetLink } from "@/lib/reports/scenario-provenance";

export type GuidedComparisonReportPayload = {
  schema: "openplan.guided-comparison-report.v1";
  workspaceId: string;
  projectId: string;
  snapshotId: string;
  snapshot: Record<string, unknown>;
  scenarioSet: { id: string; title: string; updated_at: string };
  entries: Array<{ id: string; label: string; entry_type: string; assumptions_json: Record<string, unknown>; updated_at: string }>;
  geography: Record<string, unknown>;
  population: Record<string, unknown>;
  sources: Array<{
    method: "aequilibrae" | "activitysim";
    role: "baseline" | "build";
    runId: string;
    link: Record<string, unknown>;
    inputSnapshot: Record<string, unknown>;
    output: Record<string, unknown>;
    kpis: Array<Record<string, unknown>>;
    decision: Record<string, unknown>;
    validation: Record<string, unknown>;
    validationArtifacts: Array<Record<string, unknown>>;
  }>;
  populationArtifacts: Array<Record<string, unknown>>;
  results: GuidedComparisonResult[];
  caveats: string[];
};

export type GuidedComparisonSelectionV1 = {
  version: 1;
  snapshotId: string;
  bindingSha256: string;
  payload: GuidedComparisonReportPayload;
};

export type GuidedComparisonOption = { id: string; projectId: string; label: string };

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Canonical report JSON retains finite fractional KPIs without integer coercion. */
export function guidedReportCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(guidedReportCanonicalJson).join(",")}]`;
  const record = objectRecord(value);
  if (record) return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${guidedReportCanonicalJson(record[key])}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  throw new Error("The guided report contains a non-JSON or nonfinite value.");
}

/** Absent and explicit clear preserve ordinary reports. Corrupt versions refuse. */
export function readGuidedComparisonSelection(metadata: unknown): GuidedComparisonSelectionV1 | null {
  const value = objectRecord(metadata)?.guidedComparisonSelectionV1;
  if (value === undefined || value === null) return null;
  const row = objectRecord(value);
  const payload = objectRecord(row?.payload);
  if (!row || row.version !== 1 || Object.keys(row).sort().join(",") !== "bindingSha256,payload,snapshotId,version" ||
      typeof row.snapshotId !== "string" || !/^[0-9a-f-]{36}$/.test(row.snapshotId) ||
      typeof row.bindingSha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.bindingSha256) ||
      payload?.schema !== "openplan.guided-comparison-report.v1" || payload.snapshotId !== row.snapshotId ||
      !Array.isArray(payload.sources) || payload.sources.length !== 4 || payload.sources.some((source) => typeof objectRecord(source)?.runId !== "string") ||
      !Array.isArray(payload.entries) || !Array.isArray(payload.results) || !Array.isArray(payload.caveats)) {
    throw new Error("The saved guided comparison selection has an unsupported version or invalid binding. Select it again before generation.");
  }
  return row as GuidedComparisonSelectionV1;
}

export function writeGuidedComparisonSelection(metadata: unknown, selection: GuidedComparisonSelectionV1 | null) {
  return { ...(objectRecord(metadata) ?? {}), guidedComparisonSelectionV1: selection };
}

export const GUIDED_REPORT_CAVEATS = [
  "The methods remain separate. No average or consensus result is calculated. Agreement is sensitivity evidence, not accuracy.",
  "These retained screening results establish no validated forecast, project benefit, or nationwide scientific acceptance.",
  "ActivitySim trip-table rows count person-trip records, not assigned vehicle trips. The two trip quantities have different definitions.",
  "Where prototype_mtc coefficients are used, they remain borrowed and uncalibrated. Inconclusive and out-of-area validation remain inconclusive.",
  "The common population covers household residents. Group quarters are excluded and unassessed; full population coverage is unassessed.",
  "The build applies the recorded synthetic change in internal auto trips. It does not represent a physical road change or establish a project benefit.",
];

/** Include the explicit snapshot without inventing Analysis Studio attachments. */
export function includeGuidedScenarioBasis(links: ReportScenarioSetLink[], selection: GuidedComparisonSelectionV1 | null): ReportScenarioSetLink[] {
  if (!selection) return links;
  const p = selection.payload;
  const baseline = p.entries.find((entry) => entry.id === p.snapshot.baseline_entry_id);
  const build = p.entries.find((entry) => entry.id === p.snapshot.candidate_entry_id);
  const selected = { comparisonSnapshotId: p.snapshotId, label: String(p.snapshot.label), summary: typeof p.snapshot.summary === "string" ? p.snapshot.summary : null,
    status: "ready", candidateEntryId: build?.id ?? "", candidateEntryLabel: build?.label ?? null,
    indicatorDeltaCount: 0, updatedAt: String(p.snapshot.updated_at) };
  const existing = links.find((link) => link.scenarioSetId === p.scenarioSet.id);
  if (existing) return links.map((link) => link !== existing ? link : { ...link,
    comparisonSnapshots: [selected, ...(link.comparisonSnapshots ?? []).filter((snapshot) => snapshot.comparisonSnapshotId !== p.snapshotId)] });
  return [...links, { scenarioSetId: p.scenarioSet.id, scenarioSetTitle: p.scenarioSet.title,
    baselineEntryId: baseline?.id ?? null, baselineLabel: baseline?.label ?? null,
    baselineRunId: null, baselineRunTitle: null, baselineRunCreatedAt: null, matchedRunIds: [], matchedEntries: [],
    comparisonSummary: { totalAlternatives: 0, readyAlternatives: 0, blockedAlternatives: 0, baselineEntryPresent: Boolean(baseline), baselineRunPresent: false,
      label: "Explicit guided snapshot; separate worker outputs, no Analysis Studio attachment" },
    scenarioSetUpdatedAt: p.scenarioSet.updated_at, latestMatchedEntryUpdatedAt: null, latestMatchedRunCreatedAt: null,
    comparisonSnapshots: [selected] }];
}
