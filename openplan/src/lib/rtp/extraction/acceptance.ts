/**
 * ACCEPTING A TRANSCRIPTION — the one seam between a machine reading an adopted
 * plan and that plan's own numbers entering OpenPlan.
 *
 * There is NO parallel writer. A figure transcribed off page 112 of an adopted
 * RTP reaches the database through the SAME route, the same zod schema, the
 * same cross-cycle band check, the same amount ceiling and the same
 * NULL-is-not-zero discipline as a figure a planner typed by hand. The only
 * difference is one optional field on the request — `fromExtractionCandidateId`
 * — which this module resolves, and one column on the row afterwards, which
 * remembers which reviewed transcription the value came from.
 *
 * WHY THAT IS THE WHOLE DESIGN. A second write path for "trusted" machine
 * output is how a machine ends up authoring a planning number: the second path
 * always ends up missing one of the first path's refusals, and the missing one
 * is invisible because both paths answer 200. Routing acceptance through the
 * existing door makes every refusal apply to the transcribed value BY
 * CONSTRUCTION rather than by anyone remembering to re-implement it. The route
 * tests in this lane prove it the only way that means anything: the same bad
 * payload is refused identically whether or not it carries a candidate id.
 *
 * WHAT THIS MODULE MAY NEVER DO, and the reason each is here rather than in a
 * plan file:
 *
 *   1. It never reads a VALUE out of a candidate. `proposed_json` is not
 *      touched here at all. The reviewer's browser puts the proposed values in
 *      the request body, a human looks at them, and the route parses them. A
 *      resolver that copied the proposal into the insert would be a machine
 *      writing a planning number with a human-shaped click in front of it.
 *   2. It never accepts a candidate the verifier could not confirm. The
 *      database enforces that too — `rtp_extraction_candidates` CHECKs that
 *      `status = 'accepted'` implies `quote_verified` — but the flip below
 *      names it anyway so the refusal is legible at both ends.
 *   3. It never registers an assistant action. Acceptance is an HTTP route a
 *      signed-in person calls; `ACTION_METADATA` gains nothing, which is what
 *      keeps `refused-rtp-financial-actions-stay-refused.test.ts` green by
 *      construction rather than by exemption.
 *
 * AN EDITED ACCEPTANCE IS THE SAME CALL WITH EDITED VALUES. If a planner
 * corrects a transcribed figure before accepting it, they send their corrected
 * value with the same candidate id. The candidate keeps recording what the
 * machine proposed, the row records what the human wrote, and "what did the
 * planner change?" stays answerable forever by comparing the two.
 */
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";

/**
 * The request field, named once so all five write routes spell it identically.
 *
 * Two of those routes have a "no changes were requested" refinement that counts
 * the keys of the payload. This constant is what lets them EXCLUDE this key
 * from that count — see `isOnlyExtractionProvenance` below for why that
 * exclusion is load-bearing rather than tidy.
 */
export const FROM_EXTRACTION_CANDIDATE_FIELD = "fromExtractionCandidateId";

/**
 * The candidate kinds a write route may accept.
 *
 * Deliberately NOT the whole `target_kind` vocabulary of
 * `20260811000008_rtp_extraction_staging.sql`: `chapter_block` is missing on
 * purpose. Transcribed chapter narrative never reaches
 * `rtp_cycle_chapters.content_markdown` through a write route — it lands in the
 * existing `document_narrative_drafts` staging machinery, so an adopted plan
 * cannot quote itself wrongly without a human accepting the draft first
 * (Nathaniel's Q3 decision, 2026-08-11). A test pins this list against the
 * migration's CHECK and asserts that `chapter_block` is the ONE difference, so
 * a seventh kind added to the schema cannot quietly become route-acceptable.
 */
export const ACCEPTANCE_TARGET_KINDS = [
  "financial_line",
  "performance_measure",
  "horizon_band",
  "programmed_project",
  "cycle_financial_basis",
] as const;

export type ExtractionAcceptanceTargetKind = (typeof ACCEPTANCE_TARGET_KINDS)[number];

/**
 * How each kind reads in a sentence a planner would say out loud. Used only in
 * the 400 that explains a mismatch, and written for a planner rather than for
 * whoever wrote the schema — `chapter_block` is included even though no route
 * accepts it, because the honest way to refuse one is to name what it is.
 */
const TARGET_KIND_LABELS: Record<string, string> = {
  financial_line: "a revenue or cost line",
  performance_measure: "a performance measure",
  horizon_band: "a period of the plan",
  programmed_project: "a project's programmed cost",
  cycle_financial_basis: "the plan's cost basis year and inflation rate",
  chapter_block: "a block of chapter text",
};

