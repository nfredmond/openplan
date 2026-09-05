import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  CRASH_FILTER_FACETS,
  CRASH_SEVERITY_BANDS,
  crashFilterSearchParams,
  facetValues,
  type CrashFilterSelection,
} from "@/lib/safety/crash-filters";
import { CRASH_DIMENSION_COLUMNS, CRASH_KSI_SEVERITIES } from "@/lib/safety/vocabulary";
import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import type { SafetyIngestSummary } from "@/lib/safety/client-types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SAFETY HEADLINE COUNTS THE STUDY AREA, NOT THE DOTS ON THE MAP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT WENT WRONG. `/safety` shows the severe-crash total used for KSI screening,
 * measure SS4A and HSIP score a project on. It was computed by adding up the
 * severity of the crash FEATURES the query route returned, and that query is
 * capped: PostgREST enforces `max_rows`, so a real run against the local
 * 32,650-crash extract drew 1,000 crashes while 11,870 matched the study area
 * under the page's default filters. The headline understated KSI by roughly an
 * order of magnitude — 290 read as a handful — on the one number a planner
 * copies straight into a funding application.
 *
 * WHAT MUST STAY TRUE, and each has a test below:
 *
 *   1. THE FIGURE IS THE STUDY-AREA TOTAL. It comes from `severityTotals`,
 *      counted in Postgres. A response without them yields NO figure — never a
 *      quiet fall back to the drawn rows, and never a zero.
 *   2. THE TOTAL AND THE MAP SHARE ONE FILTER DEFINITION. Every band count is
 *      built by handing the row query's own filter closure a head-count query
 *      and appending exactly one severity predicate. If the two could be built
 *      differently, the headline and the map would disagree on screen and the
 *      product would be worse than it was before.
 *   3. THE MAP'S OWN COUNT STAYS BESIDE IT. Two numbers, both visible, each
 *      saying what it is. There is no toggle: a figure whose meaning depends on
 *      invisible state is the same defect in a new coat.
 *   4. AN UNREPORTED CASUALTY IS NOT ZERO. The count of collisions the source
 *      never classified is rendered INSIDE the headline block, against the same
 *      denominator. A number separated from its qualification is a claim nobody
 *      can defend.
 *
 * NOTHING HERE IS A HAND-WRITTEN LIST OF FILENAMES OR BANDS. The bands come
 * from `CRASH_SEVERITY_BANDS`, the KSI composition from `CRASH_KSI_SEVERITIES`,
 * the filter permutations from `CRASH_FILTER_FACETS`. A sixth severity band
 * added to the vocabulary is counted by the route and asserted here with no
 * edit to this file.
 */

// ---------------------------------------------------------------------------
// PART 1 — THE ROUTE. One filter definition for the rows and for every total.
// ---------------------------------------------------------------------------

type RecordedCall =
  | { op: "eq" | "gte" | "lte"; column: string; value: unknown }
  | { op: "in"; column: string; values: readonly unknown[] }
  | { op: "or"; filter: string };

type RecordedQuery = {
  table: string;
  projection: string;
  head: boolean;
  count: string | undefined;
  calls: RecordedCall[];
};

const recorded: RecordedQuery[] = [];

/**
 * A band whose count the database refuses to answer, or null.
 *
 * The failure has to be injectable because the response to it is a REFUSAL, not
 * a smaller number: a band that could not be counted must take the whole map
 * with it. A partial map renders an uncounted band as a band with no crashes in
 * it, and a zero in the fatal row of a safety page reads as good news.
 */
let failingBand: string | null = null;

/** True to make the MATCHED-count query fail, leaving only the capped fallback. */
let failMatchedCount = false;

/**
 * A Supabase stand-in that records what each query was built from.
 *
 * It is thenable, so `await`ing a builder resolves like a real PostgREST call.
 * It records the CALLS rather than a description of them, which is what lets the
 * assertions compare two queries structurally instead of comparing one query
 * against a sentence about it.
 */
