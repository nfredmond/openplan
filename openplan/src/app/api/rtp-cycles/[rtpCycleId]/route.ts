import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  RTP_CYCLE_STATUS_OPTIONS,
} from "@/lib/rtp/catalog";

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
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
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

    const payload = patchRtpCycleSchema.safeParse(await request.json().catch(() => null));
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

    const { data: updatedCycle, error: updateError } = await supabase
      .from("rtp_cycles")
      .update(updates)
      .eq("id", cycle.id)
      .select(
        "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, created_at, updated_at"
      )
      .single();

    if (updateError) {
      audit.error("cycle_update_failed", { message: updateError.message, code: updateError.code ?? null });
      return NextResponse.json({ error: "Failed to update RTP cycle" }, { status: 500 });
    }

    const readiness = buildRtpCycleReadiness({
      geographyLabel: updatedCycle.geography_label,
      horizonStartYear: updatedCycle.horizon_start_year,
      horizonEndYear: updatedCycle.horizon_end_year,
      adoptionTargetDate: updatedCycle.adoption_target_date,
      publicReviewOpenAt: updatedCycle.public_review_open_at,
      publicReviewCloseAt: updatedCycle.public_review_close_at,
    });

    audit.info("cycle_updated", { rtpCycleId: cycle.id, durationMs: Date.now() - startedAt });
    return NextResponse.json({
      cycle: {
        ...updatedCycle,
        readiness,
        workflow: buildRtpCycleWorkflowSummary({ status: updatedCycle.status, readiness }),
      },
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update RTP cycle" }, { status: 500 });
  }
}
