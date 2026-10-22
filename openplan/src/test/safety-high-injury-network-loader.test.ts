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

type Row = { id: string; longitude: number; latitude: number; severity: string; collision_year: number | null };
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
          const yearPredicates: Array<(year: number | null) => boolean> = [];
          const query: HighInjuryNetworkCrashQuery = {
            eq: (...args) => { calls.push({ method: "eq", args }); return query; },
            gte: (column, value) => {
              calls.push({ method: "gte", args: [column, value] });
              if (column === "collision_year") yearPredicates.push((year) => year !== null && year >= Number(value));
              return query;
            },
            lte: (column, value) => {
              calls.push({ method: "lte", args: [column, value] });
              if (column === "collision_year") yearPredicates.push((year) => year !== null && year <= Number(value));
              return query;
            },
            in: (column, values) => {
              calls.push({ method: "in", args: [column, values] });
              if (column === "collision_year") yearPredicates.push((year) => year !== null && values.includes(year));
              return query;
            },
            order: (...args) => { calls.push({ method: "order", args }); return query; },
            range: (start, end) => { from = start; to = end; return query; },
            then(resolve, reject) {
              const matching = rows.filter((row) => yearPredicates.every((predicate) => predicate(row.collision_year)));
              const capped = Math.min(to, from + (options.rowCap ?? ROW_CAP) - 1);
              const page = options.dropAfterFirstPage && from > 0 ? [] : matching.slice(from, capped + 1);
              return Promise.resolve({
                data: options.error ? null : page,
                error: options.error ?? null,
                count: options.count === undefined ? matching.length : options.count,
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
    collision_year: 2024,
  }));
}

describe("reading severe crashes for the network", () => {
  it("filters every page and exact count to sparse requested years without filling the gap", async () => {
    const rows = rowsOf(3500).map((row, index) => ({ ...row, collision_year: [2020, 2021, 2022, null][index % 4] }));
    const { supabase, selects, calls } = fakeSupabase(rows, { rowCap: 500 });
    const read = await loadHighInjuryNetworkCrashes(supabase, { ...SCOPE, years: [2022, 2020, 2022] });
    expect(read).toMatchObject({ status: "read", count: 1750 });
    if (read.status !== "read") throw new Error("expected exact-year read");
    expect(read.crashes.map((row) => row.id)).toEqual(rows.filter((row) => row.collision_year === 2020 || row.collision_year === 2022).map((row) => row.id));
    expect(selects).toHaveLength(4);
    expect(selects.every((select) => select.columns === "id, longitude, latitude, severity")).toBe(true);
    expect(calls.filter((call) => call.method === "in" && call.args[0] === "collision_year")).toEqual(
      Array.from({ length: 4 }, () => ({ method: "in", args: ["collision_year", [2020, 2022]] })),
    );
  });

  it("preserves range-only and unbounded reads when no exact set is supplied", async () => {
    const rows = rowsOf(5).map((row, index) => ({ ...row, collision_year: [2019, 2020, 2021, 2022, null][index] }));
    const { supabase, calls } = fakeSupabase(rows);
    const ranged = await loadHighInjuryNetworkCrashes(supabase, { ...SCOPE, yearFrom: 2020, yearTo: 2021 });
    expect(ranged).toMatchObject({ status: "read", count: 2 });
    if (ranged.status !== "read") throw new Error("expected range read");
    expect(ranged.crashes.map((row) => row.id)).toEqual(rows.slice(1, 3).map((row) => row.id));
    expect(calls).not.toContainEqual({ method: "in", args: ["collision_year", expect.anything()] });
    expect(await loadHighInjuryNetworkCrashes(supabase, SCOPE)).toMatchObject({ status: "read", count: 5 });
  });

  it.each([{ years: [] }, { years: [2022.5] }, { years: [NaN] }, { years: [1899] }, { years: [2101] }])("refuses explicit invalid year membership $years before querying", async ({ years }) => {
    const { supabase, selects } = fakeSupabase(rowsOf(1));
    expect(await loadHighInjuryNetworkCrashes(supabase, { ...SCOPE, years })).toEqual({ status: "failed" });
    expect(selects).toHaveLength(0);
  });

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
    const { supabase, calls } = fakeSupabase(rowsOf(3).map((row) => ({ ...row, severity: "fatal", collision_year: 2022 })));
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

  it("uses the same exact bounded selection for membership and output labels", async () => {
    const { supabase, calls } = fakeSupabase(rowsOf(4).map((row, index) => ({ ...row, collision_year: 2020 + index })));
    const network = await buildHighInjuryNetworkForIngest(supabase, {
      workspaceId: SCOPE.workspaceId, ingestId: SCOPE.ingestId, bbox: SCOPE.bbox,
      severityCompleteness: "kabco_full", years: [2023, 2020, 2022, 2022], yearFrom: 2021, yearTo: 2022, roads: [],
    });
    expect(network).toMatchObject({ status: "computed", years: [2022], crashesConsidered: 1 });
    expect(calls).toContainEqual({ method: "in", args: ["collision_year", [2022]] });
    expect(calls).toContainEqual({ method: "gte", args: ["collision_year", 2021] });
    expect(calls).toContainEqual({ method: "lte", args: ["collision_year", 2022] });
  });

  it.each([{ years: [] }, { years: [2022.5] }, { years: [2020] }])("withholds a missing, invalid or disjoint period $years instead of returning zero", async ({ years }) => {
    const { supabase, selects } = fakeSupabase(rowsOf(1));
    expect(await buildHighInjuryNetworkForIngest(supabase, {
      workspaceId: SCOPE.workspaceId, ingestId: SCOPE.ingestId, bbox: SCOPE.bbox,
      severityCompleteness: "kabco_full", years, yearFrom: 2022, roads: [],
    })).toEqual({ status: "unavailable", reason: "year_scope_unavailable", basis: "ksi" });
    expect(selects).toHaveLength(0);
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
