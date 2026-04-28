import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceRoleClientMock = vi.fn();
const recentLimitMock = vi.fn();
const recentOrderMock = vi.fn(() => ({ limit: recentLimitMock }));
const recentGteMock = vi.fn(() => ({ order: recentOrderMock }));
const recentSelectMock = vi.fn(() => ({ gte: recentGteMock }));
const singleMock = vi.fn();
const selectAfterInsertMock = vi.fn(() => ({ single: singleMock }));
const insertMock = vi.fn(() => ({ select: selectAfterInsertMock }));
const fromMock = vi.fn((table: string) => {
  if (table === "access_requests") {
    return { select: recentSelectMock, insert: insertMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { POST } from "@/app/api/request-access/route";
import {
  buildAccessRequestBodyFingerprint,
  buildAccessRequestClientFingerprint,
} from "@/lib/access-requests";

function jsonRequest(payload: unknown, headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/request-access", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Vitest Access Request",
      "x-forwarded-for": "203.0.113.10",
      ...(headers ?? {}),
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const validPayload = {
  agencyName: "Nevada County Transportation Commission",
  contactName: "Nat Ford",
  contactEmail: " Nat.Ford@Agency.GOV ",
  roleTitle: "Planning lead",
  region: "Nevada County",
  organizationType: "rtpa_mpo",
  serviceLane: "managed_hosting_admin",
  deploymentPosture: "nat_ford_managed",
  dataSensitivity: "internal_planning",
  desiredFirstWorkflow: "rtp",
  onboardingNeeds: "Import existing RTP project tables and brief staff leads.",
  expectedWorkspaceName: "NCTC Pilot",
  useCase: "Screen rural transit corridors and prepare grant support material.",
  sourcePath: "/request-access",
};

describe("POST /api/request-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServiceRoleClientMock.mockReturnValue({ from: fromMock });
    recentLimitMock.mockResolvedValue({
      data: [],
      error: null,
    });
    singleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        status: "new",
        created_at: "2026-04-24T12:00:00.000Z",
      },
      error: null,
    });
  });

  it("stores a valid public access request through the service role client", async () => {
    const response = await POST(jsonRequest(validPayload));

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json).toEqual(
      expect.objectContaining({
        success: true,
        requestId: "33333333-3333-4333-8333-333333333333",
        status: "new",
      }),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agency_name: "Nevada County Transportation Commission",
        contact_name: "Nat Ford",
        contact_email: "Nat.Ford@Agency.GOV",
        email_normalized: "nat.ford@agency.gov",
        role_title: "Planning lead",
        region: "Nevada County",
        organization_type: "rtpa_mpo",
        service_lane: "managed_hosting_admin",
        deployment_posture: "nat_ford_managed",
        data_sensitivity: "internal_planning",
        desired_first_workflow: "rtp",
        onboarding_needs: "Import existing RTP project tables and brief staff leads.",
        expected_workspace_name: "NCTC Pilot",
        source_path: "/request-access",
        metadata_json: expect.objectContaining({
          submitted_via: "request_access_form",
          body_fingerprint: expect.any(String),
          source_fingerprint: expect.any(String),
        }),
      }),
    );
    expect(recentSelectMock).toHaveBeenCalledWith("id, created_at, metadata_json");
    expect(recentGteMock).toHaveBeenCalledWith("created_at", expect.any(String));
    expect(recentOrderMock).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(recentLimitMock).toHaveBeenCalledWith(25);
    expect(selectAfterInsertMock).toHaveBeenCalledWith("id, status, created_at");
  });

  it("rejects invalid request bodies before service-role insert", async () => {
    const response = await POST(
      jsonRequest({
        agencyName: "A",
        contactName: "",
        contactEmail: "not-an-email",
        useCase: "short",
      }),
    );

    expect(response.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies before service-role insert", async () => {
    const response = await POST(
      jsonRequest({
        ...validPayload,
        useCase: "x".repeat(17 * 1024),
      }),
    );

    expect(response.status).toBe(413);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("silently accepts honeypot-filled submissions without inserting", async () => {
    const response = await POST(
      jsonRequest({
        ...validPayload,
        website: "https://spam.example",
      }),
    );

    expect(response.status).toBe(201);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("treats duplicate open requests as already received", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint access_requests_one_open_per_email_idx",
      },
    });

    const response = await POST(jsonRequest(validPayload));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(expect.objectContaining({ success: true, duplicate: true }));
  });

  it("rate limits repeated recent requests from the same connection", async () => {
    const request = jsonRequest(validPayload);
    const sourceFingerprint = buildAccessRequestClientFingerprint(request);
    recentLimitMock.mockResolvedValueOnce({
      data: [
        { id: "recent-1", created_at: new Date().toISOString(), metadata_json: { source_fingerprint: sourceFingerprint } },
        { id: "recent-2", created_at: new Date().toISOString(), metadata_json: { source_fingerprint: sourceFingerprint } },
        { id: "recent-3", created_at: new Date().toISOString(), metadata_json: { source_fingerprint: sourceFingerprint } },
      ],
      error: null,
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("treats matching recent request content as already received before inserting", async () => {
    const bodyFingerprint = buildAccessRequestBodyFingerprint(validPayload);
    recentLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "recent-duplicate",
          created_at: new Date().toISOString(),
          metadata_json: { body_fingerprint: bodyFingerprint },
        },
      ],
      error: null,
    });

    const response = await POST(jsonRequest(validPayload));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(expect.objectContaining({ success: true, duplicate: true }));
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns a server error when recent activity cannot be checked", async () => {
    recentLimitMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "XX000",
        message: "recent lookup failed",
      },
    });

    const response = await POST(jsonRequest(validPayload));

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe("Failed to verify recent access request activity");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns a server error when the intake row cannot be stored", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "XX000",
        message: "database unavailable",
      },
    });

    const response = await POST(jsonRequest(validPayload));

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe("Failed to submit access request");
  });
});
