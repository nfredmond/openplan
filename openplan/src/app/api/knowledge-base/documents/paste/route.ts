import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  buildKbChunkRows,
  checkWorkspaceMembership,
  insertKbChunks,
  KB_DOCUMENT_COLUMNS,
  looksLikePendingSchema,
  type WorkspaceMembershipResult,
} from "@/lib/knowledge-base/documents";
import { chunkExtractedDocument } from "@/lib/knowledge-base/chunk";
import { extractedFromText, NoExtractableTextError } from "@/lib/knowledge-base/extract";

export const runtime = "nodejs";

const pasteBodySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(200000),
  docKind: z
    .enum(["rtp", "comment_letter", "prior_study", "nofo", "staff_report", "policy", "other"])
    .optional(),
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

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("knowledge_base.documents.paste", request);
  const startedAt = Date.now();

  try {
    const bodyRead = await readJsonOrNullWithLimit(request, BODY_LIMITS.documentJson);
    if (!bodyRead.ok) return bodyRead.response;
    const parsed = pasteBodySchema.safeParse(bodyRead.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, parsed.data.workspaceId);
    if (!membership.ok) {
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
      }
      return membershipErrorResponse(membership);
    }

    if (parsed.data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id")
        .eq("id", parsed.data.projectId)
        .eq("workspace_id", parsed.data.workspaceId)
        .maybeSingle();
      if (projectError) {
        return NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 });
      }
      if (!project) {
        return NextResponse.json({ error: "Linked project not found" }, { status: 404 });
      }
    }

    let pageCount = 0;
    let charCount = 0;
    let chunkRowsSource;
    try {
      const extracted = extractedFromText(parsed.data.text);
      chunkRowsSource = chunkExtractedDocument(extracted.pages);
      pageCount = extracted.pageCount;
      charCount = extracted.charCount;
    } catch (error) {
      if (error instanceof NoExtractableTextError) {
        return NextResponse.json({ error: "The pasted text is empty" }, { status: 400 });
      }
      throw error;
    }

    const checksum = createHash("sha256").update(parsed.data.text, "utf8").digest("hex");
    const service = createServiceRoleClient();
    const documentId = randomUUID();
    const chunkRows = buildKbChunkRows(documentId, parsed.data.workspaceId, chunkRowsSource);

    const { data: document, error: insertError } = await service
      .from("kb_documents")
      .insert({
        id: documentId,
        workspace_id: parsed.data.workspaceId,
        project_id: parsed.data.projectId ?? null,
        uploaded_by: user.id,
        title: parsed.data.title,
        doc_kind: parsed.data.docKind ?? "other",
        source_kind: "pasted_text",
        original_filename: null,
        content_type: "text/plain",
        byte_size: Buffer.byteLength(parsed.data.text, "utf8"),
        storage_ref: null,
        page_count: pageCount,
        chunk_count: chunkRows.length,
        char_count: charCount,
        checksum,
        status: "ready",
        extraction_error: null,
      })
      .select(KB_DOCUMENT_COLUMNS)
      .single();

    if (insertError || !document) {
      audit.error("kb_paste_insert_failed", { message: insertError?.message ?? "unknown" });
      if (looksLikePendingSchema(insertError?.message)) {
        return membershipErrorResponse({ ok: false, kind: "schema_pending", message: "" });
      }
      return NextResponse.json({ error: "Failed to record the document" }, { status: 500 });
    }

    const chunkError = await insertKbChunks(service, chunkRows);
    if (chunkError) {
      await service
        .from("kb_documents")
        .update({ status: "failed", extraction_error: "Failed to index document chunks." })
        .eq("id", documentId);
      audit.error("kb_paste_chunk_insert_failed", { documentId, message: chunkError.message });
      return NextResponse.json({ error: "Failed to index the document" }, { status: 500 });
    }

    audit.info("kb_paste_ready", {
      workspaceId: parsed.data.workspaceId,
      documentId,
      chunks: chunkRows.length,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    audit.error("kb_paste_unhandled_error", { error });
    return NextResponse.json({ error: "Unexpected error while saving text" }, { status: 500 });
  }
}
