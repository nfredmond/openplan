import { describe, expect, it } from "vitest";
import {
  buildKbChunkRows,
  buildKbDocumentPath,
  checkWorkspaceMembership,
  looksLikePendingSchema,
  sanitizeFilename,
} from "@/lib/knowledge-base/documents";
import type { DocumentChunk } from "@/lib/knowledge-base/types";

describe("sanitizeFilename", () => {
  it("keeps a safe basename and strips path traversal", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("My Plan (v2).pdf")).toBe("My_Plan_v2_.pdf");
    expect(sanitizeFilename("a\\b\\report.docx")).toBe("report.docx");
  });

  it("falls back to a default for empty / unsafe names", () => {
    expect(sanitizeFilename("")).toBe("document");
    expect(sanitizeFilename(null)).toBe("document");
    expect(sanitizeFilename("....")).toBe("document");
  });
});

describe("buildKbDocumentPath", () => {
  it("nests under workspace + document id with a sanitized filename", () => {
    expect(buildKbDocumentPath("ws-1", "doc-1", "Grant NOFO.pdf")).toBe("ws-1/doc-1/Grant_NOFO.pdf");
  });
});

describe("buildKbChunkRows", () => {
  it("maps chunks to insert rows carrying the document + workspace scope", () => {
    const chunks: DocumentChunk[] = [
      {
        chunkIndex: 0,
        content: "Corridor safety.",
        pageFrom: 1,
        pageTo: 2,
        charStart: 0,
        charEnd: 16,
        tokenEstimate: 4,
      },
    ];
    const rows = buildKbChunkRows("doc-1", "ws-1", chunks);
    expect(rows[0]).toMatchObject({
      document_id: "doc-1",
      workspace_id: "ws-1",
      chunk_index: 0,
      page_from: 1,
      page_to: 2,
      content: "Corridor safety.",
      token_estimate: 4,
    });
  });
});

describe("looksLikePendingSchema", () => {
  it("recognizes missing-relation / schema-cache errors", () => {
    expect(looksLikePendingSchema('relation "kb_documents" does not exist')).toBe(true);
    expect(looksLikePendingSchema("Could not find the table 'public.kb_documents'")).toBe(true);
    expect(looksLikePendingSchema("permission denied")).toBe(false);
    expect(looksLikePendingSchema(null)).toBe(false);
  });
});

type MembershipResponse = { data: { role: string } | null; error: { message: string } | null };

function mockMembershipClient(response: MembershipResponse) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => response,
          }),
        }),
      }),
    }),
  };
}

describe("checkWorkspaceMembership", () => {
  it("returns the role for a member", async () => {
    const result = await checkWorkspaceMembership(
      mockMembershipClient({ data: { role: "owner" }, error: null }),
      "user-1",
      "ws-1"
    );
    expect(result).toEqual({ ok: true, role: "owner" });
  });

  it("returns not_member when there is no membership row", async () => {
    const result = await checkWorkspaceMembership(
      mockMembershipClient({ data: null, error: null }),
      "user-1",
      "ws-1"
    );
    expect(result).toEqual({ ok: false, kind: "not_member", message: "Workspace not found" });
  });

  it("distinguishes a not-yet-applied schema from a real error", async () => {
    const pending = await checkWorkspaceMembership(
      mockMembershipClient({ data: null, error: { message: 'relation "workspace_members" does not exist' } }),
      "user-1",
      "ws-1"
    );
    expect(pending.ok).toBe(false);
    expect(pending).toMatchObject({ kind: "schema_pending" });

    const failed = await checkWorkspaceMembership(
      mockMembershipClient({ data: null, error: { message: "connection reset" } }),
      "user-1",
      "ws-1"
    );
    expect(failed).toMatchObject({ ok: false, kind: "error" });
  });
});
