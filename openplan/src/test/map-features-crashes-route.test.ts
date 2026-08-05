import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Acquired crashes as a shared map layer.
 *
 * The defect class this route exists inside is the most dangerous one in the
 * platform: an empty crash map reads as a safe corridor. So the tests here are
 * mostly about what the response SAYS when it carries no features — whether the
 * silence is a coverage gap, an un-run acquisition, an outage, or a real finding
 * about the years that were requested.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CRASH_A = "c0000001-0000-4000-8000-000000000001";
const CRASH_B = "c0000001-0000-4000-8000-000000000002";
const PROJECT_ID = "d0000001-0000-4000-8000-000000000007";

// A workspace whose stated area is inside CCRS's envelope, and one that is not.
// Neither is a constant in the product: both are fixtures standing in for "a
// workspace that stated some geography", which is the only thing the route reads.
const COVERED_WORKSPACE_ROW = {
  home_geography_source: "tigerweb",
  home_geography_label: "Nevada County, CA",
  home_min_lon: -121.3,
  home_min_lat: 39.0,
  home_max_lon: -120.4,
  home_max_lat: 39.5,
};

const UNCOVERED_WORKSPACE_ROW = {
  home_geography_source: "tigerweb",
  home_geography_label: "Franklin County, OH",
  home_min_lon: -83.2,
  home_min_lat: 39.8,
  home_max_lon: -82.8,
  home_max_lat: 40.2,
};

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const crashLimitMock = vi.fn();
const crashOrderIdMock = vi.fn(() => ({ limit: crashLimitMock }));
const crashOrderDateMock = vi.fn(() => ({ order: crashOrderIdMock }));
const crashEqMock = vi.fn(() => ({ order: crashOrderDateMock }));
const crashSelectMock = vi.fn(() => ({ eq: crashEqMock }));

const ingestLimitMock = vi.fn();
const ingestOrderMock = vi.fn(() => ({ limit: ingestLimitMock }));
const ingestEqMock = vi.fn(() => ({ order: ingestOrderMock }));
// Typed to receive its arguments so the select STRING can be asserted: an
// untyped Supabase client makes a missing column a runtime `undefined` rather
// than a compile error, so the column list is a thing tests have to check.
const ingestSelectMock = vi.fn((..._args: unknown[]) => ({ eq: ingestEqMock }));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "workspaces") return { select: workspaceSelectMock };
  if (table === "safety_crashes") return { select: crashSelectMock };
  if (table === "safety_crash_ingests") return { select: ingestSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>(
    "@/lib/workspaces/current"
  );
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) =>
      loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getCrashes } from "@/app/api/map-features/crashes/route";
import { MAP_FEATURE_LAYER_LIMIT } from "@/lib/cartographic/layer-disclosure";

type CrashPayload = {
  type: string;
  features: Array<{ id: string; geometry: { coordinates: number[] }; properties: Record<string, unknown> }>;
  returnedCount: number;
  matchedCount: number;
  droppedCount: number;
  truncated: boolean;
  limit: number;
  scopeState: string;
  acquisitionState: string;
  coverageNotes: string[];
};

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/crashes", { method: "GET" });
}

function asMember() {
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: WORKSPACE_ID, role: "editor" },
    workspace: { id: WORKSPACE_ID, name: "Any agency" },
  });
}

/**
 * A completed acquisition, including the box it actually asked about. The extent
 * is load-bearing: an acquisition takes a caller-supplied bbox and is never
 * clipped to the workspace's home geography, so it is the only record of what
 * the drawn crashes cover.
 */
const READY_INGEST = {
  status: "ready",
  coverage_state: "ccrs_ca_statewide",
  severity_completeness: "fatal_injury_only",
  crash_count: 2,
  geocoded_count: 2,
  min_lon: -121.2,
  min_lat: 39.1,
  max_lon: -120.5,
  max_lat: 39.4,
};

/** The same acquisition, asking about far more ground than the stated area. */
const WIDER_THAN_HOME_INGEST = {
  ...READY_INGEST,
  min_lon: -124.5,
  min_lat: 32.5,
  max_lon: -114.1,
  max_lat: 42.0,
};

