import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const TRACT_A = "06057010100";
const TRACT_B = "06057010200";
const TRACT_BAD = "06057000000";

/**
 * CORRECTED, not updated.
 *
 * The previous version of this file contained a test literally named
 * "does not workspace-scope the query — tracts are public data", asserting the
 * chain used only `select` + `limit`. That described the code rather than the
 * intent, and the code was wrong: `census_tracts` is a SHARED, NATIONAL table
 * that every workspace's home-geography ingest writes into, so an unfiltered
 * `.limit(500)` drew an arbitrary slice of whatever had been ingested — quite
 * possibly none of the viewer's own county — and said nothing about it.
 *
 * Tracts remain public data (no membership is required to READ them). What
 * membership establishes is WHICH tracts belong on this workspace's map.
 */

const tractOrderMock = vi.fn();
const tractEqCountyMock = vi.fn(() => ({ order: tractOrderMock }));
const tractEqStateMock = vi.fn(() => ({ eq: tractEqCountyMock }));
const tractSelectMock = vi.fn(() => ({ eq: tractEqStateMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "census_tracts_map") return { select: tractSelectMock };
  if (table === "workspaces") return { select: workspaceSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

import { GET as getCensusTracts } from "@/app/api/map-features/census-tracts/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/census-tracts", { method: "GET" });
}

const validGeometry = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [-121.04, 39.23],
        [-121.03, 39.23],
        [-121.03, 39.24],
        [-121.04, 39.24],
        [-121.04, 39.23],
      ],
    ],
  ],
};

const NEVADA_COUNTY_ROW = {
  home_geography_source: "tigerweb",
  home_geography_kind: "county",
  home_geography_ref: "06057",
  home_geography_label: "Nevada County, CA",
  home_country_code: "US",
};

type TractPayload = {
  type: string;
  features: Array<{ id: string; geometry: { type: string }; properties: Record<string, unknown> }>;
  returnedCount: number;
  matchedCount: number;
  droppedCount: number;
  truncated: boolean;
  limit: number;
  scopeState: string;
  scopeLabel: string | null;
  coverageNotes: string[];
};

