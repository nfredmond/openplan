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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Query = { table: string; projection: string; filters: Array<[string, unknown]>; range: [number, number] | null };

const state = vi.hoisted(() => ({
  severityCompleteness: "kabco_full",
  roadError: false,
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
  createServiceRoleClient: vi.fn(),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "member" } } }) },
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => ({
      select: (projection: string) => {
        const query: Query = { table, projection, filters: [], range: null };
        state.queries.push(query);
        const result = () => {
          if (table === "safety_crash_ingests") {
            return {
              data: [{
                id: INGEST_ID, project_id: PROJECT_ID, status: "ready", source_label: "Statewide crash file",
                severity_completeness: state.severityCompleteness, crash_count: 4, geocoded_count: 4,
                stored_count: 4, truncated: false, years_requested: [2022, 2023, 2024],
              }],
              error: null,
            };
          }
          if (table === "safety_road_context_features") {
            return state.roadError
              ? { data: null, error: { message: "permission denied" } }
              : {
                  data: [{
                    id: "row-1", road_name: "Main Street", source_id: "us-census-tiger-line-cache",
                    source_vintage: "2025-01-01", cached_at: "2026-10-01T00:00:00Z",
                    geometry_geojson: { type: "LineString", coordinates: [[0, 0.5], [0.0072, 0.5]] },
                  }],
                  error: null,
                };
          }
          if (table === "models") return { data: [], error: null };
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

import { GET } from "@/app/api/safety/crashes/route";

function request(extra = "") {
  return new NextRequest(
    `http://localhost/api/safety/crashes?workspaceId=${WORKSPACE_ID}&projectId=${PROJECT_ID}&ingestId=${INGEST_ID}&minLon=-1&minLat=-1&maxLon=1&maxLat=1${extra}`,
  );
}

function networkQuery() {
  return state.queries.find((query) => query.projection === NETWORK_PROJECTION);
}

beforeEach(() => {
  state.severityCompleteness = "kabco_full";
  state.roadError = false;
  state.queries = [];
  state.severeRows = [
    { id: "c1", longitude: 0.002, latitude: 0.5001, severity: "fatal" },
    { id: "c2", longitude: 0.004, latitude: 0.5001, severity: "severe_injury" },
  ];
});

describe("the crash route's high-injury network", () => {
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

  it("reports a failed road read as unavailable, not as a grid or an empty list", async () => {
    state.roadError = true;
    const body = await (await GET(request())).json();
    expect(body.highInjuryNetwork).toEqual({ status: "unavailable", reason: "road_read_failed", basis: "ksi" });
    expect(networkQuery()).toBeUndefined();
  });
});
