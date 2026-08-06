import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import ts from "typescript";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAP_FEATURE_LAYER_LIMIT,
  PROJECT_AREA_LAYER_LIMIT,
  representativeWorkweekDay,
  TRANSIT_MAP_SERVICE_DAY,
  TRANSIT_STOP_LAYER_LIMIT,
  POSTGREST_MAX_ROWS_PER_REQUEST,
} from "@/lib/cartographic/layer-disclosure";
import {
  DEFAULT_SERVICE_DAY_GROUPING_PROFILE,
  MONDAY_TO_FRIDAY_WORKWEEK,
  SERVICE_DAY_GROUPING_PROFILES,
  SUNDAY_TO_THURSDAY_WORKWEEK,
} from "@/lib/gtfs/service-day-groups";
import { GTFS_NOT_A_TIMETABLE_CAVEAT } from "@/lib/gtfs/caveats";
import {
  BASIC_SERVICE_HEADWAY_MINUTES,
  FREQUENT_SERVICE_HEADWAY_MINUTES,
} from "@/lib/gtfs/service-levels";
import {
  TRANSIT_SERVICE_TIER_COLOR,
  TRANSIT_SERVICE_TIER_LEGEND_ORDER,
} from "@/lib/cartographic/transit-service-tier-palette";

/**
 * THE TRANSIT STOP MAP LAYER.
 *
 * Three properties are load-bearing here and none of them is visible from a
 * screenshot, which is why they are asserted rather than reviewed:
 *
 *   1. THE LAYER READS `gtfs_stops_map`, NOT `gtfs_stop_service_levels`.
 *      supabase-js cannot read a PostGIS geometry — PostgREST hands back hex
 *      EWKB and nothing in this repository parses it — so a route that selects
 *      `geom` gets a string, draws nothing, and reports every row as
 *      undrawable. A planner reads "0 drawn, 2,821 could not be drawn" as a
 *      finding about THEIR DATA. The suite would be green throughout: the
 *      clients are untyped, so the wrong column name is not a compile error,
 *      and a mocked client returns the fixture whatever was asked for. Only an
 *      assertion on the projection STRING catches it.
 *
 *   2. THE ORDER IS PART OF THE SENTENCE. The layer is capped, and the only
 *      honest thing a capped layer can say is what it left out. "The 5,000
 *      most-served of 12,400 — the ones not drawn are the least-served" is a
 *      FACT under `trips_per_day DESC` and an invention under any other order.
 *      Deleting one `.order()` call turns a disclosure into a falsehood and
 *      changes nothing else about the response, so the order and the sentence
 *      are asserted together.
 *
 *   3. THE WORKSPACE FILTER IS EXPLICIT, NOT INHERITED FROM RLS.
 *      `gtfs_feeds.workspace_id IS NULL` means a PUBLIC preloaded feed that
 *      every tenant on the deployment can read, and the read policies allow it
 *      on purpose. A query that merely followed RLS would draw a stranger's
 *      transit agency inside a workspace's map with nothing saying so.
 *
 * A fourth property is asserted here for a reason worth stating: THE CLAIM
 * BOUNDARY. `gtfs-claim-boundaries.test.ts` holds the transit lane's language
 * rule, but its roots are `src/lib/gtfs`, `src/app/api/gtfs`, `src/lib/transit`
 * and the Data Hub — it does not reach `src/app/api/map-features/transit` or
 * `src/components/cartographic`. So the map lane's copy is scanned below,
 * against the same prohibitions. THAT DUPLICATION IS A FINDING, NOT A DESIGN:
 * the right fix is one root added to that guard's `TRANSIT_ROOTS`, which this
 * change did not own. Until then the rule is enforced in two places, and the
 * test at the bottom asserts the gap is still real so this block cannot quietly
 * become dead weight after the roots are widened.
 */

const REPO_ROOT = process.cwd();

const ROUTE_FILE = "src/app/api/map-features/transit/route.ts";
const BACKDROP_FILE = "src/components/cartographic/cartographic-map-backdrop.tsx";
const PANEL_FILE = "src/components/cartographic/cartographic-layers-panel.tsx";

