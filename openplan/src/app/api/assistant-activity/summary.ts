export type AssistantActionExecutionRow = {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  action_kind: string;
  audit_event: string;
  approval: "safe" | "review" | "approval_required";
  regrounding: "refresh_preview" | "none";
  outcome: "succeeded" | "failed";
  error_message: string | null;
  input_summary: Record<string, unknown> | null;
  input_hash: string | null;
  approval_id: string | null;
  execution_source: string | null;
  started_at: string;
  completed_at: string;
};

export const ASSISTANT_ACTIVITY_SELECT =
  "id, workspace_id, user_id, action_kind, audit_event, approval, regrounding, outcome, error_message, input_summary, input_hash, approval_id, execution_source, started_at, completed_at";

export type AssistantActivitySummary = {
  total: number;
  byOutcome: Record<string, number>;
  byActionKind: Record<string, number>;
  approvalGated: number;
  failed: number;
};

export function buildAssistantActivitySummary(
  executions: Pick<AssistantActionExecutionRow, "action_kind" | "approval" | "outcome">[]
): AssistantActivitySummary {
  return executions.reduce<AssistantActivitySummary>(
    (summary, execution) => {
      summary.total += 1;
      summary.byOutcome[execution.outcome] = (summary.byOutcome[execution.outcome] ?? 0) + 1;
      summary.byActionKind[execution.action_kind] = (summary.byActionKind[execution.action_kind] ?? 0) + 1;
      if (execution.approval === "approval_required") summary.approvalGated += 1;
      if (execution.outcome === "failed") summary.failed += 1;
      return summary;
    },
    { total: 0, byOutcome: {}, byActionKind: {}, approvalGated: 0, failed: 0 }
  );
}
