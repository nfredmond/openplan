import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * ONE TRANSIT FEED — READING IT, DESTROYING IT, AND REFETCHING IT.
 *
 * ================= WHY THESE THREE DOORS ARE TESTED IN ONE FILE
 *
 * `GET`, `DELETE` and the sibling `POST …/refresh` are the three doors that
 * take a feed id from a request and act on the row it names, and they share a
 * single defence: find the row with `.eq("id", …).eq("workspace_id", …)`, and
 * when that misses, ask whether it is a PUBLIC preloaded feed before answering.
 * Two of the three do it with `createServiceRoleClient()`. Testing them apart
 * would let the two implementations of one rule drift, which is the seam defect
 * this repository keeps paying for — a geofence enforced on one of two
 * submission doors, custody no page could display.
 *
 * ============================== WHY THE FAKE APPLIES THE FILTERS IT RECORDS
 *
 * Under service-role there is no RLS beneath the query. The `.eq()` chain is
 * the access control, entire. A fake that answers with its fixture whatever it
 * was filtered on cannot observe a deleted filter at all — that is exactly how
 * six access-control mutations survived a 36-test suite on 2026-08-05. So the
 * fake here holds rows in tables, APPLIES `.eq()` / `.is()` / `.in()` to them,
 * and RECORDS every one so a test can assert both the effect and the call.
 *
 * ============================================== WHAT THE FIXTURES ARE FOR
 *
 * Three feeds exist: this workspace's, ANOTHER workspace's, and a public
 * preloaded one (`workspace_id IS NULL`) that every tenant on the deployment
 * reads. Deleting that public row would cascade through its versions into both
 * derived service-level tables — for every workspace at once — which is why the
 * refusal is a distinct branch rather than a 404, and why a test exists for the
 * refusal's *content* and not only its status.
 *
 * There is also a version row that names this workspace's feed and ANOTHER
 * workspace's id. Nothing in the product can create one. It is here because a
 * filter no fixture can fail is a filter nobody notices losing.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const authGetUserMock = vi.fn();
const runGtfsIngestMock = vi.fn();
const resolveGtfsCatalogRedirectMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const FEED_ID = "44444444-4444-4444-8444-444444444444";
/** Same shape, another agency. Must be indistinguishable from absent. */
const FOREIGN_FEED_ID = "55555555-5555-4555-8555-555555555555";
/** `workspace_id IS NULL` — readable by everyone, removable by nobody. */
const PUBLIC_FEED_ID = "66666666-6666-4666-8666-666666666666";
/** An id that names no row at all. */
const MISSING_FEED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** This workspace's feed, ingested from an uploaded archive. */
const UPLOADED_FEED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const CURRENT_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const FAILED_VERSION_ID = "88888888-8888-4888-8888-888888888888";
/**
 * A row that should not exist: it names THIS feed and ANOTHER workspace. It is
 * the only shape in which the version reads' `workspace_id` filter is more than
 * decoration.
 */
const MISMATCHED_VERSION_ID = "99999999-9999-4999-8999-999999999999";

const STORED_FEED_URL = "https://transit.example.gov/gtfs.zip";
const NOW = "2026-08-05T00:00:00.000Z";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), requestId: "test" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

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

import { DELETE, GET } from "@/app/api/gtfs/feeds/[feedId]/route";
import { POST as REFRESH } from "@/app/api/gtfs/feeds/[feedId]/refresh/route";
import {
  GTFS_FEED_COLUMNS,
  GTFS_FEED_REFRESH_SOURCE_COLUMNS,
  GTFS_FEED_VERSION_COLUMNS,
  GTFS_FEED_VERSION_TEARDOWN_COLUMNS,
} from "@/lib/gtfs/route-projections";
import { GTFS_UPLOADS_BUCKET } from "@/lib/gtfs/persist";
import { GTFS_NOT_A_TIMETABLE_CAVEAT } from "@/lib/gtfs/caveats";

