import { beforeEach, describe, expect, it, vi } from "vitest";

const readActiveWorkspaceIdMock = vi.fn(async (): Promise<string | null> => null);
vi.mock("@/lib/workspaces/active-workspace", () => ({
  readActiveWorkspaceId: () => readActiveWorkspaceIdMock(),
  writeActiveWorkspaceId: vi.fn(),
  ACTIVE_WORKSPACE_COOKIE: "openplan_active_workspace",
}));

import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  loadCurrentWorkspaceMembership,
  loadWorkspaceContext,
  resolveWorkspaceMembershipSelection,
  resolveWorkspaceShellState,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";

beforeEach(() => {
  readActiveWorkspaceIdMock.mockResolvedValue(null);
});

const TWO_MEMBERSHIPS = [
  {
    workspace_id: "workspace-older",
    role: "admin",
    workspaces: [{ name: "Foothills MPO", created_at: "2026-03-01T12:00:00.000Z" }],
  },
  {
    workspace_id: "workspace-1",
    role: "owner",
    workspaces: [{ name: "Nevada County", created_at: "2026-03-02T12:00:00.000Z" }],
  },
];

function membershipClient(rows: unknown[]) {
  const eqMock = vi.fn().mockResolvedValue({ data: rows, error: null });
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return { from: fromMock } as unknown as Parameters<typeof loadWorkspaceContext>[0];
}

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
      workspaceName: "No workspace yet",
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
          workspaces: { name: "Nevada County" },
        },
        workspace: { name: "Nevada County" },
      })
    ).toEqual({
      workspaceName: "Nevada County",
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
          workspaces: { name: "Beta", created_at: "2026-03-10T12:00:00.000Z" },
        },
        {
          workspace_id: "workspace-a",
          role: "owner",
          workspaces: { name: "Alpha", created_at: "2026-03-11T12:00:00.000Z" },
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
          workspaces: { name: "Alpha", created_at: "2026-03-11T12:00:00.000Z" },
        },
        {
          workspace_id: "workspace-b",
          role: "admin",
          workspaces: { name: "Beta", created_at: "2026-03-10T12:00:00.000Z" },
        },
      ],
      { requestedWorkspaceId: "workspace-b", requireExplicitSelectionForMultiWorkspace: true }
    );

    expect(result.invalidWorkspaceId).toBe(false);
    expect(result.requiresExplicitSelection).toBe(false);
    expect(result.membership?.workspace_id).toBe("workspace-b");
    expect(result.workspace).toEqual({ name: "Beta", created_at: "2026-03-10T12:00:00.000Z" });
  });

  it("flags an invalid requested workspace id instead of silently falling back", () => {
    const result = resolveWorkspaceMembershipSelection(
      [
        {
          workspace_id: "workspace-a",
          role: "owner",
          workspaces: { name: "Alpha", created_at: "2026-03-11T12:00:00.000Z" },
        },
      ],
      { requestedWorkspaceId: "workspace-missing", requireExplicitSelectionForMultiWorkspace: true }
    );

    expect(result.invalidWorkspaceId).toBe(true);
    expect(result.membership).toBeUndefined();
    expect(result.workspace).toBeNull();
  });

  it("loads and unwraps the current workspace membership from Supabase", async () => {
    const eqMock = vi.fn().mockResolvedValue({
      data: [
        {
          workspace_id: "workspace-older",
          role: "admin",
          workspaces: [{ name: "Foothills MPO", created_at: "2026-03-01T12:00:00.000Z" }],
        },
        {
          workspace_id: "workspace-1",
          role: "owner",
          workspaces: [{ name: "Nevada County", created_at: "2026-03-02T12:00:00.000Z" }],
        },
      ],
      error: null,
    });
    const selectMock = vi.fn(() => ({ eq: eqMock }));
    const fromMock = vi.fn(() => ({ select: selectMock }));

    const result = await loadCurrentWorkspaceMembership(
      {
        from: fromMock,
      } as unknown as Parameters<typeof loadCurrentWorkspaceMembership>[0],
      "user-1"
    );

    expect(fromMock).toHaveBeenCalledWith("workspace_members");
    expect(selectMock).toHaveBeenCalledWith(CURRENT_WORKSPACE_MEMBERSHIP_SELECT);
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual({
      membership: {
        workspace_id: "workspace-1",
        role: "owner",
        workspaces: [{ name: "Nevada County", created_at: "2026-03-02T12:00:00.000Z" }],
      },
      workspace: { name: "Nevada County", created_at: "2026-03-02T12:00:00.000Z" },
    });
  });

  it("honors the persisted active-workspace selection over newest-first", async () => {
    // The cookie names the OLDER workspace; without honoring it, newest-first
    // would pick workspace-1.
    readActiveWorkspaceIdMock.mockResolvedValue("workspace-older");

    const ctx = await loadWorkspaceContext(membershipClient(TWO_MEMBERSHIPS), "user-1");

    expect(ctx.membership?.workspace_id).toBe("workspace-older");
    expect(ctx.workspace).toMatchObject({ name: "Foothills MPO" });
    // The switcher list carries every membership, sorted.
    expect(ctx.options).toEqual([
      { id: "workspace-1", name: "Nevada County" },
      { id: "workspace-older", name: "Foothills MPO" },
    ]);
  });

  it("falls back to newest-first when the selection cookie is stale", async () => {
    // The cookie points at a workspace the user no longer belongs to.
    readActiveWorkspaceIdMock.mockResolvedValue("workspace-deleted");

    const ctx = await loadWorkspaceContext(membershipClient(TWO_MEMBERSHIPS), "user-1");

    expect(ctx.membership?.workspace_id).toBe("workspace-1");
  });
});
