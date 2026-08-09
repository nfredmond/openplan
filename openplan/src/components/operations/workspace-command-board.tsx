import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { isGrantsCommand, resolveSharedGrantsQueueHref } from "@/lib/operations/grants-links";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";
import { buildWorkflowNextActionGroups, type WorkflowNextActionEntry } from "@/lib/operations/workflow-next-action-groups";

function postureTone(posture: WorkspaceOperationsSummary["posture"]) {
  switch (posture) {
    case "attention":
      return "warning" as const;
    case "active":
      return "info" as const;
    default:
      return "success" as const;
  }
}

function postureLabel(posture: WorkspaceOperationsSummary["posture"]) {
  switch (posture) {
    case "attention":
      return "Attention";
    case "active":
      return "Active";
    default:
      return "Stable";
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * For `summary.counts` only — see the matching note in
 * `workflow-next-action-groups.ts`. The `summary.moduleObservations` numbers are
 * `number | null` where null means NOT MEASURED, and must go through
 * `observedValue` / `observedCountPhrase` instead so an unread lane cannot
 * render as a zero.
 */
function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** What a stat tile shows in place of a number nobody measured. */
const UNMEASURED_VALUE = "—";

function observedValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : UNMEASURED_VALUE;
}

function observedCountPhrase(
  value: number | null | undefined,
  singular: string,
  plural = `${singular}s`
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `an unmeasured number of ${plural}`;
  }

  return `${value} ${value === 1 ? singular : plural}`;
}

function resolveNextActionHref(action: WorkflowNextActionEntry) {
  return action.command && isGrantsCommand(action.command)
    ? resolveSharedGrantsQueueHref(action.command)
    : action.href;
}

function formatActionBadge(badge: WorkflowNextActionEntry["badges"][number]) {
  return badge.value !== null && badge.value !== undefined ? `${badge.label}: ${badge.value}` : badge.label;
}

function groupCountLabel(group: ReturnType<typeof buildWorkflowNextActionGroups>[number]) {
  if (group.queuedActionCount === 0) return "standing check";
  if (group.queuedActionCount > group.displayedActionCount) {
    return `${pluralize(group.queuedActionCount, "queued action")} · ${group.displayedActionCount} shown`;
  }
  return pluralize(group.queuedActionCount, "queued action");
}

