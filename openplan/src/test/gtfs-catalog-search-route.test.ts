import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * WHAT TRANSIT SERVES THIS AREA — the four answers, kept four.
 *
 * ============================ THE THING THIS ROUTE CAN GET WRONG SILENTLY
 *
 * `findGtfsFeedsForArea` answers with a discriminated union of four statuses,
 * and three of them mean completely different things to a planner:
 *
 *   no_covering_feed     a statement about the WORLD — the catalog lists
 *                        nothing whose service area contains this place. The
 *                        only branch a planner may quote in a document.
 *   covered_but_unusable feeds DO serve this place; every one was withheld.
 *   catalog_unavailable  this deployment could not read the catalog. An
 *                        UNKNOWN, and evidence about nowhere.
 *
 * Collapse any two and a planner in a city with three transit agencies, all
 * behind API keys, is told their community has no transit. The library defends
 * that by construction — three of the four branches carry no `feeds` field at
 * all, so `feeds?.length === 0` cannot compile as a way to flatten them — but
 * that property only survives if the STATUS crosses the wire. Nothing in a
 * green unit test of the library proves the route forwards it, which is what
 * these tests are for.
 *
 * ========================== AND THE FIELD THAT MUST NEVER CROSS THE WIRE
 *
 * `catalog_unavailable` may carry a `diagnostic`: the refusal with the resolved
 * IP address left in. A member who can read that can use the feed-URL field as
 * a DNS-mapping oracle for the deployment's private network. The route
 * assembles its response field-by-field rather than spreading the outcome so a
 * new field on the library type cannot leak by default — so one test below
 * seeds an unknown extra field and asserts the response's key set exactly,
 * because "the diagnostic is absent" would still pass a route that spread
 * everything except the one field the test knew to look for.
 *
 * =============================================== WHY THE MEMBERSHIP FAKE
 *
 * This route makes exactly one database query — the membership check — and it
 * decides everything: 404 vs 503 vs 500 vs answering at all. The fake records
 * and applies its filters for the same reason the other GTFS route tests do: a
 * membership read missing `.eq("user_id", …)` would hand any signed-in user any
 * workspace's search, and a fake that returns its fixture whatever it was asked
 * could not see that.
 */

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const findGtfsFeedsForAreaMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const CATALOG_URL = "https://catalog.example/catalog.csv";
/** A private-network address. If this string reaches a client, that is the bug. */
const RESOLVED_PRIVATE_ADDRESS = "169.254.169.254";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), requestId: "test" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

vi.mock("@/lib/gtfs/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gtfs/catalog")>();
  return {
    ...actual,
    findGtfsFeedsForArea: (...args: unknown[]) => findGtfsFeedsForAreaMock(...args),
  };
});

import { GET } from "@/app/api/gtfs/catalog/search/route";

/* -------------------------------------------------------------------------- */
/* A membership fake that records and applies its filters                       */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
type QueryError = { message: string; code?: string } | null;
type Filter = { column: string; value: unknown };
type Query = { table: string; columns: string | null; filters: Filter[] };

let tables: Record<string, Row[]> = {};
let tableFailures: Record<string, QueryError> = {};
let queries: Query[] = [];

function makeChain(table: string) {
  const filters: Filter[] = [];
  let columns: string | null = null;

  function run(): { data: Row[]; error: QueryError } {
    queries.push({ table, columns, filters: [...filters] });
    const failure = tableFailures[table];
    if (failure) return { data: [], error: failure };
    const rows = tables[table] ?? [];
    return {
      data: rows.filter((row) => filters.every((filter) => row[filter.column] === filter.value)),
      error: null,
    };
  }

  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((cols: string) => {
    columns = cols;
    return chain;
  });
  chain.eq = vi.fn((column: string, value: unknown) => {
    filters.push({ column, value });
    return chain;
  });
  chain.maybeSingle = vi.fn(async () => {
    const result = run();
    if (result.error) return { data: null, error: result.error };
    return { data: result.data[0] ?? null, error: null };
  });
  return chain;
}

function installClient() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => makeChain(table)),
  });
}

