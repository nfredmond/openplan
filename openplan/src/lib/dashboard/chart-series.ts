/**
 * The two figures the dashboard reads from rows the overview did not already
 * have: public comments arriving over time, and money drawn against money
 * authorised.
 *
 * PURE, LIKE `insights.ts`. Rows and a clock come in, an `InsightSeries` comes
 * out. `chart-reads.ts` does the I/O; this file decides what may be drawn.
 *
 * THE RULE THESE TWO EXIST TO OBEY. A shape is more persuasive than a number,
 * so the ways a chart can lie are the whole design here:
 *
 *  1. A FAILED READ IS NOT A ZERO. Both builders take the read's outcome, not
 *     just its rows. `{ rows: [], error }` blocks as unreadable; `{ rows: [] }`
 *     blocks as empty. Nothing about those two states is allowed to look alike.
 *  2. A TRUNCATED READ IS NOT A TOTAL. Both reads are capped. A read that came
 *     back at its cap has more rows behind it, so every total drawn from it
 *     would be an undercount wearing a total's clothes. That blocks too.
 *  3. TWO POINTS ARE NOT A TREND. The comment series needs at least three
 *     weeks with the campaign open before it draws a line.
 *  4. ROWS THAT CANNOT BE ATTRIBUTED ARE COUNTED AND DISCLOSED, never dropped
 *     silently — an invoice with no award on it is money that exists, and a
 *     drawdown figure that quietly omits it understates the draw.
 */

import {
  blocked,
  blockedRead,
  series,
  type ChartReadOutcome,
  type InsightPoint,
  type InsightSeries,
} from "@/lib/dashboard/insights";
import { formatMoney, ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER } from "@/lib/money/format";

/**
 * The read-outcome shape and the wording of a blocked read both moved to
 * `insights.ts` on 2026-08-13, when the RUNS figures — which had been drawing a
 * failed read as a flat line at zero — were put on the same footing. They are
 * re-exported here because that is where every existing caller imports them
 * from, and because the two files are one idea split for testability, not two.
 */
export type { ChartReadOutcome } from "@/lib/dashboard/insights";

export type EngagementCommentRow = {
  created_at?: string | null;
};

export type FundingAwardRow = {
  id?: string | null;
  title?: string | null;
  awarded_amount?: number | string | null;
};

export type AwardInvoiceRow = {
  funding_award_id?: string | null;
  amount?: number | string | null;
  status?: string | null;
};

/**
 * Invoice statuses that mean money has actually been ASKED FOR from the funder.
 * The vocabulary is the database's (20260321000033's status CHECK), not this
 * file's. `draft` and `internal_review` are deliberately excluded: an invoice
 * still inside the agency has not been drawn against anything, and counting it
 * would tell a planner they have less headroom on an award than they do.
 * `rejected` is excluded because a refused claim is not a draw.
 */
export const DRAWN_INVOICE_STATUSES = ["submitted", "approved_for_payment", "paid"] as const;

/** How far back the comment figure looks. Twelve weeks is a comment period and a bit. */
export const COMMENT_WINDOW_WEEKS = 12;

/** A running total needs a few weeks of shape before it is a line and not a pair of dots. */
const MIN_COMMENT_WEEKS = 3;

function weekStartUtc(when: Date): Date {
  const start = new Date(
    Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate())
  );
  // Monday-first weeks: getUTCDay() is 0 for Sunday, which belongs to the week
  // that began six days earlier, not to the one starting tomorrow.
  const dayOffset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - dayOffset);
  return start;
}

