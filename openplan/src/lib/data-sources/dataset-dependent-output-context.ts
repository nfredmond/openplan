import type { DatasetLineageReadinessLevel } from "./dataset-lineage-readiness";

export type DatasetDependentOutputLevel = "output_ready" | "review_ready" | "blocked" | "registry_only";

export type DatasetDependentOutputSurface = "project_link" | "analysis_overlay" | "thematic_map" | "report_appendix";

export type DatasetDependentOutputHint = {
  key: DatasetDependentOutputSurface;
  label: string;
  ready: boolean;
  detail: string;
};

export type DatasetDependentOutputContextInput = {
  status?: string | null;
  linkedProjectCount?: number | null;
  lineageLevel: DatasetLineageReadinessLevel;
  overlayReady: boolean;
  thematicReady: boolean;
  latestRefreshStatus?: string | null;
  latestRefreshAt?: string | null;
};

export type DatasetDependentOutputContext = {
  level: DatasetDependentOutputLevel;
  label: string;
  detail: string;
  dependentOutputCount: number;
  needs: string[];
  hints: DatasetDependentOutputHint[];
};

function normalized(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isLineageReportReady(level: DatasetLineageReadinessLevel): boolean {
  return level === "complete" || level === "usable";
}

function makeHint(
  key: DatasetDependentOutputSurface,
  label: string,
  ready: boolean,
  readyDetail: string,
  missingDetail: string
): DatasetDependentOutputHint {
  return {
    key,
    label,
    ready,
    detail: ready ? readyDetail : missingDetail,
  };
}

export function resolveDatasetDependentOutputContext(
  input: DatasetDependentOutputContextInput
): DatasetDependentOutputContext {
  const status = normalized(input.status || "draft");
  const refreshStatus = normalized(input.latestRefreshStatus);
  const linkedProjectCount = Math.max(0, input.linkedProjectCount ?? 0);
  const hasProjectLink = linkedProjectCount > 0;
  const statusReady = status === "ready";
  const refreshBlocked = refreshStatus === "failed" || refreshStatus === "cancelled";
  const statusBlocked = status === "error";
  const statusNeedsReview = status === "stale" || status === "refreshing" || refreshStatus === "running" || refreshStatus === "queued";
  const lineageReportReady = isLineageReportReady(input.lineageLevel);
  const reportAppendixReady = hasProjectLink && statusReady && lineageReportReady && !refreshBlocked;

  const hints: DatasetDependentOutputHint[] = [
    makeHint(
      "project_link",
      "Project linkage",
      hasProjectLink,
      `${pluralize(linkedProjectCount, "project")} can see this dataset from the shared spine.`,
      "Link at least one project before treating this as dependent planning evidence."
    ),
    makeHint(
      "analysis_overlay",
      "Analysis overlay",
      input.overlayReady,
      "Analysis Studio can draw this dataset as a coverage or geography layer.",
      "Attach supported geography before presenting this as a map-ready source."
    ),
    makeHint(
      "thematic_map",
      "Thematic map",
      input.thematicReady,
      "A metric and supported analysis geometry are present for thematic mapping.",
      "Add a supported metric plus analysis geometry before using this for thematic claims."
    ),
    makeHint(
      "report_appendix",
      "Report appendix",
      reportAppendixReady,
      "Lineage and project linkage are strong enough for a supervised report appendix handoff.",
      "Needs ready status, usable lineage, and at least one linked project before report appendix handoff."
    ),
  ];

  const needs = hints.filter((hint) => !hint.ready).map((hint) => hint.label);
  const dependentOutputCount = hints.filter((hint) => hint.ready).length;

  if (statusBlocked || refreshBlocked) {
    return {
      level: "blocked",
      label: "Output blocked",
      detail: refreshBlocked
        ? "Latest refresh did not complete cleanly; dependent reports and maps need operator review before reuse."
        : "Dataset is in an error state; do not use it for dependent planning outputs until repaired.",
      dependentOutputCount,
      needs,
      hints,
    };
  }

  if (!hasProjectLink) {
    return {
      level: "registry_only",
      label: "Registry only",
      detail: "Dataset is documented, but no project currently depends on it in the shared planning spine.",
      dependentOutputCount,
      needs,
      hints,
    };
  }

  if (reportAppendixReady && (input.thematicReady || input.overlayReady) && !statusNeedsReview) {
    return {
      level: "output_ready",
      label: "Output-ready",
      detail: "Project linkage, lineage, and map posture are strong enough for supervised reports or analysis handoff.",
      dependentOutputCount,
      needs,
      hints,
    };
  }

  return {
    level: "review_ready",
    label: statusNeedsReview ? "Refresh review" : "Handoff review",
    detail: statusNeedsReview
      ? "A dependent project exists, but refresh posture needs review before maps or report appendices rely on it."
      : "A dependent project exists; close the missing output context before treating this as appendix-ready evidence.",
    dependentOutputCount,
    needs,
    hints,
  };
}

export function toneForDatasetDependentOutputLevel(
  level: DatasetDependentOutputLevel
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (level === "output_ready") return "success";
  if (level === "review_ready") return "warning";
  if (level === "blocked") return "danger";
  return "neutral";
}
