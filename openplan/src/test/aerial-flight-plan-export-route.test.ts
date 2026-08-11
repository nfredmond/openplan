import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import { hashFlightPlanParams } from "@/lib/aerial/camera-registry";
import { FLIGHT_SNAPSHOT_SCHEMA_VERSION } from "@/lib/aerial/flight-exports";

/**
 * The flight-plan export route: downloads are built from the SAVED, REVIEWED
 * snapshot — never regenerated — so the load-bearing behavior is its three
 * refusals (no snapshot, stale snapshot, unusable snapshot) plus membership.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const missionMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const planMaybeSingleMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") {
    return { select: () => ({ eq: () => ({ maybeSingle: missionMaybeSingleMock }) }) };
  }
  if (table === "workspace_members") {
    return {
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }),
    };
  }
  if (table === "aerial_flight_plans") {
    return { select: () => ({ eq: () => ({ maybeSingle: planMaybeSingleMock }) }) };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as exportFlightPlan } from "@/app/api/aerial/missions/[missionId]/flight-plan/export/route";

const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "00000000-0000-4000-8000-000000000001";

const AOI = { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] };

function context() {
  return { params: Promise.resolve({ missionId: MISSION_ID }) };
}

function request(format: string | null) {
  const url = new URL(`http://localhost/api/aerial/missions/${MISSION_ID}/flight-plan/export`);
  if (format !== null) url.searchParams.set("format", format);
  return new NextRequest(url);
}

/** A 2-line, 5-photo snapshot, matching the flight-exports fixture scale. */
function snapshotJson() {
  return {
    schemaVersion: FLIGHT_SNAPSHOT_SCHEMA_VERSION,
    altitudeM: 100,
    gsdCm: 2.74,
    footprintWidthM: 149.9,
    footprintHeightM: 99.9,
    lineSpacingM: 52.5,
    actualLineSpacingM: 52.5,
    photoSpacingM: 25,
    lines: [
      {
        index: 0,
        grid: "primary",
        start: [10.0, 45.0],
        end: [10.001, 45.0],
        headingDeg: 90,
        lengthM: 78.6,
        photoPoints: [
          [10.0, 45.0],
          [10.0005, 45.0],
          [10.001, 45.0],
        ],
      },
      {
        index: 1,
        grid: "primary",
        start: [10.001, 45.0005],
        end: [10.0, 45.0005],
        headingDeg: 270,
        lengthM: 78.6,
        photoPoints: [
          [10.001, 45.0005],
          [10.0, 45.0005],
        ],
      },
    ],
    lineCount: 2,
    photoCount: 5,
    totalFlightDistanceM: 212.8,
    estimatedDurationSeconds: 34.6,
    estimatedBatteryLegs: 1,
    coverageAreaM2: 4368,
    flightAxisDeg: 90,
    assumptions: ["assumption one"],
    input: { speedMps: 8, flightMinutesPerBattery: 20, turnAllowanceSeconds: 8 },
  };
}

/** The fingerprint the route recomputes for freshPlanRow() under AOI. */
function currentFingerprint() {
  return hashFlightPlanParams({
    aoiGeojson: AOI,
    cameraKey: "generic-1-inch-20mp",
    targetGsdCmPerPx: 2.74,
    altitudeAglM: null,
    frontOverlapPct: 80,
    sideOverlapPct: 65,
    speedMS: 8,
    gimbalPitchDeg: -90,
    crossGrid: false,
    boundaryMarginM: 10,
    corridorWidthM: null,
  });
}

