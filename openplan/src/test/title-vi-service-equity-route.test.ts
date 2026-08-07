import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecordingSupabase,
  equalityFilters,
  type QueryResponse,
  type RecordedQuery,
} from "./helpers/fake-supabase-query-recorder";

/**
 * THE ROUTE BEHIND A CIVIL-RIGHTS FINDING, WHICH HAD NO TEST AT ALL.
 *
 * Found 2026-08-07 while widening its projection. `src/app/api/title-vi/
 * service-equity/route.ts` says of itself:
 *
 *   "There is no RLS net under a service-role read, so the `.eq()` chain IS the
 *    access control and is asserted as such by this route's tests."
 *
 * There were no such tests. `title-vi-service-equity.test.ts` covers the pure
 * comparison and the policy parser; nothing imported the route. So the sentence
 * was true about the design and false about the repository — the most expensive
 * kind of comment, because it stops anyone from looking.
 *
 * What is asserted here is what a mocked Supabase client CANNOT otherwise catch:
 *
 *   - the `.eq()` arguments on every service-role read, because a chain double
 *     answers its fixture whether the workspace filter is there or not;
 *   - the projection string, because a column dropped from a `.select()` leaves
 *     every assertion green and the surface rendering `undefined`;
 *   - that a read FAILURE is never answered as an empty result, which on this
 *     surface would read as "no tract here has any transit service".
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

let respond: (query: RecordedQuery) => QueryResponse;
let recorder: ReturnType<typeof createRecordingSupabase>;
let serviceRecorder: ReturnType<typeof createRecordingSupabase>;
let currentUser: { id: string } | null = { id: USER_ID };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...recorder.client,
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
  createServiceRoleClient: () => serviceRecorder.client,
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({
    error: vi.fn(),
    failure: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

import { GET } from "@/app/api/title-vi/service-equity/route";

/** A tract that is 30% minority on its own universe and 20% below poverty on its. */
function tractServiceRow(geoid: string, over: Record<string, unknown> = {}) {
  return {
    tract_geoid: geoid,
    service_day: "monday",
    stops_in_tract: 4,
    stop_events_per_day: 100,
    best_peak_headway_seconds: 900,
    best_span_seconds: 18 * 3600,
    routes_serving: 3,
    ...over,
  };
}

function censusRow(geoid: string, over: Record<string, unknown> = {}) {
  return {
    geoid,
    pop_total: 1000,
    pop_white: 700,
    pop_below_poverty: 100,
    poverty_universe: 900,
    race_universe: 1000,
    ...over,
  };
}

const POLICY_ROW = {
  id: "policy-1",
  workspace_id: WORKSPACE_ID,
  adopted_on: "2026-01-15",
  adopted_by: "Board of Directors",
  board_action_reference: "Res. 2026-04",
  document_url: null,
  minority_definition_method: "fixed_threshold",
  minority_threshold_pct: "25.00",
  low_income_definition_method: "fixed_threshold",
  low_income_threshold_pct: "15.00",
  disparate_impact_threshold_pct: "20.00",
  disproportionate_burden_threshold_pct: "20.00",
  standard_peak_headway_minutes: 30,
  standard_offpeak_headway_minutes: 60,
  standard_span_hours: 18,
  standard_on_time_performance_pct: 85,
  standard_vehicle_load_note: null,
  standard_service_availability_note: null,
  policy_amenity_distribution_note: null,
  policy_vehicle_assignment_note: null,
  superseded_at: null,
};

