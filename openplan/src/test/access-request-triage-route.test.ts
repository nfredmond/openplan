import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const authGetUserMock = vi.fn();

const lookupMaybeSingleMock = vi.fn();
const lookupEqMock = vi.fn(() => ({ maybeSingle: lookupMaybeSingleMock }));
const lookupSelectMock = vi.fn(() => ({ eq: lookupEqMock }));

const rpcSingleMock = vi.fn();
const rpcMock = vi.fn(() => ({ single: rpcSingleMock }));

const serviceFromMock = vi.fn((table: string) => {
  if (table === "access_requests") {
    return { select: lookupSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { POST } from "@/app/api/admin/access-requests/[accessRequestId]/route";

function triageRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/admin/access-requests/44444444-4444-4444-8444-444444444444", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Vitest Access Request Triage",
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function routeContext(accessRequestId = "44444444-4444-4444-8444-444444444444") {
  return {
    params: Promise.resolve({ accessRequestId }),
  };
}

describe("POST /api/admin/access-requests/[accessRequestId]", () => {
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
    lookupMaybeSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "new",
      },
      error: null,
    });
    rpcSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "reviewing",
        reviewed_at: "2026-04-24T12:00:00.000Z",
        review_event_id: "55555555-5555-4555-8555-555555555555",
      },
      error: null,
    });
  });

  it("updates only triage fields for allowlisted reviewers", async () => {
    const response = await POST(triageRequest({ status: "reviewing" }), routeContext());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      success: true,
      request: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "reviewing",
        reviewedAt: "2026-04-24T12:00:00.000Z",
        reviewEventId: "55555555-5555-4555-8555-555555555555",
      },
    });
    expect(lookupSelectMock).toHaveBeenCalledWith("id, status");
    expect(rpcMock).toHaveBeenCalledWith("record_access_request_triage", {
      p_access_request_id: "44444444-4444-4444-8444-444444444444",
      p_previous_status: "new",
      p_status: "reviewing",
      p_reviewer_user_id: "user-1",
    });
    expect(JSON.stringify(json)).not.toContain("nat@example.gov");
  });

  it("rejects unauthenticated requests before service-role access", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await POST(triageRequest({ status: "reviewing" }), routeContext());

    expect(response.status).toBe(401);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects non-allowlisted users before service-role access", async () => {
    authGetUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-2", email: "other@openplan.test" } },
    });

    const response = await POST(triageRequest({ status: "reviewing" }), routeContext());

    expect(response.status).toBe(403);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects invalid ids and unsupported statuses", async () => {
    const invalidIdResponse = await POST(triageRequest({ status: "reviewing" }), routeContext("not-a-uuid"));
    expect(invalidIdResponse.status).toBe(400);

    const invalidStatusResponse = await POST(triageRequest({ status: "provisioned" }), routeContext());
    expect(invalidStatusResponse.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 404 for missing access request rows", async () => {
    lookupMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await POST(triageRequest({ status: "reviewing" }), routeContext());

    expect(response.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects invalid status transitions", async () => {
    lookupMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "contacted",
      },
      error: null,
    });

    const response = await POST(triageRequest({ status: "reviewing" }), routeContext());

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json).toEqual(
      expect.objectContaining({
        error: "Invalid access request status transition",
        currentStatus: "contacted",
        allowedStatuses: ["invited", "deferred", "declined"],
      }),
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns a server error when the update fails", async () => {
    rpcSingleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "XX000",
        message: "update failed",
      },
    });

    const response = await POST(triageRequest({ status: "reviewing" }), routeContext());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe("Failed to update access request status");
  });

  it("returns a conflict when the status changes before the review event is recorded", async () => {
    rpcSingleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "40001",
        message: "Access request status changed before triage could be recorded",
      },
    });

    const response = await POST(triageRequest({ status: "reviewing" }), routeContext());

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error).toBe("Access request status changed before the review event could be recorded");
  });
});