/** As PostgREST returns it — NUMERIC columns arrive as strings. */
function freshPlanRow(overrides: Record<string, unknown> = {}) {
  return {
    camera_key: "generic-1-inch-20mp",
    target_gsd_cm_per_px: "2.74",
    altitude_agl_m: null,
    front_overlap_pct: "80",
    side_overlap_pct: "65",
    speed_m_s: "8",
    gimbal_pitch_deg: "-90",
    cross_grid: false,
    boundary_margin_m: "10",
    corridor_width_m: null,
    generated_plan: snapshotJson(),
    generated_with: currentFingerprint(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  missionMaybeSingleMock.mockResolvedValue({
    data: { id: MISSION_ID, workspace_id: WORKSPACE_ID, title: "Riverfront Survey", aoi_geojson: AOI },
    error: null,
  });
  membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
  planMaybeSingleMock.mockResolvedValue({ data: freshPlanRow(), error: null });
});

describe("GET /api/aerial/missions/[missionId]/flight-plan/export", () => {
  it("refuses an unknown format and names the three real ones", async () => {
    const response = await exportFlightPlan(request("dji-json"), context());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("wpml");
    expect(body.error).toContain("litchi");
    expect(body.error).toContain("kml");
  });

  it("requires a session", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const response = await exportFlightPlan(request("kml"), context());
    expect(response.status).toBe(401);
  });

  it("denies a user with no membership in the mission's workspace", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await exportFlightPlan(request("kml"), context());
    expect(response.status).toBe(403);
  });

  it("refuses when no flight plan exists — Generate and save first", async () => {
    planMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await exportFlightPlan(request("wpml"), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Generate and save the flight plan first");
  });

  it("refuses when the plan exists but holds no saved snapshot", async () => {
    planMaybeSingleMock.mockResolvedValue({
      data: freshPlanRow({ generated_plan: null, generated_with: null }),
      error: null,
    });
    const response = await exportFlightPlan(request("wpml"), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Generate and save the flight plan first");
  });

  it("refuses a STALE snapshot — parameters changed since generation", async () => {
    planMaybeSingleMock.mockResolvedValue({
      // Overlap edited after the snapshot was generated: fingerprint mismatch.
      data: freshPlanRow({ front_overlap_pct: "85" }),
      error: null,
    });
    const response = await exportFlightPlan(request("litchi"), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("The saved plan predates these settings");
  });

  it("refuses when only the mission AOI changed — the AOI is part of the fingerprint", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: {
        id: MISSION_ID,
        workspace_id: WORKSPACE_ID,
        title: "Riverfront Survey",
        aoi_geojson: { type: "Polygon", coordinates: [[[0, 0], [0, 2], [2, 2], [0, 0]]] },
      },
      error: null,
    });
    const response = await exportFlightPlan(request("kml"), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("The saved plan predates these settings");
  });

  it("refuses an unusable snapshot by saying why, instead of a best-effort file", async () => {
    const bad = snapshotJson();
    bad.schemaVersion = "unknown-9";
    planMaybeSingleMock.mockResolvedValue({ data: freshPlanRow({ generated_plan: bad }), error: null });
    const response = await exportFlightPlan(request("kml"), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("cannot be exported");
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "aerial_flight_plan_snapshot_unusable",
      expect.objectContaining({ missionId: MISSION_ID })
    );
  });

  it("serves the WPML kmz with the right content type, filename, and contents", async () => {
    const response = await exportFlightPlan(request("wpml"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/vnd.google-earth.kmz");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="flight-plan-riverfront-survey.kmz"'
    );
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    const waylines = await zip.file("wpmz/waylines.wpml")!.async("string");
    // One takePhoto per photo point of the SAVED snapshot.
    expect(waylines.split("takePhoto").length - 1).toBe(5);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "aerial_flight_plan_exported",
      expect.objectContaining({ missionId: MISSION_ID, format: "wpml", photoCount: 5 })
    );
  });

  it("serves the Litchi CSV: header plus one row per photo point", async () => {
    const response = await exportFlightPlan(request("litchi"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain("flight-plan-riverfront-survey-litchi.csv");
    const rows = (await response.text()).trim().split("\n");
    expect(rows).toHaveLength(1 + 5);
    expect(rows[0].startsWith("latitude,longitude,altitude(m)")).toBe(true);
  });

  it("serves the generic KML with a placemark per line and per photo point", async () => {
    const response = await exportFlightPlan(request("kml"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("kml+xml");
    const kml = await response.text();
    expect(kml.split("<Placemark>").length - 1).toBe(2 + 5);
  });

  it("does not present a failed plan read as an absent plan", async () => {
    planMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const response = await exportFlightPlan(request("kml"), context());
    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "aerial_flight_plan_load_failed",
      expect.objectContaining({ missionId: MISSION_ID })
    );
  });
});
