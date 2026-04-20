import { redirect } from "next/navigation";
import {
  Activity,
  CheckCircle2,
  Search,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  operationalWarningEvents,
  summarizeOperationalWarnings,
  type OperationalWarningEvent,
} from "@/lib/observability/operational-events";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

export const metadata = {
  title: "Operational Warnings | OpenPlan Admin",
};

type RecentActionExecution = {
  id: string;
  action_kind: string;
  audit_event: string;
  approval: "safe" | "review" | "approval_required";
  regrounding: "refresh_preview" | "none";
  outcome: "succeeded" | "failed";
  error_message: string | null;
  input_summary: Record<string, unknown> | null;
  started_at: string;
  completed_at: string;
};

function getSeverityTone(severity: OperationalWarningEvent["severity"]) {
  if (severity === "urgent") return "danger" as const;
  if (severity === "investigate") return "warning" as const;
  return "info" as const;
}

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

export default async function AdminOperationsPage() {
  const summary = summarizeOperationalWarnings();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?next=/admin/operations");
  }

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);
  const workspaceId = membership?.workspace_id ?? null;
  const actionExecutionsResult = workspaceId
    ? await supabase
        .from("assistant_action_executions")
        .select(
          "id, action_kind, audit_event, approval, regrounding, outcome, error_message, input_summary, started_at, completed_at"
        )
        .eq("workspace_id", workspaceId)
        .order("completed_at", { ascending: false })
        .limit(8)
    : { data: [], error: null };

  const actionExecutions = (actionExecutionsResult.data ?? []) as RecentActionExecution[];
  const actionExecutionsError = actionExecutionsResult.error;

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Activity className="h-3.5 w-3.5" />
            Operational telemetry
          </div>
          <div className="module-intro-body">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">Observation live</StatusBadge>
              <StatusBadge tone="neutral">Log-backed</StatusBadge>
              {workspace ? <StatusBadge tone="neutral">{workspace.name}</StatusBadge> : null}
            </div>
            <h1 className="module-intro-title">Warning watchboard</h1>
            <p className="module-intro-description">
              Use these warning events and action-audit rows to review request pressure, CSP report-only noise, AI
              cost outliers, and operator-fired actions while the pilot remains supervised.
            </p>
          </div>

          <div className="module-summary-grid cols-4">
            <div className="module-summary-card">
              <p className="module-summary-label">Tracked warnings</p>
              <p className="module-summary-value">{summary.totalEvents}</p>
              <p className="module-summary-detail">Events with route, threshold, and response guidance.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Investigate</p>
              <p className="module-summary-value">{summary.investigateEvents}</p>
              <p className="module-summary-detail">Warnings that should be grouped by route and source when they spike.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Watch</p>
              <p className="module-summary-value">{summary.watchEvents}</p>
              <p className="module-summary-detail">Observation-only signals that should build a baseline before enforcement.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Urgent</p>
              <p className="module-summary-value">{summary.urgentEvents}</p>
              <p className="module-summary-detail">No current warning class is configured as urgent by default.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <Search className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Combined query</p>
              <h2 className="module-operator-title">Start with the warning event names</h2>
            </div>
          </div>
          <p className="module-operator-copy break-words">{summary.combinedLogQuery}</p>
          <div className="module-operator-list">
            <div className="module-operator-item">Group oversized-body events by route, client IP, and user agent.</div>
            <div className="module-operator-item">Treat AI cost warnings as observation-only until real pilot usage sets a baseline.</div>
            <div className="module-operator-item">Keep CSP in report-only mode until recurring blocked URI patterns are understood.</div>
          </div>
        </article>
      </header>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Assistant action activity</p>
            <h2 className="module-section-title">Recent audited operator actions</h2>
            <p className="module-section-description">
              These rows come from `assistant_action_executions`, the same audit table used by report generation and
              other action-backed planner operations.
            </p>
          </div>
          <StatusBadge tone={actionExecutionsError ? "warning" : "info"}>
            {actionExecutionsError ? "Audit read warning" : `${actionExecutions.length} recent`}
          </StatusBadge>
        </div>

        {actionExecutionsError ? (
          <div className="module-note mt-4 border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm leading-relaxed">
                Action activity could not be loaded. Check `assistant_action_executions` RLS and workspace membership
                before treating the activity lane as complete.
              </p>
            </div>
          </div>
        ) : actionExecutions.length > 0 ? (
          <div className="mt-5 module-record-list">
            {actionExecutions.map((execution) => {
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
          <div className="module-note mt-4 text-sm leading-relaxed text-muted-foreground">
            No assistant actions have been recorded for this workspace yet. The first packet generation, funding
            decision update, or project-record action will appear here after it writes an audit row.
          </div>
        )}
      </article>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Warning catalog</p>
            <h2 className="module-section-title">Log events to review during pilot operations</h2>
            <p className="module-section-description">
              Each row names the event, where it comes from, when to pay attention, and the first response.
            </p>
          </div>
          <StatusBadge tone="info">No blocking controls</StatusBadge>
        </div>

        <div className="mt-5 module-record-list">
          {operationalWarningEvents.map((event) => (
            <div key={event.event} className="module-record-row">
              <div className="module-record-head">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={getSeverityTone(event.severity)}>{event.severity}</StatusBadge>
                    <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {event.source}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{event.label}</h3>
                      <code className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[0.72rem] text-slate-700">
                        {event.event}
                      </code>
                    </div>
                    <p className="module-record-summary">{event.threshold}</p>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                <div className="module-subpanel">
                  <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-foreground">
                    <Search className="h-3.5 w-3.5 text-emerald-700" />
                    Log query
                  </div>
                  <p className="mt-2 break-words text-[0.76rem] text-muted-foreground">{event.logQuery}</p>
                </div>
                <div className="module-subpanel">
                  <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-foreground">
                    <ShieldAlert className="h-3.5 w-3.5 text-emerald-700" />
                    First response
                  </div>
                  <p className="mt-2 text-[0.76rem] leading-relaxed text-muted-foreground">{event.response}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
