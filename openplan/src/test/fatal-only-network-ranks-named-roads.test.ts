/**
 * A FATAL-ONLY PLACE GETS NAMED ROADS, NOT A GRID OF COORDINATES (D20).
 *
 * The rehearsal's Lincoln County, Nevada pull stored 12 fatal crashes from
 * FARS. Road lines were fetched only near severe-crash concentrations, and 12
 * scattered fatal crashes never pair up, so no road line was stored and the
 * high-injury network fell back to half-mile squares named by coordinates, a
 * 12-way tie. A tribal area gave three tied squares.
 *
 * These cases run the real crash route, the real TIGER/Line adapter and the
 * real ranking. Only `fetch` (the Census service), the database and the cache
 * write are faked. Fixtures: a Nevada county with 12 fatal crashes, a tribal
 * area that crosses the Nevada and Idaho line with three, and a place where
 * the road service answers with no road at all.
 *
 * Blind category: the live TIGERweb service (field names, record limits,
 * vintage wording) and the stored cache read back on the next request; the
 * fake serves one named line through each crash, so a crash far from every
 * road is not exercised here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  describeHighInjuryNetworkTie,
  highInjuryNetworkMeasureLabel,
  type HighInjuryNetworkSegment,
} from "@/lib/safety/high-injury-network";

type Crash = { id: string; longitude: number; latitude: number; severity: string };
type Place = { name: string; bbox: [number, number, number, number]; crashes: Crash[]; roadName: (crash: Crash) => string };

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const INGEST_ID = "22222222-2222-4222-8222-222222222222";
const NETWORK_PROJECTION = "id, longitude, latitude, severity";

function crashes(prefix: string, points: Array<[number, number]>): Crash[] {
  return points.map(([longitude, latitude], index) => ({ id: `${prefix}-${String(index).padStart(2, "0")}`, longitude, latitude, severity: "fatal" }));
}

/** Twelve fatal crashes along rural highways, none within 150 m of another. */
const NEVADA_COUNTY: Place = {
  name: "a Nevada county with 12 fatal crashes",
  bbox: [-115.9, 36.84, -114.05, 38.68],
  crashes: crashes("nv", [
    [-114.62, 37.62], [-114.51, 37.81], [-114.45, 37.95], [-114.39, 38.12], [-114.88, 37.31], [-115.01, 37.12],
    [-115.23, 37.51], [-115.42, 37.64], [-114.95, 38.02], [-114.21, 38.41], [-115.62, 36.98], [-114.7, 38.3],
  ]),
  roadName: (crash) => (crash.longitude > -114.8 ? "US Highway 93" : "State Route 375"),
};

/** Three fatal crashes in a reservation that straddles the Nevada and Idaho line. */
const CROSS_STATE_TRIBAL_AREA: Place = {
  name: "a tribal area across a state line with 3 fatal crashes",
  bbox: [-116.35, 41.8, -115.8, 42.2],
  crashes: crashes("tribal", [[-116.05, 41.93], [-116.1, 42.06], [-115.95, 41.99]]),
  roadName: (crash) => (crash.latitude > 42 ? "Idaho Highway 51" : "Nevada State Route 225"),
};

const state = vi.hoisted(() => ({
  place: null as unknown as {
    bbox: [number, number, number, number];
    crashes: Array<{ id: string; longitude: number; latitude: number; severity: string }>;
    roadName: (crash: { id: string; longitude: number; latitude: number; severity: string }) => string;
  },
  provider: "named" as "named" | "empty" | "one_failure",
  cacheWrite: vi.fn(),
  tigerQueries: 0,
}));

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
    // No two of these crashes are within 150 m, so no concentration exists.
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => ({
      select: (projection: string) => {
        const filters: Array<[string, unknown]> = [];
        let range: [number, number] | null = null;
        const all = state.place.crashes;
        const result = () => {
          if (table === "safety_crash_ingests") {
            const [minLon, minLat, maxLon, maxLat] = state.place.bbox;
            return { data: [{
              id: INGEST_ID, project_id: PROJECT_ID, status: "ready", source_id: "fars-national",
              source_label: "NHTSA Fatality Analysis Reporting System (FARS)", severity_completeness: "fatal_only",
              min_lon: minLon, min_lat: minLat, max_lon: maxLon, max_lat: maxLat,
              crash_count: all.length, geocoded_count: all.length, stored_count: all.length, truncated: false,
              years_requested: [2022, 2023, 2024, 2025],
            }], error: null };
          }
          // No road lines are stored for the project yet.
          if (table === "safety_road_context_features" || table === "models") return { data: [], error: null };
          if (projection === NETWORK_PROJECTION) {
            const severities = (filters.find(([key]) => key === "severity")?.[1] ?? []) as string[];
            const rows = all.filter((row) => severities.includes(row.severity));
            const [from, to] = range ?? [0, rows.length - 1];
            return { data: rows.slice(from, to + 1), count: rows.length, error: null };
          }
          const custody = filters.every(([key]) => ["workspace_id", "ingest_id"].includes(key));
          return { data: [], count: custody ? all.length : 0, error: null };
        };
        const chain = {
          eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
          is: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
          gte: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
          lte: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
          in: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
          not: () => chain, or: () => chain, order: () => chain, limit: () => chain,
          range: (from: number, to: number) => { range = [from, to]; return chain; },
          then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
        };
        return chain;
      },
    }),
  }),
}));

