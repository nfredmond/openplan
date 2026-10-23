import type { ReportDriftSummary } from "./source-review-posture";
import { formatDriftLabelList } from "./source-review-posture";
import type { DatasetDependentOutputContext } from "@/lib/data-sources/dataset-dependent-output-context";
import {
  buildProjectFundingProfileScan,
  type ProjectFundingProfileScan,
} from "@/lib/projects/funding";
import {
  isCompleteFundingSnapshot,
  type ReportComparisonSnapshotAggregate,
  type ReportFundingSnapshot,
} from "@/lib/reports/catalog";

export type ReportGenerationReadinessStatus =
  | "ready"
  | "attention"
  | "blocked"
  | "not_started"
  | "unknown";

export type ReportGenerationReadinessCheck = {
  id: "source_context" | "comparison_context" | "funding_profile" | "data_lineage";
  label: string;
  status: ReportGenerationReadinessStatus;
  statusLabel: string;
  detail: string;
  nextAction: string;
};

export type ReportDataLineageReadinessSummary = {
  datasetCount: number;
  outputReadyCount: number;
  reviewReadyCount: number;
  blockedCount: number;
  registryOnlyCount: number;
  dependentOutputCount: number;
  firstNeed: string | null;
};

export type ReportGenerationReadiness = {
  status: ReportGenerationReadinessStatus;
  label: string;
  detail: string;
  nextAction: string;
  checks: ReportGenerationReadinessCheck[];
  dataLineageSummary: ReportDataLineageReadinessSummary;
  fundingProfileScan: ProjectFundingProfileScan | null;
};

function priority(status: ReportGenerationReadinessStatus): number {
  if (status === "blocked") return 0;
  if (status === "attention") return 1;
  if (status === "not_started") return 2;
  if (status === "unknown") return 3;
  return 4;
}

function hasSourceContext(sourceContext: Record<string, unknown> | null | undefined): boolean {
  return Boolean(sourceContext && Object.keys(sourceContext).length > 0);
}

function summarizeDataLineage(
  contexts: DatasetDependentOutputContext[]
): ReportDataLineageReadinessSummary {
  return {
    datasetCount: contexts.length,
    outputReadyCount: contexts.filter((context) => context.level === "output_ready").length,
    reviewReadyCount: contexts.filter((context) => context.level === "review_ready").length,
    blockedCount: contexts.filter((context) => context.level === "blocked").length,
    registryOnlyCount: contexts.filter((context) => context.level === "registry_only").length,
    dependentOutputCount: contexts.reduce(
      (sum, context) => sum + context.dependentOutputCount,
      0
    ),
    firstNeed:
      contexts
        .flatMap((context) => context.needs)
        .find((need) => need.trim().length > 0) ?? null,
  };
}

function fundingCheck(
  fundingProfileScan: ProjectFundingProfileScan | null,
  fundingSnapshotIncomplete = false
): ReportGenerationReadinessCheck {
  if (fundingSnapshotIncomplete) {
    return {
      id: "funding_profile",
      label: "Funding profile scan",
      status: "unknown",
      statusLabel: "Funding figures not recorded",
      detail:
        "The saved funding snapshot is missing some dollar figures, so funding readiness is not assessed.",
      nextAction: "Regenerate the packet to save the current funding figures.",
    };
  }

  if (!fundingProfileScan) {
    return {
      id: "funding_profile",
      label: "Funding profile scan",
      status: "not_started",
      statusLabel: "No funding profile",
      detail:
        "No project funding posture is visible yet, so packet language cannot cite funding need, match, award, or reimbursement readiness.",
      nextAction:
        "Record the project funding need or confirm that this packet does not need funding-backed language before generation.",
    };
  }

  return {
    id: "funding_profile",
    label: "Funding profile scan",
    status: fundingProfileScan.status,
    statusLabel: fundingProfileScan.label,
    detail: fundingProfileScan.lanes
      .slice(0, 2)
      .map((lane) => `${lane.label}: ${lane.statusLabel}.`)
      .join(" "),
    nextAction: fundingProfileScan.nextAction,
  };
}

function withRefreshLogNote(
  check: ReportGenerationReadinessCheck,
  refreshLogNote: string | null | undefined
): ReportGenerationReadinessCheck {
  if (!refreshLogNote) {
    return check;
  }

  return { ...check, detail: `${check.detail} ${refreshLogNote}` };
}

