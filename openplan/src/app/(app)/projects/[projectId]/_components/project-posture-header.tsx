import Link from "next/link";
import { ArrowRight, FileStack, FolderKanban, Target } from "lucide-react";
import { ProjectRtpLinker } from "@/components/projects/project-rtp-linker";
import {
  ReportPacketCommandQueue,
  type ReportPacketCommandQueueItem,
} from "@/components/reports/report-packet-command-queue";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildGrantDecisionModelingSupport,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import type { ProjectControlsSummary } from "@/lib/projects/controls";
import {
  describeComparisonSnapshotAggregate,
  describeEvidenceChainSummary,
  formatReportStatusLabel,
  formatReportTypeLabel,
  getReportNavigationHref,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  parseStoredComparisonSnapshotAggregate,
  reportStatusTone,
} from "@/lib/reports/catalog";
import { fmtDateTime, titleize, toneForStatus } from "./_helpers";
import type {
  ExistingRtpLink,
  ProjectReportRow,
  ProjectRow,
  RtpCycleRow,
  WorkspaceRow,
} from "./_types";

type ProjectReportEnriched = ProjectReportRow & {
  packetFreshness: ReturnType<typeof getReportPacketFreshness>;
  comparisonAggregate: ReturnType<typeof parseStoredComparisonSnapshotAggregate>;
  comparisonDigest: ReturnType<typeof describeComparisonSnapshotAggregate>;
  evidenceChainDigest: ReturnType<typeof describeEvidenceChainSummary>;
};

type ProjectGrantModelingEvidence = {
  projectId: string;
  comparisonBackedCount: number;
  leadComparisonReport: {
    id: string;
    title: string;
    href: string;
    packetFreshness: ReturnType<typeof getReportPacketFreshness>;
    comparisonAggregate: NonNullable<ReturnType<typeof parseStoredComparisonSnapshotAggregate>>;
    comparisonDigest: NonNullable<ReturnType<typeof describeComparisonSnapshotAggregate>>;
  };
};

type ProjectPostureHeaderProps = {
  project: ProjectRow;
  workspaceData: WorkspaceRow | null;
  projectControlsSummary: ProjectControlsSummary;
  linkedRtpCycleCount: number;
  constrainedRtpLinkCount: number;
  illustrativeRtpLinkCount: number;
  candidateRtpLinkCount: number;
  projectRtpLinksPending: boolean;
  workspaceRtpCycles: RtpCycleRow[];
  existingRtpLinks: ExistingRtpLink[];
  deliverableCount: number;
  openRiskCount: number;
  openIssueCount: number;
  reportRecordCount: number;
  reportAttentionCount: number;
  evidenceBackedReportCount: number;
  refreshRecommendedReportCount: number;
  governanceHoldReportCount: number;
  comparisonBackedReportCount: number;
  projectReports: ProjectReportEnriched[];
  projectReportQueueItems: ReportPacketCommandQueueItem[];
  recommendedReport: ProjectReportEnriched | null;
  projectGrantModelingEvidence: ProjectGrantModelingEvidence | null;
  projectGrantModelingReadiness: ReturnType<typeof describeProjectGrantModelingReadiness>;
  projectGrantModelingSupport: ReturnType<typeof buildGrantDecisionModelingSupport>;
};

