import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ActionApproval,
  type RegroundingMode,
  getActionMetadata,
} from "@/lib/runtime/action-metadata";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";

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
  approvalId?: string | null;
  inputHash?: string | null;
  executionSource?: "manual" | "planner_agent_quick_link";
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
    approval_id: input.approvalId ?? null,
    input_hash: input.inputHash ?? null,
    execution_source: input.executionSource ?? "manual",
    started_at: input.startedAt,
    completed_at: input.completedAt,
  });

  return {
    error: error
      ? { message: error.message, code: error.code ?? null }
      : null,
  };
}

export type WithAssistantActionAuditMeta = {
  actionKind: AssistantQuickLinkExecuteAction["kind"];
  workspaceId: string | null;
  userId: string | null;
  inputSummary?: Record<string, unknown> | null;
  approvalId?: string | null;
  inputHash?: string | null;
  executionSource?: "manual" | "planner_agent_quick_link";
};

/**
 * Wraps a server-side action body with per-action audit persistence.
 * Looks up the ActionRecord in the registry to attach auditEvent/approval/
 * regrounding, then writes one assistant_action_executions row on success
 * and one on failure (re-throwing the original error after logging).
 *
 * Audit insert failures never mask business-logic results. If the row write
 * itself fails, a warning is logged via console.warn and the original body
 * result / error is preserved.
 */
export async function withAssistantActionAudit<T>(
  supabase: AssistantActionAuditSupabaseLike,
  meta: WithAssistantActionAuditMeta,
  body: () => Promise<T>
): Promise<T> {
  const record = getActionMetadata(meta.actionKind);
  const startedAt = new Date().toISOString();

  try {
    const result = await body();
    const completedAt = new Date().toISOString();
    const { error } = await recordAssistantActionExecution(supabase, {
      workspaceId: meta.workspaceId,
      userId: meta.userId,
      actionKind: meta.actionKind,
      auditEvent: record.auditEvent,
      approval: record.approval,
      regrounding: record.regrounding,
      outcome: "succeeded",
      inputSummary: meta.inputSummary ?? null,
      approvalId: meta.approvalId ?? null,
      inputHash: meta.inputHash ?? null,
      executionSource: meta.executionSource ?? "manual",
      startedAt,
      completedAt,
    });
    if (error) {
      console.warn("[action-audit] succeeded-row insert failed", {
        actionKind: meta.actionKind,
        message: error.message,
        code: error.code,
      });
    }
    return result;
  } catch (err) {
    const completedAt = new Date().toISOString();
    const errorMessage = err instanceof Error ? err.message : String(err);
    const { error } = await recordAssistantActionExecution(supabase, {
      workspaceId: meta.workspaceId,
      userId: meta.userId,
      actionKind: meta.actionKind,
      auditEvent: record.auditEvent,
      approval: record.approval,
      regrounding: record.regrounding,
      outcome: "failed",
      errorMessage,
      inputSummary: meta.inputSummary ?? null,
      approvalId: meta.approvalId ?? null,
      inputHash: meta.inputHash ?? null,
      executionSource: meta.executionSource ?? "manual",
      startedAt,
      completedAt,
    });
    if (error) {
      console.warn("[action-audit] failed-row insert failed", {
        actionKind: meta.actionKind,
        message: error.message,
        code: error.code,
      });
    }
    throw err;
  }
}