function readSource(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/* -------------------------------------------------------------------------- */
/* The service day, and the cap                                                 */
/* -------------------------------------------------------------------------- */

describe("the day this layer draws is derived, never typed", () => {
  /**
   * VARYING THE BINDING IS THE WHOLE TEST. One profile cannot tell "reads the
   * profile" from "returns 'wednesday'": both pass. Two profiles that must
   * yield DIFFERENT days is what makes the derivation observable.
   */
  it("takes the middle of a profile's workweek group, and moves with the profile", () => {
    expect(representativeWorkweekDay(MONDAY_TO_FRIDAY_WORKWEEK)).toBe("wednesday");
    expect(representativeWorkweekDay(SUNDAY_TO_THURSDAY_WORKWEEK)).toBe("tuesday");
  });

  /**
   * `representativeWorkweekDay` assumes the FIRST group of a profile is its
   * workweek group. That is true of every profile in the registry today and is
   * exactly the kind of assumption a new profile breaks silently — a
   * weekend-first profile would make this layer report a region's Saturday
   * service as its typical weekday, with nothing on screen to contradict it.
   */
  it("holds for every registered profile, so a new one cannot break it quietly", () => {
    for (const profile of SERVICE_DAY_GROUPING_PROFILES) {
      const day = representativeWorkweekDay(profile);
      expect(profile.groups[0].days, `${profile.key} put a non-workweek group first`).toContain(day);
      expect(day).not.toBe("saturday");
      expect(day).not.toBe("sunday");
    }
  });

  it("refuses a profile with no workweek group rather than picking a day at random", () => {
    expect(() =>
      representativeWorkweekDay({
        key: "empty",
        label: "Empty",
        appliesTo: "nowhere",
        groups: [{ key: "none", label: "None", days: [] }],
      }),
    ).toThrow(/no workweek group/);
  });

  it("is what the layer actually uses", () => {
    expect(TRANSIT_MAP_SERVICE_DAY).toBe(
      representativeWorkweekDay(DEFAULT_SERVICE_DAY_GROUPING_PROFILE),
    );
  });
});

describe("the transit cap is derived from the shared one", () => {
  /**
   * The multiplier goes the OTHER WAY from `PROJECT_AREA_LAYER_LIMIT`, and both
   * directions come from the same measurement: a stop is a point plus eight
   * scalars, a project area is a TIGERweb boundary. The row count is what
   * forced the number up — Sacramento Regional Transit's real feed derives
   * 2,821 stops on one service day, and a cap under that would truncate a
   * MID-SIZE agency on every load.
   */
  it("multiplies rather than divides, and covers a measured mid-size agency whole", () => {
    expect(TRANSIT_STOP_LAYER_LIMIT).toBe(MAP_FEATURE_LAYER_LIMIT * 10);
    expect(TRANSIT_STOP_LAYER_LIMIT).toBeGreaterThan(PROJECT_AREA_LAYER_LIMIT);
    // Sacramento Regional Transit: 2,821 stops, measured 2026-08-05.
    expect(TRANSIT_STOP_LAYER_LIMIT).toBeGreaterThan(2821);
  });
});

/* -------------------------------------------------------------------------- */
/* The route                                                                    */
/* -------------------------------------------------------------------------- */

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const FEED_ID = "f0000001-0000-4000-8000-000000000001";
const VERSION_ID = "b0000001-0000-4000-8000-000000000001";
const STOP_ROW_A = "50000001-0000-4000-8000-000000000001";
const STOP_ROW_B = "50000001-0000-4000-8000-000000000002";

/** One recorded PostgREST chain: the table, the projection, and every filter. */
type RecordedQuery = {
  table: string;
  projection: string;
  options: Record<string, unknown> | undefined;
  calls: Array<{ verb: string; args: unknown[] }>;
};

type QueryResult = { data: unknown; error: unknown; count?: number | null };

let recorded: RecordedQuery[] = [];
let respond: (query: RecordedQuery) => QueryResult;

/**
 * A recording PostgREST fake.
 *
 * Deliberately NOT a stack of nested `vi.fn()` chains. The properties under
 * test are "which table", "which columns" and "which filters, in which order" —
 * a fake that records the whole chain lets each assertion name exactly one of
 * those, and a chain shape this route does not use fails loudly instead of
 * returning `undefined` three calls later.
 */
function makeSupabase() {
  const from = (table: string) => ({
    select: (projection: string, options?: Record<string, unknown>) => {
      const query: RecordedQuery = { table, projection, options, calls: [] };
      recorded.push(query);
      const builder: Record<string, unknown> = {};
      for (const verb of ["eq", "in", "is", "not", "order", "limit", "range", "gte", "lte", "maybeSingle"]) {
        builder[verb] = (...args: unknown[]) => {
          query.calls.push({ verb, args });
          return builder;
        };
      }
      builder.then = (
        resolve: (value: QueryResult) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(respond(query)).then(resolve, reject);
      return builder;
    },
  });
  return { auth: { getUser: authGetUserMock }, from };
}

const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>(
    "@/lib/workspaces/current",
  );
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) =>
      loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getTransit } from "@/app/api/map-features/transit/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/transit", { method: "GET" });
}

function asMember() {
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: WORKSPACE_ID, role: "editor" },
    workspace: { id: WORKSPACE_ID, name: "Any agency" },
  });
}

const FEED_ROW = {
  id: FEED_ID,
  agency_name: "Sacramento Regional Transit",
  is_active: true,
  status: "loaded",
};

const VERSION_ROW = {
  id: VERSION_ID,
  feed_id: FEED_ID,
  service_start_date: "2024-08-01",
  service_end_date: "2025-04-05",
  frequency_trip_count: 0,
  parse_warnings: [],
  route_service_level_rows: 749,
};

function stopRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STOP_ROW_A,
    feed_version_id: VERSION_ID,
    stop_id: "1234",
    stop_name: "Main St & 2nd Ave",
    geometry_geojson: { type: "Point", coordinates: [-121.4944, 38.5816] },
    service_day: TRANSIT_MAP_SERVICE_DAY,
    trips_per_day: 96,
    peak_headway_seconds: 720,
    routes_serving: 3,
    route_ids: ["1", "51", "81"],
    ...overrides,
  };
}

