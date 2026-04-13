import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  RTP_CYCLE_STATUS_OPTIONS,
} from "@/lib/rtp/catalog";

const RTP_CYCLE_STATUSES = RTP_CYCLE_STATUS_OPTIONS.map((option) => option.value) as [string, ...string[]];

const listRtpCyclesSchema = z.object({
  status: z.enum(RTP_CYCLE_STATUSES).optional(),
});

const createRtpCycleSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    status: z.enum(RTP_CYCLE_STATUSES).optional(),
    geographyLabel: z.string().trim().max(160).optional(),
    horizonStartYear: z.number().int().min(1900).max(2200).optional(),
    horizonEndYear: z.number().int().min(1900).max(2200).optional(),
    adoptionTargetDate: z.string().date().optional(),
    publicReviewOpenAt: z.string().datetime({ offset: true }).optional(),
    publicReviewCloseAt: z.string().datetime({ offset: true }).optional(),
    summary: z.string().trim().max(4000).optional(),
  })
  .superRefine((value, context) => {
    const hasStart = typeof value.horizonStartYear === "number";
    const hasEnd = typeof value.horizonEndYear === "number";
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasStart ? ["horizonEndYear"] : ["horizonStartYear"],
        message: "Both horizon years must be provided together.",
      });
    }

    if (hasStart && hasEnd && value.horizonEndYear! < value.horizonStartYear!) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["horizonEndYear"],
        message: "The horizon end year must be greater than or equal to the start year.",
      });
    }

    if ((value.publicReviewOpenAt && !value.publicReviewCloseAt) || (!value.publicReviewOpenAt && value.publicReviewCloseAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publicReviewCloseAt"],
        message: "Both public review timestamps must be provided together.",
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

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("rtp_cycles.list", request);
  const startedAt = Date.now();

  try {
    const parsedFilters = listRtpCyclesSchema.safeParse({
      status: request.nextUrl.searchParams.get("status") ?? undefined,
    });

    if (!parsedFilters.success) {
      audit.warn("validation_failed", { issues: parsedFilters.error.issues });
      return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let query = supabase
      .from("rtp_cycles")
      .select(
        "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, created_at, updated_at"
      )
      .order("updated_at", { ascending: false });

    if (parsedFilters.data.status) {
      query = query.eq("status", parsedFilters.data.status);
    }

    const { data, error } = await query;

    if (error) {
      audit.error("query_failed", { error: error.message });
      return NextResponse.json({ error: "Failed to load RTP cycles" }, { status: 500 });
    }

    const cycles = (data ?? []).map((cycle) => {
      const readiness = buildRtpCycleReadiness({
        geographyLabel: cycle.geography_label,
        horizonStartYear: cycle.horizon_start_year,
        horizonEndYear: cycle.horizon_end_year,
        adoptionTargetDate: cycle.adoption_target_date,
        publicReviewOpenAt: cycle.public_review_open_at,
        publicReviewCloseAt: cycle.public_review_close_at,
      });

      return {
        ...cycle,
        readiness,
        workflow: buildRtpCycleWorkflowSummary({ status: cycle.status, readiness }),
      };
    });

    audit.info("loaded", { count: cycles.length, durationMs: Date.now() - startedAt });
    return NextResponse.json({ cycles });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to load RTP cycles" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("rtp_cycles.create", request);
  const startedAt = Date.now();

  try {
    const payload = createRtpCycleSchema.safeParse(await request.json());
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid RTP cycle payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let membershipResult;
    try {
      membershipResult = await loadCurrentWorkspaceMembership(supabase, user.id);
    } catch (error) {
      audit.error("membership_lookup_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }

    const membership = membershipResult.membership;

    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const insertPayload = {
      workspace_id: membership.workspace_id,
      title: payload.data.title,
      status: payload.data.status ?? "draft",
      geography_label: payload.data.geographyLabel || null,
      horizon_start_year: payload.data.horizonStartYear ?? null,
      horizon_end_year: payload.data.horizonEndYear ?? null,
      adoption_target_date: payload.data.adoptionTargetDate ?? null,
      public_review_open_at: payload.data.publicReviewOpenAt ?? null,
      public_review_close_at: payload.data.publicReviewCloseAt ?? null,
      summary: payload.data.summary || null,
      created_by: user.id,
    };

    const { data, error } = await supabase
      .from("rtp_cycles")
      .insert(insertPayload)
      .select(
        "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, created_at, updated_at"
      )
      .single();

    if (error) {
      audit.error("insert_failed", { error: error.message });
      return NextResponse.json({ error: "Failed to create RTP cycle" }, { status: 500 });
    }

    const readiness = buildRtpCycleReadiness({
      geographyLabel: data.geography_label,
      horizonStartYear: data.horizon_start_year,
      horizonEndYear: data.horizon_end_year,
      adoptionTargetDate: data.adoption_target_date,
      publicReviewOpenAt: data.public_review_open_at,
      publicReviewCloseAt: data.public_review_close_at,
    });

    audit.info("created", { rtpCycleId: data.id, durationMs: Date.now() - startedAt });
    return NextResponse.json({
      rtpCycleId: data.id,
      cycle: {
        ...data,
        readiness,
        workflow: buildRtpCycleWorkflowSummary({ status: data.status, readiness }),
      },
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to create RTP cycle" }, { status: 500 });
  }
}
