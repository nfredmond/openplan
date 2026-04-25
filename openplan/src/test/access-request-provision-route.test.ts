import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const authGetUserMock = vi.fn();
const auditInfoMock = vi.fn();
const auditWarnMock = vi.fn();
const auditErrorMock = vi.fn();
const applyBillingSubscriptionMutationMock = vi.fn();
const createWorkspaceInvitationMock = vi.fn();

const accessMaybeSingleMock = vi.fn();
const accessEqMock = vi.fn(() => ({ maybeSingle: accessMaybeSingleMock }));
const accessSelectMock = vi.fn(() => ({ eq: accessEqMock }));

const workspaceInsertMock = vi.fn();
const workspaceSelectMock = vi.fn();
const workspaceSingleMock = vi.fn();
const workspaceDeleteEqMock = vi.fn();
const workspaceDeleteMock = vi.fn(() => ({ eq: workspaceDeleteEqMock }));
const memberDeleteEqMock = vi.fn();
const memberDeleteMock = vi.fn(() => ({ eq: memberDeleteEqMock }));
const invitationDeleteEqMock = vi.fn();
const invitationDeleteMock = vi.fn(() => ({ eq: invitationDeleteEqMock }));

const rpcSingleMock = vi.fn();
const rpcMock = vi.fn(() => ({ single: rpcSingleMock }));

const serviceFromMock = vi.fn((table: string) => {
  if (table === "access_requests") return { select: accessSelectMock };
  if (table === "workspaces") return { insert: workspaceInsertMock, delete: workspaceDeleteMock };
  if (table === "workspace_members") return { delete: memberDeleteMock };
  if (table === "workspace_invitations") return { delete: invitationDeleteMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({
    info: auditInfoMock,
    warn: auditWarnMock,
    error: auditErrorMock,
  }),
}));

vi.mock("@/lib/billing/subscriptions", () => ({
  applyBillingSubscriptionMutation: (...args: unknown[]) => applyBillingSubscriptionMutationMock(...args),
}));

vi.mock("@/lib/workspaces/invitations", () => ({
  createWorkspaceInvitation: (...args: unknown[]) => createWorkspaceInvitationMock(...args),
}));

import { POST } from "@/app/api/admin/access-requests/[accessRequestId]/provision/route";

function provisionRequest(payload: unknown) {
  return new NextRequest(
    "http://localhost/api/admin/access-requests/44444444-4444-4444-8444-444444444444/provision",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Vitest Access Request Provision",
      },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    },
  );
}

function routeContext(accessRequestId = "44444444-4444-4444-8444-444444444444") {
  return {
    params: Promise.resolve({ accessRequestId }),
  };
}