function dayLabel(when: Date): string {
  return when.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function toAmount(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Public and staff comments arriving week by week, as a running total.
 *
 * WHY A RUNNING TOTAL AND NOT A WEEKLY COUNT. The question a planner asks
 * during a comment period is "are we getting enough response yet", and that is
 * a cumulative question — the number they report to a board is the total. The
 * risk of a cumulative line is that it can only ever go up, which looks like
 * progress even when a week was silent, so every point ALSO carries how many
 * arrived that week, in the tooltip and in the table. A flat stretch is
 * visible as a flat stretch.
 *
 * The window is bounded, and the caption says so: the total is "since <date>",
 * never "all comments ever", because the read is capped and a lifetime total
 * from a capped read is exactly the lie rule 2 above refuses.
 */
export function commentsReceivedOverTime(
  outcome: ChartReadOutcome<EngagementCommentRow>,
  now: Date = new Date()
): InsightSeries {
  const readBlock = blockedRead(outcome, "public comments");
  if (readBlock) return readBlock;

  const windowStart = weekStartUtc(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - (COMMENT_WINDOW_WEEKS - 1) * 7);

  const perWeek = new Map<number, number>();
  let counted = 0;
  for (const row of outcome.rows) {
    if (typeof row.created_at !== "string") continue;
    const when = new Date(row.created_at);
    if (Number.isNaN(when.getTime())) continue;
    const bucket = weekStartUtc(when);
    if (bucket.getTime() < windowStart.getTime()) continue;
    perWeek.set(bucket.getTime(), (perWeek.get(bucket.getTime()) ?? 0) + 1);
    counted += 1;
  }

  if (counted === 0) {
    return blocked(
      `No comments have come in since ${dayLabel(windowStart)}. Once people start responding to a campaign, their comments show up here week by week.`,
      "empty"
    );
  }

  // Every week in the window is drawn, including silent ones. A silent week
  // skipped would compress the axis and make a quiet month look busy.
  const points: InsightPoint[] = [];
  let runningTotal = 0;
  for (let index = 0; index < COMMENT_WINDOW_WEEKS; index += 1) {
    const bucket = new Date(windowStart);
    bucket.setUTCDate(bucket.getUTCDate() + index * 7);
    const arrived = perWeek.get(bucket.getTime()) ?? 0;
    runningTotal += arrived;
    points.push({
      label: dayLabel(bucket),
      value: runningTotal,
      detail: `Week of ${dayLabel(bucket)}: ${arrived} new comment${arrived === 1 ? "" : "s"} · ${runningTotal} since ${dayLabel(windowStart)}`,
    });
  }

  const weeksWithComments = [...perWeek.values()].filter((count) => count > 0).length;
  if (weeksWithComments < MIN_COMMENT_WEEKS) {
    return blocked(
      `${counted} comment${counted === 1 ? "" : "s"} came in, but they fall in only ${weeksWithComments} week${weeksWithComments === 1 ? "" : "s"}. A line through that is not a trend, so the count is left as a count.`,
      "insufficient"
    );
  }

  return series(points);
}

/**
 * Money drawn against money authorised, one row per award.
 *
 * THE FORM IS A METER, NOT TWO BARS. Drawn and authorised are not two series to
 * compare — one is part of the other, and drawing them as two coloured bars
 * invites the reader to compare award A's authorised against award B's drawn,
 * which means nothing. Each row is a track (authorised) with a fill (drawn).
 *
 * WHAT "DRAWN" MEANS IS STATED, because it is a judgement: an invoice that has
 * been submitted to the funder or beyond. See `DRAWN_INVOICE_STATUSES`.
 *
 * AWARDS WITH NO AMOUNT RECORDED ARE EXCLUDED AND COUNTED. A zero denominator
 * has no percentage, and drawing it as a full or empty bar would state one.
 * Invoices carrying no award link are counted and disclosed the same way: that
 * money exists, it just cannot be attributed to an award, and a drawdown figure
 * that dropped it silently would understate the draw.
 */
export function awardDrawdown(
  awards: ChartReadOutcome<FundingAwardRow>,
  invoices: ChartReadOutcome<AwardInvoiceRow>,
  limit = 8
): InsightSeries {
  const awardBlock = blockedRead(awards, "funding awards");
  if (awardBlock) return awardBlock;
  const invoiceBlock = blockedRead(invoices, "invoice records");
  if (invoiceBlock) return invoiceBlock;

  if (awards.rows.length === 0) {
    return blocked(
      "No funding awards are recorded in this workspace, so there is no authorised money to draw against.",
      "empty"
    );
  }

  const drawnByAward = new Map<string, number>();
  let unattributedDrawn = 0;
  let unattributedCount = 0;
  for (const invoice of invoices.rows) {
    const status = typeof invoice.status === "string" ? invoice.status : "";
    if (!(DRAWN_INVOICE_STATUSES as readonly string[]).includes(status)) continue;
    const amount = toAmount(invoice.amount);
    if (amount === null) continue;
    const awardId = typeof invoice.funding_award_id === "string" ? invoice.funding_award_id : "";
    if (!awardId) {
      unattributedDrawn += amount;
      unattributedCount += 1;
      continue;
    }
    drawnByAward.set(awardId, (drawnByAward.get(awardId) ?? 0) + amount);
  }

  let unpricedAwards = 0;
  const priced = awards.rows.flatMap((award): InsightPoint[] => {
    const authorised = toAmount(award.awarded_amount);
    const id = typeof award.id === "string" ? award.id : "";
    if (authorised === null || authorised <= 0) {
      unpricedAwards += 1;
      return [];
    }
    const drawn = drawnByAward.get(id) ?? 0;
    const percent = Math.round((drawn / authorised) * 100);
    const drawnText = formatMoney(drawn, { precision: "whole" });
    const authorisedText = formatMoney(authorised, { precision: "whole" });
    return [
      {
        label: (typeof award.title === "string" && award.title.trim()) || "(untitled award)",
        value: drawn,
        reference: authorised,
        formattedValue: drawnText,
        detail:
          percent > 100
            ? `${drawnText} drawn against ${authorisedText} authorised — ${percent}%, which is MORE than the award. Check the invoices on it.`
            : `${drawnText} drawn against ${authorisedText} authorised (${percent}%)`,
      },
    ];
  });

  if (priced.length === 0) {
    return blocked(
      `None of the ${awards.rows.length} award${awards.rows.length === 1 ? "" : "s"} here records an amount, so there is no authorised figure to measure a draw against.`,
      "empty"
    );
  }

  // Biggest awards first: the question is where the money is, and an alphabetical
  // list of eight awards buries the one that matters.
  const shown = [...priced].sort((a, b) => (b.reference ?? 0) - (a.reference ?? 0)).slice(0, limit);

  const caveats: string[] = [ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER];
  if (shown.length < priced.length) {
    caveats.push(`Showing the ${shown.length} largest of ${priced.length} awards.`);
  }
  if (unpricedAwards > 0) {
    caveats.push(
      `${unpricedAwards} award${unpricedAwards === 1 ? " records no" : "s record no"} amount and ${unpricedAwards === 1 ? "is" : "are"} left out.`
    );
  }
  if (unattributedCount > 0) {
    caveats.push(
      `${formatMoney(unattributedDrawn, { precision: "whole" })} across ${unattributedCount} invoice${unattributedCount === 1 ? "" : "s"} is not linked to an award, so it is not counted in any bar.`
    );
  }

  return series(shown, caveats.join(" "));
}
