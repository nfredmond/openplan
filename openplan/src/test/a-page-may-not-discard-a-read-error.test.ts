import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A PAGE MAY NOT DISCARD A READ ERROR.
 *
 * `const { data } = await supabase.from(...)` hands back `null` for both "there
 * is nothing here" and "this query failed". A page that destructures only `data`
 * cannot tell the two apart, so every empty-state sentence it renders — written
 * for the first case — states the second one as fact.
 *
 * This is not hypothetical and it is not rare. Two shipped instances, both on
 * surfaces the PUBLIC reads:
 *
 *   - the public plan page rendered "No projects have been published for this
 *     plan yet", an agency publicly stating it had funded nothing, because a
 *     read failed;
 *   - the engagement portal rendered "No published feedback yet. Be the first to
 *     share something", telling residents nobody in their community had taken
 *     part, on the strength of a broken query.
 *
 * WHY A RATCHET RATHER THAN A CLEAN ASSERTION. There were 23 of these across 13
 * pages when this guard was written. Fixing them all in one change would have
 * been a large, unreviewable diff, and a plain assertion would have had to be
 * disabled until that landed — which is how a guard becomes decoration. So the
 * list below was a CEILING that could only fall.
 *
 * THE DEBT IS PAID (2026-08-03). All 13 pages were fixed in one coordinated run
 * and `KNOWN_DISCARDED` is now EMPTY, which turns the first assertion into the
 * plain rule its name always claimed: no page under `src/app` may destructure
 * only `data`. The list is kept — empty — rather than deleted, because it is the
 * mechanism that made the cleanup possible and the next large refactor may need
 * it again. It may never grow: a page that reacquires a discarded read is a
 * regression to fix, not a number to record.
 *
 * WHAT THIS PATTERN STILL CANNOT SEE, measured 2026-08-03 — do not read a green
 * run as "no page discards a read error":
 *
 *   - ARRAY DESTRUCTURING. `const [{ data: a }, { data: b }] = await
 *     Promise.all([...])` never matches, because the regex anchors on `const {`.
 *     13 such bindings remain: grants (6), reports (5), safety (2). Recounted
 *     2026-08-04 — an earlier draft of this header said 14 and named the
 *     dashboard as well, which was wrong: the dashboard destructures to NAMED
 *     results (`const [runsResult, …] = await Promise.all(…)`) and checks
 *     `homeGeographyResult.error`, which is the correct shape, not the defect.
 *     A number written into a comment is a claim like any other; this one was
 *     checked.
 *   - A CLASSIFIER USED AS THE ONLY ERROR BRANCH. `looksLikePendingSchema(
 *     x.error?.message) ? [] : (x.data ?? [])` keeps the error and then throws it
 *     away: it classifies exactly one failure (a pending migration) and turns
 *     every other one — revoked grant, RLS change, dropped connection — into
 *     `[]`, i.e. an answer. 17 remain (16 on the project detail page, 1 on the
 *     RTP registry). `read-failures.ts` is "classify FIRST, then collect what is
 *     left"; these classify and never collect.
 *
 * Widening the pattern to either shape is real, wanted work. It must be its own
 * change, because it re-opens a debt list this one just closed, and because
 * registering a lane without fixing its panel makes the disclosure banner itself
 * lie ("shown as unavailable rather than as zero").
 *
 * WHY PAGES AND NOT ROUTES. An API route that swallows an error returns wrong
 * data or a wrong status — bad, but a different defect with a different fix. A
 * PAGE turns it into a sentence a human reads and believes. There are 20 more of
 * these under `src/app/api`; they want their own guard, not this one.
 *
 * TO FIX A PAGE: keep the whole result, check the error, and disclose it —
 * `ReadFailureLog` in `src/lib/ui/read-failures.ts` exists for exactly this and
 * both public pages now use it. Then lower the number here.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");

/** `const { data } = await …` and `const { data: rows } = await …`. */
const DISCARDED_ERROR = /const\s*\{\s*data(?:\s*:\s*\w+)?\s*\}\s*=\s*await/g;