describe("GET /api/map-features/crashes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    workspaceMaybeSingleMock.mockResolvedValue({ data: COVERED_WORKSPACE_ROW, error: null });
    crashLimitMock.mockResolvedValue({ data: [], error: null, count: 0 });
    ingestLimitMock.mockResolvedValue({ data: [], error: null, count: 0 });
  });

  it("returns 401 when the request is anonymous", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getCrashes(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("says why it is empty, rather than returning a bare empty layer, with no membership", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getCrashes(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as CrashPayload;
    expect(payload.features).toEqual([]);
    expect(payload.coverageNotes[0]).toContain("no workspace is active");
    expect(crashSelectMock).not.toHaveBeenCalled();
  });

  it("maps acquired crashes to Point features carrying the acquisition's project", async () => {
    asMember();
    crashLimitMock.mockResolvedValue({
      data: [
        {
          id: CRASH_A,
          severity: "fatal",
          collision_date: "2023-08-14",
          collision_year: 2023,
          killed_count: 1,
          injured_count: 0,
          pedestrian_involved: true,
          bicyclist_involved: false,
          latitude: 39.22,
          longitude: -121.06,
          safety_crash_ingests: { project_id: PROJECT_ID },
        },
        {
          // PostgREST can surface DOUBLE PRECISION as strings and a to-one embed
          // as a single-element array; both must coerce rather than crash.
          id: CRASH_B,
          severity: "injury",
          collision_date: null,
          collision_year: "2021",
          killed_count: "0",
          injured_count: "3",
          pedestrian_involved: false,
          bicyclist_involved: true,
          latitude: "39.24",
          longitude: "-121.02",
          safety_crash_ingests: [{ project_id: null }],
        },
      ],
      error: null,
      count: 2,
    });
    ingestLimitMock.mockResolvedValue({ data: [READY_INGEST], error: null, count: 1 });

    const response = await getCrashes(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as CrashPayload;
    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toHaveLength(2);
    expect(payload.features[0].geometry.coordinates).toEqual([-121.06, 39.22]);
    expect(payload.features[0].properties).toEqual({
      kind: "safety_crash",
      crashId: CRASH_A,
      projectId: PROJECT_ID,
      severity: "fatal",
      collisionDate: "2023-08-14",
      collisionYear: 2023,
      killedCount: 1,
      injuredCount: 0,
      pedestrianInvolved: true,
      bicyclistInvolved: false,
    });
    expect(payload.features[1].geometry.coordinates).toEqual([-121.02, 39.24]);
    expect(payload.features[1].properties).toMatchObject({
      projectId: null,
      collisionYear: 2021,
      injuredCount: 3,
      bicyclistInvolved: true,
    });
    expect(payload.scopeState).toBe("covered");
    expect(payload.acquisitionState).toBe("acquired");
    // Scoped to the workspace, and capped like its map-feature siblings.
    expect(crashEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(crashLimitMock).toHaveBeenCalledWith(MAP_FEATURE_LAYER_LIMIT);
  });

  /**
   * The heart of this lane. Crash coverage is state-scoped for anything the
   * database will store, so a workspace outside that footprint must be TOLD it
   * has no acquirable source — an empty layer there would otherwise read as
   * "no crashes here", which is the opposite of what is known.
   */
  it("states the coverage gap, and names the source it checked, outside the storable footprint", async () => {
    asMember();
    workspaceMaybeSingleMock.mockResolvedValue({ data: UNCOVERED_WORKSPACE_ROW, error: null });

    const response = await getCrashes(bareRequest());

    const payload = (await response.json()) as CrashPayload;
    expect(payload.scopeState).toBe("out_of_coverage");
    expect(payload.features).toEqual([]);
    const gap = payload.coverageNotes[0];
    expect(gap).toContain("Franklin County, OH");
    expect(gap).toContain("California Crash Reporting System (CCRS)");
    expect(gap).toContain("This is not evidence that no crashes occurred.");
  });

  it("refuses to claim coverage when the workspace has stated no geography", async () => {
    asMember();
    workspaceMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await getCrashes(bareRequest());

    const payload = (await response.json()) as CrashPayload;
    expect(payload.scopeState).toBe("coverage_unknown");
    expect(payload.coverageNotes[0]).toContain("cannot say whether a crash source covers your area");
  });

  /**
   * THE SAME SENTENCE, MANUFACTURED FROM A FAILED READ.
   *
   * `coverage_unknown` looks like an honest unknown and is not: its copy states
   * that this workspace HAS NOT STATED A HOME GEOGRAPHY and tells the planner to
   * state one on the dashboard. A read that failed saw no row, so it establishes
   * neither half — the area may be set, and a storable source may well cover it.
   * The route already holds that a coverage sentence it cannot build honestly
   * makes the whole layer fail; this read is one of the two the sentence is
   * built from.
   */
  it("refuses rather than reporting an unreadable workspace as one that stated no geography", async () => {
    asMember();
    workspaceMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table workspaces", code: "42501" },
    });

    const response = await getCrashes(bareRequest());

    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("Failed to load the workspace's home geography");
    expect(body.hint).toBe("This is a read failure, not an empty result.");

    // The old claim, gone — and with it the remedy that sent a planner to change
    // a setting the route never managed to read.
    expect(JSON.stringify(body)).not.toContain("has not stated a home geography");
    expect(JSON.stringify(body)).not.toContain("Workspace geography panel");
    expect(body).not.toHaveProperty("scopeState");
    expect(body).not.toHaveProperty("coverageNotes");
    expect(body).not.toHaveProperty("features");

    expect(crashSelectMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "crash_layer_scope_read_failed",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        message: "permission denied for table workspaces",
      })
    );
  });

  it("answers 503, not 500, when the home-geography columns are not migrated yet", async () => {
    asMember();
    workspaceMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "column workspaces.home_min_lon does not exist", code: "42703" },
    });

    const response = await getCrashes(bareRequest());

    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("Workspace geography schema is not available yet");
    expect(JSON.stringify(body)).not.toContain("has not stated a home geography");
    expect(crashSelectMock).not.toHaveBeenCalled();
  });

  /**
   * A Supabase client here is deliberately untyped, so a column left out of the
   * select string is not a type error — it arrives as `undefined` and the
   * comparison it feeds silently answers the wrong question. The acquisition
   * extents are exactly that kind of column, so the select is asserted directly.
   */
  it("asks the acquisition rows for the area they covered", () => {
    asMember();

    return getCrashes(bareRequest()).then(() => {
      const selected = String(ingestSelectMock.mock.calls[0]?.[0] ?? "");
      for (const column of ["min_lon", "min_lat", "max_lon", "max_lat"]) {
        expect(selected, `ingest select is missing ${column}`).toContain(column);
      }
    });
  });

  /**
   * The reachable contradiction. A home geography is optional and most
   * workspaces have none, but an acquisition supplies its own bbox — so a
   * workspace with no stated area can have crashes on screen. The coverage note
   * used to tell that planner the layer was empty for want of a stated area,
   * with red dots in front of them.
   */
  it("describes the drawn crashes rather than calling the layer empty when no geography is stated", async () => {
    asMember();
    workspaceMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    crashLimitMock.mockResolvedValue({
      data: [
        {
          id: CRASH_A,
          severity: "fatal",
          collision_date: "2023-08-14",
          collision_year: 2023,
          killed_count: 1,
          injured_count: 0,
          pedestrian_involved: false,
          bicyclist_involved: false,
          latitude: 39.22,
          longitude: -121.06,
          safety_crash_ingests: { project_id: null },
        },
      ],
      error: null,
      count: 1,
    });
    ingestLimitMock.mockResolvedValue({ data: [READY_INGEST], error: null, count: 1 });

    const payload = (await (await getCrashes(bareRequest())).json()) as CrashPayload;

    expect(payload.scopeState).toBe("coverage_unknown");
    expect(payload.features).toHaveLength(1);
    expect(payload.coverageNotes[0]).toContain("draws only what this workspace has acquired");
    expect(payload.coverageNotes.some((note) => note.includes("An empty crash layer here"))).toBe(
      false
    );
    expect(
      payload.coverageNotes.some((note) => note.includes("beyond what its acquisitions already requested"))
    ).toBe(true);
  });

  /**
   * The other direction: the stated area is narrower than what was acquired, so
   * dots land outside it. Saying nothing would leave a planner reading the layer
   * as bounded by their own jurisdiction when it is not.
   */
  it("says the drawn crashes are not bounded by the stated area when an acquisition reached past it", async () => {
    asMember();
    crashLimitMock.mockResolvedValue({
      data: [
        {
          id: CRASH_B,
          severity: "injury",
          collision_date: "2022-05-01",
          collision_year: 2022,
          killed_count: 0,
          injured_count: 1,
          pedestrian_involved: false,
          bicyclist_involved: false,
          latitude: 34.05,
          longitude: -118.24,
          safety_crash_ingests: { project_id: null },
        },
      ],
      error: null,
      count: 1,
    });
    ingestLimitMock.mockResolvedValue({
      data: [WIDER_THAN_HOME_INGEST],
      error: null,
      count: 1,
    });

    const payload = (await (await getCrashes(bareRequest())).json()) as CrashPayload;

    expect(payload.scopeState).toBe("covered");
    const outside = payload.coverageNotes.find((note) => note.includes("reaching outside"));
    expect(outside).toContain("the completed acquisition on record here");
    expect(outside).toContain("Nevada County, CA");
    expect(outside).toContain("not bounded by the workspace's stated area");
  });

  it("keeps quiet about containment when the acquisition stayed inside the stated area", async () => {
    asMember();
    crashLimitMock.mockResolvedValue({
      data: [
        {
          id: CRASH_A,
          severity: "pdo",
          collision_date: "2024-03-03",
          collision_year: 2024,
          killed_count: 0,
          injured_count: 0,
          pedestrian_involved: false,
          bicyclist_involved: false,
          latitude: 39.22,
          longitude: -121.06,
          safety_crash_ingests: { project_id: null },
        },
      ],
      error: null,
      count: 1,
    });
    ingestLimitMock.mockResolvedValue({ data: [READY_INGEST], error: null, count: 1 });

    const payload = (await (await getCrashes(bareRequest())).json()) as CrashPayload;

    expect(payload.coverageNotes.some((note) => note.includes("reaching outside"))).toBe(false);
    // But the layer still bounds itself to what was acquired.
    expect(payload.coverageNotes[0]).toContain("areas and years its completed acquisitions asked for");
  });

  it("distinguishes an un-run acquisition from one that ran and found nothing", async () => {
    asMember();

    const neverRun = (await (await getCrashes(bareRequest())).json()) as CrashPayload;
    expect(neverRun.acquisitionState).toBe("none");
    expect(neverRun.coverageNotes.some((note) => note.includes("none have been acquired yet"))).toBe(
      true
    );

    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    asMember();
    workspaceMaybeSingleMock.mockResolvedValue({ data: COVERED_WORKSPACE_ROW, error: null });
    crashLimitMock.mockResolvedValue({ data: [], error: null, count: 0 });
    ingestLimitMock.mockResolvedValue({
      data: [{ ...READY_INGEST, crash_count: 0, geocoded_count: 0 }],
      error: null,
      count: 1,
    });

    const ranEmpty = (await (await getCrashes(bareRequest())).json()) as CrashPayload;
    expect(ranEmpty.acquisitionState).toBe("acquired");
    expect(
      ranEmpty.coverageNotes.some((note) => note.includes("stored no mappable collisions"))
    ).toBe(true);
  });

  it("carries the geocoding and severity-completeness caveats from the acquisition record", async () => {
    asMember();
    crashLimitMock.mockResolvedValue({
      data: [
        {
          id: CRASH_A,
          severity: "injury",
          collision_date: "2022-01-05",
          collision_year: 2022,
          killed_count: 0,
          injured_count: 1,
          pedestrian_involved: false,
          bicyclist_involved: false,
          latitude: 39.22,
          longitude: -121.06,
          safety_crash_ingests: { project_id: null },
        },
      ],
      error: null,
      count: 1,
    });
    ingestLimitMock.mockResolvedValue({
      data: [{ ...READY_INGEST, crash_count: 1180, geocoded_count: 916 }],
      error: null,
      count: 1,
    });

    const payload = (await (await getCrashes(bareRequest())).json()) as CrashPayload;

    expect(
      payload.coverageNotes.some((note) =>
        note.includes("Reported crashes that the source agency did not geolocate")
      )
    ).toBe(true);
    // The KSI firewall: no orange dots is not evidence of no serious injuries
    // when the source cannot separate them.
    expect(
      payload.coverageNotes.some((note) => note.includes("killed-or-seriously-injured (KSI)"))
    ).toBe(true);
  });

  it("drops a crash whose coordinates or severity cannot be drawn, and counts the drop", async () => {
    asMember();
    crashLimitMock.mockResolvedValue({
      data: [
        {
          id: CRASH_A,
          severity: "fatal",
          collision_date: "2023-08-14",
          collision_year: 2023,
          killed_count: 1,
          injured_count: 0,
          pedestrian_involved: false,
          bicyclist_involved: false,
          latitude: 39.22,
          longitude: -121.06,
          safety_crash_ingests: { project_id: null },
        },
        {
          id: CRASH_B,
          severity: "unknown_bucket",
          collision_date: "2023-08-15",
          collision_year: 2023,
          killed_count: 0,
          injured_count: 0,
          pedestrian_involved: false,
          bicyclist_involved: false,
          latitude: 39.23,
          longitude: -121.05,
          safety_crash_ingests: { project_id: null },
        },
      ],
      error: null,
      count: 2,
    });
    ingestLimitMock.mockResolvedValue({ data: [READY_INGEST], error: null, count: 1 });

    const payload = (await (await getCrashes(bareRequest())).json()) as CrashPayload;

    expect(payload.features).toHaveLength(1);
    expect(payload.droppedCount).toBe(1);
    expect(payload.truncated).toBe(false);
    expect(
      payload.coverageNotes.some((note) => note.includes("could not be drawn"))
    ).toBe(true);
  });

  it("discloses truncation and names which subset was drawn", async () => {
    asMember();
    crashLimitMock.mockResolvedValue({
      data: [
        {
          id: CRASH_A,
          severity: "pdo",
          collision_date: "2024-02-02",
          collision_year: 2024,
          killed_count: 0,
          injured_count: 0,
          pedestrian_involved: false,
          bicyclist_involved: false,
          latitude: 39.22,
          longitude: -121.06,
          safety_crash_ingests: { project_id: null },
        },
      ],
      error: null,
      count: 48213,
    });
    ingestLimitMock.mockResolvedValue({ data: [READY_INGEST], error: null, count: 1 });

    const payload = (await (await getCrashes(bareRequest())).json()) as CrashPayload;

    expect(payload.truncated).toBe(true);
    expect(payload.matchedCount).toBe(48213);
    expect(
      payload.coverageNotes.some((note) => note.includes("most recent by collision date"))
    ).toBe(true);
  });

  /**
   * A layer that draws crash points whose coverage sentences could not be built
   * is the silent degrade this route exists to prevent. Failing outright makes
   * the backdrop render "could not be loaded, which is not a finding that there
   * are none here" — the only true statement available.
   */
  it("fails the whole layer when the acquisition history cannot be read", async () => {
    asMember();
    crashLimitMock.mockResolvedValue({ data: [], error: null, count: 0 });
    ingestLimitMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "safety_crash_ingests" does not exist', code: "42P01" },
      count: null,
    });

    const response = await getCrashes(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "crash_layer_query_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID })
    );
  });
});
