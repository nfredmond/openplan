import { describe, expect, it } from "vitest";

import {
  LINK_VALIDATION_NOT_SUPPORTED_CAVEAT,
  diagnoseZoneResolution,
} from "@/lib/models/zone-resolution";

/**
 * THE DIAGNOSTIC THAT EXPLAINS A FAILED VALIDATION INSTEAD OF LEAVING A PLANNER
 * TO CONCLUDE THE MODEL IS WRONG.
 *
 * A trip that begins and ends in the same zone never touches a link — at this
 * resolution there are no streets inside a zone, only a centroid and a
 * connector. It counts toward VMT and mode share and toward no link volume at
 * all. That is what zones ARE; it becomes a problem only when somebody compares
 * modelled volumes to traffic counts and reads the gap as failed demand.
 *
 * OpenPlan's own county validation hit exactly that: 26 zones, 36% intrazonal,
 * link-level AADT comparison failed — and the demand was not the reason. The
 * product said nothing, so the only available conclusion was that the model was
 * broken.
 *
 * The bands are OPENPLAN'S OWN SCREENING HEURISTIC and every verdict says so.
 * What they assert is not that a model is wrong — it is what a particular
 * comparison can and cannot establish, which is a claim about method.
 */

function trips(pairs: Array<[string, string]>) {
  return pairs.map(([origin_taz, dest_taz]) => ({ origin_taz, dest_taz }));
}

/** `count` trips, `intrazonal` of them beginning and ending in one zone. */
function tripsWithIntrazonal(count: number, intrazonal: number) {
  return trips(
    Array.from({ length: count }, (_, index) =>
      index < intrazonal ? ["z1", "z1"] : ["z1", "z2"]
    ) as Array<[string, string]>
  );
}

describe("it counts the travel that never reaches a link", () => {
  it("counts a trip as intrazonal only when both ends are the same zone", () => {
    const diagnostic = diagnoseZoneResolution(
      trips([
        ["z1", "z1"],
        ["z1", "z2"],
        ["z2", "z2"],
        ["z2", "z1"],
      ]),
      2
    );

    expect(diagnostic.tripCount).toBe(4);
    expect(diagnostic.intrazonalTripCount).toBe(2);
    expect(diagnostic.intrazonalSharePct).toBe(50);
  });

  it("takes the zone count it was GIVEN, not the zones the trips happen to touch", () => {
    // A zone with no trips in it is still a zone and still coarsens nothing.
    // Deriving the count from the trip table would report a smaller, more
    // flattering system than the one the model was actually run on.
    const diagnostic = diagnoseZoneResolution(trips([["z1", "z2"]]), 40);
    expect(diagnostic.zoneCount).toBe(40);
  });
});

describe("what the comparison can establish", () => {
  it("supports link-level validation when almost everything reaches the network", () => {
    const diagnostic = diagnoseZoneResolution(tripsWithIntrazonal(100, 5), 300);

    expect(diagnostic.intrazonalSharePct).toBe(5);
    expect(diagnostic.band).toBe("fine");
    expect(diagnostic.supportsLinkLevelValidation).toBe(true);
    expect(diagnostic.summary).toMatch(/meaningful test/i);
  });

  it("still supports it in the workable band, but says what to expect first", () => {
    const diagnostic = diagnoseZoneResolution(tripsWithIntrazonal(100, 15), 120);

    expect(diagnostic.band).toBe("workable");
    expect(diagnostic.supportsLinkLevelValidation).toBe(true);
    // The useful half: a planner should not go hunting for a demand explanation
    // for a gap the zone system already accounts for.
    expect(diagnostic.summary).toMatch(/below observed counts by roughly that share/i);
  });

  it("REFUSES link-level validation once a quarter of travel is invisible", () => {
    const diagnostic = diagnoseZoneResolution(tripsWithIntrazonal(100, 25), 40);

    expect(diagnostic.band).toBe("coarse");
    expect(diagnostic.supportsLinkLevelValidation).toBe(false);
    // It must say what to use INSTEAD. A refusal with no alternative reads as
    // "your run is useless", and the run is not useless — trip totals, mode
    // share and VMT all count intrazonal travel perfectly well.
    expect(diagnostic.summary).toMatch(/trip totals, mode share and VMT/i);
    expect(diagnostic.summary).toMatch(/split the zone system finer/i);
  });

  it("names the measured precedent at the resolution that actually failed", () => {
    // The case from OpenPlan's own validation: 26 zones, 36% intrazonal.
    const diagnostic = diagnoseZoneResolution(tripsWithIntrazonal(1000, 360), 26);

    expect(diagnostic.intrazonalSharePct).toBe(36);
    expect(diagnostic.band).toBe("very_coarse");
    expect(diagnostic.supportsLinkLevelValidation).toBe(false);
    expect(diagnostic.summary).toMatch(/26 zones and 36%/);
    // And it must not say the model is wrong — that is the conclusion this
    // whole diagnostic exists to stop somebody drawing.
    expect(diagnostic.summary).not.toMatch(/\bmodel is (wrong|broken|invalid)\b/i);
  });

  it("puts the boundaries where the bands say they are", () => {
    // Exactly ON a boundary belongs to the gentler band — a run at 10.0% is
    // fine, and only 10.1% moves it. Pinned because an off-by-one here silently
    // reclassifies every run sitting on a round number.
    expect(diagnoseZoneResolution(tripsWithIntrazonal(1000, 100), 50).band).toBe("fine");
    expect(diagnoseZoneResolution(tripsWithIntrazonal(1000, 101), 50).band).toBe("workable");
    expect(diagnoseZoneResolution(tripsWithIntrazonal(1000, 200), 50).band).toBe("workable");
    expect(diagnoseZoneResolution(tripsWithIntrazonal(1000, 201), 50).band).toBe("coarse");
    expect(diagnoseZoneResolution(tripsWithIntrazonal(1000, 300), 50).band).toBe("coarse");
    expect(diagnoseZoneResolution(tripsWithIntrazonal(1000, 301), 50).band).toBe("very_coarse");
  });
});

describe("no trips is not a good score", () => {
  it("reports nothing measurable rather than a fine-grained zone system", () => {
    // The failure mode this guards: `0 / 0` treated as 0% intrazonal would put a
    // run that produced NO TRAVEL AT ALL in the best band, and tell a planner
    // that link-level comparison against it is meaningful.
    const diagnostic = diagnoseZoneResolution([], 26);

    expect(diagnostic.intrazonalSharePct).toBeNull();
    expect(diagnostic.band).toBeNull();
    expect(diagnostic.supportsLinkLevelValidation).toBe(false);
    expect(diagnostic.summary).toMatch(/produced no trips/i);
    expect(diagnostic.summary).not.toMatch(/meaningful test/i);
  });
});

describe("the caveat that travels with a comparison", () => {
  it("says whose judgement the banding is", () => {
    // A number OpenPlan chose is indistinguishable, on a page shown to a board,
    // from one a standards body published — unless it says which it is.
    expect(LINK_VALIDATION_NOT_SUPPORTED_CAVEAT).toMatch(
      /OpenPlan's own screening heuristic, not an adopted standard/i
    );
    // And it must state the consequence, not just the limitation.
    expect(LINK_VALIDATION_NOT_SUPPORTED_CAVEAT).toMatch(/not evidence about the model's demand/i);
  });
});
