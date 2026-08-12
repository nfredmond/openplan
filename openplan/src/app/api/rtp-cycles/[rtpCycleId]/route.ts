import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  RTP_CYCLE_STATUS_OPTIONS,
} from "@/lib/rtp/catalog";
import {
  completeExtractionAcceptance,
  isOnlyExtractionProvenance,
  resolveExtractionCandidate,
} from "@/lib/rtp/extraction/acceptance";

/**
 * THE PLAN'S COST BASIS YEAR AND INFLATION RATE, and why they arrive here.
 *
 * `rtp_cycles.financial_basis_year` and `rtp_cycles.annual_inflation_rate` were
 * added by 20260805000003 and, until this change, were READ in five places —
 * the fiscal-constraint engine, the board export, the public plan page, the
 * chapter-draft facts and the assistant's context — and WRITTEN by nothing at
 * all. There was no door. That is the repo's named shipped-invisible defect
 * class wearing its most consequential shape: the two numbers that decide
 * whether a plan reports constant dollars or year-of-expenditure dollars, and
 * no way for the agency to state either.
 *
 * They are the whole content of a `cycle_financial_basis` transcription
 * (Nathaniel's Q5, 2026-08-11), so the document-ingestion lane cannot land
 * without a writer for them. Both fields are added to the ORDINARY payload, not
 * to a transcription-only path: a capability a machine's output can reach and a
 * planner's typing cannot is exactly the second writer this lane exists to
 * avoid.
 *
 * WHAT SETTING THEM COSTS, which the review surface states before the click.
 * A cycle with no rate reports constant dollars and discloses that it did.
 * Setting a rate re-derives the escalated value of every line in the plan, so
 * it is never inferred, never defaulted, and only ever transcribed when the
 * adopted document states that exact figure.
 *
 * The rate is a FRACTION — 0.03, not 3 — matching the column's
 * `BETWEEN 0 AND 1` CHECK. Three per cent typed as `3` is refused rather than
 * quietly read as three hundred per cent a year.
 */
const MIN_FINANCIAL_BASIS_YEAR = 1900;
const MAX_FINANCIAL_BASIS_YEAR = 2200;

const paramsSchema = z.object({
  rtpCycleId: z.string().uuid(),
});

const RTP_CYCLE_STATUSES = RTP_CYCLE_STATUS_OPTIONS.map((option) => option.value) as [string, ...string[]];

const patchRtpCycleSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    status: z.enum(RTP_CYCLE_STATUSES).optional(),
    geographyLabel: z.union([z.string().trim().max(160), z.null()]).optional(),
    horizonStartYear: z.union([z.number().int().min(1900).max(2200), z.null()]).optional(),
    horizonEndYear: z.union([z.number().int().min(1900).max(2200), z.null()]).optional(),
    adoptionTargetDate: z.union([z.string().date(), z.null()]).optional(),
    publicReviewOpenAt: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
    publicReviewCloseAt: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
    summary: z.union([z.string().trim().max(4000), z.null()]).optional(),
    // Nullable so a cycle can be un-pinned, not only moved.
    anchorLatitude: z.union([z.number().min(-90).max(90), z.null()]).optional(),
    anchorLongitude: z.union([z.number().min(-180).max(180), z.null()]).optional(),
    financialBasisYear: z
      .union([
        z.number().int().min(MIN_FINANCIAL_BASIS_YEAR).max(MAX_FINANCIAL_BASIS_YEAR),
        z.null(),
      ])
      .optional(),
    annualInflationRate: z.union([z.number().min(0).max(1), z.null()]).optional(),
    /**
     * The reviewed transcription these values were copied from, when there was
     * one. `rtp_cycles` carries no `extraction_candidate_id` column on purpose
     * (20260811000009's header): a cycle is not a transcribed artifact, and the
     * candidate itself already records what it proposed and which page it came
     * from. So acceptance here marks the candidate and writes no provenance
     * column — which is why the flip below is the only thing this field adds.
     */
    fromExtractionCandidateId: z.string().uuid().optional(),
  })
  // Naming a transcription is not an edit. Without the exclusion, a body
  // carrying nothing but a candidate id would pass this check, mark the
  // transcription accepted, and change no value in the plan.
  .refine((value) => !isOnlyExtractionProvenance(value), {
    message: "At least one field must be updated",
  })
  .superRefine((value, context) => {
    const start = value.horizonStartYear;
    const end = value.horizonEndYear;
    if ((start === null) !== (end === null) && (start !== undefined || end !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [start === null ? "horizonEndYear" : "horizonStartYear"],
        message: "Both horizon years must be cleared or provided together.",
      });
    }
    if (typeof start === "number" && typeof end === "number" && end < start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["horizonEndYear"],
        message: "The horizon end year must be greater than or equal to the start year.",
      });
    }
    // Both coordinates move, or both clear, together. A cycle holding one half
    // of a pin renders nothing and explains nothing.
    const anchorLat = value.anchorLatitude;
    const anchorLon = value.anchorLongitude;
    if ((anchorLat !== undefined || anchorLon !== undefined) && (anchorLat === undefined || anchorLon === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [anchorLat === undefined ? "anchorLatitude" : "anchorLongitude"],
        message: "Both anchor coordinates must be cleared or provided together.",
      });
    }
    if (anchorLat !== undefined && anchorLon !== undefined && (anchorLat === null) !== (anchorLon === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["anchorLongitude"],
        message: "Both anchor coordinates must be cleared or provided together.",
      });
    }

    if ((value.publicReviewOpenAt === null) !== (value.publicReviewCloseAt === null) && (value.publicReviewOpenAt !== undefined || value.publicReviewCloseAt !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicReviewCloseAt"],
        message: "Both public review timestamps must be cleared or provided together.",
      });
    }
    if (value.publicReviewOpenAt && value.publicReviewCloseAt) {
      const open = new Date(value.publicReviewOpenAt).getTime();
      const close = new Date(value.publicReviewCloseAt).getTime();
      if (close < open) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["publicReviewCloseAt"],
          message: "The public review close time must be after the open time.",
        });
      }
    }
  });

