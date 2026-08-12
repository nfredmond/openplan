/**
 * STAGING ONE VERBATIM BLOCK OF AN ADOPTED PLAN AS CHAPTER TEXT.
 *
 * This route is the whole of the chapter half of the transcription lane, and
 * the shape of it is the argument for it: it writes ONE row, into
 * `document_narrative_drafts`, with `status = 'draft'`.
 *
 * IT DOES NOT TOUCH `rtp_cycle_chapters`. Not `content_markdown`, not `status`,
 * not anything — it reads the chapter row only to prove the chapter is in this
 * cycle and this workspace. Published chapter content stays what a planner
 * typed or pasted into their own editor, which is Nathaniel's Q3 decision of
 * 2026-08-11 and the reason chapter text was allowed into scope at all. The
 * temptation this refuses is real: the words ARE the plan's own words, so
 * writing them straight into the chapter looks safe. What it would actually do
 * is let a machine decide which of the plan's words are this chapter's text.
 *
 * IT STAGES ONE BLOCK PER REQUEST, AND THERE IS NO BATCH. A body naming a list
 * of passages is a 400. Staging a block is an accept decision — the candidate
 * flips to `accepted` and the block enters the chapter's queue — and a route
 * that took forty of them would hide forty decisions behind one click. The
 * pairing itself (which chapter this policy statement belongs to) is a
 * judgement a planner makes; nothing here matches text to chapters, and there
 * is deliberately no code in this file that could.
 *
 * IT VERIFIES AGAIN, AGAINST THE DOCUMENT. The extraction verifier already
 * confirmed the quote when the candidate was staged.
 * `verifyStoredChapterBlock` re-runs the verbatim rule here, and this route
 * re-reads the cited passage out of `kb_document_chunks` so the check is made
 * against the document as it is stored NOW rather than against the staging row.
 * A read of that passage that FAILS is refused; a passage that is genuinely
 * gone (re-reading a document replaces its chunks) is recorded as such on the
 * draft rather than quietly treated as a match.
 *
 * NO ASSISTANT ACTION IS REGISTERED. `ACTION_METADATA` gains nothing, so
 * `refused-rtp-financial-actions-stay-refused.test.ts` stays green by
 * construction. An agent holding this write would be an agent deciding which of
 * an adopted plan's paragraphs become the agency's next plan — authorship
 * wearing a citation, which is precisely the line this whole feature is drawn
 * around.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { isWriteFailure } from "@/lib/http/write-outcome";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { authorizeRtpCycleWrite } from "@/lib/rtp/cycle-write-authorization";
import {
  CHAPTER_BLOCK_REFUSAL_SENTENCES,
  CHAPTER_BLOCK_TARGET_KIND,
  buildTranscribedChapterGrounding,
  renderTranscribedChapterBlock,
  transcribedChapterFactsInput,
  verifyStoredChapterBlock,
  type ChapterBlockSource,
} from "@/lib/rtp/extraction/chapter-blocks";
import {
  FROM_EXTRACTION_CANDIDATE_FIELD,
  completeExtractionAcceptance,
} from "@/lib/rtp/extraction/acceptance";

const paramsSchema = z.object({
  rtpCycleId: z.string().uuid(),
  chapterId: z.string().uuid(),
});

/**
 * `.strict()` and exactly one passage.
 *
 * The strictness is not tidiness: an unrecognised key would be STRIPPED by zod
 * and the request would succeed having ignored it, which is how this repository
 * once shipped a guard that proved nothing because the field it tested never
 * reached the code. A body carrying `candidateIds: [...]` is refused here
 * rather than silently staging the first one.
 */
const stageSchema = z
  .object({ [FROM_EXTRACTION_CANDIDATE_FIELD]: z.string().uuid() })
  .strict();

const CANDIDATE_COLUMNS =
  "id, run_id, target_kind, proposed_json, source_chunk_id, source_page, source_quote, quote_verified, status";

const RUN_COLUMNS = "id, model, kb_document_id, kb_documents(id, title)";

const DRAFT_COLUMNS =
  "id, workspace_id, target_kind, target_id, section_key, draft_markdown, model, grounding_json, grounded_sentence_count, total_sentence_count, facts_hash, status, accepted_markdown, accepted_by, accepted_at, created_by, created_at";

