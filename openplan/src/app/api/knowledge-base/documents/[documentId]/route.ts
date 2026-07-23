import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
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

    const { data: chunks } = await supabase
      .from("kb_document_chunks")
      .select("id, chunk_index, page_from, page_to, token_estimate, content")
      .eq("document_id", parsedParams.data.documentId)
      .order("chunk_index", { ascending: true })
      .limit(PREVIEW_CHUNK_LIMIT);

    const preview = (chunks ?? []).map((chunk) => ({
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

    return NextResponse.json({ document, chunks: preview }, { status: 200 });
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
      .select("id, storage_ref")
      .eq("id", parsedParams.data.documentId)
      .maybeSingle();

    if (error) {
      audit.error("kb_document_delete_lookup_failed", { message: error.message });
      return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
    }
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
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
