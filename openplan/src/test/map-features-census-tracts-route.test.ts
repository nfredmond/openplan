import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TRACT_A = "06057010100";
const TRACT_B = "06057010200";
const TRACT_BAD = "06057000000";

const tractLimitMock = vi.fn();
const tractSelectMock = vi.fn(() => ({ limit: tractLimitMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "census_tracts_map") {
    return { select: tractSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as getCensusTracts } from "@/app/api/map-features/census-tracts/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/census-tracts", {
    method: "GET",
  });
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

describe("GET /api/map-features/census-tracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when the request is anonymous", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getCensusTracts(bareRequest());

    expect(response.status).toBe(401);
    expect(tractSelectMock).not.toHaveBeenCalled();
  });

  it("returns MultiPolygon features and filters out malformed geometries", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    tractLimitMock.mockResolvedValue({
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
          // Non-MultiPolygon geometry — should be dropped.
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
      error: null,
    });

    const response = await getCensusTracts(bareRequest());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      type: string;
      features: Array<{
        id: string;
        geometry: { type: string };
        properties: Record<string, unknown>;
      }>;
    };
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
      properties: {
        name: null,
        popTotal: 5200,
        pctZeroVehicle: 3,
        pctPoverty: 6,
        pctNonwhite: 10,
      },
    });
    expect(tractSelectMock).toHaveBeenCalledWith(
      "geoid, state_fips, county_fips, name, geometry_geojson, pop_total, households, pct_nonwhite, pct_zero_vehicle, pct_poverty"
    );
    expect(tractLimitMock).toHaveBeenCalledWith(500);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "census_tract_choropleth_loaded",
      expect.objectContaining({ count: 2 })
    );
  });

  it("returns 500 when the census_tracts_map lookup fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    tractLimitMock.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "42P01" },
    });

    const response = await getCensusTracts(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "census_tract_choropleth_query_failed",
      expect.objectContaining({ message: "boom" })
    );
  });

  it("does not workspace-scope the query — tracts are public data", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    tractLimitMock.mockResolvedValue({ data: [], error: null });

    await getCensusTracts(bareRequest());

    // Sanity: the chain only uses select+limit, no .eq("workspace_id", ...).
    expect(tractSelectMock).toHaveBeenCalledTimes(1);
    expect(tractLimitMock).toHaveBeenCalledTimes(1);
  });
});
