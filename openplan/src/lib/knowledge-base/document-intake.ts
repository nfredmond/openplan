import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import type { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
// Pure magic-byte sniffer (zero imports of its own): the BYTES decide whether
// an "image" is an image, never the Content-Type header.
import { sniffImageFormat } from "@/lib/aerial/imagery";
import { enqueueExtraction } from "@/lib/knowledge-base/extraction-jobs";
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
  type WorkspaceMembershipResult,
} from "@/lib/knowledge-base/documents";
import type { KbDocKind, KbExtractableSourceKind } from "@/lib/knowledge-base/types";
import { chunkExtractedDocument } from "@/lib/knowledge-base/chunk";
import {
  DocumentParseError,
  extractDocument,
  NoExtractableTextError,
  resolveSourceKind,
  resolveStoredSourceKind,
  type StoredResolution,
} from "@/lib/knowledge-base/extract";
import { checkWorkspaceStorageRoom, workspaceStorageRefusal } from "@/lib/workspaces/storage-quota";

/**
 * What every Knowledge Base file upload shares, whichever door the bytes came
 * through: `POST /api/knowledge-base/documents` (the body) or
 * `.../documents/upload/complete` (an object the browser staged in Storage).
 * Both doors run `verifyKbUploadTarget` and `resolveKbUploadType` before any
 * byte is read and `storeKbDocument` after, so a staged document meets exactly
 * the image sniff, checksum, scope-aware dedup, storage limit, extraction and
 * record a body upload meets.
 */

type AuditLogger = ReturnType<typeof createApiAuditLogger>;
type UserClient = Awaited<ReturnType<typeof createClient>>;
type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export function kbMembershipErrorResponse(result: Extract<WorkspaceMembershipResult, { ok: false }>) {
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

/** The declared type as the accept lists compare it: no parameters, lower case. */
export function normalizeKbDeclaredContentType(raw: string | null | undefined): string {
  return (raw ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Membership in the named workspace, the writer-role gate, and the linked
 * project's workspace, in that order. The project lookup uses the caller's own
 * client, so RLS is a second net under the explicit workspace filter.
 */
export async function verifyKbUploadTarget(input: {
  supabase: UserClient;
  userId: string;
  workspaceId: string;
  projectId: string | undefined;
  audit: AuditLogger;
}): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const { supabase, userId, workspaceId, projectId, audit } = input;
  const membership = await checkWorkspaceMembership(supabase, userId, workspaceId);
  if (!membership.ok) {
    if (membership.kind === "error") {
      audit.error("membership_lookup_failed", { message: membership.message });
    }
    return { ok: false, response: kbMembershipErrorResponse(membership) };
  }

  if (isReadOnlyWorkspaceRole(membership.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Viewers have read-only access to this workspace" }, { status: 403 }),
    };
  }

  if (projectId) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (projectError) {
      return { ok: false, response: NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 }) };
    }
    if (!project) {
      return { ok: false, response: NextResponse.json({ error: "Linked project not found" }, { status: 404 }) };
    }
  }
  return { ok: true };
}

export type KbUploadType = {
  extractableKind: KbExtractableSourceKind | null;
  storedResolution: StoredResolution | null;
};

/**
 * Which accept list the declared type and filename land on, or the 415.
 * Extractable resolution first (those documents become citable); stored
 * resolution second; genuinely unknown formats are refused.
 */
export function resolveKbUploadType(
  declaredContentType: string,
  filename: string | undefined
): { ok: true; type: KbUploadType } | { ok: false; response: NextResponse } {
  const extractableKind = resolveSourceKind(declaredContentType, filename);
  const storedResolution =
    !extractableKind || extractableKind === "pasted_text"
      ? resolveStoredSourceKind(declaredContentType, filename)
      : null;
  if ((!extractableKind || extractableKind === "pasted_text") && !storedResolution) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Unsupported document type. Upload a PDF, Word (.docx), plain-text, or Markdown file " +
            "(these are indexed for citation), or an image (JPEG/PNG/TIFF), spreadsheet " +
            "(.csv/.xlsx/.xls/.ods), CAD file (.dwg/.dxf), or office document " +
            "(.pptx/.ppt/.doc/.rtf/.odt/.odp) to store for reference.",
        },
        { status: 415 }
      ),
    };
  }
  return { ok: true, type: { extractableKind, storedResolution } };
}

