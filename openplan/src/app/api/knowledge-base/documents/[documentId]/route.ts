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

    // Remove the stored object first (best-effort); the row + chunks are the
    // authoritative record and cascade on the row delete.
    const storageRef = typeof document.storage_ref === "string" ? document.storage_ref : null;
    const prefix = `storage://${KB_DOCUMENTS_BUCKET}/`;
    if (storageRef && storageRef.startsWith(prefix)) {
      const objectPath = storageRef.slice(prefix.length);
      if (objectPath && !objectPath.includes("..")) {
        await service.storage.from(KB_DOCUMENTS_BUCKET).remove([objectPath]);
      }
    }

    const { error: deleteError } = await service
      .from("kb_documents")
      .delete()
      .eq("id", parsedParams.data.documentId);
    if (deleteError) {
      audit.error("kb_document_delete_failed", { message: deleteError.message });
      return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
    }

    audit.info("kb_document_deleted", { documentId: parsedParams.data.documentId, userId: user.id });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    audit.error("kb_document_delete_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while deleting document" }, { status: 500 });
  }
}
