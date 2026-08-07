import { describe, expect, it } from "vitest";

import { compareServiceEquity, type TractServiceRow } from "@/lib/title-vi/service-equity";
import type { TitleViPolicy } from "@/lib/title-vi/policy";

/**
 * WHICH POPULATION A SHARE IS DIVIDED BY, PINNED — because getting it wrong
 * moves tracts out of a protected group and no test in the repository could
 * tell.
 *
 * THE DEFECT THIS WAS WRITTEN FOR, found 2026-08-07. `compareServiceEquity`
 * classified a tract as low-income using `pop_below_poverty / pop_total`. Those
 * two numbers come from different ACS tables:
 *
 *   pop_below_poverty  B17001_002E  universe: people whose poverty status ACS
 *                                   DETERMINED — which excludes anyone in
 *                                   institutionalised group quarters, military
 *                                   barracks or a college dormitory
 *   pop_total          B01003_001E  universe: everybody
 *
 * So the denominator was always the larger number and the poverty rate was
 * always too low. In an ordinary tract that is a percent or two. In a tract
 * holding a state prison, a university or a barracks it is enormous — and those
 * tracts are not a curiosity, they are where the rate decides something. Every
 * tract pushed below the agency's adopted threshold leaves the low-income focus
 * group and joins the comparison group, which is the direction that makes a
 * disparity smaller and a finding go away.
 *
 * WHY THE FIXTURES LOOK LIKE THIS. A tract whose universes equal its head-count
 * cannot tell "divided by the poverty universe" from "divided by the total
 * population" — which is exactly why the defect survived a suite with 29 tests
 * over this module. Every tract below states a universe that DIFFERS from the
 * head-count, and each assertion is written so that the old arithmetic produces
 * a different answer, not merely a less precise one.
 *
 * The poverty divergences here are realistic: a 6,000-resident tract containing
 * a 3,000-bed prison genuinely reports a poverty universe near 3,000. The RACE
 * divergence is not — B03002's universe is the total population and the two
 * agree closely in real data. It is exaggerated on purpose, because a realistic
 * one-percent difference would not distinguish the two columns under any
 * threshold, and the thing under test is which column the code reads.
 */

function policy(over: Partial<TitleViPolicy> = {}): TitleViPolicy {
  return {
    id: "policy-1",
    workspaceId: "ws-1",
    adoptedOn: "2026-01-15",
    adoptedBy: "Board of Directors",
    boardActionReference: "Res. 2026-04",
    documentUrl: null,
    minorityDefinitionMethod: "fixed_threshold",
    minorityThresholdPct: 50,
    lowIncomeDefinitionMethod: "fixed_threshold",
    lowIncomeThresholdPct: 20,
    disparateImpactThresholdPct: 20,
    disproportionateBurdenThresholdPct: 20,
    standardPeakHeadwayMinutes: 30,
    standardOffpeakHeadwayMinutes: 60,
    standardSpanHours: 18,
    standardOnTimePerformancePct: 85,
    standardVehicleLoadNote: null,
    standardServiceAvailabilityNote: null,
    policyAmenityDistributionNote: null,
    policyVehicleAssignmentNote: null,
    supersededAt: null,
    ...over,
  };
}

/**
 * The universes default to the head-count the caller gave — the ordinary ACS
 * case — so a test that raises `populationTotal` without saying anything about
 * universes still describes a coherent tract. Every test that is ABOUT the
 * denominator overrides one of them explicitly, and that divergence is the
 * whole assertion.
 */
function tract(over: Partial<TractServiceRow> & { geoid: string }): TractServiceRow {
  const populationTotal = over.populationTotal === undefined ? 1000 : over.populationTotal;
  return {
    populationTotal,
    populationWhiteNonHispanic: 900,
    raceUniverse: populationTotal,
    populationBelowPoverty: 50,
    povertyUniverse: populationTotal,
    stopsInTract: 4,
    stopEventsPerDay: 100,
    bestPeakHeadwaySeconds: 900,
    bestSpanSeconds: 18 * 3600,
    routesServing: 3,
    ...over,
  };
}

/**
 * Two minority tracts and two non-minority ones, so the minority comparison
 * always has both groups and never short-circuits the low-income half through
 * the `no_comparison_group` refusal.
 */