/** The default world: one own feed, one ready version, one drawable stop. */
function defaultResponder(options: {
  stops?: unknown[];
  stopCount?: number | null;
  publicFeedCount?: number;
  feeds?: unknown[];
  versions?: unknown[];
} = {}) {
  return (query: RecordedQuery): QueryResult => {
    if (query.table === "gtfs_feeds") {
      const isCountOnly = query.options?.head === true;
      if (isCountOnly) {
        return { data: null, error: null, count: options.publicFeedCount ?? 0 };
      }
      return { data: options.feeds ?? [FEED_ROW], error: null, count: null };
    }
    if (query.table === "gtfs_feed_versions") {
      return { data: options.versions ?? [VERSION_ROW], error: null, count: null };
    }
    if (query.table === "gtfs_stops_map") {
      const stops = options.stops ?? [stopRow()];
      // HONOUR THE RANGE, because the route now reads in pages and a fake that
      // returned the whole fixture on page one would leave every line of that
      // paging loop unexecuted while the suite went green. PostgREST caps a
      // response at `max_rows` however wide the requested range is, so the slice
      // is bounded by BOTH — which is the behaviour that made a single-request
      // read silently return 1,000 of 2,821 stops against the real database.
      const range = query.calls.find((call) => call.verb === "range");
      if (range) {
        const [from, to] = range.args as [number, number];
        const width = Math.min(to - from + 1, POSTGREST_MAX_ROWS_PER_REQUEST);
        return {
          data: stops.slice(from, from + width),
          error: null,
          count: options.stopCount === undefined ? stops.length : options.stopCount,
        };
      }
      return {
        data: stops,
        error: null,
        count: options.stopCount === undefined ? stops.length : options.stopCount,
      };
    }
    throw new Error(`Unexpected table: ${query.table}`);
  };
}

function queryFor(table: string): RecordedQuery | undefined {
  return recorded.find((query) => query.table === table && query.options?.head !== true);
}

function filtersOn(query: RecordedQuery | undefined, verb: string): Array<unknown[]> {
  return (query?.calls ?? []).filter((call) => call.verb === verb).map((call) => call.args);
}

