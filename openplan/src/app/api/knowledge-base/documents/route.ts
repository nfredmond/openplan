import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
// Pure magic-byte sniffer (zero imports of its own): the BYTES decide whether
// an "image" is an image, never the Content-Type header.
import { sniffImageFormat } from "@/lib/aerial/imagery";
import {
  buildKbChunkRows,
  buildKbDocumentPath,
  checkWorkspaceMembership,
  insertKbChunks,
  KB_DOCUMENT_COLUMNS,
  KB_DOCUMENT_MAX_BYTES_ENV,
  KB_DOCUMENTS_BUCKET,
  KB_STORED_DOCUMENT_NOTICE,
  looksLikePendingSchema,
  resolveKbDocumentMaxBytes,
  type WorkspaceMembershipResult,
} from "@/lib/knowledge-base/documents";
import {
  buildKbDocumentNameFilter,
  KB_DOCUMENT_LIST_LIMIT,
  resolveKbDocumentListFilters,
  resolveKbDocumentOrder,
} from "@/lib/knowledge-base/document-list-filters";
import { KB_DOC_KINDS, type KbDocKind } from "@/lib/knowledge-base/types";
import { chunkExtractedDocument } from "@/lib/knowledge-base/chunk";
import {
  DocumentParseError,
  extractDocument,
  NoExtractableTextError,
  resolveSourceKind,
  resolveStoredSourceKind,
} from "@/lib/knowledge-base/extract";

// Extraction (unpdf/mammoth) runs inline; allow more than the default budget on
// hosted platforms for larger PDFs.
export const runtime = "nodejs";
export const maxDuration = 60;

const uploadQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  // Derived from the shared taxonomy so a doc kind added there (e.g. 'drawing',
  // 'exhibit' in 20260811000005) is uploadable without re-typing the list here.
  docKind: z.enum(KB_DOC_KINDS as [KbDocKind, ...KbDocKind[]]).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  filename: z.string().trim().max(255).optional(),
});

const listQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  // Narrowing the list happens HERE, not in the browser: the read is capped, so
  // a name filter applied to the rows already loaded would leave the documents
  // past the cap exactly as unfindable as before. Every value is normalized by
  // `resolveKbDocumentListFilters`, which is why they are permissive strings
  // rather than a strict enum or date — a value it cannot use is disclosed as
  // unapplied, never a 400 a planner has to decode.
  q: z.string().max(200).optional(),
  sort: z.string().max(20).optional(),
  addedFrom: z.string().max(10).optional(),
  addedTo: z.string().max(10).optional(),
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

    if (isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
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
    // Extractable resolution first (those documents become citable); stored
    // resolution second; genuinely unknown formats stay on the 415 path.
    const extractableKind = resolveSourceKind(declaredContentType, query.data.filename);
    const storedResolution =
      !extractableKind || extractableKind === "pasted_text"
        ? resolveStoredSourceKind(declaredContentType, query.data.filename)
        : null;
    if ((!extractableKind || extractableKind === "pasted_text") && !storedResolution) {
      return NextResponse.json(
        {
          error:
            "Unsupported document type. Upload a PDF, Word (.docx), plain-text, or Markdown file " +
            "(these are indexed for citation), or an image (JPEG/PNG/TIFF), spreadsheet " +
            "(.csv/.xlsx/.xls/.ods), CAD file (.dwg/.dxf), or office document " +
            "(.pptx/.ppt/.doc/.rtf/.odt/.odp) to store for reference.",
        },
        { status: 415 }
      );
    }

    // The ceiling is the operator's, resolved per request so raising the env
    // takes effect without a redeploy. Streamed: at 100 MiB, buffer-then-check
    // would be the allocation the limit exists to prevent.
    const maxBytes = resolveKbDocumentMaxBytes();
    const bodyRead = await readBytesWithLimitStreaming(request, maxBytes);
    if (!bodyRead.ok) {
      audit.warn("kb_document_body_too_large", {
        byteLength: bodyRead.byteLength,
        maxBytes,
      });
      return NextResponse.json(
        {
          error:
            `This file is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MiB per-file ceiling of this ` +
            `deployment. Whoever operates it can raise ${KB_DOCUMENT_MAX_BYTES_ENV} — OpenPlan itself is free ` +
            "and has no usage tiers.",
          maxBytes,
        },
        { status: 413 }
      );
    }
    if (bodyRead.byteLength === 0) {
      return NextResponse.json({ error: "The uploaded document is empty" }, { status: 400 });
    }

    // For an image, the BYTES decide — cameras and transfer tools mislabel
    // routinely, and a "photo" no viewer can open is worth catching at the door.
    let storedContentType = storedResolution?.contentType ?? null;
    if (storedResolution?.kind === "uploaded_image") {
      const sniffed = sniffImageFormat(bodyRead.bytes);
      if (!sniffed) {
        return NextResponse.json(
          {
            error:
              "This file was named or labeled as an image, but its contents are not a JPEG, PNG, or TIFF. " +
              "Nothing was stored.",
          },
          { status: 415 }
        );
      }
      storedContentType = sniffed.contentType;
    }

    const checksum = createHash("sha256").update(bodyRead.bytes).digest("hex");
    const service = createServiceRoleClient();

    // Idempotent dedup: a byte-identical document already ingested in this
    // workspace — parsed (`ready`) or kept (`stored`) — is returned as-is
    // instead of re-ingesting. Failed rows are NOT deduped against: re-upload
    // is the retry path.
    const existingResult = await service
      .from("kb_documents")
      .select(KB_DOCUMENT_COLUMNS)
      .eq("workspace_id", query.data.workspaceId)
      .eq("checksum", checksum)
      .in("status", ["ready", "stored"])
      .limit(1)
      .maybeSingle();

    // VERDICT: this probe is benign, and the upload deliberately continues when
    // it fails. Nothing in the response claims the document is new — a failed
    // probe costs a duplicate row, not a false statement — so refusing the
    // upload would be the worse answer. What is NOT optional is observing the
    // error: a probe that failed every time would silently turn dedup off, and
    // this log is the only place that would say so.
    if (existingResult.error) {
      audit.warn("kb_document_dedup_probe_failed", { message: existingResult.error.message });
    }
    if (existingResult.data) {
      return NextResponse.json({ document: existingResult.data, deduped: true }, { status: 200 });
    }

    const documentId = randomUUID();
    const storagePath = buildKbDocumentPath(query.data.workspaceId, documentId, query.data.filename);

    const { error: uploadError } = await service.storage
      .from(KB_DOCUMENTS_BUCKET)
      .upload(storagePath, bodyRead.bytes, {
        // Stored kinds are recorded and served under the canonical type the
        // accept list (or the image sniff) resolved, never the raw header.
        contentType: storedResolution ? (storedContentType ?? declaredContentType) : declaredContentType,
        upsert: false,
      });
    if (uploadError) {
      audit.error("kb_document_storage_upload_failed", { message: uploadError.message });
      return NextResponse.json({ error: "Failed to store the document" }, { status: 500 });
    }

    // ------------------------------------------------------------------
    // STORED branch: keep the bytes, record the row, and STOP. No
    // extraction, no chunks — a stored document must never become
    // groundable by accident, and the absence of chunk rows (plus the
    // RPC's status = 'ready' filter) is what makes that structural.
    // ------------------------------------------------------------------
    if (storedResolution) {
      const { data: document, error: insertError } = await service
        .from("kb_documents")
        .insert({
          id: documentId,
          workspace_id: query.data.workspaceId,
          project_id: query.data.projectId ?? null,
          uploaded_by: user.id,
          title: deriveTitle(query.data.title, query.data.filename),
          doc_kind: query.data.docKind ?? "other",
          source_kind: storedResolution.kind,
          original_filename: query.data.filename ?? null,
          content_type: storedContentType,
          byte_size: bodyRead.byteLength,
          storage_ref: `storage://${KB_DOCUMENTS_BUCKET}/${storagePath}`,
          page_count: null,
          chunk_count: 0,
          char_count: null,
          checksum,
          status: "stored",
          extraction_error: null,
          extraction_source: "none",
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

      audit.info("kb_document_stored", {
        workspaceId: query.data.workspaceId,
        documentId,
        sourceKind: storedResolution.kind,
        bytes: bodyRead.byteLength,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { document, stored: true, notice: KB_STORED_DOCUMENT_NOTICE },
        { status: 201 }
      );
    }

    // Every non-extractable accepted format returned inside the stored branch,
    // so reaching here with no extractable kind is a logic error — refuse
    // rather than cast past the type system.
    if (!extractableKind || extractableKind === "pasted_text") {
      return NextResponse.json({ error: "Unsupported document type." }, { status: 415 });
    }
    const sourceKind = extractableKind;

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
        // Where the indexed text came from — nothing was indexed on failure,
        // so a failed row honestly records no source.
        extraction_source: extractionError ? null : "text_layer",
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

    const filters = resolveKbDocumentListFilters({
      q: query.data.q,
      sort: query.data.sort,
      addedFrom: query.data.addedFrom,
      addedTo: query.data.addedTo,
    });
    const order = resolveKbDocumentOrder(filters.sort);

    let builder = supabase
      .from("kb_documents")
      .select(KB_DOCUMENT_COLUMNS)
      .eq("workspace_id", query.data.workspaceId)
      .order(order.column, { ascending: order.ascending })
      .limit(KB_DOCUMENT_LIST_LIMIT);
    if (query.data.projectId) {
      builder = builder.eq("project_id", query.data.projectId);
    }
    if (filters.nameTerm) {
      builder = builder.or(buildKbDocumentNameFilter(filters.nameTerm));
    }
    if (filters.addedFrom) {
      builder = builder.gte("created_at", filters.addedFrom);
    }
    if (filters.addedTo) {
      builder = builder.lte("created_at", filters.addedTo);
    }

    const { data: documents, error } = await builder;
    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return membershipErrorResponse({ ok: false, kind: "schema_pending", message: "" });
      }
      audit.error("kb_documents_list_failed", { message: error.message });
      return NextResponse.json({ error: "Failed to list documents" }, { status: 500 });
    }

    // `appliedFilters` is what the read DID, not what was asked for. A date the
    // route could not parse comes back absent, so the screen can say the filter
    // was not applied instead of showing an unnarrowed list under a narrowed
    // caption.
    return NextResponse.json(
      {
        documents: documents ?? [],
        appliedFilters: filters,
        limit: KB_DOCUMENT_LIST_LIMIT,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("kb_documents_list_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while listing documents" }, { status: 500 });
  }
}
