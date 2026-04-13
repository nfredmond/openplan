import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>("@/lib/workspaces/current");
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getCurrentWorkspace } from "@/app/api/workspaces/current/route";

describe("/api/workspaces/current", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: USER_ID,
        },
      },
    });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: WORKSPACE_ID,
        role: "member",
        workspaces: {
          name: "Pilot workspace",
          plan: "pilot",
          created_at: "2026-04-12T18:00:00.000Z",
        },
      },
      workspace: {
        name: "Pilot workspace",
        plan: "pilot",
        created_at: "2026-04-12T18:00:00.000Z",
      },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getCurrentWorkspace();

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns the helper-selected current workspace", async () => {
    const response = await getCurrentWorkspace();

    expect(response.status).toBe(200);
    expect(loadCurrentWorkspaceMembershipMock).toHaveBeenCalledWith(expect.anything(), USER_ID);
    expect(await response.json()).toMatchObject({
      workspaceId: WORKSPACE_ID,
      name: "Pilot workspace",
      role: "member",
    });
  });

  it("returns 404 when no workspace membership exists", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({
      membership: null,
      workspace: null,
    });

    const response = await getCurrentWorkspace();

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "No workspace membership found" });
  });

  it("returns 500 when helper-backed workspace resolution fails", async () => {
    loadCurrentWorkspaceMembershipMock.mockRejectedValueOnce(new Error("membership lookup failed"));

    const response = await getCurrentWorkspace();

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "Failed to fetch workspace membership",
      details: "membership lookup failed",
    });
  });
});
