import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

/** The checksum dedup probe, addressable on its own so it can be made to fail. */
let dedupResponse: { data: unknown; error: null | { message: string } } = { data: null, error: null };
/** Every `.in(column, values)` the dedup probe applied. */
const dedupInCalls: Array<[string, unknown]> = [];
/** Service-role writes the upload performed, in order. */
const serviceInserts: Array<{ table: string; rows: unknown }> = [];

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
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    from: (table: string) => ({
      // The dedup probe: kb_documents filtered by workspace + checksum, with
      // status narrowed by `.in` to the deduplicable outcomes (ready|stored).
      select: () => ({
        eq: () => ({
          eq: () => ({
            in: (column: string, values: unknown) => {
              dedupInCalls.push([column, values]);
              return { limit: () => ({ maybeSingle: async () => dedupResponse }) };
            },
          }),
        }),
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

  it("bounds a date range on created_at, whole days, in UTC", async () => {
    const res = await GET(
      new NextRequest(
        `http://localhost/api/knowledge-base/documents?workspaceId=${WORKSPACE_ID}&addedFrom=2026-01-01&addedTo=2026-06-30`
      )
    );
    expect(res.status).toBe(200);
    expect(kbListRangeCalls).toEqual([
      ["gte", "created_at", "2026-01-01T00:00:00.000Z"],
      ["lte", "created_at", "2026-06-30T23:59:59.999Z"],
    ]);
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
