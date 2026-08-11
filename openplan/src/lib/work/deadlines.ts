/**
 * THE ONE deadline convention: how OpenPlan decides what is overdue, what is
 * next, and in what order dated work is presented.
 *
 * WHY THIS MODULE EXISTS (2026-08-11). The same shaping had grown twice, in two
 * places that could not see each other:
 *
 *   - `src/lib/projects/controls.ts` — `isPast`, `sortByEarliestDate` and
 *     `sortDeadlineItems`, feeding one project's control room;
 *   - `src/app/(app)/projects/[projectId]/_components/_ordering.ts` —
 *     `parseSortableDate`, `milestonePriority`, `submittalPriority`,
 *     `invoicePriority`, feeding the same page's record lanes.
 *
 * A third caller then arrived — the personal work queue (`/my-work`), which
 * merges dated records ACROSS projects — and a third copy is how the product
 * ends up calling a milestone overdue on one screen and upcoming on another.
 * This repository's recorded defect class states it exactly: a shared capability
 * that lives inside one of its two callers will be reimplemented wrongly by the
 * third. So the shaping moved here and both original modules became importers;
 * `_ordering.ts` re-exports what its own callers import from it, so no call site
 * had to move at the same time as the logic.
 *
 * NOTHING IN HERE CHANGED IN THE MOVE. Every function is the original body, and
 * the existing tests of both callers (`project-controls-summary.test.ts`,
 * `project-detail-page.test.tsx`, `the-deliverable-update-control-is-reachable.test.tsx`)
 * pass unchanged — that is the proof the extraction is behaviour-preserving, and
 * it is worth more than any assertion written specially for it.
 *
 * TWO NOTIONS OF "UNPARSEABLE" LIVE HERE, DELIBERATELY UNMERGED.
 * {@link parseSortableDate} answers `+Infinity` for a missing or broken date, so
 * an undated record sorts LAST. {@link isDeadlinePast} answers `false` for the
 * same input, so an undated record is never called overdue. Both are right for
 * their question and merging them would be a behaviour change wearing the
 * clothes of a cleanup — the same warning `_ordering.ts` already carried about
 * `latestKnownDate` vs the spine rollup's `latestDate`.
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

/**
 * Whether a due date has already passed.
 *
 * A missing date is NOT overdue, and neither is an unparseable one: "overdue" is
 * a claim about a deadline, and a record with no deadline has not missed one.
 */
export function isDeadlinePast(dateInput: string | null | undefined, now: Date): boolean {
  if (!dateInput) {
    return false;
  }

  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() < now.getTime();
}

/**
 * Soonest first, across the two date columns the project record types use
 * (`target_date` on milestones, `due_date` on submittals, invoices and
 * deliverables). Undated records sort last via the far-future sentinel.
 */
export function sortByEarliestDate<T extends { target_date?: string | null; due_date?: string | null }>(
  records: T[]
): T[] {
  return [...records].sort((left, right) => {
    const leftDate = new Date(left.target_date ?? left.due_date ?? "9999-12-31").getTime();
    const rightDate = new Date(right.target_date ?? right.due_date ?? "9999-12-31").getTime();
    return leftDate - rightDate;
  });
}

/** The minimum an item needs in order to take its place in a deadline queue. */
export type DeadlineOrderable = {
  deadlineAt: string;
  isOverdue: boolean;
};

/**
 * Overdue first, then soonest first.
 *
 * The two-key order is the whole point: a deadline queue sorted by date alone
 * buries a two-week-old miss under tomorrow's work, and a queue sorted by
 * overdue alone loses the order within each half.
 */
export function sortDeadlineItems<T extends DeadlineOrderable>(items: T[]): T[] {
  return sortDeadlineItemsBy(items, (item) => item);
}

/**
 * The same order for items that spell their deadline differently.
 *
 * The personal work queue calls its column `dueOn` and merges four record types
 * that each name their date column something else; it would otherwise need its
 * own copy of the comparator, which is the exact thing this module was created
 * to stop. ONE comparator, two entry points.
 */
export function sortDeadlineItemsBy<T>(
  items: readonly T[],
  toOrderable: (item: T) => DeadlineOrderable
): T[] {
  return [...items].sort((left, right) => {
    const leftOrder = toOrderable(left);
    const rightOrder = toOrderable(right);
    if (leftOrder.isOverdue !== rightOrder.isOverdue) {
      return leftOrder.isOverdue ? -1 : 1;
    }

    return new Date(leftOrder.deadlineAt).getTime() - new Date(rightOrder.deadlineAt).getTime();
  });
}

/** Milestone lanes: blocked, then overdue, then open, then complete. */
export function milestonePriority(
  milestone: { status?: string | null; target_date?: string | null },
  now: Date
): number {
  if (milestone.status === "blocked") return 0;
  if (milestone.status !== "complete" && parseSortableDate(milestone.target_date) < now.getTime()) return 1;
  if (milestone.status !== "complete") return 2;
  return 3;
}

/** Submittal lanes: overdue, then pending, then accepted. */
export function submittalPriority(
  submittal: { status?: string | null; due_date?: string | null },
  now: Date
): number {
  if (submittal.status !== "accepted" && parseSortableDate(submittal.due_date) < now.getTime()) return 0;
  if (submittal.status !== "accepted") return 1;
  return 2;
}

/**
 * Invoice lanes: overdue, then in the review/payment lane, then draft, then
 * settled (paid or rejected).
 */
export function invoicePriority(
  invoice: { status?: string | null; due_date?: string | null },
  now: Date
): number {
  const status = invoice.status ?? "";
  const dueAt = parseSortableDate(invoice.due_date);
  if (!["paid", "rejected"].includes(status) && dueAt < now.getTime()) return 0;
  if (["internal_review", "submitted", "approved_for_payment"].includes(status)) return 1;
  if (status === "draft") return 2;
  return 3;
}

/**
 * How a deadline reads on screen — ONE rendering, so a date does not appear as
 * `2026-08-20` in one place and `8/20/2026, 12:00:00 AM` in another.
 *
 * UTC, deliberately. Half these columns are `DATE` (deliverables, milestones,
 * submittals, invoices) and half are `TIMESTAMPTZ` (grant decisions, award
 * obligations); rendering the first group in the reader's local zone shifts a
 * plain calendar date backwards for anyone west of UTC, which is how a
 * deadline of the 20th shows as the 19th. An unparseable value is returned
 * verbatim rather than swallowed.
 */
export function formatWorkDeadlineDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The statuses that take a record out of the queue entirely, per record type. */
export const CLOSED_DELIVERABLE_STATUS = "complete";
export const CLOSED_MILESTONE_STATUS = "complete";
export const CLOSED_SUBMITTAL_STATUS = "accepted";
export const SETTLED_INVOICE_STATUSES: readonly string[] = ["paid", "rejected"];
