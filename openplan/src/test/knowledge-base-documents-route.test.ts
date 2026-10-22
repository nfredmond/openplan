import { beforeEach, describe, expect, it, vi } from "vitest";

// The workspace storage limit (storage-quota.ts). Room by default; a test that
// is about the limit sets the answer and checks what the route asked.
const checkWorkspaceStorageRoomMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspaces/storage-quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaces/storage-quota")>()),
  checkWorkspaceStorageRoom: (...args: unknown[]) =>
    checkWorkspaceStorageRoomMock(...args) ?? Promise.resolve({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 }),
}));
// Every test starts from the default (room), whatever ran before it.
beforeEach(() => checkWorkspaceStorageRoomMock.mockReset());
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const auditInfo = vi.fn();
const auditWarn = vi.fn();
const auditError = vi.fn();
/** Every `.eq(column, value)` applied to the kb_documents list builder. */
const kbListEqCalls: Array<[string, unknown]> = [];
/**
 * The rest of what the list read narrowed by. Recorded separately because these
 * are the filters that make a document PAST THE LIST CAP findable: a name filter
 * that never reaches the database leaves exactly those documents unreachable,
 * and the response looks identical either way.
 */
const kbListOrCalls: string[] = [];
const kbListRangeCalls: Array<[string, string, unknown]> = [];
const kbListOrderCalls: Array<[string, boolean | undefined]> = [];
let kbListLimit: number | null = null;
let kbListResponse: { data: unknown[]; error: null | { message: string } } = { data: [], error: null };
/** The workspace row the calendar reads (`time_zone, home_country_code`), and every read of it. */
let workspaceCalendarRow: { time_zone: string | null; home_country_code: string | null } = {
  time_zone: null,
  home_country_code: null,
};
const workspaceCalendarReads: Array<{ columns: string; eq: [string, unknown] }> = [];

/** The checksum dedup probe, addressable on its own so it can be made to fail. */
let dedupResponse: { data: unknown; error: null | { message: string } } = { data: null, error: null };
/** Every `.in(column, values)` the dedup probe applied. */
const dedupInCalls: Array<[string, unknown]> = [];
const dedupEqCalls: Array<[string, unknown]> = [];
const dedupIsCalls: Array<[string, unknown]> = [];
/** Service-role writes the upload performed, in order. */
const serviceInserts: Array<{ table: string; rows: unknown }> = [];
const storageUploads: string[] = [];

