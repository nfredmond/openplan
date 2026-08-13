"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDateTime } from "@/lib/grants/page-helpers";
import {
  FUNDING_AWARD_CLOSED_SPENDING_STATUS,
  FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS,
  describeFundingAwardClosureBasis,
  formatFundingAwardClosureBasisLabel,
  fundingAwardClosureBasisTone,
} from "@/lib/programs/catalog";

/**
 * The award close-out step of the money lifecycle: discovery → award →
 * reimbursement → close-out.
 *
 * `POST /api/funding-awards/[awardId]/closeout` had no caller anywhere in the
 * app, so an award could be reimbursed to the last dollar and still sit open
 * forever. This is that caller.
 *
 * The route is the authority on whether an award may close, and this control
 * deliberately does not second-guess it. It could add up the project's linked
 * invoices client-side and hide the button when coverage looks short — but a
 * button that silently disappears teaches a planner nothing, while the route's
 * 422 names the shortfall to the dollar. So the button is always offered on an
 * open award, and the refusal is the explanation.
 */

export type FundingAwardCloseoutAward = {
  id: string;
  title: string;
  /** `funding_awards.spending_status`; `fully_spent` is what close-out sets. */
  spendingStatus: string | null;
  /**
   * How the award became closed — `funding_awards.closure_basis`
   * (20260729000001). Optional on purpose, and `undefined` is NOT the same as
   * `null` here: `null` is a row that carries no basis, `undefined` is a caller
   * that did not load the column. Both are rendered as "not known", never as
   * "closed out", because an imported closure that reads like an earned one is
   * the exact false provenance this record exists to prevent.
   */
  closureBasis?: string | null;
  closedAt?: string | null;
  closureNote?: string | null;
  /** Set when the award has been re-opened at least once; survives a re-close. */
  reopenedAt?: string | null;
};

/**
 * The three buckets the route reports on a 422, mirrored exactly: paid, in the
 * payment flow (internal review / submitted / approved for payment), and still a
 * draft. Rejected invoices are in none of them, so the counts are not a census
 * of everything linked to the award — see `CloseoutCoverageBreakdown` below,
 * which has to say so rather than let three zeroes imply an empty register.
 */
type CloseoutInvoiceBreakdown = {
  paidCount: number;
  paidAmount: number;
  activeCount: number;
  activeAmount: number;
  draftCount: number;
  draftAmount: number;
};

/**
 * The route's `coverage` object. `coverageRatio` is not parsed: it is exactly
 * `paidAmount / awardedAmount`, so re-deriving it from the two amounts already
 * required here cannot disagree with the server, while carrying a fourth number
 * could.
 */
type CloseoutCoverage = {
  awardedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  breakdown: CloseoutInvoiceBreakdown | null;
};

type CloseoutOutcome =
  | { kind: "closed"; coverage: CloseoutCoverage | null; closedAt: string | null }
  | { kind: "already_closed" }
  | { kind: "reopened"; priorClosureBasis: string | null; details: string | null }
  | { kind: "refused_coverage"; coverage: CloseoutCoverage }
  | { kind: "refused"; message: string };

function readFiniteNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Parses the breakdown only if every field arrived. A partially-read breakdown
 * would render missing counts as `0`, which reads as "no invoices are sitting in
 * that state" — a claim about the world made out of an absent field.
 */
function parseCloseoutInvoiceBreakdown(value: unknown): CloseoutInvoiceBreakdown | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;

  const paidCount = readFiniteNumber(source, "paidCount");
  const paidAmount = readFiniteNumber(source, "paidAmount");
  const activeCount = readFiniteNumber(source, "activeCount");
  const activeAmount = readFiniteNumber(source, "activeAmount");
  const draftCount = readFiniteNumber(source, "draftCount");
  const draftAmount = readFiniteNumber(source, "draftAmount");

  if (
    paidCount === null ||
    paidAmount === null ||
    activeCount === null ||
    activeAmount === null ||
    draftCount === null ||
    draftAmount === null
  ) {
    return null;
  }

  return { paidCount, paidAmount, activeCount, activeAmount, draftCount, draftAmount };
}

