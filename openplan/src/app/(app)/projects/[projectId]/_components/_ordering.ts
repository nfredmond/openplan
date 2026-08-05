import type { BillingInvoiceRow, MilestoneRow, SubmittalRow } from "./_types";

/**
 * How the project control room orders the things that have a date on them.
 *
 * Extracted from `page.tsx` because that file sits at the 1200-line `max-lines`
 * cap and the rule skips comments, so every honest read-failure flag added there
 * has to buy its lines from somewhere. Ordering is the right thing to move: it
 * is pure, it depends on nothing the page loads, and it is the part a reader
 * scanning the page for data flow does not need in front of them.
 *
 * NOTE FOR WHOEVER CONSOLIDATES THIS. `latestKnownDate` here and `latestDate` in
 * `src/lib/projects/spine-readiness.ts` do the same job. They are NOT merged
 * now: the two differ in what they do with an unparseable value, and the spine
 * rollup's behaviour is asserted by its own tests, so unifying them is a change
 * with its own evidence rather than a rename.
 */

/**
 * A sortable timestamp, with a missing or unparseable date sorting LAST.
 *
 * `Number.POSITIVE_INFINITY` rather than 0 is load-bearing: an undated milestone
 * sorted as the epoch would render as the most overdue item on the project.
 */
export function parseSortableDate(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export function compareDateValues(left: string | null | undefined, right: string | null | undefined): number {
  return parseSortableDate(left) - parseSortableDate(right);
}

/** The most recent of the dates that parse, or null when none of them do. */
export function latestKnownDate(...values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => {
      if (!value) return null;
      const time = new Date(value).getTime();
      return Number.isNaN(time) ? null : { value, time };
    })
    .filter((item): item is { value: string; time: number } => Boolean(item));

  if (valid.length === 0) return null;

  valid.sort((left, right) => right.time - left.time);
  return valid[0].value;
}

export function milestonePriority(milestone: MilestoneRow, now: Date): number {
  if (milestone.status === "blocked") return 0;
  if (milestone.status !== "complete" && parseSortableDate(milestone.target_date) < now.getTime()) return 1;
  if (milestone.status !== "complete") return 2;
  return 3;
}

export function submittalPriority(submittal: SubmittalRow, now: Date): number {
  if (submittal.status !== "accepted" && parseSortableDate(submittal.due_date) < now.getTime()) return 0;
  if (submittal.status !== "accepted") return 1;
  return 2;
}

export function invoicePriority(invoice: BillingInvoiceRow, now: Date): number {
  const dueAt = parseSortableDate(invoice.due_date);
  if (!["paid", "rejected"].includes(invoice.status) && dueAt < now.getTime()) return 0;
  if (["internal_review", "submitted", "approved_for_payment"].includes(invoice.status)) return 1;
  if (invoice.status === "draft") return 2;
  return 3;
}
