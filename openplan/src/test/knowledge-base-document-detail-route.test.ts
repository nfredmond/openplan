import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A FAILED READ MAY NOT DECIDE A PERMISSION, AND MAY NOT REPORT AN ABSENCE.
 *
 * The DELETE handler reads the caller's workspace role to decide whether a
 * viewer is allowed to remove a document. That read used to be destructured as
 * `{ data: membership }`, so a failed query left the role undefined,
 * `isReadOnlyWorkspaceRole` answered no, and the delete ran with the permission
 * check silently skipped. The tests below make that one read fail and assert
 * both halves of the fix: the 500, and that nothing was deleted.
 *
 * A MOCKED SUPABASE CLIENT HANDS BACK ITS FIXTURE WHATEVER THE CODE ASKED FOR,
 * which is exactly why this class of defect ships. So each read is addressed by
 * TABLE NAME here and can be failed on its own, and the service-role client
 * records every delete and storage removal it is asked to perform — the
 * assertion that matters is the one about what did NOT happen.
 */

const getUserMock = vi.fn();
const auditInfo = vi.fn();
const auditWarn = vi.fn();
const auditError = vi.fn();

type ReadResult = { data: unknown; error: null | { message: string } };

let documentResponse: ReadResult;
let chunksResponse: ReadResult;
let membershipResponse: ReadResult;
// The dependency pre-check reads and the row-delete result, all defaulted to
// "nothing depends on it, delete succeeds" so the happy path is unchanged.
let extractionRefsResponse: ReadResult;
let claimRefsResponse: ReadResult;
let kbDeleteResponse: { error: null | { message: string; code?: string } };
/** Ordered log of destructive ops, to prove the row is deleted before bytes. */
const order: string[] = [];

/** Every `.select(columns)` string the route asked each table for. */
const projections: Array<[string, string]> = [];
/** Service-role writes the route attempted: `table` + the row filter. */
const executedDeletes: Array<{ table: string; filter: [string, unknown] }> = [];
const storageRemovals: string[][] = [];

/** Awaitable filter-recording builder standing in for the chunk-preview query. */
function chunkPreviewBuilder() {
  const builder = {
    select: (columns: string) => {
      projections.push(["kb_document_chunks", columns]);
      return builder;
    },
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (value: ReadResult) => unknown) => resolve(chunksResponse),
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
      if (table === "kb_documents") {
        return {
          select: (columns: string) => {
            projections.push(["kb_documents", columns]);
            return { eq: () => ({ maybeSingle: async () => documentResponse }) };
          },
        };
      }
      if (table === "kb_document_chunks") {
        return chunkPreviewBuilder();
      }
      if (table === "workspace_members") {
        return {
          select: (columns: string) => {
            projections.push(["workspace_members", columns]);
            return { eq: () => ({ eq: () => ({ maybeSingle: async () => membershipResponse }) }) };
          },
        };
      }
      throw new Error(`unexpected table read: ${table}`);
    },
  }),
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          order.push("storage.remove");
          storageRemovals.push(paths);
          return { error: null };
        },
      }),
    },
    from: (table: string) => {
      // The dependency pre-check reads that turn a RESTRICT foreign key into a
      // named refusal: rtp_extraction_runs (cited by an adopted plan) and
      // measure_claim_documents (attached to a measure claim).
      if (table === "rtp_extraction_runs" || table === "measure_claim_documents") {
        return {
          select: (columns: string) => {
            projections.push([table, columns]);
            return {
              eq: async () =>
                table === "rtp_extraction_runs" ? extractionRefsResponse : claimRefsResponse,
            };
          },
        };
      }
      return {
        delete: () => ({
          eq: async (column: string, value: unknown) => {
            order.push("row.delete");
            executedDeletes.push({ table, filter: [column, value] });
            return kbDeleteResponse;
          },
        }),
      };
    },
  }),
}));

import { DELETE, GET } from "@/app/api/knowledge-base/documents/[documentId]/route";
import { KB_DOCUMENTS_BUCKET } from "@/lib/knowledge-base/documents";

const DOCUMENT_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

function request(method: "GET" | "DELETE") {
  return new NextRequest(`http://localhost/api/knowledge-base/documents/${DOCUMENT_ID}`, { method });
}

const context = { params: Promise.resolve({ documentId: DOCUMENT_ID }) };

beforeEach(() => {
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  documentResponse = {
    data: {
      id: DOCUMENT_ID,
      workspace_id: WORKSPACE_ID,
      title: "Adopted plan",
      chunk_count: 40,
      storage_ref: `storage://${KB_DOCUMENTS_BUCKET}/${WORKSPACE_ID}/${DOCUMENT_ID}/plan.pdf`,
    },
    error: null,
  };
  chunksResponse = { data: [], error: null };
  membershipResponse = { data: { role: "member" }, error: null };
  extractionRefsResponse = { data: [], error: null };
  claimRefsResponse = { data: [], error: null };
  kbDeleteResponse = { error: null };
  projections.length = 0;
  executedDeletes.length = 0;
  storageRemovals.length = 0;
  order.length = 0;
  auditInfo.mockClear();
  auditWarn.mockClear();
  auditError.mockClear();
});

