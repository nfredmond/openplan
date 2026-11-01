import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { KB_DOCUMENTS_BUCKET, resolveKbDocumentMaxBytes } from "@/lib/knowledge-base/documents";
import {
  kbDocumentTooLargeResponse,
  normalizeKbDeclaredContentType,
  resolveKbUploadType,
  storeKbDocument,
  verifyKbUploadTarget,
} from "@/lib/knowledge-base/document-intake";
import { KB_DOC_KINDS, type KbDocKind } from "@/lib/knowledge-base/types";
import { consumeStagedUpload, isOwnStagedUploadPath, removeStagedUpload } from "@/lib/files/staged-upload";

/**
 * Store a Knowledge Base document the browser already put in private Storage.
 *
 * The staged path must belong to this user in this workspace. Membership, the
 * role, the linked project and the declared type are checked again here, not
 * carried over from `./start`. The stored object is read back against the
 * operator's ceiling, compared with the size declared when its URL was issued,
 * and removed. Only then do the bytes meet `storeKbDocument`, the same image
 * sniff, checksum, scope-aware dedup, storage limit, extraction and record the
 * body route runs. A refusal after the path check removes the staged object.
 */

export const runtime = "nodejs";
// Reading the staged copy back and writing the stored copy both move the whole
// file; a 100 MiB scanned plan needs more than the body route's minute.
export const maxDuration = 300;

const completeSchema = z
  .object({
    workspaceId: z.string().uuid(),
    projectId: z.string().uuid().optional(),
    docKind: z.enum(KB_DOC_KINDS as [KbDocKind, ...KbDocKind[]]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    filename: z.string().trim().max(255).optional(),
    contentType: z.string().max(255).optional(),
    objectPath: z.string().min(1).max(512),
    /** The size declared when the upload URL was issued. */
    byteSize: z.number().int().positive(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("knowledge_base.documents.upload.complete", request);
  const startedAt = Date.now();

  try {
    const read = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!read.ok) return read.response;
    const parsed = completeSchema.safeParse(read.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid upload parameters" }, { status: 400 });
    }
    const { workspaceId, projectId, filename, objectPath, byteSize } = parsed.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const target = await verifyKbUploadTarget({ supabase, userId: user.id, workspaceId, projectId, audit });
    if (!target.ok) return target.response;

    // Before any Storage read: the path must be one this user staged in this
    // workspace. Nothing else in the bucket can be named here.
    if (!isOwnStagedUploadPath(objectPath, workspaceId, user.id)) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }

    const service = createServiceRoleClient();

    const declaredContentType = normalizeKbDeclaredContentType(parsed.data.contentType);
    const uploadType = resolveKbUploadType(declaredContentType, filename);
    if (!uploadType.ok) {
      if (!(await removeStagedUpload(service, KB_DOCUMENTS_BUCKET, objectPath))) {
        audit.warn("kb_document_staged_upload_not_removed", { workspaceId, status: "unsupported_type" });
      }
      return uploadType.response;
    }

    const maxBytes = resolveKbDocumentMaxBytes();
    const staged = await consumeStagedUpload(service, KB_DOCUMENTS_BUCKET, objectPath, {
      maxBytes,
      declaredBytes: byteSize,
    });
    if (staged.status === "missing") {
      return NextResponse.json(
        { error: "The document did not reach storage", detail: "Upload the file again." },
        { status: 409 }
      );
    }
    if (staged.status === "unavailable") {
      audit.error("kb_document_staged_read_failed", { message: staged.message });
      return NextResponse.json({ error: "Storage could not be read right now" }, { status: 503 });
    }
    if (!staged.removed) {
      audit.warn("kb_document_staged_upload_not_removed", { workspaceId, status: staged.status });
    }
    if (staged.status === "too_large") {
      audit.warn("kb_document_body_too_large", { byteLength: staged.bytesRead, maxBytes, staged: true });
      return kbDocumentTooLargeResponse(maxBytes);
    }
    if (staged.status === "size_mismatch") {
      audit.warn("kb_document_staged_size_mismatch", {
        declared: staged.declaredBytes,
        stored: staged.storedBytes,
      });
      return NextResponse.json(
        { error: "The stored document is not the file that was chosen", detail: "Upload the file again." },
        { status: 409 }
      );
    }

    return await storeKbDocument({
      service,
      workspaceId,
      projectId,
      userId: user.id,
      title: parsed.data.title,
      docKind: parsed.data.docKind,
      filename,
      declaredContentType,
      type: uploadType.type,
      bytes: staged.bytes,
      origin: new URL(request.url).origin,
      audit,
      startedAt,
    });
  } catch (error) {
    audit.error("kb_document_upload_complete_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while uploading document" }, { status: 500 });
  }
}
