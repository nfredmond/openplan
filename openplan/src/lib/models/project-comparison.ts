import type { AnalysisSequenceFacts, AnalysisStepId } from "@/components/models/analysis-sequence";

export const GUIDED_PROJECT_COMPARISON_VERSION = "openplan.project_comparison.v1";

export const GUIDED_AUTO_TRIP_CHANGE_KIND = "assigned_auto_trip_change_pct";

export type GuidedBuildAssumption = {
  kind: typeof GUIDED_AUTO_TRIP_CHANGE_KIND;
  autoTripChangePct: number;
  basis: string;
};

/**
 * The one build input the guided worker lane currently knows how to execute.
 * It is deliberately narrow: a planner supplies a percent change in assigned
 * daily auto trips and names its basis. OpenPlan neither derives the percent
 * from the project description nor treats it as a forecast.
 */
export function parseGuidedBuildAssumption(value: unknown): GuidedBuildAssumption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const candidate = root.guidedProjectChange;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (
    record.kind !== GUIDED_AUTO_TRIP_CHANGE_KIND ||
    typeof record.autoTripChangePct !== "number" ||
    !Number.isFinite(record.autoTripChangePct) ||
    record.autoTripChangePct < -90 ||
    record.autoTripChangePct > 200 ||
    typeof record.basis !== "string" ||
    record.basis.trim().length < 3
  ) {
    return null;
  }
  return {
    kind: GUIDED_AUTO_TRIP_CHANGE_KIND,
    autoTripChangePct: record.autoTripChangePct,
    basis: record.basis.trim(),
  };
}

export function guidedBuildAssumptions(assumption: GuidedBuildAssumption): Record<string, unknown> {
  return {
    guidedProjectChange: assumption,
  };
}

/**
 * The managed workers build the runnable road graph from OpenStreetMap at
 * launch, then bind both methods to the exact recorded network-state digest.
 * This registration is not evidence that a network has already been loaded;
 * the worker still has to succeed and return the digest.
 */
export const GUIDED_WORKER_NETWORK_BASIS = {
  kind: "worker_osm_snapshot",
  source: "OpenStreetMap",
  identity: "network_state_digest",
  comparisonRule: "exact_digest_match",
} as const;

export const GUIDED_PROJECT_COMPARISON_MODELS = [
  {
    method: "aequilibrae",
    modelFamily: "travel_demand",
    titleSuffix: "AequilibraE assignment",
  },
  {
    method: "activitysim",
    modelFamily: "activity_based_model",
    titleSuffix: "ActivitySim demand",
  },
] as const;

export type ProjectComparisonState = {
  state: "not_started" | "inputs_missing" | "runs_missing" | "validation_missing" | "packet_stale" | "packet_ready" | "unknown";
  label: string;
  firstMissingStep: AnalysisStepId | null;
  trafficAnswer: string;
  vmtAnswer: string;
  valueAnswer: string;
  uncertainties: string[];
};

/**
 * Turn the shared modeling facts into one manager-facing answer.
 *
 * Counts never become effect estimates. Until a saved comparison packet exists,
 * traffic and VMT stay explicitly unavailable; a completed current-conditions
 * corridor screen is not allowed to fill either blank.
 */
