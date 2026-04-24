import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const createWorkspaceInvitationMock = vi.fn();

const authGetUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const membershipEqMock = vi.fn();
const membershipSelectMock = vi.fn();
const fromMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/invitations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/invitations")>(
    "@/lib/workspaces/invitations"
  );
  return {
    ...actual,
    createWorkspaceInvitation: (...args: unknown[]) => createWorkspaceInvitationMock(...args),
  };
});

import { POST as postWorkspaceInvitation } from "@/app/api/workspaces/invitations/route";

function invitationRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/workspaces/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/workspaces/invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "owner" },
      error: null,
    });
    const membershipChain = {
      eq: membershipEqMock,
      maybeSingle: membershipMaybeSingleMock,
    };
    membershipEqMock.mockReturnValue(membershipChain);
    membershipSelectMock.mockReturnValue(membershipChain);
    fromMock.mockImplementation((table: string) => {
      if (table === "workspace_members") return { select: membershipSelectMock };
      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    createServiceRoleClientMock.mockReturnValue({ from: vi.fn() });
    createWorkspaceInvitationMock.mockResolvedValue({
      invitation: {
        id: "33333333-3333-4333-8333-333333333333",
        email: "planner@nctc.ca.gov",
        email_normalized: "planner@nctc.ca.gov",
        role: "member",
        status: "pending",
        expires_at: "2026-05-08T12:00:00.000Z",
      },
      invitationUrl: "http://localhost/sign-up?invite=token&redirect=%2Fdashboard",
      reissued: false,
    });
  });

  it("returns 401 when the current user is not authenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postWorkspaceInvitation(
      invitationRequest({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        email: "planner@nctc.ca.gov",
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
    expect(createWorkspaceInvitationMock).not.toHaveBeenCalled();
  });

  it("returns 403 when a non-admin member attempts to invite", async () => {
    membershipMaybeSingleMock.mockResolvedValue({
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "member" },
      error: null,
    });

    const response = await postWorkspaceInvitation(
      invitationRequest({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        email: "planner@nctc.ca.gov",
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Owner/admin access is required" });
    expect(createWorkspaceInvitationMock).not.toHaveBeenCalled();
  });

  it("creates a manual-delivery invitation for owner/admin users", async () => {
    const response = await postWorkspaceInvitation(
      invitationRequest({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        email: "planner@nctc.ca.gov",
        role: "member",
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      invitationId: "33333333-3333-4333-8333-333333333333",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      email: "planner@nctc.ca.gov",
      role: "member",
      delivery: "manual",
      reissued: false,
    });
    expect(createWorkspaceInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        email: "planner@nctc.ca.gov",
        role: "member",
        invitedByUserId: "22222222-2222-4222-8222-222222222222",
        origin: "http://localhost",
      })
    );
  });
});
