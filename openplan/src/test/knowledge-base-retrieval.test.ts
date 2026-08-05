import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  excerptPageLabel,
  KB_EXCERPT_SNIPPET_CHARS,
  loadKnowledgeBaseExcerpts,
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

describe("loadKnowledgeBaseExcerpts", () => {
  it("maps RPC rows to excerpts, collapsing whitespace, and forwards the scope", async () => {
    const supabase = mockSupabase({ data: [ROW], error: null });
    const { excerpts, error, searched } = await loadKnowledgeBaseExcerpts({
      supabase,
      workspaceId: "ws-1",
      projectId: "proj-1",
      query: "  safety  ",
      limit: 4,
    });
    expect(error).toBeNull();
    expect(searched).toBe(true);
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]).toMatchObject({
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
    const { excerpts } = await loadKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "x" });
    expect(excerpts[0].snippet.length).toBeLessThanOrEqual(KB_EXCERPT_SNIPPET_CHARS + 1);
    expect(excerpts[0].snippet.endsWith("…")).toBe(true);
  });

  it("a corpus that held no match is a searched, error-free empty result", async () => {
    const supabase = mockSupabase({ data: [], error: null });
    const read = await loadKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "bridge scour" });
    // The ONE combination a caller may render as "your documents say nothing".
    expect(read).toEqual({ excerpts: [], error: null, searched: true });
  });

  it("does not claim to have searched when the query is blank", async () => {
    const supabase = mockSupabase({ data: [ROW], error: null });
    const read = await loadKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "   " });
    expect(read).toEqual({ excerpts: [], error: null, searched: false });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("does not claim to have searched without a workspace id", async () => {
    const supabase = mockSupabase({ data: [ROW], error: null });
    const read = await loadKnowledgeBaseExcerpts({ supabase, workspaceId: null, query: "x" });
    expect(read).toEqual({ excerpts: [], error: null, searched: false });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // ── The defect class: a failed read may not be answered as an empty corpus ──

  it("RETURNS the RPC error instead of swallowing it, so no caller can read the failure as an empty corpus", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "canceling statement due to statement timeout" },
    });
    const read = await loadKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "x" });

    expect(read.error).not.toBeNull();
    expect(read.error?.message).toContain("statement timeout");
    // A timeout is not a setup gap — it must not be dressed up as one.
    expect(read.error?.schemaPending).toBe(false);
    expect(read.excerpts).toEqual([]);
    // The old false claim: `[]` with nothing to distinguish it from a corpus
    // that genuinely matched nothing. A failed read is NOT a searched one.
    expect(read.searched).toBe(true);
    expect(read).not.toEqual({ excerpts: [], error: null, searched: true });
  });

  it("separates an unapplied migration from a read failure so an operator gets the actionable message", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: 'relation "kb_document_chunks" does not exist' },
    });
    const read = await loadKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "x" });
    expect(read.error?.schemaPending).toBe(true);
    expect(read.excerpts).toEqual([]);
  });

  it("returns a thrown client as an error rather than an empty result", async () => {
    const supabase = { rpc: vi.fn().mockRejectedValue(new Error("fetch failed")) };
    const read = await loadKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "x" });
    expect(read.error?.message).toContain("fetch failed");
    expect(read.excerpts).toEqual([]);
  });

  it("treats a non-array answer as a failed read, not as zero passages", async () => {
    const supabase = mockSupabase({ data: null, error: null });
    const read = await loadKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "x" });
    expect(read.error).not.toBeNull();
    expect(read.error?.message).toContain("not a result set");
  });

  it("still reports a failure that arrived with no words", async () => {
    const supabase = mockSupabase({ data: null, error: { message: "   " } });
    const read = await loadKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "x" });
    expect(read.error).toEqual({ message: "no message reported", schemaPending: false });
  });
});

