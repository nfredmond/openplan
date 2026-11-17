import type { SupabaseClient } from "@supabase/supabase-js";

import {
  runFundingAwardCloseoutCommand,
  type FundingAwardCloseoutEvent,
} from "@/lib/grants/award-handoff-server";
import {
  summarizeBillingInvoiceRecords,
  type BillingInvoiceSummary,
} from "@/lib/invoicing/invoice-records";
import { rebuildProjectRtpPosture } from "@/lib/projects/rtp-posture-writeback";
import { todayInWorkspace } from "@/lib/time/workspace-calendar";

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
 * WHERE THE ACT HAPPENS. Since 20261117000000 the database refuses any change
 * to an award's closure columns except inside `funding_award_closeout_command`
 * (or the managed command for awards with conditions). The coverage numbers
 * below explain a refusal before the command is called; the command repeats
 * the arithmetic in SQL, inside the transaction that writes the close-out, and
 * its answer is the one that counts. The asserted closure recorded on import
 * runs through the same command and files no milestone.
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
  latest_handoff_revision_id?: string|null; current_handoff_revision_id?:string|null; currency_code?:string|null;
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
  "id, workspace_id, project_id, title, latest_handoff_revision_id, current_handoff_revision_id, currency_code, awarded_amount, match_amount, match_posture, risk_flag, notes, spending_status, obligation_due_at, expenditure_deadline_at, closure_basis, closed_at, closed_by, closure_note, closure_released_amount, obligated_on, reopened_at, reopened_by, reopen_reason, created_at, updated_at";

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
  | {
      outcome: "evaluated";
      /** Paid covers a positive ceiling and no linked request is still open. */
      earned: boolean;
      /** Paid is below a positive ceiling and no linked request is still open. */
      reconcilable: boolean;
      openCount: number;
      coverage: FundingAwardCloseoutCoverage;
    };

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

  // Draft, in internal review, submitted or approved for payment: the SQL
  // command refuses every close while any of these is linked.
  const openCount = invoiceSummary.draftCount + invoiceSummary.submittedCount;

  return {
    outcome: "evaluated",
    earned: awardedAmount > 0 && paidAmount >= awardedAmount && openCount === 0,
    reconcilable: awardedAmount > 0 && paidAmount < awardedAmount && openCount === 0,
    openCount,
    coverage: {
      awardedAmount,
      paidAmount,
      outstandingAmount: Math.max(awardedAmount - paidAmount, 0),
      coverageRatio: awardedAmount > 0 ? paidAmount / awardedAmount : 0,
      invoiceStatusBreakdown: buildCloseoutInvoiceCoverageBreakdown(invoiceSummary),
    },
  };
}

export type FundingAwardClosureActResult =
  | { outcome: "done"; result: Record<string, unknown> }
  | { outcome: "refused"; status: 403 | 404 | 409 | 422 | 503; message: string; detail: string | null };

/**
 * Close, reconcile, record as closed on import, or reopen an award with no
 * handoff revision. Every one of these acts runs in the SQL command
 * `funding_award_closeout_command` (20261117000000): the database refuses a
 * change to the closure columns from anywhere else, so this is the only path.
 * The command re-reads the requests inside its transaction, refuses while any
 * is open, checks paid coverage, files the close-out milestone on the
 * workspace's calendar day and writes the closure receipt. The posture rebuild
 * stays here because it reads through the caller's session.
 */
export async function actOnFundingAwardClosure({
  supabase,
  award,
  userId,
  event,
  note,
  reopenSpendingStatus,
  audit,
  now = () => new Date(),
}: {
  supabase: FundingAwardClosureSupabaseLike;
  award: CloseableFundingAward;
  userId: string;
  event: FundingAwardCloseoutEvent;
  note: string | null;
  reopenSpendingStatus?: string | null;
  audit: FundingAwardAuditLogger;
  now?: () => Date;
}): Promise<FundingAwardClosureActResult> {
  const calendar = await todayInWorkspace(supabase, award.workspace_id, now());
  if (calendar.readError) {
    audit.warn("funding_award_closeout_calendar_unreadable", { awardId: award.id, message: calendar.readError });
  }
  const command = await runFundingAwardCloseoutCommand({
    actorId: userId,
    awardId: award.id,
    event,
    note,
    calendarDate: calendar.today,
    reopenSpendingStatus: reopenSpendingStatus ?? null,
  });
  if (command.outcome === "refused") {
    audit.warn("funding_award_closure_refused", { awardId: award.id, event, status: command.status, message: command.message });
    return command;
  }
  if (command.result.status !== "already_closed") {
    await rebuildFundingAwardProjectPosture({ supabase, award, audit });
  }
  audit.info("funding_award_closure_recorded", {
    awardId: award.id,
    projectId: award.project_id,
    userId,
    event,
    status: command.result.status ?? null,
    closureReceiptId: command.result.closureReceiptId ?? null,
  });
  return command;
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