/**
 * The ceiling — now EMPTY, and it may only ever shrink.
 *
 * The 13 pages that used to be listed here (county-runs, engagement campaign,
 * invoicing, models, plans, programs, projects detail and list, reports detail,
 * both RTP cycle pages, scenarios detail, and the public plan page) all keep
 * their read results and disclose their failures. The public plan page's
 * share-token lookup — the last entry, which used to 404 on a failed read — now
 * renders a shell that says the read failed and explicitly denies the inference
 * that the plan is missing, unpublished, or withdrawn.
 */
const KNOWN_DISCARDED: ReadonlyArray<readonly [string, number]> = [];

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return entry === "page.tsx" || entry === "layout.tsx" ? [full] : [];
  });
}

function discardedCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of pageFiles(APP_DIR)) {
    const matches = readFileSync(file, "utf8").match(DISCARDED_ERROR);
    if (matches?.length) {
      counts.set(path.relative(process.cwd(), file).split(path.sep).join("/"), matches.length);
    }
  }
  return counts;
}

describe("a page may not discard a read error", () => {
  const known = new Map(KNOWN_DISCARDED.map(([file, count]) => [file, count]));

  it("adds no new page that renders a failed read as an answer", () => {
    const actual = discardedCounts();
    const added = [...actual.keys()].filter((file) => !known.has(file));

    expect(
      added,
      "these pages discard a Supabase read error — keep the result, check `error`, and disclose it with ReadFailureLog"
    ).toEqual([]);
  });

  it("lets no listed page get worse", () => {
    const actual = discardedCounts();
    const worsened = [...actual.entries()]
      .filter(([file, count]) => known.has(file) && count > (known.get(file) ?? 0))
      .map(([file, count]) => `${file}: ${known.get(file)} → ${count}`);

    expect(worsened, "these pages added another discarded read error").toEqual([]);
  });

  /**
   * The staleness half, and the reason the list can only shrink. Without it a
   * fixed page would sit here forever claiming a debt it no longer has, and the
   * next reader would trust a number that had quietly stopped being true.
   */
  it("keeps the ceiling honest — a fixed page must be removed from the list", () => {
    const actual = discardedCounts();
    const stale = KNOWN_DISCARDED.filter(([file, count]) => (actual.get(file) ?? 0) < count).map(
      ([file, count]) => `${file}: listed ${count}, actually ${actual.get(file) ?? 0} — lower or delete this entry`
    );

    expect(stale, "the ratchet moved; update the list").toEqual([]);
  });

  /**
   * The three assertions above all pass trivially if the scan finds nothing —
   * a broken pattern, a wrong directory, a rename. This is the floor.
   */
  it("guards the guard — the scan reaches real pages and the pattern still matches", () => {
    const files = pageFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.endsWith(path.join("(public)", "plan", "[shareToken]", "page.tsx")))).toBe(true);

    // The pattern must match the shape it names, in both spellings.
    expect(`const { data } = await supabase.from("x").select()`.match(DISCARDED_ERROR)).toHaveLength(1);
    expect(`const { data: rows } = await supabase.from("x").select()`.match(DISCARDED_ERROR)).toHaveLength(1);
    // And must NOT match a read that keeps its error.
    expect(`const { data, error } = await supabase.from("x").select()`.match(DISCARDED_ERROR)).toBeNull();
  });

  it("has fixed the public surfaces that shipped the defect", () => {
    const actual = discardedCounts();
    // The engagement portal page and its loader disclose read failures now; the
    // portal page must not reacquire one.
    expect(actual.get("src/app/(public)/engage/[shareToken]/page.tsx") ?? 0).toBe(0);
    expect(actual.get("src/app/(embed)/embed/[shareToken]/page.tsx") ?? 0).toBe(0);
    // The public plan page was the last entry on the ratchet. Named explicitly
    // so that emptying KNOWN_DISCARDED can never quietly un-guard it.
    expect(actual.get("src/app/(public)/plan/[shareToken]/page.tsx") ?? 0).toBe(0);
  });
});
