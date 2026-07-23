import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const ingestMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }),
    }),
  }),
  createServiceRoleClient: () => ({}),
}));

vi.mock("@/lib/safety/ingest", () => ({
  ingestCrashesForStudyArea: (...args: unknown[]) => ingestMock(...args),
}));

import { POST } from "@/app/api/safety/crashes/ingest/route";

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const BBOX = { minLon: -121.3, minLat: 39.1, maxLon: -120.0, maxLat: 39.6 };

function ingestRequest(body: unknown) {
  return new NextRequest("http://localhost/api/safety/crashes/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/safety/crashes/ingest guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
    ingestMock.mockResolvedValue({
      ingestId: "ingest-1",
      status: "ready",
      sourceId: "ccrs-ca",
      sourceLabel: "CCRS",
      coverageState: "ccrs_ca_statewide",
      crashCount: 1180,
      geocodedCount: 1089,
      storedCount: 1089,
      truncated: false,
      yearsCovered: [2025],
      error: null,
    });
  });

  it("400 on malformed JSON", async () => {
    const res = await POST(ingestRequest("{not json"));
    expect(res.status).toBe(400);
  });

  it("400 when required fields are missing", async () => {
    const res = await POST(ingestRequest({ workspaceId: WORKSPACE_ID }));
    expect(res.status).toBe(400);
  });

  it("400 on an inverted bounding box", async () => {
    const res = await POST(
      ingestRequest({
        workspaceId: WORKSPACE_ID,
        bbox: { minLon: -120.0, minLat: 39.6, maxLon: -121.3, maxLat: 39.1 },
        years: [2025],
      })
    );
    expect(res.status).toBe(400);
  });

  it("400 for years before CCRS existed", async () => {
    const res = await POST(
      ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [1999] })
    );
    expect(res.status).toBe(400);
  });

  it("413 when the body exceeds the route's size limit", async () => {
    // Bounded read, per the repo-wide body-limit inventory guard.
    const oversized = { workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025], pad: "x".repeat(20_000) };
    const res = await POST(ingestRequest(oversized));
    expect(res.status).toBe(413);
  });

  it("401 when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025] }));
    expect(res.status).toBe(401);
  });

  it("404 when the caller is not a workspace member", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await POST(ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025] }));
    expect(res.status).toBe(404);
  });

  it("503 when the safety schema is not applied yet", async () => {
    membershipMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "safety_crashes" does not exist' },
    });
    const res = await POST(ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025] }));
    expect(res.status).toBe(503);
  });

  it("200 with reported-vs-mappable counts on success", async () => {
    const res = await POST(ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.crashCount).toBe(1180);
    expect(body.geocodedCount).toBe(1089);
  });

  it("returns 200 (not an HTTP error) for an honest no_coverage outcome", async () => {
    // no_coverage is a state the UI renders, not a failure to report.
    ingestMock.mockResolvedValue({
      ingestId: "ingest-2",
      status: "no_coverage",
      sourceId: null,
      sourceLabel: null,
      coverageState: "out_of_coverage",
      crashCount: 0,
      geocodedCount: 0,
      storedCount: 0,
      truncated: false,
      yearsCovered: [],
      error: null,
    });
    const res = await POST(
      ingestRequest({
        workspaceId: WORKSPACE_ID,
        bbox: { minLon: -83.2, minLat: 42.2, maxLon: -83.0, maxLat: 42.4 },
        years: [2025],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("no_coverage");
    expect(body.coverageState).toBe("out_of_coverage");
  });
});
