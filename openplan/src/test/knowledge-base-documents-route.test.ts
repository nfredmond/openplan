import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const auditInfo = vi.fn();
const auditWarn = vi.fn();
const auditError = vi.fn();
/** Every `.eq(column, value)` applied to the kb_documents list builder. */
const kbListEqCalls: Array<[string, unknown]> = [];
let kbListResponse: { data: unknown[]; error: null | { message: string } } = { data: [], error: null };

/** The checksum dedup probe, addressable on its own so it can be made to fail. */
let dedupResponse: { data: unknown; error: null | { message: string } } = { data: null, error: null };
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
    order: () => builder,
    limit: () => builder,
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
      // The dedup probe: kb_documents filtered by workspace, checksum, status.
      select: () => ({
        eq: () => ({
          eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => dedupResponse }) }) }),
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
});
