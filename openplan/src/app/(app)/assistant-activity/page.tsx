import { redirect } from "next/navigation";
import { Activity, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, ErrorState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import type { StatusTone } from "@/lib/ui/status";
import {
  ASSISTANT_ACTIVITY_SELECT,
  buildAssistantActivitySummary,
  type AssistantActionExecutionRow,
} from "@/app/api/assistant-activity/summary";

const ACTIVITY_LIMIT = 50;

const ACTION_KIND_LABELS: Record<string, string> = {
  generate_report_artifact: "Generate report artifact",
  create_rtp_packet_record: "Create RTP packet record",
  create_funding_opportunity: "Create funding opportunity",
  create_project_funding_profile: "Create project funding profile",
  update_funding_opportunity_decision: "Update funding opportunity decision",
  link_billing_invoice_funding_award: "Link billing invoice to funding award",
  create_project_record: "Create project record",
};

const APPROVAL_PRESENTATION: Record<
  AssistantActionExecutionRow["approval"],
  { label: string; tone: StatusTone }
> = {
  safe: { label: "Safe", tone: "neutral" },
  review: { label: "Review", tone: "info" },
  approval_required: { label: "Approval required", tone: "warning" },
};

function formatActionKindLabel(actionKind: string) {
  const known = ACTION_KIND_LABELS[actionKind];
  if (known) return known;

  const humanized = actionKind.split("_").filter(Boolean).join(" ");
  return humanized.length > 0 ? humanized.slice(0, 1).toUpperCase() + humanized.slice(1) : actionKind;
}

function formatExecutionTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatInputHash(inputHash: string | null) {
  if (!inputHash) return "not recorded";
  return inputHash.length > 12 ? `${inputHash.slice(0, 12)}…` : inputHash;
}

export default async function AssistantActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Planner Agent activity"
        title="Planner Agent activity needs a provisioned workspace"
        description="The Planner Agent audit trail is workspace-scoped. You are signed in, but no workspace membership was found for this account, so there is no action ledger to show yet."
      />
    );
  }

  const workspaceName = workspace.name ?? "Planning Workspace";

  const { data: executionsData, error: executionsError } = await supabase
    .from("assistant_action_executions")
    .select(ASSISTANT_ACTIVITY_SELECT)
    .eq("workspace_id", membership.workspace_id)
    .order("completed_at", { ascending: false })
    .limit(ACTIVITY_LIMIT);

  const executions = (executionsData ?? []) as AssistantActionExecutionRow[];
  const summary = buildAssistantActivitySummary(executions);

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Activity className="h-3.5 w-3.5" />
            Action audit ledger
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Planner Agent activity</h1>
            <p className="module-intro-description">
              Every action the Planner Agent executes in this workspace is written to a per-execution audit
              ledger — successes and failures alike — so operators can answer who fired what, when, and with
              what outcome.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Actions recorded</p>
              <p className="module-summary-value">{summary.total}</p>
              <p className="module-summary-detail">Most recent {ACTIVITY_LIMIT} audit rows for {workspaceName}.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Approval-gated</p>
              <p className="module-summary-value">{summary.approvalGated}</p>
              <p className="module-summary-detail">Executed only after a single-use operator approval.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Failed</p>
              <p className="module-summary-value">{summary.failed}</p>
              <p className="module-summary-detail">Failures are audited with the same rigor as successes.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">AI governance</p>
              <h2 className="module-operator-title">Hash-verified, single-use approvals</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            The Planner Agent cannot take an approval-gated action silently. Each approval is bound to a
            server-computed input hash, expires on a timer, and is consumed on first use.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Every execution writes one audit row — success or failure.</div>
            <div className="module-operator-item">Approval-gated actions verify the input hash before running.</div>
            <div className="module-operator-item">Reads are RLS-scoped to workspace members only.</div>
          </div>
        </article>
      </header>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Audit trail</p>
            <h2 className="module-section-title">Executed actions in this workspace</h2>
            <p className="module-section-description">
              {summary.total} action{summary.total === 1 ? "" : "s"} · {summary.approvalGated} approval-gated ·{" "}
              {summary.failed} failed
            </p>
          </div>
          <StatusBadge tone={executionsError ? "warning" : "info"}>
            {executionsError ? "Audit read warning" : `${summary.total} recorded`}
          </StatusBadge>
        </div>

        <p className="module-note mt-4 text-sm leading-relaxed text-muted-foreground">
          Every Planner Agent action is recorded here with a server-computed input hash of exactly what was
          executed. Approval-gated actions additionally require a single-use, time-limited operator approval
          that is verified against that hash before the action runs.
        </p>

        {executionsError ? (
          <div className="mt-5">
            <ErrorState
              title="Action activity could not be loaded"
              description="The assistant_action_executions read failed. Check workspace membership and RLS before treating this ledger as complete."
            />
          </div>
        ) : executions.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="No Planner Agent actions yet"
              description="Actions executed from the copilot will appear here as audit rows — including the input hash, approval class, and outcome — as soon as the first one runs."
            />
          </div>
        ) : (
          <div className="mt-5 module-record-list">
            {executions.map((execution) => {
              const approval = APPROVAL_PRESENTATION[execution.approval] ?? {
                label: execution.approval,
                tone: "neutral" as StatusTone,
              };

              return (
                <div key={execution.id} className="module-record-row">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={execution.outcome === "succeeded" ? "success" : "danger"}>
                          {execution.outcome === "succeeded" ? "Succeeded" : "Failed"}
                        </StatusBadge>
                        <StatusBadge tone={approval.tone}>{approval.label}</StatusBadge>
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{formatActionKindLabel(execution.action_kind)}</h3>
                          <p className="module-record-stamp shrink-0">
                            {formatExecutionTimestamp(execution.completed_at)}
                          </p>
                        </div>
                        <p className="text-[0.73rem] text-muted-foreground">
                          {workspaceName}
                          {" · input hash "}
                          <code className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 text-[0.7rem]">
                            {formatInputHash(execution.input_hash)}
                          </code>
                          {execution.execution_source ? ` · ${execution.execution_source}` : ""}
                        </p>
                        {execution.outcome === "failed" && execution.error_message ? (
                          <p className="text-[0.73rem] text-destructive">Failed with: {execution.error_message}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
