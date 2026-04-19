import Link from "next/link";
import {
  ArrowRight,
  ClipboardCheck,
  FileClock,
  FileSpreadsheet,
  Target,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { BillingInvoiceSummary } from "@/lib/billing/invoice-records";
import type { ProjectControlsSummary } from "@/lib/projects/controls";
import {
  buildProjectControlHref,
  fmtCurrency,
  fmtDateTime,
  titleize,
  toneForDeliverableStatus,
  toneForInvoiceStatus,
  toneForMilestoneStatus,
  toneForSubmittalStatus,
} from "./_helpers";
import type {
  BillingInvoice,
  DeliverableRow,
  MilestoneRow,
  ProjectRow,
  SubmittalRow,
} from "./_types";

type RecommendedReportRef = {
  id: string;
  title: string;
} | null;

type ProjectDeliveryBoardProps = {
  project: ProjectRow;
  projectControlsSummary: ProjectControlsSummary;
  invoiceSummary: BillingInvoiceSummary;
  recommendedReport: RecommendedReportRef;
  firstBlockedMilestone: MilestoneRow | null;
  firstOverdueMilestone: MilestoneRow | null;
  firstOverdueSubmittal: SubmittalRow | null;
  firstOverdueInvoice: BillingInvoice | null;
  projectMilestonesPending: boolean;
  milestones: MilestoneRow[];
  prioritizedMilestones: MilestoneRow[];
  projectSubmittalsPending: boolean;
  submittals: SubmittalRow[];
  prioritizedSubmittals: SubmittalRow[];
  projectInvoicesPending: boolean;
  projectInvoices: BillingInvoice[];
  prioritizedProjectInvoices: BillingInvoice[];
  deliverables: DeliverableRow[] | null;
};

export function ProjectDeliveryBoard({
  project,
  projectControlsSummary,
  invoiceSummary,
  recommendedReport,
  firstBlockedMilestone,
  firstOverdueMilestone,
  firstOverdueSubmittal,
  firstOverdueInvoice,
  projectMilestonesPending,
  milestones,
  prioritizedMilestones,
  projectSubmittalsPending,
  submittals,
  prioritizedSubmittals,
  projectInvoicesPending,
  projectInvoices,
  prioritizedProjectInvoices,
  deliverables,
}: ProjectDeliveryBoardProps) {
  return (
    <>
      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Target className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Project controls</p>
              <h2 className="module-section-title">Milestone, submittal, and invoice readiness</h2>
              <p className="module-section-description">
                This is the operator-facing slice for LAPM-style project controls. It is deliberately honest: workflow posture is live now, while exact Caltrans exhibit/form numbering remains deferred.
              </p>
            </div>
          </div>
        </div>

        <div className="module-summary-grid cols-5 mt-5">
          <div className="module-summary-card">
            <p className="module-summary-label">Delivery phase</p>
            <p className="module-summary-value text-base leading-tight">{titleize(project.delivery_phase)}</p>
            <p className="module-summary-detail">Current top-level phase on the project record.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Milestones</p>
            <p className="module-summary-value">{projectControlsSummary.milestoneCount}</p>
            <p className="module-summary-detail">{projectControlsSummary.completedMilestoneCount} complete · {projectControlsSummary.blockedMilestoneCount} blocked.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Pending submittals</p>
            <p className="module-summary-value">{projectControlsSummary.pendingSubmittalCount}</p>
            <p className="module-summary-detail">{projectControlsSummary.overdueSubmittalCount} overdue for review or agency response.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Overdue controls</p>
            <p className="module-summary-value">{projectControlsSummary.overdueMilestoneCount + projectControlsSummary.overdueSubmittalCount}</p>
            <p className="module-summary-detail">Milestones + submittals currently behind target dates.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Outstanding invoices</p>
            <p className="module-summary-value text-base leading-tight">{fmtCurrency(invoiceSummary.outstandingNetAmount)}</p>
            <p className="module-summary-detail">{invoiceSummary.submittedCount} invoice record(s) still in review or payment flow.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Control deadlines</p>
            <p className="module-summary-value">{projectControlsSummary.deadlineSummary.totalCount}</p>
            <p className="module-summary-detail">
              {projectControlsSummary.deadlineSummary.overdueCount} overdue · {projectControlsSummary.deadlineSummary.upcomingCount} upcoming.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5 mt-5">
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recommended next action</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge tone={projectControlsSummary.recommendedNextAction.tone}>
                {projectControlsSummary.recommendedNextAction.label}
              </StatusBadge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{projectControlsSummary.recommendedNextAction.detail}</p>
            <div className="mt-3">
              <Link
                href={buildProjectControlHref(
                  projectControlsSummary.recommendedNextAction.targetId,
                  projectControlsSummary.recommendedNextAction.targetRowId
                )}
                className="module-inline-action w-fit"
              >
                Open control lane
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Next milestone</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{projectControlsSummary.nextMilestone?.title ?? "No upcoming milestone recorded"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectControlsSummary.nextMilestone
                ? `${titleize(projectControlsSummary.nextMilestone.phase_code)} · target ${fmtDateTime(projectControlsSummary.nextMilestone.target_date)}`
                : "Add the next phase checkpoint or approval target to make schedule pressure visible."}
            </p>
            <div className="mt-3">
              <Link
                href={buildProjectControlHref("project-milestones", projectControlsSummary.nextMilestone?.id ? `project-milestone-${projectControlsSummary.nextMilestone.id}` : undefined)}
                className="module-inline-action w-fit"
              >
                Open milestone
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Next submittal</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{projectControlsSummary.nextSubmittal?.title ?? "No upcoming submittal recorded"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectControlsSummary.nextSubmittal
                ? `${titleize(projectControlsSummary.nextSubmittal.submittal_type)} · due ${fmtDateTime(projectControlsSummary.nextSubmittal.due_date)}`
                : "Add the next packet, reimbursement claim, or agency handoff to expose review cadence."}
            </p>
            <div className="mt-3">
              <Link
                href={buildProjectControlHref("project-submittals", projectControlsSummary.nextSubmittal?.id ? `project-submittal-${projectControlsSummary.nextSubmittal.id}` : undefined)}
                className="module-inline-action w-fit"
              >
                Open submittal
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice posture</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{invoiceSummary.totalCount ? `${invoiceSummary.totalCount} invoice record(s)` : "No invoice records yet"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {invoiceSummary.totalCount
                ? `${fmtCurrency(invoiceSummary.paidNetAmount)} paid · ${invoiceSummary.overdueCount} overdue. Net requested ${fmtCurrency(invoiceSummary.totalNetAmount)}.`
                : "The register is ready for consulting/project-delivery invoices instead of SaaS-only subscription state."}
            </p>
            <div className="mt-3">
              <Link href="#project-invoices" className="module-inline-action w-fit">
                Open invoice lane
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Deadline queue</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">
              {projectControlsSummary.deadlineSummary.nextDeadline?.title ?? "No control deadlines recorded"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectControlsSummary.deadlineSummary.nextDeadline
                ? `${projectControlsSummary.deadlineSummary.nextDeadline.label} · ${fmtDateTime(projectControlsSummary.deadlineSummary.nextDeadline.deadlineAt)}`
                : "Add milestone, submittal, or invoice due dates so the control room can surface real deadline pressure."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {projectControlsSummary.deadlineSummary.nextDeadline ? (
                <StatusBadge tone={projectControlsSummary.deadlineSummary.nextDeadline.tone}>
                  {projectControlsSummary.deadlineSummary.nextDeadline.label}
                </StatusBadge>
              ) : null}
              {projectControlsSummary.deadlineSummary.overdueCount > 0 ? (
                <StatusBadge tone="danger">{projectControlsSummary.deadlineSummary.overdueCount} overdue</StatusBadge>
              ) : null}
            </div>
            <div className="mt-3">
              <Link
                href={
                  projectControlsSummary.deadlineSummary.nextDeadline
                    ? buildProjectControlHref(
                        projectControlsSummary.deadlineSummary.nextDeadline.targetId,
                        projectControlsSummary.deadlineSummary.nextDeadline.targetRowId
                      )
                    : "#project-milestones"
                }
                className="module-inline-action w-fit"
              >
                Open deadline lane
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>

        {projectControlsSummary.deadlineSummary.items.length > 0 ? (
          <div className="mt-5 rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Control deadline queue</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  The first few dated control items across milestones, submittals, and invoices, ordered by urgency.
                </p>
              </div>
              <StatusBadge tone={projectControlsSummary.deadlineSummary.overdueCount > 0 ? "danger" : "info"}>
                {projectControlsSummary.deadlineSummary.overdueCount > 0
                  ? `${projectControlsSummary.deadlineSummary.overdueCount} overdue`
                  : `${projectControlsSummary.deadlineSummary.upcomingCount} upcoming`}
              </StatusBadge>
            </div>
            <div className="mt-4 space-y-3">
              {projectControlsSummary.deadlineSummary.items.map((item) => (
                <Link
                  key={`${item.kind}-${item.title}-${item.deadlineAt}`}
                  href={buildProjectControlHref(item.targetId, item.targetRowId)}
                  className="flex items-start justify-between gap-3 rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(item.kind)}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">{fmtDateTime(item.deadlineAt)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Open lane</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {(projectControlsSummary.attentionSummary.reportPackets.count > 0 ||
          projectControlsSummary.attentionSummary.blockedMilestones.count > 0 ||
          projectControlsSummary.attentionSummary.overdueMilestones.count > 0 ||
          projectControlsSummary.attentionSummary.overdueSubmittals.count > 0 ||
          projectControlsSummary.attentionSummary.overdueInvoices.count > 0) ? (
          <div className="mt-5 rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Attention lanes</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Fast paths into the control lanes currently creating schedule or payment risk.
                </p>
              </div>
              <StatusBadge tone="danger">Operator attention</StatusBadge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {projectControlsSummary.attentionSummary.reportPackets.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.reportPackets.targetId,
                    projectControlsSummary.attentionSummary.reportPackets.targetRowId
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Report packets</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.reportPackets.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Refresh stale packets or generate missing artifacts before delivery review.</p>
                  {recommendedReport ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {recommendedReport.title}</p>
                  ) : null}
                </Link>
              ) : null}
              {projectControlsSummary.attentionSummary.blockedMilestones.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.blockedMilestones.targetId,
                    firstBlockedMilestone ? `project-milestone-${firstBlockedMilestone.id}` : undefined
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Blocked milestones</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.blockedMilestones.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Clear milestone blockers before the next delivery move.</p>
                  {firstBlockedMilestone ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {firstBlockedMilestone.title}</p>
                  ) : null}
                </Link>
              ) : null}
              {projectControlsSummary.attentionSummary.overdueMilestones.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.overdueMilestones.targetId,
                    firstOverdueMilestone ? `project-milestone-${firstOverdueMilestone.id}` : undefined
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overdue milestones</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.overdueMilestones.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Rebaseline checkpoints that are already behind target.</p>
                  {firstOverdueMilestone ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {firstOverdueMilestone.title}</p>
                  ) : null}
                </Link>
              ) : null}
              {projectControlsSummary.attentionSummary.overdueSubmittals.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.overdueSubmittals.targetId,
                    firstOverdueSubmittal ? `project-submittal-${firstOverdueSubmittal.id}` : undefined
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overdue submittals</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.overdueSubmittals.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Bring late packets back into explicit review cadence.</p>
                  {firstOverdueSubmittal ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {firstOverdueSubmittal.title}</p>
                  ) : null}
                </Link>
              ) : null}
              {projectControlsSummary.attentionSummary.overdueInvoices.count > 0 ? (
                <Link
                  href={buildProjectControlHref(
                    projectControlsSummary.attentionSummary.overdueInvoices.targetId,
                    firstOverdueInvoice ? `project-invoice-${firstOverdueInvoice.id}` : undefined
                  )}
                  className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3 transition hover:bg-muted/35"
                >
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overdue invoices</p>
                  <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{projectControlsSummary.attentionSummary.overdueInvoices.count}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Resolve payment or documentation drift in the invoice lane.</p>
                  {firstOverdueInvoice ? (
                    <p className="mt-2 text-xs text-muted-foreground">First: {firstOverdueInvoice.invoice_number}</p>
                  ) : null}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="module-note mt-5 text-sm">
          Exact CALTRANS/LAPM exhibit/form IDs, claim packet generation, and agency-specific packet templates remain deferred. What works now is the operator control surface: milestone tracking, submittal tracking, and invoice register scaffolding tied to the project record.
        </div>
      </article>

      <div className="grid gap-6 xl:grid-cols-3">
        <article id="project-milestones" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                <Target className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Milestones</p>
                <h2 className="module-section-title">Phase checkpoints</h2>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge tone={projectControlsSummary.blockedMilestoneCount > 0 ? "danger" : "neutral"}>
              {projectControlsSummary.blockedMilestoneCount} blocked
            </StatusBadge>
            <StatusBadge tone={projectControlsSummary.overdueMilestoneCount > 0 ? "warning" : "info"}>
              {projectControlsSummary.overdueMilestoneCount} overdue
            </StatusBadge>
            <StatusBadge tone="neutral">{projectControlsSummary.completedMilestoneCount} complete</StatusBadge>
          </div>
          {projectMilestonesPending ? (
            <div className="module-alert mt-5 text-sm">Project milestones will appear after the Lane C migration is applied to the database.</div>
          ) : milestones.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No milestones recorded yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {prioritizedMilestones.map((milestone) => (
                <div key={milestone.id} id={`project-milestone-${milestone.id}`} className="module-record-row scroll-mt-24">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForMilestoneStatus(milestone.status)}>{titleize(milestone.status)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(milestone.phase_code)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(milestone.milestone_type)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{milestone.title}</h3>
                        <p className="module-record-stamp">{milestone.target_date ? `Target ${fmtDateTime(milestone.target_date)}` : "No target date"}</p>
                      </div>
                      <p className="module-record-summary">{milestone.summary || milestone.notes || "No milestone summary yet."}</p>
                    </div>
                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                      {milestone.owner_label ? `${milestone.owner_label}` : ""}
                      {milestone.actual_date ? `${milestone.owner_label ? " · " : ""}Actual ${fmtDateTime(milestone.actual_date)}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-submittals" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <FileClock className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Submittals</p>
                <h2 className="module-section-title">Packets in review flow</h2>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge tone={projectControlsSummary.overdueSubmittalCount > 0 ? "danger" : "info"}>
              {projectControlsSummary.overdueSubmittalCount} overdue
            </StatusBadge>
            <StatusBadge tone="neutral">{projectControlsSummary.pendingSubmittalCount} pending</StatusBadge>
            {projectControlsSummary.nextSubmittal ? (
              <StatusBadge tone="info">Next due {fmtDateTime(projectControlsSummary.nextSubmittal.due_date)}</StatusBadge>
            ) : null}
          </div>
          {projectSubmittalsPending ? (
            <div className="module-alert mt-5 text-sm">Project submittals will appear after the Lane C migration is applied to the database.</div>
          ) : submittals.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No submittals recorded yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {prioritizedSubmittals.map((submittal) => (
                <div key={submittal.id} id={`project-submittal-${submittal.id}`} className="module-record-row scroll-mt-24">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForSubmittalStatus(submittal.status)}>{titleize(submittal.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(submittal.submittal_type)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{submittal.title}</h3>
                        <p className="module-record-stamp">{submittal.due_date ? `Due ${fmtDateTime(submittal.due_date)}` : "No due date"}</p>
                      </div>
                      <p className="module-record-summary">{submittal.notes || "No submittal notes yet."}</p>
                    </div>
                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                      Cycle {submittal.review_cycle}{submittal.agency_label ? ` · ${submittal.agency_label}` : ""}{submittal.reference_number ? ` · Ref ${submittal.reference_number}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-invoices" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <FileSpreadsheet className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Invoices</p>
                <h2 className="module-section-title">Project-linked billing register</h2>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge tone={invoiceSummary.overdueCount > 0 ? "danger" : "info"}>{invoiceSummary.overdueCount} overdue</StatusBadge>
            <StatusBadge tone="neutral">{invoiceSummary.submittedCount} in review/payment</StatusBadge>
            <StatusBadge tone="info">Outstanding {fmtCurrency(invoiceSummary.outstandingNetAmount)}</StatusBadge>
          </div>
          {projectInvoicesPending ? (
            <div className="module-alert mt-5 text-sm">Invoice records will appear after the Lane C migration is applied to the database.</div>
          ) : projectInvoices.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No invoice records linked to this project yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {prioritizedProjectInvoices.map((invoice) => (
                <div key={invoice.id} id={`project-invoice-${invoice.id}`} className="module-record-row scroll-mt-24">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleize(invoice.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(invoice.billing_basis)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(invoice.supporting_docs_status)}</StatusBadge>
                      {invoice.fundingAward ? <StatusBadge tone="neutral">Award {invoice.fundingAward.title}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{invoice.invoice_number}</h3>
                        <p className="module-record-stamp">{fmtCurrency(invoice.net_amount)}</p>
                      </div>
                      <p className="module-record-summary">
                        {invoice.notes || `${titleize(invoice.caltrans_posture)}${invoice.submitted_to ? ` · ${invoice.submitted_to}` : ""}`}
                      </p>
                    </div>
                    <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                      {invoice.invoice_date ? `Invoice ${fmtDateTime(invoice.invoice_date)}` : ""}
                      {invoice.due_date ? ` · Due ${fmtDateTime(invoice.due_date)}` : ""}
                      {invoice.fundingAward ? ` · ${invoice.fundingAward.title}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <article id="project-deliverables" className="module-section-surface scroll-mt-24">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Deliverables</p>
              <h2 className="module-section-title">Outputs to ship</h2>
            </div>
          </div>
        </div>
        {!deliverables || deliverables.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">No deliverables yet. Add the first required output in the creation lane.</div>
        ) : (
          <div className="mt-5 module-record-list">
            {deliverables.map((deliverable) => (
              <div key={deliverable.id} className="module-record-row">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={toneForDeliverableStatus(deliverable.status)}>{titleize(deliverable.status)}</StatusBadge>
                    {deliverable.owner_label ? <StatusBadge tone="neutral">{deliverable.owner_label}</StatusBadge> : null}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{deliverable.title}</h3>
                      {deliverable.due_date ? <p className="module-record-stamp">Due {fmtDateTime(deliverable.due_date)}</p> : null}
                    </div>
                    <p className="module-record-summary">{deliverable.summary || "No summary yet."}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </>
  );
}
