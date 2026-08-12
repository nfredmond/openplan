import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const projectMaybeSingleMock = vi.fn();
const projectIngestListMock = vi.fn();
const ingestMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: projectMaybeSingleMock }) }) }),
        };
      }
      if (table === "safety_crash_ingests") {
        return {
          select: () => ({ eq: () => ({ eq: projectIngestListMock }) }),
        };
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }),
      };
    },
  }),
  createServiceRoleClient: () => ({}),
}));

vi.mock("@/lib/safety/ingest", () => ({
  ingestCrashesForStudyArea: (...args: unknown[]) => ingestMock(...args),
}));

import { POST } from "@/app/api/safety/crashes/ingest/route";
import { GET } from "@/app/api/safety/crashes/route";

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const PROJECT_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
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
    projectMaybeSingleMock.mockResolvedValue({ data: { id: PROJECT_ID }, error: null });
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

  it("does not encode one source's calendar in the transport layer", async () => {
    // The route must stay jurisdiction- and source-neutral: clamping a year
    // range to CCRS's 2016 start here would mean editing this route to add any
    // other state or data source. The ADAPTER owns that limit and clamps
    // against its own live manifest.
    const res = await POST(
      ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [1999] })
    );
    expect(res.status).toBe(200);
    expect(ingestMock).toHaveBeenCalled();
  });

  it("still rejects years that are not plausible calendar years", async () => {
    const res = await POST(
      ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [3500] })
    );
    expect(res.status).toBe(400);
  });

  it("accepts any positive subdivision code, leaving validity to the adapter", async () => {
    // A max of 58 would have hardcoded California's county count into the API.
    const res = await POST(
      ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025], countyCode: 201 })
    );
    expect(res.status).toBe(200);
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

  /**
   * A VIEWER MAY READ CRASHES THEY MAY NOT STORE.
   *
   * This route used to answer a viewer 403 outright. It is the ONLY door into
   * the crash lane, and the lane's read-only path (FARS today) writes nothing —
   * so a viewer anywhere a storable source does not reach, i.e. every state but
   * California, saw no crash data at all from a request that would have stored
   * nothing. Restriction standing in for a permission the request never needed.
   *
   * The route no longer predicts which branch the lane will take; it passes the
   * capability down and the lane refuses at each write. These two tests pin the
   * route's half of that seam — the lane's half is in
   * `safety-read-only-lane.test.ts`, where the writes are actually counted.
   */
  it("lets a viewer through, telling the lane it may not store", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });

    const res = await POST(ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025] }));

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledWith(expect.objectContaining({ mayStore: false }));
  });

  it("tells the lane an editor may store", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "member" }, error: null });

    const res = await POST(ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025] }));

    expect(res.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledWith(expect.objectContaining({ mayStore: true }));
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

  it("accepts a workspace-owned projectId and passes it to the ingest", async () => {
    const res = await POST(
      ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025], projectId: PROJECT_ID })
    );
    expect(res.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID })
    );
  });

  it("400 when projectId is not a UUID", async () => {
    const res = await POST(
      ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025], projectId: "not-a-uuid" })
    );
    expect(res.status).toBe(400);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("404 when the linked project does not belong to the workspace", async () => {
    projectMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await POST(
      ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025], projectId: PROJECT_ID })
    );
    expect(res.status).toBe(404);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("500 when the linked-project lookup fails", async () => {
    projectMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(
      ingestRequest({ workspaceId: WORKSPACE_ID, bbox: BBOX, years: [2025], projectId: PROJECT_ID })
    );
    expect(res.status).toBe(500);
    expect(ingestMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/safety/crashes project filter", () => {
  const crashQuery = (extra: string) =>
    new NextRequest(
      `http://localhost/api/safety/crashes?workspaceId=${WORKSPACE_ID}&minLon=-121.3&minLat=39.1&maxLon=-120&maxLat=39.6${extra}`
    );

  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
  });

  it("400 when projectId is not a UUID", async () => {
    const res = await GET(crashQuery("&projectId=nope"));
    expect(res.status).toBe(400);
  });

  it("returns an honest empty collection when the project has no acquisitions", async () => {
    projectIngestListMock.mockResolvedValue({ data: [], error: null });
    const res = await GET(crashQuery(`&projectId=${PROJECT_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.features).toEqual([]);
    expect(body.returnedCount).toBe(0);
    expect(body.matchedCount).toBe(0);
    expect(body.truncated).toBe(false);
  });

  it("500 when the project's acquisitions cannot be resolved", async () => {
    projectIngestListMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(crashQuery(`&projectId=${PROJECT_ID}`));
    expect(res.status).toBe(500);
  });
});

/**
 * THE FILTERS AS A PLANNER'S BROWSER ACTUALLY SENDS THEM.
 *
 * `one-crash-filter-definition.test.ts` proves the two interpreters agree; this
 * proves the route is wired to one of them. The parameter names come from the
 * facet registry, so `mode` (a single-choice enum over two of the three
 * involvement flags) is gone and `involvement` (a multi-select over all three,
 * motorcyclists included) has taken its place.
 */
describe("GET /api/safety/crashes facet parameters", () => {
  const crashQuery = (extra: string) =>
    new NextRequest(
      `http://localhost/api/safety/crashes?workspaceId=${WORKSPACE_ID}&minLon=-121.3&minLat=39.1&maxLon=-120&maxLat=39.6${extra}`
    );

  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
  });

  it("400s on a severity outside the vocabulary instead of silently unfiltering", async () => {
    // Quietly dropping an unrecognised filter is how a planner reads a total for
    // a population they never asked for.
    expect((await GET(crashQuery("&severity=fatal,catastrophic"))).status).toBe(400);
  });

  it("400s on an involvement value outside the vocabulary", async () => {
    expect((await GET(crashQuery("&involvement=scooterist"))).status).toBe(400);
  });

  it("accepts the neutral dimensions the vocabulary declares", async () => {
    for (const query of [
      "&severity=fatal,unknown",
      "&lighting=dark_unlighted",
      "&weather=rain,fog",
      "&collision_type=vehicle_pedestrian",
      "&involvement=pedestrian,bicyclist,motorcyclist",
    ]) {
      const res = await GET(crashQuery(query));
      expect(res.status, `${query} was rejected`).not.toBe(400);
    }
  });
});
