import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards the load-bearing retrieval-quality fix caught in the Wave 7 live
// walkthrough: kb_search_chunks must OR the query terms, not AND them, or a
// natural-language question (with words absent from the document) matches nothing.
const sql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260723000003_kb_search_chunks_or_semantics.sql"),
  "utf8"
);

describe("kb_search_chunks OR-semantics migration", () => {
  it("redefines kb_search_chunks rewriting websearch AND (' & ') to OR (' | ')", () => {
    expect(sql).toMatch(/create or replace function public\.kb_search_chunks/i);
    expect(sql).toContain("replace(websearch_to_tsquery('english', p_query)::text, ' & ', ' | ')");
  });

  it("preserves the security + scope guarantees", () => {
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toContain("d.status = 'ready'");
    expect(sql).toContain("c.workspace_id = p_workspace_id");
    // ts_rank still orders by relevance so OR recall does not flatten ranking.
    expect(sql).toContain("ts_rank(c.content_tsv, parsed.query)");
  });
});
