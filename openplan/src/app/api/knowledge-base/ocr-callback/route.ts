import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { timingSafeSecretEquals } from "@/lib/http/secret-compare";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { buildKbChunkRows, insertKbChunks } from "@/lib/knowledge-base/documents";
import { chunkExtractedDocument } from "@/lib/knowledge-base/chunk";
import {
  isKbOcrCallbackConfigured,
  resolveKbOcrCallbackMaxBytes,
} from "@/lib/knowledge-base/ocr-availability";
import {
  ocrCallbackSchema,
  ocrPagesToExtractedPages,
  OCR_STATUS_TO_JOB_STATUS,
  TERMINAL_KB_OCR_JOB_STATUSES,
  type OcrCallback,
} from "@/lib/knowledge-base/ocr-contract";

/**
 * Where recognised text becomes citable evidence.
 *
 * The OCR worker POSTs here, bearer-authenticated, as a job advances. On a
 * `succeeded` delivery this route does the one thing the whole lane exists for:
 * it turns per-page recognised text into page-anchored chunks and flips the
 * document to `ready` with `extraction_source = 'ocr'`.
 *
 * THE PAGE SURVIVES OR NOTHING SHIPS. The pages arrive numbered 1..N with no
 * gaps — `ocrCallbackSchema` refuses any other shape — and go straight into
 * `chunkExtractedDocument`, the SAME deterministic chunker the text-layer path
 * uses, which carries each chunk's page range into `kb_document_chunks`. There
 * is no second chunking path here and there must never be one: two chunkers
 * would eventually disagree, and the RTP extraction lane's verifier depends on
 * a quote being a substring of the chunk that carries it.
 *
 * NOTHING HERE INVENTS TEXT. The route writes what the worker sent, or it
 * writes nothing and records why. A `failed` delivery leaves the document
 * exactly as it was — `failed`, zero chunks, uncitable — with the reason on the
 * job row, because a document that could not be read must keep saying so.
 *
 * IDEMPOTENT IN TWO LAYERS, because a redelivery that inserted the chunks twice
 * would double every excerpt in search and there would be no error anywhere:
 *   1. `kb_ocr_job_callbacks.callback_id` is UNIQUE — a replayed delivery fails
 *      with 23505 and this route answers `deduped` without re-applying.
 *   2. A DIFFERENT callbackId reporting the same terminal state is refused by
 *      the job's own terminal-status check, and the chunk insert is skipped
 *      when the document already has chunks.
 */

export const runtime = "nodejs";
// Chunking a 500-page scan is CPU work on a large string; give it more than the
// platform default.
export const maxDuration = 300;

const POSTGRES_UNIQUE_VIOLATION = "23505";

const CALLBACK_TOKEN_ENV = "OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN";

type OcrJobRow = {
  id: string;
  workspace_id: string;
  document_id: string;
  request_id: string;
  worker_job_id: string | null;
  status: string;
};

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