/** The per-file refusal, naming the setting an operator can raise. */
export function kbDocumentTooLargeResponse(maxBytes: number): NextResponse {
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

export function kbDocumentEmptyResponse(): NextResponse {
  return NextResponse.json({ error: "The uploaded document is empty" }, { status: 400 });
}

/**
 * Validate, dedupe, store, record and (for text formats) extract one document
 * whose bytes are already in memory and already within the per-file ceiling.
 */
export async function storeKbDocument(input: {
  service: ServiceClient;
  workspaceId: string;
  projectId: string | undefined;
  userId: string;
  title: string | undefined;
  docKind: KbDocKind | undefined;
  filename: string | undefined;
  declaredContentType: string;
  type: KbUploadType;
  bytes: Uint8Array;
  /** The app origin, for the extraction worker's callback. */
  origin: string;
  audit: AuditLogger;
  startedAt: number;
}): Promise<NextResponse> {
  const { service, workspaceId, projectId, userId, filename, declaredContentType, bytes, audit, startedAt } = input;
  const { extractableKind, storedResolution } = input.type;

  if (bytes.byteLength === 0) return kbDocumentEmptyResponse();

  // For an image, the BYTES decide — cameras and transfer tools mislabel
  // routinely, and a "photo" no viewer can open is worth catching at the door.
  let storedContentType = storedResolution?.contentType ?? null;
  if (storedResolution?.kind === "uploaded_image") {
    const sniffed = sniffImageFormat(bytes);
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

  const checksum = createHash("sha256").update(bytes).digest("hex");

  // Idempotent dedup: a byte-identical document already ingested at the SAME
  // scope — workspace-wide, or attached to this exact project — is returned
  // as-is. A project-only source cannot stand in for a workspace portfolio
  // source, and a workspace document cannot silently become project-only.
  // Failed rows are NOT deduped against: re-upload is the retry path.
  let existingQuery = service
    .from("kb_documents")
    .select(KB_DOCUMENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("checksum", checksum);
  existingQuery = projectId ? existingQuery.eq("project_id", projectId) : existingQuery.is("project_id", null);
  const existingResult = await existingQuery.in("status", ["ready", "stored"]).limit(1).maybeSingle();

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

  // The workspace's total, after dedup (a returned duplicate stores nothing)
  // and before any byte reaches Storage.
  const room = await checkWorkspaceStorageRoom(service, workspaceId, bytes.byteLength);
  if (room.status !== "room") {
    audit.warn("kb_document_workspace_storage_refused", {
      status: room.status,
      byteLength: bytes.byteLength,
      ...(room.status === "full" ? { usedBytes: room.usedBytes, quotaBytes: room.quotaBytes } : { detail: room.detail }),
    });
    return workspaceStorageRefusal(room);
  }

  const documentId = randomUUID();
  const storagePath = buildKbDocumentPath(workspaceId, documentId, filename);
  const title = deriveTitle(input.title, filename);
  const docKind = input.docKind ?? "other";

  const { error: uploadError } = await service.storage.from(KB_DOCUMENTS_BUCKET).upload(storagePath, bytes, {
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
        workspace_id: workspaceId,
        project_id: projectId ?? null,
        uploaded_by: userId,
        title,
        doc_kind: docKind,
        source_kind: storedResolution.kind,
        original_filename: filename ?? null,
        content_type: storedContentType,
        byte_size: bytes.byteLength,
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
        return kbMembershipErrorResponse({ ok: false, kind: "schema_pending", message: "" });
      }
      return NextResponse.json({ error: "Failed to record the document" }, { status: 500 });
    }

    audit.info("kb_document_stored", {
      workspaceId,
      documentId,
      sourceKind: storedResolution.kind,
      bytes: bytes.byteLength,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ document, stored: true, notice: KB_STORED_DOCUMENT_NOTICE }, { status: 201 });
  }

  // Every non-extractable accepted format returned inside the stored branch,
  // so reaching here with no extractable kind is a logic error — refuse
  // rather than cast past the type system.
  if (!extractableKind || extractableKind === "pasted_text") {
    return NextResponse.json({ error: "Unsupported document type." }, { status: 415 });
  }
  const sourceKind = extractableKind;

  if (sourceKind === "uploaded_pdf") {
    // Retain the original record before any text extraction. A worker owns PDF parsing.
    const inserted = await service.from("kb_documents").insert({
      id: documentId, workspace_id: workspaceId, project_id: projectId ?? null,
      uploaded_by: userId, title, doc_kind: docKind,
      source_kind: sourceKind, original_filename: filename ?? null, content_type: "application/pdf",
      byte_size: bytes.byteLength, storage_ref: `storage://${KB_DOCUMENTS_BUCKET}/${storagePath}`,
      page_count: null, chunk_count: 0, char_count: null, checksum, status: "stored", extraction_source: "none", extraction_error: null,
    }).select(KB_DOCUMENT_COLUMNS).single();
    if (inserted.error || !inserted.data) return NextResponse.json({ error: "The original bytes were stored but the document record could not be confirmed. Retry the same upload." }, { status: 503 });
    try {
      const job = await enqueueExtraction(documentId, userId, "text", input.origin);
      return NextResponse.json({ document: inserted.data, job, notice: "Original retained. Text extraction is queued; you can review the original while processing runs." }, { status: 202 });
    } catch {
      return NextResponse.json({ document: inserted.data, warning: "Original retained. Text extraction could not be queued. Use Retry reading in the source controls." }, { status: 201 });
    }
  }

  // Extract + chunk BEFORE inserting the row so the persisted status is honest
  // (ready with real chunks, or failed with a real reason) in one write.
  let extractionError: string | null = null;
  let pageCount = 0;
  let charCount = 0;
  let chunkRows: Array<Record<string, unknown>> = [];
  try {
    const extracted = await extractDocument(bytes, sourceKind);
    const chunks = chunkExtractedDocument(extracted.pages);
    pageCount = extracted.pageCount;
    charCount = extracted.charCount;
    chunkRows = buildKbChunkRows(documentId, workspaceId, chunks);
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
      workspace_id: workspaceId,
      project_id: projectId ?? null,
      uploaded_by: userId,
      title,
      doc_kind: docKind,
      source_kind: sourceKind,
      original_filename: filename ?? null,
      content_type: declaredContentType,
      byte_size: bytes.byteLength,
      storage_ref: `storage://${KB_DOCUMENTS_BUCKET}/${storagePath}`,
      page_count: extractionError ? null : pageCount,
      chunk_count: chunkRows.length,
      char_count: extractionError ? null : charCount,
      checksum,
      status,
      extraction_error: extractionError,
      // Where the indexed text came from — nothing was indexed on failure,
      // so a failed row honestly records no source.
      extraction_source: extractionError
        ? null
        : sourceKind === "uploaded_spreadsheet"
          ? "spreadsheet_parse"
          : "text_layer",
    })
    .select(KB_DOCUMENT_COLUMNS)
    .single();

  if (insertError || !document) {
    await service.storage.from(KB_DOCUMENTS_BUCKET).remove([storagePath]);
    audit.error("kb_document_insert_failed", { message: insertError?.message ?? "unknown" });
    if (looksLikePendingSchema(insertError?.message)) {
      return kbMembershipErrorResponse({ ok: false, kind: "schema_pending", message: "" });
    }
    return NextResponse.json({ error: "Failed to record the document" }, { status: 500 });
  }

  if (extractionError) {
    audit.info("kb_document_failed", {
      workspaceId,
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
    workspaceId,
    documentId,
    chunks: chunkRows.length,
    pages: pageCount,
    durationMs: Date.now() - startedAt,
  });
  return NextResponse.json({ document }, { status: 201 });
}
