"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDateTime } from "@/lib/grants/page-helpers";

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

  const isClosed = award.spendingStatus === "fully_spent";

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
        </div>
      </div>

      {isClosed ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Recorded fully spent. OpenPlan marks close-out by setting that spending status, so there is
          nothing left to close here.
        </p>
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
              OpenPlan has no route that reopens a closed award, so treat this as one-way.
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
          ? "Close an award once its paid invoices cover the awarded amount. Closing marks it fully spent, files a close-out milestone, and rebuilds this project's RTP funding posture."
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