/** The default happy path: two minority tracts and two comparison tracts. */
function defaultTables(): Record<string, unknown> {
  return {
    workspace_members: { role: "admin" },
    title_vi_policies: POLICY_ROW,
    gtfs_feed_versions: [
      {
        id: VERSION_ID,
        feed_id: "feed-1",
        tract_service_rows: 4,
        tract_service_computed_at: "2026-08-01T00:00:00Z",
        service_start_date: "2026-01-01",
        service_end_date: "2026-12-31",
      },
    ],
    gtfs_tract_service: [
      tractServiceRow("focus-1"),
      tractServiceRow("focus-2"),
      tractServiceRow("comparison-1", { stop_events_per_day: 400 }),
      tractServiceRow("comparison-2", { stop_events_per_day: 400 }),
    ],
    census_tracts: [
      censusRow("focus-1", { pop_white: 400 }),
      censusRow("focus-2", { pop_white: 400 }),
      censusRow("comparison-1", { pop_white: 900 }),
      censusRow("comparison-2", { pop_white: 900 }),
    ],
  };
}

function install(tables: Record<string, unknown>, overrides: Record<string, QueryResponse> = {}) {
  respond = (query) => {
    if (overrides[query.table]) return overrides[query.table];
    return { data: tables[query.table] ?? null, error: null };
  };
  recorder = createRecordingSupabase((query) => respond(query));
  serviceRecorder = createRecordingSupabase((query) => respond(query));
}

async function get(search = `workspaceId=${WORKSPACE_ID}&serviceDay=monday`) {
  const request = {
    nextUrl: new URL(`https://openplan.test/api/title-vi/service-equity?${search}`),
    headers: new Headers(),
  } as unknown as Parameters<typeof GET>[0];
  const response = await GET(request);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  currentUser = { id: USER_ID };
  install(defaultTables());
});

describe("the tenant boundary is the .eq() chain, because nothing else is there", () => {
  it("scopes both service-role reads to the workspace, the feed version and the service day", async () => {
    await get();

    const tractService = serviceRecorder.queriesFor("gtfs_tract_service");
    expect(tractService.length).toBeGreaterThan(0);
    // Recorded ARGUMENTS, not the presence of a filter: a double returns the
    // same rows for the wrong workspace as for the right one.
    expect(equalityFilters(tractService[0])).toEqual({
      workspace_id: WORKSPACE_ID,
      feed_version_id: VERSION_ID,
      service_day: "monday",
    });
  });

  it("reads the feed version scoped to the workspace and to a ready current version", async () => {
    await get();

    const versions = recorder.queriesFor("gtfs_feed_versions");
    expect(equalityFilters(versions[0])).toEqual({
      workspace_id: WORKSPACE_ID,
      is_current: true,
      status: "ready",
    });
  });

  it("confirms membership before reading anything with the service role", async () => {
    install({ ...defaultTables(), workspace_members: null });

    const { status, body } = await get();

    expect(status).toBe(404);
    expect(body.error).toBe("Workspace not found");
    // The service-role client must not have been used at all: a 404 that still
    // read another tenant's rows has already leaked them into this process.
    expect(serviceRecorder.queries).toHaveLength(0);
  });

  it("answers 401 before any query when there is no session", async () => {
    currentUser = null;

    const { status } = await get();

    expect(status).toBe(401);
    expect(recorder.queries).toHaveLength(0);
    expect(serviceRecorder.queries).toHaveLength(0);
  });
});

describe("it asks the database for the columns it computes with", () => {
  it("projects both ACS universes, not just the counts", async () => {
    await get();

    const projection = serviceRecorder.queriesFor("census_tracts")[0].projection ?? "";
    for (const column of [
      "geoid",
      "pop_total",
      "pop_white",
      "pop_below_poverty",
      // THE TWO THAT MATTER. Without them every share is divided by pop_total,
      // which understates poverty and moves tracts out of the protected group.
      "poverty_universe",
      "race_universe",
    ]) {
      expect(projection, `projection is missing ${column}`).toContain(column);
    }
  });

  it("projects every service column the comparison reads", async () => {
    await get();

    const projection = serviceRecorder.queriesFor("gtfs_tract_service")[0].projection ?? "";
    for (const column of [
      "tract_geoid",
      "stops_in_tract",
      "stop_events_per_day",
      "best_peak_headway_seconds",
      "best_span_seconds",
      "routes_serving",
    ]) {
      expect(projection, `projection is missing ${column}`).toContain(column);
    }
  });

  it("projects the flag that says whether the tract join ever ran", async () => {
    await get();

    const projection = recorder.queriesFor("gtfs_feed_versions")[0].projection ?? "";
    // Dropping this column would make every feed look computed, and an empty
    // tract table would then be reported as an absence of service.
    expect(projection).toContain("tract_service_computed_at");
  });
});

