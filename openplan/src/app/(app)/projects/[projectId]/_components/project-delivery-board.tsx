import Link from "next/link";
import { ArrowRight, ClipboardCheck, FileClock, Target } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordStatusAdvanceButton } from "@/components/projects/record-status-advance-button";
import { DeliverableUpdateControls } from "@/components/projects/deliverable-update-controls";
import {
  RecordAssigneeChip,
  type ProjectAssigneeRoster,
} from "@/components/projects/record-assignee";
import { RecordAssigneeControl } from "@/components/projects/record-assignee-control";
import type { BillingInvoiceSummary } from "@/lib/invoicing/invoice-records";
import {
  DELIVERABLE_PACE_LABELS,
  deliverableBudgetPaceTone,
  type DeliverableBudgetSummary,
} from "@/lib/projects/budget";
import type { ProjectControlsSummary } from "@/lib/projects/controls";
import {
  buildProjectControlHref,
  fmtCurrency,
  fmtDateTime,
  titleize,
  toneForDeliverableStatus,
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
  /** True when the milestone read FAILED — distinct from a project with none. */
  milestonesReadFailed?: boolean;
  prioritizedMilestones: MilestoneRow[];
  projectSubmittalsPending: boolean;
  submittals: SubmittalRow[];
  /** True when the submittal read FAILED — distinct from a project with none. */
  submittalsReadFailed?: boolean;
  /** True when the reimbursement-invoice read FAILED — money, so it must not read as zero. */
  invoicesReadFailed?: boolean;
  /**
   * ACCEPTED AND IGNORED. The invoice register moved to `ProjectInvoiceRegister`
   * so it sits with this project's funding; the summary tile above still reports
   * claims from `invoiceSummary`. These three stay declared, and only declared,
   * so callers written against the old shape still type-check while they are
   * updated. Delete them — and the callers still passing them — together.
   */
  projectInvoicesPending?: boolean;
  projectInvoices?: BillingInvoice[];
  prioritizedProjectInvoices?: BillingInvoice[];
  prioritizedSubmittals: SubmittalRow[];
  deliverables: DeliverableRow[] | null;
  /** Per-deliverable budget/burn summaries keyed by deliverable id (may be empty pre-migration). */
  budgetSummaryByDeliverableId: Map<string, DeliverableBudgetSummary>;
  /**
   * The workspace roster, or an explicit failure. Required, not optional: an
   * optional roster prop the page forgot to pass would render every assigned
   * record as if nobody owned it, and nothing would fail.
   */
  assigneeRoster: ProjectAssigneeRoster;
  /**
   * True when the deliverable projection could not ask for `assignee_user_id`
   * because 20260811000006 is not applied here. Disclosed once, in the
   * deliverables panel — not as a chip on every row.
   */
  deliverableAssigneeColumnPending?: boolean;
  /**
   * Whether this member may change records at all. Required, not optional: an
   * optional write flag defaulting to true is how a read-only viewer gets a
   * control that 403s, and defaulting to false is how everyone else loses one
   * silently. The route enforces the same rule server-side — this only decides
   * whether a planner is offered something that would work.
   */
  canWrite: boolean;
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
  milestonesReadFailed = false,
  prioritizedMilestones,
  projectSubmittalsPending,
  submittals,
  submittalsReadFailed = false,
  invoicesReadFailed = false,
  prioritizedSubmittals,
  deliverables,
  budgetSummaryByDeliverableId,
  assigneeRoster,
  deliverableAssigneeColumnPending = false,
  canWrite,
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
                Milestones, submittals, and invoices, tracked the way a local-assistance project needs them. The workflow works today; OpenPlan does not yet fill in a funder&apos;s exact exhibit and form numbers for you.
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
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoices</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{invoiceSummary.totalCount ? `${invoiceSummary.totalCount} invoice record(s)` : invoicesReadFailed ? "Invoice records unavailable" : "No invoice records yet"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {invoiceSummary.totalCount
                ? `${fmtCurrency(invoiceSummary.paidNetAmount)} paid · ${invoiceSummary.overdueCount} overdue. Net requested ${fmtCurrency(invoiceSummary.claimedNetAmount)}.${invoiceSummary.rejectedCount > 0 ? ` ${fmtCurrency(invoiceSummary.rejectedNetAmount)} rejected, not counted.` : ""}`
                : "Add invoices here as you bill for project work, and this will track what is paid and what is late."}
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
                : "Add milestone, submittal, or invoice due dates so real deadline pressure shows up here."}
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
                    projectControlsSummary.attentionSummary.blockedMilestones.targetRowId
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
                    projectControlsSummary.attentionSummary.overdueMilestones.targetRowId
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
                    projectControlsSummary.attentionSummary.overdueSubmittals.targetRowId
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
                    projectControlsSummary.attentionSummary.overdueInvoices.targetRowId
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

      {/* Two columns, not three: the invoice register moved to this project's
          funding, where the awards it is claimed against live. */}
      <div className="grid gap-6 xl:grid-cols-2">
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
            <div className="module-empty-state mt-5 text-sm">
              {milestonesReadFailed
                ? "Milestones could not be read, so none are listed. This is a failed lookup, not a schedule with nothing in it."
                : "No milestones recorded yet."}
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {prioritizedMilestones.map((milestone) => (
                <div key={milestone.id} id={`project-milestone-${milestone.id}`} className="module-record-row scroll-mt-24">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForMilestoneStatus(milestone.status)}>{titleize(milestone.status)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(milestone.phase_code)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(milestone.milestone_type)}</StatusBadge>
                      {/* The teammate lane. owner_label — the external-party
                          lane — still renders in its own line below. */}
                      <RecordAssigneeChip roster={assigneeRoster} assigneeUserId={milestone.assignee_user_id} />
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
                    <div className="mt-3">
                      <RecordStatusAdvanceButton
                        projectId={project.id}
                        recordId={milestone.id}
                        recordType="milestone"
                        currentStatus={milestone.status}
                      />
                    </div>
                    {/* Reassign or unassign — the chip above only READS. */}
                    <RecordAssigneeControl
                      projectId={project.id}
                      workspaceId={project.workspace_id}
                      recordId={milestone.id}
                      recordType="milestone"
                      currentAssigneeUserId={milestone.assignee_user_id}
                      canWrite={canWrite}
                    />
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
            <div className="module-empty-state mt-5 text-sm">
              {submittalsReadFailed
                ? "Submittals could not be read, so none are listed. This is a failed lookup, not a project with nothing submitted."
                : "No submittals recorded yet."}
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {prioritizedSubmittals.map((submittal) => (
                <div key={submittal.id} id={`project-submittal-${submittal.id}`} className="module-record-row scroll-mt-24">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForSubmittalStatus(submittal.status)}>{titleize(submittal.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(submittal.submittal_type)}</StatusBadge>
                      {/* agency_label (below) names the REVIEWING agency; this
                          names the teammate who owes the packet. */}
                      <RecordAssigneeChip roster={assigneeRoster} assigneeUserId={submittal.assignee_user_id} />
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
                    <div className="mt-3">
                      <RecordStatusAdvanceButton
                        projectId={project.id}
                        recordId={submittal.id}
                        recordType="submittal"
                        currentStatus={submittal.status}
                      />
                    </div>
                    {/* Who owes the packet can change; the chip above only READS. */}
                    <RecordAssigneeControl
                      projectId={project.id}
                      workspaceId={project.workspace_id}
                      recordId={submittal.id}
                      recordType="submittal"
                      currentAssigneeUserId={submittal.assignee_user_id}
                      canWrite={canWrite}
                    />
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
        {deliverableAssigneeColumnPending ? (
          <div className="module-alert mt-5 text-sm">
            Deliverable assignees are not shown here yet: this deployment is behind migration
            20260811000006, so the list could not ask the database who is assigned. Nobody is being
            reported as unassigned — the question has not been asked.
          </div>
        ) : null}
        {!deliverables || deliverables.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">No deliverables yet. Add the first required output in the creation lane.</div>
        ) : (
          <div className="mt-5 module-record-list">
            {deliverables.map((deliverable) => {
              const budgetSummary = budgetSummaryByDeliverableId.get(deliverable.id) ?? null;

              return (
                <div key={deliverable.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDeliverableStatus(deliverable.status)}>{titleize(deliverable.status)}</StatusBadge>
                      {deliverable.owner_label ? <StatusBadge tone="neutral">{deliverable.owner_label}</StatusBadge> : null}
                      {/* Both lanes, side by side: the free-text owner above,
                          the accountable teammate here. */}
                      <RecordAssigneeChip roster={assigneeRoster} assigneeUserId={deliverable.assignee_user_id} />
                      {budgetSummary ? (
                        <>
                          <StatusBadge tone={deliverableBudgetPaceTone(budgetSummary.paceStatus)}>
                            {DELIVERABLE_PACE_LABELS[budgetSummary.paceStatus]}
                          </StatusBadge>
                          {budgetSummary.budgetAmount !== null ? (
                            <StatusBadge tone="neutral">Budget {fmtCurrency(budgetSummary.budgetAmount)}</StatusBadge>
                          ) : null}
                          {budgetSummary.actualToDate > 0 ? (
                            <StatusBadge tone="info">Billed + spend {fmtCurrency(budgetSummary.actualToDate)}</StatusBadge>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{deliverable.title}</h3>
                        {deliverable.due_date ? <p className="module-record-stamp">Due {fmtDateTime(deliverable.due_date)}</p> : null}
                      </div>
                      <p className="module-record-summary">{deliverable.summary || "No summary yet."}</p>
                    </div>
                    {/*
                      The deliverable lane's write control. Budget and progress
                      seed src/lib/projects/budget.ts, which refuses a pace
                      verdict without them — so without this control the chips
                      above are stuck at their refusal forever.
                    */}
                    <DeliverableUpdateControls
                      projectId={project.id}
                      deliverableId={deliverable.id}
                      currentStatus={deliverable.status}
                      currentBudgetAmount={budgetSummary?.budgetAmount ?? null}
                      currentPercentComplete={budgetSummary?.percentComplete ?? null}
                    />
                    {/*
                      Reassignment. `assignee_user_id` is UNDEFINED here when the
                      projection could not ask for it (the panel discloses that
                      once, above), and the control renders nothing rather than
                      offering "Unassigned" as an answer nobody gave.
                    */}
                    <RecordAssigneeControl
                      projectId={project.id}
                      workspaceId={project.workspace_id}
                      recordId={deliverable.id}
                      recordType="deliverable"
                      currentAssigneeUserId={deliverable.assignee_user_id}
                      canWrite={canWrite}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </>
  );
}
