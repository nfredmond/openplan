import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  deriveHomeMapView,
  homeGeographyBbox,
  homeGeographyFromPlaceBoundary,
  homeGeographyLabel,
  parseWorkspaceHomeGeography,
  resolveJurisdiction,
  subdivisionCodeFromTigerwebGeoid,
  TIGERWEB_GEOGRAPHY_SOURCE,
  type WorkspaceHomeGeography,
} from "@/lib/workspaces/home-geography";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";

function geography(overrides: Partial<WorkspaceHomeGeography> = {}): WorkspaceHomeGeography {
  return {
    home_geography_source: TIGERWEB_GEOGRAPHY_SOURCE,
    home_geography_kind: "county",
    home_geography_ref: "39049",
    home_geography_label: "Franklin County, OH",
    home_country_code: "US",
    home_subdivision_code: "OH",
    home_min_lon: -83.2,
    home_min_lat: 39.8,
    home_max_lon: -82.7,
    home_max_lat: 40.2,
    home_geometry_geojson: null,
    home_geography_set_at: "2026-07-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("home geography — map view", () => {
  it("returns null when the workspace has not stated a geography", () => {
    // The whole point: an unset workspace must fall back to a NEUTRAL camera,
    // not to somebody else's town. If this ever returns a view, a default place
    // has crept back in.
    expect(deriveHomeMapView(null)).toBeNull();
    expect(deriveHomeMapView(undefined)).toBeNull();
    expect(deriveHomeMapView(geography({ home_min_lon: null, home_min_lat: null, home_max_lon: null, home_max_lat: null }))).toBeNull();
  });

  it("never returns the neutral continental fallback as if it were a real home", () => {
    const view = deriveHomeMapView(geography());
    expect(view).not.toBeNull();
    expect(view?.center).not.toEqual(CONTINENTAL_US_CENTER);
  });

  it("rejects a partial bounding box rather than patching it", () => {
    // Three of four corners would frame a map that looks right and is wrong.
    expect(homeGeographyBbox(geography({ home_max_lat: null }))).toBeNull();
    expect(deriveHomeMapView(geography({ home_max_lat: null }))).toBeNull();
  });

  it("centres on the bounding box", () => {
    const view = deriveHomeMapView(geography());
    expect(view?.center[0]).toBeCloseTo(-82.95, 6);
    expect(view?.center[1]).toBeCloseTo(40.0, 6);
  });

  it("scales zoom to the span — a bigger geography gets a wider view", () => {
    const county = deriveHomeMapView(geography());
    const stateSized = deriveHomeMapView(
      geography({ home_min_lon: -84.9, home_min_lat: 38.3, home_max_lon: -80.5, home_max_lat: 42.0 })
    );
    const neighbourhood = deriveHomeMapView(
      geography({ home_min_lon: -83.01, home_min_lat: 39.99, home_max_lon: -82.99, home_max_lat: 40.01 })
    );

    expect(stateSized!.zoom).toBeLessThan(county!.zoom);
    expect(county!.zoom).toBeLessThan(neighbourhood!.zoom);
  });

  it("clamps a degenerate point bounding box instead of computing infinite zoom", () => {
    const view = deriveHomeMapView(
      geography({ home_min_lon: -83, home_min_lat: 40, home_max_lon: -83, home_max_lat: 40 })
    );
    expect(Number.isFinite(view!.zoom)).toBe(true);
    expect(view!.zoom).toBeLessThanOrEqual(14);
    expect(view!.center).toEqual([-83, 40]);
  });

  it("frames a bounding box that crosses the antimeridian", () => {
    // Fiji-shaped: minLon > maxLon is well-formed, not corrupt. Treating the
    // span as negative would send the camera to the opposite side of the world.
    const view = deriveHomeMapView(
      geography({ home_min_lon: 176.8, home_min_lat: -18.5, home_max_lon: -179.7, home_max_lat: -16.1 })
    );
    expect(view).not.toBeNull();
    // Centre stays inside the geography (just past the dateline), not at ~-1.5.
    expect(Math.abs(view!.center[0])).toBeGreaterThan(170);
    expect(view!.zoom).toBeGreaterThan(2);
  });

  it("honours a caller-supplied viewport instead of assuming one", () => {
    const wide = deriveHomeMapView(geography(), { viewportWidth: 1800, viewportHeight: 1200 });
    const small = deriveHomeMapView(geography(), { viewportWidth: 360, viewportHeight: 640 });
    expect(wide!.zoom).toBeGreaterThan(small!.zoom);
  });
});

