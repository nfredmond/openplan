import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
/** Every `.eq(column, value)` applied to the kb_documents list builder. */
const kbListEqCalls: Array<[string, unknown]> = [];
let kbListResponse: { data: unknown[]; error: null | { message: string } } = { data: [], error: null };

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
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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
  createServiceRoleClient: () => ({}),
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