function dataLineageCheck(
  summary: ReportDataLineageReadinessSummary,
  refreshLogNote?: string | null
): ReportGenerationReadinessCheck {
  if (summary.datasetCount === 0) {
    return {
      id: "data_lineage",
      label: "Data lineage",
      status: "unknown",
      statusLabel: "No project-linked datasets",
      detail:
        "No Data Hub datasets are linked to this project yet; packet generation can continue, but dataset-backed claims need a separate source note.",
      nextAction:
        "Link Data Hub sources when the packet relies on census, safety, GTFS, funding, or other reusable datasets.",
    };
  }

  if (summary.blockedCount > 0) {
    return withRefreshLogNote(
      {
        id: "data_lineage",
        label: "Data lineage",
        status: "blocked",
        statusLabel: `${summary.blockedCount} dataset${summary.blockedCount === 1 ? "" : "s"} blocked`,
        detail: `${summary.outputReadyCount}/${summary.datasetCount} project-linked dataset${summary.datasetCount === 1 ? " is" : "s are"} output-ready; blocked refresh or dataset error posture needs review before report reuse.`,
        nextAction:
          summary.firstNeed ??
          "Repair blocked dataset refresh, lineage, or project linkage before relying on dataset-backed packet claims.",
      },
      refreshLogNote
    );
  }

  if (summary.outputReadyCount > 0 && summary.reviewReadyCount === 0) {
    return withRefreshLogNote(
      {
        id: "data_lineage",
        label: "Data lineage",
        status: "ready",
        statusLabel: `${summary.outputReadyCount} output-ready`,
        detail: `${summary.outputReadyCount}/${summary.datasetCount} project-linked dataset${summary.datasetCount === 1 ? " is" : "s are"} ready for supervised maps, overlays, or report appendices.`,
        nextAction:
          "Carry the linked dataset names and caveats into report review before external use.",
      },
      refreshLogNote
    );
  }

  return withRefreshLogNote(
    {
      id: "data_lineage",
      label: "Data lineage",
      status: "attention",
      statusLabel: `${summary.outputReadyCount}/${summary.datasetCount} output-ready`,
      detail: `${summary.reviewReadyCount} review-ready and ${summary.registryOnlyCount} registry-only dataset${summary.datasetCount === 1 ? "" : "s"} are visible in the project lineage check.`,
      nextAction:
        summary.firstNeed ??
        "Close lineage, refresh, or project-linkage gaps before treating dataset-backed claims as appendix-ready.",
    },
    refreshLogNote
  );
}

function comparisonContextCheck(
  comparisonAggregate: ReportComparisonSnapshotAggregate | null | undefined
): ReportGenerationReadinessCheck {
  if (!comparisonAggregate || comparisonAggregate.comparisonSnapshotCount <= 0) {
    return {
      id: "comparison_context",
      label: "Comparison source context",
      status: "unknown",
      statusLabel: "No saved comparisons",
      detail:
        "No comparison snapshot source context is attached to this report yet. This is acceptable for non-modeling packets, but grant pursue language needs a separate evidence source.",
      nextAction:
        "Attach a current comparison snapshot before using this report as modeling-backed grant evidence.",
    };
  }

  if ((comparisonAggregate.sourceContextSnapshotCount ?? 0) <= 0) {
    return {
      id: "comparison_context",
      label: "Comparison source context",
      status: "attention",
      statusLabel: "Source context missing",
      detail: `${comparisonAggregate.comparisonSnapshotCount} saved comparison${comparisonAggregate.comparisonSnapshotCount === 1 ? "" : "s"} are attached, but structured source-context summaries were not captured.`,
      nextAction:
        "Regenerate or re-save comparison evidence with source context before using it in packet narrative.",
    };
  }

  return {
    id: "comparison_context",
    label: "Comparison source context",
    status:
      (comparisonAggregate.exportReadySnapshotCount ?? 0) > 0
        ? "ready"
        : "attention",
    statusLabel: `${comparisonAggregate.sourceContextSnapshotCount ?? 0} source-context ${
      (comparisonAggregate.sourceContextSnapshotCount ?? 0) === 1 ? "summary" : "summaries"
    }`,
    detail: `${comparisonAggregate.readyComparisonSnapshotCount} ready comparison${comparisonAggregate.readyComparisonSnapshotCount === 1 ? "" : "s"}, ${comparisonAggregate.indicatorDeltaCount} indicator delta${comparisonAggregate.indicatorDeltaCount === 1 ? "" : "s"}, and ${comparisonAggregate.caveatSnapshotCount ?? 0} caveat-backed snapshot${(comparisonAggregate.caveatSnapshotCount ?? 0) === 1 ? "" : "s"} are attached.`,
    nextAction:
      "Review comparison caveats and pairing labels before reusing this evidence in grant or public packet language.",
  };
}

