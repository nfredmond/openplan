import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import {
  FUNDING_AWARD_MATCH_POSTURE_OPTIONS,
  FUNDING_AWARD_RISK_FLAG_OPTIONS,
  FUNDING_AWARD_SPENDING_STATUS_OPTIONS,
} from "@/lib/programs/catalog";

const FUNDING_AWARD_MATCH_POSTURES = FUNDING_AWARD_MATCH_POSTURE_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];
const FUNDING_AWARD_SPENDING_STATUSES = FUNDING_AWARD_SPENDING_STATUS_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];
const FUNDING_AWARD_RISK_FLAGS = FUNDING_AWARD_RISK_FLAG_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];

const listFundingAwardsSchema = z.object({
  projectId: z.string().uuid().optional(),
});

const createFundingAwardSchema = z.object({
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  awardedAmount: z.number().min(0),
  matchAmount: z.number().min(0).optional(),
  matchPosture: z.enum(FUNDING_AWARD_MATCH_POSTURES).optional(),
  obligationDueAt: z.string().datetime().optional(),
  spendingStatus: z.enum(FUNDING_AWARD_SPENDING_STATUSES).optional(),
  riskFlag: z.enum(FUNDING_AWARD_RISK_FLAGS).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("funding-awards.list", request);
  const startedAt = Date.now();

  try {
    const parsed = listFundingAwardsSchema.safeParse({
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
    });

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
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
      .from("funding_awards")
      .select(
        "id, workspace_id, project_id, program_id, funding_opportunity_id, title, awarded_amount, match_amount, match_posture, obligation_due_at, spending_status, risk_flag, notes, created_at, updated_at, funding_opportunities(id, title), programs(id, title)"
      );

    if (parsed.data.projectId) {
      query = query.eq("project_id", parsed.data.projectId);
    }

    query = query.order("updated_at", { ascending: false });

    const { data, error } = await query;
    if (error) {
      audit.error("funding_awards_list_failed", { message: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to load funding awards" }, { status: 500 });
    }

    return NextResponse.json({ awards: data ?? [] });
  } catch (error) {
    audit.error("funding_awards_list_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while loading funding awards" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("funding-awards.create", request);
  const startedAt = Date.now();

  try {
    const payload = await request.json();
    const parsed = createFundingAwardSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid funding award payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadProjectAccess(supabase, parsed.data.projectId, user.id, "programs.write");
    if (access.error) {
      audit.error("funding_award_project_access_failed", {
        projectId: parsed.data.projectId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }

    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const { data: award, error } = await supabase
      .from("funding_awards")
      .insert({
        workspace_id: access.project.workspace_id,
        project_id: access.project.id,
        funding_opportunity_id: parsed.data.opportunityId ?? null,
        program_id: parsed.data.programId ?? null,
        title: parsed.data.title.trim(),
        awarded_amount: parsed.data.awardedAmount,
        match_amount: parsed.data.matchAmount ?? 0,
        match_posture: parsed.data.matchPosture ?? "partial",
        obligation_due_at: parsed.data.obligationDueAt ?? null,
        spending_status: parsed.data.spendingStatus ?? "not_started",
        risk_flag: parsed.data.riskFlag ?? "none",
        notes: parsed.data.notes?.trim() || null,
        created_by: user.id,
      })
      .select(
        "id, workspace_id, project_id, program_id, funding_opportunity_id, title, awarded_amount, match_amount, match_posture, obligation_due_at, spending_status, risk_flag, notes, created_at, updated_at"
      )
      .single();

    if (error || !award) {
      audit.error("funding_award_insert_failed", {
        projectId: parsed.data.projectId,
        userId: user.id,
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create funding award" }, { status: 500 });
    }

    audit.info("funding_award_created", {
      awardId: award.id,
      userId: user.id,
      workspaceId: access.project.workspace_id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ awardId: award.id, award }, { status: 201 });
  } catch (error) {
    audit.error("funding_award_create_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while creating funding award" }, { status: 500 });
  }
}