type RouteContext = { params: Promise<{ rtpCycleId: string; chapterId: string }> };

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.chapters.transcribed_blocks", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid chapter reference" }, { status: 400 });
    }
    const { rtpCycleId, chapterId } = parsedParams.data;

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = stageSchema.safeParse(payloadBody.data);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json(
        {
          error: "Invalid request",
          details:
            "Name one passage to put into this chapter. Passages go in one at a time on purpose — each one is a decision about what this plan will say.",
        },
        { status: 400 }
      );
    }
    const candidateId = parsedBody.data[FROM_EXTRACTION_CANDIDATE_FIELD];

    const supabase = await createClient();
    // The cast is the repo's untyped-client convention: comparing the full
    // client generic against the lib's structural type trips TS2589.
    const authorized = await authorizeRtpCycleWrite(
      supabase as unknown as Parameters<typeof authorizeRtpCycleWrite>[0],
      audit,
      rtpCycleId
    );
    if (!authorized.ok) return authorized.response;
    const { workspaceId, userId } = authorized;

    // The chapter, scoped three ways, so "not part of this plan" is something
    // the database verified rather than something this route assumed.
    const chapterResult = await supabase
      .from("rtp_cycle_chapters")
      .select("id, title, rtp_cycle_id, workspace_id")
      .eq("id", chapterId)
      .eq("rtp_cycle_id", rtpCycleId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const chapterFailure = classifyRouteReadFailure("the chapter", chapterResult);
    if (chapterFailure) {
      audit.error("chapter_lookup_failed", { rtpCycleId, chapterId, message: chapterFailure.message });
      return NextResponse.json(chapterFailure.body, { status: chapterFailure.status });
    }
    const chapter = (chapterResult.data ?? null) as { id: string; title: string | null } | null;
    if (!chapter) {
      return NextResponse.json(
        {
          error: "That chapter is not part of this plan",
          details: "Nothing was staged. Reload the plan and choose a chapter from it.",
        },
        { status: 404 }
      );
    }

    const candidateResult = await supabase
      .from("rtp_extraction_candidates")
      .select(CANDIDATE_COLUMNS)
      .eq("id", candidateId)
      .eq("rtp_cycle_id", rtpCycleId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const candidateFailure = classifyRouteReadFailure("the passage", candidateResult, {
      pendingError: "Document transcription is not available yet",
      pendingHint: "Apply Supabase migration 20260811000008_rtp_extraction_staging.sql, then try again.",
    });
    if (candidateFailure) {
      audit.error("extraction_candidate_lookup_failed", {
        rtpCycleId,
        chapterId,
        extractionCandidateId: candidateId,
        message: candidateFailure.message,
      });
      return NextResponse.json(candidateFailure.body, { status: candidateFailure.status });
    }

    const candidate = (candidateResult.data ?? null) as
      | {
          id: string;
          run_id: string | null;
          target_kind: string;
          proposed_json: unknown;
          source_chunk_id: string | null;
          source_page: number | null;
          source_quote: string | null;
          quote_verified: boolean | null;
          status: string;
        }
      | null;

    if (!candidate) {
      audit.warn("extraction_candidate_not_in_cycle", {
        rtpCycleId,
        chapterId,
        extractionCandidateId: candidateId,
      });
      return NextResponse.json(
        {
          error: "That passage is not part of this plan",
          details:
            "The passage is not in this plan, or it is no longer available. Nothing was staged. Reload the document review for this plan.",
        },
        { status: 404 }
      );
    }

    if (candidate.status !== "pending") {
      audit.warn("extraction_candidate_already_reviewed", {
        rtpCycleId,
        chapterId,
        extractionCandidateId: candidateId,
        status: candidate.status,
      });
      return NextResponse.json(
        {
          error: "That passage has already been reviewed",
          details:
            candidate.status === "accepted"
              ? "Somebody has already put this passage into a chapter. Nothing was staged — open the chapter to see it."
              : "Somebody has already set this passage aside. Nothing was staged.",
        },
        { status: 409 }
      );
    }

    // The reading this passage came out of: it names the document the citation
    // has to credit, and the model whose reading produced it.
    const runResult = candidate.run_id
      ? await supabase.from("rtp_extraction_runs").select(RUN_COLUMNS).eq("id", candidate.run_id).maybeSingle()
      : { data: null, error: null };

    const runFailure = classifyRouteReadFailure("the reading this passage came from", runResult);
    if (runFailure) {
      audit.error("extraction_run_lookup_failed", {
        rtpCycleId,
        chapterId,
        extractionCandidateId: candidateId,
        message: runFailure.message,
      });
      return NextResponse.json(runFailure.body, { status: runFailure.status });
    }

    const run = (runResult.data ?? null) as
      | {
          id: string;
          model: string | null;
          kb_document_id: string | null;
          kb_documents: { id: string; title: string | null } | Array<{ id: string; title: string | null }> | null;
        }
      | null;

    const document = firstOf(run?.kb_documents ?? null);
    const source: ChapterBlockSource = {
      kbDocumentId: document?.id ?? run?.kb_document_id ?? null,
      documentTitle: document?.title ?? null,
    };

    /*
      RE-READ THE CITED PASSAGE, AND KEEP THE THREE OUTCOMES APART.

        found      -> re-check the quote against the document as stored now.
        not found  -> the passage is genuinely gone (source_chunk_id is
                      ON DELETE SET NULL, and re-reading a document replaces its
                      chunks). Recorded on the draft, not treated as a match.
        read failed-> REFUSED. A query that did not answer is not a document
                      that changed, and staging on that basis would put "checked
                      against the page" on a block nothing checked.
    */
    let chunk: { content: string | null } | null = null;
    if (candidate.source_chunk_id) {
      const chunkResult = await supabase
        .from("kb_document_chunks")
        .select("id, content")
        .eq("id", candidate.source_chunk_id)
        .maybeSingle();

      const chunkFailure = classifyRouteReadFailure("the page this passage was copied from", chunkResult);
      if (chunkFailure) {
        audit.error("extraction_chunk_lookup_failed", {
          rtpCycleId,
          chapterId,
          extractionCandidateId: candidateId,
          message: chunkFailure.message,
        });
        return NextResponse.json(chunkFailure.body, { status: chunkFailure.status });
      }
      chunk = (chunkResult.data ?? null) as { content: string | null } | null;
    }

    const verification = verifyStoredChapterBlock(
      {
        id: candidate.id,
        target_kind: candidate.target_kind,
        proposed_json: candidate.proposed_json,
        source_page: candidate.source_page,
        source_quote: candidate.source_quote,
        quote_verified: candidate.quote_verified,
      },
      chunk
    );

    if (!verification.ok) {
      audit.warn("chapter_block_refused", {
        rtpCycleId,
        chapterId,
        extractionCandidateId: candidateId,
        reason: verification.reason,
      });
      return NextResponse.json(
        {
          error: "This passage cannot be staged as chapter text",
          details: CHAPTER_BLOCK_REFUSAL_SENTENCES[verification.reason],
          reason: verification.reason,
        },
        { status: 400 }
      );
    }

    const block = verification.block;
    const grounding = buildTranscribedChapterGrounding(block, source);
    const draftMarkdown = renderTranscribedChapterBlock(block, source);
    const factsHash = createHash("sha256")
      .update(transcribedChapterFactsInput(block, source))
      .digest("hex");

    /*
      Inserted through the CALLER'S OWN client, not the service role.
      `document_narrative_drafts` has a member INSERT policy that requires
      `created_by = auth.uid()`, and its column-scoped grant lets members update
      only the review fields afterwards. Writing this row as the service role
      would step around a boundary that already says exactly the right thing.

      `model` records the model whose reading produced the passage — the honest
      answer to "what read this document" — and "unrecorded" when the run did
      not store one, never an invented id.
    */
    const insertResult = await supabase
      .from("document_narrative_drafts")
      .insert({
        workspace_id: workspaceId,
        target_kind: "rtp_chapter",
        target_id: chapter.id,
        section_key: null,
        draft_markdown: draftMarkdown,
        model: run?.model?.trim() || "unrecorded",
        grounding_json: grounding,
        grounded_sentence_count: grounding.grounded_sentence_count,
        total_sentence_count: grounding.total_sentence_count,
        facts_hash: factsHash,
        status: "draft",
        created_by: userId,
      })
      .select(DRAFT_COLUMNS)
      .single();

    if (isWriteFailure(insertResult.error) || !insertResult.data) {
      const message = insertResult.error?.message ?? "";
      if (looksLikePendingSchema(message)) {
        return NextResponse.json(
          {
            error: "Chapter text cannot be staged yet: the document_narrative_drafts table is missing.",
            hint: "Apply migration 20260727000013_document_narrative_drafts, then try again.",
          },
          { status: 503 }
        );
      }
      audit.error("chapter_block_draft_insert_failed", {
        rtpCycleId,
        chapterId,
        extractionCandidateId: candidateId,
        message: message || "chapter_block_draft_insert_returned_no_row",
      });
      return NextResponse.json(
        {
          error: "This passage could not be staged",
          details: "Nothing was saved. Try again — and if it keeps failing, the chapter draft store is not writable.",
        },
        { status: 500 }
      );
    }

    const draft = insertResult.data as { id: string };

    // The candidate flip runs AFTER the row exists, because the candidate's own
    // CHECK requires an accepted row to point at. A flip that fails never turns
    // into a failed response — the block IS staged, and reporting failure is how
    // the same paragraph gets staged twice.
    const acceptance = await completeExtractionAcceptance({
      audit,
      candidate: { id: candidate.id, targetKind: CHAPTER_BLOCK_TARGET_KIND },
      acceptedRowId: draft.id,
      reviewedBy: userId,
      context: { rtpCycleId, chapterId, surface: "chapter_block" },
    });

    audit.info("chapter_block_staged", {
      rtpCycleId,
      chapterId,
      extractionCandidateId: candidateId,
      draftId: draft.id,
      sourcePage: block.page,
      chunkRecheck: block.chunkRecheck,
    });

    return NextResponse.json({ draft: insertResult.data, ...acceptance }, { status: 201 });
  } catch (error) {
    audit.error("chapter_block_stage_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while staging this passage as chapter text" },
      { status: 500 }
    );
  }
}
