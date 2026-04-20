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

export function RecentActionActivity({
  executions,
  error,
  className,
  label = "Assistant action activity",
  title = "Recent audited operator actions",
  description = "These rows come from assistant_action_executions, the same audit table used by report generation and other action-backed planner operations.",
  emptyDescription = "No assistant actions have been recorded for this workspace yet. The first packet generation, funding decision update, or project-record action will appear here after it writes an audit row.",
}: RecentActionActivityProps) {
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
        <div className="mt-5 module-record-list">
          {executions.map((execution) => {
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
                        {formatActionTimestamp(execution.completed_at)}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{formatActionKind(execution.action_kind)}</h3>
                        <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[0.72rem] text-slate-700">
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
      ) : (
        <div className="module-note mt-4 text-sm leading-relaxed text-muted-foreground">{emptyDescription}</div>
      )}
    </article>
  );
}
