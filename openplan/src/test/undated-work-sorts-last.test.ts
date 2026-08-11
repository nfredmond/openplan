import { describe, expect, it } from "vitest";

import {
  compareDateValues,
  invoicePriority,
  isDeadlinePast,
  milestonePriority,
  parseSortableDate,
  submittalPriority,
} from "@/lib/work/deadlines";

/**
 * A RECORD WITH NO DATE IS THE LAST THING TO WORRY ABOUT, NEVER THE FIRST.
 *
 * `parseSortableDate` answers `Number.POSITIVE_INFINITY` for a missing or
 * unparseable date. That sentinel is the whole behaviour, and it was completely
 * unguarded: changing it to `0` survived all 9,201 tests in this repository.
 * The consequence of that surviving mutation is not a cosmetic ordering wobble.
 * Every overdue test built on this function is a `< now.getTime()` comparison,
 * so an undated record parsed as the epoch is not merely sorted first — it is
 * classified OVERDUE. A milestone nobody has scheduled would head the schedule
 * as the most urgent thing on the project, above real misses.
 *
 * This file pins the sentinel by its CONSEQUENCES rather than by its value, so
 * it fails in both directions a "simplification" could take it: `0` and
 * `-Infinity` are both smaller than every real timestamp and both produce the
 * same wrong verdict. An assertion of the literal `Infinity` would pin the
 * number without pinning what depends on it.
 *
 * The companion rule is in the module's own header and is asserted at the
 * bottom: `isDeadlinePast` answers `false` for the same input. Two notions of
 * "unparseable", deliberately unmerged — one orders, one judges — and they must
 * agree on the only thing that matters, which is that an undated record has not
 * missed a deadline.
 */

const NOW = new Date("2026-08-11T12:00:00.000Z");
const PAST = "2026-07-01";
const FUTURE = "2026-12-01";
/** Beyond anything a planner would type, and still a real, parseable date. */
const FAR_FUTURE = "9999-12-31";

const UNDATED: Array<[string, string | null | undefined]> = [
  ["null", null],
  ["undefined", undefined],
  ["an empty string", ""],
  ["an unparseable string", "not a date"],
];

describe("an undated record sorts last and is never called overdue", () => {
  it.each(UNDATED)("sorts %s after even the furthest real date", (_label, value) => {
    // Greater than a real date, not merely different from it. `0` and
    // `-Infinity` both fail here, and so would any sentinel in the past.
    expect(parseSortableDate(value)).toBeGreaterThan(parseSortableDate(FAR_FUTURE));
    expect(parseSortableDate(value)).toBeGreaterThan(NOW.getTime());
  });

  it("puts the undated record at the bottom when a mixed list is sorted by date", () => {
    const rows = [
      { id: "undated", date: null as string | null },
      { id: "future", date: FUTURE },
      { id: "past", date: PAST },
    ];

    const ordered = [...rows]
      .sort((left, right) => compareDateValues(left.date, right.date))
      .map((row) => row.id);

    expect(ordered).toEqual(["past", "future", "undated"]);
  });

  it("treats two undated records as equally unurgent rather than reordering them", () => {
    // `Infinity - Infinity` is NaN, which the language defines as +0 inside a
    // sort comparator — so the pair keeps its original order instead of being
    // shuffled. Recorded because it looks like a bug and is not.
    const rows = [{ id: "a", date: null }, { id: "b", date: null }];
    expect(
      [...rows].sort((left, right) => compareDateValues(left.date, right.date)).map((row) => row.id)
    ).toEqual(["a", "b"]);
  });

  it("does not put an undated milestone in the overdue lane", () => {
    const overdue = milestonePriority({ status: "in_progress", target_date: PAST }, NOW);
    const scheduled = milestonePriority({ status: "in_progress", target_date: FUTURE }, NOW);
    const undated = milestonePriority({ status: "in_progress", target_date: null }, NOW);

    // An unscheduled milestone is ordinary open work — the same lane as one
    // whose target is still ahead, and strictly below a real miss.
    expect(undated).toBe(scheduled);
    expect(undated).toBeGreaterThan(overdue);
  });

  it("does not put an undated submittal in the overdue lane", () => {
    const overdue = submittalPriority({ status: "submitted", due_date: PAST }, NOW);
    const pending = submittalPriority({ status: "submitted", due_date: FUTURE }, NOW);
    const undated = submittalPriority({ status: "submitted", due_date: null }, NOW);

    expect(undated).toBe(pending);
    expect(undated).toBeGreaterThan(overdue);
  });

  it("does not put an invoice with no due date in the overdue lane", () => {
    // Money, so the direction of the error matters twice: an invoice reported
    // late that is not late sends somebody chasing a funder for nothing.
    const overdue = invoicePriority({ status: "submitted", due_date: PAST }, NOW);
    const inReview = invoicePriority({ status: "submitted", due_date: FUTURE }, NOW);
    const undated = invoicePriority({ status: "submitted", due_date: null }, NOW);

    expect(undated).toBe(inReview);
    expect(undated).toBeGreaterThan(overdue);
  });

  it("keeps the undated milestone last under the project page's two-key ordering", () => {
    // The page sorts by lane priority first and by date within a lane — the
    // same shape as `prioritizedMilestones` in
    // src/app/(app)/projects/[projectId]/page.tsx, which imports both halves
    // from this module (pinned by work-deadlines-are-shared.test.ts).
    const milestones = [
      { id: "undated", status: "in_progress", target_date: null as string | null },
      { id: "blocked", status: "blocked", target_date: FUTURE },
      { id: "overdue", status: "in_progress", target_date: PAST },
      { id: "upcoming", status: "in_progress", target_date: FUTURE },
    ];

    const ordered = [...milestones]
      .sort((left, right) => {
        const priorityDiff = milestonePriority(left, NOW) - milestonePriority(right, NOW);
        if (priorityDiff !== 0) return priorityDiff;
        return compareDateValues(left.target_date, right.target_date);
      })
      .map((milestone) => milestone.id);

    // Blocked, then the real miss, then dated open work, then the one nobody
    // has scheduled. A past-facing sentinel puts "undated" second.
    expect(ordered).toEqual(["blocked", "overdue", "upcoming", "undated"]);
  });

  it.each(UNDATED)("agrees with isDeadlinePast that %s has missed nothing", (_label, value) => {
    // The two functions answer different questions and must not be merged, but
    // they cannot disagree about this: no deadline means no missed deadline.
    expect(isDeadlinePast(value, NOW)).toBe(false);
    expect(parseSortableDate(value) < NOW.getTime()).toBe(false);
  });
});
