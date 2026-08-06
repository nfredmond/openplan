import { describe, expect, it } from "vitest";
import {
  GTFS_LIMITS,
  GTFS_MAX_ARCHIVE_BYTES,
  GTFS_MAX_STOP_SERVICE_PAIRS,
  GTFS_PARSE_BUDGET_MS,
  resolveGtfsLimit,
  resolveGtfsLimits,
} from "@/lib/gtfs/limits";
import {
  GTFS_ALWAYS_APPLICABLE_CAVEATS,
  GTFS_CAVEATS,
  GTFS_DANGLING_REFERENCE_CAVEAT,
  GTFS_FREQUENCIES_EXPANSION_CAVEAT,
  GTFS_FREQUENT_SERVICE_TIER_CAVEAT,
  GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT,
  GTFS_INTERPOLATED_STOP_TIME_CAVEAT,
  GTFS_NOT_A_TIMETABLE_CAVEAT,
  GTFS_PAST_MIDNIGHT_CAVEAT,
  selectGtfsCaveats,
} from "@/lib/gtfs/caveats";
import {
  BASIC_SERVICE_HEADWAY_MINUTES,
  FREQUENT_SERVICE_HEADWAY_MINUTES,
} from "@/lib/gtfs/service-levels";

/**
 * The two files that are pure policy: the numbers an operator may change, and
 * the sentences that must travel with a derived figure.
 *
 * Neither has behaviour to test, which is exactly why they are worth guarding
 * mechanically — a constant with no consumer and no assertion is a constant
 * that silently drifts, and these two files are where a wrong number and a
 * missing caveat would each be least visible.
 */

describe("every bound is operator-configurable, and nothing is a bare literal", () => {
  it("gives every limit a distinct, prefixed environment variable", () => {
    const names = GTFS_LIMITS.map((limit) => limit.env);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^OPENPLAN_GTFS_[A-Z0-9_]+$/);
  });

  it("gives every limit a positive default and a stated rationale", () => {
    for (const limit of GTFS_LIMITS) {
      expect(limit.defaultValue).toBeGreaterThan(0);
      expect(Number.isFinite(limit.defaultValue)).toBe(true);
      // The rationale is where the number came from. A bound nobody can justify
      // is a bound the next person will change to whatever is convenient.
      expect(limit.rationale.length).toBeGreaterThan(20);
    }
  });

  it("reads an operator override", () => {
    expect(resolveGtfsLimit(GTFS_MAX_ARCHIVE_BYTES, { OPENPLAN_GTFS_MAX_ARCHIVE_BYTES: "1024" })).toBe(1024);
    expect(resolveGtfsLimits({ OPENPLAN_GTFS_MAX_STOP_SERVICE_PAIRS: "5" }).maxStopServicePairs).toBe(5);
  });

  it("FALLS BACK TO THE DEFAULT on a typo, never to zero", () => {
    // A limit of 0 would refuse every feed on earth and read to a planner as
    // "GTFS is broken". Same posture as run-cap.ts.
    for (const value of ["", "   ", "abc", "0", "-5", "NaN"]) {
      expect(resolveGtfsLimit(GTFS_MAX_STOP_SERVICE_PAIRS, { OPENPLAN_GTFS_MAX_STOP_SERVICE_PAIRS: value })).toBe(
        GTFS_MAX_STOP_SERVICE_PAIRS.defaultValue,
      );
    }
  });

  it("resolves every declared limit into the resolved set", () => {
    // A limit declared and never resolved is a limit nothing enforces.
    const resolved = resolveGtfsLimits({});
    expect(Object.keys(resolved)).toHaveLength(GTFS_LIMITS.length + 1); // +1: parseBudgetMs
    for (const value of Object.values(resolved)) expect(value).toBeGreaterThan(0);
  });

  it("keeps the defaults large enough for the largest real US feed measured", () => {
    // King County Metro, measured 2026-08-05: 17,475,566-byte archive,
    // 2,167,134 stop_times rows, 35,904 stop/service pairs. A default that
    // refuses a real agency is a product that does not work there.
    const resolved = resolveGtfsLimits({});
    expect(resolved.maxArchiveBytes).toBeGreaterThan(17_475_566);
    expect(resolved.maxRowsPerTable).toBeGreaterThan(2_167_134);
    expect(resolved.maxStopServicePairs).toBeGreaterThan(35_904);
    expect(resolved.maxMemberUncompressedBytes).toBeGreaterThan(126_600_000);
  });

  it("bounds a parse in wall-clock time as well as in size", () => {
    expect(GTFS_PARSE_BUDGET_MS.defaultValue).toBeLessThanOrEqual(300_000);
  });
});

