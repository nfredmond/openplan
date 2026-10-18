/**
 * The crash query route ranks the high-injury network from the acquisition's
 * own severity coverage and the project's stored Safety road lines.
 *
 * A wiring test has to vary the binding: the same request is answered once for
 * a source that separates serious injuries and once for one that does not, and
 * the network, its severity filter and its label must follow. Blind category:
 * the fake does not run SQL or PostgREST, so column existence is proved
 * elsewhere (migrations and the live RLS lane).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Query = { table: string; projection: string; filters: Array<[string, unknown]>; range: [number, number] | null };

const state = vi.hoisted(() => ({
  severityCompleteness: "kabco_full",
  roadError: false,
  erroredRoadData: false,
  modelRoadMode: "none" as "none" | "unusable" | "valid",
  emptyRoads: false,
  sourceId: "ccrs-ca" as string | null,
  concentrations: [] as Record<string, unknown>[],
  cacheWrite: vi.fn(),
  loadRoads: vi.fn(),
  queries: [] as Query[],
  severeRows: [] as Array<{ id: string; longitude: number; latitude: number; severity: string }>,
}));

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const INGEST_ID = "22222222-2222-4222-8222-222222222222";
const NETWORK_PROJECTION = "id, longitude, latitude, severity";

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/workspaces/membership", () => ({
  checkWorkspaceMembership: async () => ({ ok: true, role: "owner" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ from: (table: string) => {
    expect(table).toBe("safety_road_context_features");
    return { upsert: state.cacheWrite };
  } }),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "member" } } }) },
    rpc: async (name: string) => ({ data: name === "safety_ksi_concentrations_for_ingests" ? state.concentrations : [], error: null }),
    from: (table: string) => ({
      select: (projection: string) => {
        const query: Query = { table, projection, filters: [], range: null };
        state.queries.push(query);
        const result = () => {
          if (table === "safety_crash_ingests") {
            return {
              data: [{
                source_id: state.sourceId, min_lon: -121.2, min_lat: 39.1, max_lon: -120.8, max_lat: 39.5,
                id: INGEST_ID, project_id: PROJECT_ID, status: "ready", source_label: "Statewide crash file",
                severity_completeness: state.severityCompleteness, crash_count: 4, geocoded_count: 4,
                stored_count: 4, truncated: false, years_requested: [2022, 2023, 2024],
              }],
              error: null,
            };
          }
          if (table === "safety_road_context_features") {
            return state.roadError
              ? { data: state.erroredRoadData ? [{
                  id: "partial-road", road_name: "Partial failed-cache road", source_id: "us-census-tiger-line-cache",
                  source_vintage: "2025-01-01", geometry_geojson: { type: "LineString", coordinates: [[-121.061, 39.218], [-121.061, 39.220]] },
                }] : null, error: { message: "permission denied" } }
              : {
                  data: state.emptyRoads ? [] : [{
                    id: "row-1", road_name: "Main Street", source_id: "us-census-tiger-line-cache",
                    source_vintage: "2025-01-01", cached_at: "2026-10-01T00:00:00Z",
                    geometry_geojson: { type: "LineString", coordinates: [[0, 0.5], [0.0072, 0.5]] },
                  }],
                  error: null,
                };
          }
          if (table === "models") return { data: state.modelRoadMode === "none" ? [] : [{ network_package_version_id: "version-1" }], error: null };
          if (table === "network_package_versions") return { data: [{ id: "version-1", manifest_json: {
            source: state.modelRoadMode === "valid" ? "openstreetmap" : "unknown-legacy-network", source_vintage: "2025",
          } }], error: null };
          if (table === "network_corridors") return { data: [{ id: "model-road", package_version_id: "version-1", corridor_name: "Independent Road",
            geometry_geojson: { type: "LineString", coordinates: [[-121.061, 39.218], [-121.061, 39.220]] },
          }], error: null };
          if (projection === NETWORK_PROJECTION) {
            const severities = (query.filters.find(([key]) => key === "severity")?.[1] ?? []) as string[];
            const rows = state.severeRows.filter((row) => severities.includes(row.severity));
            const [from, to] = query.range ?? [0, rows.length - 1];
            return { data: rows.slice(from, to + 1), count: rows.length, error: null };
          }
          const custodyCount = query.filters.every(([key]) => ["workspace_id", "ingest_id"].includes(key));
          return { data: [], count: custodyCount ? 4 : 0, error: null };
        };
        const chain = {
          eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
          is: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
          gte: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
          lte: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
          in: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
          not: () => chain, or: () => chain, order: () => chain, limit: () => chain,
          range: (from: number, to: number) => { query.range = [from, to]; return chain; },
          then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
        };
        return chain;
      },
    }),
  }),
}));

vi.mock("@/lib/safety/us-road-context-adapter", () => ({ loadUsTigerRoadContext: (...args: unknown[]) => state.loadRoads(...args) }));
import { SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION } from "@/lib/safety/crash-evidence";
import * as sourceRegistry from "@/lib/safety/sources/registry";
import { ccrsAdapter } from "@/lib/safety/sources/ccrs";
import { GET } from "@/app/api/safety/crashes/route";

function request(extra = "", acquisitionExtent = false) {
  const bounds = acquisitionExtent ? "minLon=-121.2&minLat=39.1&maxLon=-120.8&maxLat=39.5" : "minLon=-1&minLat=-1&maxLon=1&maxLat=1";
  return new NextRequest(
    `http://localhost/api/safety/crashes?workspaceId=${WORKSPACE_ID}&projectId=${PROJECT_ID}&ingestId=${INGEST_ID}&${bounds}${extra}`,
  );
}

function networkQuery() {
  return state.queries.find((query) => query.projection === NETWORK_PROJECTION);
}

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  state.severityCompleteness = "kabco_full";
  state.roadError = false;
  state.erroredRoadData = false;
  state.modelRoadMode = "none";
  state.emptyRoads = false;
  state.sourceId = "ccrs-ca";
  state.concentrations = [];
  state.cacheWrite.mockReset().mockResolvedValue({ error: null });
  state.loadRoads.mockReset().mockResolvedValue({
    roads: [{ id: "tiger-road", name: "Source Road", sourceId: "us-census-tiger-line-cache",
      sourceLabel: "U.S. Census TIGER/Line roads", vintage: "2025-01-01",
      geometry: { type: "LineString", coordinates: [[-121.061, 39.218], [-121.061, 39.220]] } }],
    coverageLimit: "Nearest named source roads within 150 meters.", sourceVintage: "2025-01-01",
  });
  state.queries = [];
  state.severeRows = [
    { id: "c1", longitude: 0.002, latitude: 0.5001, severity: "fatal" },
    { id: "c2", longitude: 0.004, latitude: 0.5001, severity: "severe_injury" },
  ];
});

describe("the crash route's high-injury network", () => {
  it.each(["saved", "returned_error", "thrown_error"])("loads source roads for an uploaded acquisition without a country hint: %s", async (cacheState) => {
    if (cacheState === "returned_error") state.cacheWrite.mockResolvedValueOnce({ error: { message: "write failed" } });
    if (cacheState === "thrown_error") state.cacheWrite.mockRejectedValueOnce(new Error("write failed"));
    state.emptyRoads = true;
    state.concentrations = [{ rank: 1, longitude: -121.061, latitude: 39.219,
      crash_count: 4, fatal_crash_count: 1, serious_injury_crash_count: 3, radius_meters: 150 }];
    state.severeRows = [
      { id: "c1", longitude: -121.061, latitude: 39.219, severity: "fatal" },
      { id: "c2", longitude: -121.061, latitude: 39.2195, severity: "severe_injury" },
    ];
    const response = await GET(request("", true));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(state.queries.find(({ table }) => table === "safety_crash_ingests")?.projection).toBe(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION);
    expect(state.loadRoads).toHaveBeenCalledWith([expect.objectContaining({ longitude: -121.061, latitude: 39.219 })]);
    expect(body.ksiConcentrations[0].roadIdentity.name).toBe("Source Road");
    expect(body.roadContextCoverageLimit).toContain("150 meters");
    expect(state.cacheWrite).toHaveBeenCalledWith([expect.objectContaining({
      workspace_id: WORKSPACE_ID, project_id: PROJECT_ID, country_code: "US",
      source_id: "us-census-tiger-line-cache", source_vintage: "2025-01-01", source_feature_id: "tiger-road",
    })], { onConflict: "workspace_id,project_id,source_id,source_vintage,source_feature_id" });
  });

  it.each([null, "unknown", "foreign-source"])("ignores a forged US hint for source %s", async (sourceId) => {
    state.sourceId = sourceId;
    state.emptyRoads = true;
    state.concentrations = [{ rank: 1, longitude: -121.061, latitude: 39.219,
      crash_count: 4, fatal_crash_count: 1, serious_injury_crash_count: 3, radius_meters: 150 }];
    const response = await GET(request("&roadContextCountry=US", true));
    expect(response.status).toBe(200);
    expect((await response.json()).ksiConcentrations[0].roadIdentity.status).toBe("unavailable");
    expect(state.loadRoads).not.toHaveBeenCalled();
    expect(state.cacheWrite).not.toHaveBeenCalled();
  });

  it("does not send another declared provider's source records to TIGER, even with a US hint", async () => {
    vi.spyOn(sourceRegistry, "getCrashSourceById").mockReturnValue({ ...ccrsAdapter, roadContextProvider: "other-country-roads" });
    state.emptyRoads = true;
    state.concentrations = [{ rank: 1, longitude: -121.061, latitude: 39.219,
      crash_count: 4, fatal_crash_count: 1, serious_injury_crash_count: 3, radius_meters: 150 }];
    const response = await GET(request("&roadContextCountry=US", true));
    expect(response.status).toBe(200);
    expect((await response.json()).ksiConcentrations[0].roadIdentity.status).toBe("unavailable");
    expect(state.loadRoads).not.toHaveBeenCalled();
    expect(state.cacheWrite).not.toHaveBeenCalled();
  });

  it("ranks fatal and serious-injury crashes on a source that separates them", async () => {
    const body = await (await GET(request())).json();
    expect(body.highInjuryNetwork).toMatchObject({
      status: "computed",
      basis: "ksi",
      method: "road_segments",
      years: [2022, 2023, 2024],
      crashesConsidered: 2,
      crashesPlaced: 2,
    });
    expect(body.highInjuryNetwork.segments[0]).toMatchObject({
      label: "Main Street",
      crashCount: 2,
      fatalCrashCount: 1,
      seriousInjuryCrashCount: 1,
    });
    expect(networkQuery()?.filters).toContainEqual(["severity", ["fatal", "severe_injury"]]);
    expect(networkQuery()?.filters).toContainEqual(["ingest_id", INGEST_ID]);
  });

  it("ranks fatal crashes only, and says so, on a source that cannot separate serious injuries", async () => {
    state.severityCompleteness = "fatal_injury_only";
    const body = await (await GET(request())).json();
    expect(body.highInjuryNetwork).toMatchObject({ status: "computed", basis: "fatal_only", crashesConsidered: 1 });
    expect(body.highInjuryNetwork.segments[0]).toMatchObject({ crashCount: 1, seriousInjuryCrashCount: null });
    expect(networkQuery()?.filters).toContainEqual(["severity", ["fatal"]]);
  });

  it("follows the year filter and reports the years it used", async () => {
    const body = await (await GET(request("&yearFrom=2023"))).json();
    expect(body.highInjuryNetwork.years).toEqual([2023, 2024]);
    expect(networkQuery()?.filters).toContainEqual(["collision_year", 2023]);
  });

  it.each([
    ["unusable model rows", "unusable", false, null],
    ["partial failed-cache rows", "unusable", true, null],
    ["valid independent model roads", "valid", true, "Independent Road"],
  ] as const)("preserves a failed Safety cache read with %s", async (_label, modelRoadMode, erroredRoadData, expectedName) => {
    state.roadError = true;
    state.modelRoadMode = modelRoadMode;
    state.erroredRoadData = erroredRoadData;
    state.concentrations = [{ rank: 1, longitude: -121.061, latitude: 39.219,
      crash_count: 4, fatal_crash_count: 1, serious_injury_crash_count: 3, radius_meters: 150 }];
    const response = await GET(request("", true));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ksiConcentrations[0].roadIdentity).toMatchObject(expectedName
      ? { status: "matched", name: expectedName }
      : { status: "unavailable", reason: "no_registered_road_evidence" });
    expect(body.roadContext?.map((road: { name: string }) => road.name) ?? null).toEqual(expectedName ? [expectedName] : null);
    expect(body.highInjuryNetwork).toEqual({ status: "unavailable", reason: "road_read_failed", basis: "ksi" });
    expect(state.loadRoads).not.toHaveBeenCalled();
    expect(state.cacheWrite).not.toHaveBeenCalled();
    expect(state.queries.find(({ table }) => table === "network_package_versions")?.projection).toBe("id, version_name, created_at, manifest_json");
    expect(state.queries.find(({ table }) => table === "network_corridors")?.projection).toBe("id, package_version_id, corridor_name, geometry_geojson");
  });

  it("reports a failed road read as unavailable, not as a grid or an empty list", async () => {
    state.roadError = true;
    state.concentrations = [{ rank: 1, longitude: -121.061, latitude: 39.219, crash_count: 4, fatal_crash_count: 1, serious_injury_crash_count: 3, radius_meters: 150 }];
    const body = await (await GET(request())).json();
    expect(body.highInjuryNetwork).toEqual({ status: "unavailable", reason: "road_read_failed", basis: "ksi" });
    expect(networkQuery()).toBeUndefined();
    expect(state.loadRoads).not.toHaveBeenCalled();
  });
});
