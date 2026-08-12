/**
 * RTP DOCUMENT EXTRACTION — the run route.
 *
 * POST reads an uploaded, already-indexed adopted plan and stages what it finds
 * as CANDIDATES: a proposed value, the page it came from, and the document's
 * own words. Nothing here writes an RTP table. Acceptance is a separate,
 * human-pressed action that runs the ordinary write route with the ordinary
 * permission check, and a candidate whose quote the verifier could not confirm
 * can never be accepted at all — `rtp_extraction_candidates` enforces that with
 * a CHECK rather than trusting a rule in a route.
 *
 * GET lists this cycle's runs, newest first, so the review surface can group by
 * run and show what each one read and what it dropped.
 *
 * NO ASSISTANT ACTION IS REGISTERED FOR EITHER. `ACTION_METADATA` gains
 * nothing, so the five 2026-08-05 RTP financial refusals stay green BY
 * CONSTRUCTION — the guard enumerates `Object.keys(ACTION_METADATA)` and has no
 * new key to see. The difference between those refusals and this route is not
 * the payload: it is that this one has a document behind it and a human in
 * front of it.
 *
 * THREE THINGS THIS ROUTE IS CAREFUL ABOUT, in the order they bite.
 *
 * 1. IT REFUSES BY NAME WHEN THE DOCUMENT IS NOT READY. A scan with no text
 *    layer is the common case and the honest answer depends on the deployment:
 *    an operator who has wired up an OCR worker gets told to run it, and one
 *    who has not gets told that reading a scan needs a service they do not
 *    have. `lib/knowledge-base/ocr-availability.ts` composes both sentences at
 *    display time, because the stored `extraction_error` was written when the
 *    answer could still change.
 *
 * 2. THE PROMPT NEVER SEES THE DATABASE. This route reads the cycle's horizon
 *    bands — and hands them to the VERIFIER, which resolves a quoted period
 *    label against them. They do not go into the prompt and there is nowhere in
 *    `buildExtractionPrompt` to put them. A model shown the existing ledger can
 *    copy it back and call it transcription, and the result would be a figure
 *    that left OpenPlan and returned wearing a page citation.
 *    `src/test/rtp-extraction-run-route.test.ts` seeds sentinel values into
 *    those rows and asserts they reach no prompt.
 *
 * 3. A FAILED RUN SAYS SO. The run row is written either way; a model failure
 *    answers 502 with the run and a named reason, never a 201 that reads as
 *    "recorded". A crashed run that looked benign is a defect this repository
 *    has already shipped once (2026-08-10, the modeling lane).
 */

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";

import { anthropicModel, hasAnthropicAccess } from "@/lib/integrations/anthropic-access";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { insertNotReadableBackResponse } from "@/lib/http/write-outcome";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { checkAiUsageRateLimit, recordAiUsageEvent } from "@/lib/runtime/ai-rate-limit";
import { authorizeRtpCycleWrite } from "@/lib/rtp/cycle-write-authorization";
import {
  describeUnreadableDocument,
  documentCanBeOcred,
  isKbOcrWorkerConfigured,
} from "@/lib/knowledge-base/ocr-availability";
import {
  EXTRACTION_CHUNKS_PER_TARGET,
  EXTRACTION_CHUNK_PAGE_SIZE,
  EXTRACTION_MAX_CHUNKS_SCANNED,
  EXTRACTION_MAX_MODEL_CALLS,
  RTP_EXTRACTION_DEFAULT_TARGET_KINDS,
  RTP_EXTRACTION_TARGET_KINDS,
  resolveRtpExtractionModelId,
  type RtpExtractionTargetKind,
} from "@/lib/rtp/extraction/contract";
import {
  PASSAGE_EXCLUSION_SENTENCES,
  RTP_EXTRACTION_DISCARD_SENTENCES,
  buildExtractionPassages,
  type ExtractionChunkRow,
  type PassageExclusionReason,
} from "@/lib/rtp/extraction/verify";
import { runRtpExtraction } from "@/lib/rtp/extraction/run";

