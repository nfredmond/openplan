import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Safety rules for /api/workspaces/members:
 * - listing/managing is owner/admin (viewer and member get 403);
 * - only an OWNER may grant/revoke the owner role or demote/remove an owner;
 * - the LAST owner can never be demoted or removed, including by themselves;
 * - self-removal (leaving) is open to every role except the last owner.
 */

const getUserMock = vi.fn();
const actorMembershipMock = vi.fn();
const memberListMock = vi.fn();
const targetMembershipMock = vi.fn();
const ownerCountMock = vi.fn();
const updateResultMock = vi.fn();
const deleteResultMock = vi.fn();
const getUserByIdMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table !== "workspace_members") throw new Error(`Unexpected table: ${table}`);
      // The RLS client serves exactly ONE chain: the actor guard
      // (.eq().eq().maybeSingle()), which reads the caller's own row and so
      // survives the members_read_own policy. A roster read (.eq().order())
      // through this client would silently return only the caller in
      // production, so it fails loudly here instead.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: actorMembershipMock }),
            order: () => {
              throw new Error(
                "The member roster must be read with the service role — RLS (members_read_own) returns only the caller"
              );
            },
          }),
        }),
      };
    },
  }),
  createServiceRoleClient: () => ({
    auth: { admin: { getUserById: getUserByIdMock } },
    from: (table: string) => {
      if (table !== "workspace_members") throw new Error(`Unexpected table: ${table}`);
      return {
        select: (_columns: string, options?: { head?: boolean }) => {
          if (options?.head) {
            // Owner count: awaited directly after .eq().eq().
            return { eq: () => ({ eq: () => Promise.resolve(ownerCountMock()) }) };
          }
          // Two chains share the leading .eq(workspace_id): the target
          // membership lookup (.eq().maybeSingle()) and the roster
          // (.order().limit()).
          return {
            eq: () => ({
              eq: () => ({ maybeSingle: targetMembershipMock }),
              order: () => ({ limit: memberListMock }),
            }),
          };
        },
        update: () => ({ eq: () => ({ eq: () => Promise.resolve(updateResultMock()) }) }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve(deleteResultMock()) }) }),
      };
    },
  }),
}));

import { DELETE, GET, PATCH } from "@/app/api/workspaces/members/route";

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function listRequest(query = `?workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`http://localhost/api/workspaces/members${query}`);
}

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/workspaces/members", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function removeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/workspaces/members", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setActorRole(role: string | null) {
  actorMembershipMock.mockResolvedValue({
    data: role ? { workspace_id: WORKSPACE_ID, role } : null,
    error: null,
  });
}

function setTargetRole(role: string | null) {
  targetMembershipMock.mockResolvedValue({
    data: role ? { user_id: TARGET_ID, role } : null,
    error: null,
  });
}

function setOwnerCount(count: number) {
  ownerCountMock.mockReturnValue({ count, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: ACTOR_ID } } });
  setActorRole("owner");
  setTargetRole("member");
  setOwnerCount(2);
  memberListMock.mockResolvedValue({
    data: [
      { user_id: ACTOR_ID, role: "owner", joined_at: "2026-07-01T00:00:00Z" },
      { user_id: TARGET_ID, role: "member", joined_at: "2026-07-02T00:00:00Z" },
    ],
    error: null,
  });
  getUserByIdMock.mockImplementation(async (id: string) => ({
    data: { user: { id, email: id === ACTOR_ID ? "owner@agency.gov" : "member@agency.gov" } },
    error: null,
  }));
  updateResultMock.mockReturnValue({ error: null });
  deleteResultMock.mockReturnValue({ error: null });
});

describe("GET /api/workspaces/members", () => {
  it("400s without a workspace id", async () => {
    expect((await GET(listRequest(""))).status).toBe(400);
  });

  it("401s when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect((await GET(listRequest())).status).toBe(401);
  });

  it("404s for a non-member rather than revealing the workspace exists", async () => {
    setActorRole(null);
    expect((await GET(listRequest())).status).toBe(404);
  });

  it("403s for a member and for a viewer — team data is owner/admin only", async () => {
    setActorRole("member");
    expect((await GET(listRequest())).status).toBe(403);
    setActorRole("viewer");
    expect((await GET(listRequest())).status).toBe(403);
  });

  it("lists members with emails resolved through the auth admin API", async () => {
    const res = await GET(listRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.callerUserId).toBe(ACTOR_ID);
    expect(body.members).toEqual([
      { userId: ACTOR_ID, email: "owner@agency.gov", role: "owner", joinedAt: "2026-07-01T00:00:00Z" },
      { userId: TARGET_ID, email: "member@agency.gov", role: "member", joinedAt: "2026-07-02T00:00:00Z" },
    ]);
  });

  it("returns a null email instead of failing when an auth lookup breaks", async () => {
    getUserByIdMock.mockRejectedValue(new Error("auth admin unavailable"));
    const res = await GET(listRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members.every((member: { email: string | null }) => member.email === null)).toBe(true);
  });
});