/** Awaitable filter-recording builder standing in for the kb_documents list query. */
function kbListBuilder() {
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      kbListEqCalls.push([column, value]);
      return builder;
    },
    or: (clause: string) => {
      kbListOrCalls.push(clause);
      return builder;
    },
    gte: (column: string, value: unknown) => {
      kbListRangeCalls.push(["gte", column, value]);
      return builder;
    },
    lte: (column: string, value: unknown) => {
      kbListRangeCalls.push(["lte", column, value]);
      return builder;
    },
    lt: (column: string, value: unknown) => {
      kbListRangeCalls.push(["lt", column, value]);
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      kbListOrderCalls.push([column, options?.ascending]);
      return builder;
    },
    limit: (value: number) => {
      kbListLimit = value;
      return builder;
    },
    then: (resolve: (value: typeof kbListResponse) => unknown) => resolve(kbListResponse),
  };
  return builder;
}

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: auditInfo, warn: auditWarn, error: auditError }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === "workspace_members") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }),
        };
      }
      if (table === "kb_documents") {
        return kbListBuilder();
      }
      if (table === "workspaces") {
        return {
          select: (columns: string) => ({
            eq: (column: string, value: unknown) => {
              workspaceCalendarReads.push({ columns, eq: [column, value] });
              return { maybeSingle: async () => ({ data: workspaceCalendarRow, error: null }) };
            },
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "p" }, error: null }) }) }),
        }),
      };
    },
  }),
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string) => {
          storageUploads.push(path);
          return { error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
    from: (table: string) => ({
      // The dedup probe: kb_documents filtered by workspace + checksum, with
      // status narrowed by `.in` to the deduplicable outcomes (ready|stored).
      select: () => ({
        eq: function eq(column: string, value: unknown) {
          dedupEqCalls.push([column, value]);
          return this;
        },
        is: function is(column: string, value: unknown) {
          dedupIsCalls.push([column, value]);
          return this;
        },
        in: function inFilter(column: string, values: unknown) {
          dedupInCalls.push([column, values]);
          return { limit: () => ({ maybeSingle: async () => dedupResponse }) };
        },
      }),
      insert: (rows: unknown) => {
        serviceInserts.push({ table, rows });
        return {
          select: () => ({
            single: async () => ({ data: { id: "doc-1", title: "Adopted plan" }, error: null }),
          }),
          // kb_document_chunks is awaited directly, with no projection.
          then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

import { GET, POST } from "@/app/api/knowledge-base/documents/route";

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

function uploadRequest(query: string, headers: Record<string, string>) {
  return new NextRequest(`http://localhost/api/knowledge-base/documents${query}`, {
    method: "POST",
    headers,
    body: "x",
  });
}

/** A plain-text upload that reaches extraction, so the dedup probe is exercised. */
function uploadTextRequest() {
  return uploadRequest(`?workspaceId=${WORKSPACE_ID}&filename=plan.txt`, {
    "content-type": "text/plain",
  });
}

describe("POST /api/knowledge-base/documents guards", () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
  });

  it("400 when workspaceId is missing", async () => {
    const res = await POST(uploadRequest("", { "content-type": "application/pdf" }));
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await POST(
      uploadRequest(`?workspaceId=${WORKSPACE_ID}`, { "content-type": "application/pdf" })
    );
    expect(res.status).toBe(401);
  });

  it("404 when the user is not a workspace member", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await POST(
      uploadRequest(`?workspaceId=${WORKSPACE_ID}`, { "content-type": "application/pdf" })
    );
    expect(res.status).toBe(404);
  });

  it("415 for an unsupported document type", async () => {
    const res = await POST(
      uploadRequest(`?workspaceId=${WORKSPACE_ID}`, { "content-type": "image/png" })
    );
    expect(res.status).toBe(415);
  });
});

/**
 * The dedup probe asks whether a byte-identical document was already ingested.
 * It is the one read in this lane that may fail without anything being claimed
 * — nothing in the response says the document is new — so the upload continues.
 * What it may NOT do is fail unobserved: a probe that failed every time would
 * turn dedup off permanently and the only evidence would be this log line.
 */
describe("POST /api/knowledge-base/documents — the checksum dedup probe", () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
    dedupResponse = { data: null, error: null };
    dedupInCalls.length = 0;
    dedupEqCalls.length = 0;
    dedupIsCalls.length = 0;
    serviceInserts.length = 0;
    auditInfo.mockClear();
    auditWarn.mockClear();
    auditError.mockClear();
  });

  it("returns the existing document when the probe finds one", async () => {
    dedupResponse = { data: { id: "doc-existing", title: "Adopted plan" }, error: null };

    const res = await POST(uploadTextRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deduped?: boolean; document: { id: string } };
    expect(body.deduped).toBe(true);
    expect(body.document.id).toBe("doc-existing");
    expect(serviceInserts).toEqual([]);
    // The probe dedupes against BOTH terminal keep-states — ready (parsed) and
    // stored (kept) — and nothing else: failed rows retry via re-upload.
    expect(dedupInCalls).toEqual([["status", ["ready", "stored"]]]);
    expect(dedupIsCalls).toEqual([["project_id", null]]);
    expect(dedupEqCalls).toContainEqual(["workspace_id", WORKSPACE_ID]);
  });

  it("deduplicates project documents only inside that exact project", async () => {
    const projectId = "990e8400-e29b-41d4-a716-446655440000";
    dedupResponse = { data: { id: "doc-project", title: "Project source" }, error: null };

    const res = await POST(
      uploadRequest(`?workspaceId=${WORKSPACE_ID}&projectId=${projectId}&filename=plan.txt`, {
        "content-type": "text/plain",
      })
    );

    expect(res.status).toBe(200);
    expect(dedupEqCalls).toContainEqual(["project_id", projectId]);
    expect(dedupIsCalls).toEqual([]);
  });

  it("logs the failure and still ingests when the probe fails", async () => {
    dedupResponse = { data: null, error: { message: "canceling statement due to statement timeout" } };

    const res = await POST(uploadTextRequest());

    expect(res.status).toBe(201);
    const body = (await res.json()) as { deduped?: boolean; document: { id: string } };
    // A failed probe must not be answered as "no duplicate exists".
    expect(body.deduped).toBeUndefined();
    expect(serviceInserts.map((insert) => insert.table)).toContain("kb_documents");

    expect(auditWarn).toHaveBeenCalledWith("kb_document_dedup_probe_failed", {
      message: "canceling statement due to statement timeout",
    });
  });
});

