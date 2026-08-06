import { buildMetricDeltas, formatDelta, type MetricDelta } from "@/lib/analysis/compare";
import { getManagedRunModeDefinition } from "@/lib/models/run-modes";
import { buildScenarioStudioHref } from "@/lib/scenarios/catalog";
import {
  buildScenarioComparisonSourceContext,
  type ScenarioComparisonSourceContext,
} from "@/lib/scenarios/comparison-source-context";

export type ScenarioComparisonBoardRun = {
  id: string;
  title: string;
  metrics: Record<string, unknown> | null;
};

export type ScenarioComparisonBoardModelRun = {
  id: string;
  run_title: string;
  engine_key: string;
  status: string;
  result_summary_json: Record<string, unknown> | null;
};

export type ScenarioComparisonBoardEvidenceSource = "analysis_run" | "model_run";

export type ScenarioComparisonBoardEntry = {
  id: string;
  entry_type: string;
  label: string;
  assumptions_json?: Record<string, unknown> | null;
  attached_run_id: string | null;
  attachedRun: ScenarioComparisonBoardRun | null;
  attached_model_run_id?: string | null;
  attachedModelRun?: ScenarioComparisonBoardModelRun | null;
};

export type ScenarioComparisonBoardMetric = {
  key: string;
  label: string;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  deltaLabel: string;
  tone: "success" | "warning" | "neutral";
  /** True when both runs carry a number and subtracting them would mislead. */
  incomparable: boolean;
  /**
   * WHY, IN A SENTENCE A PLANNER CAN ACT ON. Null when comparable.
   *
   * The board dropped this field for as long as it existed: `buildMetricDeltas`
   * produced the reason, the card rendered a bare "Not comparable" badge, and the
   * explanation reached no surface at all. A refusal a reader cannot act on is
   * indistinguishable from a bug in the product, and the first thing a planner
   * does with one is work around it.
   */
  incomparableReason: string | null;
};

export type ScenarioComparisonBoardCard = {
  entryId: string;
  candidateLabel: string;
  candidateRunId: string;
  candidateRunTitle: string;
  baselineLabel: string;
  baselineRunId: string;
  baselineRunTitle: string;
  /** Which kind of run backs each side of this card. */
  evidenceSource: ScenarioComparisonBoardEvidenceSource;
  baselineEvidenceSource: ScenarioComparisonBoardEvidenceSource;
  /** Present only when that side's evidence is a worker model run. */
  candidateModelRun: { engineKey: string; status: string } | null;
  baselineModelRun: { engineKey: string; status: string } | null;
  changedMetricCount: number;
  analysisHref: string;
  headlineMetrics: ScenarioComparisonBoardMetric[];
  sourceContext: ScenarioComparisonSourceContext;
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

/** The scorecard keys `buildModelRunResultSummary` stamps into
 * model_runs.result_summary_json for managed deterministic runs — the same
 * namespace the board's metric-delta builder reads. */
const MODEL_RUN_SCORECARD_KEYS = [
  "overallScore",
  "accessibilityScore",
  "safetyScore",
  "equityScore",
] as const;

/**
 * Pure adapter from a model run's result_summary_json onto the board's metric
 * shape. Only the scorecard keys the comparison-delta builder understands are
 * carried across; worker engines whose summaries use engine-specific KPI
 * namespaces (snake_case sketch/trip-gen keys) yield null, so a model run
 * without comparable metrics never fakes comparison readiness.
 *
 * THE PROVENANCE RIDES ALONG, AND LEAVING IT BEHIND INVERTED THE REFUSAL. This
 * used to return the four numbers and nothing else, so `resolveTransitMethod`
 * saw no `sourceSnapshots` on either side and reported EVERY model run as
 * "not recorded". The consequence was backwards in both directions at once: a
 * model run could never be compared with an analysis run measured identically,
 * while two model runs measured two DIFFERENT ways compared cleanly, because
 * both were equally silent. Carrying the snapshot through is what lets the two
 * sides disagree when they should.
 */
export function modelRunComparisonMetrics(
  resultSummary: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!resultSummary || typeof resultSummary !== "object" || Array.isArray(resultSummary)) {
    return null;
  }

  const metrics: Record<string, unknown> = {};
  let scorecardKeys = 0;
  for (const key of MODEL_RUN_SCORECARD_KEYS) {
    const value = resultSummary[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key] = value;
      scorecardKeys += 1;
    }
  }

  // Comparison readiness is still decided by the NUMBERS alone: a summary
  // carrying provenance and no scorecard value has nothing to compare.
  if (scorecardKeys === 0) return null;

  const snapshots = resultSummary.sourceSnapshots;
  if (snapshots && typeof snapshots === "object" && !Array.isArray(snapshots)) {
    metrics.sourceSnapshots = snapshots;
  }

  return metrics;
}

