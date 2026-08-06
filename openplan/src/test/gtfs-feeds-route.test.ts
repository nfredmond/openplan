import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE WORKSPACE'S TRANSIT FEEDS — WHO MAY SEE THEM, AND WHOSE FEED A NEW
 * INGEST LANDS IN.
 *
 * ============================ WHY THIS HARNESS RECORDS EVERY FILTER
 *
 * `POST /api/gtfs/feeds` does its "have we already registered this source"
 * probe with `createServiceRoleClient()`. A service-role client bypasses RLS by
 * design, so on that query the `.eq("workspace_id", …)` chain is not a
 * belt-and-braces companion to a policy — it IS the access control, entire.
 * There is nothing underneath it to catch a filter somebody deletes while
 * refactoring.
 *
 * This repository has already paid for the test shape that cannot see that.
 * On 2026-08-05 a public RTP page shipped with a fake whose `eq()` was
 * `() => query` — it returned the builder and recorded nothing — and six
 * mutations, every one of them access control, survived a 36-test suite. So
 * the fake below does two things a returns-the-fixture mock does not:
 *
 *   1. it RECORDS every `.from()`, `.select()`, `.eq()`, `.is()` and `.in()`,
 *      so a test can assert that a filter reached the client at all; and
 *   2. it APPLIES those filters to rows held in tables, so deleting a filter
 *      changes what the route gets back and the body assertions move too.
 *
 * Either alone is weaker than it looks. Recording without applying proves the
 * call was made and not that it selected anything; applying without recording
 * cannot distinguish "the route scoped the query" from "the route asked for
 * everything and the fixture happened to hold one row". Both are here.
 *
 * ================================== THE FIXTURES THAT MAKE THE FILTERS REAL
 *
 * Three feeds share one normalised source URL: this workspace's own, ANOTHER
 * workspace's, and a PUBLIC preloaded one (`workspace_id IS NULL`, the row
 * every tenant on the deployment reads). That collision is the whole point.
 * The reuse probe exists to turn a re-ingest into a refresh of the feed the
 * planner already has; without the workspace filter it would find one of the
 * other two first and add a version — with this workspace's parsed rows and
 * this workspace's requester — to a feed belonging to somebody else, or to the
 * shared row every other tenant analyses with. A test seeded with one feed
 * could not tell that apart from correct behaviour.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const authGetUserMock = vi.fn();
const runGtfsIngestMock = vi.fn();
const resolveGtfsCatalogRedirectMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const OWN_FEED_ID = "44444444-4444-4444-8444-444444444444";
/** The same source URL, registered by an agency that is not this one. */
const FOREIGN_FEED_ID = "55555555-5555-4555-8555-555555555555";
/** `workspace_id IS NULL` — the preloaded row every tenant reads. */
const PUBLIC_FEED_ID = "66666666-6666-4666-8666-666666666666";

const OWN_VERSION_ID = "77777777-7777-4777-8777-777777777777";
/** A newer ingest of the same feed that FAILED. Never the current one. */
const FAILED_VERSION_ID = "88888888-8888-4888-8888-888888888888";
/** A ready, current version belonging to another workspace's feed. */
const FOREIGN_VERSION_ID = "99999999-9999-4999-8999-999999999999";

const SOURCE_URL = "https://transit.example.gov/gtfs.zip";
const NORMALIZED_SOURCE_URL = "https://transit.example.gov/gtfs.zip";
const NOW = "2026-08-05T00:00:00.000Z";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), requestId: "test" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

// The ingest itself downloads and parses an archive; only its CALL is under
// test here. `importOriginal` keeps `normalizeGtfsSourceUrl` and
// `provisionalFeedNameFromUrl` real, because the route's identity key and the
// name a new feed gets are exactly what these tests assert on — stubbing them
// would let the route agree with a stub about a URL neither of them normalised.
vi.mock("@/lib/gtfs/ingest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gtfs/ingest")>();
  return { ...actual, runGtfsIngest: (...args: unknown[]) => runGtfsIngestMock(...args) };
});

vi.mock("@/lib/gtfs/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gtfs/catalog")>();
  return {
    ...actual,
    resolveGtfsCatalogRedirect: (...args: unknown[]) => resolveGtfsCatalogRedirectMock(...args),
  };
});