function minorityScaffold(): TractServiceRow[] {
  return [
    tract({ geoid: "m1", populationWhiteNonHispanic: 100 }),
    tract({ geoid: "m2", populationWhiteNonHispanic: 100 }),
    tract({ geoid: "w1", populationWhiteNonHispanic: 900 }),
    tract({ geoid: "w2", populationWhiteNonHispanic: 900 }),
  ];
}

function run(tracts: TractServiceRow[], over: Partial<TitleViPolicy> = {}) {
  const result = compareServiceEquity({
    serviceDay: "monday",
    tracts,
    policy: policy(over),
    tractServiceComputed: true,
  });
  if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
  return result.comparison;
}

describe("the poverty rate is divided by the poverty universe", () => {
  it("puts a prison tract in the low-income group, where the total-population rate would not", () => {
    // 6,000 residents, of whom 3,200 are in a state prison and therefore outside
    // the poverty universe. 700 of the remaining 2,800 are below poverty.
    //   correct:  700 / 2,800 = 25.0%  → at or above the adopted 20% → FOCUS
    //   the bug:  700 / 6,000 = 11.7%  → below it                    → COMPARISON
    const prison = tract({
      geoid: "prison",
      populationTotal: 6000,
      povertyUniverse: 2800,
      populationBelowPoverty: 700,
      populationWhiteNonHispanic: 5400,
      raceUniverse: 6000,
    });

    const comparison = run([...minorityScaffold(), prison]);

    expect(comparison.lowIncomeFocus.tracts).toBe(1);
    expect(comparison.lowIncomeFocus.population).toBe(6000);
    expect(comparison.lowIncomeComparison.tracts).toBe(4);
  });

  it("computes the service-area low-income share over the poverty universe", () => {
    // Two tracts, 2,000 people each. One is half dormitory.
    //   correct:  (300 + 100) / (1,000 + 2,000) = 13.3%
    //   the bug:  (300 + 100) / (2,000 + 2,000) = 10.0%
    const comparison = run(
      [
        tract({
          geoid: "campus",
          populationTotal: 2000,
          povertyUniverse: 1000,
          populationBelowPoverty: 300,
          populationWhiteNonHispanic: 200,
        }),
        tract({
          geoid: "ordinary",
          populationTotal: 2000,
          povertyUniverse: 2000,
          populationBelowPoverty: 100,
          populationWhiteNonHispanic: 1800,
        }),
      ],
      // The service-area average is the adopted definition here, so this share
      // is not decoration — it is the cut every tract is classified against.
      { lowIncomeDefinitionMethod: "service_area_average", lowIncomeThresholdPct: null }
    );

    expect(comparison.serviceAreaLowIncomeSharePct).toBe(13.3);
    // 30% is above 13.3% and 5% is below it, so the definition separated them.
    expect(comparison.lowIncomeFocus.tracts).toBe(1);
    expect(comparison.lowIncomeComparison.tracts).toBe(1);
  });

  it("weights service by residents, not by the poverty universe", () => {
    // The prison's 3,200 residents are outside the poverty universe and inside
    // the tract. A service figure speaks for people who live somewhere, so the
    // weight is the head-count — 6,000, not 2,800.
    const comparison = run([
      ...minorityScaffold(),
      tract({
        geoid: "prison",
        populationTotal: 6000,
        povertyUniverse: 2800,
        populationBelowPoverty: 700,
        populationWhiteNonHispanic: 5400,
        raceUniverse: 6000,
      }),
    ]);

    expect(comparison.lowIncomeFocus.population).toBe(6000);
    expect(comparison.lowIncomeFocus.population).not.toBe(2800);
  });
});

