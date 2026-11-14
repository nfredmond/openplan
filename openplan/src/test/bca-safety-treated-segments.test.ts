import { describe, expect, it } from "vitest";
import {
  BCA_SAFETY_REPORT_PROJECTION,
  BCA_SAFETY_ROAD_PROJECTION,
  BCA_SEGMENT_CRASH_PROJECTION,
  loadBcaSafetyPlanOffers,
  type BcaSafetySupabaseLike,
} from "@/lib/safety/bca-evidence-loader";
import { SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION } from "@/lib/safety/crash-evidence";
import { roadLineKey } from "@/lib/safety/high-injury-network";
import { readCachedUsRoadContext } from "@/lib/safety/road-context";
import { SAFETY_COUNTERMEASURES } from "@/lib/safety/countermeasures";
import { addBcaSafetyStream } from "@/lib/bca/workbench/safety-evidence";
import {
  summarizeBcaTreatedSegments,
  type BcaCountedSegment,
  type BcaSegmentCrash,
  type BcaTreatedSegment,
} from "@/lib/safety/bca-evidence";
import { newBcaDocument } from "@/lib/bca/workbench/document";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const REPORT = "33333333-3333-4333-8333-333333333333";
const INGEST = "44444444-4444-4444-8444-444444444444";
const ROW_CAP = 1000;

// Two short parallel roads about 220 m apart, beyond the 50 m snap distance.
const roadRows = [
  { id: "r-a", road_name: "Treated Road", source_id: "U.S. Census TIGER/Line", source_vintage: "2024",
    geometry_geojson: { type: "LineString", coordinates: [[-120.5, 39.5], [-120.495, 39.5]] } },
  { id: "r-b", road_name: "Other Road", source_id: "U.S. Census TIGER/Line", source_vintage: "2024",
    geometry_geojson: { type: "LineString", coordinates: [[-120.5, 39.502], [-120.495, 39.502]] } },
];
const roads = readCachedUsRoadContext(roadRows.map((r) => ({ id: r.id, name: r.road_name, geometry_geojson: r.geometry_geojson, source: r.source_id, vintage: r.source_vintage })));
const segmentA = `road:${roadLineKey(roads.find((r) => r.name === "Treated Road")!)}:0`;
const segmentB = `road:${roadLineKey(roads.find((r) => r.name === "Other Road")!)}:0`;

type Crash = { id: string; longitude: number; latitude: number; severity: string; collision_year: number | null; killed_count: number | null };
let n = 0;
const crash = (lat: number, severity: string, year: number, killed: number | null = severity === "fatal" ? 1 : 0): Crash =>
  ({ id: `c-${String(n++).padStart(6, "0")}`, longitude: -120.4975, latitude: lat, severity, collision_year: year, killed_count: killed });

/** A CCRS-style acquisition: serious injuries separated. */
function ccrsCrashes(): Crash[] {
  return [
    crash(39.5, "fatal", 2021, 1), crash(39.5, "fatal", 2021, 2), crash(39.5, "severe_injury", 2021),
    crash(39.5, "severe_injury", 2022), crash(39.5, "severe_injury", 2022), crash(39.5, "severe_injury", 2022),
    crash(39.5, "fatal", 2023, 1),
    // On the treated road but outside the plan's severities or years.
    crash(39.5, "injury", 2022), crash(39.5, "pdo", 2022), crash(39.5, "fatal", 2020, 1),
    // On a road that has no countermeasure.
    crash(39.502, "fatal", 2022, 1), crash(39.502, "severe_injury", 2023),
    // Far from every road: more than the row cap, so the read must page.
    ...Array.from({ length: 2500 }, () => crash(39.6, "severe_injury", 2021)),
  ];
}

/** A FARS-style acquisition: fatal crashes only, one with no count of people killed. */
function farsCrashes(): Crash[] {
  return [
    crash(39.5, "fatal", 2021, 1), crash(39.5, "fatal", 2022, null), crash(39.5, "fatal", 2022, 3),
    crash(39.502, "fatal", 2021, 1),
    ...Array.from({ length: 1200 }, () => crash(39.6, "fatal", 2023)),
  ];
}

