import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { withAssistantActionAudit } from "@/lib/observability/action-audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import {
  FUNDING_OPPORTUNITY_DECISION_OPTIONS,
  FUNDING_OPPORTUNITY_STATUS_OPTIONS,
} from "@/lib/programs/catalog";

const FUNDING_OPPORTUNITY_STATUSES = FUNDING_OPPORTUNITY_STATUS_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];
const FUNDING_OPPORTUNITY_DECISIONS = FUNDING_OPPORTUNITY_DECISION_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
});

const patchFundingOpportunitySchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    status: z.enum(FUNDING_OPPORTUNITY_STATUSES).optional(),
    decisionState: z.enum(FUNDING_OPPORTUNITY_DECISIONS).optional(),
    agencyName: z.union([z.string().trim().max(160), z.null()]).optional(),
    ownerLabel: z.union([z.string().trim().max(160), z.null()]).optional(),
    cadenceLabel: z.union([z.string().trim().max(160), z.null()]).optional(),
    expectedAwardAmount: z.union([z.number().min(0), z.null()]).optional(),
    opensAt: z.union([z.string().datetime(), z.null()]).optional(),
    closesAt: z.union([z.string().datetime(), z.null()]).optional(),
    decisionDueAt: z.union([z.string().datetime(), z.null()]).optional(),
    fitNotes: z.union([z.string().trim().max(4000), z.null()]).optional(),
    readinessNotes: z.union([z.string().trim().max(4000), z.null()]).optional(),
    decisionRationale: z.union([z.string().trim().max(4000), z.null()]).optional(),
    decidedAt: z.union([z.string().datetime(), z.null()]).optional(),
    summary: z.union([z.string().trim().max(4000), z.null()]).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ opportunityId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid funding opportunity id" }, { status: 400 });
    }

    const payload = await request.json();
    const parsed = patchFundingOpportunitySchema.safeParse(payload);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid funding opportunity payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadFundingOpportunityAccess(
      supabase,
      parsedParams.data.opportunityId,
      user.id,
      "programs.write"
    );

    if (access.error) {
      audit.error("funding_opportunity_access_failed", {
        opportunityId: parsedParams.data.opportunityId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
    }

    if (!access.opportunity) {
      return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const updates: Record<string, string | number | null> = {};

    if (parsed.data.title !== undefined) updates.title = parsed.data.title.trim();
    if (parsed.data.status !== undefined) updates.opportunity_status = parsed.data.status;
    if (parsed.data.decisionState !== undefined) updates.decision_state = parsed.data.decisionState;
    if (parsed.data.agencyName !== undefined) updates.agency_name = parsed.data.agencyName?.trim() || null;
    if (parsed.data.ownerLabel !== undefined) updates.owner_label = parsed.data.ownerLabel?.trim() || null;
    if (parsed.data.cadenceLabel !== undefined) updates.cadence_label = parsed.data.cadenceLabel?.trim() || null;
    if (parsed.data.expectedAwardAmount !== undefined) updates.expected_award_amount = parsed.data.expectedAwardAmount;
    if (parsed.data.opensAt !== undefined) updates.opens_at = parsed.data.opensAt;
    if (parsed.data.closesAt !== undefined) updates.closes_at = parsed.data.closesAt;
    if (parsed.data.decisionDueAt !== undefined) updates.decision_due_at = parsed.data.decisionDueAt;
    if (parsed.data.fitNotes !== undefined) updates.fit_notes = parsed.data.fitNotes?.trim() || null;
    if (parsed.data.readinessNotes !== undefined) updates.readiness_notes = parsed.data.readinessNotes?.trim() || null;
    if (parsed.data.decisionRationale !== undefined)
      updates.decision_rationale = parsed.data.decisionRationale?.trim() || null;

    if (parsed.data.decidedAt !== undefined) {
      updates.decided_at = parsed.data.decidedAt;
    } else if (parsed.data.decisionState !== undefined) {
      updates.decided_at = new Date().toISOString();
    }

    if (parsed.data.summary !== undefined) updates.summary = parsed.data.summary?.trim() || null;

    const shouldAuditAsDecision = parsed.data.decisionState !== undefined;
    const runUpdate = async () => {
      const { data, error } = await supabase
        .from("funding_opportunities")
        .update(updates)
        .eq("id", access.opportunity!.id)
        .select(
          "id, workspace_id, program_id, project_id, title, opportunity_status, decision_state, agency_name, owner_label, cadence_label, expected_award_amount, opens_at, closes_at, decision_due_at, fit_notes, readiness_notes, decision_rationale, decided_at, summary, created_at, updated_at"
        )
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "funding_opportunity_update_returned_no_row");
      }
      return data;
    };

    let updatedOpportunity;
    try {
      updatedOpportunity = shouldAuditAsDecision
        ? await withAssistantActionAudit(
            supabase,
            {
              actionKind: "update_funding_opportunity_decision",
              workspaceId: access.opportunity.workspace_id,
              userId: user.id,
              inputSummary: {
                opportunityId: access.opportunity.id,
                decisionState: parsed.data.decisionState,
              },
            },
            runUpdate
          )
        : await runUpdate();
    } catch (updateErr) {
      audit.error("funding_opportunity_update_failed", {
        opportunityId: access.opportunity.id,
        userId: user.id,
        message: updateErr instanceof Error ? updateErr.message : String(updateErr),
      });
      return NextResponse.json({ error: "Failed to update funding opportunity" }, { status: 500 });
    }

    audit.info("funding_opportunity_updated", {
      opportunityId: access.opportunity.id,
      userId: user.id,
      workspaceId: access.opportunity.workspace_id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ opportunity: updatedOpportunity });
  } catch (error) {
    audit.error("funding_opportunity_patch_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while updating funding opportunity" }, { status: 500 });
  }
}
