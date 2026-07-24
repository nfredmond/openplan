import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const checkWorkspaceMembershipMock = vi.fn();
const writeActiveWorkspaceIdMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/workspaces/membership", () => ({
  checkWorkspaceMembership: (...args: unknown[]) => checkWorkspaceMembershipMock(...args),
}));

vi.mock("@/lib/workspaces/active-workspace", () => ({
  writeActiveWorkspaceId: (...args: unknown[]) => writeActiveWorkspaceIdMock(...args),
}));

const { POST } = await import("@/app/api/workspaces/active/route");

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/workspaces/active", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/workspaces/active", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    checkWorkspaceMembershipMock.mockResolvedValue({ ok: true, role: "owner" });
    writeActiveWorkspaceIdMock.mockResolvedValue(undefined);
  });

  it("writes the cookie for a workspace the caller belongs to", async () => {
    const res = await POST(req({ workspaceId: WORKSPACE_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspaceId: WORKSPACE_ID });
    expect(writeActiveWorkspaceIdMock).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("401s an unauthenticated caller and never writes", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(req({ workspaceId: WORKSPACE_ID }));
    expect(res.status).toBe(401);
    expect(writeActiveWorkspaceIdMock).not.toHaveBeenCalled();
  });

  it("404s a workspace the caller is not a member of, and never writes", async () => {
    checkWorkspaceMembershipMock.mockResolvedValue({ ok: false, kind: "not_member", message: "Workspace not found" });
    const res = await POST(req({ workspaceId: WORKSPACE_ID }));
    expect(res.status).toBe(404);
    expect(writeActiveWorkspaceIdMock).not.toHaveBeenCalled();
  });

  it("400s a malformed workspaceId", async () => {
    expect((await POST(req({ workspaceId: "not-a-uuid" }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect(writeActiveWorkspaceIdMock).not.toHaveBeenCalled();
  });

  it("503s before the workspace schema is applied", async () => {
    checkWorkspaceMembershipMock.mockResolvedValue({ ok: false, kind: "schema_pending", message: "schema cache" });
    expect((await POST(req({ workspaceId: WORKSPACE_ID }))).status).toBe(503);
  });
});
