import { describe, expect, it } from "vitest";

import {
  FHWA_VMT_SOURCE,
  PUBLISHED_VMT_SHARES,
  compareToPublishedShares,
} from "@/lib/models/charts/published-vmt-shares";

/**
 * THE ACCURACY CHECK THAT WORKS IN ALL FIFTY STATES.
 *
 * Only four state DOTs publish count feeds OpenPlan can read, so in the rest
 * of the country a corridor number has no check at all. FHWA publishes VMT by
 * functional system for every state every year — so "does this model produce a
 * sane amount of driving, on the right kinds of road" is answerable anywhere.
 *
 * Measured 2026-08-17 over 24 counties: the model puts 37% of vehicle miles on
 * principal arterials where the published share is 21%, and 26% on freeways
 * where it is 45%.
 */

describe("the published reference", () => {
  it("cites where the numbers came from and when they were read", () => {
    // An earlier version of this comparison used remembered figures and was
    // wrong by 10-15 points on two rows. A citation is what makes that
    // checkable rather than repeatable.
    expect(FHWA_VMT_SOURCE.url).toContain("fhwa.dot.gov");
    expect(FHWA_VMT_SOURCE.readOn).toBe("2026-08-17");
    expect(FHWA_VMT_SOURCE.states).toContain("California");
  });

  it("says plainly that a study area elsewhere is compared against those four states", () => {
    expect(FHWA_VMT_SOURCE.note).toContain("not that state's own figure");
  });

  it("covers the whole road hierarchy without double-counting a class", () => {
    const seen = new Set<string>();
    for (const row of PUBLISHED_VMT_SHARES) {
      for (const osmClass of row.osmClasses) {
        expect(seen.has(osmClass)).toBe(false);
        seen.add(osmClass);
      }
    }
    expect(seen).toContain("motorway");
    expect(seen).toContain("residential");
  });

  it("has shares that sum to roughly one", () => {
    const total = PUBLISHED_VMT_SHARES.reduce((sum, row) => sum + row.share, 0);
    expect(total).toBeGreaterThan(0.97);
    expect(total).toBeLessThan(1.03);
  });
});

describe("comparing a run against it", () => {
  // Real Nevada County proportions, roughly.
  const RUN_VMT = {
    motorway: 8_759_373,
    trunk: 6_057_864,
    primary: 6_546_940,
    secondary: 5_340_981,
    tertiary: 3_111_559,
    residential: 672_302,
  };

  it("folds OSM classes into the published categories", () => {
    const rows = compareToPublishedShares(RUN_VMT);
    expect(rows).not.toBeNull();
    const freeway = rows!.find((row) => row.label === "Freeway")!;
    const total = Object.values(RUN_VMT).reduce((a, b) => a + b, 0);
    expect(freeway.model).toBeCloseTo(RUN_VMT.motorway / total, 5);
    expect(freeway.published).toBe(0.448);
  });

  it("shows the finding: arterials over, freeways under", () => {
    const rows = compareToPublishedShares(RUN_VMT)!;
    const arterial = rows.find((r) => r.label === "Principal arterial")!;
    const freeway = rows.find((r) => r.label === "Freeway")!;
    expect(arterial.model).toBeGreaterThan(arterial.published);
    expect(freeway.model).toBeLessThan(freeway.published);
  });

  it("groups trunk with principal arterials, because the counts say so", () => {
    /**
     * The natural reading of the OSM tag puts `trunk` with freeways. The count
     * stations disagree — median model-over-observed across 24 counties is
     * motorway 0.78, trunk 2.38, primary 2.05 — so trunk behaves like an
     * arterial. Moving it back means disagreeing with that measurement.
     */
    const arterial = PUBLISHED_VMT_SHARES.find((row) => row.label === "Principal arterial")!;
    const freeway = PUBLISHED_VMT_SHARES.find((row) => row.label === "Freeway")!;
    expect(arterial.osmClasses).toContain("trunk");
    expect(freeway.osmClasses).not.toContain("trunk");
  });

  it("returns nothing when the run recorded no breakdown", () => {
    // An absent comparison is not a comparison of zeroes — drawing one would
    // tell a planner their model puts no traffic anywhere.
    expect(compareToPublishedShares(null)).toBeNull();
    expect(compareToPublishedShares(undefined)).toBeNull();
    expect(compareToPublishedShares({})).toBeNull();
    expect(compareToPublishedShares({ motorway: 0 })).toBeNull();
  });

  it("counts an unmapped OSM class into the total but no category", () => {
    // A class nobody mapped must not silently inflate a category it is not in;
    // it still belongs to the denominator because the vehicle-miles are real.
    const rows = compareToPublishedShares({ motorway: 100, some_new_osm_tag: 100 })!;
    const freeway = rows.find((r) => r.label === "Freeway")!;
    expect(freeway.model).toBeCloseTo(0.5, 5);
    expect(rows.reduce((sum, row) => sum + row.model, 0)).toBeCloseTo(0.5, 5);
  });
});