export function ProjectPostureHeader({
  project,
  workspaceData,
  projectControlsSummary,
  linkedRtpCycleCount,
  constrainedRtpLinkCount,
  illustrativeRtpLinkCount,
  candidateRtpLinkCount,
  projectRtpLinksPending,
  workspaceRtpCycles,
  existingRtpLinks,
  deliverableCount,
  openRiskCount,
  openIssueCount,
  reportRecordCount,
  reportAttentionCount,
  evidenceBackedReportCount,
  refreshRecommendedReportCount,
  governanceHoldReportCount,
  comparisonBackedReportCount,
  projectReports,
  projectReportQueueItems,
  recommendedReport,
  projectGrantModelingEvidence,
  projectGrantModelingReadiness,
  projectGrantModelingSupport,
}: ProjectPostureHeaderProps) {
  return (
    <>
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <StatusBadge tone={toneForStatus(project.status)}>{titleize(project.status)}</StatusBadge>
            <span className="module-record-chip"><span>Type</span><strong>{titleize(project.plan_type)}</strong></span>
          </div>
          <p className="text-[0.73rem] text-muted-foreground">
            {titleize(project.delivery_phase)} · Controls {titleize(projectControlsSummary.controlHealth)}{linkedRtpCycleCount > 0 ? ` · RTP ${linkedRtpCycleCount} linked` : ""} · {workspaceData?.name ?? "Unknown workspace"} · Updated {fmtDateTime(project.updated_at)}
          </p>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{project.name}</h1>
            <p className="module-intro-description">
              {project.summary ||
                "Use this detail view to keep runs, milestones, submittals, invoices, deliverables, risks, issues, decisions, meetings, and linked datasets tied to the project."}
            </p>
          </div>

          <div className="module-summary-grid cols-6">
            <div className="module-summary-card">
              <p className="module-summary-label">Deliverables</p>
              <p className="module-summary-value">{deliverableCount}</p>
              <p className="module-summary-detail">Outputs actively tracked in this control room.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Open risks</p>
              <p className="module-summary-value">{openRiskCount}</p>
              <p className="module-summary-detail">Risks still requiring active attention or mitigation.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Open issues</p>
              <p className="module-summary-value">{openIssueCount}</p>
              <p className="module-summary-detail">Current blockers surfaced for delivery and analysis flow.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Milestones</p>
              <p className="module-summary-value">{projectControlsSummary.milestoneCount}</p>
              <p className="module-summary-detail">Phase checkpoints and operator deadlines on the record.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Pending submittals</p>
              <p className="module-summary-value">{projectControlsSummary.pendingSubmittalCount}</p>
              <p className="module-summary-detail">Packets still in draft, review, or submitted posture.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">RTP cycles</p>
              <p className="module-summary-value">{linkedRtpCycleCount}</p>
              <p className="module-summary-detail">Regional plan cycles this project is now attached to.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <FolderKanban className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Project control room</p>
              <h2 className="module-operator-title">LAPM-oriented controls are now visible, not implied</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            OpenPlan now treats milestones, submittals, and invoice posture as first-class project controls instead of burying them inside generic notes.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Workspace tier: {titleize(workspaceData?.plan ?? "pilot")}</div>
            <div className="module-operator-item">
              Stage-gate template: {workspaceData?.stage_gate_template_id ?? "Not available"}
            </div>
            <div className="module-operator-item">
              Template version: {workspaceData?.stage_gate_template_version ?? "Not available"} · Workspace slug: {workspaceData?.slug ?? "Unknown"}
            </div>
            <div className="module-operator-item">CALTRANS posture is aligned to gate domains and invoice/submittal workflow, while exact exhibit/form IDs remain deferred in v0.1.</div>
          </div>
        </article>
      </header>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              <Target className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Portfolio</p>
              <h2 className="module-section-title">RTP portfolio posture</h2>
              <p className="module-section-description">
                Start making project prioritization explicit by attaching this project to one or more RTP cycles with a clear role and rationale.
              </p>
            </div>
          </div>
        </div>

        <div className="module-summary-grid cols-4 mt-5">
          <div className="module-summary-card">
            <p className="module-summary-label">Linked cycles</p>
            <p className="module-summary-value">{linkedRtpCycleCount}</p>
            <p className="module-summary-detail">Total RTP update cycles connected to this project.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Constrained</p>
            <p className="module-summary-value">{constrainedRtpLinkCount}</p>
            <p className="module-summary-detail">Projects positioned inside the fiscally constrained portfolio.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Illustrative</p>
            <p className="module-summary-value">{illustrativeRtpLinkCount}</p>
            <p className="module-summary-detail">Projects visible for aspiration or later advancement.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Candidate</p>
            <p className="module-summary-value">{candidateRtpLinkCount}</p>
            <p className="module-summary-detail">Projects still being framed before final portfolio posture.</p>
          </div>
        </div>

        <div className="mt-5">
          {projectRtpLinksPending ? (
            <div className="rounded-[0.5rem] border border-amber-300/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
              RTP linkage schema is not available yet in this environment. Run the latest migration, then this project can attach into RTP cycle portfolio tracking.
            </div>
          ) : (
            <ProjectRtpLinker
              projectId={project.id}
              availableCycles={workspaceRtpCycles.map((cycle) => ({
                id: cycle.id,
                title: cycle.title,
                status: cycle.status,
                geographyLabel: cycle.geography_label,
                horizonStartYear: cycle.horizon_start_year,
                horizonEndYear: cycle.horizon_end_year,
              }))}
              existingLinks={existingRtpLinks}
            />
          )}
        </div>
      </article>

      <article id="project-reporting" className="module-section-surface scroll-mt-24">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
              <FileStack className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Reporting</p>
              <h2 className="module-section-title">Packet freshness and regeneration cues</h2>
              <p className="module-section-description">
                Project-level reporting should tell the team whether they already have a usable packet, need to regenerate one, or still need the first report record.
              </p>
            </div>
          </div>
        </div>

        <div className="module-summary-grid cols-6 mt-5">
          <div className="module-summary-card">
            <p className="module-summary-label">Report records</p>
            <p className="module-summary-value">{reportRecordCount}</p>
            <p className="module-summary-detail">Report packets and drafts linked to this project.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Needs attention</p>
            <p className="module-summary-value">{reportAttentionCount}</p>
            <p className="module-summary-detail">Reports that still need packet updates.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Evidence-backed</p>
            <p className="module-summary-value">{evidenceBackedReportCount}</p>
            <p className="module-summary-detail">Reports with source-summary details attached.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Refresh recommended</p>
            <p className="module-summary-value">{refreshRecommendedReportCount}</p>
            <p className="module-summary-detail">Report packets that drifted after generation.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Governance holds</p>
            <p className="module-summary-value">{governanceHoldReportCount}</p>
            <p className="module-summary-detail">Packets that surfaced a blocked gate in the latest evidence snapshot.</p>
          </div>
        </div>

        {projectReports.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">
            No reports are linked to this project yet. Create the first report packet to start a review trail.
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <ReportPacketCommandQueue
              title="Project packet queue"
              description="The next report packet actions inside this project, ordered before the full report list below."
              items={projectReportQueueItems}
              emptyLabel="No queued report packet work in this project right now."
            />

            <div className="grid gap-4 md:grid-cols-[0.92fr_1.08fr]">
            <div
              className={`rounded-[0.75rem] border p-5 ${
                reportAttentionCount > 0
                  ? "border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20"
                  : "border-emerald-400/35 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Reporting posture
              </p>
              <h3 className="mt-2 text-sm font-semibold text-foreground">
                {reportAttentionCount > 0 && recommendedReport
                  ? `${recommendedReport.title} needs attention`
                  : "Packet trail looks current"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {recommendedReport
                  ? getReportPacketActionLabel(recommendedReport.packetFreshness.label)
                  : "Open reports to create the first packet for this project."}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {recommendedReport?.packetFreshness.detail ??
                  "No reports are linked to this project yet."}
              </p>
              {recommendedReport?.comparisonDigest ? (
                <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-2.5">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Comparison posture
                  </p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/90">
                    {recommendedReport.comparisonDigest.headline}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {recommendedReport.comparisonDigest.detail}
                  </p>
                </div>
              ) : null}
              {projectGrantModelingEvidence ? (
                <div
                  id="project-packet-release-review"
                  className="mt-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2.5"
                >
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Packet release review
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StatusBadge tone={projectGrantModelingReadiness?.tone ?? "neutral"}>
                      {projectGrantModelingReadiness?.label ?? "No visible support"}
                    </StatusBadge>
                    <StatusBadge tone={projectGrantModelingEvidence.leadComparisonReport.packetFreshness.tone}>
                      {projectGrantModelingEvidence.leadComparisonReport.packetFreshness.label}
                    </StatusBadge>
                    <StatusBadge tone="info">
                      Suggested {titleize(projectGrantModelingSupport.recommendedDecisionState)}
                    </StatusBadge>
                  </div>
                  <p className="mt-2 text-xs font-medium leading-relaxed text-foreground/90">
                    {projectGrantModelingSupport.recommendedNextActionTitle}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {projectGrantModelingSupport.recommendedNextActionSummary}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={projectGrantModelingEvidence.leadComparisonReport.href}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary/35 hover:text-primary"
                    >
                      Open packet review
                    </Link>
                    <Link
                      href={`/grants?focusProjectId=${project.id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary/35 hover:text-primary"
                    >
                      Open Grants OS
                    </Link>
                  </div>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {recommendedReport ? (
                  <Link
                    href={getReportNavigationHref(
                      recommendedReport.id,
                      recommendedReport.packetFreshness.label
                    )}
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary/35 hover:text-primary"
                  >
                    Open report
                  </Link>
                ) : null}
                <Link
                  href="/reports"
                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary/35 hover:text-primary"
                >
                  Open reports
                </Link>
              </div>
            </div>

            <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Recent report records
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-foreground">
                    {reportRecordCount > projectReports.length
                      ? `Showing ${projectReports.length} most recent of ${reportRecordCount}`
                      : `Showing ${projectReports.length} most recent report records`}
                  </h3>
                </div>
                {reportAttentionCount > 0 ? (
                  <StatusBadge tone="warning">{reportAttentionCount} need attention</StatusBadge>
                ) : (
                  <StatusBadge tone="success">Packets current</StatusBadge>
                )}
                {comparisonBackedReportCount > 0 ? (
                  <StatusBadge tone="info">{comparisonBackedReportCount} comparison-backed</StatusBadge>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {projectReports.map((report) => (
                  <Link
                    key={report.id}
                    id={`project-report-${report.id}`}
                    href={`/reports/${report.id}`}
                    className="block rounded-[0.5rem] border border-border/70 bg-card/70 p-4 transition-colors hover:border-primary/35 hover:bg-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <h4 className="text-sm font-semibold text-foreground">{report.title}</h4>
                        <p className="text-sm text-muted-foreground">
                          {report.summary || "No summary provided yet."}
                        </p>
                      </div>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <StatusBadge tone={reportStatusTone(report.status)}>
                        {formatReportStatusLabel(report.status)}
                      </StatusBadge>
                      <StatusBadge tone="info">
                        {formatReportTypeLabel(report.report_type)}
                      </StatusBadge>
                    </div>
                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">{report.packetFreshness.label} · {report.packetFreshness.detail}</p>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      {report.packetFreshness.detail}
                    </p>
                    {report.evidenceChainDigest ? (
                      <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-2.5">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Evidence posture
                        </p>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/90">
                          {report.evidenceChainDigest.headline}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {report.evidenceChainDigest.detail}
                        </p>
                        {report.evidenceChainDigest.blockedGateDetail ? (
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {report.evidenceChainDigest.blockedGateDetail}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {report.comparisonDigest ? (
                      <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-2.5">
                        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Comparison posture
                        </p>
                        <p className="mt-1 text-xs font-medium leading-relaxed text-foreground/90">
                          {report.comparisonDigest.headline}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {report.comparisonDigest.detail}
                        </p>
                      </div>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
            </div>
          </div>
        )}
      </article>
    </>
  );
}
