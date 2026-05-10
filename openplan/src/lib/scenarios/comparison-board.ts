import { buildMetricDeltas, formatDelta, type MetricDelta } from "@/lib/analysis/compare";
import { buildScenarioStudioHref } from "@/lib/scenarios/catalog";

export type ScenarioComparisonBoardRun = {
  id: string;
  title: string;
  metrics: Record<string, unknown> | null;
};

export type ScenarioComparisonBoardEntry = {
  id: string;
  entry_type: string;
  label: string;
  assumptions_json?: Record<string, unknown> | null;
  attached_run_id: string | null;
  attachedRun: ScenarioComparisonBoardRun | null;
};

export type ScenarioComparisonBoardMetric = {
  key: string;
  label: string;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  deltaLabel: string;
  tone: "success" | "warning" | "neutral";
};

export type ScenarioComparisonBoardCard = {
  entryId: string;
  candidateLabel: string;
  candidateRunId: string;
  candidateRunTitle: string;
  baselineLabel: string;
  baselineRunId: string;
  baselineRunTitle: string;
  changedMetricCount: number;
  analysisHref: string;
  headlineMetrics: ScenarioComparisonBoardMetric[];
  sourceContext: ScenarioComparisonSourceContext;
};

export type ScenarioComparisonSourceContext = {
  pairingLabel: string;
  sourceSummary: string;
  baselineAssumptions: string;
  alternativeAssumptions: string;
  caveatSummary: string;
  exportReadiness: string;
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

const METRIC_TONES: Record<string, { positive: "success" | "warning" | "neutral"; negative: "success" | "warning" | "neutral" }> = {
  overallScore: { positive: "success", negative: "warning" },
  accessibilityScore: { positive: "success", negative: "warning" },
  safetyScore: { positive: "success", negative: "warning" },
  equityScore: { positive: "success", negative: "warning" },
  totalTransitStops: { positive: "success", negative: "warning" },
  totalFatalCrashes: { positive: "warning", negative: "success" },
  pctDisadvantaged: { positive: "neutral", negative: "neutral" },
  pctZeroVehicle: { positive: "neutral", negative: "neutral" },
};

function toneForMetricDelta(metric: MetricDelta): "success" | "warning" | "neutral" {
  if (metric.delta === null || metric.delta === 0) return "neutral";
  const config = METRIC_TONES[metric.key] ?? { positive: "neutral", negative: "neutral" };
  return metric.delta > 0 ? config.positive : config.negative;
}

function formatAssumptionValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null;
}

function assumptionCount(assumptions: Record<string, unknown> | null | undefined): number {
  if (!assumptions) return 0;
  return Object.values(assumptions).filter((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  }).length;
}

function formatPlannerAssumptions(
  roleLabel: "Baseline" | "Alternative",
  assumptions: Record<string, unknown> | null | undefined
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

function buildScenarioComparisonSourceContext({
  baselineEntry,
  candidateEntry,
  changedMetricCount,
  headlineMetrics,
}: {
  baselineEntry: ScenarioComparisonBoardEntry;
  candidateEntry: ScenarioComparisonBoardEntry;
  changedMetricCount: number;
  headlineMetrics: ScenarioComparisonBoardMetric[];
}): ScenarioComparisonSourceContext {
  const evidenceLabels = headlineMetrics.map((metric) => metric.label);
  const evidenceLabelSummary =
    evidenceLabels.length > 0
      ? `${evidenceLabels.length} planner-readable scorecard indicator${evidenceLabels.length === 1 ? "" : "s"}`
      : "attached run scorecard evidence";

  return {
    pairingLabel: `${candidateEntry.label} compared against ${baselineEntry.label}`,
    sourceSummary: `Source context: attached run scorecards from “${candidateEntry.attachedRun?.title ?? "Alternative run"}” and “${baselineEntry.attachedRun?.title ?? "Baseline run"}” using ${evidenceLabelSummary}. No behavioral-onramp KPI rows are read by this board.`,
    baselineAssumptions: formatPlannerAssumptions("Baseline", baselineEntry.assumptions_json),
    alternativeAssumptions: formatPlannerAssumptions("Alternative", candidateEntry.assumptions_json),
    caveatSummary:
      "Caveat posture: planning analysis and evidence triage only; not a validated behavioral forecast or certified model calibration.",
    exportReadiness:
      changedMetricCount > 0
        ? "Export readiness: ready for a draft comparison packet when the report also carries these run links, assumptions, and caveats."
        : "Export readiness: run links are present, but no headline scorecard movement is detected; review assumptions before drafting narrative.",
    evidenceLabels,
  };
}

export function buildScenarioComparisonBoard({
  scenarioSetId,
  baselineEntry,
  alternativeEntries,
}: {
  scenarioSetId: string;
  baselineEntry: ScenarioComparisonBoardEntry | null;
  alternativeEntries: ScenarioComparisonBoardEntry[];
}): ScenarioComparisonBoardCard[] {
  if (!baselineEntry?.attached_run_id || !baselineEntry.attachedRun?.metrics) {
    return [];
  }

  const baselineRunId = baselineEntry.attached_run_id;

  return alternativeEntries
    .filter((entry) => entry.attached_run_id && entry.attachedRun?.metrics && entry.attached_run_id !== baselineRunId)
    .map((entry) => {
      const deltas = buildMetricDeltas(entry.attachedRun?.metrics ?? {}, baselineEntry.attachedRun?.metrics ?? {});
      const changedMetricCount = deltas.filter((metric) => metric.delta !== null && metric.delta !== 0).length;
      const headlineMetrics = deltas.slice(0, 4).map((metric) => ({
        key: metric.key,
        label: metric.label,
        current: metric.current,
        baseline: metric.baseline,
        delta: metric.delta,
        deltaLabel: formatDelta(metric.delta),
        tone: toneForMetricDelta(metric),
      }));

      return {
        entryId: entry.id,
        candidateLabel: entry.label,
        candidateRunId: entry.attached_run_id as string,
        candidateRunTitle: entry.attachedRun?.title ?? "Attached alternative run",
        baselineLabel: baselineEntry.label,
        baselineRunId,
        baselineRunTitle: baselineEntry.attachedRun?.title ?? "Attached baseline run",
        changedMetricCount,
        analysisHref: buildScenarioStudioHref({
          runId: entry.attached_run_id,
          baselineRunId,
          scenarioSetId,
          entryId: entry.id,
        }),
        headlineMetrics,
        sourceContext: buildScenarioComparisonSourceContext({
          baselineEntry,
          candidateEntry: entry,
          changedMetricCount,
          headlineMetrics,
        }),
      } satisfies ScenarioComparisonBoardCard;
    });
}
