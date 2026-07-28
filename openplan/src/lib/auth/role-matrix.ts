/**
 * Workspace roles, strongest first. "viewer" is the read-only tier: it appears
 * in every read/list action below and in NO mutating action. Anything that
 * changes workspace content — creates, writes, deletes, generation, member and
 * configuration management — is owner/admin/member at most.
 */
export const WORKSPACE_ROLES = ["owner", "admin", "member", "viewer"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_ACTIONS = [
  "analysis.create",
  "analysis.context.read",
  "engagement.read",
  "engagement.write",
  "models.read",
  "models.write",
  "plans.read",
  "plans.write",
  "programs.read",
  "programs.write",
  "reports.read",
  "reports.write",
  "scenarios.read",
  "scenarios.write",
  "runs.list",
  "runs.update",
  "runs.delete",
  "report.generate",
  "workspace.configure",
  "invoices.read",
  "invoices.write",
  "stage_gates.decisions.read",
  "stage_gates.decisions.write",
] as const;

export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

export const WORKSPACE_ACTION_ROLE_MATRIX: Record<WorkspaceAction, readonly WorkspaceRole[]> = {
  "analysis.create": ["owner", "admin", "member"],
  "analysis.context.read": ["owner", "admin", "member", "viewer"],
  "engagement.read": ["owner", "admin", "member", "viewer"],
  "engagement.write": ["owner", "admin", "member"],
  "models.read": ["owner", "admin", "member", "viewer"],
  "models.write": ["owner", "admin", "member"],
  "plans.read": ["owner", "admin", "member", "viewer"],
  "plans.write": ["owner", "admin", "member"],
  "programs.read": ["owner", "admin", "member", "viewer"],
  "programs.write": ["owner", "admin", "member"],
  "reports.read": ["owner", "admin", "member", "viewer"],
  "reports.write": ["owner", "admin", "member"],
  "scenarios.read": ["owner", "admin", "member", "viewer"],
  "scenarios.write": ["owner", "admin", "member"],
  "runs.list": ["owner", "admin", "member", "viewer"],
  "runs.update": ["owner", "admin", "member"],
  "runs.delete": ["owner", "admin", "member"],
  "report.generate": ["owner", "admin", "member"],
  "workspace.configure": ["owner", "admin"],
  "invoices.read": ["owner", "admin", "member", "viewer"],
  "invoices.write": ["owner", "admin"],
  "stage_gates.decisions.read": ["owner", "admin", "member", "viewer"],
  "stage_gates.decisions.write": ["owner", "admin", "member"],
};

export function normalizeWorkspaceRole(role: string | null | undefined): WorkspaceRole | null {
  const normalized = role?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if ((WORKSPACE_ROLES as readonly string[]).includes(normalized)) {
    return normalized as WorkspaceRole;
  }

  return null;
}

export function canAccessWorkspaceAction(
  action: WorkspaceAction | string,
  role: string | null | undefined
): boolean {
  if (!(action in WORKSPACE_ACTION_ROLE_MATRIX)) {
    return false;
  }

  const normalizedRole = normalizeWorkspaceRole(role);
  if (!normalizedRole) {
    return false;
  }

  const allowedRoles = WORKSPACE_ACTION_ROLE_MATRIX[action as WorkspaceAction];
  return allowedRoles.includes(normalizedRole);
}

/**
 * True when the role may never mutate workspace content. Some routes authorize
 * writes by bare membership because their module has no matrix action yet;
 * they call this before writing so the viewer tier stays read-only everywhere,
 * while the matrix above remains the single policy table for what "viewer"
 * means. Unknown/legacy role strings return false — bare-membership routes
 * keep their historical behavior for them.
 */
export function isReadOnlyWorkspaceRole(role: string | null | undefined): boolean {
  return normalizeWorkspaceRole(role) === "viewer";
}

export function getWorkspaceRoleMatrixProofRows(): Array<{
  action: WorkspaceAction;
  allowedRoles: readonly WorkspaceRole[];
}> {
  return WORKSPACE_ACTIONS.map((action) => ({
    action,
    allowedRoles: WORKSPACE_ACTION_ROLE_MATRIX[action],
  }));
}