function parseCloseoutCoverage(value: unknown): CloseoutCoverage | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;

  const awardedAmount = readFiniteNumber(source, "awardedAmount");
  const paidAmount = readFiniteNumber(source, "paidAmount");
  const outstandingAmount = readFiniteNumber(source, "outstandingAmount");

  if (awardedAmount === null || paidAmount === null || outstandingAmount === null) {
    return null;
  }

  return {
    awardedAmount,
    paidAmount,
    outstandingAmount,
    breakdown: parseCloseoutInvoiceBreakdown(source.invoiceStatusBreakdown),
  };
}

/**
 * Floors rather than rounds. A 99.6%-covered award rounded to "100% covered"
 * next to a refusal reads as a contradiction, or worse, as a bug in the refusal.
 */
function formatCoveragePercent(coverage: CloseoutCoverage): string | null {
  if (coverage.awardedAmount <= 0) return null;
  return `${Math.floor((coverage.paidAmount / coverage.awardedAmount) * 100)}%`;
}

function describeCoverageRefusal(coverage: CloseoutCoverage): string {
  // The route refuses on `awardedAmount <= 0` with the same status and the same
  // generic message as a shortfall, but the planner's problem is a different
  // one: there is no denominator to cover, not a gap to invoice against.
  if (coverage.awardedAmount <= 0) {
    return "This award has no awarded amount recorded, so there is no total for paid invoices to cover. Set the awarded amount on the award record first.";
  }

  const percent = formatCoveragePercent(coverage);
  return `Paid invoices cover ${formatCurrency(coverage.paidAmount)} of the ${formatCurrency(
    coverage.awardedAmount
  )} awarded${percent ? ` (${percent})` : ""} — ${formatCurrency(
    coverage.outstandingAmount
  )} is still short. Close-out needs the full awarded amount paid.`;
}

function pluralizeInvoices(count: number): string {
  return count === 1 ? "invoice" : "invoices";
}

function CloseoutCoverageBreakdown({ breakdown }: { breakdown: CloseoutInvoiceBreakdown | null }) {
  if (!breakdown) {
    // The route sent no usable breakdown. Rendering three zeroes here would
    // state "this award has no invoices at all", which is not what was read.
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        The refusal arrived without its invoice breakdown, so the split across paid, submitted and open
        invoices is not shown here. The billing register for this project is the record.
      </p>
    );
  }

  const total = breakdown.paidCount + breakdown.activeCount + breakdown.draftCount;

  if (total === 0) {
    // Three zeroes are not evidence of an empty billing register: rejected
    // invoices are counted in no bucket, so an award whose only linked invoice
    // was rejected arrives here looking identical to an award nobody has
    // invoiced against yet. The copy states what the counts actually prove and
    // names the gap, instead of turning an absence into "nothing is linked".
    return (
      <p className="mt-2 text-xs">
        No paid, in-flight, or draft invoice is linked to this award, so nothing has been paid against
        it. Rejected invoices are not counted here, so an award whose only invoice was rejected reads
        the same way. Start a reimbursement record before closing it out.
      </p>
    );
  }

  /*
   * Each bucket is labelled by what is actually known of the invoices in it. The
   * middle one read "submitted" until it was found to be holding internal-review
   * and approved-for-payment invoices too — the route had bucketed on a status
   * string (`approved`) the schema does not define — and telling a planner their
   * approved invoice had never been submitted is a false statement about their
   * own money. It now says which statuses it holds, so the figure can be
   * reconciled line-for-line against the billing register.
   */
  return (
    <ul className="mt-2 space-y-1 text-xs">
      <li>
        <strong>{breakdown.paidCount}</strong> paid {pluralizeInvoices(breakdown.paidCount)} ·{" "}
        {formatCurrency(breakdown.paidAmount)} — the only status that counts toward close-out.
      </li>
      <li>
        <strong>{breakdown.activeCount}</strong> {pluralizeInvoices(breakdown.activeCount)} in the
        payment flow · {formatCurrency(breakdown.activeAmount)} — in internal review, submitted, or
        approved for payment, so not yet paid.
      </li>
      <li>
        <strong>{breakdown.draftCount}</strong> draft {pluralizeInvoices(breakdown.draftCount)} ·{" "}
        {formatCurrency(breakdown.draftAmount)} — not yet in the payment flow.
      </li>
    </ul>
  );
}

