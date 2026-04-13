import { type SupabaseClient } from "@supabase/supabase-js";

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

export type WorkspaceMembershipClient = Pick<SupabaseClient, "from">;

export type WorkspaceMembershipSelection = {
  memberships: WorkspaceMembershipRow[];
  membership: WorkspaceMembershipRow | undefined;
  workspace: WorkspaceRecord | null;
  hasMultipleMemberships: boolean;
  requiresExplicitSelection: boolean;
  invalidWorkspaceId: boolean;
};

function compareWorkspaceMemberships(a: WorkspaceMembershipRow, b: WorkspaceMembershipRow): number {
  const workspaceA = unwrapWorkspaceRecord(a.workspaces);
  const workspaceB = unwrapWorkspaceRecord(b.workspaces);

  const createdAtA = workspaceA?.created_at ? Date.parse(workspaceA.created_at) : Number.NaN;
  const createdAtB = workspaceB?.created_at ? Date.parse(workspaceB.created_at) : Number.NaN;

  if (Number.isFinite(createdAtA) && Number.isFinite(createdAtB) && createdAtA !== createdAtB) {
    return createdAtB - createdAtA;
  }

  if (Number.isFinite(createdAtA) && !Number.isFinite(createdAtB)) {
    return -1;
  }

  if (!Number.isFinite(createdAtA) && Number.isFinite(createdAtB)) {
    return 1;
  }

  const nameA = workspaceA?.name ?? "";
  const nameB = workspaceB?.name ?? "";
  const nameCompare = nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
  if (nameCompare !== 0) {
    return nameCompare;
  }

  return a.workspace_id.localeCompare(b.workspace_id);
}

export function resolveWorkspaceMembershipSelection(
  memberships: WorkspaceMembershipRow[] | null | undefined,
  options?: {
    requestedWorkspaceId?: string | null;
    requireExplicitSelectionForMultiWorkspace?: boolean;
  }
): WorkspaceMembershipSelection {
  const normalizedMemberships = [...(memberships ?? [])].sort(compareWorkspaceMemberships);
  const requestedWorkspaceId = options?.requestedWorkspaceId ?? null;
  const requireExplicitSelectionForMultiWorkspace = options?.requireExplicitSelectionForMultiWorkspace ?? false;

  if (normalizedMemberships.length === 0) {
    return {
      memberships: [],
      membership: undefined,
      workspace: null,
      hasMultipleMemberships: false,
      requiresExplicitSelection: false,
      invalidWorkspaceId: false,
    };
  }

  if (requestedWorkspaceId) {
    const selectedMembership = normalizedMemberships.find((membership) => membership.workspace_id === requestedWorkspaceId);
    return {
      memberships: normalizedMemberships,
      membership: selectedMembership,
      workspace: unwrapWorkspaceRecord(selectedMembership?.workspaces),
      hasMultipleMemberships: normalizedMemberships.length > 1,
      requiresExplicitSelection: false,
      invalidWorkspaceId: !selectedMembership,
    };
  }

  if (requireExplicitSelectionForMultiWorkspace && normalizedMemberships.length > 1) {
    return {
      memberships: normalizedMemberships,
      membership: undefined,
      workspace: null,
      hasMultipleMemberships: true,
      requiresExplicitSelection: true,
      invalidWorkspaceId: false,
    };
  }

  const membership = normalizedMemberships[0];
  return {
    memberships: normalizedMemberships,
    membership,
    workspace: unwrapWorkspaceRecord(membership?.workspaces),
    hasMultipleMemberships: normalizedMemberships.length > 1,
    requiresExplicitSelection: false,
    invalidWorkspaceId: false,
  };
}

export async function loadCurrentWorkspaceMembership(
  supabase: WorkspaceMembershipClient,
  userId: string
): Promise<{ membership: WorkspaceMembershipRow | undefined; workspace: WorkspaceRecord | null }> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message ?? "Failed to load workspace membership");
  }

  const selection = resolveWorkspaceMembershipSelection(data as WorkspaceMembershipRow[] | null | undefined);
  const membership = selection.membership;
  const workspace = selection.workspace;

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
