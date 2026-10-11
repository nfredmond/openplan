import type { MyWorkItem, MyWorkSourceId } from "@/lib/my-work/types";

/**
 * The dashboard's two lists, built from My Work and a few workspace dates.
 *
 * Needs you holds work that has no date (blocked projects, reviews waiting on a
 * person, undated tasks). Coming up holds dated work. An item lands in one list
 * only, so the same obligation never appears twice on one screen.
 *
 * Dates are compared as calendar days. A due date of the 14th is not overdue
 * until the 14th has ended for the reader; `isCalendarDayPast` gives the
 * browser's own answer, and the server's conservative answer comes from
 * `isDeadlinePast` in `lib/work/deadlines.ts`.
 */

export type ComingUpKind =
  | "deliverable"
  | "milestone"
  | "submittal"
  | "grant"
  | "award"
  | "invoice"
  | "plan-action"
  | "plan-review"
  | "public-review"
  | "adoption"
  | "comment-period";

export type ComingUpItem = {
  key: string;
  kind: ComingUpKind;
  title: string;
  /** Calendar date, `YYYY-MM-DD`. */
  dueOn: string;
  href: string;
  projectName: string | null;
  /** The server's answer. The browser may also mark items due yesterday. */
  overdue: boolean;
};

export type NeedsYouItem = {
  key: string;
  title: string;
  /** Short word for what kind of work this is ("Stage gate", "Review"). */
  label: string;
  href: string;
  projectName: string | null;
};

/** A source that returned its full read cap, so more rows may exist. */
export type CappedSource = { label: string; shown: number };

const KIND_BY_SOURCE: Partial<Record<MyWorkSourceId, ComingUpKind>> = {
  deliverables: "deliverable",
  milestones: "milestone",
  submittals: "submittal",
  land_use_plan_actions: "plan-action",
  land_use_plan_process: "plan-action",
  land_use_plan_review_closing: "plan-review",
  grant_decisions: "grant",
  award_obligations: "award",
  invoice_windows: "invoice",
};

/** The word shown beside each date. */
export const COMING_UP_KIND_LABELS: Record<ComingUpKind, string> = {
  deliverable: "Deliverable",
  milestone: "Milestone",
  submittal: "Submittal",
  grant: "Grant decision",
  award: "Award deadline",
  invoice: "Invoice window",
  "plan-action": "Plan action",
  "plan-review": "Plan review closes",
  "public-review": "Public review closes",
  adoption: "Adoption target",
  "comment-period": "Comment period ends",
};

const DATED_BLOCKS = new Set(["deadlines", "workspace_deadlines"]);

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` from a date or timestamp string, or null when it is not one. */
export function calendarDate(value: string | null | undefined): string | null {
  const match = value ? DATE_ONLY.exec(value) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** The reader's own calendar date, `YYYY-MM-DD`, in their device's time zone. */
export function localCalendarDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Whether a calendar date is before today. String order is date order for `YYYY-MM-DD`. */
export function isCalendarDayPast(dueOn: string, today: string): boolean {
  return dueOn < today;
}

/** Shift a `YYYY-MM-DD` date by whole days. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** My Work items with a date become Coming up items; everything else is left out. */
export function comingUpFromMyWork(items: readonly MyWorkItem[]): ComingUpItem[] {
  return items.flatMap((item) => {
    const dueOn = calendarDate(item.dueOn);
    const kind = KIND_BY_SOURCE[item.sourceId];
    if (!DATED_BLOCKS.has(item.block) || !dueOn || !kind) return [];
    return [
      {
        key: `${item.sourceId}:${item.id}`,
        kind,
        title: item.title,
        dueOn,
        href: item.href,
        projectName: item.projectName,
        overdue: item.isOverdue,
      },
    ];
  });
}

const NEEDS_YOU_BLOCK_ORDER = ["blocked_projects", "needs_review", "undated"] as const;

/** My Work items without a date become Needs you items, blocked work first. */
export function needsYouFromMyWork(items: readonly MyWorkItem[]): NeedsYouItem[] {
  return NEEDS_YOU_BLOCK_ORDER.flatMap((block) =>
    items
      .filter((item) => item.block === block)
      .map((item) => ({
        key: `${item.sourceId}:${item.id}`,
        title: item.title,
        label: item.badge.label,
        href: item.href,
        projectName: item.projectName,
      }))
  );
}

/**
 * Add workspace-level next actions that My Work does not already list. Matched
 * on the link, because two lists that send the planner to the same record are
 * the same item.
 */
export function withCommandActions(
  needsYou: readonly NeedsYouItem[],
  commands: ReadonlyArray<{ key: string; title: string; href: string; moduleLabel?: string }>
): NeedsYouItem[] {
  const seen = new Set(needsYou.map((item) => item.href));
  const extra = commands
    .filter((command) => !seen.has(command.href))
    .map((command) => ({
      key: `command:${command.key}`,
      title: command.title,
      label: command.moduleLabel ?? "Next step",
      href: command.href,
      projectName: null,
    }));
  return [...needsYou, ...extra];
}

/** Soonest first; ties keep a stable order by title. Duplicate keys keep the first. */
export function sortComingUp(items: readonly ComingUpItem[]): ComingUpItem[] {
  const seen = new Set<string>();
  return [...items]
    .filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)))
    .sort((left, right) =>
      left.dueOn === right.dueOn ? left.title.localeCompare(right.title) : left.dueOn < right.dueOn ? -1 : 1
    );
}

/** Items due on or before `until`, inclusive. */
export function withinWindow(items: readonly ComingUpItem[], until: string): ComingUpItem[] {
  return items.filter((item) => item.dueOn <= until);
}

/**
 * The sentence that says a list may be incomplete, or null when every source
 * returned fewer rows than its cap. A list that silently stops at a cap reads
 * as "nothing else is due", which is the empty-queue failure the roadmap (M2c)
 * forbids.
 */
export function cappedSourcesSentence(capped: readonly CappedSource[]): string | null {
  if (capped.length === 0) return null;
  const named = capped.map((source) => source.label).join(", ");
  return `More ${named} may be due than are shown here. My Work lists them all.`;
}

/** Counts by month and kind for the "Deadlines by month" chart. */
export function deadlinesByMonth(
  items: readonly ComingUpItem[],
  from: string,
  months: number
): Array<{ month: string; label: string; count: number }> {
  const [year, month] = from.split("-").map(Number);
  const buckets = Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 + index, 1));
    return {
      month: date.toISOString().slice(0, 7),
      label: date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      count: 0,
    };
  });
  const byMonth = new Map(buckets.map((bucket) => [bucket.month, bucket]));
  for (const item of items) {
    const bucket = byMonth.get(item.dueOn.slice(0, 7));
    if (bucket) bucket.count += 1;
  }
  return buckets;
}