import { GET, POST } from "@/app/api/gtfs/feeds/route";
import {
  GTFS_FEED_COLUMNS,
  GTFS_FEED_VERSION_COLUMNS,
} from "@/lib/gtfs/route-projections";
import {
  GTFS_FREQUENCIES_EXPANSION_CAVEAT,
  GTFS_NOT_A_TIMETABLE_CAVEAT,
} from "@/lib/gtfs/caveats";

/* -------------------------------------------------------------------------- */
/* A tiny in-memory PostgREST that both records and applies its filters         */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
type QueryError = { message: string; code?: string } | null;
type Filter = { kind: "eq" | "is" | "in"; column: string; value: unknown };
type ClientKind = "rls" | "service";
type Query = {
  client: ClientKind;
  table: string;
  columns: string | null;
  filters: Filter[];
};

let tables: Record<string, Row[]> = {};
let tableFailures: Record<string, QueryError> = {};
let queries: Query[] = [];

const PASSTHROUGH_METHODS = ["order", "limit", "range", "not", "filter", "match"];

function rowMatches(row: Row, filter: Filter): boolean {
  const actual = row[filter.column];
  if (filter.kind === "eq") return actual === filter.value;
  if (filter.kind === "in") {
    return Array.isArray(filter.value) && (filter.value as unknown[]).includes(actual);
  }
  // `.is(column, null)` is how PostgREST spells IS NULL, and a row that simply
  // does not carry the column is null in the database's eyes too.
  if (filter.value === null) return actual === null || actual === undefined;
  return actual === filter.value;
}

function makeChain(client: ClientKind, table: string) {
  const filters: Filter[] = [];
  let columns: string | null = null;
  let memo: { data: Row[]; error: QueryError } | null = null;

  function run(): { data: Row[]; error: QueryError } {
    if (memo) return memo;
    queries.push({ client, table, columns, filters: [...filters] });

    const failure = tableFailures[table];
    if (failure) {
      memo = { data: [], error: failure };
      return memo;
    }

    const rows = tables[table] ?? [];
    memo = { data: rows.filter((row) => filters.every((f) => rowMatches(row, f))), error: null };
    return memo;
  }

  const chain: Record<string, unknown> = {};

  chain.select = vi.fn((cols: string) => {
    columns = cols;
    return chain;
  });
  chain.eq = vi.fn((column: string, value: unknown) => {
    filters.push({ kind: "eq", column, value });
    return chain;
  });
  chain.is = vi.fn((column: string, value: unknown) => {
    filters.push({ kind: "is", column, value });
    return chain;
  });
  chain.in = vi.fn((column: string, value: unknown) => {
    filters.push({ kind: "in", column, value });
    return chain;
  });
  for (const method of PASSTHROUGH_METHODS) chain[method] = vi.fn(() => chain);

  chain.maybeSingle = vi.fn(async () => {
    const result = run();
    if (result.error) return { data: null, error: result.error };
    return { data: result.data[0] ?? null, error: null };
  });
  chain.single = vi.fn(async () => {
    const result = run();
    if (result.error) return { data: null, error: result.error };
    if (result.data.length === 0) {
      return { data: null, error: { code: "PGRST116", message: "no rows returned" } };
    }
    return { data: result.data[0], error: null };
  });
  chain.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(run()).then(onFulfilled, onRejected);

  return chain;
}

function installClients() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => makeChain("rls", table)),
  });
  createServiceRoleClientMock.mockReturnValue({
    from: vi.fn((table: string) => makeChain("service", table)),
  });
}

/** Every query the SERVICE-ROLE client made against a table. */
function serviceQueries(table: string): Query[] {
  return queries.filter((query) => query.client === "service" && query.table === table);
}

/** Every query the caller's own (RLS) client made against a table. */
function rlsQueries(table: string): Query[] {
  return queries.filter((query) => query.client === "rls" && query.table === table);
}

function hasFilter(query: Query, column: string, value: unknown): boolean {
  return query.filters.some(
    (filter) => filter.column === column && filter.value === value && filter.kind !== "in"
  );
}