type Call = { table: string; columns: string; options?: unknown; filters: Array<[string, string, unknown]> };

/** A PostgREST stand-in that applies filters and never returns more than ROW_CAP rows. */
function fakeClient(tables: Record<string, Array<Record<string, unknown>>>, failCrashRangeFrom: number | null = null) {
  const calls: Call[] = [];
  const client: BcaSafetySupabaseLike = {
    from(table) {
      return {
        select(columns, options) {
          const call: Call = { table, columns, options, filters: [] };
          calls.push(call);
          let rows = [...(tables[table] ?? [])];
          const orders: Array<[string, boolean]> = [];
          let range: [number, number] | null = null;
          let limit: number | null = null;
          const builder = {
            eq(c: string, v: unknown) { call.filters.push(["eq", c, v]); rows = rows.filter((r) => r[c] === v); return builder; },
            in(c: string, vs: readonly unknown[]) { call.filters.push(["in", c, vs]); rows = rows.filter((r) => vs.includes(r[c])); return builder; },
            gte(c: string, v: unknown) { call.filters.push(["gte", c, v]); rows = rows.filter((r) => (r[c] as number) >= (v as number)); return builder; },
            lte(c: string, v: unknown) { call.filters.push(["lte", c, v]); rows = rows.filter((r) => (r[c] as number) <= (v as number)); return builder; },
            order(c: string, o: { ascending: boolean }) { call.filters.push(["order", c, o]); orders.push([c, o.ascending]); return builder; },
            range(from: number, to: number) { range = [from, to]; return builder; },
            limit(count: number) { limit = count; return builder; },
            then(resolve: (value: { data: unknown; error: unknown; count?: number | null }) => unknown) {
              const count = rows.length;
              rows.sort((a, b) => {
                for (const [c, ascending] of orders) {
                  if (String(a[c]) === String(b[c])) continue;
                  return (String(a[c]) < String(b[c]) ? -1 : 1) * (ascending ? 1 : -1);
                }
                return 0;
              });
              let out = range ? rows.slice(range[0], range[1] + 1) : rows;
              if (limit !== null) out = out.slice(0, limit);
              out = out.slice(0, ROW_CAP);
              const head = (options as { head?: boolean } | undefined)?.head === true;
              if (table === "safety_crashes" && range && failCrashRangeFrom !== null && range[0] >= failCrashRangeFrom)
                return Promise.resolve({ data: null, error: { message: "page failed" }, count: null }).then(resolve);
              return Promise.resolve({ data: head ? null : out, error: null, count }).then(resolve);
            },
          };
          return builder as never;
        },
      };
    },
  };
  return { client, calls };
}

function tablesFor(crashes: Crash[], severityCompleteness: string, sourceId: string) {
  return {
    reports: [{ id: REPORT, title: "Local Road Safety Plan", workspace_id: WS, project_id: PROJECT, updated_at: "2026-01-01T00:00:00Z",
      metadata_json: { safetyActionPlan: { ingestId: INGEST, attachments: [
        { segmentId: segmentA, segmentLabel: "Treated Road", countermeasureIds: [SAFETY_COUNTERMEASURES[0].id] },
      ] } } }],
    safety_crash_ingests: [{ id: INGEST, workspace_id: WS, project_id: PROJECT, status: "ready", source_id: sourceId,
      source_label: `${sourceId} test extract`, severity_completeness: severityCompleteness,
      min_lon: -121, min_lat: 39, max_lon: -120, max_lat: 40, years_requested: [2021, 2022, 2023],
      crash_count: crashes.length, geocoded_count: crashes.length, stored_count: crashes.length, truncated: false }],
    safety_road_context_features: roadRows.map((r) => ({ ...r, workspace_id: WS, project_id: PROJECT })),
    safety_crashes: crashes.map((c) => ({ ...c, workspace_id: WS, ingest_id: INGEST })),
  };
}