describe("the minority share is divided by the race universe", () => {
  it("uses B03002's universe rather than the head-count", () => {
    //   correct:  (1,000 - 400) / 1,000 = 60%
    //   the bug:  (2,000 - 400) / 2,000 = 80%
    // With a 70% adopted threshold the two answers fall on OPPOSITE sides.
    const comparison = run(
      [
        tract({
          geoid: "focus",
          populationTotal: 2000,
          raceUniverse: 1000,
          populationWhiteNonHispanic: 400,
        }),
        tract({ geoid: "other", populationWhiteNonHispanic: 50, raceUniverse: 1000 }),
        tract({ geoid: "white-1", populationWhiteNonHispanic: 900 }),
      ],
      { minorityThresholdPct: 70 }
    );

    // 60% and 95% against a 70% cut: only the second tract is in the group.
    expect(comparison.minorityFocus.tracts).toBe(1);
    expect(comparison.minorityFocus.population).toBe(1000);
  });

  it("computes the service-area minority share over the race universe", () => {
    //   correct:  (600 + 100) / (1,000 + 1,000) = 35%
    //   the bug:  (1,600 + 100) / (2,000 + 1,000) = 56.7%
    const comparison = run(
      [
        tract({
          geoid: "a",
          populationTotal: 2000,
          raceUniverse: 1000,
          populationWhiteNonHispanic: 400,
        }),
        tract({ geoid: "b", populationWhiteNonHispanic: 900, raceUniverse: 1000 }),
      ],
      { minorityDefinitionMethod: "service_area_average", minorityThresholdPct: null }
    );

    expect(comparison.serviceAreaMinoritySharePct).toBe(35);
  });
});

describe("a tract with no universe is counted, never assumed", () => {
  it("keeps a tract with no poverty universe out of BOTH low-income groups", () => {
    // A tract loaded before migration 20260805000010 has NULL universes. Reading
    // its missing poverty rate as 0% would file it as an affluent tract — an
    // invented finding, on the side that dilutes a disparity.
    const comparison = run([
      ...minorityScaffold(),
      tract({
        geoid: "stale",
        populationTotal: 4000,
        povertyUniverse: null,
        populationBelowPoverty: null,
        populationWhiteNonHispanic: 3600,
      }),
    ]);

    expect(comparison.lowIncomeFocus.tracts + comparison.lowIncomeComparison.tracts).toBe(4);
    expect(comparison.tractsWithNoPovertyUniverse).toBe(1);
    expect(
      comparison.disclosures.some((line) => /no poverty universe/i.test(line)),
      "the reader must be told which tracts the low-income half does not cover"
    ).toBe(true);
  });

  it("still reports it in the minority comparison, which its race universe supports", () => {
    // The two universes are separate columns and a tract can carry one without
    // the other. Dropping such a tract from the minority figures too would
    // withhold a comparison that is fully measurable.
    const comparison = run([
      ...minorityScaffold(),
      tract({
        geoid: "poverty-only-gap",
        populationTotal: 4000,
        raceUniverse: 4000,
        populationWhiteNonHispanic: 400,
        povertyUniverse: null,
        populationBelowPoverty: null,
      }),
    ]);

    expect(comparison.minorityFocus.tracts).toBe(3);
    expect(comparison.tractsWithNoPopulationUniverse).toBe(0);
  });

  it("makes the low-income comparison unmeasured rather than empty when no tract has the universe", () => {
    const comparison = run(
      minorityScaffold().map((row) => ({
        ...row,
        povertyUniverse: null,
        populationBelowPoverty: null,
      })),
      { lowIncomeDefinitionMethod: "service_area_average", lowIncomeThresholdPct: null }
    );

    expect(comparison.serviceAreaLowIncomeSharePct).toBeNull();
    expect(comparison.lowIncomeFocus.tracts).toBe(0);
    expect(comparison.lowIncomeComparison.tracts).toBe(0);
    expect(
      comparison.disclosures.some((line) => /No low-income comparison could be made/i.test(line)),
      "an empty low-income group must say why, or it reads as a finding that nobody is low-income"
    ).toBe(true);
    // The minority comparison is untouched by the poverty gap.
    expect(comparison.minorityFocus.tracts).toBe(2);
  });

  it("refuses the whole analysis when no tract can be classified at all", () => {
    const result = compareServiceEquity({
      serviceDay: "monday",
      tracts: minorityScaffold().map((row) => ({
        ...row,
        raceUniverse: null,
        populationWhiteNonHispanic: null,
        povertyUniverse: null,
      })),
      policy: policy(),
      tractServiceComputed: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("no_population_measured");
    // It must name the step that fixes it, because the usual cause is tracts
    // loaded before the universes existed.
    expect(result.refusal.message).toMatch(/loaded again from the Workspace geography panel/i);
  });
});
