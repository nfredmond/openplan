type StageGateDecision = "PASS" | "HOLD";

export type ReportArtifactGateResult = {
  decision: StageGateDecision;
  missingArtifacts: string[];
};

type RunRecord = {
  summary_text?: unknown;
  metrics?: unknown;
};

const REQUIRED_ARTIFACT_KEYS = [
  "summary_text",
  "metrics.overallScore",
  "metrics.confidence",
  "metrics.sourceSnapshots.census.fetchedAt",
  "metrics.sourceSnapshots.transit.fetchedAt",
  "metrics.sourceSnapshots.crashes.fetchedAt",
] as const;

function getByPath(value: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = value;

  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function hasArtifactValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return value !== null && value !== undefined;
}

export function evaluateReportArtifactGate(run: RunRecord): ReportArtifactGateResult {
  const missingArtifacts = REQUIRED_ARTIFACT_KEYS.filter((artifactKey) => {
    const value = getByPath(run, artifactKey);
    return !hasArtifactValue(value);
  });

  return {
    decision: missingArtifacts.length > 0 ? "HOLD" : "PASS",
    missingArtifacts,
  };
}
