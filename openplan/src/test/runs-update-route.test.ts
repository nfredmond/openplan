import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const runMaybeSingleMock = vi.fn();
const runEqMock = vi.fn(() => ({ maybeSingle: runMaybeSingleMock }));
const runSelectMock = vi.fn(() => ({ eq: runEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const updateEqMock = vi.fn().mockResolvedValue({ error: null });
const updateMock = vi.fn(() => ({ eq: updateEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "runs") {
    return {
      select: runSelectMock,
      update: updateMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
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

import { PATCH as patchRun } from "@/app/api/runs/route";

describe("PATCH /api/runs", () => {
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

    runMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        metrics: {
          overallScore: 75,
        },
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "member",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 400 for invalid payload", async () => {
    const response = await patchRun(
      new NextRequest("http://localhost/api/runs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "nope" }),
      })
    );

    expect(response.status).toBe(400);
  });

  it("persists map view state into run metrics", async () => {
    const response = await patchRun(
      new NextRequest("http://localhost/api/runs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          mapViewState: {
            tractMetric: "poverty",
            showTracts: true,
            showCrashes: true,
            crashSeverityFilter: "fatal",
            crashUserFilter: "pedestrian",
            activeDatasetOverlayId: null,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({
      metrics: expect.objectContaining({
        overallScore: 75,
        mapViewState: expect.objectContaining({
          crashSeverityFilter: "fatal",
          crashUserFilter: "pedestrian",
          tractMetric: "poverty",
        }),
      }),
    });
  });
});