function makeRecordingClient() {
  const build = (table: string, projection: string, options?: { count?: string; head?: boolean }) => {
    const entry: RecordedQuery = {
      table,
      projection,
      head: Boolean(options?.head),
      count: options?.count,
      calls: [],
    };
    recorded.push(entry);

    // Resolved LAZILY, after the filters have been recorded, so a test can fail
    // exactly the band it names.
    const result = () => {
      if (entry.table === "safety_crash_ingests") {
        return {
          data: [{ id: "11111111-1111-4111-8111-111111111111", project_id: null }],
          count: null,
          error: null,
        };
      }
      if (!entry.head) return { data: [], count: null, error: null };
      const selectsFailingBand =
        failingBand !== null &&
        entry.calls.some(
          (call) =>
            call.op === "in" &&
            call.column === SEVERITY_COLUMN &&
            call.values.includes(failingBand)
        );
      if (selectsFailingBand) return { data: null, count: null, error: { message: "boom" } };
      // The MATCHED count is the first head query the route builds against the
      // crash table. Identified by position rather than by its predicates: a
      // planner filtering to one severity band gives the matched count the same
      // `in` predicate a band count has, and a shape-based test would then fail
      // the wrong query.
      const isMatchedCount =
        recorded.filter((other) => other.table === entry.table && other.head)[0] === entry;
      if (failMatchedCount && isMatchedCount) {
        return { data: null, count: null, error: { message: "count boom" } };
      }
      return { data: null, count: 7, error: null };
    };

    const builder: Record<string, unknown> = {
      eq: (column: string, value: unknown) => {
        entry.calls.push({ op: "eq", column, value });
        return builder;
      },
      gte: (column: string, value: unknown) => {
        entry.calls.push({ op: "gte", column, value });
        return builder;
      },
      lte: (column: string, value: unknown) => {
        entry.calls.push({ op: "lte", column, value });
        return builder;
      },
      in: (column: string, values: readonly unknown[]) => {
        entry.calls.push({ op: "in", column, values });
        return builder;
      },
      or: (filter: string) => {
        entry.calls.push({ op: "or", filter });
        return builder;
      },
      is: () => builder,
      // Not filters, and deliberately NOT recorded: ordering and the display cap
      // belong to the map, and requiring the count queries to carry them would
      // be asserting the opposite of what this file is about.
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: { role: "owner" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return builder;
  };

  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => ({
      select: (projection: string, options?: { count?: string; head?: boolean }) =>
        build(table, projection, options),
    }),
  };
}

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeRecordingClient(),
  createServiceRoleClient: () => makeRecordingClient(),
}));

const { GET } = await import("@/app/api/safety/crashes/route");

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const BBOX = "minLon=-121.3&minLat=39.1&maxLon=-120&maxLat=39.6";

const SEVERITY_COLUMN = CRASH_DIMENSION_COLUMNS.severity;

function crashRequest(selection: CrashFilterSelection): NextRequest {
  const params = new URLSearchParams(crashFilterSearchParams(selection));
  const suffix = params.toString() ? `&${params.toString()}` : "";
  return new NextRequest(
    `http://localhost/api/safety/crashes?workspaceId=${WORKSPACE_ID}&${BBOX}${suffix}`
  );
}

function crashQueries(): RecordedQuery[] {
  return recorded.filter((entry) => entry.table === "safety_crashes");
}

function serialize(calls: RecordedCall[]): string {
  return JSON.stringify(calls);
}

/**
 * Selections to drive the route with — derived, so a new facet is exercised
 * without editing this file. One value, two values, and every value (the case
 * that emits no predicate at all), plus year bounds.
 */
function selections(): CrashFilterSelection[] {
  const built: CrashFilterSelection[] = [{}, { yearFrom: 2021, yearTo: 2025 }];
  for (const facet of CRASH_FILTER_FACETS) {
    const values = facetValues(facet);
    built.push({ [facet.id]: [values[0]] });
    built.push({ [facet.id]: [values[0], values[values.length - 1]] });
    built.push({ [facet.id]: [...values], yearFrom: 2023 });
  }
  // Everything at once: the case where a filter dropped from the count queries
  // would still leave four others agreeing, and a laxer assertion would pass.
  built.push({
    ...Object.fromEntries(CRASH_FILTER_FACETS.map((facet) => [facet.id, [facetValues(facet)[0]]])),
    yearFrom: 2022,
    yearTo: 2024,
  });
  return built;
}

