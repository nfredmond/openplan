import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { parseStorageRef, storageRefAllowed } from "@/lib/models/artifact-source";
import {
  KB_DOCUMENTS_BUCKET,
  looksLikePendingSchema,
  sanitizeFilename,
} from "@/lib/knowledge-base/documents";

/**
 * Download a Knowledge Base document's stored file.
 *
 * WHY THIS DID NOT EXIST. The upload route has stored bytes in the private
 * `kb-documents` bucket since the module shipped, and no route anywhere under
 * `/api/knowledge-base` could serve them back — a planner could upload a plan,
 * cite it, delete it, but never get the file itself out again. The Document
 * Library (2026-08-11) lists stored files (images, spreadsheets, CAD) whose
 * ENTIRE value is the bytes, so the gap had to close.
 *
 * Mirrors `/api/reports/[reportId]/artifacts/[artifactId]/download` segment for
 * segment: authorize via the caller's own read, confine the storage reference
 * to the document's own `<workspaceId>/<documentId>/` prefix, mint a
 * short-lived signed URL, redirect.
 *
 * The row is read with the CALLER'S RLS client — `kb_documents` SELECT is
 * member-scoped, so a hit proves workspace membership (the same authorization
 * the detail route relies on; viewers may read, and downloading is reading).
 * The service-role client touches ONLY the storage signer, never a table.
 */

// Matches the report / model-run artifact routes: a short-lived link minted per
// request for an already-authorized reader, never a stored public URL.
const KB_DOCUMENT_SIGNED_URL_TTL_SECONDS = 15 * 60;

const paramsSchema = z.object({ documentId: z.string().uuid() });

type RouteContext = { params: Promise<{ documentId: string }> };

type DocumentRow = {
  id: string;
  workspace_id: string;
  title: string | null;
  original_filename: string | null;
  storage_ref: string | null;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("knowledge_base.documents.download", request);

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

    // RLS scopes this to the caller's workspaces, so a hit already proves
    // membership — a foreign document answers 404 here, not 403.
    const { data: documentData, error } = await supabase
      .from("kb_documents")
      .select("id, workspace_id, title, original_filename, storage_ref")
      .eq("id", parsedParams.data.documentId)
      .maybeSingle();

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json(
          { error: "Knowledge Base schema is not available yet" },
          { status: 503 }
        );
      }
      audit.error("kb_document_download_lookup_failed", { message: error.message });
      return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
    }

    const document = (documentData ?? null) as DocumentRow | null;
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const storageRefRaw =
      typeof document.storage_ref === "string" ? document.storage_ref.trim() : "";
    if (!storageRefRaw) {
      // Pasted text is indexed, not stored: the record is real and there is
      // honestly no file behind it. Say which, rather than 404ing as if the
      // document did not exist.
      return NextResponse.json(
        {
          error:
            "This document has no stored file to download. Pasted text is indexed for citation but " +
            "OpenPlan keeps no original file for it.",
        },
        { status: 409 }
      );
    }

    // Every dereference is bound to THIS document's own prefix. `storage_ref`
    // is written only by OpenPlan's own routes today, but the confinement is
    // what makes that an invariant rather than a habit — a ref pointing
    // anywhere else is refused before it can reach the signer.
    const scope = {
      bucket: KB_DOCUMENTS_BUCKET,
      objectPathPrefix: `${document.workspace_id}/${document.id}/`,
    } as const;

    // Rows are written as `storage://kb-documents/<ws>/<doc>/<file>`; a bare
    // object path is accepted too so the two conventions in the codebase
    // cannot diverge into a hole.
    const ref = parseStorageRef(storageRefRaw) ?? {
      bucket: KB_DOCUMENTS_BUCKET,
      objectPath: storageRefRaw,
    };

    if (ref.objectPath.startsWith("/") || !storageRefAllowed(ref, scope)) {
      audit.warn("kb_document_ref_out_of_scope", {
        documentId: document.id,
        bucket: ref.bucket,
      });
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // A filename a planner can recognise in a downloads folder — the name the
    // file was uploaded under, run through the same sanitizer that named the
    // storage object.
    const filename = sanitizeFilename(document.original_filename ?? document.title);

    const service = createServiceRoleClient();
    const { data, error: signError } = await service.storage
      .from(ref.bucket)
      .createSignedUrl(ref.objectPath, KB_DOCUMENT_SIGNED_URL_TTL_SECONDS, {
        download: filename,
      });

    if (signError || !data?.signedUrl) {
      audit.error("kb_document_sign_failed", {
        documentId: document.id,
        message: signError?.message ?? "no signed url",
      });
      return NextResponse.json({ error: "Failed to sign document URL" }, { status: 500 });
    }

    audit.info("kb_document_download_signed", {
      documentId: document.id,
      workspaceId: document.workspace_id,
      userId: user.id,
    });
    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    audit.error("kb_document_download_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while preparing the download" },
      { status: 500 }
    );
  }
}
