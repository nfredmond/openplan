import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { isGrantsCommand, resolveSharedGrantsQueueHref } from "@/lib/operations/grants-links";
import { ADMIN_PILOT_READINESS_ROUTE } from "@/lib/operations/pilot-readiness-proof-paths";
import { getAdminPilotReadinessProofArtifactIndex } from "@/lib/operations/release-proof-packet";
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

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

const pilotPreflightProofArtifact = getAdminPilotReadinessProofArtifactIndex().find(
  (item) => item.key === "pilot-preflight-proof",
);

export function WorkspaceCommandBoard({
  summary,
  label = "Operations command board",
  title = "What the workspace should do next",
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
  const rtpFundingReviewCount = safeCount(counts.rtpFundingReviewPackets);
  const aerialMissionCount = safeCount(counts.aerialMissions);
  const aerialActiveMissionCount = safeCount(counts.aerialActiveMissions);
  const aerialReadyPackageCount = safeCount(counts.aerialReadyPackages);
  const baseDescription = description ?? summary.detail;
  const rtpFundingReviewRoutesThroughGrants =
    summary.nextCommand?.key === "review-current-report-packets" && summary.nextCommand.moduleKey === "grants";
  const effectiveDescription =
    rtpFundingReviewCount > 0
      ? `${baseDescription} ${pluralize(rtpFundingReviewCount, "current RTP packet")} still ${rtpFundingReviewCount === 1 ? "needs" : "need"}${rtpFundingReviewRoutesThroughGrants ? " Grants OS follow-through before packet release review is treated as settled." : " funding-backed release review even though packet freshness already reads current."}`
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
          <p className="module-summary-label">Packet work</p>
          <p className="module-summary-value">
            {reportRefreshRecommendedCount + reportNoPacketCount + reportPacketCurrentCount}
          </p>
          <p className="module-summary-detail">
            {reportRefreshRecommendedCount} refresh recommended, {reportNoPacketCount} without packets, {reportPacketCurrentCount} ready for release review{rtpFundingReviewCount > 0 ? `, ${rtpFundingReviewCount} ${rtpFundingReviewRoutesThroughGrants ? "routed through Grants OS." : "funding-backed."}` : "."}
          </p>
        </div>
        <div className="module-subpanel">
          <p className="module-summary-label">Plan setup</p>
          <p className="module-summary-value">{plansNeedingSetupCount}</p>
          <p className="module-summary-detail">{planCount} total plans, {activeProjectCount} active projects in scope.</p>
        </div>
        <div className="module-subpanel">
          <p className="module-summary-label">Funding pressure</p>
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
          <p className="module-summary-label">Reimbursement follow-through</p>
          <p className="module-summary-value">{reimbursementPressure}</p>
          <p className="module-summary-detail">
            {reimbursementPressure === 0
              ? "No reimbursement packet or invoice follow-through pressure is visible in this workspace snapshot."
              : `${reimbursementStartCount} need first reimbursement packet${reimbursementStartCount === 1 ? "" : "s"}, ${reimbursementAdvanceCount} already in the invoice follow-through lane.`}
          </p>
        </div>
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
            Review, check, inspect, or regenerate work by lane before treating the Command Center queue as clear.
          </p>
        </div>
        <div className="divide-y divide-border/60">
          {workflowGroups.map((group) => (
            <section key={group.key} className="grid gap-3 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
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
                {group.key === "admin-release-proof" ? (
                  <div className="mt-3 border-l border-primary/35 pl-3">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                      Pilot proof reference
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Start with the{" "}
                      <Link href={ADMIN_PILOT_READINESS_ROUTE} className="font-semibold text-primary hover:underline">
                        readiness packet + preflight proof
                      </Link>
                      {pilotPreflightProofArtifact
                        ? `; latest preflight note: ${pilotPreflightProofArtifact.artifact}.`
                        : "."} Keep claims inside the supervised-pilot caveats before external use.
                    </p>
                  </div>
                ) : null}
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
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-1">
        <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Command queue</p>
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
