import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readBytesWithLimit } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  buildKbChunkRows,
  buildKbDocumentPath,
  checkWorkspaceMembership,
  insertKbChunks,
  KB_DOCUMENT_COLUMNS,
  KB_DOCUMENTS_BUCKET,
  looksLikePendingSchema,
  type WorkspaceMembershipResult,
} from "@/lib/knowledge-base/documents";
import { chunkExtractedDocument } from "@/lib/knowledge-base/chunk";
import {
  DocumentParseError,
  extractDocument,
  NoExtractableTextError,
  resolveSourceKind,
} from "@/lib/knowledge-base/extract";

// Extraction (unpdf/mammoth) runs inline; allow more than the default budget on
// hosted platforms for larger PDFs.
export const runtime = "nodejs";
export const maxDuration = 60;

const uploadQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  docKind: z
    .enum(["rtp", "comment_letter", "prior_study", "nofo", "staff_report", "policy", "other"])
    .optional(),
  title: z.string().trim().min(1).max(200).optional(),
  filename: z.string().trim().max(255).optional(),
});

const listQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
});

function membershipErrorResponse(result: Extract<WorkspaceMembershipResult, { ok: false }>) {
  if (result.kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Knowledge Base schema is not available yet",
        hint: "Apply the latest Supabase migrations before using the Knowledge Base.",
      },
      { status: 503 }
    );
  }
  if (result.kind === "not_member") {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
}

