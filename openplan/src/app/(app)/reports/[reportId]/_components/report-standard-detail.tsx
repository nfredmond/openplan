import type { ComponentProps } from "react";
import { ScrollText } from "lucide-react";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { PilotWorkflowHandoff } from "@/components/operations/pilot-workflow-handoff";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { ReportDetailControls } from "@/components/reports/report-detail-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildGrantDecisionModelingSupport,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";
import type { ProjectFundingSnapshot } from "@/lib/projects/funding";
import {
  formatDateTime,
  formatReportStatusLabel,
  formatReportTypeLabel,
  reportStatusTone,
  type ReportComparisonSnapshotAggregate,
  type ReportComparisonSnapshotDigest,
  type ReportEvidenceChainDigest,
  type ReportFundingDigest,
} from "@/lib/reports/catalog";
import { formatCurrency } from "./_helpers";
import { ReportCompositionAudit } from "./report-composition-audit";
import { ReportNavigationPreview } from "./report-navigation-preview";
import { ReportPacketReview } from "./report-packet-review";
import { ReportProvenanceAudit } from "./report-provenance-audit";
import type {
  DriftItem,
  EngagementCampaignLinkRow,
  LinkedRunRow,
  ReportArtifact,
  ReportProjectRow,
  ReportRow,
} from "./_types";

type ReportPacketReviewProps = ComponentProps<typeof ReportPacketReview>;
type ReportCompositionAuditProps = ComponentProps<typeof ReportCompositionAudit>;
type ReportProvenanceAuditProps = ComponentProps<typeof ReportProvenanceAudit>;
type ReportNavigationPreviewProps = ComponentProps<typeof ReportNavigationPreview>;
type StandardReportProvenanceProps = Omit<
  ReportProvenanceAuditProps,
  "driftActionByKey"
>;

type ReportStandardDetailProps = {
  report: ReportRow;
  project: ReportProjectRow | null;
  workspace: { name: string | null } | null;
  runs: LinkedRunRow[];
  latestArtifact: ReportArtifact | null;
  fundingSnapshot: ProjectFundingSnapshot | null;
  operationsSummary: WorkspaceOperationsSummary;
  driftItems: DriftItem[];
  driftedItems: DriftItem[];
  evidenceSummaryDigest: ReportEvidenceChainDigest | null;
  fundingSummaryDigest: ReportFundingDigest | null;
  engagementCampaign: EngagementCampaignLinkRow | null;
  engagementPublicHref: string | null;
  currentReportPacketFreshness: ReportPacketReviewProps["packetFreshness"];
  currentReportComparisonAggregate: ReportComparisonSnapshotAggregate | null;
  currentReportComparisonDigest: ReportComparisonSnapshotDigest | null;
  compositionAuditProps: ReportCompositionAuditProps;
  provenanceAuditProps: StandardReportProvenanceProps;
  navigationPreviewProps: ReportNavigationPreviewProps;
};

