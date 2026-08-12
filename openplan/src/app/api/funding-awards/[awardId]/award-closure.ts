import type { SupabaseClient } from "@supabase/supabase-js";

import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import {
  summarizeBillingInvoiceRecords,
  type BillingInvoiceSummary,
} from "@/lib/invoicing/invoice-records";
import { FUNDING_AWARD_CLOSED_SPENDING_STATUS } from "@/lib/programs/catalog";
import { rebuildProjectRtpPosture } from "@/lib/projects/rtp-posture-writeback";

/**
 * ONE DEFINITION OF WHAT CLOSING AN AWARD MEANS, shared by the two routes that
 * can do it: `POST /api/funding-awards/[awardId]/closeout` and the `PATCH` on
 * the award itself.
 *
 * WHY THIS MODULE EXISTS. Close-out is not a status change. It is a contract:
 * paid invoices must cover the awarded amount, the award is marked fully spent
 * WITH the basis on which it was closed, a close-out milestone is filed on the
 * project, and the project's RTP funding posture is rebuilt so every surface
 * that reports on this project's funding agrees with the change. When PATCH was
 * added, the alternative was to re-implement the coverage arithmetic there —
 * which is how two paths end up disagreeing about whether the same award is
 * covered, and how one of them ends up skipping the milestone. Both routes call
 * the two functions below instead, so there is exactly one answer to "is this
 * covered" and exactly one act of closing.
 *
 * WHAT IS DELIBERATELY NOT HERE. The asserted, import-time closure — the
 * "recorded as closed on import" path — does not pass through
 * `recordEarnedFundingAwardCloseout`. It is a different act with a different
 * meaning, and giving it the earned function's side effects would file a
 * close-out milestone claiming a compliance sign-off that nobody performed.
 * Those writes live in the routes that own the intent, and they set
 * `closure_basis = 'recorded_on_import'` so the row itself carries the
 * difference.
 */

/**
 * A funding-award row, in the shape the close-out needs it. Selected through the
 * caller's own client, so having one in hand already proves the caller can see
 * the row.
 */
export type CloseableFundingAward = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  awarded_amount: number | string | null;
  spending_status: string | null;
  /**
   * Optional in the type even though the schema's coherence CHECK guarantees it
   * is set on every closed award, because whether it ARRIVES depends on the
   * caller's `.select()` — the routes here always ask for it via
   * `CLOSEABLE_FUNDING_AWARD_COLUMNS`, but the page-level reads that feed the
   * grants surfaces choose their own column lists. Readers must treat a missing
   * basis as "not known", never as "earned".
   *
   * Note what this optionality does NOT buy: it is not tolerance for a database
   * without 20260729000001 applied. A `.select()` naming a column the table
   * lacks fails outright at PostgREST, so this code REQUIRES the migration —
   * ship it first.
   */
  closure_basis?: string | null;
  closed_at?: string | null;
  reopened_at?: string | null;
};

/** The columns every read of an award-for-closure must select. */
export const CLOSEABLE_FUNDING_AWARD_COLUMNS =
  "id, workspace_id, project_id, title, awarded_amount, match_amount, match_posture, risk_flag, notes, spending_status, obligation_due_at, expenditure_deadline_at, closure_basis, closed_at, closed_by, closure_note, reopened_at, reopened_by, reopen_reason, created_at, updated_at";

export type FundingAwardAuditLogger = {
  info: (event: string, context?: Record<string, unknown>) => void;
  warn: (event: string, context?: Record<string, unknown>) => void;
  error: (event: string, context?: Record<string, unknown>) => void;
};

/** The subset of the Supabase client these functions use. */
export type FundingAwardClosureSupabaseLike = Pick<SupabaseClient, "from">;

export function toFundingAwardNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export type CloseoutInvoiceCoverageBreakdown = {
  paidCount: number;
  paidAmount: number;
  activeCount: number;
  activeAmount: number;
  draftCount: number;
  draftAmount: number;
};