/**
 * What a closed award's record actually says about how it closed.
 *
 * The badge and the sentence are both driven by the basis, and the "closure
 * basis was not loaded" case gets its own words rather than borrowing another
 * branch's. Before the basis existed, this row said "Recorded fully spent" over
 * every closed award — an award born closed by a mis-click on the create form
 * and an award closed to the dollar against paid invoices produced the identical
 * line, which is how an assertion becomes indistinguishable from a finding.
 */
function FundingAwardClosureProvenance({ award }: { award: FundingAwardCloseoutAward }) {
  const basisWasLoaded = award.closureBasis !== undefined;

  return (
    <div className="mt-2 rounded-[0.5rem] border border-border/50 bg-background/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={basisWasLoaded ? fundingAwardClosureBasisTone(award.closureBasis) : "neutral"}>
          {basisWasLoaded ? formatFundingAwardClosureBasisLabel(award.closureBasis) : "Closure basis not loaded"}
        </StatusBadge>
        {award.closedAt ? (
          <span className="text-xs text-muted-foreground">Closed {formatDateTime(award.closedAt)}</span>
        ) : null}
        {award.reopenedAt ? (
          <StatusBadge tone="warning">Re-opened {formatDateTime(award.reopenedAt)}</StatusBadge>
        ) : null}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {basisWasLoaded
          ? describeFundingAwardClosureBasis(award.closureBasis)
          : "This view did not load how this award was closed, so it cannot tell an earned close-out from one recorded on import. The award record itself is where that is stored."}
      </p>
      {award.closureNote ? (
        <p className="mt-1.5 text-xs">
          <span className="font-semibold">Stated basis:</span> {award.closureNote}
        </p>
      ) : null}
    </div>
  );
}