describe("PATCH /api/workspaces/members", () => {
  const payload = { workspaceId: WORKSPACE_ID, userId: TARGET_ID, role: "admin" };

  it("400s on an unknown role", async () => {
    expect((await PATCH(patchRequest({ ...payload, role: "superuser" }))).status).toBe(400);
  });

  it("403s for member and viewer actors", async () => {
    setActorRole("member");
    expect((await PATCH(patchRequest(payload))).status).toBe(403);
    setActorRole("viewer");
    expect((await PATCH(patchRequest(payload))).status).toBe(403);
    expect(updateResultMock).not.toHaveBeenCalled();
  });

  it("404s when the target is not a member of the workspace", async () => {
    setTargetRole(null);
    expect((await PATCH(patchRequest(payload))).status).toBe(404);
  });

  it("lets an admin move a member between member, admin, and viewer", async () => {
    setActorRole("admin");
    for (const role of ["admin", "viewer", "member"]) {
      const res = await PATCH(patchRequest({ ...payload, role }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ updated: true, userId: TARGET_ID, role });
    }
  });

  it("refuses to let an admin grant the owner role", async () => {
    setActorRole("admin");
    const res = await PATCH(patchRequest({ ...payload, role: "owner" }));
    expect(res.status).toBe(403);
    expect(updateResultMock).not.toHaveBeenCalled();
  });

  it("refuses to let an admin change another owner's role", async () => {
    setActorRole("admin");
    setTargetRole("owner");
    const res = await PATCH(patchRequest({ ...payload, role: "member" }));
    expect(res.status).toBe(403);
    expect(updateResultMock).not.toHaveBeenCalled();
  });

  it("lets an owner grant the owner role", async () => {
    const res = await PATCH(patchRequest({ ...payload, role: "owner" }));
    expect(res.status).toBe(200);
  });

  it("lets an owner demote another owner while a second owner remains", async () => {
    setTargetRole("owner");
    setOwnerCount(2);
    const res = await PATCH(patchRequest({ ...payload, role: "member" }));
    expect(res.status).toBe(200);
  });

  it("409s instead of demoting the last owner", async () => {
    setTargetRole("owner");
    setOwnerCount(1);
    const res = await PATCH(patchRequest({ ...payload, role: "member" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("last owner");
    expect(updateResultMock).not.toHaveBeenCalled();
  });

  it("409s when the database refuses the demotion, even though the count passed", async () => {
    // The count-then-write pre-check is a courtesy, not the guarantee: two
    // owners demoting each other at the same instant both pass it. The
    // owner-floor trigger (20260728000004) serializes and refuses the second
    // write; that refusal must reach the caller as the same 409, never a 500.
    setTargetRole("owner");
    setOwnerCount(2);
    updateResultMock.mockReturnValue({ error: { code: "OP409", message: "workspace would be left without an owner" } });
    const res = await PATCH(patchRequest({ ...payload, role: "member" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("last owner");
  });

  it("409s when the last owner tries to demote themselves", async () => {
    setTargetRole("owner");
    setOwnerCount(1);
    const res = await PATCH(
      patchRequest({ workspaceId: WORKSPACE_ID, userId: ACTOR_ID, role: "member" })
    );
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/workspaces/members", () => {
  const payload = { workspaceId: WORKSPACE_ID, userId: TARGET_ID };

  it("403s when a member or viewer removes someone else", async () => {
    setActorRole("member");
    expect((await DELETE(removeRequest(payload))).status).toBe(403);
    setActorRole("viewer");
    expect((await DELETE(removeRequest(payload))).status).toBe(403);
    expect(deleteResultMock).not.toHaveBeenCalled();
  });

  it("lets a member and a viewer leave the workspace themselves", async () => {
    for (const role of ["member", "viewer"]) {
      setActorRole(role);
      setTargetRole(role);
      const res = await DELETE(removeRequest({ workspaceId: WORKSPACE_ID, userId: ACTOR_ID }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ removed: true, left: true });
    }
  });

  it("lets an admin remove a member", async () => {
    setActorRole("admin");
    const res = await DELETE(removeRequest(payload));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: true, userId: TARGET_ID, left: false });
  });

  it("refuses to let an admin remove an owner", async () => {
    setActorRole("admin");
    setTargetRole("owner");
    expect((await DELETE(removeRequest(payload))).status).toBe(403);
    expect(deleteResultMock).not.toHaveBeenCalled();
  });

  it("lets an owner remove another owner while a second owner remains", async () => {
    setTargetRole("owner");
    setOwnerCount(2);
    expect((await DELETE(removeRequest(payload))).status).toBe(200);
  });

  it("409s instead of removing the last owner", async () => {
    setTargetRole("owner");
    setOwnerCount(1);
    const res = await DELETE(removeRequest(payload));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("last owner");
    expect(deleteResultMock).not.toHaveBeenCalled();
  });

  it("409s when the database refuses the removal, even though the count passed", async () => {
    setTargetRole("owner");
    setOwnerCount(2);
    deleteResultMock.mockReturnValue({ error: { code: "OP409", message: "workspace would be left without an owner" } });
    const res = await DELETE(removeRequest(payload));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("last owner");
  });

  it("409s when the last owner tries to leave", async () => {
    setTargetRole("owner");
    setOwnerCount(1);
    const res = await DELETE(removeRequest({ workspaceId: WORKSPACE_ID, userId: ACTOR_ID }));
    expect(res.status).toBe(409);
  });

  it("404s when the target is not a member", async () => {
    setTargetRole(null);
    expect((await DELETE(removeRequest(payload))).status).toBe(404);
  });

  it("404s for a non-member actor rather than revealing the workspace exists", async () => {
    setActorRole(null);
    expect((await DELETE(removeRequest(payload))).status).toBe(404);
  });
});