type ResolvedEntryEvidence = {
  runId: string;
  runTitle: string;
  metrics: Record<string, unknown>;
  source: ScenarioComparisonBoardEvidenceSource;
  modelRun: { engineKey: string; status: string } | null;
  /** Screening-grade framing for model-run evidence, reused verbatim from the
   * run-mode registry — never newly worded claim language. */
  caveats: string[];
};

/** Model run first, legacy run second — and only evidence with comparable
 * metrics counts, so the card never renders an empty scorecard. */
function resolveEntryEvidence(entry: ScenarioComparisonBoardEntry): ResolvedEntryEvidence | null {
  const modelRun = entry.attached_model_run_id ? entry.attachedModelRun ?? null : null;
  if (modelRun) {
    const metrics = modelRunComparisonMetrics(modelRun.result_summary_json);
    if (metrics) {
      return {
        runId: modelRun.id,
        runTitle: modelRun.run_title,
        metrics,
        source: "model_run",
        modelRun: { engineKey: modelRun.engine_key, status: modelRun.status },
        caveats: [getManagedRunModeDefinition(modelRun.engine_key).caveatSummary],
      };
    }
  }

  if (entry.attached_run_id && entry.attachedRun?.metrics) {
    return {
      runId: entry.attached_run_id,
      runTitle: entry.attachedRun.title ?? "Attached run",
      metrics: entry.attachedRun.metrics,
      source: "analysis_run",
      modelRun: null,
      caveats: [],
    };
  }

  return null;
}

function toneForMetricDelta(metric: MetricDelta): "success" | "warning" | "neutral" {
  // An incomparable metric is neutral for the same reason a null one is: there
  // is no direction to report. It differs in that BOTH runs carry a number, so
  // the label below must say why nothing is shown rather than "N/A".
  if (metric.incomparable) return "neutral";
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
  const baselineEvidence = baselineEntry ? resolveEntryEvidence(baselineEntry) : null;
  if (!baselineEntry || !baselineEvidence) {
    return [];
  }

  const baselineRunId = baselineEvidence.runId;

  return alternativeEntries
    .map((entry) => ({ entry, evidence: resolveEntryEvidence(entry) }))
    .filter(
      (item): item is { entry: ScenarioComparisonBoardEntry; evidence: ResolvedEntryEvidence } =>
        Boolean(item.evidence && item.evidence.runId !== baselineRunId)
    )
    .map(({ entry, evidence }) => {
      const deltas = buildMetricDeltas(evidence.metrics, baselineEvidence.metrics);
      const changedMetricCount = deltas.filter((metric) => metric.delta !== null && metric.delta !== 0).length;
      const headlineMetrics = deltas.slice(0, 4).map((metric) => ({
        key: metric.key,
        label: metric.label,
        current: metric.current,
        baseline: metric.baseline,
        delta: metric.delta,
        deltaLabel: metric.incomparable ? "Not comparable" : formatDelta(metric.delta),
        tone: toneForMetricDelta(metric),
        incomparable: metric.incomparable,
        incomparableReason: metric.incomparableReason,
      }));

      return {
        entryId: entry.id,
        candidateLabel: entry.label,
        candidateRunId: evidence.runId,
        candidateRunTitle: evidence.runTitle,
        baselineLabel: baselineEntry.label,
        baselineRunId,
        baselineRunTitle: baselineEvidence.runTitle,
        evidenceSource: evidence.source,
        baselineEvidenceSource: baselineEvidence.source,
        candidateModelRun: evidence.modelRun,
        baselineModelRun: baselineEvidence.modelRun,
        changedMetricCount,
        // The Studio deep-link only understands Analysis Studio run ids; a
        // model-run-backed card links without run pinning rather than pointing
        // Studio at an id it cannot open.
        analysisHref: buildScenarioStudioHref({
          runId: evidence.source === "analysis_run" ? evidence.runId : entry.attached_run_id,
          baselineRunId:
            baselineEvidence.source === "analysis_run" ? baselineRunId : baselineEntry.attached_run_id,
          scenarioSetId,
          entryId: entry.id,
        }),
        headlineMetrics,
        sourceContext: buildScenarioComparisonSourceContext({
          baselineEntry: {
            id: baselineEntry.id,
            label: baselineEntry.label,
            assumptions_json: baselineEntry.assumptions_json,
            attached_run_id: baselineRunId,
            attachedRun: { title: baselineEvidence.runTitle },
          },
          candidateEntry: {
            id: entry.id,
            label: entry.label,
            assumptions_json: entry.assumptions_json,
            attached_run_id: evidence.runId,
            attachedRun: { title: evidence.runTitle },
          },
          changedMetricCount,
          evidenceLabels: headlineMetrics.map((metric) => metric.label),
          caveats: [...baselineEvidence.caveats, ...evidence.caveats],
        }),
      } satisfies ScenarioComparisonBoardCard;
    });
}
