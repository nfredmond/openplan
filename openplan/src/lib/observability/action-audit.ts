import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionApproval, RegroundingMode } from "@/lib/runtime/action-registry";

export type AssistantActionExecutionOutcome = "succeeded" | "failed";

export type AssistantActionExecutionAuditInput = {
  workspaceId: string | null;
  userId: string | null;
  actionKind: string;
  auditEvent: string;
  approval: ActionApproval;
  regrounding: RegroundingMode;
  outcome: AssistantActionExecutionOutcome;
  errorMessage?: string | null;
  inputSummary?: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string;
};

export type AssistantActionAuditSupabaseLike = Pick<SupabaseClient, "from">;

export async function recordAssistantActionExecution(
  supabase: AssistantActionAuditSupabaseLike,
  input: AssistantActionExecutionAuditInput
): Promise<{ error: { message: string; code?: string | null } | null }> {
  const { error } = await supabase.from("assistant_action_executions").insert({
    workspace_id: input.workspaceId,
    user_id: input.userId,
    action_kind: input.actionKind,
    audit_event: input.auditEvent,
    approval: input.approval,
    regrounding: input.regrounding,
    outcome: input.outcome,
    error_message: input.errorMessage ?? null,
    input_summary: input.inputSummary ?? null,
    started_at: input.startedAt,
    completed_at: input.completedAt,
  });

  return {
    error: error
      ? { message: error.message, code: error.code ?? null }
      : null,
  };
}
