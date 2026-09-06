import { describe, expect, it } from "vitest";

import {
  boxLiesWithin,
  describeCrashLayerCoverage,
  summarizeAcquiredAreas,
  summarizeCrashAcquisitions,
  type CrashLayerCoverageInput,
} from "@/lib/cartographic/crash-layer-coverage";
import { MAP_FEATURE_LAYER_LIMIT } from "@/lib/cartographic/layer-disclosure";

/**
 * An empty crash layer has four different meanings and only one of them is a
 * finding about the roads. These tests pin the sentence for each, because the
 * defect they prevent is silent: a map with no red dots is indistinguishable
 * from a map whose data source does not cover the viewer's state, and a planner
 * reading it will conclude the corridor is safe.
 *
 * A NON-empty crash layer has its own version of the same defect, which is the
 * second thing these tests pin. The drawn crashes are scoped to the WORKSPACE
 * and were acquired for caller-supplied boxes; the home geography is optional
 * and unrelated. A note describing the home geography while the dots describe
 * somewhere else is a disclosure the map refutes, and a refuted disclosure
 * teaches a planner to ignore the ones that are right.
 */

function input(overrides: Partial<CrashLayerCoverageInput> = {}): CrashLayerCoverageInput {
  return {
    scopeState: "covered",
    scopeLabel: "Franklin County, OH",
    checkedSourceLabels: [],
    acquisitionState: "acquired",
    acquiredAreas: { areaCount: 1, outsideHomeCount: 0, uncomparableCount: 0 },
    anyUngeocoded: false,
    anySeverityIncomplete: false,
    unclassifiedCount: 0,
    returnedCount: 12,
    matchedCount: 12,
    droppedCount: 0,
    limit: MAP_FEATURE_LAYER_LIMIT,
    ...overrides,
  };
}

