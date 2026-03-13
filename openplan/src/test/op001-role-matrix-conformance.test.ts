import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ACTION_ROLE_MATRIX,
  canAccessWorkspaceAction,
  getWorkspaceRoleMatrixProofRows,
} from "@/lib/auth/role-matrix";

describe("OP-001 role-matrix conformance (deny-by-default)", () => {
  it("publishes expected role matrix rows for key API actions", () => {
    const rows = getWorkspaceRoleMatrixProofRows();

    expect(rows).toEqual(
      expect.arrayContaining([
        { action: "analysis.create", allowedRoles: ["owner", "admin", "member"] },
        { action: "analysis.context.read", allowedRoles: ["owner", "admin", "member"] },
        { action: "runs.list", allowedRoles: ["owner", "admin", "member"] },
        { action: "runs.delete", allowedRoles: ["owner", "admin", "member"] },
        { action: "report.generate", allowedRoles: ["owner", "admin", "member"] },
        { action: "billing.checkout", allowedRoles: ["owner", "admin"] },
        { action: "stage_gates.decisions.read", allowedRoles: ["owner", "admin", "member"] },
        { action: "stage_gates.decisions.write", allowedRoles: ["owner", "admin", "member"] },
      ])
    );

    expect(rows).toHaveLength(Object.keys(WORKSPACE_ACTION_ROLE_MATRIX).length);
  });

  it("enforces deny-by-default for unknown actions and unsupported roles", () => {
    expect(canAccessWorkspaceAction("billing.checkout", "viewer")).toBe(false);
    expect(canAccessWorkspaceAction("runs.list", "auditor")).toBe(false);
    expect(canAccessWorkspaceAction("stage_gates.decisions.read", "")).toBe(false);
    expect(canAccessWorkspaceAction("unknown.action", "owner")).toBe(false);
    expect(canAccessWorkspaceAction("unknown.action", "member")).toBe(false);
  });

  it("allows only owner/admin for billing checkout", () => {
    expect(canAccessWorkspaceAction("billing.checkout", "owner")).toBe(true);
    expect(canAccessWorkspaceAction("billing.checkout", "admin")).toBe(true);
    expect(canAccessWorkspaceAction("billing.checkout", "member")).toBe(false);
  });
});