function describeTargetKind(kind: string): string {
  return TARGET_KIND_LABELS[kind] ?? "something else in this plan";
}

/**
 * True when a PATCH body asks for no change other than naming a transcription.
 *
 * THE DEFECT THIS PREVENTS, which is the subtle one in this whole lane. Two of
 * the update schemas decide "did the caller actually ask for anything?" by
 * counting defined keys. Add `fromExtractionCandidateId` and a body carrying
 * nothing but an id and a candidate reference starts passing that check — the
 * route then writes the provenance column, marks the candidate ACCEPTED, and
 * changes not one of the values the candidate proposed. The review surface
 * would show a transcription accepted, the plan would show the planner's old
 * number, and nothing anywhere would disagree.
 *
 * So provenance is never a change on its own. It rides along with a real edit
 * or the request is the ordinary 400 it always was.
 */
export function isOnlyExtractionProvenance(payload: Record<string, unknown>, idField?: string): boolean {
  return !Object.entries(payload).some(
    ([key, value]) => key !== idField && key !== FROM_EXTRACTION_CANDIDATE_FIELD && value !== undefined,
  );
}

/**
 * The candidate row, projected down to what acceptance needs. `proposed_json`
 * is deliberately absent from the projection: nothing here may read a value the
 * model proposed, and the surest way to keep that true is to never fetch it.
 */
export type ResolvedExtractionCandidate = {
  id: string;
  targetKind: string;
};

export type ExtractionCandidateResolution =
  | { ok: true; candidate: ResolvedExtractionCandidate | null }
  | { ok: false; response: NextResponse };

/**
 * `PromiseLike` rather than `Promise`, and a structural type rather than the
 * client's own: a PostgrestBuilder is thenable but not a Promise, and comparing
 * the full generated client generic against a structural type trips TS2589.
 * Callers pass their ordinary server client through the repo's usual cast.
 */
type CandidateQuery = {
  eq: (column: string, value: string) => CandidateQuery;
  maybeSingle: () => PromiseLike<{ data: unknown; error: { message?: string | null } | null }>;
};

export type ExtractionCandidateReader = {
  from: (table: string) => { select: (columns: string) => CandidateQuery };
};

export type ExtractionAcceptanceAudit = {
  warn: (event: string, payload: Record<string, unknown>) => void;
  error: (event: string, payload: Record<string, unknown>) => void;
};

/**
 * The columns the resolver reads. Asserted on by the route tests, because a
 * mocked Supabase client hands back its fixture for whatever was asked and a
 * dropped column is invisible until production.
 */
export const EXTRACTION_CANDIDATE_COLUMNS = "id, workspace_id, rtp_cycle_id, target_kind, status, quote_verified";

type StoredCandidate = {
  id?: unknown;
  target_kind?: unknown;
  status?: unknown;
  quote_verified?: unknown;
};

/**
 * Resolve the transcription a write is being accepted from, or explain why it
 * cannot be.
 *
 * Returns `{ ok: true, candidate: null }` when the caller supplied no id, so
 * every route has ONE call site rather than a branch: a hand-typed write and a
 * transcribed one run the same code down to the insert.
 *
 * THE READ IS SCOPED THREE WAYS — id, cycle and workspace — and it runs through
 * the CALLER'S OWN client, not the service role. The scoping is what makes
 * "that transcription is not part of this plan" a statement the database
 * verified rather than one the route assumed, and the caller's client means
 * row-level security is a second opinion on the same question. A candidate from
 * another workspace, from another plan cycle in the same workspace, or from no
 * plan at all all answer the same 404: distinguishing them would confirm the
 * existence of other agencies' documents to anyone willing to guess ids.
 */