describe("the study-area total and the map cannot be built from different filters", () => {
  beforeEach(() => {
    recorded.length = 0;
    failingBand = null;
    failMatchedCount = false;
  });

  it("counts one head query per declared severity band, plus the rows and the matched count", async () => {
    const res = await GET(crashRequest({}));
    expect(res.status).toBe(200);

    const queries = crashQueries();
    // A guard on the guard: if the fake were never reached, everything below
    // would pass over an empty list.
    expect(queries.length).toBe(CRASH_SEVERITY_BANDS.length + 2);

    const rowQueries = queries.filter((entry) => !entry.head);
    expect(rowQueries).toHaveLength(1);
    expect(queries.filter((entry) => entry.head)).toHaveLength(CRASH_SEVERITY_BANDS.length + 1);
  });

  it("gives every band count the row query's exact filters plus one severity predicate", async () => {
    for (const selection of selections()) {
      recorded.length = 0;
      const res = await GET(crashRequest(selection));
      expect(res.status, `${JSON.stringify(selection)} was rejected`).toBe(200);

      const queries = crashQueries();
      const rows = queries.find((entry) => !entry.head);
      if (!rows) throw new Error("no row query was issued");

      const heads = queries.filter((entry) => entry.head);
      // The matched count is the row query's filters exactly — no more, no less.
      const matched = heads.filter((entry) => serialize(entry.calls) === serialize(rows.calls));
      expect(matched, `matched count diverged for ${JSON.stringify(selection)}`).toHaveLength(1);

      const bandQueries = heads.filter((entry) => entry !== matched[0]);
      expect(bandQueries).toHaveLength(CRASH_SEVERITY_BANDS.length);

      const bandsCounted: string[] = [];
      for (const band of bandQueries) {
        const head = band.calls.slice(0, rows.calls.length);
        const tail = band.calls.slice(rows.calls.length);
        // THE WHOLE POINT: identical prefix. A filter the rows carry and a band
        // count does not — or the reverse — means the headline and the map are
        // describing different populations.
        expect(
          serialize(head),
          `a band count did not carry the row query's filters for ${JSON.stringify(selection)}`
        ).toBe(serialize(rows.calls));
        expect(tail).toHaveLength(1);
        const [predicate] = tail;
        if (predicate.op !== "in") throw new Error("a band was not selected with an `in` predicate");
        expect(predicate.column).toBe(SEVERITY_COLUMN);
        expect(predicate.values).toHaveLength(1);
        bandsCounted.push(String(predicate.values[0]));
      }

      expect([...bandsCounted].sort()).toEqual([...CRASH_SEVERITY_BANDS].sort());
    }
  });

  it("actually discriminates — the filters reach the queries at all", async () => {
    // Without this, the differential above would pass just as happily against a
    // route that applied no filters anywhere.
    recorded.length = 0;
    await GET(crashRequest({ [CRASH_FILTER_FACETS[0].id]: [facetValues(CRASH_FILTER_FACETS[0])[0]] }));
    const rows = crashQueries().find((entry) => !entry.head);
    if (!rows) throw new Error("no row query was issued");
    // Workspace scope plus four bbox bounds is the floor; the facet adds more.
    expect(rows.calls.length).toBeGreaterThan(5);
  });

  it("returns a total for every band, and never a partial map", async () => {
    recorded.length = 0;
    const res = await GET(crashRequest({}));
    const body = await res.json();
    expect(Object.keys(body.severityTotals).sort()).toEqual([...CRASH_SEVERITY_BANDS].sort());
    for (const band of CRASH_SEVERITY_BANDS) {
      expect(typeof body.severityTotals[band]).toBe("number");
    }
  });

  it("withholds ALL the totals when any one band could not be counted", async () => {
    // A partial map is worse than none: an uncounted band renders as a band with
    // no crashes in it, and a zero in the fatal row of a safety page reads as
    // good news. Every band is failed in turn — a check written against one band
    // would pass a route that special-cased it.
    for (const band of CRASH_SEVERITY_BANDS) {
      recorded.length = 0;
      failingBand = band;
      const res = await GET(crashRequest({}));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.severityTotals, `${band} failed to count and the rest were still published`).toBeNull();
      // The map itself still loads: a failed count is not a failed page.
      expect(body.type).toBe("FeatureCollection");
    }
  });

  it("marks the matched count as inexact when it fell back to the fetched rows", async () => {
    // The fallback is the number of rows fetched, which is CAPPED. Reported as
    // an exact total it would claim the area holds precisely as many crashes as
    // the map happened to draw — the same understatement, one field over.
    recorded.length = 0;
    failMatchedCount = true;
    const res = await GET(crashRequest({}));
    const body = await res.json();
    expect(body.matchedCountIsExact).toBe(false);

    recorded.length = 0;
    failMatchedCount = false;
    const good = await (await GET(crashRequest({}))).json();
    expect(good.matchedCountIsExact).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PART 2 — THE PAGE. The headline reads the total, never the rows it drew.
// ---------------------------------------------------------------------------

vi.mock("@/components/safety/safety-crash-map", () => ({
  safetyWorkspaceGisAnchorLayerId: () => undefined,
  SafetyCrashMap: () => <div data-testid="safety-crash-map" />,
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({ onCorridorChange }: { onCorridorChange: (t: string) => void }) => (
    <button
      onClick={() =>
        onCorridorChange(
          JSON.stringify({
            type: "Polygon",
            coordinates: [
              [
                [-121.3, 39.1],
                [-120.3, 39.1],
                [-120.3, 39.6],
                [-121.3, 39.6],
                [-121.3, 39.1],
              ],
            ],
          })
        )
      }
    >
      pick-area
    </button>
  ),
}));

function readyIngest(over: Partial<SafetyIngestSummary> = {}): SafetyIngestSummary {
  return {
    id: "ingest-1",
    sourceLabel: "Example Crash Reporting System",
    attribution: "Example agency (public domain).",
    coverageState: "ccrs_ca_statewide",
    severityCompleteness: "kabco_full",
    status: "ready",
    crashCount: 32650,
    geocodedCount: 32650,
    truncated: false,
    yearsRequested: [2021, 2022, 2023, 2024, 2025],
    fetchError: null,
    createdAt: "2026-08-14T00:00:00.000Z",
    ...over,
  };
}

/**
 * A crash point of one severity band, in the shape the route returns.
 *
 * The drawn features are deliberately built to DISAGREE with the totals below:
 * that disagreement is the whole measurement. A fixture whose dots happened to
 * add up to the same number would let a headline computed from the dots pass.
 */
function feature(severity: string, index: number) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-121 + index * 0.001, 39.2] },
    properties: {
      kind: "safety_crash",
      id: `crash-${severity}-${index}`,
      externalId: `case-${index}`,
      sourceId: "example",
      collisionDate: "2025-01-02",
      collisionYear: 2025,
      severity,
      killedCount: null,
      injuredCount: null,
      pedestrianInvolved: false,
      bicyclistInvolved: false,
      motorcyclistInvolved: false,
      collisionType: null,
      lighting: null,
      weather: null,
    },
  };
}