describe("retrieveKnowledgeBaseExcerpts (the deprecated best-effort adapter)", () => {
  it("still maps rows for the callers that have not migrated", async () => {
    const supabase = mockSupabase({ data: [ROW], error: null });
    const out = await retrieveKnowledgeBaseExcerpts({ supabase, workspaceId: "ws-1", query: "safety" });
    expect(out).toHaveLength(1);
    expect(out[0].documentTitle).toBe("Nevada County 2045 RTP");
  });

  it("is lossy BY CONSTRUCTION: a failed search is indistinguishable from an empty corpus", async () => {
    const failed = mockSupabase({ data: null, error: { message: "permission denied for function" } });
    const empty = mockSupabase({ data: [], error: null });

    // This equality is the defect, stated so it cannot be mistaken for coverage.
    // It is why the caller list below may only shrink.
    expect(await retrieveKnowledgeBaseExcerpts({ supabase: failed, workspaceId: "ws-1", query: "x" })).toEqual(
      await retrieveKnowledgeBaseExcerpts({ supabase: empty, workspaceId: "ws-1", query: "x" })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shrink-only ratchet over the call sites that still discard the error.
//
// A `@deprecated` tag is a convention, and this repo's conventions get violated.
// The list below is the executable form: a NEW caller of the lossy adapter fails
// the build, and a caller that migrates to `loadKnowledgeBaseExcerpts` must be
// struck off or the staleness check fails. Neither direction is silent.
// ─────────────────────────────────────────────────────────────────────────────

const SRC_ROOT = join(process.cwd(), "src");

/**
 * Call sites of `retrieveKnowledgeBaseExcerpts`, relative to `src/`. Each one
 * drafts or answers with Knowledge Base facts and cannot currently tell a
 * planner that the search failed. Remove an entry when it migrates; never add.
 */
const CALLERS_STILL_DISCARDING_THE_ERROR = [
  "app/api/assistant/chat/route.ts",
  "app/api/reports/[reportId]/narrative-draft/route.ts",
  "app/api/rtp-cycles/[rtpCycleId]/chapters/[chapterId]/draft/route.ts",
  "lib/assistant/chat-tools.ts",
  "lib/grants/narrative-evidence.ts",
];

/**
 * Matches the CALL, not the mention. `every-api-route-has-a-caller` was once
 * defeated by a route path written inside a sentence, so block comments are
 * stripped first and an open paren is required — `search/route.ts` names this
 * function in its header to explain why it does NOT call it.
 */
function collectAdapterCallers(root: string): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || rel === "test") continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (rel === "lib/knowledge-base/retrieval.ts") continue;
      const source = readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/retrieveKnowledgeBaseExcerpts\s*\(/.test(source)) found.push(rel);
    }
  };

  walk(root);
  return found.sort();
}

describe("the lossy Knowledge Base adapter has a shrink-only caller list", () => {
  it("finds exactly the call sites still discarding the search error", () => {
    // An equality, not a floor: a broken walk that found nothing would pass a
    // floor assertion and prove the opposite of what this file claims.
    expect(collectAdapterCallers(SRC_ROOT)).toEqual([...CALLERS_STILL_DISCARDING_THE_ERROR].sort());
  });

  it("detects a new caller and ignores one that is only named in a comment", () => {
    // Proves the scan itself is not vacuous, without touching a file this lane
    // does not own.
    const fixture = mkdtempSync(join(tmpdir(), "kb-adapter-scan-"));
    try {
      mkdirSync(join(fixture, "lib", "nested"), { recursive: true });
      writeFileSync(
        join(fixture, "lib", "nested", "caller.ts"),
        "const x = await retrieveKnowledgeBaseExcerpts({ supabase, workspaceId, query });\n"
      );
      writeFileSync(
        join(fixture, "lib", "mentions-only.ts"),
        "/**\n * WHY THIS DOES NOT CALL `retrieveKnowledgeBaseExcerpts`: it needs the error.\n */\nexport const ok = 1;\n"
      );

      expect(collectAdapterCallers(fixture)).toEqual(["lib/nested/caller.ts"]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