describe("POST /api/knowledge-base/documents: the workspace storage limit", () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
    dedupResponse = { data: null, error: null };
    serviceInserts.length = 0;
    storageUploads.length = 0;
    auditWarn.mockClear();
  });

  it("refuses a file that would go over the limit before any byte is stored", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({
      status: "full",
      usedBytes: 5 * 1024 ** 3,
      quotaBytes: 5 * 1024 ** 3,
      message: "This file would put the workspace over its 5 GiB storage limit (5 GiB used).",
    });

    const res = await POST(uploadTextRequest());

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      error: "This file would put the workspace over its 5 GiB storage limit (5 GiB used).",
    });
    expect(storageUploads).toEqual([]);
    expect(serviceInserts).toEqual([]);
    // The measured body (one byte) against THIS workspace.
    expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, 1);
  });

  it("refuses when the workspace's use cannot be read", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({
      status: "unreadable",
      message: "Storage use could not be checked, so nothing was uploaded. Try again in a minute.",
      detail: "permission denied",
    });

    const res = await POST(uploadTextRequest());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Storage use could not be checked, so nothing was uploaded. Try again in a minute.",
    });
    expect(storageUploads).toEqual([]);
  });

  it("stores the file while the workspace has room", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 });

    const res = await POST(uploadTextRequest());

    expect(res.status).toBe(201);
    expect(storageUploads).toHaveLength(1);
    expect(storageUploads[0].startsWith(`${WORKSPACE_ID}/`)).toBe(true);
  });

  it("answers a duplicate without checking, because a duplicate stores nothing", async () => {
    dedupResponse = { data: { id: "doc-existing", title: "Adopted plan" }, error: null };

    const res = await POST(uploadTextRequest());

    expect(res.status).toBe(200);
    expect(checkWorkspaceStorageRoomMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/knowledge-base/documents guards", () => {
  beforeEach(() => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
    kbListEqCalls.length = 0;
    kbListOrCalls.length = 0;
    kbListRangeCalls.length = 0;
    kbListOrderCalls.length = 0;
    kbListLimit = null;
    kbListResponse = { data: [], error: null };
    workspaceCalendarRow = { time_zone: null, home_country_code: null };
    workspaceCalendarReads.length = 0;
  });

  it("400 when workspaceId is missing", async () => {
    const res = await GET(new NextRequest("http://localhost/api/knowledge-base/documents"));
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await GET(
      new NextRequest(`http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}`)
    );
    expect(res.status).toBe(401);
  });

  it("scopes the list to the workspace without a project filter by default", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}`)
    );
    expect(res.status).toBe(200);
    expect(kbListEqCalls).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(kbListEqCalls.map(([column]) => column)).not.toContain("project_id");
  });

  it("narrows the list to a project when projectId is supplied", async () => {
    const projectId = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
    kbListResponse = { data: [{ id: "doc-1", project_id: projectId }], error: null };
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&projectId=${projectId}`
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: Array<{ id: string }> };
    expect(body.documents).toHaveLength(1);
    expect(kbListEqCalls).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(kbListEqCalls).toContainEqual(["project_id", projectId]);
  });

  it("400 when projectId is not a UUID", async () => {
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&projectId=not-a-uuid`
      )
    );
    expect(res.status).toBe(400);
  });

  /**
   * FINDABILITY PAST THE CAP. Every assertion here is about the QUERY, not the
   * response: the list is capped, so a name filter the database never sees
   * returns the same first page it always did, and a planner looking for their
   * 201st document is told it does not exist.
   */
  it("pushes the name filter into the database across title and filename", async () => {
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&q=scour`
      )
    );
    expect(res.status).toBe(200);
    expect(kbListOrCalls).toEqual(['title.ilike."%scour%",original_filename.ilike."%scour%"']);
    expect(kbListLimit).toBe(200);
  });

  it("sends a pasted filename to the database whole", async () => {
    // The reason the filter exists. Flattening the punctuation — which the
    // first version of this route did — sends a term that matches this
    // document in neither column, from the box that offers to find it by name.
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&q=${encodeURIComponent(
          "2023_Corridor_Study_FINAL_v3.pdf"
        )}`
      )
    );
    expect(res.status).toBe(200);
    expect(kbListOrCalls[0]).toContain("2023");
    expect(kbListOrCalls[0]).toContain("_Corridor");
    expect(kbListOrCalls[0]).toContain("v3.pdf");
  });

  it("does not let a search term become extra filter clauses", async () => {
    // `.or()` takes a raw PostgREST filter string, and the comma and periods
    // below are a second clause on a column the planner never chose — unless
    // the value is quoted. The term is no longer flattened (that broke filename
    // search); it is quoted and escaped, so what has to hold now is that it
    // cannot LEAVE the quoted value.
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&q=${encodeURIComponent(
          'a,status.eq.ready","x'
        )}`
      )
    );
    expect(res.status).toBe(200);

    const filter = kbListOrCalls[0];
    // Exactly four quotes: one pair around each of the two column values. Any
    // quote the term contributed would make a fifth, and that is precisely the
    // breakout — observed live against PostgREST, which then parsed the
    // injected `id.eq.…` as a filter of its own.
    expect((filter.match(/(?<!\\)"/g) ?? []).length).toBe(4);
    expect(filter).toBe(
      'title.ilike."%a,status.eq.ready\\",\\"x%",original_filename.ilike."%a,status.eq.ready\\",\\"x%"'
    );
  });

  it("bounds a date range on created_at, whole days, in UTC when the workspace has no zone", async () => {
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&addedFrom=2026-01-01&addedTo=2026-06-30`
      )
    );
    expect(res.status).toBe(200);
    expect(kbListRangeCalls).toEqual([
      ["gte", "created_at", "2026-01-01T00:00:00.000Z"],
      ["lt", "created_at", "2026-07-01T00:00:00.000Z"],
    ]);
  });

  /**
   * THE WORKSPACE'S DAYS, NOT UTC'S. A document added at 8 p.m. Pacific on
   * October 14 is stored as 03:00 UTC on the 15th. Bounded in UTC, a filter on
   * the 14th missed it and a filter on the 15th found it.
   */
  async function rangeFor(zone: string, from: string, to: string) {
    workspaceCalendarRow = { time_zone: zone, home_country_code: null };
    kbListRangeCalls.length = 0;
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&addedFrom=${from}&addedTo=${to}`
      )
    );
    expect(res.status).toBe(200);
    return [...kbListRangeCalls];
  }

  it("bounds a date range by the workspace's midnights, read from the workspace row", async () => {
    // Pacific daylight time: the 14th runs from 07:00 UTC to 07:00 UTC, so the
    // 8 p.m. document (2026-10-15T03:00Z) is inside it.
    expect(await rangeFor("America/Los_Angeles", "2026-10-14", "2026-10-14")).toEqual([
      ["gte", "created_at", "2026-10-14T07:00:00.000Z"],
      ["lt", "created_at", "2026-10-15T07:00:00.000Z"],
    ]);
    expect(workspaceCalendarReads).toEqual([{ columns: "time_zone, home_country_code", eq: ["id", WORKSPACE_ID] }]);
  });

  it("varies with the workspace's zone: Tokyo and Honolulu get their own midnights", async () => {
    expect(await rangeFor("Asia/Tokyo", "2026-10-14", "2026-10-14")).toEqual([
      ["gte", "created_at", "2026-10-13T15:00:00.000Z"],
      ["lt", "created_at", "2026-10-14T15:00:00.000Z"],
    ]);
    expect(await rangeFor("Pacific/Honolulu", "2026-10-14", "2026-10-14")).toEqual([
      ["gte", "created_at", "2026-10-14T10:00:00.000Z"],
      ["lt", "created_at", "2026-10-15T10:00:00.000Z"],
    ]);
  });

  it("ends a day at the next midnight across the end of daylight time (a 25-hour November 1)", async () => {
    expect(await rangeFor("America/Los_Angeles", "2026-11-01", "2026-11-01")).toEqual([
      ["gte", "created_at", "2026-11-01T07:00:00.000Z"],
      ["lt", "created_at", "2026-11-02T08:00:00.000Z"],
    ]);
    // And the 23-hour March 8, when daylight time starts.
    expect(await rangeFor("America/Los_Angeles", "2026-03-08", "2026-03-08")).toEqual([
      ["gte", "created_at", "2026-03-08T08:00:00.000Z"],
      ["lt", "created_at", "2026-03-09T07:00:00.000Z"],
    ]);
  });

  it("does not read the workspace row when no date is asked for", async () => {
    await GET(new NextRequest(`http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&q=rtp`));
    expect(workspaceCalendarReads).toEqual([]);
  });

  it("drops a day that is not a day, and says so in the echo instead of narrowing", async () => {
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&addedFrom=2026-02-31`
      )
    );
    expect(res.status).toBe(200);
    expect(kbListRangeCalls).toEqual([]);
    const body = (await res.json()) as { appliedFilters: { addedFrom: string | null } };
    expect(body.appliedFilters.addedFrom).toBeNull();
  });

  it("orders by the requested column, and falls back to newest for anything else", async () => {
    await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&sort=title`
      )
    );
    expect(kbListOrderCalls).toEqual([["title", true]]);

    kbListOrderCalls.length = 0;
    await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&sort=sideways`
      )
    );
    expect(kbListOrderCalls).toEqual([["created_at", false]]);
  });

  it("echoes back what the read applied, so the screen can caption it honestly", async () => {
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&q=rtp&sort=oldest`
      )
    );
    const body = (await res.json()) as {
      appliedFilters: { nameTerm: string | null; sort: string };
      limit: number;
    };
    expect(body.appliedFilters).toEqual({
      nameTerm: "rtp",
      sort: "oldest",
      addedFrom: null,
      addedTo: null,
    });
    expect(body.limit).toBe(200);
  });
});
