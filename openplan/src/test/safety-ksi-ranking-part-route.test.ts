/**
 * KI-2026-09-05-027, route half: `part=ksi_concentrations` answers the
 * crash-location ranking alone, for the same scoped acquisition.
 *
 * The fake records every table read and RPC call, so the test can show the
 * retry reads the acquisition and the ranking and nothing else: no crash rows,
 * no band counts, no tract burden and no high-injury network.
 *
 * Blind category: the fake runs no SQL. That the RPC exists and honors its
 * parameters is proved by the migration tests and the live RLS lane.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Read = { table: string; projection: string; filters: Array<[string, unknown]> };

const state = vi.hoisted(() => ({
  reads: [] as Read[],
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
  concentrationError: null as { message: string } | null,
  concentrations: [] as Record<string, unknown>[],
  warn: vi.fn(),
}));

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const INGEST_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ warn: state.warn, error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/workspaces/membership", () => ({
  checkWorkspaceMembership: async () => ({ ok: true, role: "member" }),
}));
vi.mock("@/lib/safety/us-road-context-adapter", () => ({
  loadUsTigerRoadContext: async () => ({ roads: [], coverageLimit: "No source roads near the ranked points." }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => {
    throw new Error("the ranking retry must not write");
  },
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "member" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcs.push({ name, args });
      if (name === "safety_ksi_concentrations_for_ingests") {
        return state.concentrationError
          ? { data: null, error: state.concentrationError }
          : { data: state.concentrations, error: null };
      }
      return { data: [], error: null };
    },
    from: (table: string) => ({
      select: (projection: string) => {
        const read: Read = { table, projection, filters: [] };
        state.reads.push(read);
        const result = () => {
          if (table === "safety_crash_ingests") {
            return {
              data: [{
                id: INGEST_ID, project_id: PROJECT_ID, status: "ready", source_id: "odot-or",
                source_label: "Statewide crash file", severity_completeness: "kabco_full",
                crash_count: 4, geocoded_count: 4, stored_count: 4, truncated: false,
                years_requested: [2022, 2023, 2024], min_lon: -1, min_lat: -1, max_lon: 1, max_lat: 1,
              }],
              error: null,
            };
          }
          if (table === "safety_road_context_features" || table === "models") return { data: [], error: null };
          // The custody count: every stored crash of the acquisition.
          return { data: [], count: 4, error: null };
        };
        const chain = {
          eq: (key: string, value: unknown) => { read.filters.push([key, value]); return chain; },
          is: (key: string, value: unknown) => { read.filters.push([key, value]); return chain; },
          gte: () => chain, lte: () => chain, in: () => chain, not: () => chain, or: () => chain,
          order: () => chain, limit: () => chain, range: () => chain,
          then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
        };
        return chain;
      },
    }),
  }),
}));

import { SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION } from "@/lib/safety/crash-evidence";
import { CRASH_QUERY_PROJECTION } from "@/lib/safety/crash-filters";
import { GET } from "@/app/api/safety/crashes/route";

function request(extra = "") {
  return new NextRequest(
    `http://localhost/api/safety/crashes?workspaceId=${WORKSPACE_ID}&projectId=${PROJECT_ID}&ingestId=${INGEST_ID}` +
      `&minLon=-1&minLat=-1&maxLon=1&maxLat=1${extra}`
  );
}

beforeEach(() => {
  state.reads = [];
  state.rpcs = [];
  state.concentrationError = null;
  state.concentrations = [{
    rank: 1, longitude: 0.1, latitude: 0.2, crash_count: 3,
    fatal_crash_count: 1, serious_injury_crash_count: 2, radius_meters: 150,
  }];
  state.warn.mockReset();
});

describe("the crash route's ranking-only part", () => {
  it("reads the scoped acquisition and the ranking, and nothing else", async () => {
    const response = await GET(request("&part=ksi_concentrations"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.part).toBe("ksi_concentrations");
    expect(body.ksiConcentrations).toEqual([
      expect.objectContaining({ rank: 1, crashCount: 3, fatalCrashCount: 1, seriousInjuryCrashCount: 2 }),
    ]);
    // None of the totals or other screens ride along.
    for (const key of ["features", "severityTotals", "matchedCount", "ksiEquityTracts", "highInjuryNetwork"]) {
      expect(body).not.toHaveProperty(key);
    }

    const ingestRead = state.reads.find((read) => read.table === "safety_crash_ingests");
    expect(ingestRead?.projection).toBe(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION);
    expect(ingestRead?.filters).toEqual(expect.arrayContaining([
      ["workspace_id", WORKSPACE_ID], ["id", INGEST_ID], ["project_id", PROJECT_ID],
    ]));
    expect(state.reads.some((read) => read.projection === CRASH_QUERY_PROJECTION)).toBe(false);
    // Only the custody head count touches safety_crashes; no band counts.
    expect(state.reads.filter((read) => read.table === "safety_crashes")).toHaveLength(1);

    expect(state.rpcs.map((call) => call.name)).toEqual(["safety_ksi_concentrations_for_ingests"]);
    expect(state.rpcs[0].args).toMatchObject({
      p_workspace_id: WORKSPACE_ID,
      p_project_id: PROJECT_ID,
      p_ingest_ids: [INGEST_ID],
      p_min_lon: -1, p_min_lat: -1, p_max_lon: 1, p_max_lat: 1,
      p_severities: ["fatal", "severe_injury"],
    });
  });

  it("answers a failed ranking with an error status, never an empty list", async () => {
    state.concentrationError = { message: "upstream timeout" };
    const response = await GET(request("&part=ksi_concentrations"));
    expect(response.status).toBe(503);
    expect((await response.json()).ksiConcentrations).toBeNull();
    expect(state.warn).toHaveBeenCalledWith(
      "safety_ksi_concentrations_unavailable",
      expect.objectContaining({ part: "ksi_concentrations", error: "upstream timeout" })
    );
  });

  it("refuses a part it does not answer", async () => {
    const response = await GET(request("&part=severity_totals"));
    expect(response.status).toBe(400);
    expect(state.rpcs).toHaveLength(0);
  });

  it("still answers the full query, ranking included, without a part", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ksiConcentrations).toHaveLength(1);
    expect(body).toHaveProperty("severityTotals");
    expect(state.rpcs.map((call) => call.name).sort()).toEqual([
      "safety_ksi_concentrations_for_ingests",
      "safety_ksi_tract_burden_for_ingests",
    ]);
  });
});
