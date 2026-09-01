export type GuidedComparisonLink = {
  comparison_snapshot_id: string;
  model_run_id: string;
  method: string;
  scenario_role: string;
};

export type GuidedComparisonKpi = {
  run_id: string;
  kpi_name: string;
  value: number | null;
  unit: string | null;
};

export type GuidedComparisonDecision = {
  model_run_id: string;
  track: string;
  claim_status: string;
  status_reason: string | null;
};

export type GuidedComparisonResult = {
  method: "aequilibrae" | "activitysim";
  methodLabel: string;
  baseline: GuidedComparisonRunResult;
  build: GuidedComparisonRunResult;
  metrics: GuidedComparisonMetric[];
};

export type GuidedComparisonRunResult = {
  runId: string;
  claimStatus: string | null;
  statusReason: string | null;
};

export type GuidedComparisonMetric = {
  key: "total_trips" | "daily_vmt";
  label: string;
  baseline: number;
  build: number;
  delta: number;
  percentDelta: number | null;
  unit: string;
};

const METHODS = [
  { key: "aequilibrae", label: "AequilibraE", track: "assignment" },
  { key: "activitysim", label: "ActivitySim", track: "behavioral_demand" },
] as const;

const METRICS = [
  { key: "total_trips", label: "Trips per day" },
  { key: "daily_vmt", label: "Vehicle miles traveled per day" },
] as const;

/**
 * Build two independent method results from the four runs already bound to a
 * guided comparison snapshot. Missing or mismatched rows stay absent; this
 * helper never substitutes another run, averages methods, or invents a zero.
 */
export function buildGuidedComparisonResults(params: {
  snapshotId: string;
  links: readonly GuidedComparisonLink[];
  kpis: readonly GuidedComparisonKpi[];
  decisions: readonly GuidedComparisonDecision[];
}): GuidedComparisonResult[] {
  const { snapshotId, links, kpis, decisions } = params;
  const snapshotLinks = links.filter((link) => link.comparison_snapshot_id === snapshotId);

  return METHODS.flatMap((method) => {
    const baselineLink = snapshotLinks.find(
      (link) => link.method === method.key && link.scenario_role === "baseline",
    );
    const buildLink = snapshotLinks.find(
      (link) => link.method === method.key && link.scenario_role === "build",
    );
    if (!baselineLink || !buildLink) return [];

    const runResult = (runId: string): GuidedComparisonRunResult => {
      const decision = decisions.find(
        (row) => row.model_run_id === runId && row.track === method.track,
      );
      return {
        runId,
        claimStatus: decision?.claim_status ?? null,
        statusReason: decision?.status_reason ?? null,
      };
    };

    const metrics = METRICS.flatMap((metric): GuidedComparisonMetric[] => {
      const baseline = kpis.find(
        (row) => row.run_id === baselineLink.model_run_id && row.kpi_name === metric.key,
      );
      const build = kpis.find(
        (row) => row.run_id === buildLink.model_run_id && row.kpi_name === metric.key,
      );
      if (
        typeof baseline?.value !== "number" ||
        !Number.isFinite(baseline.value) ||
        typeof build?.value !== "number" ||
        !Number.isFinite(build.value) ||
        !baseline.unit ||
        baseline.unit !== build.unit
      ) return [];
      const delta = build.value - baseline.value;
      return [{
        key: metric.key,
        label: metric.label,
        baseline: baseline.value,
        build: build.value,
        delta,
        percentDelta: baseline.value === 0 ? null : (delta / baseline.value) * 100,
        unit: baseline.unit,
      }];
    });

    return [{
      method: method.key,
      methodLabel: method.label,
      baseline: runResult(baselineLink.model_run_id),
      build: runResult(buildLink.model_run_id),
      metrics,
    }];
  });
}

export function formatGuidedComparisonValue(value: number, key: GuidedComparisonMetric["key"]): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: key === "daily_vmt" ? 1 : 0,
    maximumFractionDigits: key === "daily_vmt" ? 1 : 0,
  });
}