export async function resolveExtractionCandidate(options: {
  supabase: ExtractionCandidateReader;
  audit: ExtractionAcceptanceAudit;
  candidateId: string | undefined;
  targetKind: ExtractionAcceptanceTargetKind;
  rtpCycleId: string;
  workspaceId: string;
}): Promise<ExtractionCandidateResolution> {
  const { supabase, audit, candidateId, targetKind, rtpCycleId, workspaceId } = options;

  if (candidateId === undefined) return { ok: true, candidate: null };

  const result = await supabase
    .from("rtp_extraction_candidates")
    .select(EXTRACTION_CANDIDATE_COLUMNS)
    .eq("id", candidateId)
    .eq("rtp_cycle_id", rtpCycleId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  // A read that FAILED reaches the same `!candidate` branch a read that found
  // nothing reaches. Answering "not part of this plan" to a question the
  // database never answered would send a planner back to a review screen that
  // is showing them the very row this route just denied.
  const failure = classifyRouteReadFailure("the transcription", result, {
    pendingError: "Document transcription is not available yet",
    pendingHint: "Apply Supabase migration 20260811000008_rtp_extraction_staging.sql, then try again.",
  });
  if (failure) {
    audit.error("extraction_candidate_lookup_failed", {
      extractionCandidateId: candidateId,
      rtpCycleId,
      message: failure.message,
    });
    return { ok: false, response: NextResponse.json(failure.body, { status: failure.status }) };
  }

  const candidate = (result.data ?? null) as StoredCandidate | null;

  if (!candidate || typeof candidate.id !== "string") {
    audit.warn("extraction_candidate_not_in_cycle", { extractionCandidateId: candidateId, rtpCycleId });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "That transcription is not part of this plan",
          details:
            "The passage this figure was going to be copied from is not in this plan, or it is no longer " +
            "available. Nothing was saved. Open the document review for this plan and accept it from there.",
        },
        { status: 404 },
      ),
    };
  }

  if (candidate.target_kind !== targetKind) {
    audit.warn("extraction_candidate_wrong_target", {
      extractionCandidateId: candidate.id,
      rtpCycleId,
      expected: targetKind,
      stored: typeof candidate.target_kind === "string" ? candidate.target_kind : null,
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "That transcription belongs somewhere else in the plan",
          details:
            `This passage was read out of the document as ${describeTargetKind(String(candidate.target_kind))}, ` +
            `and it is being saved as ${describeTargetKind(targetKind)}. Nothing was saved. Accept it from the ` +
            "part of the document review it was staged under.",
        },
        { status: 400 },
      ),
    };
  }

  if (candidate.status !== "pending") {
    audit.warn("extraction_candidate_already_reviewed", {
      extractionCandidateId: candidate.id,
      rtpCycleId,
      status: typeof candidate.status === "string" ? candidate.status : null,
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "That transcription has already been reviewed",
          details:
            "Somebody has already accepted or set aside this passage, so nothing was saved. Reload the " +
            "document review to see what happened to it — accepting it twice would record the same figure " +
            "in this plan twice.",
        },
        { status: 409 },
      ),
    };
  }

  // Belt and braces over the database's own CHECK. The verifier discards an
  // unconfirmed quote before it is ever staged, so this should be unreachable —
  // which is exactly why it is worth having, because the day someone stages the
  // discards "so the planner can see them", this route refuses instead of
  // becoming the door a machine authors a planning number through.
  if (candidate.quote_verified !== true) {
    audit.warn("extraction_candidate_quote_unverified", { extractionCandidateId: candidate.id, rtpCycleId });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "That passage could not be matched to the document",
          details:
            "The figures in this proposal were not found in the words it quotes, so it cannot be recorded " +
            "in the plan. Nothing was saved. Enter the value by hand from the page instead.",
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, candidate: { id: candidate.id, targetKind } };
}

/**
 * What the row's provenance column should be set to, or nothing at all.
 *
 * Returns an EMPTY object for a hand-typed write rather than
 * `{ extraction_candidate_id: null }`, and the difference matters twice. It
 * keeps the insert a typed write sends byte-identical to the one it sent before
 * this feature existed — so a route test can prove the ordinary path is
 * untouched. And it keeps every hand-typed write working during the window
 * between deploying this code and applying migration 20260811000009: naming a
 * column that does not exist yet is a PGRST204 on every save, while omitting it
 * is a row with a NULL the column would have defaulted to anyway.
 */
export function extractionProvenanceColumns(
  candidate: ResolvedExtractionCandidate | null,
): Record<string, string> {
  return candidate ? { extraction_candidate_id: candidate.id } : {};
}

export type ExtractionAcceptanceRecord = { recorded: true } | { recorded: false; warning: string };

const NOT_RECORDED_WARNING =
  "This was saved to the plan and it cites its page in the document. The document review could not be " +
  "updated to show it as accepted, so it may still be listed there as waiting — accepting it a second time " +
  "would record the same value in this plan twice.";

