import { describe, expect, it } from "vitest";
import { deriveCcrsSeverity } from "@/lib/safety/sources/ccrs";
import { toCrashRows } from "@/lib/safety/ingest";
import { summarizeCrashFetch, describeCrashSafety } from "@/lib/data-sources/crashes";
import { ccrsAdapter } from "@/lib/safety/sources/ccrs";
import { deriveSeverityFromCounts, toCasualtyCount } from "@/lib/safety/vocabulary";
import type { CrashRecord } from "@/lib/safety/sources/types";

/**
 * THE DEFECT, AND WHY IT WAS INVISIBLE FOR A YEAR.
 *
 * The crash adapter read two casualty counts through a parser that returned 0
 * for anything it could not read, then clamped the result with `max(0, …)`. The
 * severity derivation saw "0 killed, 0 injured" and returned property-damage-
 * only, which is the correct answer for that input and the wrong answer for the
 * question. A collision the source reported WITHOUT any casualty count was
 * therefore stored, filtered, painted and counted as a crash where nobody was
 * hurt.
 *
 * Measured against the live source on 2026-08-11, `IsDeleted = 'False'`:
 *
 *     statewide 2025           401,301 crashes
 *       NumberKilled NULL       19,637
 *       NumberInjured NULL      18,970
 *       BOTH NULL               18,967   (4.7%)
 *     one rural county 2025      1,180 crashes
 *       BOTH NULL                  112   (9.5%)
 *
 * They are not secretly fatal: the person-level table returns no rows for them,
 * so the outcome is genuinely unrecorded. `NumberKilled` also carries '-1' in
 * the wild, which the clamp turned into 0 as well.
 *
 * Nothing could see it. The unit tests asserted `deriveCcrsSeverity(0, 0) ===
 * "pdo"`, which was true and is still true. The row fixtures all carried counts.
 * The severity CHECK constraint admitted the value it was being handed. The
 * failure only exists in the gap between "the source said zero" and "the source
 * said nothing", and no test had ever put a null in that gap.
 *
 * So this file's whole job is to put a null in that gap, at every layer it has
 * to survive: the parser, the derivation, the adapter's own function, the row
 * builder, and the corridor summary that a grant narrative quotes.
 */

function record(overrides: Partial<CrashRecord> = {}): CrashRecord {
  return {
    externalId: "case-1",
    collisionDate: "2025-01-12",
    collisionYear: 2025,
    severity: "injury",
    killedCount: 0,
    injuredCount: 1,
    pedestrianInvolved: false,
    bicyclistInvolved: false,
    motorcyclistInvolved: false,
    collisionType: "rear_end",
    lighting: "daylight",
    weather: "clear",
    sourceAttributes: {},
    latitude: 39.2,
    longitude: -121.0,
    ...overrides,
  };
}

describe("toCasualtyCount", () => {
  it("reads a real count, however the source types it", () => {
    // The killed column is TEXT in the DataStore while the injured column is
    // numeric, so both spellings have to work.
    expect(toCasualtyCount(3)).toBe(3);
    expect(toCasualtyCount("3")).toBe(3);
    expect(toCasualtyCount(0)).toBe(0);
    expect(toCasualtyCount("0")).toBe(0);
  });

  it("returns NULL — not 0 — for a count the source did not supply", () => {
    for (const value of [null, undefined, "", "   ", "unknown", Number.NaN, {}]) {
      expect(toCasualtyCount(value), `${JSON.stringify(value)} must not read as zero`).toBeNull();
    }
  });

  it("returns NULL for a negative count instead of clamping it to zero", () => {
    // Observed in the wild: '-1' appears in the killed column. A clamp turns a
    // data error into the assertion that nobody died.
    expect(toCasualtyCount(-1)).toBeNull();
    expect(toCasualtyCount("-1")).toBeNull();
  });
});

describe("deriveSeverityFromCounts", () => {
  it("still classifies every crash whose counts were readable", () => {
    expect(deriveSeverityFromCounts(1, 0)).toBe("fatal");
    expect(deriveSeverityFromCounts(2, 5)).toBe("fatal");
    expect(deriveSeverityFromCounts(0, 1)).toBe("injury");
    expect(deriveSeverityFromCounts(0, 0)).toBe("pdo");
  });

  it("returns `unknown` when a count is missing and nothing positive was reported", () => {
    // THE CASE THAT USED TO BE STORED AS PROPERTY DAMAGE ONLY.
    expect(deriveSeverityFromCounts(null, null)).toBe("unknown");
    expect(deriveSeverityFromCounts(0, null)).toBe("unknown");
    expect(deriveSeverityFromCounts(null, 0)).toBe("unknown");
  });

  it("keeps a POSITIVE observation even when its partner column is missing", () => {
    // A collision reporting three deaths is fatal whether or not the injured
    // column was filled in. Blanket-unknown here would throw away a report the
    // source did make — which is the same class of error in the other direction.
    expect(deriveSeverityFromCounts(3, null)).toBe("fatal");
    expect(deriveSeverityFromCounts(null, 2)).toBe("injury");
  });

  it("never invents a serious-injury band from two crash-level counts", () => {
    // `severe_injury` is a person-level determination. A function that could
    // reach it from these two numbers would be inventing it.
    const reached = new Set(
      [
        [null, null],
        [0, 0],
        [0, 9],
        [1, 0],
        [4, 12],
        [null, 3],
      ].map(([k, i]) => deriveSeverityFromCounts(k, i))
    );
    expect(reached.has("severe_injury")).toBe(false);
  });
});