describe("home geography — jurisdiction", () => {
  it("returns null when no country is recorded, so a registry cannot default", () => {
    expect(resolveJurisdiction(null)).toBeNull();
    expect(resolveJurisdiction(geography({ home_country_code: null }))).toBeNull();
  });

  it("returns the ISO descriptor the stage-gate registry speaks", () => {
    expect(resolveJurisdiction(geography())).toEqual({ country: "US", subdivision: "OH" });
  });

  it("keeps a missing subdivision null rather than inventing one", () => {
    expect(resolveJurisdiction(geography({ home_subdivision_code: null }))).toEqual({
      country: "US",
      subdivision: null,
    });
  });

  it("normalizes casing so a lookup never depends on it", () => {
    expect(resolveJurisdiction(geography({ home_country_code: "us", home_subdivision_code: "oh" }))).toEqual({
      country: "US",
      subdivision: "OH",
    });
  });
});

describe("home geography — row parsing", () => {
  it("treats a row without a source as unset", () => {
    expect(parseWorkspaceHomeGeography(null)).toBeNull();
    expect(parseWorkspaceHomeGeography({})).toBeNull();
    // A stray label with no source is not a resolvable geography.
    expect(parseWorkspaceHomeGeography({ home_geography_label: "Somewhere" })).toBeNull();
  });

  it("parses a stored row and drops blank strings", () => {
    const parsed = parseWorkspaceHomeGeography({
      ...geography(),
      home_geography_label: "   ",
    });
    expect(parsed?.home_geography_ref).toBe("39049");
    expect(parsed?.home_geography_label).toBeNull();
    expect(homeGeographyLabel(parsed)).toBeNull();
  });
});

describe("home geography — TIGERweb adapter", () => {
  it("derives the ISO subdivision from a state-prefixed GEOID", () => {
    expect(subdivisionCodeFromTigerwebGeoid("county", "39049")).toBe("OH");
    expect(subdivisionCodeFromTigerwebGeoid("city", "3918000")).toBe("OH");
    expect(subdivisionCodeFromTigerwebGeoid("cdp", "0630000")).toBe("CA");
  });

  it("refuses to read a CBSA code as a state prefix", () => {
    // CBSA 31080 is Los Angeles; its leading "31" is NOT a state FIPS (that
    // would be Nebraska). A CBSA can also straddle states outright, so the
    // subdivision is genuinely unknown — and must stay null.
    expect(subdivisionCodeFromTigerwebGeoid("metro", "31080")).toBeNull();
    expect(subdivisionCodeFromTigerwebGeoid("micro", "16220")).toBeNull();
  });

  it("builds a persistable row from a resolved boundary", () => {
    const boundary: PlaceBoundaryResponse = {
      kind: "county",
      geoid: "39049",
      label: "Franklin County, OH",
      geojson: {
        type: "Polygon",
        coordinates: [[[-83.2, 39.8], [-82.7, 39.8], [-82.7, 40.2], [-83.2, 39.8]]],
      },
      bbox: { minLon: -83.2, minLat: 39.8, maxLon: -82.7, maxLat: 40.2 },
    };

    const row = homeGeographyFromPlaceBoundary(boundary, { setAt: new Date("2026-07-23T00:00:00Z") });

    expect(row.home_geography_source).toBe(TIGERWEB_GEOGRAPHY_SOURCE);
    expect(row.home_geography_kind).toBe("county");
    expect(row.home_geography_ref).toBe("39049");
    expect(row.home_country_code).toBe("US");
    expect(row.home_subdivision_code).toBe("OH");
    expect(row.home_min_lon).toBe(-83.2);
    expect(row.home_max_lat).toBe(40.2);
    expect(row.home_geometry_geojson).toBe(boundary.geojson);
    expect(row.home_geography_set_at).toBe("2026-07-23T00:00:00.000Z");
    // Round-trips through the accessors it is written for.
    expect(resolveJurisdiction(row)).toEqual({ country: "US", subdivision: "OH" });
    expect(deriveHomeMapView(row)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route guards
// ---------------------------------------------------------------------------

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const workspaceSelectMaybeSingleMock = vi.fn();
const serviceUpdateMock = vi.fn();
const serviceUpdateMaybeSingleMock = vi.fn();
const resolvePlaceBoundaryMock = vi.fn();

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === "workspace_members") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: workspaceSelectMaybeSingleMock }) }),
      };
    },
  }),
  createServiceRoleClient: () => ({
    from: () => ({
      update: (row: unknown) => {
        serviceUpdateMock(row);
        return {
          eq: () => ({ select: () => ({ maybeSingle: serviceUpdateMaybeSingleMock }) }),
        };
      },
    }),
  }),
}));