/**
 * THE REAL SHAPE OF THE DEFECT, in numbers taken from the local database.
 *
 * 11,870 crashes match the study area under the page's default filters; the map
 * draws 1,000 of them. The true KSI is 277 fatal + 13 serious = 290, and 738
 * collisions carry no casualty count at all. The drawn slice below contains a
 * single fatal crash — which is what the page used to report.
 */
const DRAWN = [feature("fatal", 0), feature("injury", 1), feature("injury", 2)];
const TOTALS: Record<string, number> = {
  fatal: 277,
  severe_injury: 13,
  injury: 10842,
  pdo: 0,
  unknown: 738,
};
const TRUE_KSI = CRASH_KSI_SEVERITIES.reduce((sum, band) => sum + (TOTALS[band] ?? 0), 0);

function crashResponse(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      type: "FeatureCollection",
      features: DRAWN,
      returnedCount: DRAWN.length,
      matchedCount: 11870,
      matchedCountIsExact: true,
      undrawableCount: 0,
      severityTotals: TOTALS,
      truncated: true,
      limit: 2000,
      ...over,
    }),
  } as Response;
}

function renderSafety(response = crashResponse(), ingest = readyIngest()) {
  vi.stubGlobal("fetch", vi.fn(async () => response) as unknown as typeof fetch);
  // Start with the saved acquisition's area. Choosing a new area clears it.
  render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest} studyArea={{
    corridorText: JSON.stringify({
      type: "Polygon",
      coordinates: [[[-121.3, 39.1], [-120.3, 39.1], [-120.3, 39.6], [-121.3, 39.6], [-121.3, 39.1]]],
    }),
    place: null,
    label: "Saved study area",
    origin: "project",
    originLabel: "Saved project",
  }} />);
}