export function summarizeProjectComparison(facts: AnalysisSequenceFacts): ProjectComparisonState {
  if (facts.unreadable.length > 0) {
    return {
      state: "unknown",
      label: "Comparison state could not be determined",
      firstMissingStep: facts.unreadable[0] ?? null,
      trafficAnswer: "Unavailable because part of the project modeling record could not be read.",
      vmtAnswer: "Unavailable because part of the project modeling record could not be read.",
      valueAnswer: "Not supportable until the missing record can be read and the comparison is complete.",
      uncertainties: facts.unreadable.map((step) => `The ${step} record could not be read.`),
    };
  }

  const hasExplicitMethodCounts =
    typeof facts.aequilibraeModelCount === "number" && typeof facts.activitySimModelCount === "number";
  const hasBothMethodRecords = hasExplicitMethodCounts
    ? (facts.aequilibraeModelCount ?? 0) > 0 && (facts.activitySimModelCount ?? 0) > 0
    : facts.modelCount >= 2;
  const hasSharedNetworkBasis = facts.guidedProjectComparison
    ? (facts.managedNetworkBasisCount ?? 0) > 0
    : facts.networkCount > 0 || (facts.managedNetworkBasisCount ?? 0) > 0;

  const missing: Array<{ step: AnalysisStepId; message: string }> = [
    !hasSharedNetworkBasis
      ? { step: "network", message: "No shared road-network basis is registered." }
      : null,
    facts.scenarioSetCount < 1
      ? { step: "comparison", message: "No baseline-and-build scenario set is on file." }
      : null,
    !hasBothMethodRecords
      ? { step: "model", message: "Separate AequilibraE and ActivitySim method records are not both on file." }
      : null,
    (facts.aequilibraeRunCount ?? 0) < (facts.guidedProjectComparison ? 2 : 1)
      ? { step: "run", message: facts.guidedProjectComparison ? "Both AequilibraE baseline and build runs have not succeeded." : "No AequilibraE run is on file." }
      : null,
    (facts.activitySimRunCount ?? 0) < (facts.guidedProjectComparison ? 2 : 1)
      ? { step: "activitysim_run", message: facts.guidedProjectComparison ? "Both separate ActivitySim baseline and build jobs have not succeeded." : "No separate ActivitySim run is on file." }
      : null,
    (facts.guidedProjectComparison ? (facts.guidedComparisonCheckedCount ?? 0) < 1 : facts.checkedRunCount < 1)
      ? { step: "check", message: facts.guidedProjectComparison ? "All four exact outputs do not yet have track-matched validation decisions." : "No run has a recorded observed-count screening decision." }
      : null,
    (facts.comparisonPacketCount ?? 0) < 1
      ? { step: "packet", message: "No unaveraged baseline-versus-build comparison report is saved." }
      : null,
  ].filter((item): item is { step: AnalysisStepId; message: string } => item !== null);

  if (missing.length === 0) {
    return {
      state: "packet_ready",
      label: "Comparison report is on file",
      firstMissingStep: null,
      trafficAnswer: "Read the saved report; OpenPlan does not repeat its project-specific number from a count alone.",
      vmtAnswer: "Read the saved report; the two methods remain separate in that record.",
      valueAnswer: "Review the saved effects beside the project's documented cost and decision criteria.",
      uncertainties: ["The saved report's caveats and method disagreements still apply."],
    };
  }

  if ((facts.comparisonPacketCount ?? 0) < 1 && (facts.savedComparisonPacketCount ?? 0) > 0) {
    return {
      state: "packet_stale",
      label: "Saved comparison needs refresh",
      firstMissingStep: "packet",
      trafficAnswer: "A saved exact comparison is on file, but it does not match the latest four outputs. Open the saved record for its historical result, then refresh it before treating it as current.",
      vmtAnswer: "The saved record keeps both methods separate, but newer run evidence means its VMT result is not the current comparison.",
      valueAnswer: "Do not use the stale comparison for a current value judgment; preserve it and save a refreshed exact snapshot.",
      uncertainties: [
        "The saved comparison does not match the latest exact four outputs; preserve it and save a refreshed snapshot after review.",
        ...missing.filter((item) => item.step !== "packet").map((item) => item.message),
      ],
    };
  }

  const hasScaffold = facts.scenarioSetCount > 0 || facts.modelCount > 0;
  const state = !hasScaffold
    ? "not_started"
    : !hasSharedNetworkBasis || facts.scenarioSetCount < 1 || !hasBothMethodRecords
      ? "inputs_missing"
      : (facts.aequilibraeRunCount ?? 0) < (facts.guidedProjectComparison ? 2 : 1) ||
          (facts.activitySimRunCount ?? 0) < (facts.guidedProjectComparison ? 2 : 1)
        ? "runs_missing"
        : (facts.guidedProjectComparison ? (facts.guidedComparisonCheckedCount ?? 0) < 1 : facts.checkedRunCount < 1)
          ? "validation_missing"
          : "runs_missing";

  return {
    state,
    label: state === "not_started" ? "Baseline-versus-build comparison not started" : "Baseline-versus-build answer is not available yet",
    firstMissingStep: missing[0]?.step ?? null,
    trafficAnswer: "Unavailable. OpenPlan has no completed, checked baseline-versus-build traffic comparison for this project.",
    vmtAnswer: "Unavailable. OpenPlan has no completed, checked baseline-versus-build VMT comparison for this project.",
    valueAnswer: "Not supportable yet. Compare the documented project cost with the eventual effects; do not infer value from the current-conditions corridor score.",
    uncertainties: missing.map((item) => item.message),
  };
}

export function isGuidedProjectComparisonModel(config: unknown, method: "aequilibrae" | "activitysim"): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const record = config as Record<string, unknown>;
  return record.guidedProjectComparison === GUIDED_PROJECT_COMPARISON_VERSION && record.method === method;
}

/**
 * Detect a guided record even when a later edit damaged one part of its
 * contract. Once a record declares guided intent, readers must fail closed;
 * they may not silently reinterpret its generic run or snapshot rows as truth.
 */
export function hasGuidedProjectComparisonIntent(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const record = config as Record<string, unknown>;
  const basis = record.networkBasis;
  return record.guidedProjectComparison === GUIDED_PROJECT_COMPARISON_VERSION ||
    ((record.method === "aequilibrae" || record.method === "activitysim") &&
      Boolean(basis && typeof basis === "object" && !Array.isArray(basis) &&
        (basis as Record<string, unknown>).kind === GUIDED_WORKER_NETWORK_BASIS.kind));
}

export function usesGuidedWorkerNetwork(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const basis = (config as Record<string, unknown>).networkBasis;
  if (!basis || typeof basis !== "object" || Array.isArray(basis)) return false;
  const record = basis as Record<string, unknown>;
  return (
    record.kind === GUIDED_WORKER_NETWORK_BASIS.kind &&
    record.source === GUIDED_WORKER_NETWORK_BASIS.source &&
    record.identity === GUIDED_WORKER_NETWORK_BASIS.identity &&
    record.comparisonRule === GUIDED_WORKER_NETWORK_BASIS.comparisonRule
  );
}