describe("describeCrashLayerCoverage", () => {
  /**
   * Even the entirely healthy layer says what it is. "Twelve dots" invites the
   * reading "twelve crashes in my county"; the acquisitions asked about some
   * boxes and some years, and everywhere else on the map is blank for want of a
   * request rather than for want of a crash.
   */
  it("bounds a healthy layer to the areas and years its acquisitions asked for", () => {
    const notes = describeCrashLayerCoverage(input());

    expect(notes[0]).toContain("draws only what this workspace has acquired");
    expect(notes[0]).toContain("12 stored collisions");
    expect(notes[0]).toContain("areas and years its completed acquisitions asked for");
    expect(notes[0]).toContain("not because no crashes occurred there");
    // Nothing is wrong beyond that, so nothing else is claimed.
    expect(notes).toHaveLength(1);
  });

  it("names the sources it checked when no storable source covers the stated area", () => {
    const notes = describeCrashLayerCoverage(
      input({
        scopeState: "out_of_coverage",
        checkedSourceLabels: ["California Crash Reporting System (CCRS)"],
        acquisitionState: "none",
        returnedCount: 0,
        matchedCount: 0,
      })
    );

    const gap = notes[0];
    expect(gap).toContain("Franklin County, OH");
    expect(gap).toContain("California Crash Reporting System (CCRS)");
    // The load-bearing half: an uncovered area is never a finding about crashes.
    expect(gap).toContain("This is not evidence that no crashes occurred.");
  });

  /**
   * A remedy the product knows cannot succeed is worse than no remedy. Where no
   * storable source covers the area, "run a crash acquisition" would send a
   * planner to a workbench that can only fail, so the gap note stands alone.
   */
  it("does not tell an uncovered workspace to run an acquisition that cannot succeed", () => {
    const notes = describeCrashLayerCoverage(
      input({
        scopeState: "out_of_coverage",
        checkedSourceLabels: ["California Crash Reporting System (CCRS)"],
        acquisitionState: "none",
        returnedCount: 0,
        matchedCount: 0,
      })
    );

    expect(notes).toHaveLength(1);
    expect(notes.some((note) => note.includes("Run a crash acquisition"))).toBe(false);
  });

  it("does not repeat the coverage sentence when the acquisitions found the same gap", () => {
    const notes = describeCrashLayerCoverage(
      input({
        scopeState: "out_of_coverage",
        checkedSourceLabels: ["California Crash Reporting System (CCRS)"],
        acquisitionState: "out_of_coverage",
        returnedCount: 0,
        matchedCount: 0,
      })
    );

    expect(notes).toHaveLength(1);
  });

  it("refuses to claim coverage either way when the workspace has stated no geography", () => {
    const notes = describeCrashLayerCoverage(
      input({
        scopeState: "coverage_unknown",
        scopeLabel: null,
        acquisitionState: "none",
        returnedCount: 0,
        matchedCount: 0,
      })
    );

    expect(notes[0]).toContain("cannot say whether a crash source covers your area");
    expect(notes[0]).toContain("not a finding that no crashes occurred");
    // And it points at where the answer actually gets set.
    expect(notes[0]).toContain("Workspace geography panel");
  });

  /**
   * The reachable contradiction, and the common one: a home geography is
   * optional, so most workspaces have none — and a workspace with no stated
   * area can still have acquired crashes, because an acquisition takes its own
   * bbox. The unconditional version of the note above told that planner an
   * empty layer was not a finding and to go set an area, with crashes drawn in
   * front of them.
   */
  it("does not call the layer empty when no geography is stated but crashes are drawn", () => {
    const notes = describeCrashLayerCoverage(
      input({ scopeState: "coverage_unknown", scopeLabel: null, returnedCount: 30, matchedCount: 30 })
    );

    // What is on screen is stated first, and stated as acquired.
    expect(notes[0]).toContain("30 stored collisions");
    // The sentences that would contradict the dots are gone.
    expect(notes.some((note) => note.includes("An empty crash layer here"))).toBe(false);
    expect(notes.some((note) => note.includes("not a finding that no crashes occurred"))).toBe(false);
    // The genuine unknown is still stated — scoped to the ground nothing asked about.
    const gap = notes.find((note) => note.includes("has not stated a home geography"));
    expect(gap).toContain("beyond what its acquisitions already requested");
    expect(gap).toContain("Workspace geography panel");
  });

  /**
   * The other direction: a workspace states an area no storable source covers,
   * yet has crashes from an acquisition elsewhere — a consultant working across
   * state lines, or an area changed after the fact. The gap is real and must
   * still be said; what it must not do is read as "there are no crashes",
   * because the map is showing some.
   */
  it("scopes an uncovered stated area to itself rather than to the crashes on screen", () => {
    const notes = describeCrashLayerCoverage(
      input({
        scopeState: "out_of_coverage",
        checkedSourceLabels: ["California Crash Reporting System (CCRS)"],
        returnedCount: 40,
        matchedCount: 40,
        acquiredAreas: { areaCount: 2, outsideHomeCount: 2, uncomparableCount: 0 },
      })
    );

    expect(notes[0]).toContain("40 stored collisions");
    const gap = notes.find((note) => note.includes("Franklin County, OH"));
    // The gap is about acquiring MORE, not about what is already drawn.
    expect(gap).toContain("nothing further can be acquired for the stated area");
    // It still refuses to be read as absence...
    expect(gap).toContain("not evidence that no crashes occurred there");
    // ...but drops the shared sentence whose "no crashes could be retrieved"
    // clause the drawn dots would flatly contradict.
    expect(notes.some((note) => note.includes("no crashes could be retrieved"))).toBe(false);
    // And the dots are explained rather than contradicted.
    expect(
      notes.some((note) => note.includes("what is drawn is not bounded by the workspace's stated area"))
    ).toBe(true);
  });

  it("says how many acquisitions reached outside the stated area", () => {
    const notes = describeCrashLayerCoverage(
      input({ acquiredAreas: { areaCount: 3, outsideHomeCount: 1, uncomparableCount: 0 } })
    );

    const outside = notes.find((note) => note.includes("reaching outside"));
    expect(outside).toContain("1 of the 3 completed acquisitions on record here");
    expect(outside).toContain("Franklin County, OH");
  });

  /**
   * The counts are a ratio of what this response could READ, never a total —
   * the acquisition history is fetched under a cap, so a bare total would be a
   * floor presented as the workspace's whole history.
   */
  it("counts acquisitions only against the ones it could read", () => {
    const notes = describeCrashLayerCoverage(
      input({ acquiredAreas: { areaCount: 6, outsideHomeCount: 2, uncomparableCount: 0 } })
    );

    expect(notes.some((note) => note.includes("2 of the 6 completed acquisitions on record here"))).toBe(
      true
    );
  });

  it("stays silent about containment when every acquisition sits inside the stated area", () => {
    const notes = describeCrashLayerCoverage(
      input({ acquiredAreas: { areaCount: 4, outsideHomeCount: 0, uncomparableCount: 0 } })
    );

    expect(notes.some((note) => note.includes("reaching outside"))).toBe(false);
  });

  /**
   * An extent that cannot be read is reported as unread. Guessing "inside"
   * would hide a real overreach and guessing "outside" would invent one, and
   * both are confident answers to a question the row does not answer.
   */
  it("reports an unusable acquisition extent as uncompared rather than picking a side", () => {
    const notes = describeCrashLayerCoverage(
      input({ acquiredAreas: { areaCount: 2, outsideHomeCount: 0, uncomparableCount: 1 } })
    );

    const unknown = notes.find((note) => note.includes("unusable area"));
    expect(unknown).toContain("1 of the 2 completed acquisitions on record here");
    expect(unknown).toContain("is unknown");
    expect(notes.some((note) => note.includes("reaching outside"))).toBe(false);
  });

  it("distinguishes never-acquired from acquired-and-empty", () => {
    const neverRun = describeCrashLayerCoverage(
      input({ acquisitionState: "none", returnedCount: 0, matchedCount: 0 })
    );
    expect(neverRun.some((note) => note.includes("none have been acquired yet"))).toBe(true);
    expect(neverRun.some((note) => note.includes("Safety workbench"))).toBe(true);

    const ranAndFoundNothing = describeCrashLayerCoverage(
      input({ acquisitionState: "acquired", returnedCount: 0, matchedCount: 0 })
    );
    expect(
      ranAndFoundNothing.some((note) => note.includes("stored no mappable collisions"))
    ).toBe(true);
    // Even the one case where zero IS a finding bounds what it is a finding about.
    expect(
      ranAndFoundNothing.some((note) => note.includes("not all time"))
    ).toBe(true);
  });

  it("reports an unreachable source as an outage rather than as zero crashes", () => {
    const notes = describeCrashLayerCoverage(
      input({ acquisitionState: "unavailable", returnedCount: 0, matchedCount: 0 })
    );

    expect(notes[0]).toContain("could not be reached");
    expect(notes[0]).toContain("This is not evidence that no crashes occurred.");
  });

  it("says an acquisition is still running rather than telling the planner to start one", () => {
    const notes = describeCrashLayerCoverage(
      input({ acquisitionState: "in_flight", returnedCount: 0, matchedCount: 0 })
    );

    expect(notes[0]).toContain("still running");
    expect(notes.some((note) => note.includes("Run a crash acquisition"))).toBe(false);
  });

  it("discloses truncation, names which subset was drawn, and points at the full record", () => {
    const notes = describeCrashLayerCoverage(
      input({ returnedCount: 500, matchedCount: 48213, limit: 500 })
    );

    const truncation = notes.find((note) => note.includes("showing 500 of 48,213"));
    expect(truncation).toBeDefined();
    // "The most recent 500" is a subset a planner can reason about; "the first
    // 500" of an arbitrary order is not.
    expect(truncation).toContain("most recent by collision date");
    expect(truncation).toContain("not a finding that they do not exist");
    expect(truncation).toContain("Safety workbench queries the full record");
  });

  it("counts undrawable rows as missing from the map, not absent from the record", () => {
    const notes = describeCrashLayerCoverage(input({ returnedCount: 11, droppedCount: 1 }));

    const dropped = notes.find((note) => note.includes("could not be drawn"));
    expect(dropped).toContain("1 acquired collision");
    expect(dropped).toContain("missing from the map rather than absent from the record");
  });

  it("carries the Safety module's own geocoding caveat rather than a second wording of it", () => {
    const notes = describeCrashLayerCoverage(input({ anyUngeocoded: true }));

    expect(
      notes.some((note) => note.includes("Reported crashes that the source agency did not geolocate"))
    ).toBe(true);
  });

  /**
   * The KSI firewall. A source that cannot separate suspected serious injuries
   * must not let a viewer read "no orange dots" as "no serious injuries", so the
   * completeness caveat travels with the drawn points.
   */
  it("states that serious injuries are not separable when a contributing source cannot separate them", () => {
    const notes = describeCrashLayerCoverage(input({ anySeverityIncomplete: true }));

    expect(notes.some((note) => note.includes("fatal-or-serious-injury crash count"))).toBe(true);
  });

  it("omits the severity caveat when nothing is drawn for it to explain", () => {
    const notes = describeCrashLayerCoverage(
      input({ anySeverityIncomplete: true, returnedCount: 0, matchedCount: 0 })
    );

    expect(notes.some((note) => note.includes("fatal-or-serious-injury crash count"))).toBe(false);
  });

  it("stops at one sentence when there is no workspace to scope anything to", () => {
    const notes = describeCrashLayerCoverage(
      input({
        scopeState: "no_workspace",
        acquisitionState: "none",
        returnedCount: 0,
        matchedCount: 0,
      })
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("no workspace is active");
  });
});

describe("summarizeCrashAcquisitions", () => {
  it("reports nothing acquired when no acquisition row exists", () => {
    expect(summarizeCrashAcquisitions([], { storedCrashCount: 0 })).toBe("none");
  });

  it("reports acquired when any acquisition completed", () => {
    expect(
      summarizeCrashAcquisitions(
        [
          { status: "failed", coverageState: "source_unavailable" },
          { status: "ready", coverageState: "ccrs_ca_statewide" },
        ],
        { storedCrashCount: 0 }
      )
    ).toBe("acquired");
  });

  /**
   * The acquisition history is read under a cap. Crash rows exist only because
   * some acquisition stored them, so a non-zero count proves a completed run
   * even when the row that did it fell outside the read — without this, a
   * workspace would be told its source was unreachable while its own crashes
   * were on screen.
   */
  it("trusts stored crashes over a bounded acquisition read", () => {
    expect(
      summarizeCrashAcquisitions([{ status: "failed", coverageState: "source_unavailable" }], {
        storedCrashCount: 4210,
      })
    ).toBe("acquired");
  });

  it("prefers a reachability failure over a coverage gap, because it is the actionable one", () => {
    expect(
      summarizeCrashAcquisitions(
        [
          { status: "no_coverage", coverageState: "out_of_coverage" },
          { status: "failed", coverageState: "source_unavailable" },
        ],
        { storedCrashCount: 0 }
      )
    ).toBe("unavailable");
  });

  it("reports a coverage gap when every completed acquisition found no covering source", () => {
    expect(
      summarizeCrashAcquisitions([{ status: "no_coverage", coverageState: "out_of_coverage" }], {
        storedCrashCount: 0,
      })
    ).toBe("out_of_coverage");
  });

  it("reports work in flight for a queued or running acquisition", () => {
    expect(
      summarizeCrashAcquisitions(
        [
          { status: "pending", coverageState: "ccrs_ca_statewide" },
          { status: "fetching", coverageState: "ccrs_ca_statewide" },
        ],
        { storedCrashCount: 0 }
      )
    ).toBe("in_flight");
  });
});

/**
 * The boxes are fixtures, not product constants: one stands in for "a stated
 * area" and the others for "an acquisition asked about a box", which is all
 * either side of the comparison ever is.
 */
const STATED_AREA = { minLon: -121.3, minLat: 39.0, maxLon: -120.4, maxLat: 39.5 };

describe("boxLiesWithin", () => {
  it("accepts a box strictly inside another", () => {
    expect(
      boxLiesWithin({ minLon: -121.0, minLat: 39.1, maxLon: -120.8, maxLat: 39.3 }, STATED_AREA)
    ).toBe(true);
  });

  it("accepts a box equal to the one containing it", () => {
    expect(boxLiesWithin({ ...STATED_AREA }, STATED_AREA)).toBe(true);
  });

  it("rejects a box that spills over an edge", () => {
    expect(
      boxLiesWithin({ minLon: -121.4, minLat: 39.1, maxLon: -120.8, maxLat: 39.3 }, STATED_AREA)
    ).toBe(false);
  });

  /**
   * A box whose west edge exceeds its east edge crosses the antimeridian and is
   * well-formed — the Aleutians, Fiji and Chukotka all produce one, which is why
   * neither the migration nor `homeGeographyBbox` constrains longitude ordering.
   * Comparing the raw numbers would read it as a 350-degree span and report a
   * contained box as an overreach.
   */
  it("compares across the antimeridian instead of reading the wrap as a global span", () => {
    const crossing = { minLon: 179.0, minLat: 51.0, maxLon: -179.0, maxLat: 52.0 };

    expect(boxLiesWithin({ minLon: 179.5, minLat: 51.2, maxLon: -179.5, maxLat: 51.8 }, crossing)).toBe(
      true
    );
    expect(boxLiesWithin({ minLon: 178.0, minLat: 51.2, maxLon: 179.5, maxLat: 51.8 }, crossing)).toBe(
      false
    );
  });

  it("refuses to answer when either box is unusable", () => {
    // Inverted latitude has no wrap to justify it, so it is corrupt rather than
    // clever, and the answer is "unknown" rather than a guessed side.
    expect(boxLiesWithin({ minLon: -121.0, minLat: 39.4, maxLon: -120.8, maxLat: 39.1 }, STATED_AREA)).toBe(
      null
    );
    expect(boxLiesWithin(null, STATED_AREA)).toBe(null);
    expect(boxLiesWithin({ minLon: -121.0, minLat: 39.1, maxLon: -120.8, maxLat: 39.3 }, null)).toBe(null);
  });
});

describe("summarizeAcquiredAreas", () => {
  it("counts the acquisitions that asked about ground outside the stated area", () => {
    expect(
      summarizeAcquiredAreas(
        [
          { minLon: -121.0, minLat: 39.1, maxLon: -120.8, maxLat: 39.3 },
          { minLon: -124.0, minLat: 37.0, maxLon: -120.0, maxLat: 40.0 },
        ],
        STATED_AREA
      )
    ).toEqual({ areaCount: 2, outsideHomeCount: 1, uncomparableCount: 0 });
  });

  it("counts an unreadable extent as uncompared rather than as outside", () => {
    expect(
      summarizeAcquiredAreas([null, { minLon: -121.0, minLat: 39.1, maxLon: -120.8, maxLat: 39.3 }], STATED_AREA)
    ).toEqual({ areaCount: 2, outsideHomeCount: 0, uncomparableCount: 1 });
  });

  /**
   * With no stated area there is nothing to compare against, and reporting
   * "0 outside" would present an unmade comparison as a passed one.
   * `scopeState: "coverage_unknown"` is what carries the absence instead.
   */
  it("makes no comparison at all when the workspace has stated no area", () => {
    expect(
      summarizeAcquiredAreas([{ minLon: 100, minLat: -40, maxLon: 101, maxLat: -39 }], null)
    ).toEqual({ areaCount: 1, outsideHomeCount: 0, uncomparableCount: 0 });
  });

  it("reports no areas when no acquisition has completed", () => {
    expect(summarizeAcquiredAreas([], STATED_AREA)).toEqual({
      areaCount: 0,
      outsideHomeCount: 0,
      uncomparableCount: 0,
    });
  });
});

/**
 * THE FIFTH LEGEND ENTRY IS NOT A SEVERITY RUNG.
 *
 * `unknown` is the band for a collision the source reported with no casualty
 * count at all — 4.7% of one state's 2025 records, 9.5% in one rural county of
 * it. Those points are painted, and the legend has four rungs plus this one, so
 * a reader with no sentence to go on takes the fifth grey for the mildest rung.
 * These records were literally stored as property-damage-only until the band
 * existed; the disclosure is what stops that mistake being made again by eye.
 */
describe("collisions the source never classified", () => {
  it("says how many of the drawn points carry no casualty count", () => {
    const notes = describeCrashLayerCoverage(input({ unclassifiedCount: 7 }));
    const note = notes.find((entry) => entry.includes("no casualty count"));
    expect(note).toBeDefined();
    expect(note).toContain("7 of the collisions drawn here");
    expect(note).toMatch(/in no severity band/i);
  });

  it("reads correctly for a single collision", () => {
    const note = describeCrashLayerCoverage(input({ unclassifiedCount: 1 })).find((entry) =>
      entry.includes("no casualty count")
    );
    expect(note).toContain("1 of the collision drawn here carries");
  });

  it("says nothing when every drawn collision was classified", () => {
    // A disclosure that fires unconditionally is one a reader learns to skip.
    const notes = describeCrashLayerCoverage(input({ unclassifiedCount: 0 }));
    expect(notes.some((entry) => entry.includes("no casualty count"))).toBe(false);
  });
});