describe("the KSI headline is the study-area total", () => {
  it("reports the counted total, not the crashes the map drew", async () => {
    renderSafety();

    const headline = await screen.findByTestId("safety-ksi-headline");
    expect(headline).toHaveTextContent(
      new RegExp(`${TRUE_KSI.toLocaleString()} fatal or serious-injury crashes`)
    );
    // The drawn slice carries exactly one fatal crash and no serious injuries.
    expect(headline).not.toHaveTextContent(/\b1 fatal or serious-injury crash/);
    expect(headline).toHaveTextContent(/crash records.*not people killed or injured/i);
    expect(headline.textContent).toMatch(/whole area you picked/i);
  });

  it("keeps the map's own count beside it, so both numbers are on screen", async () => {
    renderSafety();

    const headline = await screen.findByTestId("safety-ksi-headline");
    expect(headline.textContent).toContain(`drawing ${DRAWN.length.toLocaleString()}`);
    expect(headline.textContent).toContain((11870).toLocaleString());
  });

  it("carries the unclassified count inside the same block as the figure", async () => {
    // A caveat in a paragraph elsewhere on the page is a caveat that will be
    // separated from the number when the number is quoted.
    renderSafety();

    const headline = await screen.findByTestId("safety-ksi-headline");
    expect(headline.textContent).toContain((TOTALS.unknown).toLocaleString());
    expect(headline.textContent).toMatch(/no casualty count/i);
    expect(headline.textContent).toMatch(/floor/i);
  });

  it("shows no figure at all when the bands could not be counted", async () => {
    // Never a fall back to the drawn rows, and never a zero. A missing KSI on
    // this page has to be a sentence, because a missing figure reads as none.
    renderSafety(crashResponse({ severityTotals: null }));

    await waitFor(() => {
      expect(screen.getByText(/could not count how many were fatal or serious/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("safety-ksi-headline")).not.toBeInTheDocument();
    expect(screen.queryByText(/killed or seriously injured/i)).not.toBeInTheDocument();
  });

  it("shows no figure when the source cannot separate a serious injury", async () => {
    // `fatal + 0` would read as "no serious injuries occurred".
    renderSafety(crashResponse(), readyIngest({ severityCompleteness: "fatal_injury_only" }));

    await waitFor(() => {
      expect(screen.getByText(/cannot be derived from it/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("safety-ksi-headline")).not.toBeInTheDocument();
  });

  it("states the unclassified count against the study area even with no KSI figure", async () => {
    renderSafety(crashResponse(), readyIngest({ severityCompleteness: "fatal_injury_only" }));

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`${(TOTALS.unknown).toLocaleString()} of the collisions in the area you picked`))
      ).toBeInTheDocument();
    });
  });

  it("says 'at least' when the matched count is a capped fallback", async () => {
    // The route falls back to the number of rows it fetched when the count query
    // fails. Stating that flat would claim the study area holds exactly as many
    // crashes as the map happened to draw.
    renderSafety(crashResponse({ matchedCountIsExact: false, matchedCount: DRAWN.length }));

    const headline = await screen.findByTestId("safety-ksi-headline");
    expect(headline.textContent).toMatch(/at least/i);
  });
});
