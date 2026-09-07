import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolveTenantScopedStorageTarget } from "@/lib/files/tenant-scoped-storage";
import { KB_DOCUMENTS_BUCKET } from "./documents";
import { buildOcrRequest } from "./ocr-contract";
import { resolveKbOcrLanguages, resolveKbOcrCallbackMaxBytes } from "./ocr-availability";

export function extractionCallbackUrl(origin: string) {
  return `${(process.env.OPENPLAN_KB_OCR_CALLBACK_URL?.trim() || origin).replace(/\/+$/, "")}/api/knowledge-base/ocr-callback`;
}

/** Acknowledged work is committed before dispatch. The worker pulls missed dispatches. */
export async function enqueueExtraction(documentId: string, actorId: string, mode: "text" | "ocr", origin: string, requestId: string = randomUUID()) {
  const service = createServiceRoleClient();
  const result = await service.rpc("enqueue_kb_extraction", {
    p_document_id: documentId, p_actor_id: actorId, p_request_id: requestId,
    p_mode: mode, p_languages: resolveKbOcrLanguages(), p_callback_url: extractionCallbackUrl(origin),
  });
  if (result.error) throw new Error("The extraction job could not be recorded. The original remains retained; retry.");
  return result.data as { id: string; request_id: string; document_id: string; status: string };
}

/** Fresh signed sources are issued only while the recorded requester still has write access. */
export async function pendingExtractionRequests(origin: string) {
  const service = createServiceRoleClient();
  const now = new Date().toISOString();
  const jobs = await service.from("kb_ocr_jobs").select("id, document_id, workspace_id, request_id, requested_by, source_checksum, extraction_mode, languages, dispatch_callback_url, cancel_requested")
    .eq("job_kind", "extraction").in("status", ["queued", "running"]).eq("dispatch_callback_url", extractionCallbackUrl(origin)).lte("dispatch_after", now).order("created_at").limit(10);
  if (jobs.error) throw new Error("Pending document jobs could not be read");
  const requests: Record<string, unknown>[] = [];
  for (const job of jobs.data ?? []) {
    // Checkpoint first: a corrupt oldest row cannot starve the jobs behind it.
    try {
    const checkpoint = await service.from("kb_ocr_jobs").update({ dispatch_after: new Date(Date.now() + 30_000).toISOString() }).eq("id", job.id).in("status", ["queued", "running"]);
    if (checkpoint.error) continue;
    const member = await service.from("workspace_members").select("role").eq("workspace_id", job.workspace_id).eq("user_id", job.requested_by).maybeSingle();
    if (member.error) throw new Error("Requester access could not be checked");
    if (job.cancel_requested || !member.data || !["owner", "admin", "member"].includes(member.data.role)) {
      const updated = await service.from("kb_ocr_jobs").update({ status: "failed", cancel_requested: true, failure_detail: job.cancel_requested ? "Canceled by requester; original retained." : "Requester access was revoked; original retained." }).eq("id", job.id).in("status", ["queued", "running"]);
      if (updated.error) throw new Error("Job cancellation could not be recorded");
      continue;
    }
    const document = await service.from("kb_documents").select("id, workspace_id, project_id, title, original_filename, storage_ref, checksum, byte_size").eq("id", job.document_id).eq("workspace_id", job.workspace_id).maybeSingle();
    if (document.error) throw new Error("Retained document could not be read");
    const row = document.data;
    if (!row || row.checksum !== job.source_checksum) throw new Error("Retained document identity changed");
    const target = resolveTenantScopedStorageTarget(row.storage_ref, { bucket: KB_DOCUMENTS_BUCKET, objectPathPrefix: `${row.workspace_id}/${row.id}/` });
    if (!target) throw new Error("Retained document location is invalid");
    const signed = await service.storage.from(target.bucket).createSignedUrl(target.objectPath, 3600);
    if (signed.error || !signed.data?.signedUrl) throw new Error("The original could not be made available to the worker");
    const payload = buildOcrRequest({ requestId: job.request_id, callbackUrl: job.dispatch_callback_url, documentId: row.id, workspaceId: row.workspace_id, projectId: row.project_id, documentTitle: row.title, sourceUrl: signed.data.signedUrl, filename: row.original_filename, sizeBytes: row.byte_size, checksumSha256: row.checksum, languages: job.languages, maxCallbackBytes: resolveKbOcrCallbackMaxBytes() });
    requests.push({ ...payload, mode: job.extraction_mode });
    } catch {
      await service.from("kb_ocr_jobs").update({ failure_detail: "Dispatch could not read or sign this retained original. Retry reading; other documents continue processing." }).eq("id", job.id).in("status", ["queued", "running"]);
    }
  }
  return requests;
}

export async function pendingExtractionCancellations(origin: string) {
  const service = createServiceRoleClient();
  const result = await service.from("kb_ocr_jobs").select("request_id").eq("dispatch_callback_url", extractionCallbackUrl(origin)).eq("cancel_requested", true).order("updated_at", { ascending: false }).limit(1000);
  if (result.error) throw new Error("Cancellations could not be read");
  return (result.data ?? []).map((row) => row.request_id as string);
}
