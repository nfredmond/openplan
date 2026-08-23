import type { ComponentProps } from "react";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { PilotWorkflowHandoff } from "@/components/operations/pilot-workflow-handoff";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { ReportDetailControls } from "@/components/reports/report-detail-controls";
import { ReportNarrativeDraftPanel } from "@/components/reports/report-narrative-draft-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildGrantDecisionModelingSupport,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";
import type { ProjectFundingSnapshot } from "@/lib/projects/funding";
import type { AgreementCorridorSelection, ReportAgreementEvidence } from "@/lib/reports/dual-demand-agreement";
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
import { PageTabNav } from "@/components/ui/page-tab-nav";
import { PageTabPanel } from "@/components/ui/page-tab-panel";
import { PAGE_TAB_QUERY_KEY, resolvePageTab, type PageTabDefinition } from "@/lib/ui/page-tabs";
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
  "driftActionByKey" | "comparisonDigest"
>;

/** The three tabs of a report record: the packet, what backs it, what it was. */
export type ReportDetailTabKey = "packet" | "evidence" | "history";

/**
 * Anchors on this page's header, which sits ABOVE the tab strip and is on
 * screen whichever tab is open.
 *
 * They belong to no tab, and saying so is load-bearing rather than tidy. The
 * Packet tab used to declare `report-controls` (and swept `detail-title`,
 * `detail-summary` and `detail-status` in with a `detail-` prefix), so
 * arriving at `?tab=history#report-controls` — a link this product mints in
 * `getReportNavigationHref` — did a `location.replace` onto the Packet tab and
 * threw away the tab the reader had asked for, to reach a control that was
 * already in front of them.
 */
const REPORT_HEADER_ANCHORS = [
  "report-controls",
  "detail-title",
  "detail-summary",
  "detail-status",
] as const;

type ReportStandardDetailProps = {
  /**
   * The page's query string. The active tab is read out of it here rather than
   * passed separately, so there is exactly one place that decides which tab a
   * URL means and the strip's links cannot disagree with the panels.
   */
  searchParams?: Record<string, string | string[] | undefined>;
  /**
   * Reads that failed, per tab, in the planner's words. Supplied by the page,
   * which is the only place that knows which lane fed which panel — a failure
   * behind a closed tab is named above the tab strip so it is not mistaken for
   * a tab nobody opened.
   */
  unreadableByTab?: Partial<Record<ReportDetailTabKey, readonly string[]>>;
  report: ReportRow;
  project: ReportProjectRow | null;
  workspace: { name: string | null } | null;
  runs: LinkedRunRow[];
  /** Succeeded worker model runs the attach control may cite (engine + status shown). */
  citeableModelRuns?: Array<{ id: string; title: string; engineKey: string; status: string }>;
  /** Model runs this report currently cites, in citation order. */
  citedModelRunIds?: string[];
  agreementEvidence?: ReportAgreementEvidence[];
  agreementCorridorSelections?: AgreementCorridorSelection[];
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
  generationReadiness: ReportPacketReviewProps["generationReadiness"];
  currentReportComparisonAggregate: ReportComparisonSnapshotAggregate | null;
  currentReportComparisonDigest: ReportComparisonSnapshotDigest | null;
  /** AI narrative assist for the whitelisted section(s); null hides the panel
   * (RTP/campaign targets, or no whitelisted section enabled). */
  narrativeDraftPanelProps?: ComponentProps<typeof ReportNarrativeDraftPanel> | null;
  compositionAuditProps: ReportCompositionAuditProps;
  provenanceAuditProps: StandardReportProvenanceProps;
  navigationPreviewProps: ReportNavigationPreviewProps;
};

