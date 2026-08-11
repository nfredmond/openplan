import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/knowledge-base/documents/[documentId]/download
 *
 * The Knowledge Base's one byte-serving door, built for the Document Library
 * (2026-08-11). Two properties are load-bearing and both are proven here with
 * fakes that RECORD what was asked, not just answer it:
 *
 * 1. The row is read with the CALLER'S RLS client, filtered by the document id
 *    — the service-role client must never read a table on this route (it has
 *    no workspace_id-free join to hide behind, but the discipline is the
 *    point: service-role reads of tenant tables are the leak class).
 * 2. `storage_ref` is confined to the document's own
 *    `<workspaceId>/<documentId>/` prefix in the kb-documents bucket before it
 *    can reach the signer. A ref pointing anywhere else answers 404 and signs
 *    nothing.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const createSignedUrlMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_WORKSPACE_ID = "88888888-8888-4888-8888-888888888888";
const OTHER_DOCUMENT_ID = "99999999-9999-4999-8999-999999999999";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let documentRow: Record<string, unknown> | null;
let documentReadError: { message: string } | null;

/** Every `.eq()` the route applied to the RLS read, recorded for assertion. */
let recordedFilters: Array<[string, unknown]>;
/** Every `.select()` projection asked of kb_documents. */
let recordedSelects: string[];

