import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ retained: 4 as number | null, unavailable: false,
  queries: [] as Array<{ table: string; projection: string; filters: Array<[string, unknown]> }> }));
const workspaceId = "11111111-1111-4111-8111-111111111111";
const ingestId = "22222222-2222-4222-8222-222222222222";
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/workspaces/membership", () => ({ checkWorkspaceMembership: async () => ({ ok: true, role: "owner" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "member" } } }) },
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => ({ select: (projection: string) => {
      const query = { table, projection, filters: [] as Array<[string, unknown]> };
      state.queries.push(query);
      const result = () => {
        if (table === "safety_crash_ingests") {
          const row: Record<string, unknown> = { id: ingestId, project_id: null, status: "ready",
            geocoded_count: 40, stored_count: 4, truncated: true, severity_completeness: "kabco_full" };
          const selected = Object.fromEntries(projection.split(",").map((key) => [key.trim(), row[key.trim()]]));
          return { data: state.unavailable ? [] : [selected], error: null };
        }
        const unfiltered = query.filters.every(([key]) => ["workspace_id", "ingest_id"].includes(key));
        return { data: [], count: unfiltered ? state.retained : 0, error: null };
      };
      const chain = {
        eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
        is: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
        gte: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
        lte: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
        in: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; },
        or: () => chain, order: () => chain, limit: () => chain, range: () => chain,
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return chain;
    } }),
  }), createServiceRoleClient: vi.fn(),
}));
import { GET } from "@/app/api/safety/crashes/route";
import { GET as exportCrashes } from "@/app/api/safety/crashes/export/route";
function request(exporting = false) {
  return new NextRequest(`http://localhost/api/safety/crashes${exporting ? "/export" : ""}?workspaceId=${workspaceId}&ingestId=${ingestId}&minLon=0&minLat=0&maxLon=1&maxLat=1`);
}
describe("the visible acquisition and export share custody", () => {
  beforeEach(() => { state.retained = 4; state.unavailable = false; state.queries = []; });
  it.each([0, 3, null])("withholds a missing or unreadable acquisition with %s retained rows", async (retained) => {
    state.retained = retained;
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.severityTotals).toBeNull();
    expect(body.ksiConcentrations).toBeNull();
    expect(body.custodyWarning).toContain("Missing records are not zero");
    expect((await exportCrashes(request(true))).status).toBe(409);
  });
  it("keeps source truncation separate from missing stored records and binds the exact export", async () => {
    const body = await (await GET(request())).json();
    expect(body.custodyWarning).toBeUndefined();
    expect(body.severityTotals).not.toBeNull();
    const exported = await exportCrashes(request(true));
    expect(exported.status).toBe(200);
    expect(await exported.text()).toContain(ingestId);
    for (const query of state.queries.filter((q) => q.table === "safety_crash_ingests")) {
      expect(query.filters).toContainEqual(["id", ingestId]);
      expect(query.filters).toContainEqual(["workspace_id", workspaceId]);
      expect(query.projection).toContain("stored_count");
    }
    const custodyQueries = state.queries.filter((q) => q.table === "safety_crashes" && q.filters.length === 2);
    expect(custodyQueries.length).toBeGreaterThanOrEqual(2);
    for (const query of custodyQueries) expect(query.filters).toContainEqual(["ingest_id", ingestId]);
  });
  it("does not turn a context without an acquisition into zero fatal crashes", async () => {
    state.unavailable = true;
    const body = await (await GET(request())).json();
    expect(body.severityTotals).toBeNull();
    expect(body.custodyWarning).toContain("No crash count has been established");
  });
});
