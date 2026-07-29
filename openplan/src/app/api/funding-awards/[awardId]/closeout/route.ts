import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { rebuildProjectRtpPosture } from "@/lib/projects/rtp-posture-writeback";
import {
  summarizeBillingInvoiceRecords,
  type BillingInvoiceSummary,
} from "@/lib/invoicing/invoice-records";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

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

type CloseoutInvoiceCoverageBreakdown = {
  paidCount: number;
  paidAmount: number;
  activeCount: number;
  activeAmount: number;
  draftCount: number;
  draftAmount: number;
};

/**
 * The three buckets a close-out refusal explains itself with, read off the
 * invoicing module's own summary of the same rows rather than re-derived here.
 *
 * This was a second, hand-rolled pass over the invoices, and it was wrong twice.
 * It bucketed on the status `"approved"`, which `billing_invoice_records` has
 * never permitted — the column's CHECK constraint allows
 * `draft | internal_review | submitted | approved_for_payment | paid | rejected`
 * — so every approved-for-payment invoice fell through to the residual bucket
 * and was reported back to the planner as money that had not even been submitted
 * for payment. And it valued each row as `net_amount ?? amount` while the
 * coverage figure printed beside it came from `computeNetInvoiceAmount`.
 * `net_amount` is a plain stored column with a `DEFAULT 0`, not a generated one:
 * any row written by something other than the invoicing composer can carry a
 * zero there, and the same invoice would then be worth $0 in the breakdown and
 * its full retention-net value in the coverage figure — two different amounts
 * for one planner's money, in one response.
 *
 * Deriving both from `summarizeBillingInvoiceRecords` makes that class of
 * disagreement impossible: the breakdown's paid bucket IS the coverage figure,
 * and "in the payment flow" means here exactly what it means on /grants,
 * /invoicing and the project funding lane.
 *
 * Approved-for-payment sits with the in-flight invoices rather than the paid
 * ones because the agency has not been reimbursed yet — a funder's approval is a
 * promise, not a deposit, and counting it as paid would let an award close on
 * money that never arrived. Rejected invoices are in no bucket at all, so the
 * three counts deliberately need not add up to every invoice linked to the
 * award: a rejected invoice is not money in this pipeline and never will be.
 */
function buildCloseoutInvoiceCoverageBreakdown(
  summary: BillingInvoiceSummary
): CloseoutInvoiceCoverageBreakdown {
  return {
    paidCount: summary.paidCount,
    paidAmount: summary.paidNetAmount,
    // `submittedCount` is the summary's count of the outstanding triad
    // (internal review / submitted / approved for payment), incremented in the
    // same branch as `outstandingNetAmount`, so the count and the amount can
    // never describe different sets of rows.
    activeCount: summary.submittedCount,
    activeAmount: summary.outstandingNetAmount,
    draftCount: summary.draftCount,
    draftAmount: summary.draftNetAmount,
  };
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

    const payloadJsonBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadJsonBody.ok) return payloadJsonBody.response;

    const payloadJson = payloadJsonBody.data;
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

    // One read of the rows, one set of money numbers. The stored `net_amount`
    // column is selected above for shape parity with the other invoice reads but
    // deliberately not trusted here: the summary recomputes net from `amount`
    // and the retention fields, which is the module's single definition of what
    // an invoice is worth.
    const invoiceSummary = summarizeBillingInvoiceRecords(invoiceRows ?? []);
    const invoiceCoverageBreakdown = buildCloseoutInvoiceCoverageBreakdown(invoiceSummary);
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
            invoiceStatusBreakdown: invoiceCoverageBreakdown,
          },
        },
        { status: 422 }
      );
    }

    if (award.spending_status === "fully_spent") {
      audit.info("funding_award_closeout_already_complete", {
        awardId: award.id,
        projectId: award.project_id,
        awardedAmount,
        paidAmount,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          awardId: award.id,
          status: "already_closed",
          coverage: {
            awardedAmount,
            paidAmount,
            outstandingAmount,
            coverageRatio,
            invoiceStatusBreakdown: invoiceCoverageBreakdown,
          },
        },
        { status: 200 }
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

    const { data: existingCloseoutMilestones, error: milestoneLookupError } = await supabase
      .from("project_milestones")
      .select("id")
      .eq("project_id", award.project_id)
      .eq("funding_award_id", award.id)
      .eq("milestone_type", "closeout")
      .limit(1);

    if (milestoneLookupError) {
      audit.warn("funding_award_closeout_milestone_lookup_failed", {
        awardId: award.id,
        projectId: award.project_id,
        message: milestoneLookupError.message,
        code: milestoneLookupError.code ?? null,
      });
    }

    const hasExistingCloseoutMilestone = (existingCloseoutMilestones?.length ?? 0) > 0;

    if (hasExistingCloseoutMilestone) {
      audit.info("funding_award_closeout_milestone_already_exists", {
        awardId: award.id,
        projectId: award.project_id,
        closedAt: closedAtIso,
      });
    } else {
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
          invoiceStatusBreakdown: invoiceCoverageBreakdown,
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