const fromMock = vi.fn((table: string) => {
  if (table !== "kb_documents") throw new Error(`Unexpected table: ${table}`);
  return {
    select: (columns: string) => {
      recordedSelects.push(columns);
      const builder = {
        eq: (column: string, value: unknown) => {
          recordedFilters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => ({ data: documentRow, error: documentReadError }),
      };
      return builder;
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as downloadDocument } from "@/app/api/knowledge-base/documents/[documentId]/download/route";

function request() {
  return new NextRequest(
    `http://localhost/api/knowledge-base/documents/${DOCUMENT_ID}/download`,
    { method: "GET" }
  );
}

function ctx(documentId: string = DOCUMENT_ID) {
  return { params: Promise.resolve({ documentId }) };
}

describe("GET /api/knowledge-base/documents/[documentId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordedFilters = [];
    recordedSelects = [];
    documentReadError = null;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://storage.example/signed?token=kb" },
      error: null,
    });
    // DECOY: the service-role client exposes ONLY the storage signer. If the
    // route ever reads a table through it, this fake throws and the test
    // fails — a service-role read of tenant data is the cross-tenant leak
    // class the library was designed around.
    createServiceRoleClientMock.mockReturnValue({
      storage: { from: () => ({ createSignedUrl: createSignedUrlMock }) },
      from: () => {
        throw new Error("service-role client must not read tables on the download route");
      },
    });

    documentRow = {
      id: DOCUMENT_ID,
      workspace_id: WORKSPACE_ID,
      title: "2045 RTP",
      original_filename: "2045-rtp.pdf",
      storage_ref: `storage://kb-documents/${WORKSPACE_ID}/${DOCUMENT_ID}/2045-rtp.pdf`,
    };
  });

  it("redirects to a 15-minute signed URL named after the uploaded file", async () => {
    const response = await downloadDocument(request(), ctx());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://storage.example/signed?token=kb");
    expect(createSignedUrlMock).toHaveBeenCalledWith(
      `${WORKSPACE_ID}/${DOCUMENT_ID}/2045-rtp.pdf`,
      15 * 60,
      { download: "2045-rtp.pdf" }
    );
  });

  it("reads the row with the RLS client, filtered by the requested document id", async () => {
    await downloadDocument(request(), ctx());

    // The read went through the CALLER'S client…
    expect(createClientMock).toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledWith("kb_documents");
    // …asked for the columns the route actually uses…
    expect(recordedSelects[0]).toContain("workspace_id");
    expect(recordedSelects[0]).toContain("storage_ref");
    expect(recordedSelects[0]).toContain("original_filename");
    // …and bound the filter to THIS document, not to nothing.
    expect(recordedFilters).toContainEqual(["id", DOCUMENT_ID]);
  });

  it("binds the filter to the id that was requested, not a fixed one", async () => {
    documentRow = null;
    await downloadDocument(request(), ctx(OTHER_DOCUMENT_ID));
    expect(recordedFilters).toContainEqual(["id", OTHER_DOCUMENT_ID]);
    expect(recordedFilters).not.toContainEqual(["id", DOCUMENT_ID]);
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    expect((await downloadDocument(request(), ctx())).status).toBe(401);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed document id before touching the database", async () => {
    const response = await downloadDocument(request(), ctx("not-a-uuid"));
    expect(response.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a document the RLS read cannot see", async () => {
    documentRow = null;
    expect((await downloadDocument(request(), ctx())).status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the deployment is behind the Knowledge Base migration", async () => {
    documentReadError = {
      message: "Could not find the table 'public.kb_documents' in the schema cache",
    };
    expect((await downloadDocument(request(), ctx())).status).toBe(503);
  });

  it("answers 500 (not an empty 404) when the row read fails", async () => {
    documentReadError = { message: "permission denied for table kb_documents" };
    const response = await downloadDocument(request(), ctx());
    expect(response.status).toBe(500);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("says a pasted document has no file rather than 404ing as if it did not exist", async () => {
    documentRow = { ...(documentRow as object), storage_ref: null };
    const response = await downloadDocument(request(), ctx());
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/no stored file/);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  describe("storage-ref confinement", () => {
    const OUT_OF_SCOPE = [
      // Another workspace's prefix entirely.
      `storage://kb-documents/${OTHER_WORKSPACE_ID}/${DOCUMENT_ID}/leak.pdf`,
      // This workspace, but a DIFFERENT document.
      `storage://kb-documents/${WORKSPACE_ID}/${OTHER_DOCUMENT_ID}/leak.pdf`,
      // Traversal out of the prefix.
      `storage://kb-documents/${WORKSPACE_ID}/${DOCUMENT_ID}/../../secrets/all.pdf`,
      // A different bucket.
      `storage://report-artifacts/${WORKSPACE_ID}/${DOCUMENT_ID}/leak.pdf`,
      // Absolute bare path.
      `/${WORKSPACE_ID}/${DOCUMENT_ID}/leak.pdf`,
      // Bare path outside the prefix.
      `${OTHER_WORKSPACE_ID}/${DOCUMENT_ID}/leak.pdf`,
    ];

    it.each(OUT_OF_SCOPE)("refuses to sign %s", async (storageRef) => {
      documentRow = { ...(documentRow as object), storage_ref: storageRef };

      const response = await downloadDocument(request(), ctx());

      expect(response.status).toBe(404);
      // The important half: it must never reach the signer.
      expect(createSignedUrlMock).not.toHaveBeenCalled();
      expect(mockAudit.warn).toHaveBeenCalledWith(
        "kb_document_ref_out_of_scope",
        expect.objectContaining({ documentId: DOCUMENT_ID })
      );
    });

    it("accepts an in-scope bare object path (the second ref convention)", async () => {
      documentRow = {
        ...(documentRow as object),
        storage_ref: `${WORKSPACE_ID}/${DOCUMENT_ID}/2045-rtp.pdf`,
      };
      expect((await downloadDocument(request(), ctx())).status).toBe(307);
    });
  });

  it("returns 500 when the signer fails, rather than a broken redirect", async () => {
    createSignedUrlMock.mockResolvedValue({ data: null, error: { message: "bucket gone" } });
    expect((await downloadDocument(request(), ctx())).status).toBe(500);
  });

  it("falls back to a sanitized title when the upload recorded no filename", async () => {
    documentRow = { ...(documentRow as object), original_filename: null, title: "2045 RTP" };
    await downloadDocument(request(), ctx());
    expect(createSignedUrlMock).toHaveBeenCalledWith(
      expect.any(String),
      15 * 60,
      { download: "2045_RTP" }
    );
  });
});
