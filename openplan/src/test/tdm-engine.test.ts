import { describe, expect, it } from "vitest";

import { InsufficientDataError } from "@/lib/planner-pack/types";
import { TDM_STRATEGY_CATALOG } from "@/lib/tdm/catalog";
import {
  DEFAULT_CO2E_LBS_PER_VEHICLE_MILE,
  LBS_PER_METRIC_TON,
  TDM_COMBINED_REVIEW_THRESHOLD_PCT,
  TDM_SCREENING_CAVEAT,
  applyTdmToAnnualVmt,
  combineTdmStrategies,
  estimateGhgFromVmtReduction,
  summarizeTdmCombination,
} from "@/lib/tdm/engine";

// Clean re-implementation (not a port) of transitscore-3d's
// `lib/tdmCalculations.ts` calculateTDMImpact and the GHG conversion side of
// `lib/vmtCalculations.ts`. Harvest defects deliberately fixed and pinned
// here:
//   - additive percentage summing — replaced by multiplicative dampening
//     (1 − Π(1 − rᵢ/100)), with the naive additive sum reported only for
//     transparency;
//   - the walk/bike "site context bonus" that double-counted site context
//     (walk/bike already reduce base VMT upstream) — removed entirely;
//   - the silent hard cap at 60% — replaced by an explicit
//     exceedsReviewThreshold flag at 30% that callers must surface;
//   - two consumers (ScenarioPlanner vs AnalysisWizard) disagreeing on
//     combination math — combineTdmStrategies is the single combiner.

describe("combineTdmStrategies", () => {
  it("combines two strategies with multiplicative dampening (golden)", () => {
    // unbundled-parking 5.0%, transit-subsidy 6.5%.
    // surviving = (1 − 0.05) × (1 − 0.065) = 0.95 × 0.935 = 0.88825
    // combined  = (1 − 0.88825) × 100      = 11.175%
    // additive  = 5.0 + 6.5                = 11.5%
    const result = combineTdmStrategies([
      { key: "unbundled-parking" },
      { key: "transit-subsidy" },
    ]);

    expect(result.combinedVmtReductionPct).toBeCloseTo(11.175, 10);
    expect(result.additiveSumPct).toBeCloseTo(11.5, 10);
    expect(result.exceedsReviewThreshold).toBe(false);
    expect(result.strategies).toEqual([
      {
        key: "unbundled-parking",
        name: "Unbundled Parking",
        category: "pricing",
        appliedVmtReductionPct: 5.0,
      },
      {
        key: "transit-subsidy",
        name: "Transit Pass Subsidy",
        category: "pricing",
        appliedVmtReductionPct: 6.5,
      },
    ]);
  });

  it("returns a single strategy's own percentage", () => {
    // combined = (1 − (1 − 0.065)) × 100 = 6.5%
    const result = combineTdmStrategies([{ key: "transit-subsidy" }]);
    expect(result.combinedVmtReductionPct).toBeCloseTo(6.5, 10);
    expect(result.additiveSumPct).toBeCloseTo(6.5, 10);
    expect(result.exceedsReviewThreshold).toBe(false);
  });

  it("treats an empty selection as a valid 0% combination", () => {
    const result = combineTdmStrategies([]);
    expect(result.combinedVmtReductionPct).toBe(0);
    expect(result.additiveSumPct).toBe(0);
    expect(result.strategies).toEqual([]);
    expect(result.exceedsReviewThreshold).toBe(false);
  });

  it("keeps multiplicative below additive for every 2-strategy pair in the catalog", () => {
    // Property: for r_a, r_b > 0, (a + b − ab/100) < (a + b), always.
    const keys = TDM_STRATEGY_CATALOG.map((strategy) => strategy.key);
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const result = combineTdmStrategies([{ key: keys[i] }, { key: keys[j] }]);
        expect(result.combinedVmtReductionPct).toBeLessThan(result.additiveSumPct);
      }
    }
  });

  it("flags the full catalog for review without capping or exceeding 100%", () => {
    // All 14 defaults: 3.5+2.5+1.0+4.0 (infrastructure = 11.0)
    //                + 5.0+6.5+4.5     (pricing        = 16.0)
    //                + 3.0+4.0+2.0+2.5 (programs       = 11.5)
    //                + 7.0+5.5+3.5     (policy         = 16.0)
    // additive = 54.5. Multiplicative combined ≈ 42.7% — above the 30%
    // review threshold but never clamped (the harvest silently capped at 60).
    const result = combineTdmStrategies(
      TDM_STRATEGY_CATALOG.map((strategy) => ({ key: strategy.key }))
    );
    expect(result.additiveSumPct).toBeCloseTo(54.5, 10);
    expect(result.combinedVmtReductionPct).toBeLessThan(result.additiveSumPct);
    expect(result.combinedVmtReductionPct).toBeLessThan(100);
    expect(result.combinedVmtReductionPct).toBeGreaterThan(TDM_COMBINED_REVIEW_THRESHOLD_PCT);
    expect(result.exceedsReviewThreshold).toBe(true);
  });

  it("honors a per-selection override", () => {
    const result = combineTdmStrategies([
      { key: "bike-parking", vmtReductionPctOverride: 10 },
    ]);
    expect(result.strategies[0].appliedVmtReductionPct).toBe(10);
    // combined = (1 − (1 − 0.10)) × 100 = 10%
    expect(result.combinedVmtReductionPct).toBeCloseTo(10, 10);
    expect(result.additiveSumPct).toBeCloseTo(10, 10);
  });

  it("accepts the override boundaries 0 and 100", () => {
    const zero = combineTdmStrategies([{ key: "bike-parking", vmtReductionPctOverride: 0 }]);
    expect(zero.combinedVmtReductionPct).toBe(0);

    // (1 − (1 − 1)) × 100 = 100 — arithmetically valid, review-flagged.
    const full = combineTdmStrategies([{ key: "bike-parking", vmtReductionPctOverride: 100 }]);
    expect(full.combinedVmtReductionPct).toBe(100);
    expect(full.exceedsReviewThreshold).toBe(true);
  });

  it("throws on an override above 100 or below 0", () => {
    expect(() =>
      combineTdmStrategies([{ key: "bike-parking", vmtReductionPctOverride: 100.1 }])
    ).toThrow(/must be between 0 and 100/);
    expect(() =>
      combineTdmStrategies([{ key: "bike-parking", vmtReductionPctOverride: -0.1 }])
    ).toThrow(/must be between 0 and 100/);
    expect(() =>
      combineTdmStrategies([{ key: "bike-parking", vmtReductionPctOverride: Number.NaN }])
    ).toThrow(/must be between 0 and 100/);
  });

  it("throws a plain Error on an unknown key", () => {
    expect(() => combineTdmStrategies([{ key: "free-helicopters" }])).toThrow(
      'Unknown TDM strategy key: "free-helicopters"'
    );
    expect(() => combineTdmStrategies([{ key: "free-helicopters" }])).not.toThrow(
      InsufficientDataError
    );
  });

  it("pins the review threshold at 30%", () => {
    expect(TDM_COMBINED_REVIEW_THRESHOLD_PCT).toBe(30);
  });
});

