import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import {
  KB_DOCUMENT_COLUMNS,
  KB_DOCUMENTS_BUCKET,
  looksLikePendingSchema,
} from "@/lib/knowledge-base/documents";

export const runtime = "nodejs";

/** Max chunks returned in the detail preview, and the per-chunk display cap. */
const PREVIEW_CHUNK_LIMIT = 12;
const PREVIEW_CHUNK_CHARS = 600;

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Whether anything cites this document, and if so a sentence naming it — the
 * "refuses by NAME, stating the cycle and the count" the RESTRICT foreign keys
 * on `rtp_extraction_runs.kb_document_id` and `measure_claim_documents` promise.
 *
 * A `message` means refuse; `failed` means the check itself errored and the
 * caller must not proceed (a dependency read that silently returned nothing
 * would delete a cited source). The database RESTRICT is the real guarantee —
 * this exists to turn a generic 23503 into something a planner can act on.
 */
async function describeDependenciesBlockingDelete(
  service: ServiceClient,
  documentId: string
): Promise<{ message: string | null; failed: boolean }> {
  const extractionResult = await service
    .from("rtp_extraction_runs")
    .select("rtp_cycle_id, rtp_cycles(title)")
    .eq("kb_document_id", documentId);
  if (extractionResult.error) return { message: null, failed: true };

  const claimResult = await service
    .from("measure_claim_documents")
    .select("id")
    .eq("kb_document_id", documentId);
  if (claimResult.error) return { message: null, failed: true };

  const portfolioImportResult = await service
    .from("project_portfolio_import_batches")
    .select("id")
    .or(
      `source_document_id.eq.${documentId},original_workbook_document_id.eq.${documentId}`
    );
  if (portfolioImportResult.error) return { message: null, failed: true };

  const extractionRows = (extractionResult.data ?? []) as Array<{
    rtp_cycles: { title?: string | null } | { title?: string | null }[] | null;
  }>;
  const claimCount = (claimResult.data ?? []).length;
  const portfolioImportCount = (portfolioImportResult.data ?? []).length;

  if (extractionRows.length === 0 && claimCount === 0 && portfolioImportCount === 0) {
    return { message: null, failed: false };
  }

  const parts: string[] = [];
  if (extractionRows.length > 0) {
    const cycleTitles = Array.from(
      new Set(
        extractionRows
          .map((row) => {
            const cycle = Array.isArray(row.rtp_cycles) ? row.rtp_cycles[0] : row.rtp_cycles;
            return typeof cycle?.title === "string" ? cycle.title.trim() : "";
          })
          .filter((title) => title.length > 0)
      )
    );
    const cycleClause = cycleTitles.length
      ? ` in ${cycleTitles.length === 1 ? "the RTP cycle" : "RTP cycles"} "${cycleTitles.join('", "')}"`
      : "";
    parts.push(
      `${extractionRows.length} adopted-plan extraction${extractionRows.length === 1 ? "" : "s"}${cycleClause}`
    );
  }
  if (claimCount > 0) {
    parts.push(`${claimCount} measure claim${claimCount === 1 ? "" : "s"}`);
  }
  if (portfolioImportCount > 0) {
    parts.push(
      `${portfolioImportCount} durable project portfolio import${portfolioImportCount === 1 ? "" : "s"}`
    );
  }

  return {
    message:
      `This document backs ${parts.join(" and ")}. Deleting it would strand those citations on ` +
      "records the workspace still shows, so it cannot be removed while they exist. Detach or " +
      "remove those first.",
    failed: false,
  };
}

