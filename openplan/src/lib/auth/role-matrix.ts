export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_ACTIONS = [
  "analysis.create",
  "analysis.context.read",
  "engagement.read",
  "engagement.write",
  "plans.read",
  "plans.write",
  "reports.read",
  "reports.write",
  "scenarios.read",
  "scenarios.write",
  "runs.list",
  "runs.update",
  "runs.delete",
  "report.generate",
  "billing.checkout",
  "stage_gates.decisions.read",
  "stage_gates.decisions.write",
] as const;

export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

export const WORKSPACE_ACTION_ROLE_MATRIX: Record<WorkspaceAction, readonly WorkspaceRole[]> = {
  "analysis.create": ["owner", "admin", "member"],
  "analysis.context.read": ["owner", "admin", "member"],
  "engagement.read": ["owner", "admin", "member"],
  "engagement.write": ["owner", "admin", "member"],
  "plans.read": ["owner", "admin", "member"],
  "plans.write": ["owner", "admin", "member"],
  "reports.read": ["owner", "admin", "member"],
  "reports.write": ["owner", "admin", "member"],
  "scenarios.read": ["owner", "admin", "member"],
  "scenarios.write": ["owner", "admin", "member"],
  "runs.list": ["owner", "admin", "member"],
  "runs.update": ["owner", "admin", "member"],
  "runs.delete": ["owner", "admin", "member"],
  "report.generate": ["owner", "admin", "member"],
  "billing.checkout": ["owner", "admin"],
  "stage_gates.decisions.read": ["owner", "admin", "member"],
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

export function getWorkspaceRoleMatrixProofRows(): Array<{
  action: WorkspaceAction;
  allowedRoles: readonly WorkspaceRole[];
}> {
  return WORKSPACE_ACTIONS.map((action) => ({
    action,
    allowedRoles: WORKSPACE_ACTION_ROLE_MATRIX[action],
  }));
}