describe("applyTdmToAnnualVmt", () => {
  // combined = 11.175% (see the two-strategy golden above).
  const combination = combineTdmStrategies([
    { key: "unbundled-parking" },
    { key: "transit-subsidy" },
  ]);

  it("applies the combined reduction to a numeric base (golden)", () => {
    // reduced  = 1,000,000 × 0.11175 = 111,750
    // adjusted = 1,000,000 − 111,750 = 888,250
    const result = applyTdmToAnnualVmt(1_000_000, combination);
    expect(result.baseAnnualVmt).toBe(1_000_000);
    expect(result.annualVmtReduced).toBeCloseTo(111_750, 6);
    expect(result.adjustedAnnualVmt).toBeCloseTo(888_250, 6);
  });

  it("coerces a Supabase NUMERIC string base (golden)", () => {
    // base     = 1,200,000.5
    // reduced  = 1,200,000.5 × 0.11175
    //          = 1,200,000 × 0.11175 + 0.5 × 0.11175
    //          = 134,100 + 0.055875 = 134,100.055875
    // adjusted = 1,200,000.5 − 134,100.055875 = 1,065,900.444125
    const result = applyTdmToAnnualVmt("1200000.5", combination);
    expect(result.baseAnnualVmt).toBeCloseTo(1_200_000.5, 10);
    expect(result.annualVmtReduced).toBeCloseTo(134_100.055875, 4);
    expect(result.adjustedAnnualVmt).toBeCloseTo(1_065_900.444125, 4);
  });

  it("throws InsufficientDataError on null or blank input", () => {
    expect(() => applyTdmToAnnualVmt(null, combination)).toThrow(InsufficientDataError);
    expect(() => applyTdmToAnnualVmt("", combination)).toThrow(InsufficientDataError);
    expect(() => applyTdmToAnnualVmt("   ", combination)).toThrow(InsufficientDataError);
  });

  it("throws InsufficientDataError on zero or negative input", () => {
    expect(() => applyTdmToAnnualVmt(0, combination)).toThrow(InsufficientDataError);
    expect(() => applyTdmToAnnualVmt("0", combination)).toThrow(InsufficientDataError);
    expect(() => applyTdmToAnnualVmt(-5_000, combination)).toThrow(InsufficientDataError);
  });

  it("throws InsufficientDataError on non-finite input — never estimates a base", () => {
    expect(() => applyTdmToAnnualVmt(Number.NaN, combination)).toThrow(InsufficientDataError);
    expect(() => applyTdmToAnnualVmt(Number.POSITIVE_INFINITY, combination)).toThrow(
      InsufficientDataError
    );
    expect(() => applyTdmToAnnualVmt("not-a-number", combination)).toThrow(
      InsufficientDataError
    );
  });
});

