import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

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
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">{label}</p>
          <h2 className="module-section-title">{title}</h2>
          <p className="module-section-description">{description ?? summary.detail}</p>
        </div>
        <StatusBadge tone={postureTone(summary.posture)}>{postureLabel(summary.posture)}</StatusBadge>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="module-subpanel">
          <p className="module-summary-label">Packet pressure</p>
          <p className="module-summary-value">{summary.counts.reportRefreshRecommended + summary.counts.reportNoPacket}</p>
          <p className="module-summary-detail">
            {summary.counts.reportRefreshRecommended} refresh recommended, {summary.counts.reportNoPacket} without packets.
          </p>
        </div>
        <div className="module-subpanel">
          <p className="module-summary-label">Plan setup</p>
          <p className="module-summary-value">{summary.counts.plansNeedingSetup}</p>
          <p className="module-summary-detail">{summary.counts.plans} total plans, {summary.counts.activeProjects} active projects in scope.</p>
        </div>
        <div className="module-subpanel">
          <p className="module-summary-label">Funding pressure</p>
          <p className="module-summary-value">{summary.counts.openFundingOpportunities}</p>
          <p className="module-summary-detail">
            {summary.counts.closingSoonFundingOpportunities} closing within 14 days
            {summary.counts.projectFundingNeedAnchorProjects > 0
              ? `, ${summary.counts.projectFundingNeedAnchorProjects} missing funding anchors`
              : ""}
            {summary.counts.projectFundingSourcingProjects > 0
              ? `, ${summary.counts.projectFundingSourcingProjects} needing sourcing`
              : ""}
            {summary.counts.projectFundingDecisionProjects > 0
              ? `, ${summary.counts.projectFundingDecisionProjects} needing pursue decisions`
              : ""}
            {summary.counts.projectFundingAwardRecordProjects > 0
              ? `, ${summary.counts.projectFundingAwardRecordProjects} awarded opportunities missing award records`
              : ""}
            {summary.counts.projectFundingGapProjects > 0
              ? `, ${summary.counts.projectFundingGapProjects} project funding gaps.`
              : "."}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {summary.commandQueue.length > 0 ? (
          summary.commandQueue.map((item) => (
            <Link key={item.key} href={item.href} className="module-subpanel block transition-colors hover:border-primary/35">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
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
          <div className="module-subpanel text-sm text-muted-foreground">
            No immediate queue pressure is visible from the current workspace snapshot.
          </div>
        )}
      </div>

      {children ? <div className="mt-5 grid gap-3">{children}</div> : null}
    </article>
  );
}