describe("the adapter's own derivation reads raw values", () => {
  it("classifies an unsupplied count as unknown rather than property damage", () => {
    // The signature change is the fix. Taking numbers meant the caller had
    // already destroyed the distinction before this function was reached.
    expect(deriveCcrsSeverity(null, null)).toBe("unknown");
    expect(deriveCcrsSeverity("", "")).toBe("unknown");
    expect(deriveCcrsSeverity("-1", null)).toBe("unknown");
    // …while every previously-correct answer is unchanged.
    expect(deriveCcrsSeverity("1", 0)).toBe("fatal");
    expect(deriveCcrsSeverity("0", 2)).toBe("injury");
    expect(deriveCcrsSeverity("0", 0)).toBe("pdo");
  });
});

describe("the unsupplied count survives all the way to the column", () => {
  it("writes NULL, not 0, into killed_count and injured_count", () => {
    const rows = toCrashRows(
      [record({ severity: "unknown", killedCount: null, injuredCount: null })],
      { workspaceId: "ws-1", ingestId: "ingest-1", sourceId: "ccrs-ca" }
    );
    expect(rows[0].killed_count).toBeNull();
    expect(rows[0].injured_count).toBeNull();
    expect(rows[0].severity).toBe("unknown");
  });
});

describe("the corridor summary accounts for what it could not classify", () => {
  const bbox = { minLon: -121.3, minLat: 39.1, maxLon: -120.0, maxLat: 39.6 };

  function summarize(records: CrashRecord[]) {
    return summarizeCrashFetch(
      ccrsAdapter,
      { records, matchedTotal: records.length, geocodedTotal: records.length, yearsCovered: [2025], truncated: false },
      bbox,
      [2025]
    );
  }

  it("counts unclassified crashes rather than dropping them out of every tally", () => {
    // If they were silently skipped, the severity counts would fail to add up to
    // the reported total and a reader would fill the gap in with "property
    // damage" — which is precisely the wrong conclusion.
    const summary = summarize([
      record({ externalId: "a", severity: "fatal", killedCount: 1, injuredCount: 0 }),
      record({ externalId: "b", severity: "unknown", killedCount: null, injuredCount: null }),
      record({ externalId: "c", severity: "unknown", killedCount: null, injuredCount: null }),
    ]);

    expect(summary.unclassifiedCrashes).toBe(2);
    expect(summary.totalFatalCrashes).toBe(1);
    expect(summary.reportedTotal).toBe(3);
    expect(summary.totalFatalCrashes + (summary.totalInjuryCrashes ?? 0) + summary.unclassifiedCrashes).toBe(3);
  });

  it("keeps an unclassified crash off the severity-painted map layer", () => {
    // The layer paints a severity. A collision with none to paint would have to
    // be given one of the three colours, which asserts an outcome nobody
    // reported.
    const summary = summarize([
      record({ externalId: "a", severity: "fatal", killedCount: 1, injuredCount: 0 }),
      record({ externalId: "b", severity: "unknown", killedCount: null, injuredCount: null }),
    ]);
    expect(summary.points).toHaveLength(1);
    expect(summary.points[0].properties.severityBucket).toBe("fatal");
  });

  it("says the number out loud in the narrative a grant application quotes", () => {
    const summary = summarize([
      record({ externalId: "a", severity: "fatal", killedCount: 1, injuredCount: 0 }),
      record({ externalId: "b", severity: "unknown", killedCount: null, injuredCount: null }),
    ]);
    const line = describeCrashSafety(summary);
    expect(line).toContain("1 mapped crashes carry no casualty count");
    expect(line).toContain("not classified by severity");
  });

  it("says nothing about unclassified crashes when there are none", () => {
    // A disclosure that fires unconditionally is noise, and noise gets skimmed
    // past on the run where it matters.
    const line = describeCrashSafety(
      summarize([record({ externalId: "a", severity: "fatal", killedCount: 1, injuredCount: 0 })])
    );
    expect(line).not.toContain("not classified by severity");
  });
});