export function WorkspaceCommandBoard({
  summary,
  label = "What needs attention",
  title = "Where the work is right now",
  description,
  children,
}: {
  summary: WorkspaceOperationsSummary;
  label?: string;
  title?: string;
  description?: string;
  children?: ReactNode;
}) {
  const counts = summary.counts;
  const reportRefreshRecommendedCount = safeCount(counts.reportRefreshRecommended);
  const reportNoPacketCount = safeCount(counts.reportNoPacket);
  const reportPacketCurrentCount = safeCount(counts.reportPacketCurrent);
  const rtpFundingReviewCount = safeCount(counts.rtpFundingReviewPackets);
  const rtpReviewLoopOpenCount = safeCount(counts.rtpReviewLoopOpenPackets);
  const reportGovernanceAttentionCount =
    reportRefreshRecommendedCount + reportNoPacketCount + rtpFundingReviewCount + rtpReviewLoopOpenCount;
  const plansNeedingSetupCount = safeCount(counts.plansNeedingSetup);
  const planCount = safeCount(counts.plans);
  const activeProjectCount = safeCount(counts.activeProjects);
  const openFundingOpportunityCount = safeCount(counts.openFundingOpportunities);
  const closingSoonFundingOpportunityCount = safeCount(counts.closingSoonFundingOpportunities);
  const overdueDecisionFundingOpportunityCount = safeCount(counts.overdueDecisionFundingOpportunities);
  const fundingNeedAnchorProjectCount = safeCount(counts.projectFundingNeedAnchorProjects);
  const fundingSourcingProjectCount = safeCount(counts.projectFundingSourcingProjects);
  const fundingDecisionProjectCount = safeCount(counts.projectFundingDecisionProjects);
  const fundingAwardRecordProjectCount = safeCount(counts.projectFundingAwardRecordProjects);
  const fundingGapProjectCount = safeCount(counts.projectFundingGapProjects);
  const reimbursementStartCount = safeCount(counts.projectFundingReimbursementStartProjects);
  const reimbursementAdvanceCount = safeCount(counts.projectFundingReimbursementActiveProjects);
  const reimbursementPressure = reimbursementStartCount + reimbursementAdvanceCount;
  const aerialMissionCount = safeCount(counts.aerialMissions);
  const aerialActiveMissionCount = safeCount(counts.aerialActiveMissions);
  const aerialReadyPackageCount = safeCount(counts.aerialReadyPackages);
  const observations = summary.moduleObservations;
  const engagementObservation = observations?.engagement;
  const safetyObservation = observations?.safety;
  const modelingObservation = observations?.modeling;
  const unreadableLaneLabels = (observations?.unreadable ?? []).map((failure) => failure.label);
  const baseDescription = description ?? summary.detail;
  const rtpFundingReviewRoutesThroughGrants =
    summary.nextCommand?.key === "review-current-report-packets" && summary.nextCommand.moduleKey === "grants";
  const effectiveDescription =
    rtpFundingReviewCount > 0
      ? `${baseDescription} ${pluralize(rtpFundingReviewCount, "RTP packet")} ${rtpFundingReviewCount === 1 ? "is" : "are"} up to date but still ${rtpFundingReviewCount === 1 ? "needs" : "need"}${rtpFundingReviewRoutesThroughGrants ? " funding sorted out in Grants" : " a funding check"} before you share ${rtpFundingReviewCount === 1 ? "it" : "them"}.`
      : baseDescription;
  const workflowGroups = buildWorkflowNextActionGroups(summary);

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">{label}</p>
          <h2 className="module-section-title">{title}</h2>
          <p className="module-section-description">{effectiveDescription}</p>
        </div>
        <StatusBadge tone={postureTone(summary.posture)}>{postureLabel(summary.posture)}</StatusBadge>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="module-subpanel">
          <p className="module-summary-label">Report packets</p>
          <p className="module-summary-value">
            {reportRefreshRecommendedCount + reportNoPacketCount + reportPacketCurrentCount}
          </p>
          <p className="module-summary-detail">
            {reportRefreshRecommendedCount} out of date, {reportNoPacketCount} not generated yet, {reportPacketCurrentCount} ready to review{rtpFundingReviewCount > 0 ? `, ${rtpFundingReviewCount} waiting on funding${rtpFundingReviewRoutesThroughGrants ? " in Grants" : ""}.` : "."}
          </p>
        </div>
        <div className="module-subpanel">
          <p className="module-summary-label">Reports needing action</p>
          <p className="module-summary-value">{reportGovernanceAttentionCount}</p>
          <p className="module-summary-detail">
Only the ones that need something from you: {reportRefreshRecommendedCount} to regenerate, {reportNoPacketCount} to generate, {rtpFundingReviewCount} waiting on funding, {rtpReviewLoopOpenCount} still in review.
            {reportPacketCurrentCount > 0
              ? ` ${reportPacketCurrentCount} up-to-date packet${reportPacketCurrentCount === 1 ? " is" : "s are"} not counted here, because nothing is being asked of you.`
              : ""}
          </p>
          {summary.nextCommand ? (
            <Link
              href={isGrantsCommand(summary.nextCommand) ? resolveSharedGrantsQueueHref(summary.nextCommand) : summary.nextCommand.href}
              className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline"
            >
              Start with this one
            </Link>
          ) : null}
        </div>
        <div className="module-subpanel">
          <p className="module-summary-label">Plans to finish setting up</p>
          <p className="module-summary-value">{plansNeedingSetupCount}</p>
          <p className="module-summary-detail">{planCount} plan{planCount === 1 ? "" : "s"} in total, {activeProjectCount} active project{activeProjectCount === 1 ? "" : "s"}.</p>
        </div>
        <div className="module-subpanel">
          <p className="module-summary-label">Open grant opportunities</p>
          <p className="module-summary-value">{openFundingOpportunityCount}</p>
          <p className="module-summary-detail">
            {closingSoonFundingOpportunityCount} closing within 14 days
            {overdueDecisionFundingOpportunityCount > 0
              ? `, ${overdueDecisionFundingOpportunityCount} overdue decision${overdueDecisionFundingOpportunityCount === 1 ? "" : "s"}`
              : ""}
            {fundingNeedAnchorProjectCount > 0
              ? `, ${fundingNeedAnchorProjectCount} missing funding anchors`
              : ""}
            {fundingSourcingProjectCount > 0
              ? `, ${fundingSourcingProjectCount} needing sourcing`
              : ""}
            {fundingDecisionProjectCount > 0
              ? `, ${fundingDecisionProjectCount} needing pursue decisions`
              : ""}
            {fundingAwardRecordProjectCount > 0
              ? `, ${fundingAwardRecordProjectCount} awarded opportunities missing award records`
              : ""}
            {fundingGapProjectCount > 0
              ? `, ${fundingGapProjectCount} project funding gaps.`
              : "."}
          </p>
        </div>
        <div className="module-subpanel">
          <p className="module-summary-label">Invoicing to chase</p>
          <p className="module-summary-value">{reimbursementPressure}</p>
          <p className="module-summary-detail">
            {reimbursementPressure === 0
              ? "No awards are waiting to be invoiced, and no invoices are waiting on you."
              : `${reimbursementStartCount} need first reimbursement packet${reimbursementStartCount === 1 ? "" : "s"}, ${reimbursementAdvanceCount} already in invoice follow-through.`}
          </p>
        </div>
        {engagementObservation ? (
          <div className="module-subpanel">
            <p className="module-summary-label">Engagement moderation</p>
            <p className="module-summary-value">
              {observedValue(engagementObservation.moderationActionableItems)}
            </p>
            <p className="module-summary-detail">
              {engagementObservation.moderationActionableItems === null
                ? "The moderation queue could not be read, so this is not a claim that nothing is waiting. Open Engagement to see it."
                : `Comments pending or flagged across ${observedCountPhrase(engagementObservation.campaigns, "campaign")}, with ${observedCountPhrase(engagementObservation.approvedItems, "approved comment")} available to draw from.`}
            </p>
          </div>
        ) : null}
        {safetyObservation ? (
          <div className="module-subpanel">
            <p className="module-summary-label">Crash data pulls</p>
            <p className="module-summary-value">{observedValue(safetyObservation.crashIngests)}</p>
            <p className="module-summary-detail">
              {safetyObservation.crashIngests === null
                ? "This workspace's crash data pulls could not be read, so nothing here says whether crash evidence exists."
                : `${observedCountPhrase(safetyObservation.readyCrashIngests, "pull")} ready, ${observedCountPhrase(safetyObservation.failedCrashIngests, "pull")} failed, ${observedCountPhrase(safetyObservation.uncoveredCrashIngests, "study area")} with no registered source coverage. A study area without coverage is a disclosed gap, not a reading about collisions.`}
            </p>
          </div>
        ) : null}
        {modelingObservation ? (
          <div className="module-subpanel">
            <p className="module-summary-label">Model runs</p>
            <p className="module-summary-value">{observedValue(modelingObservation.modelRuns)}</p>
            <p className="module-summary-detail">
              {modelingObservation.modelRuns === null
                ? "Model runs could not be read for this workspace, so no run state is reported either way."
                : `${observedCountPhrase(modelingObservation.activeModelRuns, "run")} in flight, ${observedCountPhrase(modelingObservation.failedModelRuns, "run")} failed, across ${observedCountPhrase(modelingObservation.scenarioSets, "scenario set")}.`}
            </p>
          </div>
        ) : null}
        {aerialMissionCount > 0 ? (
          <div className="module-subpanel sm:col-span-2">
            <p className="module-summary-label">Aerial evidence</p>
            <p className="module-summary-value">{aerialMissionCount}</p>
            <p className="module-summary-detail">
              {aerialActiveMissionCount} active, {aerialReadyPackageCount} evidence package{aerialReadyPackageCount === 1 ? "" : "s"} ready.
              {summary.aerialPosture?.verificationReadiness === "ready"
                ? " Field verification support packages are ready."
                : summary.aerialPosture?.verificationReadiness === "partial"
                ? " Partial field verification evidence is available."
                : " Evidence packages pending QA and verification."}
            </p>
          </div>
        ) : null}
      </div>

      {unreadableLaneLabels.length > 0 ? (
        /*
         * The disclosure that keeps every empty lane above honest. A read that
         * failed produces no count and no queue item, which on its own is
         * indistinguishable from a lane with nothing in it — so the lanes that
         * could not be read are named here, and the reader is told which parts
         * of this board to disbelieve. Same rule as ReadFailureLog.describe().
         */
        <p className="mt-4 rounded-xl border border-border/80 bg-muted/30 px-3 py-2 text-[0.78rem] leading-5 text-muted-foreground">
          This board could not read{" "}
          {unreadableLaneLabels.length === 1
            ? unreadableLaneLabels[0]
            : `${unreadableLaneLabels.slice(0, -1).join(", ")} and ${unreadableLaneLabels[unreadableLaneLabels.length - 1]}`}
          . Those sections are shown as unmeasured rather than as zero — an empty section here would not mean the
          records are absent.
        </p>
      ) : null}

      {summary.nextCommand ? (
        <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="module-summary-label">Primary next action</p>
              <h3 className="mt-1 text-base font-semibold text-foreground">{summary.nextCommand.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{summary.nextCommand.detail}</p>
            </div>
            <StatusBadge tone={summary.nextCommand.tone}>{summary.nextCommand.tone === "warning" ? "Next" : "Queue"}</StatusBadge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.nextCommand.moduleLabel ? <StatusBadge tone="neutral">{summary.nextCommand.moduleLabel}</StatusBadge> : null}
            {summary.nextCommand.badges.map((badge) => (
              <StatusBadge key={`next-${summary.nextCommand?.key}-${badge.label}`} tone="neutral">
                {badge.label}
                {badge.value !== null && badge.value !== undefined ? `: ${badge.value}` : ""}
              </StatusBadge>
            ))}
          </div>
          <Link
            href={isGrantsCommand(summary.nextCommand) ? resolveSharedGrantsQueueHref(summary.nextCommand) : summary.nextCommand.href}
            className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline"
          >
            Open primary action
          </Link>
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-border/80 bg-background/70">
        <div className="border-b border-border/70 px-4 py-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Workflow next-action groups
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Review, check, inspect, or regenerate work in each module before treating the Command Center queue as clear.
          </p>
        </div>
        <div className="divide-y divide-border/60">
          {workflowGroups.map((group) => {
            return (
              <section
                key={group.key}
                className="grid gap-3 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]"
              >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{group.title}</span>
                  <span className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                    {group.tone === "warning" ? "Next" : group.tone === "danger" ? "Blocked" : "Check"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{group.description}</p>
                <p className="mt-2 text-[0.72rem] font-medium text-muted-foreground/80">
                  {groupCountLabel(group)} · {group.cue}
                </p>
                <div className="mt-3 border-l border-border/80 pl-3">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                    Readiness: <span className="normal-case tracking-normal text-foreground">{group.readiness.label}</span>
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{group.readiness.detail}</p>
                  {group.readiness.metrics.length > 0 ? (
                    <p className="mt-1 text-[0.7rem] font-medium leading-5 text-muted-foreground/80">
                      {group.readiness.metrics.slice(0, 3).map(formatActionBadge).join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2">
                {group.actions.map((action) => (
                  <Link
                    key={`${group.key}-${action.key}`}
                    href={resolveNextActionHref(action)}
                    className="block rounded-xl border border-border/70 bg-muted/20 px-3 py-2 transition-colors hover:border-primary/35 hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{action.title}</p>
                      {action.source === "queue" ? (
                        <span className="shrink-0 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-primary">
                          queued
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.detail}</p>
                    {action.badges.length > 0 ? (
                      <p className="mt-1.5 text-[0.7rem] font-medium leading-5 text-muted-foreground/80">
                        {action.badges.slice(0, 3).map(formatActionBadge).join(" · ")}
                        {action.badges.length > 3 ? ` · +${action.badges.length - 3} more` : ""}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
              </section>
            );
          })}
        </div>
      </div>

      <div className="mt-5 space-y-1">
        <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Next actions</p>
        {summary.commandQueue.length > 0 ? (
          summary.commandQueue.map((item) => (
            <Link key={item.key} href={isGrantsCommand(item) ? resolveSharedGrantsQueueHref(item) : item.href} className="module-subpanel block transition-colors hover:border-primary/35">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    {item.moduleLabel ? <StatusBadge tone="neutral">{item.moduleLabel}</StatusBadge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                </div>
                <StatusBadge tone={item.tone}>{item.tone === "warning" ? "Next" : "Queue"}</StatusBadge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.badges.map((badge) => (
                  <StatusBadge key={`${item.key}-${badge.label}`} tone="neutral">
                    {badge.label}
                    {badge.value !== null && badge.value !== undefined ? `: ${badge.value}` : ""}
                  </StatusBadge>
                ))}
              </div>
            </Link>
          ))
        ) : (
          <p className="text-[0.82rem] text-muted-foreground">
            No immediate queue pressure visible from the current workspace snapshot.
          </p>
        )}
      </div>

      {children ? (
        <div className="mt-5 space-y-1">
          <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Baseline</p>
          {children}
        </div>
      ) : null}
    </article>
  );
}
