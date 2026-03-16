import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  loadCurrentWorkspaceMembership,
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