function FundingAwardCloseoutRow({
  award,
  projectName,
  canClose,
}: {
  award: FundingAwardCloseoutAward;
  projectName: string;
  canClose: boolean;
}) {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<CloseoutOutcome | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenStatus, setReopenStatus] =
    useState<(typeof FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS)[number]["value"]>("active");

  // Through the catalog constant rather than the literal: this one comparison
  // decides whether the panel offers a close-out or a re-open, and a spelling
  // that drifts from the column's value would silently offer the wrong one.
  const isClosed = award.spendingStatus === FUNDING_AWARD_CLOSED_SPENDING_STATUS;

  async function handleCloseout() {
    setIsSubmitting(true);
    setOutcome(null);

    try {
      const response = await fetch(`/api/funding-awards/${award.id}/closeout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(note.trim() ? { notes: note.trim() } : {}),
      });

      // A gateway or a crash can answer with something that is not JSON at all;
      // that must surface as the HTTP failure it is, not as a parser stack.
      const payload = (await response.json().catch(() => null)) as
        | (Record<string, unknown> & { error?: string; status?: string })
        | null;

      if (response.ok) {
        // The route answers 200 twice: once for a close-out it performed, once
        // for an award that was already closed. The second is not a failure —
        // it is the idempotent answer to a stale page or a second planner
        // getting there first — so it reports as success and says why nothing
        // changed. It does NOT claim a milestone or a posture rebuild, because
        // that path performs neither.
        if (payload?.status === "already_closed") {
          setIsConfirming(false);
          setOutcome({ kind: "already_closed" });
          router.refresh();
          return;
        }

        setIsConfirming(false);
        setOutcome({
          kind: "closed",
          coverage: parseCloseoutCoverage(payload?.coverage),
          closedAt: typeof payload?.closedAt === "string" ? payload.closedAt : null,
        });
        router.refresh();
        return;
      }

      if (response.status === 422) {
        const coverage = parseCloseoutCoverage(payload?.coverage);
        setIsConfirming(false);
        if (coverage) {
          setOutcome({ kind: "refused_coverage", coverage });
          return;
        }
      }

      setIsConfirming(false);
      setOutcome({
        kind: "refused",
        message:
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : `Close-out was refused with HTTP ${response.status} and no reason given.`,
      });
    } catch (requestError) {
      setIsConfirming(false);
      setOutcome({
        kind: "refused",
        message:
          requestError instanceof Error
            ? `Close-out could not be sent: ${requestError.message}`
            : "Close-out could not be sent, and the reason was not reported.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Withdraw a close-out.
   *
   * This exists because the alternative was worse: before the PATCH route, an
   * award closed by a mis-click was closed forever, and the close-out route
   * answered `already_closed` to every attempt to fix it. The reason is required
   * — the API refuses a blank one and so does the database — because an undo
   * nobody accounted for would be a bigger falsification than the mistake it
   * corrects.
   */
  async function handleReopen() {
    const reason = reopenReason.trim();
    if (!reason) {
      setOutcome({
        kind: "refused",
        message: "Re-opening a closed award needs a written reason — it withdraws a close-out.",
      });
      return;
    }

    setIsSubmitting(true);
    setOutcome(null);

    try {
      const response = await fetch(`/api/funding-awards/${award.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reopen: { reason, spendingStatus: reopenStatus } }),
      });

      const payload = (await response.json().catch(() => null)) as
        | (Record<string, unknown> & { error?: string; details?: string })
        | null;

      if (response.ok) {
        setIsReopening(false);
        setReopenReason("");
        setOutcome({
          kind: "reopened",
          priorClosureBasis:
            typeof payload?.priorClosureBasis === "string" ? payload.priorClosureBasis : null,
          details: typeof payload?.details === "string" ? payload.details : null,
        });
        router.refresh();
        return;
      }

      setIsReopening(false);
      setOutcome({
        kind: "refused",
        message:
          [payload?.error, payload?.details].filter((part) => typeof part === "string" && part).join(" ") ||
          `Re-opening was refused with HTTP ${response.status} and no reason given.`,
      });
    } catch (requestError) {
      setIsReopening(false);
      setOutcome({
        kind: "refused",
        message:
          requestError instanceof Error
            ? `Re-opening could not be sent: ${requestError.message}`
            : "Re-opening could not be sent, and the reason was not reported.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <li className="border-t border-border/50 pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{award.title}</p>
        </div>
        <div className="flex items-center gap-2">
          {isClosed ? (
            <StatusBadge tone="success">Closed out</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Open</StatusBadge>
          )}
          {!isClosed && canClose && !isConfirming ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => {
                setOutcome(null);
                setIsConfirming(true);
              }}
            >
              Close out award
            </Button>
          ) : null}
          {isClosed && canClose && !isReopening ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSubmitting}
              onClick={() => {
                setOutcome(null);
                setIsReopening(true);
              }}
            >
              Re-open award
            </Button>
          ) : null}
        </div>
      </div>

      {isClosed ? <FundingAwardClosureProvenance award={award} /> : null}

      {isReopening ? (
        <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-3">
          <p className="text-sm font-semibold">Re-open {award.title}?</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>
              Withdraws the close-out: the award stops reading as fully spent, and its closure basis, date
              and author are cleared from the record.
            </li>
            <li>
              The re-opening itself is kept — date, reason and who did it stay on the award even if it is
              closed out again later.
            </li>
            <li>
              Any close-out milestone already filed on {projectName} is left in place. It records that a
              close-out happened, which re-opening does not undo.
            </li>
            <li>Rebuilds {projectName}&rsquo;s RTP funding posture from the change.</li>
          </ul>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label
                className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                htmlFor={`reopen-status-${award.id}`}
              >
                Status it returns to
              </label>
              <select
                id={`reopen-status-${award.id}`}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
                value={reopenStatus}
                onChange={(event) =>
                  setReopenStatus(
                    event.target.value as (typeof FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS)[number]["value"]
                  )
                }
              >
                {FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {/*
                Asked rather than defaulted. Whether a re-opened award is active
                or delayed is a claim about the work, and only the planner knows
                which is true.
              */}
            </div>
            <div className="space-y-1.5">
              <label
                className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                htmlFor={`reopen-reason-${award.id}`}
              >
                Reason (required)
              </label>
              <Textarea
                id={`reopen-reason-${award.id}`}
                rows={2}
                maxLength={2000}
                value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
                placeholder="Why the close-out is being withdrawn — de-obligation, audit finding, amendment, or a mis-click."
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isSubmitting} onClick={() => void handleReopen()}>
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Re-opening…
                </span>
              ) : (
                "Confirm re-open"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSubmitting}
              onClick={() => setIsReopening(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {isConfirming ? (
        <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-3">
          <p className="text-sm font-semibold">Close out {award.title}?</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>Marks the award fully spent, and files a close-out milestone on {projectName}.</li>
            <li>
              Rebuilds {projectName}&rsquo;s RTP funding posture — the funding status this project shows
              on its own page and in the grants queue is recomputed from the change.
            </li>
            <li>
              Reversible, but not quietly: re-opening a closed award needs a written reason, and both the
              close-out and the re-opening stay on the record.
            </li>
            <li>
              The server refuses unless paid invoices cover the full awarded amount, and will name any
              shortfall.
            </li>
          </ul>

          <div className="mt-3 space-y-1.5">
            <label
              className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              htmlFor={`closeout-note-${award.id}`}
            >
              Close-out note (optional)
            </label>
            <Textarea
              id={`closeout-note-${award.id}`}
              rows={2}
              maxLength={4000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What this close-out certifies, and against which final invoice."
            />
            <p className="text-xs text-muted-foreground">
              Stored as the close-out milestone&rsquo;s summary. Left blank, OpenPlan writes its own
              sign-off line.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isSubmitting} onClick={() => void handleCloseout()}>
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Closing out…
                </span>
              ) : (
                "Confirm close-out"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSubmitting}
              onClick={() => setIsConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {outcome?.kind === "closed" ? (
        <div
          role="status"
          className="mt-3 rounded-[0.5rem] border border-[color:var(--pine)]/30 bg-[color:var(--pine)]/10 px-3 py-3 text-xs text-[color:var(--pine)]"
        >
          <p className="text-sm font-semibold">Closed out {award.title}.</p>
          {outcome.coverage ? (
            <p className="mt-1">
              Marked fully spent against {formatCurrency(outcome.coverage.paidAmount)} paid on the{" "}
              {formatCurrency(outcome.coverage.awardedAmount)} awarded.
            </p>
          ) : null}
          {outcome.closedAt ? <p className="mt-1">Recorded {formatDateTime(outcome.closedAt)}.</p> : null}
          {/*
            The route also files the close-out milestone and rebuilds the RTP
            posture, but it logs a warning and still answers 200 when either of
            those writes fails — the response body carries no result for them.
            So this says they were attempted and points at where the truth lives,
            rather than reporting two writes it never heard back about.
          */}
          <p className="mt-1">
            Close-out also files a close-out milestone and rebuilds this project&rsquo;s RTP funding
            posture. This response does not report on those two writes, so confirm them on the project
            page.
          </p>
        </div>
      ) : null}

      {outcome?.kind === "already_closed" ? (
        <div
          role="status"
          className="mt-3 rounded-[0.5rem] border border-[color:var(--pine)]/30 bg-[color:var(--pine)]/10 px-3 py-3 text-xs text-[color:var(--pine)]"
        >
          <p className="text-sm font-semibold">{award.title} was already closed out.</p>
          <p className="mt-1">
            This view was out of date — nothing changed, and no new milestone or posture rebuild was
            filed.
          </p>
        </div>
      ) : null}

      {outcome?.kind === "reopened" ? (
        <div
          role="status"
          className="mt-3 rounded-[0.5rem] border border-[color:var(--copper)]/40 bg-[color:var(--copper)]/10 px-3 py-3 text-xs text-[color:var(--copper)]"
        >
          <p className="text-sm font-semibold">Re-opened {award.title}.</p>
          {outcome.priorClosureBasis ? (
            <p className="mt-1">
              The closure it withdrew was recorded as{" "}
              {formatFundingAwardClosureBasisLabel(outcome.priorClosureBasis).toLowerCase()}.
            </p>
          ) : null}
          {outcome.details ? <p className="mt-1">{outcome.details}</p> : null}
        </div>
      ) : null}

      {outcome?.kind === "refused_coverage" ? (
        <div
          role="alert"
          className="mt-3 rounded-[0.5rem] border border-[color:var(--copper)]/40 bg-[color:var(--copper)]/10 px-3 py-3 text-[color:var(--copper)]"
        >
          <p className="text-sm font-semibold">Close-out refused: invoice coverage is short.</p>
          <p className="mt-1 text-xs">{describeCoverageRefusal(outcome.coverage)}</p>
          <CloseoutCoverageBreakdown breakdown={outcome.coverage.breakdown} />
        </div>
      ) : null}

      {outcome?.kind === "refused" ? (
        <div
          role="alert"
          className="mt-3 rounded-[0.5rem] border border-destructive/40 bg-destructive/10 px-3 py-3 text-destructive"
        >
          <p className="text-sm font-semibold">Close-out refused.</p>
          <p className="mt-1 text-xs">{outcome.message}</p>
        </div>
      ) : null}
    </li>
  );
}

export function FundingAwardCloseoutPanel({
  projectName,
  awards,
  canClose,
}: {
  projectName: string;
  awards: FundingAwardCloseoutAward[];
  canClose: boolean;
}) {
  if (awards.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-[0.5rem] border border-border/60 bg-muted/15 px-3 py-3">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Award close-out
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {/*
          The withheld-control sentence describes THIS VIEW, never the reader's
          standing. `canClose` is only as good as whatever signal the caller had
          to hand, and a caller can hold a narrower one than the route uses: for
          a while /grants gated this on `invoices.write` (owner/admin) against a
          close-out route that authorizes `programs.write` (owner/admin/member),
          so every member saw the control withheld for a close-out the server
          would have accepted. Telling that member "this is read-only for you"
          would have stated as fact something the component cannot know and the
          server would have contradicted. So it says what is true — the control
          is not offered here — and leaves the permission question with the
          route, which settles it per project.
        */}
        {canClose
          ? "Close an award once its paid invoices cover the awarded amount. Closing marks it fully spent, files a close-out milestone, and updates how this project's funding is counted in the long-range plan. A closed award can be re-opened with a written reason, and each closed award shows how it was closed — earned against invoices, or recorded on import."
          : "Close-out marks an award fully spent once its paid invoices cover the awarded amount. Recording one is a write action and this view is not offering it; the server decides per project who may record a close-out."}
      </p>
      <ul className="mt-3 space-y-3">
        {awards.map((award) => (
          <FundingAwardCloseoutRow
            key={`award-closeout-${award.id}`}
            award={award}
            projectName={projectName}
            canClose={canClose}
          />
        ))}
      </ul>
    </div>
  );
}