function seed(role = "admin", options: { includeOwnFeed?: boolean } = {}) {
  const includeOwnFeed = options.includeOwnFeed ?? true;

  const feeds: Row[] = [
    // ORDER MATTERS. The foreign row is FIRST so that a probe which lost its
    // workspace filter would find it before this workspace's own — a fixture
    // ordered the other way round would let the mutation pass by luck.
    {
      id: FOREIGN_FEED_ID,
      workspace_id: OTHER_WORKSPACE_ID,
      agency_name: "Another agency's registration",
      normalized_source_url: NORMALIZED_SOURCE_URL,
      feed_url: SOURCE_URL,
      status: "ready",
      source_kind: "url",
      catalog_source_id: null,
      current_version_id: FOREIGN_VERSION_ID,
      created_at: NOW,
    },
    {
      id: PUBLIC_FEED_ID,
      workspace_id: null,
      agency_name: "Preloaded statewide feed",
      normalized_source_url: NORMALIZED_SOURCE_URL,
      feed_url: SOURCE_URL,
      status: "ready",
      source_kind: "url",
      catalog_source_id: null,
      current_version_id: null,
      created_at: NOW,
    },
  ];

  if (includeOwnFeed) {
    feeds.push({
      id: OWN_FEED_ID,
      workspace_id: WORKSPACE_ID,
      agency_name: "Mountain Area Transit",
      normalized_source_url: NORMALIZED_SOURCE_URL,
      feed_url: SOURCE_URL,
      status: "ready",
      source_kind: "url",
      catalog_source_id: null,
      current_version_id: OWN_VERSION_ID,
      created_at: NOW,
    });
  }

  tables = {
    workspace_members: [{ user_id: USER_ID, workspace_id: WORKSPACE_ID, role }],
    gtfs_feeds: feeds,
    gtfs_feed_versions: [
      {
        id: FOREIGN_VERSION_ID,
        feed_id: FOREIGN_FEED_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        status: "ready",
        is_current: true,
        frequency_trip_count: 0,
        route_service_level_rows: 40,
        service_end_date: "2026-12-31",
        created_at: NOW,
      },
      {
        id: OWN_VERSION_ID,
        feed_id: OWN_FEED_ID,
        workspace_id: WORKSPACE_ID,
        status: "ready",
        is_current: true,
        frequency_trip_count: 12,
        route_service_level_rows: 31,
        service_end_date: "2026-09-30",
        created_at: NOW,
      },
      {
        // A LATER ingest of this workspace's own feed that failed. It is not
        // current and it is not ready, and it is here because filtering on
        // either half of that alone is wrong in a different direction.
        id: FAILED_VERSION_ID,
        feed_id: OWN_FEED_ID,
        workspace_id: WORKSPACE_ID,
        status: "failed",
        is_current: false,
        frequency_trip_count: 0,
        route_service_level_rows: 0,
        service_end_date: null,
        created_at: NOW,
      },
    ],
  };
}

function listRequest(query: string) {
  return new NextRequest(`http://localhost/api/gtfs/feeds?${query}`);
}

function createRequest(body: unknown) {
  return new NextRequest("http://localhost/api/gtfs/feeds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function successfulIngest(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    feedId: OWN_FEED_ID,
    versionId: OWN_VERSION_ID,
    createdFeed: false,
    adoption: { adopted: true },
    displayName: "Mountain Area Transit",
    routeServiceLevelRows: 31,
    stopServiceLevelRows: 402,
    droppedForMissingCoordinates: 0,
    warnings: [],
    caveats: [],
    checksumSha256: "a".repeat(64),
    byteSize: 2_700_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tables = {};
  tableFailures = {};
  queries = [];
  seed();
  installClients();
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  runGtfsIngestMock.mockResolvedValue(successfulIngest());
});

/* -------------------------------------------------------------------------- */
/* GET — the list                                                               */
/* -------------------------------------------------------------------------- */