export function ReportStandardDetail({
  searchParams,
  unreadableByTab,
  report,
  project,
  workspace,
  runs,
  citeableModelRuns = [],
  citedModelRunIds = [],
  agreementEvidence = [],
  agreementCorridorSelections = [],
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
  generationReadiness,
  currentReportComparisonAggregate,
  currentReportComparisonDigest,
  narrativeDraftPanelProps = null,
  compositionAuditProps,
  provenanceAuditProps,
  navigationPreviewProps,
}: ReportStandardDetailProps) {
  const isCampaignTarget = Boolean(report.engagement_campaign_id);
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

  const tabs: PageTabDefinition<ReportDetailTabKey>[] = [
    {
      key: "packet",
      label: "Packet",
      anchors: ["packet-release-review", "report-narrative-draft-panel"],
      // One grounding line per drafted section, so the id carries the section
      // key and the claim is a prefix.
      anchorPrefixes: ["narrative-grounding-line-"],
      unreadable: unreadableByTab?.packet ?? [],
    },
    {
      key: "evidence",
      label: "Evidence",
      anchorPrefixes: ["artifact-"],
      unreadable: unreadableByTab?.evidence ?? [],
    },
    {
      key: "history",
      label: "History",
      anchors: ["drift-since-generation", "evidence-chain-summary"],
      unreadable: unreadableByTab?.history ?? [],
    },
  ];
  const activeTab = resolvePageTab(tabs, searchParams?.[PAGE_TAB_QUERY_KEY], "packet");

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
          <p className="mt-4 max-w-[36rem] text-[1.0625rem] leading-[1.65] text-muted-foreground">
            {report.summary ||
              "No summary yet. Say what this report is for, and OpenPlan can generate it as a web page you can send."}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <StatusBadge tone={reportStatusTone(report.status)}>
              {formatReportStatusLabel(report.status)}
            </StatusBadge>
            <span className="module-record-chip">
              <span>Type</span>
              <strong>{formatReportTypeLabel(report.report_type)}</strong>
            </span>
            {isCampaignTarget && engagementCampaign ? (
              <Link
                href={`/engagement/${engagementCampaign.id}`}
                className="module-record-chip transition hover:text-primary"
              >
                <span>Campaign</span>
                <strong>{engagementCampaign.title}</strong>
              </Link>
            ) : null}
            {report.latest_artifact_kind ? (
              <span className="text-[0.73rem] text-muted-foreground">
                {report.latest_artifact_kind.toUpperCase()}
              </span>
            ) : null}
          </div>

          <div className="module-summary-grid cols-4 mt-6">
            <div className="module-summary-card">
              <p className="module-summary-label">
                {isCampaignTarget ? "Engagement campaign" : "Project"}
              </p>
              <p className="module-summary-value truncate text-xl">
                {isCampaignTarget
                  ? engagementCampaign?.title ?? "Unknown campaign"
                  : project?.name ?? "Unknown"}
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
              <p className="module-summary-label">Funding</p>
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
                  : "Generate a packet and the funding picture at that moment is saved with it."}
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
            modelRunOptions={citeableModelRuns}
            citedModelRunIds={citedModelRunIds}
            agreementEvidence={agreementEvidence}
            agreementCorridorSelections={agreementCorridorSelections}
          />
        </div>
      </header>

      <PageTabNav
        tabs={tabs}
        activeKey={activeTab}
        basePath={`/reports/${report.id}`}
        searchParams={searchParams}
        ariaLabel="Report sections"
        pageAnchors={REPORT_HEADER_ANCHORS}
      />

      <PageTabPanel tabKey="packet" active={activeTab === "packet"}>
      <WorkspaceCommandBoard
        summary={operationsSummary}
        label="Across your workspace"
        title="What needs attention next"
        description="The most pressing work anywhere in this workspace, kept in view so it does not get lost while you are in here."
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
        generationReadiness={generationReadiness}
        grantModelingReadiness={currentReportGrantModelingReadiness}
        grantModelingSupport={currentReportGrantModelingSupport}
        grantModelingEvidence={currentReportGrantModelingEvidence}
        comparisonDigest={currentReportComparisonDigest}
      />

      {narrativeDraftPanelProps ? <ReportNarrativeDraftPanel {...narrativeDraftPanelProps} /> : null}

      <ReportNavigationPreview {...navigationPreviewProps} />
      </PageTabPanel>

      <PageTabPanel tabKey="evidence" active={activeTab === "evidence"}>
      <ReportCompositionAudit {...compositionAuditProps} />
      </PageTabPanel>

      <PageTabPanel tabKey="history" active={activeTab === "history"}>
      <ReportProvenanceAudit
        {...provenanceAuditProps}
        driftActionByKey={driftActionByKey}
        comparisonDigest={currentReportComparisonDigest}
      />
      </PageTabPanel>
    </section>
  );
}