/* -------------------------------------------------------------------------- */
/* A tiny in-memory PostgREST that both records and applies its filters         */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
type QueryError = { message: string; code?: string } | null;
type Filter = { kind: "eq" | "is" | "in"; column: string; value: unknown };
type ClientKind = "rls" | "service";
type Operation = "select" | "delete";
type Query = {
  client: ClientKind;
  table: string;
  operation: Operation;
  columns: string | null;
  filters: Filter[];
};

/** Storage removals land in the same timeline as the queries, so a test can
 *  assert that the objects went BEFORE the rows that name them. */
const STORAGE_TIMELINE_TABLE = "storage:gtfs-uploads";

let tables: Record<string, Row[]> = {};
let tableFailures: Record<string, QueryError> = {};
let queries: Query[] = [];
let storageRemovals: Array<{ bucket: string; paths: string[] }> = [];
let storageRemoveError: { message: string } | null = null;

const PASSTHROUGH_METHODS = ["order", "limit", "range", "not", "filter", "match"];

function rowMatches(row: Row, filter: Filter): boolean {
  const actual = row[filter.column];
  if (filter.kind === "eq") return actual === filter.value;
  if (filter.kind === "in") {
    return Array.isArray(filter.value) && (filter.value as unknown[]).includes(actual);
  }
  if (filter.value === null) return actual === null || actual === undefined;
  return actual === filter.value;
}

function makeChain(client: ClientKind, table: string) {
  const filters: Filter[] = [];
  let columns: string | null = null;
  let operation: Operation = "select";
  let memo: { data: Row[]; error: QueryError } | null = null;

  function run(): { data: Row[]; error: QueryError } {
    if (memo) return memo;
    queries.push({ client, table, operation, columns, filters: [...filters] });

    const failure = tableFailures[table];
    if (failure) {
      memo = { data: [], error: failure };
      return memo;
    }

    const rows = tables[table] ?? [];
    const matched = rows.filter((row) => filters.every((f) => rowMatches(row, f)));

    if (operation === "delete") {
      tables[table] = rows.filter((row) => !matched.includes(row));
    }

    memo = { data: matched, error: null };
    return memo;
  }

  const chain: Record<string, unknown> = {};

  chain.select = vi.fn((cols: string) => {
    columns = cols;
    return chain;
  });
  chain.delete = vi.fn(() => {
    operation = "delete";
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

function makeStorage() {
  return {
    from: vi.fn((bucket: string) => ({
      remove: vi.fn(async (paths: string[]) => {
        queries.push({
          client: "service",
          table: STORAGE_TIMELINE_TABLE,
          operation: "delete",
          columns: null,
          filters: [],
        });
        storageRemovals.push({ bucket, paths: [...paths] });
        if (storageRemoveError) return { data: null, error: storageRemoveError };
        return { data: paths.map((path) => ({ name: path })), error: null };
      }),
    })),
  };
}

function installClients() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => makeChain("rls", table)),
  });
  createServiceRoleClientMock.mockReturnValue({
    from: vi.fn((table: string) => makeChain("service", table)),
    storage: makeStorage(),
  });
}

function serviceQueries(table: string): Query[] {
  return queries.filter((query) => query.client === "service" && query.table === table);
}

function rlsQueries(table: string): Query[] {
  return queries.filter((query) => query.client === "rls" && query.table === table);
}

function deleteQueries(table: string): Query[] {
  return queries.filter((query) => query.table === table && query.operation === "delete");
}

function hasFilter(query: Query, column: string, value: unknown): boolean {
  return query.filters.some(
    (filter) => filter.column === column && filter.value === value && filter.kind !== "in"
  );
}

function hasIsNullFilter(query: Query, column: string): boolean {
  return query.filters.some(
    (filter) => filter.kind === "is" && filter.column === column && filter.value === null
  );
}

