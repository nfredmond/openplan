export type WorkspaceRecord = {
  name?: string | null;
  plan?: string | null;
  created_at?: string | null;
  subscription_plan?: string | null;
  subscription_status?: string | null;
  billing_updated_at?: string | null;
};

export type WorkspaceMembershipRow = {
  workspace_id: string;
  role: string;
  workspaces: WorkspaceRecord | WorkspaceRecord[] | null;
};

export type WorkspaceShellState = {
  workspaceName: string;
  workspacePlan: string;
  workspaceRole: string;
  membershipStatus: "provisioned" | "not_provisioned" | "guest";
};

export const CURRENT_WORKSPACE_MEMBERSHIP_SELECT =
  "workspace_id, role, workspaces(name, plan, created_at, subscription_plan, subscription_status, billing_updated_at)";

export function unwrapWorkspaceRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export type WorkspaceMembershipClient = {
  from: (table: string) => {
    select: (query: string) => {
      eq: (column: string, value: string) => {
        limit: (count: number) => PromiseLike<{
          data: unknown[] | null;
          error: { message?: string | null } | null;
        }>;
      };
    };
  };
};

export async function loadCurrentWorkspaceMembership(
  supabase: WorkspaceMembershipClient,
  userId: string
): Promise<{ membership: WorkspaceMembershipRow | undefined; workspace: WorkspaceRecord | null }> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    throw new Error(error.message ?? "Failed to load workspace membership");
  }

  const membership = data?.[0] as WorkspaceMembershipRow | undefined;
  const workspace = unwrapWorkspaceRecord(membership?.workspaces);

  return {
    membership,
    workspace,
  };
}

export function resolveWorkspaceShellState({
  membership,
  workspace,
  isAuthenticated,
}: {
  membership?: WorkspaceMembershipRow | null;
  workspace?: WorkspaceRecord | null;
  isAuthenticated: boolean;
}): WorkspaceShellState {
  if (!isAuthenticated) {
    return {
      workspaceName: "Planning Workspace",
      workspacePlan: "Preview",
      workspaceRole: "Guest",
      membershipStatus: "guest",
    };
  }

  if (!membership || !workspace) {
    return {
      workspaceName: "No workspace provisioned",
      workspacePlan: "Provisioning required",
      workspaceRole: "No membership",
      membershipStatus: "not_provisioned",
    };
  }

  return {
    workspaceName: workspace.name ?? "Planning Workspace",
    workspacePlan: workspace.plan ?? "pilot",
    workspaceRole: membership.role,
    membershipStatus: "provisioned",
  };
}