describe("GET /api/map-features/census-tracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "owner" },
    });
    workspaceMaybeSingleMock.mockResolvedValue({ data: NEVADA_COUNTY_ROW, error: null });
  });

  it("returns 401 when the request is anonymous", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getCensusTracts(bareRequest());

    expect(response.status).toBe(401);
    expect(tractSelectMock).not.toHaveBeenCalled();
  });

  it("scopes the query to the workspace's own county", async () => {
    tractOrderMock.mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    });

    await getCensusTracts(bareRequest());

    expect(tractEqStateMock).toHaveBeenCalledWith("state_fips", "06");
    expect(tractEqCountyMock).toHaveBeenCalledWith("county_fips", "057");
    // Deterministic order, so a truncated payload is a stable prefix rather
    // than an arbitrary subset that changes between page loads.
    expect(tractOrderMock).toHaveBeenCalledWith("geoid", { ascending: true });
  });

  it("selects only the identity columns of the home geography, never the boundary polygon", async () => {
    tractOrderMock.mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    });

    await getCensusTracts(bareRequest());

    const selected = String((workspaceSelectMock.mock.calls as unknown as string[][])[0]?.[0] ?? "");
    // This route fires on every (app) page load; the polygon can be megabytes.
    expect(selected).not.toContain("home_geometry_geojson");
    expect(selected).toContain("home_geography_ref");
  });

  it("returns MultiPolygon features, drops malformed geometry, and counts the drop", async () => {
    tractOrderMock.mockReturnValue({
      limit: vi.fn().mockResolvedValue({
        count: 3,
        error: null,
        data: [
          {
            geoid: TRACT_A,
            state_fips: "06",
            county_fips: "057",
            name: "Grass Valley core (demo)",
            geometry_geojson: validGeometry,
            pop_total: 4200,
            households: 1600,
            pct_nonwhite: 18.5,
            pct_zero_vehicle: 12,
            pct_poverty: 14.2,
          },
          {
            // PostgREST can return NUMERIC as strings — the route coerces them.
            geoid: TRACT_B,
            state_fips: "06",
            county_fips: "057",
            name: null,
            geometry_geojson: validGeometry,
            pop_total: "5200",
            households: "2100",
            pct_nonwhite: "10.0",
            pct_zero_vehicle: "3.0",
            pct_poverty: "6.0",
          },
          {
            geoid: TRACT_BAD,
            state_fips: "06",
            county_fips: "057",
            name: "Polygon instead of MultiPolygon",
            geometry_geojson: { type: "Polygon", coordinates: [] },
            pop_total: 1,
            households: 1,
            pct_nonwhite: 0,
            pct_zero_vehicle: 0,
            pct_poverty: 0,
          },
        ],
      }),
    });

    const response = await getCensusTracts(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as TractPayload;

    expect(payload.type).toBe("FeatureCollection");
    expect(payload.features).toHaveLength(2);
    expect(payload.features[0]).toMatchObject({
      id: TRACT_A,
      geometry: { type: "MultiPolygon" },
      properties: {
        kind: "census_tract",
        geoid: TRACT_A,
        name: "Grass Valley core (demo)",
        popTotal: 4200,
        pctZeroVehicle: 12,
        pctPoverty: 14.2,
        pctNonwhite: 18.5,
      },
    });
    expect(payload.features[1]).toMatchObject({
      id: TRACT_B,
      properties: { name: null, popTotal: 5200, pctZeroVehicle: 3, pctPoverty: 6, pctNonwhite: 10 },
    });

    // An undrawable tract is reported, not silently absent.
    expect(payload.droppedCount).toBe(1);
    expect(payload.truncated).toBe(false);
    expect(payload.coverageNotes.join(" ")).toContain("could not be drawn");
    expect(tractSelectMock).toHaveBeenCalledWith(
      "geoid, state_fips, county_fips, name, geometry_geojson, pop_total, households, pct_nonwhite, pct_zero_vehicle, pct_poverty",
      { count: "exact" }
    );
  });

  it("discloses truncation with the matched total, not just what it drew", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      geoid: `06037${String(i).padStart(6, "0")}`,
      state_fips: "06",
      county_fips: "037",
      name: `Tract ${i}`,
      geometry_geojson: validGeometry,
      pop_total: 100,
      households: 40,
      pct_nonwhite: 1,
      pct_zero_vehicle: 1,
      pct_poverty: 1,
    }));
    tractOrderMock.mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: rows, error: null, count: 2498 }),
    });

    const payload = (await (await getCensusTracts(bareRequest())).json()) as TractPayload;

    expect(payload.returnedCount).toBe(500);
    expect(payload.matchedCount).toBe(2498);
    expect(payload.truncated).toBe(true);
    expect(payload.coverageNotes.join(" ")).toContain("Showing 500 of 2,498");
  });

  it("draws nothing and says why when the workspace has no home geography", async () => {
    workspaceMaybeSingleMock.mockResolvedValue({ data: {}, error: null });

    const payload = (await (await getCensusTracts(bareRequest())).json()) as TractPayload;

    expect(payload.features).toEqual([]);
    expect(payload.scopeState).toBe("geography_not_set");
    expect(payload.coverageNotes.join(" ")).toContain("has not set a home geography");
    // Critically: it must not fall back to an unfiltered or state-wide query.
    expect(tractSelectMock).not.toHaveBeenCalled();
  });

  it("draws nothing and says why when there is no workspace membership", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null });

    const payload = (await (await getCensusTracts(bareRequest())).json()) as TractPayload;

    expect(payload.scopeState).toBe("no_workspace");
    expect(payload.features).toEqual([]);
    expect(tractSelectMock).not.toHaveBeenCalled();
  });

  it("refuses to scope a non-county home geography rather than drawing another county", async () => {
    workspaceMaybeSingleMock.mockResolvedValue({
      data: { ...NEVADA_COUNTY_ROW, home_geography_kind: "metro", home_geography_ref: "40900" },
      error: null,
    });

    const payload = (await (await getCensusTracts(bareRequest())).json()) as TractPayload;

    expect(payload.scopeState).toBe("geography_kind_unsupported");
    expect(payload.features).toEqual([]);
    expect(tractSelectMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the census_tracts_map lookup fails", async () => {
    tractOrderMock.mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: "boom", code: "42P01" }, count: null }),
    });

    const response = await getCensusTracts(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "census_tract_choropleth_query_failed",
      expect.objectContaining({ message: "boom" })
    );
  });
});