describe("GET /api/map-features/transit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorded = [];
    respond = defaultResponder();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockImplementation(async () => makeSupabase());
  });

  it("returns 401 when the request is anonymous", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getTransit(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("returns an empty layer, with the transit cap, when the session has no workspace", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getTransit(bareRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.features).toEqual([]);
    expect(payload.limit).toBe(TRANSIT_STOP_LAYER_LIMIT);
    expect(recorded).toEqual([]);
  });

  /**
   * THE TENANT BOUNDARY. `gtfs_feeds.workspace_id IS NULL` is a public preloaded
   * feed shared by the whole deployment, and RLS lets a member read it. Nothing
   * about a stop drawn from one would say it belonged to another organisation,
   * so the filter is named rather than inherited.
   */
  it("asks for this workspace's own feeds by name, never merely what RLS allows", async () => {
    asMember();

    await getTransit(bareRequest());

    const feedQuery = queryFor("gtfs_feeds");
    expect(filtersOn(feedQuery, "eq")).toContainEqual(["workspace_id", WORKSPACE_ID]);
    // An `.or()` matching the workspace OR null is the shape that lets a
    // stranger's agency into a tenant's map. It must not appear at all.
    expect((feedQuery?.calls ?? []).some((call) => call.verb === "or")).toBe(false);
    expect(filtersOn(queryFor("gtfs_stops_map"), "eq")).toContainEqual([
      "workspace_id",
      WORKSPACE_ID,
    ]);
  });

  /**
   * BOTH HALVES OF THE READER'S PREDICATE. `is_current` alone reads a version
   * that failed after being promoted as though it were service data; `status =
   * 'ready'` alone gives a workspace with three successful ingests three times
   * its real stops. `filterToCurrentReadyVersion` applies both, and this is the
   * assertion that it was actually called rather than imported.
   */
  it("reads the feed version in use through both halves of the shared predicate", async () => {
    asMember();

    await getTransit(bareRequest());

    const versionFilters = filtersOn(queryFor("gtfs_feed_versions"), "eq");
    expect(versionFilters).toContainEqual(["is_current", true]);
    expect(versionFilters).toContainEqual(["status", "ready"]);
    expect(versionFilters).toContainEqual(["workspace_id", WORKSPACE_ID]);
  });

  /**
   * THE VIEW, AND THE PROJECTION. Reading the base table instead would return
   * hex EWKB for every geometry and draw nothing, with the suite green.
   */
  it("reads gtfs_stops_map and asks for the geometry the browser can actually use", async () => {
    asMember();

    await getTransit(bareRequest());

    expect(recorded.map((query) => query.table)).toContain("gtfs_stops_map");
    expect(recorded.map((query) => query.table)).not.toContain("gtfs_stop_service_levels");

    const projection = queryFor("gtfs_stops_map")?.projection ?? "";
    expect(projection).toContain("geometry_geojson");
    expect(projection).not.toMatch(/\bgeom\b(?!etry)/);
    expect(projection).toContain("trips_per_day");
    expect(projection).toContain("peak_headway_seconds");

    // A departure time cannot be printed by a surface that never received one.
    expect(projection).not.toContain("first_departure_seconds");
    expect(projection).not.toContain("last_departure_seconds");
    expect(projection).not.toBe("*");
  });

  it("draws one representative weekday, capped, ordered by how well served a stop is", async () => {
    asMember();

    await getTransit(bareRequest());

    const stopQuery = queryFor("gtfs_stops_map");
    expect(filtersOn(stopQuery, "eq")).toContainEqual(["service_day", TRANSIT_MAP_SERVICE_DAY]);

    // THE CAP IS EXPRESSED AS A RANGE, NOT A `.limit()`, and that is the whole
    // point of the paging change: PostgREST returns at most
    // `POSTGREST_MAX_ROWS_PER_REQUEST` rows however large a limit it is handed,
    // so the old single `.limit(5000)` silently returned 1,000 of Sacramento's
    // 2,821 stops while the disclosure went on reporting a limit of 5,000.
    // The first page may never ask for more than the platform will return, and
    // it may never reach past the layer's own cap.
    const firstRange = filtersOn(stopQuery, "range")[0] as [number, number];
    expect(firstRange[0]).toBe(0);
    expect(firstRange[1] - firstRange[0] + 1).toBeLessThanOrEqual(POSTGREST_MAX_ROWS_PER_REQUEST);
    expect(firstRange[1]).toBeLessThan(TRANSIT_STOP_LAYER_LIMIT);

    const orders = filtersOn(stopQuery, "order");
    // Trips DESC first: the primary sort is what makes the truncation sentence
    // a fact. The id tiebreak keeps a truncated payload stable between loads.
    expect(orders[0]).toEqual(["trips_per_day", { ascending: false }]);
    expect(orders[1]).toEqual(["id", { ascending: true }]);
  });

  it("reads past the platform's row ceiling in pages, so the cap it names is the cap it applies", async () => {
    asMember();

    // More stops than one PostgREST response can carry. Before the paging
    // change this returned exactly POSTGREST_MAX_ROWS_PER_REQUEST rows while
    // the disclosure reported a limit of TRANSIT_STOP_LAYER_LIMIT — a false
    // statement on the one surface whose job is saying what was left out.
    const oversized = Array.from({ length: POSTGREST_MAX_ROWS_PER_REQUEST + 250 }, (_, index) =>
      stopRow({ id: `stop-${String(index).padStart(5, "0")}`, trips_per_day: 900 - index })
    );
    respond = defaultResponder({ stops: oversized, stopCount: oversized.length });

    const response = await getTransit(bareRequest());
    const payload = await response.json();

    // Every row arrives, across more than one round trip.
    expect(payload.features).toHaveLength(oversized.length);
    expect(payload.returnedCount).toBe(oversized.length);
    expect(payload.truncated).toBe(false);

    const pages = recorded.filter((query) => query.table === "gtfs_stops_map");
    expect(pages.length).toBeGreaterThan(1);

    // The count rides the FIRST page only — asking again would be a round trip
    // whose answer is already known, and two counts could disagree.
    expect(pages[0].options?.count).toBe("exact");
    for (const page of pages.slice(1)) expect(page.options?.count).toBeUndefined();

    // EVERY page carries the same ordering. A page ordered differently would
    // interleave rows and destroy the property the truncation sentence rests on.
    for (const page of pages) {
      const orders = filtersOn(page, "order");
      expect(orders[0]).toEqual(["trips_per_day", { ascending: false }]);
      expect(orders[1]).toEqual(["id", { ascending: true }]);
    }
  });

  it("stops paging at the layer's own cap rather than reading a whole agency", async () => {
    asMember();

    const enormous = Array.from({ length: TRANSIT_STOP_LAYER_LIMIT + 600 }, (_, index) =>
      stopRow({ id: `stop-${String(index).padStart(6, "0")}`, trips_per_day: 5000 - index })
    );
    respond = defaultResponder({ stops: enormous, stopCount: enormous.length });

    const response = await getTransit(bareRequest());
    const payload = await response.json();

    expect(payload.returnedCount).toBe(TRANSIT_STOP_LAYER_LIMIT);
    expect(payload.matchedCount).toBe(enormous.length);
    expect(payload.truncated).toBe(true);
    expect(payload.limit).toBe(TRANSIT_STOP_LAYER_LIMIT);

    // And no page reached past the cap.
    for (const page of recorded.filter((query) => query.table === "gtfs_stops_map")) {
      const range = filtersOn(page, "range")[0] as [number, number];
      expect(range[1]).toBeLessThan(TRANSIT_STOP_LAYER_LIMIT);
    }
  });

  it("draws a stop as a point carrying its service level, tiered from the shared thresholds", async () => {
    asMember();

    const response = await getTransit(bareRequest());
    const payload = await response.json();

    expect(payload.features).toHaveLength(1);
    expect(payload.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [-121.4944, 38.5816],
    });
    expect(payload.features[0].properties).toMatchObject({
      kind: "transit_stop",
      stopName: "Main St & 2nd Ave",
      agencyName: "Sacramento Regional Transit",
      serviceDay: TRANSIT_MAP_SERVICE_DAY,
      tripsPerDay: 96,
      // 720 seconds is 12 minutes, which meets the frequent tier.
      peakHeadwayMinutes: 12,
      serviceTierMinutes: FREQUENT_SERVICE_HEADWAY_MINUTES,
      routesServing: 3,
    });
    expect(payload.serviceDay).toBe(TRANSIT_MAP_SERVICE_DAY);
  });

  it("tiers a wider headway down, and refuses to tier a stop with no derivable interval", async () => {
    asMember();
    respond = defaultResponder({
      stops: [
        stopRow({ id: STOP_ROW_A, peak_headway_seconds: 25 * 60 }),
        stopRow({ id: STOP_ROW_B, peak_headway_seconds: null, trips_per_day: 2 }),
      ],
    });

    const payload = await (await getTransit(bareRequest())).json();

    expect(payload.features[0].properties.serviceTierMinutes).toBe(BASIC_SERVICE_HEADWAY_MINUTES);
    // Null rather than the wider tier: "no interval could be derived" must not
    // borrow the meaning of "meets the 30-minute tier".
    expect(payload.features[1].properties.serviceTierMinutes).toBeNull();
    expect(payload.features[1].properties.peakHeadwayMinutes).toBeNull();
  });

  /**
   * THE SENTENCE THE ORDER PAYS FOR. Without `trips_per_day DESC` this claim is
   * an invention, which is why the assertion names the claim and the order test
   * above names the mechanism.
   */
  it("says WHICH stops the cap left out, not merely that it left some out", async () => {
    asMember();
    respond = defaultResponder({ stops: [stopRow()], stopCount: 12400 });

    const payload = await (await getTransit(bareRequest())).json();

    expect(payload.truncated).toBe(true);
    expect(payload.matchedCount).toBe(12400);
    const note = (payload.coverageNotes as string[]).find((entry) => entry.includes("most-served"));
    expect(note).toBeDefined();
    expect(note).toContain("12,400");
    expect(note).toContain("least-served");
    expect(note).toContain("not stops that do not exist");
  });

  /**
   * THE OTHER POLARITY, WHICH IS THE ONE THAT SHIPS ON EVERY ORDINARY LOAD.
   *
   * Only the truncated case was ever asserted, so `if (disclosure.truncated)`
   * could be widened to `if (features.length >= 0)` with 40 of 40 tests still
   * green — putting "showing the 1 most-served of 1, the ones not drawn are the
   * least-served" on a layer that drew everything it had. A sentence about what
   * was left out is a falsehood when nothing was left out, and an unasserted
   * negative is how a disclosure turns into an invention.
   */
  it("says nothing about most-served or least-served when nothing was left out", async () => {
    asMember();
    respond = defaultResponder({ stops: [stopRow(), stopRow({ id: STOP_ROW_B })] });

    const payload = await (await getTransit(bareRequest())).json();

    expect(payload.truncated).toBe(false);
    expect(payload.features).toHaveLength(2);
    expect(payload.matchedCount).toBe(2);

    const notes = payload.coverageNotes as string[];
    expect(notes.some((note) => note.includes("most-served"))).toBe(false);
    expect(notes.some((note) => note.includes("least-served"))).toBe(false);
    expect(notes.some((note) => note.includes("the map draws at most"))).toBe(false);
    // And the layer still says what it DID draw, so the absence above is the
    // truncation sentence being withheld rather than the notes being empty.
    expect(notes.some((note) => note.includes("derived from"))).toBe(true);
  });

  /**
   * THE WRONG-QUERY CANARY. A hex EWKB string is exactly what
   * `gtfs_stop_service_levels.geom` returns through PostgREST. It is counted as
   * undrawable rather than handed to Mapbox, and the count is disclosed.
   */
  it("counts a geometry it cannot draw as dropped instead of drawing nothing quietly", async () => {
    asMember();
    respond = defaultResponder({
      stops: [
        stopRow(),
        stopRow({ id: STOP_ROW_B, geometry_geojson: "0101000020E6100000AE47E17A14AE5EC0" }),
      ],
    });

    const payload = await (await getTransit(bareRequest())).json();

    expect(payload.features).toHaveLength(1);
    expect(payload.droppedCount).toBe(1);
    // Dropped rows were fetched, so this is lossy rather than truncated. The two
    // say different things and must not be conflated.
    expect(payload.truncated).toBe(false);
    expect((payload.coverageNotes as string[]).some((note) => note.includes("could not"))).toBe(
      true,
    );
  });

  it("carries the caveats that qualify every number it just drew", async () => {
    asMember();

    const payload = await (await getTransit(bareRequest())).json();

    expect(payload.caveats).toContain(GTFS_NOT_A_TIMETABLE_CAVEAT);
    expect((payload.coverageNotes as string[])).toContain(GTFS_NOT_A_TIMETABLE_CAVEAT);
  });

  /**
   * A LOADED FEED IS NOT A RUNNING ONE. Three of four Sacramento-area feeds
   * measured on 2026-08-05 had already expired, SacRT's sixteen months earlier.
   * A headway drawn without this reads as current service.
   */
  it("says when the schedule inside a drawn feed has already stopped running", async () => {
    asMember();

    const payload = await (await getTransit(bareRequest())).json();

    const note = (payload.coverageNotes as string[]).find((entry) =>
      entry.includes("already ended"),
    );
    expect(note).toBeDefined();
    expect(note).toContain("2025-04-05");
    expect(note).toContain("Sacramento Regional Transit");
  });

  it("does not claim an expiry for a feed whose service window is still open", async () => {
    asMember();
    respond = defaultResponder({
      versions: [{ ...VERSION_ROW, service_end_date: "2099-12-31" }],
    });

    const payload = await (await getTransit(bareRequest())).json();

    expect((payload.coverageNotes as string[]).some((note) => note.includes("already ended"))).toBe(
      false,
    );
  });

  it("discloses the preloaded feeds it deliberately does not draw", async () => {
    asMember();
    respond = defaultResponder({ publicFeedCount: 2 });

    const payload = await (await getTransit(bareRequest())).json();

    const note = (payload.coverageNotes as string[]).find((entry) => entry.includes("preloaded"));
    expect(note).toBeDefined();
    expect(note).toContain("2");
  });

  it("says a workspace has no feed of its own rather than showing an unexplained empty map", async () => {
    asMember();
    respond = defaultResponder({ feeds: [] });

    const payload = await (await getTransit(bareRequest())).json();

    expect(payload.features).toEqual([]);
    expect((payload.coverageNotes as string[])[0]).toContain("has not brought in a transit feed");
    // And it stops there: no version read, no stop read, nothing to draw.
    expect(recorded.map((query) => query.table)).not.toContain("gtfs_stops_map");
  });

  it("distinguishes 'no feed' from 'no completed ingest in use'", async () => {
    asMember();
    respond = defaultResponder({ versions: [] });

    const payload = await (await getTransit(bareRequest())).json();

    expect(payload.features).toEqual([]);
    expect((payload.coverageNotes as string[])[0]).toContain("completed ingest in use");
    expect(recorded.map((query) => query.table)).not.toContain("gtfs_stops_map");
  });

  /**
   * A FAILED READ IS FATAL TO THE LAYER, not just to its copy. Answering 200
   * with an empty FeatureCollection would tell the planner their workspace has
   * no transit, and by then the error is gone — the 200 would be the last place
   * the truth existed.
   */
  it("answers 500 rather than an empty layer when the stop read fails", async () => {
    asMember();
    const base = defaultResponder();
    respond = (query) => {
      if (query.table === "gtfs_stops_map") {
        return { data: null, error: { message: "connection reset" }, count: null };
      }
      return base(query);
    };

    const response = await getTransit(bareRequest());

    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "transit_layer_stop_read_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    );
  });

  it("answers 503 rather than an empty layer when the schema is not migrated yet", async () => {
    asMember();
    respond = () => ({
      data: null,
      error: { message: 'relation "public.gtfs_feeds" does not exist' },
      count: null,
    });

    const response = await getTransit(bareRequest());

    expect(response.status).toBe(503);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "transit_layer_feed_read_failed",
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    );
  });

  it("audits what it drew, so an operator can check the sentence a planner saw", async () => {
    asMember();
    respond = defaultResponder({ stopCount: 12400 });

    await getTransit(bareRequest());

    expect(mockAudit.info).toHaveBeenCalledWith(
      "transit_layer_loaded",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        count: 1,
        matchedCount: 12400,
        truncated: true,
        serviceDay: TRANSIT_MAP_SERVICE_DAY,
      }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The claim boundary, over the surfaces the gtfs guard cannot reach            */
/* -------------------------------------------------------------------------- */

/**
 * The prohibitions, kept in the same shape and wording as
 * `gtfs-claim-boundaries.test.ts` so the two cannot drift into two different
 * rules. See the header for why this file has to carry a copy at all.
 */
const PROHIBITED_TRANSIT_CLAIMS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "a departure time presented as an answer",
    pattern: /\b(?:departs?|departing|leaves?|leaving|arrives?|arriving|scheduled)\s+(?:at|for)\s+\d{1,2}:[0-5]\d/i,
  },
  { label: "a departure time presented as an answer", pattern: /\bthe\s+\d{1,2}:[0-5]\d\b/ },
  { label: "a departure time presented as an answer", pattern: /\b\d{1,2}:[0-5]\d\s*(?:am|pm|a\.m\.|p\.m\.)/i },
  {
    label: "a departure time presented as an answer",
    pattern: /\bnext\s+(?:bus|train|vehicle|departure|arrival)\b/i,
  },
  { label: "a departure time presented as an answer", pattern: /\bdeparture board\b/i },
  { label: "real-time service OpenPlan does not read", pattern: /\breal[\s-]?time\b/i },
  {
    label: "real-time service OpenPlan does not read",
    pattern: /\blive\s+(?:arrivals?|departures?|times?|schedule|tracking|vehicles?|buses|transit)/i,
  },
  { label: "real-time service OpenPlan does not read", pattern: /\barriving\s+(?:now|in)\b/i },
  {
    label: "complete transit coverage a workspace's feeds cannot have",
    pattern:
      /\b(?:all|every|complete|comprehensive|entire|full)\b[^.\n]{0,25}\btransit\s+(?:service|network|routes?|stops?|system)\b/i,
  },
  {
    label: "complete transit coverage a workspace's feeds cannot have",
    pattern: /\b(?:all|every|complete|comprehensive|entire)\b[^.\n]{0,25}\b(?:transit\s+)?(?:routes?|stops?)\s+(?:in|serving|across)\b/i,
  },
  {
    label: "a timetable presented as something OpenPlan provides",
    pattern:
      /\b(?:provides?|providing|offers?|offering|shows?|showing|displays?|displaying|includes?|including|publishes?|gives?|view|see)\s+(?:the\s+|a\s+|your\s+|an\s+|this\s+)?(?:timetable|schedule)s?\b/i,
  },
];

