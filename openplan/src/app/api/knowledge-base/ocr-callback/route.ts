import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { timingSafeSecretEquals } from "@/lib/http/secret-compare";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { buildKbChunkRows } from "@/lib/knowledge-base/documents";
import { chunkExtractedDocument } from "@/lib/knowledge-base/chunk";
import {
  isKbOcrCallbackConfigured,
  resolveKbOcrCallbackMaxBytes,
} from "@/lib/knowledge-base/ocr-availability";
import {
  ocrCallbackSchema,
  ocrPagesToExtractedPages,
} from "@/lib/knowledge-base/ocr-contract";

/** Commit the receipt, retained pages, index and job state in one database transaction. */
export const runtime = "nodejs";
const CALLBACK_TOKEN_ENV = "OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN";

function parseBearer(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isAuthenticated(request: NextRequest): boolean {
  const configured = process.env[CALLBACK_TOKEN_ENV]?.trim();
  if (!configured) return false;
  return timingSafeSecretEquals(parseBearer(request), configured);
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("knowledge_base.ocr.callback", request);
  const startedAt = Date.now();

  try {
    if (!isKbOcrCallbackConfigured()) {
      // 503, not 401: "not provisioned" and "bad credentials" are different
      // problems for whoever is holding the worker's logs.
      audit.warn("missing_config", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "missing_config" }, { status: 503 });
    }
    if (!isAuthenticated(request)) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The ceiling the worker was TOLD about at dispatch (it measures its
    // payload against the same number and fails with both figures rather than
    // meeting this 413 with nothing to learn from it).
    const maxBytes = resolveKbOcrCallbackMaxBytes();
    const payloadBody = await readJsonOrNullWithLimit(request, maxBytes);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = ocrCallbackSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json(
        { error: "Invalid OCR callback payload", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const callback = parsed.data;
    const service = createServiceRoleClient();
    const job = await service.from("kb_ocr_jobs").select("id, document_id, workspace_id").eq("request_id", callback.requestId).maybeSingle();
    if (job.error) return NextResponse.json({ error: "Could not load extraction job" }, { status: 503 });
    if (!job.data) return NextResponse.json({ error: "unknown_request" }, { status: 404 });
    const pages = ocrPagesToExtractedPages(callback.pages ?? []);
    const chunks = callback.status === "succeeded" ? buildKbChunkRows(job.data.document_id, job.data.workspace_id, chunkExtractedDocument(pages)) : [];
    const result = await service.rpc("apply_kb_extraction_callback", { p_callback: callback, p_chunks: chunks, p_payload_bytes: payloadBody.byteLength });
    if (result.error) {
      audit.warn("kb_extraction_callback_not_applied", { code: result.error.code });
      return NextResponse.json({ error: "The extraction result was not applied; retry the same callback." }, { status: result.error.code === "42501" ? 403 : result.error.code === "PT409" ? 409 : 503 });
    }
    return NextResponse.json(result.data);
  } catch (error) {
    audit.error("kb_ocr_callback_unhandled_error", { error });
    return NextResponse.json({ error: "The extraction result was not applied; retry the same callback." }, { status: 503 });
  }
}
