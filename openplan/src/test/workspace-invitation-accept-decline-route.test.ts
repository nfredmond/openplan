import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadInvitationByTokenMock = vi.fn();

const authGetUserMock = vi.fn();
const acceptInvitationRpcMock = vi.fn();
const invitationUpdateMock = vi.fn();
const fromMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const pendingInvitation = {
  id: "33333333-3333-4333-8333-333333333333",
  workspace_id: "11111111-1111-4111-8111-111111111111",
  email: "planner@nctc.ca.gov",
  email_normalized: "planner@nctc.ca.gov",
  role: "member",
  status: "pending",
  token_hash: "hash",
  token_prefix: "prefix",
  invited_by_user_id: "22222222-2222-4222-8222-222222222222",
  expires_at: "2026-05-08T12:00:00.000Z",
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
    loadInvitationByToken: (...args: unknown[]) => loadInvitationByTokenMock(...args),
  };
});

import { POST as postAcceptInvitation } from "@/app/api/workspaces/invitations/accept/route";
import { POST as postDeclineInvitation } from "@/app/api/workspaces/invitations/decline/route";

function tokenRequest(path: string, token = "invite-token-12345678901234567890") {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

function buildFilterResult(error: { message: string } | null = null) {
  const chain = {
    error,
    eq: vi.fn(() => chain),
  };
  return chain;
}

describe("workspace invitation accept/decline routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "44444444-4444-4444-8444-444444444444",
          email: "planner@nctc.ca.gov",
        },
      },
    });
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    });

    acceptInvitationRpcMock.mockResolvedValue({
      data: [{ final_role: "member", membership_changed: true }],
      error: null,
    });
    invitationUpdateMock.mockReturnValue(buildFilterResult());
    fromMock.mockImplementation((table: string) => {
      if (table === "workspace_invitations") {
        return {
          update: invitationUpdateMock,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });
    createServiceRoleClientMock.mockReturnValue({ from: fromMock, rpc: acceptInvitationRpcMock });
    loadInvitationByTokenMock.mockResolvedValue({ ok: true, invitation: pendingInvitation });
  });

  it("accepts a pending invitation through the atomic database function", async () => {
    const response = await postAcceptInvitation(tokenRequest("/api/workspaces/invitations/accept"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      role: "member",
      membershipChanged: true,
    });
    expect(acceptInvitationRpcMock).toHaveBeenCalledWith("accept_workspace_invitation", {
      p_invitation_id: "33333333-3333-4333-8333-333333333333",
      p_workspace_id: "11111111-1111-4111-8111-111111111111",
      p_user_id: "44444444-4444-4444-8444-444444444444",
      p_role: "member",
    });
    expect(invitationUpdateMock).not.toHaveBeenCalled();
  });

  it("upgrades an existing lower-role membership when accepting a higher invitation", async () => {
    acceptInvitationRpcMock.mockResolvedValue({
      data: [{ final_role: "admin", membership_changed: true }],
      error: null,
    });
    loadInvitationByTokenMock.mockResolvedValue({
      ok: true,
      invitation: { ...pendingInvitation, role: "admin" },
    });

    const response = await postAcceptInvitation(tokenRequest("/api/workspaces/invitations/accept"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "admin", membershipChanged: true });
    expect(acceptInvitationRpcMock).toHaveBeenCalledWith(
      "accept_workspace_invitation",
      expect.objectContaining({ p_role: "admin" })
    );
  });

  it("rejects acceptance when the signed-in email does not match the invitation", async () => {
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "44444444-4444-4444-8444-444444444444",
          email: "different@nctc.ca.gov",
        },
      },
    });

    const response = await postAcceptInvitation(tokenRequest("/api/workspaces/invitations/accept"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Invitation email does not match the signed-in user",
    });
    expect(acceptInvitationRpcMock).not.toHaveBeenCalled();
  });

  it("marks expired invitations unavailable on accept", async () => {
    loadInvitationByTokenMock.mockResolvedValue({
      ok: false,
      reason: "expired",
      invitation: pendingInvitation,
    });

    const response = await postAcceptInvitation(tokenRequest("/api/workspaces/invitations/accept"));

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: "Invitation has expired" });
    expect(invitationUpdateMock).toHaveBeenCalledWith({ status: "expired" });
  });

  it("declines a pending invitation without changing membership", async () => {
    const response = await postDeclineInvitation(tokenRequest("/api/workspaces/invitations/decline"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      status: "declined",
    });
    expect(acceptInvitationRpcMock).not.toHaveBeenCalled();
    expect(invitationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "declined",
      })
    );
  });

  it("rejects decline when the signed-in email does not match the invitation", async () => {
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "44444444-4444-4444-8444-444444444444",
          email: "different@nctc.ca.gov",
        },
      },
    });

    const response = await postDeclineInvitation(tokenRequest("/api/workspaces/invitations/decline"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Invitation email does not match the signed-in user",
    });
    expect(invitationUpdateMock).not.toHaveBeenCalled();
  });
});
