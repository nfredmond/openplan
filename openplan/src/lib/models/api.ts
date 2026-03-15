import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";

type QueryError = {
  message: string;
  code?: string | null;
} | null;

type MembershipRow = {
  workspace_id: string;
  role: string;
};

type ModelRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  scenario_set_id: string | null;
  title?: string | null;
  model_family?: string | null;
  status?: string | null;
  config_version?: string | null;
  owner_label?: string | null;
  horizon_label?: string | null;
  assumptions_summary?: string | null;
  input_summary?: string | null;
  output_summary?: string | null;
  summary?: string | null;
  config_json?: Record<string, unknown> | null;
  last_validated_at?: string | null;
  last_run_recorded_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type QueryEqBuilder<T> = {
  eq: (column: string, value: string) => QueryEqBuilder<T>;
  maybeSingle: () => PromiseLike<{ data: T | null; error: QueryError }>;
};

type QueryClientLike = {
  from: (table: string) => {
    select: (columns: string) => QueryEqBuilder<unknown>;
  };
};

function asQueryClient(value: unknown): QueryClientLike {
  return value as QueryClientLike;
}

export async function loadModelAccess(
  supabase: unknown,
  modelId: string,
  userId: string,
  action: "models.read" | "models.write"
) {
  const client = asQueryClient(supabase);
  const { data: model, error: modelError } = (await client
    .from("models")
    .select(
      "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, horizon_label, assumptions_summary, input_summary, output_summary, summary, config_json, last_validated_at, last_run_recorded_at, created_at, updated_at"
    )
    .eq("id", modelId)
    .maybeSingle()) as Awaited<{ data: ModelRow | null; error: QueryError }>;

  if (modelError) {
    return { supabase, model: null, membership: null, error: modelError };
  }

  if (!model) {
    return { supabase, model: null, membership: null, error: null };
  }

  const { data: membership, error: membershipError } = (await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", model.workspace_id)
    .eq("user_id", userId)
    .maybeSingle()) as Awaited<{ data: MembershipRow | null; error: QueryError }>;

  if (membershipError) {
    return { supabase, model, membership: null, error: membershipError };
  }

  return {
    supabase,
    model,
    membership,
    error: null,
    allowed: Boolean(membership && canAccessWorkspaceAction(action, membership.role)),
  };
}
