import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The open-source modelling landscape must be RE-CHECKED, not remembered.
 *
 * ============================================================== WHY THIS EXISTS
 *
 * Nathaniel asked, in his words, that "an agent checks the internet every now
 * and again" about open-source transportation modelling — because the engines
 * OpenPlan is built on change, and an agent recalling what was true a year ago
 * sounds exactly like an agent that just checked.
 *
 * A note in a document asking someone to review it every six months is a
 * convention, and every convention in this repository that was only written
 * down has been violated at least once. So the review date is executable: when
 * it passes, this test fails, and the failure names the document and what to do.
 *
 * The fix for a failure is never to edit the date. It is to DO the review — read
 * the projects' own documentation, decide whether anything changed, record what
 * would change the answer — and then move the date because the review happened.
 *
 * ============================================================ WHAT IT CANNOT DO
 *
 * It cannot tell whether a review was real or whether someone bumped a date to
 * get a green suite. Nothing here can. What it does is make the omission
 * VISIBLE and dated, which is the whole difference between a reminder and a
 * mechanism.
 */

const REPO_ROOT = path.join(process.cwd(), "..");
const LANDSCAPE_DOC = path.join(REPO_ROOT, "docs", "modeling", "OPEN_SOURCE_MODEL_LANDSCAPE.md");
const RELATIVE = path.relative(REPO_ROOT, LANDSCAPE_DOC);

/** `**Reviewed YYYY-MM-DD. Next review due YYYY-MM-DD**` */
const REVIEWED_ON = /\*\*Reviewed (\d{4}-\d{2}-\d{2})\./;
const NEXT_REVIEW = /Next review due (\d{4}-\d{2}-\d{2})/;

function landscapeDoc(): string {
  return readFileSync(LANDSCAPE_DOC, "utf8");
}

function parseUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

describe("the open-source modelling landscape is rechecked on a schedule", () => {
  it("has a landscape review document at all", () => {
    expect(
      existsSync(LANDSCAPE_DOC),
      `${RELATIVE} is missing. It records which modelling engines were considered and why, ` +
        "and it is the thing this schedule is about. Restore it from git history rather than " +
        "deleting this test."
    ).toBe(true);
  });

  it("states when it was reviewed and when it is due again", () => {
    const doc = landscapeDoc();
    const reviewed = REVIEWED_ON.exec(doc)?.[1];
    const due = NEXT_REVIEW.exec(doc)?.[1];

    expect(reviewed, `${RELATIVE} does not say when it was last reviewed`).toBeTruthy();
    expect(due, `${RELATIVE} does not say when the next review is due`).toBeTruthy();

    // A due date before the review date would make the check meaningless.
    expect(
      parseUtcDate(due!).getTime(),
      "the next review is dated before the last one"
    ).toBeGreaterThan(parseUtcDate(reviewed!).getTime());
  });

  it("is not overdue", () => {
    const due = NEXT_REVIEW.exec(landscapeDoc())?.[1];
    const overdueBy = Math.floor(
      (Date.now() - parseUtcDate(due!).getTime()) / (24 * 60 * 60 * 1000)
    );

    expect(
      overdueBy,
      `The open-source modelling landscape review is ${overdueBy} days overdue (was due ${due}).\n` +
        `Read ${RELATIVE} — its "What would change the answer" section is the checklist. ` +
        "Check the projects' own documentation (ActivitySim, MATSim, SUMO, Zephyr Foundation), " +
        "not search-engine listicles. Then record what you found and move the date because the " +
        "review happened — not to make this pass."
    ).toBeLessThanOrEqual(0);
  });

  it("guards the guard — the date checks can actually fail", () => {
    // If these regexes stop matching the document's format, every check above
    // passes by finding nothing to complain about.
    const doc = landscapeDoc();
    expect(REVIEWED_ON.test(doc)).toBe(true);
    expect(NEXT_REVIEW.test(doc)).toBe(true);
    expect(NEXT_REVIEW.test("Next review due 2027-02-15")).toBe(true);
    expect(NEXT_REVIEW.test("Next review due sometime")).toBe(false);

    // And an overdue date must genuinely be in the past relative to `Date.now`.
    expect(parseUtcDate("2000-01-01").getTime()).toBeLessThan(Date.now());
  });
});
