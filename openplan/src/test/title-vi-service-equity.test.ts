import { describe, expect, it } from "vitest";

import {
  SERVICE_MEASURES,
  compareServiceEquity,
  type ServiceEquityInput,
  type TractServiceRow,
} from "@/lib/title-vi/service-equity";
import {
  TITLE_VI_POLICY_COLUMNS,
  titleViPolicyGaps,
  toTitleViPolicy,
  type TitleViPolicy,
  type TitleViPolicyRow,
} from "@/lib/title-vi/policy";

/**
 * TITLE VI SERVICE EQUITY — the assertions, written with the findings of the
 * 2026-08-06 equity audit in hand.
 *
 * That audit measured the surface this module sits on and found 23 of 44
 * mutations testing nothing, including a threshold table where every value
 * could be moved to switch its flag off permanently. This file exists so the
 * same thing is not true of the module built on top of it on its first day.
 *
 * The three edges it is built around, each of which would produce a WRONG
 * civil-rights finding rather than a missing one:
 *
 *   1. HEADWAY IMPROVES DOWNWARD. Three measures get better as the number
 *      rises and one gets better as it falls. An unsigned comparison reports
 *      minority areas waiting twice as long as an ADVANTAGE.
 *   2. A THRESHOLD ONLY FIRES AGAINST THE FOCUS GROUP. A minority group
 *      receiving more service is not a Title VI finding.
 *   3. NO ADOPTED THRESHOLD MEANS NO VERDICT, never a default. A number
 *      OpenPlan chose is indistinguishable, on a published finding, from one
 *      the agency adopted.
 */

