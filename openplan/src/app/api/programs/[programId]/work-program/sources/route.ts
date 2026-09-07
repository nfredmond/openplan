import { createApiAuditLogger } from "@/lib/observability/audit";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonOrNullWithLimit, BODY_LIMITS } from "@/lib/http/body-limit";
import { resolveTenantScopedStorageTarget } from "@/lib/files/tenant-scoped-storage";
import { KB_DOCUMENTS_BUCKET } from "@/lib/knowledge-base/documents";
import { enqueueExtraction } from "@/lib/knowledge-base/extraction-jobs";
import { extractWorkProgramSource } from "@/lib/programs/work-program/source-extraction";
import { authorizeWorkProgram } from "@/lib/programs/work-program/server";

const sourceSchema = z.object({
  documentId: z.string().uuid(), role: z.enum(["predecessor", "amendment", "comparison", "authority", "supplement"]),
  sourceUrl: z.string().url().max(2000).refine((value) => /^https?:\/\//.test(value)).nullable(),
  extraction: z.enum(["review", "manual"]), documentExtractionId: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(), pageCount: z.number().int().min(1).max(5000).optional(),
}).strict();

/** Retain source identity and create a new immutable review version from retained page text. */
export async function POST(request: NextRequest, context: { params: Promise<{ programId: string }> }) {
  const audit = createApiAuditLogger("programs.workProgram.source", request);
  try {
    const { programId } = await context.params;
    const access = await authorizeWorkProgram(request, programId, true);
    if (access.response) { audit.warn("source_access_refused", { status: access.response.status }); return access.response; }
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    const parsed = sourceSchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: "Provide a retained PDF, source role and valid source reference" }, { status: 400 });
    const documentResult = await access.supabase.from("kb_documents").select("id, workspace_id, title, checksum, storage_ref, source_kind, page_count, byte_size").eq("id", parsed.data.documentId).eq("workspace_id", access.program.workspace_id).maybeSingle();
    if (documentResult.error) return NextResponse.json({ error: "Could not read the document" }, { status: 503 });
    const document = documentResult.data;
    if (!document) return NextResponse.json({ error: "Source document not found" }, { status: 404 });
    if (document.source_kind !== "uploaded_pdf" || !document.checksum) return NextResponse.json({ error: "Choose a PDF with a retained original checksum" }, { status: 409 });
    const target = resolveTenantScopedStorageTarget(document.storage_ref, { bucket: KB_DOCUMENTS_BUCKET, objectPathPrefix: `${document.workspace_id}/${document.id}/` });
    if (!target) return NextResponse.json({ error: "The retained original location is invalid" }, { status: 409 });
    let pages = document.page_count ?? parsed.data.pageCount;
    let documentExtractionId: string | null = null;
    let extraction: ReturnType<typeof extractWorkProgramSource>;
    if (parsed.data.extraction === "review") {
      let query = access.supabase.from("kb_document_extractions").select("id, document_checksum, page_count, pages_json").eq("document_id", document.id).eq("workspace_id", document.workspace_id);
      if (parsed.data.documentExtractionId) query = query.eq("id", parsed.data.documentExtractionId);
      const result = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (result.error) return NextResponse.json({ error: "Retained page text could not be read" }, { status: 503 });
      if (!result.data) {
        if (parsed.data.documentExtractionId) return NextResponse.json({ error: "Extraction version not found for this original" }, { status: 404 });
        const job = await enqueueExtraction(document.id, access.user.id, "text", new URL(request.url).origin, parsed.data.requestId);
        return NextResponse.json({ job, documentId: document.id, notice: "Original retained. Reading is queued; select its extraction version after processing." }, { status: 202 });
      }
      if (result.data.document_checksum !== document.checksum) return NextResponse.json({ error: "The original checksum differs from the extraction" }, { status: 409 });
      pages = result.data.page_count;
      documentExtractionId = result.data.id;
      extraction = extractWorkProgramSource(result.data.pages_json);
    } else {
      if (!pages) return NextResponse.json({ error: "Enter the PDF page count from the retained original for manual review. Indexing is not required." }, { status: 400 });
      extraction = { parser: "manual-page-review", pageCount: pages, elements: [], warnings: ["Manual page review. Verify page count and citations against the retained original; no text extraction is implied."] };
    }
    const service = createServiceRoleClient();
    const attached = await service.rpc("attach_program_work_program_source", { p_program_id: programId, p_actor_id: access.user.id, p_document_id: document.id, p_checksum: document.checksum, p_role: parsed.data.role, p_source_url: parsed.data.sourceUrl, p_page_count: pages, p_extraction: extraction });
    if (attached.error) return NextResponse.json({ error: "Source retention could not be confirmed. Existing provenance is unchanged; retry." }, { status: attached.error.code === "PT409" ? 409 : attached.error.code === "42501" ? 403 : 503 });
    if (!documentExtractionId) return NextResponse.json({ sourceId: attached.data.id });
    const version = await service.rpc("version_work_program_extraction", { p_source_id: attached.data.id, p_actor_id: access.user.id, p_document_extraction_id: documentExtractionId, p_request_id: parsed.data.requestId ?? randomUUID(), p_extraction: extraction });
    if (version.error) return NextResponse.json({ error: "Source retained, but its new review version could not be confirmed. Retry with the same request." }, { status: version.error.code === "PT409" ? 409 : 503 });
    audit.info("source_version_retained", { programId, sourceId: attached.data.id, extractionVersionId: version.data.id });
    return NextResponse.json({ sourceId: attached.data.id, extractionVersionId: version.data.id });
  } catch { audit.error("source_review_failed"); return NextResponse.json({ error: "Source review did not finish. Original and earlier versions remain retained; retry." }, { status: 503 }); }
}