const paramsSchema = z.object({ documentId: z.string().uuid() });

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("knowledge_base.documents.detail", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // RLS scopes this to the caller's workspaces, so a hit already proves access.
    const { data: document, error } = await supabase
      .from("kb_documents")
      .select(KB_DOCUMENT_COLUMNS)
      .eq("id", parsedParams.data.documentId)
      .maybeSingle();

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json({ error: "Knowledge Base schema is not available yet" }, { status: 503 });
      }
      audit.error("kb_document_detail_failed", { message: error.message });
      return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
    }
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const chunksResult = await supabase
      .from("kb_document_chunks")
      .select("id, chunk_index, page_from, page_to, token_estimate, content")
      .eq("document_id", parsedParams.data.documentId)
      .order("chunk_index", { ascending: true })
      .limit(PREVIEW_CHUNK_LIMIT);

    // The preview is an extra, so a failure here does not withhold the document
    // — but it is disclosed rather than dropped: an empty `chunks` next to a
    // chunk_count of 40 reads as "none of it was indexed", which is a claim this
    // read did not establish.
    if (chunksResult.error) {
      audit.warn("kb_document_chunk_preview_failed", { message: chunksResult.error.message });
    }

    const preview = (chunksResult.data ?? []).map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunk_index,
      pageFrom: chunk.page_from,
      pageTo: chunk.page_to,
      tokenEstimate: chunk.token_estimate,
      excerpt:
        typeof chunk.content === "string" && chunk.content.length > PREVIEW_CHUNK_CHARS
          ? `${chunk.content.slice(0, PREVIEW_CHUNK_CHARS)}…`
          : chunk.content,
    }));

    return NextResponse.json(
      { document, chunks: preview, chunksUnreadable: Boolean(chunksResult.error) },
      { status: 200 }
    );
  } catch (error) {
    audit.error("kb_document_detail_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while loading document" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("knowledge_base.documents.delete", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Loading through the RLS client confirms the caller is a member of the
    // document's workspace before any service-role write happens.
    const { data: document, error } = await supabase
      .from("kb_documents")
      .select("id, storage_ref, workspace_id")
      .eq("id", parsedParams.data.documentId)
      .maybeSingle();

    if (error) {
      audit.error("kb_document_delete_lookup_failed", { message: error.message });
      return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
    }
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Visibility proves membership, not write authority — the viewer tier can
    // read this document but may not delete it.
    const membershipResult = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", document.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    // A read that failed established no role, so the delete stops here. The
    // earlier `{ data: membership }` form dropped the error, left the role
    // undefined, answered "is this a viewer?" with no, and deleted the document
    // on a permission check that never ran. 403 would be the same mistake
    // pointing the other way: it asserts a viewer role nobody read either.
    if (membershipResult.error) {
      audit.error("kb_document_delete_role_check_failed", {
        message: membershipResult.error.message,
      });
      return NextResponse.json(
        {
          error:
            "We could not confirm your role in this workspace, so the document was not deleted. Try again in a moment.",
        },
        { status: 500 }
      );
    }

    if (isReadOnlyWorkspaceRole((membershipResult.data as { role?: string } | null)?.role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }

    const service = createServiceRoleClient();
    const documentId = parsedParams.data.documentId;

    // A document that backs figures in an adopted plan or a measure claim may
    // not be deleted — two migrations make that a RESTRICT foreign key and
    // promise "the delete route refuses by NAME instead, stating the cycle and
    // the count." That refusal is BUILT HERE. Named refusal first, so the
    // planner learns what depends on the file; and because we check before
    // touching anything, the bytes are safe even for a dependency this code
    // does not yet know about (see the ordering note below).
    const refusal = await describeDependenciesBlockingDelete(service, documentId);
    if (refusal.failed) {
      audit.error("kb_document_delete_dependency_check_failed", { message: refusal.message });
      return NextResponse.json(
        { error: "We could not check what depends on this document, so it was not deleted." },
        { status: 500 }
      );
    }
    if (refusal.message) {
      audit.info("kb_document_delete_refused_dependency", { documentId, reason: refusal.message });
      return NextResponse.json({ error: refusal.message }, { status: 409 });
    }

    // THE ROW GOES FIRST, THE BYTES SECOND, AND THE ORDER IS THE WHOLE FIX.
    // This route used to remove the storage object first, "best-effort", then
    // delete the row. When a RESTRICT dependency existed the row delete failed
    // 23503 — but the only copy of the file was already gone, leaving the row
    // 'ready' and still cited on the public plan page with a download link that
    // 500s at signing (found 2026-08-17). Deleting the row first means the
    // database's own RESTRICT is a second guard behind the check above: if it
    // fires, nothing has been destroyed and we refuse.
    const { error: deleteError } = await service
      .from("kb_documents")
      .delete()
      .eq("id", documentId);
    if (deleteError) {
      // 23503 = a dependency the pre-check did not cover (e.g. a new referrer,
      // or a row inserted between the check and here). The bytes are intact.
      const isForeignKeyViolation =
        (deleteError as { code?: string }).code === "23503" ||
        /foreign key/i.test(deleteError.message);
      audit.error("kb_document_delete_failed", {
        message: deleteError.message,
        foreignKey: isForeignKeyViolation,
      });
      return NextResponse.json(
        {
          error: isForeignKeyViolation
            ? "This document is cited by other records in the workspace and cannot be deleted while they exist."
            : "Failed to delete document",
        },
        { status: isForeignKeyViolation ? 409 : 500 }
      );
    }

    // The row (and its chunks, by cascade) is gone; now the bytes. Best-effort:
    // an orphaned object is recoverable, a deleted-then-failed row was not.
    const storageRef = typeof document.storage_ref === "string" ? document.storage_ref : null;
    const prefix = `storage://${KB_DOCUMENTS_BUCKET}/`;
    if (storageRef && storageRef.startsWith(prefix)) {
      const objectPath = storageRef.slice(prefix.length);
      if (objectPath && !objectPath.includes("..")) {
        await service.storage.from(KB_DOCUMENTS_BUCKET).remove([objectPath]);
      }
    }

    audit.info("kb_document_deleted", { documentId, userId: user.id });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    audit.error("kb_document_delete_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while deleting document" }, { status: 500 });
  }
}