function policy(over: Partial<TitleViPolicy> = {}): TitleViPolicy {
  return {
    id: "policy-1",
    workspaceId: "ws-1",
    adoptedOn: "2026-01-15",
    adoptedBy: "Board of Directors",
    boardActionReference: "Res. 2026-04",
    documentUrl: null,
    minorityDefinitionMethod: "service_area_average",
    minorityThresholdPct: null,
    lowIncomeDefinitionMethod: "service_area_average",
    lowIncomeThresholdPct: null,
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
 * The universes DEFAULT TO THE HEAD-COUNT the caller gave, rather than to a
 * constant, so that a test overriding `populationTotal` describes a coherent
 * tract instead of one with 9,000 residents and a race universe of 1,000. That
 * is what ACS reports in the ordinary case — B03002's universe IS the total
 * population — and it keeps every test here about the thing it is named for.
 *
 * It is deliberately NOT what proves which denominator the code reached for: a
 * fixture where the universes always equal the head-count cannot tell the two
 * apart. `a-poverty-rate-uses-the-poverty-universe.test.ts` is built entirely
 * out of tracts where they differ, and that is where the denominators are
 * pinned.
 */
function tract(over: Partial<TractServiceRow> = {}): TractServiceRow {
  const populationTotal = over.populationTotal === undefined ? 1000 : over.populationTotal;
  return {
    geoid: "39049000100",
    populationTotal,
    populationWhiteNonHispanic: 800,
    raceUniverse: populationTotal,
    populationBelowPoverty: 100,
    povertyUniverse: populationTotal,
    stopsInTract: 4,
    stopEventsPerDay: 100,
    bestPeakHeadwaySeconds: 900,
    bestSpanSeconds: 18 * 3600,
    routesServing: 3,
    ...over,
  };
}

/** A minority tract (80% minority) and a non-minority one (20%), equal size. */
function twoGroups(
  focusOver: Partial<TractServiceRow>,
  comparisonOver: Partial<TractServiceRow>
): TractServiceRow[] {
  return [
    tract({ geoid: "focus", populationTotal: 1000, populationWhiteNonHispanic: 200, ...focusOver }),
    tract({ geoid: "comparison", populationTotal: 1000, populationWhiteNonHispanic: 800, ...comparisonOver }),
  ];
}

function run(over: Partial<ServiceEquityInput> = {}) {
  return compareServiceEquity({
    serviceDay: "monday",
    tracts: twoGroups({}, {}),
    policy: policy(),
    tractServiceComputed: true,
    ...over,
  });
}

function measure(result: ReturnType<typeof compareServiceEquity>, key: string) {
  if (!result.ok) throw new Error(`expected a comparison, got refusal ${result.refusal.code}`);
  const found = result.comparison.minorityMeasures.find((m) => m.measure.key === key);
  if (!found) throw new Error(`no measure ${key}`);
  return found;
}

describe("a measure that improves downward is compared in the right direction", () => {
  it("declares exactly one measure as lower-is-better, and it is headway", () => {
    const inverted = SERVICE_MEASURES.filter((m) => m.direction === "lower_is_better");
    expect(inverted.map((m) => m.key)).toEqual(["bestPeakHeadwaySeconds"]);
  });

  it("reports a LONGER wait in minority tracts as worse, not better", () => {
    // Focus waits 30 minutes, comparison waits 15. The raw relative difference
    // is +100%; the honest one is -100%, because waiting twice as long is half
    // the service. An unsigned comparison would report this as an advantage.
    const result = run({
      tracts: twoGroups(
        { bestPeakHeadwaySeconds: 1800 },
        { bestPeakHeadwaySeconds: 900 }
      ),
    });
    const headway = measure(result, "bestPeakHeadwaySeconds");

    expect(headway.focusValue).toBe(30);
    expect(headway.comparisonValue).toBe(15);
    expect(headway.relativeDifferencePct).toBe(-100);
    expect(headway.exceedsAdoptedThreshold).toBe(true);
  });

  it("reports a SHORTER wait in minority tracts as better, and trips nothing", () => {
    const result = run({
      tracts: twoGroups(
        { bestPeakHeadwaySeconds: 900 },
        { bestPeakHeadwaySeconds: 1800 }
      ),
    });
    const headway = measure(result, "bestPeakHeadwaySeconds");

    expect(headway.relativeDifferencePct).toBe(50);
    expect(headway.exceedsAdoptedThreshold).toBe(false);
  });

  it("keeps higher-is-better measures pointing the ordinary way", () => {
    const result = run({
      tracts: twoGroups({ stopEventsPerDay: 50 }, { stopEventsPerDay: 100 }),
    });
    const events = measure(result, "stopEventsPerDay");
    expect(events.relativeDifferencePct).toBe(-50);
    expect(events.exceedsAdoptedThreshold).toBe(true);
  });
});

describe("an adopted threshold is the only thing that produces a verdict", () => {
  it("names nothing when no threshold is adopted, however large the gap", () => {
    const result = run({
      policy: policy({ disparateImpactThresholdPct: null }),
      tracts: twoGroups({ stopEventsPerDay: 1 }, { stopEventsPerDay: 1000 }),
    });
    const events = measure(result, "stopEventsPerDay");

    // The difference is still MEASURED and reported — withholding it would hide
    // a real gap. What is withheld is the verdict.
    expect(events.relativeDifferencePct).toBe(-99.9);
    expect(events.exceedsAdoptedThreshold).toBeNull();
  });

  it("does not fire when the focus group receives MORE service", () => {
    // A minority group with far better service is not a Title VI finding, and
    // reporting one would be the same error as an unsigned comparison.
    const result = run({
      tracts: twoGroups({ stopEventsPerDay: 1000 }, { stopEventsPerDay: 100 }),
    });
    const events = measure(result, "stopEventsPerDay");
    expect(events.relativeDifferencePct).toBe(900);
    expect(events.exceedsAdoptedThreshold).toBe(false);
  });

  it("compares against the adopted number, not a built-in one", () => {
    const gap = twoGroups({ stopEventsPerDay: 70 }, { stopEventsPerDay: 100 });
    // -30% difference: over a 20-point threshold, under a 40-point one.
    expect(
      measure(run({ tracts: gap, policy: policy({ disparateImpactThresholdPct: 20 }) }), "stopEventsPerDay")
        .exceedsAdoptedThreshold
    ).toBe(true);
    expect(
      measure(run({ tracts: gap, policy: policy({ disparateImpactThresholdPct: 40 }) }), "stopEventsPerDay")
        .exceedsAdoptedThreshold
    ).toBe(false);
  });

  it("uses the disproportionate-burden threshold for the low-income comparison", () => {
    // The two thresholds are separate adopted values and must not share a path.
    const result = compareServiceEquity({
      serviceDay: "monday",
      tractServiceComputed: true,
      policy: policy({
        disparateImpactThresholdPct: 90,
        disproportionateBurdenThresholdPct: 5,
      }),
      tracts: [
        tract({ geoid: "poor", populationTotal: 1000, populationWhiteNonHispanic: 200, populationBelowPoverty: 400, stopEventsPerDay: 70 }),
        tract({ geoid: "rich", populationTotal: 1000, populationWhiteNonHispanic: 800, populationBelowPoverty: 50, stopEventsPerDay: 100 }),
      ],
    });
    if (!result.ok) throw new Error(result.refusal.code);

    const minority = result.comparison.minorityMeasures.find((m) => m.measure.key === "stopEventsPerDay");
    const lowIncome = result.comparison.lowIncomeMeasures.find((m) => m.measure.key === "stopEventsPerDay");
    // Same -30% gap, two different adopted thresholds, two different verdicts.
    expect(minority?.relativeDifferencePct).toBe(-30);
    expect(minority?.exceedsAdoptedThreshold).toBe(false);
    expect(lowIncome?.relativeDifferencePct).toBe(-30);
    expect(lowIncome?.exceedsAdoptedThreshold).toBe(true);
  });
});

describe("no data and no service are never the same answer", () => {
  it("refuses when no policy has been adopted", () => {
    const result = compareServiceEquity({
      serviceDay: "monday",
      tracts: twoGroups({}, {}),
      tractServiceComputed: true,
      policy: null as unknown as TitleViPolicy,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("no_adopted_policy");
    expect(result.refusal.message).toMatch(/policy your agency adopts/i);
  });

  it("refuses when the tract join never ran, and says it is not a finding", () => {
    const result = run({ tractServiceComputed: false, tracts: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("tract_service_not_computed");
    expect(result.refusal.message).toMatch(/NOT a finding/i);
  });

  it("refuses when no tracts are loaded, and names the step that fixes it", () => {
    const result = run({ tracts: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("no_tract_coverage");
    expect(result.refusal.message).toMatch(/not a finding that the area has no census tracts/i);
    expect(result.refusal.message).toMatch(/Workspace geography panel/i);
  });

  it("refuses when every tract fell on one side of the adopted definition", () => {
    const result = run({
      tracts: [
        tract({ geoid: "a", populationTotal: 1000, populationWhiteNonHispanic: 100 }),
        tract({ geoid: "b", populationTotal: 1000, populationWhiteNonHispanic: 100 }),
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("no_comparison_group");
    expect(result.refusal.message).toMatch(/not a finding that service is equitable/i);
  });

  it("counts tracts it could not classify instead of dropping them silently", () => {
    const result = run({
      tracts: [
        ...twoGroups({}, {}),
        tract({ geoid: "suppressed", populationTotal: 0, populationWhiteNonHispanic: 0 }),
        tract({ geoid: "null-universe", populationTotal: null, populationWhiteNonHispanic: null }),
      ],
    });
    if (!result.ok) throw new Error(result.refusal.code);
    expect(result.comparison.tractsWithNoPopulationUniverse).toBe(2);
    expect(result.comparison.disclosures.some((d) => /no population universe/i.test(d))).toBe(true);
  });

  it("treats a tract with no stops as a measurement of no service", () => {
    const result = run({
      tracts: twoGroups({ stopsInTract: 0, stopEventsPerDay: 0, routesServing: 0, bestPeakHeadwaySeconds: null, bestSpanSeconds: null }, {}),
    });
    if (!result.ok) throw new Error(result.refusal.code);

    expect(result.comparison.minorityFocus.tractsWithNoService).toBe(1);
    expect(result.comparison.minorityFocus.populationWithNoService).toBe(1000);
    // The share-with-any-service measure is where an unserved tract lands.
    const anyService = measure(result, "populationWithAnyService");
    expect(anyService.focusValue).toBe(0);
    expect(anyService.comparisonValue).toBe(100);
    expect(anyService.relativeDifferencePct).toBe(-100);
  });

  it("excludes unserved tracts from headway, and says so", () => {
    // A tract with no stops has no headway. Including it would need a made-up
    // number; excluding it silently would hide the worst-served places. It is
    // excluded AND disclosed, and the share-with-any-service measure carries it.
    const headway = SERVICE_MEASURES.find((m) => m.key === "bestPeakHeadwaySeconds");
    const anyService = SERVICE_MEASURES.find((m) => m.key === "populationWithAnyService");
    expect(headway?.includesUnservedTracts).toBe(false);
    expect(anyService?.includesUnservedTracts).toBe(true);

    const result = run({
      tracts: [
        tract({ geoid: "f1", populationTotal: 1000, populationWhiteNonHispanic: 200, stopsInTract: 0, stopEventsPerDay: 0, routesServing: 0, bestPeakHeadwaySeconds: null, bestSpanSeconds: null }),
        tract({ geoid: "f2", populationTotal: 1000, populationWhiteNonHispanic: 200, bestPeakHeadwaySeconds: 1200 }),
        tract({ geoid: "c1", populationTotal: 1000, populationWhiteNonHispanic: 800, bestPeakHeadwaySeconds: 600 }),
      ],
    });
    if (!result.ok) throw new Error(result.refusal.code);
    const h = result.comparison.minorityMeasures.find((m) => m.measure.key === "bestPeakHeadwaySeconds");
    // Only the served focus tract took part, and the count says so.
    expect(h?.focusTractsCompared).toBe(1);
    expect(h?.focusValue).toBe(20);
    expect(result.comparison.disclosures.some((d) => /no stops has\s+no headway/i.test(d))).toBe(true);
  });

  it("KEEPS unserved tracts in the measures that can carry them", () => {
    // The dangerous direction, and the one the exclusion flag actually governs.
    // A tract with no service has a null headway, so `weightedMean` drops it
    // whether or not the flag says to — the flag is only observable on measures
    // whose unserved value is a real 0. Excluding those would delete the
    // worst-served places from the comparison and make a service gap vanish,
    // which is why each such measure is asserted to include them.
    const carriesUnserved = SERVICE_MEASURES.filter((m) => m.includesUnservedTracts).map((m) => m.key);
    expect(carriesUnserved).toEqual([
      "populationWithAnyService",
      "stopEventsPerDay",
      "routesServing",
    ]);

    const result = run({
      tracts: [
        tract({ geoid: "f1", populationTotal: 1000, populationWhiteNonHispanic: 200, stopsInTract: 0, stopEventsPerDay: 0, routesServing: 0, bestPeakHeadwaySeconds: null, bestSpanSeconds: null }),
        tract({ geoid: "f2", populationTotal: 1000, populationWhiteNonHispanic: 200, stopEventsPerDay: 100, routesServing: 4 }),
        tract({ geoid: "c1", populationTotal: 1000, populationWhiteNonHispanic: 800, stopEventsPerDay: 100, routesServing: 4 }),
      ],
    });
    if (!result.ok) throw new Error(result.refusal.code);

    // Both focus tracts count: (0 + 100) / 2 = 50, not the 100 that dropping
    // the unserved one would report — and 50 vs 100 is the real gap.
    const events = result.comparison.minorityMeasures.find((m) => m.measure.key === "stopEventsPerDay");
    expect(events?.focusTractsCompared).toBe(2);
    expect(events?.focusValue).toBe(50);
    expect(events?.relativeDifferencePct).toBe(-50);

    const routes = result.comparison.minorityMeasures.find((m) => m.measure.key === "routesServing");
    expect(routes?.focusTractsCompared).toBe(2);
    expect(routes?.focusValue).toBe(2);
  });
});

describe("the comparison is of people, and of one service day", () => {
  it("weights by population rather than counting tracts", () => {
    // One large well-served minority tract and one small unserved one. Counting
    // tracts would say half the minority group has no service; weighting by
    // people says a tenth does, which is the true statement about residents.
    const result = run({
      tracts: [
        tract({ geoid: "big", populationTotal: 9000, populationWhiteNonHispanic: 1000, stopEventsPerDay: 100 }),
        tract({ geoid: "small", populationTotal: 1000, populationWhiteNonHispanic: 100, stopsInTract: 0, stopEventsPerDay: 0, routesServing: 0, bestPeakHeadwaySeconds: null, bestSpanSeconds: null }),
        tract({ geoid: "comparison", populationTotal: 1000, populationWhiteNonHispanic: 800, stopEventsPerDay: 100 }),
      ],
    });
    if (!result.ok) throw new Error(result.refusal.code);

    const anyService = measure(result, "populationWithAnyService");
    // 9,000 of 10,000 minority-tract residents have service.
    expect(anyService.focusValue).toBe(90);
    expect(result.comparison.minorityFocus.population).toBe(10000);
    expect(result.comparison.minorityFocus.tracts).toBe(2);
  });

  it("reports the service day it was given and never merges days", () => {
    const saturday = run({ serviceDay: "saturday" });
    if (!saturday.ok) throw new Error(saturday.refusal.code);
    expect(saturday.comparison.serviceDay).toBe("saturday");
    expect(saturday.comparison.disclosures.some((d) => /saturday service day only/i.test(d))).toBe(true);
    expect(saturday.comparison.disclosures.some((d) => /never added together/i.test(d))).toBe(true);
  });

  it("discloses that the extent is a bounding envelope, not a service area", () => {
    const result = run();
    if (!result.ok) throw new Error(result.refusal.code);
    expect(
      result.comparison.disclosures.some((d) => /not the agency's adopted service-area boundary/i.test(d))
    ).toBe(true);
  });

  it("explains that a stop event is not a vehicle", () => {
    const result = run();
    if (!result.ok) throw new Error(result.refusal.code);
    expect(result.comparison.disclosures.some((d) => /rather than a count of vehicles/i.test(d))).toBe(true);
  });
});

describe("the adopted definition decides which tracts are compared", () => {
  it("uses the service-area average when that is the adopted method", () => {
    const result = run({
      tracts: [
        tract({ geoid: "a", populationTotal: 1000, populationWhiteNonHispanic: 500 }),
        tract({ geoid: "b", populationTotal: 1000, populationWhiteNonHispanic: 900 }),
      ],
    });
    if (!result.ok) throw new Error(result.refusal.code);
    // 600 minority of 2,000 people → 30% service-area share. Tract a is 50%.
    expect(result.comparison.serviceAreaMinoritySharePct).toBe(30);
    expect(result.comparison.minorityFocus.tracts).toBe(1);
    expect(result.comparison.classificationBasis).toMatch(/service-area minority share of 30%/);
    expect(result.comparison.classificationBasis).toMatch(/Board of Directors/);
  });

  it("uses a fixed threshold when the agency adopted one instead", () => {
    const tracts = [
      tract({ geoid: "a", populationTotal: 1000, populationWhiteNonHispanic: 500 }),
      tract({ geoid: "b", populationTotal: 1000, populationWhiteNonHispanic: 900 }),
    ];
    // At a 45% fixed threshold tract a (50%) is in and b (10%) is out — the
    // same split the average produced, so raise it to 60% to prove the fixed
    // number is what moved the boundary rather than the average.
    const result = run({
      tracts,
      policy: policy({ minorityDefinitionMethod: "fixed_threshold", minorityThresholdPct: 60 }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("no_comparison_group");

    const lower = run({
      tracts,
      policy: policy({ minorityDefinitionMethod: "fixed_threshold", minorityThresholdPct: 45 }),
    });
    if (!lower.ok) throw new Error(lower.refusal.code);
    expect(lower.comparison.minorityFocus.tracts).toBe(1);
    expect(lower.comparison.classificationBasis).toMatch(/fixed threshold adopted on 2026-01-15/);
  });
});

describe("the policy row is read as numbers, not as strings", () => {
  function row(over: Partial<TitleViPolicyRow> = {}): TitleViPolicyRow {
    return {
      id: "p1",
      workspace_id: "ws-1",
      adopted_on: "2026-01-15",
      adopted_by: "Board",
      board_action_reference: null,
      document_url: null,
      minority_definition_method: "fixed_threshold",
      minority_threshold_pct: "50.00",
      low_income_definition_method: "service_area_average",
      low_income_threshold_pct: null,
      disparate_impact_threshold_pct: "10.00",
      disproportionate_burden_threshold_pct: "10.00",
      standard_peak_headway_minutes: 30,
      standard_offpeak_headway_minutes: 60,
      standard_span_hours: "18.0",
      standard_on_time_performance_pct: "85.00",
      standard_vehicle_load_note: null,
      standard_service_availability_note: null,
      policy_amenity_distribution_note: null,
      policy_vehicle_assignment_note: null,
      superseded_at: null,
      ...over,
    };
  }

  it("coerces every NUMERIC column, which PostgREST returns as a string", () => {
    // Postgres `numeric` has arbitrary precision, so the driver preserves it as
    // text. `"10.00" > 5` is FALSE in JavaScript and `>=` compares
    // lexicographically, so an uncoerced threshold would silently never fire —
    // a disparate-impact test that always passes.
    const parsed = toTitleViPolicy(row());
    expect(parsed.minorityThresholdPct).toBe(50);
    expect(parsed.disparateImpactThresholdPct).toBe(10);
    expect(parsed.standardSpanHours).toBe(18);
    expect(parsed.standardOnTimePerformancePct).toBe(85);
    for (const value of [
      parsed.minorityThresholdPct,
      parsed.disparateImpactThresholdPct,
      parsed.disproportionateBurdenThresholdPct,
      parsed.standardSpanHours,
      parsed.standardOnTimePerformancePct,
    ]) {
      expect(typeof value).toBe("number");
    }
  });

  it("compares two thresholds against each other correctly, which strings would not", () => {
    // WHERE THE COERCION ACTUALLY MATTERS, stated precisely because the obvious
    // claim is wrong: JavaScript's relational operators coerce a numeric string,
    // so `Math.abs(-30) > "20.00"` is already true and a single uncoerced
    // threshold would NOT flip a verdict. What breaks is STRING-TO-STRING
    // comparison, which is lexicographic — and that is what comparing two
    // thresholds, or sorting them, does.
    const strict = toTitleViPolicy(row({ disparate_impact_threshold_pct: "9.00" }));
    const loose = toTitleViPolicy(row({ disparate_impact_threshold_pct: "10.00" }));

    expect(loose.disparateImpactThresholdPct! > strict.disparateImpactThresholdPct!).toBe(true);
    // The same values as the strings PostgREST hands back compare the other way.
    expect(("10.00" as unknown as number) > ("9.00" as unknown as number)).toBe(false);
  });

  it("keeps null thresholds null rather than turning them into zero", () => {
    // `Number(null)` is 0, and a zero disparate-impact threshold would fire on
    // every measured difference however small — the loudest possible wrong
    // answer, and the one that would look most like the tool working.
    const parsed = toTitleViPolicy(row({ disparate_impact_threshold_pct: null }));
    expect(parsed.disparateImpactThresholdPct).toBeNull();
    expect(parsed.disparateImpactThresholdPct).not.toBe(0);
  });

  it("asks the database for every column it reads back", () => {
    // A mocked Supabase client answers whatever columns were requested, so a
    // column dropped from the projection leaves tests green and the page
    // rendering undefined. Assert on the projection string itself.
    const parsed = toTitleViPolicy(row());
    const requested = TITLE_VI_POLICY_COLUMNS.split(",").map((column) => column.trim());
    for (const column of Object.keys(row())) {
      expect(requested, `projection is missing ${column}`).toContain(column);
    }
    expect(Object.keys(parsed).length).toBeGreaterThan(15);
  });
});

describe("an incomplete policy says what is missing", () => {
  it("reports the absence of a policy as a gap, not as a default", () => {
    const gaps = titleViPolicyGaps(null);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatch(/supplies no default thresholds/i);
  });

  it("names an adopted-but-empty threshold", () => {
    expect(titleViPolicyGaps(policy({ disparateImpactThresholdPct: null }))).toContainEqual(
      expect.stringMatching(/No disparate-impact threshold is adopted/i)
    );
    expect(
      titleViPolicyGaps(
        policy({ minorityDefinitionMethod: "fixed_threshold", minorityThresholdPct: null })
      )
    ).toContainEqual(expect.stringMatching(/fixed minority threshold is selected but no percentage/i));
  });

  it("reports no gaps for a fully adopted policy", () => {
    expect(titleViPolicyGaps(policy())).toEqual([]);
  });
});
