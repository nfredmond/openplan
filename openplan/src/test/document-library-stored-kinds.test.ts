/**
 * Stored kinds — the Knowledge Base holds files it deliberately does not read.
 *
 * The contract under test (migration 20260811000005 + the ingest routes):
 *
 *   * `stored` is a status meaning "kept, extraction NOT attempted" — distinct
 *     from `failed` ("attempted, no text found").
 *   * A stored row NEVER gets chunk rows. Together with the retrieval RPC's
 *     `status = 'ready'` filter (pinned by knowledge-base-search-migration),
 *     that is the wall keeping stored files out of grounding.
 *   * `extraction_source` records where indexed text came from, and the
 *     projection surfaces it, so the column has a real TypeScript reader.
 *   * The per-file ceiling is the OPERATOR'S (OPENPLAN_KB_DOCUMENT_MAX_BYTES),
 *     and the refusal names the variable.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DEFAULT_KB_DOCUMENT_MAX_BYTES,
  KB_DOCUMENT_COLUMNS,
  KB_DOCUMENT_MAX_BYTES_ENV,
  KB_STORED_DOCUMENT_NOTICE,
  resolveKbDocumentMaxBytes,
} from "@/lib/knowledge-base/documents";

const getUserMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();

/** Every service-role insert, by table, in order. */
const serviceInserts: Array<{ table: string; rows: Record<string, unknown> }> = [];
/** Every storage upload: [path, contentType]. */
const storageUploads: Array<[string, string | undefined]> = [];
const storageRemovals: string[] = [];

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
        upload: async (objectPath: string, _bytes: unknown, options?: { contentType?: string }) => {
          storageUploads.push([objectPath, options?.contentType]);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          storageRemovals.push(...paths);
          return { error: null };
        },
      }),
    },
    from: (table: string) => ({
      // The dedup probe: nothing pre-existing in these tests.
      select: () => ({
        eq: () => ({
          eq: () => ({
            in: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          }),
        }),
      }),
      insert: (rows: Record<string, unknown>) => {
        serviceInserts.push({ table, rows });
        return {
          select: () => ({
            single: async () => ({ data: { id: "doc-1", ...rows }, error: null }),
          }),
          then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

import { POST as uploadPost } from "@/app/api/knowledge-base/documents/route";
import { POST as pastePost } from "@/app/api/knowledge-base/documents/paste/route";

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function uploadRequest(query: string, headers: Record<string, string>, body: Uint8Array | string) {
  return new NextRequest(`http://localhost/api/knowledge-base/documents${query}`, {
    method: "POST",
    headers,
    body: body as BodyInit,
  });
}

beforeEach(() => {
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  membershipMaybeSingleMock.mockResolvedValue({ data: { role: "owner" }, error: null });
  serviceInserts.length = 0;
  storageUploads.length = 0;
  storageRemovals.length = 0;
  delete process.env[KB_DOCUMENT_MAX_BYTES_ENV];
});

afterEach(() => {
  delete process.env[KB_DOCUMENT_MAX_BYTES_ENV];
});

describe("migration 20260811000005 — the schema half of the contract", () => {
  const sql = readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260811000005_document_library_stored_kinds.sql"
    ),
    "utf8"
  );

  it("adds 'stored' to the status vocabulary alongside the existing values", () => {
    const statusCheck = /kb_documents_status_check\s+CHECK \(status IN \(([^)]*)\)/.exec(sql);
    expect(statusCheck).not.toBeNull();
    for (const value of ["'pending'", "'extracting'", "'ready'", "'failed'", "'archived'", "'stored'"]) {
      expect(statusCheck![1]).toContain(value);
    }
  });

  it("adds the four stored source kinds without dropping the extractable five", () => {
    const kindCheck = /kb_documents_source_kind_check\s+CHECK \(source_kind IN \(([\s\S]*?)\)\)/.exec(sql);
    expect(kindCheck).not.toBeNull();
    for (const value of [
      "'uploaded_pdf'",
      "'uploaded_docx'",
      "'uploaded_txt'",
      "'uploaded_md'",
      "'pasted_text'",
      "'uploaded_image'",
      "'uploaded_spreadsheet'",
      "'uploaded_cad'",
      "'uploaded_other'",
    ]) {
      expect(kindCheck![1]).toContain(value);
    }
  });

  it("adds 'drawing' and 'exhibit' to doc_kind", () => {
    const docKindCheck = /kb_documents_doc_kind_check\s+CHECK \(doc_kind IN \(([\s\S]*?)\)\)/.exec(sql);
    expect(docKindCheck).not.toBeNull();
    expect(docKindCheck![1]).toContain("'drawing'");
    expect(docKindCheck![1]).toContain("'exhibit'");
  });

  it("adds extraction_source with the three-value CHECK and NO future values promised", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS extraction_source text");
    expect(sql).toMatch(/CHECK \(extraction_source IN \('text_layer','pasted','none'\)\)/);
    // 'ocr' / 'spreadsheet_parse' arrive with the worker that implements them.
    expect(sql).not.toMatch(/IN \([^)]*'ocr'/);
    expect(sql).not.toMatch(/IN \([^)]*'spreadsheet_parse'/);
  });

  it("moves the size ceiling out of the bucket row, scoped to the one bucket", () => {
    expect(sql).toMatch(/file_size_limit = NULL/);
    expect(sql).toMatch(/WHERE id = 'kb-documents'/);
  });
});

describe("extraction_source has a real TypeScript reader", () => {
  it("is projected by KB_DOCUMENT_COLUMNS (list + detail both select this string)", () => {
    expect(KB_DOCUMENT_COLUMNS.split(",").map((column) => column.trim())).toContain(
      "extraction_source"
    );
  });
});

describe("resolveKbDocumentMaxBytes — the operator's ceiling", () => {
  it("defaults to 100 MiB and matches the documented default", () => {
    expect(resolveKbDocumentMaxBytes({})).toBe(DEFAULT_KB_DOCUMENT_MAX_BYTES);
    expect(DEFAULT_KB_DOCUMENT_MAX_BYTES).toBe(100 * 1024 * 1024);
  });

  it("threads the env value rather than hardcoding the default", () => {
    expect(resolveKbDocumentMaxBytes({ [KB_DOCUMENT_MAX_BYTES_ENV]: "134217728" })).toBe(134217728);
    expect(resolveKbDocumentMaxBytes({ [KB_DOCUMENT_MAX_BYTES_ENV]: "8" })).toBe(8);
  });

  it("falls back to the default for garbage", () => {
    for (const bad of ["", "  ", "abc", "-1", "0", "1.5", "Infinity"]) {
      expect(resolveKbDocumentMaxBytes({ [KB_DOCUMENT_MAX_BYTES_ENV]: bad })).toBe(
        DEFAULT_KB_DOCUMENT_MAX_BYTES
      );
    }
  });

  it("the stored sentence never claims processing is coming", () => {
    expect(KB_STORED_DOCUMENT_NOTICE.toLowerCase()).not.toContain("processing");
    expect(KB_STORED_DOCUMENT_NOTICE.toLowerCase()).toContain("cannot be cited");
  });
});

describe("POST /api/knowledge-base/documents — the stored branch", () => {
  it("stores a PNG: status stored, extraction_source none, zero chunks, sniffed content type", async () => {
    const res = await uploadPost(
      uploadRequest(
        `?workspaceId=${WORKSPACE_ID}&filename=site-photo.png&docKind=exhibit`,
        { "content-type": "image/png" },
        PNG_MAGIC
      )
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { stored?: boolean; notice?: string; document: { id: string } };
    expect(body.stored).toBe(true);
    expect(body.notice).toBe(KB_STORED_DOCUMENT_NOTICE);

    const documentInserts = serviceInserts.filter((insert) => insert.table === "kb_documents");
    expect(documentInserts).toHaveLength(1);
    expect(documentInserts[0].rows).toMatchObject({
      workspace_id: WORKSPACE_ID,
      source_kind: "uploaded_image",
      doc_kind: "exhibit",
      status: "stored",
      extraction_source: "none",
      chunk_count: 0,
      page_count: null,
      char_count: null,
      content_type: "image/png",
    });

    // THE WALL: a stored document gets no chunk rows, ever. The retrieval RPC
    // additionally filters status='ready' (knowledge-base-search-migration
    // pins that), so stored bytes cannot enter grounding by accident.
    expect(serviceInserts.filter((insert) => insert.table === "kb_document_chunks")).toEqual([]);

    // And the object went up under the sniffed type, not the raw header.
    expect(storageUploads).toHaveLength(1);
    expect(storageUploads[0][1]).toBe("image/png");
  });

  it("stores a CSV as a spreadsheet under its canonical content type", async () => {
    const res = await uploadPost(
      uploadRequest(
        `?workspaceId=${WORKSPACE_ID}&filename=cost-table.csv`,
        { "content-type": "text/csv" },
        "project,cost\nBridge,1200000\n"
      )
    );

    expect(res.status).toBe(201);
    const documentInserts = serviceInserts.filter((insert) => insert.table === "kb_documents");
    expect(documentInserts).toHaveLength(1);
    expect(documentInserts[0].rows).toMatchObject({
      source_kind: "uploaded_spreadsheet",
      status: "stored",
      extraction_source: "none",
      content_type: "text/csv",
    });
    expect(serviceInserts.filter((insert) => insert.table === "kb_document_chunks")).toEqual([]);
  });

  it("refuses a mislabeled image — declared image/png, bytes not an image — storing nothing", async () => {
    const res = await uploadPost(
      uploadRequest(
        `?workspaceId=${WORKSPACE_ID}&filename=fake.png`,
        { "content-type": "image/png" },
        "just some text pretending to be a picture"
      )
    );

    expect(res.status).toBe(415);
    expect(storageUploads).toEqual([]);
    expect(serviceInserts).toEqual([]);
  });

  it("still refuses genuinely unknown formats with 415", async () => {
    const res = await uploadPost(
      uploadRequest(
        `?workspaceId=${WORKSPACE_ID}&filename=bundle.zip`,
        { "content-type": "application/zip" },
        "PK"
      )
    );
    expect(res.status).toBe(415);
    expect(storageUploads).toEqual([]);
    expect(serviceInserts).toEqual([]);
  });

  it("an extractable upload records extraction_source text_layer", async () => {
    const res = await uploadPost(
      uploadRequest(
        `?workspaceId=${WORKSPACE_ID}&filename=plan.txt`,
        { "content-type": "text/plain" },
        "Adopted regional plan narrative."
      )
    );

    expect(res.status).toBe(201);
    const documentInserts = serviceInserts.filter((insert) => insert.table === "kb_documents");
    expect(documentInserts).toHaveLength(1);
    expect(documentInserts[0].rows).toMatchObject({
      source_kind: "uploaded_txt",
      status: "ready",
      extraction_source: "text_layer",
    });
  });
});

describe("the operator ceiling is enforced and the refusal names the env", () => {
  it("413s past the env-resolved ceiling, echoing the resolved number (not the default)", async () => {
    process.env[KB_DOCUMENT_MAX_BYTES_ENV] = "8";

    const res = await uploadPost(
      uploadRequest(
        `?workspaceId=${WORKSPACE_ID}&filename=site-photo.png`,
        { "content-type": "image/png" },
        PNG_MAGIC // 12 bytes > 8
      )
    );

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; maxBytes: number };
    // The binding is varied: 8 proves the env threaded through, because the
    // default would be 104857600.
    expect(body.maxBytes).toBe(8);
    expect(body.error).toContain(KB_DOCUMENT_MAX_BYTES_ENV);
    expect(storageUploads).toEqual([]);
    expect(serviceInserts).toEqual([]);
  });

  it("accepts the same body once the ceiling is raised", async () => {
    process.env[KB_DOCUMENT_MAX_BYTES_ENV] = "1024";

    const res = await uploadPost(
      uploadRequest(
        `?workspaceId=${WORKSPACE_ID}&filename=site-photo.png`,
        { "content-type": "image/png" },
        PNG_MAGIC
      )
    );

    expect(res.status).toBe(201);
  });
});

describe("POST /api/knowledge-base/documents/paste records extraction_source", () => {
  it("writes extraction_source 'pasted'", async () => {
    const res = await pastePost(
      new NextRequest("http://localhost/api/knowledge-base/documents/paste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          title: "Board direction on corridor phasing",
          text: "The board directed staff to phase the corridor improvements.",
        }),
      })
    );

    expect(res.status).toBe(201);
    const documentInserts = serviceInserts.filter((insert) => insert.table === "kb_documents");
    expect(documentInserts).toHaveLength(1);
    expect(documentInserts[0].rows).toMatchObject({
      source_kind: "pasted_text",
      status: "ready",
      extraction_source: "pasted",
    });
  });
});
