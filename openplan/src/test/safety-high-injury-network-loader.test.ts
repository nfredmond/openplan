/**
 * The high-injury network reads every severe crash in scope, under the 1,000-row
 * cap, and refuses a short read instead of ranking a smaller network.
 *
 * The fake enforces the row cap the way PostgREST does, so a loader that read
 * one page and stopped would rank 1,000 of 2,500 crashes and this file would
 * see it. Blind category: the fake does not run SQL, so it cannot prove the
 * real column names exist; it pins the projection and filters the loader asks for.
 */
import { describe, expect, it } from "vitest";
import {
  buildHighInjuryNetworkForIngest,
  HIGH_INJURY_NETWORK_CRASH_PROJECTION,
  loadHighInjuryNetworkCrashes,
  type HighInjuryNetworkCrashQuery,
  type HighInjuryNetworkSupabaseLike,
} from "@/lib/safety/high-injury-network-loader";

type Row = { id: string; longitude: number; latitude: number; severity: string };
type Call = { method: string; args: unknown[] };

const ROW_CAP = 1000;

function fakeSupabase(
  rows: Row[],
  options: { count?: number | null; error?: unknown; dropAfterFirstPage?: boolean; rowCap?: number } = {},
) {
  const calls: Call[] = [];
  const selects: Array<{ columns: string; options?: unknown }> = [];
  const supabase: HighInjuryNetworkSupabaseLike = {
    from() {
      return {
        select(columns: string, selectOptions?: { count: "exact" }) {
          selects.push({ columns, options: selectOptions });
          let from = 0;
          let to = rows.length - 1;
          const query: HighInjuryNetworkCrashQuery = {
            eq: (...args) => { calls.push({ method: "eq", args }); return query; },
            gte: (...args) => { calls.push({ method: "gte", args }); return query; },
            lte: (...args) => { calls.push({ method: "lte", args }); return query; },
            in: (...args) => { calls.push({ method: "in", args }); return query; },
            order: (...args) => { calls.push({ method: "order", args }); return query; },
            range: (start, end) => { from = start; to = end; return query; },
            then(resolve, reject) {
              const capped = Math.min(to, from + (options.rowCap ?? ROW_CAP) - 1);
              const page = options.dropAfterFirstPage && from > 0 ? [] : rows.slice(from, capped + 1);
              return Promise.resolve({
                data: options.error ? null : page,
                error: options.error ?? null,
                count: options.count === undefined ? rows.length : options.count,
              }).then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
  };
  return { supabase, calls, selects };
}

const SCOPE = {
  workspaceId: "w-1",
  ingestId: "i-1",
  bbox: { minLon: -1, minLat: -1, maxLon: 1, maxLat: 1 },
  severities: ["fatal", "severe_injury"] as const,
};

function rowsOf(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c-${String(index).padStart(5, "0")}`,
    longitude: 0.0001 * index,
    latitude: 0,
    severity: index % 3 === 0 ? "fatal" : "severe_injury",
  }));
}

describe("reading severe crashes for the network", () => {
  it("reads past the row cap until the pages add up to the exact count", async () => {
    const { supabase, selects, calls } = fakeSupabase(rowsOf(2500));
    const read = await loadHighInjuryNetworkCrashes(supabase, { ...SCOPE, yearFrom: 2020, yearTo: 2024 });
    expect(read.status).toBe("read");
    if (read.status !== "read") return;
    expect(read.crashes).toHaveLength(2500);
    expect(read.count).toBe(2500);
    expect(selects.length).toBe(3);
    expect(selects[0]).toEqual({ columns: HIGH_INJURY_NETWORK_CRASH_PROJECTION, options: { count: "exact" } });
    expect(HIGH_INJURY_NETWORK_CRASH_PROJECTION).toBe("id, longitude, latitude, severity");
    expect(calls).toContainEqual({ method: "eq", args: ["ingest_id", "i-1"] });
    expect(calls).toContainEqual({ method: "eq", args: ["workspace_id", "w-1"] });
    expect(calls).toContainEqual({ method: "in", args: ["severity", ["fatal", "severe_injury"]] });
    expect(calls).toContainEqual({ method: "gte", args: ["collision_year", 2020] });
    expect(calls).toContainEqual({ method: "lte", args: ["collision_year", 2024] });
    expect(calls).toContainEqual({ method: "order", args: ["id", { ascending: true }] });
  });

  it("reads in full from a server whose row cap is below the page size", async () => {
    const { supabase, selects } = fakeSupabase(rowsOf(1200), { rowCap: 500 });
    const read = await loadHighInjuryNetworkCrashes(supabase, SCOPE);
    expect(read).toMatchObject({ status: "read", count: 1200 });
    if (read.status === "read") expect(new Set(read.crashes.map((crash) => crash.id)).size).toBe(1200);
    expect(selects).toHaveLength(3);
  });

  it("calls a short read a failure, never a smaller network", async () => {
    const { supabase } = fakeSupabase(rowsOf(2500), { dropAfterFirstPage: true });
    expect(await loadHighInjuryNetworkCrashes(supabase, SCOPE)).toEqual({ status: "failed" });
  });

  it("calls an unreadable count a failure", async () => {
    const { supabase } = fakeSupabase(rowsOf(10), { count: null });
    expect(await loadHighInjuryNetworkCrashes(supabase, SCOPE)).toEqual({ status: "failed" });
  });

  it("calls a database error a failure", async () => {
    const { supabase } = fakeSupabase(rowsOf(10), { error: { message: "timeout" } });
    expect(await loadHighInjuryNetworkCrashes(supabase, SCOPE)).toEqual({ status: "failed" });
  });

  it("refuses an area above the limit instead of ranking part of it", async () => {
    const { supabase, selects } = fakeSupabase(rowsOf(30));
    expect(await loadHighInjuryNetworkCrashes(supabase, SCOPE, 20)).toEqual({ status: "too_many", count: 30 });
    expect(selects).toHaveLength(1);
  });

  it("reads zero crashes as a computed, empty network", async () => {
    const { supabase } = fakeSupabase([]);
    const network = await buildHighInjuryNetworkForIngest(supabase, {
      workspaceId: "w-1",
      ingestId: "i-1",
      severityCompleteness: "kabco_full",
      bbox: SCOPE.bbox,
      years: [2024],
      roads: [],
    });
    expect(network).toMatchObject({ status: "computed", crashesConsidered: 0, segments: [] });
  });
});

describe("what the route gets back", () => {
  it("does not query when the source's severity coverage is unknown", async () => {
    const { supabase, selects } = fakeSupabase(rowsOf(5));
    const network = await buildHighInjuryNetworkForIngest(supabase, {
      workspaceId: "w-1",
      ingestId: "i-1",
      severityCompleteness: "unrecorded",
      bbox: SCOPE.bbox,
      years: [2024],
      roads: [],
    });
    expect(network).toEqual({ status: "unavailable", reason: "severity_coverage_unknown", basis: null });
    expect(selects).toHaveLength(0);
  });

  it("asks for fatal crashes only when the source records only deaths", async () => {
    const { supabase, calls } = fakeSupabase(rowsOf(3).map((row) => ({ ...row, severity: "fatal" })));
    const network = await buildHighInjuryNetworkForIngest(supabase, {
      workspaceId: "w-1",
      ingestId: "i-1",
      severityCompleteness: "fatal_only",
      bbox: SCOPE.bbox,
      years: [2022],
      roads: [],
    });
    expect(calls).toContainEqual({ method: "in", args: ["severity", ["fatal"]] });
    expect(network).toMatchObject({ status: "computed", basis: "fatal_only", crashesConsidered: 3 });
  });

  it("turns a failed read into an unavailable state with its reason", async () => {
    const { supabase } = fakeSupabase(rowsOf(5), { error: { message: "boom" } });
    const network = await buildHighInjuryNetworkForIngest(supabase, {
      workspaceId: "w-1",
      ingestId: "i-1",
      severityCompleteness: "kabco_full",
      bbox: SCOPE.bbox,
      years: [2024],
      roads: [],
    });
    expect(network).toEqual({ status: "unavailable", reason: "crash_read_failed", basis: "ksi" });
  });
});