describe("the caveats that travel with a derived figure", () => {
  it("says plainly that this is not a timetable", () => {
    // The product decision the whole lane is shaped around: how often the bus
    // comes, never what time the 4:15 leaves.
    expect(GTFS_NOT_A_TIMETABLE_CAVEAT).toMatch(/not a timetable/i);
    expect(GTFS_NOT_A_TIMETABLE_CAVEAT).toMatch(/service day/i);
    expect(GTFS_NOT_A_TIMETABLE_CAVEAT).toMatch(/does not store individual departure times/i);
  });

  it("says the headway is an hourly average rather than a measured gap", () => {
    expect(GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT).toMatch(/hourly average/i);
    expect(GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT).toMatch(/not measured gaps/i);
    expect(GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT).toMatch(/screening/i);
  });

  it("names both frequent-service tiers and disclaims the statutory test", () => {
    expect(GTFS_FREQUENT_SERVICE_TIER_CAVEAT).toContain(String(FREQUENT_SERVICE_HEADWAY_MINUTES));
    expect(GTFS_FREQUENT_SERVICE_TIER_CAVEAT).toContain(String(BASIC_SERVICE_HEADWAY_MINUTES));
    // OpenPlan derives its peak from the data; the statute defines it. Saying
    // so is what keeps a screening tier from being read as a determination.
    expect(GTFS_FREQUENT_SERVICE_TIER_CAVEAT).toMatch(/NOT a determination under any statute/i);
  });

  it("keeps every caveat distinct and substantial", () => {
    const texts = Object.values(GTFS_CAVEATS);
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) expect(text.length).toBeGreaterThan(80);
  });

  it("always shows the four that apply to every figure", () => {
    const always = selectGtfsCaveats({
      usesFrequencies: false,
      stopTimesWithoutTime: 0,
      departuresBeyondBinRange: 0,
      danglingReferences: 0,
      showsFrequentServiceTier: false,
    });
    expect(always).toEqual([...GTFS_ALWAYS_APPLICABLE_CAVEATS]);
    expect(always).toContain(GTFS_NOT_A_TIMETABLE_CAVEAT);
    expect(always).toContain(GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT);
  });

  it("adds only the caveats the feed actually earns", () => {
    // Boilerplate is what trains a reader to skip the caveat that matters.
    const plain = selectGtfsCaveats({
      usesFrequencies: false,
      stopTimesWithoutTime: 0,
      departuresBeyondBinRange: 0,
      danglingReferences: 0,
      showsFrequentServiceTier: false,
    });
    expect(plain).not.toContain(GTFS_FREQUENCIES_EXPANSION_CAVEAT);
    expect(plain).not.toContain(GTFS_INTERPOLATED_STOP_TIME_CAVEAT);
    expect(plain).not.toContain(GTFS_PAST_MIDNIGHT_CAVEAT);
    expect(plain).not.toContain(GTFS_DANGLING_REFERENCE_CAVEAT);

    const everything = selectGtfsCaveats({
      usesFrequencies: true,
      stopTimesWithoutTime: 4,
      departuresBeyondBinRange: 1,
      danglingReferences: 9,
      showsFrequentServiceTier: true,
    });
    expect(everything).toContain(GTFS_FREQUENT_SERVICE_TIER_CAVEAT);
    expect(everything).toContain(GTFS_FREQUENCIES_EXPANSION_CAVEAT);
    expect(everything).toContain(GTFS_INTERPOLATED_STOP_TIME_CAVEAT);
    expect(everything).toContain(GTFS_PAST_MIDNIGHT_CAVEAT);
    expect(everything).toContain(GTFS_DANGLING_REFERENCE_CAVEAT);
    expect(new Set(everything).size).toBe(everything.length);
  });
});
