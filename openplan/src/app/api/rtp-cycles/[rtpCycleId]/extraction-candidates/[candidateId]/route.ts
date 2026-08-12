/**
 * SETTING A TRANSCRIPTION ASIDE — the review screen's own write, and the ONLY
 * one it has.
 *
 * Accepting a transcription is not here and must never be. Acceptance runs the
 * ordinary RTP write route — the financial-assumptions POST, the
 * performance-measures POST, the horizon-bands POST, the project rtp-links
 * POST, the cycle PATCH — each carrying `fromExtractionCandidateId`, so a
 * transcribed figure passes the same zod, the same cross-cycle band check, the
 * same amount ceiling and the same NULL-is-not-zero discipline as a figure
 * somebody typed. A second writer for "reviewed" values is how a machine ends
 * up authoring a planning number: the second path always misses one of the
 * first path's refusals, and the miss is invisible because both answer 200.
 *
 * SO THIS ROUTE WRITES NOTHING BUT A REJECTION. It flips one candidate to
 * `rejected`, records who and when, and touches no RTP table. There is
 * deliberately no reason field: a free-text box on a rejection is a place for a
 * planner to write a figure, and a figure written there would be a value in the
 * system that never came from a page and never went through a write route.
 *
 * NO ASSISTANT ACTION IS REGISTERED. `ACTION_METADATA` gains nothing here, so
 * `refused-rtp-financial-actions-stay-refused.test.ts` stays green BY
 * CONSTRUCTION. Note what an agent-held reject would actually be, since it
 * sounds harmless: an action that empties a work queue the agent can see is a
 * completion-signal shape with a standing bad incentive (CLAUDE.md, refusal
 * principle 5), and the queue it would empty is the one place a planner sees
 * what the machine got wrong.
 *
 * THE GATE IS `plans.write`, not a reader's. Setting a proposal aside is a
 * review decision about the plan: it takes the passage off the queue for
 * everyone in the workspace, and a viewer who cannot change the plan may not
 * decide what the plan will never say.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { authorizeRtpCycleWrite } from "@/lib/rtp/cycle-write-authorization";

const paramsSchema = z.object({
  rtpCycleId: z.string().uuid(),
  candidateId: z.string().uuid(),
});

/**
 * `.strict()` and a single action. A body that names anything else is a 400
 * rather than a silently stripped key — the defect this repository has already
 * paid for, where a guard "proving" a payload could not set a field passed
 * because the field never reached the code.
 */
const reviewSchema = z.object({ action: z.literal("reject") }).strict();

const CANDIDATE_COLUMNS = "id, target_kind, status, source_page";

type RouteContext = { params: Promise<{ rtpCycleId: string; candidateId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.extraction_candidates.review", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid transcription reference" }, { status: 400 });
    }
    const { rtpCycleId, candidateId } = parsedParams.data;

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = reviewSchema.safeParse(payloadBody.data);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json(
        {
          error: "Invalid review action",
          details:
            "Setting a passage aside is the only thing this can do. A transcription is accepted by saving it into the plan, which runs the plan's own save.",
        },
        { status: 400 }
      );
    }

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

    // Read through the CALLER'S client, scoped three ways — id, cycle and
    // workspace — so "that transcription is not part of this plan" is something
    // the database verified rather than something this route assumed, with
    // row-level security as a second opinion on the same question.
    const existing = await supabase
      .from("rtp_extraction_candidates")
      .select(CANDIDATE_COLUMNS)
      .eq("id", candidateId)
      .eq("rtp_cycle_id", rtpCycleId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const readFailure = classifyRouteReadFailure("the transcription", existing, {
      pendingError: "Document transcription is not available yet",
      pendingHint: "Apply Supabase migration 20260811000008_rtp_extraction_staging.sql, then try again.",
    });
    if (readFailure) {
      audit.error("extraction_candidate_lookup_failed", {
        rtpCycleId,
        extractionCandidateId: candidateId,
        message: readFailure.message,
      });
      return NextResponse.json(readFailure.body, { status: readFailure.status });
    }

    const candidate = (existing.data ?? null) as { id: string; status: string } | null;
    if (!candidate) {
      audit.warn("extraction_candidate_not_in_cycle", {
        rtpCycleId,
        extractionCandidateId: candidateId,
      });
      return NextResponse.json(
        {
          error: "That transcription is not part of this plan",
          details:
            "The passage is not in this plan, or it is no longer available. Nothing was changed. Reload the document review for this plan.",
        },
        { status: 404 }
      );
    }

    if (candidate.status !== "pending") {
      audit.warn("extraction_candidate_already_reviewed", {
        rtpCycleId,
        extractionCandidateId: candidateId,
        status: candidate.status,
      });
      return NextResponse.json(
        {
          error: "That transcription has already been reviewed",
          details:
            candidate.status === "accepted"
              ? "Somebody has already saved this passage into the plan. Nothing was changed — remove the figure from the plan itself if it should not be there."
              : "Somebody has already set this passage aside. Nothing was changed.",
        },
        { status: 409 }
      );
    }

    // SERVICE ROLE, because `rtp_extraction_candidates` has no write policy for
    // anybody: members may read it and nothing more. `.eq("status", "pending")`
    // is the concurrency half — two reviewers acting on the same passage at the
    // same moment cannot both match, so a rejection can never overwrite an
    // acceptance that landed first and orphan the row's citation.
    const service = createServiceRoleClient();
    const { data, error } = await service
      .from("rtp_extraction_candidates")
      .update({
        status: "rejected",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", candidateId)
      .eq("rtp_cycle_id", rtpCycleId)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .select(CANDIDATE_COLUMNS)
      .maybeSingle();

    if (error) {
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json(
          {
            error: "Document transcription is not available yet",
            hint: "Apply migration 20260811000008_rtp_extraction_staging, then try again.",
          },
          { status: 503 }
        );
      }
      audit.error("extraction_candidate_reject_failed", {
        rtpCycleId,
        extractionCandidateId: candidateId,
        message: error.message,
      });
      return NextResponse.json({ error: "Failed to set this passage aside" }, { status: 500 });
    }

    // No row matched: somebody reviewed it between the read above and this
    // write. Reporting success would take it off this reviewer's screen while
    // leaving the plan carrying whatever the other reviewer did with it.
    if (!data) {
      audit.warn("extraction_candidate_reject_raced", {
        rtpCycleId,
        extractionCandidateId: candidateId,
      });
      return NextResponse.json(
        {
          error: "That transcription has already been reviewed",
          details:
            "Somebody reviewed this passage a moment ago, so nothing was changed. Reload the document review to see what happened to it.",
        },
        { status: 409 }
      );
    }

    audit.info("extraction_candidate_rejected", {
      rtpCycleId,
      extractionCandidateId: candidateId,
    });

    return NextResponse.json({ candidate: data });
  } catch (error) {
    audit.error("extraction_candidate_review_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while reviewing this passage" },
      { status: 500 }
    );
  }
}
