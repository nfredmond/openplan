export const SCENARIO_SET_STATUSES = ["draft", "active", "archived"] as const;
export const SCENARIO_ENTRY_TYPES = ["baseline", "alternative"] as const;
export const SCENARIO_ENTRY_STATUSES = ["draft", "ready", "superseded"] as const;
export const SCENARIO_ASSUMPTION_SET_STATUSES = ["draft", "active", "archived"] as const;
export const SCENARIO_DATA_PACKAGE_TYPES = ["input", "reference", "model_output", "evidence"] as const;
export const SCENARIO_DATA_PACKAGE_STATUSES = ["draft", "ready", "archived"] as const;

export type ScenarioSetStatus = (typeof SCENARIO_SET_STATUSES)[number];
export type ScenarioEntryType = (typeof SCENARIO_ENTRY_TYPES)[number];
export type ScenarioEntryStatus = (typeof SCENARIO_ENTRY_STATUSES)[number];
export type ScenarioAssumptionSetStatus = (typeof SCENARIO_ASSUMPTION_SET_STATUSES)[number];
export type ScenarioDataPackageType = (typeof SCENARIO_DATA_PACKAGE_TYPES)[number];
export type ScenarioDataPackageStatus = (typeof SCENARIO_DATA_PACKAGE_STATUSES)[number];
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

export type ScenarioLinkedReportRecord = {
  id: string;
  title: string | null;
  status: string | null;
  report_type: string | null;
  generated_at: string | null;
  updated_at: string | null;
  latest_artifact_kind?: string | null;
};

export type ScenarioLinkedReportRun = {
  report_id: string;
  run_id: string;
};

export type ScenarioLinkedReport = ScenarioLinkedReportRecord & {
  matchedRunIds: string[];
  matchedEntryIds: string[];
  matchedEntryLabels: string[];
  matchedBaselineRun: boolean;
  matchedAlternativeEntryCount: number;
  comparisonReady: boolean;
  linkageKind: "comparison-ready" | "run-linked-only";
};

export type ScenarioEntryReportSummary = {
  totalLinkedReports: number;
  generatedLinkedReports: number;
  latestReportId: string | null;
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

export function buildScenarioStudioHref({
  runId,
  baselineRunId,
  scenarioSetId,
  entryId,
}: {
  runId: string | null | undefined;
  baselineRunId?: string | null | undefined;
  scenarioSetId?: string | null | undefined;
  entryId?: string | null | undefined;
}): string {
  const params = new URLSearchParams();

  if (runId) {
    params.set("runId", runId);
  }

  if (baselineRunId && baselineRunId !== runId) {
    params.set("baselineRunId", baselineRunId);
  }

  if (scenarioSetId) {
    params.set("scenarioSetId", scenarioSetId);
  }

  if (entryId) {
    params.set("entryId", entryId);
  }

  const query = params.toString();
  return query ? `/explore?${query}#analysis-run-history` : "/explore#analysis-run-history";
}

export function buildScenarioReportDraft({
  scenarioSetTitle,
  planningQuestion,
  baselineLabel,
  candidateLabel,
}: {
  scenarioSetTitle: string;
  planningQuestion?: string | null | undefined;
  baselineLabel: string;
  candidateLabel: string;
}) {
  const title = `${scenarioSetTitle}: ${candidateLabel} vs ${baselineLabel}`;
  const summary = [
    `Scenario evidence packet for ${candidateLabel} compared against ${baselineLabel}.`,
    planningQuestion ? `Planning question: ${planningQuestion}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return { title, summary };
}

export function buildScenarioLinkedReports({
  reports,
  reportRuns,
  entries,
  baselineEntryId,
}: {
  reports: ScenarioLinkedReportRecord[];
  reportRuns: ScenarioLinkedReportRun[];
  entries: Array<{ id: string; label: string; attached_run_id: string | null }>;
  baselineEntryId?: string | null | undefined;
}) {
  const entryIdsByRunId = new Map<string, string[]>();
  const entryLabelsById = new Map(entries.map((entry) => [entry.id, entry.label]));
  const baselineEntry = entries.find((entry) => entry.id === baselineEntryId) ?? null;
  const baselineRunId = baselineEntry?.attached_run_id ?? null;

  for (const entry of entries) {
    if (!entry.attached_run_id) continue;
    const current = entryIdsByRunId.get(entry.attached_run_id) ?? [];
    current.push(entry.id);
    entryIdsByRunId.set(entry.attached_run_id, current);
  }

  const runsByReportId = new Map<string, string[]>();
  for (const link of reportRuns) {
    if (!entryIdsByRunId.has(link.run_id)) continue;
    const current = runsByReportId.get(link.report_id) ?? [];
    current.push(link.run_id);
    runsByReportId.set(link.report_id, current);
  }

  const linkedReports: ScenarioLinkedReport[] = reports
    .map((report) => {
      const matchedRunIds = Array.from(new Set(runsByReportId.get(report.id) ?? []));
      const matchedEntryIds = Array.from(
        new Set(matchedRunIds.flatMap((runId) => entryIdsByRunId.get(runId) ?? []))
      );

      const matchedBaselineRun = Boolean(baselineRunId) && (baselineRunId ? matchedRunIds.includes(baselineRunId) : false);
      const matchedAlternativeEntryCount = matchedEntryIds.filter((entryId) => entryId !== baselineEntryId).length;
      const comparisonReady = Boolean(baselineRunId) && matchedBaselineRun && matchedAlternativeEntryCount > 0;

      return {
        ...report,
        matchedRunIds,
        matchedEntryIds,
        matchedEntryLabels: matchedEntryIds.map((entryId) => entryLabelsById.get(entryId) ?? entryId),
        matchedBaselineRun,
        matchedAlternativeEntryCount,
        comparisonReady,
        linkageKind: comparisonReady
          ? ("comparison-ready" as const)
          : ("run-linked-only" as const),
      };
    })
    .filter((report) => report.matchedRunIds.length > 0)
    .sort((left, right) => {
      const leftStamp = left.generated_at ?? left.updated_at ?? "";
      const rightStamp = right.generated_at ?? right.updated_at ?? "";
      return rightStamp.localeCompare(leftStamp);
    });

  const entryReportSummary = new Map<string, ScenarioEntryReportSummary>();

  for (const entry of entries) {
    const entryReports = linkedReports.filter((report) => report.matchedEntryIds.includes(entry.id));
    entryReportSummary.set(entry.id, {
      totalLinkedReports: entryReports.length,
      generatedLinkedReports: entryReports.filter((report) => report.status === "generated").length,
      latestReportId: entryReports[0]?.id ?? null,
    });
  }

  return {
    linkedReports,
    entryReportSummary,
  };
}
