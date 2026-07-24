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
        { action: "plans.read", allowedRoles: ["owner", "admin", "member"] },
        { action: "plans.write", allowedRoles: ["owner", "admin", "member"] },
        { action: "runs.list", allowedRoles: ["owner", "admin", "member"] },
        { action: "runs.update", allowedRoles: ["owner", "admin", "member"] },
        { action: "runs.delete", allowedRoles: ["owner", "admin", "member"] },
        { action: "report.generate", allowedRoles: ["owner", "admin", "member"] },
        { action: "workspace.configure", allowedRoles: ["owner", "admin"] },
        { action: "invoices.read", allowedRoles: ["owner", "admin", "member"] },
        { action: "invoices.write", allowedRoles: ["owner", "admin"] },
        { action: "stage_gates.decisions.read", allowedRoles: ["owner", "admin", "member"] },
        { action: "stage_gates.decisions.write", allowedRoles: ["owner", "admin", "member"] },
      ])
    );

    expect(rows).toHaveLength(Object.keys(WORKSPACE_ACTION_ROLE_MATRIX).length);
  });

  it("enforces deny-by-default for unknown actions and unsupported roles", () => {
    expect(canAccessWorkspaceAction("workspace.configure", "viewer")).toBe(false);
    expect(canAccessWorkspaceAction("runs.list", "auditor")).toBe(false);
    expect(canAccessWorkspaceAction("stage_gates.decisions.read", "")).toBe(false);
    expect(canAccessWorkspaceAction("unknown.action", "owner")).toBe(false);
    expect(canAccessWorkspaceAction("unknown.action", "member")).toBe(false);
  });

  it("allows only owner/admin for billing checkout", () => {
    expect(canAccessWorkspaceAction("workspace.configure", "owner")).toBe(true);
    expect(canAccessWorkspaceAction("workspace.configure", "admin")).toBe(true);
    expect(canAccessWorkspaceAction("workspace.configure", "member")).toBe(false);
  });

  it("allows members to read invoice records but not write them", () => {
    expect(canAccessWorkspaceAction("invoices.read", "member")).toBe(true);
    expect(canAccessWorkspaceAction("invoices.write", "owner")).toBe(true);
    expect(canAccessWorkspaceAction("invoices.write", "admin")).toBe(true);
    expect(canAccessWorkspaceAction("invoices.write", "member")).toBe(false);
  });
});
