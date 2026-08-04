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
 * WHY A RATCHET RATHER THAN A CLEAN ASSERTION. There are 23 of these left across
 * 13 pages. Fixing them all in one change would be a large, unreviewable diff,
 * and a plain assertion would have to be disabled until that landed — which is
 * how a guard becomes decoration. So the list below is a CEILING that may only
 * fall. A new page with a discarded error fails immediately; a fixed page must
 * be removed from the list or the staleness check fails.
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
 * The ceiling. Each entry is a page that still discards at least one read error,
 * with how many it discards. This list may only SHRINK.
 *
 * Public surfaces are fixed and deliberately absent:
 * `(public)/engage/[shareToken]` and the engagement portal loader now disclose
 * their failures; `(public)/plan/[shareToken]` keeps one — the share-token
 * lookup, whose failure currently 404s rather than rendering a false absence.
 */
const KNOWN_DISCARDED: ReadonlyArray<readonly [string, number]> = [
  ["src/app/(app)/county-runs/[countyRunId]/page.tsx", 1],
  ["src/app/(app)/engagement/[campaignId]/page.tsx", 2],
  ["src/app/(app)/invoicing/page.tsx", 1],
  ["src/app/(app)/models/page.tsx", 1],
  ["src/app/(app)/plans/[planId]/page.tsx", 1],
  ["src/app/(app)/programs/[programId]/page.tsx", 1],
  ["src/app/(app)/projects/[projectId]/page.tsx", 5],
  ["src/app/(app)/projects/page.tsx", 1],
  ["src/app/(app)/reports/[reportId]/page.tsx", 1],
  ["src/app/(app)/rtp/[rtpCycleId]/document/page.tsx", 1],
  ["src/app/(app)/rtp/[rtpCycleId]/page.tsx", 1],
  ["src/app/(app)/scenarios/[scenarioSetId]/page.tsx", 4],
  ["src/app/(public)/plan/[shareToken]/page.tsx", 1],
];

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

  it("has fixed the two public surfaces that shipped the defect", () => {
    const actual = discardedCounts();
    // The engagement portal page and its loader disclose read failures now; the
    // portal page must not reacquire one.
    expect(actual.get("src/app/(public)/engage/[shareToken]/page.tsx") ?? 0).toBe(0);
    expect(actual.get("src/app/(embed)/embed/[shareToken]/page.tsx") ?? 0).toBe(0);
  });
});
