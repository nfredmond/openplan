export const SCENARIO_SET_STATUSES = ["draft", "active", "archived"] as const;
export const SCENARIO_ENTRY_TYPES = ["baseline", "alternative"] as const;
export const SCENARIO_ENTRY_STATUSES = ["draft", "ready", "superseded"] as const;

export type ScenarioSetStatus = (typeof SCENARIO_SET_STATUSES)[number];
export type ScenarioEntryType = (typeof SCENARIO_ENTRY_TYPES)[number];
export type ScenarioEntryStatus = (typeof SCENARIO_ENTRY_STATUSES)[number];
export type ScenarioComparisonStatus =
  | "ready"
  | "missing-baseline"
  | "missing-both-runs"
  | "missing-baseline-run"
  | "missing-candidate-run"
  | "same-run";

export type ScenarioComparisonReadiness = {
  status: ScenarioComparisonStatus;
  ready: boolean;
  tone: "success" | "warning" | "neutral";
  label: string;
  reason: string;
  evidenceReady: boolean;
  baselineEntryPresent: boolean;
  baselineRunPresent: boolean;
  candidateRunPresent: boolean;
  sameRunAttached: boolean;
};

export type ScenarioComparisonSummary = {
  totalAlternatives: number;
  readyAlternatives: number;
  blockedAlternatives: number;
  baselineEntryPresent: boolean;
  baselineRunPresent: boolean;
};

export function titleizeScenarioValue(value: string | null | undefined): string {
  if (!value) return "Unknown";

  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeScenarioSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return normalized || "scenario-entry";
}

export function makeScenarioEntrySlug(label: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${normalizeScenarioSlug(label)}-${suffix}`;
}

export function scenarioStatusTone(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active" || status === "ready") return "success";
  if (status === "archived" || status === "superseded") return "warning";
  if (status === "draft") return "neutral";
  return "neutral";
}

export function scenarioComparisonStatus(
  baselineRunId: string | null | undefined,
  candidateRunId: string | null | undefined,
  baselineEntryId?: string | null | undefined
): ScenarioComparisonStatus {
  return getScenarioComparisonReadiness({
    baselineEntryId,
    baselineRunId,
    candidateRunId,
  }).status;
}

export function getScenarioComparisonReadiness({
  baselineEntryId,
  baselineRunId,
  candidateRunId,
}: {
  baselineEntryId?: string | null | undefined;
  baselineRunId: string | null | undefined;
  candidateRunId: string | null | undefined;
}): ScenarioComparisonReadiness {
  const baselineEntryPresent = Boolean(baselineEntryId);
  const baselineRunPresent = Boolean(baselineRunId);
  const candidateRunPresent = Boolean(candidateRunId);
  const sameRunAttached = Boolean(baselineRunId && candidateRunId && baselineRunId === candidateRunId);

  if (!baselineEntryPresent) {
    return {
      status: "missing-baseline",
      ready: false,
      tone: "warning",
      label: "Missing baseline",
      reason: "Register a baseline entry before comparing alternatives.",
      evidenceReady: false,
      baselineEntryPresent,
      baselineRunPresent,
      candidateRunPresent,
      sameRunAttached,
    };
  }

  if (!baselineRunPresent && !candidateRunPresent) {
    return {
      status: "missing-both-runs",
      ready: false,
      tone: "warning",
      label: "Runs missing",
      reason: "Attach runs to both the baseline and alternative before comparison.",
      evidenceReady: false,
      baselineEntryPresent,
      baselineRunPresent,
      candidateRunPresent,
      sameRunAttached,
    };
  }

  if (!baselineRunPresent) {
    return {
      status: "missing-baseline-run",
      ready: false,
      tone: "warning",
      label: "Baseline run missing",
      reason: "Attach a run to the baseline entry before comparison.",
      evidenceReady: false,
      baselineEntryPresent,
      baselineRunPresent,
      candidateRunPresent,
      sameRunAttached,
    };
  }

  if (!candidateRunPresent) {
    return {
      status: "missing-candidate-run",
      ready: false,
      tone: "warning",
      label: "Alternative run missing",
      reason: "Attach a run to this alternative before comparison.",
      evidenceReady: false,
      baselineEntryPresent,
      baselineRunPresent,
      candidateRunPresent,
      sameRunAttached,
    };
  }

  if (sameRunAttached) {
    return {
      status: "same-run",
      ready: false,
      tone: "warning",
      label: "Same run attached",
      reason: "Use a distinct alternative run so the comparison is decision-useful.",
      evidenceReady: false,
      baselineEntryPresent,
      baselineRunPresent,
      candidateRunPresent,
      sameRunAttached,
    };
  }

  return {
    status: "ready",
    ready: true,
    tone: "success",
    label: "Ready to compare",
    reason: "Baseline and alternative both have attached runs.",
    evidenceReady: true,
    baselineEntryPresent,
    baselineRunPresent,
    candidateRunPresent,
    sameRunAttached,
  };
}

export function buildScenarioComparisonSummary({
  baselineEntryId,
  baselineRunId,
  candidateRunIds,
}: {
  baselineEntryId?: string | null | undefined;
  baselineRunId: string | null | undefined;
  candidateRunIds: Array<string | null | undefined>;
}): ScenarioComparisonSummary {
  const readyAlternatives = candidateRunIds.filter((candidateRunId) =>
    getScenarioComparisonReadiness({
      baselineEntryId,
      baselineRunId,
      candidateRunId,
    }).ready
  ).length;
  const totalAlternatives = candidateRunIds.length;

  return {
    totalAlternatives,
    readyAlternatives,
    blockedAlternatives: totalAlternatives - readyAlternatives,
    baselineEntryPresent: Boolean(baselineEntryId),
    baselineRunPresent: Boolean(baselineRunId),
  };
}
