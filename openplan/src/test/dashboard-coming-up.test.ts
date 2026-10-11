import { describe, expect, it } from "vitest";

import {
  addDays,
  calendarDate,
  cappedSourcesSentence,
  comingUpFromMyWork,
  deadlinesByMonth,
  isCalendarDayPast,
  needsYouFromMyWork,
  sortComingUp,
  withCommandActions,
  withinWindow,
  type ComingUpItem,
} from "@/lib/dashboard/coming-up";
import type { MyWorkItem } from "@/lib/my-work/types";

function item(overrides: Partial<MyWorkItem>): MyWorkItem {
  return {
    sourceId: "deliverables",
    block: "deadlines",
    id: "d1",
    title: "Draft PS&E",
    projectId: "p1",
    projectName: "Main Street",
    dueOn: "2026-10-14",
    isOverdue: false,
    ownerLabel: null,
    badge: { label: "Deliverable", tone: "neutral" },
    detail: null,
    href: "/projects/p1?tab=delivery",
    dedupKey: null,
    ...overrides,
  };
}

describe("dashboard lists", () => {
  it("puts dated work in Coming up and undated work in Needs you, never both", () => {
    const items = [
      item({ id: "a", block: "deadlines" }),
      item({ id: "b", sourceId: "grant_decisions", block: "workspace_deadlines", dueOn: "2026-10-20T07:00:00+00:00" }),
      item({ id: "c", sourceId: "stage_gate_holds", block: "blocked_projects", dueOn: null, badge: { label: "Held at a gate", tone: "warning" } }),
      item({ id: "d", sourceId: "narrative_drafts", block: "needs_review", dueOn: null }),
    ];
    const coming = comingUpFromMyWork(items);
    const needs = needsYouFromMyWork(items);

    expect(coming.map((entry) => entry.key)).toEqual(["deliverables:a", "grant_decisions:b"]);
    expect(coming[1].dueOn).toBe("2026-10-20");
    expect(coming[1].kind).toBe("grant");
    expect(needs.map((entry) => entry.key)).toEqual(["stage_gate_holds:c", "narrative_drafts:d"]);
    const overlap = coming.filter((entry) => needs.some((need) => need.key === entry.key));
    expect(overlap).toEqual([]);
  });

  it("lists blocked projects before reviews", () => {
    const needs = needsYouFromMyWork([
      item({ id: "r", sourceId: "narrative_drafts", block: "needs_review", dueOn: null }),
      item({ id: "g", sourceId: "stage_gate_holds", block: "blocked_projects", dueOn: null }),
    ]);
    expect(needs.map((entry) => entry.key)).toEqual(["stage_gate_holds:g", "narrative_drafts:r"]);
  });

  it("adds a workspace next step only when My Work does not already link to it", () => {
    const needs = needsYouFromMyWork([
      item({ id: "r", sourceId: "narrative_drafts", block: "needs_review", dueOn: null, href: "/reports/1" }),
    ]);
    const merged = withCommandActions(needs, [
      { key: "refresh", title: "Refresh report packets", href: "/reports/1" },
      { key: "grants", title: "Advance near-term funding windows", href: "/grants", moduleLabel: "Grants" },
    ]);
    expect(merged.map((entry) => entry.key)).toEqual(["narrative_drafts:r", "command:grants"]);
    expect(merged[1].label).toBe("Grants");
  });

  it("sorts soonest first, drops duplicate keys, and keeps a window", () => {
    const entries: ComingUpItem[] = [
      { key: "x", kind: "invoice", title: "B", dueOn: "2026-11-03", href: "/", projectName: null, overdue: false },
      { key: "y", kind: "grant", title: "A", dueOn: "2026-10-14", href: "/", projectName: null, overdue: false },
      { key: "y", kind: "grant", title: "A", dueOn: "2026-10-14", href: "/", projectName: null, overdue: false },
      { key: "z", kind: "adoption", title: "C", dueOn: "2027-02-01", href: "/", projectName: null, overdue: false },
    ];
    const sorted = sortComingUp(entries);
    expect(sorted.map((entry) => entry.key)).toEqual(["y", "x", "z"]);
    expect(withinWindow(sorted, "2026-12-31").map((entry) => entry.key)).toEqual(["y", "x"]);
  });

  it("compares calendar days, so a deadline is not past on its own day", () => {
    expect(isCalendarDayPast("2026-10-14", "2026-10-14")).toBe(false);
    expect(isCalendarDayPast("2026-10-13", "2026-10-14")).toBe(true);
    expect(calendarDate("2026-10-14T23:30:00-07:00")).toBe("2026-10-14");
    expect(calendarDate("not a date")).toBeNull();
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("says in words when a source returned its cap, and says nothing otherwise", () => {
    expect(cappedSourcesSentence([])).toBeNull();
    expect(cappedSourcesSentence([{ label: "deliverables", shown: 10 }])).toBe(
      "More deliverables may be due than are shown here. My Work lists them all."
    );
  });

  it("counts deadlines into calendar months from the start month", () => {
    const counts = deadlinesByMonth(
      [
        { key: "a", kind: "grant", title: "A", dueOn: "2026-10-14", href: "/", projectName: null, overdue: false },
        { key: "b", kind: "invoice", title: "B", dueOn: "2026-10-30", href: "/", projectName: null, overdue: false },
        { key: "c", kind: "invoice", title: "C", dueOn: "2026-12-01", href: "/", projectName: null, overdue: false },
        { key: "d", kind: "invoice", title: "D", dueOn: "2027-03-01", href: "/", projectName: null, overdue: false },
      ],
      "2026-10-10",
      3
    );
    expect(counts.map((bucket) => [bucket.label, bucket.count])).toEqual([
      ["Oct", 2],
      ["Nov", 0],
      ["Dec", 1],
    ]);
  });
});
