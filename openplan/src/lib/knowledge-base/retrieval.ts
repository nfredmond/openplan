/**
 * Knowledge Base retrieval — lexical full-text search over uploaded-document
 * chunks via the `kb_search_chunks` RPC (SECURITY INVOKER, so the caller's RLS
 * applies). Screening-grade keyword matching, NOT semantic search.
 *
 * THE OUTCOME-RETURNING CORE. `loadKnowledgeBaseExcerpts` neither swallows nor
 * throws: it returns `{ excerpts, error, searched }` and lets the caller decide
 * what to tell a planner. That is the seam `loadOpportunityPursuitContext`
 * (src/lib/grants/pursuit.ts) and `loadSurveyDefinition`
 * (src/lib/engagement/survey-responses.ts) already use, and the one the header
 * of `src/app/api/knowledge-base/search/route.ts` has been asking this module
 * for since that route was written.
 *
 * WHY IT MATTERS HERE. A search that FAILED and a search that MATCHED NOTHING
 * both produced `[]` before. So a drafting route could compose an RTP chapter
 * with zero supporting-document facts and answer 201 as though the agency's own
 * corpus had nothing to say on the subject — and neither the planner nor the
 * audit log was told the search never ran. "No matching excerpts" is a claim
 * about the planner's documents, and a read that failed may not make it.
 *
 * `retrieveKnowledgeBaseExcerpts` survives as the best-effort adapter its
 * existing callers still use. It DISCARDS the error, which is exactly the
 * defect above; `src/test/knowledge-base-retrieval.test.ts` holds a shrink-only
 * list of the call sites that have not migrated yet, so a new one cannot be
 * added and a migrated one must be struck off.
 */

import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
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

/**
 * Why a search produced no passages when it produced none for a reason other
 * than the corpus. `schemaPending` separates "this deployment has not applied
 * the Knowledge Base migrations" (an operator setup step, which the search
 * route answers 503) from any other read failure (500).
 */
export type KnowledgeBaseSearchFailure = {
  message: string;
  schemaPending: boolean;
};

export type KnowledgeBaseExcerptRead = {
  /** The passages the RPC returned. Empty is only meaningful with the two flags below. */
  excerpts: KnowledgeBaseExcerpt[];
  /** Non-null when the search could not run. `excerpts` is then empty because
   * NOTHING WAS SEARCHED — never because nothing matched. */
  error: KnowledgeBaseSearchFailure | null;
  /**
   * False when there was nothing to search for (a blank query) or nowhere to
   * search (no workspace). Not a failure — but not evidence about the corpus
   * either, so a caller must not report it as "the documents say nothing".
   * `searched === true && error === null && excerpts.length === 0` is the ONE
   * combination that means the corpus genuinely held no matching passage.
   */
  searched: boolean;
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

/** A database error that arrived with no words still has to be reportable. */
function failure(message: string | null | undefined): KnowledgeBaseSearchFailure {
  const text = (message ?? "").trim();
  return {
    message: text || "no message reported",
    schemaPending: looksLikePendingSchema(message),
  };
}

export type KnowledgeBaseRetrievalParams = {
  supabase: unknown;
  workspaceId: string | null | undefined;
  projectId?: string | null;
  query: string;
  limit?: number;
};

/**
 * Retrieve the top Knowledge Base chunks matching `query` for a workspace,
 * optionally narrowed to a project (which also includes workspace-wide docs),
 * REPORTING the outcome instead of flattening it.
 *
 * The three no-passage outcomes are kept apart because a planner is owed a
 * different sentence for each: nothing was asked (`searched: false`), the
 * search could not run (`error`), or the corpus held no match (neither).
 */
export async function loadKnowledgeBaseExcerpts(
  params: KnowledgeBaseRetrievalParams
): Promise<KnowledgeBaseExcerptRead> {
  const query = params.query.replace(/\s+/g, " ").trim();
  if (!query || !params.workspaceId) return { excerpts: [], error: null, searched: false };

  const client = params.supabase as RpcClient;
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await client.rpc("kb_search_chunks", {
      p_workspace_id: params.workspaceId,
      p_project_id: params.projectId ?? null,
      p_query: query,
      p_limit: params.limit ?? 6,
    });
  } catch (thrown) {
    return {
      excerpts: [],
      error: failure(thrown instanceof Error ? thrown.message : String(thrown)),
      searched: true,
    };
  }

  if (result.error) {
    return { excerpts: [], error: failure(result.error.message), searched: true };
  }
  if (!Array.isArray(result.data)) {
    // A set-returning RPC answers with an array. Anything else is an answer
    // this module cannot read, which is a failed read — not an empty corpus.
    return {
      excerpts: [],
      error: failure(`the search returned ${typeof result.data}, not a result set`),
      searched: true,
    };
  }

  return {
    excerpts: (result.data as RpcRow[]).map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      docKind: row.doc_kind,
      pageFrom: row.page_from,
      pageTo: row.page_to,
      chunkIndex: row.chunk_index,
      snippet: toSnippet(row.content ?? ""),
      rank: typeof row.rank === "number" ? row.rank : 0,
    })),
    error: null,
    searched: true,
  };
}

/**
 * @deprecated Best-effort adapter — it DROPS the failure `loadKnowledgeBaseExcerpts`
 * reports, so its callers cannot tell an unreadable Knowledge Base from a corpus
 * with nothing to say, and none of them discloses the difference to the planner
 * or to the audit log. Call `loadKnowledgeBaseExcerpts` and surface the error.
 * The remaining call sites are enumerated in
 * `src/test/knowledge-base-retrieval.test.ts`, which fails if that list grows.
 */
export async function retrieveKnowledgeBaseExcerpts(
  params: KnowledgeBaseRetrievalParams
): Promise<KnowledgeBaseExcerpt[]> {
  const { excerpts } = await loadKnowledgeBaseExcerpts(params);
  return excerpts;
}