describe("estimateGhgFromVmtReduction", () => {
  it("converts VMT reduced to metric tons CO2e with the default factor (golden)", () => {
    // 1,000,000 VMT × 0.78 lbs/mi = 780,000 lbs CO2e
    // 780,000 / 2,204.62262 lbs/t = 353.80205 t CO2e
    //   check: 2,204.62262 × 353.802 = 779,999.892…, remainder 0.108 →
    //   0.108 / 2,204.62262 ≈ 0.000049 → 353.802049…
    const result = estimateGhgFromVmtReduction(1_000_000);
    expect(result.annualMetricTonsCo2eReduced).toBeCloseTo(353.80205, 4);
    expect(result.annualMetricTonsCo2eReduced).toBeCloseTo(780_000 / LBS_PER_METRIC_TON, 10);
    expect(result.co2eLbsPerVehicleMile).toBe(DEFAULT_CO2E_LBS_PER_VEHICLE_MILE);
    expect(DEFAULT_CO2E_LBS_PER_VEHICLE_MILE).toBe(0.78);
    expect(LBS_PER_METRIC_TON).toBe(2204.62262);
  });

  it("honors a custom emissions factor (golden)", () => {
    // 1,000,000 VMT × 0.89 lbs/mi = 890,000 lbs CO2e
    // 890,000 / 2,204.62262 lbs/t = 403.69721 t CO2e
    //   check: 2,204.62262 × 403.697 = 889,999.538…, remainder 0.462 →
    //   0.462 / 2,204.62262 ≈ 0.00021 → 403.69721…
    const result = estimateGhgFromVmtReduction(1_000_000, { co2eLbsPerVehicleMile: 0.89 });
    expect(result.annualMetricTonsCo2eReduced).toBeCloseTo(403.69721, 4);
    expect(result.co2eLbsPerVehicleMile).toBe(0.89);
  });

  it("returns zero tons for zero VMT reduced", () => {
    expect(estimateGhgFromVmtReduction(0).annualMetricTonsCo2eReduced).toBe(0);
  });
});

describe("TDM_SCREENING_CAVEAT", () => {
  it("is pinned verbatim", () => {
    expect(TDM_SCREENING_CAVEAT).toBe(
      "Screening-level TDM estimate for early scoping — strategy effectiveness varies with context, baseline mode share, and program design. Confirm measure-level values against the CAPCOA Handbook (2021) or project-specific studies before CEQA or grant use."
    );
  });
});

describe("summarizeTdmCombination", () => {
  it("summarizes an unflagged combination without a review clause", () => {
    // combined 11.175% → "11.2"; additive 11.5% → "11.5"
    const summary = summarizeTdmCombination(
      combineTdmStrategies([{ key: "unbundled-parking" }, { key: "transit-subsidy" }])
    );
    expect(summary).toBe(
      "2 strategies combine to an estimated 11.2% VMT reduction (additive sum 11.5%)."
    );
    expect(summary).not.toMatch(/review/i);
  });

  it("uses singular grammar for one strategy", () => {
    const summary = summarizeTdmCombination(combineTdmStrategies([{ key: "transit-subsidy" }]));
    expect(summary).toBe(
      "1 strategy combines to an estimated 6.5% VMT reduction (additive sum 6.5%)."
    );
  });

  it("appends the review-threshold warning clause when flagged", () => {
    const summary = summarizeTdmCombination(
      combineTdmStrategies(TDM_STRATEGY_CATALOG.map((strategy) => ({ key: strategy.key })))
    );
    expect(summary).toMatch(/exceeds the 30% combined-program review threshold/);
    expect(summary).toMatch(/planner review required/i);
  });
});
