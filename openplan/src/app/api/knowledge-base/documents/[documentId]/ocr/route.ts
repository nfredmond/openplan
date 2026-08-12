import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { parseStorageRef, storageRefAllowed } from "@/lib/models/artifact-source";
import { KB_DOCUMENTS_BUCKET, looksLikePendingSchema } from "@/lib/knowledge-base/documents";
import {
  isKbOcrCallbackConfigured,
  isKbOcrWorkerConfigured,
  KB_OCR_CALLBACK_TOKEN_ENV,
  KB_OCR_WORKER_TOKEN_ENV,
  KB_OCR_WORKER_URL_ENV,
  resolveKbOcrCallbackMaxBytes,
  resolveKbOcrLanguages,
} from "@/lib/knowledge-base/ocr-availability";
import {
  buildOcrRequest,
  KB_OCR_JOB_COLUMNS,
  ocrCallbackSchema,
} from "@/lib/knowledge-base/ocr-contract";

/**
 * Ask this deployment's OCR worker to read a scanned document.
 *
 * WHAT THIS ROUTE IS AND IS NOT. It is a person, looking at a document they can
 * already see, asking a machine to read the pages. No assistant action exists
 * for it and none may be added: `ACTION_METADATA` gains nothing here, so
 * `refused-rtp-financial-actions-stay-refused` stays green BY CONSTRUCTION.
 * The reason is not squeamishness about automation — it is that OCR is the
 * first step of a chain that ends in a dollar figure inside an adopted plan,
 * and every link in that chain is a person deciding, with the page in front of
 * them, rather than a model deciding on their behalf.
 *
 * The refusals here all NAME OCR and say whether this deployment has it, so a
 * planner never meets "not supported" for something their own agency could
 * enable in ten minutes.
 */

export const runtime = "nodejs";

const WORKER_DISPATCH_TIMEOUT_MS = 15_000;

/**
 * How long the signed link to the PDF stays valid. One hour: the worker only
 * needs it long enough to DOWNLOAD (recognition happens afterwards, from a
 * local copy), but a large scan behind a slow link and a queued job can put
 * minutes between dispatch and fetch.
 */
const OCR_SOURCE_URL_TTL_SECONDS = 3600;

const ACTIVE_JOB_STATUSES = ["queued", "running"] as const;

const paramsSchema = z.object({ documentId: z.string().uuid() });

type RouteContext = { params: Promise<{ documentId: string }> };

type DocumentRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string | null;
  original_filename: string | null;
  byte_size: number | null;
  checksum: string | null;
  storage_ref: string | null;
  source_kind: string;
  status: string;
  extraction_source: string | null;
};

const DOCUMENT_COLUMNS =
  "id, workspace_id, project_id, title, original_filename, byte_size, checksum, storage_ref, source_kind, status, extraction_source";

function resolveCallbackUrl(request: NextRequest): string {
  const configured = process.env.OPENPLAN_KB_OCR_CALLBACK_URL?.trim();
  const base = (configured || new URL(request.url).origin).replace(/\/+$/, "");
  return `${base}/api/knowledge-base/ocr-callback`;
}

/** The one place that decides whether this deployment can dispatch at all. */
function describeMissingConfiguration(): string[] {
  const missing: string[] = [];
  if (!process.env.OPENPLAN_KB_OCR_WORKER_URL?.trim()) missing.push(KB_OCR_WORKER_URL_ENV);
  if (!process.env.OPENPLAN_KB_OCR_WORKER_TOKEN?.trim()) missing.push(KB_OCR_WORKER_TOKEN_ENV);
  if (!isKbOcrCallbackConfigured()) missing.push(KB_OCR_CALLBACK_TOKEN_ENV);
  return missing;
}