function deriveTitle(explicit: string | undefined, filename: string | undefined): string {
  if (explicit) return explicit;
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  const withoutExt = base.replace(/\.[^.]+$/, "").trim();
  return withoutExt || "Untitled document";
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("knowledge_base.documents.upload", request);
  const startedAt = Date.now();

  try {
    const query = uploadQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json({ error: "Invalid upload parameters" }, { status: 400 });
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
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
      }
      return membershipErrorResponse(membership);
    }

    if (query.data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id")
        .eq("id", query.data.projectId)
        .eq("workspace_id", query.data.workspaceId)
        .maybeSingle();
      if (projectError) {
        return NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 });
      }
      if (!project) {
        return NextResponse.json({ error: "Linked project not found" }, { status: 404 });
      }
    }

    const declaredContentType = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const sourceKind = resolveSourceKind(declaredContentType, query.data.filename);
    if (!sourceKind || sourceKind === "pasted_text") {
      return NextResponse.json(
        {
          error:
            "Unsupported document type. Upload a PDF, Word (.docx), plain-text, or Markdown file.",
        },
        { status: 415 }
      );
    }

    const bodyRead = await readBytesWithLimit(request, BODY_LIMITS.kbDocumentRaw);
    if (!bodyRead.ok) {
      audit.warn("kb_document_body_too_large", {
        byteLength: bodyRead.byteLength,
        maxBytes: BODY_LIMITS.kbDocumentRaw,
      });
      return bodyRead.response;
    }
    if (bodyRead.byteLength === 0) {
      return NextResponse.json({ error: "The uploaded document is empty" }, { status: 400 });
    }

    const checksum = createHash("sha256").update(bodyRead.bytes).digest("hex");
    const service = createServiceRoleClient();

    // Idempotent dedup: a byte-identical document already parsed in this
    // workspace is returned as-is instead of re-ingesting.
    const { data: existing } = await service
      .from("kb_documents")
      .select(KB_DOCUMENT_COLUMNS)
      .eq("workspace_id", query.data.workspaceId)
      .eq("checksum", checksum)
      .eq("status", "ready")
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ document: existing, deduped: true }, { status: 200 });
    }

    const documentId = randomUUID();
    const storagePath = buildKbDocumentPath(query.data.workspaceId, documentId, query.data.filename);

    const { error: uploadError } = await service.storage
      .from(KB_DOCUMENTS_BUCKET)
      .upload(storagePath, bodyRead.bytes, { contentType: declaredContentType, upsert: false });
    if (uploadError) {
      audit.error("kb_document_storage_upload_failed", { message: uploadError.message });
      return NextResponse.json({ error: "Failed to store the document" }, { status: 500 });
    }

    // Extract + chunk BEFORE inserting the row so the persisted status is honest
    // (ready with real chunks, or failed with a real reason) in one write.
    let extractionError: string | null = null;
    let pageCount = 0;
    let charCount = 0;
    let chunkRows: Array<Record<string, unknown>> = [];
    try {
      const extracted = await extractDocument(bodyRead.bytes, sourceKind);
      const chunks = chunkExtractedDocument(extracted.pages);
      pageCount = extracted.pageCount;
      charCount = extracted.charCount;
      chunkRows = buildKbChunkRows(documentId, query.data.workspaceId, chunks);
    } catch (error) {
      if (error instanceof NoExtractableTextError || error instanceof DocumentParseError) {
        extractionError = error.message;
      } else {
        // Unexpected failure: remove the orphaned object and surface a 500.
        await service.storage.from(KB_DOCUMENTS_BUCKET).remove([storagePath]);
        audit.error("kb_document_extraction_unexpected", {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: "Failed to process the document" }, { status: 500 });
      }
    }

    const status = extractionError ? "failed" : "ready";
    const { data: document, error: insertError } = await service
      .from("kb_documents")
      .insert({
        id: documentId,
        workspace_id: query.data.workspaceId,
        project_id: query.data.projectId ?? null,
        uploaded_by: user.id,
        title: deriveTitle(query.data.title, query.data.filename),
        doc_kind: query.data.docKind ?? "other",
        source_kind: sourceKind,
        original_filename: query.data.filename ?? null,
        content_type: declaredContentType,
        byte_size: bodyRead.byteLength,
        storage_ref: `storage://${KB_DOCUMENTS_BUCKET}/${storagePath}`,
        page_count: extractionError ? null : pageCount,
        chunk_count: chunkRows.length,
        char_count: extractionError ? null : charCount,
        checksum,
        status,
        extraction_error: extractionError,
      })
      .select(KB_DOCUMENT_COLUMNS)
      .single();

    if (insertError || !document) {
      await service.storage.from(KB_DOCUMENTS_BUCKET).remove([storagePath]);
      audit.error("kb_document_insert_failed", { message: insertError?.message ?? "unknown" });
      if (looksLikePendingSchema(insertError?.message)) {
        return membershipErrorResponse({ ok: false, kind: "schema_pending", message: "" });
      }
      return NextResponse.json({ error: "Failed to record the document" }, { status: 500 });
    }

    if (extractionError) {
      audit.info("kb_document_failed", {
        workspaceId: query.data.workspaceId,
        documentId,
        reason: extractionError,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ document, warning: extractionError }, { status: 201 });
    }

    // Persist chunks in bounded batches so a large document does not exceed the
    // PostgREST request size.
    const chunkError = await insertKbChunks(service, chunkRows);
    if (chunkError) {
      await service
        .from("kb_documents")
        .update({ status: "failed", extraction_error: "Failed to index document chunks." })
        .eq("id", documentId);
      audit.error("kb_document_chunk_insert_failed", { documentId, message: chunkError.message });
      return NextResponse.json({ error: "Failed to index the document" }, { status: 500 });
    }

    audit.info("kb_document_ready", {
      workspaceId: query.data.workspaceId,
      documentId,
      chunks: chunkRows.length,
      pages: pageCount,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    audit.error("kb_document_upload_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while uploading document" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("knowledge_base.documents.list", request);

  try {
    const query = listQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json({ error: "Invalid list parameters" }, { status: 400 });
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
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
      }
      return membershipErrorResponse(membership);
    }

    let builder = supabase
      .from("kb_documents")
      .select(KB_DOCUMENT_COLUMNS)
      .eq("workspace_id", query.data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (query.data.projectId) {
      builder = builder.eq("project_id", query.data.projectId);
    }

    const { data: documents, error } = await builder;
    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return membershipErrorResponse({ ok: false, kind: "schema_pending", message: "" });
      }
      audit.error("kb_documents_list_failed", { message: error.message });
      return NextResponse.json({ error: "Failed to list documents" }, { status: 500 });
    }

    return NextResponse.json({ documents: documents ?? [] }, { status: 200 });
  } catch (error) {
    audit.error("kb_documents_list_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while listing documents" }, { status: 500 });
  }
}