describe("a failed read is never answered as a finding", () => {
  it("answers 503 when tract service cannot be read", async () => {
    install(defaultTables(), {
      gtfs_tract_service: { data: null, error: { message: "connection reset" } },
    });

    const { status, body } = await get();

    expect(status).toBe(503);
    expect(String(body.hint)).toMatch(/not a finding that tracts have no service/i);
  });

  it("answers 503 when the demographics cannot be read", async () => {
    install(defaultTables(), {
      census_tracts: { data: null, error: { message: "connection reset" } },
    });

    const { status, body } = await get();

    expect(status).toBe(503);
    expect(String(body.hint)).toMatch(/not a finding about the population/i);
  });

  it("names the migration when the deployment predates the universe columns", async () => {
    install(defaultTables(), {
      census_tracts: {
        data: null,
        error: { message: 'column census_tracts.poverty_universe does not exist' },
      },
    });

    const { status, body } = await get();

    expect(status).toBe(503);
    expect(String(body.error)).toMatch(/predates the census tract universe columns/i);
    expect(String(body.hint)).toContain("20260805000010");
    // It must say what it will NOT do instead: a poverty rate over total
    // population is the defect that migration removes, not a fallback.
    expect(String(body.hint)).toMatch(/understates it/i);
  });

  it("does not mistake an ordinary column failure for a pending migration", async () => {
    // The narrow predicate exists so a permission failure or a typo in another
    // column surfaces as itself. Answering 503-with-a-migration-name here would
    // tell an operator to apply a migration that changes nothing.
    install(defaultTables(), {
      census_tracts: {
        data: null,
        error: { message: "permission denied for table census_tracts" },
      },
    });

    const { status, body } = await get();

    expect(status).toBe(503);
    expect(String(body.error)).toBe("Could not read census tract demographics");
  });
});

describe("what it computes with what it read", () => {
  it("classifies on each share's own universe and returns a comparison", async () => {
    const { status, body } = await get();

    expect(status).toBe(200);
    const result = body.result as { ok: boolean; comparison: Record<string, unknown> };
    expect(result.ok).toBe(true);
    // 600 of a race universe of 1,000 → 60%, above the adopted 25%.
    expect(result.comparison.minorityFocus).toMatchObject({ tracts: 2 });
    expect(result.comparison.minorityComparison).toMatchObject({ tracts: 2 });
    // 100 below poverty on a poverty universe of 900 → 11.1%, below the adopted
    // 15%. Against pop_total it would be 10% — the same side here, which is why
    // the denominator is pinned by its own test rather than by this one.
    expect(result.comparison.lowIncomeFocus).toMatchObject({ tracts: 0 });
  });

  it("refuses without recording a finding when no policy is adopted", async () => {
    install({ ...defaultTables(), title_vi_policies: null });

    const { status, body } = await get();

    expect(status).toBe(200);
    const result = body.result as { ok: boolean; refusal: { code: string; message: string } };
    expect(result.ok).toBe(false);
    expect(result.refusal.code).toBe("no_adopted_policy");
    expect(result.refusal.message).toMatch(/OpenPlan will not supply one/i);
  });

  it("refuses when the workspace has no feed rather than reporting no service", async () => {
    install({ ...defaultTables(), gtfs_feed_versions: [] });

    const { body } = await get();

    const result = body.result as { ok: boolean; refusal: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.refusal.code).toBe("no_feed");
    // Nothing further was read: there is no version to scope a read to.
    expect(serviceRecorder.queriesFor("gtfs_tract_service")).toHaveLength(0);
  });
});
