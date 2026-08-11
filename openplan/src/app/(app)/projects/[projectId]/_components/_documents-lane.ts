import { loadDocumentLibrary } from "@/lib/document-library/query";
import type { DocumentLibraryResult } from "@/lib/document-library/types";

/**
 * The project page's documents lane: one call that answers both questions the
 * page asks about files.
 *
 * 1. `kbCount` — the EXACT head-count of Knowledge Base documents attached to
 *    this project, for the posture header. This stays its own query on purpose:
 *    the library listing below is per-source CAPPED (`limitPerSource`), so
 *    deriving the header's number from it would silently understate any project
 *    holding more documents than the cap — a count is a claim, and a truncated
 *    listing cannot support it.
 * 2. `library` — the project's slice of the Document Library: every file
 *    OpenPlan holds or can produce for this project, read live from each owning
 *    module's table with THIS caller's RLS client, failures disclosed per
 *    source (`perSource` + `reads`), never rendered as emptiness.
 *
 * HONEST NULL, kept exactly as the inline read it replaced: `kbCount` is null —
 * not 0 — when the head-count read fails for any reason (schema pending, policy
 * change, dropped connection). "0 documents" is a claim about the project that
 * a broken query cannot support, and zero is the reassuring direction of the
 * error: a planner who sees it stops looking. The posture header renders null
 * as "count unavailable" (`project-posture-header.tsx`).
 */

type KbHeadCountResult = {
  count: number | null;
  error: { message?: string | null } | null;
};

/**
 * The one chain the head-count uses, typed structurally like every lane on
 * this page — the repo's Supabase clients are deliberately untyped.
 */
type KbHeadCountClient = {
  from(table: string): {
    select(
      columns: string,
      options: { count: "exact"; head: true }
    ): {
      eq(column: string, value: string): PromiseLike<KbHeadCountResult>;
    };
  };
};

export type ProjectDocumentsLane = {
  /** Exact Knowledge Base document count for the posture header; null = unavailable, never presented as zero. */
  kbCount: number | null;
  /** The project's slice of the Document Library, with per-source read outcomes. */
  library: DocumentLibraryResult;
};

export async function loadProjectDocumentsLane(
  supabase: unknown,
  projectId: string,
  workspaceId: string
): Promise<ProjectDocumentsLane> {
  const [headCount, library] = await Promise.all([
    (async (): Promise<KbHeadCountResult> => {
      try {
        return await (supabase as KbHeadCountClient)
          .from("kb_documents")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId);
      } catch (error) {
        // A thrown read is still a failed read: it must land in the null
        // (count unavailable) arm, never in the zero one.
        return {
          count: null,
          error: { message: error instanceof Error ? error.message : "read threw" },
        };
      }
    })(),
    loadDocumentLibrary(supabase, { workspaceId, projectId }),
  ]);

  const kbCount = headCount.error ? null : (headCount.count ?? 0);
  return { kbCount, library };
}
