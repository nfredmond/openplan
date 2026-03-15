import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";

type QueryError = {
  message: string;
  code?: string | null;
} | null;

type MembershipRow = {
  workspace_id: string;
  role: string;
};

type ProjectRow = {
  id: string;
  workspace_id: string;
  name?: string | null;
};

type CampaignRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  engagement_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CategoryRow = {
  id: string;
  campaign_id: string;
  label?: string | null;
};

type RunEqBuilder<T> = {
  eq: (column: string, value: string) => RunEqBuilder<T>;
  maybeSingle: () => PromiseLike<{ data: T | null; error: QueryError }>;
};

type QueryClientLike = {
  from: (table: string) => {
    select: (columns: string) => RunEqBuilder<unknown>;
  };
};

function asQueryClient(value: unknown): QueryClientLike {
  return value as QueryClientLike;
}

export async function loadProjectAccess(
  supabase: unknown,
  projectId: string,
  userId: string,
  action: "engagement.read" | "engagement.write"
) {
  const client = asQueryClient(supabase);
  const { data: project, error: projectError } = (await client
    .from("projects")
    .select("id, workspace_id, name")
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

export async function loadCampaignAccess(
  supabase: unknown,
  campaignId: string,
  userId: string,
  action: "engagement.read" | "engagement.write"
) {
  const client = asQueryClient(supabase);
  const { data: campaign, error: campaignError } = (await client
    .from("engagement_campaigns")
    .select("id, workspace_id, project_id, title, summary, status, engagement_type, created_at, updated_at")
    .eq("id", campaignId)
    .maybeSingle()) as Awaited<{ data: CampaignRow | null; error: QueryError }>;

  if (campaignError) {
    return { campaign: null, membership: null, error: campaignError };
  }

  if (!campaign) {
    return { campaign: null, membership: null, error: null };
  }

  const { data: membership, error: membershipError } = (await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", campaign.workspace_id)
    .eq("user_id", userId)
    .maybeSingle()) as Awaited<{ data: MembershipRow | null; error: QueryError }>;

  if (membershipError) {
    return { campaign, membership: null, error: membershipError };
  }

  return {
    campaign,
    membership,
    error: null,
    allowed: Boolean(membership && canAccessWorkspaceAction(action, membership.role)),
  };
}

export async function validateCampaignCategoryAccess(
  supabase: unknown,
  campaignId: string,
  categoryId: string | null | undefined
) {
  if (!categoryId) {
    return { category: null, error: null };
  }

  const client = asQueryClient(supabase);
  const { data: category, error } = (await client
    .from("engagement_categories")
    .select("id, campaign_id, label")
    .eq("campaign_id", campaignId)
    .eq("id", categoryId)
    .maybeSingle()) as Awaited<{ data: CategoryRow | null; error: QueryError }>;

  return { category, error };
}
