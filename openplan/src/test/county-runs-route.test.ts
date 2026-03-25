import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const fromMock = vi.fn();
const querySelectMock = vi.fn();
const queryEqMock = vi.fn();
const queryOrderMock = vi.fn();
const queryLimitMock = vi.fn();
const insertMock = vi.fn();
const insertSelectMock = vi.fn();
const insertSingleMock = vi.fn();

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

import { GET as getCountyRuns, POST as postCountyRuns } from "@/app/api/county-runs/route";

function jsonRequest(method: "GET" | "POST", url: string, payload?: unknown) {
  return new NextRequest(url, {
    method,
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
}

describe("/api/county-runs route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "123e4567-e89b-12d3-a456-426614174000" },
      },
    });

    queryLimitMock.mockResolvedValue({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          geography_label: "Nevada County, CA",
          geography_id: "06057",
          run_name: "nevada-run",
          stage: "validated-screening",
          status_label: "bounded screening-ready",
          enqueue_status: "queued_stub",
          last_enqueued_at: "2026-03-24T23:05:00Z",
          updated_at: "2026-03-24T23:00:00Z",
        },
      ],
      error: null,
    });
    queryOrderMock.mockReturnValue({ limit: queryLimitMock });
    queryEqMock.mockReturnValue({ eq: queryEqMock, order: queryOrderMock, limit: queryLimitMock });
    querySelectMock.mockReturnValue({ eq: queryEqMock, order: queryOrderMock, limit: queryLimitMock });

    insertSingleMock.mockResolvedValue({
      data: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        run_name: "placer-run",
        stage: "bootstrap-incomplete",
      },
      error: null,
    });
    insertSelectMock.mockReturnValue({ single: insertSingleMock });
    insertMock.mockReturnValue({ select: insertSelectMock });

    fromMock.mockImplementation((table: string) => {
      if (table === "county_runs") {
        return {
          select: querySelectMock,
          insert: insertMock,
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("lists county runs for a workspace", async () => {
    const response = await getCountyRuns(
      jsonRequest("GET", "http://localhost/api/county-runs?workspaceId=11111111-1111-4111-8111-111111111111")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          geographyLabel: "Nevada County, CA",
          runName: "nevada-run",
          stage: "validated-screening",
          statusLabel: "bounded screening-ready",
          enqueueStatus: "queued_stub",
          lastEnqueuedAt: "2026-03-24T23:05:00Z",
          updatedAt: "2026-03-24T23:00:00Z",
        },
      ],
    });
  });

  it("returns 400 when workspaceId is missing on GET", async () => {
    const response = await getCountyRuns(jsonRequest("GET", "http://localhost/api/county-runs"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "workspaceId is required" });
  });

  it("creates a county run", async () => {
    const response = await postCountyRuns(
      jsonRequest("POST", "http://localhost/api/county-runs", {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        geographyType: "county_fips",
        geographyId: "06061",
        geographyLabel: "Placer County, CA",
        runName: "placer-run",
        runtimeOptions: {
          keepProject: true,
        },
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      stage: "bootstrap-incomplete",
      runName: "placer-run",
      workerPayload: {
        countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        geographyId: "06061",
        geographyLabel: "Placer County, CA",
        countyPrefix: "PLACER",
        callback: {
          manifestIngestUrl: "http://localhost/api/county-runs/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/manifest",
        },
      },
    });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "11111111-1111-4111-8111-111111111111",
        geography_id: "06061",
        run_name: "placer-run",
        stage: "bootstrap-incomplete",
        requested_runtime_json: expect.objectContaining({
          countyPrefix: "PLACER",
        }),
      })
    );
  });

  it("returns 400 for invalid POST payload", async () => {
    const response = await postCountyRuns(
      jsonRequest("POST", "http://localhost/api/county-runs", {
        geographyType: "county_fips",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const getResponse = await getCountyRuns(
      jsonRequest("GET", "http://localhost/api/county-runs?workspaceId=11111111-1111-4111-8111-111111111111")
    );
    const postResponse = await postCountyRuns(
      jsonRequest("POST", "http://localhost/api/county-runs", {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        geographyType: "county_fips",
        geographyId: "06061",
        geographyLabel: "Placer County, CA",
        runName: "placer-run",
      })
    );

    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
  });
});