async function load(crashes: Crash[], severityCompleteness: string, sourceId: string) {
  const fake = fakeClient(tablesFor(crashes, severityCompleteness, sourceId));
  const read = await loadBcaSafetyPlanOffers(fake.client, { workspaceId: WS, projectId: PROJECT });
  if (read.status !== "read") throw new Error("read failed");
  const plan = read.plans[0];
  if (plan.status !== "ready") throw new Error(`plan unavailable: ${plan.reason}`);
  return { plan, calls: fake.calls };
}

/** The segment's counts, or a failure if no count was offered. */
function counted(segment: BcaTreatedSegment): BcaCountedSegment {
  if (segment.status !== "counted") throw new Error(`segment not counted: ${segment.reason}`);
  return segment;
}

describe("crashes offered on a saved safety plan's treated segments", () => {
  it("equal the stored counts by severity and year for a CCRS acquisition read past the row cap", async () => {
    const { plan, calls } = await load(ccrsCrashes(), "kabco_full", "ccrs");
    // The fixture holds two distinct road segments; only the treated one is offered.
    expect(segmentB).not.toBe(segmentA);
    expect(plan.segments.map((s) => s.segmentId)).toEqual([segmentA]);
    expect(plan.seriousInjury).toBe("counted");
    expect(plan.years).toEqual([2021, 2022, 2023]);
    expect(plan.sourceId).toBe("ccrs");
    const a = counted(plan.segments[0]);
    expect(a.years).toEqual([
      { year: 2021, fatalCrashes: 2, seriousInjuryCrashes: 1 },
      { year: 2022, fatalCrashes: 0, seriousInjuryCrashes: 3 },
      { year: 2023, fatalCrashes: 1, seriousInjuryCrashes: 0 },
    ]);
    expect(a).toMatchObject({ fatalCrashes: 3, seriousInjuryCrashes: 4, fatalities: 4, fatalCrashesWithoutPersonCount: 0 });
    // The catalog note names the CMF Clearinghouse entries read for the item (KI-2026-11-14-290).
    expect(a.countermeasures[0].cmfNote).toMatch(/^CMF Clearinghouse, read November 14, 2026: entry \d+/);

    // Projections and scope filters the counts depend on.
    const crashReads = calls.filter((c) => c.table === "safety_crashes" && c.columns === BCA_SEGMENT_CRASH_PROJECTION);
    expect(crashReads.length).toBeGreaterThan(2); // 2,500+ rows under a 1,000-row cap
    for (const read of crashReads) {
      expect(read.filters).toContainEqual(["eq", "workspace_id", WS]);
      expect(read.filters).toContainEqual(["eq", "ingest_id", INGEST]);
      expect(read.filters).toContainEqual(["in", "severity", ["fatal", "severe_injury"]]);
      expect(read.filters).toContainEqual(["in", "collision_year", [2021, 2022, 2023]]);
      expect(read.filters).toContainEqual(["order", "id", { ascending: true }]);
    }
    expect(calls.find((c) => c.table === "reports")?.columns).toBe(BCA_SAFETY_REPORT_PROJECTION);
    expect(calls.find((c) => c.table === "safety_crash_ingests")?.columns).toBe(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION);
    expect(calls.find((c) => c.table === "safety_road_context_features")?.columns).toBe(BCA_SAFETY_ROAD_PROJECTION);
  });

  it("keeps injury crashes unavailable, not zero, for a fatal-only FARS acquisition", async () => {
    const { plan } = await load(farsCrashes(), "fatal_only", "fars");
    expect(plan.seriousInjury).toBe("not_in_source");
    const a = counted(plan.segments[0]);
    expect(a.years).toEqual([
      { year: 2021, fatalCrashes: 1, seriousInjuryCrashes: null },
      { year: 2022, fatalCrashes: 2, seriousInjuryCrashes: null },
      { year: 2023, fatalCrashes: 0, seriousInjuryCrashes: null },
    ]);
    expect(a).toMatchObject({ fatalCrashes: 3, seriousInjuryCrashes: null, fatalities: null, fatalCrashesWithoutPersonCount: 1 });
    const doc = newBcaDocument(PROJECT);
    expect(() => addBcaSafetyStream(doc, plan, a, { outcome: "serious-injury", persons: 2, cmf: 0.8, cmfId: 123 }))
      .toThrow("Injury crashes are not in it");
  });

  it("says a failed crash read failed instead of offering fewer crashes", async () => {
    // The third page of crash rows errors.
    const fake = fakeClient(tablesFor(ccrsCrashes(), "kabco_full", "ccrs"), 2000);
    const read = await loadBcaSafetyPlanOffers(fake.client, { workspaceId: WS, projectId: PROJECT });
    expect(read).toMatchObject({ status: "read", plans: [{ status: "unavailable" }] });
  });

  // An acquisition that records injury crashes without separating the serious
  // ones ranks on fatal crashes too. That is not a fatal-only source.
  it("says serious injuries are not separated, not absent, for a fatal-and-injury acquisition", async () => {
    const { plan } = await load(farsCrashes(), "fatal_injury_only", "ccrs");
    expect(plan.seriousInjury).toBe("not_separated");
    const a = counted(plan.segments[0]);
    expect(a.seriousInjuryCrashes).toBeNull();
    expect(() => addBcaSafetyStream(newBcaDocument(PROJECT), plan, a, { outcome: "serious-injury", persons: 2, cmf: 0.8, cmfId: 123 }))
      .toThrow("does not separate the serious ones");
  });

  // A plan saved against grid squares, or against road lines that were stored
  // again, names a segment the current road lines do not produce.
  it("offers no count for a treated segment the stored road lines no longer produce", async () => {
    const tables = tablesFor(ccrsCrashes(), "kabco_full", "ccrs");
    const attachments = (tables.reports[0].metadata_json.safetyActionPlan.attachments as Array<Record<string, unknown>>);
    attachments.push({ segmentId: "grid:-14972:6143", segmentLabel: "Half-mile square near Treated Road", countermeasureIds: [SAFETY_COUNTERMEASURES[0].id] });
    const fake = fakeClient(tables);
    const read = await loadBcaSafetyPlanOffers(fake.client, { workspaceId: WS, projectId: PROJECT });
    if (read.status !== "read" || read.plans[0].status !== "ready") throw new Error("plan not ready");
    const [resolved, unresolved] = read.plans[0].segments;
    expect(counted(resolved).fatalCrashes).toBe(3);
    expect(unresolved.status).toBe("unresolved");
    expect(unresolved).not.toHaveProperty("fatalCrashes");
    expect(unresolved).not.toHaveProperty("years");
    expect(unresolved).toMatchObject({ reason: expect.stringContaining("not zero crashes") });
    expect(() => addBcaSafetyStream(newBcaDocument(PROJECT), read.plans[0] as never, unresolved as never, { outcome: "fatality", persons: 1, cmf: 0.8, cmfId: 123 }))
      .toThrow("not counted");
  });

  // Twenty-five newer reports carry no safety plan. The plan must still be found.
  it("finds a saved plan behind more than twenty newer reports that have none", async () => {
    const tables = tablesFor(ccrsCrashes(), "kabco_full", "ccrs");
    for (let i = 0; i < 25; i += 1) {
      tables.reports.push({ id: `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`, title: `Status report ${i}`,
        workspace_id: WS, project_id: PROJECT, updated_at: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`, metadata_json: {} as never });
    }
    const fake = fakeClient(tables);
    const read = await loadBcaSafetyPlanOffers(fake.client, { workspaceId: WS, projectId: PROJECT });
    expect(read).toMatchObject({ status: "read", plansNotShown: 0, plans: [{ status: "ready", reportId: REPORT }] });
    const reportReads = fake.calls.filter((c) => c.table === "reports");
    for (const call of reportReads) {
      expect(call.filters).toContainEqual(["order", "updated_at", { ascending: false }]);
      expect(call.filters).toContainEqual(["order", "id", { ascending: true }]);
    }
  });

  it("says how many older plans it leaves out", async () => {
    const tables = tablesFor(farsCrashes(), "fatal_only", "fars");
    const first = tables.reports[0];
    for (let i = 0; i < 22; i += 1) {
      tables.reports.push({ ...first, id: `88888888-8888-4888-8888-${String(i).padStart(12, "0")}`, title: `Plan ${i}`,
        updated_at: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00Z` });
    }
    const fake = fakeClient(tables);
    const read = await loadBcaSafetyPlanOffers(fake.client, { workspaceId: WS, projectId: PROJECT });
    if (read.status !== "read") throw new Error("read failed");
    expect(read.plans).toHaveLength(20);
    expect(read.plansNotShown).toBe(3);
    // Newest first: the original, oldest plan is one of the three left out.
    expect(read.plans.map((plan) => plan.reportId)).not.toContain(REPORT);
    expect(read.plans[0].reportTitle).toBe("Plan 21");
  });
});

