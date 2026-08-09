/**
 * ONE crash analysis year window, for every crash lane.
 *
 * WHAT WENT WRONG. Two lanes read the same crash registry and asked it
 * different questions:
 *
 *   * the Explore corridor scorecard derived a rolling window from the clock
 *     (`src/lib/data-sources/crashes.ts`);
 *   * the Safety workspace posted a HARDCODED `[2025, 2024, 2023, 2022, 2021]`,
 *     which was already a year stale when it was written and silently changes
 *     meaning every January — the shape of rot the scorecard's own comment says
 *     the window exists to avoid ("a hardcoded year list … rots into 'no crashes
 *     found'").
 *
 * So the same place could have two crash histories, each surface internally
 * consistent and neither wrong about itself. `src/lib/safety/crash-years.ts` is
 * the single definition, and this file is the ratchet: it fails if the two
 * exported implementations ever disagree, and it fails if a hardcoded year list
 * comes back into a crash lane.
 *
 * THIS FILE ALSO RECORDS AN INCOMPLETE EXTRACTION. `data-sources/crashes.ts`
 * still defines its own copy rather than importing the shared one; that edit
 * lies outside the file ownership this change was made under and is reported to
 * the integrator. The equivalence assertion below is what keeps the duplicate
 * honest until it is deleted — and what will fail the moment somebody changes
 * one window without the other.
 */

import { readFileSync } from "node:fs";
import { stripSourceComments } from "./helpers/source-text";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CRASH_ANALYSIS_YEAR_WINDOW, recentCrashYears } from "@/lib/safety/crash-years";
import { recentCrashYears as scorecardCrashYears } from "@/lib/data-sources/crashes";

/** Dates chosen to cross a year boundary and a leap year, in UTC. */
const PROBE_DATES = [
  "2026-01-01T00:00:00Z",
  "2026-08-03T23:59:59Z",
  "2026-12-31T23:59:59Z",
  "2027-01-01T00:00:00Z",
  "2024-02-29T12:00:00Z",
  "2031-06-15T00:00:00Z",
];

describe("the crash analysis year window", () => {
  it("is a rolling window off the clock, not a fixed list", () => {
    expect(recentCrashYears(new Date("2026-07-23T00:00:00Z"))).toEqual([2025, 2024, 2023, 2022]);
    expect(recentCrashYears(new Date("2031-01-01T00:00:00Z"))).toEqual([2030, 2029, 2028, 2027]);
    expect(recentCrashYears(new Date("2026-01-01T00:00:00Z"))).toHaveLength(
      CRASH_ANALYSIS_YEAR_WINDOW
    );
  });

  it("is the SAME window in the Safety lane and the corridor scorecard", () => {
    // Two implementations that agree today are still two implementations; this
    // is what makes a divergence a build failure instead of a support ticket.
    for (const iso of PROBE_DATES) {
      const now = new Date(iso);
      expect(recentCrashYears(now), `windows diverged at ${iso}`).toEqual(scorecardCrashYears(now));
    }
  });

  it("excludes the current year, which is always incomplete", () => {
    const now = new Date("2026-08-03T00:00:00Z");
    expect(recentCrashYears(now)).not.toContain(2026);
    expect(recentCrashYears(now)[0]).toBe(2025);
  });

  it("keeps a hardcoded year list out of the Safety workspace", () => {
    // The literal that was there. A guard on the SHAPE rather than on the exact
    // years, so re-introducing next year's version is caught too.
    const source = readFileSync(
      path.join(process.cwd(), "src/components/safety/safety-workspace.tsx"),
      "utf8"
    );
    // Shared stripper: block-only plus whole-line `//` let a trailing comment
    // carrying a year list reach the matcher.
    const code = stripSourceComments(source);

    // Three or more consecutive four-digit years in an array literal.
    const HARDCODED_YEAR_LIST = /\[\s*(?:20\d{2}\s*,\s*){2,}20\d{2}\s*[,\]]/;
    expect(code).not.toMatch(HARDCODED_YEAR_LIST);
    expect(code).toContain("recentCrashYears(");
  });

  it("guards the guard — the pattern catches the literal that actually shipped", () => {
    const HARDCODED_YEAR_LIST = /\[\s*(?:20\d{2}\s*,\s*){2,}20\d{2}\s*[,\]]/;
    expect(HARDCODED_YEAR_LIST.test("const years = [2025, 2024, 2023, 2022, 2021];")).toBe(true);
    expect(HARDCODED_YEAR_LIST.test("const years = [2027, 2026, 2025];")).toBe(true);
    // A single year, or a pair, is a legitimate test probe or default.
    expect(HARDCODED_YEAR_LIST.test("years: [2025]")).toBe(false);
    expect(HARDCODED_YEAR_LIST.test("const years = recentCrashYears();")).toBe(false);
  });
});
