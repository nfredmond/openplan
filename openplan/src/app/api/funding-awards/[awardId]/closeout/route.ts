import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { rebuildProjectRtpPosture } from "@/lib/projects/rtp-posture-writeback";
import { summarizeBillingInvoiceRecords } from "@/lib/billing/invoice-records";

const awardIdSchema = z.object({
  awardId: z.string().uuid(),
});

const closeoutPayloadSchema = z
  .object({
    notes: z.string().trim().max(4000).optional(),
  })
  .optional();

type RouteContext = {
  params: Promise<{ awardId: string }>;
};

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-awards.closeout", request);
  const startedAt = Date.now();

  try {
    const params = await context.params;
    const parsedParams = awardIdSchema.safeParse(params);

    if (!parsedParams.success) {
      audit.warn("validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid award identifier" }, { status: 400 });
    }

    const payloadJson = await request.json().catch(() => null);
    const parsedPayload = closeoutPayloadSchema.safeParse(payloadJson ?? undefined);
    if (!parsedPayload.success) {
      audit.warn("validation_failed", { issues: parsedPayload.error.issues });
      return NextResponse.json({ error: "Invalid closeout payload" }, { status: 400 });
    }
    const notes = parsedPayload.data?.notes?.trim() || null;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: award, error: awardError } = await supabase
      .from("funding_awards")
      .select(
        "id, workspace_id, project_id, title, awarded_amount, spending_status, obligation_due_at"
      )
      .eq("id", parsedParams.data.awardId)
      .maybeSingle();

    if (awardError) {
      audit.error("funding_award_load_failed", {
        awardId: parsedParams.data.awardId,
        message: awardError.message,
        code: awardError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load funding award" }, { status: 500 });
    }

    if (!award) {
      return NextResponse.json({ error: "Funding award not found" }, { status: 404 });
    }

    const access = await loadProjectAccess(supabase, award.project_id, user.id, "programs.write");
    if (access.error) {
      audit.error("funding_award_project_access_failed", {
        awardId: award.id,
        projectId: award.project_id,
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

    const { data: invoiceRows, error: invoiceError } = await supabase
      .from("billing_invoice_records")
      .select("status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date")
      .eq("workspace_id", award.workspace_id)
      .eq("funding_award_id", award.id);

    if (invoiceError) {
      audit.error("funding_award_invoice_load_failed", {
        awardId: award.id,
        message: invoiceError.message,
        code: invoiceError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked invoices" }, { status: 500 });
    }

    const invoiceSummary = summarizeBillingInvoiceRecords(invoiceRows ?? []);
    const awardedAmount = toNumber(award.awarded_amount);
    const paidAmount = invoiceSummary.paidNetAmount;
    const coverageRatio = awardedAmount > 0 ? paidAmount / awardedAmount : 0;
    const outstandingAmount = Math.max(awardedAmount - paidAmount, 0);

    if (awardedAmount <= 0 || paidAmount < awardedAmount) {
      audit.warn("funding_award_closeout_blocked", {
        awardId: award.id,
        projectId: award.project_id,
        awardedAmount,
        paidAmount,
        outstandingAmount,
      });
      return NextResponse.json(
        {
          error: "Closeout requires 100% paid invoice coverage against the awarded amount",
          coverage: {
            awardedAmount,
            paidAmount,
            outstandingAmount,
            coverageRatio,
          },
        },
        { status: 422 }
      );
    }

    const closedAtIso = new Date().toISOString();
    const closedAtDate = closedAtIso.slice(0, 10);

    const { error: updateAwardError } = await supabase
      .from("funding_awards")
      .update({ spending_status: "fully_spent" })
      .eq("id", award.id)
      .eq("workspace_id", award.workspace_id);

    if (updateAwardError) {
      audit.error("funding_award_closeout_update_failed", {
        awardId: award.id,
        message: updateAwardError.message,
        code: updateAwardError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update funding award" }, { status: 500 });
    }

    const { error: milestoneError } = await supabase.from("project_milestones").insert({
      project_id: award.project_id,
      funding_award_id: award.id,
      title: `Closeout: ${award.title}`,
      summary: notes ?? "Auto-generated compliance sign-off on 100% invoice coverage.",
      milestone_type: "closeout",
      phase_code: "closeout",
      status: "complete",
      target_date: closedAtDate,
      actual_date: closedAtDate,
      created_by: user.id,
    });

    if (milestoneError) {
      audit.warn("funding_award_closeout_milestone_failed", {
        awardId: award.id,
        projectId: award.project_id,
        message: milestoneError.message,
        code: milestoneError.code ?? null,
      });
    } else {
      audit.info("funding_award_closeout_milestone_created", {
        awardId: award.id,
        projectId: award.project_id,
        closedAt: closedAtIso,
      });
    }

    const postureResult = await rebuildProjectRtpPosture({
      supabase,
      projectId: award.project_id,
      workspaceId: award.workspace_id,
    });

    if (postureResult.error) {
      audit.warn("rtp_posture_rebuild_failed", {
        awardId: award.id,
        projectId: award.project_id,
        message: postureResult.error.message,
        code: postureResult.error.code ?? null,
      });
    } else {
      audit.info("rtp_posture_rebuilt", {
        awardId: award.id,
        projectId: award.project_id,
        status: postureResult.posture?.status ?? "unknown",
        pipelineStatus: postureResult.posture?.pipelineStatus ?? "unknown",
      });
    }

    audit.info("funding_award_closeout_completed", {
      awardId: award.id,
      projectId: award.project_id,
      userId: user.id,
      awardedAmount,
      paidAmount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        awardId: award.id,
        coverage: {
          awardedAmount,
          paidAmount,
          outstandingAmount,
          coverageRatio,
        },
        closedAt: closedAtIso,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("funding_award_closeout_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error during funding award closeout" }, { status: 500 });
  }
}
