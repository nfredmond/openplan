import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ActionApproval,
  type RegroundingMode,
  getActionMetadata,
} from "@/lib/runtime/action-metadata";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";
import { USER_AUTHORED, type AssistantActionAuthorship } from "@/lib/assistant/agent-principal";

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
  /**
   * Who AUTHORED the action, and who approved it — distinct from `userId`, which
   * is the session the write executed under. Defaults to user-authored so an
   * existing manual write path keeps recording the truth about itself.
   */
  authorship?: AssistantActionAuthorship;
  startedAt: string;
  completedAt: string;
};

export type AssistantActionAuditSupabaseLike = Pick<SupabaseClient, "from">;

/**
 * Does this write error mean the deployment has not applied 20260730000006 yet?
 *
 * PostgREST answers an unknown column with PGRST204 and a schema-cache message;
 * a direct Postgres error is 42703. Both name the column, so the match is on the
 * authorship columns specifically — a genuine constraint or permission failure
 * must never be mistaken for a pending migration and silently downgraded.
 */
function looksLikePendingAuthorshipColumns(error: { message?: string; code?: string | null } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  const namesAuthorshipColumn = /actor_kind|actor_agent_id|approved_by_user_id|approved_at/.test(message);
  if (!namesAuthorshipColumn) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /does not exist|schema cache|could not find/i.test(message)
  );
}

export async function recordAssistantActionExecution(
  supabase: AssistantActionAuditSupabaseLike,
  input: AssistantActionExecutionAuditInput
): Promise<{ error: { message: string; code?: string | null } | null }> {
  const authorship = input.authorship ?? USER_AUTHORED;
  const core = {
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
  };

  const { error } = await supabase.from("assistant_action_executions").insert({
    ...core,
    actor_kind: authorship.actorKind,
    actor_agent_id: authorship.actorAgentId,
    approved_by_user_id: authorship.approvedByUserId,
    approved_at: authorship.approvedAt,
  });

  /**
   * A deployment sitting between this code and its migration would otherwise
   * write NO ledger row at all — the insert names four columns the table does
   * not have, and the only consequence today is a console warning. Losing the
   * audit trail silently is worse than losing the authorship on it, and the read
   * side already reports `authorshipAvailable: false` for exactly this window.
   * So the row is written without authorship rather than not written.
   */
  if (looksLikePendingAuthorshipColumns(error)) {
    const fallback = await supabase.from("assistant_action_executions").insert(core);
    if (!fallback.error) {
      console.warn("[action-audit] authorship columns are missing; row written without them", {
        actionKind: input.actionKind,
        migration: "20260730000006_assistant_action_agent_principal",
      });
      return { error: null };
    }
    return { error: { message: fallback.error.message, code: fallback.error.code ?? null } };
  }

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
  authorship?: AssistantActionAuthorship;
};

/**
 * The identity half of an audit row, in one spread.
 *
 * Routes used to hand-thread `approvalId`/`inputHash`/`executionSource` one
 * field at a time. Adding authorship would have made that four more fields per
 * route to remember, and the failure mode of forgetting one is silent: the row
 * still writes, it just records an agent-authored change under a person's name.
 * Taking the whole verification and returning the whole identity removes the
 * opportunity.
 */
export function assistantActionAuditIdentity(verification: {
  approvalId: string | null;
  inputHash: string | null;
  executionSource: "manual" | "planner_agent_quick_link";
  authorship: AssistantActionAuthorship;
}): Pick<
  WithAssistantActionAuditMeta,
  "approvalId" | "inputHash" | "executionSource" | "authorship"
> {
  return {
    approvalId: verification.approvalId,
    inputHash: verification.inputHash,
    executionSource: verification.executionSource,
    authorship: verification.authorship,
  };
}

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
      authorship: meta.authorship,
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
      authorship: meta.authorship,
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