describe("treated-segment counting", () => {
  it("counts only fatal and serious-injury crashes placed on the treated segment in requested years", () => {
    const row = (id: string, severity: BcaSegmentCrash["severity"], year: number | null): BcaSegmentCrash =>
      ({ id, longitude: 0, latitude: 0, severity, collisionYear: year, killedCount: severity === "fatal" ? 1 : 0 });
    const crashes = [row("f1", "fatal", 2021), row("s1", "severe_injury", 2021), row("i1", "injury", 2021),
      row("p1", "pdo", 2021), row("u1", "unknown", 2021), row("f2", "fatal", 2019), row("f3", "fatal", null), row("fb", "fatal", 2021)];
    const placements = new Map(crashes.map((c) => [c.id, c.id === "fb" ? "road:other:0" : "road:treated:0"]));
    const [first] = summarizeBcaTreatedSegments({
      attachments: [{ segmentId: "road:treated:0", segmentLabel: "Treated", countermeasureIds: [] }],
      crashes, placements, seriousInjuryCounted: true, years: [2021],
    });
    const segment = counted(first);
    expect(segment.years).toEqual([{ year: 2021, fatalCrashes: 1, seriousInjuryCrashes: 1 }]);
    expect(segment.fatalities).toBe(1);
  });
});

describe("a safety stream enters the analysis only when the planner adds it", () => {
  it("adds recorded fatalities with the planner's CMF and refuses a blank factor or ID", async () => {
    const { plan } = await load(ccrsCrashes(), "kabco_full", "ccrs");
    const a = counted(plan.segments[0]);
    const doc = newBcaDocument(PROJECT);
    expect(() => addBcaSafetyStream(doc, plan, a, { outcome: "fatality", persons: null, cmf: null, cmfId: 123 })).toThrow("blank is not zero");
    expect(() => addBcaSafetyStream(doc, plan, a, { outcome: "fatality", persons: null, cmf: 0.75, cmfId: null })).toThrow("CMF Clearinghouse ID");
    expect(() => addBcaSafetyStream(doc, plan, a, { outcome: "serious-injury", persons: null, cmf: 0.75, cmfId: 123 })).toThrow("persons");
    const next = addBcaSafetyStream(doc, plan, a, { outcome: "fatality", persons: 99, cmf: 0.75, cmfId: 123 });
    // Recorded fatalities win over a typed number; 4 people over 3 requested years.
    expect(next.flows).toHaveLength(1);
    expect(next.flows[0]).toMatchObject({ category: "safety", unit: "fatality", noBuild: 4 / 3, build: (4 / 3) * 0.75, unitValue: null });
    expect(next.evidence.map((e) => e.reference)).toEqual([`/reports/${REPORT}`, "https://cmfclearinghouse.fhwa.dot.gov/detail.php?facid=123"]);
    expect(doc.flows).toHaveLength(0);
    expect(() => addBcaSafetyStream(next, plan, a, { outcome: "fatality", persons: null, cmf: 0.75, cmfId: 123 })).toThrow("already in the analysis");
  });
});