/**
 * GET — the state of OCR for this document, so a surface can say something
 * true without re-deriving the rule. Answers whether this deployment has a
 * worker and what the most recent job for this document did.
 *
 * A job-list read that FAILED is reported as unavailable with the reason, never
 * as "no job": "nothing has been tried" and "we could not look" need different
 * sentences, and only one of them invites the planner to press the button.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("knowledge_base.documents.ocr.status", request);

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

    // RLS scopes this to the caller's workspaces, so a hit already proves access.
    const { data: document, error } = await supabase
      .from("kb_documents")
      .select("id, source_kind, status, extraction_source")
      .eq("id", parsedParams.data.documentId)
      .maybeSingle();

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json(
          { error: "Knowledge Base schema is not available yet" },
          { status: 503 }
        );
      }
      audit.error("kb_ocr_status_document_lookup_failed", { message: error.message });
      return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
    }
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const jobResult = await supabase
      .from("kb_ocr_jobs")
      .select(KB_OCR_JOB_COLUMNS)
      .eq("document_id", parsedParams.data.documentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (jobResult.error && !looksLikePendingSchema(jobResult.error.message)) {
      audit.warn("kb_ocr_job_read_failed", { message: jobResult.error.message });
    }

    return NextResponse.json({
      workerConfigured: isKbOcrWorkerConfigured(),
      document: {
        sourceKind: document.source_kind,
        status: document.status,
        extractionSource: document.extraction_source,
      },
      latestJob: jobResult.error ? null : (jobResult.data ?? null),
      latestJobUnreadable: Boolean(jobResult.error),
    });
  } catch (error) {
    audit.error("kb_ocr_status_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while reading OCR status" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("knowledge_base.documents.ocr.request", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
    }
    const documentId = parsedParams.data.documentId;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Loading through the RLS client confirms the caller is a member of the
    // document's workspace before any service-role write happens; a foreign
    // document answers 404 here, not 403.
    const { data: documentData, error: documentError } = await supabase
      .from("kb_documents")
      .select(DOCUMENT_COLUMNS)
      .eq("id", documentId)
      .maybeSingle();

    if (documentError) {
      if (looksLikePendingSchema(documentError.message)) {
        return NextResponse.json(
          { error: "Knowledge Base schema is not available yet" },
          { status: 503 }
        );
      }
      audit.error("kb_ocr_document_lookup_failed", { message: documentError.message });
      return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
    }

    const document = (documentData ?? null) as DocumentRow | null;
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Visibility proves membership, not write authority. A read that FAILED
    // established no role, so the request stops here — answering 403 would be
    // the same mistake pointing the other way: it asserts a viewer role nobody
    // read either.
    const membershipResult = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", document.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipResult.error) {
      audit.error("kb_ocr_role_check_failed", { message: membershipResult.error.message });
      return NextResponse.json(
        {
          error:
            "We could not confirm your role in this workspace, so nothing was sent for reading. Try again in a moment.",
        },
        { status: 500 }
      );
    }
    if (isReadOnlyWorkspaceRole((membershipResult.data as { role?: string } | null)?.role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }

    // ── What can be read, and what already has been ──────────────────────
    if (document.source_kind !== "uploaded_pdf") {
      return NextResponse.json(
        {
          error: "not_a_scanned_pdf",
          detail:
            "OCR reads scanned PDFs. This document is not a PDF, so there are no pages to recognise. " +
            "Reading spreadsheets, images and CAD files is a separate capability OpenPlan does not have.",
        },
        { status: 409 }
      );
    }
    if (document.status === "ready") {
      return NextResponse.json(
        {
          error: "already_readable",
          detail:
            document.extraction_source === "ocr"
              ? "This document has already been read with OCR and is searchable and quotable."
              : "This document already has a text layer and is searchable and quotable; OCR would add nothing.",
        },
        { status: 409 }
      );
    }
    if (document.status !== "failed") {
      return NextResponse.json(
        {
          error: "not_awaiting_ocr",
          detail: `This document is '${document.status}'. OCR is offered for documents whose text extraction failed — the scans.`,
        },
        { status: 409 }
      );
    }

    // ── Does this deployment have a worker at all ────────────────────────
    const missing = describeMissingConfiguration();
    if (missing.length > 0) {
      audit.info("kb_ocr_not_configured", { documentId, missing });
      return NextResponse.json(
        {
          error: "ocr_not_configured",
          capability: "ocr",
          detail:
            "This deployment has no OCR service configured, so a scanned document cannot be read here. " +
            `Whoever operates it can set ${missing.join(", ")} and point them at an OCR worker — ` +
            "workers/ocr_worker in this repository is one, and its DEPLOY.md is a ten-minute checklist. " +
            "Nothing was sent, and no text was invented.",
          missingEnvironmentVariables: missing,
        },
        { status: 501 }
      );
    }
    const workerUrl = (process.env.OPENPLAN_KB_OCR_WORKER_URL ?? "").trim();
    const workerToken = (process.env.OPENPLAN_KB_OCR_WORKER_TOKEN ?? "").trim();

    // ── One job at a time per document ───────────────────────────────────
    const { data: activeJob, error: activeJobError } = await supabase
      .from("kb_ocr_jobs")
      .select("id, request_id, status")
      .eq("document_id", documentId)
      .in("status", [...ACTIVE_JOB_STATUSES])
      .limit(1)
      .maybeSingle();

    if (activeJobError) {
      if (looksLikePendingSchema(activeJobError.message)) {
        return NextResponse.json(
          {
            error: "ocr_schema_pending",
            detail:
              "The OCR tables are not in this database yet. Apply the latest Supabase migrations, then try again.",
          },
          { status: 503 }
        );
      }
      // A failed read is not an absence of jobs. Refusing costs a retry;
      // continuing would dispatch a second job for a document already being
      // read, and pay for the same pages twice.
      audit.error("kb_ocr_active_job_check_failed", { message: activeJobError.message });
      return NextResponse.json(
        {
          error: "ocr_job_state_unreadable",
          detail:
            "We could not check whether this document is already being read, so nothing was sent. That is a read failure, not an idle document — try again in a moment.",
        },
        { status: 500 }
      );
    }
    if (activeJob) {
      return NextResponse.json(
        {
          error: "ocr_already_running",
          requestId: (activeJob as { request_id: string }).request_id,
          detail: "This document is already being read. Reading a long scan can take many minutes.",
        },
        { status: 409 }
      );
    }

    // ── Mint the signed link, confined to this document's own prefix ─────
    const storageRefRaw = (document.storage_ref ?? "").trim();
    if (!storageRefRaw) {
      return NextResponse.json(
        {
          error: "no_stored_file",
          detail: "This document has no stored file, so there are no pages to read.",
        },
        { status: 409 }
      );
    }

    const scope = {
      bucket: KB_DOCUMENTS_BUCKET,
      objectPathPrefix: `${document.workspace_id}/${document.id}/`,
    } as const;
    const ref = parseStorageRef(storageRefRaw) ?? {
      bucket: KB_DOCUMENTS_BUCKET,
      objectPath: storageRefRaw,
    };
    if (ref.objectPath.startsWith("/") || !storageRefAllowed(ref, scope)) {
      audit.warn("kb_ocr_ref_out_of_scope", { documentId, bucket: ref.bucket });
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const service = createServiceRoleClient();
    const { data: signed, error: signError } = await service.storage
      .from(ref.bucket)
      .createSignedUrl(ref.objectPath, OCR_SOURCE_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      audit.error("kb_ocr_sign_failed", {
        documentId,
        message: signError?.message ?? "no signed url",
      });
      return NextResponse.json(
        { error: "Failed to prepare the document for reading" },
        { status: 500 }
      );
    }

    // ── Record the job BEFORE dispatch ───────────────────────────────────
    // A crash between the two steps must not orphan an accepted worker job:
    // the callback route resolves the document and the workspace from
    // request_id via this row.
    const requestId = randomUUID();
    const languages = resolveKbOcrLanguages();
    const maxCallbackBytes = resolveKbOcrCallbackMaxBytes();

    const { data: jobRow, error: jobInsertError } = await service
      .from("kb_ocr_jobs")
      .insert({
        workspace_id: document.workspace_id,
        document_id: document.id,
        request_id: requestId,
        status: "queued",
        languages,
        requested_by: user.id,
      })
      .select("id")
      .single();

    if (jobInsertError || !jobRow) {
      audit.error("kb_ocr_job_insert_failed", {
        documentId,
        message: jobInsertError?.message ?? "unknown",
      });
      if (looksLikePendingSchema(jobInsertError?.message)) {
        return NextResponse.json(
          {
            error: "ocr_schema_pending",
            detail:
              "The OCR tables are not in this database yet. Apply the latest Supabase migrations, then try again.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "Failed to record the OCR request" }, { status: 500 });
    }

    const markFailed = async (reason: string) => {
      const { error } = await service
        .from("kb_ocr_jobs")
        .update({ status: "failed", failure_detail: reason.slice(0, 2048) })
        .eq("id", jobRow.id);
      if (error) {
        audit.error("kb_ocr_dispatch_failure_writeback_failed", {
          requestId,
          message: error.message,
        });
      }
    };

    const ocrRequest = buildOcrRequest({
      requestId,
      callbackUrl: resolveCallbackUrl(request),
      documentId: document.id,
      workspaceId: document.workspace_id,
      projectId: document.project_id,
      documentTitle: document.title ?? document.original_filename ?? "Untitled document",
      sourceUrl: signed.signedUrl,
      filename: document.original_filename,
      sizeBytes: document.byte_size,
      checksumSha256: document.checksum,
      languages,
      maxCallbackBytes,
    });

    let workerResponse: Response;
    try {
      workerResponse = await fetch(`${workerUrl.replace(/\/+$/, "")}/api/v1/ocr-requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify(ocrRequest),
        signal: AbortSignal.timeout(WORKER_DISPATCH_TIMEOUT_MS),
      });
    } catch (fetchError) {
      const detail = fetchError instanceof Error ? fetchError.message : "worker fetch failed";
      audit.error("kb_ocr_worker_dispatch_failed", { requestId, documentId, detail });
      await markFailed(`The OCR service could not be reached: ${detail}`);
      return NextResponse.json({ error: "ocr_worker_unreachable", detail }, { status: 502 });
    }

    if (workerResponse.status !== 200 && workerResponse.status !== 202) {
      const errorText = (await workerResponse.text().catch(() => "")).trim();
      const detail = errorText
        ? `the OCR service answered ${workerResponse.status}: ${errorText.slice(0, 500)}`
        : `the OCR service answered ${workerResponse.status}`;
      audit.error("kb_ocr_worker_dispatch_rejected", {
        requestId,
        documentId,
        status: workerResponse.status,
      });
      await markFailed(detail);
      return NextResponse.json({ error: "ocr_worker_refused", detail }, { status: 502 });
    }

    const acceptedBody = await workerResponse.json().catch(() => null);
    const parsedAccepted = ocrCallbackSchema.safeParse(acceptedBody);
    if (!parsedAccepted.success || parsedAccepted.data.status !== "accepted") {
      const detail =
        "the OCR service's answer did not match the extraction contract, so the request was not accepted";
      audit.error("kb_ocr_accepted_response_invalid", {
        requestId,
        documentId,
        issues: parsedAccepted.success ? null : parsedAccepted.error.issues,
      });
      await markFailed(detail);
      return NextResponse.json({ error: "ocr_worker_refused", detail }, { status: 502 });
    }

    const accepted = parsedAccepted.data;
    const { error: acceptUpdateError } = await service
      .from("kb_ocr_jobs")
      .update({
        status: "running",
        worker_job_id: accepted.jobReference,
        last_callback_id: accepted.callbackId,
        last_callback_at: accepted.occurredAt,
        message: "The OCR service accepted this document and is reading it.",
      })
      .eq("id", jobRow.id);

    if (acceptUpdateError) {
      // The worker owns the job now; keep the row (callbacks will advance it)
      // but surface the writeback problem.
      audit.error("kb_ocr_job_accept_update_failed", {
        requestId,
        message: acceptUpdateError.message,
      });
    }

    audit.info("kb_ocr_requested", {
      documentId,
      workspaceId: document.workspace_id,
      userId: user.id,
      requestId,
      workerJobId: accepted.jobReference,
      languages,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        requestId,
        status: "accepted",
        languages,
        detail:
          "The OCR service is reading this document. A long scan can take many minutes; the document " +
          "becomes searchable when it finishes.",
      },
      { status: 202 }
    );
  } catch (error) {
    audit.error("kb_ocr_request_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while requesting OCR" },
      { status: 500 }
    );
  }
}
