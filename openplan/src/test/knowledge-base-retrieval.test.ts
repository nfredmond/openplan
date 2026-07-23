import { describe, expect, it, vi } from "vitest";
import {
  excerptPageLabel,
  KB_EXCERPT_SNIPPET_CHARS,
  retrieveKnowledgeBaseExcerpts,
} from "@/lib/knowledge-base/retrieval";

const ROW = {
  chunk_id: "c1",
  document_id: "d1",
  document_title: "Nevada County 2045 RTP",
  doc_kind: "rtp",
  page_from: 3,
  page_to: 3,
  chunk_index: 0,
  content: "  Corridor   safety   improvements.  ",
  rank: 0.42,
};

function mockSupabase(response: { data: unknown; error: { message: string } | null }) {
  return { rpc: vi.fn().mockResolvedValue(response) };
}

describe("excerptPageLabel", () => {
  it("formats single, range, and missing pages", () => {
    expect(excerptPageLabel(5, 5)).toBe("p. 5");
    expect(excerptPageLabel(5, null)).toBe("p. 5");
    expect(excerptPageLabel(5, 7)).toBe("pp. 5-7");
    expect(excerptPageLabel(null, null)).toBe("");
  });
});

describe("retrieveKnowledgeBaseExcerpts", () => {
  it("maps RPC rows to excerpts, collapsing whitespace, and forwards the scope", async () => {
    const supabase = mockSupabase({ data: [ROW], error: null });
    const out = await retrieveKnowledgeBaseExcerpts({
      supabase,
      workspaceId: "ws-1",
      projectId: "proj-1",
      query: "  safety  ",
      limit: 4,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      chunkId: "c1",
      documentTitle: "Nevada County 2045 RTP",
      pageFrom: 3,
      snippet: "Corridor safety improvements.",
      rank: 0.42,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("kb_search_chunks", {
      p_workspace_id: "ws-1",
      p_project_id: "proj-1",
      p_query: "safety",
      p_limit: 4,
    });
  });

  it("truncates long snippets with an ellipsis", async () => {
    const supabase = mockSupabase({ data: [{ ...ROW, content: "word ".repeat(300) }], error: null });
    const [excerpt] = await retrieveKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "x" });
    expect(excerpt.snippet.length).toBeLessThanOrEqual(KB_EXCERPT_SNIPPET_CHARS + 1);
    expect(excerpt.snippet.endsWith("…")).toBe(true);
  });

  it("returns [] for an empty query without calling the RPC", async () => {
    const supabase = mockSupabase({ data: [ROW], error: null });
    expect(await retrieveKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "   " })).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns [] without a workspace id", async () => {
    const supabase = mockSupabase({ data: [ROW], error: null });
    expect(await retrieveKnowledgeBaseExcerpts({ supabase, workspaceId: null, query: "x" })).toEqual([]);
  });

  it("is best-effort: RPC error yields []", async () => {
    const supabase = mockSupabase({ data: null, error: { message: 'relation "kb_document_chunks" does not exist' } });
    expect(await retrieveKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "x" })).toEqual([]);
  });

  it("is best-effort: a thrown RPC yields []", async () => {
    const supabase = { rpc: vi.fn().mockRejectedValue(new Error("boom")) };
    expect(await retrieveKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "x" })).toEqual([]);
  });
});
