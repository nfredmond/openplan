/**
 * Knowledge Base retrieval — lexical full-text search over uploaded-document
 * chunks via the `kb_search_chunks` RPC (SECURITY INVOKER, so the caller's RLS
 * applies). Screening-grade keyword matching, NOT semantic search.
 *
 * Best-effort by contract: any failure (schema not applied, RPC missing, empty
 * query) returns [] so callers — the grant narrative route and the Planner
 * Agent — degrade to their non-KB behavior instead of erroring.
 */

import type { KbDocKind } from "./types";

/** Per-excerpt snippet cap so retrieved passages stay within prompt budgets. */
export const KB_EXCERPT_SNIPPET_CHARS = 480;

export type KnowledgeBaseExcerpt = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  docKind: KbDocKind | string;
  pageFrom: number | null;
  pageTo: number | null;
  chunkIndex: number;
  snippet: string;
  rank: number;
};

type RpcRow = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  doc_kind: string;
  page_from: number | null;
  page_to: number | null;
  chunk_index: number;
  content: string;
  rank: number;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function toSnippet(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > KB_EXCERPT_SNIPPET_CHARS
    ? `${collapsed.slice(0, KB_EXCERPT_SNIPPET_CHARS).trimEnd()}…`
    : collapsed;
}

/** "p. 5", "pp. 5-7", or "" — provenance page label for an excerpt. */
export function excerptPageLabel(pageFrom: number | null, pageTo: number | null): string {
  if (pageFrom == null) return "";
  if (pageTo == null || pageTo === pageFrom) return `p. ${pageFrom}`;
  return `pp. ${pageFrom}-${pageTo}`;
}

/**
 * Retrieve the top Knowledge Base chunks matching `query` for a workspace,
 * optionally narrowed to a project (which also includes workspace-wide docs).
 */
export async function retrieveKnowledgeBaseExcerpts(params: {
  supabase: unknown;
  workspaceId: string | null | undefined;
  projectId?: string | null;
  query: string;
  limit?: number;
}): Promise<KnowledgeBaseExcerpt[]> {
  const query = params.query.replace(/\s+/g, " ").trim();
  if (!query || !params.workspaceId) return [];

  const client = params.supabase as RpcClient;
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await client.rpc("kb_search_chunks", {
      p_workspace_id: params.workspaceId,
      p_project_id: params.projectId ?? null,
      p_query: query,
      p_limit: params.limit ?? 6,
    });
  } catch {
    return [];
  }

  if (result.error || !Array.isArray(result.data)) return [];

  return (result.data as RpcRow[]).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    docKind: row.doc_kind,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    chunkIndex: row.chunk_index,
    snippet: toSnippet(row.content ?? ""),
    rank: typeof row.rank === "number" ? row.rank : 0,
  }));
}
