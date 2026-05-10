export type ScenarioComparisonAssumptionInput = Record<string, unknown> | null | undefined;

export type ScenarioComparisonSourceContextInput = {
  baselineEntry: {
    id: string;
    label: string;
    assumptions_json?: ScenarioComparisonAssumptionInput;
    attached_run_id?: string | null;
    attachedRun?: { title?: string | null } | null;
  };
  candidateEntry: {
    id: string;
    label: string;
    assumptions_json?: ScenarioComparisonAssumptionInput;
    attached_run_id?: string | null;
    attachedRun?: { title?: string | null } | null;
  };
  changedMetricCount?: number;
  indicatorDeltaCount?: number;
  evidenceLabels?: string[];
  caveats?: string[];
  status?: string | null;
};

export type ScenarioComparisonSourceContext = {
  kind: "scenario_comparison_snapshot_source_context";
  pairingLabel: string;
  pairing: {
    baselineEntryId: string;
    baselineEntryLabel: string;
    baselineRunId: string | null;
    candidateEntryId: string;
    candidateEntryLabel: string;
    candidateRunId: string | null;
  };
  sourceSummary: string;
  baselineAssumptions: string;
  alternativeAssumptions: string;
  caveatSummary: string;
  caveats: string[];
  exportReadiness: string;
  exportReady: boolean;
  evidenceLabels: string[];
};

const PLANNER_ASSUMPTION_LABELS: Record<string, string> = {
  analysisMethod: "Analysis method",
  baseYear: "Base year",
  costYear: "Cost year",
  fundingScenario: "Funding scenario",
  geography: "Geography",
  geographyLabel: "Geography",
  growthRate: "Growth rate",
  horizon: "Horizon",
  horizonYear: "Horizon year",
  landUseScenario: "Land-use scenario",
  networkSource: "Network source",
  network_source: "Network source",
  projectPackage: "Project package",
  transitService: "Transit service",
};

const DEFAULT_SCENARIO_COMPARISON_CAVEAT =
  "Planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration.";

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function formatAssumptionValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null;
}

function assumptionCount(assumptions: ScenarioComparisonAssumptionInput): number {
  if (!assumptions) return 0;
  return Object.values(assumptions).filter((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  }).length;
}

export function formatScenarioPlannerAssumptions(
  roleLabel: "Baseline" | "Alternative",
  assumptions: ScenarioComparisonAssumptionInput
): string {
  const knownItems = Object.entries(assumptions ?? {})
    .map(([key, value]) => {
      const label = PLANNER_ASSUMPTION_LABELS[key];
      const formattedValue = formatAssumptionValue(value);
      return label && formattedValue ? `${label}: ${formattedValue}` : null;
    })
    .filter((value): value is string => Boolean(value));

  if (knownItems.length > 0) {
    return `${roleLabel}: ${knownItems.slice(0, 3).join(" · ")}`;
  }

  const count = assumptionCount(assumptions);
  if (count > 0) {
    return `${roleLabel}: ${count} structured assumption${count === 1 ? "" : "s"} recorded for audit.`;
  }

  return `${roleLabel}: assumptions not recorded yet.`;
}

export function buildScenarioComparisonSourceContext({
  baselineEntry,
  candidateEntry,
  changedMetricCount,
  indicatorDeltaCount,
  evidenceLabels: rawEvidenceLabels = [],
  caveats: rawCaveats = [],
  status,
}: ScenarioComparisonSourceContextInput): ScenarioComparisonSourceContext {
  const evidenceLabels = dedupeStrings(rawEvidenceLabels).slice(0, 12);
  const evidenceCount =
    typeof indicatorDeltaCount === "number" ? indicatorDeltaCount : changedMetricCount ?? evidenceLabels.length;
  const evidenceLabelSummary =
    evidenceLabels.length > 0
      ? `${evidenceLabels.length} planner-readable scorecard indicator${evidenceLabels.length === 1 ? "" : "s"}`
      : evidenceCount > 0
        ? `${evidenceCount} saved indicator delta${evidenceCount === 1 ? "" : "s"}`
        : "attached run scorecard evidence";
  const hasMovement = (changedMetricCount ?? indicatorDeltaCount ?? 0) > 0;
  const exportReady = (status ?? "draft") === "ready" || hasMovement;
  const caveats = dedupeStrings([DEFAULT_SCENARIO_COMPARISON_CAVEAT, ...rawCaveats]).slice(0, 12);
  const candidateRunTitle = candidateEntry.attachedRun?.title?.trim() || "Alternative run";
  const baselineRunTitle = baselineEntry.attachedRun?.title?.trim() || "Baseline run";

  return {
    kind: "scenario_comparison_snapshot_source_context",
    pairingLabel: `${candidateEntry.label} compared against ${baselineEntry.label}`,
    pairing: {
      baselineEntryId: baselineEntry.id,
      baselineEntryLabel: baselineEntry.label,
      baselineRunId: baselineEntry.attached_run_id ?? null,
      candidateEntryId: candidateEntry.id,
      candidateEntryLabel: candidateEntry.label,
      candidateRunId: candidateEntry.attached_run_id ?? null,
    },
    sourceSummary: `Source context: attached run scorecards from “${candidateRunTitle}” and “${baselineRunTitle}” using ${evidenceLabelSummary}. No behavioral-onramp KPI rows are read by this board or snapshot helper.`,
    baselineAssumptions: formatScenarioPlannerAssumptions("Baseline", baselineEntry.assumptions_json),
    alternativeAssumptions: formatScenarioPlannerAssumptions("Alternative", candidateEntry.assumptions_json),
    caveatSummary: `Caveat posture: ${caveats.join(" ")}`,
    caveats,
    exportReady,
    exportReadiness: exportReady
      ? "Export readiness: ready for a draft comparison packet when the report also carries these run links, assumptions, and caveats."
      : "Export readiness: run links are present, but no headline scorecard movement is detected; review assumptions before drafting narrative.",
    evidenceLabels,
  };
}
