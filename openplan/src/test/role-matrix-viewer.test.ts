import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ACTIONS,
  WORKSPACE_ACTION_ROLE_MATRIX,
  canAccessWorkspaceAction,
  isReadOnlyWorkspaceRole,
  normalizeWorkspaceRole,
  type WorkspaceAction,
} from "@/lib/auth/role-matrix";

/**
 * The viewer tier's whole contract: read everything, change nothing.
 *
 * Every action is classified read or write HERE, exhaustively — the
 * Record<WorkspaceAction, …> type makes adding a matrix action without
 * classifying it a compile error, and the runtime sweep below turns any gap
 * into a loud test failure rather than a silently unguarded action.
 */
const ACTION_CLASSIFICATION: Record<WorkspaceAction, "read" | "write"> = {
  "analysis.create": "write",
  "analysis.context.read": "read",
  "engagement.read": "read",
  "engagement.write": "write",
  "models.read": "read",
  "models.write": "write",
  "plans.read": "read",
  "plans.write": "write",
  "programs.read": "read",
  "programs.write": "write",
  "reports.read": "read",
  "reports.write": "write",
  "scenarios.read": "read",
  "scenarios.write": "write",
  "runs.list": "read",
  "runs.update": "write",
  "runs.delete": "write",
  "report.generate": "write",
  "workspace.configure": "write",
  "invoices.read": "read",
  "invoices.write": "write",
  "stage_gates.decisions.read": "read",
  "stage_gates.decisions.write": "write",
};

describe("viewer role in the workspace action matrix", () => {
  it("classifies every matrix action so a new action fails loud until classified", () => {
    for (const action of WORKSPACE_ACTIONS) {
      expect(
        ACTION_CLASSIFICATION[action],
        `Unclassified workspace action "${action}" — add it to ACTION_CLASSIFICATION as read or write`
      ).toMatch(/^(read|write)$/);
    }
    expect(Object.keys(ACTION_CLASSIFICATION).sort()).toEqual([...WORKSPACE_ACTIONS].sort());
    expect(Object.keys(WORKSPACE_ACTION_ROLE_MATRIX).sort()).toEqual([...WORKSPACE_ACTIONS].sort());
  });

  it("allows viewer on every read action", () => {
    for (const action of WORKSPACE_ACTIONS) {
      if (ACTION_CLASSIFICATION[action] !== "read") continue;
      expect(canAccessWorkspaceAction(action, "viewer"), `viewer should read ${action}`).toBe(true);
    }
  });

  it("denies viewer on every write action", () => {
    for (const action of WORKSPACE_ACTIONS) {
      if (ACTION_CLASSIFICATION[action] !== "write") continue;
      expect(canAccessWorkspaceAction(action, "viewer"), `viewer must not ${action}`).toBe(false);
    }
  });

  it("keeps owner/admin/member access unchanged by the viewer tier", () => {
    for (const action of WORKSPACE_ACTIONS) {
      const allowed = WORKSPACE_ACTION_ROLE_MATRIX[action];
      expect(allowed).toContain("owner");
      expect(allowed).toContain("admin");
      // member lost nothing: the only member-excluded actions predate viewer.
      if (!allowed.includes("member")) {
        expect(["workspace.configure", "invoices.write"]).toContain(action);
      }
    }
  });

  it("normalizes viewer like every other role", () => {
    expect(normalizeWorkspaceRole("viewer")).toBe("viewer");
    expect(normalizeWorkspaceRole(" Viewer ")).toBe("viewer");
    expect(normalizeWorkspaceRole("auditor")).toBeNull();
  });

  it("flags only viewer as read-only for bare-membership write routes", () => {
    expect(isReadOnlyWorkspaceRole("viewer")).toBe(true);
    expect(isReadOnlyWorkspaceRole(" VIEWER ")).toBe(true);
    expect(isReadOnlyWorkspaceRole("member")).toBe(false);
    expect(isReadOnlyWorkspaceRole("admin")).toBe(false);
    expect(isReadOnlyWorkspaceRole("owner")).toBe(false);
    // Unknown/legacy strings keep their historical bare-membership behavior.
    expect(isReadOnlyWorkspaceRole("editor")).toBe(false);
    expect(isReadOnlyWorkspaceRole(null)).toBe(false);
    expect(isReadOnlyWorkspaceRole(undefined)).toBe(false);
  });
});