type RouteContext = {
  params: Promise<{ rtpCycleId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = patchRtpCycleSchema.safeParse(payloadBody.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid RTP cycle update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: cycle, error: cycleError } = await supabase
      .from("rtp_cycles")
      .select("id, workspace_id")
      .eq("id", parsedParams.data.rtpCycleId)
      .maybeSingle();

    if (cycleError) {
      audit.error("cycle_lookup_failed", { message: cycleError.message, code: cycleError.code ?? null });
      return NextResponse.json({ error: "Failed to load RTP cycle" }, { status: 500 });
    }
    if (!cycle) {
      return NextResponse.json({ error: "RTP cycle not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("workspace_id", cycle.workspace_id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", { message: membershipError.message, code: membershipError.code ?? null });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }
    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (payload.data.title !== undefined) updates.title = payload.data.title;
    if (payload.data.status !== undefined) updates.status = payload.data.status;
    if (payload.data.geographyLabel !== undefined) updates.geography_label = payload.data.geographyLabel;
    if (payload.data.horizonStartYear !== undefined) updates.horizon_start_year = payload.data.horizonStartYear;
    if (payload.data.horizonEndYear !== undefined) updates.horizon_end_year = payload.data.horizonEndYear;
    if (payload.data.adoptionTargetDate !== undefined) updates.adoption_target_date = payload.data.adoptionTargetDate;
    if (payload.data.publicReviewOpenAt !== undefined) updates.public_review_open_at = payload.data.publicReviewOpenAt;
    if (payload.data.publicReviewCloseAt !== undefined) updates.public_review_close_at = payload.data.publicReviewCloseAt;
    if (payload.data.summary !== undefined) updates.summary = payload.data.summary;
    if (payload.data.anchorLatitude !== undefined) updates.anchor_latitude = payload.data.anchorLatitude;
    if (payload.data.anchorLongitude !== undefined) updates.anchor_longitude = payload.data.anchorLongitude;
    // `!== undefined`, not truthiness: a basis year of null CLEARS the year and
    // an inflation rate of 0 is a real answer — a plan that programmes in
    // constant dollars and says so. `|| null` here would silently discard the
    // second one and report escalation the agency did not adopt.
    if (payload.data.financialBasisYear !== undefined) updates.financial_basis_year = payload.data.financialBasisYear;
    if (payload.data.annualInflationRate !== undefined) {
      updates.annual_inflation_rate = payload.data.annualInflationRate;
    }

    // Resolved after the edit is assembled and before the write, so a
    // transcription belonging to another plan refuses without changing
    // anything. The cycle scoping the lookup is the one this request has
    // already proven the caller may write.
    const candidate = await resolveExtractionCandidate({
      supabase: supabase as unknown as Parameters<typeof resolveExtractionCandidate>[0]["supabase"],
      audit,
      candidateId: payload.data.fromExtractionCandidateId,
      targetKind: "cycle_financial_basis",
      rtpCycleId: cycle.id,
      workspaceId: cycle.workspace_id,
    });
    if (!candidate.ok) return candidate.response;

    const { data: updatedCycle, error: updateError } = await supabase
      .from("rtp_cycles")
      .update(updates)
      .eq("id", cycle.id)
      .select(
        "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, anchor_latitude, anchor_longitude, financial_basis_year, annual_inflation_rate, created_at, updated_at"
      )
      .single();

    if (updateError && isWriteFailure(updateError)) {
      audit.error("cycle_update_failed", { message: updateError.message, code: updateError.code ?? null });
      return NextResponse.json({ error: "Failed to update RTP cycle" }, { status: 500 });
    }

    // The trailing null check restates the helper for the type checker, which is
    // what lets the readiness build below read the returned row.
    if (writeMatchedNoRows({ data: updatedCycle, error: updateError }) || !updatedCycle) {
      // This request already read the cycle through the caller's own client and
      // already passed `plans.write`, so zero matched rows is the database
      // refusing a write the application believed was allowed — not a 404.
      audit.error("cycle_update_matched_no_rows", {
        rtpCycleId: cycle.id,
        workspaceId: cycle.workspace_id,
        role: membership.role ?? null,
      });
      return noRowsMatchedResponse({ subject: "RTP cycle", targetWasVerified: true });
    }

    const readiness = buildRtpCycleReadiness({
      geographyLabel: updatedCycle.geography_label,
      horizonStartYear: updatedCycle.horizon_start_year,
      horizonEndYear: updatedCycle.horizon_end_year,
      adoptionTargetDate: updatedCycle.adoption_target_date,
      publicReviewOpenAt: updatedCycle.public_review_open_at,
      publicReviewCloseAt: updatedCycle.public_review_close_at,
    });

    const acceptance = await completeExtractionAcceptance({
      audit,
      candidate: candidate.candidate,
      acceptedRowId: cycle.id,
      reviewedBy: user.id,
      context: { rtpCycleId: cycle.id },
    });

    audit.info("cycle_updated", {
      rtpCycleId: cycle.id,
      extractionCandidateId: candidate.candidate?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      cycle: {
        ...updatedCycle,
        readiness,
        workflow: buildRtpCycleWorkflowSummary({ status: updatedCycle.status, readiness }),
      },
      ...acceptance,
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update RTP cycle" }, { status: 500 });
  }
}
