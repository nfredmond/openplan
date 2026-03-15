import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";

type QueryError = {
  message: string;
  code?: string | null;
} | null;

type MembershipRow = {
  workspace_id: string;
  role: string;
};

type PlanRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title?: string | null;
  plan_type?: string | null;
  status?: string | null;
  geography_label?: string | null;
  horizon_year?: number | null;
  summary?: string | null;
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

export async function loadPlanAccess(
  supabase: unknown,
  planId: string,
  userId: string,
  action: "plans.read" | "plans.write"
) {
  const client = asQueryClient(supabase);
  const { data: plan, error: planError } = (await client
    .from("plans")
    .select("id, workspace_id, project_id, title, plan_type, status, geography_label, horizon_year, summary, created_at, updated_at")
    .eq("id", planId)
    .maybeSingle()) as Awaited<{ data: PlanRow | null; error: QueryError }>;

  if (planError) {
    return { supabase, plan: null, membership: null, error: planError };
  }

  if (!plan) {
    return { supabase, plan: null, membership: null, error: null };
  }

  const { data: membership, error: membershipError } = (await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", plan.workspace_id)
    .eq("user_id", userId)
    .maybeSingle()) as Awaited<{ data: MembershipRow | null; error: QueryError }>;

  if (membershipError) {
    return { supabase, plan, membership: null, error: membershipError };
  }

  return {
    supabase,
    plan,
    membership,
    error: null,
    allowed: Boolean(membership && canAccessWorkspaceAction(action, membership.role)),
  };
}
