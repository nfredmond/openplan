type RecentActionActivityQueryResult = {
  data: unknown[] | null;
  error?: { message?: string } | null;
};

type RecentActionActivityPostEqChain = {
  order: (column: string, options: { ascending: boolean }) => {
    limit: (count: number) => PromiseLike<RecentActionActivityQueryResult>;
  };
};

type RecentActionActivitySelectChain = {
  eq: (column: string, value: string) => RecentActionActivityPostEqChain;
};

export type RecentActionActivitySupabaseLike = {
  from: (table: string) => {
    select: (query: string) => RecentActionActivitySelectChain;
  };
};

export type RecentActionExecution = {
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

export type RecentActionActivityResult = {
  executions: RecentActionExecution[];
  error: { message?: string } | null;
};

const RECENT_ACTION_ACTIVITY_SELECT =
  "id, action_kind, audit_event, approval, regrounding, outcome, error_message, input_summary, started_at, completed_at";

export async function loadRecentActionExecutionsForWorkspace(
  supabase: RecentActionActivitySupabaseLike,
  workspaceId: string,
  limit = 8
): Promise<RecentActionActivityResult> {
  const result = await supabase
    .from("assistant_action_executions")
    .select(RECENT_ACTION_ACTIVITY_SELECT)
    .eq("workspace_id", workspaceId)
    .order("completed_at", { ascending: false })
    .limit(limit);

  return {
    executions: (result.data ?? []) as RecentActionExecution[],
    error: result.error ?? null,
  };
}
