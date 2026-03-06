import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const decisionsLimitMock = vi.fn();
const decisionsOrderMock = vi.fn(() => ({ limit: decisionsLimitMock }));
const decisionsEqRunMock = vi.fn(() => ({ order: decisionsOrderMock }));
const decisionsEqWorkspaceMock = vi.fn(() => ({
  eq: decisionsEqRunMock,
  order: decisionsOrderMock,
}));
const decisionsSelectMock = vi.fn(() => ({ eq: decisionsEqWorkspaceMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }

  if (table === "stage_gate_decisions") {
    return { select: decisionsSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as getDecisions } from "@/app/api/stage-gates/decisions/route";

describe("GET /api/stage-gates/decisions auth + role guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        role: "member",
      },
      error: null,
    });

    decisionsLimitMock.mockResolvedValue({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          run_id: "33333333-3333-4333-8333-333333333333",
          gate_id: "report_artifact_gate",
          decision: "PASS",
          rationale: "All required artifacts present.",
          missing_artifacts: [],
          metadata: { source: "api.report" },
          decided_by: "22222222-2222-4222-8222-222222222222",
          decided_at: "2026-03-05T20:00:00.000Z",
        },
      ],
      error: null,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getDecisions(
      new NextRequest(
        "http://localhost/api/stage-gates/decisions?workspaceId=11111111-1111-4111-8111-111111111111"
      )
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 403 when workspace membership is missing", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await getDecisions(
      new NextRequest(
        "http://localhost/api/stage-gates/decisions?workspaceId=11111111-1111-4111-8111-111111111111"
      )
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("returns 403 for unsupported role (deny-by-default)", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        role: "viewer",
      },
      error: null,
    });

    const response = await getDecisions(
      new NextRequest(
        "http://localhost/api/stage-gates/decisions?workspaceId=11111111-1111-4111-8111-111111111111"
      )
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("returns 200 with decision rows for workspace member", async () => {
    const response = await getDecisions(
      new NextRequest(
        "http://localhost/api/stage-gates/decisions?workspaceId=11111111-1111-4111-8111-111111111111&limit=25"
      )
    );

    expect(response.status).toBe(200);
    expect(decisionsEqWorkspaceMock).toHaveBeenCalledWith(
      "workspace_id",
      "11111111-1111-4111-8111-111111111111"
    );
    expect(decisionsOrderMock).toHaveBeenCalledWith("decided_at", { ascending: false });
    expect(decisionsLimitMock).toHaveBeenCalledWith(25);
    expect(await response.json()).toMatchObject({ decisions: expect.any(Array) });
  });

  it("filters by runId when provided", async () => {
    const response = await getDecisions(
      new NextRequest(
        "http://localhost/api/stage-gates/decisions?workspaceId=11111111-1111-4111-8111-111111111111&runId=33333333-3333-4333-8333-333333333333"
      )
    );

    expect(response.status).toBe(200);
    expect(decisionsEqRunMock).toHaveBeenCalledWith(
      "run_id",
      "33333333-3333-4333-8333-333333333333"
    );
  });
});