const NEGATION =
  /\b(?:not|never|no|none|nothing|cannot|can't|won't|does not|do not|is not|are not|without|excludes?|excluded|refuses?|unreachable|rather than|instead of|may not|must not)\b/i;

/** Text a browser or an API consumer can receive. Comments are never collected. */
function renderableRuns(relative: string): string[] {
  const source = ts.createSourceFile(
    relative,
    readSource(relative),
    ts.ScriptTarget.Latest,
    true,
    relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const runs: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) {
      runs.push(node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      runs.push(node.text);
    } else if (ts.isJsxText(node)) {
      const collapsed = node.text.replace(/\s+/g, " ").trim();
      if (collapsed) runs.push(collapsed);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return runs.filter((run) => run.trim().length > 0);
}

function assertableSentences(run: string): string[] {
  return run
    .split(/(?<=[.;:])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !NEGATION.test(sentence));
}

const MAP_LANE_FILES = [ROUTE_FILE, BACKDROP_FILE, PANEL_FILE];

describe("the transit map lane stays inside service-level claims", () => {
  it("collects text that can reach a person, and nothing from comments", () => {
    const runs = renderableRuns(ROUTE_FILE);
    expect(runs.some((run) => run.includes("least-served stops"))).toBe(true);
    // The route's header comment contains "a promise to a rider standing on the
    // corner". If that is collected, this scan is reading comments and every
    // assertion below is about the wrong text.
    expect(runs.some((run) => run.includes("standing on the corner"))).toBe(false);
  });

  it.each(MAP_LANE_FILES)("keeps %s inside service-level claims", (file) => {
    for (const run of renderableRuns(file)) {
      for (const sentence of assertableSentences(run)) {
        for (const { label, pattern } of PROHIBITED_TRANSIT_CLAIMS) {
          expect(sentence, `${file} contains a prohibited transit claim (${label})`).not.toMatch(
            pattern,
          );
        }
      }
    }
  });

  it("actually catches the overclaims a transit map would be tempted by", () => {
    // A guard nobody can see fail is indistinguishable from no guard, and these
    // are the four a MAP specifically invites: a popup that answers "when",
    // a layer that claims live vehicles, and a label that claims the region.
    const overclaims = [
      "The next bus from this stop is on its way.",
      "Live arrivals at every stop in view.",
      "Every transit stop in the region.",
      "View the timetable for this stop.",
    ];
    for (const text of overclaims) {
      const tripped = assertableSentences(text).some((sentence) =>
        PROHIBITED_TRANSIT_CLAIMS.some((claim) => claim.pattern.test(sentence)),
      );
      expect(tripped, `"${text}" should have tripped a prohibition`).toBe(true);
    }
  });

  /**
   * THE DOT AND THE KEY MUST COME FROM ONE PLACE.
   *
   * The layer paints three meaning-bearing colours and, until this change, the
   * legend had no transit entry at all — so the colours carried a claim nothing
   * on screen defined. Adding the entry fixes that once; keeping the palette in
   * ONE module is what stops the two drifting apart afterwards, which is the
   * failure a screenshot review cannot catch because both surfaces look fine
   * individually.
   *
   * Asserted on the SOURCE because a Mapbox paint expression cannot be rendered
   * in jsdom. If the backdrop ever types a tier colour again, this fails.
   */
  it("paints the transit tiers from the shared palette rather than its own hexes", () => {
    const backdrop = readSource(BACKDROP_FILE);

    expect(backdrop).toContain('from "@/lib/cartographic/transit-service-tier-palette"');
    for (const tier of TRANSIT_SERVICE_TIER_LEGEND_ORDER) {
      expect(backdrop).toContain(`TRANSIT_SERVICE_TIER_COLOR.${tier}`);
      // The literal itself must be gone: an import beside a hardcoded copy is the
      // shape that drifts, and `every-api-route-has-a-caller` learned the same
      // lesson — matching the import proves nothing about the use.
      expect(
        backdrop.includes(TRANSIT_SERVICE_TIER_COLOR[tier]),
        `${tier}'s colour is typed into the backdrop as well as imported`,
      ).toBe(false);
    }
  });

  it("does not fire on the honest phrasings this layer actually uses", () => {
    const honest = [
      "About 96 trips call here on a Wednesday.",
      "About one vehicle every 12 minutes in the busiest hour.",
      "Derived from a published feed, averaged over one service day — a service level, not a timetable.",
      "Transit stops (ingested feeds)",
      "Served by 3 routes (1, 51, 81).",
    ];
    for (const text of honest) {
      for (const sentence of assertableSentences(text)) {
        for (const { label, pattern } of PROHIBITED_TRANSIT_CLAIMS) {
          expect(sentence, `honest copy wrongly tripped ${label}: "${text}"`).not.toMatch(pattern);
        }
      }
    }
  });

  /**
   * WHY THIS COPY OF THE RULE EXISTS, ASSERTED SO IT CANNOT BECOME DEAD WEIGHT.
   *
   * `gtfs-claim-boundaries.test.ts` decides its scope from four roots plus the
   * Data Hub, and none of them contains this route or the cartographic
   * components. When someone widens those roots — which is the right fix — this
   * assertion fails, and the block above should be deleted rather than
   * maintained in parallel. A duplicated rule that nobody is told has become
   * redundant is how two rules end up saying different things.
   */
  it("records that the shared transit guard still cannot reach these files", () => {
    const guard = readSource("src/test/gtfs-claim-boundaries.test.ts");
    const rootsBlock = guard.slice(
      guard.indexOf("const TRANSIT_ROOTS"),
      guard.indexOf("const TRANSIT_LANE_IMPORT"),
    );
    expect(rootsBlock.length).toBeGreaterThan(0);
    expect(rootsBlock).not.toContain("map-features");
    expect(rootsBlock).not.toContain("components/cartographic");
  });
});

/* -------------------------------------------------------------------------- */
/* Reachability — a layer nobody can turn on is not a layer                     */
/* -------------------------------------------------------------------------- */

describe("the layer is reachable from the shell, not merely implemented", () => {
  const backdrop = readSource(BACKDROP_FILE);

  it("is fetched by the backdrop from the route that exists", () => {
    expect(backdrop).toContain('fetch("/api/map-features/transit"');
  });

  it("registers its coverage notes under its own layer key", () => {
    expect(backdrop).toMatch(/registerLayerStatus\(\s*"transit"/);
    expect(backdrop).toMatch(/noteLayer\(\s*"transit"/);
  });

  it("is gated on its own toggle, and remembers only a completed read", () => {
    // The gate is the divergence from every other layer, so it is asserted
    // rather than assumed: without the first line the payload rides every
    // navigation; without the third a failed attempt would leave the layer
    // permanently empty behind a checkbox that looks switched on.
    expect(backdrop).toContain("if (!layers.transit) return;");
    expect(backdrop).toContain("transitFetchedForRef.current === workspaceId");
    expect(backdrop).toContain("if (!settled) transitFetchedForRef.current = undefined;");
  });

  it("honours the toggle across all three drawn layers", () => {
    expect(backdrop).toMatch(/const visibility = layers\.transit \? "visible" : "none";/);
    for (const id of [
      "TRANSIT_CLUSTER_LAYER_ID",
      "TRANSIT_CLUSTER_COUNT_LAYER_ID",
      "TRANSIT_STOPS_CIRCLE_LAYER_ID",
    ]) {
      expect(backdrop).toContain(id);
    }
  });

  it("counts a transit click as a feature hit rather than as background", () => {
    const featureLayers = backdrop.slice(
      backdrop.indexOf("const FEATURE_LAYERS = ["),
      backdrop.indexOf("] as const;", backdrop.indexOf("const FEATURE_LAYERS = [")),
    );
    expect(featureLayers).toContain("TRANSIT_STOPS_CIRCLE_LAYER_ID");
    expect(featureLayers).toContain("TRANSIT_CLUSTER_LAYER_ID");
  });

  /**
   * THE POPUP IS BUILT FROM DOM NODES. `stop_name` comes out of a third party's
   * published feed and is written to the page verbatim; `setHTML` with an
   * interpolated feed value would make any agency's GTFS export a script
   * injection into every workspace that ingested it.
   */
  it("builds the stop popup without ever handing feed text to setHTML", () => {
    expect(backdrop).toContain("setDOMContent(transitPopupContent(");
    const popupBlock = backdrop.slice(
      backdrop.indexOf("const transitPopupContent"),
      backdrop.indexOf("const onTransitStopClick"),
    );
    expect(popupBlock.length).toBeGreaterThan(0);
    expect(popupBlock).not.toContain("innerHTML");
    expect(popupBlock).toContain("textContent");
  });

  /**
   * NEITHER TIER THRESHOLD MAY BE A LITERAL. They are the reporting vocabulary
   * the whole transit lane is built on, and a `15` typed into a paint
   * expression is a policy decision hidden where nobody would look for it.
   */
  it("paints the tiers from the shared constants, never from a number", () => {
    const paintBlock = backdrop.slice(
      backdrop.indexOf("const TRANSIT_TIER_PAINT"),
      backdrop.indexOf("];", backdrop.indexOf("const TRANSIT_TIER_PAINT")),
    );
    expect(paintBlock).toContain("FREQUENT_SERVICE_HEADWAY_MINUTES");
    expect(paintBlock).toContain("BASIC_SERVICE_HEADWAY_MINUTES");
    expect(paintBlock).not.toMatch(/\b(?:15|30)\b/);
  });

  it("has no bare 15 or 30 standing in for a headway tier anywhere in the route", () => {
    const route = readSource(ROUTE_FILE);
    const body = route.slice(route.indexOf("function serviceTierMinutes"));
    expect(body).toContain("FREQUENT_SERVICE_HEADWAY_MINUTES");
    expect(body).toContain("BASIC_SERVICE_HEADWAY_MINUTES");
  });
});

describe("the layers panel offers transit, off by default", () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  /**
   * RENDERED, not read off a constant. A key present in `LAYER_KEYS` and a
   * checkbox a planner can actually tick are different facts, and this repo has
   * shipped the first without the second eleven times.
   */
  it("renders a labelled, unchecked transit toggle", async () => {
    const { CartographicProvider } = await import(
      "@/components/cartographic/cartographic-context"
    );
    const { CartographicLayersPanel } = await import(
      "@/components/cartographic/cartographic-layers-panel"
    );

    render(
      createElement(
        CartographicProvider,
        null,
        createElement(CartographicLayersPanel, { workspaceId: WORKSPACE_ID }),
      ),
    );

    const label = screen.getByText("Transit stops (ingested feeds)");
    expect(label).toBeInTheDocument();

    const checkbox = label.parentElement?.querySelector("input[type=checkbox]");
    expect(checkbox).toBeTruthy();
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });
});
