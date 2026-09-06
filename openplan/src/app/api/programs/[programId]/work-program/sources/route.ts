import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readJsonOrNullWithLimit, BODY_LIMITS } from "@/lib/http/body-limit";
import { resolveTenantScopedStorageTarget } from "@/lib/files/tenant-scoped-storage";
import { KB_DOCUMENTS_BUCKET } from "@/lib/knowledge-base/documents";
import { extractDocument } from "@/lib/knowledge-base/extract";
import { extractWorkProgramSource } from "@/lib/programs/work-program/source-extraction";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";

const sourceSchema = z.object({
  documentId: z.string().uuid(),
  role: z.enum(["predecessor", "amendment", "comparison", "authority", "supplement"]),
  sourceUrl: z.string().url().max(2000).refine((value) => /^https?:\/\//.test(value), "Use an HTTP or HTTPS source URL").nullable(),
  extraction: z.enum(["review", "manual"]),
}).strict();

/** Attach an existing original; retries reuse its immutable, checksum-bound extraction. */
export async function POST(request: NextRequest, context: { params: Promise<{ programId: string }> }) {
  const audit = createApiAuditLogger("programs.workProgram.source", request);
  try {
    const { programId } = await context.params;
    const access = await authorizeWorkProgram(request, programId, true);
    if (access.response) return access.response;
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    const parsed = sourceSchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: "Provide a document, source role and valid source URL" }, { status: 400 });
    const { data: document, error } = await access.supabase.from("kb_documents")
      .select("id, workspace_id, title, checksum, storage_ref, source_kind, page_count, byte_size")
      .eq("id", parsed.data.documentId).eq("workspace_id", access.program.workspace_id).maybeSingle();
    if (error) return NextResponse.json({ error: "Could not read the source document" }, { status: 503 });
    if (!document) return NextResponse.json({ error: "Source document not found" }, { status: 404 });
    if (document.source_kind !== "uploaded_pdf" || !document.checksum || !document.page_count) return NextResponse.json({ error: "Attach an indexed PDF with a retained original and known page count. Complete document intake before reviewing it here." }, { status: 409 });
    const existing = await access.supabase.from("program_work_program_sources").select("id, source_url")
      .eq("program_id", programId).eq("document_id", document.id).eq("document_checksum", document.checksum).eq("source_role", parsed.data.role).maybeSingle();
    if (existing.error) return NextResponse.json({ error: "Could not verify a previous attachment" }, { status: 503 });
    if (existing.data) {
      if (existing.data.source_url !== parsed.data.sourceUrl) return NextResponse.json({ error: "This source is already retained with a different URL. Its original provenance cannot be overwritten." }, { status: 409 });
      return NextResponse.json({ sourceId: existing.data.id, reused: true });
    }
    const target = resolveTenantScopedStorageTarget(document.storage_ref, { bucket: KB_DOCUMENTS_BUCKET, objectPathPrefix: `${document.workspace_id}/${document.id}/` });
    if (!target) return NextResponse.json({ error: "The retained source location is not valid for this document" }, { status: 409 });
    // This synchronous layout pass is deliberately bounded. Larger originals
    // remain usable by manual page citation; a durable large-document parser
    // is required before expanding automatic intake beyond this path.
    if (parsed.data.extraction === "review" && (!document.byte_size || document.byte_size > 10 * 1024 * 1024)) return NextResponse.json({ error: "Automatic work-element review currently accepts PDFs up to 10 MiB. Choose manual page review for this retained original." }, { status: 413 });
    const service = createServiceRoleClient();
    let extraction = { parser: "manual-page-review" as const, pageCount: document.page_count as number, elements: [], warnings: ["Review this original manually and cite the PDF page numbers when entering proposed work."] } as ReturnType<typeof extractWorkProgramSource>;
    const download = await service.storage.from(target.bucket).download(target.objectPath);
    if (download.error || !download.data) return NextResponse.json({ error: "The original could not be read. Retry when document storage recovers." }, { status: 503 });
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== document.checksum) return NextResponse.json({ error: "The original bytes no longer match the retained document checksum. Source review was stopped." }, { status: 409 });
    if (parsed.data.extraction === "review") {
      if (bytes.length > 10 * 1024 * 1024) return NextResponse.json({ error: "The original exceeds the automatic review limit. Use manual page review." }, { status: 413 });
      const extracted = await extractDocument(bytes, "uploaded_pdf");
      if (extracted.pageCount !== document.page_count) return NextResponse.json({ error: "The PDF page count no longer matches its document record" }, { status: 409 });
      extraction = extractWorkProgramSource(extracted.pages);
    }
    const result = await service.rpc("attach_program_work_program_source", {
      p_program_id: programId, p_actor_id: access.user.id, p_document_id: document.id, p_checksum: document.checksum,
      p_role: parsed.data.role, p_source_url: parsed.data.sourceUrl, p_page_count: document.page_count, p_extraction: extraction,
    });
    if (result.error) {
      audit.warn("work_program_source_refused", { programId, code: result.error.code });
      return NextResponse.json({ error: "The source attachment could not be confirmed. Retry with the same document and source role." }, { status: result.error.code === "42501" ? 403 : 503 });
    }
    audit.info("work_program_source_attached", { programId, documentId: document.id, userId: access.user.id });
    return NextResponse.json({ sourceId: result.data.id, reused: false });
  } catch (error) {
    audit.error("work_program_source_failed", { error });
    return NextResponse.json({ error: "The source review could not finish. The original remains in Documents; retry or use manual page review." }, { status: 503 });
  }
}
