import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as ordering from "@/app/(app)/projects/[projectId]/_components/_ordering";
import { buildProjectControlsSummary } from "@/lib/projects/controls";
import * as deadlines from "@/lib/work/deadlines";

import { codeIncludes, stripSourceComments } from "./helpers/source-text";
import { loadSeededMyWork } from "./helpers/fake-my-work-tables";

/**
 * ONE DEADLINE CONVENTION, NOT THREE.
 *
 * `isPast`, `sortByEarliestDate` and `sortDeadlineItems` lived in
 * `src/lib/projects/controls.ts`; `parseSortableDate`, `milestonePriority`,
 * `submittalPriority` and `invoicePriority` lived in the project page's
 * `_ordering.ts`. Both moved to `src/lib/work/deadlines.ts` when the personal
 * work queue needed the same shaping across projects — because the third copy
 * is the one that starts calling a milestone overdue on one screen and upcoming
 * on another, and nobody would ever see the disagreement from inside either
 * lane.
 *
 * THE PROOF THE MOVE CHANGED NOTHING is not in this file: it is that
 * `project-controls-summary.test.ts`, `project-detail-page.test.tsx` and
 * `the-deliverable-update-control-is-reachable.test.tsx` pass UNCHANGED. What
 * this file does is stop the copies coming back.
 *
 * MUTATION-VERIFIED (2026-08-11): re-declaring `parseSortableDate` locally in
 * `_ordering.ts` fails the identity test; putting a private `isPast` back into
 * `controls.ts` fails the source guard; changing the shared overdue test to
 * `<=` moves BOTH surfaces in the agreement test, which is the whole point of
 * their sharing it.
 */

const ROOT = path.join(process.cwd(), "src");

function sourceOf(relative: string): string {
  return stripSourceComments(readFileSync(path.join(ROOT, relative), "utf8"));
}

describe("the deadline convention is shared, not copied", () => {
  it("re-exports the project page's ordering helpers rather than redefining them", () => {
    // Identity, not behaviour: two identical copies behave the same until one
    // of them is edited, which is exactly the failure mode.
    expect(ordering.parseSortableDate).toBe(deadlines.parseSortableDate);
    expect(ordering.compareDateValues).toBe(deadlines.compareDateValues);
    expect(ordering.latestKnownDate).toBe(deadlines.latestKnownDate);
    expect(ordering.milestonePriority).toBe(deadlines.milestonePriority);
    expect(ordering.submittalPriority).toBe(deadlines.submittalPriority);
    expect(ordering.invoicePriority).toBe(deadlines.invoicePriority);
  });

  it("keeps the project control room on the shared overdue and sort helpers", () => {
    const controls = sourceOf("lib/projects/controls.ts");

    expect(codeIncludes(controls, 'from "@/lib/work/deadlines"')).toBe(true);
    // The three that moved may not grow local definitions again.
    for (const banned of [
      "function isPast(",
      "function sortByEarliestDate",
      "function sortDeadlineItems",
    ]) {
      expect(
        codeIncludes(controls, banned),
        `controls.ts redefines ${banned} — import it from @/lib/work/deadlines instead`
      ).toBe(false);
    }
  });

  it("keeps the personal queue on them too", () => {
    const sources = sourceOf("lib/my-work/sources.ts");
    const query = sourceOf("lib/my-work/query.ts");

    expect(codeIncludes(sources, 'from "@/lib/work/deadlines"')).toBe(true);
    expect(codeIncludes(query, 'from "@/lib/work/deadlines"')).toBe(true);
    // And it does not invent a second "is this late" test of its own.
    expect(codeIncludes(sources, "function isDeadlinePast")).toBe(false);
    expect(codeIncludes(query, "function isDeadlinePast")).toBe(false);
  });

  it("makes the project control room and the work queue agree about the same date", async () => {
    // The seeded workspace's overdue deliverable is 2026-08-01 against a clock
    // of 2026-08-11; its upcoming one is 2026-09-01.
    const { result } = await loadSeededMyWork();
    const queueOverdue = new Map(result.items.map((item) => [item.id, item.isOverdue]));

    const summary = buildProjectControlsSummary(
      [
        { id: "m-mine", title: "Environmental scoping complete", status: "in_progress", target_date: "2026-08-15" },
        { id: "m-past", title: "Kickoff", status: "in_progress", target_date: "2026-08-01" },
      ],
      [],
      [],
      null,
      new Date("2026-08-11T12:00:00Z")
    );
    const controlsOverdue = new Map(
      summary.deadlineSummary.items.map((item) => [item.targetRowId, item.isOverdue])
    );

    // Same clock, same dates, same verdict — on both sides of the product.
    expect(queueOverdue.get("d-mine-overdue")).toBe(true);
    expect(controlsOverdue.get("project-milestone-m-past")).toBe(true);
    expect(queueOverdue.get("m-mine")).toBe(false);
    expect(controlsOverdue.get("project-milestone-m-mine")).toBe(false);

    // The boundary is the same on both: a deadline AT the current instant has
    // not passed.
    expect(deadlines.isDeadlinePast("2026-08-11T12:00:00Z", new Date("2026-08-11T12:00:00Z"))).toBe(
      false
    );
  });
});
