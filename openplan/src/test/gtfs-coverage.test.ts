/**
 * "DOES THIS FEED SERVE THIS STUDY AREA" — and the three ways of getting it
 * wrong that this module is built to refuse.
 *
 *   1. A FAILED READ BECOMING A COVERAGE FACT. PostgREST answers a count it
 *      could not produce with `count: null`, and reading that as zero would
 *      tell a planner their transit agency does not serve their own city
 *      because a query timed out.
 *   2. UNDER-ANSWERING. The predicate is a bounding box over plain numeric
 *      columns, because supabase-js cannot read PostGIS. It over-answers by
 *      construction — a stop in the envelope's corner counts — and that
 *      direction is the safe one: over-answering lets a feed through for the
 *      worker to judge properly, under-answering prints a confident "this feed
 *      does not cover your area" about a feed that does.
 *   3. A DEGENERATE ENVELOPE SELECTING NOTHING. A study area crossing the
 *      antimeridian produces `minLon > maxLon`, and a `gte`/`lte` pair over
 *      that matches no row at all — which would read as "no stops here" about
 *      the entire Pacific.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  GTFS_STOP_COVERAGE_COLUMNS,
  GTFS_STOP_COVERAGE_TABLE,
  assessFeedVersionCoverage,
  bboxIsQueryable,
  coverageFromStopRowCount,
  type CoverageQueryClient,
} from "@/lib/gtfs/coverage";
import { collectSupabaseSelectSites } from "./supabase-call-sites";

const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const SACRAMENTO = { minLon: -121.6, minLat: 38.4, maxLon: -121.3, maxLat: 38.7 };

function fakeClient(answer: { count: number | null; error: { message: string } | null }) {
  const filters: Array<{ verb: string; column: string; value: unknown }> = [];
  let table: string | null = null;
  let head = false;

  const chain = {
    eq(column: string, value: unknown) {
      filters.push({ verb: "eq", column, value });
      return chain;
    },
    gte(column: string, value: unknown) {
      filters.push({ verb: "gte", column, value });
      return chain;
    },
    lte(column: string, value: unknown) {
      filters.push({ verb: "lte", column, value });
      return chain;
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(answer).then(resolve, reject);
    },
  };

  const client = {
    from(name: string) {
      table = name;
      return {
        select(_columns: string, options: { head: true; count: "exact" }) {
          head = options.head;
          return chain;
        },
      };
    },
  };

  return {
    client: client as unknown as CoverageQueryClient,
    filters,
    get table() {
      return table;
    },
    get head() {
      return head;
    },
  };
}

describe("counting a feed's stops inside a study area", () => {
  it("answers yes with the row count when stops fall inside", async () => {
    const fake = fakeClient({ count: 412, error: null });
    const result = await assessFeedVersionCoverage({
      client: fake.client,
      feedVersionId: VERSION_ID,
      bbox: SACRAMENTO,
    });

    expect(result).toEqual({ coverage: "yes", stopServiceRowsInStudyArea: 412, reason: null });
  });

  it("filters by the feed version and by both coordinate ranges", async () => {
    const fake = fakeClient({ count: 1, error: null });
    await assessFeedVersionCoverage({ client: fake.client, feedVersionId: VERSION_ID, bbox: SACRAMENTO });

    // The version filter IS the containment property: the version was resolved
    // through `filterToCurrentReadyVersion` against a workspace-scoped feed
    // upstream, so this read cannot reach another workspace's rows by
    // construction rather than by remembering an extra `.eq()`.
    expect(fake.filters).toEqual([
      { verb: "eq", column: GTFS_STOP_COVERAGE_COLUMNS.version, value: VERSION_ID },
      { verb: "gte", column: GTFS_STOP_COVERAGE_COLUMNS.latitude, value: SACRAMENTO.minLat },
      { verb: "lte", column: GTFS_STOP_COVERAGE_COLUMNS.latitude, value: SACRAMENTO.maxLat },
      { verb: "gte", column: GTFS_STOP_COVERAGE_COLUMNS.longitude, value: SACRAMENTO.minLon },
      { verb: "lte", column: GTFS_STOP_COVERAGE_COLUMNS.longitude, value: SACRAMENTO.maxLon },
    ]);
    expect(fake.table).toBe(GTFS_STOP_COVERAGE_TABLE);
    // `head: true` — this must never pull 18,000 stop rows across the wire to
    // answer a yes/no question.
    expect(fake.head).toBe(true);
  });

  it("writes its table and columns as LITERALS, so the AST guards can see them", () => {
    // Not decoration. `.from(someConstant)` records `table: null` in
    // `supabase-call-sites.ts`, which makes the read invisible to
    // `reference-count-projection-guard`, to the timetable guard and to the
    // claim-tier walker alike — and writing it that way failed the first of
    // those on the first run. The constants above exist for tests; the call
    // must spell it out.
    //
    // Read with the AST rather than a regex over the file text, deliberately.
    // The module header QUOTES the forbidden form (`.from(someConstant)`) in
    // order to explain why it is forbidden, and a text guard would fail on its
    // own documentation — which teaches people to delete the documentation.
    // This repository already carries that scar. The parser sees code only.
    const sites = collectSupabaseSelectSites({ files: ["src/lib/gtfs/coverage.ts"] });

    expect(sites).toHaveLength(1);
    expect(sites[0].table).toBe(GTFS_STOP_COVERAGE_TABLE);
    // `table: null` is what a computed `.from()` records, and it is exactly
    // what makes a read invisible to every AST guard in this repo.
    expect(sites[0].table).not.toBeNull();
    expect(sites[0].headOnly).toBe(true);
    expect(sites[0].isCount).toBe(true);

    const source = readFileSync(path.join(process.cwd(), "src/lib/gtfs/coverage.ts"), "utf8");
    expect(source).toMatch(/\.eq\("feed_version_id",/);
  });

  it("does not query at all for an envelope that would select nothing", async () => {
    const fake = fakeClient({ count: 5, error: null });
    const result = await assessFeedVersionCoverage({
      client: fake.client,
      feedVersionId: VERSION_ID,
      // Antimeridian: min > max. A gte/lte pair over this matches no row.
      bbox: { minLon: 170, minLat: 38.4, maxLon: -170, maxLat: 38.7 },
    });

    expect(result.coverage).toBe("not_determined");
    expect(result.reason).toMatch(/antimeridian/);
    expect(fake.table).toBeNull();
  });

  it("reports a thrown client as not_determined rather than propagating", async () => {
    const exploding = {
      from() {
        return {
          select() {
            throw new Error("client blew up");
          },
        };
      },
    } as unknown as CoverageQueryClient;

    const result = await assessFeedVersionCoverage({
      client: exploding,
      feedVersionId: VERSION_ID,
      bbox: SACRAMENTO,
    });

    // A coverage answer is a disclosure. One that can fail a launch is worse
    // than one that says "not determined".
    expect(result.coverage).toBe("not_determined");
    expect(result.reason).toMatch(/client blew up/);
  });
});

describe("turning a count into an answer", () => {
  it("a zero count is a real `no`", () => {
    expect(coverageFromStopRowCount(0, null)).toEqual({
      coverage: "no",
      stopServiceRowsInStudyArea: 0,
      reason: null,
    });
  });

  it("a NULL count is never a `no`", () => {
    // The whole point. `count: null` means the count could not be produced.
    const result = coverageFromStopRowCount(null, null);
    expect(result.coverage).toBe("not_determined");
    expect(result.stopServiceRowsInStudyArea).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it("an error is never a `no`, even when a count came back with it", () => {
    const result = coverageFromStopRowCount(0, { message: "statement timeout" });
    expect(result.coverage).toBe("not_determined");
    expect(result.reason).toMatch(/statement timeout/);
  });
});

describe("which envelopes may be asked about", () => {
  it("accepts a normal one and a degenerate point", () => {
    expect(bboxIsQueryable(SACRAMENTO)).toBe(true);
    expect(bboxIsQueryable({ minLon: -121.5, minLat: 38.5, maxLon: -121.5, maxLat: 38.5 })).toBe(true);
  });

  it("refuses inverted or non-finite envelopes", () => {
    expect(bboxIsQueryable({ minLon: 170, minLat: 38, maxLon: -170, maxLat: 39 })).toBe(false);
    expect(bboxIsQueryable({ minLon: -121, minLat: 39, maxLon: -120, maxLat: 38 })).toBe(false);
    expect(
      bboxIsQueryable({
        minLon: Number.POSITIVE_INFINITY,
        minLat: 38,
        maxLon: -120,
        maxLat: 39,
      })
    ).toBe(false);
    expect(bboxIsQueryable({ minLon: Number.NaN, minLat: 38, maxLon: -120, maxLat: 39 })).toBe(false);
  });
});