describe("DELETE /api/knowledge-base/documents/[documentId] — the role read gates the delete", () => {
  it("refuses the delete when the role read fails, and never touches the database", async () => {
    membershipResponse = {
      data: null,
      error: { message: "permission denied for table workspace_members" },
    };

    const res = await DELETE(request("DELETE"), context);

    // The whole point: the write must not have happened. A 500 that deleted the
    // row anyway would satisfy the status assertion and none of the intent, so
    // this is asserted before the status.
    expect(executedDeletes).toEqual([]);
    expect(storageRemovals).toEqual([]);
    expect(res.status).toBe(500);

    const body = (await res.json()) as { error?: string; success?: boolean };
    expect(body.success).toBeUndefined();
    expect(body.error).toContain("could not confirm your role");
    // 403 asserts a viewer role this read never established, so it is refused
    // as firmly as the delete is.
    expect(res.status).not.toBe(403);
    expect(body.error).not.toContain("read-only");

    expect(auditError).toHaveBeenCalledWith("kb_document_delete_role_check_failed", {
      message: "permission denied for table workspace_members",
    });
  });

  it("refuses the delete when the role read fails on a not-yet-applied schema", async () => {
    membershipResponse = {
      data: null,
      error: { message: "Could not find the table 'public.workspace_members' in the schema cache" },
    };

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(500);
    expect(executedDeletes).toEqual([]);
  });

  it("deletes the document when the role read succeeds for a member", async () => {
    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(executedDeletes).toEqual([{ table: "kb_documents", filter: ["id", DOCUMENT_ID] }]);
    expect(storageRemovals).toEqual([[`${WORKSPACE_ID}/${DOCUMENT_ID}/plan.pdf`]]);
  });

  it("deletes the row BEFORE the bytes, so a RESTRICT never leaves an orphaned citation", async () => {
    // The critical (found 2026-08-17): the route removed the file bytes first,
    // then the row — so when a RESTRICT dependency failed the row delete, the
    // agency's only copy of a cited adopted-plan source was already destroyed
    // while the row stayed 'ready' and cited. Order is the whole fix.
    await DELETE(request("DELETE"), context);
    expect(order).toEqual(["row.delete", "storage.remove"]);
  });

  it("refuses BY NAME when an adopted-plan extraction cites the document, and destroys nothing", async () => {
    extractionRefsResponse = {
      data: [{ rtp_cycle_id: "cycle-1", rtp_cycles: { title: "2050 RTP" } }],
      error: null,
    };

    const res = await DELETE(request("DELETE"), context);

    // Nothing destroyed — asserted before the status, because a 409 that still
    // deleted the bytes would be the same data-loss with better manners.
    expect(executedDeletes).toEqual([]);
    expect(storageRemovals).toEqual([]);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("adopted-plan extraction");
    // "stating the cycle" — the migration's promise, verbatim intent.
    expect(body.error).toContain("2050 RTP");
  });

  it("refuses when a measure claim attaches the document", async () => {
    claimRefsResponse = { data: [{ id: "claim-doc-1" }], error: null };

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(409);
    expect(executedDeletes).toEqual([]);
    expect(storageRemovals).toEqual([]);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("measure claim");
  });

  it("refuses when the dependency check itself fails — it must not assume the document is free", async () => {
    extractionRefsResponse = { data: null, error: { message: "permission denied" } };

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(500);
    expect(executedDeletes).toEqual([]);
    expect(storageRemovals).toEqual([]);
  });

  it("keeps the bytes when the row delete fails on a foreign key the pre-check did not cover", async () => {
    // Belt to the pre-check's braces: even a dependency this code does not know
    // about must not cost the bytes, because the row goes first now.
    kbDeleteResponse = { error: { message: "violates foreign key constraint", code: "23503" } };

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(409);
    expect(storageRemovals).toEqual([]);
  });

  it("403s a viewer, which is a role the read did establish", async () => {
    membershipResponse = { data: { role: "viewer" }, error: null };

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(403);
    expect(executedDeletes).toEqual([]);
  });

  it("asks for the workspace the role check is run against", async () => {
    await DELETE(request("DELETE"), context);

    const documentProjection = projections.find(([table]) => table === "kb_documents")?.[1] ?? "";
    expect(documentProjection).toContain("workspace_id");
    expect(projections).toContainEqual(["workspace_members", "role"]);
  });
});

describe("GET /api/knowledge-base/documents/[documentId] — an unreadable preview is disclosed", () => {
  it("does not present a failed chunk read as a document with no chunks", async () => {
    chunksResponse = { data: null, error: { message: "canceling statement due to statement timeout" } };

    const res = await GET(request("GET"), context);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      chunks: unknown[];
      chunksUnreadable?: boolean;
      document: { chunk_count: number };
    };
    // The document still loads — the preview is an extra — but the response
    // says the preview could not be read rather than shipping an empty list
    // beside a chunk_count of 40.
    expect(body.document.chunk_count).toBe(40);
    expect(body.chunksUnreadable).toBe(true);

    expect(auditWarn).toHaveBeenCalledWith("kb_document_chunk_preview_failed", {
      message: "canceling statement due to statement timeout",
    });
  });

  it("reports a readable preview as readable", async () => {
    chunksResponse = {
      data: [
        { id: "chunk-1", chunk_index: 0, page_from: 1, page_to: 1, token_estimate: 12, content: "Policy 1." },
      ],
      error: null,
    };

    const res = await GET(request("GET"), context);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { chunks: Array<{ excerpt: string }>; chunksUnreadable?: boolean };
    expect(body.chunks).toHaveLength(1);
    expect(body.chunks[0].excerpt).toBe("Policy 1.");
    expect(body.chunksUnreadable).toBe(false);
    expect(auditWarn).not.toHaveBeenCalled();
  });

  it("503s when the document read reports a not-yet-applied schema", async () => {
    documentResponse = {
      data: null,
      error: { message: "Could not find the table 'public.kb_documents' in the schema cache" },
    };

    const res = await GET(request("GET"), context);

    expect(res.status).toBe(503);
  });
});