export type FundingAwardCloseoutCoverage = {
  awardedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  coverageRatio: number;
  invoiceStatusBreakdown: CloseoutInvoiceCoverageBreakdown;
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

export type FundingAwardCoverageEvaluation =
  | { outcome: "read_failed"; message: string; code: string | null }
  | { outcome: "evaluated"; earned: boolean; coverage: FundingAwardCloseoutCoverage };

/**
 * Whether this award's paid invoices have earned it a close-out, and the numbers
 * that say so either way.
 *
 * `earned` requires a positive awarded amount as well as full coverage, because
 * an award with no awarded amount recorded has no denominator: paid $0 of $0 is
 * arithmetically 100% and means nothing at all. The two refusals read
 * differently to the planner (see the close-out control), which is why the
 * coverage object carries both amounts rather than only the ratio.
 */
export async function evaluateFundingAwardCloseoutCoverage({
  supabase,
  award,
}: {
  supabase: FundingAwardClosureSupabaseLike;
  award: CloseableFundingAward;
}): Promise<FundingAwardCoverageEvaluation> {
  const { data: invoiceRows, error: invoiceError } = await supabase
    .from("billing_invoice_records")
    .select("status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date")
    .eq("workspace_id", award.workspace_id)
    .eq("funding_award_id", award.id);

  if (invoiceError) {
    return {
      outcome: "read_failed",
      message: invoiceError.message,
      code: invoiceError.code ?? null,
    };
  }

  // One read of the rows, one set of money numbers. The stored `net_amount`
  // column is selected above for shape parity with the other invoice reads but
  // deliberately not trusted here: the summary recomputes net from `amount`
  // and the retention fields, which is the module's single definition of what
  // an invoice is worth.
  const invoiceSummary = summarizeBillingInvoiceRecords(invoiceRows ?? []);
  const awardedAmount = toFundingAwardNumber(award.awarded_amount);
  const paidAmount = invoiceSummary.paidNetAmount;

  return {
    outcome: "evaluated",
    earned: awardedAmount > 0 && paidAmount >= awardedAmount,
    coverage: {
      awardedAmount,
      paidAmount,
      outstandingAmount: Math.max(awardedAmount - paidAmount, 0),
      coverageRatio: awardedAmount > 0 ? paidAmount / awardedAmount : 0,
      invoiceStatusBreakdown: buildCloseoutInvoiceCoverageBreakdown(invoiceSummary),
    },
  };
}

export type EarnedCloseoutResult =
  | { outcome: "write_failed"; message: string; code: string | null }
  | { outcome: "no_rows_matched" }
  | { outcome: "closed"; closedAt: string };

/**
 * Perform the close-out an award has earned: mark it fully spent with the
 * earned basis, file the close-out milestone, rebuild the project's RTP posture.
 *
 * Callers must have evaluated coverage first — this function does not re-check
 * it, because doing so would read the invoices twice per request and invite the
 * two reads to disagree across the gap between them. The coverage numbers are
 * passed in so the audit record states the figures the decision was actually
 * made on.
 *
 * The status write records WHO closed it and WHEN alongside the basis, in one
 * statement. That is not bookkeeping for its own sake: the schema's coherence
 * CHECK refuses `fully_spent` with no basis, so a future writer that sets the
 * status and forgets the provenance fails loudly at the database instead of
 * quietly producing a closure nobody can account for.
 *
 * The milestone and the posture rebuild are reported as warnings rather than
 * failures, and the returned result deliberately says nothing about them: both
 * happen AFTER the award is already closed, and answering "close-out failed"
 * because a milestone insert failed would tell the caller to retry an act that
 * has already happened. The routes disclose that gap to the planner rather than
 * claiming two writes they did not hear back about.
 */
export async function recordEarnedFundingAwardCloseout({
  supabase,
  award,
  userId,
  notes,
  coverage,
  audit,
  now = () => new Date(),
}: {
  supabase: FundingAwardClosureSupabaseLike;
  award: CloseableFundingAward;
  userId: string;
  notes: string | null;
  coverage: FundingAwardCloseoutCoverage;
  audit: FundingAwardAuditLogger;
  now?: () => Date;
}): Promise<EarnedCloseoutResult> {
  const closedAtIso = now().toISOString();
  const closedAtDate = closedAtIso.slice(0, 10);

  const updateResult = await supabase
    .from("funding_awards")
    .update({
      spending_status: FUNDING_AWARD_CLOSED_SPENDING_STATUS,
      closure_basis: "earned_coverage",
      closed_at: closedAtIso,
      closed_by: userId,
      closure_note: notes,
    })
    .eq("id", award.id)
    .eq("workspace_id", award.workspace_id)
    .select("id")
    .maybeSingle();

  if (isWriteFailure(updateResult.error)) {
    audit.error("funding_award_closeout_update_failed", {
      awardId: award.id,
      message: updateResult.error?.message ?? "unknown",
      code: updateResult.error?.code ?? null,
    });
    return {
      outcome: "write_failed",
      message: updateResult.error?.message ?? "unknown",
      code: updateResult.error?.code ?? null,
    };
  }

  // The caller read this exact row through its own client and passed every
  // membership and role check before getting here, so zero matched rows is not
  // "no such award" — it is the database refusing a write the application
  // believed was allowed. The routes answer it as the disclosed 500 that
  // write-outcome.ts defines for `targetWasVerified: true`.
  if (writeMatchedNoRows(updateResult)) {
    audit.error("funding_award_closeout_update_matched_no_rows", {
      awardId: award.id,
      workspaceId: award.workspace_id,
    });
    return { outcome: "no_rows_matched" };
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
    // An award that was closed, re-opened, and closed again already carries the
    // milestone from the first close-out. It is NOT re-filed and NOT rewritten:
    // it records that a close-out happened on a date, which is still true, and
    // editing it to today's date would erase that. The re-open columns on the
    // award are what carry the fuller story.
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
      created_by: userId,
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

  await rebuildFundingAwardProjectPosture({ supabase, award, audit });

  audit.info("funding_award_closeout_completed", {
    awardId: award.id,
    projectId: award.project_id,
    userId,
    closureBasis: "earned_coverage",
    awardedAmount: coverage.awardedAmount,
    paidAmount: coverage.paidAmount,
  });

  return { outcome: "closed", closedAt: closedAtIso };
}

/**
 * Rebuild the project's RTP funding posture after an award changed.
 *
 * Shared because every write that moves award money has to do it — a create, an
 * earned close-out, an asserted import closure, a re-open, an edit to the
 * awarded amount. The posture is what /projects, /rtp and the grants queue all
 * report from, so an award change that skips it leaves those surfaces stating a
 * funding position that is no longer true.
 */
export async function rebuildFundingAwardProjectPosture({
  supabase,
  award,
  audit,
}: {
  supabase: FundingAwardClosureSupabaseLike;
  award: Pick<CloseableFundingAward, "id" | "project_id" | "workspace_id">;
  audit: FundingAwardAuditLogger;
}): Promise<void> {
  const postureResult = await rebuildProjectRtpPosture({
    supabase,
    projectId: award.project_id,
    workspaceId: award.workspace_id,
  });

  if (postureResult.error) {
    audit.warn("rtp_posture_rebuild_failed", {
      awardId: award.id,
      projectId: award.project_id,
      workspaceId: award.workspace_id,
      message: postureResult.error.message,
      code: postureResult.error.code ?? null,
    });
    return;
  }

  audit.info("rtp_posture_rebuilt", {
    awardId: award.id,
    projectId: award.project_id,
    workspaceId: award.workspace_id,
    status: postureResult.posture?.status ?? "unknown",
    pipelineStatus: postureResult.posture?.pipelineStatus ?? "unknown",
  });
}