function seed(role = "admin") {
  tables = {
    workspace_members: [
      // Another workspace's membership row for the SAME user is not seeded, and
      // another user's membership in THIS workspace is — so a read that lost
      // either filter would find a row and answer 200.
      { user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", workspace_id: WORKSPACE_ID, role: "owner" },
      { user_id: USER_ID, workspace_id: WORKSPACE_ID, role },
    ],
  };
}

/** A bounding box somewhere. Deliberately not a real place — see rule 0. */
const AREA = { minLon: -121.2, minLat: 39.1, maxLon: -120.9, maxLat: 39.4 };

function searchRequest(overrides: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({
    workspaceId: WORKSPACE_ID,
    minLon: String(AREA.minLon),
    minLat: String(AREA.minLat),
    maxLon: String(AREA.maxLon),
    maxLat: String(AREA.maxLat),
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  return new NextRequest(`http://localhost/api/gtfs/catalog/search?${params.toString()}`);
}

const DISCLOSURE = {
  staticEntriesConsidered: 1173,
  realtimeEntriesIgnored: 402,
  unrecognisedDataTypeRows: 0,
  unreadableRows: 2,
  duplicateIds: 1,
  supersededOrInactive: 244,
  supersededOrInactiveCoveringArea: 1,
  supersededOrInactiveCoveringAreaEntries: [],
  requiringApiKey: 9,
  requiringApiKeyEntries: [],
  entriesWithNoPublishedServiceAreaAnywhere: 88,
  withoutDownloadUrl: 0,
  withoutDownloadUrlEntries: [],
};

const RANKED_FEED = {
  entry: {
    catalogId: "mdb-1234",
    provider: "Mountain Area Transit",
    name: "Mountain Area Transit",
    downloadUrl: "https://transit.example.gov/gtfs.zip",
    status: "active",
  },
  serviceAreaSpread: 0.4,
  focusOffsetDegrees: 0.02,
};

beforeEach(() => {
  vi.clearAllMocks();
  tables = {};
  tableFailures = {};
  queries = [];
  seed();
  installClient();
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  findGtfsFeedsForAreaMock.mockResolvedValue({
    status: "matched",
    feeds: [RANKED_FEED],
    disclosure: DISCLOSURE,
    catalogUrl: CATALOG_URL,
  });
});

/* -------------------------------------------------------------------------- */
/* The doorway                                                                  */
/* -------------------------------------------------------------------------- */

describe("GET /api/gtfs/catalog/search — who may ask", () => {
  it("refuses an unrecognised query parameter rather than ignoring it", async () => {
    // A dropped parameter is worse than a rejected one: `&state=CA` reads as a
    // filter, and a schema that ignores it returns a nationwide answer the
    // caller believes was narrowed.
    const response = await GET(searchRequest({ state: "CA" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid catalog search parameters",
    });
    expect(findGtfsFeedsForAreaMock).not.toHaveBeenCalled();
  });

  it("refuses a bounding box whose minimums exceed its maximums", async () => {
    const response = await GET(searchRequest({ minLon: "-100", maxLon: "-121" }));

    expect(response.status).toBe(400);
    expect(findGtfsFeedsForAreaMock).not.toHaveBeenCalled();
  });

  it("refuses half a focus point", async () => {
    const response = await GET(searchRequest({ focusLon: "-121.05" }));

    expect(response.status).toBe(400);
    expect(findGtfsFeedsForAreaMock).not.toHaveBeenCalled();
  });

  it("answers 401 when nobody is signed in", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(searchRequest());

    expect(response.status).toBe(401);
    expect(findGtfsFeedsForAreaMock).not.toHaveBeenCalled();
  });

  it("tells a non-member the workspace was not found, and never that it is forbidden", async () => {
    const response = await GET(searchRequest({ workspaceId: OTHER_WORKSPACE_ID }));
    const body = await response.json();

    // 403 would confirm the workspace id names something real.
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
    expect(body.error).toBe("Workspace not found");
    expect(findGtfsFeedsForAreaMock).not.toHaveBeenCalled();
  });

  it("scopes the membership check to this user AND this workspace", async () => {
    await GET(searchRequest());

    const membership = queries.find((query) => query.table === "workspace_members");
    expect(membership).toBeDefined();
    expect(membership?.filters).toContainEqual({ column: "workspace_id", value: WORKSPACE_ID });
    expect(membership?.filters).toContainEqual({ column: "user_id", value: USER_ID });
  });

  it("lets a VIEWER search, because reading a public catalog changes nothing", async () => {
    seed("viewer");

    const response = await GET(searchRequest());

    // Deliberately no role gate here, and the inverse of every other GTFS
    // door: the read-only tier is exactly the person who should be able to see
    // which agencies publish feeds for the area they are studying. If a role
    // gate is ever added to this route, this test is the argument against it.
    expect(response.status).toBe(200);
    expect(findGtfsFeedsForAreaMock).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an unapplied migration from a missing workspace", async () => {
    tableFailures.workspace_members = {
      message: 'relation "public.workspace_members" does not exist',
    };

    const response = await GET(searchRequest());

    expect(response.status).toBe(503);
    expect(findGtfsFeedsForAreaMock).not.toHaveBeenCalled();
  });

  it("reports a failed membership read as a failure, not as a missing workspace", async () => {
    tableFailures.workspace_members = { message: "connection terminated unexpectedly" };

    const response = await GET(searchRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "Failed to verify workspace membership",
    });
    expect(findGtfsFeedsForAreaMock).not.toHaveBeenCalled();
  });

  it("passes the area through, and a focus point only when both halves are given", async () => {
    await GET(searchRequest());
    expect(findGtfsFeedsForAreaMock.mock.calls[0][0]).toEqual({ bbox: AREA });

    findGtfsFeedsForAreaMock.mockClear();
    await GET(searchRequest({ focusLon: "-121.05", focusLat: "39.22" }));
    expect(findGtfsFeedsForAreaMock.mock.calls[0][0]).toEqual({
      bbox: AREA,
      focus: { lon: -121.05, lat: 39.22 },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The four answers                                                             */
/* -------------------------------------------------------------------------- */

describe("GET /api/gtfs/catalog/search — the four answers stay four", () => {
  it("returns feeds when the catalog covers this area", async () => {
    const response = await GET(searchRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("matched");
    expect(body.feeds).toHaveLength(1);
    expect(body.feeds[0].entry.catalogId).toBe("mdb-1234");
    expect(body.disclosure).toEqual(DISCLOSURE);
    expect(body.catalogUrl).toBe(CATALOG_URL);
    // The branch carries no `withheld`, so a surface cannot read one answer's
    // shape into another's.
    expect(body).not.toHaveProperty("withheld");
  });

  it("names the agencies it withheld rather than returning an empty list", async () => {
    findGtfsFeedsForAreaMock.mockResolvedValue({
      status: "covered_but_unusable",
      withheld: [
        { entry: { ...RANKED_FEED.entry, downloadUrl: null }, reason: "requires_api_key" },
      ],
      disclosure: DISCLOSURE,
      catalogUrl: CATALOG_URL,
    });

    const response = await GET(searchRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("covered_but_unusable");
    expect(body.withheld[0].reason).toBe("requires_api_key");
    // NO `feeds` field, in either direction. A response carrying `feeds: []`
    // here is the exact misreport this status was split out to prevent: a
    // planner in a city with buses running past the window, told there are
    // none.
    expect(body).not.toHaveProperty("feeds");
  });

  it("says nothing covers this area only when nothing does", async () => {
    findGtfsFeedsForAreaMock.mockResolvedValue({
      status: "no_covering_feed",
      disclosure: DISCLOSURE,
      catalogUrl: CATALOG_URL,
    });

    const response = await GET(searchRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("no_covering_feed");
    expect(body).not.toHaveProperty("feeds");
    expect(body).not.toHaveProperty("withheld");
    // The disclosure travels with the statement, because "nothing covers you"
    // means something different when 88 entries publish no service area at all.
    expect(body.disclosure.entriesWithNoPublishedServiceAreaAnywhere).toBe(88);
  });

  it("reports an unreadable catalog as an unknown, with its own status code", async () => {
    findGtfsFeedsForAreaMock.mockResolvedValue({
      status: "catalog_unavailable",
      code: "catalog_unavailable",
      detail: "The catalog did not answer within the time allowed.",
      catalogUrl: CATALOG_URL,
    });

    const response = await GET(searchRequest());
    const body = await response.json();

    // 503, not a 200 with nothing in it. A failed download reported as an
    // absence of buses is evidence about nowhere presented as evidence about
    // somewhere.
    expect(response.status).toBe(503);
    expect(body.status).toBe("catalog_unavailable");
    expect(body.code).toBe("catalog_unavailable");
    expect(body).not.toHaveProperty("feeds");
    expect(body).not.toHaveProperty("withheld");
  });

  it("keeps all four answers distinguishable from one another", async () => {
    // The property that matters is not any single body but that no two of the
    // four arrive looking alike. A route that flattened two of them would pass
    // every test above that it still satisfied, and fail this one.
    const outcomes = [
      { status: "matched", feeds: [RANKED_FEED], disclosure: DISCLOSURE, catalogUrl: CATALOG_URL },
      {
        status: "covered_but_unusable",
        withheld: [{ entry: RANKED_FEED.entry, reason: "superseded" }],
        disclosure: DISCLOSURE,
        catalogUrl: CATALOG_URL,
      },
      { status: "no_covering_feed", disclosure: DISCLOSURE, catalogUrl: CATALOG_URL },
      {
        status: "catalog_unavailable",
        code: "catalog_unavailable",
        detail: "unreadable",
        catalogUrl: CATALOG_URL,
      },
    ];

    const seen: string[] = [];
    for (const outcome of outcomes) {
      findGtfsFeedsForAreaMock.mockResolvedValue(outcome);
      const response = await GET(searchRequest());
      seen.push(`${response.status}:${(await response.json()).status}`);
    }

    expect(new Set(seen).size).toBe(4);
    expect(seen).toEqual([
      "200:matched",
      "200:covered_but_unusable",
      "200:no_covering_feed",
      "503:catalog_unavailable",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* The diagnostic                                                               */
/* -------------------------------------------------------------------------- */

describe("GET /api/gtfs/catalog/search — the diagnostic goes to the log and no further", () => {
  it("never returns the resolved-address diagnostic to a client", async () => {
    findGtfsFeedsForAreaMock.mockResolvedValue({
      status: "catalog_unavailable",
      code: "catalog_unavailable",
      detail: "The catalog address was refused.",
      diagnostic: `refused after resolving to ${RESOLVED_PRIVATE_ADDRESS}`,
      catalogUrl: CATALOG_URL,
    });

    const response = await GET(searchRequest());
    const body = await response.json();

    expect(body).not.toHaveProperty("diagnostic");
    // Asserted against the serialised body as well, because a diagnostic
    // nested inside some future envelope would still be readable by whoever
    // receives it.
    expect(JSON.stringify(body)).not.toContain(RESOLVED_PRIVATE_ADDRESS);
    // It is not discarded either — an operator needs it to find the failure.
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "gtfs_catalog_unavailable",
      expect.objectContaining({ diagnostic: `refused after resolving to ${RESOLVED_PRIVATE_ADDRESS}` })
    );
  });

  it("assembles each answer field-by-field, so a new library field cannot leak by default", async () => {
    // The stronger form of the test above. "The diagnostic is absent" would
    // still pass a route that spread the whole outcome and deleted one known
    // key; asserting the key set exactly is what makes `...outcome` fail.
    findGtfsFeedsForAreaMock.mockResolvedValue({
      status: "matched",
      feeds: [RANKED_FEED],
      disclosure: DISCLOSURE,
      catalogUrl: CATALOG_URL,
      diagnostic: `resolved to ${RESOLVED_PRIVATE_ADDRESS}`,
      internalUpstreamToken: "never-for-a-client",
    });

    const response = await GET(searchRequest());
    const body = await response.json();

    expect(Object.keys(body).sort()).toEqual(["catalogUrl", "disclosure", "feeds", "status"]);
    expect(JSON.stringify(body)).not.toContain(RESOLVED_PRIVATE_ADDRESS);
    expect(JSON.stringify(body)).not.toContain("never-for-a-client");
  });

  it("keeps the withheld branch's key set closed too", async () => {
    findGtfsFeedsForAreaMock.mockResolvedValue({
      status: "covered_but_unusable",
      withheld: [{ entry: RANKED_FEED.entry, reason: "no_download_url" }],
      disclosure: DISCLOSURE,
      catalogUrl: CATALOG_URL,
      internalUpstreamToken: "never-for-a-client",
    });

    const response = await GET(searchRequest());
    const body = await response.json();

    expect(Object.keys(body).sort()).toEqual([
      "catalogUrl",
      "disclosure",
      "status",
      "withheld",
    ]);
  });
});
