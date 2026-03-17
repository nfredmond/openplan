import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  loadCurrentWorkspaceMembership,
  resolveWorkspaceMembershipSelection,
  resolveWorkspaceShellState,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";

describe("workspace membership helpers", () => {
  it("unwraps joined workspace rows consistently", () => {
    expect(unwrapWorkspaceRecord([{ name: "Alpha" }, { name: "Beta" }])).toEqual({ name: "Alpha" });
    expect(unwrapWorkspaceRecord({ name: "Solo" })).toEqual({ name: "Solo" });
    expect(unwrapWorkspaceRecord(null)).toBeNull();
  });

  it("returns a not-provisioned shell state for signed-in users without membership", () => {
    expect(
      resolveWorkspaceShellState({
        isAuthenticated: true,
        membership: null,
        workspace: null,
      })
    ).toEqual({
      workspaceName: "No workspace provisioned",
      workspacePlan: "Provisioning required",
      workspaceRole: "No membership",
      membershipStatus: "not_provisioned",
    });
  });

  it("returns a provisioned shell state when membership and workspace exist", () => {
    expect(
      resolveWorkspaceShellState({
        isAuthenticated: true,
        membership: {
          workspace_id: "workspace-1",
          role: "owner",
          workspaces: { name: "Nevada County", plan: "pilot" },
        },
        workspace: { name: "Nevada County", plan: "pilot" },
      })
    ).toEqual({
      workspaceName: "Nevada County",
      workspacePlan: "pilot",
      workspaceRole: "owner",
      membershipStatus: "provisioned",
    });
  });

  it("requires explicit selection for multi-workspace billing contexts", () => {
    const result = resolveWorkspaceMembershipSelection(
      [
        {
          workspace_id: "workspace-b",
          role: "admin",
          workspaces: { name: "Beta", created_at: "2026-03-10T12:00:00.000Z", plan: "starter" },
        },
        {
          workspace_id: "workspace-a",
          role: "owner",
          workspaces: { name: "Alpha", created_at: "2026-03-11T12:00:00.000Z", plan: "pilot" },
        },
      ],
      { requireExplicitSelectionForMultiWorkspace: true }
    );

    expect(result.memberships.map((membership) => membership.workspace_id)).toEqual(["workspace-a", "workspace-b"]);
    expect(result.hasMultipleMemberships).toBe(true);
    expect(result.requiresExplicitSelection).toBe(true);
    expect(result.membership).toBeUndefined();
    expect(result.workspace).toBeNull();
  });

  it("selects the requested workspace when an explicit workspace id is provided", () => {
    const result = resolveWorkspaceMembershipSelection(
      [
        {
          workspace_id: "workspace-a",
          role: "owner",
          workspaces: { name: "Alpha", created_at: "2026-03-11T12:00:00.000Z", plan: "pilot" },
        },
        {
          workspace_id: "workspace-b",
          role: "admin",
          workspaces: { name: "Beta", created_at: "2026-03-10T12:00:00.000Z", plan: "starter" },
        },
      ],
      { requestedWorkspaceId: "workspace-b", requireExplicitSelectionForMultiWorkspace: true }
    );

    expect(result.invalidWorkspaceId).toBe(false);
    expect(result.requiresExplicitSelection).toBe(false);
    expect(result.membership?.workspace_id).toBe("workspace-b");
    expect(result.workspace).toEqual({ name: "Beta", created_at: "2026-03-10T12:00:00.000Z", plan: "starter" });
  });

  it("flags an invalid requested workspace id instead of silently falling back", () => {
    const result = resolveWorkspaceMembershipSelection(
      [
        {
          workspace_id: "workspace-a",
          role: "owner",
          workspaces: { name: "Alpha", created_at: "2026-03-11T12:00:00.000Z", plan: "pilot" },
        },
      ],
      { requestedWorkspaceId: "workspace-missing", requireExplicitSelectionForMultiWorkspace: true }
    );

    expect(result.invalidWorkspaceId).toBe(true);
    expect(result.membership).toBeUndefined();
    expect(result.workspace).toBeNull();
  });

  it("loads and unwraps the current workspace membership from Supabase", async () => {
    const limitMock = vi.fn().mockResolvedValue({
      data: [
        {
          workspace_id: "workspace-1",
          role: "admin",
          workspaces: [{ name: "Foothills MPO", plan: "starter" }],
        },
      ],
      error: null,
    });
    const eqMock = vi.fn(() => ({ limit: limitMock }));
    const selectMock = vi.fn(() => ({ eq: eqMock }));
    const fromMock = vi.fn(() => ({ select: selectMock }));

    const result = await loadCurrentWorkspaceMembership(
      {
        from: fromMock,
      },
      "user-1"
    );

    expect(fromMock).toHaveBeenCalledWith("workspace_members");
    expect(selectMock).toHaveBeenCalledWith(CURRENT_WORKSPACE_MEMBERSHIP_SELECT);
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      membership: {
        workspace_id: "workspace-1",
        role: "admin",
        workspaces: [{ name: "Foothills MPO", plan: "starter" }],
      },
      workspace: { name: "Foothills MPO", plan: "starter" },
    });
  });
});
