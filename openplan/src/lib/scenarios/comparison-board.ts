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
      } satisfies ScenarioComparisonBoardCard;
    });
}
