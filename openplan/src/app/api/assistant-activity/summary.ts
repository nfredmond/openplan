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
  /** Who AUTHORED the action — distinct from `user_id`, the session it ran under. */
  actor_kind: string | null;
  actor_agent_id: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  started_at: string;
  completed_at: string;
};

/**
 * The columns that exist on every deployment, migrated or not.
 *
 * PostgREST fails the WHOLE query when a select names a column the table does
 * not have, so a deployment sitting between a deploy and 20260730000006 would
 * get an empty audit ledger — a screen that says "no Planner Agent actions yet"
 * about a workspace that has plenty. Blank is the one answer this page may never
 * give, so the authorship columns are requested separately and fall back.
 */
export const ASSISTANT_ACTIVITY_SELECT_CORE =
  "id, workspace_id, user_id, action_kind, audit_event, approval, regrounding, outcome, error_message, input_summary, input_hash, approval_id, execution_source, started_at, completed_at";

export const ASSISTANT_ACTIVITY_AUTHORSHIP_COLUMNS =
  "actor_kind, actor_agent_id, approved_by_user_id, approved_at";

export const ASSISTANT_ACTIVITY_SELECT = `${ASSISTANT_ACTIVITY_SELECT_CORE}, ${ASSISTANT_ACTIVITY_AUTHORSHIP_COLUMNS}`;

type AssistantActivityReadResult = {
  data: AssistantActionExecutionRow[] | null;
  error: { message: string; code?: string | null } | null;
  /** False when the deployment predates 20260730000006 and authorship is unavailable. */
  authorshipAvailable: boolean;
};

/**
 * Structurally typed rather than `SupabaseClient`: the Supabase clients in this
 * codebase are deliberately untyped (see CLAUDE.md), and threading the real
 * client type through a builder chain here blows the instantiation depth limit.
 */
type AssistantActivitySupabaseLike = {
  from(table: string): unknown;
};

type AssistantActivityQueryChain = {
  select(columns: string): {
    eq(
      column: string,
      value: unknown
    ): {
      order(
        column: string,
        options: { ascending: boolean }
      ): {
        limit(count: number): PromiseLike<{
          data: unknown;
          error: { message: string; code?: string | null } | null;
        }>;
      };
    };
  };
};

/**
 * Read the ledger, degrading HONESTLY when the authorship columns are not there
 * yet: the rows still come back, and `authorshipAvailable` says the ledger
 * cannot answer "who wrote this" on this deployment — which a surface must show
 * rather than defaulting the rows to "a person did it".
 */
export async function loadAssistantActivityRows(
  supabase: AssistantActivitySupabaseLike,
  params: { workspaceId: string; limit: number }
): Promise<AssistantActivityReadResult> {
  const table = supabase.from("assistant_action_executions") as AssistantActivityQueryChain;
  const query = (columns: string) =>
    table
      .select(columns)
      .eq("workspace_id", params.workspaceId)
      .order("completed_at", { ascending: false })
      .limit(params.limit);

  const full = await query(ASSISTANT_ACTIVITY_SELECT);
  if (!full.error) {
    return {
      data: (full.data ?? []) as AssistantActionExecutionRow[],
      error: null,
      authorshipAvailable: true,
    };
  }

  const core = await query(ASSISTANT_ACTIVITY_SELECT_CORE);
  if (core.error) {
    // Both reads failed, so this is a real failure and not a pending migration.
    // Report the FULL read's error: it is the one describing the query the app
    // actually intends to run.
    return { data: null, error: full.error, authorshipAvailable: false };
  }

  return {
    data: (core.data ?? []) as AssistantActionExecutionRow[],
    error: null,
    authorshipAvailable: false,
  };
}

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