vi.mock("@/lib/geographies/place-resolver", () => ({
  resolvePlaceBoundary: (...args: unknown[]) => resolvePlaceBoundaryMock(...args),
}));

const { GET, PATCH } = await import("@/app/api/workspaces/home-geography/route");

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/workspaces/home-geography", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("/api/workspaces/home-geography", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
    workspaceSelectMaybeSingleMock.mockResolvedValue({ data: geography(), error: null });
    serviceUpdateMaybeSingleMock.mockResolvedValue({ data: geography(), error: null });
    resolvePlaceBoundaryMock.mockResolvedValue({
      kind: "county",
      geoid: "39049",
      label: "Franklin County, OH",
      geojson: {
        type: "Polygon",
        coordinates: [[[-83.2, 39.8], [-82.7, 39.8], [-82.7, 40.2], [-83.2, 39.8]]],
      },
      bbox: { minLon: -83.2, minLat: 39.8, maxLon: -82.7, maxLat: 40.2 },
    });
  });

  it("401s an unauthenticated write", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await PATCH(patchRequest({ workspaceId: WORKSPACE_ID, kind: "county", geoid: "39049" }));
    expect(res.status).toBe(401);
    expect(serviceUpdateMock).not.toHaveBeenCalled();
  });

  it("404s a caller who is not a member", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await PATCH(patchRequest({ workspaceId: WORKSPACE_ID, kind: "county", geoid: "39049" }));
    expect(res.status).toBe(404);
    expect(serviceUpdateMock).not.toHaveBeenCalled();
  });

  it("403s a plain member — stating the home geography is workspace configuration", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "member" }, error: null });
    const res = await PATCH(patchRequest({ workspaceId: WORKSPACE_ID, kind: "county", geoid: "39049" }));
    expect(res.status).toBe(403);
    expect(serviceUpdateMock).not.toHaveBeenCalled();
  });

  it("503s when the migration has not been applied", async () => {
    membershipMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "public.workspace_members" does not exist' },
    });
    const res = await PATCH(patchRequest({ workspaceId: WORKSPACE_ID, kind: "county", geoid: "39049" }));
    expect(res.status).toBe(503);
  });

  it("400s malformed JSON and invalid parameters", async () => {
    expect((await PATCH(patchRequest("{not json"))).status).toBe(400);
    expect((await PATCH(patchRequest({ workspaceId: WORKSPACE_ID }))).status).toBe(400);
    expect(
      (await PATCH(patchRequest({ workspaceId: WORKSPACE_ID, kind: "planet", geoid: "39049" }))).status
    ).toBe(400);
    expect(
      (await PATCH(patchRequest({ workspaceId: WORKSPACE_ID, kind: "county", geoid: "OH" }))).status
    ).toBe(400);
  });

  it("fails closed when the boundary cannot be resolved", async () => {
    // Storing the id without a verified boundary would leave a geography that
    // renders as a wrong extent everywhere it is read.
    resolvePlaceBoundaryMock.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ workspaceId: WORKSPACE_ID, kind: "county", geoid: "39049" }));
    expect(res.status).toBe(404);
    expect(serviceUpdateMock).not.toHaveBeenCalled();
  });

  it("re-resolves the boundary server-side and never trusts a client bbox", async () => {
    const res = await PATCH(
      patchRequest({
        workspaceId: WORKSPACE_ID,
        kind: "county",
        geoid: "39049",
        // A hostile extent, which must be ignored entirely.
        bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      })
    );

    expect(res.status).toBe(200);
    expect(resolvePlaceBoundaryMock).toHaveBeenCalledWith("county", "39049");
    const written = serviceUpdateMock.mock.calls[0][0] as WorkspaceHomeGeography;
    expect(written.home_min_lon).toBe(-83.2);
    expect(written.home_subdivision_code).toBe("OH");
    expect(written.home_geography_set_at).toBeTruthy();
  });

  it("reports an unset workspace as null rather than a default place", async () => {
    workspaceSelectMaybeSingleMock.mockResolvedValue({ data: {}, error: null });
    const res = await GET(
      new NextRequest(`http://localhost/api/workspaces/home-geography?workspaceId=${WORKSPACE_ID}`)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).homeGeography).toBeNull();
  });

  it("400s a read without a valid workspaceId", async () => {
    const res = await GET(new NextRequest("http://localhost/api/workspaces/home-geography?workspaceId=nope"));
    expect(res.status).toBe(400);
  });
});
