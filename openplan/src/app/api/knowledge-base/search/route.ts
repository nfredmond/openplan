/**
 * Knowledge Base search — the planner-facing door to the `kb_search_chunks`
 * RPC that, until now, only the Planner Agent and the drafting routes could
 * open. A workspace could upload a corpus and had no way to look inside it.
 *
 * WHY THIS DOES NOT CALL `retrieveKnowledgeBaseExcerpts`. That helper is
 * best-effort BY CONTRACT: every failure — RPC missing, RLS refusal, thrown
 * client — returns `[]`, which is exactly right for a drafting route that must
 * degrade to its non-KB behavior, and exactly wrong here. On this surface `[]`
 * is rendered to a planner as "nothing in your documents matched", which is a
 * claim about their corpus that a FAILED READ MAY NOT MAKE. So this route
 * calls the RPC itself and reports the three outcomes apart: schema not
 * applied (503), read failed (500), read succeeded with zero rows (200 + an
 * empty list the UI may honestly call "no matches").
 *
 * The duplicated part is only the row -> excerpt mapping. The right end state
 * is an outcome-returning core in `src/lib/knowledge-base/retrieval.ts`
 * (`{ ok: true, excerpts } | { ok: false, reason }`) that both this route and
 * the best-effort helper share; `src/test/knowledge-base-search.test.tsx`
 * carries a divergence guard asserting both callers invoke the same RPC with
 * the same argument names until that consolidation happens.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { checkWorkspaceMembership, looksLikePendingSchema } from "@/lib/workspaces/membership";
import {
  KB_EXCERPT_SNIPPET_CHARS,
  type KnowledgeBaseExcerpt,
} from "@/lib/knowledge-base/retrieval";

// Module-local by necessity: Next.js rejects any export from a `route.ts` that
// is not one of its own route fields, so these cannot be shared from here.
/** Hard ceiling mirrors the RPC's own `LEAST(GREATEST(limit,1),25)`. */
const KB_SEARCH_MAX_LIMIT = 25;
const KB_SEARCH_DEFAULT_LIMIT = 10;

const searchQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(KB_SEARCH_MAX_LIMIT).optional(),
});

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

function toSnippet(content: string): string {
  const collapsed = (content ?? "").replace(/\s+/g, " ").trim();
  return collapsed.length > KB_EXCERPT_SNIPPET_CHARS
    ? `${collapsed.slice(0, KB_EXCERPT_SNIPPET_CHARS).trimEnd()}…`
    : collapsed;
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("knowledge_base.search", request);

  try {
    const query = searchQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json(
        {
          error: "Invalid search parameters",
          hint: "A workspace and a search term of 1–500 characters are required.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, query.data.workspaceId);
    if (!membership.ok) {
      if (membership.kind === "schema_pending") {
        return NextResponse.json(
          {
            error: "Knowledge Base schema is not available yet",
            hint: "Apply the latest Supabase migrations before searching the Knowledge Base.",
          },
          { status: 503 }
        );
      }
      if (membership.kind === "not_member") {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      audit.error("membership_lookup_failed", { message: membership.message });
      return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
    }

    // A project narrow is only meaningful for a project of THIS workspace. A
    // foreign id is refused rather than quietly searched workspace-wide, so an
    // empty result can never come from a scope the planner did not choose.
    if (query.data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id")
        .eq("id", query.data.projectId)
        .eq("workspace_id", query.data.workspaceId)
        .maybeSingle();
      if (projectError) {
        audit.error("kb_search_project_lookup_failed", { message: projectError.message });
        return NextResponse.json({ error: "Failed to verify the selected project" }, { status: 500 });
      }
      if (!project) {
        return NextResponse.json({ error: "Selected project not found" }, { status: 404 });
      }
    }

    const limit = query.data.limit ?? KB_SEARCH_DEFAULT_LIMIT;

    // SECURITY INVOKER: the RPC runs under the caller's RLS, so this cannot
    // read another workspace's chunks even though the id arrives from the URL.
    let result: { data: unknown; error: { message: string } | null };
    try {
      result = await supabase.rpc("kb_search_chunks", {
        p_workspace_id: query.data.workspaceId,
        p_project_id: query.data.projectId ?? null,
        p_query: query.data.q,
        p_limit: limit,
      });
    } catch (thrown) {
      audit.error("kb_search_rpc_threw", {
        error: thrown instanceof Error ? thrown.message : String(thrown),
      });
      return NextResponse.json(
        {
          error: "The Knowledge Base search could not be run",
          hint: "This is a read failure, not an empty result — your documents were not searched.",
        },
        { status: 500 }
      );
    }

    if (result.error) {
      if (looksLikePendingSchema(result.error.message)) {
        return NextResponse.json(
          {
            error: "Knowledge Base search is not available yet",
            hint: "Apply the latest Supabase migrations before searching the Knowledge Base.",
          },
          { status: 503 }
        );
      }
      audit.error("kb_search_rpc_failed", { message: result.error.message });
      return NextResponse.json(
        {
          error: "The Knowledge Base search could not be run",
          hint: "This is a read failure, not an empty result — your documents were not searched.",
        },
        { status: 500 }
      );
    }

    if (!Array.isArray(result.data)) {
      audit.error("kb_search_rpc_unexpected_shape", { received: typeof result.data });
      return NextResponse.json(
        {
          error: "The Knowledge Base search could not be run",
          hint: "This is a read failure, not an empty result — your documents were not searched.",
        },
        { status: 500 }
      );
    }

    const excerpts: KnowledgeBaseExcerpt[] = (result.data as RpcRow[]).map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      docKind: row.doc_kind,
      pageFrom: row.page_from,
      pageTo: row.page_to,
      chunkIndex: row.chunk_index,
      snippet: toSnippet(row.content),
      rank: typeof row.rank === "number" ? row.rank : 0,
    }));

    audit.info("kb_search_completed", {
      workspaceId: query.data.workspaceId,
      projectId: query.data.projectId ?? null,
      queryLength: query.data.q.length,
      matches: excerpts.length,
      limit,
    });

    return NextResponse.json(
      { query: query.data.q, projectId: query.data.projectId ?? null, limit, excerpts },
      { status: 200 }
    );
  } catch (error) {
    audit.error("kb_search_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while searching the Knowledge Base" },
      { status: 500 }
    );
  }
}
