import {
  describeComparisonSnapshotAggregate,
  getReportNavigationHref,
  getReportPacketFreshness,
  parseStoredComparisonSnapshotAggregate,
  type ReportComparisonSnapshotAggregate,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import type { FundingOpportunityDecision } from "@/lib/programs/catalog";

export type ProjectGrantModelingReportRow = {
  id: string;
  project_id: string;
  title: string;
  updated_at: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
};

export type ProjectGrantModelingArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

type ProjectGrantComparisonDigest = NonNullable<
  ReturnType<typeof describeComparisonSnapshotAggregate>
>;

export type ProjectGrantModelingReadinessPosture = {
  key: "decision-ready" | "stale" | "thin";
  label: string;
  tone: "success" | "warning" | "neutral";
  detail: string;
};

export type ProjectGrantModelingQueuePosture =
  | "decision-ready"
  | "refresh-recommended"
  | "thin"
  | "no-visible-support";

type ProjectGrantModelingLeadReport = {
  id: string;
  title: string;
  href: string;
  packetFreshness: ReturnType<typeof getReportPacketFreshness>;
  comparisonAggregate: ReportComparisonSnapshotAggregate;
  comparisonDigest: ProjectGrantComparisonDigest;
};

export type ProjectGrantModelingEvidence = {
  projectId: string;
  comparisonBackedCount: number;
  leadComparisonReport: ProjectGrantModelingLeadReport;
};

export const GRANT_MODELING_PLANNING_CAVEAT =
  "Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.";

export type GrantDecisionModelingSupport = {
  title: string;
  summary: string;
  readinessNoteSuggestion: string;
  decisionRationaleSuggestion: string;
  recommendedNextActionTitle: string;
  recommendedNextActionSummary: string;
  recommendedDecisionState: FundingOpportunityDecision;
};

function getGrantSupportFreshnessPriority(label: string) {
  switch (label) {
    case PACKET_FRESHNESS_LABELS.CURRENT:
      return 0;
    case PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED:
      return 1;
    case PACKET_FRESHNESS_LABELS.NO_PACKET:
      return 2;
    default:
      return 3;
  }
}

export function describeProjectGrantModelingReadiness(
  evidence: ProjectGrantModelingEvidence | null | undefined
): ProjectGrantModelingReadinessPosture | null {
  if (!evidence) {
    return null;
  }

  const leadReport = evidence.leadComparisonReport;
  if (leadReport.packetFreshness.label !== PACKET_FRESHNESS_LABELS.CURRENT) {
    return {
      key: "stale",
      label: PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED,
      tone: "warning",
      detail: `${leadReport.title} has comparison-backed planning support, but the packet should be refreshed before operators lean on it for grant readiness or prioritization. ${leadReport.packetFreshness.detail}`,
    };
  }

  if (
    leadReport.comparisonAggregate.readyComparisonSnapshotCount > 0 &&
    leadReport.comparisonAggregate.indicatorDeltaCount > 0
  ) {
    return {
      key: "decision-ready",
      label: "Appears decision-ready",
      tone: "success",
      detail: `${leadReport.title} carries current comparison-backed planning support with ready saved comparisons and visible indicator deltas. ${leadReport.comparisonDigest.detail}`,
    };
  }

  return {
    key: "thin",
    label: "Appears thin",
    tone: "neutral",
    detail: `${leadReport.title} has comparison-backed planning support, but the current packet still looks thin for grant triage. ${leadReport.comparisonDigest.detail}`,
  };
}

export function resolveProjectGrantModelingQueuePosture(
  evidence: ProjectGrantModelingEvidence | null | undefined
): ProjectGrantModelingQueuePosture {
  const readiness = describeProjectGrantModelingReadiness(evidence);

  if (!readiness) {
    return "no-visible-support";
  }

  if (readiness.key === "decision-ready") {
    return "decision-ready";
  }

  if (readiness.key === "stale") {
    return "refresh-recommended";
  }

  return "thin";
}

export function getProjectGrantModelingQueuePriority(
  evidence: ProjectGrantModelingEvidence | null | undefined
) {
  switch (resolveProjectGrantModelingQueuePosture(evidence)) {
    case "decision-ready":
      return 0;
    case "refresh-recommended":
      return 1;
    case "thin":
      return 2;
    case "no-visible-support":
      return 3;
    default:
      return 4;
  }
}

export function compareProjectGrantModelingEvidenceForQueue(
  left: ProjectGrantModelingEvidence | null | undefined,
  right: ProjectGrantModelingEvidence | null | undefined
) {
  const postureDifference =
    getProjectGrantModelingQueuePriority(left) - getProjectGrantModelingQueuePriority(right);
  if (postureDifference !== 0) {
    return postureDifference;
  }

  if (!left || !right) {
    return 0;
  }

  if (right.comparisonBackedCount !== left.comparisonBackedCount) {
    return right.comparisonBackedCount - left.comparisonBackedCount;
  }

  if (
    right.leadComparisonReport.comparisonAggregate.readyComparisonSnapshotCount !==
    left.leadComparisonReport.comparisonAggregate.readyComparisonSnapshotCount
  ) {
    return (
      right.leadComparisonReport.comparisonAggregate.readyComparisonSnapshotCount -
      left.leadComparisonReport.comparisonAggregate.readyComparisonSnapshotCount
    );
  }

  if (
    right.leadComparisonReport.comparisonAggregate.indicatorDeltaCount !==
    left.leadComparisonReport.comparisonAggregate.indicatorDeltaCount
  ) {
    return (
      right.leadComparisonReport.comparisonAggregate.indicatorDeltaCount -
      left.leadComparisonReport.comparisonAggregate.indicatorDeltaCount
    );
  }

  return 0;
}

export function buildProjectGrantModelingEvidenceByProjectId(
  reports: ProjectGrantModelingReportRow[] | null | undefined,
  artifacts: ProjectGrantModelingArtifactRow[] | null | undefined
) {
  const latestArtifactByReportId = new Map<string, ProjectGrantModelingArtifactRow>();
  for (const artifact of artifacts ?? []) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, artifact);
    }
  }

  const reportsByProjectId = new Map<
    string,
    Array<{
      id: string;
      title: string;
      updatedAt: string;
      packetFreshness: ReturnType<typeof getReportPacketFreshness>;
      comparisonAggregate: ReportComparisonSnapshotAggregate | null;
      comparisonDigest: ProjectGrantComparisonDigest | null;
    }>
  >();

  for (const report of reports ?? []) {
    const latestArtifact = latestArtifactByReportId.get(report.id) ?? null;
    const comparisonAggregate = parseStoredComparisonSnapshotAggregate(
      latestArtifact?.metadata_json ?? null
    );
    const projectReports = reportsByProjectId.get(report.project_id) ?? [];
    projectReports.push({
      id: report.id,
      title: report.title,
      updatedAt: report.updated_at,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: latestArtifact?.generated_at ?? report.generated_at,
        updatedAt: report.updated_at,
      }),
      comparisonAggregate,
      comparisonDigest: describeComparisonSnapshotAggregate(comparisonAggregate),
    });
    reportsByProjectId.set(report.project_id, projectReports);
  }

  const evidenceByProjectId = new Map<string, ProjectGrantModelingEvidence>();

  for (const [projectId, projectReports] of reportsByProjectId.entries()) {
    const sortedReports = [...projectReports].sort((left, right) => {
      const freshnessPriority =
        getGrantSupportFreshnessPriority(left.packetFreshness.label) -
        getGrantSupportFreshnessPriority(right.packetFreshness.label);
      if (freshnessPriority !== 0) {
        return freshnessPriority;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

    const comparisonBackedReports = sortedReports.filter(
      (report) => Boolean(report.comparisonDigest && report.comparisonAggregate)
    );
    const leadComparisonReport = comparisonBackedReports[0] ?? null;

    if (!leadComparisonReport?.comparisonDigest || !leadComparisonReport.comparisonAggregate) {
      continue;
    }

    evidenceByProjectId.set(projectId, {
      projectId,
      comparisonBackedCount: comparisonBackedReports.length,
      leadComparisonReport: {
        id: leadComparisonReport.id,
        title: leadComparisonReport.title,
        href: getReportNavigationHref(
          leadComparisonReport.id,
          leadComparisonReport.packetFreshness.label
        ),
        packetFreshness: leadComparisonReport.packetFreshness,
        comparisonAggregate: leadComparisonReport.comparisonAggregate,
        comparisonDigest: leadComparisonReport.comparisonDigest,
      },
    });
  }

  return evidenceByProjectId;
}

export function buildGrantDecisionModelingSupport(
  evidence: ProjectGrantModelingEvidence | null | undefined,
  projectName?: string | null
): GrantDecisionModelingSupport {
  if (!evidence) {
    const subject = projectName
      ? `${projectName} has no visible modeling-backed packet linked yet.`
      : "No visible modeling-backed packet is linked yet.";

    return {
      title: projectName ? `${projectName} modeling posture` : "Modeling posture",
      summary: `${subject} Keep monitoring or add support before relying on modeling language for this opportunity. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      readinessNoteSuggestion: `Recommended next action: keep this opportunity in monitor posture or add supporting packet evidence first because no visible modeling support is linked yet. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      decisionRationaleSuggestion: `Decision context should stay in monitor posture until operators add visible modeling support or confirm the funding source can proceed without it. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      recommendedNextActionTitle: "Keep monitoring or add support first",
      recommendedNextActionSummary: `No visible modeling-backed packet is linked yet, so keep this opportunity in monitor posture or add support before relying on modeling language. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      recommendedDecisionState: "monitor",
    };
  }

  const leadReport = evidence.leadComparisonReport;
  const readiness = describeProjectGrantModelingReadiness(evidence);

  if (readiness?.key === "decision-ready") {
    return {
      title: leadReport.title,
      summary: `${readiness.detail} ${GRANT_MODELING_PLANNING_CAVEAT}`,
      readinessNoteSuggestion: `Recommended next action: advance this opportunity to pursue now because modeling posture appears decision-ready in ${leadReport.title}. ${leadReport.comparisonDigest.headline}. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      decisionRationaleSuggestion: `Advance this opportunity to pursue now because ${leadReport.title} appears decision-ready as planning support for prioritization. ${leadReport.comparisonDigest.headline}. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      recommendedNextActionTitle: "Advance to pursue now",
      recommendedNextActionSummary: `${leadReport.title} appears decision-ready, so operators can advance this opportunity to pursue now while the packet is current. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      recommendedDecisionState: "pursue",
    };
  }

  if (readiness?.key === "stale") {
    return {
      title: leadReport.title,
      summary: `${readiness.detail} ${GRANT_MODELING_PLANNING_CAVEAT}`,
      readinessNoteSuggestion: `Recommended next action: keep this opportunity in monitor posture and refresh ${leadReport.title} before final pursue language. ${leadReport.packetFreshness.detail} ${GRANT_MODELING_PLANNING_CAVEAT}`,
      decisionRationaleSuggestion: `Keep this opportunity in monitor posture until ${leadReport.title} is refreshed; the current packet is useful for planning support but should not drive final pursue language yet. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      recommendedNextActionTitle: "Refresh supporting packet before final pursue language",
      recommendedNextActionSummary: `${leadReport.title} still helps with planning context, but operators should refresh the supporting packet before leaning on it for final pursue language. ${GRANT_MODELING_PLANNING_CAVEAT}`,
      recommendedDecisionState: "monitor",
    };
  }

  return {
    title: leadReport.title,
    summary: `${readiness?.detail ?? `Saved comparison context from ${leadReport.title} can support readiness and prioritization language for this opportunity. ${leadReport.comparisonDigest.detail}`} ${GRANT_MODELING_PLANNING_CAVEAT}`,
    readinessNoteSuggestion: `Recommended next action: keep this opportunity in monitor posture and strengthen evidence before relying on ${leadReport.title} for grant triage. ${leadReport.comparisonDigest.headline}. ${GRANT_MODELING_PLANNING_CAVEAT}`,
    decisionRationaleSuggestion: `Keep this opportunity in monitor posture until ${leadReport.title} carries stronger comparison-backed planning support for prioritization. ${leadReport.comparisonDigest.headline}. ${GRANT_MODELING_PLANNING_CAVEAT}`,
    recommendedNextActionTitle: "Strengthen evidence before relying on it",
    recommendedNextActionSummary: `${leadReport.title} is still thin as planning support, so operators should strengthen the evidence before relying on it for pursue language. ${GRANT_MODELING_PLANNING_CAVEAT}`,
    recommendedDecisionState: "monitor",
  };
}
