import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { KB_DOCUMENTS_BUCKET, resolveKbDocumentMaxBytes } from "@/lib/knowledge-base/documents";
import {
  kbDocumentEmptyResponse,
  kbDocumentTooLargeResponse,
  normalizeKbDeclaredContentType,
  resolveKbUploadType,
  verifyKbUploadTarget,
} from "@/lib/knowledge-base/document-intake";
import { KB_DOC_KINDS, type KbDocKind } from "@/lib/knowledge-base/types";
import { STAGED_UPLOAD_CONTENT_TYPE, stagedUploadPath } from "@/lib/files/staged-upload";
import { checkWorkspaceStorageRoom, workspaceStorageRefusal } from "@/lib/workspaces/storage-quota";

/**
 * Issue a signed upload URL for one Knowledge Base document, so the browser can
 * put it in private Storage without sending it through this function. An
 * adopted RTP or EIR runs 40 to 80 MB; the hosted platform refuses a function
 * body above about 4.5 MB (KI-2026-10-12-017).
 *
 * Membership, the writer-role gate, the linked project, the declared type, the
 * declared size against the operator's ceiling and the workspace's storage room
 * are all settled before any URL exists, with the same refusals the body route
 * gives. The URL writes one new object under `<workspace>/staged/<user>/` and
 * cannot overwrite. `./complete` checks all of it again against the stored
 * bytes. See `lib/files/staged-upload.ts`.
 */

export const runtime = "nodejs";

const startSchema = z
  .object({
    workspaceId: z.string().uuid(),
    projectId: z.string().uuid().optional(),
    docKind: z.enum(KB_DOC_KINDS as [KbDocKind, ...KbDocKind[]]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    filename: z.string().trim().max(255).optional(),
    /** The size the browser reports for the chosen file. */
    byteSize: z.number().int().nonnegative(),
    /** The type the body route would read from the Content-Type header. */
    contentType: z.string().max(255).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("knowledge_base.documents.upload.start", request);

  try {
    const read = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!read.ok) return read.response;
    const parsed = startSchema.safeParse(read.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid upload parameters" }, { status: 400 });
    }
    const { workspaceId, projectId, filename, byteSize } = parsed.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const target = await verifyKbUploadTarget({ supabase, userId: user.id, workspaceId, projectId, audit });
    if (!target.ok) return target.response;

    const uploadType = resolveKbUploadType(normalizeKbDeclaredContentType(parsed.data.contentType), filename);
    if (!uploadType.ok) return uploadType.response;

    if (byteSize === 0) return kbDocumentEmptyResponse();

    const maxBytes = resolveKbDocumentMaxBytes();
    if (byteSize > maxBytes) {
      audit.warn("kb_document_body_too_large", { byteLength: byteSize, maxBytes, declared: true });
      return kbDocumentTooLargeResponse(maxBytes);
    }

    const service = createServiceRoleClient();

    // The workspace's total, with the declared size, before any URL exists.
    // The complete route removes the staged object before it checks again.
    const room = await checkWorkspaceStorageRoom(service, workspaceId, byteSize);
    if (room.status !== "room") {
      audit.warn("kb_document_workspace_storage_refused", {
        status: room.status,
        byteLength: byteSize,
        ...(room.status === "full" ? { usedBytes: room.usedBytes, quotaBytes: room.quotaBytes } : { detail: room.detail }),
      });
      return workspaceStorageRefusal(room);
    }

    const objectPath = stagedUploadPath(workspaceId, user.id, randomUUID());
    const signed = await service.storage
      .from(KB_DOCUMENTS_BUCKET)
      .createSignedUploadUrl(objectPath, { upsert: false });
    if (signed.error || !signed.data?.signedUrl) {
      audit.error("kb_document_upload_url_failed", { message: signed.error?.message ?? "no signed URL" });
      return NextResponse.json({ error: "Storage could not accept an upload right now" }, { status: 503 });
    }

    audit.info("kb_document_upload_url_issued", { workspaceId, projectId: projectId ?? null, byteSize });
    return NextResponse.json({
      uploadUrl: signed.data.signedUrl,
      objectPath,
      contentType: STAGED_UPLOAD_CONTENT_TYPE,
    });
  } catch (error) {
    audit.error("kb_document_upload_start_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while preparing the upload" }, { status: 500 });
  }
}