function seed(role = "admin") {
  tables = {
    workspace_members: [{ user_id: USER_ID, workspace_id: WORKSPACE_ID, role }],
    gtfs_feeds: [
      // Foreign and public first, so a read that lost its workspace filter
      // would find one of THEM rather than falling back to the right answer.
      {
        id: FOREIGN_FEED_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        agency_name: "Another agency",
        source_kind: "url",
        feed_url: "https://other.example.gov/gtfs.zip",
        catalog_provider: null,
        catalog_source_id: null,
        status: "ready",
        created_at: NOW,
      },
      {
        id: PUBLIC_FEED_ID,
        workspace_id: null,
        agency_name: "Preloaded statewide feed",
        source_kind: "url",
        feed_url: "https://statewide.example.gov/gtfs.zip",
        catalog_provider: null,
        catalog_source_id: null,
        status: "ready",
        created_at: NOW,
      },
      {
        id: FEED_ID,
        workspace_id: WORKSPACE_ID,
        agency_name: "Mountain Area Transit",
        source_kind: "url",
        feed_url: STORED_FEED_URL,
        catalog_provider: null,
        catalog_source_id: null,
        status: "ready",
        created_at: NOW,
      },
      {
        id: UPLOADED_FEED_ID,
        workspace_id: WORKSPACE_ID,
        agency_name: "Uploaded archive",
        source_kind: "upload",
        feed_url: null,
        catalog_provider: null,
        catalog_source_id: null,
        status: "ready",
        created_at: NOW,
      },
    ],
    gtfs_feed_versions: [
      {
        id: MISMATCHED_VERSION_ID,
        feed_id: FEED_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        status: "ready",
        is_current: true,
        storage_path: "other-workspace/should-never-be-touched.zip",
        route_service_level_rows: 999,
        stop_service_level_rows: 9999,
        frequency_trip_count: 0,
        service_end_date: "2026-12-31",
        created_at: NOW,
      },
      {
        id: CURRENT_VERSION_ID,
        feed_id: FEED_ID,
        workspace_id: WORKSPACE_ID,
        status: "ready",
        is_current: true,
        storage_path: null,
        route_service_level_rows: 31,
        stop_service_level_rows: 402,
        frequency_trip_count: 0,
        service_end_date: "2026-09-30",
        created_at: NOW,
      },
      {
        id: FAILED_VERSION_ID,
        feed_id: FEED_ID,
        workspace_id: WORKSPACE_ID,
        status: "failed",
        is_current: false,
        storage_path: "workspace/failed-attempt.zip",
        route_service_level_rows: 0,
        stop_service_level_rows: 0,
        frequency_trip_count: 0,
        service_end_date: null,
        created_at: NOW,
      },
    ],
  };
}

function detailRequest(feedId: string, query: string) {
  return new NextRequest(`http://localhost/api/gtfs/feeds/${feedId}?${query}`);
}

function deleteRequest(feedId: string, query: string) {
  return new NextRequest(`http://localhost/api/gtfs/feeds/${feedId}?${query}`, {
    method: "DELETE",
  });
}