/**
 * Mark the candidate accepted and point it at the row it became.
 *
 * SERVICE ROLE, because `rtp_extraction_candidates` has no write policy for
 * anybody: members may read it and nothing more. A client-writable staging
 * table is a row claiming a quote that never went through the verifier, which
 * is the single thing the table exists to make impossible.
 *
 * AFTER THE WRITE, NEVER BEFORE. The candidate's own CHECK requires
 * `accepted_row_id` to be present once it is accepted, so there is no id to
 * flip with until the row exists. That ordering has a cost, disclosed rather
 * than hidden: the write can land and the flip can fail. This function NEVER
 * turns that into a failed response — reporting failure for a write that
 * succeeded is how duplicate revenue lines get made — so it answers
 * `recorded: false` with a sentence the route hands back, and the planner is
 * told the plan has the figure and the review list may be stale.
 *
 * `.eq("status", "pending")` on the update is the concurrency half: two
 * reviewers accepting the same passage at the same moment both pass the
 * resolver, and only one of them matches here. The second gets
 * `recorded: false` and the warning, rather than silently overwriting the first
 * reviewer's `accepted_row_id` and orphaning their row's citation.
 */
export async function recordExtractionCandidateAccepted(options: {
  audit: ExtractionAcceptanceAudit;
  candidateId: string;
  acceptedRowId: string;
  reviewedBy: string;
  context?: Record<string, unknown>;
}): Promise<ExtractionAcceptanceRecord> {
  const { audit, candidateId, acceptedRowId, reviewedBy, context } = options;

  try {
    const service = createServiceRoleClient();
    const { data, error } = await service
      .from("rtp_extraction_candidates")
      .update({
        status: "accepted",
        accepted_row_id: acceptedRowId,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", candidateId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error) {
      audit.error("extraction_candidate_not_marked_accepted", {
        ...context,
        extractionCandidateId: candidateId,
        acceptedRowId,
        reason: "update_failed",
        message: error.message,
      });
      return { recorded: false, warning: NOT_RECORDED_WARNING };
    }

    if (!data) {
      audit.error("extraction_candidate_not_marked_accepted", {
        ...context,
        extractionCandidateId: candidateId,
        acceptedRowId,
        reason: "no_rows_matched",
      });
      return { recorded: false, warning: NOT_RECORDED_WARNING };
    }

    return { recorded: true };
  } catch (error) {
    audit.error("extraction_candidate_not_marked_accepted", {
      ...context,
      extractionCandidateId: candidateId,
      acceptedRowId,
      reason: "unhandled_error",
      message: error instanceof Error ? error.message : String(error),
    });
    return { recorded: false, warning: NOT_RECORDED_WARNING };
  }
}

export type ExtractionAcceptanceReport = {
  id: string;
  recorded: boolean;
  warning?: string;
};

/**
 * The response fragment a route spreads in, present ONLY when the request named
 * a transcription. A hand-typed write's response is unchanged, byte for byte.
 */
export function extractionAcceptanceReport(
  candidate: ResolvedExtractionCandidate,
  outcome: ExtractionAcceptanceRecord,
): ExtractionAcceptanceReport {
  return outcome.recorded
    ? { id: candidate.id, recorded: true }
    : { id: candidate.id, recorded: false, warning: outcome.warning };
}

/**
 * The whole tail of an acceptance: flip the candidate, and describe what
 * happened. Kept as one call so no route can do the first half and forget the
 * second.
 */
export async function completeExtractionAcceptance(options: {
  audit: ExtractionAcceptanceAudit;
  candidate: ResolvedExtractionCandidate | null;
  acceptedRowId: string | null | undefined;
  reviewedBy: string;
  context?: Record<string, unknown>;
}): Promise<{ extractionCandidate?: ExtractionAcceptanceReport }> {
  const { audit, candidate, acceptedRowId, reviewedBy, context } = options;
  if (!candidate) return {};

  // The row landed but the route could not read its id back — the
  // insert-not-readable-back case, which the write routes already answer
  // honestly. There is nothing to point the candidate at, so it stays pending
  // and the planner is told the review list may be stale.
  if (typeof acceptedRowId !== "string" || acceptedRowId.length === 0) {
    audit.error("extraction_candidate_not_marked_accepted", {
      ...context,
      extractionCandidateId: candidate.id,
      reason: "accepted_row_id_missing",
    });
    return { extractionCandidate: { id: candidate.id, recorded: false, warning: NOT_RECORDED_WARNING } };
  }

  const outcome = await recordExtractionCandidateAccepted({
    audit,
    candidateId: candidate.id,
    acceptedRowId,
    reviewedBy,
    context,
  });

  return { extractionCandidate: extractionAcceptanceReport(candidate, outcome) };
}