describe("GET /api/gtfs/feeds", () => {
  it("refuses an unrecognised query parameter rather than ignoring it", async () => {
    // `.strict()` is not fussiness. A parameter the schema silently drops is a
    // filter the caller believes is being applied — `?workspaceId=…&feedId=…`
    // reads as a scoped list and would return the whole workspace.
    const response = await GET(listRequest(`workspaceId=${WORKSPACE_ID}&status=ready`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid feed list parameters",
    });
  });

  it("answers 401 when nobody is signed in", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(listRequest(`workspaceId=${WORKSPACE_ID}`));

    expect(response.status).toBe(401);
  });

  it("tells a non-member the workspace was not found, and never that it is forbidden", async () => {
    const response = await GET(listRequest(`workspaceId=${OTHER_WORKSPACE_ID}`));
    const body = await response.json();

    // 403 would confirm the workspace exists. That is an enumeration oracle,
    // and the whole lane answers 404 for this reason.
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(body.error).toBe("Workspace not found");
    // And it stopped there: no feed was read on behalf of a stranger.
    expect(rlsQueries("gtfs_feeds")).toHaveLength(0);
  });

  it("scopes the membership check to this user AND this workspace", async () => {
    await GET(listRequest(`workspaceId=${WORKSPACE_ID}`));

    const membership = rlsQueries("workspace_members")[0];
    expect(membership).toBeDefined();
    expect(hasFilter(membership, "workspace_id", WORKSPACE_ID)).toBe(true);
    expect(hasFilter(membership, "user_id", USER_ID)).toBe(true);
  });

  it("returns only this workspace's feeds — not another tenant's, and not the public preloaded row", async () => {
    const response = await GET(listRequest(`workspaceId=${WORKSPACE_ID}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.feeds.map((feed: Row) => feed.id)).toEqual([OWN_FEED_ID]);

    // The filter that produced that, asserted where it was applied rather than
    // inferred from the answer. Both halves matter: the body assertion catches
    // a filter that stops selecting, and this one catches a filter that is
    // never sent at all.
    const feedRead = rlsQueries("gtfs_feeds")[0];
    expect(hasFilter(feedRead, "workspace_id", WORKSPACE_ID)).toBe(true);
  });

  it("asks the database for the columns it hands back, by the exported name", async () => {
    await GET(listRequest(`workspaceId=${WORKSPACE_ID}`));

    // The Supabase clients in this repo are deliberately untyped, so a column
    // typo is not a build error — it renders as `undefined` on a page. The
    // projection string itself is therefore the thing worth asserting.
    expect(rlsQueries("gtfs_feeds")[0].columns).toBe(GTFS_FEED_COLUMNS);
    // The count first, so the loop below cannot pass by iterating nothing —
    // the list route reads versions twice, once for what is adopted and once
    // for every recent attempt.
    expect(rlsQueries("gtfs_feed_versions")).toHaveLength(2);
    for (const query of rlsQueries("gtfs_feed_versions")) {
      expect(query.columns).toBe(GTFS_FEED_VERSION_COLUMNS);
    }

    // And one column by name, because its absence would be silent and its
    // consequence is not: without `service_end_date` no surface can say a
    // feed's service has expired, and an expired schedule reads exactly like a
    // current one.
    expect(GTFS_FEED_VERSION_COLUMNS).toContain("service_end_date");
    expect(GTFS_FEED_VERSION_COLUMNS).toContain("frequency_trip_count");
    // The private-bucket object key is deliberately NOT in a projection a
    // browser receives.
    expect(GTFS_FEED_VERSION_COLUMNS).not.toContain("storage_path");
  });

  it("counts a version as current only when it is BOTH current and ready, and only in this workspace", async () => {
    const response = await GET(listRequest(`workspaceId=${WORKSPACE_ID}`));
    const body = await response.json();

    expect(body.currentVersions.map((version: Row) => version.id)).toEqual([OWN_VERSION_ID]);

    const currentRead = rlsQueries("gtfs_feed_versions")[0];
    expect(hasFilter(currentRead, "workspace_id", WORKSPACE_ID)).toBe(true);
    expect(hasFilter(currentRead, "is_current", true)).toBe(true);
    expect(hasFilter(currentRead, "status", "ready")).toBe(true);
  });

  it("qualifies each adopted feed's numbers, keyed by the feed the version belongs to", async () => {
    const response = await GET(listRequest(`workspaceId=${WORKSPACE_ID}`));
    const body = await response.json();

    expect(Object.keys(body.caveatsByFeedId)).toEqual([OWN_FEED_ID]);
    expect(body.caveatsByFeedId[OWN_FEED_ID]).toContain(GTFS_NOT_A_TIMETABLE_CAVEAT);
    // The seeded current version has 12 frequency-based trips, so the caveat
    // that explains what that means travels with it.
    expect(body.caveatsByFeedId[OWN_FEED_ID]).toContain(GTFS_FREQUENCIES_EXPANSION_CAVEAT);
  });

  it("reports a failed read as a failure, never as a workspace with no feeds", async () => {
    tableFailures.gtfs_feeds = { message: "connection terminated unexpectedly" };

    const response = await GET(listRequest(`workspaceId=${WORKSPACE_ID}`));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.hint).toBe("This is a read failure, not an empty result.");
  });

  it("says the migrations are missing rather than reporting no transit feeds", async () => {
    tableFailures.gtfs_feed_versions = {
      message: 'relation "public.gtfs_feed_versions" does not exist',
    };

    const response = await GET(listRequest(`workspaceId=${WORKSPACE_ID}`));

    expect(response.status).toBe(503);
  });
});

/* -------------------------------------------------------------------------- */
/* POST — registering a source                                                  */
/* -------------------------------------------------------------------------- */

describe("POST /api/gtfs/feeds", () => {
  it("refuses an unrecognised body key rather than ingesting the rest of it", async () => {
    const response = await POST(
      createRequest({
        source: "url",
        workspaceId: WORKSPACE_ID,
        url: SOURCE_URL,
        feedId: OWN_FEED_ID,
      })
    );

    expect(response.status).toBe(400);
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
  });

  it("refuses a URL supplied beside a catalog id", async () => {
    // The provenance columns exist so a planner can trust where a number came
    // from. Accepting an address next to a catalog id would let a caller label
    // an arbitrary download "Sacramento Regional Transit, from the Mobility
    // Database" — the one thing the catalog branch is built to prevent.
    const response = await POST(
      createRequest({
        source: "catalog",
        workspaceId: WORKSPACE_ID,
        catalogId: "mdb-1234",
        url: "https://attacker.example/feed.zip",
      })
    );

    expect(response.status).toBe(400);
    expect(resolveGtfsCatalogRedirectMock).not.toHaveBeenCalled();
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer, and ingests nothing", async () => {
    seed("viewer");

    const response = await POST(
      createRequest({ source: "url", workspaceId: WORKSPACE_ID, url: SOURCE_URL })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Viewers have read-only access to this workspace");
    // The refusal has to come BEFORE the work, not after it. An ingest that ran
    // and then reported 403 would have written a version row and downloaded
    // 190 MB on a read-only member's say-so.
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
    expect(serviceQueries("gtfs_feeds")).toHaveLength(0);
  });

  it("tells a non-member the workspace was not found, and never that it is forbidden", async () => {
    const response = await POST(
      createRequest({ source: "url", workspaceId: OTHER_WORKSPACE_ID, url: SOURCE_URL })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(body.error).toBe("Workspace not found");
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
    expect(serviceQueries("gtfs_feeds")).toHaveLength(0);
  });

  it("refuses an address that is not http(s), before anything tries to fetch it", async () => {
    const response = await POST(
      createRequest({ source: "url", workspaceId: WORKSPACE_ID, url: "ftp://transit.example.gov/g.zip" })
    );

    expect(response.status).toBe(400);
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
  });

  it("adds a version to THIS workspace's existing registration of the same source", async () => {
    // The negative control for the test below. Without it, "feedId was null"
    // would be satisfied by a route that never reuses anything at all, and the
    // cross-tenant assertion would prove nothing about the filter.
    const response = await POST(
      createRequest({ source: "url", workspaceId: WORKSPACE_ID, url: SOURCE_URL })
    );

    expect(response.status).toBe(200);
    expect(runGtfsIngestMock).toHaveBeenCalledTimes(1);
    const params = runGtfsIngestMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.feedId).toBe(OWN_FEED_ID);
    // And it keeps the name the planner already gave it rather than renaming
    // their feed to a hostname on every refresh.
    expect(params.provisionalName).toBe("Mountain Area Transit");
  });

  it("never lands a new ingest in another workspace's feed, or in the shared public one", async () => {
    // This workspace has NOT registered the source. Another workspace has, and
    // so has the deployment-wide public row — both with the same normalised
    // URL. Reusing either would write this workspace's parsed service levels
    // into somebody else's feed.
    seed("admin", { includeOwnFeed: false });

    const response = await POST(
      createRequest({ source: "url", workspaceId: WORKSPACE_ID, url: SOURCE_URL })
    );

    expect(response.status).toBe(200);
    const params = runGtfsIngestMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.feedId).toBeNull();
    expect(params.feedId).not.toBe(FOREIGN_FEED_ID);
    expect(params.feedId).not.toBe(PUBLIC_FEED_ID);
    expect(params.workspaceId).toBe(WORKSPACE_ID);
    // The hostname, because nothing in this workspace has named this feed yet.
    expect(params.provisionalName).toBe("transit.example.gov");
  });

  it("scopes the reuse probe by workspace and by the normalised source url", async () => {
    await POST(createRequest({ source: "url", workspaceId: WORKSPACE_ID, url: SOURCE_URL }));

    const probe = serviceQueries("gtfs_feeds")[0];
    expect(probe).toBeDefined();
    // Recorded on the SERVICE-ROLE client, which has no RLS underneath it.
    // This `.eq` is the entire boundary between two tenants' feeds.
    expect(hasFilter(probe, "workspace_id", WORKSPACE_ID)).toBe(true);
    expect(hasFilter(probe, "normalized_source_url", NORMALIZED_SOURCE_URL)).toBe(true);
  });

  it("keys a catalog feed's reuse probe on the catalog id, still inside this workspace", async () => {
    resolveGtfsCatalogRedirectMock.mockResolvedValue({
      status: "live",
      entry: {
        catalogId: "mdb-1234",
        provider: "Mountain Area Transit",
        name: "Mountain Area Transit",
        downloadUrl: SOURCE_URL,
        status: "active",
        boundingBox: null,
      },
      supersededIds: ["mdb-88"],
    });

    const response = await POST(
      createRequest({ source: "catalog", workspaceId: WORKSPACE_ID, catalogId: "mdb-1234" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const probe = serviceQueries("gtfs_feeds")[0];
    expect(hasFilter(probe, "workspace_id", WORKSPACE_ID)).toBe(true);
    expect(hasFilter(probe, "catalog_source_id", "mdb-1234")).toBe(true);
    // The ids walked through to reach today's entry are the answer to "is my
    // saved feed still the right one", so they cross the wire.
    expect(body.supersededCatalogIds).toEqual(["mdb-88"]);
  });

  it("answers 503 when the catalog cannot be read, and never leaks the resolved-address diagnostic", async () => {
    resolveGtfsCatalogRedirectMock.mockResolvedValue({
      status: "catalog_unavailable",
      code: "catalog_unavailable",
      detail: "The catalog did not answer.",
      diagnostic: "refused after resolving to 169.254.169.254",
      catalogUrl: "https://catalog.example/catalog.csv",
    });

    const response = await POST(
      createRequest({ source: "catalog", workspaceId: WORKSPACE_ID, catalogId: "mdb-1234" })
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    // A member who can read a resolved IP can use the feed-URL field as a
    // DNS-mapping oracle for the deployment's private network.
    expect(JSON.stringify(body)).not.toContain("169.254.169.254");
    expect(body).not.toHaveProperty("diagnostic");
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
  });

  it("passes a failed ingest's own status and code through rather than inventing one", async () => {
    runGtfsIngestMock.mockResolvedValue({
      ok: false,
      status: 422,
      code: "archive_too_large",
      detail: "The archive is larger than this deployment accepts.",
      feedId: OWN_FEED_ID,
      versionId: FAILED_VERSION_ID,
      createdFeed: false,
    });

    const response = await POST(
      createRequest({ source: "url", workspaceId: WORKSPACE_ID, url: SOURCE_URL })
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe("archive_too_large");
    // The version row is named so a card can show the attempt that failed
    // instead of silently continuing to display the older one.
    expect(body.versionId).toBe(FAILED_VERSION_ID);
  });

  it("answers 201 only when a feed row was actually created", async () => {
    runGtfsIngestMock.mockResolvedValue(successfulIngest({ createdFeed: true }));

    const response = await POST(
      createRequest({ source: "url", workspaceId: WORKSPACE_ID, url: SOURCE_URL })
    );

    expect(response.status).toBe(201);
  });
});