export function buildReportGenerationReadiness(input: {
  hasGeneratedArtifact: boolean;
  sourceContext: Record<string, unknown> | null;
  driftedSourceCount: number;
  unassessedSourceCount?: number;
  sourceReviewSummary?: ReportDriftSummary;
  comparisonAggregate?: ReportComparisonSnapshotAggregate | null;
  guidedComparison?: { selected: boolean; problem: string | null };
  fundingSnapshot?: ReportFundingSnapshot | null;
  datasetOutputContexts?: DatasetDependentOutputContext[];
  /**
   * Honest framing when the latest refresh-log entry for a linked dataset is
   * recorded-but-unexecuted ("queued"/"running"): nothing in OpenPlan runs
   * refresh jobs, so the lineage check must not imply an orchestrated refresh.
   * Built by `buildReportRefreshLogNote` in data-lineage-output-contexts.
   */
  refreshLogNote?: string | null;
  now?: Date | string;
}): ReportGenerationReadiness {
  const fundingSnapshot = input.fundingSnapshot ?? null;
  // A saved snapshot missing a dollar figure is not scanned: the scan would
  // treat the missing figure as $0 and could report a gap as covered.
  const fundingSnapshotIncomplete =
    fundingSnapshot !== null && !isCompleteFundingSnapshot(fundingSnapshot);
  const fundingProfileScan =
    fundingSnapshot !== null && isCompleteFundingSnapshot(fundingSnapshot)
      ? buildProjectFundingProfileScan({
          summary: fundingSnapshot,
          hasComparisonEvidence: Boolean(
            input.comparisonAggregate && input.comparisonAggregate.comparisonSnapshotCount > 0
          ),
          now: input.now,
        })
      : null;
  const dataLineageSummary = summarizeDataLineage(input.datasetOutputContexts ?? []);
  const driftedSourceCount = input.sourceReviewSummary?.changedCount ?? input.driftedSourceCount;
  const unassessedSourceCount = input.sourceReviewSummary?.unassessedLabels?.length ?? input.unassessedSourceCount;
  const reviewLabels = input.sourceReviewSummary?.reviewLabels ?? [];
  const sourceContextCheck: ReportGenerationReadinessCheck = input.hasGeneratedArtifact && unassessedSourceCount && !hasSourceContext(input.sourceContext)
    ? { id: "source_context", label: "Packet source context", status: "unknown",
        statusLabel: "Source evidence unassessed", detail: "Retained source context is unavailable or historically untracked. Missing evidence does not establish zero, a source change or unchanged inputs.",
        nextAction: "Review the unavailable inputs and retained evidence before release use." }
    : !hasSourceContext(input.sourceContext)
    ? {
        id: "source_context",
        label: "Packet source context",
        status: input.hasGeneratedArtifact ? "attention" : "not_started",
        statusLabel: input.hasGeneratedArtifact
          ? "Legacy packet context"
          : "First packet needed",
        detail: input.hasGeneratedArtifact
          ? "The latest artifact exists, but no compact source context was captured with it. Treat this as legacy evidence until regenerated."
          : "No generated artifact exists yet, so the packet has not captured report origin, linked evidence, funding, or lineage snapshots.",
        nextAction: "Generate a packet after reviewing funding, comparison, and dataset lineage posture.",
      }
    : driftedSourceCount > 0
      ? {
          id: "source_context",
          label: "Packet source context",
          status: "attention",
          statusLabel: `${driftedSourceCount} source change${driftedSourceCount === 1 ? "" : "s"}`,
          detail:
            "The latest artifact has compact source context, but live source state has changed since generation.",
          nextAction:
            "Review changed source areas and regenerate before using the packet outside supervised draft review.",
        }
      : reviewLabels.length ? {
          id: "source_context", label: "Packet source context", status: "attention",
          statusLabel: "Generation writeback needs review",
          detail: `${formatDriftLabelList(reviewLabels)}. This does not establish that a source changed.`,
          nextAction: "Review the report revision and generation completion before using the retained packet.",
        } : unassessedSourceCount ? {
          id: "source_context", label: "Packet source context", status: "unknown",
          statusLabel: input.sourceReviewSummary ? "Source evidence unassessed" : "Historical source baseline unassessed",
          detail: input.sourceReviewSummary?.unassessedLabels?.length
            ? `${formatDriftLabelList(input.sourceReviewSummary.unassessedLabels)}. Missing evidence does not establish a source change or unchanged evidence.`
            : "Some historical source totals were not recorded. Missing fields do not establish a source change or unchanged evidence.",
          nextAction: "Review the retained source records and the unassessed baseline before release use.",
        } : {
          id: "source_context",
          label: "Packet source context",
          status: "ready",
          statusLabel: "Context captured",
          detail:
            "The latest packet carries compact source context and no live source drift is visible right now.",
          nextAction:
            "Keep this source-context check in the release review before external reuse.",
        };

  const checks = [
    sourceContextCheck,
    input.guidedComparison?.problem ? {
      id: "comparison_context" as const, label: "Selected guided comparison", status: "blocked" as const,
      statusLabel: "Saved comparison binding is invalid", detail: input.guidedComparison.problem,
      nextAction: "Review and save the exact comparison again, or clear the selection. Historical artifacts remain available.",
    } : input.guidedComparison?.selected ? {
      id: "comparison_context" as const, label: "Selected guided comparison", status: "unknown" as const,
      statusLabel: "Saved binding checked; live evidence unassessed",
      detail: "The saved snapshot binds four separate worker outputs. This page does not recheck live artifact bytes or custody. Analysis Studio attachments are not required.",
      nextAction: "Review the retained assumptions and scientific caveats. Save and generation verify the exact files and custody before accepting the comparison.",
    } : comparisonContextCheck(input.comparisonAggregate),
    fundingCheck(fundingProfileScan, fundingSnapshotIncomplete),
    dataLineageCheck(dataLineageSummary, input.refreshLogNote ?? null),
  ];
  const firstAction = [...checks].sort(
    (left, right) => priority(left.status) - priority(right.status)
  )[0];
  const hasBlocked = checks.some((check) => check.status === "blocked");
  const hasAttention = checks.some((check) => check.status === "attention");
  const hasNotStarted = checks.some((check) => check.status === "not_started");
  // Optional unknown checks keep their existing behavior on unselected reports.
  const hasUnassessedGuidedComparison = Boolean(input.guidedComparison?.selected && !input.guidedComparison.problem);
  const hasUnassessedSources = Boolean(unassessedSourceCount);
  const allReadyOrUnknown = checks.every(
    (check) => check.status === "ready" || check.status === "unknown"
  );
  const status: ReportGenerationReadinessStatus = hasBlocked
    ? "blocked"
    : hasAttention
      ? "attention"
      : hasNotStarted
        ? "not_started"
        : hasUnassessedGuidedComparison || hasUnassessedSources
          ? "unknown"
          : allReadyOrUnknown
            ? "ready"
            : "unknown";

  const attentionCount = checks.filter((check) => check.status === "attention" || check.status === "blocked" ||
    ((hasUnassessedGuidedComparison && check.id === "comparison_context" || hasUnassessedSources && check.id === "source_context") && check.status === "unknown")).length;

  return {
    status,
    label: hasBlocked
      ? "Generation readiness blocked"
      : hasAttention
        ? "Generation readiness needs review"
        : hasNotStarted
          ? "Generation readiness needs first packet"
          : hasUnassessedGuidedComparison || hasUnassessedSources
            ? "Generation readiness unassessed"
            : "Generation readiness reviewed",
    detail: `${checks.filter((check) => check.status === "ready").length}/${checks.length} checks ready; ${attentionCount} need operator attention before release use.${hasUnassessedGuidedComparison ? " Selected comparison live artifact bytes and custody remain unassessed." : ""}`,
    nextAction:
      firstAction?.nextAction ??
      "Review source context, funding, and dataset lineage before generating or releasing this packet.",
    checks,
    dataLineageSummary,
    fundingProfileScan,
  };
}

export function reportGenerationReadinessTone(
  status: ReportGenerationReadinessStatus
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "ready") return "success";
  if (status === "attention") return "warning";
  if (status === "blocked") return "danger";
  if (status === "not_started") return "neutral";
  return "neutral";
}
