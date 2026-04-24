import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const applyBillingSubscriptionMutationMock = vi.fn();
const createWorkspaceInvitationMock = vi.fn();

const workspaceInsertMock = vi.fn();
const workspaceSelectMock = vi.fn();
const workspaceSingleMock = vi.fn();
const workspaceDeleteEqMock = vi.fn();
const workspaceDeleteMock = vi.fn();
const memberInsertMock = vi.fn();
const memberDeleteEqMock = vi.fn();
const memberDeleteMock = vi.fn();
const invitationDeleteEqMock = vi.fn();
const invitationDeleteMock = vi.fn();
const fromMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/billing/subscriptions", () => ({
  applyBillingSubscriptionMutation: (...args: unknown[]) => applyBillingSubscriptionMutationMock(...args),
}));

vi.mock("@/lib/workspaces/invitations", () => ({
  createWorkspaceInvitation: (...args: unknown[]) => createWorkspaceInvitationMock(...args),
}));

import { POST as postProvisionWorkspace } from "@/app/api/admin/workspaces/provision/route";

function provisionRequest(payload: unknown, secret = "provision-secret") {
  return new NextRequest("http://localhost/api/admin/workspaces/provision", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/admin/workspaces/provision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENPLAN_WORKSPACE_PROVISIONING_SECRET = "provision-secret";

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    workspaceSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "nevada-county-transportation-commission",
        name: "Nevada County Transportation Commission",
        plan: "pilot",
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
      },
      error: null,
    });
    workspaceSelectMock.mockReturnValue({ single: workspaceSingleMock });
    workspaceInsertMock.mockReturnValue({ select: workspaceSelectMock });
    workspaceDeleteEqMock.mockResolvedValue({ error: null });
    workspaceDeleteMock.mockReturnValue({ eq: workspaceDeleteEqMock });
    memberInsertMock.mockResolvedValue({ error: null });
    memberDeleteEqMock.mockResolvedValue({ error: null });
    memberDeleteMock.mockReturnValue({ eq: memberDeleteEqMock });
    invitationDeleteEqMock.mockResolvedValue({ error: null });
    invitationDeleteMock.mockReturnValue({ eq: invitationDeleteEqMock });

    fromMock.mockImplementation((table: string) => {
      if (table === "workspaces") return { insert: workspaceInsertMock, delete: workspaceDeleteMock };
      if (table === "workspace_members") return { insert: memberInsertMock, delete: memberDeleteMock };
      if (table === "workspace_invitations") return { delete: invitationDeleteMock };
      throw new Error(`Unexpected table: ${table}`);
    });

    createServiceRoleClientMock.mockReturnValue({ from: fromMock });
    applyBillingSubscriptionMutationMock.mockResolvedValue({ error: null, ledgerMissing: false });
    createWorkspaceInvitationMock.mockResolvedValue({
      invitation: {
        id: "33333333-3333-4333-8333-333333333333",
        email: "owner@nctc.ca.gov",
        role: "owner",
        expires_at: "2026-05-08T12:00:00.000Z",
      },
      invitationUrl: "http://localhost/sign-up?invite=token&redirect=%2Fdashboard",
    });
  });

  it("returns 503 when the operator secret is not configured", async () => {
    delete process.env.OPENPLAN_WORKSPACE_PROVISIONING_SECRET;

    const response = await postProvisionWorkspace(
      provisionRequest({
        workspaceName: "Nevada County Transportation Commission",
        ownerEmail: "owner@nctc.ca.gov",
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Workspace provisioning is not configured" });
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the operator secret does not match", async () => {
    const response = await postProvisionWorkspace(
      provisionRequest(
        {
          workspaceName: "Nevada County Transportation Commission",
          ownerEmail: "owner@nctc.ca.gov",
        },
        "wrong-secret"
      )
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("provisions a workspace with a direct owner membership and billing snapshot", async () => {
    const response = await postProvisionWorkspace(
      provisionRequest({
        workspaceName: "Nevada County Transportation Commission",
        ownerUserId: "22222222-2222-4222-8222-222222222222",
        plan: "professional",
        subscriptionStatus: "trialing",
        stripeCustomerId: "cus_123",
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      ownerMembershipCreated: true,
      ownerInvitation: null,
      plan: "professional",
      subscriptionStatus: "trialing",
    });
    expect(memberInsertMock).toHaveBeenCalledWith({
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      role: "owner",
    });
    expect(applyBillingSubscriptionMutationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        subscriptionPlan: "professional",
        subscriptionStatus: "trialing",
        stripeCustomerId: "cus_123",
      })
    );
  });

  it("provisions an owner invitation without sending email", async () => {
    const response = await postProvisionWorkspace(
      provisionRequest({
        workspaceName: "Nevada County Transportation Commission",
        ownerEmail: "owner@nctc.ca.gov",
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      ownerMembershipCreated: false,
      ownerInvitation: {
        email: "owner@nctc.ca.gov",
        role: "owner",
        delivery: "manual",
      },
    });
    expect(memberInsertMock).not.toHaveBeenCalled();
    expect(createWorkspaceInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        email: "owner@nctc.ca.gov",
        role: "owner",
        origin: "http://localhost",
      })
    );
  });

  it("cleans up a partially provisioned workspace when billing snapshot creation fails", async () => {
    applyBillingSubscriptionMutationMock.mockResolvedValue({
      error: { message: "billing insert failed" },
      ledgerMissing: false,
    });

    const response = await postProvisionWorkspace(
      provisionRequest({
        workspaceName: "Nevada County Transportation Commission",
        ownerUserId: "22222222-2222-4222-8222-222222222222",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to provision workspace" });
    expect(memberDeleteEqMock).toHaveBeenCalledWith(
      "workspace_id",
      "11111111-1111-4111-8111-111111111111"
    );
    expect(invitationDeleteEqMock).toHaveBeenCalledWith(
      "workspace_id",
      "11111111-1111-4111-8111-111111111111"
    );
    expect(workspaceDeleteEqMock).toHaveBeenCalledWith("id", "11111111-1111-4111-8111-111111111111");
  });
});
