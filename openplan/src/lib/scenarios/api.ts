import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";

type QueryError = {
  message: string;
  code?: string | null;
} | null;

type ProjectRow = {
  id: string;
  workspace_id: string;
  name?: string | null;
  summary?: string | null;
  status?: string | null;
  plan_type?: string | null;
  delivery_phase?: string | null;
  updated_at?: string | null;
};

type ScenarioSetRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  title?: string | null;
  summary?: string | null;
  planning_question?: string | null;
  status?: string | null;
  baseline_entry_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type MembershipRow = {
  workspace_id: string;
  role: string;
};

type RunRow = {
  id: string;
  workspace_id: string;
  title?: string | null;
  summary_text?: string | null;
  created_at?: string | null;
};

type MaybeSingleResult<T> = PromiseLike<{
  data: T | null;
  error: QueryError;
}>;

type QueryEqBuilder<T> = {
  eq: (column: string, value: string) => QueryEqBuilder<T>;
  maybeSingle: () => MaybeSingleResult<T>;
};

type QueryClientLike = {
  from: (table: string) => {
    select: (columns: string) => QueryEqBuilder<unknown>;
  };
};

function asQueryClient(value: unknown): QueryClientLike {
  return value as QueryClientLike;
}

export async function loadProjectAccess(
  supabase: unknown,
  projectId: string,
  userId: string,
  action: "scenarios.read" | "scenarios.write"
) {
  const client = asQueryClient(supabase);
  const { data: project, error: projectError } = (await client
    .from("projects")
    .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
    .eq("id", projectId)
    .maybeSingle()) as Awaited<{ data: ProjectRow | null; error: QueryError }>;

  if (projectError) {
    return { project: null, membership: null, error: projectError };
  }

  if (!project) {
    return { project: null, membership: null, error: null };
  }

  const { data: membership, error: membershipError } = (await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", project.workspace_id)
    .eq("user_id", userId)
    .maybeSingle()) as Awaited<{ data: MembershipRow | null; error: QueryError }>;

  if (membershipError) {
    return { project, membership: null, error: membershipError };
  }

  return {
    project,
    membership,
    error: null,
    allowed: Boolean(membership && canAccessWorkspaceAction(action, membership.role)),
  };
}

export async function loadScenarioSetAccess(
  supabase: unknown,
  scenarioSetId: string,
  userId: string,
  action: "scenarios.read" | "scenarios.write"
) {
  const client = asQueryClient(supabase);
  const { data: scenarioSet, error: scenarioSetError } = (await client
    .from("scenario_sets")
    .select("id, workspace_id, project_id, title, summary, planning_question, status, baseline_entry_id, created_at, updated_at")
    .eq("id", scenarioSetId)
    .maybeSingle()) as Awaited<{ data: ScenarioSetRow | null; error: QueryError }>;

  if (scenarioSetError) {
    return { scenarioSet: null, membership: null, error: scenarioSetError };
  }

  if (!scenarioSet) {
    return { scenarioSet: null, membership: null, error: null };
  }

  const { data: membership, error: membershipError } = (await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", scenarioSet.workspace_id)
    .eq("user_id", userId)
    .maybeSingle()) as Awaited<{ data: MembershipRow | null; error: QueryError }>;

  if (membershipError) {
    return { scenarioSet, membership: null, error: membershipError };
  }

  return {
    scenarioSet,
    membership,
    error: null,
    allowed: Boolean(membership && canAccessWorkspaceAction(action, membership.role)),
  };
}

export async function validateRunAccess(
  supabase: unknown,
  workspaceId: string,
  runId: string | null | undefined
) {
  if (!runId) {
    return { run: null, error: null };
  }

  const client = asQueryClient(supabase);
  const { data: run, error } = (await client
    .from("runs")
    .select("id, workspace_id, title, summary_text, created_at")
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .maybeSingle()) as Awaited<{ data: RunRow | null; error: QueryError }>;

  return { run, error };
}