import { GET } from "@/app/api/safety/crashes/route";

/**
 * The Census TIGERweb service: a dated layer description, and for each query
 * box one named east-west line through every fixture crash inside it, on the
 * first road layer only.
 */
function tigerweb(input: string | URL | Request): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url.pathname.endsWith("/2") && url.searchParams.get("f") === "pjson") {
    return json({ description: "Roads as of January 1, 2025." });
  }
  const layer = Number(/MapServer\/(\d+)\/query$/.exec(url.pathname)?.[1]);
  state.tigerQueries += 1;
  if (state.provider === "one_failure" && state.tigerQueries === 2) return json({ error: "busy" }, 503);
  if (state.provider === "empty" || layer !== 0) return json({ type: "FeatureCollection", features: [] });
  const [minLon, minLat, maxLon, maxLat] = (url.searchParams.get("geometry") ?? "").split(",").map(Number);
  const inside = state.place.crashes.filter((crash) =>
    crash.longitude >= minLon && crash.longitude <= maxLon && crash.latitude >= minLat && crash.latitude <= maxLat);
  return json({
    type: "FeatureCollection",
    features: inside.map((crash) => ({
      type: "Feature",
      properties: { NAME: state.place.roadName(crash), OID: `oid-${crash.id}` },
      geometry: { type: "LineString", coordinates: [[crash.longitude - 0.006, crash.latitude], [crash.longitude + 0.006, crash.latitude]] },
    })),
  });
}

async function network(place: Place) {
  state.place = place;
  const [minLon, minLat, maxLon, maxLat] = place.bbox;
  const response = await GET(new NextRequest(
    `http://localhost/api/safety/crashes?workspaceId=${WORKSPACE_ID}&projectId=${PROJECT_ID}&ingestId=${INGEST_ID}`
    + `&minLon=${minLon}&minLat=${minLat}&maxLon=${maxLon}&maxLat=${maxLat}`,
  ));
  expect(response.status).toBe(200);
  return (await response.json()).highInjuryNetwork;
}

beforeEach(() => {
  state.provider = "named";
  state.tigerQueries = 0;
  state.cacheWrite.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal("fetch", vi.fn(tigerweb));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([NEVADA_COUNTY, CROSS_STATE_TRIBAL_AREA])("$name", (place) => {
  it("ranks the fatal crashes on named road segments, labeled as fatal crashes only", async () => {
    const hin = await network(place);
    expect(hin).toMatchObject({ status: "computed", basis: "fatal_only", method: "road_segments" });
    expect(hin.crashesPlaced).toBe(place.crashes.length);
    expect(highInjuryNetworkMeasureLabel(hin.basis, hin.method)).toBe("Fatal crashes per mile (fatal crashes only)");
    const names = new Set(place.crashes.map(place.roadName));
    for (const segment of hin.segments as HighInjuryNetworkSegment[]) {
      expect(names.has(segment.label), segment.label).toBe(true);
      expect(segment.lengthMiles).toBeGreaterThan(0);
      expect(segment.roadSource).toBe("U.S. Census TIGER/Line roads 2025-01-01");
      expect(segment.seriousInjuryCrashCount).toBeNull();
    }
    // Every line it ranked on was frozen in the project cache first.
    expect(state.cacheWrite).toHaveBeenCalledTimes(1);
    const stored = state.cacheWrite.mock.calls[0][0] as Array<{ project_id: string; road_name: string; source_feature_id: string }>;
    expect(stored).toHaveLength(place.crashes.length);
    expect(new Set(stored.map((row) => row.road_name))).toEqual(names);
    expect(stored.every((row) => row.project_id === PROJECT_ID)).toBe(true);
  });
});

describe("a place where the road service returns nothing", () => {
  it("keeps the grid, labels nothing as a road, and says the squares tie", async () => {
    state.provider = "empty";
    const hin = await network(CROSS_STATE_TRIBAL_AREA);
    expect(hin).toMatchObject({ status: "computed", basis: "fatal_only", method: "grid_cells", roadSources: [], roadMilesReviewed: null });
    expect(hin.segments).toHaveLength(3);
    for (const segment of hin.segments as HighInjuryNetworkSegment[]) {
      expect(segment.label).toMatch(/^Half-mile square, road name unavailable \(\d+\.\d{5}, -\d+\.\d{5}\)$/);
      expect(segment.lengthMiles).toBeNull();
      expect(segment.roadSource).toBeNull();
      expect(segment.geometry.type).toBe("Polygon");
    }
    expect(describeHighInjuryNetworkTie(hin.segments)).toBe("All 3 listed squares are tied at rank 1, so this list is not a ranking.");
    expect(state.cacheWrite).not.toHaveBeenCalled();
  });

  it("keeps the grid and stores nothing when one road query fails", async () => {
    state.provider = "one_failure";
    const hin = await network(NEVADA_COUNTY);
    expect(hin).toMatchObject({ status: "computed", method: "grid_cells" });
    expect(describeHighInjuryNetworkTie(hin.segments)).toBe("All 12 listed squares are tied at rank 1, so this list is not a ranking.");
    expect(state.cacheWrite).not.toHaveBeenCalled();
  });

  it("does not rank on lines it could not freeze", async () => {
    state.cacheWrite.mockResolvedValue({ error: { message: "write failed" } });
    const hin = await network(NEVADA_COUNTY);
    expect(hin).toMatchObject({ status: "computed", method: "grid_cells" });
  });
});
