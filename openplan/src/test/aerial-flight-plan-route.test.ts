import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashFlightPlanParams } from "@/lib/aerial/camera-registry";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const missionMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const planMaybeSingleMock = vi.fn();
const planUpsertSingleMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Captured so the projection and the written row can be asserted directly. */
let capturedPlanSelects: string[] = [];
let capturedUpserts: Array<{ row: Record<string, unknown>; options: unknown }> = [];

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: missionMaybeSingleMock }) }),
    };
  }
  if (table === "workspace_members") {
    return {
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }),
    };
  }
  if (table === "aerial_flight_plans") {
    return {
      select: (columns: string) => {
        capturedPlanSelects.push(columns);
        return { eq: () => ({ maybeSingle: planMaybeSingleMock }) };
      },
      upsert: (row: Record<string, unknown>, options: unknown) => {
        capturedUpserts.push({ row, options });
        return {
          select: (columns: string) => {
            capturedPlanSelects.push(columns);
            return { single: planUpsertSingleMock };
          },
        };
      },
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as getFlightPlan, PUT as putFlightPlan } from "@/app/api/aerial/missions/[missionId]/flight-plan/route";

const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "00000000-0000-4000-8000-000000000001";

const AOI = { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] };

/**
 * Every column of aerial_flight_plans, by name. Asserted against the
 * projection the route actually sends, because the Supabase clients are
 * untyped: a column dropped from the `.select()` leaves every mocked test
 * green while the real page renders undefined.
 */
const EXPECTED_PROJECTION =
  "id, workspace_id, mission_id, camera_key, target_gsd_cm_per_px, altitude_agl_m, " +
  "front_overlap_pct, side_overlap_pct, speed_m_s, gimbal_pitch_deg, cross_grid, " +
  "boundary_margin_m, corridor_width_m, crew_pilot_name, rth_altitude_m, notes, " +
  "generated_plan, generated_at, generated_with, updated_by, created_at, updated_at";

function context() {
  return { params: Promise.resolve({ missionId: MISSION_ID }) };
}

function getRequest() {
  return new NextRequest(`http://localhost/api/aerial/missions/${MISSION_ID}/flight-plan`);
}

function putRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/aerial/missions/${MISSION_ID}/flight-plan`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** A stored plan row as PostgREST returns it — NUMERIC columns as strings. */
function storedPlanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: WORKSPACE_ID,
    mission_id: MISSION_ID,
    camera_key: "generic-1-inch-20mp",
    target_gsd_cm_per_px: "2",
    altitude_agl_m: null,
    front_overlap_pct: "80",
    side_overlap_pct: "70",
    speed_m_s: "5",
    gimbal_pitch_deg: "-90",
    cross_grid: false,
    boundary_margin_m: "10",
    corridor_width_m: null,
    crew_pilot_name: null,
    rth_altitude_m: null,
    notes: null,
    generated_plan: { schemaVersion: "grid-1", lines: [] },
    generated_at: "2026-08-11T10:00:00Z",
    generated_with: "fnv1a64:0000000000000000",
    updated_by: USER_ID,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T10:00:00Z",
    ...overrides,
  };
}

/** The fingerprint the route must compute for storedPlanRow() under AOI. */
function currentFingerprint() {
  return hashFlightPlanParams({
    aoiGeojson: AOI,
    cameraKey: "generic-1-inch-20mp",
    targetGsdCmPerPx: 2,
    altitudeAglM: null,
    frontOverlapPct: 80,
    sideOverlapPct: 70,
    speedMS: 5,
    gimbalPitchDeg: -90,
    crossGrid: false,
    boundaryMarginM: 10,
    corridorWidthM: null,
  });
}

const VALID_PUT_BODY = {
  cameraKey: "generic-1-inch-20mp",
  targetGsdCmPerPx: 2,
  frontOverlapPct: 80,
  sideOverlapPct: 70,
  speedMS: 5,
  gimbalPitchDeg: -90,
  crossGrid: false,
  boundaryMarginM: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedPlanSelects = [];
  capturedUpserts = [];
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  missionMaybeSingleMock.mockResolvedValue({
    data: { id: MISSION_ID, workspace_id: WORKSPACE_ID, aoi_geojson: AOI },
    error: null,
  });
  membershipMaybeSingleMock.mockResolvedValue({ data: { role: "editor" }, error: null });
  planMaybeSingleMock.mockResolvedValue({ data: null, error: null });
  planUpsertSingleMock.mockResolvedValue({ data: storedPlanRow(), error: null });
});

describe("GET /api/aerial/missions/[missionId]/flight-plan", () => {
  it("answers an honest null when no plan has been authored — not an empty object", async () => {
    const response = await getFlightPlan(getRequest(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ flightPlan: null });
  });

  it("asks the database for every column it returns — the full projection, by name", async () => {
    await getFlightPlan(getRequest(), context());
    expect(capturedPlanSelects).toEqual([EXPECTED_PROJECTION]);
  });

  it("reports a snapshot stale when its fingerprint no longer matches the current parameters", async () => {
    planMaybeSingleMock.mockResolvedValue({
      data: storedPlanRow({ generated_with: "fnv1a64:0000000000000000" }),
      error: null,
    });

    const response = await getFlightPlan(getRequest(), context());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.generatedPlanStale).toBe(true);
  });

  it("reports a snapshot fresh when the fingerprint matches parameters AND mission AOI", async () => {
    planMaybeSingleMock.mockResolvedValue({
      data: storedPlanRow({ generated_with: currentFingerprint() }),
      error: null,
    });

    const response = await getFlightPlan(getRequest(), context());
    const body = await response.json();
    expect(body.generatedPlanStale).toBe(false);
    // And the derived half of the vertical profile is disclosed, not assumed:
    // GSD 2 cm/px on the generic 1-inch class derives 72.96 m (hand-derived).
    expect(body.vertical.cameraKnown).toBe(true);
    expect(body.vertical.profile.basis).toBe("authored_gsd");
    expect(body.vertical.profile.altitudeAglM).toBeCloseTo(72.96, 10);
  });

  it("marks the snapshot stale when only the mission AOI changed", async () => {
    planMaybeSingleMock.mockResolvedValue({
      data: storedPlanRow({ generated_with: currentFingerprint() }),
      error: null,
    });
    missionMaybeSingleMock.mockResolvedValue({
      data: {
        id: MISSION_ID,
        workspace_id: WORKSPACE_ID,
        aoi_geojson: { type: "Polygon", coordinates: [[[0, 0], [0, 2], [2, 2], [0, 0]]] },
      },
      error: null,
    });

    const body = await (await getFlightPlan(getRequest(), context())).json();
    expect(body.generatedPlanStale).toBe(true);
  });

  it("discloses an unknown camera key instead of silently defaulting", async () => {
    planMaybeSingleMock.mockResolvedValue({
      data: storedPlanRow({ camera_key: "renamed-out-of-registry", generated_with: null, generated_plan: null, generated_at: null }),
      error: null,
    });

    const body = await (await getFlightPlan(getRequest(), context())).json();
    expect(body.vertical).toEqual({ cameraKnown: false, profile: null });
  });

  it("denies a non-member", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await getFlightPlan(getRequest(), context());
    expect(response.status).toBe(403);
  });

  it("does not present a failed plan read as an absent plan", async () => {
    planMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const response = await getFlightPlan(getRequest(), context());
    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "aerial_flight_plan_load_failed",
      expect.objectContaining({ missionId: MISSION_ID })
    );
  });
});

describe("PUT /api/aerial/missions/[missionId]/flight-plan", () => {
  it("saves a plan, deriving the snapshot fingerprint server-side from params + mission AOI", async () => {
    const response = await putFlightPlan(
      putRequest({ ...VALID_PUT_BODY, generatedPlan: { schemaVersion: "grid-1", lines: [] } }),
      context()
    );

    expect(response.status).toBe(200);
    expect(capturedUpserts).toHaveLength(1);
    const { row, options } = capturedUpserts[0];
    expect(options).toEqual({ onConflict: "mission_id" });
    expect(row).toMatchObject({
      mission_id: MISSION_ID,
      workspace_id: WORKSPACE_ID,
      camera_key: "generic-1-inch-20mp",
      target_gsd_cm_per_px: 2,
      altitude_agl_m: null,
      front_overlap_pct: 80,
      side_overlap_pct: 70,
      cross_grid: false,
      updated_by: USER_ID,
      generated_plan: { schemaVersion: "grid-1", lines: [] },
      // The fingerprint of exactly what is being saved — never client-supplied.
      generated_with: currentFingerprint(),
    });
    expect(typeof row.generated_at).toBe("string");
    expect(mockAudit.info).toHaveBeenCalledWith(
      "aerial_flight_plan_saved",
      expect.objectContaining({ missionId: MISSION_ID, snapshotIncluded: true })
    );
  });

  it("leaves the stored snapshot untouched when the payload carries none", async () => {
    const response = await putFlightPlan(putRequest(VALID_PUT_BODY), context());
    expect(response.status).toBe(200);
    const { row } = capturedUpserts[0];
    expect("generated_plan" in row).toBe(false);
    expect("generated_at" in row).toBe(false);
    expect("generated_with" in row).toBe(false);
  });

  it("clears the whole snapshot trio when the payload says null", async () => {
    await putFlightPlan(putRequest({ ...VALID_PUT_BODY, generatedPlan: null }), context());
    const { row } = capturedUpserts[0];
    expect(row.generated_plan).toBeNull();
    expect(row.generated_at).toBeNull();
    expect(row.generated_with).toBeNull();
  });

  it("refuses a decoy field outright rather than silently stripping it", async () => {
    // A payload wider than the plan's own fields — the shape by which a narrow
    // write rides a wide route. `.strict()` must refuse, not strip.
    const response = await putFlightPlan(
      putRequest({ ...VALID_PUT_BODY, status: "complete" }),
      context()
    );
    expect(response.status).toBe(400);
    expect(capturedUpserts).toHaveLength(0);
  });

  it("refuses a workspace override decoy the same way", async () => {
    const response = await putFlightPlan(
      putRequest({ ...VALID_PUT_BODY, workspaceId: "55555555-5555-4555-8555-555555555555" }),
      context()
    );
    expect(response.status).toBe(400);
    expect(capturedUpserts).toHaveLength(0);
  });

  it("refuses an unknown camera key and names the ones it knows", async () => {
    const response = await putFlightPlan(
      putRequest({ ...VALID_PUT_BODY, cameraKey: "not-in-registry" }),
      context()
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.knownCameraKeys).toContain("generic-1-inch-20mp");
    expect(capturedUpserts).toHaveLength(0);
  });

  it("refuses an overlap outside the photogrammetric window", async () => {
    const low = await putFlightPlan(putRequest({ ...VALID_PUT_BODY, frontOverlapPct: 30 }), context());
    expect(low.status).toBe(400);
    const high = await putFlightPlan(putRequest({ ...VALID_PUT_BODY, sideOverlapPct: 96 }), context());
    expect(high.status).toBe(400);
    expect(capturedUpserts).toHaveLength(0);
  });

  it("refuses a plan with no vertical intent at all", async () => {
    const body = { ...VALID_PUT_BODY } as Record<string, unknown>;
    delete body.targetGsdCmPerPx;
    const response = await putFlightPlan(putRequest(body), context());
    expect(response.status).toBe(400);
    expect(capturedUpserts).toHaveLength(0);
  });

  it("denies a viewer before touching the table", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    const response = await putFlightPlan(putRequest(VALID_PUT_BODY), context());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/read-only/i);
    expect(capturedUpserts).toHaveLength(0);
  });

  it("denies a non-member", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await putFlightPlan(putRequest(VALID_PUT_BODY), context());
    expect(response.status).toBe(403);
    expect(capturedUpserts).toHaveLength(0);
  });

  it("reports a failed save as a failure", async () => {
    planUpsertSingleMock.mockResolvedValue({ data: null, error: { message: "refused", code: "23514" } });
    const response = await putFlightPlan(putRequest(VALID_PUT_BODY), context());
    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "aerial_flight_plan_save_failed",
      expect.objectContaining({ missionId: MISSION_ID, code: "23514" })
    );
  });
});