export function ReportStandardDetail({
  report,
  project,
  workspace,
  runs,
  latestArtifact,
  fundingSnapshot,
  operationsSummary,
  driftItems,
  driftedItems,
  evidenceSummaryDigest,
  fundingSummaryDigest,
  engagementCampaign,
  engagementPublicHref,
  currentReportPacketFreshness,
  currentReportComparisonAggregate,
  currentReportComparisonDigest,
  compositionAuditProps,
  provenanceAuditProps,
  navigationPreviewProps,
}: ReportStandardDetailProps) {
  const currentReportGrantModelingEvidence =
    project && currentReportComparisonAggregate && currentReportComparisonDigest
      ? {
          projectId: project.id,
          comparisonBackedCount: 1,
          leadComparisonReport: {
            id: report.id,
            title: report.title,
            href: `/reports/${report.id}#packet-release-review`,
            packetFreshness: currentReportPacketFreshness,
            comparisonAggregate: currentReportComparisonAggregate,
            comparisonDigest: currentReportComparisonDigest,
          },
        }
      : null;
  const currentReportGrantModelingReadiness =
    describeProjectGrantModelingReadiness(currentReportGrantModelingEvidence);
  const currentReportGrantModelingSupport = buildGrantDecisionModelingSupport(
    currentReportGrantModelingEvidence,
    project?.name ?? null
  );
  const firstScenarioSetLink = provenanceAuditProps.scenarioSetLinks[0];
  const driftActionByKey: ReportProvenanceAuditProps["driftActionByKey"] = {
    engagement: engagementCampaign
      ? {
          href: `/engagement/${engagementCampaign.id}`,
          label: "Review engagement source",
        }
      : engagementPublicHref
        ? { href: engagementPublicHref, label: "Review public engagement" }
        : null,
    "scenario-basis": firstScenarioSetLink
      ? {
          href: `/scenarios/${firstScenarioSetLink.scenarioSetId}`,
          label: "Review scenario set",
        }
      : null,
    "project-records": project
      ? { href: `/projects/${project.id}`, label: "Review project records" }
      : null,
    "stage-gates": project
      ? {
          href: `/projects/${project.id}#project-governance`,
          label: "Review project settings",
        }
      : null,
  };

  return (
    <section className="module-page space-y-6">
      <CartographicSurfaceWide />
      <header className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <ScrollText className="h-3.5 w-3.5" />
            Report detail
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            {report.title}
          </h1>
          <p className="mt-3 max-w-3xl text-[0.9rem] leading-relaxed text-muted-foreground sm:text-base">
            {report.summary ||
              "No summary provided. Use the controls to describe this report\u2019s purpose and generate an HTML packet."}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <StatusBadge tone={reportStatusTone(report.status)}>
              {formatReportStatusLabel(report.status)}
            </StatusBadge>
            <span className="module-record-chip">
              <span>Type</span>
              <strong>{formatReportTypeLabel(report.report_type)}</strong>
            </span>
            {report.latest_artifact_kind ? (
              <span className="text-[0.73rem] text-muted-foreground">
                {report.latest_artifact_kind.toUpperCase()}
              </span>
            ) : null}
          </div>

          <div className="module-summary-grid cols-4 mt-6">
            <div className="module-summary-card">
              <p className="module-summary-label">Project</p>
              <p className="module-summary-value truncate text-xl">
                {project?.name ?? "Unknown"}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Workspace</p>
              <p className="module-summary-value truncate text-xl">
                {workspace?.name ?? "Unknown"}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked runs</p>
              <p className="module-summary-value text-xl tabular-nums">
                {runs.length}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Generated</p>
              <p className="module-summary-value text-base">
                {latestArtifact?.generated_at ?? report.generated_at
                  ? formatDateTime(
                      latestArtifact?.generated_at ?? report.generated_at
                    )
                  : "Not yet"}
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Funding posture</p>
              <p className="module-summary-value text-base">
                {fundingSnapshot?.label ?? "Not captured"}
              </p>
              <p className="module-summary-detail">
                {fundingSnapshot
                  ? fundingSnapshot.unfundedAfterLikelyAmount > 0
                    ? `${formatCurrency(fundingSnapshot.unfundedAfterLikelyAmount)} still uncovered after likely dollars.`
                    : fundingSnapshot.uninvoicedAwardAmount > 0
                      ? `${formatCurrency(fundingSnapshot.uninvoicedAwardAmount)} still uninvoiced.`
                      : fundingSnapshot.reimbursementLabel
                  : "Generate a packet to snapshot funding posture into report evidence."}
              </p>
            </div>
          </div>

          <div className="module-inline-list mt-4">
            <span className="module-inline-item">
              Created {formatDateTime(report.created_at)}
            </span>
            <span className="module-inline-item">
              Updated {formatDateTime(report.updated_at)}
            </span>
            {project?.updated_at ? (
              <span className="module-inline-item">
                Project snapshot {formatDateTime(project.updated_at)}
              </span>
            ) : null}
          </div>
        </article>

        <div id="report-controls">
          <ReportDetailControls
            report={{
              id: report.id,
              title: report.title,
              summary: report.summary,
              status: report.status,
              hasGeneratedArtifact: Boolean(report.latest_artifact_kind),
            }}
            driftSummary={{
              changedCount: driftedItems.length,
              totalCount: driftItems.length,
              labels: driftedItems.map((item) => item.label),
            }}
            evidenceSummary={evidenceSummaryDigest}
            fundingSummary={fundingSummaryDigest}
          />
        </div>
      </header>

      <WorkspaceCommandBoard
        summary={operationsSummary}
        label="Workspace command board"
        title="What should move around this report"
        description="Report detail now inherits the shared workspace runtime too, so broader packet pressure, funding timing, and setup gaps stay visible while you review drift, provenance, and governance posture on this record."
      />

      <PilotWorkflowHandoff
        currentStep="packet"
        projectId={project?.id ?? null}
        reportId={report.id}
        engagementCampaignId={engagementCampaign?.id ?? null}
        publicEngagementHref={engagementPublicHref}
        title="Carry this packet through readiness"
        description="This report is the packet-assembly step. Review the source context, refresh any drift, then move to readiness proof before using the packet externally."
      />

      <ReportPacketReview
        report={report}
        projectId={project?.id ?? null}
        packetFreshness={currentReportPacketFreshness}
        grantModelingReadiness={currentReportGrantModelingReadiness}
        grantModelingSupport={currentReportGrantModelingSupport}
        grantModelingEvidence={currentReportGrantModelingEvidence}
        comparisonDigest={currentReportComparisonDigest}
      />

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <ReportCompositionAudit {...compositionAuditProps} />

        <div className="space-y-6">
          <ReportProvenanceAudit
            {...provenanceAuditProps}
            driftActionByKey={driftActionByKey}
          />
          <ReportNavigationPreview {...navigationPreviewProps} />
        </div>
      </div>
    </section>
  );
}
