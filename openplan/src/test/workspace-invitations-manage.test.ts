import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const invitationsSelectMock = vi.fn();
const revokeMaybeSingleMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === "workspace_members") {
        // Two different chains hit this table: the guard
        // (.eq().eq().maybeSingle()) and the member count (.eq().limit()).
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: membershipMaybeSingleMock }),
              limit: async () => ({ data: [{ user_id: "u1" }, { user_id: "u2" }], error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ order: () => ({ limit: invitationsSelectMock }) }),
        }),
      };
    },
  }),
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: revokeMaybeSingleMock }) }) }) }),
      }),
    }),
  }),
}));

import { DELETE, GET } from "@/app/api/workspaces/invitations/route";

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const INVITATION_ID = "660e8400-e29b-41d4-a716-446655440111";

function listRequest(query = `?workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`http://localhost/api/workspaces/invitations${query}`);
}

function revokeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/workspaces/invitations", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("workspace invitation management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
    invitationsSelectMock.mockResolvedValue({ data: [], error: null });
    revokeMaybeSingleMock.mockResolvedValue({ data: { id: INVITATION_ID }, error: null });
  });

  it("400s without a workspace id", async () => {
    expect((await GET(listRequest(""))).status).toBe(400);
  });

  it("401s when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect((await GET(listRequest())).status).toBe(401);
  });

  it("404s for a non-member rather than revealing the workspace exists", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    expect((await GET(listRequest())).status).toBe(404);
  });

  it("403s for a plain member — managing access is owner/admin only", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "member" }, error: null });
    expect((await GET(listRequest())).status).toBe(403);
    expect(
      (await DELETE(revokeRequest({ workspaceId: WORKSPACE_ID, invitationId: INVITATION_ID }))).status
    ).toBe(403);
  });

  it("lists invitations for an owner", async () => {
    invitationsSelectMock.mockResolvedValue({
      data: [{ id: INVITATION_ID, email: "a@b.gov", role: "member", status: "pending" }],
      error: null,
    });
    const res = await GET(listRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invitations).toHaveLength(1);
    expect(body.memberCount).toBe(2);
  });

  it("never returns the token hash", async () => {
    // The raw token is shown once at creation; nothing may hand back a value
    // that could be replayed into workspace access.
    const source = readFileSync(
      path.join(process.cwd(), "src/app/api/workspaces/invitations/route.ts"),
      "utf8"
    );
    const selects = source.match(/\.select\("([^"]*)"\)/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).not.toContain("token_hash");
      expect(select).not.toContain("token_prefix");
    }
  });

  it("revokes a pending invitation", async () => {
    const res = await DELETE(revokeRequest({ workspaceId: WORKSPACE_ID, invitationId: INVITATION_ID }));
    expect(res.status).toBe(200);
    expect((await res.json()).revoked).toBe(true);
  });

  it("404s when no pending invitation matched", async () => {
    // Guards the cross-workspace case: an id from another workspace must not
    // be cancellable, and an already-accepted invitation is not revocable.
    revokeMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    expect(
      (await DELETE(revokeRequest({ workspaceId: WORKSPACE_ID, invitationId: INVITATION_ID }))).status
    ).toBe(404);
  });

  it("400s on a malformed revoke payload", async () => {
    expect((await DELETE(revokeRequest({ workspaceId: WORKSPACE_ID }))).status).toBe(400);
  });
});

describe("team panel honesty", () => {
  it("says invitations are not emailed instead of implying they were sent", () => {
    // The API reports delivery: "manual". Claiming "invite sent" would be an
    // overclaim of exactly the kind this codebase guards against.
    const source = readFileSync(
      path.join(process.cwd(), "src/components/workspaces/workspace-team-panel.tsx"),
      "utf8"
    );
    expect(source).toContain("does not email invitations");
    expect(source).toMatch(/shown once/i);
  });
});