const ROUTE_PATH = "/api/rtp-cycles/[rtpCycleId]/extraction-runs";

const paramsSchema = z.object({ rtpCycleId: z.string().uuid() });

const createRunSchema = z
  .object({
    kbDocumentId: z.string().uuid(),
    targetKinds: z.array(z.enum(RTP_EXTRACTION_TARGET_KINDS)).min(1).max(6).optional(),
  })
  .strict();

const RUN_COLUMNS =
  "id, workspace_id, rtp_cycle_id, kb_document_id, model, extraction_source, status, candidate_count, discarded_count, failure_reason, created_by, created_at";

const DOCUMENT_COLUMNS =
  "id, workspace_id, title, doc_kind, source_kind, status, extraction_source, extraction_error, chunk_count, page_count";

type DocumentRow = {
  id: string;
  workspace_id: string;
  title: string | null;
  doc_kind: string | null;
  source_kind: string;
  status: string;
  extraction_source: string | null;
  extraction_error: string | null;
  chunk_count: number | null;
  page_count: number | null;
};

/**
 * WHY THIS DOCUMENT CANNOT BE TRANSCRIBED, in words written for the planner who
 * uploaded it — naming OCR when OCR is the answer, and naming whether this
 * deployment has it.
 *
 * `null` means the document IS ready. Every other branch says what is true now
 * rather than repeating what was true at upload time.
 */
function refuseUnreadyDocument(
  document: DocumentRow,
  workerConfigured: boolean
): { reason: string; message: string } | null {
  if (document.status === "ready") return null;

  if (documentCanBeOcred(document)) {
    return {
      reason: "document_needs_ocr",
      message: `"${document.title ?? "This document"}" has not been read yet. ${describeUnreadableDocument(
        document.extraction_error,
        workerConfigured
      )}`,
    };
  }

  const byStatus: Record<string, string> = {
    pending: "is still queued to be read. Try again in a moment.",
    extracting: "is being read right now. Try again once it finishes.",
    failed: `could not be read: ${
      document.extraction_error?.trim() || "the reason was not recorded"
    }.`,
    stored:
      "was kept for download and reference only — no text was extracted from it, so there are no pages to quote. Upload it again as a document to be read if you want to transcribe from it.",
    archived: "has been archived. Restore it before transcribing from it.",
  };

  return {
    reason: "document_not_ready",
    message: `"${document.title ?? "This document"}" ${
      byStatus[document.status] ?? `is not ready to be read (status: ${document.status}).`
    }`,
  };
}

/**
 * `rtp_extraction_runs.extraction_source` admits only the two ways text can
 * carry a page. Pasted text has no pages and a stored file has no text, so
 * neither can be transcribed FROM by this lane — refused here with a sentence
 * rather than degraded into a candidate with no anchor.
 */
function resolveRunExtractionSource(document: DocumentRow): "text_layer" | "ocr" | null {
  return document.extraction_source === "text_layer" || document.extraction_source === "ocr"
    ? document.extraction_source
    : null;
}

/**
 * Read the document's own chunks, in document order, paging past PostgREST's
 * 1000-row default ceiling.
 *
 * Returns the read failure rather than an empty list, because a chunk read that
 * FAILED and a document with no chunks are the same `[]` and only one of them
 * means "this plan has nothing on the subject".
 */
async function loadDocumentChunks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  documentId: string
): Promise<
  | { ok: true; chunks: ExtractionChunkRow[]; truncated: boolean }
  | { ok: false; failure: NonNullable<ReturnType<typeof classifyRouteReadFailure>> }
