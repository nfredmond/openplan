import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const runsGetLimitMock = vi.fn();
const runsGetOrderMock = vi.fn(() => ({ limit: runsGetLimitMock }));
const runsGetEqMock = vi.fn(() => ({ order: runsGetOrderMock }));
const runsGetSelectMock = vi.fn(() => ({ eq: runsGetEqMock }));

const runsDeleteLookupMaybeSingleMock = vi.fn();
const runsDeleteLookupEqMock = vi.fn(() => ({ maybeSingle: runsDeleteLookupMaybeSingleMock }));
const runsDeleteLookupSelectMock = vi.fn(() => ({ eq: runsDeleteLookupEqMock }));

const runsDeleteEqMock = vi.fn();
const runsDeleteMock = vi.fn(() => ({ eq: runsDeleteEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }

  if (table === "runs") {
    return {
      select: (fields: string) => {
        if (fields.includes("title") || fields.includes("summary_text")) {
          return runsGetSelectMock();
        }
        return runsDeleteLookupSelectMock();
      },
      delete: runsDeleteMock,
    };
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

import { GET as getRuns, DELETE as deleteRun } from "@/app/api/runs/route";

describe("/api/runs auth + membership guards", () => {
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
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "member" },
      error: null,
    });

    runsGetLimitMock.mockResolvedValue({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          title: "Sample run",
        },
      ],
      error: null,
    });

    runsDeleteLookupMaybeSingleMock.mockResolvedValue({
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workspace_id: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    });

    runsDeleteEqMock.mockResolvedValue({ error: null });
  });

  it("GET returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getRuns(new NextRequest("http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111"));

    expect(response.status).toBe(401);
  });

  it("GET returns 403 when workspace membership is missing", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await getRuns(new NextRequest("http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("GET returns 403 when workspace role is unsupported (deny-by-default)", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "viewer" },
      error: null,
    });

    const response = await getRuns(new NextRequest("http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("GET returns 200 when user is a workspace member", async () => {
    const response = await getRuns(new NextRequest("http://localhost/api/runs?workspaceId=11111111-1111-4111-8111-111111111111"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ runs: expect.any(Array) });
  });

  it("DELETE returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await deleteRun(new NextRequest("http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { method: "DELETE" }));

    expect(response.status).toBe(401);
  });

  it("DELETE returns 404 when run does not exist", async () => {
    runsDeleteLookupMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await deleteRun(new NextRequest("http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { method: "DELETE" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Run not found" });
  });

  it("DELETE returns 403 when user is not a workspace member", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await deleteRun(new NextRequest("http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { method: "DELETE" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("DELETE returns 403 when workspace role is unsupported (deny-by-default)", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: "11111111-1111-4111-8111-111111111111", role: "viewer" },
      error: null,
    });

    const response = await deleteRun(new NextRequest("http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { method: "DELETE" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("DELETE returns 200 when user is authorized", async () => {
    const response = await deleteRun(new NextRequest("http://localhost/api/runs?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
  });
});
