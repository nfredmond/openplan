import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readJsonOrNullWithLimit, BODY_LIMITS } from "@/lib/http/body-limit";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { enqueueExtraction } from "@/lib/knowledge-base/extraction-jobs";
import { KB_OCR_JOB_COLUMNS } from "@/lib/knowledge-base/ocr-contract";
import { isKbOcrWorkerConfigured } from "@/lib/knowledge-base/ocr-availability";

type Context = { params: Promise<{ documentId: string }> };
async function accessDocument(request: NextRequest, context: Context, write: boolean) {
  const { documentId } = await context.params;
  if (!z.string().uuid().safeParse(documentId).success) return { response: NextResponse.json({ error: "Invalid document id" }, { status: 400 }) };
  if (write && readAssistantExecutionSource(request) !== "manual") return { response: NextResponse.json({ error: "Document extraction is not a registered agent write." }, { status: 403 }) };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const result = await supabase.from("kb_documents").select("id, workspace_id, source_kind, status, extraction_source, page_count").eq("id", documentId).maybeSingle();
  if (result.error) return { response: NextResponse.json({ error: "Document access could not be checked" }, { status: 503 }) };
  if (!result.data) return { response: NextResponse.json({ error: "Document not found" }, { status: 404 }) };
  const document = result.data;
  if (write) {
    const membership = await supabase.from("workspace_members").select("role").eq("workspace_id", document.workspace_id).eq("user_id", user.id).maybeSingle();
    if (membership.error) return { response: NextResponse.json({ error: "Workspace role could not be checked" }, { status: 503 }) };
    if (!membership.data || isReadOnlyWorkspaceRole(membership.data.role) || !["owner", "admin", "member"].includes(membership.data.role)) return { response: NextResponse.json({ error: "Viewers have read-only access to this workspace" }, { status: 403 }) };
  }
  return { supabase, user, document };
}

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("documents.extraction.status", request);
  try {
    const access = await accessDocument(request, context, false);
    if (access.response) { audit.warn("access_refused", { status: access.response.status }); return access.response; }
    const job = await access.supabase.from("kb_ocr_jobs").select(`${KB_OCR_JOB_COLUMNS}, extraction_mode, cancel_requested`).eq("document_id", access.document.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const versions = [];
    for (let offset = 0; ; offset += 100) {
      const page = await access.supabase.from("kb_document_extractions").select("id, job_id, document_checksum, page_count, content_sha256, engine_json, created_at").eq("document_id", access.document.id).order("created_at", { ascending: false }).order("id").range(offset, offset + 99);
      if (page.error) return NextResponse.json({ error: "Extraction versions could not be read" }, { status: 503 });
      versions.push(...(page.data ?? []));
      if ((page.data?.length ?? 0) < 100) break;
    }
    if (job.error) return NextResponse.json({ error: "Extraction status could not be read" }, { status: 503 });
    return NextResponse.json({ workerConfigured: isKbOcrWorkerConfigured(), document: { sourceKind: access.document.source_kind, status: access.document.status, extractionSource: access.document.extraction_source, pageCount: access.document.page_count }, latestJob: job.data, latestJobUnreadable: false, extractions: versions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { audit.error("extraction_status_unavailable"); return NextResponse.json({ error: "Extraction status unavailable" }, { status: 503 }); }
}

const command = z.object({ mode: z.enum(["text", "ocr"]).default("ocr"), requestId: z.string().uuid().optional(), action: z.enum(["start", "cancel"]).default("start"), jobId: z.string().uuid().optional() }).strict();
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("documents.extraction.request", request);
  try {
    const access = await accessDocument(request, context, true);
    if (access.response) { audit.warn("access_refused", { status: access.response.status }); return access.response; }
    const body = request.headers.get("content-type")?.includes("application/json") ? await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson) : { ok: true as const, data: {} };
    if (!body.ok) return body.response;
    const parsed = command.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid extraction request" }, { status: 400 });
    if (access.document.source_kind !== "uploaded_pdf") return NextResponse.json({ error: "Only retained PDFs use this extraction worker" }, { status: 409 });
    if (parsed.data.action === "cancel") {
      if (!parsed.data.jobId) return NextResponse.json({ error: "Choose a job to cancel" }, { status: 400 });
      const result = await createServiceRoleClient().rpc("cancel_kb_extraction", { p_document_id: access.document.id, p_job_id: parsed.data.jobId, p_actor_id: access.user.id });
      if (result.error) return NextResponse.json({ error: "Cancellation could not be recorded" }, { status: result.error.code === "42501" ? 403 : 503 });
      if (!result.data) return NextResponse.json({ error: "Active job not found" }, { status: 404 });
      audit.info("extraction_cancel_requested", { documentId: access.document.id, jobId: parsed.data.jobId });
      return NextResponse.json({ canceled: true, notice: "Cancellation recorded. The original remains available." });
    }
    const job = await enqueueExtraction(access.document.id, access.user.id, parsed.data.mode, new URL(request.url).origin, parsed.data.requestId);
    audit.info("extraction_accepted", { documentId: access.document.id, jobId: job.id });
    return NextResponse.json({ job, requestId: job.request_id, notice: "Reading queued. The original remains available for manual review." }, { status: 202 });
  } catch { audit.error("extraction_request_unavailable"); return NextResponse.json({ error: "The reading request could not be recorded. The original remains available; retry." }, { status: 503 }); }
}