> {
  const chunks: ExtractionChunkRow[] = [];
  for (let offset = 0; offset < EXTRACTION_MAX_CHUNKS_SCANNED; offset += EXTRACTION_CHUNK_PAGE_SIZE) {
    const result = await supabase
      .from("kb_document_chunks")
      .select("id, chunk_index, page_from, page_to, content")
      .eq("document_id", documentId)
      .eq("workspace_id", workspaceId)
      .order("chunk_index", { ascending: true })
      .range(offset, offset + EXTRACTION_CHUNK_PAGE_SIZE - 1);

    const failure = classifyRouteReadFailure("the document's indexed pages", result);
    if (failure) return { ok: false, failure };

    const page = (result.data ?? []) as ExtractionChunkRow[];
    chunks.push(...page);
    if (page.length < EXTRACTION_CHUNK_PAGE_SIZE) {
      return { ok: true, chunks, truncated: false };
    }
  }
  return { ok: true, chunks, truncated: true };
}

function countExclusions(
  excluded: readonly { reason: PassageExclusionReason }[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const exclusion of excluded) {
    counts[exclusion.reason] = (counts[exclusion.reason] ?? 0) + 1;
  }
  return counts;
}

type RouteContext = { params: Promise<{ rtpCycleId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.extraction_runs", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }
    const rtpCycleId = parsedParams.data.rtpCycleId;

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = createRunSchema.safeParse(payloadBody.data);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json({ error: "Invalid extraction run payload" }, { status: 400 });
    }
    const { kbDocumentId } = parsedBody.data;
    const targetKinds: readonly RtpExtractionTargetKind[] =
      parsedBody.data.targetKinds ?? RTP_EXTRACTION_DEFAULT_TARGET_KINDS;

    const supabase = await createClient();
    // The cast is the repo's untyped-client convention: comparing the full
    // client generic against the lib's structural type trips TS2589.
    const authorized = await authorizeRtpCycleWrite(
      supabase as unknown as Parameters<typeof authorizeRtpCycleWrite>[0],
      audit,
      rtpCycleId,
      { cycleColumns: "id, workspace_id, title" }
    );
    if (!authorized.ok) return authorized.response;
    const { workspaceId, userId } = authorized;

    // ---- The document, and whether it can be transcribed from at all. ------
    const documentResult = await supabase
      .from("kb_documents")
      .select(DOCUMENT_COLUMNS)
      .eq("id", kbDocumentId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const documentFailure = classifyRouteReadFailure("the document", documentResult);
    if (documentFailure) {
      audit.error("extraction_document_lookup_failed", {
        rtpCycleId,
        kbDocumentId,
        message: documentFailure.message,
      });
      return NextResponse.json(documentFailure.body, { status: documentFailure.status });
    }
    if (!documentResult.data) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const document = documentResult.data as unknown as DocumentRow;

    const workerConfigured = isKbOcrWorkerConfigured();
    const notReady = refuseUnreadyDocument(document, workerConfigured);
    if (notReady) {
      audit.warn("extraction_document_not_ready", {
        rtpCycleId,
        kbDocumentId,
        documentStatus: document.status,
        reason: notReady.reason,
        ocrWorkerConfigured: workerConfigured,
      });
      return NextResponse.json(
        {
          error: notReady.message,
          reason: notReady.reason,
          documentStatus: document.status,
          ocrWorkerConfigured: workerConfigured,
        },
        { status: 409 }
      );
    }

    const extractionSource = resolveRunExtractionSource(document);
    if (!extractionSource) {
      audit.warn("extraction_source_cannot_cite_a_page", {
        rtpCycleId,
        kbDocumentId,
        extractionSource: document.extraction_source,
      });
      return NextResponse.json(
        {
          error: `"${
            document.title ?? "This document"
          }" has no pages to cite. Transcribing from a plan means quoting a page, and this document's text did not come from one.`,
          reason: "no_page_anchor",
          documentStatus: document.status,
        },
        { status: 409 }
      );
    }

    // ---- Q8: no dedup, but say so when this pair has already been read. ----
    const priorRunsResult = await supabase
      .from("rtp_extraction_runs")
      .select("id, created_at")
      .eq("rtp_cycle_id", rtpCycleId)
      .eq("kb_document_id", kbDocumentId)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1);

    const priorRunsFailure = classifyRouteReadFailure("earlier extraction runs", priorRunsResult);
    if (priorRunsFailure) {
      audit.error("extraction_prior_run_lookup_failed", {
        rtpCycleId,
        kbDocumentId,
        message: priorRunsFailure.message,
      });
      return NextResponse.json(priorRunsFailure.body, { status: priorRunsFailure.status });
    }
    const priorRun = (priorRunsResult.data ?? [])[0] as { id: string; created_at: string } | undefined;
    const duplicateWarning = priorRun
      ? "This document has already been read into this plan. Reading it again stages a second set of proposals; nothing already accepted is changed or removed."
      : null;

    // ---- The cycle's bands. For the VERIFIER only. Never the prompt. -------
    const bandsResult = await supabase
      .from("rtp_horizon_bands")
      .select("id, label")
      .eq("rtp_cycle_id", rtpCycleId)
      .eq("workspace_id", workspaceId);

    const bandsFailure = classifyRouteReadFailure("the plan's periods", bandsResult);
    if (bandsFailure) {
      audit.error("extraction_band_lookup_failed", { rtpCycleId, message: bandsFailure.message });
      return NextResponse.json(bandsFailure.body, { status: bandsFailure.status });
    }
    const bands = (bandsResult.data ?? []) as Array<{ id: string; label: string | null }>;

    // ---- The document's pages. -------------------------------------------
    const chunkRead = await loadDocumentChunks(supabase, workspaceId, kbDocumentId);
    if (!chunkRead.ok) {
      audit.error("extraction_chunk_read_failed", {
        rtpCycleId,
        kbDocumentId,
        message: chunkRead.failure.message,
      });
      return NextResponse.json(chunkRead.failure.body, { status: chunkRead.failure.status });
    }

    const { passages, excluded } = buildExtractionPassages(chunkRead.chunks);

    return await withWorkspaceIntegrationContext(workspaceId, async () => {
      // Inside the integration context: a workspace's own key counts as access.
      if (!hasAnthropicAccess()) {
        audit.warn("ai_offline", { rtpCycleId, kbDocumentId });
        return NextResponse.json(
          {
            error:
              "Reading a plan document needs an Anthropic API key, and this deployment does not have one configured. Add one in workspace settings, or ask whoever runs this installation to set ANTHROPIC_API_KEY.",
            reason: "ai_offline",
          },
          { status: 503 }
        );
      }

      const rateLimit = await checkAiUsageRateLimit(workspaceId);
      if (!rateLimit.allowed) {
        audit.warn("extraction_rate_limited", { rtpCycleId, workspaceId, recentCount: rateLimit.count });
        return NextResponse.json(
          { error: "Too many AI requests in a short window. Please wait a moment and try again." },
          { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
        );
      }

      const serviceSupabase = createServiceRoleClient();
      const modelId = resolveRtpExtractionModelId();

      // The run row is created BEFORE the model is called and carries no model
      // id yet: writing one for a call that never happened would be a small lie
      // in a provenance record.
      const { data: runRow, error: runInsertError } = await serviceSupabase
        .from("rtp_extraction_runs")
        .insert({
          workspace_id: workspaceId,
          rtp_cycle_id: rtpCycleId,
          kb_document_id: kbDocumentId,
          extraction_source: extractionSource,
          status: "running",
          created_by: userId,
        })
        .select(RUN_COLUMNS)
        .single();

      if (runInsertError || !runRow) {
        if (runInsertError && looksLikePendingSchema(runInsertError.message)) {
          return NextResponse.json(
            {
              error:
                "Reading a plan document cannot be recorded yet: the rtp_extraction_runs table is missing.",
              hint: "Apply migration 20260811000008_rtp_extraction_staging, then try again.",
            },
            { status: 503 }
          );
        }
        audit.error("extraction_run_insert_failed", {
          rtpCycleId,
          kbDocumentId,
          message: runInsertError?.message ?? "extraction_run_insert_returned_no_row",
        });
        return NextResponse.json({ error: "Failed to record the extraction run" }, { status: 500 });
      }
      const runId = (runRow as { id: string }).id;

      const outcome = await runRtpExtraction({
        passages,
        targetKinds,
        bands,
        generate: async ({ system, prompt }) => {
          const generation = await generateText({
            model: anthropicModel(modelId),
            temperature: 0,
            maxOutputTokens: 4000,
            system,
            prompt,
          });
          return generation.text;
        },
        // ONE USAGE EVENT PER MODEL CALL. Fired here, not after the run, so a
        // long document's spend is metered as the many calls it actually is.
        onModelCall: (targetKind) => {
          void recordAiUsageEvent({
            workspaceId,
            bucketKey: "rtp_document_extraction",
            eventKey: "rtp_document_extraction_call",
            sourceRoute: ROUTE_PATH,
            metadataJson: { model: modelId, runId, targetKind },
            serviceSupabase,
          });
        },
      });

      const disclosures = {
        passagesIndexed: chunkRead.chunks.length,
        passagesCitable: passages.length,
        passagesNotCitable: countExclusions(excluded),
        passagesNotCitableReasons: PASSAGE_EXCLUSION_SENTENCES,
        chunkScanTruncated: chunkRead.truncated,
        maxPassagesPerKind: EXTRACTION_CHUNKS_PER_TARGET,
        maxModelCalls: EXTRACTION_MAX_MODEL_CALLS,
      };

      if (outcome.status === "failed") {
        const { data: failedRun, error: failedUpdateError } = await serviceSupabase
          .from("rtp_extraction_runs")
          .update({
            status: "failed",
            failure_reason: outcome.failureMessage,
            // Only when a call actually happened; see the run row's comment.
            ...(outcome.modelCalls > 0 ? { model: modelId } : {}),
          })
          .eq("id", runId)
          .select(RUN_COLUMNS)
          .maybeSingle();

        // A run left at 'running' because the marking failed is the 2026-08-10
        // defect wearing a different hat: it reads as still working forever.
        // The caller is told the truth by the 502 below either way, so this is
        // logged rather than escalated — but it is never discarded.
        if (failedUpdateError) {
          audit.error("extraction_run_failure_not_recorded", {
            runId,
            message: failedUpdateError.message,
          });
        }

        audit.error("extraction_run_failed", {
          rtpCycleId,
          kbDocumentId,
          runId,
          failureReason: outcome.failureReason,
          modelCalls: outcome.modelCalls,
          durationMs: Date.now() - startedAt,
        });

        return NextResponse.json(
          {
            run: failedRun ?? runRow,
            error: outcome.failureMessage,
            reason: outcome.failureReason,
            candidates: [],
            disclosures,
          },
          { status: 502 }
        );
      }

      // ---- Stage the candidates. -------------------------------------------
      let insertedCandidates: unknown[] = [];
      if (outcome.candidates.length > 0) {
        const { data, error: candidateError } = await serviceSupabase
          .from("rtp_extraction_candidates")
          .insert(
            outcome.candidates.map((candidate) => ({
              workspace_id: workspaceId,
              rtp_cycle_id: rtpCycleId,
              run_id: runId,
              target_kind: candidate.targetKind,
              proposed_json: candidate.proposedJson,
              source_chunk_id: candidate.chunkId,
              source_page: candidate.page,
              source_quote: candidate.quote,
              quote_verified: candidate.quoteVerified,
              status: "pending",
            }))
          )
          .select(
            "id, target_kind, proposed_json, source_chunk_id, source_page, source_quote, quote_verified, status, created_at"
          );

        if (candidateError) {
          const { error: markFailedError } = await serviceSupabase
            .from("rtp_extraction_runs")
            .update({
              status: "failed",
              model: modelId,
              failure_reason:
                "The plan was read, but the proposals could not be stored, so none of them were kept.",
            })
            .eq("id", runId);
          audit.error("extraction_candidate_insert_failed", {
            rtpCycleId,
            runId,
            message: candidateError.message,
            failureNotRecorded: markFailedError?.message ?? null,
          });
          return NextResponse.json(
            { error: "Failed to store the transcribed proposals" },
            { status: 500 }
          );
        }
        if (!data) {
          return insertNotReadableBackResponse({ subject: "transcribed proposals" });
        }
        insertedCandidates = data;
      }

      const { data: finishedRun, error: finishError } = await serviceSupabase
        .from("rtp_extraction_runs")
        .update({
          status: "succeeded",
          model: outcome.modelCalls > 0 ? modelId : null,
          candidate_count: outcome.candidates.length,
          discarded_count: outcome.discarded.length,
        })
        .eq("id", runId)
        .select(RUN_COLUMNS)
        .maybeSingle();

      // The proposals are stored and the run still says 'running'. Answering
      // 201 here would show a finished-looking result over a record that
      // contradicts it, and the counts the review header reads — how many were
      // proposed, how many dropped — would be zero on a run that produced
      // neither number. Say what happened instead.
      if (finishError) {
        audit.error("extraction_run_completion_not_recorded", {
          rtpCycleId,
          runId,
          candidateCount: outcome.candidates.length,
          message: finishError.message,
        });
        return NextResponse.json(
          {
            error:
              "The document was read and its proposals were stored, but this reading could not be marked finished. Reload the plan's readings before reviewing them.",
            runId,
          },
          { status: 500 }
        );
      }

      audit.info("extraction_run_succeeded", {
        rtpCycleId,
        kbDocumentId,
        runId,
        model: modelId,
        modelCalls: outcome.modelCalls,
        candidateCount: outcome.candidates.length,
        discardedCount: outcome.discarded.length,
        discardsByReason: outcome.discardsByReason,
        // The model's own page claim, cross-checked against the page the
        // candidate was actually stored with. Never a discard, always counted:
        // a model that keeps mis-stating pages is a signal about the run.
        modelPageMismatches: outcome.modelPageMismatches,
        unresolvedBandCount: outcome.unresolvedBandCount,
        passagesCitable: passages.length,
        passagesIndexed: chunkRead.chunks.length,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          run: finishedRun ?? runRow,
          candidates: insertedCandidates,
          summary: {
            proposed: outcome.candidates.length,
            discarded: outcome.discarded.length,
            discardsByReason: outcome.discardsByReason,
            discardReasonSentences: RTP_EXTRACTION_DISCARD_SENTENCES,
            unresolvedBandCount: outcome.unresolvedBandCount,
            perTarget: outcome.perTarget,
          },
          disclosures,
          warning: duplicateWarning,
        },
        { status: 201 }
      );
    });
  } catch (error) {
    audit.error("extraction_run_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while reading the document" }, { status: 500 });
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.extraction_runs.list", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }
    const rtpCycleId = parsedParams.data.rtpCycleId;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Member READ, so no write gate here. RLS scopes the rows to the caller's
    // workspaces, and the cycle filter narrows to the plan being looked at.
    const result = await supabase
      .from("rtp_extraction_runs")
      .select(RUN_COLUMNS)
      .eq("rtp_cycle_id", rtpCycleId)
      .order("created_at", { ascending: false })
      .limit(50);

    const failure = classifyRouteReadFailure("this plan's document readings", result);
    if (failure) {
      audit.error("extraction_run_list_failed", { rtpCycleId, message: failure.message });
      return NextResponse.json(failure.body, { status: failure.status });
    }

    return NextResponse.json({ runs: result.data ?? [] });
  } catch (error) {
    audit.error("extraction_run_list_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while listing document readings" },
      { status: 500 }
    );
  }
}