describe("POST /api/admin/access-requests/[accessRequestId]/provision", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS", "operator@openplan.test");

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "operator@openplan.test",
        },
      },
    });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock } });
    createServiceRoleClientMock.mockReturnValue({ from: serviceFromMock, rpc: rpcMock });

    accessMaybeSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "contacted",
        provisioned_workspace_id: null,
        agency_name: "Nevada County Transportation Commission",
        contact_email: "owner@nctc.ca.gov",
        expected_workspace_name: "NCTC Pilot",
      },
      error: null,
    });

    workspaceSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "nctc-pilot-workspace",
        name: "NCTC Pilot Workspace",
        plan: "pilot",
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
      },
      error: null,
    });
    workspaceSelectMock.mockReturnValue({ single: workspaceSingleMock });
    workspaceInsertMock.mockReturnValue({ select: workspaceSelectMock });
    workspaceDeleteEqMock.mockResolvedValue({ error: null });
    memberDeleteEqMock.mockResolvedValue({ error: null });
    invitationDeleteEqMock.mockResolvedValue({ error: null });

    applyBillingSubscriptionMutationMock.mockResolvedValue({ error: null, ledgerMissing: false });
    createWorkspaceInvitationMock.mockResolvedValue({
      invitation: {
        id: "33333333-3333-4333-8333-333333333333",
        email: "owner@nctc.ca.gov",
        role: "owner",
        expires_at: "2026-05-08T12:00:00.000Z",
      },
      invitationUrl: "http://localhost/sign-up?invite=test-token&redirect=%2Fdashboard",
    });
    rpcSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "provisioned",
        reviewed_at: "2026-04-24T12:00:00.000Z",
        review_event_id: "55555555-5555-4555-8555-555555555555",
        provisioned_workspace_id: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    });
  });

  it("provisions a pilot workspace, creates an owner invite, and records the access-request link", async () => {
    const response = await POST(
      provisionRequest({ workspaceName: "NCTC Pilot Workspace" }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json).toEqual({
      success: true,
      sideEffects: {
        reviewEventRecorded: true,
        outboundEmailSent: false,
        workspaceProvisioned: true,
        ownerInvitationCreated: true,
      },
      request: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "provisioned",
        reviewedAt: "2026-04-24T12:00:00.000Z",
        reviewEventId: "55555555-5555-4555-8555-555555555555",
        provisionedWorkspaceId: "11111111-1111-4111-8111-111111111111",
      },
      workspace: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "nctc-pilot-workspace",
        name: "NCTC Pilot Workspace",
        plan: "pilot",
      },
      ownerInvitation: {
        id: "33333333-3333-4333-8333-333333333333",
        expiresAt: "2026-05-08T12:00:00.000Z",
        invitationUrl: "http://localhost/sign-up?invite=test-token&redirect=%2Fdashboard",
        delivery: "manual",
      },
    });
    expect(accessSelectMock).toHaveBeenCalledWith(
      "id, status, provisioned_workspace_id, agency_name, contact_email, expected_workspace_name",
    );
    expect(workspaceInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "NCTC Pilot Workspace",
        slug: "nctc-pilot-workspace",
        plan: "pilot",
      }),
    );
    expect(applyBillingSubscriptionMutationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        subscriptionPlan: "pilot",
        subscriptionStatus: "pilot",
        metadata: {
          source: "access_request_provisioning",
          accessRequestId: "44444444-4444-4444-8444-444444444444",
        },
      }),
    );
    expect(createWorkspaceInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        email: "owner@nctc.ca.gov",
        role: "owner",
        invitedByUserId: "user-1",
        origin: "http://localhost",
      }),
    );
    expect(rpcMock).toHaveBeenCalledWith("record_access_request_provisioning", {
      p_access_request_id: "44444444-4444-4444-8444-444444444444",
      p_previous_status: "contacted",
      p_workspace_id: "11111111-1111-4111-8111-111111111111",
      p_owner_invitation_id: "33333333-3333-4333-8333-333333333333",
      p_reviewer_user_id: "user-1",
    });
    expect(auditInfoMock).toHaveBeenCalledWith(
      "access_request_workspace_provisioned",
      expect.objectContaining({
        ownerInvitationId: "33333333-3333-4333-8333-333333333333",
        sideEffects: {
          reviewEventRecorded: true,
          outboundEmailSent: false,
          workspaceProvisioned: true,
          ownerInvitationCreated: true,
        },
      }),
    );
    expect(JSON.stringify(json)).not.toContain("owner@nctc.ca.gov");
  });

  it("rejects unauthenticated requests before service-role access", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await POST(provisionRequest({ workspaceName: "NCTC Pilot" }), routeContext());

    expect(response.status).toBe(401);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("rejects non-allowlisted users before service-role access", async () => {
    authGetUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-2", email: "other@openplan.test" } },
    });

    const response = await POST(provisionRequest({ workspaceName: "NCTC Pilot" }), routeContext());

    expect(response.status).toBe(403);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("rejects invalid ids and payloads", async () => {
    const invalidIdResponse = await POST(provisionRequest({ workspaceName: "NCTC Pilot" }), routeContext("not-a-uuid"));
    expect(invalidIdResponse.status).toBe(400);

    const invalidJsonResponse = await POST(provisionRequest("{"), routeContext());
    expect(invalidJsonResponse.status).toBe(400);

    const invalidPayloadResponse = await POST(provisionRequest({ plan: "professional" }), routeContext());
    expect(invalidPayloadResponse.status).toBe(400);
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("returns 404 for missing access request rows", async () => {
    accessMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(provisionRequest({ workspaceName: "NCTC Pilot" }), routeContext());

    expect(response.status).toBe(404);
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("rejects requests that are not ready for provisioning", async () => {
    accessMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "reviewing",
        provisioned_workspace_id: null,
        agency_name: "Nevada County Transportation Commission",
        contact_email: "owner@nctc.ca.gov",
        expected_workspace_name: "NCTC Pilot",
      },
      error: null,
    });

    const response = await POST(provisionRequest({ workspaceName: "NCTC Pilot" }), routeContext());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: "Access request is not ready for workspace provisioning",
        currentStatus: "reviewing",
        allowedStatuses: ["contacted", "invited"],
      }),
    );
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("rejects requests that are already linked to a workspace", async () => {
    accessMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "provisioned",
        provisioned_workspace_id: "11111111-1111-4111-8111-111111111111",
        agency_name: "Nevada County Transportation Commission",
        contact_email: "owner@nctc.ca.gov",
        expected_workspace_name: "NCTC Pilot",
      },
      error: null,
    });

    const response = await POST(provisionRequest({ workspaceName: "NCTC Pilot" }), routeContext());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: "Access request is already linked to a provisioned workspace",
        provisionedWorkspaceId: "11111111-1111-4111-8111-111111111111",
      }),
    );
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("cleans up a partially provisioned workspace when billing fails", async () => {
    applyBillingSubscriptionMutationMock.mockResolvedValueOnce({
      error: { message: "billing insert failed" },
      ledgerMissing: false,
    });

    const response = await POST(provisionRequest({ workspaceName: "NCTC Pilot" }), routeContext());

    expect(response.status).toBe(500);
    expect(memberDeleteEqMock).toHaveBeenCalledWith(
      "workspace_id",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(invitationDeleteEqMock).toHaveBeenCalledWith(
      "workspace_id",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(workspaceDeleteEqMock).toHaveBeenCalledWith("id", "11111111-1111-4111-8111-111111111111");
  });

  it("cleans up and returns a conflict when the access request changes before the link is recorded", async () => {
    rpcSingleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "40001",
        message: "Access request status changed before provisioning could be recorded",
      },
    });

    const response = await POST(provisionRequest({ workspaceName: "NCTC Pilot" }), routeContext());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Access request status changed before provisioning could be recorded",
    });
    expect(memberDeleteEqMock).toHaveBeenCalledWith(
      "workspace_id",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(workspaceDeleteEqMock).toHaveBeenCalledWith("id", "11111111-1111-4111-8111-111111111111");
  });
});