/** The engine block, flattened onto the job row. Absent fields stay absent. */
function engineColumns(callback: OcrCallback): Record<string, unknown> {
  const engine = callback.engine;
  if (!engine) return {};
  return {
    engine_name: engine.name,
    engine_version: engine.version ?? null,
    // The languages the worker ACTUALLY used, which can differ from the ones
    // requested. Text recognised with the wrong language pack comes back
    // looking exactly like text; this column is the only place that would ever
    // say so.
    languages: engine.languages ?? null,
    pages_with_text: engine.pagesWithText ?? null,
  };
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
    const supabase = createServiceRoleClient();

    const { data: jobData, error: jobError } = await supabase
      .from("kb_ocr_jobs")
      .select("id, workspace_id, document_id, request_id, worker_job_id, status")
      .eq("request_id", callback.requestId)
      .maybeSingle();

    if (jobError) {
      audit.error("kb_ocr_job_lookup_failed", {
        requestId: callback.requestId,
        message: jobError.message,
      });
      return NextResponse.json({ error: "Failed to load the OCR job" }, { status: 500 });
    }
    if (!jobData) {
      audit.warn("unknown_request", {
        requestId: callback.requestId,
        callbackId: callback.callbackId,
      });
      return NextResponse.json({ error: "unknown_request" }, { status: 404 });
    }
    const job = jobData as OcrJobRow;

    if (job.worker_job_id && job.worker_job_id !== callback.jobReference) {
      audit.warn("kb_ocr_job_reference_mismatch", {
        requestId: callback.requestId,
        storedWorkerJobId: job.worker_job_id,
        callbackJobReference: callback.jobReference,
      });
      // Proceed by request_id: it is the idempotency key both sides agreed on.
    }

    // ── Layer 1 of idempotency: the ledger ────────────────────────────────
    const { error: ledgerError } = await supabase.from("kb_ocr_job_callbacks").insert({
      ocr_job_id: job.id,
      workspace_id: job.workspace_id,
      callback_id: callback.callbackId,
      status: callback.status,
      occurred_at: callback.occurredAt,
      page_count: callback.pageCount ?? null,
      payload_bytes: payloadBody.byteLength,
    });

    if (ledgerError) {
      if (ledgerError.code === POSTGRES_UNIQUE_VIOLATION) {
        audit.info("kb_ocr_callback_deduped", {
          requestId: callback.requestId,
          callbackId: callback.callbackId,
        });
        return NextResponse.json({ ok: true, deduped: true }, { status: 200 });
      }
      audit.error("kb_ocr_callback_ledger_insert_failed", {
        requestId: callback.requestId,
        callbackId: callback.callbackId,
        message: ledgerError.message,
        code: ledgerError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to record the OCR callback" }, { status: 500 });
    }

    // ── Layer 2: never re-apply a terminal transition ─────────────────────
    const nextStatus = OCR_STATUS_TO_JOB_STATUS[callback.status];
    if (TERMINAL_KB_OCR_JOB_STATUSES.includes(job.status as (typeof TERMINAL_KB_OCR_JOB_STATUSES)[number])) {
      audit.info("kb_ocr_terminal_status_preserved", {
        requestId: callback.requestId,
        jobStatus: job.status,
        callbackStatus: callback.status,
      });
      return NextResponse.json({ ok: true, ignored: "terminal" }, { status: 200 });
    }

    const jobUpdate: Record<string, unknown> = {
      status: nextStatus,
      message: callback.message ?? null,
      last_callback_id: callback.callbackId,
      last_callback_at: callback.occurredAt,
      ...engineColumns(callback),
    };
    if (!job.worker_job_id) jobUpdate.worker_job_id = callback.jobReference;
    if (typeof callback.progress === "number") jobUpdate.progress = callback.progress;
    if (typeof callback.pageCount === "number") jobUpdate.page_count = callback.pageCount;

    if (nextStatus === "failed") {
      // The document keeps saying it could not be read, which is still true.
      // The REASON lands on the job, where a planner asking "why not?" can find
      // it — a failure with no cause recorded is the defect this repo has paid
      // for before (a crashed model run that read as benign).
      jobUpdate.failure_detail =
        callback.message ??
        (callback.status === "canceled"
          ? "The OCR service cancelled this job without saying why."
          : "The OCR service reported a failure without saying why.");

      const { error: failUpdateError } = await supabase
        .from("kb_ocr_jobs")
        .update(jobUpdate)
        .eq("id", job.id);
      if (failUpdateError) {
        audit.error("kb_ocr_job_update_failed", {
          requestId: callback.requestId,
          message: failUpdateError.message,
        });
        return NextResponse.json({ error: "Failed to update the OCR job" }, { status: 500 });
      }

      audit.info("kb_ocr_failed", {
        requestId: callback.requestId,
        documentId: job.document_id,
        workspaceId: job.workspace_id,
        callbackStatus: callback.status,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ ok: true, status: nextStatus }, { status: 200 });
    }

    if (nextStatus !== "succeeded") {
      const { error: progressError } = await supabase
        .from("kb_ocr_jobs")
        .update(jobUpdate)
        .eq("id", job.id);
      if (progressError) {
        audit.error("kb_ocr_job_update_failed", {
          requestId: callback.requestId,
          message: progressError.message,
        });
        return NextResponse.json({ error: "Failed to update the OCR job" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, status: nextStatus }, { status: 200 });
    }

    // ── succeeded: the text becomes citable ───────────────────────────────
    // The schema guaranteed pages+pageCount on a succeeded callback; this
    // records that rather than assuming it.
    const pages = callback.pages ?? [];

    const extractedPages = ocrPagesToExtractedPages(pages);
    if (extractedPages.length === 0) {
      // Every page came back empty. The recogniser ran and found nothing — a
      // real outcome for a photocopy of a photocopy, and NOT a success. The
      // document stays uncitable and says why, rather than becoming a `ready`
      // document with zero chunks, which would read everywhere as "indexed".
      const { error: emptyUpdateError } = await supabase
        .from("kb_ocr_jobs")
        .update({
          ...jobUpdate,
          status: "failed",
          failure_detail:
            `OCR read all ${pages.length} pages and recognised no text on any of them. The scan may be ` +
            "too faint, or the pages may be images with no writing on them. The document is unchanged.",
        })
        .eq("id", job.id);
      if (emptyUpdateError) {
        audit.error("kb_ocr_job_update_failed", {
          requestId: callback.requestId,
          message: emptyUpdateError.message,
        });
      }
      audit.info("kb_ocr_no_text_recognised", {
        requestId: callback.requestId,
        documentId: job.document_id,
        pageCount: pages.length,
      });
      return NextResponse.json({ ok: true, status: "failed", reason: "no_text_recognised" }, { status: 200 });
    }

    const chunks = chunkExtractedDocument(extractedPages);
    const charCount = extractedPages.reduce((sum, page) => sum + page.text.length, 0);

    // Belt and braces against a double insert that the ledger's UNIQUE could
    // not catch (a genuinely new callbackId reporting the same success). A
    // document with chunks already keeps them; nothing is deleted here, because
    // deleting a workspace's indexed text on the strength of a worker callback
    // is not a trade this route gets to make.
    const { count: existingChunks, error: chunkCountError } = await supabase
      .from("kb_document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", job.document_id);

    if (chunkCountError) {
      audit.error("kb_ocr_existing_chunk_count_failed", {
        requestId: callback.requestId,
        message: chunkCountError.message,
      });
      return NextResponse.json(
        { error: "Failed to check the document's existing text" },
        { status: 500 }
      );
    }

    if ((existingChunks ?? 0) === 0) {
      const chunkRows = buildKbChunkRows(job.document_id, job.workspace_id, chunks);
      const chunkError = await insertKbChunks(supabase, chunkRows);
      if (chunkError) {
        await supabase
          .from("kb_ocr_jobs")
          .update({
            ...jobUpdate,
            status: "failed",
            failure_detail: `The recognised text could not be indexed: ${chunkError.message}`,
          })
          .eq("id", job.id);
        audit.error("kb_ocr_chunk_insert_failed", {
          requestId: callback.requestId,
          documentId: job.document_id,
          message: chunkError.message,
        });
        return NextResponse.json({ error: "Failed to index the recognised text" }, { status: 500 });
      }
    } else {
      audit.warn("kb_ocr_chunks_already_present", {
        requestId: callback.requestId,
        documentId: job.document_id,
        existingChunks,
      });
    }

    // The document flips LAST. Until this write lands the chunks are invisible
    // to retrieval (kb_search_chunks filters on status = 'ready'), so a crash
    // between the two steps leaves a document that is honestly still unread
    // rather than one that half-claims to be indexed.
    const { error: documentUpdateError } = await supabase
      .from("kb_documents")
      .update({
        status: "ready",
        extraction_source: "ocr",
        page_count: callback.pageCount ?? pages.length,
        chunk_count: chunks.length,
        char_count: charCount,
        // The stored parser error described a document with no text layer.
        // That is no longer the state of this row, and leaving the sentence
        // behind would be a `ready` document still saying it could not be read.
        extraction_error: null,
      })
      .eq("id", job.document_id);

    if (documentUpdateError) {
      await supabase
        .from("kb_ocr_jobs")
        .update({
          ...jobUpdate,
          status: "failed",
          failure_detail:
            "The text was recognised and indexed, but the document could not be marked readable: " +
            documentUpdateError.message,
        })
        .eq("id", job.id);
      audit.error("kb_ocr_document_update_failed", {
        requestId: callback.requestId,
        documentId: job.document_id,
        message: documentUpdateError.message,
      });
      return NextResponse.json({ error: "Failed to mark the document readable" }, { status: 500 });
    }

    const { error: jobUpdateError } = await supabase
      .from("kb_ocr_jobs")
      .update({ ...jobUpdate, progress: 100 })
      .eq("id", job.id);
    if (jobUpdateError) {
      audit.error("kb_ocr_job_update_failed", {
        requestId: callback.requestId,
        message: jobUpdateError.message,
      });
    }

    audit.info("kb_ocr_document_ready", {
      requestId: callback.requestId,
      documentId: job.document_id,
      workspaceId: job.workspace_id,
      pages: callback.pageCount ?? pages.length,
      pagesWithText: extractedPages.length,
      chunks: chunks.length,
      chars: charCount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { ok: true, status: "succeeded", chunks: chunks.length },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      audit.warn("kb_ocr_callback_invalid", {
        durationMs: Date.now() - startedAt,
        message: error.message,
      });
      return NextResponse.json({ error: "Invalid OCR callback payload" }, { status: 400 });
    }
    audit.error("kb_ocr_callback_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json(
      { error: "Unexpected error while handling the OCR callback" },
      { status: 500 }
    );
  }
}
