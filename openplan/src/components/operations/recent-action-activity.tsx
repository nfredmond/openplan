import { CheckCircle2, TriangleAlert } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { RecentActionExecution } from "@/lib/operations/action-activity";

type RecentActionActivityProps = {
  executions: RecentActionExecution[];
  error: { message?: string } | null;
  className?: string;
  label?: string;
  title?: string;
  description?: string;
  emptyDescription?: string;
  prioritizeSupervisedActions?: boolean;
  showNoWritePosture?: boolean;
};

function getOutcomeTone(outcome: RecentActionExecution["outcome"]) {
  return outcome === "succeeded" ? "success" as const : "danger" as const;
}

function formatActionKind(actionKind: string) {
  return actionKind
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatActionTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function summarizeInputSummary(input: RecentActionExecution["input_summary"]) {
  if (!input) return null;

  const labels: string[] = [];
  const reportId = typeof input.reportId === "string" ? input.reportId : null;
  const artifactId = typeof input.artifactId === "string" ? input.artifactId : null;
  const linkedRunCount = typeof input.linkedRunCount === "number" ? input.linkedRunCount : null;
  const projectId = typeof input.projectId === "string" ? input.projectId : null;

  if (reportId) labels.push(`report ${reportId.slice(0, 8)}`);
  if (artifactId) labels.push(`artifact ${artifactId.slice(0, 8)}`);
  if (linkedRunCount !== null) labels.push(`${linkedRunCount} linked run${linkedRunCount === 1 ? "" : "s"}`);
  if (projectId) labels.push(`project ${projectId.slice(0, 8)}`);

  return labels.length > 0 ? labels.join(" · ") : null;
}

function isSupervisedTriageAction(execution: RecentActionExecution) {
  return execution.outcome === "failed" || execution.approval !== "safe";
}

function getTriageReason(execution: RecentActionExecution) {
  if (execution.outcome === "failed") return "Failed action";
  if (execution.approval === "approval_required") return "Approval-required action";
  if (execution.approval === "review") return "Review-gated action";
  return "Safe audited action";
}

function buildActionTriageSummary(executions: RecentActionExecution[]) {
  return executions.reduce(
    (summary, execution) => {
      summary.total += 1;
      if (execution.outcome === "failed") summary.failed += 1;
      if (execution.approval === "approval_required") summary.approvalRequired += 1;
      if (execution.approval === "review") summary.reviewGated += 1;
      if (isSupervisedTriageAction(execution)) summary.supervised += 1;
      if (execution.outcome === "succeeded" && execution.approval === "safe") summary.safeSucceeded += 1;
      return summary;
    },
    {
      total: 0,
      supervised: 0,
      failed: 0,
      approvalRequired: 0,
      reviewGated: 0,
      safeSucceeded: 0,
    },
  );
}

function sortExecutionsForSupervisedTriage(executions: RecentActionExecution[]) {
  return [...executions].sort((left, right) => {
    const leftPriority = isSupervisedTriageAction(left) ? 0 : 1;
    const rightPriority = isSupervisedTriageAction(right) ? 0 : 1;

    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return new Date(right.completed_at).getTime() - new Date(left.completed_at).getTime();
  });
}

export function RecentActionActivity({
  executions,
  error,
  className,
  label = "Assistant action activity",
  title = "Recent audited operator actions",
  description = "These rows come from assistant_action_executions, the same audit table used by report generation and other action-backed planner operations.",
  emptyDescription = "No assistant actions have been recorded for this workspace yet. The first packet generation, funding decision update, or project-record action will appear here after it writes an audit row.",
  prioritizeSupervisedActions = false,
  showNoWritePosture = false,
}: RecentActionActivityProps) {
  const triageSummary = buildActionTriageSummary(executions);
  const visibleExecutions = prioritizeSupervisedActions ? sortExecutionsForSupervisedTriage(executions) : executions;

  return (
    <article className={["module-section-surface", className].filter(Boolean).join(" ")}>
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">{label}</p>
          <h2 className="module-section-title">{title}</h2>
          <p className="module-section-description">{description}</p>
        </div>
        <StatusBadge tone={error ? "warning" : "info"}>
          {error ? "Audit read warning" : `${executions.length} recent`}
        </StatusBadge>
      </div>

      {error ? (
        <div className="module-note mt-4 border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-sm leading-relaxed">
              Action activity could not be loaded. Check assistant_action_executions RLS and workspace membership before
              treating the activity lane as complete.
            </p>
          </div>
        </div>
      ) : executions.length > 0 ? (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="module-subpanel">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Supervised action triage
              </p>
              <p className="mt-2 text-sm leading-relaxed text-foreground">
                Showing {triageSummary.supervised} supervised-review row{triageSummary.supervised === 1 ? "" : "s"} from {triageSummary.total} recent audit row{triageSummary.total === 1 ? "" : "s"}.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Failed {triageSummary.failed} · Approval required {triageSummary.approvalRequired} · Review gated {triageSummary.reviewGated} · Safe succeeded {triageSummary.safeSucceeded}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {prioritizeSupervisedActions
                  ? "Filter posture: failed, review-gated, and approval-required actions are sorted first; safe completed actions remain visible below for traceability."
                  : "Filter posture: rows stay in audit-log order; use failed, review, and approval labels to triage manually."}
              </p>
            </div>
            {showNoWritePosture ? (
              <div className="module-subpanel">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  No-write smoke posture
                </p>
                <p className="mt-2 text-sm leading-relaxed text-foreground">
                  This lane only reads assistant_action_executions. It does not replay actions, provision workspaces, send email, mutate access requests, or start deployments.
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-5 module-record-list">
            {visibleExecutions.map((execution) => {
              const inputSummary = summarizeInputSummary(execution.input_summary);
              const OutcomeIcon = execution.outcome === "succeeded" ? CheckCircle2 : TriangleAlert;
              return (
                <div key={execution.id} className="module-record-row">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={getOutcomeTone(execution.outcome)}>{execution.outcome}</StatusBadge>
                        <StatusBadge tone="neutral">{execution.approval}</StatusBadge>
                        <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {getTriageReason(execution)}
                        </span>
                        <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {formatActionTimestamp(execution.completed_at)}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{formatActionKind(execution.action_kind)}</h3>
                          <code className="rounded border border-border/70 bg-muted/15 px-2 py-1 text-[0.72rem] text-foreground/80">
                            {execution.audit_event}
                          </code>
                        </div>
                        <p className="module-record-summary">
                          {execution.error_message
                            ? `Failed with: ${execution.error_message}`
                            : inputSummary ?? "Action completed without additional input summary."}
                        </p>
                      </div>
                    </div>
                    <div className="module-record-actions">
                      <OutcomeIcon
                        className={[
                          "h-4 w-4",
                          execution.outcome === "succeeded" ? "text-emerald-700" : "text-red-700",
                        ].join(" ")}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="module-note mt-4 text-sm leading-relaxed text-muted-foreground">{emptyDescription}</div>
      )}
    </article>
  );
}