function refreshRequest(feedId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/gtfs/feeds/${feedId}/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(feedId: string) {
  return { params: Promise.resolve({ feedId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  tables = {};
  tableFailures = {};
  queries = [];
  storageRemovals = [];
  storageRemoveError = null;
  seed();
  installClients();
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  runGtfsIngestMock.mockResolvedValue({
    ok: true,
    feedId: FEED_ID,
    versionId: CURRENT_VERSION_ID,
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
  });
});

/* -------------------------------------------------------------------------- */
/* GET — reading one feed                                                       */
/* -------------------------------------------------------------------------- */

describe("GET /api/gtfs/feeds/[feedId]", () => {
  it("refuses a feed id that is not a uuid", async () => {
    const response = await GET(
      detailRequest("not-a-uuid", `workspaceId=${WORKSPACE_ID}`),
      routeContext("not-a-uuid")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid feed id" });
  });

  it("refuses an unrecognised query parameter rather than ignoring it", async () => {
    const response = await GET(
      detailRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}&includeVersions=all`),
      routeContext(FEED_ID)
    );

    expect(response.status).toBe(400);
  });

  it("answers 401 when nobody is signed in", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(
      detailRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );

    expect(response.status).toBe(401);
  });

  it("tells a non-member the workspace was not found, and reads no feed on their behalf", async () => {
    const response = await GET(
      detailRequest(FEED_ID, `workspaceId=${OTHER_WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(body.error).toBe("Workspace not found");
    expect(rlsQueries("gtfs_feeds")).toHaveLength(0);
  });

  it("reports another workspace's feed as absent, with the workspace filter provably applied", async () => {
    const response = await GET(
      detailRequest(FOREIGN_FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FOREIGN_FEED_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    // 403 would confirm the id names a real feed somewhere on the deployment.
    expect(response.status).not.toBe(403);
    expect(body.error).toBe("Transit feed not found");

    const feedRead = rlsQueries("gtfs_feeds")[0];
    expect(hasFilter(feedRead, "id", FOREIGN_FEED_ID)).toBe(true);
    expect(hasFilter(feedRead, "workspace_id", WORKSPACE_ID)).toBe(true);
  });

  it("does not hand a member the shared preloaded feed through this workspace's door", async () => {
    // WORTH READING RATHER THAN SKIMMING. Today every read in this lane filters
    // `.eq("workspace_id", …)`, which no `workspace_id IS NULL` row can satisfy
    // — so a public preloaded feed is 404 here and absent from the list. That
    // is the SAFE direction and it is what is asserted. It is also a gap worth
    // knowing about: `GTFS_FEED_COLUMNS` projects `workspace_id` specifically so
    // a surface can say "this one is shared", and no route currently returns a
    // row for which that distinction could be drawn. If a public-feed read is
    // ever added it belongs in its own branch, not by loosening this filter.
    const response = await GET(
      detailRequest(PUBLIC_FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(PUBLIC_FEED_ID)
    );

    expect(response.status).toBe(404);
  });

  it("asks the database for the columns it hands back, by the exported name", async () => {
    await GET(detailRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`), routeContext(FEED_ID));

    expect(rlsQueries("gtfs_feeds")[0].columns).toBe(GTFS_FEED_COLUMNS);
    // The count first: a loop over an empty list asserts nothing, and the
    // detail read asks for versions twice — the adopted one, and the history.
    expect(rlsQueries("gtfs_feed_versions")).toHaveLength(2);
    for (const query of rlsQueries("gtfs_feed_versions")) {
      expect(query.columns).toBe(GTFS_FEED_VERSION_COLUMNS);
    }
    // Without this column nothing can say a feed's service window has ended,
    // and an expired schedule renders identically to a current one.
    expect(GTFS_FEED_VERSION_COLUMNS).toContain("service_end_date");
  });

  it("scopes every version read by feed AND by workspace", async () => {
    const response = await GET(
      detailRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );
    const body = await response.json();

    // The mismatched row names this feed and another workspace. It must appear
    // in neither answer.
    expect(body.currentVersion.id).toBe(CURRENT_VERSION_ID);
    expect(body.versions.map((version: Row) => version.id)).toEqual([
      CURRENT_VERSION_ID,
      FAILED_VERSION_ID,
    ]);

    expect(rlsQueries("gtfs_feed_versions")).toHaveLength(2);
    for (const query of rlsQueries("gtfs_feed_versions")) {
      expect(hasFilter(query, "feed_id", FEED_ID)).toBe(true);
      expect(hasFilter(query, "workspace_id", WORKSPACE_ID)).toBe(true);
    }
  });

  it("treats a version as current only when it is both current and ready", async () => {
    await GET(detailRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`), routeContext(FEED_ID));

    const currentRead = rlsQueries("gtfs_feed_versions")[0];
    expect(hasFilter(currentRead, "is_current", true)).toBe(true);
    expect(hasFilter(currentRead, "status", "ready")).toBe(true);
  });

  it("qualifies the numbers when something is adopted, and says nothing when nothing is", async () => {
    const adopted = await GET(
      detailRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );
    expect((await adopted.json()).caveats).toContain(GTFS_NOT_A_TIMETABLE_CAVEAT);

    // A feed with no ready, current version qualifies nothing — a caveat list
    // about a feed nobody is analysing with would qualify numbers nobody is
    // looking at.
    queries = [];
    const notAdopted = await GET(
      detailRequest(UPLOADED_FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(UPLOADED_FEED_ID)
    );
    const body = await notAdopted.json();
    expect(body.currentVersion).toBeNull();
    expect(body.caveats).toEqual([]);
  });

  it("reports a failed read as a failure, never as a feed with no ingests", async () => {
    tableFailures.gtfs_feed_versions = { message: "connection terminated unexpectedly" };

    const response = await GET(
      detailRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );

    expect(response.status).toBe(500);
    expect((await response.json()).hint).toBe("This is a read failure, not an empty result.");
  });
});

/* -------------------------------------------------------------------------- */
/* DELETE — destroying one feed                                                 */
/* -------------------------------------------------------------------------- */

describe("DELETE /api/gtfs/feeds/[feedId]", () => {
  it("refuses a viewer, and destroys nothing", async () => {
    seed("viewer");

    const response = await DELETE(
      deleteRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Viewers have read-only access to this workspace");
    expect(deleteQueries("gtfs_feeds")).toHaveLength(0);
    expect(storageRemovals).toHaveLength(0);
    // The service-role client is never even reached for a read-only member.
    expect(serviceQueries("gtfs_feeds")).toHaveLength(0);
  });

  it("tells a non-member the workspace was not found, and destroys nothing", async () => {
    const response = await DELETE(
      deleteRequest(FEED_ID, `workspaceId=${OTHER_WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace not found" });
    expect(deleteQueries("gtfs_feeds")).toHaveLength(0);
  });

  it("reports another workspace's feed as absent rather than forbidden, and destroys nothing", async () => {
    const response = await DELETE(
      deleteRequest(FOREIGN_FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FOREIGN_FEED_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Transit feed not found");
    // The refusal must not distinguish "another tenant's feed" from "no such
    // feed": the public probe found nothing either, and both answer 404.
    expect(deleteQueries("gtfs_feeds")).toHaveLength(0);
    expect(storageRemovals).toHaveLength(0);

    const target = serviceQueries("gtfs_feeds")[0];
    expect(hasFilter(target, "id", FOREIGN_FEED_ID)).toBe(true);
    expect(hasFilter(target, "workspace_id", WORKSPACE_ID)).toBe(true);
  });

  it("answers a missing id and another tenant's id with the same sentence", async () => {
    const missing = await DELETE(
      deleteRequest(MISSING_FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(MISSING_FEED_ID)
    );
    const foreign = await DELETE(
      deleteRequest(FOREIGN_FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FOREIGN_FEED_ID)
    );

    expect(missing.status).toBe(foreign.status);
    expect(await missing.json()).toEqual(await foreign.json());
  });

  it("refuses to remove the shared preloaded feed, and says why instead of denying it exists", async () => {
    const response = await DELETE(
      deleteRequest(PUBLIC_FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(PUBLIC_FEED_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe(
      "This is a shared preloaded feed and cannot be removed by a workspace"
    );
    // Deleting it would cascade through its versions into both derived tables
    // for EVERY workspace on the deployment. Nothing may be destroyed here.
    expect(deleteQueries("gtfs_feeds")).toHaveLength(0);
    expect(storageRemovals).toHaveLength(0);

    // The probe that found it looked the feed up AS a public feed. Recorded,
    // because a probe written as `.eq("workspace_id", null)` matches nothing in
    // PostgREST and would silently turn this refusal into a 404.
    const publicProbe = serviceQueries("gtfs_feeds")[1];
    expect(publicProbe).toBeDefined();
    expect(hasFilter(publicProbe, "id", PUBLIC_FEED_ID)).toBe(true);
    expect(hasIsNullFilter(publicProbe, "workspace_id")).toBe(true);
  });

  it("removes this workspace's feed, scoped by id AND workspace on the delete itself", async () => {
    const response = await DELETE(
      deleteRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);

    const removal = deleteQueries("gtfs_feeds")[0];
    expect(removal).toBeDefined();
    expect(hasFilter(removal, "id", FEED_ID)).toBe(true);
    // The delete re-states the workspace even though the row was just read
    // through it. Under service-role that repetition is the only thing standing
    // between this request and another tenant's row.
    expect(hasFilter(removal, "workspace_id", WORKSPACE_ID)).toBe(true);

    // Nothing else went with it.
    expect((tables.gtfs_feeds ?? []).map((feed) => feed.id)).toEqual([
      FOREIGN_FEED_ID,
      PUBLIC_FEED_ID,
      UPLOADED_FEED_ID,
    ]);
  });

  it("counts what it destroyed from this workspace's version rows only", async () => {
    const response = await DELETE(
      deleteRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );
    const body = await response.json();

    // Two versions, 31 + 0 route rows and 402 + 0 stop rows. The mismatched row
    // carries 999 / 9999 and belongs to another workspace: if it were counted,
    // the sentence a planner reads would describe destroying rows this delete
    // did not touch.
    expect(body.versionsDeleted).toBe(2);
    expect(body.routeServiceLevelRows).toBe(31);
    expect(body.stopServiceLevelRows).toBe(402);
    expect(body.detail).toContain("Those service levels are gone");

    const teardown = serviceQueries("gtfs_feed_versions")[0];
    expect(teardown.columns).toBe(GTFS_FEED_VERSION_TEARDOWN_COLUMNS);
    expect(hasFilter(teardown, "feed_id", FEED_ID)).toBe(true);
    expect(hasFilter(teardown, "workspace_id", WORKSPACE_ID)).toBe(true);
  });

  it("removes the stored objects BEFORE the rows that know where they are", async () => {
    const response = await DELETE(
      deleteRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );
    const body = await response.json();

    expect(storageRemovals).toEqual([
      { bucket: GTFS_UPLOADS_BUCKET, paths: ["workspace/failed-attempt.zip"] },
    ]);
    expect(body.storageObjectsRemoved).toBe(1);

    // A row is the only thing that knows where an object is, so deleting rows
    // first strands the objects in a private bucket with nothing able to name
    // them again. Asserted as an ORDER on one timeline rather than as two
    // independent facts.
    const storageAt = queries.findIndex((query) => query.table === STORAGE_TIMELINE_TABLE);
    const rowsAt = queries.findIndex(
      (query) => query.table === "gtfs_feeds" && query.operation === "delete"
    );
    expect(storageAt).toBeGreaterThanOrEqual(0);
    expect(rowsAt).toBeGreaterThanOrEqual(0);
    expect(storageAt).toBeLessThan(rowsAt);

    // And the object belonging to another workspace's version row was never
    // handed to the bucket.
    expect(storageRemovals[0].paths).not.toContain(
      "other-workspace/should-never-be-touched.zip"
    );
  });

  it("still removes the feed when the objects could not be deleted", async () => {
    storageRemoveError = { message: "bucket unavailable" };

    const response = await DELETE(
      deleteRequest(FEED_ID, `workspaceId=${WORKSPACE_ID}`),
      routeContext(FEED_ID)
    );
    const body = await response.json();

    // An orphaned object is housekeeping. A feed a planner asked to remove and
    // which is still there is a broken promise.
    expect(response.status).toBe(200);
    expect(body.storageObjectsRemoved).toBe(0);
    expect(deleteQueries("gtfs_feeds")).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* POST …/refresh — refetching one feed                                         */
/* -------------------------------------------------------------------------- */

describe("POST /api/gtfs/feeds/[feedId]/refresh", () => {
  it("refuses a viewer, and fetches nothing", async () => {
    seed("viewer");

    const response = await REFRESH(
      refreshRequest(FEED_ID, { workspaceId: WORKSPACE_ID }),
      routeContext(FEED_ID)
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Viewers have read-only access to this workspace",
    });
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
    expect(serviceQueries("gtfs_feeds")).toHaveLength(0);
  });

  it("tells a non-member the workspace was not found, and fetches nothing", async () => {
    const response = await REFRESH(
      refreshRequest(FEED_ID, { workspaceId: OTHER_WORKSPACE_ID }),
      routeContext(FEED_ID)
    );

    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
  });

  it("reports another workspace's feed as absent, and fetches nothing", async () => {
    const response = await REFRESH(
      refreshRequest(FOREIGN_FEED_ID, { workspaceId: WORKSPACE_ID }),
      routeContext(FOREIGN_FEED_ID)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Transit feed not found" });
    expect(runGtfsIngestMock).not.toHaveBeenCalled();

    const target = serviceQueries("gtfs_feeds")[0];
    expect(hasFilter(target, "id", FOREIGN_FEED_ID)).toBe(true);
    expect(hasFilter(target, "workspace_id", WORKSPACE_ID)).toBe(true);
  });

  it("refuses to refresh the shared preloaded feed, and fetches nothing", async () => {
    const response = await REFRESH(
      refreshRequest(PUBLIC_FEED_ID, { workspaceId: WORKSPACE_ID }),
      routeContext(PUBLIC_FEED_ID)
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe(
      "This is a shared preloaded feed and cannot be refreshed by a workspace"
    );
    // A refresh writes a version and can move `current_version_id`, which would
    // change what every other tenant on this deployment analyses with.
    expect(runGtfsIngestMock).not.toHaveBeenCalled();

    const publicProbe = serviceQueries("gtfs_feeds")[1];
    expect(hasFilter(publicProbe, "id", PUBLIC_FEED_ID)).toBe(true);
    expect(hasIsNullFilter(publicProbe, "workspace_id")).toBe(true);
  });

  it("refuses a body carrying an address, so a feed cannot be repointed by a refresh", async () => {
    const response = await REFRESH(
      refreshRequest(FEED_ID, {
        workspaceId: WORKSPACE_ID,
        url: "https://attacker.example/feed.zip",
      }),
      routeContext(FEED_ID)
    );

    expect(response.status).toBe(400);
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
  });

  it("takes the address off the stored row, through the narrow projection", async () => {
    await REFRESH(refreshRequest(FEED_ID, { workspaceId: WORKSPACE_ID }), routeContext(FEED_ID));

    const source = serviceQueries("gtfs_feeds")[0];
    // The projection is the mechanism, not the intention: a route holding only
    // these columns has no caller-supplied address available to prefer.
    expect(source.columns).toBe(GTFS_FEED_REFRESH_SOURCE_COLUMNS);
    expect(GTFS_FEED_REFRESH_SOURCE_COLUMNS).toContain("feed_url");

    expect(runGtfsIngestMock).toHaveBeenCalledTimes(1);
    const params = runGtfsIngestMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.feedId).toBe(FEED_ID);
    expect(params.workspaceId).toBe(WORKSPACE_ID);
    expect(params.source).toEqual({ kind: "url", downloadUrl: STORED_FEED_URL });
    expect(params.provisionalName).toBe("Mountain Area Transit");
  });

  it("says an uploaded feed has no address to refresh from", async () => {
    const response = await REFRESH(
      refreshRequest(UPLOADED_FEED_ID, { workspaceId: WORKSPACE_ID }),
      routeContext(UPLOADED_FEED_ID)
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "An uploaded feed cannot be refreshed",
    });
    expect(runGtfsIngestMock).not.toHaveBeenCalled();
  });

  it("answers 200 when a refetch succeeded but was not adopted", async () => {
    runGtfsIngestMock.mockResolvedValue({
      ok: true,
      feedId: FEED_ID,
      versionId: CURRENT_VERSION_ID,
      createdFeed: false,
      adoption: { adopted: false, reason: "collapse", previousRouteCount: 31, routeCount: 4 },
      displayName: "Mountain Area Transit",
      routeServiceLevelRows: 4,
      stopServiceLevelRows: 40,
      droppedForMissingCoordinates: 0,
      warnings: [],
      caveats: [],
      checksumSha256: "b".repeat(64),
      byteSize: 1_000,
    });

    const response = await REFRESH(
      refreshRequest(FEED_ID, { workspaceId: WORKSPACE_ID }),
      routeContext(FEED_ID)
    );
    const body = await response.json();

    // The refetch is what succeeded. Whether it replaced the feed in use is a
    // fact the body states, not a status code — answering 4xx would tell a
    // planner their agency's feed is broken when it is not.
    expect(response.status).toBe(200);
    expect(body.adoption.adopted).toBe(false);
    expect(body.adoption.reason).toBe("collapse");
  });
});
